'use strict';
// Tester measurement protocol (TESTER-BRIEF.md reqs 1-6, plan tier C1/C2/C3).
//
// Repeated controlled trials (>=5 per scenario per browser) of Dexerion vs
// Microsoft Edge over four axes, attributed to the WHOLE browser process tree:
//   CPU   — Win32_Process UserModeTime+KernelModeTime deltas (100 ns units)
//           summed across the browser process and every child.
//   RAM   — Win32_Process WorkingSetSize summed across the same tree.
//   GPU   — \GPU Engine(*)\Utilization Percentage + \GPU Process Memory(*)
//           \Local Usage grouped by pid (see measure-gpu-sample.ps1). Dexerion
//           ships software rendering by user decision, so its GPU numbers are
//           expected near-zero; the CPU cost is reported side-by-side.
//   Power — Windows RAPL \Energy Meter(rapl_package0_pkg)\Power (mW, 1 Hz,
//           first sample discarded) with the paired-floor protocol: the floor
//           is sampled immediately before each workload with no browser
//           running, so attribution is local in time. Trials whose floor
//           deviates >20% from their group's reference floor are INVALID.
//
// Workloads are deterministic local HTTP pages (same approach as
// power-benchmark.js). Both browsers run from throwaway profiles: Dexerion
// through the e2e electron harness (gpu:'adaptive' — the shipped Adaptive GPU
// policy), Edge through playwright channel 'msedge'. Kill switches stay in
// their shipped default state; nothing is special-cased for the benchmark.
//
// Usage:
//   node scripts/measure-protocol.js
// Env:
//   MEASURE_OUT_DIR        output dir for protocol JSON (default temp/opencode)
//   MEASURE_TRIALS         trials per scenario per browser (default 5)
//   MEASURE_SAMPLE_SEC     workload power-sample seconds (default 12)
//   MEASURE_FLOOR_SEC      paired-floor sample seconds (default 5)
//   MEASURE_SETTLE_MS      settle time after launch (default 6000)
//   MEASURE_SCENARIOS      comma list; default priority order
//                          active-browsing,background-tabs,idle,multitasking
//   MEASURE_BROWSERS       comma list; default edge,dexerion
//   MEASURE_DEADLINE_MIN   wall-clock budget in minutes (default 45); trials
//                          that would start past it are recorded as pending
//   MEASURE_NATIVE_LAUNCH  1 launches both binaries without automation flags
//   MEASURE_SKIP_POWER     1 omits RAPL on virtual hosts; never guesses power
//   DEX_BUILD_DIR          launch Dexerion from another build tree (used to
//                          measure the pre-build-1 baseline from a git
//                          worktree with a node_modules junction)

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require('@playwright/test');
const { openNative, edgeExecutable, waitFor, pagesIn, isShellUrl, samplePage } = require('./measure-native-browser.cjs');
const { memoryByRole, workloadOrder, optionalSample, requireTree, hasGpuSample, foregroundSample, workloadUrls, matchesInventory } = require('./measure-sample-guard.cjs');

const OUT_DIR = process.env.MEASURE_OUT_DIR
  || path.join(os.tmpdir(), 'opencode', 'dexerion-test1');
const TRIALS = Math.max(1, Number(process.env.MEASURE_TRIALS) || 5);
const SAMPLE_SEC = Math.max(4, Number(process.env.MEASURE_SAMPLE_SEC) || 12);
const FLOOR_SEC = Math.max(3, Number(process.env.MEASURE_FLOOR_SEC) || 5);
const SETTLE_MS = Math.max(2000, Number(process.env.MEASURE_SETTLE_MS) || 6000);
const GPU_INTERVAL_SEC = 2;
const BG_TABS = 8;
const DEADLINE_MIN = Number(process.env.MEASURE_DEADLINE_MIN) || 45;
const CORES = os.cpus().length;
const SKIP_POWER = process.env.MEASURE_SKIP_POWER === '1';
const NATIVE_LAUNCH = process.env.MEASURE_NATIVE_LAUNCH === '1';
const S = path.join(__dirname, 'measure-tree-snapshot.ps1');
const G = path.join(__dirname, 'measure-gpu-sample.ps1');
const E = path.join(__dirname, 'measure-env.ps1');
const PS_SCRIPT = path.join(__dirname, 'power-sample.ps1'); // existing, unmodified
const FLOOR_SWING_LIMIT = 0.20; // brief req 4: >20% floor swing => invalid

