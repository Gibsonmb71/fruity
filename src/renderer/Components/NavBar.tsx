import * as React from 'react';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import Menu from '@mui/material/Menu';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  ListItemIcon,
  ListItemText,
  Tooltip,
} from '@mui/material';
import { useColorScheme } from '@mui/material/styles';
import {
  Check,
  DarkMode,
  HelpOutlined,
  LightMode,
  SaveOutlined,
  SettingsBrightness,
  WarningAmber,
} from '@mui/icons-material';
import { useHotkeys } from 'react-hotkeys-hook';
import { ApplicationPages } from '../Enums';
import { hotkeyFormat } from '../Utils/GeneralReactUtils';
import getAppPageHelpText from './PageLevelHelpText';
import { headerHeight, macTrafficLightWidth } from '../Theme/tokens';
import { TournamentContext } from '../TournamentManager';
import { ITournamentReadiness, ReadinessTarget } from '../Services/TournamentReadiness';

// Display names for the buttons
const pageNames = {
  [ApplicationPages.Setup]: 'Setup',
  [ApplicationPages.Games]: 'Games',
  [ApplicationPages.Control]: 'Control',
  [ApplicationPages.Reports]: 'Reports',
};
// Which order the pages should be in
export const applicationPageOrder = [
  ApplicationPages.Setup,
  ApplicationPages.Games,
  ApplicationPages.Control,
  ApplicationPages.Reports,
];

const isMac = window.electron.getPlatform() === 'darwin';

/** Let the user drag the window by the empty parts of the header (macOS uses an inset titlebar). */
const dragRegionSx = isMac ? ({ WebkitAppRegion: 'drag' } as const) : undefined;
const noDragSx = isMac ? ({ WebkitAppRegion: 'no-drag' } as const) : undefined;

/** Breathing room kept between the nav and the clusters on either side of it. */
const navGutter = 16;

/** Horizontal padding on the header row, in px. Needed as a number to measure the usable width. */
const rowPaddingX = 12;

/**
 * How the header arranges itself, from most to least room.
 *
 * `centered` — the nav is centered on the window itself. `inline` — there isn't room to center it,
 * so the nav flows after the left cluster instead. `scroll` — the nav is wider than the row, so it
 * becomes a horizontally scrollable strip. Labels are never shrunk or truncated in any tier; the nav
 * just stops being centered, then starts scrolling.
 *
 * Deliberately, nothing that the tier controls changes how wide the header's contents are — only
 * where the nav sits and whether it clips. If a tier hid something (the wordmark, say), losing that
 * width could make the previous tier fit again and the two would flip back and forth forever.
 */
type NavLayout = 'centered' | 'inline' | 'scroll';

interface INavBarProps {
  activePage: ApplicationPages;
  setActivePage: (page: ApplicationPages) => void;
  readiness: ITournamentReadiness;
  onNavigateTarget: (target: ReadinessTarget) => void;
}

