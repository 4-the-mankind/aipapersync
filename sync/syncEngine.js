'use strict';

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const APP_TYPES = [
  { appType: 'APP_PAPER',    label: 'Paper' },
  { appType: 'APP_DAILY',    label: 'Daily' },
  { appType: 'APP_MEETING',  label: 'Meeting' },
  { appType: 'APP_LEARNING', label: 'Learning' },
  { appType: 'APP_PICKING',  label: 'Picking' },
  { appType: 'APP_MEMO',     label: 'Memo' },
];

const POLL_INTERVAL_MS = 2000;
const EMPTY_FOLDER_THRESHOLD = 3;

class SyncEngine {
  constructor({ tabletUrl, outputDir, noteFormat, onProgress, onLog }) {
    this.tabletUrl = tabletUrl.replace(/\/$/, '');
    this.outputDir = outputDir;
    this.noteFormat = noteFormat || 'pdf';
    this.onProgress = onProgress || (() => {});
    this.onLog = onLog || (() => {});
    this.aborted = false;
    this.newHistory = [];
  }

  abort() {
    this.aborted = true;
  }

  log(msg) {
    this.onLog(msg);
  }

  async get(endpoint) {
    const url = `${this.tabletUrl}${endpoint}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${endpoint}`);
    return res.json();
  }

  async checkConnectivity() {
    try {
      const res = await fetch(`${this.tabletUrl}/getChildFolderList?appType=root&folderId=&folderName=Home&language=en`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async run() {
    this.aborted = false;
    this.newHistory = [];
    const results = { total: 0, created: 0, overwritten: 0, errors: [] };

    for (let i = 0; i < APP_TYPES.length; i++) {
      if (this.aborted) break;
      const { appType, label } = APP_TYPES[i];

      try {
        this.log(`[${label}] Starting...`);
        this.onProgress({ type: 'folder-start', folder: label, folderIndex: i, folderTotal: APP_TYPES.length });

        const folderResult = await this.syncFolder(appType, label);
        results.created += folderResult.created;
        results.overwritten += folderResult.overwritten;
        results.total += folderResult.created + folderResult.overwritten;

        this.onProgress({ type: 'folder-done', folder: label, ...folderResult });
        this.log(`[${label}] Done — ${folderResult.created} created, ${folderResult.overwritten} overwritten`);
      } catch (err) {
        this.log(`[${label}] Error: ${err.message}`);
        results.errors.push({ folder: label, error: err.message });
        this.onProgress({ type: 'folder-error', folder: label, error: err.message });
      }
    }

    return { ...results, history: this.newHistory };
  }

  async syncFolder(appType, label) {
    const childFileFormat = this.noteFormat === 'pdf' ? 'pdf' : 'note';
    const fileName = `${label}.zip`;

    // Step 1: trigger packaging
    this.log(`[${label}] Packaging...`);
    const pkgData = await this.get(
      `/packageFile?appType=${appType}&fileName=${encodeURIComponent(fileName)}&isFolder=true&fileUrl=&folderId=&fileFormat=zip&childFileFormat=${childFileFormat}`
    );

    if (pkgData.code !== 200) {
      throw new Error(`packageFile failed: code ${pkgData.code}`);
    }

    const filePath = pkgData.data;

    // Step 2: poll progress
    this.log(`[${label}] Waiting for packaging to complete...`);
    await this.pollProgress(appType, label, filePath);

    if (this.aborted) return { created: 0, overwritten: 0 };

    // Step 3: verify ready
    const checkData = await this.get(`/checkDownloadFile?filePath=${encodeURIComponent(filePath)}`);
    if (!checkData.data || !checkData.data.fileSize) {
      throw new Error('checkDownloadFile returned no file size — ZIP may be empty');
    }
    this.log(`[${label}] ZIP ready (${Math.round(checkData.data.fileSize / 1024)} KB)`);

    // Step 4: download to temp
    const tmpDir = path.join(this.outputDir, '.tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmpZip = path.join(tmpDir, fileName);

    await this.downloadFile(filePath, tmpZip, label);

    if (this.aborted) {
      this.deleteSafe(tmpZip);
      return { created: 0, overwritten: 0 };
    }

    // Step 5: extract
    const { created, overwritten } = await this.extractZip(tmpZip, label, appType);

    // Step 6: cleanup
    this.deleteSafe(tmpZip);

    return { created, overwritten };
  }

  async pollProgress(appType, label, fileUrl) {
    let emptyCount = 0;

    for (;;) {
      if (this.aborted) return;

      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

      const data = await this.get(
        `/packageFolderProgress?appType=${appType}&fileUrl=${encodeURIComponent(fileUrl)}`
      );

      const progress = data.data || {};
      const packaged = progress.childCompleteCount ?? 0;
      const total = progress.childTotal ?? 0;

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

  async downloadFile(filePath, destPath, label) {
    this.log(`[${label}] Downloading ZIP...`);
    const url = `${this.tabletUrl}/download?filePath=${encodeURIComponent(filePath)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(120000) });

    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);

    const total = parseInt(res.headers.get('content-length') || '0', 10);
    let received = 0;

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
            if (total > 0) {
              this.onProgress({ type: 'download', folder: label, received, total });
            }
          }
          writer.end();
          writer.on('finish', resolve);
          writer.on('error', reject);
        } catch (err) {
          writer.destroy();
          reject(err);
        }
      };
      pump();
    });
  }

  async extractZip(zipPath, label, appType) {
    this.log(`[${label}] Extracting...`);
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    let created = 0;
    let overwritten = 0;

    for (const entry of entries) {
      if (entry.isDirectory) continue;

      const entryName = entry.entryName;
      const destFile = path.join(this.outputDir, entryName);
      const destDir = path.dirname(destFile);

      fs.mkdirSync(destDir, { recursive: true });

      const existed = fs.existsSync(destFile);
      const action = existed ? 'Overwritten' : 'Created';

      fs.writeFileSync(destFile, entry.getData());

      if (existed) overwritten++; else created++;

      const record = {
        date: new Date().toISOString(),
        folder: label,
        filePath: destFile,
        action,
      };
      this.newHistory.push(record);
    }

    return { created, overwritten };
  }

  deleteSafe(filePath) {
    try { fs.unlinkSync(filePath); } catch {}
  }
}

module.exports = SyncEngine;
