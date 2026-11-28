'use strict';
const { _electron: electron, test, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');

test('the installed-format application boots the shell and navigates a local page', async () => {
  test.skip(!process.env.DEX_PACKAGED_APP, 'An unpacked installation-format executable is required.');
  const exe = path.resolve(process.cwd(), process.env.DEX_PACKAGED_APP);
  expect(fs.existsSync(exe)).toBe(true);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-packaged-smoke-'));
  const server = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<title>Packaged Dexerion fixture</title><h1>Only a local test page</h1>');
  });
  let app;
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = 'http://127.0.0.1:' + server.address().port + '/packaged';
    app = await electron.launch({
      executablePath: exe, cwd: path.dirname(exe),
      args: ['--user-data-dir=' + profile, '--gpu=off', ...(process.platform === 'linux' ? ['--ozone-platform=x11'] : [])],
      timeout: 45000,
    });
    const win = await app.firstWindow({ timeout: 45000 });
    const info = await app.evaluate(({ app }) => ({
      packaged: app.isPackaged, archive: app.getAppPath(), electron: process.versions.electron,
    }));
    expect(info.packaged).toBe(true);
    expect(info.archive).toMatch(/app\.asar$/);
    expect(info.electron).toBe(require('electron/package.json').version);
    await expect(win.locator('#omnibox')).toBeVisible();
    await expect(win.locator('script[src$="lucide-shell.js"]')).toHaveCount(1);
    const id = await win.evaluate(() => window.dexerion.invoke('dex:get-state').then((s) => s.active));
    await win.evaluate(({ id, url }) => window.dexerion.invoke('dex:navigate', id, url), { id, url });
    await expect.poll(() => win.evaluate((id) => window.dexerion.invoke('dex:get-state')
      .then((s) => s.tabs.find((t) => t.id === id)?.title), id)).toBe('Packaged Dexerion fixture');
  } finally {
    if (app) await app.close().catch(() => {});
    server.close();
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  }
});
