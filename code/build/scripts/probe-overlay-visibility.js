'use strict';
// B1 overlay-case visibility probe (PLAN C4/B1): proves the hidden-view
// consistency fix with the app's real frame-production lever.
//
// Measured basis (probe-wcv-semantics.js): an ATTACHED view keeps producing
// rAF frames whether it is setVisible(false)'d or its window is minimized
// (CalculateNativeWinOcclusion is disabled here); the state that stops frame
// production is detach + setVisible(false) — the same state the background
// tab fix uses. So the pass criterion below is "rAF stopped", not
// document.visibilityState (which can stay stale-visible after a runtime
// detach).
//
// 1. Open the snip overlay (in-window WebContentsView), minimize the window,
//    and read the overlay page's rAF witness through the main process's
//    read-only dex:overlay-state seam. PASS: rAF paused while minimized,
//    producing again after restore.
// 2. Open the fullscreen AI-search surface (the page tab is parked at 0x0
//    behind it). PASS: the covered page's rAF paused while the surface is
//    open, producing again after close.
const { launchDexerion } = require('../e2e/app');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readOverlayState(win) {
  // dex:overlay-state is keyed by window id; the probe drives one window.
  const st = await win.evaluate(() => window.dexerion.invoke('dex:overlay-state'));
  const ids = Object.keys(st || {});
  return ids.length ? st[ids[0]] : null;
}

async function waitFor(fn, ms, step = 600) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(step);
  }
}

(async () => {
  const launched = await launchDexerion({ attempts: 2 });
  const { app, win } = launched;
  const minimizeParent = () => app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      let url = '';
      try { url = w.webContents.getURL(); } catch {}
      if (!/\/login(\?|$)/.test(url)) { w.minimize(); return true; }
    }
    return false;
  });
  const restoreParent = () => app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      let url = '';
      try { url = w.webContents.getURL(); } catch {}
      if (!/\/login(\?|$)/.test(url)) { w.restore(); return; }
    }
  });
  try {
    // ---- Part 1: the snip overlay follows the window ----
    await win.evaluate(() => window.dexerion.invoke('dex:snip-open'));
    const snipOpen = await waitFor(async () => {
      const s = await readOverlayState(win);
      return s && s.snip && s.snip.rafProducing === true ? s.snip : null;
    }, 20000);
    console.log('SNIP_OPEN_PRODUCING: ' + Boolean(snipOpen));
    const minimized = await minimizeParent();
    const snipPaused = await waitFor(async () => {
      const s = await readOverlayState(win);
      return s && s.snip && s.snip.rafProducing === false ? s.snip : null;
    }, 12000);
    console.log('PARENT_MINIMIZED: ' + Boolean(minimized));
    console.log('SNIP_RAF_PAUSED_WHEN_MINIMIZED: ' + Boolean(snipPaused));
    await restoreParent();
    const snipBack = await waitFor(async () => {
      const s = await readOverlayState(win);
      return s && s.snip && s.snip.rafProducing === true ? s.snip : null;
    }, 12000);
    console.log('SNIP_PRODUCING_AFTER_RESTORE: ' + Boolean(snipBack));

    // ---- Part 2: the page under the fullscreen search surface ----
    await win.evaluate(() => window.dexerion.invoke('dex:aisearch-open'));
    const pagePaused = await waitFor(async () => {
      const s = await readOverlayState(win);
      return s && s.searchOpen === true && s.page && s.page.rafProducing === false ? s.page : null;
    }, 12000);
    console.log('SEARCH_PAGE_RAF_PAUSED_WHILE_COVERED: ' + Boolean(pagePaused));
    await win.evaluate(() => window.dexerion.invoke('dex:aisearch-close'));
    const pageBack = await waitFor(async () => {
      const s = await readOverlayState(win);
      return s && s.searchOpen === false && s.page && s.page.rafProducing === true ? s.page : null;
    }, 12000);
    console.log('SEARCH_PAGE_PRODUCING_AFTER_CLOSE: ' + Boolean(pageBack));

    const pass = Boolean(snipOpen && minimized && snipPaused && snipBack
      && pagePaused && pageBack);
    console.log(pass ? 'OVERLAY VISIBILITY PROBE PASS' : 'OVERLAY VISIBILITY PROBE FAIL');
    process.exitCode = pass ? 0 : 1;
  } finally {
    try { await launched.app.close(); } catch {}
  }
})().catch((err) => {
  console.error('OVERLAY VISIBILITY PROBE ERROR: ' + (err && err.stack || err));
  process.exitCode = 1;
});