function NavBar(props: INavBarProps) {
  const { activePage, setActivePage, readiness, onNavigateTarget } = props;
  const tournManager = React.useContext(TournamentContext);
  const [tipsDialogOpen, setTipsDialogOpen] = React.useState(false);
  const [issuesAnchor, setIssuesAnchor] = React.useState<HTMLElement | null>(null);
  const activeIndex = applicationPageOrder.indexOf(activePage);
  const tournamentLabel = tournManager.tournament.name.trim() || tournManager.displayName || 'New tournament';
  let fileStatus: 'New' | 'Unsaved' | 'Saved' = 'Saved';
  if (tournManager.unsavedData) fileStatus = 'Unsaved';
  else if (tournManager.filePath === null) fileStatus = 'New';

  const rowRef = React.useRef<HTMLDivElement | null>(null);
  const leftRef = React.useRef<HTMLDivElement | null>(null);
  const rightRef = React.useRef<HTMLDivElement | null>(null);
  const navRef = React.useRef<HTMLElement | null>(null);
  const tabRefs = React.useRef<Array<HTMLDivElement | null>>([]);

  const [layout, setLayout] = React.useState<NavLayout>('centered');
  const [indicator, setIndicator] = React.useState({ left: 0, width: 0 });
  const [indicatorReady, setIndicatorReady] = React.useState(false);

  /**
   * Pick the layout from the elements' real widths rather than from a viewport breakpoint. What
   * matters is whether the nav's own content fits, and the nav is measured against the wider of the
   * two side clusters: centering only holds when both sides can be given that much room.
   */
  React.useLayoutEffect(() => {
    const measure = () => {
      const row = rowRef.current;
      const nav = navRef.current;
      if (!row || !nav) return;

      // scrollWidth, not offsetWidth: once the nav is scrolling, its box is clipped.
      const navWidth = nav.scrollWidth;
      const rowWidth = row.clientWidth - 2 * rowPaddingX;
      const leftWidth = leftRef.current?.offsetWidth ?? 0;
      const rightWidth = rightRef.current?.offsetWidth ?? 0;
      const widestSide = Math.max(leftWidth, rightWidth);

      let next: NavLayout;
      if (navWidth + 2 * (widestSide + navGutter) <= rowWidth) next = 'centered';
      else if (navWidth + leftWidth + rightWidth + 2 * navGutter <= rowWidth) next = 'inline';
      else next = 'scroll';

      setLayout((prev) => (prev === next ? prev : next));

      // offsetLeft is relative to the nav, which is the indicator's positioned ancestor, so the
      // indicator keeps tracking the right tab even while the nav is scrolled.
      const tab = tabRefs.current[activeIndex];
      if (!tab) return;
      setIndicator((prev) =>
        prev.left === tab.offsetLeft && prev.width === tab.offsetWidth
          ? prev
          : { left: tab.offsetLeft, width: tab.offsetWidth },
      );
    };

    measure();
    // Anything that reflows the header (window resize, font swap, the layout tier changing and
    // thereby changing the cluster widths) has to re-run this, or the nav ends up off-center and the
    // indicator ends up under the wrong tab.
    const observer = new ResizeObserver(measure);
    if (rowRef.current) observer.observe(rowRef.current);
    if (navRef.current) observer.observe(navRef.current);
    if (leftRef.current) observer.observe(leftRef.current);
    if (rightRef.current) observer.observe(rightRef.current);
    return () => observer.disconnect();
  }, [activeIndex, layout]);

  // Only start transitioning once we've measured, so the bar doesn't slide in from zero width
  // on the very first render.
  React.useEffect(() => {
    if (indicator.width > 0) setIndicatorReady(true);
  }, [indicator.width]);

  // When the nav is scrolling, changing pages by keyboard could otherwise select a tab that's off
  // screen.
  React.useEffect(() => {
    if (layout !== 'scroll') return;
    tabRefs.current[activeIndex]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [activeIndex, layout]);

  const centered = layout === 'centered';

  return (
    <>
      <AppBar position="sticky">
        <Box
          ref={rowRef}
          sx={{
            ...dragRegionSx,
            position: 'relative',
            display: 'flex',
            alignItems: 'stretch',
            height: `${headerHeight}px`,
            px: `${rowPaddingX}px`,
          }}
        >
          <Box
            ref={leftRef}
            sx={{
              flexShrink: 0,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              // The traffic lights sit at the very left of the window on macOS, so only this
              // cluster needs to clear them. Padding the whole row would push the centered nav
              // off-center by half the inset.
              ...(isMac ? { pl: `${macTrafficLightWidth - rowPaddingX}px` } : undefined),
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, flexShrink: 0 }}>
              <Box
                component="span"
                aria-hidden
                sx={{
                  flexShrink: 0,
                  fontSize: '1rem',
                  lineHeight: 1,
                }}
              >
                🍌
              </Box>
              <Typography
                noWrap
                sx={{
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  letterSpacing: '-0.01em',
                  color: 'text.primary',
                  userSelect: 'none',
                }}
              >
                YellowFruit
              </Typography>
            </Box>
            <Box aria-hidden sx={{ width: '1px', height: 16, mx: 1, flexShrink: 0, backgroundColor: 'divider' }} />
            <Tooltip title={tournamentLabel} placement="bottom-start">
              <Typography
                noWrap
                sx={{
                  minWidth: 0,
                  maxWidth: 190,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  color: 'text.secondary',
                  fontSize: '0.75rem',
                  userSelect: 'none',
                }}
              >
                {tournamentLabel}
              </Typography>
            </Tooltip>
          </Box>

          <Box
            sx={{
              ...noDragSx,
              display: 'flex',
              alignItems: 'stretch',
              minWidth: 0,
              ...(centered
                ? {
                    // Centered on the window, not on the space the side clusters happen to leave
                    // over, so the nav doesn't drift as those clusters change width.
                    position: 'absolute',
                    left: '50%',
                    top: 0,
                    bottom: 0,
                    transform: 'translateX(-50%)',
                  }
                : { flex: '1 1 auto', mx: `${navGutter}px` }),
              ...(layout === 'scroll'
                ? {
                    overflowX: 'auto',
                    overflowY: 'hidden',
                    // A visible scrollbar inside a 44px strip would eat the underline; the tabs
                    // still scroll by wheel, trackpad, and keyboard focus.
                    scrollbarWidth: 'none',
                    '&::-webkit-scrollbar': { display: 'none' },
                  }
                : undefined),
            }}
          >
            <Box
              component="nav"
              ref={navRef}
              aria-label="Application pages"
              sx={{ position: 'relative', display: 'flex', alignItems: 'stretch', flexShrink: 0 }}
            >
              {applicationPageOrder.map((page, idx) => (
                <NavTab
                  key={page}
                  label={pageNames[page]}
                  selected={page === activePage}
                  onClick={() => setActivePage(page)}
                  tabRef={(el) => {
                    tabRefs.current[idx] = el;
                  }}
                />
              ))}
              <Box
                aria-hidden
                sx={{
                  position: 'absolute',
                  left: 0,
                  // Overlap the header's 1px bottom border instead of clearing it.
                  bottom: '-1px',
                  height: '2px',
                  borderRadius: '2px 2px 0 0',
                  backgroundColor: 'primary.main',
                  transitionProperty: 'transform, width',
                  transitionDuration: indicatorReady ? '260ms' : '0ms',
                  transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
                }}
                // Inline so moving the bar doesn't mint a new emotion class on every page change.
                style={{ width: `${indicator.width}px`, transform: `translateX(${indicator.left}px)` }}
              />
            </Box>
          </Box>

          <Box
            ref={rightRef}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 0.5,
              flexShrink: 0,
              // In the centered tier the nav is out of flow, so nothing else pushes this cluster to
              // the right edge.
              ...(centered ? { ml: 'auto' } : undefined),
            }}
          >
            {readiness.issues.length > 0 && (
              <Button
                size="small"
                color="warning"
                startIcon={<WarningAmber fontSize="small" />}
                onClick={(event) => setIssuesAnchor(event.currentTarget)}
                sx={{ ...noDragSx, minHeight: 28, px: 0.75, fontSize: '0.75rem' }}
              >
                {readiness.issues.length} {readiness.issues.length === 1 ? 'issue' : 'issues'}
              </Button>
            )}
            {tournManager.unsavedData && (
              <Tooltip title="Save your changes">
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<SaveOutlined fontSize="small" />}
                  onClick={() => tournManager.saveCurrentTournament()}
                  sx={{ ...noDragSx, minHeight: 28, px: 1 }}
                >
                  Save
                </Button>
              </Tooltip>
            )}
            <Tooltip title={`${fileStatus} file`}>
              <Box
                role="status"
                aria-label={`${fileStatus} file`}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.6,
                  px: 0.75,
                  color: fileStatus === 'Unsaved' ? 'warning.main' : 'text.secondary',
                  userSelect: 'none',
                }}
              >
                <Box
                  aria-hidden
                  sx={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    backgroundColor: fileStatus === 'Unsaved' ? 'warning.main' : 'currentColor',
                  }}
                />
                <Typography variant="caption" sx={{ fontSize: '0.6875rem' }}>
                  {fileStatus}
                </Typography>
              </Box>
            </Tooltip>
            <ColorModeButton />
            <Tooltip title="Show help for this page">
              <IconButton size="small" onClick={() => setTipsDialogOpen(true)} sx={noDragSx}>
                <HelpOutlined fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </AppBar>
      <Menu
        anchorEl={issuesAnchor}
        open={issuesAnchor !== null}
        onClose={() => setIssuesAnchor(null)}
        slotProps={{ paper: { sx: { maxWidth: 430 } } }}
      >
        {readiness.issues.map((issue) => (
          <MenuItem
            key={issue.id}
            onClick={() => {
              onNavigateTarget(issue.target);
              setIssuesAnchor(null);
            }}
            sx={{ alignItems: 'flex-start', whiteSpace: 'normal' }}
          >
            <ListItemIcon sx={{ minWidth: 28, mt: 0.25 }}>
              <WarningAmber color={issue.severity === 'error' ? 'error' : 'warning'} fontSize="small" />
            </ListItemIcon>
            <ListItemText primary={issue.title} secondary={issue.message} />
          </MenuItem>
        ))}
      </Menu>
      <HelpTipsDialog page={activePage} isOpen={tipsDialogOpen} onClose={() => setTipsDialogOpen(false)} />
    </>
  );
}

