import { useContext, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useHotkeys } from 'react-hotkeys-hook';
import { Cancel, Close, Upload } from '@mui/icons-material';
import { TournamentContext } from '../TournamentManager';
import useSubscription from '../Utils/CustomHooks';
import { YfAcceptButton, YfCancelButton } from '../Utils/GeneralReactUtils';
import { MatchImportResultsModalContext } from '../Modal Managers/MatchImportResultsManager';
import MatchImportResult, { ImportResultStatus } from '../DataModel/MatchImportResult';
import { getFileNameFromPath } from '../Utils/GeneralUtils';

export default function MatchImportResultDialog() {
  const tournManager = useContext(TournamentContext);
  const [, setUpdateNeeded] = useState({}); // set this object to a new object whenever we want to force a re-render
  const [mgr] = useState(tournManager.matchImportResultsManager);
  useEffect(() => {
    mgr.dataChangedReactCallback = () => {
      setUpdateNeeded({});
    };
  }, [mgr]);

  return (
    <MatchImportResultsModalContext.Provider value={mgr}>
      <MatchImportResultDialogCore />
    </MatchImportResultsModalContext.Provider>
  );
}

enum ResultTableColumns {
  RoundNo,
  FileName,
  MatchTitle,
  Message,
  ImportOrSkip,
}

const linkOptions = {
  scheduled: 'Import as scheduled result',
  ordinary: 'Import as ordinary game',
};

/**
 * The offer made when a file plainly belongs to a game the Match Plan is still waiting on.
 *
 * Shown only when exactly one unresolved scheduled game fits. The round, teams and room are printed
 * rather than summarized so the director is confirming a specific game rather than agreeing with
 * the software; if it is the wrong one, the ordinary import is right there and costs nothing.
 */
function ScheduledLinkOffer({ result }: { result: MatchImportResult }) {
  const modalManager = useContext(MatchImportResultsModalContext);
  const suggestion = modalManager.suggestionFor(result);
  const outcome = modalManager.outcomeFor(result);
  const [choice, setChoice] = useSubscription(modalManager.choiceFor(result));

  if (outcome?.kind === 'accepted') {
    return (
      <Alert severity="warning" sx={{ mt: 1 }}>
        This round already has an accepted result for these teams. Importing this file will add a second, unlinked game.
      </Alert>
    );
  }
  if (outcome?.kind === 'backup') {
    return (
      <Alert severity="success" sx={{ mt: 1 }}>
        Backup copy matches the accepted server result. YellowFruit will keep the existing Match and will not add a
        duplicate.
      </Alert>
    );
  }
  if (outcome?.kind === 'conflict') {
    return (
      <Alert severity="error" sx={{ mt: 1 }}>
        RESULT COPIES DO NOT MATCH. The accepted server result is preserved; review this uploaded QBJ separately before
        deciding what to do.
      </Alert>
    );
  }
  if (outcome?.kind === 'stale') {
    return (
      <Alert severity="warning" sx={{ mt: 1 }}>
        This QBJ was scored against assignment revision {outcome.sourceRevision}, but the current assignment revision is{' '}
        {outcome.currentRevision}. It needs director review and will not be linked automatically.
      </Alert>
    );
  }
  if (outcome?.kind === 'ambiguous') {
    return (
      <Alert severity="info" sx={{ mt: 1 }}>
        {outcome.count} unresolved scheduled games match this round and pairing. YellowFruit cannot choose safely;
        manual linking is required.
      </Alert>
    );
  }
  if (!suggestion) return null;

  return (
    <Alert severity="info" sx={{ mt: 1 }}>
      <Typography variant="body2" sx={{ mb: 1 }}>
        This appears to be the result for:
      </Typography>
      <Typography variant="body2">
        <strong>Round {suggestion.roundName}</strong>
      </Typography>
      <Typography variant="body2">
        {suggestion.leftTeam} vs {suggestion.rightTeam}
      </Typography>
      {suggestion.roomName !== undefined && <Typography variant="body2">{suggestion.roomName}</Typography>}
      <ToggleButtonGroup
        size="small"
        color="primary"
        exclusive
        sx={{ mt: 1 }}
        value={choice}
        onChange={(e, newValue) => {
          if (newValue === null) return;
          setChoice(newValue);
          modalManager.setLinkChoice(result, newValue);
        }}
      >
        <ToggleButton value="scheduled">{linkOptions.scheduled}</ToggleButton>
        <ToggleButton value="ordinary">{linkOptions.ordinary}</ToggleButton>
      </ToggleButtonGroup>
    </Alert>
  );
}

