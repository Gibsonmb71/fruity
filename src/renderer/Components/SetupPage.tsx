import { ArrowForward, Check } from '@mui/icons-material';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { useContext, useState } from 'react';
import { SetupPages } from '../Enums';
import { TournamentContext } from '../TournamentManager';
import { resolveTournamentReadiness } from '../Services/TournamentReadiness';
import { createNavigationIntent, INavigationIntent } from '../Services/Navigation';
import { YfPageHeader } from '../Utils/GeneralReactUtils';
import GeneralPage from './GeneralPage';
import RulesPage from './RulesPage';
import TeamsPage from './TeamsPage';
import SchedulePage from './SchedulePage';
import ReadinessMark from './ReadinessMark';
import { readinessStatus } from '../Services/ReadinessSemantics';

interface ISetupPageProps {
  section: SetupPages;
  onSectionChange: (section: SetupPages) => void;
  onNavigateTarget: (intent: INavigationIntent) => void;
}

const setupTabs = [
  { label: 'Tournament', value: SetupPages.Tournament },
  { label: 'Rules', value: SetupPages.Rules },
  { label: 'Teams', value: SetupPages.Teams },
  { label: 'Format', value: SetupPages.Format },
];

function setupSectionForTarget(target: string): SetupPages {
  switch (target) {
    case 'setup:tournament':
      return SetupPages.Tournament;
    case 'setup:rules':
      return SetupPages.Rules;
    case 'setup:teams':
      return SetupPages.Teams;
    case 'setup:format':
    default:
      return SetupPages.Format;
  }
}

function setupActionFor(readiness: ReturnType<typeof resolveTournamentReadiness>) {
  if (!readiness.setup.tournamentReady) return { label: 'Add tournament details', target: 'setup:tournament' };
  if (!readiness.setup.rulesReady) return { label: 'Choose a ruleset', target: 'setup:rules' };
  if (!readiness.setup.teamsReady) return { label: 'Finish team registration', target: 'setup:teams' };
  if (!readiness.setup.formatReady) return { label: 'Choose a format', target: 'setup:format' };
  return null;
}

function setupTabReady(section: SetupPages, readiness: ReturnType<typeof resolveTournamentReadiness>) {
  switch (section) {
    case SetupPages.Tournament:
      return readiness.setup.tournamentReady;
    case SetupPages.Rules:
      return readiness.setup.rulesReady;
    case SetupPages.Teams:
      return readiness.setup.teamsReady;
    case SetupPages.Format:
    default:
      return readiness.setup.formatReady;
  }
}

function SetupStatus({ section, onSectionChange, onNavigateTarget }: ISetupPageProps) {
  const tournManager = useContext(TournamentContext);
  const service = tournManager.tournamentServerService;
  const readiness = resolveTournamentReadiness(tournManager.tournament, {
    running: service.status.running,
    currentRoundNumber: service.currentRoundNumber,
    releasedRoundNumber: service.releasedRoundNumber,
    inboxCount: service.inbox.length,
    conflictCount: service.conflicts.length,
    inboxScheduledMatchIds: service.inbox.map((item) => item.scheduledMatchId).filter(Boolean) as string[],
    sessions: service.sessions.map((session) => ({ roomId: session.roomId, status: session.status })),
    roomPresence: service.roomPresence.map((presence) => ({ roomId: presence.roomId, connected: presence.connected })),
  });
  const { setup } = readiness;

  const nextSetupAction = setupActionFor(readiness);

  return (
    <>
      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, backgroundColor: 'background.paper' }}>
        <Tabs
          value={section}
          onChange={(event, value: SetupPages) => onSectionChange(value)}
          aria-label="Setup sections"
          variant="scrollable"
          scrollButtons="auto"
          sx={{ minHeight: 38, '& .MuiTab-root': { minHeight: 38, py: 0.5 } }}
        >
          {setupTabs.map((tab) => {
            const ready = setupTabReady(tab.value, readiness);
            const teamsLabel =
              tab.value === SetupPages.Teams && setup.expectedTeamCount !== null
                ? `Teams ${setup.teamCount}/${setup.expectedTeamCount}`
                : tab.label;
            return (
              <Tab
                key={tab.value}
                value={tab.value}
                label={
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                    {teamsLabel}
                    {ready && <Check aria-label={`${tab.label} ready`} sx={{ fontSize: 16, color: 'success.main' }} />}
                  </Box>
                }
              />
            );
          })}
        </Tabs>
      </Box>
      {nextSetupAction && (
        <Box
          sx={{
            mt: 1,
            px: 1.5,
            py: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
            border: 1,
            borderColor: 'divider',
            borderRadius: 1.5,
            backgroundColor: 'action.hover',
          }}
        >
          <Typography variant="body2">
            <Box component="span" sx={{ color: 'text.secondary', mr: 0.75 }}>
              Next:
            </Box>
            {nextSetupAction.label}.
          </Typography>
          <Button
            size="small"
            variant="outlined"
            endIcon={<ArrowForward />}
            onClick={() => onSectionChange(setupSectionForTarget(nextSetupAction.target))}
          >
            Open
          </Button>
        </Box>
      )}
      <SetupPreflight readiness={readiness} onSectionChange={onSectionChange} onNavigateTarget={onNavigateTarget} />
    </>
  );
}

