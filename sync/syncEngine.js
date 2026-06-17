'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const log    = require('../main/logger');
const { loadSyncState, saveSyncState } = require('../main/syncstate');

const APP_TYPES = [
  { appType: 'APP_PAPER',    label: 'Paper' },
  { appType: 'APP_DAILY',    label: 'Daily' },
  { appType: 'APP_MEETING',  label: 'Meeting' },
  { appType: 'APP_LEARNING', label: 'Learning' },
  { appType: 'APP_PICKING',  label: 'Picking' },
  { appType: 'APP_MEMO',     label: 'Memo' },
];

const POLL_INTERVAL_MS       = 2000;
const EMPTY_FOLDER_THRESHOLD = 3;
const DOWNLOAD_SPEED_BPS     = 1 * 1024 * 1024; // 1 MB/s conservative
const DOWNLOAD_TIMEOUT_MIN   = 5 * 60_000;         // 5 minutes floor
const DOWNLOAD_TIMEOUT_MAX   = 20 * 60_000;

class SyncEngine {
  constructor({ tabletUrl, outputDir, noteFormat, incremental, deleteOnTabletDelete, onProgress, onLog }) {
    this.tabletUrl            = tabletUrl.replace(/\/$/, '');
    this.outputDir            = outputDir;
    this.noteFormat           = noteFormat  || 'pdf';
    this.incremental          = incremental !== false;
    this.deleteOnTabletDelete = !!deleteOnTabletDelete;
    this.onProgress           = onProgress  || (() => {});
    this.onLog                = onLog       || (() => {});
    this.aborted              = false;
    this.newHistory           = [];
    this.syncState            = loadSyncState();
    this.manifest             = this.syncState.__manifest || {};
  }

  abort()  {
    this.aborted = true;
    this.paused  = false;
    if (this._downloadController) this._downloadController.abort();
  }
  pause()  { this.paused = true; }
  resume() { this.paused = false; }

