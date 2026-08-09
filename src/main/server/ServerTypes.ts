/**
 * Types shared between the Electron main-process tournament server, the YellowFruit renderer, and
 * the browser room application.
 *
 * Everything here is a plain JSON-serializable DTO. Nothing from YellowFruit's internal data model
 * belongs in this file: the whole point is that room clients see a small, deliberate projection of
 * the tournament rather than the internal object graph.
 */
import { ScheduledMatchStatus } from '../../renderer/DataModel/ScheduledMatch';
import { IModaqGameFormat } from '../../renderer/Services/YellowFruitScoringRulesToModaq';
import type { IScorekeeperFormat } from '../../renderer/Services/ScorekeeperFormat';
import type { IRoomProcedure } from '../../renderer/Services/RoomProcedure';

/** Default port for the local tournament server */
export const defaultServerPort = 4732;

/** Largest request body the server will accept, in bytes. Room submissions are small JSON. */
export const maxRequestBodyBytes = 512 * 1024;

/** Mirrors Player.nameMaxLength without importing renderer model objects into the main process. */
export const roomPlayerNameMaxLength = 200;
/** Mirrors Team.maxPlayers without importing renderer model objects into the main process. */
export const roomTeamMaxPlayers = 100;

/** Header a room client uses to prove it owns the session it's writing to */
export const sessionTokenHeader = 'x-yf-session-token';

/**
 * Header a room client uses to prove which room it is.
 *
 * A room token authorizes that room's own scorekeeping and nothing else: it cannot read another
 * room, write another room's session, or change anything about the tournament.
 */
export const roomTokenHeader = 'x-yf-room-token';

/** Optional, non-secret browser identity used only for presence and operator-facing workflows. */
export const deviceIdHeader = 'x-yf-device-id';

/** Optional display name supplied by the person running a room browser. */
export const operatorNameHeader = 'x-yf-operator-name';

/** Prefix for all HTTP API routes */
export const apiPrefix = '/api/v1';

/** How long without a snapshot before the desktop UI considers a room stale */
export const staleSessionThresholdMs = 60 * 1000;

/** A room is considered connected while its permanent page is still polling this server. */
export const staleRoomThresholdMs = 60 * 1000;

// #region Tournament projection served to rooms

/** One player on a team roster, as a room needs it */
export interface IRoomPlayer {
  name: string;
}

/** Narrow, authenticated request forwarded from a playing room to the authoritative renderer. */
export interface IRoomPlayerAddRequest {
  roomId: string;
  sessionId: string;
  teamName: string;
  playerName: string;
  tournamentKey?: string;
}

/** One team a room is allowed to pick */
export interface IRoomTeam {
  /** Team name, exactly as YellowFruit knows it. Used to match the match back on import. */
  name: string;
  players: IRoomPlayer[];
}

/** One round a room is allowed to pick */
export interface IRoomRound {
  number: number;
  /** The round's complete display name, e.g. "Round 4" or "Finals". Shown as it stands. */
  name: string;
}

/**
 * The read-only projection of the open tournament that room clients get. The renderer builds this
 * and pushes it to the main process; the main process only ever serves it.
 */
