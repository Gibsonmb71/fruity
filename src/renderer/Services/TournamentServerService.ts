import { createContext } from 'react';
import Tournament from '../DataModel/Tournament';
import { ScheduledMatchStatus, transitionScheduledMatch } from '../DataModel/ScheduledMatch';
import MatchImportResult, { ImportResultStatus } from '../DataModel/MatchImportResult';
import { StatsValidity } from '../DataModel/Match';
import MatchImportService from './MatchImportService';
import scoringRulesToModaqGameFormat from './YellowFruitScoringRulesToModaq';
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

export interface IInboxItem {
  sessionId: string;
  roundNumber: number;
  leftTeam: string;
  rightTeam: string;
  submittedAt: string;
  scheduledMatchId?: string;
  roomId?: string;
  roomName?: string;
  finalRevision?: number;
  finalFingerprint?: string;
  importResult: MatchImportResult;
}

export interface IMatchSubmissionConflict {
  submission: IMatchSubmission;
  existingMatchId: string;
  noticedAt: string;
}

export default class TournamentServerService {
  status: IServerStatus = { running: false, port: defaultServerPort, addresses: [], networkAddresses: [] };

  private preferredNetworkAddress: string | null = TournamentServerService.readPreferredNetworkAddress();

  /** Raw preferred host/origin as the director entered it; host-only values are resolved against the active port. */
  private preferredRoomUrlValue: string | null = TournamentServerService.readPreferredRoomUrl();

  private advertisedRoomAddress: IAdvertisedRoomAddress | null = TournamentServerService.readAdvertisedRoomAddress();

  requestedPort: number = defaultServerPort;

  sessions: ISessionSummary[] = [];

  inbox: IInboxItem[] = [];

  roomPresence: IRoomPresence[] = [];

  helpRequests: IHelpRequest[] = [];

  lastError: string = '';

  roundOverride: number | null = null;

  conflicts: IMatchSubmissionConflict[] = [];

  private pendingDurableAcceptances = new Map<string, ISubmissionVerdict>();

  private pendingDurableVerdicts = new Map<string, ISubmissionVerdict>();

  private pollGenerations = new Map<string, number>();

  dataChangedReactCallback: () => void;

  onMatchAccepted: (result: MatchImportResult) => void;

  onScheduleChanged: () => void;

  private tournament: Tournament;

  constructor(tournament: Tournament) {
    this.tournament = tournament;
    this.dataChangedReactCallback = () => {};
    this.onMatchAccepted = () => {};
    this.onScheduleChanged = () => {};
  }

  private static readonly preferredNetworkAddressStorageKey = 'yellowfruit.preferred-network-address';

