import { createContext } from 'react';
import dayjs, { Dayjs } from 'dayjs';
import { AlertColor } from '@mui/material';
import Tournament, { IYftFileTournament, NullTournament } from './DataModel/Tournament';
import { dateFieldChanged, getFileNameFromPath, textFieldChanged, versionLt } from './Utils/GeneralUtils';
import { NullObjects } from './Utils/UtilTypes';
import { IpcBidirectional, IpcMainToRend, IpcRendToMain } from '../IPCChannels';
import { IIndeterminateQbj, IQbjWholeFile, IRefTargetDict, ValidationStatuses } from './DataModel/Interfaces';
import AnswerType from './DataModel/AnswerType';
import StandardSchedule from './DataModel/StandardSchedule';
import { Team } from './DataModel/Team';
import { Player } from './DataModel/Player';
import { IRoomPlayerAddRequest } from '../main/server/ServerTypes';
import Registration, { IQbjRegistration } from './DataModel/Registration';
import { TempTeamManager } from './Modal Managers/TempTeamManager';
import { GenericModalManager } from './Modal Managers/GenericModalManager';
import { collectRefTargets, findTournamentObject } from './DataModel/QbjUtils2';
import FileParser from './DataModel/FileParsing';
import { TempMatchManager } from './Modal Managers/TempMatchManager';
import { Match } from './DataModel/Match';
import { ScheduledMatchStatus } from './DataModel/ScheduledMatch';
import {
  FileSwitchActions,
  IMatchImportFileRequest,
  IYftBackupFile,
  SqbsExportFile,
  StatReportHtmlPage,
} from '../SharedUtils';
import { StatReportFileNames, StatReportPages } from './Enums';
import { Pool } from './DataModel/Pool';
import { PoolStats } from './DataModel/StatSummaries';
import { Phase, PhaseTypes, WildCardRankingMethod } from './DataModel/Phase';
import { Round } from './DataModel/Round';
import TempPhaseManager from './Modal Managers/TempPhaseManager';
import TempPoolManager from './Modal Managers/TempPoolManager';
import TempRankManager from './Modal Managers/TempRankManager';
import { snakeCaseToCamelCase, camelCaseToSnakeCase, earlyYftFileConversions } from './DataModel/CaseConversion';
import { CommonRuleSets } from './DataModel/ScoringRules';
import { qbjFileValidVersion } from './DataModel/QbjUtils';
import PoolAssignmentModalManager from './Modal Managers/PoolAssignmentModalManager';
import MatchImportResult from './DataModel/MatchImportResult';
import MatchImportResultsManager from './Modal Managers/MatchImportResultsManager';
import { parseOldYfFile, isOldYftFile } from './DataModel/OldYfParsing';
import parseTeamsFromSqbsFile from './DataModel/SqbsParsing';
import SqbsExportModalManager from './Modal Managers/SqbsExportModalManager';
import SqbsGenerator from './DataModel/SqbsFileGeneration';
import MatchImportService, { invalidJsonMessage } from './Services/MatchImportService';
import { ISecondaryBackupHealth, emptyBackupHealth as emptySecondaryBackupHealth } from '../shared/BackupTypes';
import { getReportDiagnostics, IReportScope, projectTournamentForReport } from './Services/ReportScope';
import TournamentServerService from './Services/TournamentServerService';
import { checkBrowserRoomScoringDisable, shouldStopServerBeforeDisabling } from './Services/RoomScoringMode';
import { repairOperationalIntegrity, IOperationalIntegrityResult } from './Services/OperationalIntegrity';
import {
  canDeleteTeam,
  canReconcileOfficialResultIdentities,
  canRenameTeam,
  IOfficialResultAnchor,
  IStructuralEditCheck,
  ITeamNameAnchor,
  captureOfficialResultIdentities,
  captureScheduledStructure,
  captureTeamNames,
  reconcileOfficialResultIdentities,
  reconcileScheduledStructure,
  reconcileScheduledStructureFromAnchors,
  reconcilePoolRename,
  reconcileTeamRename,
  restoreTeamNames,
  validateAcceptedResultLinks,
} from './Services/TournamentOperationalReconciliation';

export type TournamentLoadResult =
  | {
      ok: true;
      tournament: Tournament;
      diagnostics: string[];
      repaired: boolean;
      requiresReview: boolean;
    }
  | { ok: false; error: string; diagnostics: string[] };

/** Holds the tournament the application is currently editing */
export class TournamentManager {
  /** The tournament being edited */
  tournament: Tournament = NullTournament;

  /** name of the currently-open file */
  filePath: string | null = null;

  /** Display name for the file being edited */
  displayName: string = '';

  /** What to call this tournament when there's no file */
  static newTournamentName = 'New Tournament';

  /** Hook into the UI to tell it when it needs to update */
  dataChangedReactCallback: () => void;

  /** Show a toast message */
  makeToast: (message: string, severity?: AlertColor, urlToLaunch?: string) => void;

  /** Is there data that hasn't been saved to a file? */
  unsavedData: boolean = false;

  currentTeamsPageView: number = 0;

  currentGamesPageView: number = 0;

  genericModalManager: GenericModalManager;

  // properties for managing the Team/Registration edit workflow

  teamModalManager: TempTeamManager;

  /** The existing registration that we are editing a copy of, if any */
  registrationBeingModified: Registration | null = null;

  /** The existing team that we are editing a copy of, if any */
  teamBeingModified: Team | null = null;

  // properties for managing the Match edit workflow
  matchModalManager: TempMatchManager;

  matchBeingModified: Match | null = null;

  phaseModalManager: TempPhaseManager;

  poolModalManager: TempPoolManager;

  rankModalManager: TempRankManager;

  poolAssignmentModalManager: PoolAssignmentModalManager;

  matchImportResultsManager: MatchImportResultsManager;

  sqbsExportModalManager: SqbsExportModalManager;

  /** Optional local tournament server for browser-based room scorekeeping. Off unless started. */
  tournamentServerService: TournamentServerService;

  aboutYfDialogOpen: boolean = false;

  /** When did we last update the stat report? */
  inAppStatReportGenerated: Date;

  /** The report-only stage selection currently shown in Reports; never written to tournament files. */
  reportScope: IReportScope | null = null;

  recoveredBackup?: IYftBackupFile;

  /** Keep a recovery copy until the primary replacement confirms durable success. */
  private discardBackupAfterSuccessfulSave = false;

  /** Serialize tournament replacement commits so two asynchronous file events cannot cross. */
  private tournamentSwitchPromise: Promise<boolean> = Promise.resolve(true);

  readonly isNull: boolean = false;

  /** The version of the app that is currently running */
  appVersion: string = '';

  /** The latest published version of the app that's available to download */
  latestAvailVersion: string = '';

  constructor() {
    this.dataChangedReactCallback = () => {};
    this.makeToast = () => {};
    // Created before addIpcListeners so that its own listeners can be registered alongside ours.
    this.tournamentServerService = new TournamentServerService(this.tournament);
    this.tournamentServerService.onMatchAccepted = () => this.onRemoteMatchAccepted();
    this.tournamentServerService.onScheduleChanged = () => this.markTournamentDataChanged();
    this.tournamentServerService.onRoomPlayerAdd = (request) => this.addPlayerFromRoom(request);
    this.addIpcListeners();

    this.genericModalManager = new GenericModalManager();
    this.teamModalManager = new TempTeamManager();
    this.matchModalManager = new TempMatchManager();
    this.phaseModalManager = new TempPhaseManager();
    this.poolModalManager = new TempPoolManager();
    this.rankModalManager = new TempRankManager();
    this.poolAssignmentModalManager = new PoolAssignmentModalManager();
    this.matchImportResultsManager = new MatchImportResultsManager();
    this.sqbsExportModalManager = new SqbsExportModalManager();
    this.inAppStatReportGenerated = new Date();

    this.requestAppVersion();
    this.checkForNewVersion();

    this.installNewTournament();

    this.requestBackupFile();
    this.refreshSecondaryBackupHealth();
  }

  /**
   * Where redundant .yft copies go, and how the last one went.
   *
   * Read from the main process rather than tracked here: the write happens there, and a renderer
   * that reloaded must not be able to show a stale "backed up at 10:42" for a drive that has since
   * been unplugged.
   */
  secondaryBackupHealth: ISecondaryBackupHealth = emptySecondaryBackupHealth();

  async refreshSecondaryBackupHealth() {
    if (typeof window === 'undefined' || !window.electron) return;
    try {
      this.secondaryBackupHealth = (await window.electron.ipcRenderer.invoke(
        IpcBidirectional.GetSecondaryBackupHealth,
      )) as ISecondaryBackupHealth;
      this.dataChangedReactCallback();
    } catch {
      // The feature degrades to "not configured". Nothing about saving depends on it.
    }
  }

  async chooseSecondaryBackupFolder() {
    if (typeof window === 'undefined' || !window.electron) return;
    this.secondaryBackupHealth = (await window.electron.ipcRenderer.invoke(
      IpcBidirectional.ChooseSecondaryBackupFolder,
    )) as ISecondaryBackupHealth;
    this.dataChangedReactCallback();
  }

  async clearSecondaryBackupFolder() {
    if (typeof window === 'undefined' || !window.electron) return;
    this.secondaryBackupHealth = (await window.electron.ipcRenderer.invoke(
      IpcBidirectional.ClearSecondaryBackupFolder,
    )) as ISecondaryBackupHealth;
    this.dataChangedReactCallback();
  }

  async retrySecondaryBackup() {
    if (typeof window === 'undefined' || !window.electron) return;
    this.secondaryBackupHealth = (await window.electron.ipcRenderer.invoke(
      IpcBidirectional.RetrySecondaryBackup,
    )) as ISecondaryBackupHealth;
    this.dataChangedReactCallback();
  }