export interface ITournamentSnapshot {
  /** Tournament name, for display in the room UI */
  name: string;
  rounds: IRoomRound[];
  teams: IRoomTeam[];
  /**
   * MODAQ game format derived from the tournament's scoring rules, or null if the rules can't be
   * represented in MODAQ. When null, `gameFormatErrors` explains why and only the explicit legacy
   * scorer must refuse to start; first-party readiness uses `scoringFormat` below.
   */
  gameFormat: IModaqGameFormat | null;
  gameFormatErrors: string[];
  gameFormatWarnings: string[];
  /**
   * The tournament's scoring rules as structural data, for the first-party scorer.
   *
   * Sits alongside `gameFormat` rather than replacing it, because the two answer different
   * questions. `gameFormat` being null means the rules cannot be handed to MODAQ at all; this is
   * null only when no tournament has been loaded, since every rule set YellowFruit can hold can be
   * described. A room that can score for itself is therefore not blocked by the MODAQ refusals in
   * `gameFormatErrors`.
   */
  scoringFormat: IScorekeeperFormat | null;
  /**
   * True when a round can end before every regulation tossup is read, i.e. timed rounds. Rooms need
   * this to work out how many tossups were actually heard; see `QbjMatchNormalizer`.
   */
  timedRounds: boolean;
  /**
   * How rooms run a game, as opposed to how one is scored: halves, clock length, timeouts.
   *
   * Optional and inert by default. Nothing in the scoring engine reads it, and a room that receives
   * none behaves exactly as it did before the setting existed.
   */
  roomProcedure?: IRoomProcedure;
  /** Explicitly identifies the room-scoring workflow for the legacy generic session endpoint. */
  roomScoringMode?: 'browser' | 'traditional';
  /** Configured playing locations, including their access tokens. Tokens are never served. */
  rooms: IRoomDescriptor[];
  /** Every scheduled game that has a room, so the server can tell a room what it's playing */
  assignments: IAssignmentDescriptor[];
  /**
   * The round tournament control considers current.
   *
   * Rooms are not allowed to start a later round on their own, which stops a room racing ahead and
   * scoring a game whose teams are still playing the current round. Null means no round is in play.
   */
  currentRoundNumber: number | null;
  /** The round tournament control has released to rooms. Kept separate from the derived current round. */
  releasedRoundNumber?: number | null;
  /** When true, room browsers may continue current games but may not start a new one. */
  holdNewRoomStarts?: boolean;
  /** Optional director-facing explanation shown to scorekeepers while the hold is active. */
  holdMessage?: string;
  /** Optional text shown after QBSheet downloads its result. */
  resultHandoffInstruction?: string;
  /**
   * Stable tournament identity used to scope app-data recovery state.
   *
   * Also served to rooms, on `/tournament` and on the assignment response, so a browser can tell
   * "the server came back" from "the server is now running a different event". It identifies the
   * document and authorizes nothing.
   */
  recoveryKey?: string;
}

/** A playing location, as the server needs to know it */
export interface IRoomDescriptor {
  id: string;
  name: string;
  description?: string;
  /**
   * Capability token for this room. Used only to authorize incoming requests and never included in
   * any response.
   */
  accessToken: string;
  /** Human pairing code. Internal snapshot data only; never served by an authenticated room route. */
  pairingCode?: string;
  enabled: boolean;
}

/** Deliberately small room list used by the join screen. It contains no credentials. */
export interface IRoomJoinDescriptor {
  id: string;
  name: string;
  description?: string;
}

/**
 * What the browser landing page needs in order to choose its own default.
 *
 * A tournament running browser room scoring with rooms configured should land on pairing; a
 * traditional tournament should land on manual scoring. Both remain reachable either way, so this
 * only decides which one the scorekeeper sees first.
 */
export interface IRoomJoinListResponse {
  rooms: IRoomJoinDescriptor[];
  roomScoringMode: 'browser' | 'traditional';
}

/** The one-time result of successfully exchanging a human pairing code for a room identity. */
export interface IRoomJoinResponse {
  roomId: string;
  roomName: string;
  roomDescription?: string;
  accessToken: string;
}

export interface IRoomJoinRequest {
  code: string;
  /** Optional narrowing when two installations happen to show similar room names. */
  roomId?: string;
}

/** One scheduled game with a room, projected for the server */
export interface IAssignmentDescriptor {
  scheduledMatchId: string;
  roomId: string;
  roundNumber: number;
  /**
   * The round's complete display name, from Round.displayName(): "Round 4" for a numbered round,
   * "Finals" for a named one. Already says the word, so nothing downstream prefixes it.
   */
  roundName: string;
  /** Stable identity of this round's assignment set; changes when pairings or rooms are redrawn. */
  roundRevision?: number;
  /**
   * What the room should be reading from, when the round names a packet.
   *
   * Identity only — never any question text. A reader working from paper can be handed the wrong
   * packet, and the room saying "Packet 4" next to "Round 4" is the cheapest way there is to catch
   * it before a game is scored on questions the other rooms have already played.
   */
  packetName?: string;
  leftTeam: string;
  rightTeam: string;
  status: ScheduledMatchStatus;
  /** Present only for durable accepted history; used by recovery reconciliation, never shown to rooms. */
  resultMatchId?: string;
  /** Malformed operational history is visible but never startable. */
  quarantined?: boolean;
}