  private static readonly preferredRoomUrlStorageKey = 'yellowfruit.preferred-room-url';

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
    if (valid) this.recordAdvertisedAddress(valid);
    this.dataChangedReactCallback();
  }

  get preferredRoomUrl(): string | null {
    return this.preferredRoomUrlValue;
  }

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
    // Keep the raw input. A host-only value must pick up a later requested/running port instead of
    // permanently remembering whichever port happened to be active when the preference was saved.
    this.preferredRoomUrlValue = trimmed;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(TournamentServerService.preferredRoomUrlStorageKey, trimmed);
    }
    this.lastError = '';
    this.dataChangedReactCallback();
    return true;
  }

  get roomLinkOrigin(): string {
    const normalized =
      this.preferredRoomUrlValue === null
        ? null
        : normalizePreferredRoomUrl(this.preferredRoomUrlValue, this.status.port || this.requestedPort);
    return resolveRoomLinkOrigin(normalized, this.selectedAddress);
  }

  get roomAddressChange(): IRoomAddressChange | null {
    return detectRoomAddressChange(this.advertisedRoomAddress, this.networkAddresses, this.selectedAddress, {
      running: this.status.running,
      tournamentKey: this.recoveryKey(),
    });
  }

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
    return this.pushTournamentSnapshot();
  }

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

  private recoveryKey(): string {
    return this.tournament.operationalId;
  }

  get currentRoundNumber(): number | null {
    if (this.roundOverride !== null) return this.roundOverride;

    const unresolved = this.tournament.scheduledMatches.filter((match) => !match.isResolved());
    if (unresolved.length === 0) return null;
    return unresolved.reduce((earliest, match) => Math.min(earliest, match.roundNumber), Infinity);
  }

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

  private maybeAutoReleaseNextRound() {
    if (!this.tournament.autoReleaseNextRound) return;
    const released = this.tournament.releasedRoundNumber;
    if (released === null) return;

    const releasedMatches = this.tournament.scheduledMatches.filter((match) => match.roundNumber === released);
    if (releasedMatches.length === 0 || releasedMatches.some((match) => !match.isResolved())) return;

    const next = this.nextRoundToRelease();
    if (next === null) return;

    if (!this.releaseRound(next)) {
      this.lastError = this.canReleaseRound(next).reason ?? 'The next round could not be released.';
      this.dataChangedReactCallback();
    }
  }

  private findScheduledMatch(scheduledMatchId: string | undefined) {
    if (!scheduledMatchId) return undefined;
    return this.tournament.scheduledMatches.find((match) => match.id === scheduledMatchId);
  }

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

  pushTournamentSnapshot(): boolean {
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

  handleSubmission(submission: IMatchSubmission) {
    if (submission.tournamentKey && submission.tournamentKey !== this.recoveryKey()) return;
    const scheduled = this.findScheduledMatch(submission.scheduledMatchId);

    if (submission.scheduledMatchId && !scheduled) {
      const invalid = new MatchImportResult(TournamentServerService.makeSourceLabel(submission));
      invalid.markFatal('The scheduled game no longer exists in this tournament; review the room result manually.');
      this.replaceInboxItem(submission, invalid);
      return;
    }

    if (scheduled?.isAccepted()) {
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

  pendingCount() {
    return this.inbox.length;
  }

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
    if (scheduled?.isAccepted() || scheduled?.quarantined || scheduled?.status === ScheduledMatchStatus.Cancelled) {
      return false;
    }
    if (scheduled?.resultMatchId) return false;
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
      this.lastError = errorMessage(error);
    }
    const snapshotSynced = this.pushTournamentSnapshot();
    if (!snapshotSynced) this.onScheduleChanged();
    this.dataChangedReactCallback();
    return true;
  }

  rejectSubmission(sessionId: string, reason?: string) {
    const item = this.findInboxItem(sessionId);
    if (!item) return false;

    const scheduled = this.findScheduledMatch(item.scheduledMatchId);
    if (scheduled && !scheduled.isAccepted()) {
      const transition = transitionScheduledMatch(scheduled, ScheduledMatchStatus.NeedsAttention);
      if (!transition.ok && scheduled.status !== ScheduledMatchStatus.NeedsAttention) return false;
    }

    this.inbox = this.inbox.filter((i) => i.sessionId !== sessionId);
    this.pendingDurableVerdicts.set(sessionId, this.verdictForSubmission(item, false, reason));
    const snapshotSynced = this.pushTournamentSnapshot();
    if (!snapshotSynced) {
      this.lastError =
        this.lastError || 'The Tournament Server projection is unavailable; the rejection remains pending.';
    }
    this.onScheduleChanged();
    this.dataChangedReactCallback();
    return true;
  }

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

  confirmDurableDecision(sessionId: string) {
    const verdict = this.pendingDurableVerdicts.get(sessionId);
    if (!verdict || verdict.accepted === true) return;
    if (this.sendVerdict(verdict)) this.pendingDurableVerdicts.delete(sessionId);
  }

  confirmDurableDecisions() {
    for (const sessionId of Array.from(this.pendingDurableAcceptances.keys())) this.confirmDurableAcceptance(sessionId);
    for (const sessionId of Array.from(this.pendingDurableVerdicts.keys())) {
      this.confirmDurableDecision(sessionId);
    }
  }

  confirmDurableAcceptances() {
    for (const sessionId of Array.from(this.pendingDurableAcceptances.keys())) this.confirmDurableAcceptance(sessionId);
  }

  reset() {
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
