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
import type { GamesReviewFilter } from '../Services/Navigation';

export default function GamesViewByPool({
  reviewFilter = 'all',
}: {
  // eslint-disable-next-line react/require-default-props
  reviewFilter?: GamesReviewFilter;
}) {
  const tournManager = useContext(TournamentContext);
  const phases = tournManager.tournament.getFullPhases();

  return (
    <Stack spacing={2}>
      {phases.map((phase) => (
        <GamesForPhaseByPool key={phase.name} phase={phase} reviewFilter={reviewFilter} />
      ))}
    </Stack>
  );
}

interface IGamesForPhaseByPoolProps {
  phase: Phase;
  reviewFilter: GamesReviewFilter;
}

function GamesForPhaseByPool(props: IGamesForPhaseByPoolProps) {
  const { phase, reviewFilter } = props;

  return (
    <YfCard title={phase.name}>
      <Grid container spacing={2}>
        {phase.pools.map((pool) => poolMatrixSeries(phase, pool, reviewFilter))}
      </Grid>
    </YfCard>
  );
}

function poolMatrixSeries(phase: Phase, pool: Pool, reviewFilter: GamesReviewFilter) {
  const matrices = [];

  if (pool.roundRobins < 1) {
    return <NullMatrix key={`${phase.name}%${pool.name}`} message={`${pool.name}: Not a round robin pool`} />;
  }
  if (pool.poolTeams.length === 0) {
    return <NullMatrix key={`${phase.name}%${pool.name}`} message={`${pool.name}: No teams are assigned`} />;
  }

  for (let i = 1; i <= pool.roundRobins; i++) {
    matrices.push(
      <PoolMatrix key={`${pool.name}_${i}`} phase={phase} pool={pool} nthRoundRobin={i} reviewFilter={reviewFilter} />,
    );
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
  reviewFilter: GamesReviewFilter;
}

function PoolMatrix(props: IPoolMatrixProps) {
  const { pool, phase, nthRoundRobin, reviewFilter } = props;

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
                    reviewFilter={reviewFilter}
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
  reviewFilter: GamesReviewFilter;
}

function MatrixCell(props: IMatrixCellProps) {
  const { team, opponent, phase, nthRoundRobin, reviewFilter } = props;
  const tournManager = useContext(TournamentContext);
  const theme = useTheme();
  const successColor = theme.vars?.palette.success.main ?? theme.palette.success.main;
  const errorColor = theme.vars?.palette.error.main ?? theme.palette.error.main;
  const canAddMatch = useMemo(() => tournManager.tournament.readyToAddMatches(), [tournManager]);

  if (team === opponent) {
    return <TableCell sx={{ backgroundColor: 'action.disabledBackground' }} />;
  }
  const match = tournManager.tournament.findMatchBetweenTeams(team, opponent, phase, nthRoundRobin);
  const hasErrors = match ? match.getErrorMessages().length > 0 : false;
  const hasWarnings = match ? match.getWarningMessages().length > 0 : false;
  const reviewMatch = hasErrors || hasWarnings;
  const matchesFilter =
    reviewFilter === 'all' ||
    (reviewFilter === 'needs-review' && reviewMatch) ||
    (reviewFilter === 'errors' && hasErrors) ||
    (reviewFilter === 'warnings' && hasWarnings);
  if (!matchesFilter) return <TableCell align="center" />;
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