// Scenarios in priority order: the mission's core claim is ACTIVE browsing,
// so if the wall-clock budget runs out, the tail scenarios are the pendings.
const SCENARIOS = {
  'idle': { foreground: 'static', backgroundTabs: 0 },
  'active-browsing': { foreground: 'animated', backgroundTabs: 0 },
  'background-tabs': { foreground: 'static', backgroundTabs: BG_TABS },
  'multitasking': { foreground: 'animated', backgroundTabs: BG_TABS },
};
const SCENARIO_ORDER = (process.env.MEASURE_SCENARIOS
  || 'active-browsing,background-tabs,idle,multitasking')
  .split(',').map((s) => s.trim()).filter((s) => SCENARIOS[s]);
const BROWSERS = (process.env.MEASURE_BROWSERS || 'edge,dexerion')
  .split(',').map((s) => s.trim()).filter((s) => s === 'edge' || s === 'dexerion');

// Dexerion under test: the main build tree, or a baseline worktree build dir.
const DEX_BUILD_DIR = process.env.DEX_BUILD_DIR
  ? path.resolve(process.env.DEX_BUILD_DIR)
  : path.join(__dirname, '..');
const launchMod = require(path.join(DEX_BUILD_DIR, 'e2e', 'app.js'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (v, d = 2) => (Number.isFinite(v) ? Number(Number(v).toFixed(d)) : v);
const startedAt = Date.now();

// ---------------------------------------------------------------- workloads
// Deterministic local pages (approach reused from power-benchmark.js; the
// benchmark pages are static HTML + a fixed rAF canvas animation, served with
// no-store so every trial does the same work).
const STATIC_HTML = `<!doctype html><meta charset="utf-8"><title>Dexerion measure probe - idle</title>
<body style="margin:0;background:#f6f6f4;font:16px system-ui;color:#222"><h1>Measure probe</h1><p>Idle page</p></body>`;

const ANIMATED_HTML = `<!doctype html><meta charset="utf-8"><title>Dexerion measure probe - animated</title>
<body style="margin:0;background:#101018;overflow:hidden">
<canvas id="c" width="960" height="640"></canvas>
<script>
(function () {
  const c = document.getElementById('c'), x = c.getContext('2d');
  let f = 0;
  function frame() {
    f += 1;
    window.__dexMeasureFrames = f;
    x.fillStyle = '#101018'; x.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < 28; i += 1) {
      const a = (f / 30 + i / 28) * Math.PI * 2;
      x.fillStyle = 'hsl(' + ((i * 13 + f / 4) % 360) + ' 80% 55%)';
      x.beginPath();
      x.arc(480 + Math.cos(a) * 300, 320 + Math.sin(a * 1.7) * 180, 8 + (i % 5) * 3, 0, Math.PI * 2);
      x.fill();
    }
    if (f % 30 === 0) document.title = 'Measure probe frame ' + f;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  setInterval(function () { document.body.style.background = (f % 2) ? '#101018' : '#14141f'; }, 250);
})();
</script></body>`;

function startServer() {
  const server = http.createServer((req, res) => {
    const animated = /animated/.test(req.url || '');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(animated ? ANIMATED_HTML : STATIC_HTML);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ server, base: 'http://127.0.0.1:' + server.address().port });
  }));
}

// ------------------------------------------------------------- powershell IO
function runPs(script, args, timeoutSec) {
  const out = path.join(OUT_DIR, 'ps-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.json');
  const argv = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script];
  for (const [k, v] of Object.entries(args)) {
    if (v !== undefined && v !== null && v !== '') { argv.push('-' + k, String(v)); }
  }
  argv.push('-OutFile', out);
  try {
    execFileSync('powershell.exe', argv, { encoding: 'utf8', timeout: timeoutSec * 1000 });
    return JSON.parse(fs.readFileSync(out, 'utf8'));
  } finally { try { fs.rmSync(out, { force: true }); } catch {} }
}

const samplePower = (label, secs) => runPs(PS_SCRIPT, { DurationSec: secs }, secs + 40);
const treeSnapshot = () => runPs(S, {}, 60);
const envRecord = () => { try { return runPs(E, {}, 30); } catch { return null; } };