/** An empty snapshot, used before the renderer has pushed anything or with no tournament open */
export const emptyTournamentSnapshot: ITournamentSnapshot = {
  name: '',
  rounds: [],
  teams: [],
  gameFormat: null,
  gameFormatErrors: ['YellowFruit has not sent tournament information to the server yet.'],
  gameFormatWarnings: [],
  scoringFormat: null,
  timedRounds: false,
  roomScoringMode: 'traditional',
  rooms: [],
  assignments: [],
  currentRoundNumber: null,
  releasedRoundNumber: null,
};

// #endregion

// #region Sessions

/** Lifecycle of one room game */
export enum SessionStatus {
  /** Session exists but MODAQ hasn't sent anything yet */
  Created = 'created',
  /** At least one live snapshot has arrived */
  Playing = 'playing',
  /** The room submitted a final result; waiting on the statskeeper */
  Submitted = 'submitted',
  /** The statskeeper accepted it and it's now a real match in the tournament */
  Accepted = 'accepted',
  /** The statskeeper rejected it */
  Rejected = 'rejected',
}

/** What the desktop UI shows for a room */
export enum SessionDisplayState {
  Waiting = 'Waiting',
  Live = 'Live',
  Submitted = 'Submitted',
  Accepted = 'Accepted',
  Rejected = 'Rejected',
  Stale = 'Disconnected',
}

/** A room game. Kept in memory in the main process; the .yft file remains the source of truth. */
export interface ISession {
  id: string;
  /**
   * Capability token for this session. Only a client that presents it may write to the session.
   * Never included in listings sent anywhere but the creating client and the desktop UI.
   */
  token: string;
  roundNumber: number;
  leftTeam: string;
  rightTeam: string;
  /**
   * The room this session belongs to, when it was started from a scheduled assignment.
   *
   * Undefined for a session started by picking teams by hand, which is still supported for a
   * tournament that hasn't set up rooms and schedules.
   */
  roomId?: string;
  /** The scheduled game this session is playing, when it came from an assignment */
  scheduledMatchId?: string;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601, updated on every snapshot or final submission */
  lastSeenAt: string;
  status: SessionStatus;
  /** The most recent QBJ Match we've received, live or final. Replaced, never appended. */
  latestQbj: object | null;
  /** True once a final submission has been recorded, so re-submits are idempotent */
  finalReceived: boolean;
  /** SHA-256 of the canonical final payload currently under review. */
  finalFingerprint?: string;
  /** Monotonic review revision; a corrected final is a new review after rejection. */
  finalRevision: number;
  /** Operational tournament identity captured when this session was created. */
  tournamentKey?: string;
  /** Message from the statskeeper when a submission is rejected */
  rejectionReason?: string;
}

/** What the room client gets back when it creates a session */
export interface ISessionCreatedResponse {
  sessionId: string;
  token: string;
  roundNumber: number;
  leftTeam: string;
  rightTeam: string;
  status: SessionStatus;
}

/** Session as shown to the room client that owns it (no token echo needed) */
export interface ISessionStateResponse {
  sessionId: string;
  roundNumber: number;
  leftTeam: string;
  rightTeam: string;
  status: SessionStatus;
  createdAt: string;
  lastSeenAt: string;
  rejectionReason?: string;
}

/**
 * What the room that owns a session may read back to recover it.
 *
 * Deliberately narrow, and deliberately authorized by the session's own capability token: this is
 * the *second* recovery source, for the case where a browser's local copy of its own game is gone
 * or unreadable. It is not a room-wide or server-wide session listing, and nothing about any other
 * session is reachable through it.
 *
 * `latestQbj` is whatever the room last pushed — a live snapshot mid-game, or the final. It is a
 * QBJ Match, so recovering from it produces a scoresheet the ordinary import path already
 * understands.
 */
