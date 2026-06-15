'use strict';

const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const AdmZip = require('adm-zip');

const TEST_DATA_DIR = path.join(os.tmpdir(), 'aipapersync-jest', 'userData');

beforeEach(() => fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true }));
afterAll(()  => fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true }));

const SyncEngine = require('../sync/syncEngine');

// Helper: build a minimal fetch Response for a JSON payload
function jsonOk(data) {
  return {
    ok:      true,
    status:  200,
    json:    () => Promise.resolve(data),
    headers: { get: () => null },
  };
}

// Helper: create a real in-memory ZIP containing the given files and write to disk
function makeZipFile(destPath, files) {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, Buffer.from(content, 'utf8'));
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  zip.writeZip(destPath);
}

// ── checkConnectivity ────────────────────────────────────────────────────────

describe('checkConnectivity', () => {
  afterEach(() => { global.fetch = undefined; });

  it('returns true when the tablet responds with HTTP 200', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true }));
    const engine = new SyncEngine({ tabletUrl: 'http://mock-tablet.test', outputDir: os.tmpdir() });
    await expect(engine.checkConnectivity()).resolves.toBe(true);
  });

  it('returns false when the tablet is unreachable', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('ECONNREFUSED')));
    const engine = new SyncEngine({ tabletUrl: 'http://mock-tablet.test', outputDir: os.tmpdir() });
    await expect(engine.checkConnectivity()).resolves.toBe(false);
  });
});

// ── hasLocalFiles ────────────────────────────────────────────────────────────

describe('hasLocalFiles', () => {
  let outputDir;
  beforeEach(() => { outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-output-')); });
  afterEach(()  => { fs.rmSync(outputDir, { recursive: true, force: true }); });

  it('returns false when the folder does not exist', () => {
    const engine = new SyncEngine({ tabletUrl: 'http://mock-tablet.test', outputDir });
    expect(engine.hasLocalFiles('Paper')).toBe(false);
  });

  it('returns true when at least one file is present', () => {
    const dir = path.join(outputDir, 'Paper');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'note.pdf'), 'data');
    const engine = new SyncEngine({ tabletUrl: 'http://mock-tablet.test', outputDir });
    expect(engine.hasLocalFiles('Paper')).toBe(true);
  });
});

// ── extractZip ───────────────────────────────────────────────────────────────

