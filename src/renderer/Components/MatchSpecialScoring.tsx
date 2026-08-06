/* eslint-disable react/require-default-props */
import { useContext } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { MatchEditModalContext } from '../Modal Managers/TempMatchManager';
import { LeftOrRight } from '../Utils/UtilTypes';
import useSubscription from '../Utils/CustomHooks';
import { ValidationStatuses } from '../DataModel/Interfaces';
import { YfNumericField } from '../Utils/GeneralReactUtils';

interface IMatchSpecialScoringProps {
  whichTeam: LeftOrRight;
}

export default function MatchSpecialScoring(props: IMatchSpecialScoringProps) {
  const { whichTeam } = props;
  const modalManager = useContext(MatchEditModalContext);
  const rules = modalManager.tournament.scoringRules;
  const matchTeam = modalManager.tempMatch.getMatchTeam(whichTeam);
  const isForfeit = modalManager.tempMatch.isForfeit();

  if (!matchTeam.team) return null;

  const hasSpecialScoring = rules.useBonuses || rules.bonusesBounceBack || rules.useLightningRounds();
  if (!hasSpecialScoring) return null;

  return (
    <Box sx={{ borderTop: 1, borderColor: 'divider', px: { xs: 1.25, sm: 1.5 }, py: 1 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={{ xs: 1, sm: 2 }}
        sx={{ alignItems: { sm: 'flex-start' }, flexWrap: 'wrap' }}
      >
        {rules.useBonuses && <BonusSummary whichTeam={whichTeam} disabled={isForfeit} />}
        {rules.bonusesBounceBack && !isForfeit && <BouncebackEditor whichTeam={whichTeam} />}
        {rules.useLightningRounds() && !isForfeit && <LightningEditor whichTeam={whichTeam} />}
        {isForfeit && (
          <Typography variant="caption" color="text.secondary" sx={{ pt: 0.5 }}>
            Special scoring is not entered for a forfeit.
          </Typography>
        )}
      </Stack>
    </Box>
  );
}

function BonusSummary(props: { whichTeam: LeftOrRight; disabled: boolean }) {
  const { whichTeam, disabled } = props;
  const modalManager = useContext(MatchEditModalContext);
  const matchTeam = modalManager.tempMatch.getMatchTeam(whichTeam);
  const [points, heard, ppb] = matchTeam.getBonusStats(modalManager.tournament.scoringRules);

  return (
    <Box sx={{ minWidth: { sm: 210 }, opacity: disabled ? 0.7 : 1 }}>
      <Typography variant="overline" color="text.secondary">
        Bonuses
      </Typography>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
        <StatValue label="Points" value={disabled ? '—' : points} />
        <StatValue label="Heard" value={disabled ? '—' : heard} />
        <StatValue label="PPB" value={disabled ? '—' : ppb} />
      </Stack>
    </Box>
  );
}

function StatValue(props: { label: string; value: string }) {
  const { label, value } = props;
  return (
    <Box>
      <Typography component="span" variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
        {label}
      </Typography>
      <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
        {value}
      </Typography>
    </Box>
  );
}

function BouncebackEditor(props: { whichTeam: LeftOrRight }) {
  const { whichTeam } = props;
  const modalManager = useContext(MatchEditModalContext);
  const matchTeam = modalManager.tempMatch.getMatchTeam(whichTeam);
  const rules = modalManager.tournament.scoringRules;
  const [points, setPoints] = useSubscription(matchTeam.bonusBouncebackPoints?.toString() || '');
  const [invalid] = useSubscription(matchTeam.bouncebackFieldValidation.status === ValidationStatuses.Error);
  const [partsHeard, conversion] = modalManager.tempMatch.getBouncebackStatsString(whichTeam, rules);

  const commit = () => {
    const value = modalManager.setBouncebackPoints(whichTeam, points);
    setPoints(value?.toString() || '');
  };

  return (
    <Box sx={{ minWidth: { sm: 250 } }}>
      <Typography variant="overline" color="text.secondary">
        Bouncebacks
      </Typography>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <YfNumericField
          id={`match-${whichTeam}-bounceback`}
          label="Points"
          variant="standard"
          value={points}
          error={invalid}
          helperText={invalid ? matchTeam.bouncebackFieldValidation.message : undefined}
          slotProps={{ htmlInput: { min: 0, step: rules.bonusDivisor, 'aria-label': 'Bounceback points' } }}
          sx={{ width: '8ch', '& .MuiInputBase-input': { textAlign: 'right' } }}
          onChange={(event) => setPoints(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            }
          }}
        />
        <Typography variant="caption" color="text.secondary">
          {partsHeard} parts heard · {conversion}% conversion
        </Typography>
      </Stack>
    </Box>
  );
}

function LightningEditor(props: { whichTeam: LeftOrRight }) {
  const { whichTeam } = props;
  const modalManager = useContext(MatchEditModalContext);
  const matchTeam = modalManager.tempMatch.getMatchTeam(whichTeam);
  const rules = modalManager.tournament.scoringRules;
  const [points, setPoints] = useSubscription(matchTeam.lightningPoints?.toString() || '');

  const commit = () => {
    const value = modalManager.setLightningPoints(whichTeam, points);
    setPoints(value?.toString() || '');
  };

  return (
    <Box sx={{ minWidth: { sm: 150 } }}>
      <Typography variant="overline" color="text.secondary">
        Lightning / worksheet
      </Typography>
      <YfNumericField
        id={`match-${whichTeam}-lightning`}
        label="Points"
        variant="standard"
        value={points}
        slotProps={{ htmlInput: { min: 0, step: rules.lightningDivisor, 'aria-label': 'Lightning points' } }}
        sx={{ width: '10ch', '& .MuiInputBase-input': { textAlign: 'right' } }}
        onChange={(event) => setPoints(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
      />
    </Box>
  );
}
