import { ArrowDownward, Edit } from '@mui/icons-material';
import { Box, Button, Stack, Typography } from '@mui/material';
import { useContext, useState } from 'react';
import SchedulePickerCard from './SchedulePickerCard';
import ScheduleDetailCard from './ScheduleDetailCard';
import { TournamentContext } from '../TournamentManager';
import useSubscription from '../Utils/CustomHooks';
import { Phase } from '../DataModel/Phase';
import { YfPageHeader } from '../Utils/GeneralReactUtils';

interface ISchedulePageProps {
  // eslint-disable-next-line react/require-default-props
  showPageHeader?: boolean;
}

export default function SchedulePage({ showPageHeader = true }: ISchedulePageProps) {
  const tournManager = useContext(TournamentContext);
  const [phases] = useSubscription(tournManager.tournament.phases);
  const [changeOpen, setChangeOpen] = useState(false);

  return (
    <>
      {showPageHeader && (
        <YfPageHeader
          title="Format"
          description="Phases, pools and rounds. Start from a template or build your own."
          helpTopic="setup.format"
        />
      )}
      {phases.length === 0 ? (
        <SchedulePickerCard />
      ) : (
        <Stack spacing={2}>
          <FormatOverview phases={phases} onChange={() => setChangeOpen((current) => !current)} />
          {changeOpen && <SchedulePickerCard forceOpen onApplied={() => setChangeOpen(false)} />}
          <ScheduleDetailCard />
        </Stack>
      )}
    </>
  );
}

function FormatOverview({ phases, onChange }: { phases: Phase[]; onChange: () => void }) {
  const tournManager = useContext(TournamentContext);
  const readOnly = tournManager.tournament.hasMatchData;

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, backgroundColor: 'background.paper', p: 2 }}>
      <Stack direction="row" sx={{ alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mb: 1.5 }}>
        <Box>
          <Typography variant="h2" component="h2" sx={{ fontSize: '1.15rem' }}>
            Tournament format
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {tournManager.tournament.usingScheduleTemplate ? 'Standard format' : 'Custom format'} · {phases.length}{' '}
            stage
            {phases.length === 1 ? '' : 's'}
          </Typography>
        </Box>
        <Button size="small" variant="outlined" startIcon={<Edit />} onClick={onChange} disabled={readOnly}>
          Change
        </Button>
      </Stack>
      <Stack spacing={1.25}>
        {phases.map((phase, index) => (
          <Box key={`${phase.code}-${phase.name}`}>
            <PhaseOverview phase={phase} />
            {index < phases.length - 1 && (
              <ArrowDownward
                aria-hidden
                sx={{ display: 'block', color: 'text.disabled', fontSize: 18, ml: 1.5, mt: 0.5 }}
              />
            )}
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

function PhaseOverview({ phase }: { phase: Phase }) {
  const firstRound = phase.firstRoundNumber();
  const lastRound = phase.lastRoundNumber();
  const roundLabel = firstRound === lastRound ? `Round ${firstRound}` : `Rounds ${firstRound}–${lastRound}`;
  const poolLabel =
    phase.pools.length === 0
      ? 'Placement / tiebreaker stage'
      : phase.pools.map((pool) => `${pool.name} (${pool.size})`).join(' · ');

  return (
    <Box sx={{ borderLeft: 3, borderColor: phase.isFullPhase() ? 'primary.main' : 'divider', pl: 1.5 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        {phase.name}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {roundLabel} · {poolLabel}
      </Typography>
      {phase.pools.length > 0 && (
        <Typography variant="caption" color="text.secondary">
          {phase.pools.some((pool) => pool.roundRobins > 0) ? 'Pool play' : 'Configured advancement'}
        </Typography>
      )}
    </Box>
  );
}
