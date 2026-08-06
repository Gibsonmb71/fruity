import { ArrowForward, Check } from '@mui/icons-material';
import { Box, Button, Tab, Tabs, Typography } from '@mui/material';
import { useContext } from 'react';
import { SetupPages } from '../Enums';
import { TournamentContext } from '../TournamentManager';
import { resolveTournamentReadiness } from '../Services/TournamentReadiness';
import { YfPageHeader } from '../Utils/GeneralReactUtils';
import GeneralPage from './GeneralPage';
import RulesPage from './RulesPage';
import TeamsPage from './TeamsPage';
import SchedulePage from './SchedulePage';

interface ISetupPageProps {
  section: SetupPages;
  onSectionChange: (section: SetupPages) => void;
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

function SetupStatus({ section, onSectionChange }: Pick<ISetupPageProps, 'section' | 'onSectionChange'>) {
  const tournManager = useContext(TournamentContext);
  const readiness = resolveTournamentReadiness(tournManager.tournament);
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
    </>
  );
}

export default function SetupPage({ section, onSectionChange }: ISetupPageProps) {
  return (
    <Box sx={{ height: '100%', minHeight: 0, overflow: 'auto', pr: 0.5 }}>
      <YfPageHeader title="Setup" description="Configure the tournament before game-day operations." />
      <SetupStatus section={section} onSectionChange={onSectionChange} />
      <Box sx={{ mt: 2 }}>
        {section === SetupPages.Tournament && <GeneralPage showPageHeader={false} />}
        {section === SetupPages.Rules && <RulesPage showPageHeader={false} />}
        {section === SetupPages.Teams && <TeamsPage showPageHeader={false} />}
        {section === SetupPages.Format && <SchedulePage showPageHeader={false} />}
      </Box>
    </Box>
  );
}
