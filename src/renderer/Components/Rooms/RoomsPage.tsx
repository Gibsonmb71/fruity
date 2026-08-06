import { useContext, useEffect, useMemo, useState } from 'react';
import type { ContextType, JSX } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  Menu,
  MenuItem,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { Add, ContentCopy, MoreVert, PlayArrow, Print, Settings, Stop } from '@mui/icons-material';
import { TournamentContext } from '../../TournamentManager';
import { ControlPages } from '../../Enums';
import { TournamentServerContext } from '../../Services/TournamentServerService';
import {
  ISessionSummary,
  SessionDisplayState,
  SessionStatus,
  staleRoomThresholdMs,
} from '../../../main/server/ServerTypes';
import { ScheduledMatch, ScheduledMatchStatus } from '../../DataModel/ScheduledMatch';
import { TournamentRoom } from '../../DataModel/TournamentRoom';
import Tournament from '../../DataModel/Tournament';
import {
  ScheduleIssueSeverity,
  checkRoomDeletion,
  hasBlockingIssue,
  mergeGeneratedSchedule,
  moveRoom,
  normalizeRoomOrder,
  roundsWithGames,
  summarizeRound,
  validatePhaseScheduleCompleteness,
  validateSchedule,
} from '../../Services/ScheduleService';
import {
  IRoomAssignmentSnapshot,
  IRebalancePlan,
  applyRebalance,
  applySwapPlan,
  assignRoom,
  captureRoomAssignmentSnapshot,
  planAutoAssignUnassigned,
  planRebalance,
  planSwap,
  restoreRoomAssignmentSnapshot,
} from '../../Services/RoomAllocationService';
import { resolveTournamentReadiness } from '../../Services/TournamentReadiness';
import { createNavigationIntent, INavigationIntent } from '../../Services/Navigation';
import { ConfirmDialog, RoomDetailDialog, RoomEditorDialog, RoomQrDialog, RoomSetupDialog } from './RoomDialogs';
import { MatchEditorDialog, ScheduleGeneratorDialog } from './ScheduleDialogs';
import MatchPlanWorkspace from './MatchPlanWorkspace';
import RebracketDialog from './RebracketDialog';
import MatchInboxCard from './MatchInboxCard';
import LiveDisplaySettingsCard from './LiveDisplaySettingsCard';
import { YfPageHeader } from '../../Utils/GeneralReactUtils';
import { selectRoomAssignments } from '../../../shared/RoomAssignmentState';
import './rooms.css';

const pollIntervalMs = 3000;

function elapsed(ms: number | null): string {
  if (ms === null) return 'Never';
  const minutes = Math.floor(ms / 60000);
  if (minutes > 0) return `${minutes}m ago`;
  const seconds = Math.max(1, Math.floor(ms / 1000));
  return `${seconds}s ago`;
}

