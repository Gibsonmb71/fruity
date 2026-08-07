import {
  Stack,
  Accordion,
  Chip,
  AccordionSummary,
  AccordionDetails,
  Typography,
  IconButton,
  Box,
  Tooltip,
  Autocomplete,
  TextField,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Tab,
  Tabs,
} from '@mui/material';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Add, Delete, Edit, Error, ExpandMore, FileUpload, FilterAlt, Warning } from '@mui/icons-material';
import { TournamentContext } from '../TournamentManager';
import useSubscription from '../Utils/CustomHooks';
import { Match } from '../DataModel/Match';
import { Phase } from '../DataModel/Phase';
import { Round } from '../DataModel/Round';
import GamesViewByPool from './GamesPagePoolView';
import { ValidationStatuses } from '../DataModel/Interfaces';
import { Team } from '../DataModel/Team';
import { CtrlOrCmd, trunc } from '../Utils/GeneralUtils';
import { YfEmptyState, YfPageHeader } from '../Utils/GeneralReactUtils';
import { ApplicationPages, SetupPages } from '../Enums';
import type { GamesReviewFilter, INavigationIntent } from '../Services/Navigation';

// Defines the order the buttons should be in
const viewList = ['By round', 'By pool'];

const teamSelectNullOption = '';

interface IGamesPageProps {
  // eslint-disable-next-line react/require-default-props
  onNavigate?: (page: ApplicationPages, setupSection?: SetupPages) => void;
  // eslint-disable-next-line react/require-default-props
  navigation?: INavigationIntent;
  // eslint-disable-next-line react/require-default-props
  onNavigationHandled?: () => void;
}

export default function GamesPage(props: IGamesPageProps) {
  const { onNavigate, navigation, onNavigationHandled } = props;
  const tournManager = useContext(TournamentContext);
  const [curView] = useSubscription(tournManager.currentGamesPageView);
  const [filterTeam, setFilterTeam] = useState<Team | undefined>(() =>
    navigation?.teamName ? tournManager.tournament.findTeamByName(navigation.teamName) : undefined,
  );
  const [reviewFilter, setReviewFilter] = useState<GamesReviewFilter>(navigation?.gamesReviewFilter ?? 'all');
  const hasSchedule = tournManager.tournament.phases.length > 0;

  useEffect(() => {
    if (!navigation) return;
    if (navigation.teamName) {
      setFilterTeam(tournManager.tournament.findTeamByName(navigation.teamName));
    }
    if (navigation.gamesReviewFilter !== undefined) setReviewFilter(navigation.gamesReviewFilter);
    if (navigation.matchId) {
      const matchAndRound = tournManager.tournament.phases
        .flatMap((phase) =>
          phase.rounds.map((round) => ({
            round,
            match: round.matches.find((m) => m.id === navigation.matchId),
          })),
        )
        .find((entry) => entry.match !== undefined);
      if (matchAndRound?.match) tournManager.openMatchEditModalExistingMatch(matchAndRound.match, matchAndRound.round);
    }
    onNavigationHandled?.();
  }, [navigation, onNavigationHandled, tournManager]);

  const reviewCounts = useMemo(() => {
    const counts = { errors: 0, warnings: 0 };
    tournManager.tournament.phases
      .flatMap((phase) => phase.rounds.flatMap((round) => round.matches))
      .forEach((match) => {
        if (match.getErrorMessages().length > 0) counts.errors += 1;
        else if (match.getWarningMessages().length > 0) counts.warnings += 1;
      });
    return counts;
  }, [tournManager.tournament.phases]);

  return (
    <>
      <YfPageHeader title="Games" description="Every game entered for this tournament, by round or by pool." />
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          flexWrap: 'wrap',
          pb: 2,
          mb: 2,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Tabs
          value={curView}
          onChange={(e, newValue) => {
            tournManager.setGamesPageView(newValue);
          }}
          aria-label="Game views"
          sx={{ minHeight: 36, '& .MuiTab-root': { minHeight: 36, py: 0.25, px: 1.5 } }}
        >
          {viewList.map((val, idx) => (
            <Tab key={val} value={idx} label={val} />
          ))}
        </Tabs>
        <Tooltip placement="top" title={`Import games from one file into multiple rounds (${CtrlOrCmd()}+M)`}>
          <span>
            <Button
              variant="outlined"
              startIcon={<FileUpload />}
              disabled={tournManager.tournament.phases.length === 0}
              onClick={() => tournManager.launchImportMatchWorkflow()}
            >
              Import
            </Button>
          </span>
        </Tooltip>
        {curView === 0 && (
          <Box sx={{ ml: 'auto', width: { xs: '100%', sm: 320 } }}>
            <TeamFilterField filterByTeam={setFilterTeam} />
          </Box>
        )}
        <FormControl size="small" sx={{ minWidth: 165 }}>
          <InputLabel>Review</InputLabel>
          <Select
            value={reviewFilter}
            label="Review"
            onChange={(event) => setReviewFilter(event.target.value as GamesReviewFilter)}
            aria-label="Filter games by review status"
          >
            <MenuItem value="all">All games</MenuItem>
            <MenuItem value="needs-review">Needs review ({reviewCounts.errors + reviewCounts.warnings})</MenuItem>
            <MenuItem value="errors">Errors ({reviewCounts.errors})</MenuItem>
            <MenuItem value="warnings">Warnings ({reviewCounts.warnings})</MenuItem>
          </Select>
        </FormControl>
      </Box>
      {!hasSchedule ? (
        <Paper variant="outlined">
          <YfEmptyState
            title="Choose a format before entering games"
            description="Once the tournament has stages and rounds, games will be organized here for quick entry and review."
            action={
              <Button variant="contained" onClick={() => onNavigate?.(ApplicationPages.Setup, SetupPages.Format)}>
                Open Format
              </Button>
            }
          />
        </Paper>
      ) : (
        <>
          {curView === 0 && (
            <GamesViewByRound
              filterTeam={filterTeam}
              reviewFilter={reviewFilter}
              initialRoundNumber={navigation?.roundNumber}
              initialMatchId={navigation?.matchId}
            />
          )}
          {curView === 1 && <GamesViewByPool reviewFilter={reviewFilter} />}
        </>
      )}
    </>
  );
}

