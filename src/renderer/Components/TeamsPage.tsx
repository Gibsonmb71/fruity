import { Add, Delete, Edit, FileUpload, MoreVert, PersonAdd, Search } from '@mui/icons-material';
import {
  Box,
  Button,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useContext, useMemo, useState } from 'react';
import Registration from '../DataModel/Registration';
import useSubscription from '../Utils/CustomHooks';
import { TournamentContext } from '../TournamentManager';
import { Team } from '../DataModel/Team';
import { nextAlphabetLetter } from '../Utils/GeneralUtils';
import SeedingView from './TeamsPageSeedingView';
import StandingsView from './TeamsPageStandingsView';
import { YfEmptyState, YfPageHeader } from '../Utils/GeneralReactUtils';

// Defines the order the tabs should be in
const viewList = ['Registration', 'Prelim assignments', 'Rebracket / final ranks'];

/** Above this many teams, finding one by eye stops being reasonable. */
const searchThreshold = 12;

interface ITeamsPageProps {
  // eslint-disable-next-line react/require-default-props
  showPageHeader?: boolean;
}

function TeamsPage({ showPageHeader = true }: ITeamsPageProps) {
  const tournManager = useContext(TournamentContext);
  const [curView] = useSubscription(tournManager.currentTeamsPageView);

  const setView = (whichPage: number) => {
    if (whichPage === 2) {
      tournManager.compileStats();
    }
    tournManager.setTeamsPageView(whichPage);
  };

  return (
    <>
      {showPageHeader && <YfPageHeader title="Teams" description="Registrations, pool assignments and final ranks." />}
      {/* Page-level sub-navigation: these are three different jobs, not three settings. */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2.5 }}>
        <Tabs value={curView} onChange={(e, newValue) => setView(newValue)}>
          {viewList.map((val) => (
            <Tab key={val} label={val} />
          ))}
        </Tabs>
      </Box>
      {curView === 0 && <RegistrationView />}
      {curView === 1 && <SeedingView />}
      {curView === 2 && <StandingsView />}
    </>
  );
}

/** One row of the roster table: a single team, plus the registration it belongs to. */
interface ITeamRow {
  registration: Registration;
  team: Team;
  /** Is this the first team listed for its registration? Only that row prints the org name. */
  isFirstForReg: boolean;
  /** The letter a new sibling team would get, or '' if this isn't the last team of the reg. */
  nextLetter: string;
}

