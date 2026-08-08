import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { networkInterfaces } from 'os';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { writeFileAtomically } from '../AtomicFile';
import Router, { IRouterHost } from './Router';
import SessionStore from './SessionStore';
import PresenceStore from './PresenceStore';
import HelpRequestStore from './HelpRequestStore';
import {
  ICreateHelpRequest,
  IHelpRequest,
  IMatchSubmission,
  INetworkAddress,
  IRoomPresence,
  IRoomPlayerAddRequest,
  IServerStatus,
  ISessionSummary,
  ISubmissionVerdict,
  ITournamentServerRecovery,
  ITournamentSnapshot,
  defaultServerPort,
  emptyTournamentSnapshot,
  staleRoomThresholdMs,
} from './ServerTypes';
import { IPublicLiveSnapshot, IPublicPairingsSnapshot } from '../../shared/LiveTypes';

/** Content types for the handful of file types the room bundle is made of */
const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

function isValidTimestamp(value: string): boolean {
  return Number.isFinite(new Date(value).getTime());
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'unknown error';
}

export interface ITournamentServerOptions {
  /** Directory holding the built browser room bundle */
  roomBundleDirectory: string;
  /** Directory holding the separate public audience/display bundle */
  liveBundleDirectory?: string;
  /** Called when a room submits a final result that needs the statskeeper's decision */
  onFinalSubmission: (submission: IMatchSubmission) => void;
  /** Called when any session changes, so the desktop dashboard can refresh */
  onSessionsChanged?: (sessions: ISessionSummary[]) => void;
  /**
   * Called when a room starts its assigned game, so the desktop can move that scheduled match to
   * playing.
   */
  onSessionStarted?: (sessionId: string, scheduledMatchId: string, tournamentKey?: string) => void;
  /** Called when a room creates or closes an operational help request. */
  onHelpRequestsChanged?: (requests: IHelpRequest[]) => void;
  /** Called after the HTTP layer authenticates and scopes a room roster addition. */
  onRoomPlayerAdd?: (request: IRoomPlayerAddRequest) => void;
  /** Small versioned JSON file in app-data used to restore active room sessions after a restart. */
  recoveryFilePath?: string;
}

type TournamentServerLifecycle = 'stopped' | 'starting' | 'running' | 'stopping';

/**
 * The optional local HTTP server that serves the browser room application and accepts QBJ match
 * submissions from it.
 *
 * Runs in the Electron main process but imports nothing from Electron, so it can be exercised
 * directly in tests. It binds only when explicitly started, and never on its own.
 */
export default class TournamentServer {
  private server: Server | null = null;

  private lifecycle: TournamentServerLifecycle = 'stopped';

  private startPromise: Promise<IServerStatus> | null = null;

  private stopPromise: Promise<IServerStatus> | null = null;

  private port: number = defaultServerPort;

  private lastErrorMessage: string | undefined;

  private snapshot: ITournamentSnapshot = emptyTournamentSnapshot;

  /** Public projection supplied by the renderer; null means the tournament has disabled Live Display. */
  private publicLiveSnapshot: IPublicLiveSnapshot | null = null;

  /** Separate public released-pairings projection; it is not implied by Live Display. */
  private publicPairingsSnapshot: IPublicPairingsSnapshot | null = null;

  readonly sessions = new SessionStore();

  private router: Router;

  private options: ITournamentServerOptions;

  private recoveryKey: string | undefined;

  private roomLastSeenAt = new Map<string, string>();

  private presence = new PresenceStore();

  private helpRequests = new HelpRequestStore();

  private recoveryWritePromise: Promise<void> = Promise.resolve();

  /** A deliberate stop clears in-memory sessions; the next start may restore the durable copy. */
  private restoreAfterStop = false;