interface ITeamFilterFieldProps {
  filterByTeam: (team: Team | undefined) => void;
}

function TeamFilterField(props: ITeamFilterFieldProps) {
  const { filterByTeam } = props;
  const tournManager = useContext(TournamentContext);
  const thisTourn = tournManager.tournament;
  const [filterTeam, setFilterTeam] = useState<Team | undefined>(undefined);
  const [filterInputValue, setFilterInputValue] = useState('');

  const handleFilterChange = (val: string | null) => {
    const matchingTeam = val === null ? undefined : thisTourn.findTeamByName(val) ?? undefined;
    setFilterTeam(matchingTeam);
    filterByTeam(matchingTeam);
  };

  const isOptionEqualToValue = (option: string, value: string) => {
    if (value === option) return true;
    return value === '' && option === teamSelectNullOption;
  };

  const allTeamNames = useMemo(() => thisTourn.getListOfAllTeams().map((tm) => tm.name), [thisTourn]);
  const filterOptions = [teamSelectNullOption].concat(allTeamNames);

  return (
    <Autocomplete
      autoHighlight
      clearOnEscape
      autoSelect
      value={filterTeam?.name ?? ''}
      onChange={(event: any, newValue: string | null) => handleFilterChange(newValue)}
      inputValue={filterInputValue}
      onInputChange={(event, newVal) => setFilterInputValue(newVal)}
      options={filterOptions}
      isOptionEqualToValue={isOptionEqualToValue}
      // eslint-disable-next-line react/jsx-props-no-spreading
      renderInput={(params) => <TextField {...params} size="small" label="Filter by team" />}
    />
  );
}

interface IGameViewByRoundProps {
  filterTeam: Team | undefined;
  reviewFilter: GamesReviewFilter;
  // eslint-disable-next-line react/require-default-props
  initialRoundNumber?: number;
  // eslint-disable-next-line react/require-default-props
  initialMatchId?: string;
}

function GamesViewByRound(props: IGameViewByRoundProps) {
  const { filterTeam, reviewFilter, initialRoundNumber, initialMatchId } = props;
  const tournManager = useContext(TournamentContext);
  const [phases] = useSubscription(tournManager.tournament.phases);

  return (
    <Stack spacing={2}>
      {phases.map((phase) => (
        <GamesForPhaseByRound
          key={phase.name}
          phase={phase}
          filterTeam={filterTeam}
          reviewFilter={reviewFilter}
          initialRoundNumber={initialRoundNumber}
          initialMatchId={initialMatchId}
        />
      ))}
    </Stack>
  );
}

interface IGamesForPhaseByRoundProps {
  phase: Phase;
  filterTeam: Team | undefined;
  reviewFilter: GamesReviewFilter;
  // eslint-disable-next-line react/require-default-props
  initialRoundNumber?: number;
  // eslint-disable-next-line react/require-default-props
  initialMatchId?: string;
}

