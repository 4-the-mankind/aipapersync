'use strict';

const fs   = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const log  = require('../main/logger');
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
const DOWNLOAD_TIMEOUT_MIN   = 60_000;
const DOWNLOAD_TIMEOUT_MAX   = 20 * 60_000;

class SyncEngine {
  constructor({ tabletUrl, outputDir, noteFormat, incremental, onProgress, onLog }) {
    this.tabletUrl   = tabletUrl.replace(/\/$/, '');
    this.outputDir   = outputDir;
    this.noteFormat  = noteFormat  || 'pdf';
    this.incremental = incremental !== false;
    this.onProgress  = onProgress  || (() => {});
    this.onLog       = onLog       || (() => {});
    this.aborted     = false;
    this.newHistory  = [];
    this.syncState   = loadSyncState();
  }

  abort() { this.aborted = true; }

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
   * @param {string} endpoint
   */
  async get(endpoint) {
    const res = await fetch(`${this.tabletUrl}${endpoint}`, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${endpoint}`);
    return res.json();
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
   * `updateTime` (ms) found across all files and subfolders.
   * Uses the `updateTime` on folders as a shortcut — if a folder's
   * `updateTime` is not newer than `lastSyncMs`, its subtree is pruned.
   *
   * @param {string} appType
   * @param {string} folderId   - `noteId` of the folder, or '' for root.
   * @param {string} folderName - Display name of the folder.
   * @param {number} lastSyncMs - Timestamp of the last successful sync.
   * @returns {Promise<number>} Maximum updateTime found (0 if none).
   */
  async getMaxUpdateTime(appType, folderId, folderName, lastSyncMs) {
    const data  = await this.get(
      `/getChildFolderList?appType=${appType}&folderId=${encodeURIComponent(folderId)}&folderName=${encodeURIComponent(folderName)}&language=en`
    );
    const items = data.data || [];
    let maxTime = 0;

    for (const item of items) {
      if (item.updateTime > maxTime) maxTime = item.updateTime;

      // Recurse into non-empty subfolders. Always enter when updateTime === 0
      // (the tablet doesn't track folder-level timestamps for system folders),
      // prune only when we have a known timestamp older than the last sync.
      if (item.isFolder && !item.isEmptyFolder && (item.updateTime === 0 || item.updateTime > lastSyncMs)) {
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
    this.newHistory = [];
    const results   = { total: 0, created: 0, overwritten: 0, skipped: 0, errors: [] };

    for (let i = 0; i < APP_TYPES.length; i++) {
      if (this.aborted) break;
      const { appType, label } = APP_TYPES[i];

      try {
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
    let maxUpdateTime = 0;
    if (this.incremental) {
      this.log(`[${label}] Checking for changes...`);
      maxUpdateTime = await this.getMaxUpdateTime(appType, '', label, lastSyncMs);

      if (lastSyncMs > 0 && maxUpdateTime > 0 && maxUpdateTime <= lastSyncMs) {
        if (this.hasLocalFiles(label)) {
          this.onProgress({ type: 'folder-skipped', folder: label });
          return { created: 0, overwritten: 0, skipped: 0, entirelySkipped: true };
        }
        this.log(`[${label}] Local files missing — re-downloading despite no tablet changes`);
      }
    }

    const fileName = `${label}.zip`;

    // 1. Trigger packaging
    this.log(`[${label}] Packaging...`);
    const pkgData = await this.get(
      `/packageFile?appType=${appType}&fileName=${encodeURIComponent(fileName)}&isFolder=true&fileFormat=zip`
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

    // 5. Extract — skip individual unchanged files
    const counts = await this.extractZip(tmpZip, label);

    // 6. Cleanup
    this.deleteSafe(tmpZip);

    // 7. Persist the tablet's own maxUpdateTime (not PC clock) so next run's
    //    comparison is clock-independent and survives tablet/PC time drift.
    this.syncState[appType] = maxUpdateTime > 0 ? maxUpdateTime : Date.now();
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

    const url = `${this.tabletUrl}/download?filePath=${encodeURIComponent(filePath)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);

    const total    = parseInt(res.headers.get('content-length') || String(fileSize), 10);
    let   received = 0;

    this.onProgress({ type: 'download-start', folder: label });

    const writer = fs.createWriteStream(destPath);
    const reader = res.body.getReader();

    return new Promise((resolve, reject) => {
      const pump = async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            writer.write(Buffer.from(value));
            received += value.length;
            this.onProgress({ type: 'download', folder: label, received, total });
          }
          writer.end();
          writer.on('finish', resolve);
          writer.on('error', reject);
        } catch (err) { writer.destroy(); reject(err); }
      };
      pump();
    });
  }

  /**
   * Extracts the ZIP. When `incremental` is true, skips files whose local
   * mtime is >= the ZIP entry's mtime (file unchanged since last sync).
   *
   * @param {string} zipPath
   * @param {string} label
   * @returns {Promise<{created, overwritten, skipped}>}
   */
  async extractZip(zipPath, label) {
    this.log(`[${label}] Extracting...`);
    const entries = new AdmZip(zipPath).getEntries();
    let created = 0, overwritten = 0, skipped = 0;

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const destFile = path.join(this.outputDir, entry.entryName);
      fs.mkdirSync(path.dirname(destFile), { recursive: true });

      const existed = fs.existsSync(destFile);
      if (existed && this.incremental) {
        const localMtimeMs = fs.statSync(destFile).mtimeMs;
        const entryTime    = entry.header.time;
        const entryMs      = entryTime instanceof Date ? entryTime.getTime() : 0;
        if (entryMs > 0 && localMtimeMs >= entryMs) { skipped++; continue; }
      }

      const action = existed ? 'Overwritten' : 'Created';
      fs.writeFileSync(destFile, entry.getData());
      if (existed) overwritten++; else created++;

      this.newHistory.push({
        date: new Date().toISOString(), folder: label, filePath: destFile, action,
      });
    }

    return { created, overwritten, skipped };
  }

  /**
   * Returns true if the local output subfolder for `label` exists and contains
   * at least one file (recursively). Used to detect when the user deleted local
   * files so we can force a re-download even when the tablet reports no changes.
   * @param {string} label
   * @returns {boolean}
   */
  hasLocalFiles(label) {
    const dir = path.join(this.outputDir, label);
    if (!fs.existsSync(dir)) return false;
    const scan = (d) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        if (entry.isFile()) return true;
        if (entry.isDirectory() && scan(path.join(d, entry.name))) return true;
      }
      return false;
    };
    return scan(dir);
  }

  /** @param {string} filePath */
  deleteSafe(filePath) { try { fs.unlinkSync(filePath); } catch {} }
}

module.exports = SyncEngine;
