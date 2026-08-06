import { useContext, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  InputLabel,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { CheckCircleOutlined, FileDownload, Launch, MoreHoriz, WarningAmber } from '@mui/icons-material';
import { YfCssClasses, YfPageHeader } from '../Utils/GeneralReactUtils';
import { statReportProtocol } from '../../SharedUtils';
import { StatReportFileNames, StatReportPages } from '../Enums';
import useSubscription from '../Utils/CustomHooks';
import { TournamentContext } from '../TournamentManager';
import { resolveTournamentReadiness } from '../Services/TournamentReadiness';
import { PhaseTypes } from '../DataModel/Phase';
import { CommonRuleSets } from '../DataModel/ScoringRules';
import { ScheduledMatchStatus } from '../DataModel/ScheduledMatch';
import { IReportScope } from '../Services/ReportScope';

const primaryReportTabs = [
  { value: StatReportPages.Standings, label: 'Standings' },
  { value: StatReportPages.Individuals, label: 'Individuals' },
  { value: StatReportPages.Scoreboard, label: 'Games' },
  { value: StatReportPages.RoundReport, label: 'Round report' },
];

export default function StatReportPage() {
  const tournManager = useContext(TournamentContext);
  const [updateTime] = useSubscription(tournManager.inAppStatReportGenerated);
  const [activeReportPage, setActiveReportPage] = useState(StatReportPages.Standings);
  const [scopeMode, setScopeMode] = useState<'all' | 'prelim' | 'playoffs' | 'selected'>('all');
  const [selectedPhaseCodes, setSelectedPhaseCodes] = useState<string[]>(() =>
    tournManager.tournament.phases.map((phase) => phase.code),
  );
  const [includeCarryover, setIncludeCarryover] = useState(true);
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null);
  const [detailAnchor, setDetailAnchor] = useState<HTMLElement | null>(null);
  const readiness = resolveTournamentReadiness(tournManager.tournament);
  const reportPages = tournManager.tournament.phases;
  const allPhaseCodes = useMemo(() => reportPages.map((phase) => phase.code), [reportPages]);
  const effectivePhaseCodes = useMemo(() => {
    if (scopeMode === 'all') return allPhaseCodes;
    if (scopeMode === 'prelim') {
      return reportPages.filter((phase) => phase.phaseType === PhaseTypes.Prelim).map((phase) => phase.code);
    }
    if (scopeMode === 'playoffs') {
      return reportPages.filter((phase) => phase.phaseType !== PhaseTypes.Prelim).map((phase) => phase.code);
    }
    const validCodes = selectedPhaseCodes.filter((code) => allPhaseCodes.includes(code));
    return validCodes.length > 0 ? validCodes : allPhaseCodes;
  }, [allPhaseCodes, reportPages, scopeMode, selectedPhaseCodes]);
  const reportScope = useMemo<IReportScope>(
    () => ({ phaseCodes: effectivePhaseCodes, includeCarryover }),
    [effectivePhaseCodes, includeCarryover],
  );
  const selectedPhases = reportPages.filter((phase) => effectivePhaseCodes.includes(phase.code));
  const canIncludeCarryover = selectedPhases.some((phase) => phase.phaseType === PhaseTypes.Playoff);
  const path = `${statReportProtocol}://${StatReportFileNames[activeReportPage]}`;
  const allMatches = useMemo(
    () => tournManager.tournament.phases.flatMap((phase) => phase.rounds.flatMap((round) => round.matches)),
    [tournManager.tournament.phases],
  );
  const invalidGames = allMatches.filter((match) => match.getErrorMessages().length > 0).length;
  const warnings = allMatches.reduce((count, match) => count + match.getNumSuppressedWarnings(), 0);
  const hasStats = tournManager.tournament.stats.length > 0;
  let selectedScopeLabel = selectedPhases.map((phase) => phase.name).join(', ') || 'Selected stages';
  if (scopeMode === 'all') selectedScopeLabel = 'Entire tournament';
  else if (scopeMode === 'prelim') selectedScopeLabel = 'Preliminaries';
  else if (scopeMode === 'playoffs') selectedScopeLabel = 'Playoffs and finals';

  useEffect(() => {
    tournManager.setReportScope(reportScope);
    tournManager.generateHtmlReport(undefined, reportScope);
  }, [reportScope, tournManager]);

  const selectDetailReport = (page: StatReportPages) => {
    setActiveReportPage(page);
    setDetailAnchor(null);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box sx={{ flex: '0 0 auto' }}>
        <YfPageHeader
          title="Reports"
          description="Check results, inspect statistics, and export files for publication or interchange."
          actions={
            <>
              <Button
                variant="outlined"
                startIcon={<Launch />}
                onClick={() => tournManager.launchStatReportInBrowserWindow()}
              >
                Open in browser
              </Button>
              <Button
                variant="contained"
                startIcon={<FileDownload />}
                onClick={(event) => setExportAnchor(event.currentTarget)}
              >
                Export
              </Button>
            </>
          }
        />
      </Box>

      <ResultsReadiness
        invalidGames={invalidGames}
        hasStats={hasStats}
        suppressedWarnings={warnings}
        readiness={readiness}
      />
      <NaqtSubmissionReadiness readiness={readiness} />

      <Stack
        direction={{ xs: 'column', md: 'row' }}
        sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between', gap: 1, mb: 1.5 }}
      >
        <Tabs
          value={activeReportPage}
          onChange={(event, value: StatReportPages) => setActiveReportPage(value)}
          aria-label="Report pages"
          sx={{ minHeight: 36, '& .MuiTab-root': { minHeight: 36, py: 0.25, px: 1.5 } }}
        >
          {primaryReportTabs.map((tab) => (
            <Tab key={tab.value} value={tab.value} label={tab.label} />
          ))}
        </Tabs>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
          <FormControl size="small" sx={{ minWidth: 190 }}>
            <InputLabel>Scope</InputLabel>
            <Select
              label="Scope"
              value={scopeMode}
              onChange={(event) => {
                const next = event.target.value as typeof scopeMode;
                if (next === 'selected' && selectedPhaseCodes.length === 0) setSelectedPhaseCodes(allPhaseCodes);
                setScopeMode(next);
              }}
            >
              <MenuItem value="all">Entire tournament</MenuItem>
              <MenuItem value="prelim">Preliminaries</MenuItem>
              <MenuItem value="playoffs">Playoffs and finals</MenuItem>
              <MenuItem value="selected">Selected stages…</MenuItem>
            </Select>
          </FormControl>
          {scopeMode === 'selected' && (
            <FormControl size="small" sx={{ minWidth: 230, maxWidth: 320 }}>
              <InputLabel>Stages</InputLabel>
              <Select
                multiple
                label="Stages"
                value={selectedPhaseCodes}
                onChange={(event) => setSelectedPhaseCodes(event.target.value as string[])}
                renderValue={(values) =>
                  (values as string[])
                    .map((code) => reportPages.find((phase) => phase.code === code)?.name ?? code)
                    .join(', ')
                }
              >
                {reportPages.map((phase) => (
                  <MenuItem key={phase.code} value={phase.code}>
                    <Checkbox checked={selectedPhaseCodes.includes(phase.code)} size="small" />
                    <ListItemText primary={phase.name} />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          {canIncludeCarryover && (
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={includeCarryover}
                  onChange={(event) => setIncludeCarryover(event.target.checked)}
                />
              }
              label="Include carried-over games"
              sx={{ mr: 0, '& .MuiFormControlLabel-label': { fontSize: '0.78rem' } }}
            />
          )}
          <Button
            size="small"
            variant="outlined"
            endIcon={<MoreHoriz />}
            onClick={(event) => setDetailAnchor(event.currentTarget)}
          >
            More reports
          </Button>
        </Stack>
      </Stack>
      {scopeMode !== 'all' && (
        <Typography variant="caption" color="text.secondary" sx={{ mb: 1 }}>
          Preview scope: {selectedScopeLabel}.{' '}
          {includeCarryover && canIncludeCarryover
            ? 'Carried-over games are included.'
            : 'Only games in the selected stages are included.'}
        </Typography>
      )}

      <Paper
        variant="outlined"
        sx={{
          flex: '1 1 auto',
          minHeight: 0,
          overflow: 'hidden',
          display: 'flex',
          backgroundColor: 'background.paper',
        }}
      >
        <Box
          component="iframe"
          key={`${updateTime.toISOString()}-${activeReportPage}`}
          src={path}
          className={YfCssClasses.StatReportIFrame}
          sx={{ border: 'none', p: 1.5, width: '100%', height: '100%', minHeight: 0, flex: '1 1 auto' }}
          title={`${selectedScopeLabel} ${reportTitle(activeReportPage)}`}
        />
      </Paper>

      <Menu anchorEl={exportAnchor} open={exportAnchor !== null} onClose={() => setExportAnchor(null)}>
        <MenuItem
          onClick={() => {
            tournManager.exportStatReports();
            setExportAnchor(null);
          }}
        >
          <ListItemText
            primary="Export HTML Stat Report"
            secondary="Six linked report pages for people to read or print."
          />
        </MenuItem>
        <MenuItem
          onClick={() => {
            tournManager.openSqbsExportModal();
            setExportAnchor(null);
          }}
        >
          <ListItemText
            primary="Export SQBS"
            secondary="Legacy statistics interchange; choose stages in the next dialog."
          />
        </MenuItem>
        <MenuItem
          onClick={() => {
            tournManager.requestQbjExport();
            setExportAnchor(null);
          }}
        >
          <ListItemText primary="Export QBJ" secondary="Tournament Schema interchange, without live room state." />
        </MenuItem>
      </Menu>
      <Menu anchorEl={detailAnchor} open={detailAnchor !== null} onClose={() => setDetailAnchor(null)}>
        <MenuItem onClick={() => selectDetailReport(StatReportPages.TeamDetails)}>Team detail</MenuItem>
        <MenuItem onClick={() => selectDetailReport(StatReportPages.PlayerDetails)}>Individual detail</MenuItem>
      </Menu>
    </Box>
  );
}

function ResultsReadiness({
  invalidGames,
  hasStats,
  suppressedWarnings,
  readiness,
}: {
  invalidGames: number;
  hasStats: boolean;
  suppressedWarnings: number;
  readiness: ReturnType<typeof resolveTournamentReadiness>;
}) {
  const hasTeams = readiness.setup.teamCount > 0;
  const hasRounds = readiness.setup.formatReady;
  return (
    <Box
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 1.5,
        px: 1.5,
        py: 1.25,
        mb: 1.5,
        backgroundColor: 'background.paper',
      }}
    >
      <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
        Results readiness
      </Typography>
      <Stack direction={{ xs: 'column', md: 'row' }} sx={{ gap: 1.25, flexWrap: 'wrap' }}>
        <ReadinessItem
          valid={invalidGames === 0}
          text={invalidGames === 0 ? 'All games are valid' : `${invalidGames} games need correction`}
        />
        <ReadinessItem
          valid={hasTeams && hasStats}
          text={hasTeams && hasStats ? 'Team and individual statistics available' : 'Statistics are not compiled yet'}
        />
        <ReadinessItem
          valid={hasRounds}
          text={hasRounds ? 'Round and packet statistics available' : 'Round/packet structure is incomplete'}
        />
        {suppressedWarnings > 0 && (
          <ReadinessItem valid={false} text={`${suppressedWarnings} suppressed warnings remain`} />
        )}
      </Stack>
    </Box>
  );
}

function NaqtSubmissionReadiness({ readiness }: { readiness: ReturnType<typeof resolveTournamentReadiness> }) {
  const tournManager = useContext(TournamentContext);
  const { tournament } = tournManager;
  if (
    tournament.standardRuleSet !== CommonRuleSets.NaqtTimed &&
    tournament.standardRuleSet !== CommonRuleSets.NaqtUntimed
  ) {
    return null;
  }

  const matches = tournament.phases.flatMap((phase) => phase.rounds.flatMap((round) => round.matches));
  const invalid = matches.filter((match) => match.getErrorMessages().length > 0);
  const missingTossups = matches.filter((match) => !match.isForfeit() && match.tossupsRead === undefined);
  const scheduled = tournament.scheduledMatches.filter((match) => match.status !== ScheduledMatchStatus.Cancelled);
  const acceptedScheduled = scheduled.filter((match) => match.status === ScheduledMatchStatus.Accepted);
  const hasAutomaticCompleteness = readiness.roomOperationsEnabled && scheduled.length > 0;
  const scheduleComplete = hasAutomaticCompleteness && acceptedScheduled.length === scheduled.length;
  let completenessText = 'No games recorded yet';
  if (hasAutomaticCompleteness) {
    completenessText = scheduleComplete
      ? 'All scheduled games are accepted'
      : `${scheduled.length - acceptedScheduled.length} scheduled games are not accepted`;
  } else if (matches.length > 0) {
    completenessText = 'Game completeness cannot be verified automatically for manual entry';
  }

  return (
    <Box
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 1.5,
        px: 1.5,
        py: 1.25,
        mb: 1.5,
        backgroundColor: 'background.paper',
      }}
    >
      <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
        NAQT submission readiness
      </Typography>
      <Stack direction={{ xs: 'column', md: 'row' }} sx={{ gap: 1.25, flexWrap: 'wrap' }}>
        <ReadinessItem
          valid={invalid.length === 0}
          text={invalid.length === 0 ? 'Game data is valid' : `${invalid.length} games need correction`}
        />
        <ReadinessItem
          valid={missingTossups.length === 0}
          text={
            missingTossups.length === 0
              ? 'Tossups heard are recorded'
              : `${missingTossups.length} games lack tossups heard`
          }
        />
        <ReadinessItem
          valid={matches.length > 0 && (hasAutomaticCompleteness ? scheduleComplete : true)}
          text={completenessText}
        />
        <ReadinessItem
          valid={matches.every(
            (match) => !match.isForfeit() || match.leftTeam.forfeitLoss || match.rightTeam.forfeitLoss,
          )}
          text="Forfeits are represented in the game data"
        />
      </Stack>
    </Box>
  );
}

function ReadinessItem({ valid, text }: { valid: boolean; text: string }) {
  return (
    <Typography
      variant="body2"
      color={valid ? 'success.main' : 'warning.main'}
      sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
    >
      {valid ? <CheckCircleOutlined sx={{ fontSize: 17 }} /> : <WarningAmber sx={{ fontSize: 17 }} />}
      {text}
    </Typography>
  );
}

function reportTitle(page: StatReportPages) {
  switch (page) {
    case StatReportPages.Standings:
      return 'Standings';
    case StatReportPages.Individuals:
      return 'Individuals';
    case StatReportPages.Scoreboard:
      return 'Games';
    case StatReportPages.TeamDetails:
      return 'Team detail';
    case StatReportPages.PlayerDetails:
      return 'Individual detail';
    case StatReportPages.RoundReport:
      return 'Round report';
    default:
      return 'Report';
  }
}
