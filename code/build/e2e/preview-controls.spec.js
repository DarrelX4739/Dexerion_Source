'use strict';
// V1/V10/V12 + V40 proof for the preview chrome: every site-preview control
// (Phone, Tablet, Desktop, Expand, Exit, Reload, Console, Edit, Fullscreen)
// changes observable state, and the report overlay exposes the same fullscreen
// and exit contract with its own viewer chrome.

const { test, expect } = require('@playwright/test');
const { startAiMock } = require('./ai-mock');
const { launchDexerion } = require('./app');

const SITE_HTML = [
  '<!doctype html><html lang="en"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<title>Preview Fixture</title><meta name="description" content="Preview chrome fixture.">',
  // Deliberately adversarial: if the renderer did not normalise the viewport,
  // this page would appear as a 520px card floating in the middle of the tab.
  '<style>:root{--ink:#14202c;--paper:#fafafa}body{margin:40px;padding:40px;display:grid;place-items:center;font-family:system-ui;color:var(--ink);background:var(--paper)}',
  '#tiny{width:520px;max-width:520px;padding:32px;background:#fff;box-shadow:0 0 0 1px #0002;border-radius:14px}',
  'button{min-height:44px}</style></head><body><div id="tiny"><main><h1 data-testid="head">Preview heading</h1>',
  '<button type="button" data-act="ping" id="ping">Ping</button>',
  '<p id="out" aria-live="polite">Idle</p></main></div>',
  '<script>document.addEventListener("click",function(e){',
  'if(e.target.closest("#ping"))document.getElementById("out").textContent="Pong";',
  '});console.error("polish-preview-probe");</script></body></html>',
].join('\n');

const SITE_REPLY = '```dex-artifact\n' + JSON.stringify({
  kind: 'site',
  title: 'Preview Fixture',
  description: 'A fixture for preview chrome.',
  files: [{ path: 'index.html', content: SITE_HTML }],
}) + '\n```';

const REPORT_REPLY = '```dex-artifact\n' + JSON.stringify({
  kind: 'report',
  title: 'Preview Parity Report',
  subtitle: 'Control check',
  summary: 'A short report for the overlay parity check.',
  theme: 'clean',
  blocks: [
    { type: 'callout', label: 'Bottom line', text: 'The overlay is usable.' },
    { type: 'heading', text: '1. Findings', level: 2 },
    { type: 'paragraph', text: 'The report preview carries its own chrome.' },
  ],
}) + '\n```';

// Electron main-process helpers ------------------------------------------------
async function overlayUrls(app) {
  return app.evaluate(async ({ webContents }) => webContents.getAllWebContents()
    .map((wc) => wc.getURL() || '')
    .filter((url) => /dexerion:\/\/(?:artifact|report)\?.*overlay=1/.test(url)));
}

async function clickOverlayButton(app, product, id) {
  return app.evaluate(async ({ webContents }, arg) => {
    const pattern = arg.product === 'site'
      ? /dexerion:\/\/artifact\?.*overlay=1/
      : /dexerion:\/\/report\?.*overlay=1/;
    const wc = webContents.getAllWebContents().find((w) => pattern.test(w.getURL() || ''));
    if (!wc || wc.isDestroyed()) return null;
    return wc.executeJavaScript('(function(){var b=document.getElementById('
      + JSON.stringify(arg.id) + ');if(!b)return null;b.click();return (b.textContent||"");})()');
  }, { product, id });
}

async function overlayDom(app, product, expression) {
  return app.evaluate(async ({ webContents }, arg) => {
    const pattern = arg.product === 'site'
      ? /dexerion:\/\/artifact\?.*overlay=1/
      : /dexerion:\/\/report\?.*overlay=1/;
    const wc = webContents.getAllWebContents().find((w) => pattern.test(w.getURL() || ''));
    if (!wc || wc.isDestroyed()) return null;
    return wc.executeJavaScript(arg.expression);
  }, { product, expression });
}

async function standaloneArtifactDom(app, expression) {
  return app.evaluate(async ({ webContents }, expr) => {
    const wc = webContents.getAllWebContents().find((w) => {
      const url = w.getURL() || '';
      return /dexerion:\/\/artifact\?/.test(url) && !/overlay=1/.test(url);
    });
    if (!wc || wc.isDestroyed()) return null;
    try { return await wc.executeJavaScript(expr); } catch { return null; }
  }, expression);
}

async function standaloneArtifactPage(app) {
  for (const page of await app.windows()) {
    try {
      const url = page.url();
      if (/dexerion:\/\/artifact\?/.test(url) && !/overlay=1/.test(url)) return page;
    } catch { /* a closing window is not the preview we want */ }
  }
  return null;
}