  protected addIpcListeners() {
    this.tournamentServerService.addIpcListeners();
    window.electron.ipcRenderer.on(IpcMainToRend.CheckForUnsavedData, (action) => {
      this.checkForUnsavedData(action as FileSwitchActions);
    });
    window.electron.ipcRenderer.on(IpcMainToRend.openYftFile, (filePath, fileContents, curYfVersion) => {
      this.openYftFile(filePath as string, fileContents as string, curYfVersion as string).catch((error: unknown) =>
        this.showAsyncOperationError(error),
      );
    });
    window.electron.ipcRenderer.on(IpcMainToRend.ImportQbjTournament, (filePath, fileContents) => {
      this.importQbjTournament(filePath as string, fileContents as string).catch((error: unknown) =>
        this.showAsyncOperationError(error),
      );
    });
    window.electron.ipcRenderer.on(IpcMainToRend.saveCurrentTournament, () => {
      this.saveYftFile();
    });
    window.electron.ipcRenderer.on(IpcMainToRend.tournamentSavedSuccessfully, (filePath) => {
      this.onSuccessfulYftSave(filePath as string);
    });
    window.electron.ipcRenderer.on(IpcMainToRend.newTournament, () => {
      this.newTournament().catch((error: unknown) => this.showAsyncOperationError(error));
    });
    window.electron.ipcRenderer.on(IpcMainToRend.saveAsCommand, (filePath) => {
      this.yftSaveAs(filePath as string);
    });
    window.electron.ipcRenderer.on(IpcMainToRend.GeneratedInAppStatReport, () => {
      this.onFinishInAppStatReport();
    });
    window.electron.ipcRenderer.on(IpcMainToRend.RequestStatReport, (filePathStart) => {
      this.generateHtmlReport(filePathStart as string);
    });
    window.electron.ipcRenderer.on(IpcMainToRend.GenerateBackup, () => {
      this.saveBackup();
    });
    window.electron.ipcRenderer.on(IpcMainToRend.ImportQbjTeams, (contents) => {
      this.importQbjTeams(contents as string);
    });
    window.electron.ipcRenderer.on(IpcMainToRend.ImportSqbsTeams, (contents) => {
      this.importSqbsTeams(contents as string);
    });
    window.electron.ipcRenderer.on(IpcMainToRend.ImportQbjGamesMainLaunch, (fileAry) => {
      this.importMatchesFromQbj(fileAry as IMatchImportFileRequest[]);
    });
    window.electron.ipcRenderer.on(IpcMainToRend.MakeToast, (message) => {
      this.makeToast(message as string);
    });
    window.electron.ipcRenderer.on(IpcBidirectional.LoadBackup, (contents) => {
      this.parseBackup(contents as string);
    });
    window.electron.ipcRenderer.on(IpcBidirectional.ExportQbjFile, (filePath) => {
      this.exportQbjFile(filePath as string);
    });
    window.electron.ipcRenderer.on(IpcBidirectional.SqbsExport, () => {
      this.startSqbsExport();
    });
    window.electron.ipcRenderer.on(IpcMainToRend.SecondaryBackupHealthChanged, (health) => {
      this.secondaryBackupHealth = health as ISecondaryBackupHealth;
      this.dataChangedReactCallback();
    });
    window.electron.ipcRenderer.on(IpcMainToRend.LaunchAboutYf, () => {
      this.openAboutYfDialog();
    });
    window.electron.ipcRenderer.on(IpcBidirectional.GetAppVersion, (version) => {
      this.appVersion = version as string;
      if (this.tournament) this.tournament.appVersion = this.appVersion;
    });
    window.electron.ipcRenderer.on(IpcBidirectional.CheckForNewVersion, (latestVersion) => {
      this.latestAvailVersion = latestVersion as string;
      this.newReleaseAlert();
    });
  }

  // eslint-disable-next-line class-methods-use-this
  protected requestAppVersion() {
    window.electron.ipcRenderer.sendMessage(IpcBidirectional.GetAppVersion);
  }

  // eslint-disable-next-line class-methods-use-this
  protected requestBackupFile() {
    window.electron.ipcRenderer.sendMessage(IpcBidirectional.LoadBackup);
  }

  // eslint-disable-next-line class-methods-use-this
  protected checkForNewVersion() {
    window.electron.ipcRenderer.sendMessage(IpcBidirectional.CheckForNewVersion);
  }

  private checkForUnsavedData(action: FileSwitchActions) {
    if (!this.unsavedData) {
      window.electron.ipcRenderer.sendMessage(IpcRendToMain.ContinueWithAction, action);
      return;
    }

    this.genericModalManager.openUnsavedDataDialog(action, (saveData: boolean = false) => {
      if (saveData) {
        this.saveYftFile(action);
      } else {
        window.electron.ipcRenderer.sendMessage(IpcRendToMain.ContinueWithAction, action);
      }
    });
  }

  private newTournament(): Promise<boolean> {
    return this.enqueueTournamentSwitch(async () => {
      const prepared = await this.tournamentServerService.prepareForTournamentSwitch();
      if (!prepared.ok) {
        this.openGenericModal('Tournament still in use', prepared.reason);
        return false;
      }

      this.installNewTournament();
      return true;
    });
  }

  private installNewTournament() {
    this.tournament = new Tournament();
    this.tournament.appVersion = this.appVersion;
    this.modalManagersSetTournament();
    this.setFilePath(null);
    this.displayName = '';
    this.unsavedData = false;

    this.setWindowTitle();
    this.dataChangedReactCallback();
  }

  /** Parse file contents and load tournament for editing */
  private async openYftFile(filePath: string, fileContents: string, curYfVersion: string) {
    if (isOldYftFile(fileContents)) {
      await this.openOldYftFile(fileContents);
      return;
    }

    const objFromFile = this.parseJSON(fileContents);
    if (!objFromFile) return;
    await this.parseYftFile(filePath, objFromFile, curYfVersion);
  }

  private async openOldYftFile(fileContents: string) {
    let loadedTournament: Tournament;
    try {
      loadedTournament = parseOldYfFile(fileContents);
    } catch (err: unknown) {
      this.openGenericModal('Invalid File', err instanceof Error ? err.message : 'The older file could not be parsed.');
      return;
    }

    const integrity = repairOperationalIntegrity(loadedTournament);
    const committed = await this.commitLoadedTournament(loadedTournament, null, true, integrity);
    if (!committed) return;

    this.genericModalManager.open(
      'YellowFruit',
      'This file is from an older version of YellowFruit. It has been opened successfully, but you will need to save a new file if you make changes.',
    );
  }

  /** Import an entire (non-YFT) qbj file */
  private async importQbjTournament(_filePath: string, fileContents: string) {
    const objFromFile = this.parseJSON(fileContents);
    if (!objFromFile) return;

    snakeCaseToCamelCase(objFromFile);
    const loadResult = this.loadTournamentFromQbjObjects(objFromFile as IQbjWholeFile);
    if (!loadResult.ok) return;
    // QBJ imports are unsaved new tournaments. The selected source path is deliberately not adopted
    // as the active YFT path until a successful Save As.
    await this.commitLoadedTournament(loadResult.tournament, null, true, loadResult);
  }

  private async parseYftFile(filePath: string | null, objFromFile: object, curYfVersion?: string): Promise<boolean> {
    try {
      earlyYftFileConversions(objFromFile);
    } catch (err: unknown) {
      this.openGenericModal('Invalid File', err instanceof Error ? err.message : 'The file conversion failed.');
      return false;
    }
    snakeCaseToCamelCase(objFromFile);
    const loadResult = this.loadTournamentFromQbjObjects(objFromFile as IQbjWholeFile, curYfVersion);
    if (!loadResult.ok) return false;

    try {
      loadResult.tournament.conversions();
    } catch (err: unknown) {
      this.openGenericModal('Invalid File', err instanceof Error ? err.message : 'The file conversion failed.');
      return false;
    }
    loadResult.tournament.appVersion = this.appVersion;
    return this.commitLoadedTournament(loadResult.tournament, filePath, false, loadResult);
  }

  private parseJSON(fileContents: string) {
    const objFromFile = MatchImportService.parseJson(fileContents);
    if (!objFromFile) {
      this.openGenericModal('Invalid File', invalidJsonMessage);
    }
    return objFromFile;
  }

  /**
   * Given an array of Qbj/Yft objects, parse them and create a tournament from the info
   * @param objFromFile The parsed JSON object from the file
   * @param curYfVersion YellowFruit version the yft file must be compatible with. If not passed, we treat as a non-YFT base qbj file
   */
  loadTournamentFromQbjObjects(objFromFile: IQbjWholeFile, curYfVersion?: string): TournamentLoadResult {
    if (!qbjFileValidVersion(objFromFile)) {
      const error = "This file doesn't use a supported version of the tournament schema.";
      this.openGenericModal('Invalid File', error);
      return { ok: false, error, diagnostics: [] };
    }
    const objectList = objFromFile.objects;
    if (!objectList) {
      const error = "This file doesn't contain any tournament schema objects.";
      this.openGenericModal('Invalid File', error);
      return { ok: false, error, diagnostics: [] };
    }
    const tournamentObj = findTournamentObject(objectList);
    if (tournamentObj === null) {
      const error = 'This file doesn\'t contain a "Tournament" object.';
      this.openGenericModal('Invalid File', error);
      return { ok: false, error, diagnostics: [] };
    }

    let refTargets: IRefTargetDict = {};
    try {
      refTargets = collectRefTargets(objectList);
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : 'The file references could not be collected safely.';
      this.openGenericModal('Invalid File', error);
      return { ok: false, error, diagnostics: [] };
    }

    const parser = new FileParser(refTargets);
    try {
      const loadedTournament = curYfVersion
        ? parser.parseYftTournament(tournamentObj as IYftFileTournament, curYfVersion)
        : parser.parseTournament(tournamentObj);
      if (!loadedTournament) {
        const error = 'The file did not contain a complete tournament object.';
        this.openGenericModal('Invalid File', error);
        return { ok: false, error, diagnostics: parser.diagnostics };
      }
      const integrity = repairOperationalIntegrity(loadedTournament);
      return {
        ok: true,
        tournament: loadedTournament,
        diagnostics: [...parser.diagnostics, ...integrity.diagnostics],
        repaired: parser.repaired || integrity.repaired,
        requiresReview: parser.requiresReview || integrity.requiresReview,
      };
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : 'The tournament file could not be parsed.';
      this.openGenericModal('Invalid File', error);
      return { ok: false, error, diagnostics: parser.diagnostics };
    }
  }

  /** Commit a fully parsed candidate only after parsing and operational validation succeeded. */
  private commitLoadedTournament(
    loadedTournament: Tournament,
    committedPath: string | null,
    dirty: boolean,
    loadDiagnostics: Pick<IOperationalIntegrityResult, 'diagnostics' | 'repaired' | 'requiresReview'>,
  ): Promise<boolean> {
    return this.enqueueTournamentSwitch(async () => {
      const prepared = await this.tournamentServerService.prepareForTournamentSwitch();
      if (!prepared.ok) {
        this.openGenericModal('Tournament still in use', prepared.reason);
        return false;
      }

      loadedTournament.appVersion = loadedTournament.appVersion || this.appVersion;
      this.tournament = loadedTournament;
      this.modalManagersSetTournament();
      this.setFilePath(committedPath);
      this.displayName = this.tournament.name || '';
      this.unsavedData = dirty || loadDiagnostics.repaired;
      this.setWindowTitle();
      this.dataChangedReactCallback();
      if (loadDiagnostics.diagnostics.length > 0) {
        const prefix = loadDiagnostics.requiresReview
          ? 'The file opened, but some operational records were quarantined for review:'
          : 'The file opened with these recoverable metadata repairs:';
        this.openGenericModal('File integrity', `${prefix}\n\n${loadDiagnostics.diagnostics.join('\n')}`);
      }
      return true;
    });
  }

