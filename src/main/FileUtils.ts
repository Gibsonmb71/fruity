import path from 'path';
import { app, BrowserWindow, IpcMainEvent, dialog, IpcMainInvokeEvent, shell } from 'electron';
import fs from 'fs';
import { IpcBidirectional, IpcMainToRend } from '../IPCChannels';
import { writeFileAtomically } from './AtomicFile';
import SecondaryBackupManager, { ISecondaryBackupHealth } from './SecondaryBackup';
import { readAppPreferences, updateAppPreferences } from './AppPreferences';
import {
  FileSwitchActions,
  IMatchImportFileRequest,
  SqbsExportFile,
  StatReportHtmlPage,
  statReportProtocol,
} from '../SharedUtils';

export const inAppStatReportDirectory = path.resolve(app.getPath('userData'), 'StatReport');

const backupFileDir = path.resolve(app.getPath('userData'), 'yfBackup');
const backupFilePathProd = path.resolve(backupFileDir, 'prod_backup.yftbak');
const backupFilePathDev = path.resolve(backupFileDir, 'dev_backup.yftbak');
const curBackupFilePath = process.env.NODE_ENV === 'development' ? backupFilePathDev : backupFilePathProd;
let backupWritePromise: Promise<void> = Promise.resolve();

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown filesystem error.';
}

/**
 * The optional redundant copy of the .yft, on a USB stick or a share.
 *
 * Owned here because this is where a successful primary save is observed. Nothing about the primary
 * save waits on it or is affected by it; see SecondaryBackup for why that separation is absolute.
 */
const secondaryBackup = new SecondaryBackupManager((health) => broadcastBackupHealth(health));

function broadcastBackupHealth(health: ISecondaryBackupHealth) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IpcMainToRend.SecondaryBackupHealthChanged, health);
  }
}

/**
 * Kick off the redundant copy without joining it to the save's promise chain.
 *
 * A separate function rather than an inline `.catch`, because the two must not be chained: the
 * primary save is already durable and already acknowledged by the time this runs, and anything
 * that made Save wait on — or fail because of — a network share would be a worse bug than any this
 * feature fixes.
 */
function startSecondaryBackup(fileContents: string) {
  secondaryBackup.backup(fileContents).catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(`Redundant backup could not be started: ${errorMessage(error)}`);
  });
}

/** Adopt the folder this installation was last pointed at. */
export function restoreSecondaryBackupFolder() {
  const folder = readAppPreferences().secondaryBackupFolder;
  if (folder) secondaryBackup.setFolder(folder);
}

export function getSecondaryBackupHealth(): ISecondaryBackupHealth {
  return secondaryBackup.getHealth();
}

function preferenceSaveHealth(health: ISecondaryBackupHealth, error?: string): ISecondaryBackupHealth {
  if (!error) return health;
  return { ...health, lastError: `Backup folder setting could not be saved: ${error}` };
}

