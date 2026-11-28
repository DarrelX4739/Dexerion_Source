'use strict';
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { launchDexerion } = require('./app');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR20AAAAASUVORK5CYII=';
const PNG_URL = 'data:image/png;base64,' + PNG;

async function withApp(run) {
  const { app, win, profile } = await launchDexerion();
  try { await run(app, win); }
  finally {
    await app.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  }
}

test('a retained bookmark still navigates the newly active tab', async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<title>Local bookmark target</title><h1>Local bookmark target</h1>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const target = 'http://127.0.0.1:' + server.address().port + '/bookmarked';
  try {
    await withApp(async (_app, win) => {
      const click = win.locator('#bookmarkbar a').filter({ hasText: 'Local bookmark target' });
      await win.evaluate(async ({ url, favicon }) => {
        const bridge = window.dexerion;
        await bridge.invoke('dex:bookmark-add', { title: 'Local bookmark target', url, favicon });
        const s = await bridge.invoke('dex:get-state');
        await bridge.invoke('dex:bookmark-move', s.bookmarks.roots.other.find((b) => b.url === url).id, 'bar');
      }, { url: target, favicon: PNG_URL });
      await expect(click).toBeVisible();
      const tab = await win.evaluate(async () => {
        window.__testBookmark = document.querySelector('#bookmarkbar a');
        return window.dexerion.invoke('dex:new-tab', 'dexerion://newtab', false);
      });
      expect(tab).toBeTruthy();
      await expect.poll(() => win.evaluate(() => window.dexerion.invoke('dex:get-state').then((s) => s.active))).toBe(tab);
      expect(await win.evaluate(() => window.__testBookmark === document.querySelector('#bookmarkbar a'))).toBe(true);
      await click.click();
      await expect.poll(() => win.evaluate((id) => window.dexerion.invoke('dex:get-state')
        .then((s) => s.tabs.find((t) => t.id === id)?.url), tab)).toBe(target);
    });
  } finally { server.close(); }
});

test('identical shell state leaves chrome alone without changing navigation or an omnibox draft', async () => {
  const server = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<title>Chrome writes fixture</title><h1>Chrome writes fixture</h1>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const target = 'http://127.0.0.1:' + server.address().port + '/chrome-writes';
  try {
    await withApp(async (_app, win) => {
      const omni = win.locator('#omnibox');
      await win.evaluate((url) => window.dexerion.invoke('dex:new-tab', url, false), target);
      await expect.poll(() => win.title()).toBe('Chrome writes fixture — Dexerion');
      await omni.blur();
      await win.evaluate(() => refresh());
      await expect(omni).toHaveValue(target);
      const unchanged = await win.evaluate(async () => {
        await refresh();
        let delivered = 0;
        const watch = new MutationObserver((rows) => { delivered += rows.length; });
        for (const selector of ['title', '#account-av', '#dmenu-acc']) {
          watch.observe(document.querySelector(selector), { childList: true });
        }
        watch.observe(document.getElementById('account-btn'), { attributes: true, attributeFilter: ['title'] });
        for (let i = 0; i < 4; i++) await refresh(); // fetch and render actual main-process state
        const count = delivered + watch.takeRecords().length;
        watch.disconnect();
        return count;
      });
      expect(unchanged).toBe(0);

      await omni.focus();
      const draft = await win.evaluate(async () => {
        const input = document.getElementById('omnibox');
        // Set exactly the draft and selection being tested, independently of
        // debounced suggestions that open their own native popup.
        input.value = 'local draft';
        input.setSelectionRange(2, 5, 'backward');
        const bridge = window.dexerion;
        const current = await bridge.invoke('dex:get-state');
        await bridge.invoke('dex:account-rename', { id: current.account.id, name: 'New label' });
        await refresh();
        return [input === document.activeElement, input.value, input.selectionStart, input.selectionEnd, input.selectionDirection];
      });
      expect(draft).toEqual([true, 'local draft', 2, 5, 'backward']);
      await expect(win.locator('#account-av')).toHaveText('N');
      await expect(win.locator('#dmenu-acc')).toHaveText('New label (default)');
      await expect(win.locator('#account-btn')).toHaveAttribute('title', 'Signed in as New label — manage accounts');
      await omni.blur();
      await win.evaluate(() => refresh());
      await expect(omni).toHaveValue(target);
    });
  } finally { server.close(); }
});