  constructor(options: ITournamentServerOptions) {
    this.options = options;
    this.restoreRecovery();

    const host: IRouterHost = {
      sessions: this.sessions,
      getSnapshot: () => this.snapshot,
      getPublicLiveSnapshot: () => this.publicLiveSnapshot,
      getPublicPairingsSnapshot: () => this.publicPairingsSnapshot,
      onFinalSubmission: (sessionId) => this.handleFinalSubmission(sessionId),
      onSnapshot: () => this.notifySessionsChanged(),
      onRoomCheckIn: (roomId, deviceId, operatorName, ready) =>
        this.markRoomCheckIn(roomId, deviceId, operatorName, ready),
      onSessionChanged: () => this.notifySessionsChanged(),
      onSessionStarted: (sessionId) => {
        const session = this.sessions.get(sessionId);
        if (session?.scheduledMatchId) {
          this.options.onSessionStarted?.(sessionId, session.scheduledMatchId, session.tournamentKey);
        }
        this.notifySessionsChanged();
      },
      getRoomPresence: () => this.getRoomPresence(),
      getHelpRequests: () => this.getHelpRequests(),
      createHelpRequest: (roomId, request) => this.createHelpRequest(roomId, request),
      updateHelpRequest: (id, status, note) => this.updateHelpRequest(id, status, note),
      onRoomPlayerAdd: (request) => this.options.onRoomPlayerAdd?.(request),
      serveStatic: (req, res, pathname) => this.serveStatic(req, res, pathname),
    };
    this.router = new Router(host);
  }

  /** Replace the read-only tournament projection served to rooms */
  setTournamentSnapshot(snapshot: ITournamentSnapshot) {
    if (snapshot.recoveryKey && this.recoveryKey && snapshot.recoveryKey !== this.recoveryKey) {
      // A different tournament must never inherit another tournament's room credentials or final
      // results. The renderer sends this stable key before the server can serve a request.
      this.sessions.clear();
      this.roomLastSeenAt.clear();
      this.presence.clear();
      this.helpRequests.clear();
      this.publicLiveSnapshot = null;
      this.publicPairingsSnapshot = null;
    }
    if (snapshot.recoveryKey) this.recoveryKey = snapshot.recoveryKey;
    this.snapshot = snapshot;
    this.discardRecoveredSessionsMissingFromSnapshot();
    this.persistRecovery();
  }

  /** Replace the separate public projection. It never shares the room snapshot's credentials or session state. */
  setPublicLiveSnapshot(snapshot: IPublicLiveSnapshot | null) {
    this.publicLiveSnapshot = snapshot;
  }

  setPublicPairingsSnapshot(snapshot: IPublicPairingsSnapshot | null) {
    this.publicPairingsSnapshot = snapshot;
  }

  getPublicPairingsSnapshot(): IPublicPairingsSnapshot | null {
    return this.publicPairingsSnapshot;
  }

  getPublicLiveSnapshot(): IPublicLiveSnapshot | null {
    return this.publicLiveSnapshot;
  }

  getTournamentSnapshot(): ITournamentSnapshot {
    return this.snapshot;
  }

  isRunning(): boolean {
    return this.lifecycle === 'running' && this.server !== null && this.server.listening;
  }

  getPort(): number {
    return this.port;
  }

