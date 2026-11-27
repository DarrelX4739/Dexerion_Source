'use strict';
// V4 experiment 2 — why does a third renderer persist at idle with one tab?
//
// probe-memory-footprint counts renderers by --type=renderer command lines but
// cannot say WHICH page each renderer hosts. This probe maps every renderer
// process to the WebContents it hosts, so the extra renderer can be named
// precisely (shell chrome? boot newtab? site process? extension host?).
//
// Workloads (env PROBE_RENDERER_WORKLOADS, default "boot,idle"):
//   boot   — just booted: the single dexerion://newtab tab the app plants
//   idle   — the measure-protocol "idle" shape: boot newtab + 1 static tab
//   active — the measure-protocol "active-browsing" shape: boot newtab +
//            1 animated tab; also samples per-process CPU% twice 5 s apart
//
// For each workload (separate throwaway-profile launch): app.getAppMetrics()
// rows (pid / type / ws / private / cpu%), the webContents -> OS-pid map, and
// the full --type=renderer / gpu-process / utility command lines. The probe
// reports; it does not judge.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { launchDexerion } = require('../e2e/app');

const OUT = process.env.PROBE_RENDERER_OUT
  || path.join(os.tmpdir(), 'opencode', 'probe-renderer-map.json');
const WORKLOADS = (process.env.PROBE_RENDERER_WORKLOADS || 'boot,idle')
  .split(',').map((s) => s.trim()).filter((s) => ['boot', 'idle', 'active'].includes(s));
const SETTLE_MS = 8000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STATIC_HTML = '<!doctype html><meta charset="utf-8"><title>renderer map - idle</title><h1>Idle page</h1>';
const ANIMATED_HTML = `<!doctype html><meta charset="utf-8"><title>renderer map - animated</title>
<body style="margin:0;background:#101018;overflow:hidden"><canvas id="c" width="960" height="640"></canvas>
<script>(function(){const c=document.getElementById('c'),x=c.getContext('2d');let f=0;
function frame(){f+=1;x.fillStyle='#101018';x.fillRect(0,0,c.width,c.height);
for(let i=0;i<28;i+=1){const a=(f/30+i/28)*Math.PI*2;x.fillStyle='hsl('+((i*13+f/4)%360)+' 80% 55%)';
x.beginPath();x.arc(480+Math.cos(a)*300,320+Math.sin(a*1.7)*180,8+(i%5)*3,0,Math.PI*2);x.fill();}
requestAnimationFrame(frame);}requestAnimationFrame(frame);})();</script></body>`;

function electronCmdlines(kind) {
  const ps = "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | "
    + "Where-Object { $_.CommandLine -match '--type=" + kind + "' } | "
    + 'Select-Object -ExpandProperty CommandLine';
  try {
    return String(execFileSync('powershell.exe', ['-NoProfile', '-NoLogo', '-Command', ps],
      { encoding: 'utf8', timeout: 30000 }) || '')
      .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch { return []; }
}

async function runWorkload(workload) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(/animated/.test(req.url || '') ? ANIMATED_HTML : STATIC_HTML);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const launched = await launchDexerion({ attempts: 2, gpu: 'adaptive' });
  const { win, app } = launched;
  try {
    if (workload !== 'boot') {
      const page = workload === 'active' ? '/animated' : '/static';
      await win.evaluate(({ u }) => window.dexerion.invoke('dex:new-tab', u, false), { u: base + page });
      for (let i = 0; i < 40; i += 1) {
        const st = await win.evaluate(() => window.dexerion.invoke('dex:get-state'));
        const tabs = (st && st.tabs) || [];
        if (tabs.length >= 2 && !tabs.some((t) => t.loading)) break;
        await win.waitForTimeout(250);
      }
    }
    await sleep(SETTLE_MS);

    const sample = () => app.evaluate(({ app, webContents }) => {
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
          cpuPct: Math.round(((m.cpu && m.cpu.percentCPUUsage) || 0) * 10) / 10,
        });
      }
      // Which process hosts which document — the whole point of this probe.
      const contents = [];
      for (const wc of webContents.getAllWebContents()) {
        const entry = {};
        for (const [key, fn] of [
          ['osPid', () => wc.getOSProcessId()],
          ['type', () => wc.getType()],
          ['url', () => String(wc.getURL() || '').slice(0, 120)],
        ]) {
          try { entry[key] = fn(); } catch (e) { entry[key] = 'ERR ' + String(e && e.message).slice(0, 60); }
        }
        contents.push(entry);
      }
      const tabs = [];
      try {
        for (const w of require('electron').BrowserWindow.getAllWindows()) {
          tabs.push({ pid: w.webContents.getOSProcessId(), url: String(w.webContents.getURL() || '').slice(0, 120) });
        }
      } catch {}
      return {
        treeWsMB: Math.round(wsKB / 1024),
        treePrivateMB: Math.round(privKB / 1024),
        metrics: rows,
        webContents: contents,
        windows: tabs,
      };
    });
    const s1 = await sample();
    let s2 = null;
    if (workload === 'active') { await sleep(5000); s2 = await sample(); }

    const result = {
      workload,
      treeWsMB: s1.treeWsMB,
      treePrivateMB: s1.treePrivateMB,
      metrics: s1.metrics,
      webContents: s1.webContents,
      windows: s1.windows,
      rendererCmdlines: electronCmdlines('renderer'),
      gpuCmdlines: electronCmdlines('gpu-process'),
      utilityCmdlines: electronCmdlines('utility'),
      cpuSample2: s2 ? s2.metrics : null,
    };
    return result;
  } finally {
    try { await launched.app.close(); } catch {}
    try { server.close(); } catch {}
  }
}

(async () => {
  const results = [];
  for (const workload of WORKLOADS) {
    const row = await runWorkload(workload).catch((err) => ({ workload, error: String(err && err.stack || err) }));
    results.push(row);
    if (row.error) {
      console.log('WORKLOAD ' + workload + ': ERROR ' + row.error.split('\n')[0]);
      continue;
    }
    console.log('=== workload ' + workload + ' (tree ' + row.treeWsMB + ' MB) ===');
    const tabProcs = row.metrics.filter((m) => m.type === 'Tab');
    console.log('TAB_PROCS: ' + JSON.stringify(tabProcs));
    // pid -> hosted URLs, from the webContents map
    const byPid = {};
    for (const wc of row.webContents) {
      if (wc && wc.osPid) {
        (byPid[wc.osPid] = byPid[wc.osPid] || []).push((wc.type || '') + ':' + (wc.url || ''));
      }
    }
    for (const t of tabProcs) {
      console.log('RENDERER_MAP pid=' + t.pid + ' ws=' + t.wsMB + 'MB private=' + t.privateMB
        + 'MB hosts=' + JSON.stringify(byPid[t.pid] || []));
    }
    console.log('ALL_WEBCONTENTS: ' + JSON.stringify(row.webContents));
    console.log('RENDERER_COUNT: ' + tabProcs.length);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2), 'utf8');
  console.log('RENDERER MAP EVIDENCE: ' + OUT);
  console.log('RENDERER MAP OK');
})().catch((err) => {
  console.error('RENDERER MAP ERROR: ' + (err && err.stack || err));
  process.exitCode = 1;
});
