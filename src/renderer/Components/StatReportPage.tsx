import { useContext, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { FileDownload, Launch, MoreHoriz } from '@mui/icons-material';
import { YfCssClasses, YfPageHeader } from '../Utils/GeneralReactUtils';
import { statReportProtocol } from '../../SharedUtils';
import { StatReportFileNames, StatReportPages } from '../Enums';
import useSubscription from '../Utils/CustomHooks';
import { TournamentContext } from '../TournamentManager';
import { PhaseTypes } from '../DataModel/Phase';
import { IReportScope } from '../Services/ReportScope';
import { resolvePublicationReadiness, IPublicationReadiness } from '../Services/ReportReadiness';
import ReadinessMark from './ReadinessMark';

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
  const [scopeAnchor, setScopeAnchor] = useState<HTMLElement | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
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
  const publicationReadiness = useMemo(
    () => resolvePublicationReadiness(tournManager.tournament),
    [tournManager.tournament],
  );
  let selectedScopeLabel = selectedPhases.map((phase) => phase.name).join(', ') || 'Selected stages';
  if (scopeMode === 'all') selectedScopeLabel = 'Entire tournament';
  else if (scopeMode === 'prelim') selectedScopeLabel = 'Preliminaries';
  else if (scopeMode === 'playoffs') selectedScopeLabel = 'Playoffs and finals';
  const scopeButtonLabel = `${selectedScopeLabel}${includeCarryover && canIncludeCarryover ? ' + carryovers' : ''}`;

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

      <PublicationReadiness
        readiness={publicationReadiness}
        detailsOpen={detailsOpen}
        onToggleDetails={() => setDetailsOpen((open) => !open)}
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
          <Button
            size="small"
            variant="outlined"
            endIcon={<MoreHoriz />}
            onClick={(event) => setScopeAnchor(event.currentTarget)}
          >
            Scope: {scopeButtonLabel}
          </Button>
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
      <Menu anchorEl={scopeAnchor} open={scopeAnchor !== null} onClose={() => setScopeAnchor(null)}>
        <MenuItem
          selected={scopeMode === 'all'}
          onClick={() => {
            setScopeMode('all');
            setScopeAnchor(null);
          }}
        >
          Entire tournament
        </MenuItem>
        <MenuItem
          selected={scopeMode === 'prelim'}
          onClick={() => {
            setScopeMode('prelim');
            setScopeAnchor(null);
          }}
        >
          Preliminaries
        </MenuItem>
        <MenuItem
          selected={scopeMode === 'playoffs'}
          onClick={() => {
            setScopeMode('playoffs');
            setScopeAnchor(null);
          }}
        >
          Playoffs and finals
        </MenuItem>
        <MenuItem
          selected={scopeMode === 'selected'}
          onClick={() => {
            setScopeMode('selected');
            setScopeAnchor(null);
          }}
        >
          Custom stage selection
        </MenuItem>
        {scopeMode === 'selected' &&
          reportPages.map((phase) => (
            <MenuItem
              key={phase.code}
              onClick={() =>
                setSelectedPhaseCodes((codes) =>
                  codes.includes(phase.code) ? codes.filter((code) => code !== phase.code) : [...codes, phase.code],
                )
              }
            >
              <Checkbox checked={selectedPhaseCodes.includes(phase.code)} size="small" />
              <ListItemText primary={phase.name} />
            </MenuItem>
          ))}
        {canIncludeCarryover && (
          <MenuItem onClick={() => setIncludeCarryover((included) => !included)}>
            <Checkbox checked={includeCarryover} size="small" />
            <ListItemText primary="Include carried-over games" />
          </MenuItem>
        )}
      </Menu>

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

function PublicationReadiness({
  readiness,
  detailsOpen,
  onToggleDetails,
}: {
  readiness: IPublicationReadiness;
  detailsOpen: boolean;
  onToggleDetails: () => void;
}) {
  const showDetails = detailsOpen || readiness.status === 'problem';
  const summaryChecks = readiness.checks.filter((check) => check.id === 'game-data' || check.id === 'completeness');
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
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ alignItems: { sm: 'center' }, gap: 1.25 }}>
        <Typography variant="subtitle2" sx={{ mr: { sm: 0.5 } }}>
          Publication readiness
        </Typography>
        {summaryChecks.map((check) => (
          <VerificationItem key={check.id} status={check.status} text={check.text} />
        ))}
        <Button size="small" onClick={onToggleDetails} sx={{ ml: { sm: 'auto' } }} aria-expanded={showDetails}>
          Details
        </Button>
      </Stack>
      {showDetails && (
        <Stack direction={{ xs: 'column', md: 'row' }} sx={{ gap: 1.25, flexWrap: 'wrap', mt: 1 }}>
          {readiness.checks.map((check) => (
            <VerificationItem key={check.id} status={check.status} text={check.text} />
          ))}
        </Stack>
      )}
    </Box>
  );
}

function VerificationItem({ status, text }: { status: 'verified' | 'problem' | 'unknown'; text: string }) {
  let color: 'warning.main' | 'success.main' | 'text.secondary' = 'text.secondary';
  if (status === 'problem') color = 'warning.main';
  else if (status === 'verified') color = 'success.main';
  return (
    <Typography variant="body2" color={color} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <ReadinessMark status={status} />
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
