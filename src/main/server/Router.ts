import { IncomingMessage, ServerResponse } from 'http';
import SessionStore, { SessionWriteError, SessionWriteResult } from './SessionStore';
import normalizeQbjMatch from '../../renderer/Services/QbjMatchNormalizer';
import {
  authorizeRoom,
  buildAssignmentResponse,
  checkCanStart,
  findAssignmentForRoom,
  submittedBlockMessage,
} from './RoomDirectory';
import {
  findRoomForPairing,
  genericPairingFailureMessage,
  listEnabledRooms,
  PairingAttemptLimiter,
  toJoinResponse,
} from './RoomPairing';
import {
  ICreateSessionRequest,
  ICreateHelpRequest,
  IHelpMatchupContext,
  IHelpRequest,
  ISessionCreatedResponse,
  IRoomJoinListResponse,
  IRoomPresence,
  IRoomPresenceUpdateRequest,
  IRoomPlayerAddRequest,
  ITournamentSnapshot,
  SessionStatus,
  apiPrefix,
  deviceIdHeader,
  maxRequestBodyBytes,
  operatorNameHeader,
  roomTokenHeader,
  roomPlayerNameMaxLength,
  roomTeamMaxPlayers,
  RoomBlockedReason,
  RoomScorerKind,
  sessionTokenHeader,
} from './ServerTypes';
import { IPublicLiveSnapshot, IPublicPairingsSnapshot } from '../../shared/LiveTypes';
import { selectRoomAssignments } from '../../shared/RoomAssignmentState';
import { scorekeeperFormatProblems } from '../../renderer/Services/ScorekeeperFormat';
import { normalizeQbsheetOrigin } from '../../shared/QbsheetOrigin';

/** A parsed request body, or the reason it was refused */
type BodyResult = { ok: true; body: unknown } | { ok: false; status: number; message: string };

/** What the router needs from its host in order to do its job */
export interface IRouterHost {
  sessions: SessionStore;
  /** The read-only tournament projection to serve to rooms */
  getSnapshot: () => ITournamentSnapshot;
  /**
   * Called when a room submits a final result that the server hasn't seen before. The host hands
   * it to the YellowFruit renderer for validation. Never called for live snapshots.
   */
  onFinalSubmission: (sessionId: string) => void;
  /** Called whenever a live snapshot arrives, so the desktop dashboard can refresh */
  onSnapshot?: (sessionId: string) => void;
  /**
   * Called when a room starts its assigned game, so the desktop can move the scheduled match to
   * playing. Not called when an existing session is resumed.
   */
  onSessionStarted?: (sessionId: string) => void;
  /** Called whenever a permanent room page polls, including while it is waiting between games. */
  onRoomCheckIn?: (roomId: string, deviceId?: string, operatorName?: string, ready?: boolean) => void;
  /** Called after any session mutation so transient recovery state can be flushed. */
  onSessionChanged?: () => void;
  /** Serve the browser room application for non-API routes */
  serveStatic: (req: IncomingMessage, res: ServerResponse, pathname: string) => void;
  /** Return the deliberately reduced public projection, or null while Live Display is disabled */
  getPublicLiveSnapshot: () => IPublicLiveSnapshot | null;
  /** Return the separate public released-pairings projection, or null when disabled. */
  getPublicPairingsSnapshot?: () => IPublicPairingsSnapshot | null;
  /** Aggregate presence of all room browsers. */
  getRoomPresence?: () => IRoomPresence[];
  /** Current in-memory help requests. */
  getHelpRequests?: () => IHelpRequest[];
  /** Create a help request after its room token has been checked. */
  createHelpRequest?: (roomId: string, request: ICreateHelpRequest) => IHelpRequest | null;
  /** Resolve/cancel a help request after its owner has been checked. */
  updateHelpRequest?: (id: string, status: 'resolved' | 'cancelled', note?: string) => IHelpRequest | null;
  /** Forward one validated roster addition to the renderer that owns the Tournament model. */
  onRoomPlayerAdd?: (request: IRoomPlayerAddRequest) => void;
}

/** Longest URL we'll even look at, to avoid pathological parsing */
const maxUrlLength = 2048;

/**
 * Read and JSON-parse a request body, enforcing a size cap and requiring a JSON content type.
 *
 * The cap is enforced while streaming rather than after the fact, so an oversized upload is
 * destroyed instead of being buffered.
 */
export function readJsonBody(req: IncomingMessage): Promise<BodyResult> {
  return new Promise((resolve) => {
    const contentType = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (contentType !== 'application/json') {
      resolve({ ok: false, status: 415, message: 'Request body must be application/json.' });
      req.on('error', () => undefined);
      req.resume(); // drain so the connection can be reused
      return;
    }

    const declaredLength = Number(req.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > maxRequestBodyBytes) {
      resolve({ ok: false, status: 413, message: 'Request body is too large.' });
      req.on('error', () => undefined);
      req.destroy();
      return;
    }

    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;

    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      received += chunk.length;
      if (received > maxRequestBodyBytes) {
        settled = true;
        resolve({ ok: false, status: 413, message: 'Request body is too large.' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        resolve({ ok: true, body: JSON.parse(text) });
      } catch {
        resolve({ ok: false, status: 400, message: 'Request body is not valid JSON.' });
      }
    });

    req.on('error', () => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, status: 400, message: 'Failed to read the request body.' });
    });
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    // Room clients poll for their own session state; never let a proxy or browser cache it.
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function sendError(res: ServerResponse, status: number, message: string) {
  sendJson(res, status, { error: message });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}

