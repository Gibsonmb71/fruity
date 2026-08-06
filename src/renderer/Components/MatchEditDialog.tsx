/* eslint-disable react/require-default-props */
import { useContext, useEffect, useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  Stack,
  Typography,
} from '@mui/material';
import { MatchEditModalContext } from '../Modal Managers/TempMatchManager';
import { TournamentContext } from '../TournamentManager';
import useSubscription from '../Utils/CustomHooks';
import { YfCancelButton, hotkeyFormat } from '../Utils/GeneralReactUtils';
import MatchDetailsBar from './MatchDetailsBar';
import MatchNotesEditor from './MatchNotesEditor';
import MatchOvertimeEditor from './MatchOvertimeEditor';
import MatchTeamEditor from './MatchTeamEditor';
import MatchValidationSummary from './MatchValidationSummary';

export default function MatchEditDialog() {
  const tournManager = useContext(TournamentContext);
  const [, setUpdateNeeded] = useState({});
  const [manager] = useState(tournManager.matchModalManager);

  useEffect(() => {
    manager.dataChangedReactCallback = () => setUpdateNeeded({});
    return () => {
      manager.dataChangedReactCallback = () => {};
    };
  }, [manager]);

  return (
    <MatchEditModalContext.Provider value={manager}>
      <MatchEditDialogCore />
    </MatchEditModalContext.Provider>
  );
}

function MatchEditDialogCore() {
  const tournManager = useContext(TournamentContext);
  const modalManager = useContext(MatchEditModalContext);
  const [isOpen] = useSubscription(modalManager.modalIsOpen);
  const [revealHiddenErrors, setRevealHiddenErrors] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const totalTuhInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setRevealHiddenErrors(false);
    setFocusRequest(0);
  }, [isOpen, modalManager.tempMatch]);

  const handleSave = (stayOpen: boolean = false) => {
    // Alt+A/Alt+S can fire while a numeric or text field still owns focus. Blur first so the
    // field's existing commit handler runs before the authoritative manager validation.
    (document.activeElement as HTMLElement | null)?.blur();
    modalManager.markSaveAttempted();
    setRevealHiddenErrors(true);
    const saved = tournManager.matchEditModalAttemptToSave(stayOpen);
    if (!saved) {
      setFocusRequest((request) => request + 1);
      return;
    }
    setRevealHiddenErrors(false);
    setFocusRequest(0);
    if (stayOpen) {
      window.setTimeout(() => {
        const nextInput = tournManager.tournament.scoringRules.timed
          ? totalTuhInputRef.current
          : document.getElementById('match-left-team-input');
        (nextInput as HTMLElement | null)?.focus();
      }, 0);
    }
  };

  const handleCancel = () => {
    tournManager.matchEditModalReset();
  };

  useHotkeys('alt+c', handleCancel, { enabled: isOpen, enableOnFormTags: true });
  useHotkeys('alt+s', () => handleSave(true), { enabled: isOpen, enableOnFormTags: true });
  useHotkeys('alt+a', () => handleSave(), { enabled: isOpen, enableOnFormTags: true });

  const editingExisting = !!modalManager.originalMatchLoaded;
  const scheduledContext = modalManager.scheduledMatchContext;
  const configuredRoom = scheduledContext?.roomId
    ? modalManager.tournament.rooms.find((room) => room.id === scheduledContext.roomId)
    : undefined;
  const roomName = scheduledContext?.roomNameAtPlay || configuredRoom?.name;
  const contextLabel = scheduledContext
    ? `Round ${scheduledContext.roundNumber}${roomName ? ` · ${roomName}` : ''}`
    : modalManager.tempMatch.location || undefined;
  const leftName = modalManager.tempMatch.leftTeam.team?.name;
  const rightName = modalManager.tempMatch.rightTeam.team?.name;

  return (
    <>
      <Dialog
        fullWidth
        maxWidth="xl"
        open={isOpen}
        onClose={handleCancel}
        scroll="paper"
        aria-labelledby="match-editor-title"
        slotProps={{
          paper: {
            sx: {
              maxHeight: 'calc(100vh - 32px)',
              display: 'flex',
              flexDirection: 'column',
            },
          },
        }}
      >
        <DialogTitle id="match-editor-title" sx={{ flexShrink: 0 }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={{ xs: 0.25, sm: 2 }}
            sx={{ alignItems: { sm: 'baseline' }, justifyContent: 'space-between' }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography component="span" variant="h2" sx={{ fontSize: '1.1rem' }}>
                {editingExisting ? 'Edit Game' : 'Add Game'}
              </Typography>
              {contextLabel && (
                <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                  {contextLabel}
                </Typography>
              )}
            </Box>
            {leftName && rightName && (
              <Typography variant="body2" color="text.secondary" noWrap>
                {leftName}{' '}
                <Box component="span" sx={{ mx: 0.5, color: 'text.disabled' }}>
                  vs
                </Box>{' '}
                {rightName}
              </Typography>
            )}
          </Stack>
        </DialogTitle>
        <DialogContent
          sx={{ minHeight: 0, overflowY: 'auto', px: { xs: 1.25, sm: 2 }, py: { xs: 1.25, sm: 1.5 } }}
          onChangeCapture={() => modalManager.markEditorInteracted()}
        >
          <MatchDetailsBar totalTuhInputRef={totalTuhInputRef} />
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' },
              gap: 1.5,
              alignItems: 'start',
            }}
          >
            <MatchTeamEditor whichTeam="left" />
            <MatchTeamEditor whichTeam="right" />
          </Box>
          <Box sx={{ display: 'grid', gap: 1.5, mt: 1.5 }}>
            <MatchOvertimeEditor />
            <MatchNotesEditor />
          </Box>
        </DialogContent>
        <DialogActions
          sx={{
            flexShrink: 0,
            alignItems: 'flex-end',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            backgroundColor: 'background.paper',
            borderTop: 1,
            borderColor: 'divider',
          }}
        >
          <Box sx={{ flex: '1 1 360px', minWidth: 0, maxWidth: { sm: '70%' } }}>
            <MatchValidationSummary revealHiddenErrors={revealHiddenErrors} focusRequest={focusRequest} />
          </Box>
          <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0, alignItems: 'center' }}>
            <YfCancelButton onClick={handleCancel}>{hotkeyFormat('&Cancel')}</YfCancelButton>
            <Button variant="outlined" onClick={() => handleSave(true)}>
              {hotkeyFormat('&Save {AMP} New')}
            </Button>
            <Button
              variant="contained"
              onClick={() => handleSave()}
              title="Save Game (Alt+A)"
              aria-keyshortcuts="Alt+A"
            >
              Save Game
            </Button>
          </Stack>
        </DialogActions>
      </Dialog>
      <ErrorDialog />
    </>
  );
}

function ErrorDialog() {
  const modalManager = useContext(MatchEditModalContext);
  const [isOpen] = useSubscription(modalManager.errorDialogIsOpen);
  const [contents] = useSubscription(modalManager.errorDialogContents);
  const close = () => modalManager.closeErrorDialog();

  useHotkeys('alt+g', close, { enabled: isOpen });

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onClose={close} aria-labelledby="match-error-title">
      <DialogTitle id="match-error-title">Unable to save match</DialogTitle>
      <DialogContent>
        <List dense>
          {contents.map((content) => (
            <ListItem key={content} disableGutters>
              {content}
            </ListItem>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{hotkeyFormat('&Go Back')}</Button>
      </DialogActions>
    </Dialog>
  );
}
