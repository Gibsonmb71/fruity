/* eslint-disable react/require-default-props */
import { useContext, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Collapse,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { MatchEditModalContext } from '../Modal Managers/TempMatchManager';
import { LeftOrRight } from '../Utils/UtilTypes';
import useSubscription from '../Utils/CustomHooks';
import { ValidationStatuses } from '../DataModel/Interfaces';
import { PlayerAnswerCount } from '../DataModel/PlayerAnswerCount';
import { YfNumericField } from '../Utils/GeneralReactUtils';
import { shouldExpandOvertime, shouldShowTiePrompt } from '../Services/MatchEditorPresentation';

export default function MatchOvertimeEditor() {
  const modalManager = useContext(MatchEditModalContext);
  const [leftPoints] = useSubscription(modalManager.tempMatch.leftTeam.points);
  const [rightPoints] = useSubscription(modalManager.tempMatch.rightTeam.points);
  const isForfeit = modalManager.tempMatch.isForfeit();
  const hasExistingOvertime = modalManager.tempMatch.overtimeTossupsRead !== undefined;
  const [expanded, setExpanded] = useState(shouldExpandOvertime(hasExistingOvertime, false));
  const tiePrompt = shouldShowTiePrompt(isForfeit, leftPoints, rightPoints, expanded);
  let actionLabel = 'Add overtime';
  if (expanded) actionLabel = 'Hide overtime';
  else if (hasExistingOvertime) actionLabel = 'Edit overtime';

  useEffect(() => {
    setExpanded(shouldExpandOvertime(hasExistingOvertime, false));
    // A new temporary match is created for each Save & New cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalManager.tempMatch, hasExistingOvertime]);

  if (isForfeit) return null;

  const summary = modalManager.tempMatch.getOvertimeSummary().replace(/\s+/g, ' ').trim();

  return (
    <Paper component="section" variant="outlined" aria-labelledby="match-overtime-heading" sx={{ minWidth: 0 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          px: { xs: 1.25, sm: 1.5 },
          py: 0.75,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography id="match-overtime-heading" component="h2" variant="subtitle1">
            Overtime
          </Typography>
          {!expanded && (
            <Typography variant="caption" color="text.secondary" noWrap>
              {tiePrompt ? 'Tie detected · Add overtime' : summary || 'None'}
            </Typography>
          )}
        </Box>
        <Button
          size="small"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls="overtime-form"
        >
          {actionLabel}
        </Button>
      </Box>
      <Collapse in={expanded} id="overtime-form">
        <Box sx={{ borderTop: 1, borderColor: 'divider', px: { xs: 1.25, sm: 1.5 }, py: 1.25 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'flex-start' } }}>
            <Box sx={{ width: { xs: '100%', sm: 120 } }}>
              <OvertimeTuReadField />
            </Box>
            <Box sx={{ minWidth: 0, flex: 1, overflowX: 'auto' }}>
              <OvertimeTable />
            </Box>
          </Stack>
        </Box>
      </Collapse>
    </Paper>
  );
}

function OvertimeTuReadField() {
  const modalManager = useContext(MatchEditModalContext);
  const [otTuh, setOtTuh] = useSubscription(modalManager.tempMatch.overtimeTossupsRead?.toString() || '');
  const [status] = useSubscription(modalManager.tempMatch.overtimeTuhFieldValidation.status);
  const [message] = useSubscription(modalManager.tempMatch.overtimeTuhFieldValidation.message);

  const handleChange = (value: string) => {
    setOtTuh(value);
    const parsed = parseInt(value, 10);
    modalManager.enableOtFieldsOverride(value !== '' && !Number.isNaN(parsed) && parsed !== 0);
  };

  const commit = () => {
    const value = modalManager.setOtTuhRead(otTuh);
    setOtTuh(value?.toString() || '');
  };

  return (
    <YfNumericField
      id="match-overtime-tuh"
      label="TU read"
      value={otTuh}
      error={status === ValidationStatuses.Error}
      helperText={message || 'Total overtime tossups'}
      slotProps={{ htmlInput: { min: 0, 'aria-label': 'Overtime tossups read' } }}
      onChange={(event) => handleChange(event.target.value)}
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

function OvertimeTable() {
  const modalManager = useContext(MatchEditModalContext);
  const { answerTypes } = modalManager.tournament.scoringRules;

  return (
    <Table size="small" aria-label="Overtime scoring" sx={{ minWidth: 300 }}>
      <TableHead>
        <TableRow>
          <TableCell>Team</TableCell>
          {answerTypes.map((answerType) => (
            <TableCell key={answerType.id} align="right" title={answerType.label}>
              {answerType.shortLabel}
            </TableCell>
          ))}
        </TableRow>
      </TableHead>
      <TableBody>
        <OvertimeBuzzesRow whichTeam="left" />
        <OvertimeBuzzesRow whichTeam="right" />
      </TableBody>
    </Table>
  );
}

function OvertimeBuzzesRow(props: { whichTeam: LeftOrRight }) {
  const { whichTeam } = props;
  const modalManager = useContext(MatchEditModalContext);
  const matchTeam = modalManager.tempMatch.getMatchTeam(whichTeam);
  const enabled = modalManager.otFieldsEnabledOverride;
  const teamLabel = matchTeam.team?.name || (whichTeam === 'left' ? 'Team A' : 'Team B');

  return (
    <TableRow>
      <TableCell component="th" scope="row" sx={{ maxWidth: 220 }}>
        <Typography variant="body2" noWrap title={teamLabel}>
          {teamLabel}
        </Typography>
      </TableCell>
      {matchTeam.overTimeBuzzes.map((answerCount) => (
        <TableCell key={answerCount.answerType.id} align="right">
          <OvertimeBuzzField answerCount={answerCount} whichTeam={whichTeam} disabled={!enabled || !matchTeam.team} />
        </TableCell>
      ))}
    </TableRow>
  );
}

function OvertimeBuzzField(props: { answerCount: PlayerAnswerCount; whichTeam: LeftOrRight; disabled: boolean }) {
  const { answerCount, whichTeam, disabled } = props;
  const modalManager = useContext(MatchEditModalContext);
  const [current, setCurrent] = useSubscription(answerCount.number?.toString() || '');
  const invalid = answerCount.validation.status === ValidationStatuses.Error;
  const errorDescriptionId = `match-${whichTeam}-overtime-${answerCount.answerType.value}-error`;

  const commit = () => {
    const value = modalManager.setAnswerCount(answerCount, current, true);
    setCurrent(value?.toString() || '');
  };

  return (
    <>
      <YfNumericField
        id={`match-${whichTeam}-overtime-${answerCount.answerType.value}`}
        variant="standard"
        hiddenLabel
        disabled={disabled}
        value={current}
        error={invalid}
        slotProps={{
          htmlInput: {
            min: 0,
            inputMode: 'numeric',
            'aria-label': `${whichTeam === 'left' ? 'Team A' : 'Team B'} overtime ${answerCount.answerType.label}`,
            'aria-invalid': invalid || undefined,
            'aria-describedby': invalid ? errorDescriptionId : undefined,
          },
        }}
        sx={{ width: '6ch', '& .MuiInputBase-input': { px: 0.25, textAlign: 'right' } }}
        onChange={(event) => setCurrent(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
      />
      {invalid && (
        <Box component="span" id={errorDescriptionId} sx={visuallyHiddenSx}>
          {answerCount.validation.message}
        </Box>
      )}
    </>
  );
}

const visuallyHiddenSx = {
  border: 0,
  clip: 'rect(0 0 0 0)',
  height: 1,
  margin: -1,
  overflow: 'hidden',
  padding: 0,
  position: 'absolute' as const,
  whiteSpace: 'nowrap' as const,
  width: 1,
};
