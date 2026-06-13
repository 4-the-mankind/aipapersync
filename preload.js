'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Config
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),

  // History
  getHistory: () => ipcRenderer.invoke('history:get'),
  clearHistory: () => ipcRenderer.invoke('history:clear'),

  // Sync
  syncNow: () => ipcRenderer.invoke('sync:now'),
  abortSync: () => ipcRenderer.invoke('sync:abort'),

  // Connectivity
  checkConnectivity: () => ipcRenderer.invoke('tablet:ping'),

  // Startup
  setStartWithWindows: (enabled) => ipcRenderer.invoke('startup:set', enabled),

  // Frameless window controls
  windowControl: (action) => ipcRenderer.send(`window:${action}`),

  // Events from main → renderer
  on: (channel, cb) => {
    const allowed = ['sync:progress', 'sync:log', 'sync:complete', 'sync:error'];
    if (allowed.includes(channel)) {
      ipcRenderer.on(channel, (_e, ...args) => cb(...args));
    }
  },
  off: (channel, cb) => {
    ipcRenderer.removeListener(channel, cb);
  },
});
