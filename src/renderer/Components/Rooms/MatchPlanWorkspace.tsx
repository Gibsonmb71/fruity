import { useMemo, useState } from 'react';
import type { DragEvent, JSX } from 'react';
import {
  Box,
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
import { roundsWithGames } from '../../Services/ScheduleService';

type MatchPlanView = 'round' | 'board';
type MatchPlanRange = 'current' | 'next' | 'all';

interface IMatchPlanWorkspaceProps {
  matches: ScheduledMatch[];
  rooms: TournamentRoom[];
  currentRoundNumber: number | null;
  onMove: (match: ScheduledMatch, roomId: string) => void;
  onEdit: (match: ScheduledMatch) => void;
  onCancel: (match: ScheduledMatch) => void;
  onToggleLock: (match: ScheduledMatch) => void;
}

interface IMatchPlanCallbacks {
  rooms: TournamentRoom[];
  onMove: (match: ScheduledMatch, roomId: string) => void;
  onEdit: (match: ScheduledMatch) => void;
  onCancel: (match: ScheduledMatch) => void;
  onToggleLock: (match: ScheduledMatch) => void;
}

export default function MatchPlanWorkspace(props: IMatchPlanWorkspaceProps) {
  const { matches, rooms, currentRoundNumber, onMove, onEdit, onCancel, onToggleLock } = props;
  const [view, setView] = useState<MatchPlanView>('round');
  const [range, setRange] = useState<MatchPlanRange>(currentRoundNumber === null ? 'all' : 'current');
  const [stage, setStage] = useState('all');
  const [round, setRound] = useState('all');

  const allRounds = useMemo(() => roundsWithGames(matches), [matches]);
  const stages = useMemo(
    () => Array.from(new Set(matches.map((match) => match.phaseCode).filter((code) => code !== ''))).sort(),
    [matches],
  );
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
    workspace = <RoomBoard matches={visibleMatches} rooms={rooms} onMove={onMove} onEdit={onEdit} />;
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
              {stages.map((stageCode) => (
                <MenuItem key={stageCode} value={stageCode}>
                  {stageCode}
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
      <Tabs
        value={view}
        onChange={(event, value: MatchPlanView) => setView(value)}
        aria-label="Match Plan views"
        sx={{ px: 1.5, minHeight: 36, borderBottom: 1, borderColor: 'divider', '& .MuiTab-root': { minHeight: 36 } }}
      >
        <Tab value="round" label="By round" />
        <Tab value="board" label="Round × room" />
      </Tabs>
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
          <Box key={roundNumber} sx={{ '& + &': { borderTop: 1, borderColor: 'divider' } }}>
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
                  <TableCell sx={{ width: 180 }}>Room</TableCell>
                  <TableCell sx={{ width: 115 }}>State</TableCell>
                  <TableCell sx={{ width: 105 }}>Keep room</TableCell>
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
    <TableRow hover>
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
  matches,
  rooms,
  onMove,
  onEdit,
}: {
  matches: ScheduledMatch[];
  rooms: TournamentRoom[];
  onMove: (match: ScheduledMatch, roomId: string) => void;
  onEdit: (match: ScheduledMatch) => void;
}) {
  const rounds = roundsWithGames(matches);
  const columns = [...rooms, { id: '__unassigned__', name: 'Unassigned', enabled: true } as TournamentRoom];

  const matchesForCell = (roundNumber: number, roomId: string) =>
    matches.filter(
      (match) =>
        match.roundNumber === roundNumber && (roomId === '__unassigned__' ? !match.roomId : match.roomId === roomId),
    );

  const dropMatch = (event: DragEvent, roomId: string) => {
    event.preventDefault();
    const matchId = event.dataTransfer.getData('text/plain');
    const match = matches.find((candidate) => candidate.id === matchId);
    if (match) onMove(match, roomId === '__unassigned__' ? '' : roomId);
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
            <TableRow key={roundNumber}>
              <TableCell sx={{ verticalAlign: 'top' }}>
                <Typography variant="subtitle2">Round {roundNumber}</Typography>
              </TableCell>
              {columns.map((room) => {
                const cellMatches = matchesForCell(roundNumber, room.id);
                return (
                  <TableCell
                    key={room.id}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => dropMatch(event, room.id)}
                    onDoubleClick={() => cellMatches[0] && onEdit(cellMatches[0])}
                    sx={{ verticalAlign: 'top', minHeight: 64, backgroundColor: 'background.paper' }}
                  >
                    <Stack sx={{ gap: 0.75 }}>
                      {cellMatches.map((match) => (
                        <BoardMatch
                          key={match.id}
                          match={match}
                          onDragStart={(event) => event.dataTransfer.setData('text/plain', match.id)}
                        />
                      ))}
                      {cellMatches.length === 0 && (
                        <Typography variant="body2" color="text.disabled">
                          —
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

function BoardMatch({ match, onDragStart }: { match: ScheduledMatch; onDragStart: (event: DragEvent) => void }) {
  const draggable = isEditable(match);
  return (
    <Box
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      sx={{
        display: 'flex',
        gap: 0.5,
        alignItems: 'flex-start',
        p: 0.75,
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        cursor: draggable ? 'grab' : 'default',
        '&:active': { cursor: draggable ? 'grabbing' : 'default' },
      }}
      title={draggable ? 'Drag to another room in this round' : 'This game cannot be moved'}
    >
      {draggable && <DragIndicator sx={{ fontSize: 16, color: 'text.disabled', mt: 0.15 }} />}
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