/** Ask the director where redundant copies should go. */
export async function chooseSecondaryBackupFolder(window: BrowserWindow | null): Promise<ISecondaryBackupHealth> {
  if (!window) return secondaryBackup.getHealth();
  const chosen = dialog.showOpenDialogSync(window, {
    title: 'Choose a backup folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (!chosen || chosen.length === 0) return secondaryBackup.getHealth();
  secondaryBackup.setFolder(chosen[0]);
  const saved = await updateAppPreferences({ secondaryBackupFolder: chosen[0] });
  return preferenceSaveHealth(secondaryBackup.getHealth(), saved.ok ? undefined : saved.error);
}

export async function clearSecondaryBackupFolder(): Promise<ISecondaryBackupHealth> {
  secondaryBackup.setFolder(null);
  const saved = await updateAppPreferences({ secondaryBackupFolder: undefined });
  return preferenceSaveHealth(secondaryBackup.getHealth(), saved.ok ? undefined : saved.error);
}

/** Try the last failed copy again, for the case where the drive has come back. */
export async function retrySecondaryBackup(): Promise<ISecondaryBackupHealth> {
  await secondaryBackup.retry();
  return secondaryBackup.getHealth();
}

/** The path of the file being edited in the renderer process */
let curYftFilePath: string = '';

function getCurYftFilePath() {
  return curYftFilePath;
}
function setCurYftFilePath(newPath: string) {
  curYftFilePath = newPath;
}

/** Serialize autosave writes so an older interval callback cannot finish after a newer backup. */
function queueBackupWrite(contents: string): Promise<void> {
  const next = backupWritePromise.catch(() => undefined).then(() => writeFileAtomically(curBackupFilePath, contents));
  backupWritePromise = next;
  return next;
}

export function handleSetYftFilePath(event: IpcMainEvent, filePath: string) {
  setCurYftFilePath(filePath);
}

/** Create necessary directories and files if they don't yet exist  */
export function createDirectories() {
  if (!fs.existsSync(inAppStatReportDirectory)) {
    fs.mkdirSync(inAppStatReportDirectory, { recursive: true });
  }
  if (!fs.existsSync(backupFileDir)) {
    fs.mkdirSync(backupFileDir, { recursive: true });
  }
  if (!fs.existsSync(curBackupFilePath)) {
    queueBackupWrite('').catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error(`Unable to create the autosave file: ${errorMessage(error)}`);
    });
  }
}

/** We stop the window from closing so we can check whether we need to save. This is set to true once we've done the necessary checking and saving */
let appCanQuit = false;

export function appAllowedToQuit() {
  return appCanQuit;
}

export function tryFileSwitchAction(mainWindow: BrowserWindow, action: FileSwitchActions) {
  mainWindow.webContents.send(IpcMainToRend.CheckForUnsavedData, action);
}

/** Actually do the action we interrupted to (possibly) save data first */
export function handleContinueAction(event: IpcMainEvent, action: FileSwitchActions) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;

  doFileSwitchAction(action, window);
}

function doFileSwitchAction(action: FileSwitchActions, window: BrowserWindow) {
  switch (action) {
    case FileSwitchActions.OpenYftFile:
      openYftFile(window);
      break;
    case FileSwitchActions.ImportQbjTournament:
      importQbjTournament(window);
      break;
    case FileSwitchActions.NewFile:
      newYftFile(window);
      break;
    case FileSwitchActions.CloseApp:
      closeApplication();
      break;
    default:
  }
}

function closeApplication() {
  return clearBackupFile()
    .catch((error: unknown) => {
      // Keep a previous complete backup if clearing it fails; this is safer than truncating it.
      // eslint-disable-next-line no-console
      console.error(`Autosave backup could not be cleared: ${errorMessage(error)}`);
    })
    .finally(() => {
      appCanQuit = true;
      app.quit();
    });
}

function newYftFile(mainWindow: BrowserWindow) {
  mainWindow.webContents.send(IpcMainToRend.newTournament);
}

function openYftFile(mainWindow: BrowserWindow) {
  const fileNameAry = dialog.showOpenDialogSync(mainWindow, {
    title: 'Open File',
    filters: [{ name: 'YellowFruit Tournament', extensions: ['yft'] }],
  });
  if (!fileNameAry) return;

  readYftFileAndSendToRend(mainWindow, fileNameAry[0]);
}

export function readYftFileAndSendToRend(mainWindow: BrowserWindow, filePath: string) {
  fs.readFile(filePath, { encoding: 'utf8' }, (err, fileContents) => {
    if (err) {
      dialog.showMessageBoxSync(mainWindow, { message: `Error reading file: \n\n ${err.message}` });
      return;
    }
    mainWindow.webContents.send(IpcMainToRend.openYftFile, filePath, fileContents, app.getVersion());
  });
}

