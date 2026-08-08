import { createContext } from 'react';
import Tournament from '../DataModel/Tournament';
import { ScheduledMatchStatus, transitionScheduledMatch } from '../DataModel/ScheduledMatch';
import MatchImportResult, { ImportResultStatus } from '../DataModel/MatchImportResult';
import { StatsValidity } from '../DataModel/Match';
import MatchImportService from './MatchImportService';
import scoringRulesToModaqGameFormat from './YellowFruitScoringRulesToModaq';
import scoringRulesToScorekeeperFormat from './ScorekeeperFormat';
import buildPublicLiveSnapshot, { buildPublicPairingsSnapshot } from './PublicLiveSnapshot';
import { checkTournamentRoundRelease } from './ScheduleService';
import {
  IAdvertisedRoomAddress,
  IRoomAddressChange,
  detectRoomAddressChange,
  normalizePreferredRoomUrl,
  resolveRoomLinkOrigin,
} from './RoomAddressAdvertising';
import { IpcBidirectional, IpcMainToRend, IpcRendToMain } from '../../IPCChannels';
import {
  IMatchSubmission,
  IHelpRequest,
  INetworkAddress,
  IRoomPresence,
  IServerStatus,
  ISessionSummary,
  SessionStatus,
  ISubmissionVerdict,
  ITournamentSnapshot,
  defaultServerPort,
} from '../../main/server/ServerTypes';
import { IPublicLiveSnapshot, IPublicPairingsSnapshot } from '../../shared/LiveTypes';

/** One remote submission waiting on the statskeeper's decision */
export interface IInboxItem {
  sessionId: string;
  roundNumber: number;
  /** Team names as the room reported them, for display before validation resolves them */
  leftTeam: string;
  rightTeam: string;
  /** ISO 8601 */
  submittedAt: string;
  /** The scheduled game this is a result for, when the room was playing an assignment */
  scheduledMatchId?: string;
  roomId?: string;
  roomName?: string;
  /** The exact server final this inbox item represents, for stale-verdict protection. */
  finalRevision?: number;
  finalFingerprint?: string;
  /** Result of running the submission through the shared QBJ importer */
  importResult: MatchImportResult;
}

/**
 * A submission that arrived for a game the tournament has already recorded.
 *
 * Kept rather than dropped: two results for one game means something went wrong in the room, and the
 * director needs to see both payloads to work out which one is right.
 */
export interface IMatchSubmissionConflict {
  submission: IMatchSubmission;
  /** The accepted match this collides with */
  existingMatchId: string;
  noticedAt: string;
}

/**
 * Owns the renderer's view of the local tournament server: its status, the live room dashboard, and
 * the Match Inbox of submissions awaiting approval.
 *
 * Remote submissions are validated with the same MatchImportService the manual file import uses,
 * and are never added to the tournament without an explicit accept.
 */
export default class TournamentServerService {
  status: IServerStatus = { running: false, port: defaultServerPort, addresses: [], networkAddresses: [] };

  private preferredNetworkAddress: string | null = TournamentServerService.readPreferredNetworkAddress();

  /** Optional friendlier origin for room sheets and QR codes. Raw input is retained so host-only values can follow the active port. */
  private preferredRoomUrlValue: string | null = TournamentServerService.readPreferredRoomUrl();

  /** What the rooms were actually told to open, which is not the same as what we detect now. */
  private advertisedRoomAddress: IAdvertisedRoomAddress | null = TournamentServerService.readAdvertisedRoomAddress();

  /** Port the user wants to use next time they start the server */
  requestedPort: number = defaultServerPort;

  sessions: ISessionSummary[] = [];

  /** Submissions awaiting the statskeeper's decision, newest first */
  inbox: IInboxItem[] = [];

  /** Last check-in for every configured room, including idle rooms with no open session */
  roomPresence: IRoomPresence[] = [];

  /** Operational room help queue, kept separate from scores and schedule state. */
  helpRequests: IHelpRequest[] = [];

  /** Set when starting the server fails, so the Rooms page can show why */
  lastError: string = '';

  /**
   * Round the director has explicitly opened, overriding the automatic choice.
   *
   * Normally the current round is derived, so it advances on its own as results are accepted. This
   * exists for the case where control genuinely wants to open the next round early — it is a
   * control-room action and is deliberately not something a room client can trigger.
   */
  roundOverride: number | null = null;

  /** Conflicting submissions kept for the director to look at. Never silently discarded. */
  conflicts: IMatchSubmissionConflict[] = [];

  /** Acceptances are not acknowledged to the server until the .yft replacement is durable. */
  private pendingDurableAcceptances = new Map<string, ISubmissionVerdict>();

  /** Rejections are also held until the NeedsAttention state is durable, so a crash cannot leave a
   * recovery session rejected while the last saved .yft still says Submitted. */
  private pendingDurableVerdicts = new Map<string, ISubmissionVerdict>();

  /** Monotonic request generations make overlapping renderer polls latest-result-wins. */
  private pollGenerations = new Map<string, number>();

  dataChangedReactCallback: () => void;

  /** Called when a match is accepted, so TournamentManager can mark the file dirty and recompile */
  onMatchAccepted: (result: MatchImportResult) => void;

  /** Called when operational scheduling state changes outside of a result import. */
  onScheduleChanged: () => void;

  private tournament: Tournament;

  constructor(tournament: Tournament) {
    this.tournament = tournament;
    this.dataChangedReactCallback = () => {};
    this.onMatchAccepted = () => {};
    this.onScheduleChanged = () => {};
  }

  private static readonly preferredNetworkAddressStorageKey = 'yellowfruit.preferred-network-address';

  /** Local app preference. Deliberately not written to the .yft, QBJ or SQBS: it is this machine's. */
  private static readonly preferredRoomUrlStorageKey = 'yellowfruit.preferred-room-url';

  /** The address room devices were actually given, tracked apart from whatever is detected now. */
  private static readonly advertisedRoomAddressStorageKey = 'yellowfruit.advertised-room-address';

  private static readPreferredNetworkAddress(): string | null {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(TournamentServerService.preferredNetworkAddressStorageKey);
  }

  private static writePreferredNetworkAddress(address: string | null) {
    if (typeof localStorage === 'undefined') return;
    if (address) localStorage.setItem(TournamentServerService.preferredNetworkAddressStorageKey, address);
    else localStorage.removeItem(TournamentServerService.preferredNetworkAddressStorageKey);
  }

  private static readPreferredRoomUrl(): string | null {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(TournamentServerService.preferredRoomUrlStorageKey);
  }