  private enqueueTournamentSwitch(operation: () => Promise<boolean>): Promise<boolean> {
    const next = this.tournamentSwitchPromise
      .catch(() => false)
      .then(operation)
      .catch((error: unknown) => {
        this.showAsyncOperationError(error);
        return false;
      });
    this.tournamentSwitchPromise = next;
    return next;
  }

  private showAsyncOperationError(error: unknown) {
    this.openGenericModal(
      'Tournament switch failed',
      error instanceof Error && error.message ? error.message : 'The tournament could not be switched safely.',
    );
  }

  /** Is this a property in a JSON file that we should try to parse a date from? */
  static isNameOfDateField(key: string) {
    return (
      key === 'startDate' || key === 'endDate' || key === 'start_date' || key === 'end_date' || key === 'savedAtTime'
    );
  }

  // eslint-disable-next-line class-methods-use-this
  launchImportQbjTeamsWorkflow() {
    window.electron.ipcRenderer.sendMessage(IpcRendToMain.LaunchImportQbjTeamWorkflow);
  }

  // eslint-disable-next-line class-methods-use-this
  launchImportSqbsTeamsWorkflow() {
    window.electron.ipcRenderer.sendMessage(IpcRendToMain.LaunchImportSqbsTeamWorkflow);
  }

  private importQbjTeams(fileContents: string) {
    const objFromFile = this.parseJSON(fileContents) as IQbjWholeFile;
    if (!objFromFile) return;

    const objectList = objFromFile.objects;
    if (!qbjFileValidVersion(objFromFile)) {
      this.openGenericModal('Invalid File', "This file doesn't use a supported version of the tournament schema.");
      return;
    }

    let refTargets: IRefTargetDict = {};
    try {
      refTargets = collectRefTargets(objectList);
    } catch (error: unknown) {
      this.openGenericModal(
        'Invalid File',
        error instanceof Error && error.message ? error.message : 'The file references could not be collected safely.',
      );
      return;
    }

    const registrationList = FileParser.findRegistrations(objectList);
    if (registrationList.length === 0) {
      this.openGenericModal('Invalid File', 'This file contains no Registration objects.');
      return;
    }

    const parser = new FileParser(refTargets, this.tournament);
    parser.buildTypesByIdArrays(objectList);
    let numTeamsImported = 0;
    const importErrors: string[] = [];
    const maxTeamsAllowed = this.tournament.getExpectedNumberOfTeams();
    let maxTeamsReached = false;
    for (const reg of registrationList) {
      if (this.tournament.getNumberOfTeams() === maxTeamsAllowed) {
        maxTeamsReached = true;
        break;
      }
      numTeamsImported += this.importSingleRegistrationObj(reg, parser, importErrors);
    }

    if (numTeamsImported === 0) {
      this.openGenericModal(
        'Team Import',
        `No teams were imported because no new teams were found or the maximum number of teams was reached.${
          importErrors.length > 0 ? ` ${importErrors[0]}` : ''
        }`,
      );
    } else {
      this.openGenericModal(
        'Team Import',
        `Imported ${numTeamsImported} teams.${
          maxTeamsReached ? ' Not all teams were imported because the maximum number teams was reached.' : ''
        }${importErrors.length > 0 ? ` ${importErrors.length} registration(s) could not be imported.` : ''}`,
      );
    }
    this.markFileDirty();
  }

  private importSingleRegistrationObj(registration: IQbjRegistration, parser: FileParser, importErrors: string[] = []) {
    let registrationFromFile;
    try {
      registrationFromFile = parser.parseRegistration(registration as IIndeterminateQbj);
    } catch (error: unknown) {
      importErrors.push(
        error instanceof Error && error.message
          ? error.message
          : 'A registration could not be parsed because its data was invalid.',
      );
      return 0;
    }
    if (!registrationFromFile) return 0;

    registrationFromFile.computeLettersAndRegName();
    let numTeamsImported = 0;
    const maxTeamsAllowed = this.tournament.getExpectedNumberOfTeams();
    const existingRegistration = this.tournament.findRegistration(registrationFromFile.name);
    if (existingRegistration) {
      for (const teamFromFile of registrationFromFile.teams) {
        if (!this.tournament.findTeamByName(teamFromFile.name)) {
          existingRegistration.addTeam(teamFromFile);
          numTeamsImported++;
        }
        if (this.tournament.getNumberOfTeams() === maxTeamsAllowed) break;
      }
      this.tournament.seedTeamsInRegistration(existingRegistration);
    } else {
      if (
        maxTeamsAllowed !== null &&
        this.tournament.getNumberOfTeams() + registrationFromFile.teams.length > maxTeamsAllowed
      ) {
        return 0;
      }
      this.tournament.addRegistration(registrationFromFile);
      numTeamsImported = registrationFromFile.teams.length;
    }
    return numTeamsImported;
  }

  private importSqbsTeams(fileContents: string) {
    let registrationList;
    try {
      registrationList = parseTeamsFromSqbsFile(fileContents);
    } catch (error: unknown) {
      this.openGenericModal(
        'SQBS Roster Import',
        `Import failed: ${error instanceof Error && error.message ? error.message : 'The file could not be parsed.'}`,
      );
      return;
    }
    if (!registrationList) return;

    if (registrationList.length === 0) {
      this.openGenericModal('SQBS Roster Import', 'No teams imported: this file contains no teams');
      return;
    }

    const maxTeamsAllowed = this.tournament.getExpectedNumberOfTeams();
    let numTeamsImported = 0;
    for (const oneReg of registrationList) {
      if (maxTeamsAllowed !== null && this.tournament.getNumberOfTeams() >= maxTeamsAllowed) {
        this.openGenericModal(
          'SQBS Roster Import',
          `Imported ${numTeamsImported} teams. Not all teams in the file were imported because the maximum number of teams was reached.`,
        );
        this.markFileDirty();
        return;
      }

      const existingReg = this.tournament.findRegistration(oneReg.name);
      if (!existingReg) {
        this.tournament.addRegistration(oneReg);
        numTeamsImported++;
      } else {
        const newTeam = oneReg.teams[0];
        if (!existingReg.teams.find((t) => t.name === newTeam.name)) {
          existingReg.addTeam(newTeam);
          this.tournament.seedAndAssignNewTeam(newTeam);
          numTeamsImported++;
        }
      }
    }
    this.openGenericModal('SQBS Roster Import', `Imported ${numTeamsImported} teams.`);
    this.markFileDirty();
  }

  /**
   * Tell main to launch the file selection window for importing matches
   * @param round Which round the matches should go into. If not passed, use the files to determine the correct rounds
   * @returns
   */
  async launchImportMatchWorkflow(round?: Round) {
    const files = (await window.electron.ipcRenderer.invoke(
      IpcBidirectional.ImportQbjGamesRendererLaunch,
    )) as IMatchImportFileRequest[];

    this.importMatchesFromQbj(files, round);
  }

  /**
   * Parse a qbj or qbj-like file and add its matches to the given round
   * @param fileAry The files we're trying to parse
   * @param round Which round the matches should go into. If not passed, use the files to determine the correct rounds.
   */
  private importMatchesFromQbj(fileAry: IMatchImportFileRequest[], round?: Round) {
    if (fileAry.length === 0) return;

    const { results, hadInvalidJson } = new MatchImportService(this.tournament).importMatches(fileAry, round);
    if (hadInvalidJson) {
      this.openGenericModal('Invalid File', invalidJsonMessage);
      return;
    }

    this.openMatchImportModal(results, round);
  }

  /** Save the tournament to the given file and switch context to that file */
  yftSaveAs(filePath: string) {
    // The candidate path is intentionally not adopted here. Main sends the committed path back
    // only after the atomic replacement succeeds, so a failed Save As leaves the old identity and
    // dirty state untouched.
    this.saveYftFile(undefined, filePath);
  }

  /** Save from a visible UI control, using the current file or opening Save As for a new tournament. */
  saveCurrentTournament() {
    this.saveYftFile();
  }

  /** Write the current tournament to the current file */
  private saveYftFile(subsequentAction?: FileSwitchActions, candidatePath?: string) {
    const fileObj = this.generateWholeFileObj();
    const fileContents = TournamentManager.makeJSON(fileObj);
    window.electron.ipcRenderer.sendMessage(
      IpcRendToMain.saveFile,
      candidatePath ?? this.filePath,
      fileContents,
      subsequentAction,
    );
  }

  private exportQbjFile(filePath: string) {
    const fileObj = this.generateWholeFileObj(true);
    const fileContents = TournamentManager.makeJSON(fileObj);
    window.electron.ipcRenderer.sendMessage(IpcBidirectional.ExportQbjFile, filePath, fileContents);
  }

  private startSqbsExport() {
    if (this.tournament.phases.length > 1) {
      this.openSqbsExportModal();
    } else {
      this.generateSqbsFiles(this.tournament.phases);
    }
  }

  private generateSqbsFiles(phases: Phase[], combinedFile?: boolean) {
    if (phases.length === 0) {
      this.openGenericModal('Error', 'Failed to find any stages to export');
      return;
    }
    const sqbsGenerator = new SqbsGenerator(this.tournament);
    const sqbsFiles: SqbsExportFile[] = [];
    if (phases.length === 1 || combinedFile) {
      sqbsGenerator.generateFile(phases);
      if (sqbsGenerator.errorMessage !== '') {
        this.openGenericModal('SQBS Export', `Error: ${sqbsGenerator.errorMessage}`);
        return;
      }
      sqbsFiles.push({ contents: sqbsGenerator.fileOutput });
    } else {
      for (const ph of phases) {
        sqbsGenerator.generateFile([ph]);
        if (sqbsGenerator.errorMessage !== '') {
          this.openGenericModal('SQBS Export', `Error: ${sqbsGenerator.errorMessage}`);
          return;
        }
        sqbsFiles.push({ contents: sqbsGenerator.fileOutput, fileSuffix: ph.name });
      }
    }
    window.electron.ipcRenderer.sendMessage(IpcBidirectional.SqbsExport, sqbsFiles);
  }

  private saveBackup() {
    const fileContents = this.generateWholeFileObj();
    const backupObj: IYftBackupFile = {
      filePath: this.filePath || '',
      savedAtTime: new Date(),
      fileContents,
    };
    const backupFileContents = TournamentManager.makeJSON(backupObj);
    window.electron.ipcRenderer.sendMessage(IpcRendToMain.SaveBackup, backupFileContents);
  }

