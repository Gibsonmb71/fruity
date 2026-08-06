import { useContext, useEffect, useState } from 'react';
import { Box, Button, Collapse, Paper, Stack, TextField, Typography } from '@mui/material';
import { MatchEditModalContext } from '../Modal Managers/TempMatchManager';
import { trunc } from '../Utils/GeneralUtils';
import useSubscription from '../Utils/CustomHooks';

export default function MatchNotesEditor() {
  const modalManager = useContext(MatchEditModalContext);
  const [notes, setNotes] = useSubscription(modalManager.tempMatch.notes || '');
  const [expanded, setExpanded] = useState(Boolean(modalManager.tempMatch.notes));

  useEffect(() => {
    setExpanded(Boolean(modalManager.tempMatch.notes));
    // A new temporary match is created for each Save & New cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalManager.tempMatch]);

  const commit = () => modalManager.setNotes(notes);
  const hasNotes = notes.trim() !== '';
  let actionLabel = 'Add note';
  if (expanded) actionLabel = 'Hide notes';
  else if (hasNotes) actionLabel = 'Edit note';

  return (
    <Paper component="section" variant="outlined" aria-labelledby="match-notes-heading" sx={{ minWidth: 0 }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', justifyContent: 'space-between', px: { xs: 1.25, sm: 1.5 }, py: 0.75 }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography id="match-notes-heading" component="h2" variant="subtitle1">
            Notes
          </Typography>
          {!expanded && hasNotes && (
            <Typography variant="caption" color="text.secondary" noWrap>
              {trunc(notes, 90)}
            </Typography>
          )}
        </Box>
        <Button size="small" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls="notes-form">
          {actionLabel}
        </Button>
      </Stack>
      <Collapse in={expanded} id="notes-form">
        <Box sx={{ borderTop: 1, borderColor: 'divider', p: { xs: 1.25, sm: 1.5 } }}>
          <TextField
            id="match-notes"
            multiline
            minRows={2}
            maxRows={6}
            fullWidth
            spellCheck={false}
            value={notes}
            placeholder="Optional notes about this game"
            onChange={({ target: { value } }) => {
              setNotes(value);
              modalManager.setNotes(value);
            }}
            onBlur={commit}
            slotProps={{ htmlInput: { 'aria-label': 'Game notes' } }}
          />
        </Box>
      </Collapse>
    </Paper>
  );
}
