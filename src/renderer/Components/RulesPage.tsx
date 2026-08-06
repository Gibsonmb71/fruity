import { Box } from '@mui/material';
import Grid from '@mui/material/Grid';
import { useContext } from 'react';
import { Lock } from '@mui/icons-material';
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

function RulesPage() {
  const tournManager = useContext(TournamentContext);
  const [readOnly] = useSubscription(tournManager.tournament.hasMatchData);

  return (
    <>
      <YfPageHeader
        title="Rules"
        description="How games are scored. Start from a standard rule set, then adjust whatever differs."
      />
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
      {/*
        Paired the way a format actually gets settled — ruleset first, then match length beside what a
        toss-up is worth, bonuses beside overtime, roster limits beside anything unusual. The previous
        three-column grid distributed panels arbitrarily, so the reading order changed with the window
        width and unrelated settings ended up as neighbors.
      */}
      <Grid container spacing={2}>
        <Grid size={{ xs: 12 }}>
          <StandardRuleSetCard />
        </Grid>
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
    </>
  );
}

export default RulesPage;