  private parseBackup(fileContents: string) {
    if (fileContents === '') {
      window.electron.ipcRenderer.sendMessage(IpcRendToMain.StartAutosave);
      return;
    }
    const objFromFile = this.parseJSON(fileContents);
    if (!objFromFile) {
      window.electron.ipcRenderer.sendMessage(IpcRendToMain.StartAutosave);
      return;
    }

    const candidate = objFromFile as Partial<IYftBackupFile>;
    if (
      typeof candidate.fileContents !== 'object' ||
      candidate.fileContents === null ||
      typeof candidate.filePath !== 'string' ||
      (!(candidate.savedAtTime instanceof Date) &&
        !(typeof candidate.savedAtTime === 'string' && Number.isFinite(new Date(candidate.savedAtTime).getTime())))
    ) {
      this.openGenericModal('Invalid recovery backup', 'The autosave backup was incomplete and was not opened.');
      window.electron.ipcRenderer.sendMessage(IpcRendToMain.StartAutosave);
      return;
    }

    this.recoveredBackup = {
      filePath: candidate.filePath,
      fileContents: candidate.fileContents,
      savedAtTime: new Date(candidate.savedAtTime as string | Date),
    };
    this.onDataChanged(true);
  }

  async useRecoveredBackup() {
    if (!this.recoveredBackup) return;
    const recovered = this.recoveredBackup;
    // Parse the recovery candidate without adopting its former path. The path becomes active only
    // when the automatic replacement below reports durable success.
    if (!(await this.parseYftFile(null, recovered.fileContents))) return;
    // Recovery contents represent a separate, possibly newer document. Keep the active model
    // dirty until the primary replacement reports durable success, including when the backup had
    // no original path and therefore cannot be saved automatically yet.
    this.unsavedData = true;
    this.setWindowTitle();
    if (recovered.filePath !== '') {
      this.discardBackupAfterSuccessfulSave = true;
      this.saveYftFile();
    }
  }

  discardRecoveredBackup() {
    delete this.recoveredBackup;
    this.onDataChanged(true);
    window.electron.ipcRenderer.sendMessage(IpcRendToMain.StartAutosave);
  }

  private generateWholeFileObj(qbjOnly: boolean = false) {
    const wholeFileObj: IQbjWholeFile = { version: '2.1.1', objects: [this.tournament.toFileObject(qbjOnly, true)] };
    camelCaseToSnakeCase(wholeFileObj);
    return wholeFileObj;
  }

  private static makeJSON(obj: object) {
    return JSON.stringify(obj, (key, value) => {
      if (TournamentManager.isNameOfDateField(key)) {
        if (value) return dayjs(value).toISOString();
        return undefined;
      }
      return value;
    });
  }

  private onSuccessfulYftSave(filePath?: string) {
    this.displayName = this.tournament.name || '';
    if (filePath) this.setFilePath(filePath);
    this.unsavedData = false;
    this.tournamentServerService.confirmDurableDecisions();
    if (this.discardBackupAfterSuccessfulSave) {
      this.discardBackupAfterSuccessfulSave = false;
      this.discardRecoveredBackup();
    }
    this.setWindowTitle();
    this.makeToast('File saved');
  }

  protected setFilePath(path: string | null) {
    this.filePath = path || null;
    window.electron.ipcRenderer.sendMessage(IpcRendToMain.setYftFilePath, path || '');
  }

  compileStats() {
    this.tournament.compileStats(false, true);
    this.onFinishInAppStatReport();
  }

  /**
   * Generate html reports and direct the main process to write them to files
   * @param filePathStart The full file path, minus the identifier of the specific page (e.g. _standing.html), if saving externally. E.g. C:\mydata\mystatreport.
   * If saving to the in-app stat report, should be undefined
   */
  generateHtmlReport(filePathStart?: string, requestedScope?: IReportScope | null) {
    let filePrefix;
    if (filePathStart) filePrefix = getFileNameFromPath(filePathStart);

    if (requestedScope !== undefined) this.reportScope = requestedScope;
    const scope =
      this.reportScope ??
      ({
        phaseCodes: this.tournament.phases.map((phase) => phase.code),
        includeCarryover: true,
      } satisfies IReportScope);
    const reportTournament = projectTournamentForReport(this.tournament, scope);
    const reportWarnings = getReportDiagnostics(reportTournament);
    if (reportWarnings.length > 0) {
      this.makeToast(
        `Some inconsistent carryover games were skipped from the report (${reportWarnings.length}).`,
        'warning',
      );
    }

    reportTournament.setHtmlFilePrefix(filePrefix);
    const reports: StatReportHtmlPage[] = [
      { fileName: StatReportFileNames[StatReportPages.Standings], contents: reportTournament.makeHtmlStandings() },
      {
        fileName: StatReportFileNames[StatReportPages.Individuals],
        contents: reportTournament.makeHtmlIndividuals(),
      },
      { fileName: StatReportFileNames[StatReportPages.Scoreboard], contents: reportTournament.makeHtmlScoreboard() },
      {
        fileName: StatReportFileNames[StatReportPages.TeamDetails],
        contents: reportTournament.makeHtmlTeamDetail(),
      },
      {
        fileName: StatReportFileNames[StatReportPages.PlayerDetails],
        contents: reportTournament.makeHtmlPlayerDetail(),
      },
      {
        fileName: StatReportFileNames[StatReportPages.RoundReport],
        contents: reportTournament.makeHtmlRoundReport(),
      },
    ];
    window.electron.ipcRenderer.sendMessage(IpcRendToMain.WriteStatReports, reports, filePathStart);
  }

  setReportScope(scope: IReportScope | null) {
    this.reportScope = scope;
  }

  /** Prompt the user for a place to save the reports. Main will then tell renderer to generate reports with the chosen file name */
  exportStatReports() {
    const defaultFilePrefix = this.filePath ? getFileNameFromPath(this.filePath) : undefined;
    window.electron.ipcRenderer.sendMessage(IpcRendToMain.StatReportSaveDialog, defaultFilePrefix);
  }

  // eslint-disable-next-line class-methods-use-this
  requestQbjExport() {
    window.electron.ipcRenderer.sendMessage(IpcRendToMain.LaunchQbjExportWorkflow);
  }

  onFinishInAppStatReport() {
    this.inAppStatReportGenerated = new Date();
    this.onDataChanged(true);
  }

  modalManagersSetTournament() {
    this.teamModalManager.tournament = this.tournament;
    this.matchModalManager.tournament = this.tournament;
    this.reportScope = null;
    // A different tournament means any pending room submissions are about the wrong thing.
    this.tournamentServerService.reset();
    if (!this.tournamentServerService.setTournament(this.tournament)) {
      this.makeToast(
        this.tournamentServerService.lastError || 'The Tournament Server could not load the new tournament.',
        'error',
      );
    }
  }

  /** Keep track of which view the user is on, so that they can leave the Teams page, then
   *  come back and see the samve view.
   */
  setTeamsPageView(whichPage: number) {
    this.currentTeamsPageView = whichPage;
    this.onDataChanged(true);
  }

  /** Keep track of which view the user is on, so that they can leave the Games page, then
   *  come back and see the samve view.
   */
  setGamesPageView(whichPage: number) {
    this.currentGamesPageView = whichPage;
    this.onDataChanged(true);
  }

  /** Set the tournament's display name */
  setTournamentName(name: string): void {
    const trimmedName = name.trim();
    if (!textFieldChanged(this.tournament.name, trimmedName)) {
      return;
    }
    this.tournament.name = trimmedName;
    this.onDataChanged();
  }

  /** Set the free-text description of where the tournament is */
  setTournamentSiteName(siteName: string): void {
    const trimmedName = siteName.trim();
    if (!textFieldChanged(this.tournament.tournamentSite.name, trimmedName)) {
      return;
    }
    this.tournament.tournamentSite.name = trimmedName;
    this.onDataChanged();
  }

  setTournamentStartDate(dateFromUser: Dayjs | null) {
    const validDateOrNull = dateFromUser?.isValid() ? dateFromUser : null;
    if (!dateFieldChanged(dayjs(this.tournament.startDate), validDateOrNull)) {
      return;
    }
    this.tournament.startDate = validDateOrNull === null ? NullObjects.nullDate : validDateOrNull.toDate();
    this.onDataChanged();
  }

  setTournamentEndDate(dateFromUser: Dayjs | null) {
    const validDateOrNull = dateFromUser?.isValid() ? dateFromUser : null;
    if (!dateFieldChanged(dayjs(this.tournament.endDate), validDateOrNull)) {
      return;
    }
    this.tournament.endDate = validDateOrNull === null ? NullObjects.nullDate : validDateOrNull.toDate();
    this.onDataChanged();
  }

  /** Set the name of the question set used by the tournament */
  setQuestionSetname(setName: string): void {
    const trimmedName = setName.trim();
    if (!textFieldChanged(this.tournament.questionSet, trimmedName)) {
      return;
    }
    this.tournament.questionSet = trimmedName;
    this.onDataChanged();
  }

  /**
   * Change the explicit room-scoring workflow choice. Disabling is guarded by the same durable
   * scheduled-match state that survives a restart as well as the live server session summaries.
   */
  async setRoomScoringMode(mode: Tournament['roomScoringMode']): Promise<{ ok: boolean; reason?: string }> {
    if (this.tournament.roomScoringMode === mode) return { ok: true };

    if (mode === 'traditional') {
      const check = checkBrowserRoomScoringDisable(this.tournament, this.tournamentServerService.sessions);
      if (!check.canDisable) return { ok: false, reason: check.reason };
      if (shouldStopServerBeforeDisabling(check, this.tournamentServerService.status.running)) {
        const stopped = await this.tournamentServerService.stopServer();
        if (stopped.running) {
          return {
            ok: false,
            reason: 'The Tournament Server could not be stopped safely. Browser room scoring remains enabled.',
          };
        }
      }
    }

    this.tournament.roomScoringMode = mode;
    this.onDataChanged();
    return { ok: true };
  }

  setPacketName(round: Round, packetName: string) {
    const trimmedName = packetName.trim();
    if (!textFieldChanged(round.packet.name, trimmedName)) {
      return;
    }
    round.packet.name = trimmedName;
    this.onDataChanged();
  }

  setTrackPlayerYear(checked: boolean) {
    this.tournament.trackPlayerYear = checked;
    this.onDataChanged();
  }

  setTrackSmallSchool(checked: boolean) {
    this.tournament.trackSmallSchool = checked;
    this.onDataChanged();
  }

  setTrackJV(checked: boolean) {
    this.tournament.trackJV = checked;
    this.onDataChanged();
  }

  setTrackUG(checked: boolean) {
    this.tournament.trackUG = checked;
    this.onDataChanged();
  }

