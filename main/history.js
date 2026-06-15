'use strict';

const fs           = require('fs');
const path         = require('path');
const { dataFile } = require('./paths');

const MAX_RECORDS = 5000;

function historyPath() { return dataFile('history.json'); }

/**
 * Reads and parses history.json from userData.
 * Returns an empty array if the file is missing or malformed.
 * @returns {import('../types').HistoryEntry[]}
 */
function loadHistory() {
  try {
    return JSON.parse(fs.readFileSync(historyPath(), 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Serialises `history` and writes it to userData/history.json.
 * @param {import('../types').HistoryEntry[]} history
 */
function saveHistory(history) {
  const p = historyPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(history, null, 2), 'utf8');
}

/**
 * Prepends `entries` to the existing history and trims to {@link MAX_RECORDS}.
 * @param {import('../types').HistoryEntry[]} entries
 */
function appendHistory(entries) {
  const history = loadHistory();
  history.unshift(...entries);
  saveHistory(history.slice(0, MAX_RECORDS));
}

module.exports = { loadHistory, saveHistory, appendHistory };