export interface ISessionRecoveryResponse {
  sessionId: string;
  roundNumber: number;
  leftTeam: string;
  rightTeam: string;
  status: SessionStatus;
  /** Set when the session came from a scheduled assignment. */
  scheduledMatchId?: string;
  roomId?: string;
  createdAt: string;
  /** ISO 8601 of the last thing the room sent, which is how fresh `latestQbj` is. */
  lastSeenAt: string;
  finalReceived: boolean;
  /** The most recent QBJ Match this session sent, or null if it never sent one. */
  latestQbj: object | null;
}

/** Request body for creating a session */
export type RoomScorerKind = 'first-party' | 'legacy';

export interface ICreateSessionRequest {
  roundNumber: number;
  leftTeam: string;
  rightTeam: string;
  scorer?: RoomScorerKind;
}

// #endregion

// #region Room assignments

/** One matchup as a room needs it, with the rosters MODAQ has to be set up with */
export interface IRoomMatchup {
  scheduledMatchId: string;
  roundNumber: number;
  /** The round's complete display name, e.g. "Round 4" or "Finals". Shown as it stands. */
  roundName: string;
  /** Stable identity of this round's assignment set. */
  roundRevision?: number;
  /** The packet this round uses, when one is named. Identity only; see `IAssignmentDescriptor`. */
  packetName?: string;
  leftTeam: IRoomTeam;
  rightTeam: IRoomTeam;
  status: ScheduledMatchStatus;
}

/** A matchup reduced to what a room shows for context, with no rosters */
export interface IRoomMatchupSummary {
  scheduledMatchId: string;
  roundNumber: number;
  /** The round's complete display name, e.g. "Round 4" or "Finals". Shown as it stands. */
  roundName: string;
  leftTeam: string;
  rightTeam: string;
  status: ScheduledMatchStatus;
}

/** Why a room can't start its assigned game right now */
export enum RoomBlockedReason {
  /** The round isn't in play yet, so control has to advance the round first */
  FutureRound = 'futureRound',
  /** Already accepted or cancelled; handing it back out would let a room re-score it */
  AlreadyResolved = 'alreadyResolved',
  /** The selected scorer cannot use the tournament's scoring rules. */
  RulesUnusable = 'rulesUnusable',
  /** The room is disabled */
  RoomDisabled = 'roomDisabled',
  /** A final is awaiting tournament-control review. */
  Submitted = 'submitted',
  /** The assignment needs human repair before it can be played. */
  NeedsAttention = 'needsAttention',
  /** Tournament control has paused new room starts without interrupting games already in progress. */
  Hold = 'hold',
}

/**
 * Everything a room page needs, in one response.
 *
 * This is the endpoint a Chromebook polls all day. It is deliberately one request: a room that has
 * just come back from a network drop should recover in a single round trip.
 */
export interface IRoomAssignmentResponse {
  roomId: string;
  roomName: string;
  tournamentName: string;
  /**
   * Stable identity of the tournament being served, so a room can tell a reconnect from a switch.
   *
   * Carried here rather than left to `/tournament` because a room in the middle of a game needs to
   * notice a switch on the poll it is already making, not five minutes later on a refresh timer:
   * every snapshot it sends in between would be filed against the wrong event.
   */
  tournamentKey?: string;
  /** The game this room should be playing now, or null if it has nothing assigned */
  current: IRoomMatchup | null;
  /** The room's previous game, for context */
  previous: IRoomMatchupSummary | null;
  /** The room's next game, so a scorekeeper can see what's coming */
  next: IRoomMatchupSummary | null;
  /**
   * An open session for the current matchup, if there is one.
   *
   * Includes the session token so a reloaded page can resume writing to the game it was already
   * scoring instead of starting a second session for it.
   */
  session: ISessionResumeInfo | null;
  /** Set when the room cannot start `current` */
  blockedReason?: RoomBlockedReason;
  /** Human-readable version of `blockedReason` */
  blockedMessage?: string;
  gameFormat: IModaqGameFormat | null;
  gameFormatErrors: string[];
  gameFormatWarnings: string[];
  /** The scoring rules as structural data. See `ITournamentSnapshot.scoringFormat`. */
  scoringFormat: IScorekeeperFormat | null;
  timedRounds: boolean;
  /** Halves, clock and timeouts, when the tournament configured any. See `ITournamentSnapshot`. */
  roomProcedure?: IRoomProcedure;
  /** The highest round the director has released, if any. */
  releasedRoundNumber?: number | null;
  /** Whether new starts are paused. Existing sessions continue to work. */
  holdNewRoomStarts?: boolean;
  holdMessage?: string;
  /** Optional text shown after QBSheet downloads its result. */
  resultHandoffInstruction?: string;
  /** Aggregate room presence, useful to the room and to reconnecting pages. */
  presence?: IRoomPresence;
  /** Open request for this room, if any. */
  helpRequest?: IHelpRequest | null;
  /** Most recent terminal outcome for the current assignment, if one was reviewed. */
  lastOutcome?: IRoomLifecycleOutcome;
}

