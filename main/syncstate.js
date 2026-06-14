'use strict';

const fs   = require('fs');
const path = require('path');

const STATE_PATH = path.join(__dirname, '..', 'data', 'syncstate.json');

/**
 * Reads the sync-state file that records when each appType was last
 * successfully synced (Unix ms timestamp).
 *
 * @returns {{ [appType: string]: number }}
 */
function loadSyncState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Persists the sync-state map to disk.
 *
 * @param {{ [appType: string]: number }} state
 */
function saveSyncState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

module.exports = { loadSyncState, saveSyncState };