// GPU sampler runs concurrently with the RAPL sampler; spawn + await later.
function spawnGpu(treePids) {
  const out = path.join(OUT_DIR, 'gpu-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.json');
  const child = spawn('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', G,
    '-DurationSec', String(SAMPLE_SEC + 4),
    '-IntervalSec', String(GPU_INTERVAL_SEC),
    '-TreePids', treePids,
    '-OutFile', out,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += String(d); });
  return {
    out,
    finish: async () => {
      const deadline = Date.now() + (SAMPLE_SEC + 45) * 1000;
      while (child.exitCode === null && Date.now() < deadline) await sleep(500);
      if (child.exitCode === null) {
        try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
        return { error: 'gpu sampler timeout' };
      }
      if (child.exitCode !== 0) return { error: 'gpu sampler exit ' + child.exitCode + (stderr ? ': ' + stderr.slice(0, 300) : '') };
      try { return JSON.parse(fs.readFileSync(out, 'utf8')); }
      catch (e) { return { error: 'gpu sampler unreadable: ' + e.message }; }
    },
  };
}

// ------------------------------------------------------------ tree handling
// Seed: browser processes whose command line carries the throwaway profile
// dir; expand along parent links so crashpad/children with different
// command lines are still attributed. Whole tree, not one PID (brief req 2).
function extractTree(snapshot, profileDir) {
  const procs = snapshot.processes;
  const inTree = new Set();
  for (const p of procs) {
    if (/^(electron|Dexerion|msedge)\.exe$/i.test(p.name)
      && p.cmdline && p.cmdline.includes(profileDir)) { inTree.add(p.pid); }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of procs) {
      if (!inTree.has(p.pid) && inTree.has(p.ppid)) { inTree.add(p.pid); changed = true; }
    }
  }
  return procs.filter((p) => inTree.has(p.pid));
}

function roleOf(p) {
  const c = String(p.cmdline || '');
  const m = c.match(/--type=([\w-]+)/);
  if (m) return m[1];
  if (/crashpad/i.test(c) || /crashpad/i.test(p.name)) return 'crashpad';
  return 'browser';
}

const CO_TENANT_EXCLUDE = /^(powershell|pwsh|node|wmiprvse|registry|system idle process|memory compression|vmmem|conhost)\.exe$/i;

function cpuDelta(treeA, treeB) {
  const a = new Map(treeA.map((p) => [p.pid, p]));
  let cpu100ns = 0;
  let newPids = 0;
  let exitedPids = [];
  for (const p of treeB) {
    const pa = a.get(p.pid);
    if (pa) {
      const d = p.cpu100ns - pa.cpu100ns;
      if (d > 0) cpu100ns += d;
    } else { cpu100ns += p.cpu100ns; newPids += 1; }
  }
  const b = new Set(treeB.map((p) => p.pid));
  for (const p of treeA) if (!b.has(p.pid)) exitedPids.push(p.pid);
  return { cpu100ns, newPids, exitedPids };
}

function coTenants(snapA, snapB, treePids, wallSec) {
  const a = new Map(snapA.processes.map((p) => [p.pid, p]));
  const rows = [];
  for (const p of snapB.processes) {
    if (treePids.has(p.pid)) continue;
    if (CO_TENANT_EXCLUDE.test(p.name)) continue;
    const pa = a.get(p.pid);
    if (!pa) continue;
    const d = p.cpu100ns - pa.cpu100ns;
    if (d > 0) rows.push({ name: p.name, cpuSec: d / 1e7, pctOfMachine: round(d / 1e7 / wallSec / CORES * 100, 1) });
  }
  rows.sort((x, y) => y.cpuSec - x.cpuSec);
  return rows.slice(0, 3).map((r) => ({ name: r.name, cpuSec: round(r.cpuSec, 2), pctOfMachine: r.pctOfMachine }));
}

