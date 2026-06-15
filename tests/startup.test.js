'use strict';

// Stateful mock for Electron's login item API.
// Each test configures mockLoginState to simulate registry conditions.
// MUST be prefixed with "mock" — Jest hoists jest.mock() and only allows
// variables named mock* to be referenced inside the factory.
let mockLoginState = {};

jest.mock('electron', () => ({
  app: {
    getLoginItemSettings: jest.fn(() => mockLoginState),
    setLoginItemSettings: jest.fn(),
  },
}));

const { app } = require('electron');
const {
  setStartup,
  isRegistered,
  willLaunchAtLogin,
  reconcileStartup,
  effectiveStartWithWindows,
} = require('../main/startup');

// A realistic launch item (what Electron returns when the app is registered)
const ENTRY = [{ name: 'AIPaper Sync', path: 'AIPaper Sync.exe', args: [] }];

beforeEach(() => {
  mockLoginState = {
    openAtLogin:                 false,
    executableWillLaunchAtLogin: false,
    launchItems:                 [],
  };
  jest.clearAllMocks();
});

// ── setStartup ───────────────────────────────────────────────────────────────

describe('setStartup', () => {
  it('enables startup by calling setLoginItemSettings with openAtLogin: true', () => {
    setStartup(true);
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
  });

  it('disables startup by calling setLoginItemSettings with openAtLogin: false', () => {
    setStartup(false);
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false });
  });
});

// ── isRegistered ─────────────────────────────────────────────────────────────

describe('isRegistered', () => {
  it('returns false when launchItems is empty (never registered)', () => {
    mockLoginState.launchItems = [];
    expect(isRegistered()).toBe(false);
  });

  it('returns true when at least one launch item exists in the registry', () => {
    mockLoginState.launchItems = ENTRY;
    expect(isRegistered()).toBe(true);
  });
});

// ── willLaunchAtLogin ────────────────────────────────────────────────────────

describe('willLaunchAtLogin', () => {
  it('reflects executableWillLaunchAtLogin = true from registry', () => {
    mockLoginState.executableWillLaunchAtLogin = true;
    expect(willLaunchAtLogin()).toBe(true);
  });

  it('reflects executableWillLaunchAtLogin = false from registry (e.g. disabled in Task Manager)', () => {
    mockLoginState.executableWillLaunchAtLogin = false;
    expect(willLaunchAtLogin()).toBe(false);
  });
});

// ── reconcileStartup ─────────────────────────────────────────────────────────

describe('reconcileStartup', () => {
  it('does nothing when not registered and config already says off', () => {
    const cfg = { startWithWindows: false };
    expect(reconcileStartup(cfg)).toBe(false);
    expect(cfg.startWithWindows).toBe(false);
    expect(app.setLoginItemSettings).not.toHaveBeenCalled();
  });

  it('registers the app on first run when not registered and config says on', () => {
    const cfg = { startWithWindows: true };
    reconcileStartup(cfg);
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
  });

  it('syncs cfg=false from registry when Task Manager disabled the entry', () => {
    // Registry: entry exists, disabled (executableWillLaunchAtLogin = false)
    // Config: says true (out of sync with registry)
    mockLoginState.launchItems                 = ENTRY;
    mockLoginState.executableWillLaunchAtLogin = false;
    const cfg = { startWithWindows: true };

    expect(reconcileStartup(cfg)).toBe(true);   // cfg was mutated → caller must persist
    expect(cfg.startWithWindows).toBe(false);   // synced from registry
  });

  it('syncs cfg=true from registry when Task Manager re-enabled the entry', () => {
    // Registry: entry exists, enabled (executableWillLaunchAtLogin = true)
    // Config: says false (user had turned it off, but Task Manager re-enabled it)
    mockLoginState.launchItems                 = ENTRY;
    mockLoginState.executableWillLaunchAtLogin = true;
    const cfg = { startWithWindows: false };

    expect(reconcileStartup(cfg)).toBe(true);
    expect(cfg.startWithWindows).toBe(true);
  });

  it('returns false and leaves cfg unchanged when registry matches config (enabled)', () => {
    mockLoginState.launchItems                 = ENTRY;
    mockLoginState.executableWillLaunchAtLogin = true;
    const cfg = { startWithWindows: true };
    expect(reconcileStartup(cfg)).toBe(false);
    expect(cfg.startWithWindows).toBe(true);
  });

  it('returns false and leaves cfg unchanged when registry matches config (disabled)', () => {
    mockLoginState.launchItems                 = ENTRY;
    mockLoginState.executableWillLaunchAtLogin = false;
    const cfg = { startWithWindows: false };
    expect(reconcileStartup(cfg)).toBe(false);
    expect(cfg.startWithWindows).toBe(false);
  });
});

// ── effectiveStartWithWindows ────────────────────────────────────────────────

describe('effectiveStartWithWindows', () => {
  it('returns registry executableWillLaunchAtLogin=true when entry exists', () => {
    mockLoginState.launchItems                 = ENTRY;
    mockLoginState.executableWillLaunchAtLogin = true;
    // Config says false — registry wins
    expect(effectiveStartWithWindows({ startWithWindows: false })).toBe(true);
  });

  it('returns registry executableWillLaunchAtLogin=false when Task Manager disabled it', () => {
    mockLoginState.launchItems                 = ENTRY;
    mockLoginState.executableWillLaunchAtLogin = false;
    // Config says true — registry wins
    expect(effectiveStartWithWindows({ startWithWindows: true })).toBe(false);
  });

  it('falls back to cfg.startWithWindows when no entry exists (not yet registered)', () => {
    mockLoginState.launchItems = [];
    expect(effectiveStartWithWindows({ startWithWindows: true  })).toBe(true);
    expect(effectiveStartWithWindows({ startWithWindows: false })).toBe(false);
  });
});
