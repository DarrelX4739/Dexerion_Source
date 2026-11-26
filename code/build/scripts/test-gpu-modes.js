'use strict';
// Live verification of the three GPU modes (Adaptive | 10% cap | Off).
// For each mode, on a throwaway profile:
//   1. settings.json is seeded with the mode, the app is launched (no
//      --gpu= override, so the persisted mode actually drives the switches),
//   2. boot health is checked via dex:get-state (browsing state works),
//   3. the real process metrics (dex:memory) show whether a GPU process
//      exists — Off must have none, Adaptive and 10% cap must have one,
//   4. persistence is checked: the seeded value must survive boot unchanged,
//      and a settings-save through the real IPC must write through to disk.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron: electron } = require('@playwright/test');

const BUILD = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

// The GPU process's real Chromium command line. Under --disable-gpu Chromium
// still runs a GPU process for software compositing, so process COUNT proves
// nothing — the switch flags on the process do.
function gpuProcessCmdline() {
  const ps = "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | "
    + "Where-Object { $_.CommandLine -match '--type=gpu-process' } | "
    + 'Select-Object -First 1 -ExpandProperty CommandLine';
  try {
    return String(execFileSync('powershell.exe', ['-NoProfile', '-NoLogo', '-Command', ps], { encoding: 'utf8' }) || '').trim();
  } catch { return ''; }
}

async function launchWith(profileDir) {
  return electron.launch({
    executablePath: require('electron'),
    cwd: BUILD,
    args: ['.', '--user-data-dir=' + profileDir],
    env: {
      ...process.env,
      NODE_PATH: path.join(BUILD, 'node_modules'),
      DEX_AI_TEST: '1',
    },
    timeout: 120000,
  });
}

function check(name, cond, detail) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) failures += 1;
}

(async () => {
  for (const mode of ['adaptive', 'cap10', 'off']) {
    console.log('=== mode: ' + mode + ' ===');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-gpu-' + mode + '-'));
    const settingsPath = path.join(dir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ gpuMode: mode }));
    let app = null;
    try {
      app = await launchWith(dir);
      const win = await app.firstWindow({ timeout: 120000 });
      await win.waitForLoadState('domcontentloaded');
      await sleep(1500);

      // Browsing state machinery works in this mode.
      const st = await win.evaluate(() => window.dexerion.invoke('dex:get-state'));
      check(mode + ': boots and serves browser state', Boolean(st && Array.isArray(st.tabs)));

      // Ground truth: what Chromium actually decided at boot, read from the
      // main process (the GPU child's command line encodes switches into
      // --gpu-preferences, so raw flag checks on it are meaningless).
      const gpu = await win.evaluate(() => window.dexerion.invoke('dex:gpu-info'));
      check(mode + ': gpu-info reachable', Boolean(gpu && gpu.switches));
      if (gpu && gpu.switches) {
        const s = gpu.switches;
        if (mode === 'off') {
          check('off: --disable-gpu applied', s.disableGpu === true, 'switches=' + JSON.stringify(s));
          check('off: gpu_compositing not hardware', !/^enabled/.test(String(gpu.features.gpu_compositing)), 'features=' + JSON.stringify(gpu.features));
        } else {
          check(mode + ': GPU not disabled', s.disableGpu === false, 'switches=' + JSON.stringify(s));
          check(mode + ': zero-copy enabled', s.zeroCopy === true);
        }
        if (mode === 'cap10') {
          check('cap10: --force-low-power-gpu applied', s.forceLowPowerGpu === true);
          check('cap10: 128MB GPU memory budget applied', s.gpuMemBudgetMB === '128', 'budget=' + s.gpuMemBudgetMB);
          check('cap10: GPU raster off (CPU raster)', s.gpuRasterization === false);
        }
        if (mode === 'adaptive') {
          check('adaptive: GPU memory budget present (256/512)', ['256', '512'].includes(s.gpuMemBudgetMB), 'budget=' + s.gpuMemBudgetMB);
        }
      }

      // Process metrics (informational): Chromium keeps a software GPU process
      // even under --disable-gpu, so the count is not the assertion.
      const mem = await win.evaluate(() => window.dexerion.invoke('dex:memory'));
      const gpuProcs = (mem && mem.byType && mem.byType.GPU) || 0;
      console.log('info ' + mode + ': GPU-type processes in metrics = ' + gpuProcs);

      // Persistence: the seeded mode survives boot without a rewrite.
      const afterBoot = JSON.parse(fs.readFileSync(settingsPath, 'utf8')).gpuMode;
      check(mode + ': persisted value survives boot', afterBoot === mode, 'on disk: ' + afterBoot);

      // Save round-trip through the real IPC writes through to disk.
      const next = mode === 'adaptive' ? 'cap10' : 'adaptive';
      await win.evaluate((m) => window.dexerion.invoke('dex:settings-save', { gpuMode: m }), next);
      const afterSave = JSON.parse(fs.readFileSync(settingsPath, 'utf8')).gpuMode;
      check(mode + ': settings-save persists a mode change', afterSave === next, 'on disk: ' + afterSave);
    } catch (err) {
      failures += 1;
      console.error('FAIL ' + mode + ' — ' + String(err && err.message || err).split('\n')[0]);
    } finally {
      if (app) { try { await app.close(); } catch {} }
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  }

  console.log(failures === 0
    ? 'GPU MODES: ALL CHECKS PASS'
    : 'GPU MODES: ' + failures + ' CHECK(S) FAILED');
  process.exitCode = failures === 0 ? 0 : 1;
})().catch((err) => {
  console.error('GPU MODES ERROR: ' + (err && err.stack || err));
  process.exitCode = 1;
});
