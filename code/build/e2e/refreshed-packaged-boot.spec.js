'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { _electron: electron, expect, test } = require('@playwright/test');
const locked = require('../package-lock.json').packages['node_modules/electron'].version;

test('unpacked refreshed Dexerion opens its shell and navigates a local page', async () => {
  test.skip(!process.env.DEX_REFRESHED_PACKED_EXE, 'Only the packaged workflow supplies its freshly built executable.');
  const exe = path.resolve(process.env.DEX_REFRESHED_PACKED_EXE);
  assert.ok(fs.statSync(exe).isFile());
  const exactArchive = path.join(path.dirname(exe),'resources','app.asar');
  assert.ok(fs.statSync(exactArchive).isFile());
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-refreshed-packed-'));
  let authority;
  const server = http.createServer((req,res) => {
    if (req.method !== 'GET' || req.url !== '/packed' || req.headers.host !== authority) {
      res.writeHead(404,{Connection:'close'}).end(); return;
    }
    res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store', Connection:'close' })
      .end('<!doctype html><meta charset="utf-8"><title>Packaged fixture</title><h1 id="packed-proof">Visible local page</h1>');
  });
  let app;
  try {
    const listened = once(server,'listening');
    server.listen(0,'127.0.0.1');
    await listened;
    authority = '127.0.0.1:' + server.address().port;
    const url = 'http://' + authority + '/packed';
    // Existing test-mode flag prevents alternate first-use network content.
    // Linux uses the standalone Playwright disposable test context; this
    // is functional evidence, not a measurement of stock sandbox or GPU.
    app = await electron.launch({
      cwd:path.dirname(exe), executablePath:exe,
      args:['--user-data-dir=' + profile,'--gpu=off',
        ...(process.platform === 'linux' ? ['--ozone-platform=x11'] : [])],
      env:{...process.env,DEX_AI_TEST:'1'},
      timeout:60000,
    });
    const info = await app.evaluate(({ app }, { profile, exactArchive }) => {
      const path = process.getBuiltinModule('path');
      return { packaged:app.isPackaged, archive:path.relative(exactArchive,app.getAppPath()),
        profile:path.relative(profile,app.getPath('userData')), electron:process.versions.electron };
    }, { profile, exactArchive });
    expect(info).toEqual({ packaged:true, archive:'', profile:'', electron:locked });
    const win = await app.firstWindow({timeout:45000});
    await expect.poll(() => win.url()).toMatch(/\/renderer\/shell\.html(?:[?#].*)?$/);
    const address = win.getByRole('textbox', {name:'Search Dexerion or type a URL'});
    await expect(address).toBeVisible();
    await expect(win.locator('script[src$="/vendor/lucide.min.js"]')).toHaveCount(1);
    await expect.poll(() => win.evaluate(() => typeof window.lucide?.createIcons)).toBe('function');
    await expect(win.getByRole('button',{ name:'New tab', exact:true })).toBeVisible();
    const shellState = () => win.evaluate(() => window.dexerion.invoke('dex:get-state'));
    await expect.poll(async () => {
      const state = await shellState();
      return state.tabs.find(t => t.id === state.active)?.url;
    }).toMatch(/^dexerion:\/\/newtab(?:\/|$)/);
    await expect.poll(() => app.evaluate(async ({ webContents }) => {
      const wc = webContents.getAllWebContents().find(w => /^dexerion:\/\/newtab(?:\/|$)/.test(w.getURL()));
      if (!wc || wc.isLoadingMainFrame()) return false;
      return wc.executeJavaScript('!!document.getElementById("q") && document.visibilityState === "visible"');
    })).toBe(true);
    await win.getByRole('button',{name:'Open Dexerion AI sidebar'}).click();
    await expect(win.locator('#ai-sidebar')).toBeVisible();
    await expect(win.locator('#ai-taskbar-title')).toHaveText('New chat');
    await address.fill(url);
    await address.press('Enter');
    await expect.poll(async () => {
      const state = await shellState();
      const active = state.tabs.find(t => t.id === state.active);
      return {url:active?.url, title:active?.title, loading:active?.loading};
    }).toEqual({url,title:'Packaged fixture',loading:false});
    await expect.poll(() => app.evaluate(async ({ webContents }, url) => {
      const wc = webContents.getAllWebContents().find(w => w.getURL() === url);
      return wc && await wc.executeJavaScript('document.visibilityState === "visible" && document.querySelector("#packed-proof")?.textContent === "Visible local page"');
    },url)).toBe(true);
  } finally {
    try { if (app) await app.close(); }
    finally {
      try { if (server.listening) await new Promise(resolve => server.close(resolve)); }
      finally { fs.rmSync(profile,{ recursive:true, force:true, maxRetries:8, retryDelay:300 }); }
    }
  }
});
