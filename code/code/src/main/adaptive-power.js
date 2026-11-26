// Adaptive GPU + adaptive power management — pure decision logic.
//
// No Electron, no timers, no I/O: every decision here is a function of the
// signals the browser main process feeds it, so the policy can be unit-tested
// without starting Chromium (see build/scripts/test-adaptive-power.js).
//
// The user-facing GPU control is a single Adaptive mode. Legacy off/balanced/
// full preferences migrate to it; the only supported value after migration is
// 'adaptive'. The startup plan chooses launch-time Chromium GPU switches; the
// runtime plan chooses housekeeping cadence and which views may render.
'use strict';

const GPU_MODE = 'adaptive';
const GPU_MODES = Object.freeze(['adaptive', 'cap10', 'off']);
// Old picker values that map to Adaptive. 'off' stays a legal choice (same
// meaning it always had: software rendering, no GPU).
const LEGACY_GPU_MODES = Object.freeze(['balanced', 'full']);
// The 10% cap tier keeps the GPU only for final compositing: raster on CPU,
// a small GPU memory budget, and an integrated-GPU preference where the
// machine has hybrid graphics. Hardware video decode stays on — software
// decode would burn more power, not less.
const CAP10_GPU_MEMORY_MB = 128;
const TIERS = Object.freeze(['suspended', 'minimal', 'balanced', 'accelerated']);

const DOWNGRADE_HYSTERESIS_MS = 15000;
const SUSPEND_IDLE_MS = 10 * 60 * 1000;
const SWEEP_MIN_MS = 15000;
const SWEEP_MAX_MS = 5 * 60 * 1000;

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

// Accepted persisted values: Adaptive (default), the 10% cap tier, and Off.
// Anything unknown falls back to Adaptive.
function normalizeGpuMode(value) {
  const v = String(value === undefined || value === null ? '' : value);
  return GPU_MODES.includes(v) ? v : GPU_MODE;
}

// One-time migration of the old off/balanced/full picker. 'off' keeps its
// meaning (now a legal choice again); balanced/full/unknown map to Adaptive.
// `changed` says whether the profile needs a write.
function migrateGpuMode(value) {
  const v = String(value === undefined || value === null ? '' : value);
  if (GPU_MODES.includes(v)) return { value: v, changed: false };
  return { value: GPU_MODE, changed: true };
}

// Launch-time switches. Chromium reads these before the GPU process starts, so
// the choice is made once from the user's mode plus the power/RAM state at
// boot; runtime changes are handled by controlling which views render
// (runtimePlan) instead of pretending a command-line switch can be flipped
// later. Mode precedence: test override > persisted mode > Adaptive.
function startupGpuPlan(opts) {
  const o = opts || {};
  const override = o.override === undefined ? null : String(o.override);
  // Internal test seam only (e2e uses --gpu=off for deterministic compositor
  // timing). It is not exposed in Settings and is never written to the profile.
  if (override === 'off') {
    return {
      disableGpu: true, gpuRasterization: false, zeroCopy: false, forceLowPowerGpu: false,
      gpuMemoryMB: 0, tier: 'suspended', mode: 'off', override,
    };
  }
  const mode = normalizeGpuMode(o.mode);
  if (mode === 'off') {
    // Software rendering: no GPU process work at all. Heaviest pages still
    // render correctly, just on the CPU.
    return {
      disableGpu: true, gpuRasterization: false, zeroCopy: false, forceLowPowerGpu: false,
      gpuMemoryMB: 0, tier: 'suspended', mode, override: null,
    };
  }
  if (mode === 'cap10') {
    // Minimal GPU envelope — the closest thing an app can do to a literal
    // 10% utilization cap (a true utilization cap is driver-level). The GPU
    // still answers video/WebGL, so nothing breaks; it is just asked to do
    // far less.
    return {
      disableGpu: false, gpuRasterization: false, zeroCopy: true, forceLowPowerGpu: true,
      gpuMemoryMB: CAP10_GPU_MEMORY_MB, tier: 'minimal', mode, override: null,
    };
  }
  const onBattery = Boolean(o.onBattery);
  const freeMemMB = Number(o.freeMemMB) || 0;
  const conservative = onBattery || (freeMemMB > 0 && freeMemMB < 2048);
  return {
    disableGpu: false,
    gpuRasterization: !conservative,
    zeroCopy: true,
    forceLowPowerGpu: false,
    gpuMemoryMB: conservative ? 256 : 512,
    tier: conservative ? 'minimal' : 'balanced',
    mode, override: null,
  };
}

