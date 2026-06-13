'use strict';

// ── Entry point ───────────────────────────────────────────────────────────────
// Bootstraps the three tab panels and wires up shared UI (tab bar, window
// controls, initial data load). Each panel's logic lives in its own file:
//   status.js   — Status tab (connectivity, sync progress, log)
//   history.js  — History tab (sync record table)
//   settings.js — Settings tab (config form, startup toggle)

// ── Tab switching ─────────────────────────────────────────────────────────────

/**
 * Activates the tab whose `data-tab` attribute matches `name`, swapping the
 * active class on both the button and the corresponding panel. Triggers a
 * data-refresh callback for tabs that need to reload from the main process.
 *
 * @param {string} name - Tab identifier: "status" | "history" | "settings".
 */
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${name}`));

  if (name === 'history')  loadHistory();
  if (name === 'settings') loadSettings();
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// ── Window controls (frameless window) ───────────────────────────────────────

/**
 * Sends a window-control command to the main process via the IPC bridge.
 * Supported actions: "minimize" | "close".
 *
 * @param {'minimize'|'close'} action
 */
function windowControl(action) {
  window.api.windowControl(action);
}

$('btn-minimize').addEventListener('click', () => windowControl('minimize'));
$('btn-close').addEventListener('click',    () => windowControl('close'));

// ── Bootstrap ─────────────────────────────────────────────────────────────────

/**
 * Initialises all three panels and populates the Status tab's "Last sync"
 * metadata from the most recent history record. Runs once on DOMContentLoaded.
 *
 * @returns {Promise<void>}
 */
async function init() {
  initStatus();
  initHistory();
  initSettings();

  // Populate last-sync meta from persisted history so it survives app restarts.
  const history = await window.api.getHistory();
  if (history && history.length > 0) {
    $('last-sync-time').textContent   = formatDate(history[0].date);
    $('last-sync-result').textContent = `${history.length} record${history.length !== 1 ? 's' : ''}`;
  }
}

init();
