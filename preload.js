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
  syncNow:    () => ipcRenderer.invoke('sync:now'),
  syncStatus: () => ipcRenderer.invoke('sync:status'),
  abortSync:  () => ipcRenderer.invoke('sync:abort'),
  pauseSync:  () => ipcRenderer.invoke('sync:pause'),
  resumeSync: () => ipcRenderer.invoke('sync:resume'),

  // Connectivity
  checkConnectivity: () => ipcRenderer.invoke('tablet:ping'),

  // App state (last sync summary, persists across history clears)
  getAppState: () => ipcRenderer.invoke('appstate:get'),
  getVersion:  () => ipcRenderer.invoke('app:version'),

  // Startup
  setStartWithWindows: (enabled) => ipcRenderer.invoke('startup:set', enabled),

  // Frameless window controls
  windowControl: (action) => ipcRenderer.send(`window:${action}`),

  // DevTools toggle — the IPC handler only exists in dev (not in packaged builds)
  openDevTools: () => ipcRenderer.send('devtools:toggle'),

  // Events from main → renderer
  on: (channel, cb) => {
    const allowed = ['sync:progress', 'sync:log', 'sync:complete', 'sync:error', 'sync:state', 'sync:started'];
    if (allowed.includes(channel)) {
      ipcRenderer.on(channel, (_e, ...args) => cb(...args));
    }
  },
  off: (channel, cb) => {
    ipcRenderer.removeListener(channel, cb);
  },
});
