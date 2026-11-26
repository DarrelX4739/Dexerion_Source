'use strict';
// B1 popup-case probe (PLAN C4/B1): pins down the measured, intended popup
// behaviour so it cannot drift silently.
//
// Measured facts this probe documents (Electron 44, CalculateNativeWinOcclusion
// disabled — the app's shipped switch):
//   1. An auth-shaped window.open becomes a REAL child BrowserWindow
//      (the sign-in popup path), live in the opener's session.
//   2. A popup stays visible and keeps producing frames when its OWNER
//      window is minimized — the same behaviour Chrome/Edge show for popups
//      (they are separate top-level windows). BrowserWindow.hide() does not
//      propagate renderer visibility in this build (nothing marks hidden
//      windows non-occluded), so hiding popups would change the UI without
//      saving any work: not done, deliberately.
// PASS = the popup is a real window, its renderer is live, and the owner
// minimize leaves it exactly as documented.
const http = require('node:http');
const { launchDexerion } = require('../e2e/app');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const REPORTER = `<!doctype html><meta charset="utf-8"><title>probe</title>
<script>
  function report() {
    document.title = 'vis:' + document.visibilityState
      + ':raf:' + (window.__rafRan ? 'yes' : 'no');
  }
  window.__rafRan = false;
  requestAnimationFrame(function frame() { window.__rafRan = true; requestAnimationFrame(frame); });
  setInterval(report, 300);
  report();
</script>`;

const OPENER = `<!doctype html><meta charset="utf-8"><title>opener</title>
<script>
  setTimeout(function () {
    window.open('http://localhost:' + location.port + '/login', 'dex-signin', 'width=480,height=640');
  }, 500);
</script>`;

(async () => {
  const server = http.createServer((req, res) => {
    const body = String(req.url || '').startsWith('/login') ? REPORTER : OPENER;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const launched = await launchDexerion({ attempts: 2 });
  const { app, win } = launched;
  try {
    // Foreground tab that opens the sign-in popup (cross-site: 127.0.0.1 ->
    // localhost, /login path is auth-shaped).
    await win.evaluate((u) => window.dexerion.invoke('dex:new-tab', u, false), base + '/opener');
    // Wait for the popup page to show up among the app's windows.
    let popup = null;
    for (let i = 0; i < 40 && !popup; i++) {
      await sleep(500);
      const pages = app.windows();
      popup = pages.find((p) => {
        try { return /\/login(\?|$)/.test(p.url()); } catch { return false; }
      }) || null;
    }
    if (!popup) throw new Error('popup window never appeared (was it classified as a tab?)');
    await sleep(1500); // let its reporter loop start
    const before = await popup.title();
    console.log('PROBE_POPUP_TITLE_BEFORE: ' + before);

    // Minimize the owner, wait, then read the popup's OS visibility and its
    // page's own report back.
    const minimized = await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) {
        let url = '';
        try { url = w.webContents.getURL(); } catch {}
        if (!/\/login(\?|$)/.test(url)) { w.minimize(); return true; }
      }
      return false;
    });
    await sleep(1500);
    const states = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => {
      let url = '';
      try { url = w.webContents.getURL(); } catch {}
      return { url: String(url).split('/').pop(), visible: w.isVisible(), minimized: w.isMinimized() };
    }));
    console.log('PROBE_WINDOW_STATES_MINIMIZED: ' + JSON.stringify(states));
    const after = await popup.title();
    console.log('PROBE_POPUP_TITLE_OWNER_MINIMIZED: ' + after);

    // Restore the owner; the popup is untouched either way.
    await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) {
        let url = '';
        try { url = w.webContents.getURL(); } catch {}
        if (!/\/login(\?|$)/.test(url)) { w.restore(); return; }
      }
    });
    await sleep(1200);
    const restored = await popup.title();
    console.log('PROBE_POPUP_TITLE_RESTORED: ' + restored);

    const isRealPopup = states.some((s) => /login/.test(s.url));
    const osHidesWithOwner = states.some((s) => /login/.test(s.url) && !s.visible)
      && states.some((s) => /shell/.test(s.url) && s.minimized);
    const live = /vis:visible/.test(before) && /:raf:yes/.test(before);
    const ownerMinimized = states.some((s) => /shell/.test(s.url) && s.minimized);
    const rendererStaysLive = /vis:visible/.test(after) && /:raf:yes/.test(after);
    console.log('POPUP_IS_REAL_WINDOW: ' + isRealPopup);
    console.log('POPUP_RENDERER_LIVE: ' + live);
    console.log('OWNER_MINIMIZED: ' + ownerMinimized);
    console.log('OS_HIDES_POPUP_WITH_OWNER: ' + osHidesWithOwner
      + ' (Windows owned-window behaviour)');
    console.log('POPUP_RENDERER_STILL_PRODUCING_WHILE_OS_HIDDEN: ' + rendererStaysLive
      + ' (documented constraint: BrowserWindow hide/minimize does not propagate'
      + ' renderer visibility with CalculateNativeWinOcclusion disabled; no'
      + ' main-process lever exists for a BrowserWindow page)');
    const pass = Boolean(isRealPopup && live && ownerMinimized && rendererStaysLive);
    console.log(pass ? 'POPUP VISIBILITY PROBE PASS' : 'POPUP VISIBILITY PROBE FAIL');
    process.exitCode = pass ? 0 : 1;
  } finally {
    try { await launched.app.close(); } catch {}
    server.close();
  }
})().catch((err) => {
  console.error('POPUP VISIBILITY PROBE ERROR: ' + (err && err.stack || err));
  process.exitCode = 1;
});
