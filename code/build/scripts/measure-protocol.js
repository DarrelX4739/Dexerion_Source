'use strict';
// Tester measurement protocol (TESTER-BRIEF.md reqs 1-6, plan tier C1/C2/C3).
//
// Repeated controlled trials (>=5 per scenario per browser) of Dexerion vs
// Microsoft Edge over four axes, attributed to the WHOLE browser process tree:
//   CPU   — Win32_Process UserModeTime+KernelModeTime deltas (100 ns units)
//           summed across the browser process and every child.
//   RAM   — Win32_Process WorkingSetSize summed across the same tree.
//   GPU   — Windows GPU Engine utilisation by physical engine and PID; each
//           sampling interval contributes once to tree mean and peak.
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
//   MEASURE_SEED_PROFILE    1 primes and clones one synthetic profile per browser
//   MEASURE_LAUNCH_CONTROL  1 adds legacy automation arms as controls
//   DEX_NATIVE_PACKAGED_APP  path to an unpacked Dexerion executable, optional
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
const { aggregateGpu } = require('./measure-gpu-aggregate.cjs');
const { openNative, edgeExecutable, waitFor, pagesIn, isShellUrl, samplePage } = require('./measure-native-browser.cjs');
const { verifiedNativeTree, stableCpuByRole, fourArmOrder, rendererRoleMap, memoryByRole, workloadOrder, optionalSample, requireTree, foregroundSample, workloadUrls, matchesInventory } = require('./measure-sample-guard.cjs');

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
const LAUNCH_CONTROL = NATIVE_LAUNCH && process.env.MEASURE_LAUNCH_CONTROL === '1';
const SEED_PROFILE = NATIVE_LAUNCH && !LAUNCH_CONTROL && process.env.MEASURE_SEED_PROFILE === '1';
const DISTINCT_HOSTS = process.env.MEASURE_DISTINCT_LOOPBACK_HOSTS === '1';
const STATIC_BACKGROUND = process.env.MEASURE_STATIC_BACKGROUND === '1';
const TITLE_CONTROL = process.env.MEASURE_TITLE_CONTROL === '1';
if (DISTINCT_HOSTS && (!NATIVE_LAUNCH || LAUNCH_CONTROL)) {
  throw new Error('Distinct loopback workload requires matched native launches');
}
const seedProfiles = new Map();
const PACKAGED_BINARY = process.env.DEX_NATIVE_PACKAGED_APP ? path.resolve(process.env.DEX_NATIVE_PACKAGED_APP) : null;
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
const TITLE_SCENARIOS = ['multitasking', 'multitasking-fixed-title'];
if (TITLE_CONTROL) SCENARIOS[TITLE_SCENARIOS[1]] = { ...SCENARIOS.multitasking, fixedTitle: true };
const SCENARIO_ORDER = TITLE_CONTROL ? TITLE_SCENARIOS : (process.env.MEASURE_SCENARIOS
  || 'active-browsing,background-tabs,idle,multitasking')
  .split(',').map((s) => s.trim()).filter((s) => SCENARIOS[s]);
const BROWSERS = LAUNCH_CONTROL ? ['edge', 'edge-automation', 'dexerion', 'dexerion-automation']
  : (process.env.MEASURE_BROWSERS || 'edge,dexerion')
  .split(',').map((s) => s.trim()).filter((s) => s === 'edge' || s === 'dexerion');

