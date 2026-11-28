// Opt-in integration check. Run with a compiled dex_ap_replay and the repo's
// test dependencies installed in code/build. Never loads C++ into Electron.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const fields = ['focused','minimized','locked','onBattery','video','webgl','animation','loading','audible','interacting'];

function compareNative(binary, rows) {
  assert.ok(rows.length > 0, 'zero real decisions is not a passing shadow test');
  const expected = [], records = [];
  for (const r of rows) {
    const s = r.signals, p = r.plan, b = r.budgets;
    for (const key of fields) assert.equal(typeof s[key], 'boolean', key);
    const flags = fields.reduce((acc, k, i) => acc | (+s[k] << i), 0);
    const values = [s.idleMs, s.freeMemMB, s.cpuPct, s.activeTabCount, r.now, r.since, b.sweep, b.sleep, b.deep];
    assert.ok(values.every(Number.isFinite), 'captured non-finite measurement');
    assert.ok(Number.isSafeInteger(s.activeTabCount), 'invalid tab count');
    records.push([flags, s.idleMs, s.freeMemMB, s.cpuPct, s.activeTabCount, r.now, 1, r.since,
      r.previous, 'adaptive', '-', b.sweep, b.sleep, b.deep].join(' '));
    expected.push([p.gpuTier, p.sweepIntervalMs, +p.deepIdleSweep, p.idleSleepMs, +p.hideInactiveViews,
      +p.hideMinimizedViews, +p.backgroundThrottling, +p.sampleMetrics].join(' '));
  }
  const out = spawnSync(path.resolve(binary), [], { encoding: 'utf8', timeout: 30000,
    input: ['replay ' + rows.length + ' 1', ...records].join('\n') + '\n', maxBuffer: 1024 * 1024 });
  if (out.error) throw out.error;
  assert.equal(out.status, 0, out.stderr);
  const lines = out.stdout.trimEnd().split(/\r?\n/);
  assert.equal(lines.length, rows.length);
  for (let i = 0; i < expected.length; ++i) {
    const all = lines[i].trim().split(/\s+/);
    assert.equal(all.length, 19, 'unexpected replay protocol');
    assert.equal(all.slice(11).join(' '), expected[i], 'actual browser decision #' + i);
  }
}

// Playwright serializes this function into the trusted Electron main process.
// No page content, URL, tab/window ID, profile values or file paths are recorded.
function captureInMain({ app }, expectedProfile) {
  const path = process.getBuiltinModule('path');
  if (app.isPackaged || process.env.DEX_AI_TEST !== '1' ||
      path.relative(app.getPath('userData'), expectedProfile) !== '' ||
      !path.basename(expectedProfile).startsWith('dexerion-e2e-')) {
    throw new Error('Refusing to instrument a non-test profile');
  }
  const req = process.getBuiltinModule('module').createRequire(path.join(app.getAppPath(), 'package.json'));
  const key = req.resolve('../code/src/main/adaptive-power.js');
  if (!req.cache[key]) throw new Error('The actual application policy must already be loaded');
  const policy = req(key), original = policy.runtimePlan;
  const log = { rows: [], overflow: false, errors: 0 };
  const hook = function(s, previous, now, state, b) {
    const p = original.apply(this, arguments);
    try {
      if (log.rows.length >= 256) { log.overflow = true; return p; }
      log.rows.push({
        signals: { focused: s.focused, minimized: s.minimized, locked: s.locked, onBattery: s.onBattery,
          video: s.video, webgl: s.webgl, animation: s.animation, loading: s.loading, audible: s.audible,
          interacting: s.interacting, idleMs: s.idleMs, freeMemMB: s.freeMemMB, cpuPct: s.cpuPct,
          activeTabCount: s.activeTabCount },
        previous, now, since: state.tierSince,
        budgets: { sweep: b.sweepIntervalMs, sleep: b.idleSleepMs, deep: b.sweepDeepIdleMs },
        plan: { gpuTier: p.gpuTier, sweepIntervalMs: p.sweepIntervalMs, deepIdleSweep: p.deepIdleSweep,
          idleSleepMs: p.idleSleepMs, hideInactiveViews: p.hideInactiveViews,
          hideMinimizedViews: p.hideMinimizedViews, backgroundThrottling: p.backgroundThrottling,
          sampleMetrics: p.sampleMetrics },
      });
    } catch { ++log.errors; }
    return p;  // only the original JS result reaches the browser
  };
  policy.runtimePlan = hook;
  globalThis.__dexNativePolicyShadow = {
    log, restore() {
      if (policy.runtimePlan !== hook) throw new Error('Test observer changed unexpectedly');
      policy.runtimePlan = original;
      delete globalThis.__dexNativePolicyShadow;
      return log;
    },
  };
}

async function main() {
  const binary = process.argv[2];
  if (!binary || !fs.statSync(path.resolve(binary)).isFile()) throw new Error('Pass the compiled dex_ap_replay executable');
  if (process.platform === 'linux' && !process.env.DISPLAY)
    throw new Error('Use a disposable X11 display (xvfb-run) for this graphical test');
  const { launchDexerion } = require('../../../code/build/e2e/app.js');
  const { app, profile } = await launchDexerion({ attempts: 1, gpu: 'adaptive' });
  let hooked = false;
  try {
    assert.equal(path.dirname(profile), os.tmpdir());
    assert.ok(path.basename(profile).startsWith('dexerion-e2e-'));
    await app.evaluate(captureInMain, profile); hooked = true;
    // Use real native window operations, not hand-built signals or fake tier
    // changes. show() is also observable under Xvfb without a window manager.
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find(x => !x.isDestroyed() && x.isVisible());
      if (!w) throw new Error('No visible Dexerion window');
      w.hide(); w.show(); w.focus();
    });
    // Capture another distinct lifecycle pass; a real WM can additionally
    // deliver minimize/restore. Those transitions are reported, never faked.
    await app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find(x => !x.isDestroyed() && x.isVisible());
      if (!w) throw new Error('No visible Dexerion window');
      w.minimize();
      await new Promise(r => setTimeout(r, 250));
      w.restore(); w.hide(); w.show();
    });
    const log = await app.evaluate(() => globalThis.__dexNativePolicyShadow.restore());
    hooked = false;
    assert.equal(log.errors, 0, 'capture failed'); assert.equal(log.overflow, false, 'capture overflow');
    assert.ok(log.rows.length >= 2, 'window lifecycle generated fewer than two actual decisions');
    assert.ok(log.rows.some(r => r.signals.activeTabCount > 0), 'captured no initialized active tab');
    compareNative(binary, log.rows);
    const tiers = [...new Set(log.rows.map(r => r.plan.gpuTier))];
    console.log('PASS real Electron shadow: ' + JSON.stringify({
      decisions: log.rows.length, minimizedDecisions: log.rows.filter(r => r.signals.minimized).length,
      observedTiers: tiers, originalJsOnly: true, nativeDecisionsApplied: 0,
    }));
  } finally {
    try {
      if (hooked) await app.evaluate(() => globalThis.__dexNativePolicyShadow?.restore());
    } finally {
      try { await app.close(); }
      finally {
        // Only remove the generated profile verified above; never follow a
        // supplied path or use the actual profile for this observer.
        if (path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('dexerion-e2e-'))
          fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      }
    }
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { compareNative, captureInMain };
