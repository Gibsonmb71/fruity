import {
  Box,
  Button,
  FormControl,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import { useContext, useState } from 'react';
import { DatePicker } from '@mui/x-date-pickers';
import dayjs from 'dayjs';
import { Delete, Restore } from '@mui/icons-material';
import { TournamentContext } from '../TournamentManager';
import useSubscription from '../Utils/CustomHooks';
import YfCard from './YfCard';
import { NullDate } from '../Utils/UtilTypes';
import { YfFieldGrid, YfFieldRow, YfNotice, YfPageHeader, YfToggleGrid, YfToggleRow } from '../Utils/GeneralReactUtils';
import { Round } from '../DataModel/Round';
import { maximumHalfLengthMinutes, maximumTimeoutsPerTeam } from '../Services/RoomProcedure';

/**
 * Beyond this many rounds the packet list would drive the page height on its own, so it scrolls
 * inside its panel instead.
 */
const packetScrollAfterRounds = 8;

interface IGeneralPageProps {
  // eslint-disable-next-line react/require-default-props
  showPageHeader?: boolean;
}

function GeneralPage({ showPageHeader = true }: IGeneralPageProps) {
  return (
    <>
      {showPageHeader && (
        <YfPageHeader title="Tournament" description="What, where and when this tournament is, and what you track." />
      )}
      <BackupRecoveryNotice />
      {/*
        Three panels in two rows, not one panel per field: the two narrow groups sit side by side and
        the switch grid, which is naturally wide and short, spans underneath. Collapses to a single
        column only when there genuinely isn't room for two.
      */}
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <TournamentPanel />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <QuestionSetPanel />
        </Grid>
        <Grid size={{ xs: 12 }}>
          <TrackingPanel />
        </Grid>
        <Grid size={{ xs: 12 }}>
          <GameEntryPanel />
        </Grid>
      </Grid>
    </>
  );
}

function GameEntryPanel() {
  const manager = useContext(TournamentContext);
  const mode = manager.tournament.roomScoringMode;
  const [modeError, setModeError] = useState('');

  const changeMode = async (nextMode: typeof mode) => {
    setModeError('');
    const result = await manager.setRoomScoringMode(nextMode);
    if (!result.ok) setModeError(result.reason ?? 'Browser room scoring could not be disabled.');
  };

  return (
    <YfCard
      title="Game entry"
      helpTopic="control.browser-scoring"
      description="Choose how this tournament's results will be scored."
    >
      <FormControl component="fieldset" fullWidth>
        <RadioGroup
          value={mode}
          onChange={(event) => {
            changeMode(event.target.value as typeof mode);
          }}
          aria-label="Game entry mode"
          sx={{ gap: 0.5 }}
        >
          <FormControlLabel
            value="traditional"
            control={<Radio size="small" />}
            sx={{ alignItems: 'flex-start', m: 0 }}
            label={
              <Box sx={{ pt: 0.25 }}>
                <Typography variant="body2">Traditional YellowFruit</Typography>
                <Typography variant="caption" color="text.secondary">
                  Enter or import results in Games.
                </Typography>
              </Box>
            }
          />
          <FormControlLabel
            value="browser"
            control={<Radio size="small" />}
            sx={{ alignItems: 'flex-start', m: 0 }}
            label={
              <Box sx={{ pt: 0.25 }}>
                <Typography variant="body2">Browser room scoring</Typography>
                <Typography variant="caption" color="text.secondary">
                  {mode === 'browser'
                    ? 'On · moderators or scorekeepers score from room devices.'
                    : 'Off · optional. Enable this when room devices should submit results.'}
                </Typography>
              </Box>
            }
          />
        </RadioGroup>
      </FormControl>
      {mode === 'traditional' && (
        <Button
          size="small"
          variant="outlined"
          sx={{ mt: 1 }}
          onClick={() => {
            changeMode('browser');
          }}
        >
          Enable browser room scoring
        </Button>
      )}
      {mode === 'browser' && (
        <Button
          size="small"
          variant="text"
          color="warning"
          sx={{ mt: 1 }}
          onClick={() => {
            changeMode('traditional');
          }}
        >
          Disable browser room scoring
        </Button>
      )}
      {modeError && (
        <Typography variant="caption" color="error.main" sx={{ display: 'block', mt: 0.75 }} role="alert">
          {modeError}
        </Typography>
      )}
      {mode === 'browser' && <RoomProcedurePanel />}
    </YfCard>
  );
}

/**
 * How rooms conduct a game, as opposed to how one is scored.
 *
 * Sits inside the browser-scoring panel rather than in the scoring rules because none of it changes
 * what a game is worth: halves, a clock and timeouts are not carried by any statistic YellowFruit
 * stores, and local tournaments modify them routinely even when the scoring rules are standard.
 * Everything here is off unless a director turns it on.
 */
function RoomProcedurePanel() {
  const tournManager = useContext(TournamentContext);
  const procedure = tournManager.tournament.roomProcedure;
  const [halfLength, setHalfLength] = useSubscription(
    procedure.halfLengthMinutes === undefined ? '' : String(procedure.halfLengthMinutes),
  );

  const commitHalfLength = () => {
    const trimmed = halfLength.trim();
    const minutes = trimmed === '' ? undefined : Number(trimmed);
    tournManager.setRoomProcedure({
      ...procedure,
      halfLengthMinutes:
        minutes !== undefined && Number.isFinite(minutes) && minutes > 0 && minutes <= maximumHalfLengthMinutes
          ? minutes
          : undefined,
    });
  };

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2">Room procedure</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Optional. Affects only what a room scorekeeper is offered, never how a game is scored.
      </Typography>
      <Stack spacing={1}>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={procedure.halves}
              onChange={(e) =>
                tournManager.setRoomProcedure({
                  ...procedure,
                  halves: e.target.checked,
                  halfLengthMinutes: e.target.checked ? procedure.halfLengthMinutes : undefined,
                })
              }
            />
          }
          label={
            <Box>
              <Typography variant="body2">Play in halves</Typography>
              <Typography variant="caption" color="text.secondary">
                The room stops at the break to confirm the score with the moderator.
              </Typography>
            </Box>
          }
        />
        {procedure.halves && (
          <TextField
            size="small"
            type="number"
            label="Minutes per half"
            helperText="Leave blank when the moderator keeps the clock. YellowFruit stores no default."
            slotProps={{ htmlInput: { min: 1, max: maximumHalfLengthMinutes } }}
            sx={{ maxWidth: 260 }}
            value={halfLength}
            onChange={(e) => setHalfLength(e.target.value)}
            onBlur={commitHalfLength}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitHalfLength();
            }}
          />
        )}
        <TextField
          size="small"
          type="number"
          label="Timeouts per team"
          helperText="Zero means the room does not track timeouts."
          slotProps={{ htmlInput: { min: 0, max: maximumTimeoutsPerTeam } }}
          sx={{ maxWidth: 260 }}
          value={procedure.timeoutsPerTeam}
          onChange={(e) => {
            const value = Number(e.target.value);
            if (!Number.isInteger(value)) return;
            tournManager.setRoomProcedure({
              ...procedure,
              timeoutsPerTeam: Math.min(maximumTimeoutsPerTeam, Math.max(0, value)),
            });
          }}
        />
      </Stack>
    </Box>
  );
}

