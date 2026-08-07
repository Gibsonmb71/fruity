import { Switch } from '@mui/material';
import { ChangeEvent, useContext } from 'react';
import YfCard from './YfCard';
import useSubscription from '../Utils/CustomHooks';
import { TournamentContext } from '../TournamentManager';
import { parseAndValidateStringToInt } from '../Utils/GeneralUtils';
import { AdvancedNumericRuleField, SettingRow, SettingsList, YfDisclosureRow } from '../Utils/GeneralReactUtils';

function BonusSettingsCard() {
  const tournManager = useContext(TournamentContext);
  const thisTournamentRules = tournManager.tournament.scoringRules;
  const [useBonuses, setUseBonuses] = useSubscription(thisTournamentRules.useBonuses);
  const [bonusesBounce, setBonusesBounce] = useSubscription(thisTournamentRules.bonusesBounceBack);
  const [maxBonusScore] = useSubscription(thisTournamentRules.maximumBonusScore);
  const [maxBonusParts] = useSubscription(thisTournamentRules.maximumPartsPerBonus);
  const readOnly = tournManager.tournament.hasMatchData;

  const handleUseBonusesChange = (e: ChangeEvent<HTMLInputElement>) => {
    setUseBonuses(e.target.checked);
    tournManager.setUseBonuses(e.target.checked);
  };

  const handleBonusesBounceChange = (e: ChangeEvent<HTMLInputElement>) => {
    setBonusesBounce(e.target.checked);
    tournManager.setBonusesBounceBack(e.target.checked);
  };

  return (
    <YfCard title="Bonuses" variant="rows" fullHeight>
      <SettingsList>
        <SettingRow label="Use bonuses" description="Teams answer a bonus after converting a toss-up.">
          <Switch disabled={readOnly} checked={useBonuses} onChange={handleUseBonusesChange} />
        </SettingRow>
        <SettingRow
          label="Bouncebacks"
          description={useBonuses ? 'Unanswered parts go to the other team.' : 'Requires bonuses to be turned on.'}
          helpTopic="rules.bouncebacks"
        >
          <Switch disabled={readOnly || !useBonuses} checked={bonusesBounce} onChange={handleBonusesBounceChange} />
        </SettingRow>
        {useBonuses && (
          <YfDisclosureRow
            label="Bonus structure"
            summary={`${maxBonusScore} pts over ${maxBonusParts} part${maxBonusParts === 1 ? '' : 's'}`}
          >
            <AdvancedBonusSection />
          </YfDisclosureRow>
        )}
      </SettingsList>
    </YfCard>
  );
}

