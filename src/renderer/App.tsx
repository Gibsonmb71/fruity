import { MemoryRouter as Router, Routes, Route } from 'react-router-dom';

import './App.css';

import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import Box from '@mui/material/Box';
import { useContext, useEffect, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { Alert, AlertColor, IconButton, Snackbar, Tooltip } from '@mui/material';
import { Close, Launch } from '@mui/icons-material';
import NavBar, { applicationPageOrder } from './Components/NavBar';
import { TournamentManager, TournamentContext } from './TournamentManager';
import TeamEditDialog from './Components/TeamEditDialog';
import GenericDialog from './Components/GenericDialog';
import GamesPage from './Components/GamesPage';
import MatchEditDialog from './Components/MatchEditDialog';
import StatReportPage from './Components/StatReportPage';
import { ApplicationPages, ControlPages, SetupPages } from './Enums';
import PhaseEditDialog from './Components/PhaseEditDialog';
import PoolEditDialog from './Components/PoolEditDialog';
import RankEditDialog from './Components/RankEditDialog';
import { IpcRendToMain } from '../IPCChannels';
import PoolAssignmentDialog from './Components/PoolAssignmentDialog';
import MatchImportResultDialog from './Components/MatchImportResultDialog';
import SqbsExportDialog from './Components/SqbsExportDialog';
import AboutYfDialog from './Components/AboutYfDialog';
import SetupPage from './Components/SetupPage';
import ControlPage from './Components/ControlPage';
import yfTheme from './Theme/yfTheme';
import { headerHeight } from './Theme/tokens';
import { ReadinessTarget, resolveTournamentReadiness } from './Services/TournamentReadiness';

window.onerror = () => window.electron.ipcRenderer.sendMessage(IpcRendToMain.WebPageCrashed);
window.electron.ipcRenderer.removeAllListeners(); // needed in dev environemnt so that you don't end up with duplicate listers when the app reloads
const tournManager = new TournamentManager();

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<YellowFruit />} />
      </Routes>
    </Router>
  );
}

/** Set up various contexts for the application */
function YellowFruit() {
  const [, setUpdateNeeded] = useState({}); // set this object to a new object whenever we want to force a re-render
  const [mgr] = useState(tournManager);
  useEffect(() => {
    mgr.dataChangedReactCallback = () => {
      setUpdateNeeded({});
    };
  }, [mgr]);

  return (
    <ThemeProvider theme={yfTheme} defaultMode="system">
      <CssBaseline />
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <TournamentContext.Provider value={mgr}>
          <TournamentEditor />
        </TournamentContext.Provider>
      </LocalizationProvider>
    </ThemeProvider>
  );
}

