/** Channels for renderer sending messages to main */
export enum IpcRendToMain {
  /** Save arbitrary file contents */
  saveFile = 'saveFile',
  /** Tell the main process what file is being edited */
  setYftFilePath = 'setYftFilePath',
  /** Set the title of the electron window */
  setWindowTitle = 'setWindowTitle',
  /** Retrieve the directory containing the in-app stat report */
  GetAppDataStatReportPath = 'GetAppDataStatReportPath',
  /** Open the file browser so the user can choose where to save stat reports */
  StatReportSaveDialog = 'StatReportSaveDialog',
  /** Save html stat reports */
  WriteStatReports = 'WriteStatReports',
  /** After allowing the user to save data, continue with the action the main process was trying to do */
  ContinueWithAction = 'ContinueWithAction',
  /** Provide the contents of a backup file to save */
  SaveBackup = 'SaveBackup',
  /** Tell the main process that it can start autosaving the current data */
  StartAutosave = 'StartAutosave',
  /** Tell the main process that we crashed :( */
  WebPageCrashed = 'WebPageCrashed',
  /** Tell main to prompt for a qbj file to import teams/rosters from */
  LaunchImportQbjTeamWorkflow = 'LaunchImportQbjTeamWorkflow',
  /** Tell main to prompt for an SQBS filoe to import teams/rosters from */
  LaunchImportSqbsTeamWorkflow = 'LaunchImportSqbsTeamWorkflow',
  /** Open the native save dialog for exporting the current tournament as QBJ */
  LaunchQbjExportWorkflow = 'LaunchQbjExportWorkflow',
  /** Tell main to launch the stat report in an external browser window */
  LaunchStatReportInBrowser = 'LaunchStatReportInBrowser',
  /** Launch an arbitrary web page in an external browser window */
  LaunchExternalWebPage = 'LaunchExternalWebPage',
  /** Push the read-only tournament projection that the tournament server serves to room clients */
  TournamentServerSetSnapshot = 'TournamentServerSetSnapshot',
  /** Push the separate, deliberately reduced public live projection to the local server */
  TournamentServerSetPublicLiveSnapshot = 'TournamentServerSetPublicLiveSnapshot',
  /** Push the independent public released-pairings projection to the local server */
  TournamentServerSetPublicPairingsSnapshot = 'TournamentServerSetPublicPairingsSnapshot',
  /** The statskeeper accepted or rejected a match a room submitted */
  TournamentServerSubmissionVerdict = 'TournamentServerSubmissionVerdict',
}

/** Channels for main sending messages to renderer */
export enum IpcMainToRend {
  openYftFile = 'openYftFile',
  /** Tell the renderer which file is now open */
  SetFilePath = 'SetFilePath',
  /** Request the renderer to save the currently open tournament to yft */
  saveCurrentTournament = 'saveCurrentTournament',
  /** Tell the renderer that the .yft file was saved */
  tournamentSavedSuccessfully = 'tournamentSavedSuccessfully',
  /** "Save as" menu option */
  saveAsCommand = 'saveAsYft',
  /** Start a blank tournament with no file */
  newTournament = 'newTournament',
  /** Report that the stat report has been successfully written to file */
  GeneratedInAppStatReport = 'GeneratedInAppStatReport',
  /** Request the renderer to generate stat reports */
  RequestStatReport = 'RequestStatReport',
  /** Before switching away from the current file, allow renderer to give user a chance to save unsaved data or back out */
  CheckForUnsavedData = 'CheckForUnsavedData',
  /** Save a backup copy of the current file */
  GenerateBackup = 'GenerateBackup',
  /** Import an entire non-yft qbj file */
  ImportQbjTournament = 'ImportQbjTournament',
  /** Import teams and rosters from a non-yft qbj file */
  ImportQbjTeams = 'ImportQbjTeams',
  /** Import teams and rosters from an SQBS file */
  ImportSqbsTeams = 'ImportSqbsTeams',
  /** Send a message to display as a toast */
  MakeToast = 'MakeToast',
  /** Launch an informational help window */
  LaunchAboutYf = 'LaunchAboutYf',
  /** QBJ game import workflow, triggered by Main process */
  ImportQbjGamesMainLaunch = 'ImportQbjGamesMainLaunch',
  /** The tournament server's running state changed */
  TournamentServerStatusChanged = 'TournamentServerStatusChanged',
  /** A room submitted a final match result that needs the statskeeper's decision */
  TournamentServerMatchSubmitted = 'TournamentServerMatchSubmitted',
  /** The set of active room sessions changed, so the live dashboard should refresh */
  TournamentServerSessionsChanged = 'TournamentServerSessionsChanged',
  /** A room started its assigned game, so the scheduled match should show as being played */
  TournamentServerSessionStarted = 'TournamentServerSessionStarted',
  /** A room browser's operational help-request view changed */
  TournamentServerHelpRequestsChanged = 'TournamentServerHelpRequestsChanged',
  /** A room requested a narrowly scoped authoritative roster addition. */
  TournamentServerRoomPlayerAddRequested = 'TournamentServerRoomPlayerAddRequested',
  /** The redundant .yft backup succeeded or failed, so the Control page can show its health */
  SecondaryBackupHealthChanged = 'SecondaryBackupHealthChanged',
}