// ------------------------------------------------------------ browsers
async function prepareEdge(base, scenario) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-proto-edge-'));
  let context;
  const close = async () => {
    try { if (context) await context.close(); } catch {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  };
  const urls = workloadUrls(base, SCENARIOS[scenario]);
  try {
    // A fresh profile with no first-run prompt, otherwise stock Edge.
    context = await chromium.launchPersistentContext(dir, {
      channel: 'msedge', headless: false,
      args: ['--no-first-run', '--no-default-browser-check'],
    });
    const first = context.pages()[0] || await context.newPage();
    await first.goto(urls[0], { waitUntil: 'domcontentloaded' });
    for (const url of urls.slice(1)) {
      const p = await context.newPage();
      await p.goto(url, { waitUntil: 'domcontentloaded' });
    }
    if (!matchesInventory(context.pages().map((p) => p.url()), urls)) {
      throw new Error('Edge tab inventory did not match the workload');
    }
    await first.bringToFront();
    return {
      profileDir: dir,
      pageState: () => first.evaluate(() => ({ visible: document.visibilityState === 'visible', frames: window.__dexMeasureFrames || 0 })),
      close,
    };
  } catch (err) { await close(); throw err; }
}

async function prepareDexerion(base, scenario) {
  const { app, win, profile } = await launchMod.launchDexerion({ attempts: 2, gpu: 'adaptive' });
  const close = async () => {
    try { await app.close(); } catch {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  };
  const urls = workloadUrls(base, SCENARIOS[scenario]);
  try {
    // Navigate the existing boot tab rather than giving Dexerion an extra
    // live page; keep a unique marker to identify the actual foreground.
    const bootId = await win.evaluate(() => window.dexerion.invoke('dex:get-state')
      .then((st) => st.active || (st.tabs[0] && st.tabs[0].id) || null));
    await win.evaluate(({ id, u }) => window.dexerion.invoke('dex:navigate', id, u), { id: bootId, u: urls[0] });
    for (const u of urls.slice(1)) {
      await win.evaluate((url) => window.dexerion.invoke('dex:new-tab', url, true), u);
    }
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const st = await win.evaluate(() => window.dexerion.invoke('dex:get-state'));
      const tabs = st?.tabs || [];
      if (st?.active === bootId && !tabs.some((t) => t.loading) &&
          matchesInventory(tabs.map((t) => t.url), urls)) {
        ready = true;
        break;
      }
      await win.waitForTimeout(250);
    }
    if (!ready) throw new Error('Dexerion tab inventory did not match the workload');
    // Like Edge, the measured arm must actually be shown and focused.
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (!w) throw new Error('Dexerion window missing');
      if (w.isMinimized()) w.restore();
      w.show();
      w.focus();
    });
    return {
      profileDir: profile,
      pageState: () => app.evaluate(async ({ webContents }, url) => {
        const page = webContents.getAllWebContents().find((wc) => wc.getURL() === url);
        return page ? page.executeJavaScript("({ visible: document.visibilityState === 'visible', frames: window.__dexMeasureFrames || 0 })") : null;
      }, urls[0]),
      close,
    };
  } catch (err) { await close(); throw err; }
}

// A separate mode for hosted comparisons without Playwright's launch
// switches. Use Playwright only as a local controller over native DevTools.
async function prepareNative(browser, base, scenario) {
  const urls = workloadUrls(base, SCENARIOS[scenario]);
  const dex = browser === 'dexerion';
  const executable = dex
    ? require(require.resolve('electron', { paths: [DEX_BUILD_DIR] }))
    : edgeExecutable();
  const session = await openNative(browser, {
    chromium, executable, cwd: dex ? DEX_BUILD_DIR : undefined,
    env: dex ? { ...process.env, DEX_AI_TEST: '1' } : process.env,
  });
  const list = () => pagesIn(session.browser);
  try {
    let front;
    if (dex) {
      const shell = await waitFor(() => list().find((p) => isShellUrl(p.url())), 'native Dexerion shell');
      const getState = () => shell.evaluate(() => window.dexerion?.invoke('dex:get-state'));
      const boot = await waitFor(async () => (await getState())?.active, 'native Dexerion active tab');
      await shell.evaluate(({ id, url }) => window.dexerion.invoke('dex:navigate', id, url), { id: boot, url: urls[0] });
      for (const url of urls.slice(1)) {
        await shell.evaluate((u) => window.dexerion.invoke('dex:new-tab', u, true), url);
      }
      await waitFor(async () => {
        const st = await getState();
        return st?.active === boot && !st.tabs.some((t) => t.loading) &&
          matchesInventory(st.tabs.map((t) => t.url), urls);
      }, 'native Dexerion tab inventory');
      front = await waitFor(() => list().find((p) => p.url() === urls[0]), 'native Dexerion foreground page');
    } else {
      const context = session.browser.contexts()[0];
      front = context.pages()[0] || await context.newPage();
      await front.goto(urls[0], { waitUntil: 'domcontentloaded' });
      for (const url of urls.slice(1)) {
        const p = await context.newPage();
        await p.goto(url, { waitUntil: 'domcontentloaded' });
      }
      if (!matchesInventory(context.pages().map((p) => p.url()), urls)) {
        throw new Error('Native Edge tab inventory did not match the workload');
      }
      await front.bringToFront();
    }
    await waitFor(async () => (await samplePage(front)).visible, 'native foreground visibility');
    return { profileDir: session.profileDir, pageState: () => samplePage(front), close: session.close };
  } catch (err) { await session.close(); throw err; }
}