function importQbjTournament(mainWindow: BrowserWindow) {
  const fileNameAry = dialog.showOpenDialogSync(mainWindow, {
    title: 'Open File',
    filters: [{ name: 'Tournament Schema', extensions: ['qbj', 'json'] }],
  });
  if (!fileNameAry) return;

  fs.readFile(fileNameAry[0], { encoding: 'utf8' }, (err, fileContents) => {
    if (err) {
      dialog.showMessageBoxSync(mainWindow, { message: `Error reading file: \n\n ${err.message}` });
      return;
    }
    mainWindow.webContents.send(IpcMainToRend.ImportQbjTournament, fileNameAry[0], fileContents);
  });
}

export function handleLaunchImportQbjTeamsFromRenderer(event: IpcMainEvent) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;

  importQbjTeams(window);
}

export function importQbjTeams(mainWindow: BrowserWindow) {
  const fileNameAry = dialog.showOpenDialogSync(mainWindow, {
    title: 'Import Teams',
    filters: [{ name: 'Tournament Schema', extensions: ['qbj', 'json'] }],
  });
  if (!fileNameAry) return;

  fs.readFile(fileNameAry[0], { encoding: 'utf8' }, (err, fileContents) => {
    if (err) {
      dialog.showMessageBoxSync(mainWindow, { message: `Error reading file: \n\n ${err.message}` });
      return;
    }
    mainWindow.webContents.send(IpcMainToRend.ImportQbjTeams, fileContents);
  });
}

export function handleLaunchImportSqbsTeamsFromRenderer(event: IpcMainEvent) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;

  importSqbsTeams(window);
}

export function importSqbsTeams(mainWindow: BrowserWindow) {
  const fileNameAry = dialog.showOpenDialogSync(mainWindow, {
    title: 'Import Teams',
    filters: [{ name: 'SQBS Tournament', extensions: ['sqbs'] }],
  });
  if (!fileNameAry) return;

  fs.readFile(fileNameAry[0], { encoding: 'utf8' }, (err, fileContents) => {
    if (err) {
      dialog.showMessageBoxSync(mainWindow, { message: `Error reading file: \n\n ${err.message}` });
      return;
    }
    mainWindow.webContents.send(IpcMainToRend.ImportSqbsTeams, fileContents);
  });
}

export function requestToSaveYftFile(mainWindow: BrowserWindow) {
  mainWindow.webContents.send(IpcMainToRend.saveCurrentTournament);
}

export function yftSaveAs(mainWindow: BrowserWindow) {
  const fileName = promptForYftFile(mainWindow);
  if (!fileName) return;

  mainWindow.webContents.send(IpcMainToRend.saveAsCommand, fileName);
}

function promptForYftFile(window: BrowserWindow) {
  return dialog.showSaveDialogSync(window, {
    title: 'Save As',
    filters: [{ name: 'YellowFruit Tournament', extensions: ['yft'] }],
  });
}

export function handleSaveFile(
  event: IpcMainEvent,
  filePathFromRenderer: string,
  fileContents: string,
  subsequentAction?: FileSwitchActions,
) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;

  const filePath = filePathFromRenderer || promptForYftFile(window);
  if (!filePath) return;

  writeFileAtomically(filePath, fileContents)
    .then(() => {
      // The renderer adopts the path and clears its dirty flag only after this message. A failed
      // write never reaches this branch, including a failed Save As.
      window.webContents.send(IpcMainToRend.tournamentSavedSuccessfully, filePath);
      // Deliberately not awaited. The primary save is already durable and already acknowledged; a
      // slow or absent USB stick must not be able to make Save appear to hang or fail, and its
      // failure is reported through the backup health rather than through this write's outcome.
      startSecondaryBackup(fileContents);
      if (subsequentAction !== undefined) return doFileSwitchAction(subsequentAction, window);
      return undefined;
    })
    .catch((error: unknown) => {
      dialog.showMessageBoxSync(window, { message: `Error saving file: \n\n ${errorMessage(error)}` });
    });
}

export function handleSetWindowTitle(event: IpcMainEvent, title: string) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;

  window?.setTitle(`YellowFruit - ${title}`);
}

export function handleWriteStatReports(event: IpcMainEvent, reports: StatReportHtmlPage[], filePathStart?: string) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;

  writeStatReportFile(reports, 0, window, filePathStart);
}

