/* eslint global-require: off, no-console: off, promise/always-return: off */

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `npm run build` or `npm run build:main`, this file is compiled to
 * `./src/main.js` using webpack. This gives us some performance wins.
 */
import path from 'path';
import { app, BrowserWindow, shell, ipcMain, protocol, net, dialog, nativeTheme } from 'electron';
import { pathToFileURL } from 'url';
import { IpcMainEvent } from 'electron/main';
import MenuBuilder from './menu';
import { resolveHtmlPath } from './util';
import {
  handleSaveFile,
  handleWriteStatReports,
  handleSetWindowTitle,
  inAppStatReportDirectory,
  parseStatReportPath,
  handleRequestToSaveHtmlReports,
  handleContinueAction,
  tryFileSwitchAction,
  appAllowedToQuit,
  handleSaveBackup,
  generateBackup,
  handleLoadBackup,
  exportQbjFile,
  handleExportQbjFile,
  createDirectories,
  importGamesFromQbjRendererLaunch,
  readYftFileAndSendToRend,
  handleLaunchImportQbjTeamsFromRenderer,
  handleLaunchImportSqbsTeamsFromRenderer,
  handleExportSqbsFile,
  handleSetYftFilePath,
  handlelaunchStatReportInBrowserWindow,
  handleLaunchExternalWebPage,
  restoreSecondaryBackupFolder,
  getSecondaryBackupHealth,
  chooseSecondaryBackupFolder,
  clearSecondaryBackupFolder,
  retrySecondaryBackup,
  handleExportQbsheetGamePackages,
} from './FileUtils';
import { IpcBidirectional, IpcRendToMain } from '../IPCChannels';
import { FileSwitchActions, statReportProtocol } from '../SharedUtils';
import checkForNewVersions from './UpdateChecker';
import registerTournamentServerIpc, { isTournamentServerRunning, shutDownTournamentServer } from './server/ServerIpc';

protocol.registerSchemesAsPrivileged([
  {
    scheme: statReportProtocol,
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

let mainWindow: BrowserWindow | null = null;

// Kept in sync with the renderer theme's header surface (see src/renderer/Theme/yfTheme.ts) so the
// window chrome doesn't flash a different color while the page loads.
const headerSurfaceLight = '#ffffff';
const headerSurfaceDark = '#171b1f';

ipcMain.on(IpcBidirectional.ipcExample, async (event, arg) => {
  const msgTemplate = (pingPong: string) => `IPC test: ${pingPong}`;
  console.log(msgTemplate(arg));
  event.reply(IpcBidirectional.ipcExample, msgTemplate('pong'));
});

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

const isDebug = process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

if (isDebug) {
  require('electron-debug')();
}

const installExtensions = async () => {
  const installer = require('electron-devtools-installer');
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = ['REACT_DEVELOPER_TOOLS'];

  return installer
    .default(
      extensions.map((name) => installer[name]),
      forceDownload,
    )
    .catch(console.log);
};

const autoSaveIntervalMS = 120000; // 2 minutes

const createWindow = async () => {
  if (isDebug) {
    await installExtensions();
  }

  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets');

  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
  };

  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    show: false,
    width: 1200,
    height: 728,
    minWidth: 900,
    minHeight: 600,
    icon: getAssetPath('icon.png'),
    // Match the app header's neutral surface so there's no colored flash before the renderer paints.
    backgroundColor: nativeTheme.shouldUseDarkColors ? headerSurfaceDark : headerSurfaceLight,
    ...(isMac ? { titleBarStyle: 'hiddenInset' as const } : {}),
    webPreferences: {
      preload: app.isPackaged ? path.join(__dirname, 'preload.js') : path.join(__dirname, '../../.erb/dll/preload.js'),
    },
  });

  mainWindow.loadURL(resolveHtmlPath('index.html'));

  const syncWindowBackground = () => {
    mainWindow?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? headerSurfaceDark : headerSurfaceLight);
  };
  nativeTheme.on('updated', syncWindowBackground);
  mainWindow.on('closed', () => nativeTheme.off('updated', syncWindowBackground));

  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
    }

    const argsLength = process.defaultApp ? 3 : 2;
    if (process.env.NODE_ENV === 'production' && process.argv.length >= argsLength) {
      readYftFileAndSendToRend(mainWindow, process.argv[argsLength - 1]);
    }
  });

  mainWindow.on('close', (e) => {
    if (!mainWindow) return; // just making typescript happy
    if (appAllowedToQuit()) return;

    e.preventDefault();

    if (isTournamentServerRunning()) {
      const response = dialog.showMessageBoxSync(mainWindow, {
        type: 'warning',
        title: 'Tournament server is running',
        message: 'Quit YellowFruit and stop the tournament server?',
        detail: 'Room scorekeepers will be disconnected, and any active games may be interrupted.',
        buttons: ['Cancel', 'Quit and stop server'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (response !== 1) return;
    }

    tryFileSwitchAction(mainWindow, FileSwitchActions.CloseApp);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(mainWindow);
  menuBuilder.buildMenu();

  // Open urls in the user's browser
  mainWindow.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url);
    return { action: 'deny' };
  });
};

/**
 * Add event listeners...
 */

app.on('window-all-closed', () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Release the tournament server's port rather than leaving it bound after the app closes. Electron
// does not await async event handlers, so hold the quit event until the bounded server shutdown has
// completed (or the process-level deadline is reached) and never leave an unhandled rejection.
let shutdownInProgress = false;
async function finishQuitAfterServerShutdown(event: { preventDefault: () => void }) {
  if (shutdownInProgress) return;
  shutdownInProgress = true;
  event.preventDefault();
  const deadline = new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 3500);
    timeout.unref?.();
  });
  await Promise.race([shutDownTournamentServer(), deadline]).catch(() => undefined);
  app.quit();
}