function GamesForPhaseByRound(props: IGamesForPhaseByRoundProps) {
  const { phase, filterTeam, reviewFilter, initialRoundNumber, initialMatchId } = props;

  return (
    <Box component="section" aria-labelledby={`games-phase-${phase.code}`}>
      <Typography
        id={`games-phase-${phase.code}`}
        variant="overline"
        sx={{ display: 'block', color: 'text.secondary', letterSpacing: '0.08em', fontWeight: 700, mb: 0.5 }}
      >
        {phase.name}
      </Typography>
      <Box sx={{ borderTop: 1, borderColor: 'divider' }}>
        {phase.rounds.map((round) => (
          <SingleRound
            key={round.name}
            round={round}
            expanded={!!filterTeam}
            forceNumericDisplay={phase.forceNumericRounds || false}
            filterTeam={filterTeam}
            reviewFilter={reviewFilter}
            initialRoundNumber={initialRoundNumber}
            initialMatchId={initialMatchId}
          />
        ))}
      </Box>
    </Box>
  );
}

interface ISingleRoundProps {
  round: Round;
  expanded: boolean;
  forceNumericDisplay: boolean;
  filterTeam: Team | undefined;
  reviewFilter: GamesReviewFilter;
  // eslint-disable-next-line react/require-default-props
  initialRoundNumber?: number;
  // eslint-disable-next-line react/require-default-props
  initialMatchId?: string;
}

function SingleRound(props: ISingleRoundProps) {
  const {
    round,
    expanded: expandedProp,
    forceNumericDisplay,
    filterTeam,
    reviewFilter,
    initialRoundNumber,
    initialMatchId,
  } = props;
  const tournManager = useContext(TournamentContext);
  const [expanded, setExpanded] = useState(expandedProp || initialRoundNumber === round.number);
  const canAddMatch = useMemo(() => tournManager.tournament.readyToAddMatches(), [tournManager]);
  const [numErrs, numWarns] = round.countErrorsAndWarnings();
  const matchesToShow = useMemo(
    () =>
      round.matches.filter(
        (match) => (!filterTeam || match.includesTeam(filterTeam)) && reviewFilterMatches(match, reviewFilter),
      ),
    [filterTeam, reviewFilter, round.matches],
  );
  const numMatches = matchesToShow.length;

  useEffect(() => {
    const hasDeepFilter = !!filterTeam || reviewFilter !== 'all' || initialRoundNumber === round.number;
    if (hasDeepFilter) setExpanded(numMatches > 0);
  }, [filterTeam, initialRoundNumber, numMatches, reviewFilter, round.number]);

  const newMatchForRound = () => {
    tournManager.openMatchModalNewMatchForRound(round);
  };
  const importMatches = () => {
    tournManager.launchImportMatchWorkflow(round);
  };

  return (
    // Borderless inside the phase panel: the panel already provides the containment, and the
    // rounds are separated by the parent's hairlines.
    <Accordion
      expanded={expanded}
      sx={{ border: 0, borderRadius: 0, '& + &': { mt: 0 } }}
      onChange={() => setExpanded(!expanded)}
    >
      <AccordionSummary expandIcon={<ExpandMore fontSize="small" />} sx={{ px: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%', pr: 1 }}>
          <Typography variant="subtitle2" sx={{ width: 140, flexShrink: 0 }}>
            {round.displayName(forceNumericDisplay)}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {numMatches === 1 ? '1 game' : `${numMatches} games`}
            {!!filterTeam && <FilterAlt fontSize="small" />}
            {reviewFilter !== 'all' && <FilterAlt fontSize="small" />}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, ml: 'auto' }}>
            {numErrs > 0 && (
              <Typography variant="caption" color="error.main" sx={{ fontWeight: 600 }}>
                {numErrs} {numErrs === 1 ? 'error' : 'errors'}
              </Typography>
            )}
            {numWarns > 0 && (
              <Typography variant="caption" color="warning.main" sx={{ fontWeight: 600 }}>
                {numWarns} {numWarns === 1 ? 'warning' : 'warnings'}
              </Typography>
            )}
            {canAddMatch && (
              <Box sx={{ display: 'flex', gap: 0.25 }}>
                <Tooltip title="Enter a new game for this round" placement="left">
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      newMatchForRound();
                    }}
                  >
                    <Add fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip placement="top" title="Import games from other files into this round">
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      importMatches();
                    }}
                  >
                    <FileUpload fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            )}
          </Box>
        </Box>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 2, pb: 1.5 }}>
        {expanded && <SingleRoundMatchList round={round} matchList={matchesToShow} initialMatchId={initialMatchId} />}
      </AccordionDetails>
    </Accordion>
  );
}

