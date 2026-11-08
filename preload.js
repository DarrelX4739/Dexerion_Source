// Preload: controlled bridge for the shell UI + future AI hook point.
// contextIsolated; the shell never gets raw Node access. Future Dexerion
// Assist/Agent/Vision systems will call window.dexerion.* which routes
// through permission checks in the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dexerion', {
  invoke: (ch, ...args) => ipcRenderer.invoke(ch, ...args),
  on: (ch, fn) => ipcRenderer.on(ch, (e, ...a) => fn(...a)),
  // Namespaced future-AI capability API (deny-by-default, see permissions.js).
  ai: {
    request: (perm) => ipcRenderer.invoke('dex:ai-request', perm),
  },
});