  setTrackDiv2(checked: boolean) {
    this.tournament.trackDiv2 = checked;
    this.onDataChanged();
  }

  applStdRuleSet(ruleSet: CommonRuleSets) {
    if (!this.canChangeScoringRules()) return;
    this.tournament.applyRuleSet(ruleSet);
    this.onDataChanged();
  }

  clearStandardRuleSet() {
    if (!this.canChangeScoringRules()) return;
    this.tournament.clearStdRuleSet();
    this.onDataChanged();
  }

  setAnswerTypes(answerTypes: AnswerType[]) {
    if (!this.canChangeScoringRules()) return;
    this.tournament.scoringRules.answerTypes = answerTypes;
    this.tournament.clearStdRuleSet();
    this.onDataChanged();
  }

  setTimedRoundSetting(checked: boolean) {
    if (!this.canChangeScoringRules()) return;
    this.tournament.scoringRules.timed = checked;
    this.tournament.clearStdRuleSet();
    this.onDataChanged();
  }

  setNumTusPerRound(numTus: number) {
    if (!this.canChangeScoringRules()) return;
    if (numTus === this.tournament.scoringRules.maximumRegulationTossupCount) {
      return;
    }
    this.tournament.scoringRules.maximumRegulationTossupCount = numTus;
    this.tournament.clearStdRuleSet();
    this.onDataChanged();
  }

  setUseBonuses(checked: boolean) {
    if (!this.canChangeScoringRules()) return;
    this.tournament.scoringRules.setUseBonuses(checked);
    this.tournament.clearStdRuleSet();
    this.onDataChanged();
  }

  setBonusesBounceBack(checked: boolean) {
    if (!this.canChangeScoringRules()) return;
    this.tournament.scoringRules.bonusesBounceBack = checked;
    this.tournament.clearStdRuleSet();
    this.onDataChanged();
  }

  setMaxBonusScore(val: number) {
    if (!this.canChangeScoringRules()) return;
    if (this.tournament.scoringRules.maximumBonusScore === val) return;
    this.tournament.scoringRules.maximumBonusScore = val;
    this.tournament.clearStdRuleSet();
    this.onDataChanged();
  }

  setMinPartsPerBonus(val: number) {
    if (!this.canChangeScoringRules()) return;
    if (this.tournament.scoringRules.minimumPartsPerBonus === val) return;
    this.tournament.scoringRules.minimumPartsPerBonus = val;
    this.tournament.clearStdRuleSet();
    this.onDataChanged();
  }

  setMaxPartsPerBonus(val: number) {
    if (!this.canChangeScoringRules()) return;
    if (this.tournament.scoringRules.maximumPartsPerBonus === val) return;
    this.tournament.scoringRules.maximumPartsPerBonus = val;
    this.tournament.clearStdRuleSet();
    this.onDataChanged();
  }

  setPtsPerBonusPart(val: number | undefined) {
    if (!this.canChangeScoringRules()) return;
    if (this.tournament.scoringRules.pointsPerBonusPart === val) return;
    this.tournament.scoringRules.pointsPerBonusPart = val;
    this.tournament.clearStdRuleSet();
    this.onDataChanged();
  }

  setBonusDivisor(val: number) {
    if (!this.canChangeScoringRules()) return;
    if (this.tournament.scoringRules.bonusDivisor === val) return;
    this.tournament.scoringRules.bonusDivisor = val;
    this.tournament.clearStdRuleSet();
    this.onDataChanged();
  }

  setMaxPlayers(val: number) {
    if (!this.canChangeScoringRules()) return;
    if (this.tournament.scoringRules.maximumPlayersPerTeam === val) return;
    this.tournament.scoringRules.maximumPlayersPerTeam = val;
    this.tournament.clearStdRuleSet();
    this.onDataChanged();
  }

  setMinOverTimeTossupCount(val: number) {
    if (!this.canChangeScoringRules()) return;
    if (this.tournament.scoringRules.minimumOvertimeQuestionCount === val) return;
    this.tournament.scoringRules.minimumOvertimeQuestionCount = val;
    this.tournament.clearStdRuleSet();
    this.onDataChanged();
  }

  setOvertimeUsesBonuses(checked: boolean) {
    if (!this.canChangeScoringRules()) return;
    this.tournament.scoringRules.overtimeIncludesBonuses = checked;
    this.tournament.clearStdRuleSet();
    this.onDataChanged();
  }

  setUseLightning(checked: boolean) {
    if (!this.canChangeScoringRules()) return;
    this.tournament.scoringRules.lightningCountPerTeam = checked ? 1 : 0;
    this.tournament.clearStdRuleSet();
    this.onDataChanged();
  }

  setLightningDivisor(val: number) {
    if (!this.canChangeScoringRules()) return;
    this.tournament.scoringRules.lightningDivisor = val;
    this.tournament.clearStdRuleSet();
    this.onDataChanged();
  }

  setStandardSchedule(sched: StandardSchedule) {
    if (this.tournament.scheduledMatches.length > 0 || !this.canChangeScoringRules()) return;
    this.tournament.setStandardSchedule(sched);
    this.onDataChanged();
  }

  tryUnlockCustomSchedule() {
    if (!this.tournament.hasMatchData) {
      this.unlockCustomSchedule();
      return;
    }

    this.genericModalManager.open(
      'Customize Schedule',
      'Are you sure you want to unlock custom scheduling features and give up rebracketing assistance? Because one or more games have already been entered, you will not be able to reapply this template.',
      'N&o',
      '&Yes',
      () => {
        this.unlockCustomSchedule();
      },
    );
  }

  unlockCustomSchedule() {
    this.tournament.unlockCustomSchedule();
    this.onDataChanged();
  }

  startNewCustomSchedule() {
    if (this.tournament.scheduledMatches.length > 0) {
      this.makeToast('Start a new custom schedule only after the existing Match Plan is resolved.', 'error');
      return;
    }
    this.tournament.startNewCustomSchedule();
    this.onDataChanged();
  }

  setPhaseWCRankMethod(phase: Phase, method: WildCardRankingMethod) {
    if (!this.canEditScheduledStructure(phase)) return;
    phase.wildCardRankingMethod = method;
    this.onDataChanged();
  }

  addTiebreakerAfter(phase: Phase) {
    if (!this.canEditScheduledStructure()) return;
    this.tournament.addTiebreakerAfter(phase);
    this.onDataChanged();
  }

  addPlayoffPhase() {
    if (!this.canEditScheduledStructure()) return;
    this.tournament.addBlankPhase();
    this.onDataChanged();
  }

  movePhaseUp(phase: Phase) {
    if (!this.canEditScheduledStructure()) return;
    const anchors = captureScheduledStructure(this.tournament);
    this.tournament.movePhaseUp(phase);
    const reconciled = reconcileScheduledStructureFromAnchors(this.tournament, anchors);
    if (!reconciled.ok) {
      this.makeToast(reconciled.reason ?? 'The Match Plan could not be reconciled after moving the stage.', 'error');
      return;
    }
    this.onDataChanged();
  }

  movePhaseDown(phase: Phase) {
    if (!this.canEditScheduledStructure()) return;
    const anchors = captureScheduledStructure(this.tournament);
    this.tournament.movePhaseDown(phase);
    const reconciled = reconcileScheduledStructureFromAnchors(this.tournament, anchors);
    if (!reconciled.ok) {
      this.makeToast(reconciled.reason ?? 'The Match Plan could not be reconciled after moving the stage.', 'error');
      return;
    }
    this.onDataChanged();
  }

  tryDeletePhase(phase: Phase) {
    this.genericModalManager.open('Delete Stage', 'Are you sure you want to delete this stage?', 'N&o', '&Yes', () => {
      this.deletePhase(phase);
    });
  }

  deletePhase(phase: Phase) {
    const affected = this.tournament.scheduledMatches.some(
      (match) => match.phaseCode === phase.code || phase.includesRoundNumber(match.roundNumber),
    );
    if (affected) {
      this.makeToast('This stage has Match Plan records; cancel or resolve them before deleting the stage.', 'error');
      return;
    }
    const anchors = captureScheduledStructure(this.tournament);
    this.tournament.deletePhase(phase);
    const reconciled = reconcileScheduledStructureFromAnchors(this.tournament, anchors);
    if (!reconciled.ok) {
      this.makeToast(reconciled.reason ?? 'The Match Plan could not be reconciled after deleting the stage.', 'error');
      return;
    }
    this.onDataChanged();
  }

  forcePhaseToBeNumeric(phase: Phase) {
    if (!this.canEditScheduledStructure()) return;
    const anchors = captureScheduledStructure(this.tournament);
    this.tournament.forcePhaseToBeNumeric(phase);
    const reconciled = reconcileScheduledStructureFromAnchors(this.tournament, anchors);
    if (!reconciled.ok) {
      this.makeToast(reconciled.reason ?? 'The Match Plan could not be reconciled after changing the stage.', 'error');
      return;
    }
    this.onDataChanged();
  }

  undoForcePhaseToBeNumeric(phase: Phase) {
    if (!this.canEditScheduledStructure()) return;
    const anchors = captureScheduledStructure(this.tournament);
    this.tournament.undoForcePhaseToBeNumeric(phase);
    const reconciled = reconcileScheduledStructureFromAnchors(this.tournament, anchors);
    if (!reconciled.ok) {
      this.makeToast(reconciled.reason ?? 'The Match Plan could not be reconciled after changing the stage.', 'error');
      return;
    }
    this.onDataChanged();
  }

  addFinalsPhase() {
    if (!this.canEditScheduledStructure()) return;
    this.tournament.addFinalsPhase();
    this.onDataChanged();
  }

  addPool(phase: Phase) {
    if (!this.canEditScheduledStructure(phase)) return;
    phase.addBlankPool();
    this.onDataChanged();
  }

  /** After getting confirmation from the user, close the pool modal and delete the pool that was just open */
  tryDeletePool() {
    const poolOpened = this.poolModalManager.originalPoolOpened;
    const phase = this.poolModalManager.phaseContainingPool;
    if (poolOpened && phase) {
      this.genericModalManager.open('Delete Pool', 'Are you sure you want to delete this pool?', 'N&o', '&Yes', () => {
        this.poolModalManager.closeModal(false);
        this.deletePool(phase, poolOpened);
      });
    }
  }

  deletePool(phase: Phase, pool: Pool) {
    const affected = this.tournament.scheduledMatches.find(
      (match) =>
        match.poolName === pool.name &&
        (match.phaseCode === phase.code || phase.includesRoundNumber(match.roundNumber)),
    );
    if (affected) {
      this.makeToast(
        `${affected.describe()} uses this pool in the Match Plan; resolve it before deleting the pool.`,
        'error',
      );
      return;
    }
    this.poolModalManager.closeModal(false);
    phase.deletePool(pool, true);
    reconcileScheduledStructure(this.tournament);
    this.onDataChanged();
  }

