/* eslint-disable react/require-default-props */
import { useContext, useEffect, useMemo, useState } from 'react';
import { Autocomplete, Box, Checkbox, FormControlLabel, Paper, Stack, TextField, Typography } from '@mui/material';
import { MatchEditModalContext } from '../Modal Managers/TempMatchManager';
import { TournamentContext } from '../TournamentManager';
import useSubscription from '../Utils/CustomHooks';
import { LeftOrRight } from '../Utils/UtilTypes';
import { ValidationStatuses } from '../DataModel/Interfaces';
import { YfNumericField } from '../Utils/GeneralReactUtils';
import MatchPlayerStatsTable from './MatchPlayerStatsTable';
import MatchSpecialScoring from './MatchSpecialScoring';

interface IMatchTeamEditorProps {
  whichTeam: LeftOrRight;
}

export default function MatchTeamEditor(props: IMatchTeamEditorProps) {
  const { whichTeam } = props;
  const modalManager = useContext(MatchEditModalContext);
  const matchTeam = modalManager.tempMatch.getMatchTeam(whichTeam);
  const teamLabel = whichTeam === 'left' ? 'Team A' : 'Team B';

  return (
    <Paper
      component="section"
      variant="outlined"
      aria-labelledby={`match-${whichTeam}-heading`}
      sx={{ minWidth: 0, overflow: 'hidden' }}
    >
      <Box sx={{ px: { xs: 1.25, sm: 1.5 }, py: 1.25, borderBottom: 1, borderColor: 'divider' }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'flex-start' } }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="overline" color="text.secondary">
              {teamLabel}
            </Typography>
            <Typography
              id={`match-${whichTeam}-heading`}
              component="h2"
              variant="h3"
              noWrap
              title={matchTeam.team?.name}
              sx={{ fontSize: '1rem', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {matchTeam.team?.name || 'Select a team'}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} sx={{ width: { xs: '100%', sm: 'min(58%, 330px)' } }}>
            <TeamSelect whichTeam={whichTeam} />
            <TeamScoreField whichTeam={whichTeam} />
          </Stack>
        </Stack>
        <ForfeitControl whichTeam={whichTeam} />
      </Box>
      <Box sx={{ px: { xs: 0.75, sm: 1 }, py: 1 }}>
        <Typography variant="subtitle2" sx={{ px: 0.5, pb: 0.5 }}>
          Players
        </Typography>
        <MatchPlayerStatsTable whichTeam={whichTeam} />
      </Box>
      <MatchSpecialScoring whichTeam={whichTeam} />
    </Paper>
  );
}

const teamSelectNullOption = '';

interface ITeamSelectProps {
  whichTeam: LeftOrRight;
}

