'use strict';

// ── Settings tab ──────────────────────────────────────────────────────────────
// Owns: reading config from the main process, populating form fields,
// and persisting changes automatically on every input change.

/** @type {ReturnType<typeof setTimeout> | null} Debounce timer for text inputs. */
let saveTimer = null;

/** How long to wait after the last keystroke before auto-saving (ms). */
const SAVE_DEBOUNCE_MS = 600;

// ── Persistence ───────────────────────────────────────────────────────────────

/**
 * Reads the current form values and sends them to the main process to persist.
 * Called immediately for toggle/select changes, and after a debounce delay
 * for text input changes.
 *
 * The main process handles writing the Windows registry Run key when
 * `startWithWindows` changes.
 *
 * @returns {Promise<void>}
 */
async function saveSettings() {
  const cfg = {
    tabletUrl:        $('cfg-tablet-url').value.trim(),
    outputDir:        $('cfg-output-dir').value.trim(),
    noteFormat:       $('cfg-note-format').value,
    syncOnStartup:    $('cfg-sync-on-startup').checked,
    incremental:      $('cfg-incremental').checked,
    startWithWindows: $('cfg-start-with-windows').checked,
  };

  await window.api.saveConfig(cfg);
  showToast('Settings saved');
}

/**
 * Schedules a save after {@link SAVE_DEBOUNCE_MS} ms, cancelling any
 * previously scheduled save. Used for text inputs so we don't fire a save
 * on every keystroke.
 */
function debouncedSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettings, SAVE_DEBOUNCE_MS);
}

// ── Load ──────────────────────────────────────────────────────────────────────

/**
 * Reads the persisted config from the main process and populates all Settings
 * form fields. Called each time the Settings tab is activated so it always
 * reflects the latest saved state.
 *
 * @returns {Promise<void>}
 */
async function loadSettings() {
  const cfg = await window.api.getConfig();
  $('cfg-tablet-url').value           = cfg.tabletUrl            || '';
  $('cfg-output-dir').value           = cfg.outputDir            || '';
  $('cfg-note-format').value          = cfg.noteFormat           || 'pdf';
  $('cfg-sync-on-startup').checked    = !!cfg.syncOnStartup;
  $('cfg-incremental').checked        = cfg.incremental !== false;
  $('cfg-start-with-windows').checked = !!cfg.startWithWindows;
}

// ── Init ──────────────────────────────────────────────────────────────────────

/**
 * Wires up auto-save listeners on every Settings form control.
 * - Text inputs and URL fields: debounced save (waits for typing to pause).
 * - Select dropdowns and checkboxes (toggles): immediate save on change.
 *
 * Called once by `renderer.js` after the DOM is ready.
 */
function initSettings() {
  // Debounced save for free-text fields
  $('cfg-tablet-url').addEventListener('input', debouncedSave);
  $('cfg-output-dir').addEventListener('input', debouncedSave);

  // Immediate save for selects and toggles
  $('cfg-note-format').addEventListener('change', saveSettings);
  $('cfg-sync-on-startup').addEventListener('change', saveSettings);
  $('cfg-incremental').addEventListener('change', saveSettings);
  $('cfg-start-with-windows').addEventListener('change', saveSettings);
}