function sessionForRoom(room: TournamentRoom, sessions: ISessionSummary[]): ISessionSummary | undefined {
  return sessions
    .filter(
      (session) =>
        session.roomId === room.id &&
        session.status !== SessionStatus.Accepted &&
        session.status !== SessionStatus.Rejected,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

function roomAssignmentsForRoom(
  room: TournamentRoom,
  matches: ScheduledMatch[],
  releasedRoundNumber: number | null,
  currentRoundNumber: number | null,
) {
  return selectRoomAssignments(
    matches.filter((match) => match.roomId === room.id),
    releasedRoundNumber,
    currentRoundNumber,
  );
}

function roomState(
  room: TournamentRoom,
  match: ScheduledMatch | undefined,
  nextMatch: ScheduledMatch | undefined,
  session: ISessionSummary | undefined,
  connected: boolean,
  serverRunning: boolean,
) {
  if (!room.enabled) return { label: 'Disabled', className: 'is-disabled' };
  if (session?.displayState === SessionDisplayState.Stale) return { label: 'Stale', className: 'is-offline' };
  if (session?.displayState === SessionDisplayState.Submitted) return { label: 'Submitted', className: 'is-submitted' };
  if (session?.displayState === SessionDisplayState.Live) return { label: 'Playing', className: 'is-playing' };
  if (match?.status === ScheduledMatchStatus.NeedsAttention)
    return { label: 'Needs attention', className: 'is-warning' };
  if (connected) {
    if (nextMatch && !match) return { label: 'Waiting for release', className: 'is-connected' };
    return { label: match ? 'Waiting' : 'Connected', className: 'is-connected' };
  }
  if (!serverRunning) return { label: 'Server offline', className: 'is-offline' };
  return { label: 'Offline', className: 'is-offline' };
}

function sessionProgress(session: ISessionSummary | undefined, match: ScheduledMatch | undefined): string {
  if (session?.displayState === SessionDisplayState.Live && session.score) return `Q${session.score.tossupsRead}`;
  if (session?.displayState === SessionDisplayState.Submitted || match?.status === ScheduledMatchStatus.Submitted)
    return 'Final';
  if (match?.status === ScheduledMatchStatus.Accepted) return 'Final';
  return '—';
}

function roomPresenceFor(room: TournamentRoom, service: TournamentServerContextValue) {
  return service.roomPresence.find((presence) => presence.roomId === room.id);
}

type TournamentServerContextValue = NonNullable<ContextType<typeof TournamentServerContext>>;

interface IConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
}

function presenceLabel(connected: boolean, lastSeenAt: string | null, msSinceLastSeen: number | null): string {
  if (connected) return 'Connected';
  if (lastSeenAt !== null) return elapsed(msSinceLastSeen);
  return 'Never';
}

interface IRoomsPageProps {
  // eslint-disable-next-line react/require-default-props
  activeTab?: ControlPages;
  // eslint-disable-next-line react/require-default-props
  onTabChange?: (tab: ControlPages) => void;
  // eslint-disable-next-line react/require-default-props
  onNavigateTarget?: (intent: INavigationIntent) => void;
  navigation?: INavigationIntent;
  onNavigationHandled: () => void;
}

export default function RoomsPage({
  activeTab: controlledTab,
  onTabChange,
  onNavigateTarget,
  navigation,
  onNavigationHandled,
}: IRoomsPageProps) {
  const manager = useContext(TournamentContext);
  const service = manager.tournamentServerService;
  const { tournament } = manager;
  const [, setRefresh] = useState(0);
  const [roomDetail, setRoomDetail] = useState<TournamentRoom | null>(null);
  const [roomEditor, setRoomEditor] = useState<TournamentRoom | null | undefined>(undefined);
  const [qrRoom, setQrRoom] = useState<TournamentRoom | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [matchEditor, setMatchEditor] = useState<ScheduledMatch | null | undefined>(undefined);
  const [rebracketOpen, setRebracketOpen] = useState(false);
  const [serverSettingsOpen, setServerSettingsOpen] = useState(false);
  const [confirmState, setConfirmState] = useState<IConfirmState | null>(null);
  const [bulkPlan, setBulkPlan] = useState<{ mode: 'auto' | 'rebalance'; plan: IRebalancePlan } | null>(null);
  const [assignmentUndo, setAssignmentUndo] = useState<{ snapshot: IRoomAssignmentSnapshot; label: string } | null>(null);
  const [scheduleError, setScheduleError] = useState('');
  const [roomMenu, setRoomMenu] = useState<{ room: TournamentRoom; anchor: HTMLElement } | null>(null);
  const [uncontrolledTab, setUncontrolledTab] = useState(ControlPages.Live);
  const activeTab = controlledTab ?? uncontrolledTab;
  const setActiveTab = (tab: ControlPages) => {
    setUncontrolledTab(tab);
    onTabChange?.(tab);
  };

  useEffect(() => {
    service.dataChangedReactCallback = () => setRefresh((current) => current + 1);
    service.refreshStatus();
    return () => {
      service.dataChangedReactCallback = () => {};
    };
  }, [service]);

  useEffect(() => {
    if (!navigation) return;
    if (navigation.target === 'control:match-plan' || navigation.focus === 'result-inbox') return;
    const timer = window.setTimeout(() => onNavigationHandled(), 0);
    return () => window.clearTimeout(timer);
  }, [navigation, onNavigationHandled]);

  useEffect(() => {
    if (!service.status.running) return undefined;
    service.refreshSessions();
    service.refreshPresence();
    const handle = setInterval(() => {
      service.refreshSessions();
      service.refreshPresence();
    }, pollIntervalMs);
    return () => clearInterval(handle);
  }, [service, service.status.running]);

  const rooms = tournament.rooms.slice().sort(TournamentRoom.compare);
  const matches = tournament.scheduledMatches
    .slice()
    .sort((a, b) => a.roundNumber - b.roundNumber || a.id.localeCompare(b.id));
  const roundNumbers = useMemo(() => roundsWithGames(matches), [matches]);
  const scheduleIssues = useMemo(() => validateSchedule(matches, rooms), [matches, rooms]);
  const blockingScheduleIssues = scheduleIssues.filter((issue) => issue.severity === ScheduleIssueSeverity.Error);
  const currentRound = service.currentRoundNumber;
  const currentSummary = currentRound === null ? null : summarizeRound(matches, currentRound);
  const activeSessions = service.sessions.filter(
    (session) => session.status !== SessionStatus.Accepted && session.status !== SessionStatus.Rejected,
  );
  const onlineRooms = service.roomPresence.filter((presence) => presence.connected).length;
  const readiness = resolveTournamentReadiness(tournament, {
    running: service.status.running,
    currentRoundNumber: service.currentRoundNumber,
    releasedRoundNumber: service.releasedRoundNumber,
    inboxCount: service.inbox.length,
    conflictCount: service.conflicts.length,
    inboxScheduledMatchIds: service.inbox.map((item) => item.scheduledMatchId).filter(Boolean) as string[],
    sessions: activeSessions.map((session) => ({ roomId: session.roomId, status: session.status })),
    roomPresence: service.roomPresence.map((presence) => ({ roomId: presence.roomId, connected: presence.connected })),
  });

  const rebracketBoundary = useMemo(() => {
    const fullPhases = tournament.getFullPhases();
    return (
      fullPhases.find((phase) => {
        const next = tournament.getNextFullPhase(phase);
        if (!next || tournament.rebracketedPhaseCodes.includes(phase.code)) return false;
        const phaseRoundNumbers = phase.rounds.map((round) => round.number);
        const phaseMatches = matches.filter((match) => phaseRoundNumbers.includes(match.roundNumber));
        const missing = validatePhaseScheduleCompleteness(phase, matches);
        return phaseMatches.length > 0 && phaseMatches.every((match) => match.isResolved()) && missing.length === 0;
      }) ?? null
    );
  }, [tournament, matches]);
  const rebracketNextPhase = rebracketBoundary ? tournament.getNextFullPhase(rebracketBoundary) ?? null : null;

  const serverAddress = service.selectedAddress;
  const nextRelease = service.nextRoundToRelease();
  const nextReleaseSummary = nextRelease === null ? null : summarizeRound(matches, nextRelease);
  const previousRelease =
    nextRelease === null
      ? null
      : roundNumbers.filter((roundNumber) => roundNumber < nextRelease).sort((a, b) => b - a)[0] ?? null;
  const previousReleaseSummary = previousRelease === null ? null : summarizeRound(matches, previousRelease);
  const disabledRoomAssignments =
    nextRelease === null
      ? 0
      : matches.filter(
          (match) =>
            match.roundNumber === nextRelease &&
            match.roomId !== undefined &&
            rooms.some((room) => room.id === match.roomId && !room.enabled),
        ).length;
  const releaseBlocked =
    nextReleaseSummary === null ||
    nextReleaseSummary.expected === 0 ||
    nextReleaseSummary.roomsAssigned < nextReleaseSummary.expected ||
    (previousReleaseSummary !== null && !previousReleaseSummary.complete) ||
    disabledRoomAssignments > 0 ||
    blockingScheduleIssues.some((issue) =>
      issue.scheduledMatchIds.some((id) => matches.find((match) => match.id === id)?.roundNumber === nextRelease),
    );

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      manager.makeToast('Copied to clipboard');
    } catch (err: any) {
      manager.makeToast('Could not copy to clipboard', 'error');
    }
  };

  const openRoomEditor = (room: TournamentRoom | null = null) => setRoomEditor(room);

  const requestDeleteRoom = (room: TournamentRoom) => {
    const check = checkRoomDeletion(room, matches);
    if (!check.canDelete) {
      setConfirmState({
        title: `Cannot delete ${room.name}`,
        message: check.reason ?? 'This room is still referenced by active tournament state. Disable it instead.',
        confirmLabel: 'Close',
        onConfirm: () => setConfirmState(null),
      });
      return;
    }
    setConfirmState({
      title: `Delete ${room.name}?`,
      message:
        check.affectedScheduledMatchIds.length > 0
          ? `${check.affectedScheduledMatchIds.length} future assignment${
              check.affectedScheduledMatchIds.length === 1 ? '' : 's'
            } will become unassigned.`
          : 'This room has no scheduled games.',
      confirmLabel: 'Delete room',
      destructive: true,
      onConfirm: () => {
        const unassignmentIssues = check.affectedScheduledMatchIds.flatMap((matchId) =>
          assignRoom(tournament, matchId, undefined, { source: 'auto', unlock: true }),
        );
        if (hasBlockingIssue(unassignmentIssues)) {
          setScheduleError(unassignmentIssues.map((issue) => issue.message).join(' '));
          setConfirmState(null);
          return;
        }
        tournament.rooms = normalizeRoomOrder(tournament.rooms.filter((candidate) => candidate.id !== room.id));
        manager.markTournamentDataChanged();
        setRoomDetail(null);
        setConfirmState(null);
      },
    });
  };

  const requestRegenerateToken = (room: TournamentRoom) => {
    setConfirmState({
      title: `Regenerate ${room.name} token?`,
      message: 'The current permanent URL will stop working immediately. Print or copy the new URL afterward.',
      confirmLabel: 'Regenerate token',
      onConfirm: () => {
        room.regenerateToken();
        manager.markTournamentDataChanged();
        setConfirmState(null);
      },
    });
  };

  const rememberAssignmentUndo = (snapshot: IRoomAssignmentSnapshot, changeCount: number) => {
    if (changeCount > 0 && snapshot.entries.length > 0) {
      setAssignmentUndo({
        snapshot,
        label: `${changeCount} room assignment${changeCount === 1 ? '' : 's'} updated`,
      });
    }
  };

  const undoAssignment = () => {
    if (!assignmentUndo) return;
    const issues = restoreRoomAssignmentSnapshot(tournament, assignmentUndo.snapshot);
    if (hasBlockingIssue(issues)) {
      setScheduleError(issues.map((issue) => issue.message).join(' '));
      return;
    }
    setAssignmentUndo(null);
    manager.markTournamentDataChanged();
  };

  const moveRoomAssignment = (match: ScheduledMatch, nextRoomId: string) => {
    setScheduleError('');
    if (nextRoomId === '') {
      const snapshot = captureRoomAssignmentSnapshot(tournament, [match.id]);
      const issues = assignRoom(tournament, match.id, undefined, { source: 'manual' });
      if (hasBlockingIssue(issues)) {
        setScheduleError(issues.map((issue) => issue.message).join(' '));
        return;
      }
      rememberAssignmentUndo(snapshot, 1);
      manager.markTournamentDataChanged();
      return;
    }

    const plan = planSwap(tournament, match.id, nextRoomId);
    if (plan.kind === 'illegal') {
      setScheduleError(plan.issues.map((issue) => issue.message).join(' '));
      return;
    }
    if (plan.kind === 'move') {
      const snapshot = captureRoomAssignmentSnapshot(
        tournament,
        plan.changes.map((change) => change.matchId),
      );
      const issues = applySwapPlan(tournament, plan);
      if (hasBlockingIssue(issues)) {
        setScheduleError(issues.map((issue) => issue.message).join(' '));
        return;
      }
      rememberAssignmentUndo(snapshot, plan.changes.length);
      manager.markTournamentDataChanged();
      return;
    }

    const targetChange = plan.changes.find((change) => change.matchId === match.id);
    const otherChange = plan.changes.find((change) => change.matchId !== match.id);
    const targetRoom = rooms.find((room) => room.id === targetChange?.toRoomId)?.name ?? nextRoomId;
    const otherMatch = otherChange ? matches.find((candidate) => candidate.id === otherChange.matchId) : undefined;
    setConfirmState({
      title: 'Swap room assignments?',
      message: `${match.describe()} moves to ${targetRoom}. ${otherMatch?.describe() ?? 'The other game'} moves to ${
        rooms.find((room) => room.id === otherChange?.toRoomId)?.name ?? 'the source room'
      }.`,
      confirmLabel: 'Swap',
      onConfirm: () => {
        const snapshot = captureRoomAssignmentSnapshot(
          tournament,
          plan.changes.map((change) => change.matchId),
        );
        const issues = applySwapPlan(tournament, plan);
        if (hasBlockingIssue(issues)) setScheduleError(issues.map((issue) => issue.message).join(' '));
        else {
          rememberAssignmentUndo(snapshot, plan.changes.length);
          manager.markTournamentDataChanged();
        }
        setConfirmState(null);
      },
    });
  };

  const upcomingRoundNumbers = roundNumbers.filter(
    (roundNumber) => currentRound === null || roundNumber > currentRound,
  );

  const openBulkPlan = (mode: 'auto' | 'rebalance') => {
    let selectedRounds = upcomingRoundNumbers;
    if (selectedRounds.length === 0 && currentRound === null) selectedRounds = roundNumbers;
    const plan =
      mode === 'auto'
        ? planAutoAssignUnassigned(tournament, selectedRounds)
        : planRebalance(tournament, selectedRounds);
    setBulkPlan({ mode, plan });
  };

  const applyBulkPlan = (plan: IRebalancePlan) => {
    const snapshot = captureRoomAssignmentSnapshot(
      tournament,
      plan.changes.map((change) => change.matchId),
    );
    applyRebalance(tournament, plan);
    rememberAssignmentUndo(snapshot, plan.changes.length);
    manager.markTournamentDataChanged();
    setBulkPlan(null);
  };

  const toggleRoomAssignmentLock = (match: ScheduledMatch) => {
    if (
      !match.roomId ||
      match.status === ScheduledMatchStatus.Playing ||
      match.status === ScheduledMatchStatus.Submitted ||
      match.status === ScheduledMatchStatus.Accepted
    )
      return;
    const snapshot = captureRoomAssignmentSnapshot(tournament, [match.id]);
    match.roomAssignmentLocked = match.roomAssignmentLocked ? undefined : true;
    match.roomAssignmentSource = 'manual';
    rememberAssignmentUndo(snapshot, 1);
    manager.markTournamentDataChanged();
  };

  const cancelMatch = (match: ScheduledMatch) => {
    if (
      match.status !== ScheduledMatchStatus.Scheduled &&
      match.status !== ScheduledMatchStatus.Ready &&
      match.status !== ScheduledMatchStatus.NeedsAttention
    )
      return;
    setConfirmState({
      title: 'Cancel scheduled match?',
      message: `${match.describe()} will remain in the Match Plan history as cancelled and will not count as an expected game.`,
      confirmLabel: 'Cancel match',
      destructive: true,
      onConfirm: () => {
        match.status = ScheduledMatchStatus.Cancelled;
        manager.markTournamentDataChanged();
        setConfirmState(null);
      },
    });
  };

  const applyGeneratedSchedule = (generated: ScheduledMatch[]) => {
    const merged = mergeGeneratedSchedule(matches, generated, rooms);
    if (hasBlockingIssue(merged.issues)) {
      manager.makeToast('The generated Match Plan conflicts with retained tournament history', 'error');
      return;
    }
    tournament.scheduledMatches = merged.scheduledMatches;
    manager.markTournamentDataChanged();
    setGeneratorOpen(false);
  };

  const releaseRound = () => {
    if (nextRelease === null || releaseBlocked) return;
    service.releaseRound(nextRelease);
  };

  return (
    <TournamentServerContext.Provider value={service}>
      <main className="rooms-operations">
        <YfPageHeader
          title="Control"
          description="Tournament-day operations: what needs to happen now, where, and why."
          status={
            <Chip
              size="small"
              color={service.status.running ? 'success' : 'default'}
              label={service.status.running ? 'Server running' : 'Server offline'}
            />
          }
        />

        <Box className="control-tabs" sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
          <Tabs
            value={activeTab}
            onChange={(event, value: ControlPages) => setActiveTab(value)}
            aria-label="Control sections"
            sx={{ minHeight: 38, '& .MuiTab-root': { minHeight: 38, py: 0.5 } }}
          >
            <Tab label="Live" value={ControlPages.Live} />
            <Tab label="Match Plan" value={ControlPages.MatchPlan} />
            <Tab label="Rooms" value={ControlPages.Rooms} />
            <Tab label="Display" value={ControlPages.Display} />
          </Tabs>
        </Box>

        {activeTab === ControlPages.Live ? (
          <ServerToolbar
            service={service}
            serverAddress={serverAddress}
            onCopy={copyText}
            onSelectAddress={(address) => service.setPreferredNetworkAddress(address)}
            onTestConnection={async () => {
              if (!serverAddress) return;
              try {
                const response = await fetch(`${serverAddress}/connect`, { cache: 'no-store' });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                manager.makeToast('Connection check succeeded');
              } catch (err: any) {
                manager.makeToast('Could not reach this network address', 'error');
              }
            }}
            onOpenSettings={() => setServerSettingsOpen(true)}
          />
        ) : (
          <div className="rooms-server-compact" aria-label="Tournament Server status">
            <span className={service.status.running ? 'is-running' : 'is-offline'}>
              Tournament Server {service.status.running ? 'running' : 'offline'}
            </span>
            <Button size="small" startIcon={<Settings />} onClick={() => setServerSettingsOpen(true)}>
              Settings
            </Button>
          </div>
        )}

        {activeTab === ControlPages.Live && (
          <div className="rooms-context-row" aria-label="Current tournament context">
            {currentRound === null ? 'No active round' : `Round ${currentRound}`}
            {' · '}
            {currentRound === null ? '—' : `${currentSummary?.accepted ?? 0}/${currentSummary?.expected ?? 0} accepted`}
            {' · '}
            {rooms.length === 0 ? 'No rooms configured' : `${onlineRooms}/${rooms.length} rooms online`}
            {service.inbox.length > 0 && <> · {service.inbox.length} result pending</>}
          </div>
        )}

        {activeTab === ControlPages.Live && (
          <PrimaryOperationPanel
            readiness={readiness}
            onAction={() =>
              runPrimaryAction(
                readiness,
                setActiveTab,
                setServerSettingsOpen,
                setRebracketOpen,
                releaseRound,
                onNavigateTarget,
              )
            }
          />
        )}

        {activeTab === ControlPages.Live && <LiveRoomTable rooms={rooms} matches={matches} service={service} />}

        {activeTab === ControlPages.Display && <LiveDisplaySettingsCard />}

        {activeTab === ControlPages.Rooms && (
          <section className="rooms-panel" aria-labelledby="rooms-list-heading">
            <div className="rooms-panel-header">
              <div>
                <h2 id="rooms-list-heading">Physical rooms</h2>
                <p>
                  {rooms.length === 0
                    ? 'Add the physical rooms being used for matches.'
                    : `${rooms.length} configured room${rooms.length === 1 ? '' : 's'}`}
                </p>
              </div>
              <div className="rooms-panel-actions">
                <Button
                  size="small"
                  startIcon={<Print />}
                  onClick={() => setSetupOpen(true)}
                  disabled={rooms.length === 0}
                >
                  Setup sheet
                </Button>
                <Button size="small" variant="contained" startIcon={<Add />} onClick={() => openRoomEditor()}>
                  Add room
                </Button>
              </div>
            </div>
            {rooms.length === 0 ? (
              <div className="rooms-empty-state">
                <strong>No rooms configured</strong>
                Add the physical rooms being used for matches.
              </div>
            ) : (
              <div className="rooms-table-wrap">
                <table className="rooms-table">
                  <thead>
                    <tr>
                      <th>Room</th>
                      <th>Match</th>
                      <th>Status</th>
                      <th>Progress</th>
                      <th>Last check-in</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {rooms.map((room) => {
                      const assignmentState = roomAssignmentsForRoom(
                        room,
                        matches,
                        service.releasedRoundNumber,
                        currentRound,
                      );
                      const match = assignmentState.current ?? undefined;
                      const nextMatch = assignmentState.next ?? undefined;
                      const session = sessionForRoom(room, service.sessions);
                      const presence = roomPresenceFor(room, service);
                      const state = roomState(
                        room,
                        match,
                        nextMatch,
                        session,
                        presence?.connected ?? false,
                        service.status.running,
                      );
                      return (
                        <tr key={room.id}>
                          <td>
                            <Button
                              className="rooms-room-name"
                              size="small"
                              onClick={() => setRoomDetail(room)}
                              sx={{ textTransform: 'none', p: 0 }}
                            >
                              {room.name}
                            </Button>
                            {room.description && <div className="rooms-room-description">{room.description}</div>}
                          </td>
                          <td className="rooms-matchup">
                            <RoomMatchup match={match} nextMatch={nextMatch} separator="vs" showRound />
                          </td>
                          <td>
                            <span className={`rooms-state ${state.className}`}>{state.label}</span>
                          </td>
                          <td>{sessionProgress(session, match)}</td>
                          <td className="rooms-secondary">
                            {presenceLabel(
                              presence?.connected ?? false,
                              presence?.lastSeenAt ?? null,
                              presence?.msSinceLastSeen ?? null,
                            )}
                          </td>
                          <td>
                            <IconButton
                              size="small"
                              aria-label={`More actions for ${room.name}`}
                              onClick={(event) => setRoomMenu({ room, anchor: event.currentTarget })}
                            >
                              <MoreVert fontSize="small" />
                            </IconButton>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        <Menu anchorEl={roomMenu?.anchor ?? null} open={roomMenu !== null} onClose={() => setRoomMenu(null)}>
          <MenuItem
            onClick={() => {
              if (!roomMenu) return;
              setRoomDetail(roomMenu.room);
              setRoomMenu(null);
            }}
          >
            Open room
          </MenuItem>
          <MenuItem
            onClick={() => {
              if (!roomMenu) return;
              openRoomEditor(roomMenu.room);
              setRoomMenu(null);
            }}
          >
            Edit room
          </MenuItem>
          <MenuItem
            onClick={() => {
              if (!roomMenu) return;
              setQrRoom(roomMenu.room);
              setRoomMenu(null);
            }}
          >
            QR / permanent URL
          </MenuItem>
          <MenuItem
            onClick={() => {
              if (!roomMenu) return;
              tournament.rooms = moveRoom(tournament.rooms, roomMenu.room.id, -1);
              manager.markTournamentDataChanged();
              setRoomMenu(null);
            }}
          >
            Move up
          </MenuItem>
          <MenuItem
            onClick={() => {
              if (!roomMenu) return;
              tournament.rooms = moveRoom(tournament.rooms, roomMenu.room.id, 1);
              manager.markTournamentDataChanged();
              setRoomMenu(null);
            }}
          >
            Move down
          </MenuItem>
          <MenuItem
            onClick={() => {
              if (!roomMenu) return;
              requestRegenerateToken(roomMenu.room);
              setRoomMenu(null);
            }}
          >
            Regenerate token
          </MenuItem>
          <MenuItem
            onClick={() => {
              if (!roomMenu) return;
              roomMenu.room.enabled = !roomMenu.room.enabled;
              manager.markTournamentDataChanged();
              setRoomMenu(null);
            }}
          >
            {roomMenu?.room.enabled ? 'Disable room' : 'Enable room'}
          </MenuItem>
          <MenuItem
            onClick={() => {
              if (!roomMenu) return;
              requestDeleteRoom(roomMenu.room);
              setRoomMenu(null);
            }}
          >
            Delete room
          </MenuItem>
        </Menu>

        {activeTab === ControlPages.Live && readiness.roomOperationsEnabled && readiness.activeIssues.length > 0 && (
          <section className="rooms-panel" aria-labelledby="attention-heading">
            <div className="rooms-panel-header">
              <div>
                <h2 id="attention-heading">Needs attention</h2>
                <p>Issues that can block the next operational step.</p>
              </div>
            </div>
            <AttentionList
              service={service}
              rooms={rooms}
              scheduleIssues={scheduleIssues}
              nextRelease={nextRelease}
              releaseBlocked={releaseBlocked}
              disabledRoomAssignments={disabledRoomAssignments}
            />
          </section>
        )}

        {activeTab === ControlPages.MatchPlan && (
          <section className="rooms-panel" aria-labelledby="schedule-heading">
            <div className="rooms-panel-header">
              <div>
                <h2 id="schedule-heading">Match Plan</h2>
                <p>
                  Plan concrete team-versus-team matches and their rooms. Accepted history is never regenerated away.
                </p>
              </div>
              <div className="rooms-panel-actions">
                <Button size="small" onClick={() => openBulkPlan('auto')} disabled={rooms.length === 0}>
                  Auto-assign unassigned
                </Button>
                <Button size="small" onClick={() => openBulkPlan('rebalance')} disabled={rooms.length === 0}>
                  Rebalance upcoming
                </Button>
                <Button size="small" startIcon={<Add />} onClick={() => setMatchEditor(null)}>
                  Add match
                </Button>
                <Button size="small" variant="contained" onClick={() => setGeneratorOpen(true)}>
                  Generate Match Plan
                </Button>
              </div>
            </div>
            {scheduleError !== '' && (
              <Alert severity="error" onClose={() => setScheduleError('')} sx={{ m: 2 }}>
                {scheduleError}
              </Alert>
            )}
            <MatchPlanWorkspace
              tournament={tournament}
              phases={tournament.phases}
              matches={matches}
              rooms={rooms}
              currentRoundNumber={currentRound}
              onMove={moveRoomAssignment}
              onEdit={(match) => setMatchEditor(match)}
              onCancel={cancelMatch}
              onToggleLock={toggleRoomAssignmentLock}
              navigation={navigation}
              onNavigationHandled={onNavigationHandled}
              undoLabel={assignmentUndo?.label}
              onUndo={assignmentUndo ? undoAssignment : undefined}
            />
          </section>
        )}

        {activeTab === ControlPages.Live && (service.inbox.length > 0 || navigation?.focus === 'result-inbox') && (
          <MatchInboxCard navigation={navigation} onNavigationHandled={onNavigationHandled} />
        )}

        <RoomEditorDialog
          open={roomEditor !== undefined}
          room={roomEditor ?? null}
          tournament={tournament}
          manager={manager}
          onClose={() => setRoomEditor(undefined)}
        />
        <RoomDetailDialog
          open={roomDetail !== null}
          room={roomDetail}
          tournament={tournament}
          manager={manager}
          serverAddress={serverAddress}
          sessions={service.sessions}
          presence={roomDetail ? roomPresenceFor(roomDetail, service) : undefined}
          onClose={() => setRoomDetail(null)}
          onEdit={(room) => {
            setRoomDetail(null);
            setRoomEditor(room);
          }}
          onCopyUrl={(room) => copyText(room.url(serverAddress))}
          onShowQr={(room) => setQrRoom(room)}
          onRegenerate={requestRegenerateToken}
        />
        <RoomQrDialog
          open={qrRoom !== null}
          room={qrRoom}
          serverAddress={serverAddress}
          onClose={() => setQrRoom(null)}
        />
        <RoomSetupDialog
          open={setupOpen}
          rooms={rooms}
          serverAddress={serverAddress}
          onClose={() => setSetupOpen(false)}
        />
        <MatchEditorDialog
          open={matchEditor !== undefined}
          match={matchEditor ?? null}
          tournament={tournament}
          rooms={rooms}
          manager={manager}
          onClose={() => setMatchEditor(undefined)}
        />
        <ScheduleGeneratorDialog
          open={generatorOpen}
          tournament={tournament}
          rooms={rooms}
          onClose={() => setGeneratorOpen(false)}
          onApply={applyGeneratedSchedule}
        />
        <RebracketDialog
          open={rebracketOpen}
          tournament={tournament}
          manager={manager}
          completedPhase={rebracketBoundary}
          nextPhase={rebracketNextPhase}
          rooms={rooms}
          pendingFinals={service.inbox.length}
          onClose={() => setRebracketOpen(false)}
          onDone={() => setRebracketOpen(false)}
        />
        <AllocationPreviewDialog
          open={bulkPlan !== null}
          mode={bulkPlan?.mode ?? 'auto'}
          plan={bulkPlan?.plan ?? null}
          tournament={tournament}
          rooms={rooms}
          onClose={() => setBulkPlan(null)}
          onApply={applyBulkPlan}
        />
        <ServerSettingsDialog
          service={service}
          open={serverSettingsOpen}
          onClose={() => setServerSettingsOpen(false)}
        />
        {confirmState && (
          <ConfirmDialog
            open
            title={confirmState.title}
            message={confirmState.message}
            confirmLabel={confirmState.confirmLabel}
            destructive={confirmState.destructive ?? false}
            onClose={() => setConfirmState(null)}
            onConfirm={confirmState.onConfirm}
          />
        )}
      </main>
    </TournamentServerContext.Provider>
  );
}

function ServerToolbar({
  service,
  serverAddress,
  onCopy,
  onSelectAddress,
  onTestConnection,
  onOpenSettings,
}: {
  service: TournamentServerContextValue;
  serverAddress: string;
  onCopy: (value: string) => void;
  onSelectAddress: (value: string) => void;
  onTestConnection: () => void;
  onOpenSettings: () => void;
}) {
  const { networkAddresses } = service;
  let addressContent: JSX.Element;
  if (!service.status.running) {
    addressContent = <strong>Browser room scoring is not configured</strong>;
  } else if (networkAddresses.length > 1) {
    addressContent = (
      <FormControl size="small" sx={{ minWidth: 235 }}>
        <InputLabel id="server-network-address-label">Network address</InputLabel>
        <Select
          labelId="server-network-address-label"
          value={serverAddress}
          label="Network address"
          onChange={(event) => onSelectAddress(event.target.value)}
        >
          {networkAddresses.map((address) => (
            <MenuItem key={address.url} value={address.url}>
              {address.interfaceName}: {address.address}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    );
  } else {
    addressContent = <strong>{serverAddress || 'No LAN address found'}</strong>;
  }
  return (
    <div className="rooms-server-toolbar">
      <div className="rooms-server-address">{addressContent}</div>
      {service.status.running && serverAddress !== '' && (
        <>
          <Button size="small" startIcon={<ContentCopy />} onClick={() => onCopy(serverAddress)}>
            Copy URL
          </Button>
          <Button size="small" onClick={onTestConnection}>
            Test connection
          </Button>
        </>
      )}
      <Button size="small" startIcon={<Settings />} onClick={onOpenSettings}>
        {service.status.running ? 'Network & server' : 'Set up room scoring'}
      </Button>
      {!service.status.running && (
        <Button size="small" variant="contained" startIcon={<PlayArrow />} onClick={onOpenSettings}>
          Start server
        </Button>
      )}
    </div>
  );
}

function operationTitle(readiness: ReturnType<typeof resolveTournamentReadiness>): string {
  switch (readiness.state) {
    case 'traditional-ready':
      return 'Browser room scoring is not configured';
    case 'server-unavailable':
      return 'Tournament server is unavailable';
    case 'rooms-not-configured':
      return 'Rooms are not configured';
    case 'match-plan-missing':
      return 'Match Plan is missing';
    case 'schedule-blocked':
      return 'This round cannot start';
    case 'results-awaiting-review':
      return 'Results are waiting for review';
    case 'rebracket-required':
      return 'Rebracketing is required';
    case 'next-round-preparation':
      return 'The next round needs preparation';
    case 'round-in-progress':
      return 'Round in progress';
    case 'tournament-complete':
      return 'Tournament complete';
    case 'round-ready':
      return 'Round is ready to begin';
    case 'setup':
      return 'Finish setup before starting games';
    case 'round-complete':
    default:
      return 'Tournament operations';
  }
}

function operationMessage(readiness: ReturnType<typeof resolveTournamentReadiness>): string {
  const firstIssue = readiness.activeIssues[0];
  switch (readiness.state) {
    case 'traditional-ready':
      return 'This tournament is ready for manual game entry in Games. Set up rooms only if you want browser scoring.';
    case 'server-unavailable':
      return 'Start the local server so room scorekeepers can connect.';
    case 'rooms-not-configured':
      return 'Add the physical rooms that will host the scheduled matches.';
    case 'match-plan-missing':
      return 'Generate or enter the concrete team-versus-team matches for the tournament.';
    case 'schedule-blocked':
      return firstIssue?.message ?? 'Fix the room or match assignment before releasing this round.';
    case 'results-awaiting-review':
      return 'Submitted results are never accepted automatically. Review them before advancing.';
    case 'rebracket-required':
      return 'The completed stage has reached an advancement checkpoint. Confirm standings before continuing.';
    case 'next-round-preparation':
      return 'Confirm assignments and rooms before releasing the next round.';
    case 'round-in-progress':
      return 'Monitor the room table below. Submitted results will appear here for review.';
    case 'tournament-complete':
      return 'All planned matches are accepted. Review the reports before publishing.';
    case 'round-ready':
      return 'All current assignments are ready for scorekeepers.';
    case 'setup':
      return firstIssue?.message ?? 'Complete the remaining setup tasks.';
    case 'round-complete':
    default:
      return 'Review the current tournament state.';
  }
}

function runPrimaryAction(
  readiness: ReturnType<typeof resolveTournamentReadiness>,
  setActiveTab: (tab: ControlPages) => void,
  setServerSettingsOpen: (open: boolean) => void,
  setRebracketOpen: (open: boolean) => void,
  releaseRound: () => void,
  onNavigateTarget?: (intent: INavigationIntent) => void,
) {
  const action = primaryOperationAction(readiness);
  if (!action) return;

  switch (action.kind) {
    case 'navigate': {
      const { target } = action;
      if (!target) break;
      if (!target.startsWith('control:')) {
        onNavigateTarget?.(action.navigation ?? createNavigationIntent(target));
        break;
      }
      if (target === 'control:live') setActiveTab(ControlPages.Live);
      else if (target === 'control:rooms') setActiveTab(ControlPages.Rooms);
      else if (target === 'control:match-plan') setActiveTab(ControlPages.MatchPlan);
      else if (target === 'control:display') setActiveTab(ControlPages.Display);
      break;
    }
    case 'start-server':
      setServerSettingsOpen(true);
      break;
    case 'open-rebracket':
      setRebracketOpen(true);
      break;
    case 'release-round':
      releaseRound();
      break;
    case 'review-results':
      setActiveTab(ControlPages.Live);
      break;
    default:
      break;
  }
}

function primaryOperationAction(readiness: ReturnType<typeof resolveTournamentReadiness>) {
  if (readiness.roomOperationsEnabled || !readiness.coreReady) return readiness.primaryAction;
  return { kind: 'navigate' as const, label: 'Set up room scoring', target: 'control:rooms' as const };
}

function PrimaryOperationPanel({
  readiness,
  onAction,
}: {
  readiness: ReturnType<typeof resolveTournamentReadiness>;
  onAction: () => void;
}) {
  const roundLabel = readiness.currentRoundNumber === null ? 'TOURNAMENT' : `ROUND ${readiness.currentRoundNumber}`;
  const action = primaryOperationAction(readiness);
  return (
    <section className="rooms-panel rooms-primary-operation" aria-labelledby="primary-operation-heading">
      <div className="rooms-panel-header">
        <div>
          <div className="rooms-eyebrow">{roundLabel}</div>
          <h2 id="primary-operation-heading">{operationTitle(readiness)}</h2>
          <p>{operationMessage(readiness)}</p>
        </div>
        {action && (
          <Button variant="contained" onClick={onAction}>
            {action.label}
          </Button>
        )}
      </div>
      {readiness.currentRoundSummary && (
        <Typography variant="caption" color="text.secondary">
          {readiness.currentRoundSummary.accepted}/{readiness.currentRoundSummary.expected} accepted ·{' '}
          {readiness.currentRoundSummary.roomsAssigned}/{readiness.currentRoundSummary.expected} rooms assigned
        </Typography>
      )}
    </section>
  );
}

function RoomMatchup({
  match,
  nextMatch,
  separator,
  showRound = false,
}: {
  // eslint-disable-next-line react/require-default-props
  match?: ScheduledMatch;
  // eslint-disable-next-line react/require-default-props
  nextMatch?: ScheduledMatch;
  separator: string;
  // eslint-disable-next-line react/require-default-props
  showRound?: boolean;
}) {
  if (match) {
    return (
      <>
        <strong>{match.leftTeamName}</strong> <span className="rooms-secondary">{separator}</span>{' '}
        <strong>{match.rightTeamName}</strong>
        {showRound && <span className="rooms-secondary">Round {match.roundNumber}</span>}
      </>
    );
  }
  if (nextMatch) {
    return (
      <>
        <span className="rooms-secondary">Next · Round {nextMatch.roundNumber}</span>
        <strong>{nextMatch.leftTeamName}</strong> <span className="rooms-secondary">{separator}</span>{' '}
        <strong>{nextMatch.rightTeamName}</strong>
        <span className="rooms-secondary">Waiting for release</span>
      </>
    );
  }
  return <span className="rooms-secondary">No active game</span>;
}

function LiveRoomTable({
  rooms,
  matches,
  service,
}: {
  rooms: TournamentRoom[];
  matches: ScheduledMatch[];
  service: TournamentServerContextValue;
}) {
  return (
    <section className="rooms-panel" aria-labelledby="live-room-table-heading">
      <div className="rooms-panel-header">
        <div>
          <h2 id="live-room-table-heading">Live rooms</h2>
          <p>What each scorekeeper needs to do right now.</p>
        </div>
      </div>
      {rooms.length === 0 ? (
        <div className="rooms-empty-state">
          Browser room scoring is not configured. Use Games for traditional manual entry, or set up room scoring to
          monitor Chromebooks here.
        </div>
      ) : (
        <div className="rooms-table-wrap">
          <table className="rooms-table">
            <thead>
              <tr>
                <th>Room</th>
                <th>Match</th>
                <th>State</th>
                <th>Progress</th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((room) => {
                const assignmentState = roomAssignmentsForRoom(
                  room,
                  matches,
                  service.releasedRoundNumber,
                  service.currentRoundNumber,
                );
                const match = assignmentState.current ?? undefined;
                const nextMatch = assignmentState.next ?? undefined;
                const session = sessionForRoom(room, service.sessions);
                const presence = roomPresenceFor(room, service);
                const state = roomState(
                  room,
                  match,
                  nextMatch,
                  session,
                  presence?.connected ?? false,
                  service.status.running,
                );
                return (
                  <tr key={room.id}>
                    <td>
                      <strong>{room.name}</strong>
                    </td>
                    <td className="rooms-matchup">
                      <RoomMatchup match={match} nextMatch={nextMatch} separator="/" />
                    </td>
                    <td>
                      <span className={`rooms-state ${state.className}`}>{state.label}</span>
                    </td>
                    <td>{sessionProgress(session, match)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AttentionList({
  service,
  rooms,
  scheduleIssues,
  nextRelease,
  releaseBlocked,
  disabledRoomAssignments,
}: {
  service: TournamentServerContextValue;
  rooms: TournamentRoom[];
  scheduleIssues: ReturnType<typeof validateSchedule>;
  nextRelease: number | null;
  releaseBlocked: boolean;
  disabledRoomAssignments: number;
}) {
  const items: JSX.Element[] = [];
  if (!service.status.running) {
    items.push(
      <li key="server">
        <strong>Tournament Server is off.</strong> Room Chromebooks cannot connect until it is started.
      </li>,
    );
  }
  service.roomPresence
    .filter(
      (presence) =>
        !presence.connected && presence.lastSeenAt !== null && (presence.msSinceLastSeen ?? 0) > staleRoomThresholdMs,
    )
    .slice(0, 5)
    .forEach((presence) => {
      const room = rooms.find((candidate) => candidate.id === presence.roomId);
      items.push(
        <li key={`room-${presence.roomId}`}>
          <strong>{room?.name ?? presence.roomId}</strong> has not checked in for {elapsed(presence.msSinceLastSeen)}.
        </li>,
      );
    });
  if (service.inbox.length > 0) {
    items.push(
      <li key="inbox">
        <strong>
          {service.inbox.length} final result{service.inbox.length === 1 ? '' : 's'}
        </strong>{' '}
        waiting for review.
      </li>,
    );
  }
  scheduleIssues
    .filter((issue) => issue.severity === ScheduleIssueSeverity.Error)
    .slice(0, 3)
    .forEach((issue) => {
      items.push(
        <li key={`issue-${issue.message}`}>
          <strong>Schedule problem.</strong> {issue.message}
        </li>,
      );
    });
  if (nextRelease !== null && releaseBlocked) {
    if (disabledRoomAssignments > 0) {
      items.push(
        <li key="disabled-room">
          <strong>Round {nextRelease} uses disabled rooms.</strong> Reassign {disabledRoomAssignments}{' '}
          {disabledRoomAssignments === 1 ? 'game' : 'games'} before releasing the round.
        </li>,
      );
    }
    items.push(
      <li key="release">
        <strong>Round {nextRelease} is not ready to release.</strong> Assign every game and resolve conflicts first.
      </li>,
    );
  }
  if (items.length === 0) return <div className="rooms-attention-empty">No operational issues right now.</div>;
  return <ul className="rooms-attention-list">{items}</ul>;
}

function AllocationPreviewDialog({
  open,
  mode,
  plan,
  tournament,
  rooms,
  onClose,
  onApply,
}: {
  open: boolean;
  mode: 'auto' | 'rebalance';
  plan: IRebalancePlan | null;
  tournament: Tournament;
  rooms: TournamentRoom[];
  onClose: () => void;
  onApply: (plan: IRebalancePlan) => void;
}) {
  if (!plan) return null;
  const matchById = new Map(tournament.scheduledMatches.map((match) => [match.id, match]));
  const roomName = (roomId?: string) =>
    roomId ? rooms.find((room) => room.id === roomId)?.name ?? roomId : 'Unassigned';
  const blocking = plan.issues.some((issue) => issue.severity === ScheduleIssueSeverity.Error);
  const previewChanges = [...plan.moved, ...plan.newlyAssigned].slice(0, 12);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{mode === 'auto' ? 'Auto-assign rooms' : 'Rebalance upcoming'}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {mode === 'auto'
            ? 'Only unassigned future games will be filled. Existing room choices are kept exactly as they are.'
            : 'Future movable rounds are previewed using the deterministic allocator. Playing, submitted, accepted, and kept games are protected.'}
        </Typography>
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5, mb: 2 }}>
          <Typography variant="body2">{plan.unchanged.length} unchanged</Typography>
          <Typography variant="body2">{plan.moved.length} moved</Typography>
          <Typography variant="body2">{plan.newlyAssigned.length} newly assigned</Typography>
          <Typography variant="body2">{plan.locked.length} kept</Typography>
          <Typography variant="body2">{plan.unableToAssign.length} unable to assign</Typography>
        </Stack>
        {previewChanges.length > 0 && (
          <Box component="ul" sx={{ pl: 2.5, mt: 0, mb: 2 }}>
            {previewChanges.map((change) => (
              <li key={change.matchId}>
                <Typography variant="body2">
                  {matchById.get(change.matchId)?.describe() ?? change.matchId} · {roomName(change.fromRoomId)} →{' '}
                  {roomName(change.toRoomId)}
                </Typography>
              </li>
            ))}
            {plan.moved.length + plan.newlyAssigned.length > previewChanges.length && (
              <Typography component="li" variant="caption" color="text.secondary">
                {plan.moved.length + plan.newlyAssigned.length - previewChanges.length} more changes
              </Typography>
            )}
          </Box>
        )}
        {plan.issues.length > 0 && (
          <Alert severity={blocking ? 'error' : 'warning'}>
            {plan.issues.slice(0, 8).map((issue) => (
              <div key={issue.message}>{issue.message}</div>
            ))}
          </Alert>
        )}
        {plan.changes.length === 0 && plan.unableToAssign.length === 0 && (
          <Alert severity="info">There are no room changes to apply.</Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={blocking || plan.changes.length === 0} onClick={() => onApply(plan)}>
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ServerSettingsDialog({
  service,
  open,
  onClose,
}: {
  service: TournamentServerContextValue;
  open: boolean;
  onClose: () => void;
}) {
  const [portText, setPortText] = useState(String(service.requestedPort));
  const [busy, setBusy] = useState(false);
  const [stopConfirmationOpen, setStopConfirmationOpen] = useState(false);
  useEffect(() => {
    if (open) setPortText(String(service.requestedPort));
  }, [open, service.requestedPort]);
  const port = Number.parseInt(portText, 10);
  const validPort = Number.isInteger(port) && port >= 1024 && port <= 65535;
  const stopServer = async () => {
    setStopConfirmationOpen(false);
    setBusy(true);
    try {
      await service.stopServer();
    } finally {
      setBusy(false);
    }
  };
  const toggle = async () => {
    if (service.status.running) {
      setStopConfirmationOpen(true);
      return;
    }

    setBusy(true);
    try {
      await service.startServer(port);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
        <DialogTitle>Tournament Server settings</DialogTitle>
        <DialogContent>
          <Typography
            variant="body2"
            sx={{
              color: 'text.secondary',
              mb: 2,
            }}
          >
            The server binds to every LAN interface on this computer. Room pages only work while it is running.
          </Typography>
          {!service.status.running && (
            <TextField
              label="Port"
              value={portText}
              onChange={(event) => {
                setPortText(event.target.value);
                const next = Number.parseInt(event.target.value, 10);
                if (Number.isInteger(next)) service.setRequestedPort(next);
              }}
              error={!validPort}
              helperText={validPort ? ' ' : 'Use a port between 1024 and 65535'}
            />
          )}
          {service.status.running && (
            <>
              <Alert severity="success" sx={{ mb: 2 }}>
                Running on port {service.status.port}. Stop the server before changing the port.
              </Alert>
              {service.networkAddresses.length > 0 && (
                <FormControl fullWidth size="small">
                  <InputLabel id="settings-network-address-label">Preferred network address</InputLabel>
                  <Select
                    labelId="settings-network-address-label"
                    label="Preferred network address"
                    value={service.selectedAddress}
                    onChange={(event) => service.setPreferredNetworkAddress(event.target.value)}
                  >
                    {service.networkAddresses.map((address) => (
                      <MenuItem key={address.url} value={address.url}>
                        {address.interfaceName}: {address.address} ({address.url})
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
            </>
          )}
          {service.lastError !== '' && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {service.lastError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Close</Button>
          <Button
            variant="contained"
            color={service.status.running ? 'error' : 'primary'}
            startIcon={service.status.running ? <Stop /> : <PlayArrow />}
            onClick={toggle}
            disabled={busy || (!service.status.running && !validPort)}
          >
            {service.status.running ? 'Stop server' : 'Start server'}
          </Button>
        </DialogActions>
      </Dialog>
      <ConfirmDialog
        open={stopConfirmationOpen}
        title="Stop the tournament server?"
        message="Room scorekeepers will be disconnected, and any active games may be interrupted. Stop the server?"
        confirmLabel="Stop server"
        destructive
        onClose={() => setStopConfirmationOpen(false)}
        onConfirm={stopServer}
      />
    </>
  );
}
