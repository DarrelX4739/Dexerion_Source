'use strict';
// Unit gates for the Adaptive GPU / adaptive power policy. Pure logic only.
const assert = require('node:assert/strict');
const ap = require('../../code/src/main/adaptive-power');
const budgets = require('../../code/src/main/debloat-budgets');

let checks = 0;
const check = (name, fn) => { fn(); checks += 1; console.log('PASS ' + name); };

check('legacy GPU preferences all migrate to the single Adaptive mode', () => {
  for (const old of [...ap.LEGACY_GPU_MODES, '', null, undefined, 'nonsense', 'adaptive']) {
    assert.equal(ap.normalizeGpuMode(old), 'adaptive');
  }
  assert.equal(ap.isLegacyGpuMode('full'), true);
  assert.equal(ap.isLegacyGpuMode('adaptive'), false);
});

check('startup never disables GPU acceleration for a normal launch', () => {
  const ac = ap.startupGpuPlan({ onBattery: false, freeMemMB: 8192 });
  assert.equal(ac.disableGpu, false);
  assert.equal(ac.gpuRasterization, true);
  assert.equal(ac.gpuMemoryMB, 512);
  const battery = ap.startupGpuPlan({ onBattery: true, freeMemMB: 8192 });
  assert.equal(battery.disableGpu, false);
  assert.equal(battery.gpuRasterization, false);
  assert.equal(battery.gpuMemoryMB, 256);
  assert.equal(ap.startupGpuPlan({ freeMemMB: 512 }).gpuMemoryMB, 256);
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