interface INavTabProps {
  label: string;
  selected: boolean;
  onClick: () => void;
  tabRef: (el: HTMLDivElement | null) => void;
}

/**
 * One page link in the header nav. The wrapper spans the full header height and is what the shared
 * indicator measures itself against; the button inside stays control-sized so its hover is a compact
 * inset shape rather than a full-height block.
 *
 * Font weight deliberately does not change with selection: a bolder active label would resize the
 * tabs mid-transition and make the sliding indicator chase a moving target.
 */
function NavTab(props: INavTabProps) {
  const { label, selected, onClick, tabRef } = props;

  return (
    <Box ref={tabRef} sx={{ alignSelf: 'stretch', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
      <Button
        onClick={onClick}
        aria-current={selected ? 'page' : undefined}
        sx={{
          ...noDragSx,
          minHeight: 28,
          px: 1.25,
          py: 0.25,
          borderRadius: 1.5,
          fontSize: '0.8125rem',
          fontWeight: 500,
          whiteSpace: 'nowrap',
          color: selected ? 'primary.main' : 'text.secondary',
          transition: 'color 160ms cubic-bezier(0.4, 0, 0.2, 1)',
          '&:hover': { backgroundColor: 'action.hover', color: selected ? 'primary.main' : 'text.primary' },
        }}
      >
        {label}
      </Button>
    </Box>
  );
}

const colorModeOptions = [
  { value: 'system', label: 'System', icon: <SettingsBrightness fontSize="small" /> },
  { value: 'light', label: 'Light', icon: <LightMode fontSize="small" /> },
  { value: 'dark', label: 'Dark', icon: <DarkMode fontSize="small" /> },
] as const;

/** System / Light / Dark picker. */
function ColorModeButton() {
  const { mode, setMode } = useColorScheme();
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);

  if (!mode) return null;

  const current = colorModeOptions.find((opt) => opt.value === mode) ?? colorModeOptions[0];

  return (
    <>
      <Tooltip title={`Appearance: ${current.label}`}>
        <IconButton
          size="small"
          aria-label="appearance"
          aria-haspopup="true"
          onClick={(e) => setAnchorEl(e.currentTarget)}
          sx={noDragSx}
        >
          {current.icon}
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        {colorModeOptions.map((opt) => (
          <MenuItem
            key={opt.value}
            selected={opt.value === mode}
            onClick={() => {
              setMode(opt.value);
              setAnchorEl(null);
            }}
          >
            <ListItemIcon sx={{ minWidth: 28 }}>{opt.value === mode ? <Check fontSize="small" /> : null}</ListItemIcon>
            {opt.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

interface IHelpTipsDialogProps {
  page: ApplicationPages;
  isOpen: boolean;
  onClose: () => void;
}

function HelpTipsDialog(props: IHelpTipsDialogProps) {
  const { page, isOpen, onClose } = props;

  useHotkeys('alt+c', onClose, { enabled: isOpen });

  return (
    <Dialog fullWidth maxWidth="sm" open={isOpen} onClose={onClose}>
      <DialogTitle>Help &mdash; {pageNames[page]}</DialogTitle>
      <DialogContent>
        <HelpTextDialogContent page={page} />
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose()}>{hotkeyFormat('&Close')}</Button>
      </DialogActions>
    </Dialog>
  );
}

interface IHelpTextDialogContentProps {
  page: ApplicationPages;
}

function HelpTextDialogContent(props: IHelpTextDialogContentProps) {
  const { page } = props;
  const contents = getAppPageHelpText(page);
  if (!contents) return 'No help text';

  return contents.map((sec, idx) => (
    // eslint-disable-next-line react/no-array-index-key
    <Box key={idx} sx={{ '& + &': { mt: 2 } }}>
      {sec.header && (
        <>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            {sec.header}
          </Typography>
          <Divider sx={{ mb: 1 }} />
        </>
      )}
      {sec.content.map((par, pidx) => (
        // eslint-disable-next-line react/no-array-index-key
        <Typography key={pidx} variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {par}
        </Typography>
      ))}
    </Box>
  ));
}

export default NavBar;
