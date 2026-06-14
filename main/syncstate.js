'use strict';

const fs   = require('fs');
const path = require('path');

const STATE_PATH = path.join(__dirname, '..', 'data', 'syncstate.json');

/**
 * Reads the full sync-state file.
 * Per-appType keys hold the tablet's maxUpdateTime (Unix ms) of the last sync.
 * Reserved keys `__lastSync` and `__lastSyncResult` store the last-sync summary.
 * @returns {Object}
 */
function loadSyncState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Persists the full sync-state map to disk.
 * @param {Object} state
 */
function saveSyncState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * Returns the last-sync summary.
 * @returns {{ time: string|null, result: string|null }}
 */
function getLastSync() {
  const s = loadSyncState();
  return { time: s.__lastSync || null, result: s.__lastSyncResult || null };
}

/**
 * Stores the last-sync timestamp and result string.
 * @param {string} time   - ISO string of when the sync finished.
 * @param {string} result - Human-readable result.
 */
function setLastSync(time, result) {
  const s = loadSyncState();
  s.__lastSync       = time;
  s.__lastSyncResult = result;
  saveSyncState(s);
}

module.exports = { loadSyncState, saveSyncState, getLastSync, setLastSync };
