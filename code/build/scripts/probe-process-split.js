'use strict';
// V5 — per-process attribution: WHERE inside Dexerion's tree do the remaining
// measured gaps live? TEST-REPORT-3 puts active-browsing at CPU 107.0% /
// RAM 110.6% / power 120.5% of Edge and idle RAM 111.7%, but every number so
// far is a tree TOTAL. This probe attributes CPU/WS/private per process type
// and per pid, mapped to the WebContents each process hosts, under the same
// two shapes the protocol measures (idle: 1 page navigated in place; active:
// that page + 8 background animated tabs created detached via dex:new-tab).
//
// CPU semantics: app.getAppMetrics() reports percentCPUUsage SINCE THE
// PREVIOUS CALL, so the first sample is a since-boot baseline and is
// discarded; the remaining samples average to the per-pid CPU% over the
// sampling window.
//
// The probe reports; it does not judge. It also answers V5's spare-renderer
// question by construction: if renderer-process count equals hosted-page
// count in both shapes, no spare renderer exists to reclaim.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { launchDexerion } = require('../e2e/app');

const OUT = process.env.PROBE_SPLIT_OUT
  || path.join(os.tmpdir(), 'opencode', 'probe-process-split.json');
const WORKLOADS = (process.env.PROBE_SPLIT_WORKLOADS || 'idle,active')
  .split(',').map((s) => s.trim()).filter((s) => ['idle', 'active'].includes(s));