function RegistrationView() {
  const tournManager = useContext(TournamentContext);
  const thisTournament = tournManager.tournament;
  const [registrations] = useSubscription(thisTournament.registrations);
  const [numberOfTeams] = useSubscription(thisTournament.getNumberOfTeams());
  const [expectedNumTeams] = useSubscription(thisTournament.getExpectedNumberOfTeams());
  const [search, setSearch] = useState('');

  const cantAddMoreTeams = expectedNumTeams !== null && numberOfTeams >= expectedNumTeams;
  const showSearch = numberOfTeams > searchThreshold;

  const allRows = useMemo(() => {
    const result: ITeamRow[] = [];
    for (const reg of registrations) {
      reg.teams.forEach((team, idx) => {
        const isLastForReg = idx === reg.teams.length - 1;
        let nextLetter = '';
        if (isLastForReg) nextLetter = team.letter === '' ? 'B' : nextAlphabetLetter(team.letter);
        result.push({ registration: reg, team, isFirstForReg: idx === 0, nextLetter });
      });
    }
    return result;
  }, [registrations]);

  const needle = search.trim().toLowerCase();
  const rows =
    needle === ''
      ? allRows
      : allRows
          .filter(
            (row) =>
              row.team.name.toLowerCase().includes(needle) || row.registration.name.toLowerCase().includes(needle),
          )
          // A filtered list has no reliable "first of its group", so every visible row names its org.
          .map((row) => ({ ...row, isFirstForReg: true }));

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1 }}>
          <Typography variant="h3" component="h2">
            {numberOfTeams}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {teamCountCaption(numberOfTeams, expectedNumTeams)}
          </Typography>
        </Stack>
        {numberOfTeams > 0 && (
          <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            {showSearch && (
              <TextField
                hiddenLabel
                placeholder="Search teams"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                sx={{ width: 220 }}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <Search fontSize="small" />
                      </InputAdornment>
                    ),
                  },
                }}
              />
            )}
            <ImportMenuButton disabled={cantAddMoreTeams} />
            <Tooltip title={cantAddMoreTeams ? scheduleFullReason(expectedNumTeams) : ''}>
              <span>
                <Button
                  variant="contained"
                  startIcon={<Add />}
                  disabled={cantAddMoreTeams}
                  onClick={() => tournManager.openTeamEditModalNewTeam()}
                >
                  Add team
                </Button>
              </span>
            </Tooltip>
          </Stack>
        )}
      </Box>

      {numberOfTeams === 0 ? (
        <Paper variant="outlined">
          <YfEmptyState
            title="No teams registered yet"
            description="Add teams one at a time, or bring in a whole field from a QBJ or SQBS file you already have."
            action={
              <Stack direction="row" sx={{ gap: 1, justifyContent: 'center' }}>
                <Button variant="contained" startIcon={<Add />} onClick={() => tournManager.openTeamEditModalNewTeam()}>
                  Add team
                </Button>
                <ImportMenuButton disabled={false} />
              </Stack>
            }
          />
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Organization</TableCell>
                <TableCell sx={{ width: '7rem' }}>Team</TableCell>
                <TableCell align="right" sx={{ width: '6rem' }}>
                  Players
                </TableCell>
                <TableCell sx={{ width: '9rem' }}>Attributes</TableCell>
                <TableCell align="right" sx={{ width: '5.5rem' }} aria-label="Actions" />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} sx={{ borderBottom: 0, p: 0 }}>
                    <YfEmptyState
                      compact
                      title="No teams match that search"
                      description={`Nothing is registered under "${search.trim()}".`}
                    />
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => <TeamTableRow key={row.team.name} row={row} cantAddMoreTeams={cantAddMoreTeams} />)
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Stack>
  );
}

interface IImportMenuButtonProps {
  disabled: boolean;
}

/**
 * Importing is a secondary path, so it gets its own menu instead of hiding under an arrow attached to
 * "Add team" — in a split button that arrow reads as part of the primary action.
 */
function ImportMenuButton(props: IImportMenuButtonProps) {
  const { disabled } = props;
  const tournManager = useContext(TournamentContext);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const runAndClose = (action: () => void) => {
    setAnchorEl(null);
    action();
  };

  return (
    <>
      <Button
        variant="outlined"
        startIcon={<FileUpload />}
        disabled={disabled}
        aria-haspopup="true"
        onClick={(e) => setAnchorEl(e.currentTarget)}
      >
        Import
      </Button>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        <MenuItem onClick={() => runAndClose(() => tournManager.launchImportQbjTeamsWorkflow())}>
          From a QBJ / MODAQ file
        </MenuItem>
        <MenuItem onClick={() => runAndClose(() => tournManager.launchImportSqbsTeamsWorkflow())}>
          From an SQBS file
        </MenuItem>
      </Menu>
    </>
  );
}

interface ITeamTableRowProps {
  row: ITeamRow;
  cantAddMoreTeams: boolean;
}

