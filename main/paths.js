'use strict';

const { app } = require('electron');
const path     = require('path');

/**
 * Returns the writable data directory for the app.
 * - Dev + packaged: AppData\Roaming\AIPaper Sync\
 * Called lazily (after app is ready) so app.getPath() is always safe.
 */
function getDataDir() {
  return app.getPath('userData');
}

function dataFile(name) {
  return path.join(getDataDir(), name);
}

module.exports = { getDataDir, dataFile };