/** Miscellaneous what/where/when info about the tournament */
function TournamentPanel() {
  const tournManager = useContext(TournamentContext);
  const thisTournament = tournManager.tournament;
  const [tournName, setTournName] = useSubscription(thisTournament.name);
  const [location, setLocation] = useSubscription(thisTournament.tournamentSite.name);
  const initialStartDateVal = NullDate.isNullDate(thisTournament.startDate) ? null : dayjs(thisTournament.startDate);
  const initialEndDateVal = NullDate.isNullDate(thisTournament.endDate) ? null : dayjs(thisTournament.endDate);
  const [startDate, setStartDate] = useSubscription(initialStartDateVal);
  const [endDate, setEndDate] = useSubscription(initialEndDateVal);

  return (
    <YfCard title="Tournament" fullHeight>
      <YfFieldGrid>
        <YfFieldRow label="Name">
          <TextField
            hiddenLabel
            placeholder="Ninety Six Invitational"
            spellCheck={false}
            fullWidth
            value={tournName}
            onChange={(e) => setTournName(e.target.value)}
            onBlur={() => tournManager.setTournamentName(tournName)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') tournManager.setTournamentName(tournName);
            }}
          />
        </YfFieldRow>
        <YfFieldRow label="Location">
          <TextField
            hiddenLabel
            placeholder="Ninety Six High School"
            spellCheck={false}
            fullWidth
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            onBlur={() => tournManager.setTournamentSiteName(location)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') tournManager.setTournamentSiteName(location);
            }}
          />
        </YfFieldRow>
        <YfFieldRow label="Dates">
          <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
            <DatePicker
              value={startDate}
              slotProps={{ textField: { size: 'small', hiddenLabel: true, sx: { width: 150 } } }}
              onChange={(newValue) => {
                setStartDate(newValue);
                tournManager.setTournamentStartDate(newValue);
              }}
            />
            <Typography variant="body2" color="text.secondary">
              to
            </Typography>
            <DatePicker
              value={endDate}
              slotProps={{ textField: { size: 'small', hiddenLabel: true, sx: { width: 150 } } }}
              onChange={(newValue) => {
                setEndDate(newValue);
                tournManager.setTournamentEndDate(newValue);
              }}
            />
          </Stack>
        </YfFieldRow>
      </YfFieldGrid>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.25 }}>
        Leave the end date empty for a single-day tournament.
      </Typography>
    </YfCard>
  );
}