function AdvancedBonusSection() {
  const tournManager = useContext(TournamentContext);
  const thisTournamentRules = tournManager.tournament.scoringRules;
  const [maxBonusScore, setMaxBonusScore] = useSubscription(thisTournamentRules.maximumBonusScore.toString());
  const [minBonusParts, setMinBonusParts] = useSubscription(thisTournamentRules.minimumPartsPerBonus.toString());
  const [maxBonusParts, setMaxBonusParts] = useSubscription(thisTournamentRules.maximumPartsPerBonus.toString());
  const [ptsPerPart, setPtsPerPart] = useSubscription(thisTournamentRules.pointsPerBonusPart?.toString() || '');
  const [divisor, setDivisor] = useSubscription(thisTournamentRules.bonusDivisor.toString());
  const readOnly = tournManager.tournament.hasMatchData;

  const handleMaxBonusScoreChange = (value: string) => {
    const deflt = ptsPerPart !== '' ? parseInt(ptsPerPart, 10) * parseInt(maxBonusParts, 10) : 30;
    const valueToSave = parseAndValidateStringToInt(value, deflt, 1, 1000);
    setMaxBonusScore(valueToSave.toString());
    tournManager.setMaxBonusScore(valueToSave);

    if (valueToSave % parseInt(divisor, 10)) {
      setDivisor('1');
      tournManager.setBonusDivisor(1);
    }
  };

  const handleMinBonusPartsChange = (value: string) => {
    const valueToSave = parseAndValidateStringToInt(value, parseInt(maxBonusParts, 10), 1, parseInt(maxBonusParts, 10));
    setMinBonusParts(valueToSave.toString());
    tournManager.setMinPartsPerBonus(valueToSave);
  };

  const handleMaxBonusPartsChange = (value: string) => {
    const valueToSave = parseAndValidateStringToInt(
      value,
      parseInt(minBonusParts, 10),
      parseInt(minBonusParts, 10),
      1000,
    );
    setMaxBonusParts(valueToSave.toString());
    tournManager.setMaxPartsPerBonus(valueToSave);

    if (ptsPerPart !== '') {
      const newMaxScore = valueToSave * parseInt(ptsPerPart, 10);
      setMaxBonusScore(newMaxScore.toString());
      tournManager.setMaxBonusScore(newMaxScore);
    }
  };

  const handlePtsPerPartChange = (value: string) => {
    if (value === '') {
      tournManager.setPtsPerBonusPart(undefined);
      return;
    }
    const valueToSave = parseAndValidateStringToInt(value, thisTournamentRules.pointsPerBonusPart || 10, 1, 1000);
    setPtsPerPart(valueToSave.toString());
    tournManager.setPtsPerBonusPart(valueToSave);

    const newMaxScore = valueToSave * parseInt(maxBonusParts, 10);
    setMaxBonusScore(newMaxScore.toString());
    tournManager.setMaxBonusScore(newMaxScore);

    setDivisor(valueToSave.toString());
    tournManager.setBonusDivisor(valueToSave);
  };

  const handleDivisorChange = (value: string) => {
    const maxBonusScoreInt = parseInt(maxBonusScore, 10);
    let valueToSave = parseAndValidateStringToInt(value, thisTournamentRules.bonusDivisor, 1, maxBonusScoreInt);
    if (maxBonusScoreInt % valueToSave) valueToSave = thisTournamentRules.bonusDivisor;
    setDivisor(valueToSave.toString());
    tournManager.setBonusDivisor(valueToSave);
  };

  return (
    <SettingsList>
      <AdvancedNumericRuleField
        label="Max bonus score"
        required
        value={maxBonusScore}
        disabled={readOnly || ptsPerPart !== ''}
        minValue={1}
        maxValue={1000}
        onChange={setMaxBonusScore}
        onBlur={() => handleMaxBonusScoreChange(maxBonusScore)}
      />
      <AdvancedNumericRuleField
        label="Min parts per bonus"
        required
        value={minBonusParts}
        disabled={readOnly}
        minValue={1}
        maxValue={parseInt(maxBonusParts, 10)}
        onChange={setMinBonusParts}
        onBlur={() => handleMinBonusPartsChange(minBonusParts)}
      />
      <AdvancedNumericRuleField
        label="Max parts per bonus"
        required
        value={maxBonusParts}
        disabled={readOnly}
        minValue={parseInt(minBonusParts, 10)}
        maxValue={1000}
        onChange={setMaxBonusParts}
        onBlur={() => handleMaxBonusPartsChange(maxBonusParts)}
      />
      <AdvancedNumericRuleField
        label="Pts per bonus part"
        required={false}
        value={ptsPerPart}
        disabled={readOnly}
        minValue={1}
        maxValue={1000}
        onChange={setPtsPerPart}
        onBlur={() => handlePtsPerPartChange(ptsPerPart)}
      />
      <AdvancedNumericRuleField
        label="Divisor"
        helpTopic="rules.bonus-divisor"
        required
        value={divisor}
        disabled={readOnly || ptsPerPart !== ''}
        minValue={1}
        maxValue={parseInt(maxBonusScore, 10)}
        onChange={setDivisor}
        onBlur={() => handleDivisorChange(divisor)}
      />
    </SettingsList>
  );
}

export default BonusSettingsCard;
