// Preload: controlled bridge for the shell UI + future AI hook point.
// contextIsolated; the shell never gets raw Node access. Future Dexerion
// Assist/Agent/Vision systems will call window.dexerion.* which routes
// through permission checks in the main process.
const { contextBridge, ipcRenderer } = require('electron');

// Dexerion's own renderers may call any channel: the shell (file://) and the
// internal pages (dexerion://) are first-party code, and every privileged
// handler re-checks the sender in the main process (needChrome/chromeSender)
// before it acts.
//
// A page on the WEB is different. It runs in the same preload, so without a
// rule here a hostile site could call window.dexerion.invoke() with any
// channel name it liked and let the main process decide. Only three channels
// are actually injected into web pages: the password manager's save prompt
// and its autofill, and the "continue with Google" email detector. Everything
// else is refused in the page itself, before it reaches the main process.
const WEB_CHANNELS = new Set([
  'dex:login-capture',   // password manager: offer to save
  'dex:login-query',     // password manager: autofill
  'dex:google-detected', // the Google sign-in email detector
]);

function isWebPage() {
  try {
    const proto = String(window.location.protocol || '').toLowerCase();
    return proto !== 'file:' && proto !== 'dexerion:';
  } catch {
    // If the protocol cannot be read, treat the page as untrusted.
    return true;
  }
}

// Main-process -> renderer events have their own allowlist. They are one-way
// notifications for first-party pages only; web pages keep the WEB_CHANNELS
// restriction above and cannot subscribe here.
const RENDERER_EVENTS = new Set([
  'dex:overlay-fullscreen-changed', // preview overlay button label/aria-pressed
]);

function refused(ch) {
  return new Error('Dexerion: "' + ch + '" is not available to this page.');
}

contextBridge.exposeInMainWorld('dexerion', {
  invoke: (ch, ...args) => {
    if (isWebPage() && !WEB_CHANNELS.has(ch)) return Promise.reject(refused(ch));
    return ipcRenderer.invoke(ch, ...args);
  },
  on: (ch, fn) => {
    if (isWebPage() && !WEB_CHANNELS.has(ch)) return;
    ipcRenderer.on(ch, (e, ...a) => fn(...a));
  },
  // Allowlisted, one-way renderer events. Kept separate from `on` so adding a
  // main->renderer notification never widens the web-page channel set.
  onRendererEvent: (ch, fn) => {
    if (isWebPage() || !RENDERER_EVENTS.has(ch)) return;
    ipcRenderer.on(ch, (e, ...a) => fn(...a));
  },
  // Namespaced future-AI capability API (deny-by-default, see permissions.js).
  ai: {
    request: (perm) => {
      if (isWebPage()) return Promise.reject(refused('dex:ai-request'));
      return ipcRenderer.invoke('dex:ai-request', perm);
    },
  },
});