function QuestionSetPanel() {
  const tournManager = useContext(TournamentContext);
  const thisTournament = tournManager.tournament;
  const [qsetName, setQsetName] = useSubscription<string>(thisTournament.questionSet);

  return (
    <YfCard title="Question set" fullHeight>
      <YfFieldGrid>
        <YfFieldRow label="Set name">
          <TextField
            hiddenLabel
            placeholder="2026 NAQT IS-A"
            spellCheck={false}
            fullWidth
            value={qsetName}
            onChange={(e) => setQsetName(e.target.value)}
            onBlur={() => tournManager.setQuestionSetname(qsetName)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') tournManager.setQuestionSetname(qsetName);
            }}
          />
        </YfFieldRow>
      </YfFieldGrid>
      <PacketNames />
    </YfCard>
  );
}

/** Packet name per round, as a compact two-column grid rather than another run of labelled fields. */
function PacketNames() {
  const thisTournament = useContext(TournamentContext).tournament;
  const [phases] = useSubscription(thisTournament.phases);

  const totalRounds = phases.reduce((sum, ph) => sum + ph.rounds.length, 0);
  const scrolls = totalRounds > packetScrollAfterRounds;

  return (
    <Box sx={{ mt: 2, pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Packet names
      </Typography>
      {phases.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Rounds appear here once this tournament has a format. Pick one on the Format page.
        </Typography>
      ) : (
        <Box
          sx={{
            // A 14-round packet list would otherwise set the height of the whole page.
            ...(scrolls ? { maxHeight: 232, overflowY: 'auto', pr: 0.5 } : {}),
            display: 'grid',
            gridTemplateColumns: 'minmax(0, auto) minmax(0, 1fr)',
            alignItems: 'center',
            columnGap: 1.5,
            rowGap: 0.75,
          }}
        >
          <Typography variant="overline" color="text.secondary">
            Round
          </Typography>
          <Typography variant="overline" color="text.secondary">
            Packet
          </Typography>
          {phases.map((ph) => (
            <PacketPhaseRows key={ph.name} phaseName={ph.name} rounds={ph.rounds} showPhaseName={phases.length > 1} />
          ))}
        </Box>
      )}
    </Box>
  );
}

interface IPacketPhaseRowsProps {
  phaseName: string;
  rounds: Round[];
  showPhaseName: boolean;
}

function PacketPhaseRows(props: IPacketPhaseRowsProps) {
  const { phaseName, rounds, showPhaseName } = props;

  return (
    <>
      {showPhaseName && (
        <Typography variant="caption" color="text.secondary" sx={{ gridColumn: '1 / -1', pt: 0.5 }}>
          {phaseName}
        </Typography>
      )}
      {rounds.map((round) => (
        <PacketNameRow key={round.name} round={round} />
      ))}
    </>
  );
}

interface IPacketNameRowProps {
  round: Round;
}

function PacketNameRow(props: IPacketNameRowProps) {
  const { round } = props;
  const tournManager = useContext(TournamentContext);
  const { packet } = round;
  const [packetName, setPacketName] = useSubscription(packet.name);

  return (
    <>
      <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
        {round.displayName()}
      </Typography>
      <TextField
        hiddenLabel
        fullWidth
        value={packetName}
        onChange={(e) => setPacketName(e.target.value)}
        onBlur={() => tournManager.setPacketName(round, packetName)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') tournManager.setPacketName(round, packetName);
        }}
      />
    </>
  );
}

