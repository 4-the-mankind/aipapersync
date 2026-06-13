'use strict';

// ── Settings tab ──────────────────────────────────────────────────────────────
// Owns: reading config from the main process, populating form fields,
//       and persisting changes (including the Windows startup registry key).

/**
 * Reads the persisted config from the main process and populates all Settings
 * form fields. Called each time the Settings tab is activated so it always
 * reflects the latest saved state.
 *
 * @returns {Promise<void>}
 */
async function loadSettings() {
  const cfg = await window.api.getConfig();
  $('cfg-tablet-url').value        = cfg.tabletUrl       || '';
  $('cfg-output-dir').value        = cfg.outputDir       || '';
  $('cfg-note-format').value       = cfg.noteFormat      || 'pdf';
  $('cfg-sync-on-startup').checked = !!cfg.syncOnStartup;
  $('cfg-start-with-windows').checked = !!cfg.startWithWindows;
}

/**
 * Reads the current form values, sends them to the main process to persist,
 * and briefly shows the "Saved" confirmation feedback label.
 *
 * The main process is responsible for writing the Windows registry Run key
 * when `startWithWindows` changes.
 *
 * @returns {Promise<void>}
 */
async function saveSettings() {
  const cfg = {
    tabletUrl:        $('cfg-tablet-url').value.trim(),
    outputDir:        $('cfg-output-dir').value.trim(),
    noteFormat:       $('cfg-note-format').value,
    syncOnStartup:    $('cfg-sync-on-startup').checked,
    startWithWindows: $('cfg-start-with-windows').checked,
  };

  await window.api.saveConfig(cfg);
  showSaveFeedback();
}

/**
 * Momentarily makes the "Saved ✓" feedback label visible, then fades it out
 * after 2 seconds.
 */
function showSaveFeedback() {
  const fb = $('save-feedback');
  fb.classList.add('visible');
  setTimeout(() => fb.classList.remove('visible'), 2000);
}

// ── Init ──────────────────────────────────────────────────────────────────────

/**
 * Wires up Settings-tab event listeners. Called once by `renderer.js`.
 * `loadSettings` is also exported so the tab-switching logic can call it
 * whenever the Settings tab becomes active.
 */
function initSettings() {
  $('btn-save-settings').addEventListener('click', saveSettings);
}
