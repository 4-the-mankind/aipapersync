'use strict';

const fs   = require('fs');
const path = require('path');

const HISTORY_PATH = path.join(__dirname, '..', 'data', 'history.json');

/** Maximum number of history records kept on disk. */
const MAX_RECORDS = 5000;

/**
 * Reads and parses `data/history.json`.
 * Returns an empty array if the file is missing or malformed.
 *
 * @returns {import('../types').HistoryEntry[]}
 */
function loadHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Serialises `history` and writes it to `data/history.json`.
 * Creates the `data/` directory if it does not exist.
 *
 * @param {import('../types').HistoryEntry[]} history
 */
function saveHistory(history) {
  fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), 'utf8');
}

/**
 * Prepends `entries` to the existing history and trims the list to
 * {@link MAX_RECORDS} to keep the file size bounded.
 * Most-recent entries are always at the front of the array.
 *
 * @param {import('../types').HistoryEntry[]} entries - New records to add.
 */
function appendHistory(entries) {
  const history = loadHistory();
  history.unshift(...entries);
  saveHistory(history.slice(0, MAX_RECORDS));
}

module.exports = { loadHistory, saveHistory, appendHistory };