function TrackingPanel() {
  const tournManager = useContext(TournamentContext);
  const thisTournament = tournManager.tournament;
  const [trackPlayerYear, setTrackPlayerYear] = useSubscription(thisTournament.trackPlayerYear);
  const [trackSS, setTrackSS] = useSubscription(thisTournament.trackSmallSchool);
  const [trackJV, setTrackJV] = useSubscription(thisTournament.trackJV);
  const [trackUG, setTrackUG] = useSubscription(thisTournament.trackUG);
  const [trackD2, setTrackD2] = useSubscription(thisTournament.trackDiv2);

  const handleTrackYearChange = (checked: boolean) => {
    setTrackPlayerYear(checked);
    tournManager.setTrackPlayerYear(checked);
  };

  const handleTrackSS = (checked: boolean) => {
    setTrackSS(checked);
    tournManager.setTrackSmallSchool(checked);
  };

  const handleTrackJV = (checked: boolean) => {
    setTrackJV(checked);
    tournManager.setTrackJV(checked);
  };

  const handleTrackUG = (checked: boolean) => {
    setTrackUG(checked);
    tournManager.setTrackUG(checked);
  };

  const handleTrackD2 = (checked: boolean) => {
    setTrackD2(checked);
    tournManager.setTrackDiv2(checked);
  };

  return (
    <YfCard
      title="Tracking"
      description="Each of these adds a field when you enter teams and players, and a section to the stat report."
    >
      <YfToggleGrid>
        <YfToggleRow label="Player year or grade">
          <Switch checked={trackPlayerYear} onChange={(e) => handleTrackYearChange(e.target.checked)} />
        </YfToggleRow>
        <YfToggleRow label="Small school" hint="Set per organization, not per team">
          <Switch checked={trackSS} onChange={(e) => handleTrackSS(e.target.checked)} />
        </YfToggleRow>
        <YfToggleRow label="Junior varsity">
          <Switch checked={trackJV} onChange={(e) => handleTrackJV(e.target.checked)} />
        </YfToggleRow>
        <YfToggleRow label="Undergraduate" hint="Set per team and per player">
          <Switch checked={trackUG} onChange={(e) => handleTrackUG(e.target.checked)} />
        </YfToggleRow>
        <YfToggleRow label="Division 2" hint="Set per team and per player">
          <Switch checked={trackD2} onChange={(e) => handleTrackD2(e.target.checked)} />
        </YfToggleRow>
      </YfToggleGrid>
    </YfCard>
  );
}

function BackupRecoveryNotice() {
  const tournManager = useContext(TournamentContext);
  const [recoveredBackup] = useSubscription(tournManager.recoveredBackup);

  if (!recoveredBackup) return null;

  const firstLine = "YellowFruit didn't shut down correctly, so this file was recovered from its last autosave."; // IDE gets mad about the unescaped apostrophe if I put this in raw
  return (
    <Box sx={{ mb: 2 }}>
      <YfNotice
        tone="warning"
        icon={<Restore fontSize="small" />}
        title="Unsaved work recovered"
        description={
          <>
            {firstLine}
            <Box component="span" sx={{ display: 'block', mt: 0.5, fontWeight: 500, color: 'text.primary' }}>
              {recoveredBackup.filePath || '(New file)'}
            </Box>
            {`Autosaved at ${recoveredBackup.savedAtTime}`}
          </>
        }
        action={
          <Stack direction="row" sx={{ gap: 1 }}>
            <Button size="small" variant="contained" onClick={() => tournManager.useRecoveredBackup()}>
              Restore
            </Button>
            <Button
              size="small"
              color="inherit"
              startIcon={<Delete fontSize="small" />}
              onClick={() => tournManager.discardRecoveredBackup()}
            >
              Discard
            </Button>
          </Stack>
        }
      />
    </Box>
  );
}

export default GeneralPage;
