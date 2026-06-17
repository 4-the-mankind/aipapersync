'use strict';

const fs           = require('fs');
const { dataFile } = require('./paths');

/** @type {import('../types').AppConfig} */
const DEFAULTS = {
  tabletUrl:            'http://192.168.0.69:8090',
  outputDir:            '%USERPROFILE%\\Downloads',
  noteFormat:           'pdf',
  startWithWindows:     true,
  syncOnStartup:        false,
  closeBehavior:        'tray',
  deleteOnTabletDelete: false,
};

function configPath() { return dataFile('config.json'); }

/**
 * Reads and parses config.json from userData.
 * Falls back to {@link DEFAULTS} if the file is missing or malformed.
 * @returns {import('../types').AppConfig}
 */
function loadConfig() {
  try {
    // Strip a UTF-8 BOM if present — Node's JSON.parse chokes on it, which
    // would otherwise silently reset every setting back to DEFAULTS.
    const raw = fs.readFileSync(configPath(), 'utf8').replace(/^﻿/, '');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Serialises `cfg` and writes it to userData/config.json.
 * @param {import('../types').AppConfig} cfg
 */
function saveConfig(cfg) {
  const p = configPath();
  fs.mkdirSync(require('path').dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf8');
}

module.exports = { loadConfig, saveConfig };
