'use strict';

const fs = require('fs');
const path = require('path');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

let stream = null;
let logFile = null;
const ring = []; // last 300 lines, surfaced in the dashboard
const listeners = new Set();

const init = (userDataPath) => {
  try {
    const dir = path.join(userDataPath, 'logs');
    fs.mkdirSync(dir, { recursive: true });
    logFile = path.join(dir, 'clear.log');

    // keep the log from growing forever
    try {
      if (fs.existsSync(logFile) && fs.statSync(logFile).size > 5 * 1024 * 1024) {
        fs.renameSync(logFile, `${logFile}.1`);
      }
    } catch {
      /* rotation is best effort */
    }

    stream = fs.createWriteStream(logFile, { flags: 'a' });
  } catch (error) {
    // Logging must never take the app down.
    stream = null;
  }
};

const write = (level, scope, message, meta) => {
  const threshold = LEVELS[process.env.CLEAR_LOG_LEVEL] || LEVELS.info;
  const entry = {
    ts: new Date().toISOString(),
    level,
    scope,
    msg: message,
    ...(meta && Object.keys(meta).length ? meta : {}),
  };

  ring.push(entry);
  if (ring.length > 300) ring.shift();
  listeners.forEach((fn) => {
    try {
      fn(entry);
    } catch {
      /* ignore listener errors */
    }
  });

  if (LEVELS[level] < threshold) return;

  const line = `${JSON.stringify(entry)}\n`;
  if (stream) stream.write(line);
  if (level === 'error' || level === 'warn') process.stderr.write(line);
  else process.stdout.write(line);
};

const scoped = (scope) => ({
  debug: (msg, meta) => write('debug', scope, msg, meta),
  info: (msg, meta) => write('info', scope, msg, meta),
  warn: (msg, meta) => write('warn', scope, msg, meta),
  error: (msg, meta) => write('error', scope, msg, meta),
});

module.exports = {
  init,
  scoped,
  recent: (n = 100) => ring.slice(-n),
  onEntry: (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  logFilePath: () => logFile,
};