/** If externalFilePathStart not passed, write to the in-app location rather than exporting somewhere else */
function writeStatReportFile(
  reports: StatReportHtmlPage[],
  idx: number,
  window: BrowserWindow,
  externalFilePathStart?: string,
) {
  const page = reports[idx];
  if (!page) return;

  const pagePath = externalFilePathStart
    ? `${externalFilePathStart}_${page.fileName}`
    : path.resolve(inAppStatReportDirectory, page.fileName);
  fs.writeFile(pagePath, page.contents, { encoding: 'utf8' }, (err) => {
    if (err) {
      dialog.showMessageBoxSync(window, { message: `Error generating report: \n\n ${err.message}` });
      return;
    }
    if (idx < reports.length - 1) {
      writeStatReportFile(reports, idx + 1, window, externalFilePathStart);
    } else if (externalFilePathStart) {
      window.webContents.send(IpcMainToRend.MakeToast, 'Stat report exported');
    } else {
      window.webContents.send(IpcMainToRend.GeneratedInAppStatReport);
    }
  });
}

/** Take the special URL passed from the renderer process, and convert into the actual file name that we need to load */
export function parseStatReportPath(url: string) {
  let str = url.replace(`${statReportProtocol}://`, '');
  // Remove the #<anchor> at the end. Otherwise electron will attempt to load a file with that
  // exact name. Somehow, the iframe still magically scrolls to the anchor.
  str = str.replace(/#.*$/, '');

  // if it just ends with ".html/", we're good
  if (str.search(/\.html\/.+/) === -1) return str;

  // links in the iframe try to take you to, e.g. "standings.html/individuals.html" instead of
  // "individuals.html", so we need to remove the first page name before the slash
  return str.replace(/^.*\.html\//, '');
}

export function handleRequestToSaveHtmlReports(event: IpcMainEvent, curFileName?: string) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;

  promptForStatReportLocation(window, curFileName);
}

export function promptForStatReportLocation(window: BrowserWindow, fileNameFromRenderer?: string) {
  let defaultPath: string | undefined;
  if (fileNameFromRenderer) defaultPath = stripYftExtension(fileNameFromRenderer);
  else if (getCurYftFilePath()) defaultPath = stripYftExtension(getCurYftFilePath());

  const fileName = dialog.showSaveDialogSync(window, {
    defaultPath,
    filters: [{ name: 'HTML Webpages', extensions: ['html'] }],
  });

  if (!fileName) return;

  let fileStart = fileName.replace(/\.html$/i, '');
  fileStart = fileStart.replace(/_(standings|individuals|games|teamdetail|playerdetail|rounds)/i, '');

  window.webContents.send(IpcMainToRend.RequestStatReport, fileStart);
}

function stripYftExtension(filename: string) {
  return filename.replace(/\.yft$/i, '');
}

export function generateBackup(window: BrowserWindow | null) {
  if (!window) return;
  window.webContents.send(IpcMainToRend.GenerateBackup);
}

export function handleSaveBackup(event: IpcMainEvent, fileContents: string) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;

  queueBackupWrite(fileContents).catch((error: unknown) => {
    // Autosave is best effort, but its failure must be diagnosable without interrupting a live
    // tournament every two minutes.
    // eslint-disable-next-line no-console
    console.error(`Autosave backup failed: ${errorMessage(error)}`);
  });
}

function clearBackupFile() {
  return queueBackupWrite('');
}

function getBackupContents() {
  return fs.readFileSync(curBackupFilePath, { encoding: 'utf8' });
}

export function handleLoadBackup(event: IpcMainEvent) {
  try {
    event.reply(IpcBidirectional.LoadBackup, getBackupContents());
  } catch (error: unknown) {
    // A missing or unreadable transient backup must never block application startup.
    // eslint-disable-next-line no-console
    console.error(`Recovery backup could not be read: ${errorMessage(error)}`);
    event.reply(IpcBidirectional.LoadBackup, '');
  }
}

