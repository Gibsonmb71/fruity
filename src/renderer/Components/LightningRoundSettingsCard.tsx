import { Switch } from '@mui/material';
import { ChangeEvent, useContext } from 'react';
import YfCard from './YfCard';
import useSubscription from '../Utils/CustomHooks';
import { TournamentContext } from '../TournamentManager';
import { parseAndValidateStringToInt } from '../Utils/GeneralUtils';
import { AdvancedNumericRuleField, SettingRow, SettingsList, YfDisclosureRow } from '../Utils/GeneralReactUtils';

function LightningRoundSettingsCard() {
  const tournManager = useContext(TournamentContext);
  const thisTournamentRules = tournManager.tournament.scoringRules;
  const [useLightning, setUseLightning] = useSubscription(thisTournamentRules.lightningCountPerTeam > 0);
  const [divisor] = useSubscription(thisTournamentRules.lightningDivisor);
  const readOnly = tournManager.tournament.hasMatchData;

  const handleUseLightningChange = (e: ChangeEvent<HTMLInputElement>) => {
    setUseLightning(e.target.checked);
    tournManager.setUseLightning(e.target.checked);
  };

  return (
    <YfCard
      title="Special formats"
      description="Extra scoring outside the normal toss-up and bonus cycle."
      variant="rows"
      fullHeight
    >
      <SettingsList>
        <SettingRow
          label="Lightning round"
          description="Each team gets its own timed round, entered as a single point total."
        >
          <Switch checked={useLightning} disabled={readOnly} onChange={handleUseLightningChange} />
        </SettingRow>
        {useLightning && (
          <YfDisclosureRow label="Lightning scoring" summary={`Divisor ${divisor}`}>
            <LightningAdvancedSection />
          </YfDisclosureRow>
        )}
      </SettingsList>
    </YfCard>
  );
}

function LightningAdvancedSection() {
  const tournManager = useContext(TournamentContext);
  const [divisor, setDivisor] = useSubscription(tournManager.tournament.scoringRules.lightningDivisor.toString());

  const handleDivisorChange = (value: string) => {
    const deflt = tournManager.tournament.scoringRules.lightningDivisor;
    const valueToSave = parseAndValidateStringToInt(value, deflt, 1, 1000);
    setDivisor(valueToSave.toString());
    tournManager.setLightningDivisor(valueToSave);
  };

  return (
    <SettingsList>
      <AdvancedNumericRuleField
        label="Divisor"
        required
        disabled={tournManager.tournament.hasMatchData}
        value={divisor}
        minValue={1}
        maxValue={1000}
        onChange={setDivisor}
        onBlur={() => handleDivisorChange(divisor)}
      />
    </SettingsList>
  );
}

export default LightningRoundSettingsCard;
