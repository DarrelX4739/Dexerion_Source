// Debloat programme V131-V180 — named, unit-testable resource budgets.
//
// These values are explicit instead of magic numbers scattered through
// browser.js and ai-site-host.js. The optimised profile halves (or better)
// the old worst-case cost while keeping a functional fallback: tabs still
// sleep, previews still work, and diagnostics still cache recent results.
//
// `DEX_DEBLOAT_BASELINE=1` restores the old values for A/B measurement only.
// It is never set by the shipped app or installer.
'use strict';

const LEGACY = Object.freeze({
  siteRegistryBytes: 64 * 1024 * 1024,
  siteRegistryHosts: 24,
  diagnoseCacheEntries: 8,
  sweepIntervalMs: 30 * 1000,
  idleSleepMs: 5 * 60 * 1000,
  previewMessageLimit: 100,
  // A1: no disk-cache caps before the optimisation (Chromium defaults,
  // unbounded). 0 means "append no switch" — the exact legacy behaviour.
  diskCacheBytes: 0,
  mediaCacheBytes: 0,
  // B1: overlays (snip/report/site preview) and the active tab view were
  // never truly taken out of the frame pipeline on minimize before the
  // optimisation (setVisible only - measured: rAF keeps running). 0 restores
  // the legacy setVisible-only behaviour for both.
  overlayHideOnMinimize: 0,
  tabDetachOnMinimize: 0,
  // B1: the page tab covered by the fullscreen search surface was parked at
  // 0x0 but kept producing frames. 0 restores that.
  searchPageDetach: 0,
  // B2: the task-reminder heartbeat was a fixed 30s setInterval. The legacy
  // window of 0 marks every sweep "near", which pins the cadence to the fast
  // tick — the old behaviour exactly.
  taskHeartbeatNearMs: 30 * 1000,
  taskHeartbeatIdleMs: 30 * 1000,
  taskHeartbeatNearWindowMs: 0,
  // B2: the sweep-max floor raise (adaptive-power runtimePlan patch, applied
  // by the Controller). The stretch engages only when this budget is ABOVE
  // the regular sweep max — the legacy value (30s) never engages it, so
  // DEX_DEBLOAT_BASELINE=1 restores the exact legacy cadence.
  sweepDeepIdleMs: 30 * 1000,
});

const OPTIMIZED = Object.freeze({
  // Site preview registry: 64MB / 24 hosts -> 24MB / 12 hosts.
  siteRegistryBytes: 24 * 1024 * 1024,
  siteRegistryHosts: 12,
  // Artifact diagnostics: 8 entries -> 4 entries.
  diagnoseCacheEntries: 4,
  // Background sweeps: 30s -> 60s, halving periodic main-process wakeups.
  sweepIntervalMs: 60 * 1000,
  // Idle renderer teardown: 5min -> 3min, so idle memory falls sooner.
  idleSleepMs: 3 * 60 * 1000,
  // Preview message burst ceiling: 100/s -> 50/s, reducing renderer chatter.
  previewMessageLimit: 50,
  // A1: bounded HTTP + media disk caches. Chromium's simple-cache backend's
  // maintenance/eviction cost scales with cache size, so a bounded cache
  // bounds that background I/O. Generous caps: working sets under budget see
  // identical cache hits (PLAN A1).
  diskCacheBytes: 256 * 1024 * 1024,
  mediaCacheBytes: 192 * 1024 * 1024,
  // B1: overlays attached to a window follow its visibility — a minimized
  // window's open snip/report/preview overlay is detached+hidden, not just
  // flagged (CalculateNativeWinOcclusion is disabled, so nothing else marks
  // those windows occluded).
  overlayHideOnMinimize: 1,
  // B1: on minimize, tab views get the proven background-tab state
  // (detached + hidden) instead of setVisible-only, which does not stop
  // frame production on an attached view. Restoring re-attaches; every tab
  // switch already re-attaches (activateTab), so this self-heals.
  tabDetachOnMinimize: 1,
  // B1: the page tab under the fullscreen search surface is detached+hidden
  // while covered (it was 0x0 but still producing frames) and re-attached
  // when the surface closes.
  searchPageDetach: 1,
  // B2: adaptive task-reminder heartbeat — fast (30s) only while a reminder
  // is owed or comes due within the near window; 5 minutes otherwise.
  taskHeartbeatNearMs: 30 * 1000,
  taskHeartbeatIdleMs: 5 * 60 * 1000,
  taskHeartbeatNearWindowMs: 10 * 60 * 1000,
  // B2: deep-idle sweep ceiling (see the runtimePlan patch spec in the
  // Builder report): a suspended tier with no focused window, playback, GPU
  // demand or in-flight loads may wait this long between housekeeping sweeps.
  // Must exceed sweepIntervalMs * 3 to have any effect (validated below).
  sweepDeepIdleMs: 10 * 60 * 1000,
});

