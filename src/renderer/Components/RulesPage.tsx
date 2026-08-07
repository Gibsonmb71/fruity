import { Accordion, AccordionDetails, AccordionSummary, Box, Typography } from '@mui/material';
import Grid from '@mui/material/Grid';
import { ExpandMore, Lock } from '@mui/icons-material';
import { useContext } from 'react';
import StandardRuleSetCard from './StandardRuleSetCard';
import TossupSettingsCard from './TossupSettingsCard';
import BonusSettingsCard from './BonusSettingsCard';
import MaxPlayersSettingsCard from './MaxPlayerSettingsCard';
import OvertimeSettingsCard from './OvertimeSettingsCard';
import RoundLengthSettingsCard from './RoundLengthSettingsCard';
import LightningRoundSettingsCard from './LightningRoundSettingsCard';
import { TournamentContext } from '../TournamentManager';
import useSubscription from '../Utils/CustomHooks';
import { YfNotice, YfPageHeader } from '../Utils/GeneralReactUtils';

interface IRulesPageProps {
  // eslint-disable-next-line react/require-default-props
  showPageHeader?: boolean;
}

function RulesPage({ showPageHeader = true }: IRulesPageProps) {
  const tournManager = useContext(TournamentContext);
  const [readOnly] = useSubscription(tournManager.tournament.hasMatchData);

  return (
    <>
      {showPageHeader && (
        <YfPageHeader
          title="Rules"
          description="How games are scored. Start from a standard rule set, then adjust whatever differs."
          helpTopic="setup.rules"
        />
      )}
      {readOnly && (
        <Box sx={{ mb: 2 }}>
          <YfNotice
            icon={<Lock fontSize="small" />}
            title="Scoring rules are locked"
            description="Games have already been entered. Changing how games are scored now would quietly invalidate
              them, so these settings unlock again only if every game is deleted."
          />
        </Box>
      )}
      <StandardRuleSetCard />
      <Accordion
        disableGutters
        sx={{ mt: 2, border: 1, borderColor: 'divider', borderRadius: 1.5, '&:before': { display: 'none' } }}
      >
        <AccordionSummary
          expandIcon={<ExpandMore />}
          sx={{ minHeight: 44, '& .MuiAccordionSummary-content': { my: 1 } }}
        >
          <Box>
            <Typography variant="subtitle2">Advanced scoring controls</Typography>
            <Typography variant="caption" color="text.secondary">
              Match length, tossup values, bonuses, overtime, rosters and lightning rounds.
            </Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0 }}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6 }}>
              <RoundLengthSettingsCard />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TossupSettingsCard />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <BonusSettingsCard />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <OvertimeSettingsCard />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <MaxPlayersSettingsCard />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <LightningRoundSettingsCard />
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>
    </>
  );
}

export default RulesPage;
