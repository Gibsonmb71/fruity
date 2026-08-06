import { FormControl, InputLabel, ListItemText, MenuItem, Select, Stack, Typography } from '@mui/material';
import { useContext } from 'react';
import { CommonRuleSets, ScoringRules } from '../DataModel/ScoringRules';
import { TournamentContext } from '../TournamentManager';
import YfCard from './YfCard';
import useSubscription from '../Utils/CustomHooks';

const customRuleSet = 'custom';
const ruleSets = [CommonRuleSets.NaqtUntimed, CommonRuleSets.NaqtTimed, CommonRuleSets.Acf, CommonRuleSets.AcfPowers];

function StandardRuleSetCard() {
  const tournManager = useContext(TournamentContext);
  const [ruleSet, setRuleSet] = useSubscription(tournManager.tournament.standardRuleSet ?? customRuleSet);
  const readOnly = tournManager.tournament.hasMatchData;
  const selectedLabel = ruleSet === customRuleSet ? 'Custom' : ScoringRules.getRuleSetName(ruleSet as CommonRuleSets);

  return (
    <YfCard
      title="Ruleset"
      description="Choose a standard ruleset for the common path. Custom scoring remains available below."
    >
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ alignItems: { sm: 'center' }, gap: 1.5 }}>
        <FormControl sx={{ minWidth: 240 }} disabled={readOnly}>
          <InputLabel>Rule set</InputLabel>
          <Select
            label="Rule set"
            value={ruleSet}
            onChange={(event) => {
              const newValue = event.target.value;
              setRuleSet(newValue);
              if (newValue === customRuleSet) tournManager.clearStandardRuleSet();
              else tournManager.applStdRuleSet(newValue as CommonRuleSets);
            }}
          >
            {ruleSets.map((val) => (
              <MenuItem key={val} value={val}>
                <ListItemText primary={ScoringRules.getRuleSetName(val)} secondary={ruleSetSummary(val)} />
              </MenuItem>
            ))}
            <MenuItem value={customRuleSet}>
              <ListItemText primary="Custom" secondary="Edit the scoring controls below" />
            </MenuItem>
          </Select>
        </FormControl>
        <Typography variant="body2" color="text.secondary">
          {selectedLabel} is active. Advanced controls are available below when the tournament differs from the
          standard.
        </Typography>
      </Stack>
    </YfCard>
  );
}

function ruleSetSummary(ruleSet: CommonRuleSets) {
  switch (ruleSet) {
    case CommonRuleSets.NaqtUntimed:
      return '15-point powers · 10-point tossups · −5 negs';
    case CommonRuleSets.NaqtTimed:
      return 'NAQT scoring with timed rounds';
    case CommonRuleSets.Acf:
      return '10-point tossups · −5 negs';
    case CommonRuleSets.AcfPowers:
    default:
      return '15-point powers · 10-point tossups · −5 negs';
  }
}

export default StandardRuleSetCard;
