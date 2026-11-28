'use strict';

// Compatibility experiment only. The package, browser settings, and
// credential store are unchanged; this app sees only synthetic loopback data.
const { app, BaseWindow, WebContentsView, session, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');

const root = process.argv.find((s) => s.startsWith('--ram-compat='))?.slice('--ram-compat='.length);
const arm = process.argv.find((s) => /^sandbox-[01]$/.test(s));
assert(root && arm && path.basename(root).startsWith('dex-renderer-compat-'));
assert.equal(process.versions.electron, '44.4.5');
const sandbox = arm === 'sandbox-1';
const dir = path.join(root, 'profile');
fs.mkdirSync(dir);
app.setPath('userData', dir);
const preload = path.resolve(__dirname, '../../code/code/preload.js');
const windows = [];
const views = [];
const pages = new Map();
const events = [];
const seen = new Set();
const portServer = http.createServer((req, res) => {
  if (req.headers.host !== new URL(base).host || !['/login', '/popup'].includes(req.url)) {
    res.writeHead(404).end(); return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' })
    .end('<!doctype html><meta charset=utf-8><title>Local compatibility fixture</title>' +
      '<form><input id="username" autocomplete="username"><input id="password" type="password" autocomplete="current-password"><button>Submit</button></form>' +
      '<a id="popup" href="/popup" target="_blank">Open test popup</a>');
});
let base;
function allow(e, origin) {
  const row = pages.get(e.sender.id);
  assert(row && origin === base && e.senderFrame && new URL(e.senderFrame.url).origin === base);
  return row;
}
ipcMain.handle('dex:login-query', (e, { origin }) => {
  const row = allow(e, origin);
  events.push(['query', row]);
  return [{ username: 'local-fixture', password: 'test-only-value' }];
});
ipcMain.handle('dex:login-capture', (e, { origin, username, password }) => {
  const row = allow(e, origin);
  assert.equal(username, 'local-fixture');
  assert.equal(password, 'test-only-value');
  events.push(['capture', row]);
  return true;
});
ipcMain.handle('dex:google-detected', (e, { origin }) => {
  events.push(['sign-in-notification', allow(e, origin)]);
  return true;
});
async function usePage(wc, kind) {
  assert.equal(new URL(wc.getURL()).origin, base);
  const metric = app.getAppMetrics().find((m) => m.pid === wc.getOSProcessId());
  assert.equal(metric?.sandboxed, sandbox, 'Unexpected OS sandbox status for ' + kind);
  pages.set(wc.id, kind);
  const proof = await wc.executeJavaScript(`(async () => {
    const api = window.dexerion;
    const credentials = await api.invoke('dex:login-query', { origin: location.origin });
    const u = document.querySelector('#username'), p = document.querySelector('#password');
    u.value = credentials[0].username;
    p.value = credentials[0].password;
    let saved;
    const form = document.querySelector('form');
    form.addEventListener('submit', (e) => { e.preventDefault(); saved = api.invoke('dex:login-capture',
      { origin: location.origin, username: u.value, password: p.value }); }, { once: true });
    form.requestSubmit();
    const signIn = await api.invoke('dex:google-detected', { origin: location.origin });
    const denied = await api.invoke('dex:get-state').then(() => false, (e) => /not available/.test(e.message));
    return { saved: await saved, signIn, denied, node: typeof process !== 'undefined' || typeof require !== 'undefined' };
  })()`);
  assert.deepEqual(proof, { saved:true, signIn:true, denied:true, node:false });
}
async function page(parent, partition, attach) {
  const view = new WebContentsView({ webPreferences: {
    partition, sandbox, preload, contextIsolation: true, nodeIntegration: false,
  } });
  views.push(view);
  view.setBounds({ x:0, y:0, width: 930, height: 650 });
  if (attach) parent.contentView.addChildView(view);
  await view.webContents.loadURL(base + '/login');
  return view.webContents;
}

app.whenReady().then(async () => {
  portServer.listen(0, '127.0.0.1');
  await once(portServer, 'listening');
  base = 'http://compat.localhost:' + portServer.address().port;
  const partition = 'persist:compat-a';
  const extension = path.join(dir, 'fixture-extension');
  fs.mkdirSync(extension);
  fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify({
    manifest_version: 3, name: 'Local RAM compatibility fixture', version: '1.0.0',
    content_scripts: [{ matches: ['http://compat.localhost/*'], js: ['content.js'], run_at: 'document_end' }],
  }));
  fs.writeFileSync(path.join(extension, 'content.js'), "document.documentElement.dataset.localExtension = 'ready';");
  await session.fromPartition(partition).extensions.loadExtension(extension);
  const w = new BaseWindow({ width: 940, height: 700, show: true });
  windows.push(w);
  const primary = await page(w, partition, true);
  const peer = await page(w, partition, false);
  const other = await page(w, 'persist:compat-b', false);
  const marker = "(async()=>{for(let i=0;i<20;i++){if(document.documentElement.dataset.localExtension==='ready')return true;await new Promise(r=>setTimeout(r,50));}return false;})()";
  assert.equal(await primary.executeJavaScript(marker), true);
  assert.equal(await other.executeJavaScript("!!document.documentElement.dataset.localExtension"), false);
  seen.add('partition-scoped extension content script');
  await primary.executeJavaScript("localStorage.setItem('ram-compat','local-only')");
  assert.equal(await peer.executeJavaScript("localStorage.getItem('ram-compat')"), 'local-only');
  assert.equal(await other.executeJavaScript("localStorage.getItem('ram-compat')"), null);
  seen.add('account partition storage isolation');

  primary.setWindowOpenHandler(({ url }) => url === base + '/popup'
    ? { action: 'allow', overrideBrowserWindowOptions: { show: false, webPreferences: {
      partition, preload, sandbox, contextIsolation: true, nodeIntegration: false,
    } } } : { action: 'deny' });
  const created = once(primary, 'did-create-window');
  await primary.executeJavaScript("document.querySelector('#popup').click()", true);
  const [popup] = await created;
  windows.push(popup);
  const wc = popup.webContents;
  if (wc.isLoadingMainFrame() || !wc.getURL()) await once(wc, 'did-finish-load');
  assert.equal(wc.session, primary.session);
  await usePage(primary, 'tab');
  await usePage(wc, 'popup');
  assert.equal(new Set(events.map(x => x.join(':'))).size, 6);
  seen.add('popup and shared session');
  seen.add('synthetic credential and sign-in bridge in tab and popup');
  seen.add('web bridge denies privileged channel and exposes no Node globals');
  const finished = path.join(root, 'result.json');
  fs.writeFileSync(finished, JSON.stringify({ arm, sandbox, tests: [...seen], electron: process.versions.electron }));
  for (const v of views) v.webContents.close();
  for (const win of windows.reverse()) if (!win.isDestroyed()) win.destroy();
  portServer.close();
  app.quit();
}).catch((e) => { console.error(e.stack); app.exit(1); });