/** Tell renderer to export QBJ to the given path */
export function exportQbjFile(mainWindow: BrowserWindow) {
  const filePath = dialog.showSaveDialogSync(mainWindow, {
    title: 'Export as QBJ',
    filters: [{ name: 'Quiz Bowl Tournament Schema', extensions: ['qbj'] }],
    defaultPath: getCurYftFilePath() !== '' ? stripYftExtension(getCurYftFilePath()) : undefined,
  });
  if (!filePath) return;

  mainWindow.webContents.send(IpcBidirectional.ExportQbjFile, filePath);
}

/** Save file contents provided by the renderer */
export function handleExportQbjFile(event: IpcMainEvent, filePath: string, fileContents: string) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;

  fs.writeFile(filePath, fileContents, { encoding: 'utf8' }, (err) => {
    if (err) dialog.showMessageBoxSync(window, { title: 'YellowFruit', message: `Error saving file:\n\n${err}` });
    else window.webContents.send(IpcMainToRend.MakeToast, 'Exported QBJ file');
  });
}

/** Tell renderer to export SQBS file(s) to the given path */
export function launchSqbsExportWorkflow(mainWindow: BrowserWindow) {
  mainWindow.webContents.send(IpcBidirectional.SqbsExport);
}

export function handleExportSqbsFile(event: IpcMainEvent, files: SqbsExportFile[]) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;

  const filePathStart = dialog.showSaveDialogSync(window, {
    title: 'Export as SQBS',
    filters: [{ name: 'SQBS Tournament', extensions: ['sqbs'] }],
  });
  if (!filePathStart) return;

  writeSqbsFile(files, 0, window, filePathStart);
}

function writeSqbsFile(files: SqbsExportFile[], idx: number, window: BrowserWindow, filePathStart: string) {
  const file = files[idx];
  if (!file) return;

  const filePath = file.fileSuffix ? `${filePathStart.replace('.sqbs', '')}_${file.fileSuffix}.sqbs` : filePathStart;

  fs.writeFile(filePath, file.contents, { encoding: 'utf-8' }, (err) => {
    if (err) {
      dialog.showMessageBoxSync(window, { message: `Error generating file ${filePath}:\n\n${err.message}` });
      return;
    }
    if (idx < files.length - 1) {
      writeSqbsFile(files, idx + 1, window, filePathStart);
    } else {
      const toastMsg = files.length > 1 ? 'SQBS files exported' : 'SQBS file exported';
      window.webContents.send(IpcMainToRend.MakeToast, toastMsg);
    }
  });
}

export function importGamesFromQbjMainLaunch(window: BrowserWindow) {
  const fileAry = promptForQbjGamesToImport(window);
  window.webContents.send(IpcMainToRend.ImportQbjGamesMainLaunch, fileAry);
}

export async function importGamesFromQbjRendererLaunch(event: IpcMainInvokeEvent) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return [];

  return promptForQbjGamesToImport(window);
}

function promptForQbjGamesToImport(window: BrowserWindow) {
  const fileNameAry = dialog.showOpenDialogSync(window, {
    title: 'Import Games',
    filters: [{ name: 'Tournament Schema ', extensions: ['qbj', 'json'] }],
    properties: ['multiSelections', 'openFile'],
  });
  if (!fileNameAry) return [];

  const fileAry: IMatchImportFileRequest[] = [];
  for (const filePath of fileNameAry) {
    const fileContents = fs.readFileSync(filePath, { encoding: 'utf8' });
    fileAry.push({ filePath, fileContents });
  }
  return fileAry;
}

export function handlelaunchStatReportInBrowserWindow() {
  shell.openExternal(path.resolve(inAppStatReportDirectory, 'standings.html'));
}

export function handleLaunchExternalWebPage(event: IpcMainEvent, url: string) {
  shell.openExternal(url);
}

export function launchHelpWindow(mainWindow: BrowserWindow) {
  mainWindow.webContents.send(IpcMainToRend.LaunchAboutYf);
}