function TeamTableRow(props: ITeamTableRowProps) {
  const { row, cantAddMoreTeams } = props;
  const { registration, team, isFirstForReg, nextLetter } = row;
  const tournManager = useContext(TournamentContext);
  const hasPlayed = tournManager.tournament.teamHasPlayedAnyMatch(team);

  const openEditor = () => tournManager.openTeamEditModalExistingTeam(registration, team);

  return (
    <TableRow
      hover
      onDoubleClick={openEditor}
      // A hairline above each new organization groups its A/B/C teams without indenting them into a
      // nested container of their own.
      sx={isFirstForReg ? { '& td': { borderTop: 1, borderTopColor: 'divider' } } : undefined}
    >
      <TableCell>
        {isFirstForReg && (
          <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
            {registration.name}
          </Typography>
        )}
      </TableCell>
      <TableCell sx={{ color: team.letter === '' ? 'text.secondary' : undefined }}>
        {team.letter === '' ? 'Only team' : team.letter}
      </TableCell>
      <TableCell align="right" sx={{ color: team.players.length === 0 ? 'error.main' : undefined }}>
        {team.players.length}
      </TableCell>
      <TableCell sx={{ color: 'text.secondary' }}>{teamAttributeDisplay(registration, team) || '—'}</TableCell>
      <TableCell align="right">
        <Stack direction="row" sx={{ justifyContent: 'flex-end', gap: 0.25 }}>
          <Tooltip title="Edit team and roster">
            <IconButton size="small" onClick={openEditor} aria-label={`Edit ${team.name}`}>
              <Edit fontSize="small" />
            </IconButton>
          </Tooltip>
          <TeamRowMenu
            teamName={team.name}
            hasPlayed={hasPlayed}
            nextLetter={cantAddMoreTeams ? '' : nextLetter}
            onAddSibling={() => tournManager.startNextTeamForRegistration(registration, nextLetter)}
            onDelete={() => tournManager.tryDeleteTeam(registration, team)}
          />
        </Stack>
      </TableCell>
    </TableRow>
  );
}

interface ITeamRowMenuProps {
  teamName: string;
  hasPlayed: boolean;
  /** '' when another team for this organization can't be started from here. */
  nextLetter: string;
  onAddSibling: () => void;
  onDelete: () => void;
}

/**
 * The less-used per-team actions. These were three or four naked icon buttons on every row, which
 * turned a 30-team field into a wall of icons.
 */
function TeamRowMenu(props: ITeamRowMenuProps) {
  const { teamName, hasPlayed, nextLetter, onAddSibling, onDelete } = props;
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const runAndClose = (action: () => void) => {
    setAnchorEl(null);
    action();
  };

  return (
    <>
      <IconButton
        size="small"
        aria-label={`More actions for ${teamName}`}
        aria-haspopup="true"
        onClick={(e) => setAnchorEl(e.currentTarget)}
      >
        <MoreVert fontSize="small" />
      </IconButton>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        {nextLetter !== '' && (
          <MenuItem onClick={() => runAndClose(onAddSibling)}>
            <PersonAdd fontSize="small" sx={{ mr: 1 }} />
            {`Add ${nextLetter} team for this organization`}
          </MenuItem>
        )}
        {/* Disabled with the reason spelled out, rather than a dead icon plus a tooltip. */}
        <MenuItem disabled={hasPlayed} onClick={() => runAndClose(onDelete)}>
          <Delete fontSize="small" sx={{ mr: 1 }} />
          {hasPlayed ? "Can't delete — games entered" : 'Delete team'}
        </MenuItem>
      </Menu>
    </>
  );
}

function teamCountCaption(numTeams: number, numTeamsForSchedule: number | null) {
  const noun = numTeams === 1 ? 'team' : 'teams';
  if (numTeamsForSchedule === null) return `${noun} registered`;
  return `${noun} registered of the ${numTeamsForSchedule} this format expects`;
}

function scheduleFullReason(expectedNumTeams: number | null) {
  return `The format is built for ${expectedNumTeams} teams and they're all registered. Change the format to fit more.`;
}

function teamAttributeDisplay(reg: Registration, team: Team) {
  const attributes: string[] = [];
  if (reg.isSmallSchool) attributes.push('SS');
  if (team.isJV) attributes.push('JV');
  if (team.isUG) attributes.push('UG');
  if (team.isD2) attributes.push('D2');

  return attributes.join(' · ');
}

export default TeamsPage;
