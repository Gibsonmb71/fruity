import { ToggleButton, ToggleButtonGroup } from '@mui/material';
import { useContext } from 'react';
import { CommonRuleSets, ScoringRules } from '../DataModel/ScoringRules';
import { TournamentContext } from '../TournamentManager';
import YfCard from './YfCard';
import useSubscription from '../Utils/CustomHooks';

// Defines the order the buttons should be in
const ruleSets = [CommonRuleSets.AcfPowers, CommonRuleSets.Acf, CommonRuleSets.NaqtUntimed, CommonRuleSets.NaqtTimed];

function StandardRuleSetCard() {
  const tournManager = useContext(TournamentContext);
  const [ruleSet, setRuleSet] = useSubscription(tournManager.tournament.standardRuleSet ?? '');
  const readOnly = tournManager.tournament.hasMatchData;

  return (
    <YfCard
      title="Ruleset"
      description="Start here. Picking one applies a full set of defaults; every section below can still be changed."
    >
      <ToggleButtonGroup
        color="primary"
        exclusive
        disabled={readOnly}
        value={ruleSet}
        onChange={(e, newValue) => {
          if (newValue === null) return;
          setRuleSet(newValue);
          tournManager.applStdRuleSet(newValue);
        }}
      >
        {ruleSets.map((val) => (
          <ToggleButton key={val} value={val}>
            {ScoringRules.getRuleSetName(val)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </YfCard>
  );
}

export default StandardRuleSetCard;
