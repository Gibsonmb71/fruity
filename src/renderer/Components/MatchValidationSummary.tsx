/* eslint-disable react/require-default-props */
import { useContext, useEffect } from 'react';
import { Box, Button, ButtonBase, Stack, Typography } from '@mui/material';
import { CheckCircleOutlined, ErrorOutlined, InfoOutlined, Restore, WarningAmber } from '@mui/icons-material';
import { MatchEditModalContext } from '../Modal Managers/TempMatchManager';
import MatchValidationMessage, { MatchValidationType } from '../DataModel/MatchValidationMessage';
import { ValidationStatuses } from '../DataModel/Interfaces';
import { LeftOrRight } from '../Utils/UtilTypes';
import { isPristineNewMatch } from '../Services/MatchEditorPresentation';

export interface IMatchValidationIssue {
  key: string;
  validator: MatchValidationMessage;
  targetId?: string;
  whichTeam?: LeftOrRight;
}

interface IMatchValidationSummaryProps {
  revealHiddenErrors: boolean;
  focusRequest: number;
}

export function focusMatchEditorField(targetId?: string) {
  if (!targetId || typeof document === 'undefined') return;
  const element = document.getElementById(targetId) as HTMLElement | null;
  if (!element) return;
  element.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  element.focus?.();
  element.classList.add('yf-match-field-highlight');
  window.setTimeout(() => element.classList.remove('yf-match-field-highlight'), 1400);
}

