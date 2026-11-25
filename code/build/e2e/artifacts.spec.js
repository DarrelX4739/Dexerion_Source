'use strict';
// End-to-end proof for the artifact pipeline: a multi-file site arrives from the
// model, renders as a card with a sandboxed preview, is edited in place from the
// Code panel (and the edit survives on disk), exports as a project zip, and
// opens in the artifact viewer page. Runs against the local NIM mock.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const AdMZip = require('adm-zip');
const { startAiMock } = require('./ai-mock');
const { launchDexerion } = require('./app');

const SITE_REPLY = [
  'Here is your tide clock.',
  '',
  '```dex-artifact',
  JSON.stringify({
    kind: 'site',
    title: 'Tide clock',
    description: 'A tiny tide clock.',
    files: [
      {
        path: 'index.html',
        content: '<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body>'
          + '<h1 data-testid="head">Low tide</h1><p id="now" class="lede"></p>'
          + '<a id="go-about" href="about.html">About the tides</a> '
          + '<button id="save">save</button><button id="load">load</button>'
          + '<script src="app.js"></script></body></html>',
      },
      {
        path: 'about.html',
        content: '<!doctype html><html><body><h1 data-testid="head">About the tides</h1>'
          + '<a id="back-home" href="index.html">Home</a></body></html>',
      },
      { path: 'styles.css', content: 'body{font-family:system-ui;padding:24px}' },
      {
        path: 'app.js',
        content: 'document.getElementById("now").textContent = "Next high tide in 2h";'
          + 'document.getElementById("save").onclick = function(){'
          + '  localStorage.setItem("saved","yes");'
          + '  document.getElementById("now").textContent = "saved:" + localStorage.getItem("saved");'
          + '};'
          + 'document.getElementById("load").onclick = function(){'
          + '  fetch("data.json").then(function(r){ return r.json(); }).then(function(d){'
          + '    document.getElementById("now").textContent = "json:" + d.a; });'
          + '};'
          + 'console.error("boom-tide");',
      },
      { path: 'data.json', content: '{"a":42}' },
    ],
  }),
  '```',
].join('\n');