  private static readAdvertisedRoomAddress(): IAdvertisedRoomAddress | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(TournamentServerService.advertisedRoomAddressStorageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<IAdvertisedRoomAddress>;
      if (typeof parsed?.url !== 'string' || parsed.url === '') return null;
      return {
        url: parsed.url,
        advertisedAt: typeof parsed.advertisedAt === 'string' ? parsed.advertisedAt : new Date().toISOString(),
        tournamentKey: typeof parsed.tournamentKey === 'string' ? parsed.tournamentKey : undefined,
      };
    } catch {
      return null;
    }
  }

  get networkAddresses(): INetworkAddress[] {
    if (this.status.networkAddresses && this.status.networkAddresses.length > 0) return this.status.networkAddresses;
    return this.status.addresses.map((url) => ({ interfaceName: 'Network', address: url, url }));
  }

  get selectedAddress(): string {
    const preferred = this.networkAddresses.find((address) => address.url === this.preferredNetworkAddress);
    return preferred?.url ?? this.networkAddresses[0]?.url ?? '';
  }

  setPreferredNetworkAddress(address: string | null) {
    const valid = address && this.networkAddresses.some((entry) => entry.url === address) ? address : null;
    this.preferredNetworkAddress = valid;
    TournamentServerService.writePreferredNetworkAddress(valid);
    // Choosing an address is the director saying "this is the one the rooms use", so it is exactly
    // the moment to record what was advertised.
    if (valid) this.recordAdvertisedAddress(valid);
    this.dataChangedReactCallback();
  }

  /** The optional friendlier hostname a director has arranged for room devices. */
  get preferredRoomUrl(): string | null {
    return this.preferredRoomUrlValue;
  }

  /**
   * Set (or clear) the preferred room URL.
   *
   * @returns false when the value cannot be an origin, so the caller can say why rather than
   * silently keeping the old one.
   */
  setPreferredRoomUrl(value: string): boolean {
    const trimmed = value.trim();
    if (trimmed === '') {
      this.preferredRoomUrlValue = null;
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(TournamentServerService.preferredRoomUrlStorageKey);
      }
      this.dataChangedReactCallback();
      return true;
    }
    const normalized = normalizePreferredRoomUrl(trimmed, this.status.port || this.requestedPort);
    if (!normalized) {
      this.lastError = 'A preferred room address must be a host or http:// URL with no path, e.g. yellowfruit.local.';
      this.dataChangedReactCallback();
      return false;
    }
    this.preferredRoomUrlValue = trimmed;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(TournamentServerService.preferredRoomUrlStorageKey, trimmed);
    }
    this.lastError = '';
    this.dataChangedReactCallback();
    return true;
  }

  /**
   * The origin printed on room sheets, encoded into QR codes, and used for room links.
   *
   * The numeric address remains available separately as `selectedAddress` and is shown beside this
   * one, because a name that does not resolve on the room devices has to be diagnosable from the
   * sheet the scorekeeper is holding.
   */
  get roomLinkOrigin(): string {
    const normalized =
      this.preferredRoomUrlValue === null
        ? null
        : normalizePreferredRoomUrl(this.preferredRoomUrlValue, this.status.port || this.requestedPort);
    return resolveRoomLinkOrigin(normalized, this.selectedAddress);
  }

  /** Set when the address the rooms were given is no longer one this machine has. */
  get roomAddressChange(): IRoomAddressChange | null {
    return detectRoomAddressChange(this.advertisedRoomAddress, this.networkAddresses, this.selectedAddress, {
      running: this.status.running,
      tournamentKey: this.recoveryKey(),
    });
  }

  /**
   * Remember the address the rooms are being given.
   *
   * Recorded rather than derived, because the whole question is what the *printed sheets* say, and
   * that is decided at the moment the director starts the server or picks an interface — not by
   * whatever the machine happens to report later.
   */
  recordAdvertisedAddress(url: string) {
    if (url === '') return;
    const advertised: IAdvertisedRoomAddress = {
      url,
      advertisedAt: new Date().toISOString(),
      tournamentKey: this.recoveryKey(),
    };
    this.advertisedRoomAddress = advertised;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(TournamentServerService.advertisedRoomAddressStorageKey, JSON.stringify(advertised));
      } catch {
        // The warning degrades to not appearing. Nothing about scoring depends on it.
      }
    }
  }

  /**
   * The director has dealt with the change: new sheets are printed, or the rooms have been told.
   *
   * Implemented as re-advertising the current address rather than as a dismissal flag, so that if
   * the address changes *again* the warning comes back with the right "previous" value.
   */
  acknowledgeRoomAddressChange() {
    if (this.selectedAddress !== '') this.recordAdvertisedAddress(this.selectedAddress);
    this.dataChangedReactCallback();
  }

  setTournament(tournament: Tournament): boolean {
    this.tournament = tournament;
    this.inbox = [];
    this.conflicts = [];
    this.helpRequests = [];
    this.pendingDurableAcceptances.clear();
    this.pendingDurableVerdicts.clear();
    // Push even while stopped so the main process can scope any recovery data before the next
    // start. This does not bind a port or make the optional server visible on the LAN.
    return this.pushTournamentSnapshot();
  }

  /**
   * Prepare a parsed tournament replacement without changing the active tournament on failure.
   * Active room games and reviewable finals are an interlock: the director must resolve them first.
   * An idle running server is stopped and only then may the caller commit the new document.
   */
  async prepareForTournamentSwitch(): Promise<{ ok: true } | { ok: false; reason: string }> {
    const activeSession = this.sessions.find(
      (session) => session.status === SessionStatus.Playing || session.status === SessionStatus.Submitted,
    );
    const activeScheduled = this.tournament.scheduledMatches.find(
      (match) => match.status === ScheduledMatchStatus.Playing || match.status === ScheduledMatchStatus.Submitted,
    );
    if (activeSession || activeScheduled || this.inbox.length > 0) {
      return {
        ok: false,
        reason: 'The tournament cannot be switched while a room game is playing or awaiting review.',
      };
    }

    if (this.status.running) {
      const stopped = await this.stopServer();
      if (stopped.running) {
        return {
          ok: false,
          reason: 'The Tournament Server could not be stopped safely; the current tournament remains open.',
        };
      }
    }
    this.reset();
    return { ok: true };
  }

  /** Subscribe to the main process's tournament-server messages */
  addIpcListeners() {
    window.electron.ipcRenderer.on(IpcMainToRend.TournamentServerStatusChanged, (status) => {
      const next = status as IServerStatus;
      if (next.tournamentKey && next.tournamentKey !== this.recoveryKey()) return;
      this.status = next;
      this.lastError = this.status.errorMessage ?? '';
      this.dataChangedReactCallback();
    });
    window.electron.ipcRenderer.on(IpcMainToRend.TournamentServerSessionsChanged, (sessions) => {
      const incoming = (sessions as ISessionSummary[]) ?? [];
      this.sessions = incoming.filter(
        (session) => !session.tournamentKey || session.tournamentKey === this.recoveryKey(),
      );
      this.dataChangedReactCallback();
    });
    window.electron.ipcRenderer.on(IpcMainToRend.TournamentServerMatchSubmitted, (submission) => {
      const incoming = submission as IMatchSubmission;
      if (incoming.tournamentKey && incoming.tournamentKey !== this.recoveryKey()) return;
      this.handleSubmission(incoming);
    });
    window.electron.ipcRenderer.on(IpcMainToRend.TournamentServerSessionStarted, (payload) => {
      const { scheduledMatchId, tournamentKey } = (payload ?? {}) as {
        scheduledMatchId?: string;
        tournamentKey?: string;
      };
      if (tournamentKey && tournamentKey !== this.recoveryKey()) return;
      if (scheduledMatchId) this.handleSessionStarted(scheduledMatchId);
    });
    window.electron.ipcRenderer.on(IpcMainToRend.TournamentServerHelpRequestsChanged, (requests) => {
      this.helpRequests = (requests as IHelpRequest[]) ?? [];
      this.dataChangedReactCallback();
    });
  }

  /** Build the small read-only projection of the tournament that room clients are allowed to see */
  buildTournamentSnapshot(): ITournamentSnapshot {
    const formatResult = scoringRulesToModaqGameFormat(this.tournament.scoringRules);
    const rounds = this.tournament.phases.flatMap((phase) =>
      phase.rounds.map((round) => ({ number: round.number, name: round.displayName() })),
    );
    const teams = this.tournament.getListOfAllTeams().map((team) => ({
      name: team.name,
      players: team.players.filter((p) => p.name !== '').map((p) => ({ name: p.name })),
    }));
    const roundNames = new Map(rounds.map((round) => [round.number, round.name]));

    return {
      name: this.tournament.name || 'Untitled tournament',
      rounds: rounds.sort((a, b) => a.number - b.number),
      teams: teams.sort((a, b) => a.name.localeCompare(b.name)),
      gameFormat: formatResult.ok ? formatResult.gameFormat : null,
      gameFormatErrors: formatResult.ok ? [] : formatResult.errors,
      gameFormatWarnings: formatResult.ok ? formatResult.warnings : [],
      scoringFormat: scoringRulesToScorekeeperFormat(this.tournament.scoringRules),
      timedRounds: this.tournament.scoringRules.timed,
      roomScoringMode: this.tournament.roomScoringMode,
      rooms: this.tournament.rooms.map((room) => ({
        id: room.id,
        name: room.name,
        description: room.description || undefined,
        accessToken: room.accessToken,
        pairingCode: room.pairingCode,
        enabled: room.enabled,
      })),
      // Only games that have a room can be served to one.
      assignments: this.tournament.scheduledMatches
        .filter((match) => match.roomId !== undefined)
        .map((match) => ({
          scheduledMatchId: match.id,
          roomId: match.roomId as string,
          roundNumber: match.roundNumber,
          roundName: roundNames.get(match.roundNumber) ?? String(match.roundNumber),
          leftTeam: match.leftTeamName,
          rightTeam: match.rightTeamName,
          status: match.status,
          resultMatchId: match.resultMatchId,
          quarantined: match.quarantined || undefined,
        })),
      currentRoundNumber: this.currentRoundNumber,
      releasedRoundNumber: this.tournament.releasedRoundNumber,
      holdNewRoomStarts: this.tournament.holdNewRoomStarts,
      holdMessage: this.tournament.holdMessage || undefined,
      recoveryKey: this.recoveryKey(),
    };
  }

  /** Stable identity for transient recovery; live status and scores are intentionally excluded. */
  private recoveryKey(): string {
    return this.tournament.operationalId;
  }

  /**
   * The round rooms are allowed to play.
   *
   * Derived rather than tracked, so it advances by itself: it is the earliest round that still has a
   * game nobody has accepted. Once tournament control accepts the last result of round 4, round 5
   * becomes current and every Chromebook picks up its next game on the following poll without anyone
   * pressing anything.
   *
   * `roundOverride` lets control open a round early when it really means to.
   */
  get currentRoundNumber(): number | null {
    if (this.roundOverride !== null) return this.roundOverride;

    const unresolved = this.tournament.scheduledMatches.filter((match) => !match.isResolved());
    if (unresolved.length === 0) return null;
    return unresolved.reduce((earliest, match) => Math.min(earliest, match.roundNumber), Infinity);
  }

  /** Open a round explicitly. A control-room action; rooms cannot do this. */
  setRoundOverride(roundNumber: number | null): boolean {
    if (roundNumber !== null) {
      const check = this.canReleaseRound(roundNumber);
      if (!check.canRelease) {
        this.lastError = check.reason ?? 'That round cannot be released yet.';
        this.dataChangedReactCallback();
        return false;
      }
    }
    const previousRoundOverride = this.roundOverride;
    const previousReleasedRound = this.tournament.releasedRoundNumber;
    const previousStatuses = new Map(
      this.tournament.scheduledMatches.map((scheduled) => [scheduled.id, scheduled.status]),
    );
    this.roundOverride = roundNumber;
    this.tournament.releasedRoundNumber = roundNumber;
    if (roundNumber !== null) {
      for (const scheduled of this.tournament.scheduledMatches) {
        if (scheduled.roundNumber === roundNumber && scheduled.status === ScheduledMatchStatus.Scheduled) {
          const transition = transitionScheduledMatch(scheduled, ScheduledMatchStatus.Ready);
          if (!transition.ok) {
            this.restoreRoundOperation(previousRoundOverride, previousReleasedRound, previousStatuses);
            this.lastError = transition.reason;
            this.dataChangedReactCallback();
            return false;
          }
        }
      }
    }
    if (this.status.running && !this.pushTournamentSnapshot()) {
      return this.rollbackAfterSnapshotFailure(previousRoundOverride, previousReleasedRound, previousStatuses);
    }
    this.onScheduleChanged();
    this.dataChangedReactCallback();
    return true;
  }

  get releasedRoundNumber(): number | null {
    return this.tournament.releasedRoundNumber;
  }

  /** Release one round to rooms without touching accepted history. */
  canReleaseRound(roundNumber: number) {
    return checkTournamentRoundRelease(this.tournament, roundNumber);
  }

  private restoreRoundOperation(
    roundOverride: number | null,
    releasedRoundNumber: number | null,
    statuses: Map<string, ScheduledMatchStatus>,
  ) {
    this.roundOverride = roundOverride;
    this.tournament.releasedRoundNumber = releasedRoundNumber;
    this.tournament.scheduledMatches.forEach((scheduled) => {
      const status = statuses.get(scheduled.id);
      if (status !== undefined) scheduled.status = status;
    });
  }

  private rollbackAfterSnapshotFailure(
    previousRoundOverride: number | null,
    previousReleasedRound: number | null,
    previousStatuses: Map<string, ScheduledMatchStatus>,
  ): false {
    const snapshotError = this.lastError || 'The Tournament Server did not accept the schedule update.';
    this.restoreRoundOperation(previousRoundOverride, previousReleasedRound, previousStatuses);
    // A send can fail after the private snapshot was delivered but before one of the public
    // projections was sent. Best-effortly publish the rolled-back state so the main process cannot
    // retain the newly released round when the renderer rejected the operation.
    const rollbackSynced = !this.status.running || this.pushTournamentSnapshot();
    this.lastError = rollbackSynced
      ? snapshotError
      : `${snapshotError} The rolled-back schedule could not be sent to the Tournament Server.`;
    this.dataChangedReactCallback();
    return false;
  }

  releaseRound(roundNumber: number): boolean {
    const releaseCheck = this.canReleaseRound(roundNumber);
    if (!releaseCheck.canRelease) {
      this.lastError = releaseCheck.reason ?? 'That round cannot be released yet.';
      this.dataChangedReactCallback();
      return false;
    }

    const previousReleasedRound = this.tournament.releasedRoundNumber;
    const previousRoundOverride = this.roundOverride;
    const previousStatuses = new Map(
      this.tournament.scheduledMatches.map((scheduled) => [scheduled.id, scheduled.status]),
    );
    this.tournament.releasedRoundNumber = roundNumber;
    this.roundOverride = null;
    for (const scheduled of this.tournament.scheduledMatches) {
      if (scheduled.roundNumber === roundNumber && scheduled.status === ScheduledMatchStatus.Scheduled) {
        const transition = transitionScheduledMatch(scheduled, ScheduledMatchStatus.Ready);
        if (!transition.ok) {
          this.restoreRoundOperation(previousRoundOverride, previousReleasedRound, previousStatuses);
          this.lastError = transition.reason;
          this.dataChangedReactCallback();
          return false;
        }
      }
    }
    if (this.status.running && !this.pushTournamentSnapshot()) {
      return this.rollbackAfterSnapshotFailure(previousRoundOverride, previousReleasedRound, previousStatuses);
    }
    this.onScheduleChanged();
    this.dataChangedReactCallback();
    return true;
  }

  clearReleasedRound(): boolean {
    const previousReleasedRound = this.tournament.releasedRoundNumber;
    const previousRoundOverride = this.roundOverride;
    this.tournament.releasedRoundNumber = null;
    this.roundOverride = null;
    if (this.status.running && !this.pushTournamentSnapshot()) {
      const snapshotError = this.lastError || 'The Tournament Server did not accept the round reset.';
      this.tournament.releasedRoundNumber = previousReleasedRound;
      this.roundOverride = previousRoundOverride;
      const rollbackSynced = this.pushTournamentSnapshot();
      this.lastError = rollbackSynced
        ? snapshotError
        : `${snapshotError} The rolled-back round state could not be sent to the Tournament Server.`;
      this.dataChangedReactCallback();
      return false;
    }
    this.onScheduleChanged();
    this.dataChangedReactCallback();
    return true;
  }

  setAutoReleaseNextRound(enabled: boolean): boolean {
    const previous = this.tournament.autoReleaseNextRound;
    this.tournament.autoReleaseNextRound = enabled;
    if (this.status.running && !this.pushTournamentSnapshot()) {
      const snapshotError = this.lastError || 'The Tournament Server did not accept the auto-release setting.';
      this.tournament.autoReleaseNextRound = previous;
      const rollbackSynced = this.pushTournamentSnapshot();
      this.lastError = rollbackSynced
        ? snapshotError
        : `${snapshotError} The rolled-back auto-release state could not be sent to the Tournament Server.`;
      this.dataChangedReactCallback();
      return false;
    }
    this.onScheduleChanged();
    this.dataChangedReactCallback();
    return true;
  }

  /** Candidate next round for the manual release control. */
  nextRoundToRelease(): number | null {
    const rounds = Array.from(new Set(this.tournament.scheduledMatches.map((match) => match.roundNumber))).sort(
      (a, b) => a - b,
    );
    const released = this.tournament.releasedRoundNumber;
    if (released === null) {
      return (
        rounds.find((roundNumber) =>
          this.tournament.scheduledMatches.some((match) => match.roundNumber === roundNumber && !match.isResolved()),
        ) ?? null
      );
    }
    return rounds.find((roundNumber) => roundNumber > released) ?? null;
  }

  /** Automatically release only after the current round is actually complete. */
  private maybeAutoReleaseNextRound() {
    if (!this.tournament.autoReleaseNextRound) return;
    const released = this.tournament.releasedRoundNumber;
    if (released === null) return;

    const releasedMatches = this.tournament.scheduledMatches.filter((match) => match.roundNumber === released);
    if (releasedMatches.length === 0 || releasedMatches.some((match) => !match.isResolved())) return;

    const next = this.nextRoundToRelease();
    if (next === null) return;

    // The same release authority used by manual Control actions enforces phase checkpoints and all
    // schedule validation; auto-release must not maintain a second interpretation of readiness.
    if (!this.releaseRound(next)) {
      this.lastError = this.canReleaseRound(next).reason ?? 'The next round could not be released.';
      this.dataChangedReactCallback();
    }
  }

  /** Find a scheduled match by id */
  private findScheduledMatch(scheduledMatchId: string | undefined) {
    if (!scheduledMatchId) return undefined;
    return this.tournament.scheduledMatches.find((match) => match.id === scheduledMatchId);
  }

  /**
   * A room opened its assigned game, so show it as being played.
   *
   * Only moves a game forward from waiting. A game already submitted or accepted must not be dragged
   * back to playing by a stale request.
   */
  handleSessionStarted(scheduledMatchId: string): boolean {
    const scheduled = this.findScheduledMatch(scheduledMatchId);
    if (!scheduled) return false;
    if (
      scheduled.status === ScheduledMatchStatus.Scheduled ||
      scheduled.status === ScheduledMatchStatus.Ready ||
      scheduled.status === ScheduledMatchStatus.NeedsAttention
    ) {
      const previousStatus = scheduled.status;
      const transition = transitionScheduledMatch(scheduled, ScheduledMatchStatus.Playing);
      if (!transition.ok) return false;
      if (!this.pushTournamentSnapshot()) {
        const snapshotError = this.lastError || 'The Tournament Server did not accept the room start.';
        scheduled.status = previousStatus;
        const rollbackSynced = this.pushTournamentSnapshot();
        this.lastError = rollbackSynced
          ? snapshotError
          : `${snapshotError} The rolled-back room state could not be sent to the Tournament Server.`;
        this.dataChangedReactCallback();
        return false;
      }
      this.onScheduleChanged();
      this.dataChangedReactCallback();
      return true;
    }
    return false;
  }

  /** Send the current tournament projection to the main process so the server can serve it */
  pushTournamentSnapshot(): boolean {
    // TournamentManager is also exercised in Node-only tests where the Electron preload bridge
    // does not exist yet. The real renderer always has window.electron.
    if (typeof window === 'undefined' || !window.electron) return true;
    try {
      window.electron.ipcRenderer.sendMessage(
        IpcRendToMain.TournamentServerSetSnapshot,
        this.buildTournamentSnapshot(),
      );
      const publicSnapshot = this.buildPublicLiveSnapshot();
      window.electron.ipcRenderer.sendMessage(IpcRendToMain.TournamentServerSetPublicLiveSnapshot, publicSnapshot);
      window.electron.ipcRenderer.sendMessage(
        IpcRendToMain.TournamentServerSetPublicPairingsSnapshot,
        this.buildPublicPairingsSnapshot(),
      );
      return true;
    } catch (error: unknown) {
      this.lastError = errorMessage(error);
      this.dataChangedReactCallback();
      return false;
    }
  }

  /** Build the deliberately reduced public view. Disabled tournaments return null and expose no data. */
  buildPublicLiveSnapshot(): IPublicLiveSnapshot | null {
    return buildPublicLiveSnapshot(this.tournament);
  }

  buildPublicPairingsSnapshot(): IPublicPairingsSnapshot | null {
    return buildPublicPairingsSnapshot(this.tournament);
  }

  async startServer(port?: number) {
    if (typeof window === 'undefined' || !window.electron) {
      const status = { ...this.status, running: false, errorMessage: 'The desktop server bridge is unavailable.' };
      this.lastError = status.errorMessage ?? '';
      return status;
    }
    const portToUse = port ?? this.requestedPort;
    this.requestedPort = portToUse;
    // Give the server the tournament before it can take any requests.
    if (!this.pushTournamentSnapshot()) {
      return { ...this.status, running: false, errorMessage: this.lastError };
    }
    try {
      const status = (await window.electron.ipcRenderer.invoke(
        IpcBidirectional.TournamentServerStart,
        portToUse,
      )) as IServerStatus;
      if (!status.tournamentKey || status.tournamentKey === this.recoveryKey()) {
        this.status = status;
        this.lastError = status.errorMessage ?? '';
        // Starting the server is when an address becomes the one rooms are given. Recording it here
        // is what makes a later DHCP change detectable rather than invisible.
        // A record left over from a different tournament is not this tournament's advertised
        // address, so the first start of a newly opened document re-establishes it.
        if (
          status.running &&
          this.selectedAddress !== '' &&
          this.advertisedRoomAddress?.tournamentKey !== this.recoveryKey()
        ) {
          this.recordAdvertisedAddress(this.selectedAddress);
        }
        if (status.running && !this.pushTournamentSnapshot()) {
          return { ...status, errorMessage: this.lastError };
        }
      }
      this.dataChangedReactCallback();
      return status;
    } catch (error: unknown) {
      this.lastError = errorMessage(error);
      this.dataChangedReactCallback();
      return { ...this.status, running: false, errorMessage: this.lastError };
    }
  }

  async stopServer() {
    if (typeof window === 'undefined' || !window.electron) return this.status;
    try {
      const status = (await window.electron.ipcRenderer.invoke(IpcBidirectional.TournamentServerStop)) as IServerStatus;
      if (!status.tournamentKey || status.tournamentKey === this.recoveryKey()) this.status = status;
      this.sessions = [];
      this.dataChangedReactCallback();
      return status;
    } catch (error: unknown) {
      this.lastError = errorMessage(error);
      this.dataChangedReactCallback();
      return { ...this.status, errorMessage: this.lastError };
    }
  }

  async refreshStatus() {
    const generation = this.beginPoll('status');
    if (typeof window === 'undefined' || !window.electron) return;
    try {
      const nextStatus = (await window.electron.ipcRenderer.invoke(
        IpcBidirectional.TournamentServerGetStatus,
      )) as IServerStatus;
      if (generation !== this.currentPoll('status')) return;
      if (nextStatus.tournamentKey && nextStatus.tournamentKey !== this.recoveryKey()) return;
      this.status = nextStatus;
      const pending = (await window.electron.ipcRenderer.invoke(
        IpcBidirectional.TournamentServerGetPendingSubmissions,
      )) as IMatchSubmission[];
      if (generation !== this.currentPoll('status')) return;
      pending
        .filter((submission) => !submission.tournamentKey || submission.tournamentKey === this.recoveryKey())
        .forEach((submission) => this.handleSubmission(submission));
      await this.refreshPresence();
      await this.refreshHelpRequests();
      if (generation === this.currentPoll('status')) this.dataChangedReactCallback();
    } catch (error: unknown) {
      if (generation !== this.currentPoll('status')) return;
      this.lastError = errorMessage(error);
      this.dataChangedReactCallback();
    }
  }

  /** Poll the main process for the live room dashboard */
  async refreshSessions() {
    if (!this.status.running) return;
    const generation = this.beginPoll('sessions');
    try {
      const sessions =
        ((await window.electron.ipcRenderer.invoke(
          IpcBidirectional.TournamentServerGetSessions,
        )) as ISessionSummary[]) ?? [];
      if (generation !== this.currentPoll('sessions')) return;
      this.sessions = sessions.filter(
        (session) => !session.tournamentKey || session.tournamentKey === this.recoveryKey(),
      );
      this.dataChangedReactCallback();
    } catch (error: unknown) {
      if (generation !== this.currentPoll('sessions')) return;
      this.lastError = errorMessage(error);
      this.dataChangedReactCallback();
    }
  }

  async refreshPresence() {
    const generation = this.beginPoll('presence');
    if (typeof window === 'undefined' || !window.electron) return;
    try {
      const presence =
        ((await window.electron.ipcRenderer.invoke(
          IpcBidirectional.TournamentServerGetRoomPresence,
        )) as IRoomPresence[]) ?? [];
      if (generation !== this.currentPoll('presence')) return;
      this.roomPresence = presence;
      this.dataChangedReactCallback();
    } catch (error: unknown) {
      if (generation !== this.currentPoll('presence')) return;
      this.lastError = errorMessage(error);
      this.dataChangedReactCallback();
    }
  }

  async refreshHelpRequests() {
    const generation = this.beginPoll('help');
    if (typeof window === 'undefined' || !window.electron) return;
    try {
      const requests =
        ((await window.electron.ipcRenderer.invoke(
          IpcBidirectional.TournamentServerGetHelpRequests,
        )) as IHelpRequest[]) ?? [];
      if (generation !== this.currentPoll('help')) return;
      this.helpRequests = requests;
      this.dataChangedReactCallback();
    } catch (error: unknown) {
      if (generation !== this.currentPoll('help')) return;
      this.lastError = errorMessage(error);
      this.dataChangedReactCallback();
    }
  }

  /**
   * Resolve or cancel a room's help request.
   *
   * Nothing is changed locally until the server confirms it. A help request that quietly vanished
   * from the director's attention list without actually being resolved is worse than one that is
   * still showing: the room keeps waiting and nobody knows to go and see them. `lastError` is set
   * on every failure path so the caller has something specific to show.
   *
   * @returns the updated request, or null if the update did not happen.
   */
  async updateHelpRequest(id: string, status: 'resolved' | 'cancelled', note?: string) {
    if (typeof window === 'undefined' || !window.electron) {
      this.lastError = 'The Tournament Server is not available in this window.';
      return null;
    }
    try {
      const updated = (await window.electron.ipcRenderer.invoke(IpcBidirectional.TournamentServerUpdateHelpRequest, {
        id,
        status,
        note,
      })) as IHelpRequest | null;
      if (!updated) {
        this.lastError = 'The Tournament Server did not accept that help request update.';
        this.dataChangedReactCallback();
        return null;
      }
      this.helpRequests = this.helpRequests.map((request) => (request.id === updated.id ? updated : request));
      this.lastError = '';
      this.dataChangedReactCallback();
      return updated;
    } catch (error: unknown) {
      this.lastError = errorMessage(error);
      this.dataChangedReactCallback();
      return null;
    }
  }

  private beginPoll(kind: string): number {
    const next = (this.pollGenerations.get(kind) ?? 0) + 1;
    this.pollGenerations.set(kind, next);
    return next;
  }

  private currentPoll(kind: string): number {
    return this.pollGenerations.get(kind) ?? 0;
  }

  setRequestedPort(port: number) {
    this.requestedPort = port;
    this.dataChangedReactCallback();
  }

  /**
   * Validate a remote submission and put it in the Match Inbox.
   *
   * The round comes from the session rather than the QBJ: MODAQ 1.41 omits `_round` from custom
   * exports, and the room already told the server which round it picked.
   */
  handleSubmission(submission: IMatchSubmission) {
    if (submission.tournamentKey && submission.tournamentKey !== this.recoveryKey()) return;
    const scheduled = this.findScheduledMatch(submission.scheduledMatchId);

    // A result that names a scheduled game is never allowed to fall back to the generic/manual
    // import path when that game has been deleted or replaced. Keep it visible as a fatal inbox
    // item so the director can account for the stale room result without creating an unlinked
    // official Match.
    if (submission.scheduledMatchId && !scheduled) {
      const invalid = new MatchImportResult(TournamentServerService.makeSourceLabel(submission));
      invalid.markFatal('The scheduled game no longer exists in this tournament; review the room result manually.');
      this.replaceInboxItem(submission, invalid);
      return;
    }

    // A game the tournament has already recorded must not be quietly overwritten. Keep both
    // payloads and surface the collision instead: two results for one game means something went
    // wrong in the room and a human has to decide which is right.
    if (scheduled?.isAccepted()) {
      // A Submitted recovery record can be replayed after the YFT commit raced the server's
      // recovery write. The accepted scheduled link is proof that this exact session's result is
      // already durable in the tournament; acknowledge it without creating a second inbox item.
      if (submission.sessionStatus === SessionStatus.Submitted) {
        this.pendingDurableAcceptances.set(submission.sessionId, this.verdictForSubmission(submission, true));
        this.confirmDurableAcceptance(submission.sessionId);
        return;
      }
      this.conflicts = [
        {
          submission,
          existingMatchId: scheduled.resultMatchId ?? '(unknown)',
          noticedAt: new Date().toISOString(),
        },
        ...this.conflicts.filter((c) => c.submission.sessionId !== submission.sessionId),
      ];
      this.dataChangedReactCallback();
      return;
    }

    if (scheduled) {
      if (scheduled.status === ScheduledMatchStatus.Cancelled || scheduled.quarantined) {
        const invalid = new MatchImportResult(TournamentServerService.makeSourceLabel(submission));
        invalid.markFatal('This scheduled game is not playable and needs tournament-control review.');
        this.replaceInboxItem(submission, invalid);
        return;
      }
      if (
        scheduled.status === ScheduledMatchStatus.NeedsAttention &&
        submission.sessionStatus === SessionStatus.Submitted
      ) {
        // Case D: the durable .yft already records the rejection/review state, but the transient
        // server still has the old Submitted session. A stale final must not be accepted again;
        // close that session so the room can start a fresh retry against NeedsAttention.
        const verdictSent = this.sendVerdict(
          this.verdictForSubmission(
            submission,
            false,
            'The tournament already recorded this result as needing attention; please retry the game.',
          ),
        );
        if (!verdictSent) {
          this.lastError = this.lastError || 'The stale room verdict could not be reconciled yet.';
        }
        return;
      }
      if (
        scheduled.roundNumber !== submission.roundNumber ||
        !scheduled.matchesTeams(submission.leftTeam, submission.rightTeam) ||
        (submission.roomId !== undefined && scheduled.roomId !== submission.roomId)
      ) {
        const invalid = new MatchImportResult(TournamentServerService.makeSourceLabel(submission));
        invalid.markFatal('The submitted room, teams, or round do not match the scheduled game.');
        this.replaceInboxItem(submission, invalid);
        return;
      }
      if (scheduled.status !== ScheduledMatchStatus.Submitted) {
        if (scheduled.status === ScheduledMatchStatus.Scheduled || scheduled.status === ScheduledMatchStatus.Ready) {
          const started = transitionScheduledMatch(scheduled, ScheduledMatchStatus.Playing);
          if (!started.ok) return;
        }
        const submitted = transitionScheduledMatch(scheduled, ScheduledMatchStatus.Submitted);
        if (!submitted.ok) return;
      }
    }

    const service = new MatchImportService(this.tournament);
    const round = this.tournament.getRoundObjByNumber(submission.roundNumber);
    const sourceLabel = TournamentServerService.makeSourceLabel(submission);

    const { results, hadInvalidJson } = service.importMatches(
      [{ filePath: sourceLabel, fileContents: JSON.stringify(submission.qbj) }],
      round,
    );

    let importResult: MatchImportResult;
    if (hadInvalidJson || results.length === 0) {
      importResult = new MatchImportResult(sourceLabel);
      importResult.markFatal("This room's submission could not be read as a QBJ match.");
    } else {
      [importResult] = results;
    }

    this.replaceInboxItem(submission, importResult);
    if (!this.pushTournamentSnapshot()) {
      // Keep the inbox item and the recovery-backed server final; a later poll or user action can
      // retry the projection without losing the reviewable result.
      this.onScheduleChanged();
      return;
    }
    this.onScheduleChanged();
    this.dataChangedReactCallback();
  }

  private replaceInboxItem(submission: IMatchSubmission, importResult: MatchImportResult) {
    this.inbox = [
      {
        sessionId: submission.sessionId,
        roundNumber: submission.roundNumber,
        leftTeam: submission.leftTeam,
        rightTeam: submission.rightTeam,
        submittedAt: submission.submittedAt,
        scheduledMatchId: submission.scheduledMatchId,
        roomId: submission.roomId,
        roomName: submission.roomId
          ? this.tournament.rooms.find((room) => room.id === submission.roomId)?.name
          : undefined,
        finalRevision: submission.finalRevision,
        finalFingerprint: submission.finalFingerprint,
        importResult,
      },
      ...this.inbox.filter((item) => item.sessionId !== submission.sessionId),
    ];
    this.dataChangedReactCallback();
  }

  /**
   * A label identifying which room a match came from. This ends up on `Match.importedFile`, the same
   * field a manually imported file's name goes in, so accepted remote matches look like any other
   * imported match downstream.
   */
  static makeSourceLabel(submission: IMatchSubmission) {
    return `Room: ${submission.leftTeam} vs ${submission.rightTeam} (R${submission.roundNumber})`;
  }

  private verdictForSubmission(
    source: { sessionId: string; finalRevision?: number; finalFingerprint?: string },
    accepted: boolean,
    reason?: string,
  ): ISubmissionVerdict {
    const verdict: ISubmissionVerdict = {
      sessionId: source.sessionId,
      accepted,
      tournamentKey: this.recoveryKey(),
    };
    if (reason !== undefined) verdict.reason = reason;
    if (source.finalRevision !== undefined) verdict.finalRevision = source.finalRevision;
    if (source.finalFingerprint !== undefined) verdict.finalFingerprint = source.finalFingerprint;
    return verdict;
  }

  findInboxItem(sessionId: string) {
    return this.inbox.find((item) => item.sessionId === sessionId);
  }

  /** How many submissions are waiting, for the nav bar badge */
  pendingCount() {
    return this.inbox.length;
  }

  /**
   * Accept a submission: insert its match into the round, tell the server, and let
   * TournamentManager mark the file dirty so the normal stats flow picks it up.
   *
   * `acceptAnyway` is required for a submission with non-fatal validation errors, matching how the
   * manual import dialog treats the same situation.
   */
  acceptSubmission(sessionId: string, acceptAnyway = false) {
    const item = this.findInboxItem(sessionId);
    if (!item) return false;

    const { importResult } = item;
    const { match, round, phase, status } = importResult;
    if (!match || !round) return false;
    const authoritativeRound = this.tournament.getRoundObjByNumber(item.roundNumber);
    const authoritativePhase = authoritativeRound ? this.tournament.whichPhaseIsRoundIn(authoritativeRound) : undefined;
    if (round !== authoritativeRound || phase !== authoritativePhase) {
      this.lastError = 'The tournament schedule changed while this result was awaiting review.';
      this.dataChangedReactCallback();
      return false;
    }
    if (status === ImportResultStatus.FatalErr) return false;
    if (status === ImportResultStatus.ErrNonFatal && !acceptAnyway) return false;

    const scheduled = this.findScheduledMatch(item.scheduledMatchId);
    // Accepting twice would put two copies of one game into the standings. The scheduled match's
    // result link is the guard, and it survives a save and reopen.
    if (scheduled?.isAccepted() || scheduled?.quarantined || scheduled?.status === ScheduledMatchStatus.Cancelled) {
      return false;
    }
    if (scheduled?.resultMatchId) {
      // A dangling link is an integrity problem, not permission to create another official Match.
      // Keep the scheduled record reviewable until the director repairs it.
      return false;
    }
    if (
      scheduled &&
      (scheduled.roundNumber !== item.roundNumber ||
        !scheduled.matchesTeams(item.leftTeam, item.rightTeam) ||
        (item.roomId !== undefined && scheduled.roomId !== item.roomId))
    ) {
      this.lastError = 'The scheduled assignment changed while this result was awaiting review.';
      this.dataChangedReactCallback();
      return false;
    }
    if (item.scheduledMatchId && !scheduled) {
      this.lastError = 'The scheduled game no longer exists; this result cannot be accepted automatically.';
      this.dataChangedReactCallback();
      return false;
    }
    if (scheduled && scheduled.status !== ScheduledMatchStatus.Submitted) return false;

    // A second official match for the same scheduled pairing is rejected even if a damaged file
    // lost the scheduled result link. This catches duplicate imports and recovery races globally.
    const officialMatches = this.tournament.phases.flatMap((candidatePhase) =>
      candidatePhase.rounds.flatMap((candidateRound) => candidateRound.matches),
    );
    if (officialMatches.some((existing) => existing.id === match.id)) return false;
    if (this.tournament.scheduledMatches.some((candidate) => candidate.resultMatchId === match.id)) return false;
    if (
      scheduled &&
      round.matches.some(
        (existing) =>
          existing.leftTeam.team &&
          existing.rightTeam.team &&
          scheduled.matchesTeams(existing.leftTeam.team.name, existing.rightTeam.team.name),
      )
    ) {
      return false;
    }

    // Prepare and commit the authoritative model as one synchronous transaction. The importer has
    // already made a detached Match, but validation and transition helpers can still mutate it, so
    // retain the small rollback set until the Match is visible in its round.
    const previousStatsValidity = match.statsValidity;
    const previousImportedFile = match.importedFile;
    const previousValidation = match.modalBottomValidation.makeCopy();
    const previousScheduled = scheduled
      ? {
          status: scheduled.status,
          resultMatchId: scheduled.resultMatchId,
          roomNameAtPlay: scheduled.roomNameAtPlay,
          quarantined: scheduled.quarantined,
          operationalIssue: scheduled.operationalIssue,
        }
      : undefined;
    let matchAdded = false;
    try {
      // Mirror MatchImportResultsManager.finishImport exactly, so a remote match is
      // indistinguishable from a manually imported one.
      if (status === ImportResultStatus.ErrNonFatal) match.statsValidity = StatsValidity.omit;
      match.importedFile = importResult.filePath;
      Tournament.validateHaveTeamsPlayedInRound(match, round, phase, false);
      if (scheduled) {
        scheduled.resultMatchId = match.id;
        const transition = transitionScheduledMatch(scheduled, ScheduledMatchStatus.Accepted, {
          hasAcceptedResult: true,
        });
        if (!transition.ok) throw new Error(transition.reason);
      }
      round.addMatch(match);
      matchAdded = true;

      if (scheduled?.roomId) {
        scheduled.roomNameAtPlay = this.tournament.rooms.find((room) => room.id === scheduled.roomId)?.name;
      }
    } catch (error: unknown) {
      if (matchAdded || round.matches.includes(match)) round.deleteMatch(match);
      match.statsValidity = previousStatsValidity;
      match.importedFile = previousImportedFile;
      match.modalBottomValidation.copyFromOther(previousValidation);
      if (scheduled && previousScheduled) {
        scheduled.status = previousScheduled.status;
        scheduled.resultMatchId = previousScheduled.resultMatchId;
        scheduled.roomNameAtPlay = previousScheduled.roomNameAtPlay;
        scheduled.quarantined = previousScheduled.quarantined;
        scheduled.operationalIssue = previousScheduled.operationalIssue;
      }
      this.lastError = errorMessage(error);
      this.dataChangedReactCallback();
      return false;
    }

    this.inbox = this.inbox.filter((i) => i.sessionId !== sessionId);
    this.pendingDurableAcceptances.set(sessionId, this.verdictForSubmission(item, true));
    try {
      this.onMatchAccepted(importResult);
      this.maybeAutoReleaseNextRound();
    } catch (error: unknown) {
      // The model commit is complete. Keep the durable-acceptance handoff pending and surface the
      // callback failure instead of pretending the result was lost or retrying the Match insert.
      this.lastError = errorMessage(error);
    }
    // The accepted result may have made the next round current, so rooms need to hear about it.
    const snapshotSynced = this.pushTournamentSnapshot();
    if (!snapshotSynced) {
      // The local commit and pending durable verdict remain authoritative until the next retry; do
      // not undo an accepted Match merely because the optional live projection IPC failed.
      this.onScheduleChanged();
    }
    this.dataChangedReactCallback();
    return true;
  }

  /** Reject a submission. The room is told, and may correct and resubmit. */
  rejectSubmission(sessionId: string, reason?: string) {
    const item = this.findInboxItem(sessionId);
    if (!item) return false;

    const scheduled = this.findScheduledMatch(item.scheduledMatchId);
    // Back to needing a human rather than to plain waiting, so the round-readiness view keeps
    // showing that something is wrong here.
    if (scheduled && !scheduled.isAccepted()) {
      const transition = transitionScheduledMatch(scheduled, ScheduledMatchStatus.NeedsAttention);
      if (!transition.ok && scheduled.status !== ScheduledMatchStatus.NeedsAttention) return false;
    }

    this.inbox = this.inbox.filter((i) => i.sessionId !== sessionId);
    this.pendingDurableVerdicts.set(sessionId, this.verdictForSubmission(item, false, reason));
    const snapshotSynced = this.pushTournamentSnapshot();
    if (!snapshotSynced) {
      // The rejection remains pending until the .yft save and a later projection/verdict retry.
      this.lastError =
        this.lastError || 'The Tournament Server projection is unavailable; the rejection remains pending.';
    }
    this.onScheduleChanged();
    this.dataChangedReactCallback();
    return true;
  }

  /** Forget a recorded conflict once the director has dealt with it */
  dismissConflict(sessionId: string) {
    this.conflicts = this.conflicts.filter((c) => c.submission.sessionId !== sessionId);
    this.dataChangedReactCallback();
  }

  // eslint-disable-next-line class-methods-use-this
  private sendVerdict(verdict: ISubmissionVerdict): boolean {
    try {
      if (typeof window !== 'undefined' && window.electron) {
        window.electron.ipcRenderer.sendMessage(IpcRendToMain.TournamentServerSubmissionVerdict, verdict);
        return true;
      }
    } catch (error: unknown) {
      this.lastError = errorMessage(error);
      this.dataChangedReactCallback();
    }
    return false;
  }

  /** Called only after the primary .yft save reports a durable replacement. */
  confirmDurableAcceptance(sessionId: string) {
    const verdict = this.pendingDurableVerdicts.get(sessionId);
    if (verdict && verdict.accepted === true) {
      if (this.sendVerdict(verdict)) this.pendingDurableVerdicts.delete(sessionId);
      return;
    }
    const pending = this.pendingDurableAcceptances.get(sessionId);
    if (!pending) return;
    if (this.sendVerdict(pending)) {
      this.pendingDurableAcceptances.delete(sessionId);
      this.pendingDurableVerdicts.delete(sessionId);
    }
  }

  /** Flush one durable rejection after the saved schedule contains NeedsAttention. */
  confirmDurableDecision(sessionId: string) {
    const verdict = this.pendingDurableVerdicts.get(sessionId);
    if (!verdict || verdict.accepted === true) return;
    if (this.sendVerdict(verdict)) this.pendingDurableVerdicts.delete(sessionId);
  }

  /** Flush all result verdicts whose official schedule state is covered by the last durable YFT save. */
  confirmDurableDecisions() {
    for (const sessionId of Array.from(this.pendingDurableAcceptances.keys())) this.confirmDurableAcceptance(sessionId);
    for (const sessionId of Array.from(this.pendingDurableVerdicts.keys())) {
      this.confirmDurableDecision(sessionId);
    }
  }

  /** Compatibility alias for callers that only need to flush accepted Matches. */
  confirmDurableAcceptances() {
    for (const sessionId of Array.from(this.pendingDurableAcceptances.keys())) this.confirmDurableAcceptance(sessionId);
  }

  /** Drop everything, e.g. when a different tournament file is opened */
  reset() {
    // Presence/help responses do not carry a tournament key. Advance every outstanding poll
    // generation so a response started for the previous document cannot populate the new one after
    // a switch. Keep the counters monotonic: clearing them could let an old generation numerically
    // collide with the first request for the replacement tournament.
    for (const [kind, generation] of this.pollGenerations) {
      this.pollGenerations.set(kind, generation + 1);
    }
    this.inbox = [];
    this.sessions = [];
    this.conflicts = [];
    this.roomPresence = [];
    this.helpRequests = [];
    this.roundOverride = null;
    this.pendingDurableAcceptances.clear();
    this.pendingDurableVerdicts.clear();
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'The tournament server operation failed.';
}

export const TournamentServerContext = createContext<TournamentServerService | null>(null);
