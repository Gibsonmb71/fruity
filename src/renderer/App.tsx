import { MemoryRouter as Router, Routes, Route } from 'react-router-dom';

import './App.css';

import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import Box from '@mui/material/Box';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import {
  Alert,
  AlertColor,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Snackbar,
  TextField,
  Tooltip,
} from '@mui/material';
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
import {
  fallbackNavigationPreferences,
  readNavigationPreferences,
  writeNavigationPreferences,
} from './Services/NavigationPreferences';
import { buildQuickFindItems, filterQuickFindItems } from './Services/QuickFind';
import type { IQuickFindItem, IQuickFindNavigation } from './Services/QuickFind';

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
  const [quickFindOpen, setQuickFindOpen] = useState(false);
  const [gamesNavigation, setGamesNavigation] = useState<IQuickFindNavigation | null>(null);
  const navigationIdentity = mgr.filePath || 'new-tournament';
  const restoredIdentity = useRef<string | null>(null);

  useEffect(() => {
    if (restoredIdentity.current === navigationIdentity) return;
    const saved = readNavigationPreferences(navigationIdentity);
    const fallback = resolveTournamentReadiness(mgr.tournament, {
      running: mgr.tournamentServerService.status.running,
      currentRoundNumber: mgr.tournamentServerService.currentRoundNumber,
      releasedRoundNumber: mgr.tournamentServerService.releasedRoundNumber,
      inboxCount: mgr.tournamentServerService.inbox.length,
      conflictCount: mgr.tournamentServerService.conflicts.length,
    });
    const next =
      saved ??
      fallbackNavigationPreferences({
        coreReady: fallback.coreReady,
        roomOperationsEnabled: fallback.roomOperationsEnabled,
        currentRoundNumber: fallback.currentRoundNumber,
        hasMatches:
          mgr.tournament.hasMatchData ||
          mgr.tournament.phases.some((phase) => phase.rounds.some((round) => round.matches.length > 0)),
        hasScheduledMatches: mgr.tournament.scheduledMatches.length > 0,
        tournamentComplete: fallback.state === 'tournament-complete',
      });
    restoredIdentity.current = navigationIdentity;
    setactivePage(next.activePage);
    setSetupSection(next.setupSection);
    setControlSection(next.controlSection);
  }, [mgr, mgr.filePath, mgr.tournament, navigationIdentity]);

  useEffect(() => {
    if (restoredIdentity.current !== navigationIdentity) return;
    writeNavigationPreferences(navigationIdentity, { activePage, setupSection, controlSection });
  }, [activePage, controlSection, navigationIdentity, setupSection]);

  useHotkeys(
    'mod+k',
    (event) => {
      event.preventDefault();
      setQuickFindOpen(true);
    },
    { enableOnFormTags: true },
  );

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

  const openReadinessTarget = (target: ReadinessTarget, navigation?: IQuickFindNavigation) => {
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
        setGamesNavigation(navigation ? { ...navigation } : null);
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
        onOpenQuickFind={() => setQuickFindOpen(true)}
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
              gamesNavigation={gamesNavigation}
              onGamesNavigationHandled={() => setGamesNavigation(null)}
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
      <QuickFindDialog open={quickFindOpen} onClose={() => setQuickFindOpen(false)} onNavigate={openReadinessTarget} />
      <GenericToast />
    </>
  );
}

interface IActivePageProps {
  whichPage: ApplicationPages;
  setupSection: SetupPages;
  controlSection: ControlPages;
  gamesNavigation: IQuickFindNavigation | null;
  onGamesNavigationHandled: () => void;
  onOpenSetup: (section: SetupPages) => void;
  onOpenControl: (section?: ControlPages) => void;
  onNavigateTarget: (target: ReadinessTarget) => void;
  onNavigate: (page: ApplicationPages, setupSection?: SetupPages) => void;
}

/** A switch statement for which page to show */
function ActivePage(props: IActivePageProps) {
  const {
    whichPage,
    setupSection,
    controlSection,
    gamesNavigation,
    onGamesNavigationHandled,
    onOpenSetup,
    onOpenControl,
    onNavigateTarget,
    onNavigate,
  } = props;
  switch (whichPage) {
    case ApplicationPages.Setup:
      return <SetupPage section={setupSection} onSectionChange={onOpenSetup} onNavigateTarget={onNavigateTarget} />;
    case ApplicationPages.Games:
      return (
        <GamesPage
          navigation={gamesNavigation ?? undefined}
          onNavigationHandled={onGamesNavigationHandled}
          onNavigate={onNavigate}
        />
      );
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

function QuickFindDialog({
  open,
  onClose,
  onNavigate,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (target: ReadinessTarget, navigation?: IQuickFindNavigation) => void;
}) {
  const mgr = useContext(TournamentContext);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const items = useMemo(() => buildQuickFindItems(mgr.tournament), [mgr.tournament]);
  const results = useMemo(() => filterQuickFindItems(items, query), [items, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelectedIndex(0);
  }, [open]);

  useEffect(() => {
    setSelectedIndex((index) => Math.min(index, Math.max(results.length - 1, 0)));
  }, [results.length]);

  const choose = (item: IQuickFindItem | undefined) => {
    if (!item) return;
    onClose();
    onNavigate(item.target, item.navigation);
  };

  return (
    <Dialog fullWidth maxWidth="sm" open={open} onClose={onClose} aria-labelledby="quick-find-title">
      <DialogTitle id="quick-find-title" sx={{ pb: 1 }}>
        Quick Find
      </DialogTitle>
      <DialogContent sx={{ pt: '8px !important' }}>
        <TextField
          autoFocus
          fullWidth
          size="small"
          placeholder="Find a team, game, round, room, or action"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setSelectedIndex((index) => Math.min(index + 1, Math.max(results.length - 1, 0)));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setSelectedIndex((index) => Math.max(index - 1, 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              choose(results[selectedIndex]);
            }
          }}
          slotProps={{ htmlInput: { 'aria-label': 'Quick Find search' } }}
        />
        <List dense sx={{ mt: 1, mx: -1 }}>
          {results.map((item, index) => (
            <ListItemButton
              key={item.id}
              selected={index === selectedIndex}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={() => choose(item)}
            >
              <ListItemText primary={item.label} secondary={item.detail} />
            </ListItemButton>
          ))}
          {results.length === 0 && (
            <ListItemText
              sx={{ px: 1.5, py: 1 }}
              primary="No matching items"
              secondary="Try a team name or round number."
            />
          )}
        </List>
      </DialogContent>
    </Dialog>
  );
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