test('Focus Timer countdown and unblock action survive unchanged list updates', async () => {
  await withApp(async (_app, win) => {
    await win.evaluate(() => window.dexerion.invoke('dex:pomo-configure',
      { workMin: 1, sound: 'off', blocklist: ['fixture.example'] }));
    const unblock = win.locator('#rt-sites button[aria-label="Unblock fixture.example"]');
    await expect(unblock).toHaveCount(1);
    await win.evaluate(async () => {
      window.__testUnblock = document.querySelector('#rt-sites button');
      await window.dexerion.invoke('dex:pomo-start', 'work');
    });
    await expect(win.locator('#rt-phase')).toHaveText('Work');
    await expect.poll(() => win.locator('#rt-time').textContent()).not.toBe('01:00');
    expect(await win.evaluate(() => window.__testUnblock === document.querySelector('#rt-sites button'))).toBe(true);
    await unblock.evaluate((button) => button.click());
    await expect(win.locator('#rt-sites')).toHaveText('Nothing blocked.');
    await win.evaluate(() => window.dexerion.invoke('dex:pomo-reset'));
    await expect(win.locator('#rt-phase')).toHaveText('Ready');
  });
});

test('a real unpacked extension retains its icon and popup across unrelated shell updates', async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-toolbar-extension-'));
  fs.writeFileSync(path.join(fixture, 'manifest.json'), JSON.stringify({
    manifest_version: 3, name: 'Dexerion toolbar fixture', version: '1.0',
    action: { default_icon: 'icon.png', default_popup: 'popup.html' },
  }));
  fs.writeFileSync(path.join(fixture, 'icon.png'), Buffer.from(PNG, 'base64'));
  fs.writeFileSync(path.join(fixture, 'popup.html'), '<title>Toolbar fixture popup</title><h1>Toolbar fixture popup</h1>');
  try {
    await withApp(async (app, win) => {
      // Substitute only the OS file picker; the real guarded IPC still installs
      // the local test fixture and uses the normal toolbar and popup routes.
      await app.evaluate(({ dialog }, folder) => {
        const original = dialog.showOpenDialog;
        dialog.showOpenDialog = async (...args) => {
          dialog.showOpenDialog = original;
          return { canceled: false, filePaths: [folder] };
        };
      }, fixture);
      await win.evaluate(() => window.dexerion.invoke('dex:ext-load-unpacked'));
      const button = win.locator('#extbar button[title^="Dexerion toolbar fixture"]');
      await expect(button.locator('img')).toHaveAttribute('src', PNG_URL);
      await win.evaluate(async () => {
        window.__testExtension = document.querySelector('#extbar button');
        await window.dexerion.invoke('dex:new-tab', 'dexerion://newtab', false);
      });
      expect(await win.evaluate(() => window.__testExtension === document.querySelector('#extbar button'))).toBe(true);
      // A native popup can blur and close before Playwright gets an
      // accessibility snapshot on Xvfb. Observe the actual main-process load
      // instead of guessing which Electron 'window' event belongs to it.
      await app.evaluate(({ BrowserWindow }) => {
        const saved = BrowserWindow.prototype.loadURL;
        globalThis.__testToolbarPopup = null;
        BrowserWindow.prototype.loadURL = function capture(url, ...args) {
          const result = saved.call(this, url, ...args);
          if (/^chrome-extension:\/\/.+\/popup\.html$/.test(url)) {
            BrowserWindow.prototype.loadURL = saved;
            globalThis.__testToolbarPopup = { url, state: 'loading' };
            result.then(() => {
              globalThis.__testToolbarPopup = { url, state: 'loaded' };
            }, (err) => {
              globalThis.__testToolbarPopup = { url, state: String(err && err.message || err) };
            });
          }
          return result;
        };
      });
      await button.click();
      await expect.poll(() => app.evaluate(() => globalThis.__testToolbarPopup)).toMatchObject({
        url: expect.stringMatching(/^chrome-extension:\/\/[a-p]{32}\/popup\.html$/),
        state: 'loaded',
      });
    });
  } finally { fs.rmSync(fixture, { force: true, recursive: true, maxRetries: 3 }); }
});