/**
 * A terminal review verdict, tied to the game it belongs to.
 *
 * The scheduled match id is the whole point: a room shows "accepted" or "needs correction" about a
 * specific game, and without an identity those notices outlive the game they describe and end up
 * being read as a statement about the round the room is now playing.
 */
export interface IRoomLifecycleOutcome {
  scheduledMatchId: string;
  status: SessionStatus.Accepted | SessionStatus.Rejected;
  rejectionReason?: string;
}

/** Enough to pick up an in-progress session after a reload */
export interface ISessionResumeInfo {
  sessionId: string;
  token: string;
  status: SessionStatus;
  finalReceived: boolean;
  rejectionReason?: string;
}

/** Request body for starting a room's assigned game */
export interface IStartAssignedMatchRequest {
  /** Which assignment the room believes it is starting, so a stale page can't start the wrong game */
  scheduledMatchId: string;
  scorer?: RoomScorerKind;
}

/** A running score line derived from a QBJ snapshot, for the desktop live dashboard */
export interface ISessionScoreLine {
  leftTeam: string;
  rightTeam: string;
  leftPoints: number;
  rightPoints: number;
  /** Number of tossups read so far */
  tossupsRead: number;
}

/** One row of the desktop live-rooms dashboard */
export interface ISessionSummary {
  sessionId: string;
  roundNumber: number;
  leftTeam: string;
  rightTeam: string;
  /** The room this game is in, when it was started from an assignment */
  roomId?: string;
  scheduledMatchId?: string;
  status: SessionStatus;
  displayState: SessionDisplayState;
  createdAt: string;
  lastSeenAt: string;
  /** Milliseconds since the last snapshot */
  msSinceLastSeen: number;
  score: ISessionScoreLine | null;
  rejectionReason?: string;
  /** Operational tournament identity used to discard stale renderer events. */
  tournamentKey?: string;
}

/** Presence of a permanent room page, including rooms that are waiting between games. */
export interface IRoomPresence {
  roomId: string;
  lastSeenAt: string | null;
  msSinceLastSeen: number | null;
  connected: boolean;
  devices?: IRoomDevicePresence[];
  readyDeviceCount?: number;
}

/** A single browser/device check-in. Device ids are labels, not credentials. */
export interface IRoomDevicePresence {
  roomId: string;
  deviceId: string;
  operatorName?: string;
  lastSeenAt: string;
  msSinceLastSeen: number;
  connected: boolean;
  ready: boolean;
}

export interface IRoomPresenceUpdateRequest {
  deviceId?: string;
  operatorName?: string;
  ready?: boolean;
  scorer?: RoomScorerKind;
}

export type HelpRequestCategory =
  | 'wrong-matchup'
  | 'team-missing'
  | 'protest'
  | 'question-packet'
  | 'roster-change'
  | 'equipment-technical'
  | 'rules-question'
  | 'scoring-problem'
  | 'device-network'
  | 'wrong-room'
  | 'other';
export type HelpRequestState = 'open' | 'resolved' | 'cancelled';