if (TITLE_CONTROL && (!DISTINCT_HOSTS || !SEED_PROFILE || !PACKAGED_BINARY || STATIC_BACKGROUND ||
    TRIALS !== 4 || BROWSERS.length !== 2 || new Set(BROWSERS).size !== 2)) {
  throw new Error('Title control requires two packaged native browsers, seeded profiles, distinct animated tabs, and four trials');
}

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
<canvas id="c" width="960" height="640" style="display:block;width:928px;height:592px"></canvas>
<script>
(function () {
  const c = document.getElementById('c'), x = c.getContext('2d');
  let f = 0;
  const dynamicTitle = new URLSearchParams(location.search).get('title') !== 'fixed';
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
    if (dynamicTitle && f % 30 === 0) document.title = 'Measure probe frame ' + f;
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
const treeSnapshot = (final = false) => runPs(S, final ? { IncludePrivateWorkingSet: true } : {}, 60);
const envRecord = () => { try { return runPs(E, {}, 30); } catch { return null; } };

// GPU sampler runs concurrently with the RAPL sampler; spawn + await later.
function spawnGpu() {
  const out = path.join(OUT_DIR, 'gpu-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.json');
  const child = spawn('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', G,
    '-DurationSec', String(SAMPLE_SEC + 4),
    '-IntervalSec', String(GPU_INTERVAL_SEC),
    '-OutFile', out,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '', childError;
  child.on('error', (err) => { childError = err; });
  child.stderr.on('data', (d) => { stderr += String(d); });
  const outcome = (async () => {
    try {
      const deadline = Date.now() + (SAMPLE_SEC + 45) * 1000;
      while (!childError && child.exitCode === null && child.signalCode === null && Date.now() < deadline) await sleep(500);
      if (childError) return { error: 'gpu sampler launch: ' + childError.message };
      if (child.exitCode === null && child.signalCode === null) {
        try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
        return { error: 'gpu sampler timeout' };
      }
      if (child.exitCode !== 0) return { error: 'gpu sampler exit ' + child.exitCode + (stderr ? ': ' + stderr.slice(0, 300) : '') };
      try { return JSON.parse(fs.readFileSync(out, 'utf8')); }
      catch (e) { return { error: 'gpu sampler unreadable: ' + e.message }; }
    } finally { try { fs.rmSync(out, { force: true }); } catch {} }
  })();
  return { finish: () => outcome };
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
      pageState: () => first.evaluate(() => ({ visible: document.visibilityState === 'visible', frames: window.__dexMeasureFrames || 0, clockMs: performance.now(), timeOrigin: performance.timeOrigin })),
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
      rendererRoles: () => app.evaluate(({ BrowserWindow, webContents }, [foreground, ...background]) => {
        const shells = new Set(BrowserWindow.getAllWindows().map((w) => w.webContents.id));
        return webContents.getAllWebContents().flatMap((wc) => {
          try {
            const url = wc.getURL();
            const kind = shells.has(wc.id) ? 'shell' : url === foreground ? 'foreground'
              : background.includes(url) ? 'background' : 'other';
            return [{ pid: wc.getOSProcessId(), kind }];
          } catch { return []; }
        });
      }, urls),
      pageState: () => app.evaluate(async ({ webContents }, url) => {
        const page = webContents.getAllWebContents().find((wc) => wc.getURL() === url);
        return page ? page.executeJavaScript("({ visible: document.visibilityState === 'visible', frames: window.__dexMeasureFrames || 0, clockMs: performance.now(), timeOrigin: performance.timeOrigin })") : null;
      }, urls[0]),
      close,
    };
  } catch (err) { await close(); throw err; }
}

// A separate mode for hosted comparisons without Playwright's launch
// switches. Use Playwright only as a local controller over native DevTools.
async function prepareNative(browser, base, scenario, { prime = false } = {}) {
  const definition = SCENARIOS[scenario];
  const urls = workloadUrls(base, STATIC_BACKGROUND ? { ...definition, background: 'static' } : definition, DISTINCT_HOSTS);
  const dex = browser === 'dexerion';
  const executable = dex
    ? PACKAGED_BINARY || require(require.resolve('electron', { paths: [DEX_BUILD_DIR] }))
    : edgeExecutable();
  const session = await openNative(browser, {
    chromium, executable, cwd: dex && !PACKAGED_BINARY ? DEX_BUILD_DIR : undefined,
    packaged: dex && Boolean(PACKAGED_BINARY),
    seedDir: prime ? null : seedProfiles.get(browser),
    preserveProfile: prime,
    env: dex && !PACKAGED_BINARY ? { ...process.env, DEX_AI_TEST: '1' } : process.env,
  });
  const list = () => pagesIn(session.browser);
  try {
    let front, shell;
    if (dex) {
      shell = await waitFor(() => list().find((p) => isShellUrl(p.url())), 'native Dexerion shell');
      const getState = () => shell.evaluate(() => window.dexerion?.invoke('dex:get-state'));
      const initial = await waitFor(async () => {
        const state = await getState();
        return state?.active && state.tabs?.some((t) => t.id === state.active && !t.loading) && state;
      }, 'native Dexerion boot tab');
      const boot = initial.active;
      const seededTrial = !prime && seedProfiles.has(browser);
      if (seededTrial) {
        // Retain preferences, caches, and data but apply the workload to
        // exactly one tab. Any additional restored tabs belong to this
        // benchmark's disposable seed and are closed using the normal UI IPC.
        await shell.evaluate(async (id) => {
          const bridge = window.dexerion;
          const state = await bridge.invoke('dex:get-state');
          for (const tab of state.tabs) if (tab.id !== id) await bridge.invoke('dex:close-tab', tab.id);
          await bridge.invoke('dex:activate-tab', id);
        }, boot);
      }
      await shell.evaluate(({ id, url }) => window.dexerion.invoke('dex:navigate', id, url), { id: boot, url: urls[0] });
      for (const url of urls.slice(1)) {
        await shell.evaluate((u) => window.dexerion.invoke('dex:new-tab', u, true), url);
      }
      let lastInventory;
      try {
        await waitFor(async () => {
          const st = await getState();
          lastInventory = st && {
            n: st.tabs.length,
            activeMatches: st.active === boot,
            loading: st.tabs.filter((t) => t.loading).length,
            fixtureTabs: st.tabs.filter((t) => urls.includes(t.url)).length,
          };
          return st?.active === boot && !st.tabs.some((t) => t.loading) &&
            matchesInventory(st.tabs.map((t) => t.url), urls);
        }, 'native Dexerion tab inventory');
      } catch (error) {
        throw new Error(error.message + ': ' + JSON.stringify(lastInventory));
      }
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
    const version = await session.devtools.send('Browser.getVersion');
    return { profileDir: session.profileDir, nativeRootPid: session.processId, version: version.product,
      telemetry: async () => {
        const { targetInfos } = await session.devtools.send('Target.getTargets');
        const tally = new Map();
        for (const info of targetInfos) {
          if (info.type === 'browser') continue;
          const group = urls.includes(info.url) ? 'workload-' + info.type
            : /^edge:|^chrome:/i.test(info.url) ? 'built-in-' + info.type
              : 'other-' + info.type;
          tally.set(group, (tally.get(group) || 0) + 1);
        }
        return Object.fromEntries(tally);
      },
      // Existing trusted-shell diagnostic, after sampler B. Report only
      // verified content-tab PIDs; unassigned renderers stay unassigned.
      rendererRoles: shell ? () => shell.evaluate(async (fixtureUrls) => {
        const bridge = window.dexerion;
        const state = await bridge.invoke('dex:get-state');
        const metrics = await bridge.invoke('dex:memory');
        const matched = new Map(state.tabs.filter((t) => fixtureUrls.includes(t.url)).map((t) => [t.id, t.url]));
        if (matched.size !== fixtureUrls.length || !matched.has(state.active)) {
          throw new Error('Raw tab attribution lost the expected fixture inventory');
        }
        return metrics.tabs.filter((t) => matched.has(t.tabId)).map((t) => ({
          pid: t.pid, kind: t.tabId === state.active ? 'foreground' : 'background',
        }));
      }, urls) : undefined,
      foregroundTitle: () => front.title(),
      pageState: () => samplePage(front), close: session.close };
  } catch (err) { await session.close(false); throw err; }
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
    const useNative = NATIVE_LAUNCH && !browser.endsWith('-automation');
    const browserBin = browser.replace(/-automation$/, '');
    session = useNative ? await prepareNative(browserBin, base, scenario)
      : browserBin === 'edge' ? await prepareEdge(base, scenario) : await prepareDexerion(base, scenario);
    if (session.version) t.browserVersion = session.version;
    await sleep(SETTLE_MS);

    const beforeForeground = await session.pageState();
    const snapA = treeSnapshot();
    const treeEvidence = (snapshot) => {
      if (!useNative) return { rows: extractTree(snapshot, session.profileDir), mode: 'legacy' };
      if (!Number.isInteger(session.nativeRootPid) || session.nativeRootPid <= 0) {
        throw new Error('Native browser launch did not provide its process ID');
      }
      return { mode: 'native creation-scoped', ...verifiedNativeTree(snapshot.processes, session.nativeRootPid,
        (p) => /^(electron|Dexerion|msedge)\.exe$/i.test(p.name)
          && String(p.cmdline || '').toLowerCase().includes(session.profileDir.toLowerCase())) };
    };
    const { rows: rowsA, ...attributionA } = treeEvidence(snapA);
    const treeA = requireTree(rowsA, 'A');
    gpu = spawnGpu();
    const workloadPower = await optionalSample(() => samplePower('workload', SAMPLE_SEC), SAMPLE_SEC * 1000,
      { skip: !t.floor, wait: sleep });
    t.power = workloadPower.sample;
    t.powerError = workloadPower.error;
    const snapB = treeSnapshot(true);
    const afterForeground = await session.pageState();
    gpuFinished = await gpu.finish();

    const { rows: rowsB, ...attributionB } = treeEvidence(snapB);
    const treeB = requireTree(rowsB, 'B');
    if (useNative && !treeB.some((p) => roleOf(p) === 'renderer')) {
      throw new Error('Verified native process tree contained no renderer');
    }
    t.processTreeAttribution = { A: attributionA, B: attributionB };
    const wallMs = Date.parse(snapB.capturedAt) - Date.parse(snapA.capturedAt);
    const wallSec = Math.max(1, wallMs / 1000);
    t.wallSec = round(wallSec, 1);
    t.foreground = foregroundSample(beforeForeground, afterForeground, wallSec,
      SCENARIOS[scenario].foreground === 'animated');
    if (useNative) {
      t.foreground.viewport = { width: beforeForeground.width, height: beforeForeground.height, scale: beforeForeground.scale };
    }

    if (TITLE_CONTROL) {
      const title = await session.foregroundTitle();
      const fixed = SCENARIOS[scenario].fixedTitle === true;
      const expected = fixed ? title === 'Dexerion measure probe - animated' : /^Measure probe frame [0-9]+$/.test(title);
      if (!expected) throw new Error('Foreground failed the requested title fixture');
      t.foreground.titleControl = { fixed, observedTitle: title };
    }

    // CPU + RAM across the whole tree.
    const cd = cpuDelta(treeA, treeB);
    const cpuSec = cd.cpu100ns / 1e7;
    const roles = {};
    for (const p of treeB) roles[roleOf(p)] = (roles[roleOf(p)] || 0) + 1;
    if (session.telemetry) { try { t.visibleAndBackgroundTargets = await session.telemetry(); } catch {} }
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
      privateWsMiBB: toMiB(memoryB.totals.privateWsBytes),
      byRoleB: Object.fromEntries(Object.entries(memoryB.byRole).map(([role, row]) => [
        role, { count: row.count, wsMiB: toMiB(row.wsBytes), privateMiB: toMiB(row.privateBytes), privateWsMiB: toMiB(row.privateWsBytes) },
      ])),
    };
    let cpuLabels = new Map();
    if (session.rendererRoles) {
      try {
        const labels = rendererRoleMap(await session.rendererRoles());
        cpuLabels = labels;
        const rendererTree = treeB.filter((p) => roleOf(p) === 'renderer');
        t.ram.dexRendererBreakdown = Object.fromEntries(Object.entries(
          memoryByRole(rendererTree, (p) => labels.get(p.pid) || 'renderer-unmapped').byRole,
        ).map(([role, row]) => [role, {
          count: row.count, wsMiB: toMiB(row.wsBytes), privateMiB: toMiB(row.privateBytes),
          privateWsMiB: toMiB(row.privateWsBytes),
        }]));
      } catch (err) {
        t.ram.dexRendererError = String(err?.message || err).split('\n')[0];
      }
    }

    const stableRoles = stableCpuByRole(treeA, treeB, (p) => cpuLabels.get(p.pid) || roleOf(p));
    t.cpu.stableRoleAttribution = {
      matchedProcesses: stableRoles.measured,
      unmatchedAtEnd: stableRoles.skippedAtEnd,
      unmatchedAtStart: stableRoles.missingAtEnd,
      measuredCpuMs: round(stableRoles.total100ns / 1e4, 2),
      roles: Object.fromEntries(Object.entries(stableRoles.roles).map(([kind, row]) => [kind, {
        processes: row.processes, cpuMs: round(row.cpu100ns / 1e4, 2),
        pctOfCore: round(row.cpu100ns / 1e7 / wallSec * 100, 3),
      }])),
    };

    // Sum utilisation by physical engine on each common interval before
    // taking the mean. A newly observed child at snapshot B shares the
    // denominator rather than appearing fully utilised over all samples.
    const gpuTree = new Set([...treeA, ...treeB].map((p) => p.pid));
    const aggregate = aggregateGpu(gpuFinished?.samples, gpuTree,
      Date.parse(snapA.capturedAt), Date.parse(snapB.capturedAt));
    if (aggregate) {
      const rolesByPid = new Map([...treeA, ...treeB].map((p) => [p.pid, roleOf(p)]));
      t.gpu = { ...aggregate, perPid: aggregate.perPid.map((r) => ({ ...r, role: rolesByPid.get(r.pid) })) };
    } else {
      t.gpu = { error: gpuFinished?.error || gpuFinished?.errors?.[0] || 'No usable GPU intervals' };
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
  gpu: (t) => (t.gpu?.treeUtilPointsMean ?? NaN),
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
      workloadOrigins: DISTINCT_HOSTS ? 'one .localhost host per tab' : 'same loopback origin',
      packagedApp: Boolean(PACKAGED_BINARY && NATIVE_LAUNCH),
      exploratoryLauncherControl: LAUNCH_CONTROL,
      titleControl: TITLE_CONTROL ? 'balanced same-host fixed vs dynamic title' : null,
      backgroundFixture: NATIVE_LAUNCH && STATIC_BACKGROUND ? 'static' : 'animated',
      profileMode: SEED_PROFILE ? 'per-browser primed disposable seed, cloned per trial' : 'fresh disposable profile per trial',
      edgeLaunch: NATIVE_LAUNCH ? 'direct binary, isolated data dir, loopback ephemeral CDP, skip first-run prompts' : 'Playwright defaults, isolated data dir',
      dexerionLaunch: NATIVE_LAUNCH ? (PACKAGED_BINARY ? 'direct unpacked Dexerion binary, isolated data dir, loopback ephemeral CDP' : 'direct Electron binary and development checkout, isolated data dir, loopback ephemeral CDP') : 'Playwright Electron loader, isolated data dir, GPU adaptive',
    },
    env: envRecord(),
    scenarios: {},
    invalidTrials: [],
    errors: [],
  };

  try {
    if (SEED_PROFILE) {
      for (const browser of BROWSERS) {
        const session = await prepareNative(browser, base, 'idle', { prime: true });
        let primed = false;
        try {
          await sleep(SETTLE_MS);
          primed = true;
        } finally {
          const { kept } = await session.close(primed);
          if (!kept) throw new Error('Synthetic ' + browser + ' seed exited uncleanly');
          seedProfiles.set(browser, session.profileDir);
        }
        console.log('Primed a disposable ' + browser + ' profile');
      }
    }
    const initialiseScenario = (scenario) => {
      const group = { trialOrder: [] };
      for (const browser of BROWSERS) group[browser] = { trials: [], pending: [] };
      results.scenarios[scenario] = group;
    };
    const collectTrial = async (scenario, browser, i) => {
      const group = results.scenarios[scenario][browser];
      const elapsedMin = (Date.now() - startedAt) / 60000;
      if (elapsedMin > DEADLINE_MIN) {
        group.pending.push('trial ' + i + ' skipped: ' + round(elapsedMin, 1) + ' min elapsed > deadline ' + DEADLINE_MIN + ' min');
        return;
      }
      console.log('  ' + browser + ' / ' + scenario + ' / trial ' + i + ' (t+' + round(elapsedMin, 1) + ' min)');
      const t = await runTrial(browser, scenario, base, i);
      group.trials.push(t);
      if (!t.valid) {
        results.invalidTrials.push({ browser, scenario, trial: t.trial, reason: t.invalidReason });
        console.log('    INVALID: ' + t.invalidReason);
      } else {
        console.log('    cpu ' + t.cpu.cpuCorePct + '% core, ws ' + t.ram.wsMBB + ' MB, power ' + (t.power?.medianMW ?? 'n/a') + ' mW (floor ' + (t.floorMedianMW ?? 'n/a') + '), gpu ' + (t.gpu && t.gpu.treeUtilPointsMean !== undefined ? t.gpu.treeUtilPointsMean : 'n/a') + ' pts, foreground fps ' + (t.foreground.fps === null ? 'n/a' : round(t.foreground.fps, 2)));
      }
      if (t.foreground?.viewport) console.log('    ' + t.browserVersion + ' viewport ' + JSON.stringify(t.foreground.viewport));
      await sleep(2000); // let the browser's processes fully exit
    };
    if (TITLE_CONTROL) {
      const arms = SCENARIO_ORDER.flatMap((scenario) => BROWSERS.map((browser) => ({ scenario, browser })));
      const anchor = Math.floor(Math.random() * 4);
      results.titleControlOrder = [];
      SCENARIO_ORDER.forEach(initialiseScenario);
      for (let i = 1; i <= TRIALS; i += 1) {
        const order = fourArmOrder(arms, i, anchor);
        results.titleControlOrder.push({ trial: i, order });
        for (const scenario of SCENARIO_ORDER) {
          results.scenarios[scenario].trialOrder.push({ trial: i, order: order.filter((a) => a.scenario === scenario).map((a) => a.browser) });
        }
        for (const { scenario, browser } of order) await collectTrial(scenario, browser, i);
      }
    }
    for (const scenario of SCENARIO_ORDER) {
      console.log('=== scenario: ' + scenario + ' ===');
      if (!TITLE_CONTROL) {
        initialiseScenario(scenario);
        // Randomise the first slot, then alternate to bound order imbalance.
        const reverseFirst = Math.random() < 0.5;
        const anchor = Math.floor(Math.random() * 4);
        for (let i = 1; i <= TRIALS; i += 1) {
          const order = LAUNCH_CONTROL ? fourArmOrder(BROWSERS, i, anchor) : workloadOrder(BROWSERS, i, reverseFirst);
          results.scenarios[scenario].trialOrder.push({ trial: i, order });
          for (const browser of order) await collectTrial(scenario, browser, i);
        }
      }

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
        g.processCounts = Object.fromEntries([...new Set(valid.flatMap((t) => Object.keys(t.cpu?.roles || {})))].sort().map((role) => [
          role, summarize(valid, (t) => t.cpu?.roles[role] ?? 0),
        ]));
        g.targetCounts = Object.fromEntries([...new Set(valid.flatMap((t) => Object.keys(t.visibleAndBackgroundTargets || {})))].sort().map((target) => [
          target, summarize(valid, (t) => t.visibleAndBackgroundTargets ? t.visibleAndBackgroundTargets[target] ?? 0 : NaN),
        ]));
        const stableCpuRoles = [...new Set(valid.flatMap((t) =>
          Object.keys(t.cpu?.stableRoleAttribution?.roles || {})))].sort();
        g.stableCpuByRole = Object.fromEntries(stableCpuRoles.map((role) => [role,
          summarize(valid, (t) => t.cpu?.stableRoleAttribution?.roles?.[role]?.pctOfCore)]));
        console.log('  Stable process CPU by role ' + browser + ': ' + JSON.stringify(g.stableCpuByRole));
        console.log('  Process counts ' + browser + ': ' + JSON.stringify(g.processCounts));
        if (Object.keys(g.targetCounts).length) console.log('  Target counts ' + browser + ': ' + JSON.stringify(g.targetCounts));
        g.privateMiB = summarize(valid, (t) => t.ram?.privateMiBB);
        g.privateWsMiB = summarize(valid, (t) => t.ram?.privateWsMiBB);
        g.ramByRole = Object.fromEntries([...new Set(valid.flatMap((t) => Object.keys(t.ram?.byRoleB || {})))].sort().map((role) => [
          role, {
            wsMiB: summarize(valid, (t) => t.ram?.byRoleB[role]?.wsMiB),
            privateMiB: summarize(valid, (t) => t.ram?.byRoleB[role]?.privateMiB),
            privateWsMiB: summarize(valid, (t) => t.ram?.byRoleB[role]?.privateWsMiB),
          },
        ]));
        console.log('  RAM by role ' + browser + ': ' + JSON.stringify(g.ramByRole));
        console.log('  Private resident RAM ' + browser + ': ' + JSON.stringify(g.privateWsMiB));
        const rendererNames = [...new Set(valid.flatMap((t) => Object.keys(t.ram?.dexRendererBreakdown || {})))].sort();
        if (rendererNames.length) {
          g.dexRendererBreakdown = Object.fromEntries(rendererNames.map((role) => [role, {
            wsMiB: summarize(valid, (t) => t.ram?.dexRendererBreakdown[role]?.wsMiB),
            privateMiB: summarize(valid, (t) => t.ram?.dexRendererBreakdown[role]?.privateMiB),
            privateWsMiB: summarize(valid, (t) => t.ram?.dexRendererBreakdown[role]?.privateWsMiB),
          }]));
          console.log('  Dexerion renderer attribution: ' + JSON.stringify(g.dexRendererBreakdown));
        }
        // Within-sample power spread flag (noise-limited attribution).
        g.noiseLimited = valid.map((t) => ({
          trial: t.trial,
          noiseLimited: t.power ? (t.power.p90MW - t.power.p10MW) > Math.max(t.power.medianMW - t.floorMedianMW, 150) : null,
        })).filter((x) => x.noiseLimited).map((x) => x.trial);
      }

      if (LAUNCH_CONTROL) {
        for (const browser of ['edge', 'dexerion']) {
          const a = results.scenarios[scenario][browser], b = results.scenarios[scenario][browser + '-automation'];
          console.log('  Launch control ' + browser + ': ' + JSON.stringify({
            direct: { axes: a.summary, privateResident: a.privateWsMiB },
            automation: { axes: b.summary, privateResident: b.privateWsMiB },
          }));
        }
      }
      // Grade the 20% minimum separately from the optional 40% stretch.
      const pair = results.scenarios[scenario];
      if (pair.edge && pair.dexerion) {
        const cmp = {};
        for (const axis of Object.keys(AXES)) {
          const pct = pctOfEdge(pair.dexerion.summary[axis], pair.edge.summary[axis]);
          cmp[axis + 'PctOfEdge'] = pct;
          cmp[axis + 'Pass'] = pct === null ? 'n/a' : (pct <= 60 ? '40% STRETCH' : pct <= 80 ? '20% TARGET' : 'BELOW TARGET');
        }
        pair.comparison = cmp;
        console.log('  ' + scenario + ' comparison: ' + JSON.stringify(cmp));
      }
    }

    results.method = 'Per trial: paired RAPL floor (no browser, immediately before workload) -> launch (throwaway profile) -> settle -> whole-tree snapshot A -> concurrent GPU-engine + RAPL sampling -> whole-tree snapshot B -> teardown. CPU = Win32_Process UserMode+KernelMode delta (100 ns units) summed over the browser tree (new children counted fully, mid-window exits logged). RAM = tree working set at snapshot B; role working sets and private allocations are diagnostic only (not private resident memory). GPU = tree GPU Engine utilisation points averaged across shared sample intervals; busiest engine shown separately. GPU memory is not inferred from potentially duplicated driver rows. Power = workload median mW minus that paired floor median. Invalid: floor swing >20% vs group reference, or missing environment record. Unavailable counters remain null; missing RAPL does not prevent CPU/RAM/GPU measurements. Medians/IQR over VALID trials only; all trials published.';
    const outJson = path.join(OUT_DIR, 'measure-protocol-' + (process.env.DEX_BUILD_DIR ? 'baseline' : 'main') + '.json');
    fs.writeFileSync(outJson, JSON.stringify(results, null, 2), 'utf8');
    console.log('PROTOCOL EVIDENCE: ' + outJson);
    for (const scenario of SCENARIO_ORDER) {
      const pair = results.scenarios[scenario];
      if (pair.comparison) console.log('VERDICT ' + scenario + ': ' + JSON.stringify(pair.comparison));
    }
  } finally {
    for (const directory of seedProfiles.values()) {
      try { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {}
    }
    server.close();
  }
})().catch((err) => {
  console.error('PROTOCOL ERROR: ' + (err && err.stack || err));
  process.exitCode = 1;
});