  /** Resolves once the engine is no longer paused (or immediately if not paused). */
  async waitIfPaused() {
    while (this.paused && !this.aborted) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  /** @param {string} msg */
  log(msg) { log.info(msg); this.onLog(msg); }

  /**
   * @param {string} context
   * @param {Error}  err
   */
  logError(context, err) {
    log.error(`[${context}] ${err.message}`);
    this.onLog(`[${context}] ERROR: ${err.message}`);
  }

  /**
   * GET request to the tablet API with a 30-second timeout.
   * Retries once after 3 seconds on network failure (handles tablet WiFi wake-up).
   * @param {string} endpoint
   */
  async get(endpoint) {
    const url = `${this.tabletUrl}${endpoint}`;
    const attempt = async () => {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${endpoint}`);
      return res.json();
    };
    try {
      return await attempt();
    } catch (err) {
      if (this.aborted) throw err;
      // Network-level failure (not HTTP error) — wait 3s and retry once
      if (err.name !== 'AbortError' && !err.message.startsWith('HTTP')) {
        this.onLog(`[WARN] Request failed (${err.message}), retrying in 3s...`);
        await new Promise(r => setTimeout(r, 3000));
        return attempt();
      }
      throw err;
    }
  }

  /** @returns {Promise<boolean>} */
  async checkConnectivity() {
    try {
      const res = await fetch(
        `${this.tabletUrl}/getChildFolderList?appType=root&folderId=&folderName=Home&language=en`,
        { signal: AbortSignal.timeout(10000) }
      );
      return res.ok;
    } catch { return false; }
  }

  /**
   * Recursively walks the tablet folder tree and returns the maximum
   * `updateTime` (ms) found. Subfolders whose `updateTime` hasn't changed
   * since `lastSyncMs` are pruned for efficiency.
   *
   * @param {string} appType
   * @param {string} folderId    - noteId of the folder, or '' for root
   * @param {string} folderName  - Display name of the folder
   * @param {number} lastSyncMs  - Timestamp of the last successful sync
   * @returns {Promise<number>} Maximum updateTime found (0 if none)
   */
  async getMaxUpdateTime(appType, folderId, folderName, lastSyncMs) {
    const data  = await this.get(
      `/getChildFolderList?appType=${appType}&folderId=${encodeURIComponent(folderId)}&folderName=${encodeURIComponent(folderName)}&language=en`
    );
    const items = data.data || [];
    let maxTime = 0;

    for (const item of items) {
      if (item.updateTime > maxTime) maxTime = item.updateTime;

      if (item.isFolder && !item.isEmptyFolder &&
          (item.updateTime === 0 || item.updateTime > lastSyncMs)) {
        const subMax = await this.getMaxUpdateTime(appType, item.noteId, item.fileName, lastSyncMs);
        if (subMax > maxTime) maxTime = subMax;
      }
    }

    return maxTime;
  }

  /**
   * Full sync over all 6 tablet folders.
   * @returns {Promise<{total, created, overwritten, skipped, errors, history}>}
   */
  async run() {
    this.aborted    = false;
    this.paused     = false;
    this.newHistory = [];
    const results   = { total: 0, created: 0, overwritten: 0, skipped: 0, errors: [] };

    for (let i = 0; i < APP_TYPES.length; i++) {
      if (this.aborted) break;
      const { appType, label } = APP_TYPES[i];

      try {
        await this.waitIfPaused();
        if (this.aborted) break;
        this.log(`[${label}] Starting...`);
        this.onProgress({ type: 'folder-start', folder: label, folderIndex: i, folderTotal: APP_TYPES.length });

        const r = await this.syncFolder(appType, label);
        results.created     += r.created;
        results.overwritten += r.overwritten;
        results.skipped     += r.skipped;
        results.total       += r.created + r.overwritten;

        this.onProgress({ type: 'folder-done', folder: label, ...r });
        if (r.entirelySkipped) {
          this.log(`[${label}] Skipped — nothing changed since last sync`);
        } else {
          this.log(`[${label}] Done — ${r.created} created, ${r.overwritten} overwritten, ${r.skipped} unchanged`);
        }
      } catch (err) {
        this.logError(label, err);
        results.errors.push({ folder: label, error: err.message });
        this.onProgress({ type: 'folder-error', folder: label, error: err.message });
      }
    }

    return { ...results, history: this.newHistory };
  }

  /**
   * Syncs one folder end-to-end. When incremental mode is on and the tablet
   * reports no `updateTime` newer than the last sync, the ZIP download is
   * skipped entirely — saving bandwidth and time.
   *
   * @param {string} appType
   * @param {string} label
   */
  async syncFolder(appType, label) {
    const lastSyncMs = this.syncState[appType] || 0;

    // ── Incremental check: skip download if nothing changed ────────────────
    // We always store the tablet's own maxUpdateTime (not PC's Date.now()) so
    // the comparison is clock-independent and survives tablet/PC clock skew.
    // We only skip when the manifest also has entries for this folder, proving
    // we've successfully synced it at least once (cache is warm). An empty
    // manifest means first run OR the user reset the cache — always download.
    //
    // Note: the tablet does NOT update timestamps when a file is unlocked, so
    // the only reliable way to pick up a newly-unlocked file is a Force Sync
    // (which clears the manifest) or to wait for the next content change.
    let maxUpdateTime = 0;
    if (this.incremental) {
      this.log(`[${label}] Checking for changes...`);
      maxUpdateTime = await this.getMaxUpdateTime(appType, '', label, lastSyncMs);

      if (lastSyncMs > 0 && maxUpdateTime > 0 && maxUpdateTime <= lastSyncMs) {
        if (Object.keys(this.manifest[appType] || {}).length > 0) {
          this.onProgress({ type: 'folder-skipped', folder: label });
          return { created: 0, overwritten: 0, skipped: 0, entirelySkipped: true };
        }
        this.log(`[${label}] No sync cache — downloading`);
      }
    }

    const fileName = `${label}.zip`;

    // 1. Trigger packaging — childFileFormat tells the tablet which format to include
    this.log(`[${label}] Packaging...`);
    const fmt = this.noteFormat !== 'both' ? `&childFileFormat=${this.noteFormat}` : '';
    const pkgData = await this.get(
      `/packageFile?appType=${appType}&fileName=${encodeURIComponent(fileName)}&isFolder=true&fileFormat=zip${fmt}`
    );
    if (pkgData.code !== 200) throw new Error(`packageFile failed: code ${pkgData.code}`);
    const filePath = pkgData.data;

    // 2. Poll packaging progress
    this.log(`[${label}] Waiting for packaging to complete...`);
    await this.pollProgress(appType, label);
    if (this.aborted) return { created: 0, overwritten: 0, skipped: 0 };

    // 3. Verify ZIP is ready
    const checkData = await this.get(`/checkDownloadFile?filePath=${encodeURIComponent(filePath)}`);
    if (!checkData.data || !checkData.data.fileSize) {
      throw new Error('checkDownloadFile: no fileSize — ZIP may be empty');
    }
    const fileSize = checkData.data.fileSize;
    this.log(`[${label}] ZIP ready (${Math.round(fileSize / 1024)} KB)`);

    // 4. Download to temp on output drive (never C:)
    const tmpDir = path.join(this.outputDir, '.tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmpZip = path.join(tmpDir, fileName);

    await this.downloadFile(filePath, tmpZip, label, fileSize);
    if (this.aborted) { this.deleteSafe(tmpZip); return { created: 0, overwritten: 0, skipped: 0 }; }

    // 5. Extract — skip unchanged files (by content hash), optionally delete removed ones
    const counts = await this.extractZip(tmpZip, label, appType);

    // 6. Cleanup
    this.deleteSafe(tmpZip);

    // 7. Persist the tablet's own maxUpdateTime (not PC clock) so next run's
    //    comparison is clock-independent and survives tablet/PC time drift.
    //    Also persist the content-hash manifest used for incremental skip.
    this.syncState[appType]    = maxUpdateTime > 0 ? maxUpdateTime : Date.now();
    this.syncState.__manifest  = this.manifest;
    saveSyncState(this.syncState);

    return counts;
  }

  /**
   * Polls `/packageFolderProgress` until packaging is complete.
   * @param {string} appType
   * @param {string} label
   */
  async pollProgress(appType, label) {
    let emptyCount = 0;
    for (;;) {
      if (this.aborted) return;
      await this.waitIfPaused();
      if (this.aborted) return;
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      const data     = await this.get(`/packageFolderProgress?appType=${appType}`);
      const progress = data.data || {};
      const packaged = progress.childCompleteCount ?? 0;
      const total    = progress.childTotal         ?? 0;

      this.onProgress({ type: 'packaging', folder: label, packaged, total });

      if (total === 0) {
        emptyCount++;
        if (emptyCount >= EMPTY_FOLDER_THRESHOLD) {
          this.log(`[${label}] Folder appears empty — skipping`);
          return;
        }
        continue;
      }
      emptyCount = 0;
      this.log(`[${label}] Packaged ${packaged}/${total}`);
      if (packaged >= total) return;
    }
  }

  /**
   * Streams the ZIP from the tablet to disk. Timeout scales with file size.
   * Emits `download-start` before the first byte so the UI can reset its bar.
   *
   * @param {string} filePath
   * @param {string} destPath
   * @param {string} label
   * @param {number} fileSize
   */
  async downloadFile(filePath, destPath, label, fileSize) {
    this.log(`[${label}] Downloading ZIP...`);
    const timeoutMs = Math.min(DOWNLOAD_TIMEOUT_MAX,
      Math.max(DOWNLOAD_TIMEOUT_MIN, Math.ceil((fileSize / DOWNLOAD_SPEED_BPS) * 1000 * 3)));

    this._downloadController = new AbortController();
    const timeoutId = setTimeout(() => { if (this._downloadController) this._downloadController.abort(); }, timeoutMs);

    const url = `${this.tabletUrl}/download?filePath=${encodeURIComponent(filePath)}`;
    let res;
    try {
      res = await fetch(url, { signal: this._downloadController.signal });
      if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    } catch (err) {
      clearTimeout(timeoutId);
      this._downloadController = null;
      throw err;
    }
    // Keep _downloadController alive until the body is fully streamed so that
    // abort() can cancel an in-progress reader.read() call at any point.

    const total    = parseInt(res.headers.get('content-length') || String(fileSize), 10);
    let   received = 0;

    this.onProgress({ type: 'download-start', folder: label });

    const writer = fs.createWriteStream(destPath);
    const reader = res.body.getReader();

    return new Promise((resolve, reject) => {
      const finish = (err) => {
        clearTimeout(timeoutId);
        this._downloadController = null;
        if (err) { writer.destroy(); reject(err); } else resolve();
      };

      const pump = async () => {
        try {
          for (;;) {
            // Check abort/pause between each network chunk
            if (this.aborted) { writer.destroy(); clearTimeout(timeoutId); this._downloadController = null; resolve(); return; }
            await this.waitIfPaused();
            if (this.aborted) { writer.destroy(); clearTimeout(timeoutId); this._downloadController = null; resolve(); return; }

            const { done, value } = await reader.read();
            if (done) break;
            writer.write(Buffer.from(value));
            received += value.length;
            this.onProgress({ type: 'download', folder: label, received, total });
          }
          writer.end();
          writer.on('finish', () => finish(null));
          writer.on('error', (err) => finish(err));
        } catch (err) {
          // AbortError thrown by reader.read() when _downloadController was aborted
          if (this.aborted) { writer.destroy(); clearTimeout(timeoutId); this._downloadController = null; resolve(); }
          else finish(err);
        }
      };
      pump();
    });
  }

  /**
   * Extracts the ZIP.
   * - Format filter: skips entries whose extension doesn't match `this.noteFormat`.
   * - Incremental skip: computes MD5 of each entry; skips if hash matches the
   *   stored manifest (reliable — ZIP entry timestamps are always "now" on the
   *   tablet, making mtime comparison useless).
   * - Delete removed: if `deleteOnTabletDelete`, deletes local files that were
   *   not present in this ZIP (i.e. removed from the tablet).
   *
   * @param {string} zipPath
   * @param {string} label
   * @param {string} appType
   * @returns {Promise<{created, overwritten, skipped}>}
   */
  async extractZip(zipPath, label, appType) {
    this.log(`[${label}] Extracting...`);
    const entries        = new AdmZip(zipPath).getEntries();
    const folderManifest = (this.manifest[appType] = this.manifest[appType] || {});
    const syncedPaths    = new Set();
    let created = 0, overwritten = 0, skipped = 0;

    for (const entry of entries) {
      if (entry.isDirectory) continue;

      // Skip entries whose format doesn't match the user's setting
      if (this.noteFormat !== 'both') {
        const ext = path.extname(entry.entryName).slice(1).toLowerCase();
        if (ext !== this.noteFormat) continue;
      }

      const destFile = path.join(this.outputDir, entry.entryName);
      fs.mkdirSync(path.dirname(destFile), { recursive: true });
      syncedPaths.add(destFile);

      const existed = fs.existsSync(destFile);
      const data    = entry.getData();
      const hash    = crypto.createHash('md5').update(data).digest('hex');
      const key     = entry.entryName;

      if (existed && this.incremental && folderManifest[key] === hash) {
        skipped++;
        continue;
      }

      fs.writeFileSync(destFile, data);
      folderManifest[key] = hash;

      const action = existed ? 'Overwritten' : 'Created';
      if (existed) overwritten++; else created++;

      this.newHistory.push({
        date: new Date().toISOString(), folder: label, filePath: destFile, action,
      });
    }

    // Remove local files that no longer exist on the tablet
    if (this.deleteOnTabletDelete) {
      const localDir = path.join(this.outputDir, label);
      if (fs.existsSync(localDir)) {
        const scan = (d) => {
          for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, ent.name);
            if (ent.isFile()) {
              if (this.noteFormat === 'both' ||
                  ent.name.toLowerCase().endsWith(`.${this.noteFormat}`)) {
                if (!syncedPaths.has(full)) {
                  this.deleteSafe(full);
                  this.log(`[${label}] Deleted (removed from tablet): ${path.basename(full)}`);
                  this.newHistory.push({ date: new Date().toISOString(), folder: label, filePath: full, action: 'Deleted' });
                }
              }
            } else if (ent.isDirectory()) scan(full);
          }
        };
        scan(localDir);
      }
    }

    return { created, overwritten, skipped };
  }

  /** @param {string} filePath */
  deleteSafe(filePath) { try { fs.unlinkSync(filePath); } catch {} }
}

module.exports = SyncEngine;
