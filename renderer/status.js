'use strict';

// ── Status tab ────────────────────────────────────────────────────────────────
// Owns: connectivity indicator, Sync Now / Abort buttons,
//       per-folder progress bars, and the collapsible live log.

/** Hardcoded tablet root folders — users cannot add folders at the root level. */
const FOLDER_LABELS = ['Paper', 'Daily', 'Meeting', 'Learning', 'Picking', 'Memo'];

/** @type {boolean} Whether a sync is currently in progress. */
let syncActive = false;

/** Pending timeout that fades bars to grey after sync completes. */
let _barFadeTimer = null;

// ── Log ───────────────────────────────────────────────────────────────────────

/**
 * Appends a timestamped line to the log box and auto-scrolls to the bottom.
 * Also opens the log panel if it is collapsed.
 * @param {string} msg
 */
function appendLog(msg) {
  const box = $('log-box');
  const line = document.createElement('div');
  line.className = 'log-line';
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

// ── Connectivity ──────────────────────────────────────────────────────────────

/**
 * Pings the tablet and updates the connectivity dot + status label.
 * @returns {Promise<void>}
 */
async function checkConnectivity() {
  const dot    = $('connectivity-dot');
  const status = $('tablet-status');
  try {
    const online = await window.api.checkConnectivity();
    dot.className           = online ? 'online' : 'offline';
    status.textContent      = online ? 'Connected' : 'Unreachable';
    status.style.color      = online ? 'var(--success)' : 'var(--error)';
  } catch {
    dot.className           = 'offline';
    status.textContent      = 'Error';
    status.style.color      = 'var(--error)';
  }
}

// ── Progress bars ─────────────────────────────────────────────────────────────

/**
 * Returns the progress row for `folder`, creating it lazily if needed.
 * @param {string} folder
 * @returns {HTMLElement}
 */
function ensureFolderBar(folder) {
  const container = $('folder-bars');
  let row = document.getElementById(`bar-${folder}`);
  if (!row) {
    row = document.createElement('div');
    row.className = 'folder-row';
    row.id = `bar-${folder}`;
    row.innerHTML = `
      <div class="folder-label">
        <span>${folder}</span>
        <span id="bar-label-${folder}">—</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" id="bar-fill-${folder}"></div>
      </div>`;
    container.appendChild(row);
  }
  return row;
}

/**
 * Resets all folder bars to the idle "waiting" state.
 * Called before a new sync so stale results don't linger.
 */
function resetFolderBars() {
  // Cancel any pending fade-to-grey from the previous sync
  if (_barFadeTimer) { clearTimeout(_barFadeTimer); _barFadeTimer = null; }
  FOLDER_LABELS.forEach(folder => {
    ensureFolderBar(folder);
    const fill  = $(`bar-fill-${folder}`);
    const label = $(`bar-label-${folder}`);
    if (fill)  { fill.style.width = '0%'; fill.style.background = 'var(--accent)'; }
    if (label) { label.textContent = '—'; label.style.color = ''; }
  });
}

/**
 * Updates the packaging progress bar.
 * @param {string} folder
 * @param {number} packaged
 * @param {number} total
 */
function updateFolderBar(folder, packaged, total) {
  ensureFolderBar(folder);
  const fill  = $(`bar-fill-${folder}`);
  const label = $(`bar-label-${folder}`);
  if (total > 0) {
    const pct = Math.min(100, Math.round((packaged / total) * 100));
    fill.style.width  = `${pct}%`;
    label.textContent = `Packaging ${packaged}/${total}`;
  } else {
    fill.style.width  = '0%';
    label.textContent = 'Empty';
  }
}

// ── Sync state ────────────────────────────────────────────────────────────────

/**
 * Toggles the UI between idle and syncing states.
 * @param {boolean} active
 */
/** @type {boolean} */
let syncPaused = false;

function setPauseLabel(paused) {
  $('btn-pause').style.display  = paused ? 'none' : 'flex';
  $('btn-resume').style.display = paused ? 'flex' : 'none';
}

function setSyncActive(active) {
  syncActive = active;
  syncPaused = false;
  $('btn-sync-now').style.display      = active ? 'none' : '';
  $('btn-sync-controls').style.display = active ? 'flex' : 'none';
  setPauseLabel(false);
}

// ── IPC event handlers ────────────────────────────────────────────────────────

/**
 * Handles granular sync progress events from the main process.
 * @param {{ type: string, folder: string, [key: string]: any }} evt
 */
function onSyncProgress(evt) {
  if (evt.type === 'folder-start') {
    ensureFolderBar(evt.folder);
  }
  if (evt.type === 'folder-skipped') {
    ensureFolderBar(evt.folder);
    const fill  = $(`bar-fill-${evt.folder}`);
    const label = $(`bar-label-${evt.folder}`);
    if (fill)  { fill.style.width = '100%'; fill.style.background = 'var(--border)'; }
    if (label) { label.textContent = 'No changes'; label.style.color = 'var(--text-muted)'; }
  }
  if (evt.type === 'packaging') {
    updateFolderBar(evt.folder, evt.packaged, evt.total);
  }
  if (evt.type === 'download-start') {
    const fill  = $(`bar-fill-${evt.folder}`);
    const label = $(`bar-label-${evt.folder}`);
    if (fill)  fill.style.width   = '0%';
    if (label) label.textContent  = 'Downloading…';
  }
  if (evt.type === 'download') {
    const pct   = evt.total > 0 ? Math.round((evt.received / evt.total) * 100) : 0;
    const fill  = $(`bar-fill-${evt.folder}`);
    const label = $(`bar-label-${evt.folder}`);
    if (fill)  fill.style.width   = `${pct}%`;
    if (label) label.textContent  = `Downloading ${pct}%`;
  }
  if (evt.type === 'folder-done') {
    const fill  = $(`bar-fill-${evt.folder}`);
    const label = $(`bar-label-${evt.folder}`);
    if (fill)  fill.style.width = '100%';
    if (label) {
      if (evt.entirelySkipped) {
        label.textContent = 'No changes';
        label.style.color = 'var(--text-muted)';
      } else {
        const parts = [];
        if (evt.created)     parts.push(`${evt.created} new`);
        if (evt.overwritten) parts.push(`${evt.overwritten} updated`);
        if (evt.skipped)     parts.push(`${evt.skipped} unchanged`);
        label.textContent = parts.length ? parts.join(', ') : 'Done';
      }
    }
  }
  if (evt.type === 'folder-error') {
    const fill  = $(`bar-fill-${evt.folder}`);
    const label = $(`bar-label-${evt.folder}`);
    if (fill)  fill.style.background = 'var(--error)';
    if (label) { label.textContent = 'Error'; label.style.color = 'var(--error)'; }
  }
}

/**
 * Handles the `sync:complete` event from the main process.
 * @param {{ total: number, created: number, overwritten: number,
 *           errors: Array<{folder:string,error:string}>, error?: string }} result
 */
function onSyncComplete(result) {
  setSyncActive(false);
  // After a brief delay, fade bars to grey — cancelled if a new sync starts before it fires
  _barFadeTimer = setTimeout(() => {
    _barFadeTimer = null;
    FOLDER_LABELS.forEach(folder => {
      const fill  = $(`bar-fill-${folder}`);
      const label = $(`bar-label-${folder}`);
      if (fill)  fill.style.background = 'var(--border)';
      if (label && label.style.color !== 'var(--error)') label.style.color = 'var(--text-muted)';
    });
  }, 3000);
  const now = new Date().toLocaleString();
  $('last-sync-time').textContent = now;

  if (result.error) {
    $('last-sync-result').textContent = `Error: ${result.error}`;
    $('last-sync-result').style.color  = 'var(--error)';
    appendLog(`Sync failed: ${result.error}`);
  } else {
    const errCount = (result.errors || []).length;
    const parts = [];
    if ((result.created    || 0) > 0) parts.push(`${result.created} created`);
    if ((result.overwritten|| 0) > 0) parts.push(`${result.overwritten} overwritten`);
    if (errCount > 0)                  parts.push(`${errCount} error(s)`);
    const msg = parts.length ? parts.join(', ') : 'No changes';
    $('last-sync-result').textContent = msg;
    $('last-sync-result').style.color  = errCount > 0 ? 'var(--warn)' : 'var(--success)';
    appendLog(`Sync complete — ${result.created ?? 0} created, ${result.overwritten ?? 0} overwritten${errCount ? `, ${errCount} errors` : ''}`);
  }

  checkConnectivity();
}

/**
 * Handles a fatal `sync:error` event.
 * @param {{ error: string }} data
 */
function onSyncError(data) {
  setSyncActive(false);
  appendLog(`Sync error: ${data.error}`);
  $('last-sync-result').textContent = 'Error';
  $('last-sync-result').style.color  = 'var(--error)';
}

// ── Init ──────────────────────────────────────────────────────────────────────

/**
 * Wires up all Status-tab event listeners.
 * Called once by `renderer.js` after the DOM is ready.
 */
async function initStatus() {
  // Pre-render folder bars so they're visible immediately at launch
  resetFolderBars();

  // ── Wire up IPC listeners FIRST so no event is missed during async init ──

  // IPC events — registered before any async work so no event is missed
  window.api.on('sync:log',      (msg)  => appendLog(msg));
  window.api.on('sync:progress', (evt)  => onSyncProgress(evt));
  window.api.on('sync:complete', (res)  => onSyncComplete(res));
  window.api.on('sync:error',    (data) => onSyncError(data));
  // Main confirms sync actually started (after connectivity check passed)
  window.api.on('sync:started', () => { if (!syncActive) { resetFolderBars(); setSyncActive(true); } });
  // Main pushes running state after did-finish-load (for window opened mid-sync)
  window.api.on('sync:state', ({ running }) => {
    if (running && !syncActive) setSyncActive(true);
  });

  // Load persisted last-sync (survives history clears)
  try {
    const appState = await window.api.getAppState();
    if (appState.time) {
      $('last-sync-time').textContent   = new Date(appState.time).toLocaleString();
      $('last-sync-result').textContent = appState.result || '—';
    }
  } catch { /* first run */ }

  // ── Button listeners ─────────────────────────────────────────────────────

  // Sync Now button
  $('btn-sync-now').addEventListener('click', async () => {
    if (syncActive) return;
    appendLog('Starting sync...');
    await window.api.syncNow();
  });

  // Pause button
  $('btn-pause').addEventListener('click', () => {
    syncPaused = true;
    window.api.pauseSync();
    setPauseLabel(true);
    appendLog('Sync paused.');
  });

  // Resume button
  $('btn-resume').addEventListener('click', () => {
    syncPaused = false;
    window.api.resumeSync();
    setPauseLabel(false);
    appendLog('Sync resumed.');
  });

  // Abort button
  $('btn-abort').addEventListener('click', () => {
    window.api.abortSync();
    appendLog('Aborting sync...');
  });

  // Collapsible log panel
  $('log-toggle').addEventListener('click', (e) => {
    // Don't collapse when clicking the icon buttons inside the header
    if (e.target.closest('#log-actions')) return;
    const card = $('log-card');
    card.classList.toggle('open');
    if (card.classList.contains('open')) {
      setTimeout(() => {
        const panel = $('panel-status');
        panel.scrollTop = panel.scrollHeight;
      }, 260);
    }
  });

  // Clear log button
  $('btn-clear-log').addEventListener('click', () => {
    $('log-box').innerHTML = '';
  });

  // Copy log to clipboard
  $('btn-copy-log').addEventListener('click', () => {
    const lines = Array.from($('log-box').querySelectorAll('.log-line'))
      .map(el => el.textContent)
      .join('\n');
    navigator.clipboard.writeText(lines)
      .then(() => showToast('Log copied to clipboard'))
      .catch(() => {});
  });

  // Connectivity polling
  checkConnectivity();
  setInterval(checkConnectivity, 30000);
}
