'use strict';

const fs   = require('fs');
const path = require('path');

const LOG_PATH     = path.join(__dirname, '..', 'data', 'app.log');
const MAX_BYTES    = 2 * 1024 * 1024;  // rotate at 2 MB
const MAX_ARCHIVES = 3;                 // keep app.log.1 … app.log.3

/** @typedef {'INFO'|'WARN'|'ERROR'} LogLevel */

/**
 * Rotates log files when the current log exceeds {@link MAX_BYTES}.
 * Shifts existing archives up by one (app.log.2 → app.log.3, etc.),
 * drops the oldest if it would exceed {@link MAX_ARCHIVES},
 * then renames the current log to app.log.1.
 */
function rotate() {
  for (let i = MAX_ARCHIVES; i >= 1; i--) {
    const src  = `${LOG_PATH}.${i}`;
    const dest = `${LOG_PATH}.${i + 1}`;
    if (fs.existsSync(src)) {
      if (i === MAX_ARCHIVES) fs.unlinkSync(src);
      else fs.renameSync(src, dest);
    }
  }
  fs.renameSync(LOG_PATH, `${LOG_PATH}.1`);
}

/**
 * Appends a single line to `data/app.log`, rotating first if the file has
 * grown beyond {@link MAX_BYTES}. Creates the file (and `data/` dir) if
 * they do not yet exist.
 *
 * @param {LogLevel} level - Severity label printed in the line prefix.
 * @param {string}   msg   - Message to log. Newlines are collapsed to spaces.
 */
function write(level, msg) {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });

    if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size >= MAX_BYTES) {
      rotate();
    }

    const ts   = new Date().toISOString();
    const line = `${ts} [${level.padEnd(5)}] ${String(msg).replace(/\n/g, ' ')}\n`;
    fs.appendFileSync(LOG_PATH, line, 'utf8');
  } catch {
    // Never let logging crash the app.
  }
}

/**
 * Logs an informational message.
 * @param {string} msg
 */
function info(msg)  { write('INFO',  msg); }

/**
 * Logs a warning.
 * @param {string} msg
 */
function warn(msg)  { write('WARN',  msg); }

/**
 * Logs an error. Accepts an `Error` object or a plain string.
 * When an `Error` is passed the stack trace is appended after the message.
 *
 * @param {string | Error} msgOrErr
 */
function error(msgOrErr) {
  if (msgOrErr instanceof Error) {
    write('ERROR', `${msgOrErr.message} | stack: ${msgOrErr.stack}`);
  } else {
    write('ERROR', msgOrErr);
  }
}

/**
 * Returns the absolute path of the current log file.
 * Useful for exposing it in the UI ("Open log file").
 *
 * @returns {string}
 */
function logPath() { return LOG_PATH; }

module.exports = { info, warn, error, logPath };
