import { Box, Button, ButtonBase, Stack, Switch, TextField, Typography } from '@mui/material';
import Grid from '@mui/material/Grid';
import { useContext } from 'react';
import { DatePicker } from '@mui/x-date-pickers';
import dayjs from 'dayjs';
import { ArrowForward, AutoAwesome, CheckCircle, Delete, Restore } from '@mui/icons-material';
import { TournamentContext } from '../TournamentManager';
import useSubscription from '../Utils/CustomHooks';
import YfCard from './YfCard';
import { NullDate } from '../Utils/UtilTypes';
import { YfFieldGrid, YfFieldRow, YfNotice, YfPageHeader, YfToggleGrid, YfToggleRow } from '../Utils/GeneralReactUtils';
import { Round } from '../DataModel/Round';
import { ApplicationPages } from '../Enums';

/**
 * Beyond this many rounds the packet list would drive the page height on its own, so it scrolls
 * inside its panel instead.
 */
const packetScrollAfterRounds = 8;

interface IGeneralPageProps {
  // eslint-disable-next-line react/require-default-props
  onNavigate?: (page: ApplicationPages) => void;
}

function GeneralPage(props: IGeneralPageProps) {
  const { onNavigate } = props;

  return (
    <>
      <YfPageHeader title="General" description="What, where and when this tournament is, and what you track." />
      <SetupGuide onNavigate={onNavigate} />
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
      </Grid>
    </>
  );
}

interface ISetupStep {
  number: number;
  title: string;
  description: string;
  page: ApplicationPages;
  complete: boolean;
}

/** A short first-run path that turns a blank tournament into a clear next action. */
function SetupGuide(props: IGeneralPageProps) {
  const { onNavigate } = props;
  const manager = useContext(TournamentContext);
  const { tournament } = manager;
  const [phases] = useSubscription(tournament.phases);
  const [numberOfTeams] = useSubscription(tournament.getNumberOfTeams());

  if (tournament.hasMatchData) return null;

  const steps: ISetupStep[] = [
    {
      number: 1,
      title: 'Name the tournament',
      description:
        tournament.name.trim() === '' ? 'Add a name, location and dates.' : 'Tournament details are in place.',
      page: ApplicationPages.General,
      complete: tournament.name.trim() !== '',
    },
    {
      number: 2,
      title: 'Review the rules',
      description: 'Choose a standard format, then tune the details.',
      page: ApplicationPages.Rules,
      complete: tournament.standardRuleSet !== undefined,
    },
    {
      number: 3,
      title: 'Build a schedule',
      description: phases.length === 0 ? 'Start with a template for your field.' : 'Stages and rounds are ready.',
      page: ApplicationPages.Schedule,
      complete: phases.length > 0,
    },
    {
      number: 4,
      title: 'Add teams',
      description:
        numberOfTeams === 0 ? 'Register teams one by one or import them.' : `${numberOfTeams} teams are registered.`,
      page: ApplicationPages.Teams,
      complete: numberOfTeams > 0,
    },
  ];
  const allReady = steps.every((step) => step.complete);

  return (
    <Box
      sx={{
        mb: 2.5,
        p: 2,
        border: 1,
        borderColor: 'primary.light',
        borderRadius: 2,
        background:
          'linear-gradient(135deg, var(--mui-palette-action-selected) 0%, var(--mui-palette-background-paper) 76%)',
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'flex-start', gap: 1.25 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            width: 32,
            height: 32,
            borderRadius: 1.5,
            color: 'primary.main',
            backgroundColor: 'background.paper',
            border: 1,
            borderColor: 'primary.light',
          }}
        >
          <AutoAwesome fontSize="small" />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1">Set up your tournament</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            Work through the essentials in any order. You can change these settings later.
          </Typography>
        </Box>
      </Stack>

      <Grid container spacing={1.25} sx={{ mt: 1.5 }}>
        {steps.map((step) => (
          <Grid key={step.title} size={{ xs: 12, sm: 6, lg: 3 }}>
            <ButtonBase
              component="div"
              onClick={() => onNavigate?.(step.page)}
              sx={{
                display: 'block',
                width: '100%',
                height: '100%',
                borderRadius: 1.5,
                textAlign: 'left',
              }}
            >
              <Box
                sx={{
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  height: '100%',
                  minHeight: 114,
                  p: 1.5,
                  border: 1,
                  borderColor: step.complete ? 'success.main' : 'divider',
                  borderRadius: 1.5,
                  backgroundColor: 'background.paper',
                  transition: 'border-color 160ms ease, transform 160ms ease, box-shadow 160ms ease',
                  '&:hover': {
                    borderColor: step.complete ? 'success.main' : 'primary.main',
                    transform: 'translateY(-1px)',
                    boxShadow: 1,
                  },
                }}
              >
                <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      color: step.complete ? 'success.main' : 'text.secondary',
                      backgroundColor: step.complete ? 'success.light' : 'action.hover',
                      fontSize: '0.6875rem',
                      fontWeight: 700,
                    }}
                  >
                    {step.complete ? <CheckCircle sx={{ fontSize: 16 }} /> : step.number}
                  </Box>
                  {!step.complete && <ArrowForward sx={{ fontSize: 16, color: 'text.disabled' }} />}
                </Stack>
                <Typography variant="subtitle2" sx={{ mt: 1.25 }}>
                  {step.title}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25, pr: 0.5 }}>
                  {step.description}
                </Typography>
              </Box>
            </ButtonBase>
          </Grid>
        ))}
      </Grid>

      {allReady && (
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          sx={{
            alignItems: { xs: 'stretch', sm: 'center' },
            gap: 1.25,
            mt: 1.5,
            pt: 1.5,
            borderTop: 1,
            borderColor: 'divider',
          }}
        >
          <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
            Everything is ready. Enter the first game when you’re ready to start scoring.
          </Typography>
          <Button variant="contained" size="small" onClick={() => onNavigate?.(ApplicationPages.Games)}>
            Open Games
          </Button>
        </Stack>
      )}
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
          Rounds appear here once this tournament has a schedule. Pick one on the Schedule page.
        </Typography>
      ) : (
        <Box
          sx={{
            // A 14-round schedule would otherwise set the height of the whole page.
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