const sectionHelpText = {
  [ImportResultStatus.Success]: 'These games can be imported with no issues',
  [ImportResultStatus.Warning]: 'These games are valid, but might be inaccurate',
  [ImportResultStatus.ErrNonFatal]:
    "These games can be imported, but they won't count toward the standings until you correct the errors shown",
  [ImportResultStatus.FatalErr]: "YellowFruit can't use the contents of these files. Fix the issues and try again.",
};

function MatchImportResultDialogCore() {
  const tournManager = useContext(TournamentContext);
  const modalManager = useContext(MatchImportResultsModalContext);
  const [isOpen] = useSubscription(modalManager.modalIsOpen);
  const [round] = useSubscription(modalManager.round);
  const acceptButtonRef = useRef<HTMLButtonElement>(null);

  const allResults = modalManager.resultsList || [];
  const successes = allResults.filter((r) => r.status === ImportResultStatus.Success);
  const warnings = allResults.filter((r) => r.status === ImportResultStatus.Warning);
  const errs = allResults.filter((r) => r.status === ImportResultStatus.ErrNonFatal);
  const fatals = allResults.filter((r) => r.status === ImportResultStatus.FatalErr);
  const couldImportAnything = successes.length > 0 || warnings.length > 0 || errs.length > 0;
  const dialogTitle = round ? `Round ${round.name} Import Preview` : 'Import Preview';

  const handleAccept = () => {
    acceptButtonRef.current?.focus();
    tournManager.closeMatchImportModal(true);
  };

  const handleCancel = () => {
    tournManager.closeMatchImportModal(false);
  };

  useHotkeys('alt+c', () => handleCancel(), { enabled: isOpen, enableOnFormTags: true });
  useHotkeys('alt+a', () => handleAccept(), { enabled: isOpen && couldImportAnything, enableOnFormTags: true });

  return (
    <Dialog open={isOpen} fullWidth maxWidth="xl" onClose={handleCancel}>
      <DialogTitle>{dialogTitle}</DialogTitle>
      <DialogContent>
        {successes.length > 0 && (
          <>
            <Typography variant="subtitle2">Success</Typography>
            <Box sx={{ mt: 0.5 }}>
              <Alert severity="success" sx={{ marginBottom: 1 }}>
                {sectionHelpText[ImportResultStatus.Success]}
              </Alert>
              <ResultTable resultList={successes} showRoundCol={!round} />
            </Box>
          </>
        )}
        {warnings.length > 0 && (
          <>
            <Typography variant="subtitle2" sx={{ mt: 2 }}>
              Games with warnings
            </Typography>
            <Box sx={{ mt: 0.5 }}>
              <Alert severity="warning" sx={{ marginBottom: 1 }}>
                {sectionHelpText[ImportResultStatus.Warning]}
              </Alert>
              <ResultTable resultList={warnings} showRoundCol={!round} />
            </Box>
          </>
        )}
        {errs.length > 0 && (
          <>
            <Typography variant="subtitle2" sx={{ mt: 2 }}>
              Games with errors
            </Typography>
            <Box sx={{ mt: 0.5 }}>
              <Alert severity="error" sx={{ marginBottom: 1 }}>
                {sectionHelpText[ImportResultStatus.ErrNonFatal]}
              </Alert>
              <ResultTable resultList={errs} showRoundCol={!round} />
            </Box>
          </>
        )}
        {fatals.length > 0 && (
          <>
            <Typography variant="subtitle2" sx={{ mt: 2 }}>
              Cannot be imported
            </Typography>
            <Box sx={{ mt: 0.5 }}>
              <Alert severity="error" icon={<Cancel />} sx={{ marginBottom: 1 }}>
                {sectionHelpText[ImportResultStatus.FatalErr]}
              </Alert>
              <ResultTable resultList={fatals} showRoundCol={!round} />
            </Box>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <YfCancelButton onClick={handleCancel} />
        <YfAcceptButton onClick={handleAccept} disabled={!couldImportAnything} ref={acceptButtonRef} />
      </DialogActions>
    </Dialog>
  );
}

interface IResultTableProps {
  resultList: MatchImportResult[];
  showRoundCol: boolean;
}

function ResultTable(props: IResultTableProps) {
  const { resultList, showRoundCol } = props;

  if (resultList.length === 0) {
    return <Box sx={{ px: 2 }}>None</Box>;
  }

  return (
    <TableContainer sx={{ border: 1, borderRadius: 1, borderColor: 'divider' }}>
      <Table size="small">
        <TableBody>
          {resultList.map((rslt, idx) => (
            // eslint-disable-next-line react/no-array-index-key
            <ResultTableRow key={idx} result={rslt} showRoundCol={showRoundCol} />
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

interface IResultTableRowProps {
  result: MatchImportResult;
  showRoundCol: boolean;
}

const toggleOptions = {
  keep: 'Import',
  discard: 'Discard',
};

function ResultTableRow(props: IResultTableRowProps) {
  const { result, showRoundCol } = props;
  const modalManager = useContext(MatchImportResultsModalContext);
  const [keepResult, setKeepResult] = useSubscription(result.proceedWithImport);
  if (result.status === undefined) return null;

  const cols = getColumnList(result.status, showRoundCol);

  return (
    <TableRow>
      {cols.includes(ResultTableColumns.RoundNo) && (
        <TableCell width="10%">{`Round ${result.round?.number ?? 'unknown'}`}</TableCell>
      )}
      {cols.includes(ResultTableColumns.FileName) && (
        <TableCell width="20%">{getFileNameFromPath(result.filePath)}</TableCell>
      )}
      {cols.includes(ResultTableColumns.MatchTitle) && (
        <TableCell>
          {result.match?.getScoreString()}
          <ScheduledLinkOffer result={result} />
        </TableCell>
      )}
      {cols.includes(ResultTableColumns.Message) && (
        <TableCell>
          <MessageList messages={result.messages} />
        </TableCell>
      )}
      {cols.includes(ResultTableColumns.ImportOrSkip) && (
        <TableCell width="10%">
          <ToggleButtonGroup
            size="small"
            color="primary"
            exclusive
            value={keepResult ? toggleOptions.keep : toggleOptions.discard}
            onChange={(e, newValue) => {
              if (newValue === null) return;
              setKeepResult(newValue === toggleOptions.keep);
              modalManager.setProceedWithImport(result, newValue === toggleOptions.keep);
            }}
          >
            <ToggleButton value={toggleOptions.keep}>
              <Upload />
              {toggleOptions.keep}
            </ToggleButton>
            <ToggleButton value={toggleOptions.discard}>
              <Close /> {toggleOptions.discard}
            </ToggleButton>
          </ToggleButtonGroup>
        </TableCell>
      )}
    </TableRow>
  );
}

interface IMessageListProps {
  messages: string[];
}

function MessageList(props: IMessageListProps) {
  const { messages } = props;

  return messages.map((msg, idx) => (
    <span key={msg}>
      {msg}
      {idx < messages.length - 1 && <br />}
    </span>
  ));
}

function getColumnList(status: ImportResultStatus, showRoundCol: boolean) {
  const cols: ResultTableColumns[] = [];
  if (showRoundCol) {
    cols.push(ResultTableColumns.RoundNo);
  }
  cols.push(ResultTableColumns.FileName);

  if (status !== ImportResultStatus.FatalErr) {
    cols.push(ResultTableColumns.MatchTitle);
  }
  if (status !== ImportResultStatus.Success) {
    cols.push(ResultTableColumns.Message);
  }
  if (status !== ImportResultStatus.FatalErr) {
    cols.push(ResultTableColumns.ImportOrSkip);
  }
  return cols;
}
