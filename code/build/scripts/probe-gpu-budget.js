'use strict';
// V4 experiment 1 — does the GPU process's memory respond to
// --force-gpu-mem-available-mb at all?
//
// The plan (src/main/adaptive-power.js startupGpuPlan, FROZEN) appends the
// switch at 256 (conservative tier) / 512 (AC tier). This probe measures the
// GPU process's working set / private bytes at the plan value vs an overridden
// value, and — before trusting any override — verifies WHICH occurrence of a
// duplicated switch actually wins, by reading the browser-side effective value
// back through dex:gpu-info (app.commandLine.getSwitchValue — Chromium's
// command-line map) and the GPU child's real command line (Win32_Process).
//
// Arms (env PROBE_GPU_ARMS, default "plan,env:128"):
//   plan      — shipped launch path, no override (launchDexerion gpu:'adaptive')
//   env:<n>   — DEX_GPU_MEM_MB=<n> (main.js measurement seam; only works once
//               that seam exists — the readback proves whether it applied)
//   argv:<n>  — extra launch arg --force-gpu-mem-available-mb=<n> appended AFTER
//               the harness args (tests the "last occurrence wins" assumption)
//   off       — DEX_GPU_MEM_MB=off (no force-gpu-mem-available-mb switch at all)
//
// Each arm-round boots the app (throwaway profile), opens one static tab so
// the compositor is in its steady state, settles, then samples app metrics
// twice (3 s apart) and reports the GPU process's WS/private plus the tree WS.
// Rounds are interleaved round-robin across arms. The probe reports; it does
// not judge.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron: electron } = require('@playwright/test');
const { launchDexerion } = require('../e2e/app');

const OUT = process.env.PROBE_GPU_OUT
  || path.join(os.tmpdir(), 'opencode', 'probe-gpu-budget.json');
const ROUNDS = Math.max(1, Number(process.env.PROBE_GPU_ROUNDS) || 3);
const ARMS = (process.env.PROBE_GPU_ARMS || 'plan,env:128')
  .split(',').map((s) => s.trim()).filter(Boolean);
const SETTLE_MS = 8000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

