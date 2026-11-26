'use strict';
// Unit gates for the Adaptive GPU / adaptive power policy. Pure logic only.
const assert = require('node:assert/strict');
const ap = require('../../code/src/main/adaptive-power');
const budgets = require('../../code/src/main/debloat-budgets');

let checks = 0;
const check = (name, fn) => { fn(); checks += 1; console.log('PASS ' + name); };

check('the three GPU modes are the only accepted values; legacy values migrate', () => {
  // Legal persisted values pass through untouched.
  for (const v of ap.GPU_MODES) {
    assert.equal(ap.normalizeGpuMode(v), v);
    assert.deepEqual(ap.migrateGpuMode(v), { value: v, changed: false });
  }
  // Old balanced/full/unknown map to Adaptive (needs a write); legacy 'off'
  // keeps its meaning (now a legal choice again, no write needed).
  for (const old of [...ap.LEGACY_GPU_MODES, '', null, undefined, 'nonsense']) {
    assert.equal(ap.migrateGpuMode(old).value, 'adaptive');
    assert.equal(ap.migrateGpuMode(old).changed, true);
  }
  assert.deepEqual(ap.migrateGpuMode('off'), { value: 'off', changed: false });
});

check('Adaptive never disables GPU acceleration for a normal launch', () => {
  const ac = ap.startupGpuPlan({ mode: 'adaptive', onBattery: false, freeMemMB: 8192 });
  assert.equal(ac.disableGpu, false);
  assert.equal(ac.gpuRasterization, true);
  assert.equal(ac.gpuMemoryMB, 512);
  const battery = ap.startupGpuPlan({ mode: 'adaptive', onBattery: true, freeMemMB: 8192 });
  assert.equal(battery.disableGpu, false);
  assert.equal(battery.gpuRasterization, false);
  assert.equal(battery.gpuMemoryMB, 256);
  assert.equal(ap.startupGpuPlan({ mode: 'adaptive', freeMemMB: 512 }).gpuMemoryMB, 256);
});

check('GPU Off is real software rendering', () => {
  const off = ap.startupGpuPlan({ mode: 'off', onBattery: false, freeMemMB: 8192 });
  assert.equal(off.disableGpu, true);
  assert.equal(off.gpuRasterization, false);
  assert.equal(off.gpuMemoryMB, 0);
  assert.equal(off.tier, 'suspended');
});

check('the 10% cap keeps the GPU minimal but functional', () => {
  const cap = ap.startupGpuPlan({ mode: 'cap10', onBattery: false, freeMemMB: 8192 });
  assert.equal(cap.disableGpu, false);          // GPU stays available for video/WebGL
  assert.equal(cap.gpuRasterization, false);    // raster moves to the CPU
  assert.equal(cap.forceLowPowerGpu, true);     // integrated GPU preferred where available
  assert.equal(cap.gpuMemoryMB, ap.CAP10_GPU_MEMORY_MB);
  assert.ok(cap.gpuMemoryMB < 256);
  assert.equal(cap.tier, 'minimal');
  // Battery does not double-penalize the cap tier.
  const onBattery = ap.startupGpuPlan({ mode: 'cap10', onBattery: true });
  assert.equal(onBattery.gpuMemoryMB, ap.CAP10_GPU_MEMORY_MB);
});

check('the software-compositing switch stays a test-only override', () => {
  const t = ap.startupGpuPlan({ override: 'off' });
  assert.equal(t.disableGpu, true);
  assert.equal(t.tier, 'suspended');
  assert.equal(ap.startupGpuPlan({ override: 'balanced' }).disableGpu, false);
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
