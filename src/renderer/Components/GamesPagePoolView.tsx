import { IconButton, Stack, Table, TableBody, TableCell, TableHead, TableRow, Tooltip } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { useContext, useMemo } from 'react';
import Grid from '@mui/material/Grid';
import { Add, Edit, JoinRight } from '@mui/icons-material';
import { TournamentContext } from '../TournamentManager';
import YfCard from './YfCard';
import YfTablePanel from './YfTablePanel';
import { YfEmptyState } from '../Utils/GeneralReactUtils';
import { Phase } from '../DataModel/Phase';
import { Pool } from '../DataModel/Pool';
import { Team } from '../DataModel/Team';

export default function GamesViewByPool({ needsReview = false }: { needsReview?: boolean }) {
  const tournManager = useContext(TournamentContext);
  const phases = tournManager.tournament.getFullPhases();

  return (
    <Stack spacing={2}>
      {phases.map((phase) => (
        <GamesForPhaseByPool key={phase.name} phase={phase} needsReview={needsReview} />
      ))}
    </Stack>
  );
}

interface IGamesForPhaseByPoolProps {
  phase: Phase;
  needsReview: boolean;
}

function GamesForPhaseByPool(props: IGamesForPhaseByPoolProps) {
  const { phase, needsReview } = props;

  return (
    <YfCard title={phase.name}>
      <Grid container spacing={2}>
        {phase.pools.map((pool) => poolMatrixSeries(phase, pool, needsReview))}
      </Grid>
    </YfCard>
  );
}

function poolMatrixSeries(phase: Phase, pool: Pool, needsReview: boolean) {
  const matrices = [];

  if (pool.roundRobins < 1) {
    return <NullMatrix key={`${phase.name}%${pool.name}`} message={`${pool.name}: Not a round robin pool`} />;
  }
  if (pool.poolTeams.length === 0) {
    return <NullMatrix key={`${phase.name}%${pool.name}`} message={`${pool.name}: No teams are assigned`} />;
  }

  for (let i = 1; i <= pool.roundRobins; i++) {
    matrices.push(<PoolMatrix key={`${pool.name}_${i}`} phase={phase} pool={pool} nthRoundRobin={i} needsReview={needsReview} />);
  }
  return matrices;
}

interface INullMatrixProps {
  message: string;
}

function NullMatrix(props: INullMatrixProps) {
  const { message } = props;

  return (
    <Grid size={{ xs: 12 }}>
      <YfEmptyState title={message} compact />
    </Grid>
  );
}

interface IPoolMatrixProps {
  phase: Phase;
  pool: Pool;
  nthRoundRobin: number;
  needsReview: boolean;
}

function PoolMatrix(props: IPoolMatrixProps) {
  const { pool, phase, nthRoundRobin, needsReview } = props;

  if (pool.poolTeams.length === 0) return null;

  return (
    <Grid size={{ xs: 12 }}>
      <YfTablePanel>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{getMatrixTitle(pool, nthRoundRobin)}</TableCell>
              {pool.poolTeams.map((pt) => (
                <TableCell key={`header-${pt.team.name}`} align="center">
                  {pt.team.getTruncatedName()}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {pool.poolTeams.map((pt) => (
              <TableRow key={`row-${pt.team.name}`}>
                <TableCell>{pt.team.getTruncatedName()}</TableCell>
                {pool.poolTeams.map((opponent) => (
                  <MatrixCell
                    key={`versus-${opponent.team.name}`}
                    team={pt.team}
                    opponent={opponent.team}
                    phase={phase}
                    nthRoundRobin={nthRoundRobin}
                    needsReview={needsReview}
                  />
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </YfTablePanel>
    </Grid>
  );
}

function getMatrixTitle(pool: Pool, nthRoundRobin: number) {
  if (nthRoundRobin === 1) return pool.name;
  if (pool.name.toLocaleLowerCase().includes('round robin')) return `Round Robin ${nthRoundRobin}`;
  return `${pool.name}: Round Robin ${nthRoundRobin}`;
}

interface IMatrixCellProps {
  team: Team;
  opponent: Team;
  phase: Phase;
  nthRoundRobin: number;
  needsReview: boolean;
}

function MatrixCell(props: IMatrixCellProps) {
  const { team, opponent, phase, nthRoundRobin, needsReview } = props;
  const tournManager = useContext(TournamentContext);
  const theme = useTheme();
  const successColor = theme.vars?.palette.success.main ?? theme.palette.success.main;
  const errorColor = theme.vars?.palette.error.main ?? theme.palette.error.main;
  const canAddMatch = useMemo(() => tournManager.tournament.readyToAddMatches(), [tournManager]);

  if (team === opponent) {
    return <TableCell sx={{ backgroundColor: 'action.disabledBackground' }} />;
  }
  const match = tournManager.tournament.findMatchBetweenTeams(team, opponent, phase, nthRoundRobin);
  const reviewMatch = match && (match.getErrorMessages().length > 0 || match.getWarningMessages().length > 0);
  if (needsReview && !reviewMatch) return <TableCell align="center" />;
  if (!match) {
    return (
      <TableCell align="center">
        {canAddMatch && (
          <IconButton size="small" onClick={() => tournManager.openMatchModalNewMatchForTeams(team, opponent)}>
            <Add />
          </IconButton>
        )}
      </TableCell>
    );
  }

  const isCarryover = match.carryoverPhases.length > 0;

  const editExisting = () => {
    const round = isCarryover ? tournManager.tournament.getRoundOfMatch(match) : phase.getRoundOfMatch(match);
    if (!round) return;
    tournManager.openMatchEditModalExistingMatch(match, round);
  };
  const resultDisp = match.getShortScore(team);
  let backgroundColor = '';
  if (resultDisp.startsWith('W')) backgroundColor = alpha(successColor, 0.12);
  else if (resultDisp.startsWith('L')) backgroundColor = alpha(errorColor, 0.12);

  return (
    <TableCell align="center" sx={{ backgroundColor }}>
      {resultDisp}
      <IconButton
        size="small"
        aria-label={`Edit match between ${team.name} and ${opponent.name}`}
        onClick={editExisting}
      >
        <Edit />
      </IconButton>
      {isCarryover && (
        <Tooltip title="Carryover" placement="right">
          <JoinRight color="secondary" aria-label="Carryover" sx={{ verticalAlign: 'text-bottom', ml: 0.5 }} />
        </Tooltip>
      )}
    </TableCell>
  );
}
