import { createContext } from 'react';
import MatchImportResult, { ImportResultStatus } from '../DataModel/MatchImportResult';
import { Round } from '../DataModel/Round';
import { StatsValidity } from '../DataModel/Match';
import { getFileNameFromPath } from '../Utils/GeneralUtils';
import Tournament from '../DataModel/Tournament';
import {
  IScheduledLinkSuggestion,
  ScheduledLinkOutcome,
  commitScheduledResult,
  suggestScheduledMatchForImport,
} from '../Services/ScheduledResultReconciliation';

/** How the director chose to bring one imported game into the tournament. */
export type ImportLinkChoice = 'scheduled' | 'ordinary';

/** What the dialog knows about one imported game beyond its validation. */
export interface IImportLinkState {
  outcome: ScheduledLinkOutcome;
  /** Defaults to the scheduled link when one is offered, because that is almost always the intent. */
  choice: ImportLinkChoice;
}

export default class MatchImportResultsManager {
  modalIsOpen: boolean = false;

  round?: Round;

  resultsList?: MatchImportResult[];

  /**
   * Whether each imported game matches an unresolved scheduled game, keyed by result.
   *
   * Computed once when the dialog opens rather than per render: the answer depends on the whole
   * Match Plan, and recomputing it while the director is looking at it would let the offered
   * candidate change under them.
   */
  linkState: Map<MatchImportResult, IImportLinkState> = new Map();

  /**
   * Set when a scheduled import was refused after the director confirmed it.
   *
   * Kept rather than thrown: the ordinary import already happened for every other file in the
   * batch, and the director needs to know which one did not land and why.
   */
  importProblems: string[] = [];

  private tournament?: Tournament;

  dataChangedReactCallback: () => void;

  constructor() {
    this.dataChangedReactCallback = () => {};
  }

  reset() {
    delete this.round;
    delete this.resultsList;
    this.linkState = new Map();
  }

  openModal(resultsList: MatchImportResult[], round?: Round, tournament?: Tournament) {
    this.modalIsOpen = true;
    this.round = round;
    this.resultsList = resultsList;
    this.tournament = tournament;
    this.importProblems = [];
    this.linkState = new Map();
    if (tournament) {
      for (const result of resultsList) {
        if (result.status === ImportResultStatus.FatalErr) continue;
        const outcome = suggestScheduledMatchForImport(tournament, result);
        this.linkState.set(result, { outcome, choice: outcome.kind === 'candidate' ? 'scheduled' : 'ordinary' });
      }
    }
    this.dataChangedReactCallback();
  }

  closeModal(shouldSave: boolean) {
    if (shouldSave) {
      this.finishImport();
    }
    this.modalIsOpen = false;
    this.reset();
    this.dataChangedReactCallback();
  }

  /** The candidate offered for one result, if there is exactly one. */
  suggestionFor(result: MatchImportResult): IScheduledLinkSuggestion | undefined {
    const state = this.linkState.get(result);
    return state?.outcome.kind === 'candidate' ? state.outcome.suggestion : undefined;
  }

  outcomeFor(result: MatchImportResult): ScheduledLinkOutcome | undefined {
    return this.linkState.get(result)?.outcome;
  }

  choiceFor(result: MatchImportResult): ImportLinkChoice {
    return this.linkState.get(result)?.choice ?? 'ordinary';
  }

  setLinkChoice(result: MatchImportResult, choice: ImportLinkChoice) {
    const state = this.linkState.get(result);
    if (!state) return;
    // Only a result with a real candidate can be linked. Anything else stays an ordinary import
    // whatever the UI asks for.
    state.choice = state.outcome.kind === 'candidate' ? choice : 'ordinary';
    this.dataChangedReactCallback();
  }

  finishImport() {
    if (!this.resultsList) return;
    this.importProblems = [];

    for (const res of this.resultsList) {
      if (!res.proceedWithImport || !res.match) continue;

      const state = this.linkState.get(res);
      const suggestion = state?.outcome.kind === 'candidate' ? state.outcome.suggestion : undefined;
      if (state?.choice === 'scheduled' && suggestion && this.tournament) {
        // The scheduled path owns the whole commit — validation, transitions, linkage and the
        // Match insert — so that a linked import and an accepted room submission cannot drift into
        // two different definitions of what accepting a result means.
        const committed = commitScheduledResult(this.tournament, res, suggestion.scheduledMatchId);
        if (committed.ok) continue;
        this.importProblems.push(`${getFileNameFromPath(res.filePath)}: ${committed.reason}`);
        continue;
      }

      if (res.status === ImportResultStatus.ErrNonFatal) res.match.statsValidity = StatsValidity.omit;
      res.match.importedFile = getFileNameFromPath(res.filePath);
      Tournament.validateHaveTeamsPlayedInRound(res.match, res.round, res.phase, false);
      if (res.round) res.round.addMatch(res.match);
    }
  }

  setProceedWithImport(rslt: MatchImportResult, val: boolean) {
    rslt.proceedWithImport = val;
    this.dataChangedReactCallback();
  }
}

export const MatchImportResultsModalContext = createContext<MatchImportResultsManager>(new MatchImportResultsManager());
