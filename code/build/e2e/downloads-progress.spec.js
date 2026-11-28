'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { test, expect } = require('@playwright/test');
const { launchDexerion } = require('./app');

test('a real transfer updates download progress without rebuilding completed history', async () => {
  const total = 192 * 1024;
  let transfer;
  const server = http.createServer((req, res) => {
    if (req.url !== '/transfer') { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="live-fixture.bin"', 'Content-Length': total });
    transfer = res;
    res.write(Buffer.alloc(8 * 1024));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let launched;
  try {
    launched = await launchDexerion({ seedProfile(profile) {
      const dir = path.join(profile, 'fixture-downloads');
      fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ downloadDir: dir }));
      fs.writeFileSync(path.join(profile, 'downloads.json'), JSON.stringify([{
        id: 'finished-fixture', fileName: 'completed-fixture.txt',
        path: path.join(dir, 'completed-fixture.txt'), received: 8192, total: 8192,
        percent: 1, state: 'completed', active: false, at: Date.now(),
      }]));
    } });
    const { app, win } = launched;
    const inDownloads = script => app.evaluate(async ({ webContents }, expression) => {
      const wc = webContents.getAllWebContents().find(x => /^dexerion:\/\/downloads/.test(x.getURL()));
      return wc ? wc.executeJavaScript(expression).catch(() => null) : null;
    }, script);
    const url = 'http://127.0.0.1:' + server.address().port + '/transfer';
    await win.evaluate(u => window.dexerion.invoke('dex:new-tab', u, false), url);
    await expect.poll(() => Boolean(transfer)).toBe(true);
    await expect.poll(() => inDownloads(`(() => {
      const moving = [...document.querySelectorAll('.dl-row')].find(el => el.querySelector('.dl-title').textContent === 'live-fixture.bin');
      return moving && moving.querySelector('.st').textContent;
    })()`)).toBe('Downloading');
    expect(await inDownloads(`(() => {
      window.__testCompletedDownload = [...document.querySelectorAll('.dl-row')].find(
        el => el.querySelector('.dl-title').textContent === 'completed-fixture.txt');
      return Boolean(window.__testCompletedDownload);
    })()`)).toBe(true);

    transfer.write(Buffer.alloc(88 * 1024));
    const view = () => inDownloads(`(() => {
      const rows = [...document.querySelectorAll('.dl-row')];
      const active = rows.find(el => el.querySelector('.dl-title').textContent === 'live-fixture.bin');
      const done = rows.find(el => el.querySelector('.dl-title').textContent === 'completed-fixture.txt');
      return active && done ? {
        status: active.querySelector('.st').textContent,
        percent: active.querySelector('.dl-percent').textContent,
        sameRow: done === window.__testCompletedDownload,
        order: rows.map(el => el.querySelector('.dl-title').textContent)
      } : null;
    })()`);
    await expect.poll(async () => (await view())?.percent).toBe('50%');
    expect(await view()).toEqual({
      status: 'Downloading', percent: '50%', sameRow: true,
      order: ['live-fixture.bin', 'completed-fixture.txt'],
    });
    transfer.end(Buffer.alloc(96 * 1024));
    await expect.poll(async () => (await view())?.status).toBe('Complete');
    expect(await view()).toMatchObject({ percent: '100%', sameRow: true });
  } finally {
    if (transfer && !transfer.writableEnded) transfer.destroy();
    if (launched) {
      await launched.app.close().catch(() => {});
      fs.rmSync(launched.profile, { recursive: true, force: true, maxRetries: 3 });
    }
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