/** Channels for both directions renderer<-->main */
export enum IpcBidirectional {
  ipcExample = 'ipc-example',
  /** Grab the backup file on startup */
  LoadBackup = 'LoadBackup',
  /** Export QBJ schema file format */
  ExportQbjFile = 'ExportQbjFile',
  /** Import individual games from qbj files */
  ImportQbjGamesRendererLaunch = 'ImportQbjGames',
  /** For asking for and receiving the app version number */
  GetAppVersion = 'GetAppVersion',
  /** For the main process asking for and receiving SQBS files to save */
  SqbsExport = 'SqbsExport',
  /** See if there's a newer version the user should condider downloading */
  CheckForNewVersion = 'CheckForNewVersion',
  /** Start the local tournament server. Replies with the resulting status. */
  TournamentServerStart = 'TournamentServerStart',
  /** Stop the local tournament server. Replies with the resulting status. */
  TournamentServerStop = 'TournamentServerStop',
  /** Ask for the tournament server's current status, including its LAN addresses */
  TournamentServerGetStatus = 'TournamentServerGetStatus',
  /** Ask for the current room sessions, for the live dashboard */
  TournamentServerGetSessions = 'TournamentServerGetSessions',
  /** Ask for finals recovered from the app-data session store */
  TournamentServerGetPendingSubmissions = 'TournamentServerGetPendingSubmissions',
  /** Ask for the last check-in time of each configured room */
  TournamentServerGetRoomPresence = 'TournamentServerGetRoomPresence',
  /** Ask for open/resolved/cancelled operational help requests */
  TournamentServerGetHelpRequests = 'TournamentServerGetHelpRequests',
  /** Read the configured static QBSheet CORS origin. */
  TournamentServerGetQbsheetOrigin = 'TournamentServerGetQbsheetOrigin',
  /** Persist and apply the static QBSheet CORS origin. */
  TournamentServerSetQbsheetOrigin = 'TournamentServerSetQbsheetOrigin',
  /** Resolve or cancel one operational help request from tournament control */
  TournamentServerUpdateHelpRequest = 'TournamentServerUpdateHelpRequest',
  /** Choose a folder and write one QBSheet .qbg per exported room assignment. */
  ExportQbsheetGamePackages = 'ExportQbsheetGamePackages',
  /** Ask where redundant .yft copies are written, and how the last one went */
  GetSecondaryBackupHealth = 'GetSecondaryBackupHealth',
  /** Open the folder picker for redundant .yft copies. Replies with the resulting health. */
  ChooseSecondaryBackupFolder = 'ChooseSecondaryBackupFolder',
  /** Stop writing redundant copies. Replies with the resulting health. */
  ClearSecondaryBackupFolder = 'ClearSecondaryBackupFolder',
  /** Try the last failed redundant copy again, e.g. after the drive was plugged back in */
  RetrySecondaryBackup = 'RetrySecondaryBackup',
}

export type IpcChannels = IpcRendToMain | IpcMainToRend | IpcBidirectional;

export const rendererListenableEvents = [
  IpcMainToRend.openYftFile,
  IpcMainToRend.SetFilePath,
  IpcMainToRend.saveCurrentTournament,
  IpcMainToRend.tournamentSavedSuccessfully,
  IpcMainToRend.saveAsCommand,
  IpcMainToRend.newTournament,
  IpcMainToRend.GeneratedInAppStatReport,
  IpcMainToRend.RequestStatReport,
  IpcMainToRend.CheckForUnsavedData,
  IpcMainToRend.GenerateBackup,
  IpcMainToRend.ImportQbjTournament,
  IpcMainToRend.ImportQbjTeams,
  IpcMainToRend.ImportSqbsTeams,
  IpcMainToRend.MakeToast,
  IpcMainToRend.ImportQbjGamesMainLaunch,
  IpcMainToRend.LaunchAboutYf,
  IpcMainToRend.TournamentServerStatusChanged,
  IpcMainToRend.TournamentServerMatchSubmitted,
  IpcMainToRend.TournamentServerSessionsChanged,
  IpcMainToRend.TournamentServerSessionStarted,
  IpcMainToRend.TournamentServerHelpRequestsChanged,
  IpcMainToRend.TournamentServerRoomPlayerAddRequested,
  IpcMainToRend.SecondaryBackupHealthChanged,
  IpcBidirectional.LoadBackup,
  IpcBidirectional.ExportQbjFile,
  IpcBidirectional.ImportQbjGamesRendererLaunch,
  IpcBidirectional.GetAppVersion,
  IpcBidirectional.SqbsExport,
  IpcBidirectional.CheckForNewVersion,
  IpcBidirectional.TournamentServerStart,
  IpcBidirectional.TournamentServerStop,
  IpcBidirectional.TournamentServerGetStatus,
  IpcBidirectional.TournamentServerGetSessions,
  IpcBidirectional.TournamentServerGetPendingSubmissions,
  IpcBidirectional.TournamentServerGetRoomPresence,
  IpcBidirectional.TournamentServerGetHelpRequests,
  IpcBidirectional.TournamentServerGetQbsheetOrigin,
  IpcBidirectional.TournamentServerSetQbsheetOrigin,
  IpcBidirectional.TournamentServerUpdateHelpRequest,
  IpcBidirectional.ExportQbsheetGamePackages,
  IpcBidirectional.GetSecondaryBackupHealth,
  IpcBidirectional.ChooseSecondaryBackupFolder,
  IpcBidirectional.ClearSecondaryBackupFolder,
  IpcBidirectional.RetrySecondaryBackup,
];