// ------------------------------------------------------------ statistics
const quantile = (arr, q) => {
  const s = [...arr].sort((x, y) => x - y);
  if (!s.length) return NaN;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
};
const median = (arr) => quantile(arr, 0.5);

// ------------------------------------------------------------ trial runner
async function runTrial(browser, scenario, base, trialIdx) {
  const t = { browser, scenario, trial: trialIdx, startedAt: new Date().toISOString(), valid: true, invalidReason: null };
  let session = null;
  let gpu = null;
  let gpuFinished = null;
  try {
    // Paired floor: sampled immediately before the workload with NO browser
    // running, so package-power attribution is local in time (drift-immune).
    const floor = await optionalSample(() => samplePower('floor', FLOOR_SEC), FLOOR_SEC * 1000,
      { skip: SKIP_POWER, wait: sleep });
    t.floor = floor.sample;
    t.floorError = floor.error;
    t.floorMedianMW = t.floor?.medianMW ?? null;
    t.floorSpreadPct = t.floorMedianMW > 0
      ? round((t.floor.p90MW - t.floor.p10MW) / t.floorMedianMW * 100, 1) : null;
    // Per-trial environment (brief req 6): a trial missing this is invalid.
    t.env = envRecord();
    if (!t.env || !t.env.powerPlan || t.env.onAc === 'unknown' || t.env.osBuild === undefined) {
      t.valid = false; t.invalidReason = 'environment-record-missing';
    }
    session = NATIVE_LAUNCH ? await prepareNative(browser, base, scenario)
      : browser === 'edge' ? await prepareEdge(base, scenario) : await prepareDexerion(base, scenario);
    await sleep(SETTLE_MS);

    const beforeForeground = await session.pageState();
    const snapA = treeSnapshot();
    const treeA = requireTree(extractTree(snapA, session.profileDir), 'A');
    gpu = spawnGpu(treeA.map((p) => p.pid).join(','));
    const workloadPower = await optionalSample(() => samplePower('workload', SAMPLE_SEC), SAMPLE_SEC * 1000,
      { skip: !t.floor, wait: sleep });
    t.power = workloadPower.sample;
    t.powerError = workloadPower.error;
    const snapB = treeSnapshot();
    const afterForeground = await session.pageState();
    gpuFinished = await gpu.finish();

    const treeB = requireTree(extractTree(snapB, session.profileDir), 'B');
    const wallMs = Date.parse(snapB.capturedAt) - Date.parse(snapA.capturedAt);
    const wallSec = Math.max(1, wallMs / 1000);
    t.wallSec = round(wallSec, 1);
    t.foreground = foregroundSample(beforeForeground, afterForeground, wallSec,
      SCENARIOS[scenario].foreground === 'animated');
    if (NATIVE_LAUNCH) {
      t.foreground.viewport = { width: beforeForeground.width, height: beforeForeground.height, scale: beforeForeground.scale };
    }

    // CPU + RAM across the whole tree.
    const cd = cpuDelta(treeA, treeB);
    const cpuSec = cd.cpu100ns / 1e7;
    const roles = {};
    for (const p of treeB) roles[roleOf(p)] = (roles[roleOf(p)] || 0) + 1;
    t.cpu = {
      treeCpuSec: round(cpuSec, 2),
      cpuCorePct: round(cpuSec / wallSec * 100, 3), // percent of one logical core
      processCountA: treeA.length,
      processCountB: treeB.length,
      roles,
      newPidsMidWindow: cd.newPids,
      exitedPidsMidWindow: cd.exitedPids,
    };
    const memoryA = memoryByRole(treeA, roleOf);
    const memoryB = memoryByRole(treeB, roleOf);
    const toMiB = (bytes) => bytes === null ? null : round(bytes / (1024 * 1024), 1);
    t.ram = {
      wsMBA: toMiB(memoryA.totals.wsBytes),
      wsMBB: toMiB(memoryB.totals.wsBytes),
      privateMiBB: toMiB(memoryB.totals.privateBytes),
      byRoleB: Object.fromEntries(Object.entries(memoryB.byRole).map(([role, row]) => [
        role, { count: row.count, wsMiB: toMiB(row.wsBytes), privateMiB: toMiB(row.privateBytes) },
      ])),
    };

    // GPU axis, grouped by pid and filtered to the tree.
    if (hasGpuSample(gpuFinished)) {
      const treePidSet = new Set([...treeA, ...treeB].map((p) => p.pid));
      const rows = gpuFinished.perPid.filter((r) => treePidSet.has(r.pid));
      t.gpu = {
        intervalCount: gpuFinished.intervalCount,
        effectiveIntervalSec: gpuFinished.effectiveIntervalSec,
        treeUtilPointsMean: round(rows.reduce((a, r) => a + r.utilPointsMean, 0), 2),
        treeUtilPointsPeak: round(rows.reduce((a, r) => a + r.utilPointsPeak, 0), 2),
        treeMemMBMean: round(rows.reduce((a, r) => a + r.memBytesMean, 0) / (1024 * 1024), 1),
        treeMemMBPeak: round(rows.reduce((a, r) => a + r.memBytesPeak, 0) / (1024 * 1024), 1),
        perPid: rows.map((r) => ({ pid: r.pid, role: (treeB.find((p) => p.pid === r.pid) ? roleOf(treeB.find((p) => p.pid === r.pid)) : 'exited'), utilPointsMean: r.utilPointsMean, utilPointsPeak: r.utilPointsPeak, memMBPeak: round(r.memBytesPeak / (1024 * 1024), 1) })),
      };
    } else {
      t.gpu = { error: gpuFinished?.error || 'No usable GPU intervals' };
    }

    t.coTenants = coTenants(snapA, snapB, new Set([...treeA, ...treeB].map((p) => p.pid)), wallSec);
    t.acAtTrial = { onAc: t.env && t.env.onAc, chargePct: t.env && t.env.chargePct };
    // Attribution-quality flags (kept valid, but visible in the report): a
    // negative attributable means the workload median landed BELOW the paired
    // floor — a co-tenant spike or lull, not a browser drawing negative power.
    t.flags = [];
    if (t.power && t.floorMedianMW && (t.power.medianMW - t.floorMedianMW) < 0) {
      t.flags.push('attributable-negative');
    }
  } catch (err) {
    t.valid = false;
    t.invalidReason = 'error: ' + String(err && err.message || err).split('\n')[0];
  } finally {
    if (gpu) { try { await gpu.finish(); } catch {} }
    if (session) await session.close();
  }
  return t;
}

