'use strict';

const fs   = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'data', 'config.json');

/** @type {import('../types').AppConfig} */
const DEFAULTS = {
  tabletUrl:        'http://192.168.0.69:8090',
  outputDir:        '%USERPROFILE%\\Downloads',
  noteFormat:       'pdf',
  startWithWindows: true,
  syncOnStartup:    true,
  closeBehavior:    'tray',
};

/**
 * Reads and parses `data/config.json`.
 * Falls back to {@link DEFAULTS} if the file is missing or malformed.
 *
 * @returns {import('../types').AppConfig}
 */
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Serialises `cfg` and writes it to `data/config.json`.
 * Creates the `data/` directory if it does not exist.
 *
 * @param {import('../types').AppConfig} cfg - Config object to persist.
 */
function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

module.exports = { loadConfig, saveConfig };
