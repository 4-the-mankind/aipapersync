'use strict';

// Live tablet API contract tests.
// Only run when TABLET_URL is set (via `npm test -- http://192.168.0.69:8090`).
// These tests hit the real tablet over Wi-Fi — no mocks.

const TABLET_URL = process.env.TABLET_URL;
const run        = TABLET_URL ? describe : describe.skip;

const SyncEngine = require('../sync/syncEngine');

run('live tablet API contract', () => {
  let engine;

  beforeAll(() => {
    engine = new SyncEngine({ tabletUrl: TABLET_URL, outputDir: require('os').tmpdir() });
    console.log(`\nTablet: ${TABLET_URL}`);
  });

  // ── Connectivity ────────────────────────────────────────────────────────────

  it('tablet is reachable', async () => {
    await expect(engine.checkConnectivity()).resolves.toBe(true);
  }, 15_000);

  // ── getChildFolderList ──────────────────────────────────────────────────────

  it('GET /getChildFolderList returns a data array for root', async () => {
    const res = await engine.get('/getChildFolderList?appType=root&folderId=&folderName=Home&language=en');
    expect(Array.isArray(res.data)).toBe(true);
  }, 15_000);

  const APP_TYPES = ['APP_PAPER', 'APP_DAILY', 'APP_MEETING', 'APP_LEARNING', 'APP_PICKING', 'APP_MEMO'];

  for (const appType of APP_TYPES) {
    it(`GET /getChildFolderList responds for ${appType}`, async () => {
      const res = await engine.get(
        `/getChildFolderList?appType=${appType}&folderId=&folderName=Home&language=en`
      );
      expect(res).toHaveProperty('data');
    }, 15_000);
  }

  // ── packageFolderProgress — non-regression: no fileUrl required ─────────────

  it('GET /packageFolderProgress accepts appType alone (no fileUrl)', async () => {
    // Use APP_MEMO — least likely to have active packaging.
    // The endpoint must accept the call without fileUrl and not return HTTP 500.
    const res = await engine.get('/packageFolderProgress?appType=APP_MEMO');
    expect(res).toHaveProperty('data');
    // If the server had required fileUrl it would have returned code 500 or an error body
    expect(res.code).not.toBe(500);
  }, 15_000);

  // ── packageFile response shape ───────────────────────────────────────────────

  it('GET /packageFile returns code 200 and a non-empty filePath', async () => {
    const res = await engine.get(
      '/packageFile?appType=APP_MEMO&fileName=Memo.zip&isFolder=true&fileFormat=zip'
    );
    expect(res.code).toBe(200);
    expect(typeof res.data).toBe('string');
    expect(res.data.length).toBeGreaterThan(0);
  }, 30_000);
});