function sendConnectionPage(req: IncomingMessage, res: ServerResponse, tournamentName: string) {
  const host = typeof req.headers.host === 'string' ? req.headers.host : 'this server';
  const body = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YellowFruit connection test</title></head><body style="font-family:system-ui,sans-serif;max-width:42rem;margin:4rem auto;padding:0 1.5rem"><h1>YellowFruit server is reachable</h1><p>Connected to <strong>${escapeHtml(
    tournamentName || 'the tournament',
  )}</strong>.</p><p>Server: ${escapeHtml(
    host,
  )}</p><p>This endpoint is only a connectivity check; no room credentials or scores are exposed.</p></body></html>`;
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
  });
  if ((req.method ?? 'GET') === 'HEAD') res.end();
  else res.end(body);
}

/** Map a session write failure onto an HTTP response */
function sendSessionWriteError(res: ServerResponse, result: { error: SessionWriteError }) {
  switch (result.error) {
    case SessionWriteError.NotFound:
      sendError(res, 404, 'No such session.');
      break;
    case SessionWriteError.BadToken:
      // Deliberately the same shape as NotFound would be, so a client can't probe for valid ids.
      sendError(res, 403, 'Not authorized for this session.');
      break;
    case SessionWriteError.AlreadyResolved:
      sendError(res, 409, 'This game has already been resolved by tournament control.');
      break;
    case SessionWriteError.FinalAwaitingReview:
      sendError(res, 409, 'A final is already awaiting tournament-control review.');
      break;
    case SessionWriteError.DifferentFinal:
      sendError(res, 409, 'A different final is already awaiting tournament-control review.');
      break;
    case SessionWriteError.DuplicateFinal:
      sendError(res, 409, 'Another room session already submitted a final for this scheduled game.');
      break;
    case SessionWriteError.TeamMismatch:
      sendError(
        res,
        409,
        'The teams in this game are not the teams this room was assigned. Check with tournament control before submitting.',
      );
      break;
    default:
      sendError(res, 400, 'Session could not be updated.');
  }
}

/** Pull a token out of the request headers */
function headerToken(req: IncomingMessage, header: string): string | undefined {
  const raw = req.headers[header];
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw[0];
  return undefined;
}

/** Pull the session token out of the request headers */
function tokenFrom(req: IncomingMessage): string | undefined {
  return headerToken(req, sessionTokenHeader);
}

/** Missing scorer fields use the rules the server actually has, while explicit choices stay strict. */
function parseRequestedScorer(value: unknown, snapshot: ITournamentSnapshot): RoomScorerKind {
  if (value === undefined) return snapshot.scoringFormat !== null ? 'first-party' : 'legacy';
  if (value === 'legacy') return 'legacy';
  return 'first-party';
}

/** Validate a create-session request body against the tournament we're actually running */
function validateCreateRequest(
  body: unknown,
  snapshot: ITournamentSnapshot,
): { ok: true; request: ICreateSessionRequest } | { ok: false; message: string } {
  if (typeof body !== 'object' || body === null) return { ok: false, message: 'Expected a JSON object.' };

  const { roundNumber, leftTeam, rightTeam, scorer: requestedScorer } = body as Record<string, unknown>;
  const scorer = parseRequestedScorer(requestedScorer, snapshot);

  if (typeof roundNumber !== 'number' || !Number.isFinite(roundNumber)) {
    return { ok: false, message: 'roundNumber must be a number.' };
  }
  if (
    typeof leftTeam !== 'string' ||
    typeof rightTeam !== 'string' ||
    leftTeam.trim() === '' ||
    rightTeam.trim() === ''
  ) {
    return { ok: false, message: 'leftTeam and rightTeam must be strings.' };
  }
  if (!snapshot.rounds.some((r) => r.number === roundNumber)) {
    return { ok: false, message: 'That round is not part of this tournament.' };
  }
  // Only teams that exist in the currently open tournament are allowed.
  const knownTeam = (name: string) => snapshot.teams.some((t) => t.name === name);
  if (!knownTeam(leftTeam) || !knownTeam(rightTeam)) {
    return { ok: false, message: 'Both teams must be teams in this tournament.' };
  }
  if (leftTeam === rightTeam) {
    return { ok: false, message: 'A team cannot play itself.' };
  }
  if (
    scorer === 'legacy'
      ? snapshot.gameFormat === null
      : snapshot.scoringFormat === null || scorekeeperFormatProblems(snapshot.scoringFormat).length > 0
  ) {
    return { ok: false, message: "This tournament's scoring rules cannot be used by the selected room scorer." };
  }
  if (snapshot.roomScoringMode === 'traditional') {
    return { ok: false, message: 'The generic session endpoint is disabled for traditional YellowFruit scoring.' };
  }

  // Current snapshots carry an explicit release. Older server snapshots did not, so retain their
  // current-round compatibility fallback while refusing an explicitly unreleased round.
  const releasedRound =
    snapshot.releasedRoundNumber === undefined ? snapshot.currentRoundNumber : snapshot.releasedRoundNumber;
  if (releasedRound === null || roundNumber > releasedRound) {
    return { ok: false, message: 'That round has not been released by tournament control.' };
  }

  const assigned = snapshot.assignments.find(
    (assignment) =>
      assignment.roundNumber === roundNumber &&
      assignment.status !== 'cancelled' &&
      [assignment.leftTeam, assignment.rightTeam].sort().join('\u0000') === [leftTeam, rightTeam].sort().join('\u0000'),
  );
  if (assigned) {
    return { ok: false, message: 'That game is assigned to a room; use the assigned-room link.' };
  }

  return { ok: true, request: { roundNumber, leftTeam, rightTeam, scorer } };
}

/** A QBJ Match body is only accepted if it at least looks like one */
function looksLikeQbjMatch(body: unknown): body is object {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false;
  const candidate = body as Record<string, unknown>;
  // MODAQ always emits match_teams; snake_case is the QBJ wire format.
  return Array.isArray(candidate.match_teams);
}

/**
 * Routes HTTP requests for the local tournament server.
 *
 * Only the endpoints a room scorekeeper needs exist. There are no admin mutation endpoints: a room
 * client cannot change the tournament, accept its own match, or read another room's session.
 */
export default class Router {
  private host: IRouterHost;

  private allowedQbsheetOrigins = new Set<string>();

  private pairingAttempts = new PairingAttemptLimiter();

  constructor(host: IRouterHost, allowedQbsheetOrigins: readonly string[] = []) {
    this.host = host;
    this.setAllowedQbsheetOrigins(allowedQbsheetOrigins);
  }

  setAllowedQbsheetOrigins(origins: readonly string[]) {
    this.allowedQbsheetOrigins = new Set(
      origins.map((origin) => normalizeQbsheetOrigin(origin)).filter((origin): origin is string => origin !== null),
    );
  }

  private applyCors(req: IncomingMessage, res: ServerResponse): { origin: string | undefined; allowed: boolean } {
    const rawOrigin = req.headers.origin;
    const origin = typeof rawOrigin === 'string' ? normalizeQbsheetOrigin(rawOrigin) ?? rawOrigin : undefined;
    const allowed = origin !== undefined && this.allowedQbsheetOrigins.has(origin);
    if (!allowed || origin === undefined) return { origin, allowed: false };

    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      [
        'Content-Type',
        'x-yf-room-token',
        'x-yf-session-token',
        'x-yf-device-id',
        'x-yf-operator-name',
        'Access-Control-Request-Private-Network',
      ].join(', '),
    );
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.headers['access-control-request-private-network'] === 'true') {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    return { origin, allowed: true };
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      await this.route(req, res);
    } catch {
      if (!res.headersSent) sendError(res, 500, 'The tournament server hit an unexpected error.');
      else res.end();
    }
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const rawUrl = req.url ?? '/';
    if (rawUrl.length > maxUrlLength) {
      sendError(res, 414, 'Request URL is too long.');
      return;
    }

    let pathname: string;
    try {
      // The base is only needed to parse a relative URL; it's never used to make a request.
      pathname = decodeURIComponent(new URL(rawUrl, 'http://localhost').pathname);
    } catch {
      sendError(res, 400, 'Malformed request URL.');
      return;
    }

    const method = req.method ?? 'GET';

    const cors = this.applyCors(req, res);
    if (method === 'OPTIONS' && pathname.startsWith(apiPrefix)) {
      if (cors.origin !== undefined && !cors.allowed) {
        sendError(res, 403, 'This browser origin is not approved for QBSheet.');
        return;
      }
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      res.end();
      return;
    }

    // A deliberately credential-free endpoint for the desktop to test the selected LAN address.
    if (pathname === '/connect') {
      this.requireMethod(req, res, 'GET', () => sendConnectionPage(req, res, this.host.getSnapshot().name));
      return;
    }

    if (!pathname.startsWith(apiPrefix)) {
      // Anything that isn't the API is the browser room application.
      this.host.serveStatic(req, res, pathname);
      return;
    }

    const route = pathname.slice(apiPrefix.length);
    const segments = route.split('/').filter((s) => s !== '');

    // GET /api/v1/public/snapshot
    if (segments.length === 2 && segments[0] === 'public' && segments[1] === 'snapshot') {
      this.requireMethod(req, res, 'GET', () => {
        const snapshot = this.host.getPublicLiveSnapshot();
        if (!snapshot) {
          sendError(res, 404, 'Live Display is disabled for this tournament.');
          return;
        }
        sendJson(res, 200, snapshot);
      });
      return;
    }

    // GET /api/v1/public/pairings
    if (segments.length === 2 && segments[0] === 'public' && segments[1] === 'pairings') {
      this.requireMethod(req, res, 'GET', () => {
        const snapshot = this.host.getPublicPairingsSnapshot?.() ?? null;
        if (!snapshot) {
          sendError(res, 404, 'Public pairings are disabled for this tournament.');
          return;
        }
        sendJson(res, 200, snapshot);
      });
      return;
    }

    // GET /api/v1/join/rooms — names only, for the optional room picker on the join screen. Also
    // carries the scoring workflow, so the landing page can open on pairing or on manual scoring
    // without the scorekeeper having to know which tournament this is.
    if (segments.length === 2 && segments[0] === 'join' && segments[1] === 'rooms') {
      this.requireMethod(req, res, 'GET', () => {
        const snapshot = this.host.getSnapshot();
        const payload: IRoomJoinListResponse = {
          rooms: listEnabledRooms(snapshot),
          roomScoringMode: snapshot.roomScoringMode === 'browser' ? 'browser' : 'traditional',
        };
        sendJson(res, 200, payload);
      });
      return;
    }

    // POST /api/v1/join — exchange an 8-digit human code for the selected room's long token.
    if (segments.length === 1 && segments[0] === 'join') {
      if (method !== 'POST') {
        sendError(res, 405, `${method} is not allowed for this endpoint.`);
        return;
      }
      await this.joinRoom(req, res);
      return;
    }

    // GET /api/v1/status
    if (segments.length === 1 && segments[0] === 'status') {
      this.requireMethod(req, res, 'GET', () => sendJson(res, 200, { status: 'ok' }));
      return;
    }

    // GET /api/v1/tournament
    if (segments.length === 1 && segments[0] === 'tournament') {
      this.requireMethod(req, res, 'GET', () => {
        const snapshot = this.host.getSnapshot();
        sendJson(res, 200, {
          tournamentKey: snapshot.recoveryKey,
          name: snapshot.name,
          gameFormat: snapshot.gameFormat,
          gameFormatErrors: snapshot.gameFormatErrors,
          gameFormatWarnings: snapshot.gameFormatWarnings,
          scoringFormat: snapshot.scoringFormat,
          timedRounds: snapshot.timedRounds,
          roomProcedure: snapshot.roomProcedure,
          roundCount: snapshot.rounds.length,
          teamCount: snapshot.teams.length,
        });
      });
      return;
    }

    // GET /api/v1/rounds
    if (segments.length === 1 && segments[0] === 'rounds') {
      this.requireMethod(req, res, 'GET', () => sendJson(res, 200, { rounds: this.host.getSnapshot().rounds }));
      return;
    }

    // GET /api/v1/teams
    if (segments.length === 1 && segments[0] === 'teams') {
      this.requireMethod(req, res, 'GET', () => sendJson(res, 200, { teams: this.host.getSnapshot().teams }));
      return;
    }

    if (segments[0] === 'rooms' && segments.length >= 2) {
      const roomId = segments[1];

      // GET /api/v1/rooms/:roomId/assignment
      if (segments.length === 3 && segments[2] === 'assignment') {
        if (method !== 'GET') {
          sendError(res, 405, `${method} is not allowed for this endpoint.`);
          return;
        }
        this.getRoomAssignment(req, res, roomId);
        return;
      }

      // POST /api/v1/rooms/:roomId/sessions
      if (segments.length === 3 && segments[2] === 'sessions') {
        if (method !== 'POST') {
          sendError(res, 405, `${method} is not allowed for this endpoint.`);
          return;
        }
        await this.startAssignedMatch(req, res, roomId);
        return;
      }

      // POST /api/v1/rooms/:roomId/players
      if (segments.length === 3 && segments[2] === 'players') {
        if (method !== 'POST') {
          sendError(res, 405, `${method} is not allowed for this endpoint.`);
          return;
        }
        await this.addRoomPlayer(req, res, roomId);
        return;
      }

      // GET /api/v1/rooms/:roomId/presence
      if (segments.length === 3 && segments[2] === 'presence') {
        if (method !== 'GET' && method !== 'POST') {
          sendError(res, 405, `${method} is not allowed for this endpoint.`);
          return;
        }
        await this.roomPresence(req, res, roomId, method === 'POST');
        return;
      }

      // GET/POST /api/v1/rooms/:roomId/help and DELETE /api/v1/rooms/:roomId/help/:helpId
      if (segments.length === 3 && segments[2] === 'help') {
        if (method === 'GET') {
          this.roomHelp(req, res, roomId);
          return;
        }
        if (method === 'POST') {
          await this.createRoomHelp(req, res, roomId);
          return;
        }
        sendError(res, 405, `${method} is not allowed for this endpoint.`);
        return;
      }
      if (segments.length === 4 && segments[2] === 'help' && method === 'DELETE') {
        this.cancelRoomHelp(req, res, roomId, segments[3]);
        return;
      }
    }

    // POST /api/v1/sessions
    if (segments.length === 1 && segments[0] === 'sessions') {
      if (method !== 'POST') {
        sendError(res, 405, `${method} is not allowed for this endpoint.`);
        return;
      }
      await this.createSession(req, res);
      return;
    }

    if (segments[0] === 'sessions' && segments.length >= 2) {
      const sessionId = segments[1];

      // GET /api/v1/sessions/:sessionId
      if (segments.length === 2) {
        if (method !== 'GET') {
          sendError(res, 405, `${method} is not allowed for this endpoint.`);
          return;
        }
        const result = this.host.sessions.read(sessionId, tokenFrom(req));
        if (!result.ok) {
          sendSessionWriteError(res, result);
          return;
        }
        sendJson(res, 200, SessionStore.toStateResponse(result.session));
        return;
      }

      /*
       * GET /api/v1/sessions/:sessionId/recovery
       *
       * The second recovery source, for a browser whose own local copy of its own game is missing
       * or unreadable. Authorized by the same session capability token every other write to this
       * session needs, so a room can only ever recover the game it is already holding credentials
       * for — there is no room-wide or server-wide session read here, and no way to reach another
       * session's payload by changing the id.
       */
      if (segments.length === 3 && segments[2] === 'recovery') {
        if (method !== 'GET') {
          sendError(res, 405, `${method} is not allowed for this endpoint.`);
          return;
        }
        const result = this.host.sessions.read(sessionId, tokenFrom(req));
        if (!result.ok) {
          sendSessionWriteError(res, result);
          return;
        }
        sendJson(res, 200, SessionStore.toRecoveryResponse(result.session));
        return;
      }

      // PUT /api/v1/sessions/:sessionId/snapshot
      if (segments.length === 3 && segments[2] === 'snapshot') {
        if (method !== 'PUT') {
          sendError(res, 405, `${method} is not allowed for this endpoint.`);
          return;
        }
        await this.writeSession(req, res, sessionId, 'snapshot');
        return;
      }

      // POST /api/v1/sessions/:sessionId/final
      if (segments.length === 3 && segments[2] === 'final') {
        if (method !== 'POST') {
          sendError(res, 405, `${method} is not allowed for this endpoint.`);
          return;
        }
        await this.writeSession(req, res, sessionId, 'final');
        return;
      }
    }

    sendError(res, 404, 'No such endpoint.');
  }

  // eslint-disable-next-line class-methods-use-this
  private requireMethod(req: IncomingMessage, res: ServerResponse, expected: string, handler: () => void) {
    const method = req.method ?? 'GET';
    if (method !== expected && !(expected === 'GET' && method === 'HEAD')) {
      sendError(res, 405, `${method} is not allowed for this endpoint.`);
      return;
    }
    handler();
  }

  private static pairingSource(req: IncomingMessage): string {
    return req.socket.remoteAddress ?? 'unknown-client';
  }

  private async joinRoom(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const source = Router.pairingSource(req);
    if (!this.pairingAttempts.isAllowed(source)) {
      req.resume();
      sendError(res, 429, genericPairingFailureMessage);
      return;
    }

    const bodyResult = await readJsonBody(req);
    if (!bodyResult.ok) {
      this.pairingAttempts.recordFailure(source);
      sendError(res, 400, genericPairingFailureMessage);
      return;
    }

    const body = bodyResult.body as Record<string, unknown>;
    const room =
      typeof body === 'object' && body !== null
        ? findRoomForPairing(this.host.getSnapshot(), body.code, body.roomId)
        : null;
    if (!room) {
      this.pairingAttempts.recordFailure(source);
      // Do not distinguish malformed, disabled, unknown, or mismatched codes.
      sendError(res, 404, genericPairingFailureMessage);
      return;
    }

    this.pairingAttempts.recordSuccess(source);
    sendJson(res, 200, toJoinResponse(room));
  }

  private roomPresenceValue(roomId: string): IRoomPresence {
    return (
      this.host.getRoomPresence?.().find((presence) => presence.roomId === roomId) ?? {
        roomId,
        lastSeenAt: null,
        msSinceLastSeen: null,
        connected: false,
        devices: [],
        readyDeviceCount: 0,
      }
    );
  }

  private async roomPresence(
    req: IncomingMessage,
    res: ServerResponse,
    roomId: string,
    hasBody: boolean,
  ): Promise<void> {
    const room = this.authorizeRoomOrRefuse(req, res, roomId);
    if (!room) {
      req.resume();
      return;
    }

    let update: IRoomPresenceUpdateRequest = {};
    if (hasBody) {
      const bodyResult = await readJsonBody(req);
      if (!bodyResult.ok) {
        sendError(res, bodyResult.status, bodyResult.message);
        return;
      }
      if (typeof bodyResult.body !== 'object' || bodyResult.body === null) {
        sendError(res, 400, 'Presence update must be a JSON object.');
        return;
      }
      const body = bodyResult.body as Record<string, unknown>;
      update = {
        deviceId: typeof body.deviceId === 'string' ? body.deviceId : headerToken(req, deviceIdHeader),
        operatorName: typeof body.operatorName === 'string' ? body.operatorName : headerToken(req, operatorNameHeader),
        ready: typeof body.ready === 'boolean' ? body.ready : undefined,
        scorer: body.scorer === undefined ? undefined : parseRequestedScorer(body.scorer, this.host.getSnapshot()),
      };
    }

    const snapshot = this.host.getSnapshot();
    let readyRulesUsable: boolean | undefined;
    if (update.scorer === 'legacy') readyRulesUsable = snapshot.gameFormat !== null;
    else if (update.scorer === 'first-party')
      readyRulesUsable =
        snapshot.scoringFormat !== null && scorekeeperFormatProblems(snapshot.scoringFormat).length === 0;
    if (update.ready === true && readyRulesUsable === false) {
      sendError(res, 409, 'This browser cannot be marked ready until usable scoring rules are loaded.');
      return;
    }
    const deviceId = update.deviceId ?? headerToken(req, deviceIdHeader) ?? 'unidentified';
    let readiness: boolean | undefined;
    if (hasBody && update.scorer !== undefined) readiness = readyRulesUsable ? update.ready : false;
    this.host.onRoomCheckIn?.(roomId, deviceId, update.operatorName ?? headerToken(req, operatorNameHeader), readiness);
    sendJson(res, 200, { presence: this.roomPresenceValue(roomId) });
  }

  private roomHelp(req: IncomingMessage, res: ServerResponse, roomId: string): void {
    const room = this.authorizeRoomOrRefuse(req, res, roomId);
    if (!room) return;
    const request = this.openHelpForDevice(roomId, headerToken(req, deviceIdHeader));
    sendJson(res, 200, { request: request ?? null });
  }

  private openHelpForDevice(roomId: string, deviceId: string | undefined): IHelpRequest | undefined {
    return this.host
      .getHelpRequests?.()
      .find(
        (candidate) =>
          candidate.roomId === roomId &&
          candidate.status === 'open' &&
          (candidate.deviceId ?? undefined) === (deviceId ?? undefined),
      );
  }

  private async createRoomHelp(req: IncomingMessage, res: ServerResponse, roomId: string): Promise<void> {
    const room = this.authorizeRoomOrRefuse(req, res, roomId);
    if (!room) {
      req.resume();
      return;
    }
    const bodyResult = await readJsonBody(req);
    if (!bodyResult.ok) {
      sendError(res, bodyResult.status, bodyResult.message);
      return;
    }
    if (typeof bodyResult.body !== 'object' || bodyResult.body === null) {
      sendError(res, 400, 'Help request must be a JSON object.');
      return;
    }
    const body = bodyResult.body as Record<string, unknown>;
    const snapshot = this.host.getSnapshot();
    const currentAssignment = selectRoomAssignments(
      snapshot.assignments.filter((assignment) => assignment.roomId === roomId),
      snapshot.releasedRoundNumber,
      snapshot.currentRoundNumber,
    ).current;
    const currentMatchup: IHelpMatchupContext | undefined = currentAssignment
      ? {
          roundNumber: currentAssignment.roundNumber,
          roundName: currentAssignment.roundName,
          leftTeam: currentAssignment.leftTeam,
          rightTeam: currentAssignment.rightTeam,
        }
      : undefined;
    const request: ICreateHelpRequest = {
      category: body.category as ICreateHelpRequest['category'],
      message: typeof body.message === 'string' ? body.message : undefined,
      deviceId: headerToken(req, deviceIdHeader) ?? (typeof body.deviceId === 'string' ? body.deviceId : undefined),
      operatorName: typeof body.operatorName === 'string' ? body.operatorName : headerToken(req, operatorNameHeader),
      currentMatchup,
    };
    const created = this.host.createHelpRequest?.(roomId, request);
    if (!created) {
      sendError(res, 400, 'This help request could not be created.');
      return;
    }
    sendJson(res, 200, { request: created });
  }

  private cancelRoomHelp(req: IncomingMessage, res: ServerResponse, roomId: string, helpId: string): void {
    const room = this.authorizeRoomOrRefuse(req, res, roomId);
    if (!room) return;
    const request = this.host.getHelpRequests?.().find((candidate) => candidate.id === helpId);
    if (
      !request ||
      request.roomId !== roomId ||
      (request.deviceId ?? undefined) !== (headerToken(req, deviceIdHeader) ?? undefined)
    ) {
      sendError(res, 404, 'No such help request.');
      return;
    }
    const updated = this.host.updateHelpRequest?.(helpId, 'cancelled');
    if (!updated) {
      sendError(res, 409, 'That help request is no longer open.');
      return;
    }
    sendJson(res, 200, { request: updated });
  }

  /**
   * Identify the calling room, or send the refusal.
   *
   * An unknown room and a bad token get the same 403, so a caller with no valid token can't use the
   * difference to work out which room ids exist.
   */
  private authorizeRoomOrRefuse(req: IncomingMessage, res: ServerResponse, roomId: string) {
    const result = authorizeRoom(this.host.getSnapshot(), roomId, headerToken(req, roomTokenHeader));
    if (!result.ok) {
      sendError(res, 403, 'This room link is not valid for the tournament that is currently open.');
      return null;
    }
    return result.room;
  }

  /**
   * What this room should be playing.
   *
   * The endpoint a Chromebook polls all day. It answers in one round trip so a room coming back from
   * a network drop recovers immediately, and it includes the token of any session already open for
   * the current game so a reload resumes rather than starting a second session.
   *
   * It always answers 200 for an authorized room, whatever the game's lifecycle state. A room whose
   * final is waiting on tournament control is a working, connected room in a perfectly normal state;
   * answering it with an HTTP error made the browser show a network failure and told the scorekeeper
   * their Chromebook had fallen off the network. Refusing an actual start remains the start
   * endpoint's job, where the authority belongs.
   */
  private getRoomAssignment(req: IncomingMessage, res: ServerResponse, roomId: string) {
    const room = this.authorizeRoomOrRefuse(req, res, roomId);
    if (!room) return;

    const snapshot = this.host.getSnapshot();
    this.host.onRoomCheckIn?.(roomId, headerToken(req, deviceIdHeader), headerToken(req, operatorNameHeader));
    const response = buildAssignmentResponse(snapshot, room);

    const scheduledMatchId = response.current?.scheduledMatchId;
    const existing = scheduledMatchId ? this.host.sessions.findResumableForScheduledMatch(scheduledMatchId) : undefined;
    const outcomeMatchIds = [response.current?.scheduledMatchId, response.previous?.scheduledMatchId].filter(
      (id): id is string => id !== undefined,
    );
    const latestOutcome = outcomeMatchIds
      .map((id) => this.host.sessions.findLatestForScheduledMatch(id))
      .filter((session): session is NonNullable<typeof session> => session !== undefined)
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt) || b.createdAt.localeCompare(a.createdAt))[0];

    // The snapshot's assignment status is the usual source of the Submitted block, but the live
    // session flips first: there is a window between the room's final landing here and the renderer
    // pushing back a snapshot that says so. Describe the state the server actually holds.
    const awaitingReview = existing?.status === SessionStatus.Submitted;

    sendJson(res, 200, {
      ...response,
      blockedReason: awaitingReview ? RoomBlockedReason.Submitted : response.blockedReason,
      blockedMessage: awaitingReview ? submittedBlockMessage : response.blockedMessage,
      session: existing ? SessionStore.toResumeInfo(existing) : null,
      presence: this.roomPresenceValue(roomId),
      helpRequest: this.openHelpForDevice(roomId, headerToken(req, deviceIdHeader)) ?? null,
      lastOutcome:
        latestOutcome?.scheduledMatchId !== undefined &&
        (latestOutcome.status === SessionStatus.Accepted || latestOutcome.status === SessionStatus.Rejected)
          ? {
              scheduledMatchId: latestOutcome.scheduledMatchId,
              status: latestOutcome.status,
              rejectionReason: latestOutcome.rejectionReason,
            }
          : undefined,
    });
  }

  /**
   * Start the game this room is assigned.
   *
   * Everything that ends up recorded — the round and both teams — comes from the tournament
   * snapshot, not the request. The room only says which assignment it believes it is starting, and
   * that is checked against what the room is actually assigned, so a stale page cannot start a game
   * that has moved or been finished.
   */
  private async startAssignedMatch(req: IncomingMessage, res: ServerResponse, roomId: string) {
    const room = this.authorizeRoomOrRefuse(req, res, roomId);
    if (!room) {
      req.resume();
      return;
    }

    const bodyResult = await readJsonBody(req);
    if (!bodyResult.ok) {
      sendError(res, bodyResult.status, bodyResult.message);
      return;
    }

    const startBody = bodyResult.body as Record<string, unknown>;
    const scheduledMatchId = startBody?.scheduledMatchId;
    const scorer = parseRequestedScorer(startBody?.scorer, this.host.getSnapshot());
    if (typeof scheduledMatchId !== 'string' || scheduledMatchId === '') {
      sendError(res, 400, 'scheduledMatchId must be a string.');
      return;
    }

    const snapshot = this.host.getSnapshot();
    const assignment = findAssignmentForRoom(snapshot, roomId, scheduledMatchId);
    if (!assignment) {
      sendError(res, 409, 'That game is not assigned to this room any more. This page will refresh itself.');
      return;
    }

    // A hold blocks new sessions, not a reload of a game already in progress. Find the existing
    // session before applying the start gate so an active room can recover during a hold.
    const existing = this.host.sessions.findResumableForScheduledMatch(scheduledMatchId);

    // The session is the authority on whether this game has already been filed, and it flips before
    // the renderer can push back a snapshot saying so. Without this, a room that submitted a final
    // and then pressed Start again inside that window would be handed its own submitted session
    // back and put straight into scoring on a game that is already with tournament control.
    if (existing?.status === SessionStatus.Submitted) {
      sendJson(res, 409, { error: submittedBlockMessage, blockedReason: RoomBlockedReason.Submitted });
      return;
    }

    const block = checkCanStart(snapshot, room, assignment, scorer);
    const canResumeDuringHold =
      existing !== undefined &&
      (existing.status === SessionStatus.Created || existing.status === SessionStatus.Playing) &&
      block?.reason === RoomBlockedReason.Hold;
    if (block && !canResumeDuringHold) {
      sendJson(res, 409, { error: block.message, blockedReason: block.reason });
      return;
    }

    // A reload, or a second tab, must not produce a second session for the same game.
    const session =
      existing ??
      this.host.sessions.create(assignment.roundNumber, assignment.leftTeam, assignment.rightTeam, {
        roomId,
        scheduledMatchId,
        tournamentKey: snapshot.recoveryKey,
      });

    const payload: ISessionCreatedResponse = {
      sessionId: session.id,
      token: session.token,
      roundNumber: session.roundNumber,
      leftTeam: session.leftTeam,
      rightTeam: session.rightTeam,
      status: session.status,
    };
    // 200 rather than 201 when resuming, so the client can tell it didn't create anything.
    sendJson(res, existing ? 200 : 201, payload);
    this.host.onSessionChanged?.();
    if (!existing) this.host.onSessionStarted?.(session.id);
  }

  private async addRoomPlayer(req: IncomingMessage, res: ServerResponse, roomId: string) {
    const room = this.authorizeRoomOrRefuse(req, res, roomId);
    if (!room) {
      req.resume();
      return;
    }
    const bodyResult = await readJsonBody(req);
    if (!bodyResult.ok) {
      sendError(res, bodyResult.status, bodyResult.message);
      return;
    }
    const body = bodyResult.body as Record<string, unknown>;
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
    const teamName = typeof body?.teamName === 'string' ? body.teamName : '';
    const playerName = typeof body?.playerName === 'string' ? body.playerName.trim() : '';
    if (!sessionId || !teamName || !playerName || playerName.length > roomPlayerNameMaxLength) {
      sendError(res, 400, 'sessionId, teamName, and a valid playerName are required.');
      return;
    }
    const read = this.host.sessions.read(sessionId, tokenFrom(req));
    if (!read.ok) {
      sendSessionWriteError(res, read);
      return;
    }
    const { session } = read;
    if (session.roomId !== roomId || session.status !== SessionStatus.Playing || session.finalReceived) {
      sendError(res, 409, "That session is not this room's current playing game.");
      return;
    }
    if (teamName !== session.leftTeam && teamName !== session.rightTeam) {
      sendError(res, 403, 'A room can only add a player to a team in its current game.');
      return;
    }
    const snapshot = this.host.getSnapshot();
    const team = snapshot.teams.find((candidate) => candidate.name === teamName);
    const duplicate = team?.players.some(
      (player) => player.name.toLocaleLowerCase() === playerName.toLocaleLowerCase(),
    );
    if (!team || (!duplicate && team.players.length >= roomTeamMaxPlayers)) {
      sendError(res, 409, 'That team cannot accept another player. Request tournament control.');
      return;
    }
    const assignment = session.scheduledMatchId
      ? findAssignmentForRoom(snapshot, roomId, session.scheduledMatchId)
      : undefined;
    if (!assignment || assignment.status !== 'playing') {
      sendError(res, 409, 'That session is not the current playing assignment for this room.');
      return;
    }
    this.host.onRoomPlayerAdd?.({
      roomId,
      sessionId,
      teamName,
      playerName,
      tournamentKey: session.tournamentKey,
    });
    sendJson(res, 202, { requested: true });
  }

  /**
   * Correct the question counts on an incoming QBJ match against the format we're running.
   *
   * With no usable game format there's nothing to correct against, so the payload is stored as sent
   * rather than guessed at.
   */
  private normalizeSubmission(qbj: object): object {
    const { gameFormat, timedRounds } = this.host.getSnapshot();
    if (!gameFormat) return qbj;
    return normalizeQbjMatch(qbj, {
      regulationTossupCount: gameFormat.regulationTossupCount,
      minimumOvertimeQuestionCount: gameFormat.minimumOvertimeQuestionCount,
      gameMayEndEarly: timedRounds,
    }).qbj;
  }

  private async createSession(req: IncomingMessage, res: ServerResponse) {
    const bodyResult = await readJsonBody(req);
    if (!bodyResult.ok) {
      sendError(res, bodyResult.status, bodyResult.message);
      return;
    }

    const snapshot = this.host.getSnapshot();
    const validated = validateCreateRequest(bodyResult.body, snapshot);
    if (!validated.ok) {
      sendError(res, 400, validated.message);
      return;
    }

    const { roundNumber, leftTeam, rightTeam } = validated.request;
    const session = this.host.sessions.create(roundNumber, leftTeam, rightTeam, {
      tournamentKey: snapshot.recoveryKey,
    });
    const payload: ISessionCreatedResponse = {
      sessionId: session.id,
      token: session.token,
      roundNumber: session.roundNumber,
      leftTeam: session.leftTeam,
      rightTeam: session.rightTeam,
      status: session.status,
    };
    sendJson(res, 201, payload);
    this.host.onSessionChanged?.();
  }

  private async writeSession(req: IncomingMessage, res: ServerResponse, sessionId: string, kind: 'snapshot' | 'final') {
    // Check authorization before reading the body, so an unauthorized client can't make us buffer
    // its upload.
    const token = tokenFrom(req);
    const preflight = this.host.sessions.read(sessionId, token);
    if (!preflight.ok) {
      sendSessionWriteError(res, preflight);
      req.resume();
      return;
    }

    const bodyResult = await readJsonBody(req);
    if (!bodyResult.ok) {
      sendError(res, bodyResult.status, bodyResult.message);
      return;
    }

    if (!looksLikeQbjMatch(bodyResult.body)) {
      sendError(res, 400, 'Request body must be a QBJ Match object with a match_teams array.');
      return;
    }

    // The room client corrects MODAQ's scaffold-inflated question counts before it uploads, but do
    // it again here so a stale or cached room bundle can't put bad counts into the tournament. The
    // correction is idempotent, so re-running it on an already-corrected match changes nothing.
    const qbj = this.normalizeSubmission(bodyResult.body);

    let result: SessionWriteResult;
    if (kind === 'snapshot') {
      result = this.host.sessions.updateSnapshot(sessionId, token, qbj);
    } else {
      result = this.host.sessions.submitFinal(sessionId, token, qbj);
    }

    if (!result.ok) {
      sendSessionWriteError(res, result);
      return;
    }

    if (kind === 'snapshot') {
      this.host.onSnapshot?.(sessionId);
      this.host.onSessionChanged?.();
    } else if (result.isNew) {
      // Only a genuinely new final gets handed to the statskeeper. A retry of the same submission
      // is acknowledged without creating a second candidate match.
      this.host.onFinalSubmission(sessionId);
      this.host.onSessionChanged?.();
    }

    sendJson(res, 200, {
      ...SessionStore.toStateResponse(result.session),
      /** False when this final had already been recorded; the room can stop retrying either way. */
      newSubmission: result.isNew,
    });
  }
}