  tryDeleteTeam(reg: Registration, team: Team) {
    this.genericModalManager.open('Delete Team', `Are you sure you want to delete ${team.name}?`, 'N&o', '&Yes', () =>
      this.deleteTeam(reg, team),
    );
  }

  deleteTeam(reg: Registration, team: Team) {
    const check = canDeleteTeam(this.tournament, team.name);
    if (!check.ok) {
      this.makeToast(check.reason ?? 'This team cannot be deleted safely.', 'error');
      return;
    }
    this.tournament.deleteTeam(reg, team);
    this.onDataChanged();
  }

  shiftSeedUp(seedNo: number) {
    if (!this.canEditScheduledStructure(this.tournament.getPrelimPhase(), true)) return;
    this.tournament.shiftSeedUp(seedNo);
    this.onDataChanged();
  }

  shiftSeedDown(seedNo: number) {
    if (!this.canEditScheduledStructure(this.tournament.getPrelimPhase(), true)) return;
    this.tournament.shiftSeedDown(seedNo);
    this.onDataChanged();
  }

  seedListDragDrop(seedToMove: string, seedDroppedOn: number) {
    if (!this.canEditScheduledStructure(this.tournament.getPrelimPhase(), true)) return;
    const seedNoToMove = parseInt(seedToMove, 10);
    if (Number.isNaN(seedNoToMove)) return;

    const newPosition = seedNoToMove < seedDroppedOn ? seedDroppedOn - 1 : seedDroppedOn;
    if (seedNoToMove === newPosition) return;

    this.tournament.insertSeedAtPosition(seedNoToMove, newPosition);
    this.onDataChanged();
  }

  swapSeeds(droppedSeed: string, targetSeed: number) {
    if (!this.canEditScheduledStructure(this.tournament.getPrelimPhase(), true)) return;
    const droppedSeedNo = parseInt(droppedSeed, 10);
    if (Number.isNaN(droppedSeedNo)) return;

    this.tournament.swapSeeds(droppedSeedNo, targetSeed);
    this.onDataChanged();
  }

  /**
   * Move a team between lists on the seeing page
   * @param originPool Pool the team was in, or null if they weren't in any pool
   * @param targetPool Pool the team is being moved to
   * @param teamBeingDropped Team being moved
   */
  unseededTeamDragDrop(originPool: Pool | null, targetPool: Pool, teamBeingDropped: Team) {
    if (originPool === targetPool) return;

    const phase = this.tournament.getPrelimPhase();
    const affected = this.tournament.scheduledMatches.find(
      (match) =>
        phase?.includesRoundNumber(match.roundNumber) &&
        match.status !== ScheduledMatchStatus.Cancelled &&
        (match.involvesTeam(teamBeingDropped.name) ||
          match.poolName === originPool?.name ||
          match.poolName === targetPool.name),
    );
    if (affected) {
      this.makeToast(
        `${affected.describe()} is in the Match Plan; resolve it before changing prelim pool membership.`,
        'error',
      );
      return;
    }

    if (originPool) originPool.removeTeam(teamBeingDropped);
    targetPool.addTeam(teamBeingDropped);

    if (phase) {
      if (originPool) phase.revalidateMatchesForPoolCompatibility(originPool);
      phase.revalidateMatchesForPoolCompatibility(targetPool);
    }

    this.onDataChanged();
  }

  /**
   * Why the ordinary Delete action can't be used on this game, or null if it can.
   *
   * Only an accepted official result is protected. A manually entered game, an imported game, and a
   * scheduled game that hasn't been accepted are all ordinary games and delete normally.
   */
  static officialResultDeleteRefusal(tournament: Tournament, match: Match): string | null {
    if (!tournament.acceptedScheduledMatchForResult(match.id)) return null;
    return 'This is an accepted official result and cannot be deleted normally. Use "Correct official result…" to fix scoring details.';
  }

  tryDeleteMatch(match: Match, round: Round) {
    const refusal = TournamentManager.officialResultDeleteRefusal(this.tournament, match);
    if (refusal) {
      this.makeToast(refusal, 'error');
      return;
    }
    this.genericModalManager.open('Delete Game', 'Are you sure you want to delete this game?', 'N&o', '&Yes', () =>
      this.deleteMatch(match, round),
    );
  }

  /**
   * Remove a game from the tournament.
   *
   * The accepted-result check lives here rather than only in the confirmation dialog, because the
   * damage it prevents is structural: deleting the `Match` an accepted `ScheduledMatch` points at
   * would leave the Match Plan asserting an official result that no longer exists, and nothing
   * downstream — standings, the stat report, QBJ export — has any way to notice. Correcting an
   * accepted result is a real workflow and goes through the match editor, which updates the
   * existing `Match` in place instead of replacing it.
   *
   * @returns false when the deletion was refused.
   */
  deleteMatch(match: Match, round: Round): boolean {
    const refusal = TournamentManager.officialResultDeleteRefusal(this.tournament, match);
    if (refusal) {
      this.makeToast(refusal, 'error');
      return false;
    }
    round.deleteMatch(match);
    this.tournament.calcHasMatchData();
    this.onDataChanged();
    return true;
  }

  addTeamtoPlayoffPool(team: Team, pool: Pool, nextPhase: Phase) {
    if (!this.canEditScheduledStructure(nextPhase, true)) return;
    pool.addTeam(team);
    this.tournament.carryOverMatches(
      nextPhase,
      pool.poolTeams.map((pt) => pt.team),
    );
    this.tournament.getPrevFullPhase(nextPhase)?.markTeamDidNotAdvance(team, false);
    this.compileStats();
    this.onDataChanged();
  }

  /** Take the teams from one pool, and add them to the pools they've been calculated (or overridden) to be in */
  rebracketPool(poolStats: PoolStats, nextPhase: Phase) {
    if (!this.canEditScheduledStructure(nextPhase, true)) return;
    for (const ptStats of poolStats.poolTeams) {
      if (!ptStats.currentSeed) continue;
      if (nextPhase.findPoolWithTeam(ptStats.team)) continue; // already rebracketed
      nextPhase.findPoolWithSeed(ptStats.currentSeed)?.addTeam(ptStats.team);
    }
    this.tournament.carryOverMatches(
      nextPhase,
      poolStats.poolTeams.map((ptStats) => ptStats.team),
    );
    this.compileStats();
    this.onDataChanged();
  }

  /**
   * Put a team in the the specified pool, removing them from a different pool if needed
   * @param team team to move
   * @param nextPhase phase to put the team in
   * @param newPool pool to put the team in; if undefined, just remove the team from their existing pool
   */
  overridePlayoffPoolAssignment(team: Team, nextPhase: Phase, newPool?: Pool) {
    if (!this.canEditScheduledStructure(nextPhase, true)) return;
    const curPool = nextPhase.findPoolWithTeam(team);
    if (curPool && curPool === newPool) return;

    this.tournament.clearCarryoverMatches(team, nextPhase);
    if (curPool) curPool.removeTeam(team);
    if (newPool) {
      this.addTeamtoPlayoffPool(team, newPool, nextPhase);
    } else {
      this.tournament.getPrevFullPhase(nextPhase)?.markTeamDidNotAdvance(team, true);
    }

    this.compileStats();
    this.onDataChanged();
  }

  reorderPools(phase: Phase, positionDraggedStr: string, positionDroppedOn: number) {
    if (!this.canEditScheduledStructure(phase)) return;
    const posDragInt = parseInt(positionDraggedStr, 10);
    if (Number.isNaN(posDragInt)) return;

    phase.reorderPools(posDragInt, positionDroppedOn);
    this.onDataChanged();
  }

  setFinalRankingsReady(ready: boolean) {
    this.tournament.finalRankingsReady = ready;
    this.tournament.confirmFinalRankings();
    this.onDataChanged();
  }

  /** Open with a new blank team */
  openTeamEditModalNewTeam() {
    this.teamModalManager.openModal();
  }

  openTeamEditModalExistingTeam(reg: Registration, team: Team) {
    this.teamModalManager.openModal(reg, team);
    this.registrationBeingModified = reg;
    this.teamBeingModified = team;
  }

  /** In the modal form, queue up a team of the given letter for the given registration */
  startNextTeamForRegistration(reg: Registration, letter: string) {
    this.teamModalManager.openModal(reg, undefined, letter);
    this.registrationBeingModified = reg;
    this.teamBeingModified = null;
  }

  /** Called when the team name in the team edit form is changed */
  onTeamRegistrationNameUpdate() {
    this.teamModalManager.copyDataFromOtherRegistration(this.registrationBeingModified, this.tournament.registrations);
    this.teamModalManager.checkForDuplicateTeam(this.tournament.registrations, this.teamBeingModified);
  }

  /** Called when the team letter field in the team edit form is changed */
  onTeamLetterUpdate() {
    this.teamModalManager.checkForDuplicateTeam(this.tournament.registrations, this.teamBeingModified);
  }

  teamEditModalAttemptToSave(stayOpen: boolean = false, startNextLetter: boolean = false) {
    if (this.teamModalManager.preSaveValidation()) {
      this.teamModalSave(stayOpen, startNextLetter);
    }
  }