app.on('will-quit', (event) => {
  finishQuitAfterServerShutdown(event).catch(() => app.quit());
});

app
  .whenReady()
  .then(() => {
    createDirectories();
    restoreSecondaryBackupFolder();
    createWindow();
    ipcMain.on(IpcRendToMain.setYftFilePath, handleSetYftFilePath);
    ipcMain.on(IpcRendToMain.saveFile, handleSaveFile);
    ipcMain.on(IpcRendToMain.setWindowTitle, handleSetWindowTitle);
    ipcMain.on(IpcRendToMain.StatReportSaveDialog, handleRequestToSaveHtmlReports);
    ipcMain.on(IpcRendToMain.WriteStatReports, handleWriteStatReports);
    ipcMain.on(IpcRendToMain.ContinueWithAction, handleContinueAction);
    ipcMain.on(IpcRendToMain.SaveBackup, handleSaveBackup);
    ipcMain.on(IpcRendToMain.WebPageCrashed, handleRendererCrashed);
    ipcMain.on(IpcRendToMain.LaunchImportQbjTeamWorkflow, handleLaunchImportQbjTeamsFromRenderer);
    ipcMain.on(IpcRendToMain.LaunchImportSqbsTeamWorkflow, handleLaunchImportSqbsTeamsFromRenderer);
    ipcMain.on(IpcRendToMain.LaunchQbjExportWorkflow, (event) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (window) exportQbjFile(window);
    });
    ipcMain.on(IpcBidirectional.ExportQbjFile, handleExportQbjFile);
    ipcMain.on(IpcBidirectional.SqbsExport, handleExportSqbsFile);
    ipcMain.on(IpcRendToMain.LaunchStatReportInBrowser, handlelaunchStatReportInBrowserWindow);
    ipcMain.on(IpcRendToMain.LaunchExternalWebPage, handleLaunchExternalWebPage);
    ipcMain.on(IpcBidirectional.CheckForNewVersion, checkForNewVersions);
    ipcMain.handle(IpcBidirectional.ImportQbjGamesRendererLaunch, importGamesFromQbjRendererLaunch);
    ipcMain.once(IpcBidirectional.LoadBackup, handleLoadBackup);
    ipcMain.once(IpcRendToMain.StartAutosave, () => {
      setInterval(() => generateBackup(mainWindow), autoSaveIntervalMS);
    });
    ipcMain.on(IpcBidirectional.GetAppVersion, (event) =>
      event.reply(IpcBidirectional.GetAppVersion, app.getVersion()),
    );
    ipcMain.handle(IpcBidirectional.GetSecondaryBackupHealth, () => getSecondaryBackupHealth());
    ipcMain.handle(IpcBidirectional.ChooseSecondaryBackupFolder, async (event) =>
      chooseSecondaryBackupFolder(BrowserWindow.fromWebContents(event.sender)),
    );
    ipcMain.handle(IpcBidirectional.ClearSecondaryBackupFolder, async () => clearSecondaryBackupFolder());
    ipcMain.handle(IpcBidirectional.RetrySecondaryBackup, async () => retrySecondaryBackup());
    ipcMain.handle(IpcBidirectional.ExportQbsheetGamePackages, handleExportQbsheetGamePackages);
    // Registers handlers only. The tournament server binds a port only when the user starts it.
    registerTournamentServerIpc(() => mainWindow);

    protocol.handle(statReportProtocol, (request) => {
      const url = pathToFileURL(path.resolve(inAppStatReportDirectory, parseStatReportPath(request.url)));
      return net.fetch(url.href);
    });

    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (mainWindow === null) createWindow();
    });
  })
  .catch(console.log);

function handleRendererCrashed(event: IpcMainEvent) {
  if (isDebug) return;

  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;

  dialog.showMessageBoxSync(window, {
    title: 'YellowFruit',
    message: 'YellowFruit has encountered an unexpected error. Click OK to relaunch the application.',
    buttons: ['OK'],
  });

  forceRelaunch();
}

function forceRelaunch() {
  app.relaunch();
  app.exit();
}
