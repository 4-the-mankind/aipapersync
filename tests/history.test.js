'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const TEST_DATA_DIR = path.join(os.tmpdir(), 'aipapersync-jest', 'userData');

beforeEach(() => fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true }));
afterAll(()  => fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true }));

const { loadHistory, saveHistory, appendHistory } = require('../main/history');

const makeEntry = (n) => ({
  date: new Date().toISOString(),
  folder: 'Paper',
  filePath: `/sync/note${n}.pdf`,
  action: 'Created',
});

describe('loadHistory', () => {
  it('returns empty array when no file exists', () => {
    expect(loadHistory()).toEqual([]);
  });

  it('falls back to empty array on malformed JSON', () => {
    const p = path.join(TEST_DATA_DIR, 'history.json');
    fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
    fs.writeFileSync(p, '[broken', 'utf8');
    expect(loadHistory()).toEqual([]);
  });
});

describe('saveHistory / loadHistory', () => {
  it('round-trips an array of entries', () => {
    const entries = [makeEntry(1), makeEntry(2)];
    saveHistory(entries);
    expect(loadHistory()).toEqual(entries);
  });

  it('saveHistory([]) empties the history', () => {
    saveHistory([makeEntry(1)]);
    saveHistory([]);
    expect(loadHistory()).toEqual([]);
  });
});

describe('appendHistory', () => {
  it('prepends entries and trims to MAX_RECORDS (5000)', () => {
    // Fill with 4999 existing entries
    const existing = Array.from({ length: 4999 }, (_, i) => makeEntry(i));
    saveHistory(existing);

    // Append 3 new entries — total would be 5002, should trim to 5000
    appendHistory([makeEntry('A'), makeEntry('B'), makeEntry('C')]);
    const result = loadHistory();
    expect(result).toHaveLength(5000);
    // Newest (appended) entries are at the front
    expect(result[0].filePath).toBe('/sync/noteA.pdf');
    expect(result[1].filePath).toBe('/sync/noteB.pdf');
    expect(result[2].filePath).toBe('/sync/noteC.pdf');
  });
});
