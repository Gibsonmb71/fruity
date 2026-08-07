/* eslint-disable react/require-default-props */
import { useContext } from 'react';
import type { PropsWithChildren, Ref } from 'react';
import {
  Box,
  Checkbox,
  FormControl,
  InputLabel,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { MatchEditModalContext } from '../Modal Managers/TempMatchManager';
import { TournamentContext } from '../TournamentManager';
import useSubscription from '../Utils/CustomHooks';
import { YfHelpPopover, YfNumericField } from '../Utils/GeneralReactUtils';
import type { HelpTopicId } from './PageLevelHelpText';
import { ValidationStatuses } from '../DataModel/Interfaces';

interface IMatchDetailsBarProps {
  totalTuhInputRef: Ref<HTMLInputElement>;
}

export default function MatchDetailsBar(props: IMatchDetailsBarProps) {
  const { totalTuhInputRef } = props;

  return (
    <Box
      component="section"
      aria-labelledby="match-details-heading"
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        px: { xs: 1.25, sm: 1.5 },
        py: 1.25,
        mb: 1.5,
      }}
    >
      <Typography
        id="match-details-heading"
        component="h2"
        variant="overline"
        sx={{ display: 'block', color: 'text.secondary', mb: 0.75 }}
      >
        Match details
      </Typography>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={{ xs: 1, sm: 1.5 }}
        sx={{ alignItems: { xs: 'stretch', sm: 'flex-start' }, flexWrap: 'wrap' }}
      >
        <Box sx={{ width: { xs: '100%', sm: 120 } }}>
          <RoundField />
        </Box>
        <StageDisplay />
        <CarryoverPhaseSelect />
        <Box sx={{ width: { xs: '100%', sm: 160 }, ml: { sm: 'auto' } }}>
          <FieldWithHelp topic="games.tuh" label="Help for toss-ups read">
            <TuhTotalField inputRef={totalTuhInputRef} />
          </FieldWithHelp>
        </Box>
      </Stack>
    </Box>
  );
}

function RoundField() {
  const modalManager = useContext(MatchEditModalContext);
  const [round] = useSubscription(modalManager.round);
  const [roundNo, setRoundNo] = useSubscription(modalManager.roundNumber?.toString() || '');
  const [err] = useSubscription(modalManager.roundFieldError);
  const usesNumericRounds = !round || !modalManager.phase || modalManager.phase.usesNumericRounds();

  const commit = () => {
    const newRoundNo = modalManager.setRoundNo(roundNo);
    setRoundNo(newRoundNo === undefined ? '' : newRoundNo.toString());
  };

  if (!usesNumericRounds) {
    return (
      <TextField
        id="match-round"
        label="Round"
        fullWidth
        value={round?.name || ''}
        slotProps={{ htmlInput: { readOnly: true, 'aria-label': 'Round' } }}
        helperText=" "
      />
    );
  }

  return (
    <YfNumericField
      id="match-round"
      slotProps={{ htmlInput: { min: 1, 'aria-label': 'Round' } }}
      label="Round"
      fullWidth
      autoFocus={roundNo === ''}
      error={!!err}
      helperText={err || ' '}
      value={roundNo}
      onChange={(event) => setRoundNo(event.target.value)}
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

function StageDisplay() {
  const modalManager = useContext(MatchEditModalContext);
  const [phaseName] = useSubscription(modalManager.phase?.name || '');

  return (
    <Box sx={{ minWidth: { xs: 0, sm: 160 }, pt: { sm: 0.5 } }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        Stage
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {phaseName || 'Not assigned'}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        Derived from the round
      </Typography>
    </Box>
  );
}

/**
 * A field with its own `?` beside it, aligned to the top of the control rather than its middle so
 * the icon lines up with the label rather than floating in the middle of the input.
 */
function FieldWithHelp(props: PropsWithChildren<{ topic: HelpTopicId; label: string }>) {
  const { topic, label, children } = props;
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.25, width: '100%' }}>
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>{children}</Box>
      <Box sx={{ pt: 1.25, flexShrink: 0 }}>
        <YfHelpPopover topic={topic} label={label} />
      </Box>
    </Box>
  );
}

function CarryoverPhaseSelect() {
  const modalManager = useContext(MatchEditModalContext);
  const [selectedPhases] = useSubscription(modalManager.tempMatch.carryoverPhases);
  const availablePhases = modalManager.getAvailableCarryOverPhases();

  if (availablePhases.length === 0) return null;

  const selectedNames = selectedPhases.map((phase) => phase.name);
  const handleChange = (value: string[] | string) => {
    const phaseNames = typeof value === 'string' ? value.split(',') : value;
    modalManager.setCarryoverPhases(phaseNames);
  };

  return (
    <FieldWithHelp topic="games.carryover" label="Help for carryover">
      <FormControl sx={{ minWidth: { xs: '100%', sm: 220 }, width: '100%' }}>
        <InputLabel id="match-carryover-label">Carryover</InputLabel>
        <Select
          labelId="match-carryover-label"
          id="match-carryover"
          multiple
          label="Carryover"
          value={selectedNames}
          onChange={(event) => handleChange(event.target.value as string[])}
          renderValue={(selected) => (selected.length === 0 ? 'None' : selected.join(', '))}
        >
          {availablePhases.map((phase) => (
            <MenuItem key={phase.name} value={phase.name}>
              <Checkbox checked={selectedNames.includes(phase.name)} />
              <ListItemText primary={phase.name} />
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </FieldWithHelp>
  );
}

interface ITuhTotalFieldProps {
  inputRef: Ref<HTMLInputElement>;
}

function TuhTotalField(props: ITuhTotalFieldProps) {
  const { inputRef } = props;
  const tournManager = useContext(TournamentContext);
  const modalManager = useContext(MatchEditModalContext);
  const [tuh, setTuh] = useSubscription(modalManager.tempMatch.tossupsRead?.toString() || '');
  const [valStatus] = useSubscription(modalManager.tempMatch.totalTuhFieldValidation.status);
  const [valMsg] = useSubscription(modalManager.tempMatch.totalTuhFieldValidation.message);
  const [forfeit] = useSubscription(modalManager.tempMatch.isForfeit());
  const [roundExists] = useSubscription(!!modalManager.round);

  const commit = () => {
    const value = modalManager.setTotalTuh(tuh);
    setTuh(value?.toString() || '');
  };

  return (
    <YfNumericField
      id="match-total-tuh"
      inputRef={inputRef}
      slotProps={{ htmlInput: { min: 1, 'aria-label': 'Total tossups read' } }}
      label="TU read"
      fullWidth
      autoFocus={tournManager.tournament.scoringRules.timed && roundExists}
      disabled={forfeit}
      error={valStatus === ValidationStatuses.Error}
      helperText={valMsg || 'Including overtime'}
      value={tuh}
      onChange={(event) => setTuh(event.target.value)}
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
