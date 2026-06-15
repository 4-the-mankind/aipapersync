'use strict';

const fs           = require('fs');
const path         = require('path');
const { dataFile } = require('./paths');

function statePath() { return dataFile('syncstate.json'); }

function loadSyncState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8'));
  } catch {
    return {};
  }
}

function saveSyncState(state) {
  const p = statePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2), 'utf8');
}

function getLastSync() {
  const s = loadSyncState();
  return { time: s.__lastSync || null, result: s.__lastSyncResult || null };
}

function setLastSync(time, result) {
  const s = loadSyncState();
  s.__lastSync       = time;
  s.__lastSyncResult = result;
  saveSyncState(s);
}

module.exports = { loadSyncState, saveSyncState, getLastSync, setLastSync };