/** The actual UI of the application */
function TournamentEditor() {
  const mgr = useContext(TournamentContext);
  const [activePage, setactivePage] = useState(ApplicationPages.Setup);
  const [setupSection, setSetupSection] = useState(SetupPages.Tournament);
  const [controlSection, setControlSection] = useState(ControlPages.Live);

  useEffect(() => {
    if (activePage === ApplicationPages.Reports) {
      mgr.generateHtmlReport();
    } else if (
      activePage === ApplicationPages.Setup &&
      setupSection === SetupPages.Teams &&
      mgr.currentTeamsPageView === 2
    ) {
      mgr.compileStats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mgr, mgr.tournament, activePage, setupSection]);

  useHotkeys('alt+shift+right', () => {
    if (!mgr.anyModalOpen()) {
      const activePageIdx = applicationPageOrder.indexOf(activePage);
      setactivePage(applicationPageOrder[(activePageIdx + 1) % applicationPageOrder.length]);
    }
  });
  useHotkeys('alt+shift+left', () => {
    if (!mgr.anyModalOpen()) {
      const activePageIdx = applicationPageOrder.indexOf(activePage);
      setactivePage(
        applicationPageOrder[(activePageIdx - 1 + applicationPageOrder.length) % applicationPageOrder.length],
      );
    }
  });

  const changePage = (page: ApplicationPages) => {
    if (page === ApplicationPages.Reports) {
      mgr.generateHtmlReport();
    } else if (page === ApplicationPages.Setup && setupSection === SetupPages.Teams && mgr.currentTeamsPageView === 2) {
      mgr.compileStats();
    }
    setactivePage(page);
  };

  const openSetupSection = (section: SetupPages) => {
    setSetupSection(section);
    setactivePage(ApplicationPages.Setup);
  };

  const openControlSection = (section: ControlPages = ControlPages.Live) => {
    setControlSection(section);
    setactivePage(ApplicationPages.Control);
  };

  const openReadinessTarget = (target: ReadinessTarget) => {
    switch (target) {
      case 'setup:tournament':
        openSetupSection(SetupPages.Tournament);
        break;
      case 'setup:rules':
        openSetupSection(SetupPages.Rules);
        break;
      case 'setup:teams':
        openSetupSection(SetupPages.Teams);
        break;
      case 'setup:format':
        openSetupSection(SetupPages.Format);
        break;
      case 'games':
        setactivePage(ApplicationPages.Games);
        break;
      case 'control:match-plan':
        openControlSection(ControlPages.MatchPlan);
        break;
      case 'control:rooms':
        openControlSection(ControlPages.Rooms);
        break;
      case 'control:display':
        openControlSection(ControlPages.Display);
        break;
      case 'control:live':
        openControlSection(ControlPages.Live);
        break;
      case 'reports':
        setactivePage(ApplicationPages.Reports);
        mgr.generateHtmlReport();
        break;
      default:
        break;
    }
  };

  const service = mgr.tournamentServerService;
  const readiness = resolveTournamentReadiness(mgr.tournament, {
    running: service.status.running,
    currentRoundNumber: service.currentRoundNumber,
    releasedRoundNumber: service.releasedRoundNumber,
    inboxCount: service.inbox.length,
    conflictCount: service.conflicts.length,
    sessions: service.sessions.map((session) => ({ roomId: session.roomId, status: session.status })),
    roomPresence: service.roomPresence.map((presence) => ({ roomId: presence.roomId, connected: presence.connected })),
  });

  return (
    <>
      <NavBar
        activePage={activePage}
        setActivePage={changePage}
        readiness={readiness}
        onNavigateTarget={openReadinessTarget}
      />
      <Box
        component="main"
        sx={{
          // The header is exactly `headerHeight` tall on every platform (it reserves horizontal room
          // for the macOS traffic lights, not vertical), so this is the whole of the remaining
          // viewport. If the two ever disagree the page grows a scrollbar it doesn't need.
          height: `calc(100vh - ${headerHeight}px)`,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          px: { xs: 2, md: 3 },
          py: 2.5,
        }}
      >
        <Box
          sx={{
            maxWidth: 1500,
            width: '100%',
            height: '100%',
            minHeight: 0,
            mx: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Box
            sx={{
              height: '100%',
              minHeight: 0,
              overflowY: 'auto',
              overflowX: 'hidden',
              scrollbarGutter: 'stable',
              pr: 0.5,
            }}
          >
            <ActivePage
              whichPage={activePage}
              setupSection={setupSection}
              controlSection={controlSection}
              onOpenSetup={openSetupSection}
              onOpenControl={openControlSection}
              onNavigateTarget={openReadinessTarget}
              onNavigate={(page, section) => {
                if (section !== undefined) setSetupSection(section);
                setactivePage(page);
              }}
            />
          </Box>
        </Box>
      </Box>
      <GenericDialog />
      <TeamEditDialog />
      <MatchEditDialog />
      <PhaseEditDialog />
      <PoolEditDialog />
      <RankEditDialog />
      <PoolAssignmentDialog />
      <MatchImportResultDialog />
      <SqbsExportDialog />
      <AboutYfDialog />
      <GenericToast />
    </>
  );
}

interface IActivePageProps {
  whichPage: ApplicationPages;
  setupSection: SetupPages;
  controlSection: ControlPages;
  onOpenSetup: (section: SetupPages) => void;
  onOpenControl: (section?: ControlPages) => void;
  onNavigateTarget: (target: ReadinessTarget) => void;
  onNavigate: (page: ApplicationPages, setupSection?: SetupPages) => void;
}

/** A switch statement for which page to show */
function ActivePage(props: IActivePageProps) {
  const { whichPage, setupSection, controlSection, onOpenSetup, onOpenControl, onNavigateTarget, onNavigate } = props;
  switch (whichPage) {
    case ApplicationPages.Setup:
      return <SetupPage section={setupSection} onSectionChange={onOpenSetup} />;
    case ApplicationPages.Games:
      return <GamesPage onNavigate={onNavigate} />;
    case ApplicationPages.Control:
      return (
        <ControlPage
          section={controlSection}
          onSectionChange={(section) => onOpenControl(section)}
          onNavigateTarget={onNavigateTarget}
        />
      );
    case ApplicationPages.Reports:
      return <StatReportPage />;
    default:
      return null;
  }
}

/** Toast message that the TournamentManager can invoke imperatively */
function GenericToast() {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [severity, setSeverity] = useState<AlertColor>('success');
  const [urlToLaunch, setUrlToLaunch] = useState('');
  const [mgr] = useState(tournManager);
  useEffect(() => {
    mgr.makeToast = (msg, sev = 'success', url = '') => {
      setIsOpen(true);
      setMessage(msg);
      setSeverity(sev);
      setUrlToLaunch(url);
    };
  }, [mgr]);

  const handleClose = () => {
    setIsOpen(false);
  };
  const handleLaunchUrl = () => {
    mgr.launchWebPageInBrowserWindow(urlToLaunch);
    handleClose();
  };

  const durationMs = urlToLaunch !== '' ? 15000 : 5000;
  const action =
    urlToLaunch === '' ? null : (
      <>
        <Tooltip title="Download the lastest version from GitHub">
          <IconButton color="inherit" size="small" onClick={handleLaunchUrl}>
            <Launch fontSize="small" />
          </IconButton>
        </Tooltip>
        <IconButton color="inherit" size="small" onClick={handleClose}>
          <Close fontSize="small" />
        </IconButton>
      </>
    );

  return (
    <Snackbar open={isOpen} autoHideDuration={durationMs} onClose={handleClose}>
      <Alert severity={severity} variant="filled" onClose={handleClose} action={action} sx={{ width: '100%' }}>
        {message}
      </Alert>
    </Snackbar>
  );
}
