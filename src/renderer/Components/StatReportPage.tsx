import { useContext, useMemo, useState } from 'react';
import {
  Box,
  Button,
  FormControl,
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
  const [scope, setScope] = useState('all');
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null);
  const [detailAnchor, setDetailAnchor] = useState<HTMLElement | null>(null);
  const readiness = resolveTournamentReadiness(tournManager.tournament);
  const reportPages = tournManager.tournament.phases;
  const path = `${statReportProtocol}://${StatReportFileNames[activeReportPage]}`;
  const allMatches = useMemo(
    () => tournManager.tournament.phases.flatMap((phase) => phase.rounds.flatMap((round) => round.matches)),
    [tournManager.tournament.phases],
  );
  const invalidGames = allMatches.filter((match) => match.getErrorMessages().length > 0).length;
  const warnings = allMatches.reduce((count, match) => count + match.getNumSuppressedWarnings(), 0);
  const hasStats = tournManager.tournament.stats.length > 0;
  const selectedScopeLabel =
    scope === 'all'
      ? 'Entire tournament'
      : reportPages.find((phase) => phase.code === scope)?.name ?? 'Entire tournament';

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
            <Select label="Scope" value={scope} onChange={(event) => setScope(event.target.value)}>
              <MenuItem value="all">Entire tournament</MenuItem>
              {reportPages.map((phase) => (
                <MenuItem key={phase.code} value={phase.code}>
                  {phase.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
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
      {scope !== 'all' && (
        <Typography variant="caption" color="text.secondary" sx={{ mb: 1 }}>
          Preview scope: {selectedScopeLabel}. The HTML report keeps cross-stage links intact; use the SQBS export to
          write stage-specific files.
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
