'use strict';
// V2 quick memory gate: whole-tree working set + process count for the
// standard 5-tab local workload (1 active animated + 4 background animated —
// the measure-protocol "multitasking" shape at quick-gate size, reusing the
// power-benchmark page/server approach). Throwaway profile only.
//
// The probe reports; it does not judge. Lines it prints:
//   MEMORY_PROBE_PROFILE   optimized|baseline (DEX_DEBLOAT_BASELINE state)
//   TREE_WORKING_SET_MB    sum of app.getAppMetrics() workingSetSize (KB->MB)
//   TREE_PRIVATE_MB        same sum over privateBytes
//   PROCESS_COUNT          app.getAppMetrics().length
//   RENDERER_PROCESS_COUNT electron.exe children with --type=renderer (Win32_Process)
//   RENDERER_JS_FLAGS      distinct --js-flags values on those renderer
//                          command lines (ground truth that the js-flags
//                          switch actually reaches renderer processes)
//   PAGE_JS_HEAP           jsHeapSizeLimit/usedJSHeapSize reported by the
//                          pages themselves (performance.memory), per tab
//
// A/B helper (not part of the shipped number): DEX_PROBE_MULTI_SITE=1 opens
// 1 active static + 7 background animated tabs on seven DIFFERENT loopback
// hosts (127.0.0.2-127.0.0.8, each its own http server), which is what makes
// renderer-process-limit bite — same-site tabs already share one process via
// process-per-site, so the single-origin workload can never exercise it.

const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { launchDexerion } = require('../e2e/app');

const OUT = process.env.PROBE_MEMORY_OUT
  || path.join(os.tmpdir(), 'opencode', 'probe-memory-footprint.json');
const SETTLE_MS = 8000;
const BG_TABS = Math.max(1, Number(process.env.PROBE_BG_TABS) || 4);
const fs = require('node:fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (v, d = 1) => Number(Number(v).toFixed(d));

// Same pages as power-benchmark.js, plus a heap report in the title: the page
// itself reads performance.memory (a renderer-side read is the point — it
// shows the V8 limit the process was actually booted with). A setInterval
// carries the update because a frozen background tab stops rAF but keeps
// timers, so every tab reports no matter its state.
const STATIC_HTML = `<!doctype html><meta charset="utf-8"><title>Dexerion memory probe - idle</title>
<body style="margin:0;background:#f6f6f4;font:16px system-ui;color:#222"><h1>Memory probe</h1><p>Idle page</p>
<script>
  function report() {
    var m = performance.memory || {};
    document.title = 'heap ' + Math.round((m.jsHeapSizeLimit || 0) / 1048576)
      + '/' + Math.round((m.usedJSHeapSize || 0) / 1048576) + ' MB';
  }
  setInterval(report, 500); report();
</script></body>`;

const ANIMATED_HTML = `<!doctype html><meta charset="utf-8"><title>Dexerion memory probe - animated</title>
<body style="margin:0;background:#101018;overflow:hidden">
<canvas id="c" width="960" height="640"></canvas>
<script>
(function () {
  const c = document.getElementById('c'), x = c.getContext('2d');
  let f = 0;
  function frame() {
    f += 1;
    x.fillStyle = '#101018'; x.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < 28; i += 1) {
      const a = (f / 30 + i / 28) * Math.PI * 2;
      x.fillStyle = 'hsl(' + ((i * 13 + f / 4) % 360) + ' 80% 55%)';
      x.beginPath();
      x.arc(480 + Math.cos(a) * 300, 320 + Math.sin(a * 1.7) * 180, 8 + (i % 5) * 3, 0, Math.PI * 2);
      x.fill();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  setInterval(function () { document.body.style.background = (f % 2) ? '#101018' : '#14141f'; }, 250);
  function report() {
    var m = performance.memory || {};
    document.title = 'heap ' + Math.round((m.jsHeapSizeLimit || 0) / 1048576)
      + '/' + Math.round((m.usedJSHeapSize || 0) / 1048576) + ' MB';
  }
  setInterval(report, 500); report();
})();
</script></body>`;

function makeServer(host) {
  const server = http.createServer((req, res) => {
    const animated = /animated/.test(req.url || '');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(animated ? ANIMATED_HTML : STATIC_HTML);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => resolve({ server, base: 'http://' + host + ':' + server.address().port }));
  });
}