test('a generated site edits, exports and opens outside the chat', async () => {
  const mock = await startAiMock({ reply: SITE_REPLY });
  const { app, win, profile } = await launchDexerion({ aiBase: mock.url });
  const zipPath = path.join(os.tmpdir(), 'dex-e2e-project-' + process.pid + '.zip');
  try {
    await win.evaluate(async () => {
      await window.dexerion.invoke('dex:ai-key-set', 'nvapi-e2e-artifact-key');
      await window.dexerion.invoke('dex:ai-open');
    });
    await win.waitForSelector('#ai-sidebar:not([hidden])', { timeout: 20000 });
    await expect(win.locator('#ai-setup')).toBeHidden({ timeout: 20000 });

    // 1. Ask for the deliverable; the mock answers with a three-file site.
    await win.fill('#ai-input', 'build me a tide clock site');
    await win.press('#ai-input', 'Enter');
    const card = win.locator('#ai-messages .dxa-card[data-kind="site"]').first();
    await expect(card).toBeVisible({ timeout: 30000 });

    // 2. The card is real: the files are served from the artifact's own
    //    virtual host (real origin — no flattened srcdoc), and the file count
    //    chip is honest.
    // A save/regenerate stages a hidden twin frame and swaps on load (V20):
    // during that window two frames exist, so everything targets the visible
    // one (`:not([style*="visibility: hidden"])`) or tolerates the pair.
    const frame = card.locator('iframe.dxa-frame').first();
    await expect(frame).toHaveCount(1);
    const frameSrc = await frame.getAttribute('src');
    expect(frameSrc).toMatch(/^dexsite:\/\/[0-9a-f]{8}\/index\.html/);
    expect(await frame.getAttribute('srcdoc')).toBeNull();
    await expect(card.locator('.dxa-files')).toHaveText('5 files');

    // 3. The served page actually runs: the model's script wrote to the DOM.
    const innerFrame = win.frameLocator('#ai-messages .dxa-card[data-kind="site"] iframe.dxa-frame:not([style*="visibility: hidden"])');
    await expect(innerFrame.locator('#now')).toHaveText('Next high tide in 2h', { timeout: 15000 });

    // 3b. Multi-page: the chrome lists both pages, and a real in-page link
    //     navigates the frame through the virtual host (not srcdoc routing).
    await expect(card.locator('.dxa-page-btn')).toHaveCount(2);
    await innerFrame.locator('#go-about').click();
    // 30s: the in-frame navigation races a fresh host page load; under a full
    // parallel suite run on a loaded machine this step stalled past 15s once
    // (the spec passes alone in ~50s, and the whole run took 8m vs the usual
    // 4m). Same slow-machine budget as the post-save step below.
    await expect(innerFrame.locator('[data-testid="head"]')).toHaveText('About the tides', { timeout: 30000 });
    // The chrome follows an in-frame navigation (main's frame-navigation
    // bridge): the active page button and the page label both catch up.
    await expect(card.locator('.dxa-page-btn[title="about.html"]')).toHaveClass(/on/, { timeout: 15000 });
    await expect(card.locator('.dxa-site-page')).toHaveText('about.html');
    await innerFrame.locator('#back-home').click();
    await expect(innerFrame.locator('[data-testid="head"]')).toHaveText('Low tide', { timeout: 30000 });
    await expect(card.locator('.dxa-page-btn[title="index.html"]')).toHaveClass(/on/, { timeout: 15000 });
    await expect(card.locator('.dxa-site-page')).toHaveText('index.html');
    // The chrome can navigate too, and the active page is marked.
    await card.locator('.dxa-page-btn[title="index.html"]').click();
    await expect(innerFrame.locator('[data-testid="head"]')).toHaveText('Low tide', { timeout: 15000 });

    // 3c. Storage and fetch of the site's own files work on the served origin:
    //     localStorage persists per artifact host, data.json comes from the
    //     file set — both impossible under the old single-document sandbox.
    await innerFrame.locator('#save').click();
    await expect(innerFrame.locator('#now')).toHaveText('saved:yes', { timeout: 10000 });
    await innerFrame.locator('#load').click();
    await expect(innerFrame.locator('#now')).toHaveText('json:42', { timeout: 10000 });

    // 3c2. Interactions work from the keyboard too: focus the real button and
    //      press Enter — the same handler runs as a click (interaction proof,
    //      not just element presence).
    await innerFrame.locator('#save').focus();
    await innerFrame.locator('#save').press('Enter');
    await expect(innerFrame.locator('#now')).toHaveText('saved:yes', { timeout: 10000 });

    // 3d. "Download HTML" exports the page on screen: ask for about.html's
    //     single-file form and check it is that page, not the entry.
    const aboutExport = await win.evaluate(async () => {
      const list = await window.dexerion.invoke('dex:ai-chats-list');
      const chat = await window.dexerion.invoke('dex:ai-chat-open', list[0].id);
      const message = chat.messages.find((m) => m.artifact && m.artifact.kind === 'site');
      return window.dexerion.invoke('dex:ai-artifact-html', { artifact: message.artifact, page: 'about.html' });
    });
    expect(aboutExport.page).toBe('about.html');
    expect(aboutExport.html).toContain('About the tides');
    expect(aboutExport.html).not.toContain('Low tide');

    // 3e. The health strip names a real finding from the site validator (the
    //     fixture has no <title>, no charset, no <main>) and offers the
    //     concrete repair path ("Fix with AI" hands the issue list back).
    await expect(card.locator('.dxa-issues')).toBeVisible({ timeout: 15000 });
    await expect(card.locator('.dxa-issues')).toContainText(/title|charset|main/i);
    await expect(card.locator('.dxa-issue-fix')).toBeVisible();
    await expect(card.locator('.dxa-issues .dxa-issue-btn').first()).toBeVisible();
    // The strip is chat content, not preview chrome: it must be outside the
    // iframe wrapper so the generated site is never covered by diagnostics.
    await expect(card.locator('.dxa-site .dxa-issues')).toHaveCount(0);
    await expect(card.locator('.dxa-preview-issues .dxa-issues')).toBeVisible();

    // 3f. Component hygiene runs on the live artifact: the fixture's
    //     class="lede" has no CSS rule anywhere, and the validator says so.
    const hygiene = await win.evaluate(async () => {
      const list = await window.dexerion.invoke('dex:ai-chats-list');
      const chat = await window.dexerion.invoke('dex:ai-chat-open', list[0].id);
      const message = chat.messages.find((m) => m.artifact && m.artifact.kind === 'site');
      const diag = await window.dexerion.invoke('dex:ai-artifact-diagnose', { artifact: message.artifact });
      return (diag.issues || []).map((i) => i.code);
    });
    expect(hygiene).toContain('quality-html-unstyled-class');

    // 3h. The Focus preview (V11): the card's primary action opens the site
    //     in a dedicated overlay beside the chat, and closes cleanly.
    await card.getByRole('button', { name: 'Preview', exact: true }).click();
    const overlayState = async () => app.evaluate(async ({ BrowserWindow, webContents }) => {
      const w = BrowserWindow.getAllWindows()[0];
      const list = webContents.getAllWebContents().filter((wc) => /^dexerion:\/\/artifact\?.*overlay=1/.test(wc.getURL() || ''));
      return { count: list.length, url: list[0] ? list[0].getURL() : '', children: w ? w.contentView.children.length : 0 };
    });
    await expect.poll(async () => (await overlayState()).count, { timeout: 20000 }).toBe(1);
    const overlayShown = await overlayState();
    expect(overlayShown.url).toContain('overlay=1');
    expect(overlayShown.children).toBeGreaterThanOrEqual(2);

    // 3h2. Fullscreen: the preview can leave the page-area gutter and own every
    // pixel of the window (maximized), then restore its docked bounds and size.
    const fsButtonVisible = await app.evaluate(async ({ webContents }) => {
      const ov = webContents.getAllWebContents().find((wc) => /dexerion:\/\/artifact\?.*overlay=1/.test(wc.getURL() || ''));
      return ov ? ov.executeJavaScript('!!document.getElementById("btnFullscreen") && !document.getElementById("btnFullscreen").hidden') : false;
    });
    expect(fsButtonVisible).toBe(true);
    const preview = async () => app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      const cb = w.getContentBounds();
      const ov = (w.contentView.children || []).find((v) => /overlay=1/.test(((v.webContents && v.webContents.getURL()) || '')));
      return { cb, b: ov ? ov.getBounds() : null, maximized: w.isMaximized() };
    });
    const docked = await preview();
    expect(docked.b).toBeTruthy();
    expect(docked.b.x).toBeGreaterThan(0); // rail/chrome gutter kept while docked
    expect(await win.evaluate(() => window.dexerion.invoke('dex:overlay-fullscreen', { kind: 'site' })))
      .toEqual({ ok: true, fullscreen: true });
    await expect.poll(async () => {
      const s = await preview();
      return !!(s.b && s.b.x === 0 && s.maximized && s.b.width >= s.cb.width - 2);
    }, { timeout: 15000 }).toBe(true);
    expect(await win.evaluate(() => window.dexerion.invoke('dex:overlay-fullscreen-state', { kind: 'site' }))).toBe(true);
    await win.evaluate(() => window.dexerion.invoke('dex:overlay-fullscreen', { kind: 'site', fullscreen: false }));
    await expect.poll(async () => (await preview()).b.x, { timeout: 15000 }).toBeGreaterThan(0);
    expect(await win.evaluate(() => window.dexerion.invoke('dex:overlay-fullscreen-state', { kind: 'site' }))).toBe(false);

    await win.evaluate(() => window.dexerion.invoke('dex:site-overlay-close'));
    await expect.poll(async () => (await overlayState()).count, { timeout: 10000 }).toBe(0);

    // 3i. Console capture (V10): the page's own console.error reaches the
    //     card's badge, and the panel shows the message. Never strip spam.
    const consoleBtn = card.locator('.dxa-console-btn');
    await expect(consoleBtn).toBeVisible({ timeout: 15000 });
    await expect(consoleBtn.locator('.dxa-console-count')).toHaveText('1');
    await consoleBtn.click();
    await expect(card.locator('.dxa-console')).toContainText('boom-tide');

    // 4. Live edit: change the heading in the Code panel and save. Code lives in
    //    the card's ⋯ menu (the primary pair stays visible on one line). The
    //    menu closes on a real thread scroll; between two separate Playwright
    //    clicks the actionability scroll can trip that listener and hide the
    //    item. Trigger both clicks in one task so the second lands first — the
    //    same proven fix used by nextgen-intensive.spec.js for the Design item.
    await card.evaluate((el) => {
      const more = el.querySelector('button[aria-label="More actions"]');
      if (!more) throw new Error('More actions button missing');
      more.click();
      const code = Array.from(el.querySelectorAll('.dxa-menu .dxa-menu-item'))
        .find((b) => b.textContent.trim() === 'Code');
      if (!code) throw new Error('Code menu item missing');
      code.click();
    });
    const editor = card.locator('.dxa-code-edit');
    await expect(editor).toBeVisible();
    const srcBeforeEdit = await frame.getAttribute('src');
    await editor.fill('<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><h1 data-testid="head">High tide</h1><p id="now"></p><script src="app.js"></script></body></html>');
    await card.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(card.locator('.dxa-versions-label')).toContainText('1 earlier', { timeout: 15000 });

    // The save re-registers the edited files under a new host and the frame
    // navigates to it (the old host id no longer matches the content). This
    // step races a fresh host registration + navigation + script execution,
    // and on this machine that has been measured past 15 s under load (a
    // 52 s run became 1.3 m in the same session) — hence the 30 s budget,
    // matching the other slow-machine waits.
    await expect.poll(async () => frame.getAttribute('src'), { timeout: 30000 }).not.toBe(srcBeforeEdit);
    // …and the page genuinely re-ran on the served origin. 45s: this one step
    // has failed once in seven runs at 30s on a loaded machine (the reload
    // races host registration + navigation + script execution), while the
    // app-side work measured is well under a second.
    await expect(innerFrame.locator('[data-testid="head"]')).toHaveText('High tide', { timeout: 45000 });

    // 5. The edit is on disk, not just on screen.
    const onDisk = await win.evaluate(async () => {
      const list = await window.dexerion.invoke('dex:ai-chats-list');
      const chat = await window.dexerion.invoke('dex:ai-chat-open', list[0].id);
      const message = chat.messages.find((m) => m.artifact && m.artifact.kind === 'site');
      const index = message.artifact.files.find((f) => f.path === 'index.html');
      return { version: message.artifact.version, heading: index.content.includes('High tide'), history: (message.artifact.history || []).length };
    });
    expect(onDisk.heading).toBe(true);
    expect(onDisk.history).toBe(1);
    // Profile writes are batched, so the disk copy lands a moment later.
    await expect.poll(() => findOnDisk(profile, 'High tide'), { timeout: 10000 }).toBe(true);
    await expect.poll(() => findOnDisk(profile, 'tide-clock.preview.html') === false, { timeout: 1000 }).toBe(true);

    // 6. Project export: the zip holds the edited files plus the runnable page.
    const zip = await win.evaluate(async ({ target }) => {
      const list = await window.dexerion.invoke('dex:ai-chats-list');
      const chat = await window.dexerion.invoke('dex:ai-chat-open', list[0].id);
      const message = chat.messages.find((m) => m.artifact && m.artifact.kind === 'site');
      return window.dexerion.invoke('dex:ai-artifact-zip', { artifact: message.artifact, path: target });
    }, { target: zipPath });
    expect(zip.ok).toBe(true);
    // V13: one top-level folder, a README, and one PDF per page (printed on
    // the way through the same pipeline the Download-PDF action uses).
    const entries = new AdMZip(zipPath).getEntries().map((e) => e.entryName).sort();
    expect(entries).toEqual([
      'tide-clock/README.txt',
      'tide-clock/about.html',
      'tide-clock/app.js',
      'tide-clock/data.json',
      'tide-clock/index.html',
      'tide-clock/pdf/about.pdf',
      'tide-clock/pdf/index.pdf',
      'tide-clock/pdf/site.pdf',
      'tide-clock/preview.html',
      'tide-clock/styles.css',
    ]);
    expect(new AdMZip(zipPath).readAsText('tide-clock/index.html')).toContain('High tide');
    expect(new AdMZip(zipPath).readAsText('tide-clock/preview.html')).toContain('Next high tide in 2h');
    const pdfBytes = new AdMZip(zipPath).readFile('tide-clock/pdf/index.pdf');
    expect(pdfBytes.slice(0, 4).toString()).toBe('%PDF');
    expect(pdfBytes.length).toBeGreaterThan(1000);
    // V20: the whole site also ships as ONE combined PDF (all pages, native
    // pagination) beside the per-page files.
    const wholePdf = new AdMZip(zipPath).readFile('tide-clock/pdf/site.pdf');
    expect(wholePdf.slice(0, 4).toString()).toBe('%PDF');
    expect(wholePdf.length).toBeGreaterThan(1000);
    expect(new AdMZip(zipPath).readAsText('tide-clock/README.txt')).toContain('module');

    // 7. The standalone document is offline: no external CSS/JS/font references.
    const standalone = await win.evaluate(async () => {
      const list = await window.dexerion.invoke('dex:ai-chats-list');
      const chat = await window.dexerion.invoke('dex:ai-chat-open', list[0].id);
      const message = chat.messages.find((m) => m.artifact && m.artifact.kind === 'site');
      const res = await window.dexerion.invoke('dex:ai-artifact-html', { artifact: message.artifact });
      return res;
    });
    expect(standalone.ok).toBe(true);
    expect(standalone.html).not.toMatch(/<link[^>]*stylesheet/i);
    expect(standalone.html).not.toMatch(/<script[^>]*\ssrc=/i);
    expect(standalone.html).toContain('<style data-src="styles.css">');

    // 8. The artifact viewer page renders the same artifact in its own tab.
    const chatHandle = await win.evaluate(async () => {
      const list = await window.dexerion.invoke('dex:ai-chats-list');
      return list[0].id;
    });
    await win.evaluate(async ({ id }) => {
      const chat = await window.dexerion.invoke('dex:ai-chat-open', id);
      const index = chat.messages.findIndex((m) => m.artifact && m.artifact.kind === 'site');
      await window.dexerion.invoke('dex:new-tab', 'dexerion://artifact?chat=' + encodeURIComponent(id) + '&i=' + index, false);
    }, { id: chatHandle });
    await expect.poll(async () => win.evaluate(() => document.querySelectorAll('#tabs .tab').length), { timeout: 20000 }).toBeGreaterThan(1);
    await expect.poll(
      () => win.evaluate(() => Array.from(document.querySelectorAll('#tabs .tab')).some((t) => /Tide clock/.test(t.textContent))),
      { timeout: 20000 },
    ).toBe(true);
    // Tabs are WebContentsViews, not Playwright windows: read the page through
    // main's webContents so the assertion is about the rendered DOM.
    const viewer = await app.evaluate(async ({ webContents }) => {
      const wc = webContents.getAllWebContents().find((w) => /dexerion:\/\/artifact/.test(w.getURL() || ''));
      if (!wc) return null;
      return {
        url: wc.getURL(),
        dom: await wc.executeJavaScript('({ title: document.title, kind: (document.getElementById("kind") || {}).textContent, frames: document.querySelectorAll(".dxa-frame").length, src: (document.querySelector(".dxa-frame") || {}).getAttribute ? (document.querySelector(".dxa-frame").getAttribute("src") || "") : "" })'),
      };
    });
    expect(viewer).toBeTruthy();
    expect(viewer.url).toContain('dexerion://artifact');
    expect(viewer.dom.title).toContain('Tide clock');
    expect(viewer.dom.kind).toBe('site');
    expect(viewer.dom.frames).toBe(1);
    expect(viewer.dom.src).toMatch(/^dexsite:\/\//);
    // The viewer's host serves the *edited* bytes: fetch the frame's own URL
    // in main (protocol handling goes through the session, like the frame).
    const served = await app.evaluate(async ({ net }, src) => {
      const res = await net.fetch(src);
      const body = await res.text();
      return { status: res.status, edited: body.includes('High tide') };
    }, viewer.dom.src);
    expect(served.status).toBe(200);
    expect(served.edited).toBe(true);

    // 9. The Files library finds the artifact by a phrase inside it. This is the
    //    check for the shadowed-render bug: the full-text hits were computed,
    //    sent, and then silently dropped by the page, so only title matches
    //    ever showed.
    await win.evaluate(() => window.dexerion.invoke('dex:new-tab', 'dexerion://files', false));
    const searchHtml = [
      "(() => {",
      "  const q = document.getElementById('q');",
      "  if (!q) return null;",
      "  q.value = 'High tide';",
      "  q.dispatchEvent(new Event('input', { bubbles: true }));",
      "  return true;",
      "})()",
    ].join('\n');
    const readRows = [
      "(() => {",
      "  const rows = Array.from(document.querySelectorAll('#reports .dx-item'));",
      "  return { rows: rows.length, text: rows.map((r) => r.innerText.replace(/ +/g, ' ')).join(' | ').slice(0, 400) };",
      "})()",
    ].join('\n');
    const found = await app.evaluate(async ({ webContents }, code) => {
      const [setup, read] = code;
      for (let i = 0; i < 30; i += 1) {
        const wc = webContents.getAllWebContents().find((w) => /dexerion:\/\/files/.test(w.getURL() || ''));
        if (!wc) { await new Promise((r) => setTimeout(r, 400)); continue; }
        try {
          const ready = await wc.executeJavaScript('document.readyState');
          if (ready !== 'complete') { await new Promise((r) => setTimeout(r, 400)); continue; }
          await wc.executeJavaScript(setup);
          await new Promise((r) => setTimeout(r, 1200));
          return await wc.executeJavaScript(read);
        } catch { /* retry */ }
        await new Promise((r) => setTimeout(r, 400));
      }
      return null;
    }, [searchHtml, readRows]);
    expect(found).not.toBeNull();
    // The phrase lives in the edited index.html, not in the title: only the
    // full-text index can surface this row.
    expect(found.rows).toBeGreaterThan(0);
    expect(found.text).toContain('High tide');

    // 10. Preview editing (V12): with edit mode on, clicking the heading in
    //     the frame opens the inline editor; Update rewrites index.html
    //     through the validated save path and the served page re-renders.
    await card.getByRole('button', { name: 'Edit text in the preview' }).click();
    await innerFrame.locator('[data-testid="head"]').click();
    await expect(card.locator('.dxa-editbar')).toBeVisible({ timeout: 10000 });
    await expect(card.locator('.dxa-editbar-input')).toHaveValue('High tide');
    await card.locator('.dxa-editbar-input').fill('Big tide');
    await card.locator('.dxa-editbar-save').click();
    await expect(innerFrame.locator('[data-testid="head"]')).toHaveText('Big tide', { timeout: 45000 });
    const previewEditOnDisk = await win.evaluate(async () => {
      const list = await window.dexerion.invoke('dex:ai-chats-list');
      const chat = await window.dexerion.invoke('dex:ai-chat-open', list[0].id);
      const message = chat.messages.find((m) => m.artifact && m.artifact.kind === 'site');
      return {
        edited: message.artifact.files.find((f) => f.path === 'index.html').content.includes('Big tide'),
        history: (message.artifact.history || []).length,
      };
    });
    expect(previewEditOnDisk.edited).toBe(true);
    expect(previewEditOnDisk.history).toBe(2);
  } finally {
    await app.close();
    await mock.close();
    try { fs.rmSync(zipPath, { force: true }); } catch {}
  }
});