export const helpRequestCategoryLabels: Record<HelpRequestCategory, string> = {
  'wrong-matchup': 'Wrong matchup',
  'team-missing': "Team hasn't arrived",
  protest: 'Protest / disputed ruling',
  'question-packet': 'Question / packet issue',
  'roster-change': 'Roster change',
  'equipment-technical': 'Equipment / technical issue',
  'rules-question': 'Rules question',
  'scoring-problem': 'Scoring problem',
  'device-network': 'Device/network problem',
  'wrong-room': 'Wrong room',
  other: 'Other',
};

/** Authoritative matchup context captured when a room asks for help. */
export interface IHelpMatchupContext {
  roundNumber: number;
  /** The round's complete display name, e.g. "Round 4" or "Finals". Shown as it stands. */
  roundName: string;
  leftTeam: string;
  rightTeam: string;
}

/** A compact, durable-in-memory help signal shared between room browsers and tournament control. */
export interface IHelpRequest {
  id: string;
  roomId: string;
  roomName: string;
  category: HelpRequestCategory;
  message: string;
  status: HelpRequestState;
  createdAt: string;
  updatedAt: string;
  deviceId?: string;
  operatorName?: string;
  currentMatchup?: IHelpMatchupContext;
  resolutionNote?: string;
}

export interface ICreateHelpRequest {
  category: HelpRequestCategory;
  message?: string;
  deviceId?: string;
  operatorName?: string;
  currentMatchup?: IHelpMatchupContext;
}

/** Versioned app-data recovery payload. The .yft remains the tournament source of truth. */
export interface ITournamentServerRecovery {
  /** Version 1 had no final fingerprints; version 2 adds review identity and timestamps. */
  version: 1 | 2;
  recoveryKey: string;
  savedAt: string;
  sessions: ISession[];
  roomLastSeenAt: Record<string, string>;
}

// #endregion

// #region Main <-> renderer messages

/** Current state of the HTTP server, reported to the renderer */
export interface INetworkAddress {
  /** OS interface label, e.g. Wi-Fi or en0 */
  interfaceName: string;
  /** IPv4 address without the protocol or port */
  address: string;
  /** URL a room Chromebook can open */
  url: string;
}

export interface IServerStatus {
  running: boolean;
  port: number;
  /** Every usable LAN address a Chromebook could open, e.g. http://192.168.1.50:4732 */
  addresses: string[];
  /** Structured addresses so the director can choose the correct Wi-Fi/Ethernet/VPN interface. */
  networkAddresses?: INetworkAddress[];
  /** Set when the last start attempt failed */
  errorMessage?: string;
  /** Operational tournament key used to ignore stale renderer events. */
  tournamentKey?: string;
}

/** A final match submission handed to the renderer for validation */
export interface IMatchSubmission {
  sessionId: string;
  /**
   * The round this game belongs to, taken from the session rather than the payload.
   *
   * MODAQ omits `_round` from custom exports, and even when a round is present in a submission the
   * server's assignment is the authority: a room must not be able to file a game against a round it
   * wasn't scheduled in.
   */
  roundNumber: number;
  leftTeam: string;
  rightTeam: string;
  /** The room that submitted, when the session came from an assignment */
  roomId?: string;
  /** The scheduled game this result is for, so accepting can link the two */
  scheduledMatchId?: string;
  /** The QBJ Match object exactly as MODAQ produced it */
  qbj: object;
  /** ISO 8601 */
  submittedAt: string;
  /** Key of the tournament snapshot that created this session. */
  tournamentKey?: string;
  /** Recovery status when a durable server session is being reconciled after restart. */
  sessionStatus?: SessionStatus;
  /** Monotonic final revision used to reject a verdict for an earlier resubmission. */
  finalRevision?: number;
  /** Canonical final fingerprint used as a second guard against stale verdicts. */
  finalFingerprint?: string;
}

/** Renderer's verdict on a submission */
export interface ISubmissionVerdict {
  sessionId: string;
  accepted: boolean;
  reason?: string;
  /** Stable tournament identity prevents a delayed verdict from affecting a newly opened file. */
  tournamentKey?: string;
  /** The final revision the director reviewed; stale decisions must not affect a later retry. */
  finalRevision?: number;
  /** Optional canonical fingerprint for an even stronger stale-decision check. */
  finalFingerprint?: string;
}

// #endregion
