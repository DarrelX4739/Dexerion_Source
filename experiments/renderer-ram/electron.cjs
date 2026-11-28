'use strict';
const { app, BaseWindow, WebContentsView, ipcMain } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');

const args = process.argv.slice(2);
const kind = args.find((v) => /^[01]:[19]$/.test(v));
const control = args.find((v) => v.startsWith('--ram-control='))?.slice('--ram-control='.length);
assert(kind && control && path.basename(control).startsWith('dex-renderer-ram-'));
const [sandbox, count] = kind.split(':').map(Number);
assert.equal(process.versions.electron, '44.4.5');
const profile = path.join(control, 'profile');
app.setPath('userData', profile);
const preload = path.resolve(__dirname, '../../code/code/preload.js');

const views = [];
const allowedOrigins = new Map();
const checked = new Map();
function handler(channel) {
  ipcMain.handle(channel, (event) => {
    const allowed = allowedOrigins.get(event.sender.id);
    assert(allowed && event.senderFrame && new URL(event.senderFrame.url).origin === allowed);
    const log = checked.get(event.sender.id) ?? new Set();
    log.add(channel); checked.set(event.sender.id, log);
    return channel;
  });
}
const channels = ['dex:login-capture', 'dex:login-query', 'dex:google-detected'];
for (const channel of channels) handler(channel);
const knownPages = new Set();
const server = http.createServer((req, res) => {
  if (!knownPages.has(req.headers.host) || req.url !== '/fixture') {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' })
    .end('<!doctype html><meta charset=utf-8><title>Renderer memory fixture</title><main>Local renderer measurement</main>');
});

app.whenReady().then(async () => {
  assert.equal(app.getPath('userData'), profile);
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  const win = new BaseWindow({ show: false, width: 1000, height: 740 });
  const ready = await Promise.all(Array.from({length: count}, async (_, i) => {
    const host = 'fixture-' + i + '.localhost:' + port;
    knownPages.add(host);
    const url = 'http://' + host + '/fixture';
    const view = new WebContentsView({ webPreferences: {
      preload, sandbox: Boolean(sandbox), contextIsolation: true, nodeIntegration: false,
      spellcheck: true,
    } });
    const wc = view.webContents;
    views.push(view);
    allowedOrigins.set(wc.id, new URL(url).origin);
    view.setBounds({ x: 0, y: 0, width: 960, height: 680 });
    if (i === 0) win.contentView.addChildView(view);
    await wc.loadURL(url);
    assert.equal(wc.getURL(), url);
    const proof = await wc.executeJavaScript(`(async () => {
      const api = window.dexerion;
      const names = ${JSON.stringify(channels)};
      const results = await Promise.all(names.map(k => api.invoke(k)));
      const denied = await api.invoke('dex:get-state').then(() => false, e => /not available/.test(e.message));
      return { results, denied, hasNode: typeof require !== 'undefined' || typeof process !== 'undefined',
        rendered: document.querySelector('main')?.textContent === 'Local renderer measurement' };
    })()`);
    assert.deepEqual(proof, { results: channels, denied: true, hasNode: false, rendered: true });
    assert.equal(checked.get(wc.id)?.size, 3);
    const pid = wc.getOSProcessId();
    assert(Number.isInteger(pid) && pid > 0);
    return { pid, url };
  }));
  assert.equal(new Set(ready.map(v => v.pid)).size, count, 'a renderer was shared');
  win.show();
  const wc = views[0].webContents;
  const visible = await wc.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => resolve(document.visibilityState)))');
  assert.equal(visible, 'visible');
  fs.writeFileSync(path.join(control, 'ready.tmp'), JSON.stringify({
    appPid: process.pid, electron: process.versions.electron, chromium: process.versions.chrome,
    sandbox: !!sandbox, count, tabs: ready, visible, bridgeChannels: channels.length,
  }));
  fs.renameSync(path.join(control, 'ready.tmp'), path.join(control, 'ready.json'));
  const timer = setInterval(() => {
    if (!fs.existsSync(path.join(control, 'stop'))) return;
    clearInterval(timer);
    for (const v of views) v.webContents.close();
    win.destroy();
    server.close();
    app.quit();
  }, 100);
}).catch((e) => { console.error(e.stack); app.exit(1); });
