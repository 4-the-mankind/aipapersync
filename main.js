'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, globalShortcut } = require('electron');
const path = require('path');

const { loadConfig, saveConfig }                        = require('./main/config');
const { loadHistory, saveHistory, appendHistory }       = require('./main/history');
const { getLastSync, setLastSync }                      = require('./main/syncstate');
const { setStartup, reconcileStartup, effectiveStartWithWindows } = require('./main/startup');
const log                                               = require('./main/logger');

const ICON_PATH = path.join(__dirname, 'assets', 'icon.ico');

let tray = null;
let win = null;
let currentEngine = null;
let syncRunning = false;
let isQuitting = false;

// Keeps the last 200 log lines so a reopened window can restore them.
const LOG_BUFFER_MAX = 200;
const logBuffer = [];

// ── BrowserWindow ────────────────────────────────────────────────────────────

function createWindow() {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return;
  }

  win = new BrowserWindow({
    width: 820,
    height: 652,
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

  // Push the current sync state once the renderer is fully ready
  win.webContents.on('did-finish-load', () => {
    sendToRenderer('sync:state', { running: syncRunning });
  });

  // Intercept ALL close attempts (custom button, taskbar right-click, Alt+F4…).
  // 'quit' → quit the app. 'tray' → let the window close and be destroyed (frees
  // Chromium RAM); window-all-closed keeps the process alive in the tray, and a
  // tray double-click rebuilds a fresh window.
  win.on('close', (e) => {
    if (isQuitting) return;
    if (loadConfig().closeBehavior === 'quit') {
      app.quit(); // triggers before-quit → isQuitting = true
    }
    // tray mode: do nothing → window closes/destroys normally
  });

  win.on('closed', () => {
    win = null;
  });
}

function sendToRenderer(channel, payload) {
  if (channel === 'sync:log') {
    logBuffer.push(payload);
    if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
  }
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

// ── Sync ─────────────────────────────────────────────────────────────────────

async function runSync() {
  if (syncRunning) return { error: 'Sync already running' };

  const cfg = loadConfig();
  const SyncEngine = require('./sync/syncEngine');

  // Don't enter running state if the tablet is offline — keeps the UI in idle
  const checkEng = new SyncEngine({ tabletUrl: cfg.tabletUrl, outputDir: cfg.outputDir });
  const online = await checkEng.checkConnectivity().catch(() => false);
  if (!online) {
    log.info('Sync skipped — tablet unreachable');
    sendToRenderer('sync:log', 'Tablet unreachable — sync skipped');
    return { error: 'Tablet unreachable' };
  }

  syncRunning = true;
  refreshTrayMenu();
  log.info('Sync started');
  sendToRenderer('sync:started');

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
    const errCount = (result.errors || []).length;
    const parts = [];
    if ((result.created     || 0) > 0) parts.push(`${result.created} created`);
    if ((result.overwritten || 0) > 0) parts.push(`${result.overwritten} overwritten`);
    if (errCount > 0)                   parts.push(`${errCount} error(s)`);
    const resultMsg = parts.length ? parts.join(', ') : 'No changes';
    setLastSync(new Date().toISOString(), resultMsg);
    log.info(`Sync complete — ${result.created ?? 0} created, ${result.overwritten ?? 0} overwritten, ${errCount} errors`);
    sendToRenderer('sync:complete', result);
    return result;
  } catch (err) {
    log.error(err);
    sendToRenderer('sync:error', { error: err.message });
    return { error: err.message };
  } finally {
    syncRunning = false;
    currentEngine = null;
    refreshTrayMenu();
  }
}

// ── IPC handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('config:get', () => {
  const cfg = loadConfig();
  // Reflect live registry state so Task Manager changes show up in the toggle.
  cfg.startWithWindows = effectiveStartWithWindows(cfg);
  return cfg;
});

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

ipcMain.handle('appstate:get', () => getLastSync());
ipcMain.handle('app:version', () => app.getVersion());

ipcMain.handle('sync:now',    () => runSync());
ipcMain.handle('sync:status', () => syncRunning);

ipcMain.handle('log:getBuffer', () => [...logBuffer]);

ipcMain.handle('sync:abort', () => {
  if (currentEngine) currentEngine.abort();
  return true;
});

ipcMain.handle('sync:pause', () => {
  if (currentEngine) currentEngine.pause();
  return true;
});

ipcMain.handle('sync:resume', () => {
  if (currentEngine) currentEngine.resume();
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
ipcMain.on('window:close',    () => { if (win) win.close(); }); // handled by win.on('close')

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
    syncRunning
      ? { label: 'Pause Sync', click: () => { if (currentEngine) currentEngine.pause(); } }
      : { label: 'Sync Now',   click: () => runSync() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

function refreshTrayMenu() {
  if (tray) tray.setContextMenu(buildTrayMenu());
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

  // Reconcile the "start with Windows" setting with the actual registry state
  // (covers Task Manager enable/disable and first-run registration).
  if (reconcileStartup(cfg)) saveConfig(cfg);

  if (cfg.syncOnStartup) {
    runSync();
  }
});

app.on('second-instance', () => {
  createWindow();
});

app.on('window-all-closed', (e) => {
  if (!isQuitting) e.preventDefault(); // stay in tray unless quit was requested
});

app.on('before-quit', () => {
  isQuitting = true;
  if (currentEngine) currentEngine.abort();
  log.info('App quitting');
});