function TeamSelect(props: ITeamSelectProps) {
  const { whichTeam } = props;
  const tournManager = useContext(TournamentContext);
  const modalManager = useContext(MatchEditModalContext);
  const { tournament } = tournManager;
  const [team, setTeam] = useSubscription(modalManager.getSelectedTeam(whichTeam)?.name || teamSelectNullOption);
  const [inputValue, setInputValue] = useState('');
  const [roundNo] = useSubscription(modalManager.roundNumber?.toString() || '');
  const [round] = useSubscription(modalManager.round);

  useEffect(() => {
    setInputValue(team);
  }, [team]);

  const allTeamNames = useMemo(() => tournament.getListOfAllTeams().map((teamItem) => teamItem.name), [tournament]);
  const options = [teamSelectNullOption].concat(allTeamNames);
  const isUntimedNewEntry =
    whichTeam === 'left' &&
    !tournament.scoringRules.timed &&
    (roundNo !== '' || !!round) &&
    !modalManager.originalMatchLoaded;

  const commitTeamName = (value: string) => {
    const typedTeam = value.trim();
    if (typedTeam === '' || allTeamNames.includes(typedTeam)) {
      if (typedTeam !== team) modalManager.teamSelectChangeTeam(whichTeam, typedTeam);
      setTeam(typedTeam);
      setInputValue(typedTeam);
      return true;
    }
    return false;
  };

  const commitTypedTeam = () => {
    if (commitTeamName(inputValue)) return;
    // Keep an unmatched search from looking like a selected team after the field loses focus.
    setInputValue(team);
  };

  return (
    <Autocomplete
      id={`match-${whichTeam}-team`}
      autoHighlight
      clearOnEscape
      autoSelect
      fullWidth
      value={team}
      onChange={(event: unknown, newValue: string | null) => {
        const value = newValue || '';
        setTeam(value);
        setInputValue(value);
        modalManager.teamSelectChangeTeam(whichTeam, value);
      }}
      inputValue={inputValue}
      onInputChange={(event, newValue, reason) => {
        setInputValue(newValue);
        if (reason === 'input' && allTeamNames.includes(newValue.trim())) commitTeamName(newValue);
      }}
      options={options}
      isOptionEqualToValue={(option, value) => option === value || (option === '' && value === '')}
      renderInput={(params) => (
        <TextField
          // eslint-disable-next-line react/jsx-props-no-spreading
          {...params}
          id={`match-${whichTeam}-team-input`}
          label="Team"
          autoFocus={isUntimedNewEntry}
          onBlur={commitTypedTeam}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitTypedTeam();
            }
          }}
          slotProps={{ htmlInput: { 'aria-label': `${whichTeam === 'left' ? 'Team A' : 'Team B'} selector` } }}
        />
      )}
    />
  );
}

interface ITeamScoreFieldProps {
  whichTeam: LeftOrRight;
}

function TeamScoreField(props: ITeamScoreFieldProps) {
  const { whichTeam } = props;
  const tournManager = useContext(TournamentContext);
  const modalManager = useContext(MatchEditModalContext);
  const matchTeam = modalManager.tempMatch.getMatchTeam(whichTeam);
  const [points, setPoints] = useSubscription(matchTeam.points?.toString() || '');
  const [valStatus] = useSubscription(matchTeam.totalScoreFieldValidation.status);
  const [valMsg] = useSubscription(matchTeam.totalScoreFieldValidation.message);
  const [forfeit] = useSubscription(modalManager.tempMatch.isForfeit());
  const divisor = tournManager.tournament.scoringRules.totalDivisor;

  const commit = () => {
    const value = modalManager.setTeamScore(whichTeam, points);
    setPoints(value?.toString() || '');
  };

  return (
    <YfNumericField
      id={`match-${whichTeam}-score`}
      label="Score"
      sx={{ width: { xs: '7ch', sm: '8ch' }, flexShrink: 0 }}
      slotProps={{ htmlInput: { step: divisor, 'aria-label': `${whichTeam === 'left' ? 'Team A' : 'Team B'} score` } }}
      disabled={forfeit || !matchTeam.team}
      error={valStatus === ValidationStatuses.Error}
      helperText={valMsg || ' '}
      value={points}
      onChange={(event) => setPoints(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
      }}
    />
  );
}

function ForfeitControl(props: ITeamSelectProps) {
  const { whichTeam } = props;
  const modalManager = useContext(MatchEditModalContext);
  const matchTeam = modalManager.tempMatch.getMatchTeam(whichTeam);
  const [isForfeit, setIsForfeit] = useSubscription(matchTeam.forfeitLoss);
  const otherTeam = modalManager.tempMatch.getMatchTeam(whichTeam === 'left' ? 'right' : 'left');

  if (!matchTeam.team) return null;

  const handleChange = (checked: boolean) => {
    setIsForfeit(checked);
    modalManager.setForfeit(whichTeam, checked);
  };

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 0.75, minHeight: 28 }}>
      <FormControlLabel
        control={
          <Checkbox
            id={`match-${whichTeam}-forfeit`}
            checked={isForfeit}
            onChange={(event) => handleChange(event.target.checked)}
          />
        }
        label="Loses by forfeit"
      />
      {otherTeam.forfeitLoss && !isForfeit && (
        <Typography variant="caption" color="success.main" sx={{ fontWeight: 600 }}>
          Wins by forfeit
        </Typography>
      )}
    </Stack>
  );
}