// ------------------------------------------------------------ aggregation
function summarize(trials, axis) {
  const vals = trials.map((t) => axis(t)).filter((v) => Number.isFinite(v));
  if (!vals.length) return null;
  return {
    n: vals.length,
    median: round(median(vals), 2),
    p25: round(quantile(vals, 0.25), 2),
    p75: round(quantile(vals, 0.75), 2),
    min: round(Math.min(...vals), 2),
    max: round(Math.max(...vals), 2),
  };
}

const AXES = {
  power: (t) => (t.floorMedianMW && t.power ? t.power.medianMW - t.floorMedianMW : NaN),
  cpu: (t) => (t.cpu ? t.cpu.cpuCorePct : NaN),
  ram: (t) => (t.ram ? t.ram.wsMBB : NaN),
  gpu: (t) => (t.gpu && t.gpu.treeUtilPointsMean !== undefined ? t.gpu.treeUtilPointsMean : NaN),
};

function pctOfEdge(dexS, edgeS) {
  if (!dexS || !edgeS || !Number.isFinite(edgeS.median) || Math.abs(edgeS.median) < 1e-9) return null;
  return round(dexS.median / edgeS.median * 100, 1);
}

// ------------------------------------------------------------ main
(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { server, base } = await startServer();
  const results = {
    generatedAt: new Date().toISOString(),
    mode: process.env.DEX_BUILD_DIR ? 'baseline-worktree' : 'committed-tree',
    dexBuildDir: DEX_BUILD_DIR,
    host: {
      logicalCores: CORES,
      platform: os.platform(),
      osRelease: os.release(),
      totalMemGB: round(os.totalmem() / (1024 * 1024 * 1024), 1),
      electronVersion: (() => { try { return JSON.parse(fs.readFileSync(path.join(DEX_BUILD_DIR, 'node_modules', 'electron', 'package.json'), 'utf8')).version; } catch { return 'unknown'; } })(),
      nodeVersion: process.version,
    },
    config: {
      trialsPerScenarioPerBrowser: TRIALS, sampleSec: SAMPLE_SEC, floorSec: FLOOR_SEC,
      settleMs: SETTLE_MS, gpuIntervalSec: GPU_INTERVAL_SEC, bgTabs: BG_TABS,
      scenarioOrder: SCENARIO_ORDER, browsers: BROWSERS,
      floorSwingInvalidPct: FLOOR_SWING_LIMIT * 100,
      skipPower: SKIP_POWER,
      nativeLaunch: NATIVE_LAUNCH,
      edgeLaunch: NATIVE_LAUNCH ? 'direct binary, isolated data dir, loopback ephemeral CDP, skip first-run prompts' : 'Playwright defaults, isolated data dir',
      dexerionLaunch: NATIVE_LAUNCH ? 'direct Electron binary and development checkout, isolated data dir, loopback ephemeral CDP' : 'Playwright Electron loader, isolated data dir, GPU adaptive',
    },
    env: envRecord(),
    scenarios: {},
    invalidTrials: [],
    errors: [],
  };

  try {
    for (const scenario of SCENARIO_ORDER) {
      results.scenarios[scenario] = {};
      for (const browser of BROWSERS) results.scenarios[scenario][browser] = { trials: [], pending: [] };
      console.log('=== scenario: ' + scenario + ' ===');
      const trialOrder = [];
      // Randomise only the first slot, then alternate to bound order imbalance
      // to one round while keeping the two arms paired in time.
      const reverseFirst = Math.random() < 0.5;
      for (let i = 1; i <= TRIALS; i += 1) {
        const order = workloadOrder(BROWSERS, i, reverseFirst);
        trialOrder.push({ trial: i, order });
        for (const browser of order) {
          const elapsedMin = (Date.now() - startedAt) / 60000;
          if (elapsedMin > DEADLINE_MIN) {
            results.scenarios[scenario][browser].pending.push('trial ' + i + ' skipped: ' + round(elapsedMin, 1) + ' min elapsed > deadline ' + DEADLINE_MIN + ' min');
            continue;
          }
          console.log('  ' + browser + ' / ' + scenario + ' / trial ' + i + ' (t+' + round(elapsedMin, 1) + ' min)');
          const t = await runTrial(browser, scenario, base, i);
          results.scenarios[scenario][browser].trials.push(t);
          if (!t.valid) {
            results.invalidTrials.push({ browser, scenario, trial: t.trial, reason: t.invalidReason });
            console.log('    INVALID: ' + t.invalidReason);
          } else {
            console.log('    cpu ' + t.cpu.cpuCorePct + '% core, ws ' + t.ram.wsMBB + ' MB, power ' + (t.power?.medianMW ?? 'n/a') + ' mW (floor ' + (t.floorMedianMW ?? 'n/a') + '), gpu ' + (t.gpu && t.gpu.treeUtilPointsMean !== undefined ? t.gpu.treeUtilPointsMean : 'n/a') + ' pts, foreground fps ' + (t.foreground.fps === null ? 'n/a' : round(t.foreground.fps, 2)));
          }
          if (t.foreground?.viewport) console.log('    viewport ' + JSON.stringify(t.foreground.viewport));
          await sleep(2000); // let the browser's processes fully exit
        }
      }
      results.scenarios[scenario].trialOrder = trialOrder;

      // Floor-swing validation: a trial whose floor deviates >20% from its
      // group's reference floor (median of the others) is contaminated.
      for (const browser of BROWSERS) {
        const g = results.scenarios[scenario][browser];
        let ref = median(g.trials.filter((t) => t.valid && t.floorMedianMW > 0).map((t) => t.floorMedianMW));
        for (let pass = 0; pass < 2; pass += 1) {
          ref = median(g.trials.filter((t) => t.valid && t.floorMedianMW > 0).map((t) => t.floorMedianMW));
          for (const t of g.trials) {
            if (!t.valid) continue;
            if (Number.isFinite(ref) && ref > 0 && t.floorMedianMW > 0
              && Math.abs(t.floorMedianMW - ref) / ref > FLOOR_SWING_LIMIT) {
              t.valid = false;
              t.invalidReason = 'floor-swing>' + (FLOOR_SWING_LIMIT * 100) + '% (floor ' + t.floorMedianMW + ' vs ref ' + round(ref, 0) + ')';
              results.invalidTrials.push({ browser, scenario, trial: t.trial, reason: t.invalidReason });
              console.log('    INVALID ' + browser + '/' + t.trial + ': ' + t.invalidReason);
            }
          }
        }
        g.refFloorMW = round(ref, 0);
        const valid = g.trials.filter((t) => t.valid);
        g.nValid = valid.length;
        g.summary = {};
        for (const [axis, fn] of Object.entries(AXES)) g.summary[axis] = summarize(valid, fn);
        g.privateMiB = summarize(valid, (t) => t.ram?.privateMiBB);
        g.ramByRole = Object.fromEntries([...new Set(valid.flatMap((t) => Object.keys(t.ram?.byRoleB || {})))].sort().map((role) => [
          role, {
            wsMiB: summarize(valid, (t) => t.ram?.byRoleB[role]?.wsMiB),
            privateMiB: summarize(valid, (t) => t.ram?.byRoleB[role]?.privateMiB),
          },
        ]));
        console.log('  RAM by role ' + browser + ': ' + JSON.stringify(g.ramByRole));
        // Within-sample power spread flag (noise-limited attribution).
        g.noiseLimited = valid.map((t) => ({
          trial: t.trial,
          noiseLimited: t.power ? (t.power.p90MW - t.power.p10MW) > Math.max(t.power.medianMW - t.floorMedianMW, 150) : null,
        })).filter((x) => x.noiseLimited).map((x) => x.trial);
      }

      // Verdict per axis vs the <=60%-of-Edge bar (>=40% reduction).
      const pair = results.scenarios[scenario];
      if (pair.edge && pair.dexerion) {
        const cmp = {};
        for (const axis of Object.keys(AXES)) {
          const pct = pctOfEdge(pair.dexerion.summary[axis], pair.edge.summary[axis]);
          cmp[axis + 'PctOfEdge'] = pct;
          cmp[axis + 'Pass'] = pct === null ? 'n/a' : (pct <= 60 ? 'PASS' : 'FAIL');
        }
        pair.comparison = cmp;
        console.log('  ' + scenario + ' comparison: ' + JSON.stringify(cmp));
      }
    }

    results.method = 'Per trial: paired RAPL floor (no browser, immediately before workload) -> launch (throwaway profile) -> settle -> whole-tree snapshot A -> concurrent GPU-engine + RAPL sampling -> whole-tree snapshot B -> teardown. CPU = Win32_Process UserMode+KernelMode delta (100 ns units) summed over the browser tree (new children counted fully, mid-window exits logged). RAM = tree working set at snapshot B; role working sets and private allocations are diagnostic only (not private resident memory). GPU = GPU Engine utilisation percentage points summed per pid + GPU Process Memory Local Usage, tree-filtered. Power = workload median mW minus that paired floor median. Invalid: floor swing >20% vs group reference, or missing environment record. Unavailable counters remain null; missing RAPL does not prevent CPU/RAM/GPU measurements. Medians/IQR over VALID trials only; all trials published.';
    const outJson = path.join(OUT_DIR, 'measure-protocol-' + (process.env.DEX_BUILD_DIR ? 'baseline' : 'main') + '.json');
    fs.writeFileSync(outJson, JSON.stringify(results, null, 2), 'utf8');
    console.log('PROTOCOL EVIDENCE: ' + outJson);
    for (const scenario of SCENARIO_ORDER) {
      const pair = results.scenarios[scenario];
      if (pair.comparison) console.log('VERDICT ' + scenario + ': ' + JSON.stringify(pair.comparison));
    }
  } finally {
    server.close();
  }
})().catch((err) => {
  console.error('PROTOCOL ERROR: ' + (err && err.stack || err));
  process.exitCode = 1;
});
