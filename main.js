'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const CONFIG_PATH = path.join(__dirname, 'data', 'config.json');
const HISTORY_PATH = path.join(__dirname, 'data', 'history.json');
const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
const STARTUP_KEY = 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run';
const STARTUP_NAME = 'AIPaperSync';

let tray = null;
let win = null;
let currentEngine = null;
let syncRunning = false;

// ── Config ───────────────────────────────────────────────────────────────────

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {
      tabletUrl: 'http://192.168.0.69:8090',
      outputDir: '%USERPROFILE%\\Downloads',
      noteFormat: 'pdf',
      startWithWindows: true,
      syncOnStartup: true,
    };
  }
}

function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

// ── History ──────────────────────────────────────────────────────────────────

function loadHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function saveHistory(history) {
  fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), 'utf8');
}

function appendHistory(entries) {
  const history = loadHistory();
  history.unshift(...entries);
  saveHistory(history.slice(0, 5000));
}

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
    console.error('Registry error:', e.message);
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

  const cfg = loadConfig();
  const SyncEngine = require('./sync/syncEngine');

  currentEngine = new SyncEngine({
    tabletUrl: cfg.tabletUrl,
    outputDir: cfg.outputDir,
    noteFormat: cfg.noteFormat,
    onProgress: (evt) => sendToRenderer('sync:progress', evt),
    onLog: (msg) => sendToRenderer('sync:log', msg),
  });

  try {
    const result = await currentEngine.run();
    if (result.history && result.history.length > 0) {
      appendHistory(result.history);
    }
    sendToRenderer('sync:complete', result);
    return result;
  } catch (err) {
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
});
