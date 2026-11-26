'use strict';
// Diagnostic (Builder-local, run 2): attached-view visibility semantics.
// Every state is measured on ONE view with real bounds, attached to the
// visible shell window:
//   1 attached+visible           -> sanity (expect vis:visible, raf running)
//   2 attached + setVisible(false)
//   3 detach (no setVisible)     -> is detach alone the off-switch?
//   4 detach + setVisible(false) -> the proven background-tab state
//   5 re-attach + setVisible(true)
//   6 window minimized with the view attached+visible (occlusion calc is
//     disabled in this app -> what does the page see?)
const http = require('node:http');
const { launchDexerion } = require('../e2e/app');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const REPORTER = `<!doctype html><meta charset="utf-8"><title>semantics</title>
<script>
  window.__rafCount = 0;
  requestAnimationFrame(function frame() { window.__rafCount++; requestAnimationFrame(frame); });
</script>`;

(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(REPORTER);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  const launched = await launchDexerion({ attempts: 2, gpu: 'adaptive' });
  const { app } = launched;
  try {
    const out = await app.evaluate(async ({ WebContentsView, BrowserWindow }, url) => {
      const shell = BrowserWindow.getAllWindows()[0];
      const v = new WebContentsView({ webPreferences: {} });
      const read = async (label) => {
        let r = null;
        try {
          r = await v.webContents.executeJavaScript(
            `({ vis: document.visibilityState, raf: window.__rafCount || 0 })`, true);
        } catch (e) { r = { err: String(e && e.message) }; }
        await new Promise((res) => setTimeout(res, 1500));
        let r2 = null;
        try {
          r2 = await v.webContents.executeJavaScript(
            `({ vis: document.visibilityState, raf: window.__rafCount || 0 })`, true);
        } catch (e) { r2 = { err: String(e && e.message) }; }
        return { label, first: r, rafAdvanced: r2 && r.first ? (r2.raf - r.raf) : null };
      };
      const errs = [];
      try { shell.contentView.addChildView(v); v.setBounds({ x: 0, y: 0, width: 500, height: 400 }); v.setVisible(true); } catch (e) { errs.push('attach:' + e.message); }
      await v.webContents.loadURL(url);
      await new Promise((r) => setTimeout(r, 1500));
      const s1 = await read('1-attached-visible');
      try { v.setVisible(false); } catch (e) { errs.push('svfalse:' + e.message); }
      const s2 = await read('2-attached-setVisibleFalse');
      try { v.setVisible(true); } catch (e) { errs.push('svtrue:' + e.message); }
      try { shell.contentView.removeChildView(v); } catch (e) { errs.push('detach:' + e.message); }
      const s3 = await read('3-detached-only');
      try { v.setVisible(false); } catch (e) { errs.push('svfalse2:' + e.message); }
      const s4 = await read('4-detached-hidden');
      try { v.setVisible(true); } catch (e) { errs.push('svtrue2:' + e.message); }
      try { shell.contentView.addChildView(v); v.setBounds({ x: 0, y: 0, width: 500, height: 400 }); } catch (e) { errs.push('reattach:' + e.message); }
      const s5 = await read('5-reattached-visible');
      try { shell.minimize(); } catch (e) { errs.push('minimize:' + e.message); }
      await new Promise((r) => setTimeout(r, 1500));
      const s6 = await read('6-window-minimized-view-attached');
      try { shell.restore(); } catch (e) { errs.push('restore:' + e.message); }
      await new Promise((r) => setTimeout(r, 1200));
      const s7 = await read('7-restored');
      try { shell.contentView.removeChildView(v); v.webContents.close(); } catch {}
      return { errs, states: [s1, s2, s3, s4, s5, s6, s7] };
    }, base);
    for (const s of out.states) {
      console.log(s.label + ': ' + JSON.stringify(s.first) + ' rafAdvanced=' + s.rafAdvanced);
    }
    console.log('WCV_ERRS: ' + JSON.stringify(out.errs));
    process.exitCode = 0;
  } finally {
    try { await launched.app.close(); } catch {}
    server.close();
  }
})().catch((err) => {
  console.error('WCV SEMANTICS ERROR: ' + (err && err.stack || err));
  process.exitCode = 1;
});