interface ISingleRoundMatchListProps {
  round: Round;
  matchList: Match[];
  // eslint-disable-next-line react/require-default-props
  initialMatchId?: string;
}

function SingleRoundMatchList(props: ISingleRoundMatchListProps) {
  const { round, matchList, initialMatchId } = props;
  return (
    matchList.length > 0 && (
      <Box
        sx={{
          '& > * + *': { borderTop: 1, borderColor: 'divider' },
        }}
      >
        {matchList.map((m) => (
          <MatchListItem key={m.id} match={m} round={round} highlighted={m.id === initialMatchId} />
        ))}
      </Box>
    )
  );
}

interface IMatchListItemProps {
  match: Match;
  round: Round;
  // eslint-disable-next-line react/require-default-props
  highlighted?: boolean;
}

function reviewFilterMatches(match: Match, reviewFilter: GamesReviewFilter): boolean {
  if (reviewFilter === 'all') return true;
  const hasErrors = match.getErrorMessages().length > 0;
  const hasWarnings = match.getWarningMessages().length > 0;
  if (reviewFilter === 'errors') return hasErrors;
  if (reviewFilter === 'warnings') return hasWarnings;
  return hasErrors || hasWarnings;
}

function MatchListItem(props: IMatchListItemProps) {
  const { match, round, highlighted = false } = props;
  const tournManager = useContext(TournamentContext);
  const itemRef = useRef<HTMLDivElement>(null);
  const validationStatus = match.getOverallValidationStatus();

  const errorMessage = match.getErrorMessages()[0];
  const warningMessage = match.getWarningMessages()[0];
  const scheduledContext = tournManager.tournament.scheduledMatches.find(
    (scheduled) => scheduled.resultMatchId === match.id,
  );
  const isOfficialResult = scheduledContext?.isAccepted() === true;
  const editLabel = isOfficialResult ? 'Correct official result…' : 'Edit game';

  useEffect(() => {
    if (!highlighted || !itemRef.current) return;
    itemRef.current.scrollIntoView({ block: 'center' });
  }, [highlighted]);

  return (
    <Box
      ref={itemRef}
      id={`game-${match.id}`}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: 1.5,
        py: 1,
        '&:hover': { backgroundColor: 'action.hover' },
        ...(highlighted ? { backgroundColor: 'action.selected', outline: 1, outlineColor: 'primary.main' } : {}),
      }}
      onDoubleClick={() => tournManager.openMatchEditModalExistingMatch(match, round)}
    >
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography variant="subtitle1">{match.getScoreString()}</Typography>
        {match.carryoverPhases.length > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {`Carries over to: ${match.listCarryoverPhases()}`}
          </Typography>
        )}
        {match.importedFile && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {`Imported from ${match.importedFile}`}
          </Typography>
        )}
        {match.notes && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {match.notes}
          </Typography>
        )}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        {validationStatus === ValidationStatuses.Error && (
          <Typography
            variant="caption"
            color="error.main"
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5, maxWidth: 360 }}
          >
            <Error color="error" sx={{ fontSize: 18, flexShrink: 0 }} />
            {`Error: ${trunc(errorMessage ?? 'Invalid game data', 120)}`}
          </Typography>
        )}
        {validationStatus === ValidationStatuses.Warning && (
          <Typography
            variant="caption"
            color="warning.main"
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5, maxWidth: 360 }}
          >
            <Warning color="warning" sx={{ fontSize: 18, flexShrink: 0 }} />
            {`Warning: ${trunc(warningMessage ?? 'Review this game', 120)}`}
          </Typography>
        )}
      </Box>
      <Box sx={{ display: 'flex', gap: 0.25, flexShrink: 0 }}>
        <Tooltip title={editLabel}>
          <IconButton
            size="small"
            aria-label={editLabel}
            onClick={() => tournManager.openMatchEditModalExistingMatch(match, round)}
          >
            <Edit fontSize="small" />
          </IconButton>
        </Tooltip>
        {/*
          An accepted official result is half of a pair: deleting it would leave the Match Plan
          pointing at a game that no longer exists. Correction is the real workflow, and it is the
          pencil next to this, so a disabled bin would only be a dead control to click at. The
          service layer refuses the deletion regardless of what is rendered here.
        */}
        {isOfficialResult ? (
          <Tooltip title='Accepted official result. Corrections go through "Correct official result…".'>
            <Chip label="Official" size="small" variant="outlined" sx={{ alignSelf: 'center' }} />
          </Tooltip>
        ) : (
          <Tooltip title="Delete game">
            <IconButton size="small" aria-label="Delete game" onClick={() => tournManager.tryDeleteMatch(match, round)}>
              <Delete fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    </Box>
  );
}
