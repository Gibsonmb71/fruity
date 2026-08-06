import { useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  FormControl,
  MenuItem,
  Select,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from '@mui/material';
import { ScheduledMatch, ScheduledMatchStatus } from '../../DataModel/ScheduledMatch';
import { TournamentRoom } from '../../DataModel/TournamentRoom';
import { roundsWithGames } from '../../Services/ScheduleService';

type MatchPlanView = 'round' | 'board';

interface IMatchPlanWorkspaceProps {
  matches: ScheduledMatch[];
  rooms: TournamentRoom[];
  onRoomChange: (match: ScheduledMatch, roomId: string) => void;
  onEdit: (match: ScheduledMatch) => void;
  onCancel: (match: ScheduledMatch) => void;
  onToggleLock: (match: ScheduledMatch) => void;
}

interface IMatchPlanCallbacks {
  rooms: TournamentRoom[];
  onRoomChange: (match: ScheduledMatch, roomId: string) => void;
  onEdit: (match: ScheduledMatch) => void;
  onCancel: (match: ScheduledMatch) => void;
  onToggleLock: (match: ScheduledMatch) => void;
}

export default function MatchPlanWorkspace(props: IMatchPlanWorkspaceProps) {
  const { matches, rooms, onRoomChange, onEdit, onCancel, onToggleLock } = props;
  const [view, setView] = useState<MatchPlanView>('round');
  return (
    <>
      <Tabs
        value={view}
        onChange={(event, value: MatchPlanView) => setView(value)}
        aria-label="Match Plan views"
        sx={{ px: 1.5, minHeight: 36, borderBottom: 1, borderColor: 'divider', '& .MuiTab-root': { minHeight: 36 } }}
      >
        <Tab value="round" label="By round" />
        <Tab value="board" label="Round × room" />
      </Tabs>
      {view === 'round' ? (
        <RoundMatchPlan
          matches={matches}
          rooms={rooms}
          onRoomChange={onRoomChange}
          onEdit={onEdit}
          onCancel={onCancel}
          onToggleLock={onToggleLock}
        />
      ) : (
        <RoomBoard matches={matches} rooms={rooms} onEdit={onEdit} />
      )}
    </>
  );
}

function RoundMatchPlan({ matches, rooms, onRoomChange, onEdit, onCancel, onToggleLock }: IMatchPlanWorkspaceProps) {
  const rounds = roundsWithGames(matches);
  if (rounds.length === 0) {
    return <div className="rooms-empty-state">No concrete matches yet. Generate or add the first round.</div>;
  }

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
                  <TableCell sx={{ width: 110 }}>State</TableCell>
                  <TableCell sx={{ width: 72 }}>Lock</TableCell>
                  <TableCell align="right" sx={{ width: 150 }}>
                    Actions
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {roundMatches.map((match) => (
                  <MatchPlanRow
                    key={match.id}
                    match={match}
                    rooms={rooms}
                    onRoomChange={onRoomChange}
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

function MatchPlanRow({
  match,
  rooms,
  onRoomChange,
  onEdit,
  onCancel,
  onToggleLock,
}: IMatchPlanCallbacks & { match: ScheduledMatch }) {
  const editable = isEditable(match);
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
        <RoomSelect match={match} rooms={rooms} onRoomChange={onRoomChange} />
      </TableCell>
      <TableCell>
        <Typography
          variant="caption"
          color={match.status === ScheduledMatchStatus.NeedsAttention ? 'warning.main' : 'text.secondary'}
        >
          {statusLabel(match.status)}
        </Typography>
      </TableCell>
      <TableCell>
        <Checkbox
          size="small"
          checked={match.roomAssignmentLocked === true}
          disabled={!editable || !match.roomId}
          onChange={() => onToggleLock(match)}
          aria-label={`Lock room for ${match.describe()}`}
        />
      </TableCell>
      <TableCell align="right">
        <Button size="small" onClick={() => onEdit(match)} disabled={!editable}>
          Edit
        </Button>
        <Button size="small" color="error" onClick={() => onCancel(match)} disabled={!editable}>
          Cancel
        </Button>
      </TableCell>
    </TableRow>
  );
}

function RoomSelect({
  match,
  rooms,
  onRoomChange,
}: {
  match: ScheduledMatch;
  rooms: TournamentRoom[];
  onRoomChange: (match: ScheduledMatch, roomId: string) => void;
}) {
  const editable = isEditable(match);
  return (
    <FormControl size="small" fullWidth>
      <Select
        value={match.roomId ?? ''}
        onChange={(event) => onRoomChange(match, event.target.value)}
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
  onEdit,
}: {
  matches: ScheduledMatch[];
  rooms: TournamentRoom[];
  onEdit: (match: ScheduledMatch) => void;
}) {
  const rounds = roundsWithGames(matches);
  const hasUnassigned = matches.some((match) => !match.roomId);
  const columns = hasUnassigned ? [...rooms, new TournamentRoom('Unassigned', rooms.length, '__unassigned__')] : rooms;
  if (rounds.length === 0) {
    return <div className="rooms-empty-state">No concrete matches yet. Generate or add the first round.</div>;
  }

  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small" aria-label="Round by room Match Plan">
        <TableHead>
          <TableRow>
            <TableCell sx={{ minWidth: 90 }}>Round</TableCell>
            {columns.map((room) => (
              <TableCell key={room.id} sx={{ minWidth: 180 }}>
                {room.name}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rounds.map((roundNumber) => (
            <TableRow key={roundNumber}>
              <TableCell>
                <Typography variant="subtitle2">Round {roundNumber}</Typography>
              </TableCell>
              {columns.map((room) => {
                const match = matches.find(
                  (candidate) =>
                    candidate.roundNumber === roundNumber &&
                    (room.id === '__unassigned__' ? !candidate.roomId : candidate.roomId === room.id),
                );
                return (
                  <TableCell key={room.id} onDoubleClick={() => match && onEdit(match)} sx={{ verticalAlign: 'top' }}>
                    {match ? (
                      <>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {match.leftTeamName} / {match.rightTeamName}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {statusLabel(match.status)}
                          {match.roomAssignmentLocked ? ' · locked' : ''}
                        </Typography>
                      </>
                    ) : (
                      <Typography variant="body2" color="text.disabled">
                        —
                      </Typography>
                    )}
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