describe('extractZip', () => {
  let outputDir;
  beforeEach(() => { outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-output-')); });
  afterEach(()  => { fs.rmSync(outputDir, { recursive: true, force: true }); });

  it('creates new files and reports correct counts', async () => {
    const zipPath = path.join(outputDir, 'Paper.zip');
    makeZipFile(zipPath, {
      'Paper/note1.pdf': 'content 1',
      'Paper/note2.pdf': 'content 2',
    });

    const engine = new SyncEngine({ tabletUrl: 'http://mock-tablet.test', outputDir, incremental: false });
    const counts = await engine.extractZip(zipPath, 'Paper');

    expect(counts.created).toBe(2);
    expect(counts.overwritten).toBe(0);
    expect(counts.skipped).toBe(0);
    expect(fs.existsSync(path.join(outputDir, 'Paper', 'note1.pdf'))).toBe(true);
  });

  it('in incremental mode, skips files that have not changed (mtime >= ZIP entry time)', async () => {
    const zipPath = path.join(outputDir, 'Paper.zip');
    // ZIP entry time granularity is 2 seconds; set local file's mtime to the future
    makeZipFile(zipPath, { 'Paper/note.pdf': 'original' });

    const destFile = path.join(outputDir, 'Paper', 'note.pdf');
    fs.mkdirSync(path.dirname(destFile), { recursive: true });
    fs.writeFileSync(destFile, 'original');
    // Force mtime to far in the future so the local file appears newer than the ZIP entry
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(destFile, future, future);

    const engine = new SyncEngine({ tabletUrl: 'http://mock-tablet.test', outputDir, incremental: true });
    const counts = await engine.extractZip(zipPath, 'Paper');

    expect(counts.skipped).toBe(1);
    expect(counts.overwritten).toBe(0);
  });
});

// ── abort / pause / resume ───────────────────────────────────────────────────

describe('abort / pause / resume', () => {
  it('abort() sets aborted=true and clears paused', () => {
    const engine = new SyncEngine({ tabletUrl: 'http://mock-tablet.test', outputDir: os.tmpdir() });
    engine.paused = true;
    engine.abort();
    expect(engine.aborted).toBe(true);
    expect(engine.paused).toBe(false);
  });

  it('pause() sets paused=true', () => {
    const engine = new SyncEngine({ tabletUrl: 'http://mock-tablet.test', outputDir: os.tmpdir() });
    engine.pause();
    expect(engine.paused).toBe(true);
  });

  it('resume() clears paused=false', () => {
    const engine = new SyncEngine({ tabletUrl: 'http://mock-tablet.test', outputDir: os.tmpdir() });
    engine.pause();
    engine.resume();
    expect(engine.paused).toBe(false);
  });

  it('waitIfPaused resolves immediately when engine is not paused', async () => {
    const engine = new SyncEngine({ tabletUrl: 'http://mock-tablet.test', outputDir: os.tmpdir() });
    await expect(engine.waitIfPaused()).resolves.toBeUndefined();
  });

  it('waitIfPaused blocks until resume() is called', async () => {
    const engine = new SyncEngine({ tabletUrl: 'http://mock-tablet.test', outputDir: os.tmpdir() });
    engine.pause();

    const order = [];
    const pending = engine.waitIfPaused().then(() => order.push('unblocked'));

    await new Promise(r => setTimeout(r, 250));   // let at least one poll tick pass
    order.push('before-resume');
    engine.resume();
    await pending;

    expect(order).toEqual(['before-resume', 'unblocked']);
  });

  it('syncFolder exits without downloading when aborted during packaging', async () => {
    let outputDir;
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abort-test-'));
    try {
      const engine = new SyncEngine({ tabletUrl: 'http://mock-tablet.test', outputDir, incremental: false });

      // Spy BEFORE setting up fetch so the spy is in place when syncFolder runs
      const downloadSpy = jest.spyOn(engine, 'downloadFile').mockResolvedValue();
      const extractSpy  = jest.spyOn(engine, 'extractZip').mockResolvedValue({ created: 0, overwritten: 0, skipped: 0 });

      global.fetch = jest.fn((url) => {
        if (url.includes('/packageFile'))
          return Promise.resolve(jsonOk({ code: 200, data: '/tmp/P.zip' }));
        return Promise.reject(new Error(`Unexpected: ${url}`));
      });

      // Abort during the packaging poll phase
      jest.spyOn(engine, 'pollProgress').mockImplementation(() => {
        engine.abort();
        return Promise.resolve();
      });

      await engine.syncFolder('APP_PAPER', 'Paper');

      expect(engine.aborted).toBe(true);
      expect(downloadSpy).not.toHaveBeenCalled();
      expect(extractSpy).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
      jest.restoreAllMocks();
      global.fetch = undefined;
    }
  });
});

// ── syncFolder non-regression: correct API URLs ──────────────────────────────

describe('syncFolder — API URL non-regression', () => {
  let outputDir;
  let engine;
  let capturedUrls;

  beforeEach(() => {
    capturedUrls = [];
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-output-'));

    engine = new SyncEngine({
      tabletUrl:   'http://mock-tablet.test',
      outputDir,
      incremental: false,  // skip getMaxUpdateTime to isolate URL checks
    });

    global.fetch = jest.fn((url) => {
      capturedUrls.push(url);
      if (url.includes('/packageFile'))
        return Promise.resolve(jsonOk({ code: 200, data: '/tmp/Paper.zip' }));
      if (url.includes('/packageFolderProgress'))
        return Promise.resolve(jsonOk({ data: { childCompleteCount: 2, childTotal: 2 } }));
      if (url.includes('/checkDownloadFile'))
        return Promise.resolve(jsonOk({ data: { fileSize: 1024 } }));
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    jest.spyOn(engine, 'downloadFile').mockResolvedValue();
    jest.spyOn(engine, 'extractZip').mockResolvedValue({ created: 1, overwritten: 0, skipped: 0 });
  });

  afterEach(() => {
    fs.rmSync(outputDir, { recursive: true, force: true });
    jest.restoreAllMocks();
    global.fetch = undefined;
  });

  it('/packageFolderProgress is called without fileUrl param', async () => {
    await engine.syncFolder('APP_PAPER', 'Paper');
    const url = capturedUrls.find(u => u.includes('/packageFolderProgress'));
    expect(url).toBeDefined();
    expect(url).toContain('appType=APP_PAPER');
    expect(url).not.toContain('fileUrl');
  });

  it('/packageFile is called without superfluous params (fileUrl, childFileFormat, folderId)', async () => {
    await engine.syncFolder('APP_PAPER', 'Paper');
    const url = capturedUrls.find(u => u.includes('/packageFile'));
    expect(url).toBeDefined();
    expect(url).toContain('appType=APP_PAPER');
    expect(url).toContain('fileName=Paper.zip');
    expect(url).toContain('isFolder=true');
    expect(url).toContain('fileFormat=zip');
    expect(url).not.toContain('fileUrl');
    expect(url).not.toContain('childFileFormat');
    expect(url).not.toContain('folderId=');
  });
});
