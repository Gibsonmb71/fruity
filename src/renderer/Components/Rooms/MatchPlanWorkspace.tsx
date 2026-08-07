import { useEffect, useMemo, useState } from 'react';
import type { DragEvent, JSX, KeyboardEvent } from 'react';
import {
  Box,
  Button,
  Checkbox,
  FormControl,
  IconButton,
  InputLabel,
  Menu,
  MenuItem,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import { DragIndicator, LockOpenOutlined, LockOutlined, MoreVert } from '@mui/icons-material';
import { ScheduledMatch, ScheduledMatchStatus } from '../../DataModel/ScheduledMatch';
import { TournamentRoom } from '../../DataModel/TournamentRoom';
import { Phase } from '../../DataModel/Phase';
import Tournament from '../../DataModel/Tournament';
import { roundsWithGames } from '../../Services/ScheduleService';
import { INavigationIntent } from '../../Services/Navigation';
import { planRoomDrop } from '../../Services/RoomAllocationService';
import { matchPlanStageOptions, matchesForRoomCell } from '../../Services/MatchPlanPresentation';
import { YfHelpPopover } from '../../Utils/GeneralReactUtils';

type MatchPlanView = 'round' | 'board';
type MatchPlanRange = 'current' | 'next' | 'all';

interface IMatchPlanWorkspaceProps {
  tournament: Tournament;
  phases: Phase[];
  matches: ScheduledMatch[];
  rooms: TournamentRoom[];
  currentRoundNumber: number | null;
  onMove: (match: ScheduledMatch, roomId: string) => void;
  onEdit: (match: ScheduledMatch) => void;
  onCancel: (match: ScheduledMatch) => void;
  onToggleLock: (match: ScheduledMatch) => void;
  // eslint-disable-next-line react/require-default-props
  navigation?: INavigationIntent;
  // eslint-disable-next-line react/require-default-props
  onNavigationHandled?: () => void;
  // eslint-disable-next-line react/require-default-props
  undoLabel?: string;
  // eslint-disable-next-line react/require-default-props
  onUndo?: () => void;
}

interface IMatchPlanCallbacks {
  rooms: TournamentRoom[];
  onMove: (match: ScheduledMatch, roomId: string) => void;
  onEdit: (match: ScheduledMatch) => void;
  onCancel: (match: ScheduledMatch) => void;
  onToggleLock: (match: ScheduledMatch) => void;
}

export default function MatchPlanWorkspace(props: IMatchPlanWorkspaceProps) {
  const {
    tournament,
    phases,
    matches,
    rooms,
    currentRoundNumber,
    onMove,
    onEdit,
    onCancel,
    onToggleLock,
    navigation,
    onNavigationHandled,
    undoLabel,
    onUndo,
  } = props;
  const [view, setView] = useState<MatchPlanView>('round');
  const [range, setRange] = useState<MatchPlanRange>(currentRoundNumber === null ? 'all' : 'current');
  const [stage, setStage] = useState('all');
  const [round, setRound] = useState('all');

  const allRounds = useMemo(() => roundsWithGames(matches), [matches]);
  const stageOptions = useMemo(() => matchPlanStageOptions(phases, matches), [matches, phases]);
  const activeRound =
    currentRoundNumber ??
    allRounds.find((roundNumber) => matches.some((match) => !match.isResolved() && match.roundNumber === roundNumber));
  const nextRound = activeRound === undefined ? undefined : allRounds.find((roundNumber) => roundNumber > activeRound);
  const filteredRounds = useMemo(
    () =>
      allRounds.filter(
        (roundNumber) =>
          stage === 'all' || matches.some((match) => match.phaseCode === stage && match.roundNumber === roundNumber),
      ),
    [allRounds, matches, stage],
  );
  const visibleMatches = useMemo(() => {
    const matchesInStage = matches.filter((match) => stage === 'all' || match.phaseCode === stage);
    const rangeMatches = matchesInStage.filter((match) => {
      if (range === 'current') return activeRound === undefined || match.roundNumber === activeRound;
      if (range === 'next') return nextRound === undefined || match.roundNumber === nextRound;
      return true;
    });
    return rangeMatches
      .filter((match) => round === 'all' || match.roundNumber === Number(round))
      .sort((a, b) => a.roundNumber - b.roundNumber || a.id.localeCompare(b.id));
  }, [activeRound, matches, nextRound, range, round, stage]);

  useEffect(() => {
    if (!navigation) return undefined;
    const handle = window.setTimeout(() => {
      const matchId = navigation.scheduledMatchId ?? navigation.scheduledMatchIds?.[0];
      let target: HTMLElement | null = null;
      if (matchId) {
        target = document.querySelector<HTMLElement>(`[data-match-plan-match-id="${matchId}"]`);
      } else if (navigation.roundNumber !== undefined) {
        target = document.querySelector<HTMLElement>(`[data-match-plan-round="${navigation.roundNumber}"]`);
      }
      target?.scrollIntoView({ block: 'center' });
      target?.focus({ preventScroll: true });
      onNavigationHandled?.();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [navigation, onNavigationHandled, visibleMatches.length]);

  const setStageFilter = (value: string) => {
    setStage(value);
    setRound('all');
  };

  let workspace: JSX.Element;
  if (visibleMatches.length === 0) {
    workspace = <div className="rooms-empty-state">No scheduled games match this view.</div>;
  } else if (view === 'round') {
    workspace = (
      <RoundMatchPlan
        matches={visibleMatches}
        rooms={rooms}
        onMove={onMove}
        onEdit={onEdit}
        onCancel={onCancel}
        onToggleLock={onToggleLock}
      />
    );
  } else {
    workspace = (
      <RoomBoard tournament={tournament} matches={visibleMatches} rooms={rooms} onMove={onMove} onEdit={onEdit} />
    );
  }

  return (
    <>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between', gap: 1, px: 1.5, py: 1 }}
      >
        <Tabs
          value={range}
          onChange={(event, value: MatchPlanRange) => setRange(value)}
          aria-label="Match Plan round filter"
          sx={{ minHeight: 34, '& .MuiTab-root': { minHeight: 34, py: 0.25, px: 1.25 } }}
        >
          <Tab value="current" label="Current" disabled={activeRound === undefined} />
          <Tab value="next" label="Next" disabled={nextRound === undefined} />
          <Tab value="all" label="All" />
        </Tabs>
        <Stack direction="row" sx={{ gap: 1, minWidth: 0 }}>
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>Stage</InputLabel>
            <Select label="Stage" value={stage} onChange={(event) => setStageFilter(event.target.value)}>
              <MenuItem value="all">All stages</MenuItem>
              {stageOptions.map((stageOption) => (
                <MenuItem key={stageOption.code} value={stageOption.code}>
                  {stageOption.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 125 }}>
            <InputLabel>Round</InputLabel>
            <Select label="Round" value={round} onChange={(event) => setRound(event.target.value)}>
              <MenuItem value="all">All rounds</MenuItem>
              {filteredRounds.map((roundNumber) => (
                <MenuItem key={roundNumber} value={roundNumber}>
                  Round {roundNumber}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      </Stack>
      <Stack direction="row" sx={{ alignItems: 'center', borderBottom: 1, borderColor: 'divider' }}>
        <Tabs
          value={view}
          onChange={(event, value: MatchPlanView) => setView(value)}
          aria-label="Match Plan views"
          sx={{ px: 1.5, minHeight: 36, '& .MuiTab-root': { minHeight: 36 } }}
        >
          <Tab value="round" label="By round" />
          <Tab value="board" label="Round × room" />
        </Tabs>
        {undoLabel && onUndo && (
          <Button size="small" onClick={onUndo} sx={{ ml: 'auto', mr: 1.5 }}>
            {undoLabel} · Undo
          </Button>
        )}
      </Stack>
      {workspace}
    </>
  );
}

function RoundMatchPlan({ matches, rooms, onMove, onEdit, onCancel, onToggleLock }: IMatchPlanProps) {
  const rounds = roundsWithGames(matches);
  return (
    <Box>
      {rounds.map((roundNumber) => {
        const roundMatches = matches.filter((match) => match.roundNumber === roundNumber);
        return (
          <Box
            key={roundNumber}
            data-match-plan-round={roundNumber}
            sx={{ '& + &': { borderTop: 1, borderColor: 'divider' } }}
          >
            <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', px: 1.5, py: 1 }}>
              <Typography variant="subtitle2">Round {roundNumber}</Typography>
              <Typography variant="caption" color="text.secondary">
                {roundMatches.length} {roundMatches.length === 1 ? 'match' : 'matches'}
              </Typography>
            </Box>
            <Table size="small" aria-label={`Round ${roundNumber} Match Plan`}>
              <TableHead>
                <TableRow>
                  <TableCell>Teams</TableCell>
                  <TableCell sx={{ width: 180 }}>
                    Room
                    <YfHelpPopover topic="control.room-inheritance" label="Help for how a game ends up in a room" />
                  </TableCell>
                  <TableCell sx={{ width: 115 }}>State</TableCell>
                  <TableCell sx={{ width: 105 }}>
                    Keep room
                    <YfHelpPopover topic="control.keep-room" label="Help for keeping a room assignment" />
                  </TableCell>
                  <TableCell align="right" sx={{ width: 54 }} aria-label="Actions" />
                </TableRow>
              </TableHead>
              <TableBody>
                {roundMatches.map((match) => (
                  <MatchPlanRow
                    key={match.id}
                    match={match}
                    rooms={rooms}
                    onMove={onMove}
                    onEdit={onEdit}
                    onCancel={onCancel}
                    onToggleLock={onToggleLock}
                  />
                ))}
              </TableBody>
            </Table>
          </Box>
        );
      })}
    </Box>
  );
}

type IMatchPlanProps = IMatchPlanCallbacks & { matches: ScheduledMatch[] };

function MatchPlanRow({
  match,
  rooms,
  onMove,
  onEdit,
  onCancel,
  onToggleLock,
}: IMatchPlanCallbacks & { match: ScheduledMatch }) {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const editable = isEditable(match);
  const provenance = match.roomId
    ? `${match.roomAssignmentSource === 'manual' ? 'Manual' : 'Automatic'}${
        match.roomAssignmentLocked ? ' · kept' : ''
      }`
    : 'Unassigned';
  return (
    <TableRow hover data-match-plan-match-id={match.id} tabIndex={-1}>
      <TableCell>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {match.leftTeamName}{' '}
          <Box component="span" sx={{ color: 'text.secondary' }}>
            vs
          </Box>{' '}
          {match.rightTeamName}
        </Typography>
        {match.poolName && (
          <Typography variant="caption" color="text.secondary">
            {match.poolName}
          </Typography>
        )}
      </TableCell>
      <TableCell>
        <RoomSelect match={match} rooms={rooms} onMove={onMove} />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
          {provenance}
        </Typography>
      </TableCell>
      <TableCell>
        <Typography
          variant="body2"
          color={match.status === ScheduledMatchStatus.NeedsAttention ? 'warning.main' : 'text.primary'}
        >
          {statusLabel(match.status)}
        </Typography>
      </TableCell>
      <TableCell>
        <Tooltip title="Keep this room during automatic rebalancing.">
          <span>
            <Checkbox
              size="small"
              checked={match.roomAssignmentLocked === true}
              disabled={!editable || !match.roomId}
              icon={<LockOpenOutlined fontSize="small" />}
              checkedIcon={<LockOutlined fontSize="small" />}
              onChange={() => onToggleLock(match)}
              slotProps={{ input: { 'aria-label': `Keep room for ${match.describe()}` } }}
            />
          </span>
        </Tooltip>
      </TableCell>
      <TableCell align="right">
        <IconButton
          size="small"
          aria-label={`Actions for ${match.describe()}`}
          onClick={(event) => setMenuAnchor(event.currentTarget)}
        >
          <MoreVert fontSize="small" />
        </IconButton>
        <Menu anchorEl={menuAnchor} open={menuAnchor !== null} onClose={() => setMenuAnchor(null)}>
          <MenuItem
            disabled={!editable}
            onClick={() => {
              onEdit(match);
              setMenuAnchor(null);
            }}
          >
            Edit match
          </MenuItem>
          <MenuItem
            disabled={!editable}
            onClick={() => {
              onCancel(match);
              setMenuAnchor(null);
            }}
          >
            Cancel match
          </MenuItem>
        </Menu>
      </TableCell>
    </TableRow>
  );
}

function RoomSelect({
  match,
  rooms,
  onMove,
}: {
  match: ScheduledMatch;
  rooms: TournamentRoom[];
  onMove: (match: ScheduledMatch, roomId: string) => void;
}) {
  const editable = isEditable(match);
  return (
    <FormControl size="small" fullWidth>
      <Select
        value={match.roomId ?? ''}
        onChange={(event) => onMove(match, event.target.value)}
        disabled={!editable}
        aria-label={`Room for ${match.describe()}`}
        displayEmpty
        sx={{ minHeight: 32, fontSize: '0.8125rem' }}
      >
        <MenuItem value="">
          <em>Unassigned</em>
        </MenuItem>
        {rooms.map((room) => (
          <MenuItem key={room.id} value={room.id} disabled={!room.enabled}>
            {room.name}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

function RoomBoard({
  tournament,
  matches,
  rooms,
  onMove,
  onEdit,
}: {
  tournament: Tournament;
  matches: ScheduledMatch[];
  rooms: TournamentRoom[];
  onMove: (match: ScheduledMatch, roomId: string) => void;
  onEdit: (match: ScheduledMatch) => void;
}) {
  const [draggedMatchId, setDraggedMatchId] = useState<string | null>(null);
  const [hoveredDestination, setHoveredDestination] = useState<string | null>(null);
  const rounds = roundsWithGames(matches);
  const columns = [...rooms, { id: '__unassigned__', name: 'Unassigned', enabled: true } as TournamentRoom];

  const destinationFor = (roomId: string, roundNumber: number) => {
    if (!draggedMatchId) return { state: 'idle' as const, message: '' };
    return planRoomDrop(tournament, draggedMatchId, roomId === '__unassigned__' ? undefined : roomId, roundNumber);
  };

  const allowDragOver = (event: DragEvent, roundNumber: number, roomId: string) => {
    const destination = destinationFor(roomId, roundNumber);
    setHoveredDestination(`${roundNumber}:${roomId}`);
    event.dataTransfer.dropEffect =
      destination.state === 'valid-empty' || destination.state === 'valid-swap' ? 'move' : 'none';
    event.preventDefault();
  };

  const dropMatch = (event: DragEvent, roomId: string) => {
    event.preventDefault();
    const matchId = event.dataTransfer.getData('text/plain');
    const match = matches.find((candidate) => candidate.id === matchId);
    if (!match) return;
    const destination = planRoomDrop(
      tournament,
      match.id,
      roomId === '__unassigned__' ? undefined : roomId,
      match.roundNumber,
    );
    if (destination.state !== 'valid-empty' && destination.state !== 'valid-swap') return;
    onMove(match, roomId === '__unassigned__' ? '' : roomId);
    setDraggedMatchId(null);
    setHoveredDestination(null);
  };

  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small" aria-label="Round by room Match Plan">
        <TableHead>
          <TableRow>
            <TableCell sx={{ minWidth: 90 }}>Round</TableCell>
            {columns.map((room) => (
              <TableCell key={room.id} sx={{ minWidth: 190 }}>
                {room.name}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rounds.map((roundNumber) => (
            <TableRow key={roundNumber} data-match-plan-round={roundNumber}>
              <TableCell sx={{ verticalAlign: 'top' }}>
                <Typography variant="subtitle2">Round {roundNumber}</Typography>
              </TableCell>
              {columns.map((room) => {
                const cellMatches = matchesForRoomCell(matches, roundNumber, room.id);
                const destination = destinationFor(room.id, roundNumber);
                const destinationKey = `${roundNumber}:${room.id}`;
                const highlighted = hoveredDestination === destinationKey;
                return (
                  <TableCell
                    key={room.id}
                    onDragOver={(event) => allowDragOver(event, roundNumber, room.id)}
                    onDragLeave={() => setHoveredDestination(null)}
                    onDrop={(event) => dropMatch(event, room.id)}
                    data-drop-state={destination.state}
                    aria-label={`${room.name}, round ${roundNumber}${
                      destination.state !== 'idle' ? `, ${destination.message}` : ''
                    }`}
                    sx={{
                      verticalAlign: 'top',
                      minHeight: 64,
                      backgroundColor: highlighted ? 'action.selected' : 'background.paper',
                      outline: highlighted ? 1 : undefined,
                      outlineColor:
                        destination.state === 'invalid' || destination.state === 'protected'
                          ? 'warning.main'
                          : 'primary.main',
                    }}
                  >
                    <Stack sx={{ gap: 0.75 }}>
                      {cellMatches.map((match) => (
                        <BoardMatch
                          key={match.id}
                          match={match}
                          onEdit={onEdit}
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData('text/plain', match.id);
                            setDraggedMatchId(match.id);
                          }}
                          onDragEnd={() => {
                            setDraggedMatchId(null);
                            setHoveredDestination(null);
                          }}
                        />
                      ))}
                      {cellMatches.length === 0 && (
                        <Typography variant="body2" color="text.disabled">
                          —
                        </Typography>
                      )}
                      {highlighted && destination.state !== 'idle' && (
                        <Typography
                          variant="caption"
                          color={
                            destination.state === 'invalid' || destination.state === 'protected'
                              ? 'warning.main'
                              : 'primary.main'
                          }
                        >
                          {destination.message}
                        </Typography>
                      )}
                    </Stack>
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

function BoardMatch({
  match,
  onEdit,
  onDragStart,
  onDragEnd,
}: {
  match: ScheduledMatch;
  onEdit: (match: ScheduledMatch) => void;
  onDragStart: (event: DragEvent) => void;
  onDragEnd: () => void;
}) {
  const draggable = isEditable(match) && !match.roomAssignmentLocked;
  const activate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onEdit(match);
    }
  };
  return (
    <Box
      role="button"
      tabIndex={0}
      data-match-plan-match-id={match.id}
      draggable={draggable}
      onClick={() => onEdit(match)}
      onKeyDown={activate}
      onDragStart={draggable ? onDragStart : undefined}
      onDragEnd={onDragEnd}
      aria-label={`Edit ${match.describe()}${match.roomAssignmentLocked ? ', room kept' : ''}`}
      sx={{
        display: 'flex',
        gap: 0.5,
        alignItems: 'flex-start',
        p: 0.75,
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        cursor: draggable ? 'grab' : 'pointer',
        '&:hover, &:focus-visible': { borderColor: 'primary.main', backgroundColor: 'action.hover', outline: 'none' },
        '&:active': { cursor: draggable ? 'grabbing' : 'pointer' },
      }}
      title={
        draggable
          ? 'Drag to another room in this round, or select to edit'
          : 'Select to edit; this game cannot be moved'
      }
    >
      {draggable && <DragIndicator sx={{ fontSize: 16, color: 'text.disabled', mt: 0.15 }} aria-hidden />}
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 500, lineHeight: 1.25 }}>
          {match.leftTeamName} / {match.rightTeamName}
        </Typography>
        <Typography
          variant="caption"
          color={match.status === ScheduledMatchStatus.NeedsAttention ? 'warning.main' : 'text.secondary'}
        >
          {statusLabel(match.status)}
          {match.roomAssignmentLocked ? ' · kept' : ''}
        </Typography>
      </Box>
    </Box>
  );
}

function isEditable(match: ScheduledMatch) {
  return (
    match.status === ScheduledMatchStatus.Scheduled ||
    match.status === ScheduledMatchStatus.Ready ||
    match.status === ScheduledMatchStatus.NeedsAttention
  );
}

function statusLabel(status: ScheduledMatchStatus) {
  switch (status) {
    case ScheduledMatchStatus.Playing:
      return 'Playing';
    case ScheduledMatchStatus.Submitted:
      return 'Submitted';
    case ScheduledMatchStatus.Accepted:
      return 'Accepted';
    case ScheduledMatchStatus.NeedsAttention:
      return 'Needs attention';
    case ScheduledMatchStatus.Cancelled:
      return 'Cancelled';
    case ScheduledMatchStatus.Ready:
      return 'Ready';
    case ScheduledMatchStatus.Scheduled:
    default:
      return 'Scheduled';
  }
}