function SetupPreflight({
  readiness,
  onSectionChange,
  onNavigateTarget,
}: {
  readiness: ReturnType<typeof resolveTournamentReadiness>;
  onSectionChange: (section: SetupPages) => void;
  onNavigateTarget: (intent: INavigationIntent) => void;
}) {
  const [open, setOpen] = useState(false);
  const coreChecks = [
    { label: 'Tournament details', ready: readiness.setup.tournamentReady, target: 'setup:tournament' as const },
    { label: 'Ruleset', ready: readiness.setup.rulesReady, target: 'setup:rules' as const },
    { label: 'Teams', ready: readiness.setup.teamsReady, target: 'setup:teams' as const },
    { label: 'Format', ready: readiness.setup.formatReady, target: 'setup:format' as const },
  ];
  let statusMessage = 'Run a preflight to see the next fix.';
  if (readiness.coreReady) {
    statusMessage = readiness.roomOperationsEnabled
      ? 'Core setup is ready; room operations are checked separately.'
      : 'Ready for traditional manual game entry.';
  }

  const openTarget = (target: import('../Services/TournamentReadiness').ReadinessTarget) => {
    setOpen(false);
    if (target.startsWith('setup:')) {
      const section = setupSectionForTarget(target);
      onSectionChange(section);
      return;
    }
    onNavigateTarget(createNavigationIntent(target));
  };

  return (
    <>
      <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 0.75, minHeight: 32 }}>
        <ReadinessMark status={readinessStatus(readiness.coreReady, !readiness.coreReady)} />
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          Setup
        </Typography>
        <Typography variant="body2" color={readiness.coreReady ? 'success.main' : 'warning.main'}>
          {readiness.coreReady ? 'Ready' : 'Needs attention'}
        </Typography>
        <Button size="small" variant="outlined" sx={{ ml: 0.5 }} onClick={() => setOpen(true)}>
          Preflight
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
          {statusMessage}
        </Typography>
      </Box>
      <Dialog fullWidth maxWidth="sm" open={open} onClose={() => setOpen(false)}>
        <DialogTitle>Setup preflight</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
            Core setup is required for every tournament. Room operations are optional and only appear when configured.
          </Typography>
          {coreChecks.map((check) => (
            <PreflightRow
              key={check.label}
              label={check.label}
              status={readinessStatus(check.ready, !check.ready)}
              actionLabel={check.ready ? undefined : 'Fix'}
              onAction={() => openTarget(check.target)}
            />
          ))}
          <Divider sx={{ my: 1.5 }} />
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            {readiness.roomOperationsEnabled ? 'Room operations' : 'Traditional manual entry'}
          </Typography>
          {readiness.roomOperationsEnabled ? (
            <>
              <PreflightRow
                label="Rooms configured"
                status={readinessStatus(readiness.roomOperations.roomsConfigured, !readiness.roomOperations.roomsConfigured)}
                actionLabel={readiness.roomOperations.roomsConfigured ? undefined : 'Set up rooms'}
                onAction={() => openTarget('control:rooms')}
              />
              <PreflightRow
                label="Match Plan configured"
                status={readinessStatus(readiness.roomOperations.matchPlanConfigured, !readiness.roomOperations.matchPlanConfigured)}
                actionLabel={readiness.roomOperations.matchPlanConfigured ? undefined : 'Open Match Plan'}
                onAction={() => openTarget('control:match-plan')}
              />
              <PreflightRow
                label="Tournament Server running"
                status={readinessStatus(readiness.roomOperations.serverRunning, !readiness.roomOperations.serverRunning)}
                actionLabel={readiness.roomOperations.serverRunning ? undefined : 'Start server'}
                onAction={() => openTarget('control:live')}
              />
              <PreflightRow
                label="Current assignments valid"
                status={readinessStatus(readiness.roomOperations.currentAssignmentsValid, !readiness.roomOperations.currentAssignmentsValid)}
                actionLabel={readiness.roomOperations.currentAssignmentsValid ? undefined : 'Review Match Plan'}
                onAction={() => openTarget('control:match-plan')}
              />
            </>
          ) : (
            <PreflightRow
              label="Browser room scoring"
              status="unknown"
              actionLabel="Optional"
              onAction={() => openTarget('control:rooms')}
            />
          )}
        </DialogContent>
        <DialogActions>
          {readiness.coreReady && !readiness.roomOperationsEnabled && (
            <Button onClick={() => openTarget('games')}>Open Games</Button>
          )}
          <Button onClick={() => setOpen(false)}>Done</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function PreflightRow({
  label,
  status,
  actionLabel,
  onAction,
}: {
  label: string;
  status: 'verified' | 'problem' | 'unknown';
  actionLabel: string | undefined;
  onAction: () => void;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, minHeight: 36 }}>
      <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <ReadinessMark status={status} />
        {label}
      </Typography>
      {actionLabel && (
        <Button size="small" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </Box>
  );
}

export default function SetupPage({ section, onSectionChange, onNavigateTarget }: ISetupPageProps) {
  return (
    <Box sx={{ minHeight: '100%' }}>
      <YfPageHeader title="Setup" description="Configure the tournament before game-day operations." />
      <SetupStatus section={section} onSectionChange={onSectionChange} onNavigateTarget={onNavigateTarget} />
      <Box sx={{ mt: 2 }}>
        {section === SetupPages.Tournament && <GeneralPage showPageHeader={false} />}
        {section === SetupPages.Rules && <RulesPage showPageHeader={false} />}
        {section === SetupPages.Teams && <TeamsPage showPageHeader={false} />}
        {section === SetupPages.Format && <SchedulePage showPageHeader={false} />}
      </Box>
    </Box>
  );
}
