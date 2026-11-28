'use strict';

const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('setup', {
  info: () => ipcRenderer.invoke('setup:info'),
  browse: folder => ipcRenderer.invoke('setup:browse', folder),
  target: folder => ipcRenderer.invoke('setup:target', folder),
  install: folder => ipcRenderer.invoke('setup:install', folder),
  finish: launch => ipcRenderer.invoke('setup:finish', launch),
  minimize: () => ipcRenderer.invoke('setup:minimize'),
  close: () => ipcRenderer.invoke('setup:close')
});