test('site and report preview chrome: widths, expand, reload, console, edit, fullscreen', async () => {
  const mock = await startAiMock();
  mock.replyFor = (body) => {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const lastUser = [...messages].reverse().find((m) => m && m.role === 'user');
    const ask = String((lastUser && lastUser.content) || '');
    if (/report/i.test(ask)) return REPORT_REPLY;
    if (/site/i.test(ask)) return SITE_REPLY;
    return 'Done.';
  };
  const { app, win } = await launchDexerion({ aiBase: mock.url });
  const pageErrors = [];
  win.on('pageerror', (err) => pageErrors.push(String((err && err.message) || err)));
  try {
    await win.evaluate(async () => {
      await window.dexerion.invoke('dex:ai-key-set', 'nvapi-e2e-polish-preview');
      await window.dexerion.invoke('dex:ai-open');
    });
    await win.waitForSelector('#ai-sidebar:not([hidden])', { timeout: 15000 });
    await win.fill('#ai-input', 'build a site for the preview check');
    await win.press('#ai-input', 'Enter');
    const card = win.locator('#ai-messages .dxa-card[data-kind="site"]').first();
    await expect(card).toBeVisible({ timeout: 30000 });
    const frame = card.locator('iframe.dxa-frame').first();
    await expect(frame).toHaveCount(1);
    const bar = card.locator('.dxa-sitebar');
    const inner = win.frameLocator('#ai-messages .dxa-card[data-kind="site"] iframe.dxa-frame:not([style*="visibility: hidden"])');
    await expect(inner.locator('[data-testid="head"]')).toHaveText('Preview heading', { timeout: 15000 });

    // 1. Device presets: three buttons, each updates the frame and ARIA state.
    const widths = bar.locator('.dxa-width-btn');
    await expect(widths).toHaveCount(3);
    await expect(widths.nth(0)).toContainText('Phone');
    await expect(widths.nth(1)).toContainText('Tablet');
    await expect(widths.nth(2)).toContainText('Desktop');
    await widths.nth(0).click();
    await expect(frame).toHaveClass(/dxa-frame-phone/);
    await expect(widths.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await widths.nth(1).click();
    await expect(frame).toHaveClass(/dxa-frame-tablet/);
    await expect(widths.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await widths.nth(2).click();
    await expect(frame).not.toHaveClass(/dxa-frame-(phone|tablet)/);
    await expect(widths.nth(2)).toHaveAttribute('aria-pressed', 'true');
    // Leave a non-default width in the chat: the standalone preview below must
    // ignore it and stay on the default full-pane frame.
    await widths.nth(0).click();
    await expect(frame).toHaveClass(/dxa-frame-phone/);

    // 2. Expand / Exit preview.
    const expand = bar.getByRole('button', { name: 'Expand', exact: true });
    await expand.click();
    await expect(card.locator('.dxa-site')).toHaveClass(/expanded/);
    await expect(bar.getByRole('button', { name: 'Collapse', exact: true })).toBeVisible();
    const exit = bar.getByRole('button', { name: 'Exit preview', exact: true });
    await expect(exit).toBeVisible();
    await exit.click();
    await expect(card.locator('.dxa-site')).not.toHaveClass(/expanded/);
    await expect(exit).toBeHidden();

    // 3. Reload: the virtual-host URL is rebuilt with a fresh cache-buster.
    const before = await frame.getAttribute('src');
    await bar.getByRole('button', { name: 'Reload', exact: true }).click();
    await expect.poll(() => frame.getAttribute('src'), { timeout: 15000 }).not.toBe(before);
    await expect(inner.locator('[data-testid="head"]')).toHaveText('Preview heading', { timeout: 15000 });

    // 4. Console capture: the badge counts one message and the panel shows it.
    const consoleBtn = bar.locator('.dxa-console-btn');
    await expect(consoleBtn).toBeVisible({ timeout: 15000 });
    await expect(consoleBtn.locator('.dxa-console-count')).toHaveText('1');
    await consoleBtn.click();
    await expect(card.locator('.dxa-console')).toContainText('polish-preview-probe');

    // 5. Edit mode toggles its pressed state without changing the source.
    const edit = bar.locator('.dxa-edit-btn');
    await expect(edit).toBeVisible();
    await expect(edit).toHaveAttribute('aria-label', 'Edit text in the preview');
    await edit.click();
    await expect(edit).toHaveAttribute('aria-pressed', 'true');
    await edit.click();
    await expect(edit).toHaveAttribute('aria-pressed', 'false');

    // 6. The site Focus overlay's own Fullscreen control, then Exit.
    await card.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect.poll(async () => (await overlayUrls(app)).some((u) => /artifact\?/.test(u)), { timeout: 20000 }).toBe(true);
    await expect.poll(async () => overlayDom(app, 'site', '!!document.getElementById("btnFullscreen") && !document.getElementById("btnFullscreen").hidden'), { timeout: 15000 }).toBe(true);
    expect(await clickOverlayButton(app, 'site', 'btnFullscreen')).toBe('Fullscreen');
    await expect.poll(async () => win.evaluate(() => window.dexerion.invoke('dex:overlay-fullscreen-state', { kind: 'site' })), { timeout: 15000 }).toBe(true);
    await expect.poll(async () => overlayDom(app, 'site', 'document.getElementById("btnFullscreen").textContent'), { timeout: 15000 }).toBe('Exit fullscreen');
    expect(await clickOverlayButton(app, 'site', 'btnFullscreen')).toBe('Exit fullscreen');
    await expect.poll(async () => win.evaluate(() => window.dexerion.invoke('dex:overlay-fullscreen-state', { kind: 'site' })), { timeout: 15000 }).toBe(false);
    expect(await clickOverlayButton(app, 'site', 'btnCloseOverlay')).toBeTruthy();
    await expect.poll(async () => (await overlayUrls(app)).some((u) => /artifact\?/.test(u)), { timeout: 10000 }).toBe(false);

    // 6b. Standalone site tab: the page fills the viewport. The floating top
    // chrome has no device-width controls — only Copy HTML and Fullscreen are
    // added to the existing chrome — and the frame ignores the chat's phone
    // choice, staying on the default full-pane preview.
    await card.locator('.dxa-sitebar').getByRole('button', { name: 'Open in tab', exact: true }).click();
    await expect.poll(async () => standaloneArtifactDom(app, '!!document.body'), { timeout: 20000 }).toBe(true);
    await expect.poll(async () => standaloneArtifactDom(app, 'document.body.classList.contains("dxa-site-preview")'), { timeout: 15000 }).toBe(true);
    await expect.poll(async () => standaloneArtifactDom(app, '!document.getElementById("siteWidths")'), { timeout: 15000 }).toBe(true);
    await expect.poll(async () => standaloneArtifactDom(app, '!document.querySelector(".dxa-page-bar .dxa-width-btn")'), { timeout: 15000 }).toBe(true);
    await expect.poll(async () => standaloneArtifactDom(app, '!document.querySelector(".dxa-frame").classList.contains("dxa-frame-phone") && !document.querySelector(".dxa-frame").classList.contains("dxa-frame-tablet")'), { timeout: 15000 }).toBe(true);
    const topButtons = await standaloneArtifactDom(app, 'Array.from(document.querySelectorAll(".dxa-page-bar button")).filter(function(b){return !b.hidden && getComputedStyle(b).display!=="none";}).map(function(b){return b.id;})');
    expect(topButtons).toContain('btnCopyHtml');
    expect(topButtons).toContain('btnFullscreen');
    expect(topButtons).not.toContain('btnPhone');
    expect(topButtons).not.toContain('btnTablet');
    expect(topButtons).not.toContain('btnDesktop');
    // Diagnostics belong to the chat card; nothing error-shaped covers the site.
    expect(await standaloneArtifactDom(app, 'getComputedStyle(document.querySelector(".dxa-issues") || document.body).display')).toBe('none');

    // 6c. The preview itself wins over a "tiny box" site. The fixture above
    // centres a 520px card with a 40px body margin; the renderer's injected
    // viewport guard must still make the frame and the site's own root fill
    // the standalone tab at desktop width.
    const standalone = await standaloneArtifactPage(app);
    expect(standalone).toBeTruthy();
    const dims = await standalone.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    const frameBox = await standalone.locator('iframe.dxa-frame').boundingBox();
    expect(frameBox).toBeTruthy();
    expect(frameBox.width).toBeGreaterThan(dims.w - 4);
    expect(frameBox.height).toBeGreaterThan(dims.h - 4);
    const siteFrame = standalone.frameLocator('iframe.dxa-frame');
    await expect.poll(async () => {
      try { return await siteFrame.locator('#tiny').count(); } catch { return 0; }
    }, { timeout: 15000 }).toBe(1);
    const fill = await siteFrame.locator('html').evaluate(() => ({
      vw: window.innerWidth,
      vh: window.innerHeight,
      bodyW: document.body.getBoundingClientRect().width,
      bodyH: document.body.getBoundingClientRect().height,
      rootW: document.getElementById('tiny').getBoundingClientRect().width,
      margin: getComputedStyle(document.body).margin,
      display: getComputedStyle(document.body).display,
      guard: Boolean(document.querySelector('style[data-dex-viewport]')),
    }));
    expect(fill.guard).toBe(true);
    expect(fill.margin).toBe('0px');
    expect(fill.display).toBe('block');
    expect(fill.bodyW).toBeGreaterThan(fill.vw - 20);
    expect(fill.rootW).toBeGreaterThan(fill.vw - 20);
    expect(fill.bodyH).toBeGreaterThanOrEqual(fill.vh - 2);

    await standaloneArtifactDom(app, '(function(){window.__copyProbe="";Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:function(t){window.__copyProbe=t;return Promise.resolve();}}});document.getElementById("btnCopyHtml").click();return true;})()');
    await expect.poll(async () => standaloneArtifactDom(app, 'String(window.__copyProbe||"")'), { timeout: 15000 }).toContain('<!doctype html');
    await expect.poll(async () => standaloneArtifactDom(app, 'document.getElementById("btnCopyHtml").textContent'), { timeout: 15000 }).toBe('Copied');

    await standaloneArtifactDom(app, '(function(){window.__fsCalls=0;document.documentElement.requestFullscreen=function(){window.__fsCalls++;return Promise.resolve();};document.exitFullscreen=function(){window.__fsCalls++;return Promise.resolve();};document.getElementById("btnFullscreen").click();return true;})()');
    await expect.poll(async () => standaloneArtifactDom(app, 'window.__fsCalls'), { timeout: 15000 }).toBe(1);

    // 7. Report preview parity: the report overlay carries its own Fullscreen,
    //    Exit and open-in-tab chrome, and the SAME fullscreen state contract.
    await win.fill('#ai-input', 'build a report for the preview check');
    await win.press('#ai-input', 'Enter');
    const reportCard = win.locator('#ai-messages .dxa-card[data-kind="report"]').first();
    await expect(reportCard).toBeVisible({ timeout: 30000 });
    const opened = await win.evaluate(async () => {
      const list = await window.dexerion.invoke('dex:ai-chats-list');
      for (const item of list) {
        const chat = await window.dexerion.invoke('dex:ai-chat-open', item.id);
        const index = (chat.messages || []).findIndex((m) => m && m.artifact && m.artifact.kind === 'report');
        if (index >= 0) return window.dexerion.invoke('dex:report-overlay-open', { chatId: item.id, index });
      }
      return { ok: false };
    });
    // dex:report-overlay-open resolves to a boolean (true once the preview
    // view exists), not an { ok } envelope like the overlay fullscreen IPC.
    expect(opened).toBe(true);
    await expect.poll(async () => (await overlayUrls(app)).some((u) => /report\?/.test(u)), { timeout: 20000 }).toBe(true);
    let chrome = null;
    await expect.poll(async () => {
      chrome = await overlayDom(app, 'report', '({ fs: !document.getElementById("btnFullscreen").hidden, exit: !document.getElementById("btnCloseOverlay").hidden, tab: !document.getElementById("btnOpenTab").hidden, title: (document.querySelector(".dxa-report-title")||{}).textContent||"" })');
      return chrome && chrome.title;
    }, { timeout: 15000 }).toContain('Preview Parity Report');
    expect(chrome.fs).toBe(true);
    expect(chrome.exit).toBe(true);
    expect(chrome.tab).toBe(true);

    expect(await clickOverlayButton(app, 'report', 'btnFullscreen')).toBe('Fullscreen');
    await expect.poll(async () => win.evaluate(() => window.dexerion.invoke('dex:overlay-fullscreen-state', { kind: 'report' })), { timeout: 15000 }).toBe(true);
    await expect.poll(async () => overlayDom(app, 'report', 'document.getElementById("btnFullscreen").textContent'), { timeout: 15000 }).toBe('Exit fullscreen');
    expect(await clickOverlayButton(app, 'report', 'btnFullscreen')).toBe('Exit fullscreen');
    await expect.poll(async () => win.evaluate(() => window.dexerion.invoke('dex:overlay-fullscreen-state', { kind: 'report' })), { timeout: 15000 }).toBe(false);
    await win.evaluate(() => window.dexerion.invoke('dex:report-overlay-close'));
    await expect.poll(async () => (await overlayUrls(app)).some((u) => /report\?/.test(u)), { timeout: 10000 }).toBe(false);

    expect(pageErrors).toEqual([]);
  } finally {
    await app.close().catch(() => {});
    await mock.close();
  }
});
