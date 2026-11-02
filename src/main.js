'use strict';

const { app, BrowserWindow, ipcMain, session, shell, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

const UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000; // re-check every 4 hours
let win = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#14161a',
    title: 'Guitar Visualizer',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// ---------- Microphone / audio-interface permission ----------
function setupPermissions() {
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');
  session.defaultSession.setPermissionRequestHandler(async (_wc, permission, callback) => {
    if (permission !== 'media') return callback(false);
    if (process.platform === 'darwin') {
      try {
        return callback(await systemPreferences.askForMediaAccess('microphone'));
      } catch {
        return callback(false);
      }
    }
    callback(true);
  });
}

// ---------- Auto-update (GitHub Releases) ----------
// Only *published* releases are seen by users. Drafts and pre-releases are ignored,
// so nothing reaches users until you click "Publish release" on GitHub.

function releasesPageUrl() {
  try {
    const yml = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8');
    const owner = /owner:\s*(\S+)/.exec(yml)?.[1];
    const repo = /repo:\s*(\S+)/.exec(yml)?.[1];
    if (owner && repo) return `https://github.com/${owner}/${repo}/releases/latest`;
  } catch {
    /* fall through */
  }
  return null;
}

// macOS can only self-install signed apps, so on Mac we point the user at the download page.
const MANUAL_UPDATE = process.platform === 'darwin';

function checkForUpdates() {
  if (!app.isPackaged) {
    send('update:status', { state: 'dev' });
    return;
  }
  autoUpdater.checkForUpdates().catch((err) => send('update:status', { state: 'error', message: err.message }));
}

function setupUpdater() {
  autoUpdater.autoDownload = false; // ask the user first
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => send('update:status', { state: 'checking' }));
  autoUpdater.on('update-not-available', () => send('update:status', { state: 'none' }));
  autoUpdater.on('update-available', (info) =>
    send('update:status', { state: 'available', version: info.version, manual: MANUAL_UPDATE })
  );
  autoUpdater.on('download-progress', (p) => send('update:status', { state: 'downloading', percent: p.percent }));
  autoUpdater.on('update-downloaded', (info) => send('update:status', { state: 'ready', version: info.version }));
  autoUpdater.on('error', (err) => send('update:status', { state: 'error', message: err?.message || String(err) }));

  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('update:check', () => checkForUpdates());
  ipcMain.handle('update:download', async () => {
    if (MANUAL_UPDATE) {
      const url = releasesPageUrl();
      if (url) await shell.openExternal(url);
      return;
    }
    send('update:status', { state: 'downloading', percent: 0 });
    await autoUpdater.downloadUpdate().catch((err) => send('update:status', { state: 'error', message: err.message }));
  });
  ipcMain.handle('update:install', () => autoUpdater.quitAndInstall());

  setTimeout(checkForUpdates, 3000);
  setInterval(checkForUpdates, UPDATE_INTERVAL_MS);
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  setupPermissions();
  setupUpdater();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