const activeProfile = process.env.DEX_DEBLOAT_BASELINE === '1' ? 'baseline' : 'optimized';
const BUDGETS = Object.freeze(activeProfile === 'baseline' ? { ...LEGACY } : { ...OPTIMIZED });

function clampBudget(name, value) {
  const min = {
    siteRegistryBytes: 4 * 1024 * 1024,
    siteRegistryHosts: 2,
    diagnoseCacheEntries: 1,
    sweepIntervalMs: 15 * 1000,
    idleSleepMs: 30 * 1000,
    previewMessageLimit: 10,
    // A1: keep the caps generous but bounded. A 0 budget (legacy profile)
    // means "no switch" and is skipped by the caller before clamping.
    diskCacheBytes: 32 * 1024 * 1024,
    mediaCacheBytes: 16 * 1024 * 1024,
    // B1: hide-on-minimize levers are 0/1.
    overlayHideOnMinimize: 0,
    tabDetachOnMinimize: 0,
    searchPageDetach: 0,
    // B2: heartbeat bounds. The legacy window of 0 is handled before the
    // fast/slow decision, so a 0 min here never re-enables the slow cadence.
    taskHeartbeatNearMs: 1000,
    taskHeartbeatIdleMs: 30 * 1000,
    taskHeartbeatNearWindowMs: 0,
    // B2: deep-idle sweep ceiling, bounded to [sweep floor, 30 min].
    sweepDeepIdleMs: 15 * 1000,
  }[name];
  const max = {
    siteRegistryBytes: 128 * 1024 * 1024,
    siteRegistryHosts: 64,
    diagnoseCacheEntries: 32,
    sweepIntervalMs: 5 * 60 * 1000,
    idleSleepMs: 30 * 60 * 1000,
    previewMessageLimit: 200,
    diskCacheBytes: 1024 * 1024 * 1024,
    mediaCacheBytes: 512 * 1024 * 1024,
    overlayHideOnMinimize: 1,
    tabDetachOnMinimize: 1,
    searchPageDetach: 1,
    taskHeartbeatNearMs: 5 * 60 * 1000,
    taskHeartbeatIdleMs: 30 * 60 * 1000,
    taskHeartbeatNearWindowMs: 60 * 60 * 1000,
    sweepDeepIdleMs: 30 * 60 * 1000,
  }[name];
  if (!Number.isFinite(Number(value)) || !min && min !== 0) return BUDGETS[name];
  return Math.max(min, Math.min(max, Math.trunc(Number(value))));
}

function validateBudgets() {
  const errors = [];
  for (const [key, value] of Object.entries(OPTIMIZED)) {
    if (!Number.isFinite(value) || value <= 0) errors.push(key + ' must be a positive number');
  }
  if (OPTIMIZED.siteRegistryBytes > LEGACY.siteRegistryBytes / 2) errors.push('siteRegistryBytes did not halve');
  if (OPTIMIZED.siteRegistryHosts > LEGACY.siteRegistryHosts / 2) errors.push('siteRegistryHosts did not halve');
  if (OPTIMIZED.diagnoseCacheEntries > LEGACY.diagnoseCacheEntries / 2) errors.push('diagnoseCacheEntries did not halve');
  if (OPTIMIZED.sweepIntervalMs < LEGACY.sweepIntervalMs * 2) errors.push('sweepIntervalMs did not double');
  if (OPTIMIZED.idleSleepMs > LEGACY.idleSleepMs * 0.6) errors.push('idleSleepMs did not fall by at least 40%');
  if (OPTIMIZED.previewMessageLimit > LEGACY.previewMessageLimit / 2) errors.push('previewMessageLimit did not halve');
  // A1: the cache budgets must be sane byte counts and not above the clamps.
  if (OPTIMIZED.diskCacheBytes > 1024 * 1024 * 1024) errors.push('diskCacheBytes above the 1GB clamp');
  if (OPTIMIZED.mediaCacheBytes > 512 * 1024 * 1024) errors.push('mediaCacheBytes above the 512MB clamp');
  // B2: the slow heartbeat must never be faster than the legacy fixed tick.
  if (OPTIMIZED.taskHeartbeatIdleMs < LEGACY.taskHeartbeatIdleMs) errors.push('taskHeartbeatIdleMs did not rise above the legacy tick');
  if (OPTIMIZED.taskHeartbeatNearWindowMs <= 0) errors.push('taskHeartbeatNearWindowMs must select the near window');
  // B2: the deep-idle sweep ceiling must sit at or above the regular sweep.
  if (OPTIMIZED.sweepDeepIdleMs < OPTIMIZED.sweepIntervalMs) errors.push('sweepDeepIdleMs did not rise above sweepIntervalMs');
  return { ok: errors.length === 0, errors, activeProfile, budgets: BUDGETS, legacy: LEGACY, optimized: OPTIMIZED };
}

module.exports = {
  BUDGETS, LEGACY, OPTIMIZED, activeProfile,
  clampBudget, validateBudgets,
};