// Same CIM oracle the other probes use, widened to GPU child processes.
function gpuChildCmdlines() {
  const ps = "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | "
    + 'Where-Object { $_.CommandLine -match \'--type=gpu-process\' } | '
    + 'Select-Object -ExpandProperty CommandLine';
  try {
    return String(execFileSync('powershell.exe', ['-NoProfile', '-NoLogo', '-Command', ps],
      { encoding: 'utf8', timeout: 30000 }) || '')
      .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch { return []; }
}

function onAc() {
  // BatteryStatus 2 == "on AC" (the measure-env.ps1 convention).
  const ps = "Get-CimInstance Win32_Battery | Select-Object -ExpandProperty BatteryStatus";
  try {
    const v = String(execFileSync('powershell.exe', ['-NoProfile', '-NoLogo', '-Command', ps],
      { encoding: 'utf8', timeout: 15000 }) || '').trim();
    return v === '2' ? 'AC' : 'battery';
  } catch { return 'unknown'; }
}

// Replicates e2e/app.js launchOnce (which this window may not edit) plus the
// extra argv switches the argv arm needs. Same throwaway profile, NODE_PATH,
// DEX_AI_TEST and adaptive GPU policy (no --gpu arg).
async function launchWithExtraArgs(extraArgs, extraEnv) {
  const buildDir = path.join(__dirname, '..');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dexerion-gpubudget-'));
  const env = {
    ...process.env,
    NODE_PATH: path.join(buildDir, 'node_modules')
      + (process.env.NODE_PATH ? path.delimiter + process.env.NODE_PATH : ''),
    DEX_AI_TEST: '1',
    ...(extraEnv || {}),
  };
  let app = null;
  try {
    app = await electron.launch({
      executablePath: require('electron'),
      cwd: buildDir,
      args: ['.', '--user-data-dir=' + profile, ...(extraArgs || [])],
      env,
      timeout: 120000,
    });
    const win = await app.firstWindow({ timeout: 120000 });
    await win.waitForLoadState('domcontentloaded');
    return { app, win, profile };
  } catch (err) {
    if (app) { try { await app.close(); } catch {} }
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
    throw err;
  }
}

async function sampleArm(arm) {
  const spec = String(arm);
  const extraEnv = {};
  const extraArgs = [];
  if (spec === 'plan') {
    // shipped path, untouched
  } else if (spec === 'off') {
    extraEnv.DEX_GPU_MEM_MB = 'off';
  } else if (spec.startsWith('env:')) {
    extraEnv.DEX_GPU_MEM_MB = spec.slice(4);
  } else if (spec.startsWith('argv:')) {
    extraArgs.push('--force-gpu-mem-available-mb=' + spec.slice(5));
  } else {
    throw new Error('unknown arm: ' + spec);
  }

  const launched = extraArgs.length
    ? await launchWithExtraArgs(extraArgs, extraEnv)
    : await launchDexerion({ attempts: 2, gpu: 'adaptive', env: extraEnv });
  const { win, app } = launched;
  try {
    const server = require('node:http').createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end('<!doctype html><title>gpu budget probe</title><h1>static</h1>');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + server.address().port + '/';
    await win.evaluate(({ u }) => window.dexerion.invoke('dex:new-tab', u, false), { u: base });
    for (let i = 0; i < 40; i += 1) {
      const st = await win.evaluate(() => window.dexerion.invoke('dex:get-state'));
      const tabs = (st && st.tabs) || [];
      if (tabs.length >= 2 && !tabs.some((t) => t.loading)) break;
      await win.waitForTimeout(250);
    }
    await sleep(SETTLE_MS);

    const sampleOnce = () => app.evaluate(({ app }) => {
      let wsKB = 0;
      const gpu = [];
      for (const m of app.getAppMetrics()) {
        const mem = (m && m.memory) || {};
        wsKB += mem.workingSetSize || 0;
        if (m.type === 'GPU') {
          gpu.push({
            pid: m.pid,
            wsMB: Math.round((mem.workingSetSize || 0) / 1024),
            privateMB: Math.round((mem.privateBytes || 0) / 1024),
          });
        }
      }
      return { gpu, treeWsMB: Math.round(wsKB / 1024) };
    });
    const s1 = await sampleOnce();
    await sleep(3000);
    const s2 = await sampleOnce();
    let gpuInfo = null;
    try { gpuInfo = await win.evaluate(() => window.dexerion.invoke('dex:gpu-info')); } catch {}
    const cmdlines = gpuChildCmdlines();
    const budgetOnChild = cmdlines
      .map((c) => (/--force-gpu-mem-available-mb=(\S+)/.exec(c) || [])[1] || null)
      .filter(Boolean);
    return {
      arm,
      gpu: s1.gpu.map((g, i) => ({
        pid: g.pid,
        wsMB: Math.round((g.wsMB + s2.gpu[i].wsMB) / 2),
        privateMB: Math.round((g.privateMB + s2.gpu[i].privateMB) / 2),
      })),
      treeWsMB: Math.round((s1.treeWsMB + s2.treeWsMB) / 2),
      reportedBudget: gpuInfo && gpuInfo.switches ? gpuInfo.switches.gpuMemBudgetMB : null,
      raster: gpuInfo && gpuInfo.switches ? gpuInfo.switches.gpuRasterization : null,
      budgetSwitchOnGpuChild: [...new Set(budgetOnChild)],
      gpuCmdlines: cmdlines,
      power: onAc(),
    };
  } finally {
    try { await launched.app.close(); } catch {}
  }
}

(async () => {
  const results = [];
  const rounds = [];
  for (let round = 1; round <= ROUNDS; round += 1) {
    // Round-robin with rotated arm order so machine drift does not
    // systematically favour the first arm.
    const order = ARMS.slice(round % ARMS.length).concat(ARMS.slice(0, round % ARMS.length));
    for (const arm of order) {
      const row = await sampleArm(arm).catch((err) => ({ arm, error: String(err && err.stack || err) }));
      results.push(row);
      if (row.error) {
        console.log('ROUND ' + round + ' arm ' + arm + ': ERROR ' + row.error.split('\n')[0]);
      } else {
        const g = row.gpu[0] || { wsMB: NaN, privateMB: NaN };
        console.log('ROUND ' + round + ' arm ' + arm
          + ': gpu ws=' + g.wsMB + 'MB private=' + g.privateMB + 'MB'
          + ' tree=' + row.treeWsMB + 'MB'
          + ' reported=' + row.reportedBudget
          + ' child=' + JSON.stringify(row.budgetSwitchOnGpuChild)
          + ' power=' + row.power);
      }
      rounds.push(round);
    }
  }
  // Summary per arm (successful rounds only).
  const summary = {};
  for (const arm of ARMS) {
    const rows = results.filter((r) => r.arm === arm && !r.error && r.gpu.length);
    summary[arm] = {
      rounds: rows.length,
      gpuWsMB: median(rows.map((r) => r.gpu[0].wsMB)),
      gpuPrivateMB: median(rows.map((r) => r.gpu[0].privateMB)),
      treeWsMB: median(rows.map((r) => r.treeWsMB)),
      reportedBudget: [...new Set(rows.map((r) => r.reportedBudget))],
      childSwitch: [...new Set(rows.map((r) => JSON.stringify(r.budgetSwitchOnGpuChild)))],
    };
  }
  const out = {
    generatedAt: new Date().toISOString(),
    arms: ARMS, rounds: ROUNDS,
    planNote: 'plan = frozen adaptive-power.startupGpuPlan (256 conservative / 512 AC)',
    summary, results,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  console.log('GPU BUDGET SUMMARY: ' + JSON.stringify(summary));
  console.log('GPU BUDGET PROBE EVIDENCE: ' + OUT);
  console.log('GPU BUDGET PROBE OK');
})().catch((err) => {
  console.error('GPU BUDGET PROBE ERROR: ' + (err && err.stack || err));
  process.exitCode = 1;
});
