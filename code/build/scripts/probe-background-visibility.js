'use strict';
// Platform-level proof for the background-tab fix: open a page in a BACKGROUND
// tab and read back what the page itself sees. The page writes
// document.visibilityState into its title from a setInterval (timers keep
// firing when a document is hidden, rAF does not), so the report arrives even
// if the document is throttled. If Chromium treats the detached+hidden
// WebContentsView as a hidden document (which is what the fix relies on), the
// title reads "hidden" and requestAnimationFrame stays paused.
const http = require('node:http');
const { launchDexerion } = require('../e2e/app');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HTML = `<!doctype html><meta charset="utf-8"><title>probe</title>
<script>
  function report() {
    document.title = 'vis:' + document.visibilityState
      + ':raf:' + (window.__rafRan ? 'yes' : 'no');
  }
  window.__rafRan = false;
  requestAnimationFrame(function frame() { window.__rafRan = true; });
  setInterval(report, 300);
  report();
</script>`;

(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(HTML);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const launched = await launchDexerion({ attempts: 2, gpu: 'adaptive' });
  const { win } = launched;
  try {
    // Foreground quiet tab, then the probe page as a true background tab.
    await win.evaluate(() => window.dexerion.invoke('dex:new-tab', 'dexerion://newtab', false));
    await win.evaluate((u) => window.dexerion.invoke('dex:new-tab', u, true), base);
    await sleep(3000);
    const st = await win.evaluate(() => window.dexerion.invoke('dex:get-state'));
    const tabs = (st && st.tabs) || [];
    const probe = tabs.find((t) => String(t.url || '').startsWith(base));
    const power = await win.evaluate(() => window.dexerion.invoke('dex:power-state'));
    const title = probe ? String(probe.title || '') : '(no probe tab)';
    const hidden = title.includes(':hidden');
    const rafPaused = title.includes(':raf:no');
    console.log('PROBE_TAB_TITLE: ' + title);
    console.log('BACKGROUND_TAB_HIDDEN: ' + hidden);
    console.log('BACKGROUND_RAF_PAUSED: ' + rafPaused);
    console.log('POWER_TIER: ' + (power && power.tier) + ' VISIBLE_TABS=' +
      (power && power.signals ? power.signals.activeTabCount + '/' + '?'
        : 'n/a'));
    console.log(hidden && rafPaused ? 'VISIBILITY PROBE PASS' : 'VISIBILITY PROBE FAIL');
    process.exitCode = hidden && rafPaused ? 0 : 1;
  } finally {
    try { await launched.app.close(); } catch {}
    server.close();
  }
})().catch((err) => {
  console.error('VISIBILITY PROBE ERROR: ' + (err && err.stack || err));
  process.exitCode = 1;
});
