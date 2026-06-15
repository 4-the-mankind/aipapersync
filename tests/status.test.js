/**
 * @jest-environment jsdom
 */
'use strict';

// ── DOM scaffold ──────────────────────────────────────────────────────────────
// Minimal HTML matching the element IDs that status.js reads/writes.
const DOM_HTML = `
  <button id="btn-sync-now"></button>
  <div    id="btn-sync-controls" style="display:none"></div>
  <button id="btn-pause"         style="display:flex"></button>
  <button id="btn-resume"        style="display:none"></button>
  <button id="btn-abort"></button>
  <div    id="folder-bars"></div>
  <div    id="log-box"></div>
  <div    id="log-card"></div>
  <button id="log-toggle"></button>
  <div    id="log-actions"></div>
  <button id="btn-clear-log"></button>
  <button id="btn-copy-log"></button>
  <div    id="connectivity-dot"></div>
  <div    id="tablet-status"></div>
  <div    id="last-sync-time"></div>
  <div    id="last-sync-result"></div>
  <div    id="save-toast"></div>
`;

// ── Globals that status.js expects ────────────────────────────────────────────
// These must be assigned before require() so the module picks them up.
global.$ = (id) => document.getElementById(id);
global.showToast = jest.fn();

window.api = {
  on:               jest.fn(),
  getAppState:      jest.fn().mockResolvedValue({}),
  checkConnectivity: jest.fn().mockResolvedValue(false),
  syncNow:          jest.fn().mockResolvedValue({}),
  pauseSync:        jest.fn(),
  resumeSync:       jest.fn(),
  abortSync:        jest.fn(),
};

const {
  _setSyncActive,
  _setPauseLabel,
  _getSyncState,
  _onSyncComplete,
  _onSyncError,
} = require('../renderer/status');

// ── Helpers ───────────────────────────────────────────────────────────────────

function display(id) { return document.getElementById(id).style.display; }

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  document.body.innerHTML = DOM_HTML;
  // Reset module-level state to idle before each test
  _setSyncActive(false);
  jest.clearAllMocks();
});

// ── setSyncActive ─────────────────────────────────────────────────────────────

describe('setSyncActive', () => {
  it('active=true hides "Sync Now" button and shows sync controls', () => {
    _setSyncActive(true);
    expect(display('btn-sync-now')).toBe('none');
    expect(display('btn-sync-controls')).toBe('flex');
  });

  it('active=false shows "Sync Now" button and hides sync controls', () => {
    _setSyncActive(true);
    _setSyncActive(false);
    expect(display('btn-sync-now')).toBe('');
    expect(display('btn-sync-controls')).toBe('none');
  });

  it('active=true resets syncPaused to false', () => {
    // Simulate paused state, then start a new sync
    _setPauseLabel(true);
    _setSyncActive(true);
    expect(_getSyncState().paused).toBe(false);
  });

  it('active=true also resets the pause button to its default label', () => {
    _setPauseLabel(true);              // shows Resume
    _setSyncActive(true);             // should reset labels
    expect(display('btn-pause')).toBe('flex');
    expect(display('btn-resume')).toBe('none');
  });
});

// ── setPauseLabel ─────────────────────────────────────────────────────────────

describe('setPauseLabel', () => {
  it('paused=true hides Pause button and shows Resume button', () => {
    _setSyncActive(true);
    _setPauseLabel(true);
    expect(display('btn-pause')).toBe('none');
    expect(display('btn-resume')).toBe('flex');
  });

  it('paused=false shows Pause button and hides Resume button', () => {
    _setSyncActive(true);
    _setPauseLabel(true);
    _setPauseLabel(false);
    expect(display('btn-pause')).toBe('flex');
    expect(display('btn-resume')).toBe('none');
  });
});

// ── onSyncComplete ────────────────────────────────────────────────────────────

describe('onSyncComplete', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    _setSyncActive(true);
  });
  afterEach(() => jest.useRealTimers());

  it('resets the UI to idle state (Sync Now visible, controls hidden)', () => {
    _onSyncComplete({ created: 0, overwritten: 0, errors: [] });
    expect(display('btn-sync-now')).toBe('');
    expect(display('btn-sync-controls')).toBe('none');
  });

  it('shows "N created" when files were created and no errors', () => {
    _onSyncComplete({ created: 5, overwritten: 0, errors: [] });
    expect(document.getElementById('last-sync-result').textContent).toBe('5 created');
  });

  it('shows "N created, M overwritten" for mixed results', () => {
    _onSyncComplete({ created: 3, overwritten: 2, errors: [] });
    expect(document.getElementById('last-sync-result').textContent).toBe('3 created, 2 overwritten');
  });

  it('shows "No changes" when nothing was synced', () => {
    _onSyncComplete({ created: 0, overwritten: 0, errors: [] });
    expect(document.getElementById('last-sync-result').textContent).toBe('No changes');
  });

  it('appends the error count when some folders failed', () => {
    _onSyncComplete({ created: 1, overwritten: 0, errors: [{ folder: 'Paper', error: 'timeout' }] });
    expect(document.getElementById('last-sync-result').textContent).toContain('1 error(s)');
  });
});

// ── onSyncError ───────────────────────────────────────────────────────────────

describe('onSyncError', () => {
  it('resets the UI to idle and marks result as Error', () => {
    _setSyncActive(true);
    _onSyncError({ error: 'Connection lost' });
    expect(display('btn-sync-now')).toBe('');
    expect(document.getElementById('last-sync-result').textContent).toBe('Error');
  });
});
