'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, globalShortcut } = require('electron');
const path = require('path');
const { execSync } = require('child_process');

const { loadConfig, saveConfig }                  = require('./main/config');
const { loadHistory, saveHistory, appendHistory } = require('./main/history');
const log                                         = require('./main/logger');

const ICON_PATH    = path.join(__dirname, 'assets', 'icon.png');
const STARTUP_KEY  = 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run';
const STARTUP_NAME = 'AIPaperSync';

let tray = null;
let win = null;
let currentEngine = null;
let syncRunning = false;

// ── Windows startup registry ─────────────────────────────────────────────────

function getStartupValue() {
  const exePath = process.execPath;
  const appPath = path.join(__dirname, 'main.js');
  return `"${exePath}" "${appPath}"`;
}

function setStartup(enabled) {
  const val = getStartupValue();
  try {
    if (enabled) {
      execSync(`reg add "${STARTUP_KEY}" /v "${STARTUP_NAME}" /t REG_SZ /d "${val}" /f`, { windowsHide: true });
    } else {
      execSync(`reg delete "${STARTUP_KEY}" /v "${STARTUP_NAME}" /f`, { windowsHide: true });
    }
    return true;
  } catch (e) {
    log.error(`Registry ${enabled ? 'add' : 'delete'} failed: ${e.message}`);
    return false;
  }
}

// ── BrowserWindow ────────────────────────────────────────────────────────────

function createWindow() {
  if (win && !win.isDestroyed()) {
    win.focus();
    return;
  }

  win = new BrowserWindow({
    width: 820,
    height: 600,
    minWidth: 700,
    minHeight: 500,
    frame: false,
    backgroundColor: '#FAFAF8',
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.on('closed', () => {
    win = null;
  });
}

function sendToRenderer(channel, payload) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

// ── Sync ─────────────────────────────────────────────────────────────────────

async function runSync() {
  if (syncRunning) return { error: 'Sync already running' };
  syncRunning = true;
  log.info('Sync started');

  const cfg = loadConfig();
  const SyncEngine = require('./sync/syncEngine');

  currentEngine = new SyncEngine({
    tabletUrl:   cfg.tabletUrl,
    outputDir:   cfg.outputDir,
    noteFormat:  cfg.noteFormat,
    incremental: cfg.incremental !== false,
    onProgress:  (evt) => sendToRenderer('sync:progress', evt),
    onLog: (msg) => {
      log.info(msg);
      sendToRenderer('sync:log', msg);
    },
  });

  try {
    const result = await currentEngine.run();
    if (result.history && result.history.length > 0) {
      appendHistory(result.history);
    }
    log.info(`Sync complete — ${result.created ?? 0} created, ${result.overwritten ?? 0} overwritten, ${(result.errors || []).length} errors`);
    sendToRenderer('sync:complete', result);
    return result;
  } catch (err) {
    log.error(err);
    sendToRenderer('sync:error', { error: err.message });
    return { error: err.message };
  } finally {
    syncRunning = false;
    currentEngine = null;
  }
}

// ── IPC handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('config:get', () => loadConfig());

ipcMain.handle('config:save', (_e, cfg) => {
  saveConfig(cfg);
  if (typeof cfg.startWithWindows === 'boolean') {
    setStartup(cfg.startWithWindows);
  }
  return true;
});

ipcMain.handle('history:get', () => loadHistory());

ipcMain.handle('history:clear', () => {
  saveHistory([]);
  return true;
});

ipcMain.handle('sync:now', () => runSync());

ipcMain.handle('sync:abort', () => {
  if (currentEngine) currentEngine.abort();
  return true;
});

ipcMain.handle('tablet:ping', async () => {
  const cfg = loadConfig();
  const SyncEngine = require('./sync/syncEngine');
  const eng = new SyncEngine({ tabletUrl: cfg.tabletUrl, outputDir: cfg.outputDir });
  return eng.checkConnectivity();
});

ipcMain.handle('startup:set', (_e, enabled) => setStartup(enabled));

// Window control IPC (frameless window)
ipcMain.on('window:minimize', () => { if (win) win.minimize(); });
ipcMain.on('window:close', () => { if (win) win.close(); });

// DevTools — only available when running from source, never in a packaged build
if (!app.isPackaged) {
  ipcMain.on('devtools:toggle', () => {
    if (!win || win.isDestroyed()) return;
    win.webContents.isDevToolsOpened()
      ? win.webContents.closeDevTools()
      : win.webContents.openDevTools({ mode: 'detach' });
  });

  app.whenReady().then(() => {
    globalShortcut.register('F12', () => {
      if (!win || win.isDestroyed()) return;
      win.webContents.isDevToolsOpened()
        ? win.webContents.closeDevTools()
        : win.webContents.openDevTools({ mode: 'detach' });
    });
  });

  app.on('will-quit', () => globalShortcut.unregisterAll());
}

// ── Tray ─────────────────────────────────────────────────────────────────────

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Open AIPaper Sync', click: () => createWindow() },
    { label: 'Sync Now', click: () => runSync() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

function createTray() {
  const icon = nativeImage.createFromPath(ICON_PATH);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('AIPaper Sync');
  tray.setContextMenu(buildTrayMenu());
  tray.on('double-click', () => createWindow());
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // Prevent second instances
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  log.info(`App started (electron ${process.versions.electron}, node ${process.versions.node})`);
  createTray();

  const cfg = loadConfig();

  // Apply startup registry on first run
  if (cfg.startWithWindows) {
    setStartup(true);
  }

  if (cfg.syncOnStartup) {
    runSync();
  }
});

app.on('second-instance', () => {
  createWindow();
});

app.on('window-all-closed', (e) => {
  // Stay in tray — do not quit
  e.preventDefault();
});

app.on('before-quit', () => {
  if (currentEngine) currentEngine.abort();
  log.info('App quitting');
});
