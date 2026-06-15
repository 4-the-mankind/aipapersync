'use strict';

const fs           = require('fs');
const { dataFile } = require('./paths');

const MAX_BYTES    = 2 * 1024 * 1024;
const MAX_ARCHIVES = 3;

function logPath() { return dataFile('app.log'); }

function rotate() {
  const p = logPath();
  for (let i = MAX_ARCHIVES; i >= 1; i--) {
    const src  = `${p}.${i}`;
    const dest = `${p}.${i + 1}`;
    if (fs.existsSync(src)) {
      if (i === MAX_ARCHIVES) fs.unlinkSync(src);
      else fs.renameSync(src, dest);
    }
  }
  fs.renameSync(p, `${p}.1`);
}

function write(level, msg) {
  try {
    const p = logPath();
    fs.mkdirSync(require('path').dirname(p), { recursive: true });
    if (fs.existsSync(p) && fs.statSync(p).size >= MAX_BYTES) rotate();
    const ts   = new Date().toISOString();
    const line = `${ts} [${level.padEnd(5)}] ${String(msg).replace(/\n/g, ' ')}\n`;
    fs.appendFileSync(p, line, 'utf8');
  } catch {
    // Never let logging crash the app.
  }
}

function info(msg)  { write('INFO',  msg); }
function warn(msg)  { write('WARN',  msg); }
function error(msgOrErr) {
  if (msgOrErr instanceof Error) {
    write('ERROR', `${msgOrErr.message} | stack: ${msgOrErr.stack}`);
  } else {
    write('ERROR', msgOrErr);
  }
}

module.exports = { info, warn, error, logPath };