  /**
   * Commit the team form.
   *
   * A rename is a structural edit, not a text change. `Match.id` is computed partly from the names
   * of the teams that played, so renaming a team moves the id of every official game it appears in —
   * and an accepted `ScheduledMatch` stores that id in `resultMatchId` as a durable link to the one
   * authoritative result. Left alone, the rename would silently break the correction workflow, the
   * deletion guard, and the schedule's claim to have produced that result.
   *
   * So the rename runs as one edit: validate, capture the identities that can move, rename, rewrite
   * the references that pointed at them, check the result links still hold, and only then commit. If
   * the check fails, the names go back rather than leaving a half-renamed operational graph.
   */
  private teamModalSave(stayOpen: boolean = false, startNextLetter: boolean = false) {
    const oldTeamName = this.teamBeingModified?.name;
    const nextTeamName = this.teamBeingModified ? this.teamModalManager.tempTeam.name : undefined;
    const isRename = !!oldTeamName && !!nextTeamName && oldTeamName !== nextTeamName;
    const resultLinkCheck = validateAcceptedResultLinks(this.tournament);
    if (!resultLinkCheck.ok) {
      this.makeToast(resultLinkCheck.reason ?? 'Accepted result links could not be validated.', 'error');
      return;
    }
    if (isRename) {
      const renameCheck = canRenameTeam(this.tournament, oldTeamName, nextTeamName);
      if (!renameCheck.ok) {
        this.makeToast(renameCheck.reason ?? 'The team rename is unsafe while room scoring is active.', 'error');
        return;
      }
      // Asked before anything is mutated: an ambiguous official-game id has no safe rewrite, and
      // finding that out afterwards would mean unwinding a rename instead of never starting it.
      const identityCheck = canReconcileOfficialResultIdentities(this.tournament);
      if (!identityCheck.ok) {
        this.makeToast(identityCheck.reason ?? 'Official results could not be relinked for this rename.', 'error');
        return;
      }
    }

    // Captured before the commit, because afterwards the old names and old ids are simply gone.
    // Every team is captured, not just the edited one: changing the organization name recompiles
    // the name of every team on that registration.
    const teamNamesBefore = isRename ? captureTeamNames(this.tournament) : [];
    const resultIdentitiesBefore = isRename ? captureOfficialResultIdentities(this.tournament) : [];

    // changing the team name means we might need to save to a different registration than we opened
    const actualRegToModify = this.teamModalManager.getRegistrationToSaveTo(
      this.registrationBeingModified,
      this.tournament.registrations,
    );
    const registrationSwitched = this.registrationBeingModified !== actualRegToModify;

    if (actualRegToModify === null) {
      // brand new registration
      this.tournament.addRegAndTeam(this.teamModalManager.tempRegistration, this.teamModalManager.tempTeam);
    } else if (this.teamBeingModified === null) {
      // brand new team on existing registration
      this.teamModalManager.saveRegistration(actualRegToModify, true);
      this.tournament.seedTeamsInRegistration(actualRegToModify);
    } else if (registrationSwitched) {
      // existing team being moved from one registration to another
      this.teamModalManager.saveRegistration(actualRegToModify, true, this.teamBeingModified);
      if (this.registrationBeingModified !== null) {
        // remove the team from the old registration
        this.tournament.deleteTeam(this.registrationBeingModified, this.teamBeingModified);
      }
    } else {
      // existing team being modified without changing the registration
      this.teamModalManager.saveTeam(actualRegToModify, this.teamBeingModified);
    }
    if (isRename) {
      const reconcile = this.reconcileRenamedTeamReferences(
        oldTeamName,
        nextTeamName,
        teamNamesBefore,
        resultIdentitiesBefore,
      );
      if (!reconcile.ok) {
        this.makeToast(reconcile.reason ?? 'The scheduled team references could not be reconciled.', 'error');
        return;
      }
    }
    this.teamEditModalReset(stayOpen, startNextLetter);
    this.onDataChanged();
  }

  /**
   * Rewrite every durable reference the rename just moved, and refuse if they do not all land.
   *
   * Scheduled team names and accepted result links are two halves of the same edit: a schedule that
   * still names the old team, or that points at an id no game has any more, is exactly the state
   * this is here to prevent. On failure the team names are put back, so the tournament is left as it
   * was rather than partly renamed.
   */
  private reconcileRenamedTeamReferences(
    oldTeamName: string,
    nextTeamName: string,
    teamNamesBefore: ITeamNameAnchor[],
    resultIdentitiesBefore: IOfficialResultAnchor[],
  ): IStructuralEditCheck {
    const scheduleBefore = this.tournament.scheduledMatches.map((scheduled) => ({
      scheduled,
      resultMatchId: scheduled.resultMatchId,
      leftTeamName: scheduled.leftTeamName,
      rightTeamName: scheduled.rightTeamName,
    }));

    const rollBack = (reason?: string): IStructuralEditCheck => {
      restoreTeamNames(teamNamesBefore);
      for (const entry of scheduleBefore) {
        entry.scheduled.resultMatchId = entry.resultMatchId;
        entry.scheduled.leftTeamName = entry.leftTeamName;
        entry.scheduled.rightTeamName = entry.rightTeamName;
      }
      return { ok: false, reason };
    };

    const teamReferences = reconcileTeamRename(this.tournament, oldTeamName, nextTeamName, teamNamesBefore);
    if (!teamReferences.ok) return rollBack(teamReferences.reason);

    const resultLinks = reconcileOfficialResultIdentities(this.tournament, resultIdentitiesBefore);
    if (!resultLinks.ok) return rollBack(resultLinks.reason);

    const linkage = validateAcceptedResultLinks(this.tournament);
    if (!linkage.ok) return rollBack(linkage.reason);

    return { ok: true };
  }

  teamEditModalReset(stayOpen: boolean = false, startNextLetter: boolean = false) {
    this.teamBeingModified = null;

    if (startNextLetter) {
      if (this.registrationBeingModified !== null) {
        this.teamModalManager.resetAndNextLetter(this.registrationBeingModified);
      } else {
        const regJustAdded = this.tournament.findRegistration(this.teamModalManager.tempRegistration.name);
        if (regJustAdded) this.teamModalManager.resetAndNextLetter(regJustAdded);
      }
      this.teamModalManager.checkForDuplicateTeam(this.tournament.registrations, null);
      return;
    }

    this.registrationBeingModified = null;
    if (stayOpen) {
      this.teamModalManager.resetForNewTeam();
    } else {
      this.teamModalManager.closeModal();
    }
  }

  openMatchModalNewMatchForRound(round: Round) {
    this.matchModalManager.openModal(undefined, round);
  }

  openMatchModalNewMatchForTeams(team1: Team, team2: Team) {
    this.matchModalManager.openModal(undefined, undefined, team1, team2);
  }

  openMatchEditModalExistingMatch(match: Match, round: Round) {
    this.matchModalManager.openModal(match, round);
    this.matchBeingModified = match;
  }

  matchEditModalAttemptToSave(stayOpen: boolean = false): boolean {
    if (this.matchModalManager.preSaveValidation()) {
      return this.matchEditModalSave(stayOpen);
    }
    return false;
  }

  private matchEditModalSave(stayOpen: boolean = false): boolean {
    const officialCorrection = this.matchModalManager.scheduledMatchContext?.isAccepted() === true;
    if (this.matchBeingModified !== null) {
      if (!this.matchModalManager.saveExistingMatch(this.matchBeingModified)) {
        this.makeToast('The match could not be saved without changing its existing data.', 'error');
        return false;
      }
    } else {
      this.matchModalManager.saveNewMatch();
    }
    this.matchEditModalReset(stayOpen);
    this.tournament.calcHasMatchData();
    if (officialCorrection) this.tournament.compileStats(false, true);
    this.onDataChanged();
    return true;
  }

  matchEditModalReset(stayOpen: boolean = false) {
    this.matchBeingModified = null;
    if (stayOpen) {
      this.matchModalManager.resetForNewMatch();
    } else {
      this.matchModalManager.closeModal();
    }
  }

  /**
   * A match submitted by a room was accepted by the statskeeper. It's already been inserted into the
   * round, so from here it's treated exactly like a manually imported match.
   */
  private onRemoteMatchAccepted() {
    this.tournament.setMatchIdCounter();
    this.onDataChanged();
  }

  openMatchImportModal(importResults: MatchImportResult[], round?: Round) {
    // The tournament goes in so the dialog can offer a scheduled game for a file that plainly
    // belongs to one — the recovery route for a room that had to download its result.
    this.matchImportResultsManager.openModal(importResults, round, this.tournament);
  }

  closeMatchImportModal(shouldSave: boolean) {
    this.matchImportResultsManager.closeModal(shouldSave);
    const problems = this.matchImportResultsManager.importProblems;
    if (shouldSave) {
      // A linked import changes the schedule as well as the standings, so recompute rather than
      // waiting for the next thing that happens to.
      this.tournament.setMatchIdCounter();
      this.compileStats();
      if (problems.length > 0) {
        this.openGenericModal('Import problems', problems.join('\n'));
      }
    }
    this.onDataChanged(!shouldSave);
  }

  openPhaseModal(phase: Phase) {
    const otherNames = this.tournament.phases.filter((ph) => ph !== phase).map((ph) => ph.name);
    const relatedFullPhase = phase.isFullPhase() ? phase : this.tournament.getPrevFullPhase(phase);
    const canConvToFinals = !relatedFullPhase
      ? false
      : (phase.phaseType === PhaseTypes.Playoff || phase.phaseType === PhaseTypes.Tiebreaker) &&
        this.tournament.isLastFullPhase(relatedFullPhase) &&
        !this.tournament.hasTiebreakerAfter(phase);
    // Has to either be a playoff phase, or a finals phase immediately after a playoff phase
    const canConvToTB = !relatedFullPhase
      ? false
      : (phase.phaseType === PhaseTypes.Playoff ||
          (phase.phaseType === PhaseTypes.Finals && relatedFullPhase === this.tournament.getPrevPhase(phase))) &&
        !this.tournament.hasTiebreakerAfter(relatedFullPhase);

    this.phaseModalManager.openModal(
      phase,
      otherNames,
      canConvToFinals,
      canConvToTB,
      this.tournament.roundNumberLowerBound(phase),
      this.tournament.roundNumberUpperBound(phase),
    );
  }

  closePhaseModal(shouldSave: boolean) {
    const phaseBeingEdited = this.phaseModalManager.originalPhaseOpened;
    if (
      shouldSave &&
      phaseBeingEdited &&
      this.tournament.scheduledMatches.some(
        (match) =>
          phaseBeingEdited.includesRoundNumber(match.roundNumber) &&
          (match.status === 'playing' || match.status === 'submitted'),
      )
    ) {
      this.phaseModalManager.closeModal(false);
      this.makeToast(
        'A room-scored game is active in this stage; finish or reject it before editing the stage.',
        'error',
      );
      return;
    }
    const changesRoundStructure =
      shouldSave &&
      phaseBeingEdited &&
      ((phaseBeingEdited.usesNumericRounds() &&
        (this.phaseModalManager.firstRound !== phaseBeingEdited.firstRoundNumber() ||
          this.phaseModalManager.lastRound !== phaseBeingEdited.lastRoundNumber())) ||
        this.phaseModalManager.convertToFinals ||
        this.phaseModalManager.convertToTiebreaker);
    if (changesRoundStructure && phaseBeingEdited && !this.canEditScheduledStructure(phaseBeingEdited, true)) {
      this.phaseModalManager.closeModal(false);
      return;
    }
    const anchors = shouldSave ? captureScheduledStructure(this.tournament) : [];
    const needToRecomputePhaseCodes = shouldSave && this.phaseModalManager.needToRecomputePhaseCodes();
    this.phaseModalManager.closeModal(shouldSave);
    if (needToRecomputePhaseCodes) {
      this.tournament.recomputePhaseCodes();
    }
    if (shouldSave) {
      const reconciled = reconcileScheduledStructureFromAnchors(this.tournament, anchors);
      if (!reconciled.ok) {
        this.makeToast(reconciled.reason ?? 'The Match Plan could not be reconciled after editing the stage.', 'error');
        return;
      }
    }
    this.onDataChanged(!shouldSave);
  }

