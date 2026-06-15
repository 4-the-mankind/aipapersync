'use strict';

// ── Windows "start with Windows" handling ────────────────────────────────────
// Single source of truth for the startup-at-login logic, shared by main.js and
// the startup test harness so both exercise the exact same code path.
//
// Key finding (verified empirically — see _startup_test/):
//   * openAtLogin is UNRELIABLE: it can be false even when the entry exists and
//     is active (it only matches entries written in Electron's canonical form).
//   * executableWillLaunchAtLogin is the truth: true iff an entry exists AND is
//     not disabled (e.g. via Task Manager / StartupApproved).
//   * launchItems[] lists existing entries, letting us distinguish
//     "never registered" (first run) from "registered but disabled".

const { app } = require('electron');

/**
 * Enables/disables launch at login.
 * @param {boolean} enabled
 * @returns {boolean} success
 */
function setStartup(enabled) {
  try {
    app.setLoginItemSettings({ openAtLogin: enabled });
    return true;
  } catch {
    return false;
  }
}

/** @returns {boolean} Whether a startup entry exists in the registry at all. */
function isRegistered() {
  return (app.getLoginItemSettings().launchItems || []).length > 0;
}

/** @returns {boolean} Whether the app will actually launch at login right now. */
function willLaunchAtLogin() {
  return app.getLoginItemSettings().executableWillLaunchAtLogin;
}

/**
 * Reconciles the persisted `startWithWindows` flag with the real registry state.
 * - If an entry exists, the registry wins (covers Task Manager enable/disable).
 * - If no entry exists but config wants it on, register it (first run/reinstall).
 *
 * @param {{startWithWindows: boolean}} cfg
 * @returns {boolean} true if `cfg` was mutated and should be persisted.
 */
function reconcileStartup(cfg) {
  const settings   = app.getLoginItemSettings();
  const registered = (settings.launchItems || []).length > 0;

  if (registered) {
    if (cfg.startWithWindows !== settings.executableWillLaunchAtLogin) {
      cfg.startWithWindows = settings.executableWillLaunchAtLogin;
      return true;
    }
    return false;
  }

  if (cfg.startWithWindows) setStartup(true);
  return false;
}

/**
 * The value the Settings toggle should display. Reads live registry state so
 * Task Manager changes are reflected, falling back to config when no entry
 * exists (e.g. user turned it off, or very first launch before registration).
 *
 * @param {{startWithWindows: boolean}} cfg
 * @returns {boolean}
 */
function effectiveStartWithWindows(cfg) {
  const settings = app.getLoginItemSettings();
  if ((settings.launchItems || []).length > 0) {
    return settings.executableWillLaunchAtLogin;
  }
  return cfg.startWithWindows;
}

module.exports = {
  setStartup,
  isRegistered,
  willLaunchAtLogin,
  reconcileStartup,
  effectiveStartWithWindows,
};
