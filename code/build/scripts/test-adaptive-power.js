'use strict';
// Unit gates for the Adaptive GPU / adaptive power policy. Pure logic only.
const assert = require('node:assert/strict');
const ap = require('../../code/src/main/adaptive-power');
const budgets = require('../../code/src/main/debloat-budgets');

let checks = 0;
const check = (name, fn) => { fn(); checks += 1; console.log('PASS ' + name); };

check('one GPU mode exists and every legacy value migrates to it', () => {
  assert.deepEqual([...ap.GPU_MODES], ['adaptive']);
  assert.deepEqual(ap.migrateGpuMode('adaptive'), { value: 'adaptive', changed: false });
  // Every earlier picker value (and junk) maps to Adaptive with a write.
  for (const old of [...ap.LEGACY_GPU_MODES, '', null, undefined, 'nonsense']) {
    assert.equal(ap.migrateGpuMode(old).value, 'adaptive');
    assert.equal(ap.migrateGpuMode(old).changed, true);
  }
  assert.equal(ap.normalizeGpuMode('off'), 'adaptive');
  assert.equal(ap.normalizeGpuMode('cap10'), 'adaptive');
  assert.equal(ap.normalizeGpuMode('balanced'), 'adaptive');
});

check('Adaptive uses hardware acceleration; conservative tier on battery/low RAM', () => {
  const plan = ap.startupGpuPlan({ mode: 'adaptive', onBattery: false, freeMemMB: 8192 });
  assert.equal(plan.disableGpu, false);
  assert.equal(plan.gpuRasterization, true);
  assert.equal(plan.zeroCopy, true);
  assert.equal(plan.gpuMemoryMB, 512);
  assert.equal(plan.tier, 'balanced');
  // Conservative tier: raster stays CPU-side, smaller GPU memory budget.
  const battery = ap.startupGpuPlan({ mode: 'adaptive', onBattery: true, freeMemMB: 8192 });
  assert.equal(battery.disableGpu, false);
  assert.equal(battery.gpuRasterization, false);
  assert.equal(battery.gpuMemoryMB, 256);
  assert.equal(battery.tier, 'minimal');
  assert.equal(ap.startupGpuPlan({ mode: 'adaptive', freeMemMB: 512 }).gpuMemoryMB, 256);
});

check('the software-compositing override stays a test-only seam', () => {
  const t = ap.startupGpuPlan({ override: 'off' });
  assert.equal(t.disableGpu, true);
  assert.equal(t.tier, 'suspended');
  // Unknown override values are ignored: the persisted mode decides.
  assert.equal(ap.startupGpuPlan({ override: 'balanced' }).mode, 'adaptive');
});

check('idle, minimized and locked windows suspend GPU demand', () => {
  const now = 1000000;
  assert.equal(ap.decideGpuTier({ minimized: true }, 'accelerated', now, { tierSince: now }), 'suspended');
  assert.equal(ap.decideGpuTier({ locked: true }, 'accelerated', now, { tierSince: now }), 'suspended');
  assert.equal(ap.decideGpuTier({ idleMs: ap.SUSPEND_IDLE_MS + 1 }, 'balanced', now, { tierSince: 0 }), 'suspended');
  assert.equal(ap.decideGpuTier({ idleMs: ap.SUSPEND_IDLE_MS + 1, video: true }, 'balanced', now, { tierSince: 0 }), 'accelerated');
});

check('real GPU work upgrades immediately; downgrades use hysteresis', () => {
  const now = 1000000;
  assert.equal(ap.decideGpuTier({ webgl: true }, 'minimal', now, { tierSince: 0 }), 'accelerated');
  assert.equal(ap.decideGpuTier({ video: true }, 'minimal', now, { tierSince: 0 }), 'accelerated');
  assert.equal(ap.decideGpuTier({}, 'accelerated', now, { tierSince: now - 1000 }), 'accelerated');
  assert.equal(ap.decideGpuTier({}, 'accelerated', now, { tierSince: now - 20000 }), 'minimal');
});

check('battery and tight RAM cap animation-only GPU demand', () => {
  assert.equal(ap.desiredTier({ animation: true, onBattery: true }), 'balanced');
  assert.equal(ap.desiredTier({ animation: true, freeMemMB: 512 }), 'balanced');
  assert.equal(ap.desiredTier({ video: true, onBattery: true }), 'balanced');
  assert.equal(ap.desiredTier({ animation: true, cpuPct: 90 }), 'balanced');
});

check('runtime cadence adapts without throttling page work', () => {
  const active = ap.runtimePlan({}, undefined, 0, null, budgets.BUDGETS);
  assert.equal(active.gpuTier, 'minimal');
  assert.equal(active.sweepIntervalMs, budgets.BUDGETS.sweepIntervalMs);
  assert.equal(active.backgroundThrottling, true);
  const battery = ap.runtimePlan({ onBattery: true, animation: true }, undefined, 0, null, budgets.BUDGETS);
  assert.equal(battery.sweepIntervalMs, active.sweepIntervalMs * 2);
  assert.ok(battery.idleSleepMs <= 90000);
  const suspended = ap.runtimePlan({ minimized: true }, undefined, 0, null, budgets.BUDGETS);
  assert.equal(suspended.gpuTier, 'suspended');
  assert.equal(suspended.sampleMetrics, false);
  assert.equal(suspended.sweepIntervalMs, budgets.BUDGETS.sweepIntervalMs * 3);
});

check('every plan stays inside bounded, reversible budgets', () => {
  for (const s of [
    {}, { onBattery: true }, { minimized: true }, { idleMs: 99999999 },
    { freeMemMB: 1 }, { cpuPct: 100 }, { webgl: true }, { video: true, locked: true },
  ]) {
    const plan = ap.runtimePlan(s, undefined, 0, null, budgets.BUDGETS);
    assert.ok(ap.TIERS.includes(plan.gpuTier));
    assert.ok(plan.sweepIntervalMs >= 15000 && plan.sweepIntervalMs <= 300000);
    assert.ok(plan.idleSleepMs >= 30000 && plan.idleSleepMs <= 1800000);
  }
});

console.log('adaptive-power: ' + checks + ' checks PASS');