const BG_TABS = Math.max(0, Number(process.env.PROBE_SPLIT_BG_TABS) || 8);
const SAMPLES = Math.max(4, Number(process.env.PROBE_SPLIT_SAMPLES) || 16);
const SAMPLE_MS = 500;
const SETTLE_MS = 8000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STATIC_HTML = '<!doctype html><meta charset="utf-8"><title>split - idle</title><h1>Idle page</h1>';
const ANIMATED_HTML = `<!doctype html><meta charset="utf-8"><title>split - animated</title>
<body style="margin:0;background:#101018;overflow:hidden"><canvas id="c" width="960" height="640"></canvas>
<script>(function(){const c=document.getElementById('c'),x=c.getContext('2d');let f=0;
function frame(){f+=1;x.fillStyle='#101018';x.fillRect(0,0,c.width,c.height);
for(let i=0;i<28;i+=1){const a=(f/30+i/28)*Math.PI*2;x.fillStyle='hsl('+((i*13+f/4)%360)+' 80% 55%)';
x.beginPath();x.arc(480+Math.cos(a)*300,320+Math.sin(a*1.7)*180,8+(i%5)*3,0,Math.PI*2);x.fill();}
requestAnimationFrame(frame);}requestAnimationFrame(frame);})();</script></body>`;

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
    // Same fairness fix as measure-protocol.prepareDexerion: navigate the boot
    // newtab IN PLACE so page counts match Edge's arm exactly.
    const bootId = await win.evaluate(() => window.dexerion.invoke('dex:get-state')
      .then((st) => st.active || (st.tabs[0] && st.tabs[0].id) || null));
    await win.evaluate(({ id, u }) => window.dexerion.invoke('dex:navigate', id, u),
      { id: bootId, u: base + (workload === 'active' ? '/animated' : '/static') });
    if (workload === 'active') {
      for (let i = 0; i < BG_TABS; i += 1) {
        await win.evaluate(({ u, b }) => window.dexerion.invoke('dex:new-tab', u, b),
          { u: base + '/animated', b: true });
      }
    }
    const want = workload === 'active' ? BG_TABS + 1 : 1;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const st = await win.evaluate(() => window.dexerion.invoke('dex:get-state'));
      const tabs = (st && st.tabs) || [];
      if (tabs.length >= want && !tabs.some((t) => t.loading)) break;
      await win.waitForTimeout(250);
    }
    await sleep(SETTLE_MS);

    // pid -> hosted documents (shell chrome vs site pages), same technique as
    // probe-renderer-map.js.
    const mapContents = () => app.evaluate(({ webContents }) => {
      const out = [];
      for (const wc of webContents.getAllWebContents()) {
        const entry = {};
        for (const [key, fn] of [
          ['osPid', () => wc.getOSProcessId()],
          ['type', () => wc.getType()],
          ['url', () => String(wc.getURL() || '').slice(0, 120)],
        ]) {
          try { entry[key] = fn(); } catch (e) { entry[key] = 'ERR ' + String(e && e.message).slice(0, 60); }
        }
        out.push(entry);
      }
      return out;
    });

    // First getAppMetrics call: since-boot baseline. Discard.
    await app.evaluate(({ app }) => { app.getAppMetrics(); });
    const perPid = new Map(); // pid -> { cpuSum, cpuN, last: rows }
    for (let i = 0; i < SAMPLES; i += 1) {
      const rows = await app.evaluate(({ app }) => {
        const out = [];
        for (const m of app.getAppMetrics()) {
          const mem = (m && m.memory) || {};
          out.push({
            pid: m.pid,
            type: m.type || 'Unknown',
            name: m.name || m.serviceName || '',
            cpuPct: (m.cpu && m.cpu.percentCPUUsage) || 0,
            wsMB: Math.round((mem.workingSetSize || 0) / 1024),
            privateMB: Math.round((mem.privateBytes || 0) / 1024),
          });
        }
        return out;
      });
      for (const r of rows) {
        const acc = perPid.get(r.pid) || { type: r.type, name: r.name, cpuSum: 0, cpuN: 0, last: r };
        acc.type = r.type; acc.name = r.name;
        acc.cpuSum += r.cpuPct; acc.cpuN += 1;
        acc.last = r;
        perPid.set(r.pid, acc);
      }
      if (i < SAMPLES - 1) await sleep(SAMPLE_MS);
    }
    const contents = await mapContents();
    const byPid = {};
    for (const wc of contents) {
      if (wc && wc.osPid) (byPid[wc.osPid] = byPid[wc.osPid] || []).push((wc.type || '') + ':' + (wc.url || ''));
    }

    const procs = [...perPid.entries()].map(([pid, acc]) => ({
      pid,
      type: acc.type,
      name: acc.name,
      cpuPct: Math.round((acc.cpuSum / Math.max(1, acc.cpuN)) * 1000) / 1000,
      wsMB: acc.last.wsMB,
      privateMB: acc.last.privateMB,
      hosts: byPid[pid] || [],
    })).sort((a, b) => b.cpuPct - a.cpuPct || b.wsMB - a.wsMB);

    const byType = {};
    for (const p of procs) {
      const t = byType[p.type] || { count: 0, cpuPct: 0, wsMB: 0, privateMB: 0 };
      t.count += 1; t.cpuPct = Math.round((t.cpuPct + p.cpuPct) * 1000) / 1000;
      t.wsMB += p.wsMB; t.privateMB += p.privateMB;
      byType[p.type] = t;
    }
    const treeWs = procs.reduce((s, p) => s + p.wsMB, 0);
    const treeCpu = Math.round(procs.reduce((s, p) => s + p.cpuPct, 0) * 1000) / 1000;
    const tabProcs = procs.filter((p) => p.type === 'Tab');
    const pageHosted = Object.keys(byPid).length;

    return {
      workload,
      treeWsMB: treeWs,
      treeCpuPct: treeCpu,
      processCount: procs.length,
      rendererCount: tabProcs.length,
      hostedPages: pageHosted,
      spareRenderer: tabProcs.length > pageHosted ? 'possible' : 'none (renderers == hosted pages)',
      byType,
      procs,
      webContents: contents,
    };
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
    console.log('=== workload ' + workload + ' (tree ' + row.treeWsMB + ' MB, treeCPU ' + row.treeCpuPct
      + '% of one core, ' + row.processCount + ' processes) ===');
    console.log('SPARE_RENDERER: ' + row.spareRenderer
      + ' (renderers=' + row.rendererCount + ', hostedPages=' + row.hostedPages + ')');
    console.log('BY_TYPE: ' + JSON.stringify(row.byType));
    for (const p of row.procs) {
      console.log('  pid ' + p.pid + ' [' + p.type + (p.name ? '/' + p.name : '') + ']'
        + ' cpu=' + p.cpuPct + '% ws=' + p.wsMB + 'MB priv=' + p.privateMB + 'MB'
        + (p.hosts.length ? ' hosts=' + JSON.stringify(p.hosts) : ''));
    }
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2), 'utf8');
  console.log('PROCESS SPLIT EVIDENCE: ' + OUT);
  console.log('PROCESS SPLIT OK');
})().catch((err) => {
  console.error('PROCESS SPLIT ERROR: ' + (err && err.stack || err));
  process.exitCode = 1;
});