// "Fix with AI" injects a repair ask with the word "website" in it. That ask
// must take the deterministic site-revision route (not the generic skill loop,
// which used to reject it), and come back as a new site artifact in the chat.
test('fix with AI returns a repaired site', async () => {
  const mock = await startAiMock({ reply: SITE_REPLY });
  const { app, win } = await launchDexerion({ aiBase: mock.url });
  try {
    await win.evaluate(async () => {
      await window.dexerion.invoke('dex:ai-key-set', 'nvapi-e2e-fix-key');
      await window.dexerion.invoke('dex:ai-open');
    });
    await win.waitForSelector('#ai-sidebar:not([hidden])', { timeout: 20000 });
    await expect(win.locator('#ai-setup')).toBeHidden({ timeout: 20000 });
    await win.fill('#ai-input', 'build me a tide clock site');
    await win.press('#ai-input', 'Enter');
    const card = win.locator('#ai-messages .dxa-card[data-kind="site"]').first();
    await expect(card).toBeVisible({ timeout: 30000 });
    await expect(card.locator('.dxa-issue-fix')).toBeVisible({ timeout: 20000 });

    const chatState = async () => win.evaluate(async () => {
      const list = await window.dexerion.invoke('dex:ai-chats-list');
      const chat = await window.dexerion.invoke('dex:ai-chat-open', list[0].id);
      const messages = Array.isArray(chat.messages) ? chat.messages : [];
      const lastUser = [...messages].reverse().find((m) => m && m.role === 'user');
      const sites = messages.filter((m) => m && m.artifact && m.artifact.kind === 'site');
      return {
        messages: messages.length,
        sites: sites.length,
        lastUser: lastUser ? String(lastUser.text || '') : '',
        files: sites.length ? (sites[sites.length - 1].artifact.files || []).map((f) => f.path) : [],
      };
    });
    const before = await chatState();
    expect(before.sites).toBe(1);

    await card.locator('.dxa-issue-fix').click();
    await expect.poll(async () => (await chatState()).messages, { timeout: 45000 }).toBeGreaterThan(before.messages);
    const after = await chatState();
    expect(after.sites).toBeGreaterThanOrEqual(2);
    expect(after.lastUser).toContain('Fix the quality issues the website checker found');
    expect(after.files).toContain('index.html');

    // The bug this locks down: the repair ask used to reach the site writer as
    // a brand-new "make a website" brief, so the model invented a different
    // product instead of editing the clicked site. The NIM mock records the
    // exact wire request, so prove the revision carried the original source.
    // The first revision request carries the full source. A later
    // interactivity-repair turn quotes only the opening of the brief.
    const revisionWire = mock.requests
      .map((r) => JSON.stringify(r.body))
      .find((wire) => wire.includes('REVISION CONTRACT'));
    expect(revisionWire, 'the site writer never received a revision prompt').toBeTruthy();
    expect(revisionWire).toContain('Tide clock');
    expect(revisionWire).toContain('Low tide');
    expect(revisionWire).toContain('Fix the quality issues the website checker found');
    expect(revisionWire).toContain('SITE REVISION MODE');
  } finally {
    await app.close();
    await mock.close();
  }
});

// The chat store is JSON on disk; a marker there is the honest proof that a save
// was persisted rather than only rendered.
function findOnDisk(dir, marker) {
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { stack.push(full); continue; }
      try {
        if (fs.statSync(full).size < 4 * 1024 * 1024 && fs.readFileSync(full, 'utf8').includes(marker)) return true;
      } catch {}
    }
  }
  return false;
}