  /**
   * Start listening. Resolves with the resulting status either way; a failure to bind is reported
   * through `errorMessage` rather than thrown, because the desktop UI needs to show it.
   */
  start(port: number = defaultServerPort): Promise<IServerStatus> {
    if (this.isRunning()) return Promise.resolve(this.getStatus());

    if (this.startPromise) return this.startPromise;
    if (this.stopPromise) return this.stopPromise.then(() => this.start(port));

    // `stop()` keeps the recovery file but clears memory, so a deliberate stop/start cycle has the
    // same safe resume behavior as an application restart. The constructor already restores once;
    // avoid rereading a stale file over live state on the initial start.
    if (this.restoreAfterStop) {
      this.restoreAfterStop = false;
      this.restoreRecovery();
    }

    this.port = port;
    this.lastErrorMessage = undefined;

    this.lifecycle = 'starting';
    const startPromise = new Promise<IServerStatus>((resolve) => {
      const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        this.router.handle(req, res);
      });

      // A tournament LAN is not hostile by design, but it isn't trusted either. Keep connections
      // short-lived and cap headers so a single client can't tie the server up.
      server.headersTimeout = 10000;
      server.requestTimeout = 30000;
      server.maxHeadersCount = 64;

      const onError = (err: Error & { code?: string }) => {
        this.lastErrorMessage =
          err.code === 'EADDRINUSE'
            ? `Port ${port} is already being used by another program. Try a different port.`
            : `Couldn't start the tournament server: ${err.message}`;
        this.server = null;
        this.lifecycle = 'stopped';
        server.removeAllListeners();
        if (server.listening) server.close();
        resolve(this.getStatus());
      };

      server.once('error', onError);
      // Bind on all interfaces so Chromebooks on the LAN can reach it.
      server.listen(port, () => {
        server.removeListener('error', onError);
        // Once listening, later errors shouldn't take the process down.
        server.on('error', (err) => {
          this.lastErrorMessage = err.message;
        });
        this.server = server;
        this.lifecycle = 'running';
        const address = server.address();
        if (address && typeof address !== 'string') this.port = (address as AddressInfo).port;
        resolve(this.getStatus());
      });

      // A post-bind error must not become an unhandled rejection or leave the desktop claiming a
      // running server whose socket has already disappeared.
      server.on('error', (err: Error & { code?: string }) => {
        this.lastErrorMessage = err.message;
        if (!server.listening && this.server === server) {
          this.server = null;
          this.lifecycle = 'stopped';
        }
      });
    });

    const settledStart = startPromise.finally(() => {
      if (this.startPromise === settledStart) this.startPromise = null;
    });
    this.startPromise = settledStart;
    return settledStart;
  }

  /** Stop listening. Existing sessions are discarded, since they only mean anything while up. */
  stop(): Promise<IServerStatus> {
    if (this.stopPromise) return this.stopPromise;
    const operation = this.startPromise ? this.startPromise.then(() => this.stopListening()) : this.stopListening();
    const settledStop = operation.finally(() => {
      if (this.stopPromise === settledStop) this.stopPromise = null;
    });
    this.stopPromise = settledStop;
    return settledStop;
  }

  /** Stop after any start race has been resolved; callers use `stop()` for coalescing. */
  private stopListening(): Promise<IServerStatus> {
    const { server } = this;
    if (!server) {
      this.restoreAfterStop = true;
      this.lifecycle = 'stopped';
      // A renderer can create a recovery-backed session before the listener is bound (for example
      // while a previous start is being replaced). Flush that state before clearing memory just as
      // the listening-server path does.
      this.persistRecovery();
      const clearPromise = this.recoveryWritePromise.then(() => {
        this.sessions.clear();
        this.roomLastSeenAt.clear();
        this.presence.clear();
        this.helpRequests.clear();
        return this.getStatus();
      });
      return clearPromise;
    }

    this.lifecycle = 'stopping';
    this.restoreAfterStop = true;
    this.persistRecovery();
    this.server = null;
    const stopPromise = this.recoveryWritePromise.then(
      () =>
        new Promise<IServerStatus>((resolve) => {
          let finished = false;
          const finish = () => {
            if (finished) return;
            finished = true;
            this.sessions.clear();
            this.presence.clear();
            this.helpRequests.clear();
            this.lifecycle = 'stopped';
            resolve(this.getStatus());
          };
          const timeout = setTimeout(finish, 3000);
          timeout.unref?.();
          if (!server.listening) {
            clearTimeout(timeout);
            finish();
            return;
          }
          server.close(() => {
            clearTimeout(timeout);
            finish();
          });
          // Don't wait on keep-alive connections from rooms that have gone away.
          server.closeAllConnections?.();
        }),
    );
    return stopPromise;
  }

  getStatus(): IServerStatus {
    const networkAddresses = this.isRunning() ? TournamentServer.getLanNetworkAddresses(this.port) : [];
    return {
      running: this.isRunning(),
      port: this.port,
      addresses: networkAddresses.map((entry) => entry.url),
      networkAddresses,
      errorMessage: this.lastErrorMessage,
      tournamentKey: this.recoveryKey,
    };
  }

  getSessionSummaries(): ISessionSummary[] {
    return this.sessions.summarize();
  }

  /** Finals that survived an application restart and still need a renderer-side decision. */
  getPendingSubmissions(): IMatchSubmission[] {
    let changed = false;
    const pending = this.sessions
      .getAll()
      .flatMap((session) => {
        if (
          session.status === 'submitted' &&
          session.finalReceived &&
          session.latestQbj !== null &&
          this.hasDurableAcceptedLink(session)
        ) {
          // Case C: the .yft commit won the crash race. The durable assignment is authoritative;
          // reconcile the transient session without handing the final back to the renderer.
          changed = this.sessions.markAccepted(session.id) !== undefined || changed;
          return [];
        }
        if (
          session.status === 'accepted' &&
          session.finalReceived &&
          session.latestQbj !== null &&
          !this.hasDurableAcceptedLink(session)
        ) {
          // Case B: the transient server verdict raced a crash before the .yft replacement. Keep
          // the final and re-offer it rather than letting an Accepted-in-memory session disappear.
          changed = this.sessions.demoteAcceptedForRecovery(session.id) !== undefined || changed;
        }
        return session.status === 'submitted' && session.finalReceived && session.latestQbj !== null ? [session] : [];
      })
      .map((session) => ({
        sessionId: session.id,
        roundNumber: session.roundNumber,
        leftTeam: session.leftTeam,
        rightTeam: session.rightTeam,
        roomId: session.roomId,
        scheduledMatchId: session.scheduledMatchId,
        qbj: session.latestQbj as object,
        submittedAt: session.lastSeenAt,
        tournamentKey: session.tournamentKey,
        sessionStatus: session.status,
        finalRevision: session.finalRevision,
        finalFingerprint: session.finalFingerprint,
      }));
    if (changed) this.notifySessionsChanged();
    return pending;
  }

  /** Presence is separate from sessions so an idle room can still appear connected. */
  getRoomPresence(): IRoomPresence[] {
    const now = Date.now();
    return this.snapshot.rooms.map((room) => {
      const devicePresence = this.presence.getRoom(room, now);
      const lastSeenAt = this.roomLastSeenAt.get(room.id) ?? null;
      const deviceLastSeenAt = devicePresence.lastSeenAt;
      const effectiveLastSeenAt =
        lastSeenAt && (!deviceLastSeenAt || new Date(lastSeenAt).getTime() > new Date(deviceLastSeenAt).getTime())
          ? lastSeenAt
          : deviceLastSeenAt;
      const msSinceLastSeen =
        effectiveLastSeenAt === null ? null : Math.max(0, now - new Date(effectiveLastSeenAt).getTime());
      return {
        roomId: room.id,
        lastSeenAt: effectiveLastSeenAt,
        msSinceLastSeen,
        connected: devicePresence.connected || (msSinceLastSeen !== null && msSinceLastSeen <= staleRoomThresholdMs),
        devices: devicePresence.devices,
        readyDeviceCount: devicePresence.readyDeviceCount,
      };
    });
  }

  getHelpRequests(): IHelpRequest[] {
    return this.helpRequests.list();
  }

  private createHelpRequest(roomId: string, request: ICreateHelpRequest): IHelpRequest | null {
    const room = this.snapshot.rooms.find((candidate) => candidate.id === roomId && candidate.enabled);
    if (!room) return null;
    const created = this.helpRequests.create(room, request);
    if (created) this.notifyHelpRequestsChanged();
    return created;
  }

  updateHelpRequest(id: string, status: 'resolved' | 'cancelled', note?: string): IHelpRequest | null {
    const updated = this.helpRequests.updateState(id, status, note);
    if (updated) this.notifyHelpRequestsChanged();
    return updated;
  }

  /**
   * Every usable LAN URL for this machine.
   *
   * The first network interface is often not the right one (VPNs, Docker bridges, virtual adapters),
   * so list them all and let the person running the tournament pick the one their Chromebooks can
   * see. Loopback and link-local addresses are excluded because no other device can reach them.
   */
  static getLanAddresses(port: number): string[] {
    return TournamentServer.getLanNetworkAddresses(port).map((entry) => entry.url);
  }

  static getLanNetworkAddresses(port: number): INetworkAddress[] {
    const addresses: INetworkAddress[] = [];
    const interfaces = networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] ?? []) {
        // Node <18 reports family as a string, newer versions as a number.
        const isIpv4 = iface.family === 'IPv4' || (iface.family as unknown as number) === 4;
        if (!isIpv4 || iface.internal) continue;
        if (iface.address.startsWith('169.254.')) continue; // link-local, not routable
        addresses.push({
          interfaceName: name,
          address: iface.address,
          url: `http://${iface.address}:${port}`,
        });
      }
    }
    return addresses;
  }

  /** Mark a session accepted, after the statskeeper approved the match in the Match Inbox */
  acceptSession(sessionId: string, expectedFinal?: Pick<ISubmissionVerdict, 'finalRevision' | 'finalFingerprint'>) {
    if (this.sessions.markAccepted(sessionId, expectedFinal)) this.notifySessionsChanged();
  }

  /** Mark a session rejected */
  rejectSession(
    sessionId: string,
    reason?: string,
    expectedFinal?: Pick<ISubmissionVerdict, 'finalRevision' | 'finalFingerprint'>,
  ) {
    if (this.sessions.markRejected(sessionId, reason, expectedFinal)) this.notifySessionsChanged();
  }

  private notifySessionsChanged() {
    this.persistRecovery();
    this.options.onSessionsChanged?.(this.getSessionSummaries());
  }

  /** A server Accepted verdict is durable only when the current tournament projection proves its link. */
  private hasDurableAcceptedLink(session: { scheduledMatchId?: string }): boolean {
    if (!session.scheduledMatchId) return false;
    const assignment = this.snapshot.assignments.find(
      (candidate) => candidate.scheduledMatchId === session.scheduledMatchId,
    );
    return (
      assignment?.status === 'accepted' &&
      typeof assignment.resultMatchId === 'string' &&
      assignment.resultMatchId !== ''
    );
  }

  /** Recovery entries for a closed/deleted schedule must never become resumable room credentials. */
  private discardRecoveredSessionsMissingFromSnapshot() {
    let discarded = false;
    for (const session of this.sessions.getAll()) {
      if (
        session.scheduledMatchId &&
        !this.snapshot.assignments.some((assignment) => assignment.scheduledMatchId === session.scheduledMatchId) &&
        !(session.finalReceived && session.latestQbj !== null)
      ) {
        this.sessions.remove(session.id);
        discarded = true;
        // eslint-disable-next-line no-console
        console.error(`Tournament recovery session ${session.id} was discarded because its scheduled game is absent.`);
      }
    }
    if (discarded) this.persistRecovery();
  }

  private markRoomCheckIn(roomId: string, deviceId?: string, operatorName?: string, ready?: boolean) {
    this.roomLastSeenAt.set(roomId, new Date().toISOString());
    this.presence.checkIn(roomId, deviceId ?? 'unidentified', operatorName, ready);
    this.persistRecovery();
  }

  private notifyHelpRequestsChanged() {
    this.options.onHelpRequestsChanged?.(this.getHelpRequests());
  }

  /** Load a corrupt or missing recovery file as an empty store rather than failing startup. */
  private restoreRecovery() {
    const filePath = this.options.recoveryFilePath;
    if (!filePath || !existsSync(filePath)) return;
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<ITournamentServerRecovery>;
      if (
        (parsed.version !== 1 && parsed.version !== 2) ||
        typeof parsed.recoveryKey !== 'string' ||
        typeof parsed.savedAt !== 'string' ||
        !isValidTimestamp(parsed.savedAt)
      ) {
        // eslint-disable-next-line no-console
        console.error('Tournament recovery file invalid; starting with no recoverable sessions.');
        return;
      }

      if (this.recoveryKey && parsed.recoveryKey !== this.recoveryKey) {
        // A file from an earlier tournament may still be present while the renderer is switching
        // documents. Never let it repopulate sessions for the newly open tournament.
        this.sessions.clear();
        this.roomLastSeenAt.clear();
        // eslint-disable-next-line no-console
        console.error('Tournament recovery file belongs to a different tournament; ignoring its sessions.');
        return;
      }

      this.recoveryKey = parsed.recoveryKey;
      const diagnostics = this.sessions.restore(parsed.sessions);
      diagnostics.forEach((diagnostic) => {
        // eslint-disable-next-line no-console
        console.error(`Tournament recovery session skipped: ${diagnostic}`);
      });
      if (parsed.roomLastSeenAt && typeof parsed.roomLastSeenAt === 'object') {
        for (const [roomId, timestamp] of Object.entries(parsed.roomLastSeenAt)) {
          if (typeof timestamp === 'string' && Number.isFinite(new Date(timestamp).getTime())) {
            this.roomLastSeenAt.set(roomId, timestamp);
          }
        }
      }
    } catch (error: unknown) {
      // Recovery is best effort. MODAQ and the browser queue remain the last-resort copy of a game.
      // eslint-disable-next-line no-console
      console.error(
        `Tournament recovery file could not be read: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  /** Persist transient state atomically so a power loss cannot leave half a JSON document. */
  private persistRecovery() {
    const filePath = this.options.recoveryFilePath;
    if (!filePath || !this.recoveryKey) return;
    try {
      const directory = path.dirname(filePath);
      mkdirSync(directory, { recursive: true });
      const payload: ITournamentServerRecovery = {
        version: 2,
        recoveryKey: this.recoveryKey,
        savedAt: new Date().toISOString(),
        sessions: this.sessions.toRecoverySessions(),
        roomLastSeenAt: Object.fromEntries(this.roomLastSeenAt.entries()),
      };
      const serialized = JSON.stringify(payload);
      this.recoveryWritePromise = this.recoveryWritePromise
        .catch(() => undefined)
        .then(() => writeFileAtomically(filePath, serialized))
        .catch((error: unknown) => {
          // A recovery write failure must not bring down live scoring; the browser keeps its own queue.
          // eslint-disable-next-line no-console
          console.error(
            `Tournament recovery write failed: ${error instanceof Error ? error.message : 'unknown error'}`,
          );
        });
    } catch (error: unknown) {
      // Directory creation/serialization can fail before the asynchronous write chain exists. Keep
      // the server alive and make the failure diagnosable without exposing session tokens.
      // eslint-disable-next-line no-console
      console.error(
        `Tournament recovery preparation failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  /** Hand a brand-new final submission to the host so it can reach the renderer for validation */
  private handleFinalSubmission(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.latestQbj) return;

    this.persistRecovery();

    const submission: IMatchSubmission = {
      sessionId: session.id,
      roundNumber: session.roundNumber,
      leftTeam: session.leftTeam,
      rightTeam: session.rightTeam,
      roomId: session.roomId,
      scheduledMatchId: session.scheduledMatchId,
      qbj: session.latestQbj,
      submittedAt: session.lastSeenAt,
      tournamentKey: session.tournamentKey,
      sessionStatus: session.status,
      finalRevision: session.finalRevision,
      finalFingerprint: session.finalFingerprint,
    };
    try {
      this.options.onFinalSubmission(submission);
    } catch (error: unknown) {
      // The final is already durably retained in the recovery store. A renderer callback failure
      // must not turn the HTTP server into an uncaught exception or discard the room's retryable
      // submission.
      // eslint-disable-next-line no-console
      console.error(`Tournament final handoff failed: ${errorMessage(error)}`);
    }
    this.notifySessionsChanged();
  }

  /**
   * Serve the browser room or public live application.
   *
   * Paths from the client are never trusted: the resolved path must stay inside the bundle
   * directory, and anything that isn't a real file there falls back to index.html so the room app
   * can handle its own routing. Nothing outside the bundle directory is reachable.
   */
  private serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string) {
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return;
    }

    const isLivePath = pathname === '/live' || pathname === '/live/' || pathname.startsWith('/live/');
    const root = isLivePath ? this.options.liveBundleDirectory : this.options.roomBundleDirectory;
    if (!root) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('The public live application is not available.');
      return;
    }
    const indexPath = path.join(root, 'index.html');

    const pathWithinBundle = isLivePath ? pathname.replace(/^\/live\/?/, '') : pathname;
    const relative =
      pathWithinBundle === '' || pathWithinBundle === '/' ? 'index.html' : pathWithinBundle.replace(/^\/+/, '');
    // path.resolve collapses any ".." the client sent; the containment check below is what makes
    // that safe rather than the normalization itself.
    const candidate = path.resolve(root, relative);
    const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;

    let fileToServe = indexPath;
    if (candidate === root || candidate.startsWith(rootWithSep)) {
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        fileToServe = candidate;
      }
    }

    if (!existsSync(fileToServe)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(
        isLivePath
          ? 'The public live application has not been built. Run "npm run build:live" (or "npm run build") and restart the server.'
          : 'The room application has not been built. Run "npm run build:room" (or "npm run build") and restart the server.',
      );
      return;
    }

    const extension = path.extname(fileToServe).toLowerCase();
    res.writeHead(200, {
      'Content-Type': contentTypes[extension] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });

    if (method === 'HEAD') {
      res.end();
      return;
    }

    const stream = createReadStream(fileToServe);
    stream.on('error', () => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
    stream.pipe(res);
  }
}
