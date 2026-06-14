'use strict';

// ── Status tab ────────────────────────────────────────────────────────────────
// Owns: connectivity indicator, Sync Now / Abort buttons,
//       per-folder progress bars, and the live log box.

/** @type {boolean} Whether a sync is currently in progress. */
let syncActive = false;

// ── Log ───────────────────────────────────────────────────────────────────────

/**
 * Appends a timestamped line to the log box and auto-scrolls to the bottom.
 *
 * @param {string} msg - Plain-text message to display.
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
 * Called once on page load and then on a 30-second interval.
 *
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
 * Returns the progress row element for `folder`, creating it lazily if it
 * does not already exist in the DOM.
 *
 * @param {string} folder - Display name of the tablet folder (e.g. "Paper").
 * @returns {HTMLElement} The `.folder-row` div for this folder.
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
 * Updates the fill width and text label of the packaging progress bar.
 * When `total` is 0 the bar stays at 0 % and is labelled "Empty".
 *
 * @param {string} folder   - Folder display name.
 * @param {number} packaged - Number of files packaged so far.
 * @param {number} total    - Total number of files to package.
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

/**
 * Removes all per-folder progress bar rows from the DOM.
 * Called before starting a new sync run so stale bars don't linger.
 */
function clearFolderBars() {
  $('folder-bars').innerHTML = '';
}

// ── Sync state ────────────────────────────────────────────────────────────────

/**
 * Toggles the UI between "idle" and "syncing" states:
 * - Swaps the Sync Now / Abort button visibility.
 * - Shows or hides the progress section.
 *
 * @param {boolean} active - `true` while a sync is running.
 */
function setSyncActive(active) {
  syncActive = active;
  $('btn-sync-now').style.display  = active ? 'none' : '';
  $('btn-abort').style.display     = active ? '' : 'none';
  $('progress-section').classList.toggle('visible', active);
}

// ── IPC event handlers ────────────────────────────────────────────────────────

/**
 * Handles granular progress events emitted by syncEngine:
 * - `packaging`      → fill bar by packaged/total count.
 * - `download-start` → reset bar to 0 % before bytes arrive.
 * - `download`       → fill bar by bytes received/total.
 * - `folder-done`    → fill bar to 100 %.
 * - `folder-error`   → mark bar label as failed.
 *
 * @param {{ type: string, folder: string, packaged?: number, total?: number,
 *           received?: number, created?: number, overwritten?: number,
 *           skipped?: number, error?: string }} evt
 */
function onSyncProgress(evt) {
  if (evt.type === 'folder-start') {
    ensureFolderBar(evt.folder);
  }
  if (evt.type === 'folder-skipped') {
    ensureFolderBar(evt.folder);
    const fill  = $(`bar-fill-${evt.folder}`);
    const label = $(`bar-label-${evt.folder}`);
    if (fill)  fill.style.width  = '100%';
    if (label) { label.textContent = 'No changes'; label.style.color = 'var(--text-muted)'; }
  }
  if (evt.type === 'packaging') {
    updateFolderBar(evt.folder, evt.packaged, evt.total, 'pkg');
  }
  if (evt.type === 'download-start') {
    // Reset bar to 0 so it visually shows download progress from scratch
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
    if (fill)  fill.style.width   = '100%';
    if (label) {
      const parts = [];
      if (evt.created)    parts.push(`${evt.created} new`);
      if (evt.overwritten) parts.push(`${evt.overwritten} updated`);
      if (evt.skipped)    parts.push(`${evt.skipped} unchanged`);
      label.textContent = parts.length ? parts.join(', ') : 'Done';
    }
  }
  if (evt.type === 'folder-error') {
    const label = $(`bar-label-${evt.folder}`);
    if (label) { label.textContent = 'Error'; label.style.color = 'var(--error)'; }
  }
}

/**
 * Handles the `sync:complete` event from the main process.
 * Updates the "Last sync" metadata row, resets the UI to idle state,
 * and re-checks tablet connectivity.
 *
 * @param {{ total: number, created: number, overwritten: number,
 *           errors: Array<{folder:string,error:string}>, error?: string }} result
 */
function onSyncComplete(result) {
  setSyncActive(false);
  $('last-sync-time').textContent = new Date().toLocaleString();

  if (result.error) {
    $('last-sync-result').textContent = `Error: ${result.error}`;
    $('last-sync-result').style.color  = 'var(--error)';
    appendLog(`Sync failed: ${result.error}`);
  } else {
    const errCount = (result.errors || []).length;
    const msg = errCount > 0
      ? `${result.total} files, ${errCount} error(s)`
      : `${result.total} files synced`;
    $('last-sync-result').textContent = msg;
    $('last-sync-result').style.color  = errCount > 0 ? 'var(--warn)' : 'var(--success)';
    appendLog(`Sync complete — ${result.created} created, ${result.overwritten} overwritten${errCount ? `, ${errCount} errors` : ''}`);
  }

  checkConnectivity();
}

/**
 * Handles a fatal `sync:error` event (thrown before the engine could finish).
 *
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
 * Wires up all Status-tab event listeners and kicks off the first connectivity
 * check. Called once by `renderer.js` after the DOM is ready.
 *
 * @param {function(string): void} onTabSwitch - Callback invoked with a tab name
 *   when the renderer switches away from Status (used to refresh other panels).
 */
function initStatus(onTabSwitch) {
  // Sync Now button
  $('btn-sync-now').addEventListener('click', async () => {
    if (syncActive) return;
    clearFolderBars();
    setSyncActive(true);
    appendLog('Starting sync...');
    await window.api.syncNow();
  });

  // Abort button
  $('btn-abort').addEventListener('click', () => {
    window.api.abortSync();
    appendLog('Aborting sync...');
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

  // IPC events
  window.api.on('sync:log',      (msg)  => appendLog(msg));
  window.api.on('sync:progress', (evt)  => onSyncProgress(evt));
  window.api.on('sync:complete', (res)  => onSyncComplete(res));
  window.api.on('sync:error',    (data) => onSyncError(data));

  // Connectivity polling
  checkConnectivity();
  setInterval(checkConnectivity, 30000);
}
