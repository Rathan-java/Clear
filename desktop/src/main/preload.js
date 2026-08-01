'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * The only bridge between the renderer and Node. Context isolation is on and
 * nodeIntegration is off, so the UI can reach exactly these channels and
 * nothing else.
 */

const INVOKE_CHANNELS = new Set([
  'app:state',
  'app:logs',
  'app:info',
  'settings:get',
  'settings:patch',
  'settings:reset',
  'auth:login',
  'auth:logout',
  'pair:code',
  'devices:list',
  'devices:select',
  'capture:start',
  'capture:stop',
  'capture:toggle',
  'transcript:clear',
  'gemini:test',
  'ask:manual',
  'history:list',
  'connection:reconnect',
  'window:minimise',
  'window:hide',
  'window:setAlwaysOnTop',
  'app:quit',
  'system:openLogs',
  'system:openExternal',
]);

const EVENT_CHANNELS = new Set(['app:state', 'app:log', 'app:answer', 'app:notice', 'capture:command']);

contextBridge.exposeInMainWorld('clear', {
  invoke: (channel, payload) => {
    if (!INVOKE_CHANNELS.has(channel)) {
      return Promise.reject(new Error(`Blocked IPC channel: ${channel}`));
    }
    return ipcRenderer.invoke(channel, payload);
  },

  on: (channel, listener) => {
    if (!EVENT_CHANNELS.has(channel)) throw new Error(`Blocked IPC channel: ${channel}`);
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },

  /** Audio engine -> main. Only the capture bridge uses this. */
  sendCapture: (message) => ipcRenderer.send('capture:message', message),

  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});
