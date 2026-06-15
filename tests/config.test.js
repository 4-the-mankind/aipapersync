'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const TEST_DATA_DIR = path.join(os.tmpdir(), 'aipapersync-jest', 'userData');

beforeEach(() => fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true }));
afterAll(()  => fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true }));

const { loadConfig, saveConfig } = require('../main/config');

// ── Per-setting defaults ──────────────────────────────────────────────────────

describe('per-setting defaults (no file on disk)', () => {
  const DEFAULTS = [
    ['tabletUrl',        'http://192.168.0.69:8090'],
    ['outputDir',        '%USERPROFILE%\\Downloads'],
    ['noteFormat',       'pdf'],
    ['startWithWindows', true],
    ['syncOnStartup',    false],
    ['closeBehavior',    'tray'],
    // incremental has no hardcoded default — engine/renderer treat undefined as true via !== false
    ['incremental',      undefined],
  ];

  for (const [key, expected] of DEFAULTS) {
    it(`${key} defaults to ${JSON.stringify(expected)}`, () => {
      expect(loadConfig()[key]).toBe(expected);
    });
  }
});

// ── Per-setting save / load round-trip ────────────────────────────────────────

describe('per-setting round-trip (save → load)', () => {
  const CASES = [
    ['tabletUrl',        'http://10.0.0.1:8090'],
    ['outputDir',        'D:\\Sync\\Notes'],
    ['noteFormat',       'svg'],
    ['startWithWindows', false],
    ['syncOnStartup',    true],
    ['closeBehavior',    'quit'],
    ['incremental',      false],
  ];

  for (const [key, value] of CASES) {
    it(`${key}: saved value ${JSON.stringify(value)} is reloaded correctly`, () => {
      saveConfig({ [key]: value });
      expect(loadConfig()[key]).toBe(value);
    });
  }
});

// ── General loadConfig behaviour ──────────────────────────────────────────────

describe('loadConfig', () => {
  it('returns defaults when no file exists', () => {
    const cfg = loadConfig();
    expect(cfg.tabletUrl).toBe('http://192.168.0.69:8090');
    expect(cfg.noteFormat).toBe('pdf');
    expect(cfg.closeBehavior).toBe('tray');
    expect(cfg.startWithWindows).toBe(true);
  });

  it('merges saved values with defaults — missing keys use default', () => {
    saveConfig({ tabletUrl: 'http://10.0.0.5:8090' });
    const cfg = loadConfig();
    expect(cfg.tabletUrl).toBe('http://10.0.0.5:8090');
    expect(cfg.noteFormat).toBe('pdf');
    expect(cfg.closeBehavior).toBe('tray');
  });

  it('handles UTF-8 BOM prefix without crashing', () => {
    // BOM (﻿) makes JSON.parse throw — loadConfig must strip it
    const p = path.join(TEST_DATA_DIR, 'config.json');
    fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
    fs.writeFileSync(p, '﻿{"tabletUrl":"http://bom.local:8090"}', 'utf8');
    const cfg = loadConfig();
    expect(cfg.tabletUrl).toBe('http://bom.local:8090');
  });

  it('falls back to defaults on malformed JSON', () => {
    const p = path.join(TEST_DATA_DIR, 'config.json');
    fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
    fs.writeFileSync(p, '{not valid json', 'utf8');
    const cfg = loadConfig();
    expect(cfg.tabletUrl).toBe('http://192.168.0.69:8090');
  });

  it('round-trips all fields correctly', () => {
    const original = {
      tabletUrl:        'http://1.2.3.4:9000',
      outputDir:        'C:\\Sync',
      noteFormat:       'svg',
      startWithWindows: false,
      syncOnStartup:    true,
      closeBehavior:    'quit',
    };
    saveConfig(original);
    expect(loadConfig()).toMatchObject(original);
  });
});