const DEFAULT_SIGNALS = Object.freeze({
  focused: true,
  minimized: false,
  locked: false,
  onBattery: false,
  idleMs: 0,
  freeMemMB: 0,
  cpuPct: 0,
  activeTabCount: 1,
  video: false,
  webgl: false,
  animation: false,
  loading: false,
  audible: false,
  interacting: false,
});

function demandScore(signals) {
  const s = { ...DEFAULT_SIGNALS, ...(signals || {}) };
  let score = 0;
  if (s.webgl) score += 5;
  if (s.video) score += 5;
  if (s.animation) score += 2;
  if (s.interacting) score += 2;
  if (s.loading) score += 1;
  if (s.activeTabCount > 1) score += 1;
  if (s.audible) score += 1;
  return score;
}

function desiredTier(signals) {
  const s = { ...DEFAULT_SIGNALS, ...(signals || {}) };
  const score = demandScore(s);
  let tier;
  if (score >= 5) tier = 'accelerated';
  else if (score >= 2) tier = 'balanced';
  else tier = 'minimal';
  // Battery and low RAM cap animation-only demand, but never suppress a
  // genuinely GPU-dependent page (video/WebGL still reach accelerated).
  if ((s.onBattery || (s.freeMemMB > 0 && s.freeMemMB < 1024)) && tier === 'accelerated' && score < 7) tier = 'balanced';
  if (s.cpuPct >= 75 && tier === 'accelerated' && score < 7) tier = 'balanced';
  return tier;
}

// A tier downgrade waits out short dips so a page that alternates between
// animation and rest does not wake/suspend the compositor repeatedly. Upgrades
// are immediate: responsiveness is never traded for hysteresis.
function decideGpuTier(signals, previous, nowMs, state) {
  const s = { ...DEFAULT_SIGNALS, ...(signals || {}) };
  const now = Number(nowMs) || 0;
  const since = Number(state && state.tierSince);
  const age = Number.isFinite(since) ? Math.max(0, now - since) : DOWNGRADE_HYSTERESIS_MS;
  if (s.locked || s.minimized) return 'suspended';
  if (s.idleMs >= SUSPEND_IDLE_MS && !s.video && !s.audible && !s.webgl) return 'suspended';
  const desired = desiredTier(s);
  const rank = { suspended: 0, minimal: 1, balanced: 2, accelerated: 3 };
  const prev = TIERS.includes(previous) ? previous : null;
  if (prev && rank[desired] < rank[prev] && age < DOWNGRADE_HYSTERESIS_MS) return prev;
  return desired;
}

// Runtime plan: cadence of internal sweeps and whether inactive/minimized
// views may composite. This does NOT throttle page JavaScript or networking —
// it only stops work Dexerion itself schedules or paints on behalf of a page.
function runtimePlan(signals, previous, nowMs, state, budgets) {
  const s = { ...DEFAULT_SIGNALS, ...(signals || {}) };
  const b = budgets || {};
  const baseSweep = Number(b.sweepIntervalMs) || 60000;
  const baseIdle = Number(b.idleSleepMs) || 180000;
  const gpuTier = decideGpuTier(s, previous, nowMs, state);
  const idle = s.idleMs >= 2 * 60 * 1000;
  let multiplier = 1;
  if (gpuTier === 'suspended') multiplier = 3;
  else if (s.onBattery) multiplier = 2;
  else if (idle) multiplier = 2;
  const sweepIntervalMs = clamp(baseSweep * multiplier, SWEEP_MIN_MS, SWEEP_MAX_MS);
  let idleSleepMs = baseIdle;
  if (gpuTier === 'suspended' || s.onBattery) idleSleepMs = Math.min(idleSleepMs, 90000);
  if (s.freeMemMB > 0 && s.freeMemMB < 1024) idleSleepMs = Math.min(idleSleepMs, 60000);
  return {
    gpuTier,
    sweepIntervalMs,
    idleSleepMs: Math.round(idleSleepMs),
    hideInactiveViews: true,
    hideMinimizedViews: true,
    backgroundThrottling: true,
    sampleMetrics: gpuTier !== 'suspended',
  };
}

module.exports = {
  GPU_MODE, GPU_MODES, LEGACY_GPU_MODES, CAP10_GPU_MEMORY_MB, TIERS,
  DOWNGRADE_HYSTERESIS_MS, SUSPEND_IDLE_MS,
  clamp, normalizeGpuMode, migrateGpuMode, startupGpuPlan,
  demandScore, desiredTier, decideGpuTier, runtimePlan,
};
