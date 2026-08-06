/* eslint-disable react/require-default-props */
import { useContext, useState } from 'react';
import type { DragEvent } from 'react';
import {
  Box,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
  Menu,
  MenuItem,
} from '@mui/material';
import { DragIndicator, MoreVert } from '@mui/icons-material';
import { MatchEditModalContext } from '../Modal Managers/TempMatchManager';
import { TournamentContext } from '../TournamentManager';
import { LeftOrRight } from '../Utils/UtilTypes';
import { MatchPlayer } from '../DataModel/MatchPlayer';
import { PlayerAnswerCount } from '../DataModel/PlayerAnswerCount';
import { ValidationStatuses } from '../DataModel/Interfaces';
import useSubscription from '../Utils/CustomHooks';
import { YfCssClasses, YfNumericField } from '../Utils/GeneralReactUtils';

interface IMatchPlayerStatsTableProps {
  whichTeam: LeftOrRight;
}

export default function MatchPlayerStatsTable(props: IMatchPlayerStatsTableProps) {
  const { whichTeam } = props;
  const modalManager = useContext(MatchEditModalContext);
  const { tournament } = useContext(TournamentContext);
  const matchTeam = modalManager.tempMatch.getMatchTeam(whichTeam);
  const isForfeit = modalManager.tempMatch.isForfeit();

  if (isForfeit) {
    const otherTeam = whichTeam === 'left' ? 'right' : 'left';
    const otherTeamForfeited = modalManager.tempMatch.getMatchTeam(otherTeam).forfeitLoss;
    let text = 'Wins by forfeit';
    if (matchTeam.forfeitLoss) text = otherTeamForfeited ? 'Not played — both teams forfeited' : 'Loses by forfeit';
    return (
      <Paper
        variant="outlined"
        role="status"
        sx={{ px: 1.5, py: 1.25, color: matchTeam.forfeitLoss ? 'text.secondary' : 'success.main' }}
      >
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {text}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Player statistics are not entered for a forfeit.
        </Typography>
      </Paper>
    );
  }

  if (!matchTeam.team) {
    return (
      <Box sx={{ px: 1.5, py: 1.5, color: 'text.secondary' }}>
        <Typography variant="body2">Select a team to enter player statistics.</Typography>
      </Box>
    );
  }

  const { answerTypes } = tournament.scoringRules;
  const dragKey = `match-player-row-${whichTeam}`;

  return (
    <TableContainer component={Box} sx={{ overflowX: 'auto' }}>
      <Table
        size="small"
        aria-label={`${whichTeam === 'left' ? 'Team A' : 'Team B'} player statistics`}
        sx={{ minWidth: Math.max(420, 250 + (answerTypes.length + 2) * 62) }}
      >
        <TableHead>
          <TableRow>
            <TableCell sx={{ minWidth: 160 }}>Player</TableCell>
            <TableCell align="right" sx={{ width: 58 }}>
              TUH
            </TableCell>
            {answerTypes.map((answerType) => (
              <TableCell key={answerType.id} align="right" sx={{ width: 58 }} title={answerType.label}>
                {answerType.shortLabel}
              </TableCell>
            ))}
            <TableCell align="right" sx={{ width: 64 }}>
              Pts
            </TableCell>
            <TableCell sx={{ width: 42 }} aria-label="Player reorder actions" />
          </TableRow>
        </TableHead>
        <TableBody>
          {matchTeam.matchPlayers.map((matchPlayer, rowNumber) => (
            <PlayerRow
              key={`${whichTeam}-${matchPlayer.player.name}`}
              matchPlayer={matchPlayer}
              whichTeam={whichTeam}
              rowNumber={rowNumber}
              dragKey={dragKey}
            />
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

interface IPlayerRowProps {
  matchPlayer: MatchPlayer;
  whichTeam: LeftOrRight;
  rowNumber: number;
  dragKey: string;
}

function PlayerRow(props: IPlayerRowProps) {
  const { matchPlayer, whichTeam, rowNumber, dragKey } = props;
  const modalManager = useContext(MatchEditModalContext);
  const playerName = matchPlayer.player.name;
  const isFirst = rowNumber === 0;
  const isLast = rowNumber === modalManager.tempMatch.getMatchTeam(whichTeam).matchPlayers.length - 1;
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const closeMenu = () => setMenuAnchor(null);

  const handleDrop = (event: DragEvent<HTMLTableRowElement>) => {
    event.preventDefault();
    modalManager.reorderMatchPlayers(whichTeam, event.dataTransfer.getData(dragKey), rowNumber);
  };

  return (
    <TableRow
      hover
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
      sx={{ '&:last-child td, &:last-child th': { borderBottom: 0 } }}
    >
      <TableCell component="th" scope="row" sx={{ maxWidth: 220 }}>
        <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center', minWidth: 0 }}>
          <Tooltip title="Drag to reorder">
            <IconButton
              className={YfCssClasses.Draggable}
              size="small"
              draggable
              tabIndex={-1}
              aria-label={`Drag ${playerName} to reorder`}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData(dragKey, rowNumber.toString());
              }}
            >
              <DragIndicator fontSize="small" />
            </IconButton>
          </Tooltip>
          <Typography variant="body2" noWrap title={playerName}>
            {playerName}
          </Typography>
        </Stack>
      </TableCell>
      <TableCell align="right">
        <PlayerNumericField
          id={`match-${whichTeam}-player-${rowNumber}-tuh`}
          ariaLabel={`${playerName} tossups heard`}
          value={matchPlayer.tossupsHeard}
          error={matchPlayer.tuhValidation.status === ValidationStatuses.Error}
          errorMessage={matchPlayer.tuhValidation.message}
          onCommit={(value) => modalManager.setPlayerTuh(matchPlayer, value)}
          min={0}
        />
      </TableCell>
      {matchPlayer.answerCounts.map((answerCount) => (
        <TableCell align="right" key={answerCount.answerType.id}>
          <PlayerAnswerCountField
            answerCount={answerCount}
            id={`match-${whichTeam}-player-${rowNumber}-answer-${answerCount.answerType.value}`}
            playerName={playerName}
          />
        </TableCell>
      ))}
      <TableCell align="right">
        <Typography
          component="span"
          variant="body2"
          sx={{ display: 'inline-block', minWidth: '5ch', textAlign: 'right', fontWeight: 600 }}
          aria-label={`${playerName} calculated points`}
        >
          {matchPlayer.points}
        </Typography>
      </TableCell>
      <TableCell>
        <Tooltip title={`Reorder ${playerName}`}>
          <IconButton
            size="small"
            aria-label={`Reorder ${playerName}`}
            aria-haspopup="menu"
            onClick={(event) => setMenuAnchor(event.currentTarget)}
          >
            <MoreVert fontSize="inherit" />
          </IconButton>
        </Tooltip>
        <Menu anchorEl={menuAnchor} open={menuAnchor !== null} onClose={closeMenu}>
          <MenuItem
            disabled={isFirst}
            onClick={() => {
              modalManager.moveMatchPlayer(whichTeam, rowNumber, 'up');
              closeMenu();
            }}
          >
            Move up
          </MenuItem>
          <MenuItem
            disabled={isLast}
            onClick={() => {
              modalManager.moveMatchPlayer(whichTeam, rowNumber, 'down');
              closeMenu();
            }}
          >
            Move down
          </MenuItem>
        </Menu>
      </TableCell>
    </TableRow>
  );
}

interface IPlayerNumericFieldProps {
  id: string;
  ariaLabel: string;
  value?: number;
  error?: boolean;
  errorMessage?: string;
  min?: number;
  onCommit: (value: string) => number | undefined;
}

function PlayerNumericField(props: IPlayerNumericFieldProps) {
  const { id, ariaLabel, value, error, errorMessage, min, onCommit } = props;
  const [current, setCurrent] = useSubscription(value?.toString() || '');
  const errorDescriptionId = `${id}-error`;

  const commit = () => {
    const normalized = onCommit(current);
    setCurrent(normalized?.toString() || '');
  };

  return (
    <>
      <YfNumericField
        id={id}
        variant="standard"
        hiddenLabel
        value={current}
        error={error}
        slotProps={{
          htmlInput: {
            min,
            inputMode: 'numeric',
            'aria-label': ariaLabel,
            'aria-invalid': error || undefined,
            'aria-describedby': error ? errorDescriptionId : undefined,
          },
        }}
        sx={{
          width: '6ch',
          '& .MuiInputBase-input': { px: 0.25, textAlign: 'right' },
        }}
        onChange={(event) => setCurrent(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
      />
      {error && (
        <Box component="span" id={errorDescriptionId} sx={visuallyHiddenSx}>
          {errorMessage}
        </Box>
      )}
    </>
  );
}

interface IPlayerAnswerCountFieldProps {
  answerCount: PlayerAnswerCount;
  id: string;
  playerName: string;
}

function PlayerAnswerCountField(props: IPlayerAnswerCountFieldProps) {
  const { answerCount, id, playerName } = props;
  const modalManager = useContext(MatchEditModalContext);
  const [current, setCurrent] = useSubscription(answerCount.number?.toString() || '');
  const invalid = answerCount.validation.status === ValidationStatuses.Error;
  const errorDescriptionId = `${id}-error`;

  const commit = () => {
    const normalized = modalManager.setAnswerCount(answerCount, current);
    setCurrent(normalized?.toString() || '');
  };

  return (
    <>
      <YfNumericField
        id={id}
        variant="standard"
        hiddenLabel
        value={current}
        error={invalid}
        slotProps={{
          htmlInput: {
            min: 0,
            inputMode: 'numeric',
            'aria-label': `${playerName} ${answerCount.answerType.label} answers`,
            'aria-invalid': invalid || undefined,
            'aria-describedby': invalid ? errorDescriptionId : undefined,
          },
        }}
        sx={{
          width: '6ch',
          '& .MuiInputBase-input': { px: 0.25, textAlign: 'right' },
        }}
        onChange={(event) => setCurrent(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
      />
      {invalid && (
        <Box component="span" id={errorDescriptionId} sx={visuallyHiddenSx}>
          {answerCount.validation.message}
        </Box>
      )}
    </>
  );
}

const visuallyHiddenSx = {
  border: 0,
  clip: 'rect(0 0 0 0)',
  height: 1,
  margin: -1,
  overflow: 'hidden',
  padding: 0,
  position: 'absolute' as const,
  whiteSpace: 'nowrap' as const,
  width: 1,
};