// Ground truth for child-process command lines (same oracle test-gpu-modes.js
// uses for the GPU process, widened to renderers). Full lines so the probe
// output is auditable rather than a bare boolean.
function rendererCmdlines() {
  const ps = "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | "
    + 'Where-Object { $_.CommandLine -match \'--type=renderer\' } | '
    + 'Select-Object -ExpandProperty CommandLine';
  try {
    return String(execFileSync('powershell.exe', ['-NoProfile', '-NoLogo', '-Command', ps],
      { encoding: 'utf8', timeout: 30000 }) || '')
      .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch { return []; }
}

function allElectronPids() {
  const ps = "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | "
    + 'Select-Object -ExpandProperty ProcessId';
  try {
    return String(execFileSync('powershell.exe', ['-NoProfile', '-NoLogo', '-Command', ps],
      { encoding: 'utf8', timeout: 30000 }) || '')
      .split(/\r?\n/).map((s) => Number(s.trim())).filter(Number.isFinite);
  } catch { return []; }
}

function jsFlagsOf(cmdline) {
  const m = /--js-flags=(?:"([^"]*)"|(\S*))/.exec(cmdline || '');
  return (m && (m[1] || m[2])) || '';
}

(async () => {
  const multiSite = process.env.DEX_PROBE_MULTI_SITE === '1';
  const servers = [];
  const bases = [];
  try {
    if (multiSite) {
      // Eight distinct loopback hosts = eight distinct sites for
      // process-per-site, so renderer-process-limit is actually exercised.
      for (let i = 0; i < 8; i += 1) {
        const s = await makeServer('127.0.0.' + (i + 2));
        servers.push(s);
        bases.push(s.base);
      }
    } else {
      const s = await makeServer('127.0.0.1');
      servers.push(s);
      bases.push(s.base);
    }
    const base = bases[0];

    const launched = await launchDexerion({ attempts: 2, gpu: process.env.DEX_PROBE_GPU || 'adaptive' });
    const { win, app } = launched;
    try {
      const open = async (url, background) => {
        await win.evaluate(({ u, b }) => window.dexerion.invoke('dex:new-tab', u, b), { u: url, b: background });
      };
      if (multiSite) {
        await open(bases[0] + '/static', false);
        for (let i = 1; i < bases.length; i += 1) await open(bases[i] + '/animated', true);
      } else {
        await open(base + '/animated', false);
        for (let i = 0; i < BG_TABS; i += 1) await open(base + '/animated', true);
      }
      // Wait until every opened tab has stopped loading.
      const want = multiSite ? bases.length : BG_TABS + 1;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const st = await win.evaluate(() => window.dexerion.invoke('dex:get-state'));
        const tabs = (st && st.tabs) || [];
        if (tabs.length >= want && !tabs.some((t) => t.loading)) break;
        await win.waitForTimeout(250);
      }
      await sleep(SETTLE_MS);

      // Whole-tree metrics from the main process.
      const metrics = await app.evaluate(({ app }) => {
        const rows = [];
        let wsKB = 0, privKB = 0;
        for (const m of app.getAppMetrics()) {
          const mem = (m && m.memory) || {};
          wsKB += mem.workingSetSize || 0;
          privKB += mem.privateBytes || 0;
          rows.push({
            pid: m.pid, type: m.type || 'Unknown', name: m.name || m.serviceName || '',
            wsMB: Math.round((mem.workingSetSize || 0) / 1024),
            privateMB: Math.round((mem.privateBytes || 0) / 1024),
          });
        }
        const byType = {};
        for (const r of rows) byType[r.type] = (byType[r.type] || 0) + 1;
        return {
          mainPid: process.pid,
          workingSetMB: Math.round(wsKB / 1024),
          privateMB: Math.round(privKB / 1024),
          processCount: rows.length,
          byType,
          procs: rows.sort((a, b) => b.wsMB - a.wsMB),
        };
      });

      // Renderer process command lines (outside the app, via CIM).
      const cmdlines = rendererCmdlines();
      const pids = allElectronPids();
      const rendererFlags = [...new Set(cmdlines.map(jsFlagsOf).filter(Boolean))];
      const gpuFlags = [...new Set(cmdlines
        .filter((c) => /--type=gpu-process/.test(c))
        .map(jsFlagsOf).filter(Boolean))];

      // What the pages themselves see (performance.memory), from tab titles.
      const st = await win.evaluate(() => window.dexerion.invoke('dex:get-state'));
      const tabs = (st && st.tabs) || [];
      const heapByTitle = tabs.map((t) => {
        const m = /heap (\d+)\/(\d+) MB/.exec(String(t.title || ''));
        return {
          active: Boolean(t.active), sleeping: Boolean(t.sleeping),
          jsHeapLimitMB: m ? Number(m[1]) : null,
          jsHeapUsedMB: m ? Number(m[2]) : null,
        };
      });
      let gpuInfo = null;
      try { gpuInfo = await win.evaluate(() => window.dexerion.invoke('dex:gpu-info')); } catch {}

      const result = {
        generatedAt: new Date().toISOString(),
        workload: multiSite
          ? 'multi-site A/B: 1 active static + 7 background animated across 8 loopback hosts'
          : '1 active animated + ' + BG_TABS + ' background animated (single local origin)',
        profile: process.env.DEX_DEBLOAT_BASELINE === '1' ? 'baseline' : 'optimized',
        gpuMode: process.env.DEX_PROBE_GPU || 'adaptive',
        settleMs: SETTLE_MS,
        metrics,
        osElectronPids: pids.length,
        rendererCount: cmdlines.length,
        rendererJsFlags: rendererFlags,
        gpuJsFlags: gpuFlags,
        rendererCmdlines: cmdlines,
        pageHeaps: heapByTitle,
        gpuInfo,
        tabs: tabs.length,
      };
      fs.mkdirSync(path.dirname(OUT), { recursive: true });
      fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');

      console.log('MEMORY_PROBE_PROFILE: ' + result.profile);
      console.log('TREE_WORKING_SET_MB: ' + metrics.workingSetMB);
      console.log('TREE_PRIVATE_MB: ' + metrics.privateMB);
      console.log('PROCESS_COUNT: ' + metrics.processCount + ' (os electron.exe pids: ' + pids.length + ')');
      console.log('BY_TYPE: ' + JSON.stringify(metrics.byType));
      console.log('RENDERER_PROCESS_COUNT: ' + cmdlines.length);
      console.log('RENDERER_JS_FLAGS: ' + JSON.stringify(rendererFlags));
      console.log('GPU_JS_FLAGS: ' + JSON.stringify(gpuFlags));
      console.log('PAGE_JS_HEAP: ' + JSON.stringify(heapByTitle));
      console.log('TABS: ' + tabs.length);
      console.log('TOP_PROCS: ' + JSON.stringify(metrics.procs.slice(0, 6)));
      console.log('MEMORY PROBE EVIDENCE: ' + OUT);
      console.log('MEMORY PROBE OK');
    } finally {
      try { await launched.app.close(); } catch {}
    }
  } finally {
    for (const s of servers) { try { s.server.close(); } catch {} }
  }
})().catch((err) => {
  console.error('MEMORY PROBE ERROR: ' + (err && err.stack || err));
  process.exitCode = 1;
});