export default function MatchValidationSummary(props: IMatchValidationSummaryProps) {
  const { revealHiddenErrors, focusRequest } = props;
  const modalManager = useContext(MatchEditModalContext);
  const pristine = isPristineNewMatch(
    modalManager.validationInteractionState,
    modalManager.originalMatchLoaded !== undefined,
  );
  const saveAttempted = revealHiddenErrors || modalManager.validationInteractionState === 'save-attempted';
  const allIssues = collectValidationIssues(modalManager);
  const visibleIssues = allIssues.filter(
    (issue) =>
      !pristine &&
      !issue.validator.isSuppressed &&
      (issue.validator.status !== ValidationStatuses.HiddenError || saveAttempted),
  );
  const blockingErrors = allIssues.filter(
    (issue) => !pristine && !issue.validator.isSuppressed && issue.validator.status === ValidationStatuses.Error,
  );
  const warnings = allIssues.filter(
    (issue) => !pristine && !issue.validator.isSuppressed && issue.validator.status === ValidationStatuses.Warning,
  );
  const hiddenRequired = allIssues.filter(
    (issue) => !pristine && !issue.validator.isSuppressed && issue.validator.status === ValidationStatuses.HiddenError,
  );
  const suppressedCount = modalManager.tempMatch.getNumSuppressedWarnings();
  const displayedBlockingErrorCount = blockingErrors.length + (saveAttempted ? hiddenRequired.length : 0);

  useEffect(() => {
    if (focusRequest === 0) return undefined;
    const handle = window.setTimeout(() => {
      const firstIssue = document.querySelector<HTMLElement>('[data-yf-first-validation="true"]');
      firstIssue?.click();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [focusRequest]);

  const handleIgnore = (issue: IMatchValidationIssue) => {
    modalManager.suppressValidationMessage(issue.validator.type, issue.whichTeam);
  };

  return (
    <Box sx={{ minWidth: 0, width: '100%' }} aria-live="polite">
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', minHeight: 24 }}>
        <ValidationStatusIcon
          hasErrors={displayedBlockingErrorCount > 0}
          hasWarnings={warnings.length > 0}
          hasHiddenRequired={!pristine && hiddenRequired.length > 0}
          pristine={pristine}
        />
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {validationSummaryLabel(
            displayedBlockingErrorCount,
            warnings.length,
            hiddenRequired.length,
            saveAttempted,
            pristine,
          )}
        </Typography>
        {suppressedCount > 0 && (
          <Button
            size="small"
            variant="text"
            startIcon={<Restore fontSize="small" />}
            onClick={() => modalManager.restoreSuppressedMsgs()}
            sx={{ ml: 'auto', whiteSpace: 'nowrap' }}
          >
            {suppressedCount} ignored warning{suppressedCount === 1 ? '' : 's'} · Restore
          </Button>
        )}
      </Stack>
      {visibleIssues.length > 0 && (
        <Stack
          component="ul"
          spacing={0.25}
          sx={{ listStyle: 'none', p: 0, m: 0, mt: 0.5, maxHeight: 96, overflowY: 'auto' }}
        >
          {visibleIssues.map((issue, index) => (
            <ValidationIssueRow
              key={issue.key}
              issue={issue}
              first={index === 0}
              onFocus={() => focusMatchEditorField(issue.targetId)}
              onIgnore={() => handleIgnore(issue)}
            />
          ))}
        </Stack>
      )}
    </Box>
  );
}

function ValidationIssueRow(props: {
  issue: IMatchValidationIssue;
  first: boolean;
  onFocus: () => void;
  onIgnore: () => void;
}) {
  const { issue, first, onFocus, onIgnore } = props;
  let severityColor = 'info.main';
  if (
    issue.validator.status === ValidationStatuses.Error ||
    issue.validator.status === ValidationStatuses.HiddenError
  ) {
    severityColor = 'error.main';
  } else if (issue.validator.status === ValidationStatuses.Warning) {
    severityColor = 'warning.main';
  }

  return (
    <Stack component="li" direction="row" spacing={0.5} sx={{ alignItems: 'center', minWidth: 0 }}>
      <ButtonBase
        component="button"
        type="button"
        data-yf-first-validation={first ? 'true' : undefined}
        onClick={onFocus}
        sx={{
          minWidth: 0,
          flex: 1,
          justifyContent: 'flex-start',
          textAlign: 'left',
          borderRadius: 0.5,
          px: 0.5,
          py: 0.25,
          color: severityColor,
        }}
      >
        <Typography variant="caption" noWrap title={issue.validator.message}>
          {issue.validator.message}
        </Typography>
      </ButtonBase>
      {issue.validator.suppressable && issue.validator.status === ValidationStatuses.Warning && (
        <Button size="small" onClick={onIgnore} sx={{ minWidth: 48, py: 0 }}>
          Ignore
        </Button>
      )}
    </Stack>
  );
}

function ValidationStatusIcon(props: {
  hasErrors: boolean;
  hasWarnings: boolean;
  hasHiddenRequired: boolean;
  pristine: boolean;
}) {
  const { hasErrors, hasWarnings, hasHiddenRequired, pristine } = props;
  if (hasErrors) return <ErrorOutlined color="error" fontSize="small" />;
  if (hasWarnings) return <WarningAmber color="warning" fontSize="small" />;
  if (hasHiddenRequired) return <InfoOutlined color="info" fontSize="small" />;
  if (pristine) return <InfoOutlined color="disabled" fontSize="small" />;
  return <CheckCircleOutlined color="success" fontSize="small" />;
}

function validationSummaryLabel(
  errorCount: number,
  warningCount: number,
  hiddenRequiredCount: number,
  revealHiddenErrors: boolean,
  pristine: boolean,
) {
  if (pristine) return 'Enter game details';
  if (errorCount > 0) return `${errorCount} ${errorCount === 1 ? 'problem' : 'problems'} prevent saving`;
  if (hiddenRequiredCount > 0 && !revealHiddenErrors) return 'Complete required fields to validate the game';
  if (warningCount > 0) return `${warningCount} ${warningCount === 1 ? 'warning' : 'warnings'}`;
  return 'Game totals are consistent';
}

export function collectValidationIssues(modalManager: import('../Modal Managers/TempMatchManager').TempMatchManager) {
  const match = modalManager.tempMatch;
  const issues: IMatchValidationIssue[] = [];
  const add = (validator: MatchValidationMessage, key: string, targetId?: string, whichTeam?: LeftOrRight) => {
    if (validator.status === ValidationStatuses.Ok) return;
    issues.push({ key, validator, targetId, whichTeam });
  };

  add(match.totalTuhFieldValidation, 'match-total-tuh', 'match-total-tuh');
  add(match.overtimeTuhFieldValidation, 'match-overtime-tuh', 'match-overtime-tuh');
  match.modalBottomValidation.validators.forEach((validator) => {
    add(validator, `match-${validator.type}`, targetForMatchValidator(validator.type, modalManager));
  });

  (['left', 'right'] as LeftOrRight[]).forEach((whichTeam) => {
    const matchTeam = match.getMatchTeam(whichTeam);
    const hasTeam = !!matchTeam.team;
    add(
      matchTeam.totalScoreFieldValidation,
      `${whichTeam}-score-field`,
      hasTeam ? `match-${whichTeam}-score` : `match-${whichTeam}-team-input`,
      whichTeam,
    );
    add(
      matchTeam.bouncebackFieldValidation,
      `${whichTeam}-bounceback-field`,
      `match-${whichTeam}-bounceback`,
      whichTeam,
    );
    matchTeam.modalBottomValidation.validators.forEach((validator) => {
      add(
        validator,
        `${whichTeam}-${validator.type}`,
        targetForTeamValidator(validator.type, whichTeam, modalManager),
        whichTeam,
      );
    });
    matchTeam.matchPlayers.forEach((matchPlayer, rowNumber) => {
      add(
        matchPlayer.tuhValidation,
        `${whichTeam}-player-${rowNumber}-tuh`,
        `match-${whichTeam}-player-${rowNumber}-tuh`,
        whichTeam,
      );
      add(
        matchPlayer.totalBuzzesValidation,
        `${whichTeam}-player-${rowNumber}-buzzes`,
        `match-${whichTeam}-player-${rowNumber}-tuh`,
        whichTeam,
      );
      matchPlayer.answerCounts.forEach((answerCount) => {
        add(
          answerCount.validation,
          `${whichTeam}-player-${rowNumber}-answer-${answerCount.answerType.value}`,
          `match-${whichTeam}-player-${rowNumber}-answer-${answerCount.answerType.value}`,
          whichTeam,
        );
      });
    });
    matchTeam.overTimeBuzzes.forEach((answerCount) => {
      add(
        answerCount.validation,
        `${whichTeam}-overtime-${answerCount.answerType.value}`,
        `match-${whichTeam}-overtime-${answerCount.answerType.value}`,
        whichTeam,
      );
    });
  });

  return issues;
}

function targetForMatchValidator(
  type: MatchValidationType,
  modalManager: import('../Modal Managers/TempMatchManager').TempMatchManager,
) {
  switch (type) {
    case MatchValidationType.MissingTeams:
      return modalManager.tempMatch.leftTeam.team ? 'match-right-team-input' : 'match-left-team-input';
    case MatchValidationType.TeamPlayingItself:
      return 'match-right-team-input';
    case MatchValidationType.TieGame:
    case MatchValidationType.MatchHasTooConvertedTU:
    case MatchValidationType.OtButRegScoreNotTied:
      return 'match-left-score';
    case MatchValidationType.TeamsNotInSamePool:
    case MatchValidationType.TeamAlreadyPlayedInRound:
      return 'match-left-team-input';
    case MatchValidationType.LowTotalTuh:
    case MatchValidationType.RegulationTuhNotStandard:
    case MatchValidationType.TotalOtBuzzesExceedsTuh:
    case MatchValidationType.OtTuhLessThanMinimum:
    case MatchValidationType.OvertimeTuhTooHigh:
      return 'match-total-tuh';
    default:
      return undefined;
  }
}

function targetForTeamValidator(
  type: MatchValidationType,
  whichTeam: LeftOrRight,
  modalManager: import('../Modal Managers/TempMatchManager').TempMatchManager,
) {
  const matchTeam = modalManager.tempMatch.getMatchTeam(whichTeam);
  switch (type) {
    case MatchValidationType.MissingTotalPoints:
    case MatchValidationType.InvalidTeamScore:
    case MatchValidationType.TotalScoreAndTuPtsMismatch:
    case MatchValidationType.TuPlusLtngNotEqualTotal:
      return matchTeam.team ? `match-${whichTeam}-score` : `match-${whichTeam}-team-input`;
    case MatchValidationType.InvalidBouncebackPoints:
    case MatchValidationType.BouncebackConvOver100:
    case MatchValidationType.BouncebackDivisorMismatch:
      return `match-${whichTeam}-bounceback`;
    case MatchValidationType.LightningDivisorMismatch:
      return `match-${whichTeam}-lightning`;
    default:
      return `match-${whichTeam}-team-input`;
  }
}