  openPoolModal(phase: Phase, pool: Pool) {
    const otherNames = phase.pools.filter((pl) => pl !== pool).map((pl) => pl.name);
    this.poolModalManager.openModal(pool, otherNames, phase, !this.tournament.usingScheduleTemplate);
  }

  closePoolModal(shouldSave: boolean) {
    const pool = this.poolModalManager.originalPoolOpened;
    const phase = this.poolModalManager.phaseContainingPool;
    const changesPoolStructure =
      shouldSave &&
      pool &&
      (pool.size !== this.poolModalManager.numTeams ||
        pool.roundRobins !== this.poolModalManager.numRoundRobins ||
        pool.hasCarryover !== this.poolModalManager.hasCarryover);
    if (shouldSave && phase && !this.canEditScheduledStructure(phase, changesPoolStructure === true)) return;
    const oldName = pool?.name;
    this.poolModalManager.closeModal(shouldSave);
    if (shouldSave && pool && phase && oldName) {
      const reconciled = reconcilePoolRename(this.tournament, phase.code, oldName, pool.name);
      if (!reconciled.ok) {
        this.makeToast(reconciled.reason ?? 'The Match Plan could not be reconciled after renaming the pool.', 'error');
        return;
      }
    }
    this.onDataChanged(!shouldSave);
  }

  openRankModal(team: Team) {
    this.rankModalManager.openModal(team);
  }

  closeRankModal(shouldSave: boolean) {
    this.rankModalManager.closeModal(shouldSave);
    if (shouldSave) this.tournament.reSortStandingsByFinalRank();
    this.onDataChanged(!shouldSave);
  }

  openPoolAssignmentModal(team: Team, phase: Phase, acceptCallback: () => void, originalPool?: Pool) {
    this.poolAssignmentModalManager.openModal(team, phase, acceptCallback, originalPool);
    this.onDataChanged(true);
  }

  closePoolAssignmentModal(shouldSave: boolean) {
    this.poolAssignmentModalManager.closeModal(shouldSave);
    this.onDataChanged(!shouldSave);
  }

  poolAssignSimpleSwitch() {
    this.poolAssignmentModalManager.simplePoolSwitch();
  }

  poolAssignPlayoffSwitch() {
    if (!this.poolAssignmentModalManager.modalIsOpen) return;

    const team = this.poolAssignmentModalManager.teamBeingAssigned;
    const nextPhase = this.poolAssignmentModalManager.phase;
    if (!team || !nextPhase) return;

    const newPool = this.poolAssignmentModalManager.selectedPool;
    this.overridePlayoffPoolAssignment(team, nextPhase, newPool);
  }

  openSqbsExportModal() {
    this.sqbsExportModalManager.openModal(this.tournament.phases);
    this.onDataChanged(true);
  }

  closeSqbsExportModal(shouldSave: boolean) {
    const phases = this.sqbsExportModalManager.selectedPhases;
    const combinedFile = this.sqbsExportModalManager.combineFiles;
    this.sqbsExportModalManager.closeModal();
    this.onDataChanged(true);

    if (shouldSave) this.generateSqbsFiles(phases, combinedFile);
  }

  private canChangeScoringRules(): boolean {
    const activeScheduled = this.tournament.scheduledMatches.find(
      (match) => match.status === 'playing' || match.status === 'submitted',
    );
    const activeSession = this.tournamentServerService.sessions.find(
      (session) => session.status === 'playing' || session.status === 'submitted',
    );
    if (!activeScheduled && !activeSession) return true;
    this.makeToast('Scoring rules cannot change while a browser-scored game is active or awaiting review.', 'error');
    return false;
  }

  /** Structural schedule edits must not invalidate a live or review-pending room game. */
  private canEditScheduledStructure(scope?: Phase, requireNoScheduled = false): boolean {
    const active = this.tournament.scheduledMatches.find(
      (match) =>
        (scope === undefined || scope.includesRoundNumber(match.roundNumber)) &&
        (match.status === ScheduledMatchStatus.Playing || match.status === ScheduledMatchStatus.Submitted),
    );
    if (active) {
      this.makeToast(
        `${active.describe()} is ${active.status} in room scoring. Finish or reject it before editing the schedule.`,
        'error',
      );
      return false;
    }
    if (requireNoScheduled) {
      const scheduled = this.tournament.scheduledMatches.find(
        (match) =>
          match.status !== ScheduledMatchStatus.Cancelled &&
          (scope === undefined || scope.includesRoundNumber(match.roundNumber)),
      );
      if (scheduled) {
        this.makeToast(
          `${scheduled.describe()} is in the Match Plan. Resolve the affected schedule before changing this structure.`,
          'error',
        );
        return false;
      }
    }
    return true;
  }

  /** Should be called anytime the user modifies something */
  private onDataChanged(doesntAffectFile = false) {
    if (!doesntAffectFile) this.tournament.dataRevision += 1;
    // Keep both the room projection and the public read-only live projection current for every
    // accepted match, schedule edit, and persisted display-setting change.
    if (!this.tournamentServerService.pushTournamentSnapshot()) {
      this.makeToast(
        this.tournamentServerService.lastError || 'The Tournament Server projection could not be updated.',
        'error',
      );
    }
    this.dataChangedReactCallback();
    if (doesntAffectFile) return;

    this.markFileDirty();
  }

  /**
   * Public bridge for the tournament-operations surface.
   *
   * Room and scheduled-match controls live beside the server service rather than inside the older
   * modal managers, but their edits still need the normal dirty-file and React notification path.
   */
  markTournamentDataChanged() {
    this.onDataChanged();
  }

  /** Append one room-added player without replacing the Team or any existing Player identity. */
  addPlayerFromRoom(request: IRoomPlayerAddRequest): { ok: true; added: boolean } | { ok: false; reason: string } {
    if (request.tournamentKey && request.tournamentKey !== this.tournament.operationalId) {
      return { ok: false, reason: 'The roster request belongs to a different tournament.' };
    }
    const team = this.tournament.getListOfAllTeams().find((candidate) => candidate.name === request.teamName);
    if (!team) return { ok: false, reason: 'That team is not part of the open tournament.' };
    const name = request.playerName.trim();
    const duplicate = team.players.find((player) => player.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (duplicate) return { ok: true, added: false };
    if (team.players.length >= Team.maxPlayers) {
      return { ok: false, reason: `A team cannot have more than ${Team.maxPlayers} players.` };
    }
    const player = new Player(name);
    player.validateName(true);
    if (player.nameValidation.status === ValidationStatuses.Error) {
      return { ok: false, reason: player.nameValidation.message };
    }

    team.players.push(player);
    team.validatePlayerList();
    team.validatePlayerUniqueness();
    const errors = team.getErrorMessages();
    if (errors.length > 0) {
      team.players.pop();
      team.validatePlayerList();
      team.validatePlayerUniqueness();
      return { ok: false, reason: errors.join(' ') };
    }

    this.tournamentServerService.revalidatePendingSubmissionsForTeam(team.name);
    this.onDataChanged();
    return { ok: true, added: true };
  }

  private markFileDirty() {
    this.unsavedData = true;
    this.setWindowTitle();
  }

  protected setWindowTitle() {
    let title = this.getFileDisplayName();
    if (this.unsavedData) title = title.concat('*');
    window.electron.ipcRenderer.sendMessage(IpcRendToMain.setWindowTitle, title);
  }

  private getFileDisplayName() {
    if (this.filePath === null) return TournamentManager.newTournamentName;

    const fileName = getFileNameFromPath(this.filePath) || this.filePath;
    if (!this.displayName) return fileName;
    return `${this.displayName} - ${fileName}`;
  }

  openAboutYfDialog() {
    this.aboutYfDialogOpen = true;
    this.onDataChanged(true);
  }

  closeAboutYfDialog() {
    this.aboutYfDialogOpen = false;
    this.onDataChanged(true);
  }

  openGenericModal(title: string, contents: string) {
    this.genericModalManager.open(title, contents);
    this.dataChangedReactCallback();
  }

  closeGenericModal() {
    this.genericModalManager.close();
  }

  anyModalOpen() {
    return (
      this.genericModalManager.isOpen ||
      this.teamModalManager.modalIsOpen ||
      this.matchModalManager.modalIsOpen ||
      this.phaseModalManager.modalIsOpen ||
      this.poolModalManager.modalIsOpen ||
      this.rankModalManager.modalIsOpen ||
      this.matchImportResultsManager.modalIsOpen ||
      this.poolAssignmentModalManager.modalIsOpen ||
      this.sqbsExportModalManager.modalIsOpen ||
      this.aboutYfDialogOpen
    );
  }

  /** Alert the user if there is a newer version of the application is available */
  newReleaseAlert(isRetry?: boolean) {
    if (this.latestAvailVersion === '') return;

    if (this.appVersion === '') {
      if (isRetry) this.requestAppVersion();

      setTimeout(() => {
        this.newReleaseAlert(true);
      }, 3000);
    }

    if (versionLt(this.appVersion, this.latestAvailVersion)) {
      this.makeToast(
        `A newer version of YellowFruit is available`,
        'info',
        'https://github.com/ANadig/YellowFruit/releases/latest',
      );
    }
  }

  // eslint-disable-next-line class-methods-use-this
  launchStatReportInBrowserWindow() {
    window.electron.ipcRenderer.sendMessage(IpcRendToMain.LaunchStatReportInBrowser);
  }

  // eslint-disable-next-line class-methods-use-this
  launchWebPageInBrowserWindow(url: string) {
    window.electron.ipcRenderer.sendMessage(IpcRendToMain.LaunchExternalWebPage, url);
  }
}

/** Represents an error state where we haven't properly created or loaded a tournament to edit */
class NullTournamentManager extends TournamentManager {
  readonly isNull: boolean = true;

  constructor() {
    super();
    this.tournament.name = 'NullTournamentManager';
  }

  // eslint-disable-next-line class-methods-use-this
  addIpcListeners(): void {}

  // eslint-disable-next-line class-methods-use-this
  protected setWindowTitle(): void {}

  // eslint-disable-next-line class-methods-use-this
  requestAppVersion(): void {}

  // eslint-disable-next-line class-methods-use-this
  requestBackupFile(): void {}

  // eslint-disable-next-line class-methods-use-this
  checkForNewVersion(): void {}

  // eslint-disable-next-line class-methods-use-this
  setFilePath(): void {}
}

/** React context that elements can use to access the TournamentManager and its data without
 * having to thread data and data-changing functions up and down the react tree
 */
export const TournamentContext = createContext<TournamentManager>(new NullTournamentManager());
