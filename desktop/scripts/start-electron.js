'use strict';

/**
 * Launches Electron with a clean environment.
 *
 * Terminals hosted inside another Electron app - VS Code's integrated terminal,
 * Claude Code, Cursor - export ELECTRON_RUN_AS_NODE=1 for their own tooling.
 * If that leaks into our child process, Electron starts as plain Node:
 * require('electron') then returns the path to the binary instead of the API,
 * and the app dies with "Cannot read properties of undefined (reading
 * 'requestSingleInstanceLock')".
 *
 * Usage:
 *   node scripts/start-electron.js                        # production-ish run
 *   node scripts/start-electron.js http://localhost:5173   # point at Vite
 */

const { spawn } = require('child_process');

// In a Node context this resolves to the Electron executable path.
const electronPath = require('electron');

if (typeof electronPath !== 'string') {
  console.error('Could not resolve the Electron binary. Run `npm install` first.');
  process.exit(1);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const [devServer, ...rest] = process.argv.slice(2);
if (devServer) env.CLEAR_DEV_SERVER = devServer;

const child = spawn(electronPath, ['.', ...rest], {
  stdio: 'inherit',
  env,
  cwd: require('path').join(__dirname, '..'),
});

child.on('close', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error('Failed to start Electron:', error.message);
  process.exit(1);
});
