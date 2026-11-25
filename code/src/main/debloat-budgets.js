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
  }[name];
  const max = {
    siteRegistryBytes: 128 * 1024 * 1024,
    siteRegistryHosts: 64,
    diagnoseCacheEntries: 32,
    sweepIntervalMs: 5 * 60 * 1000,
    idleSleepMs: 30 * 60 * 1000,
    previewMessageLimit: 200,
  }[name];
  if (!Number.isFinite(Number(value)) || !min) return BUDGETS[name];
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
  return { ok: errors.length === 0, errors, activeProfile, budgets: BUDGETS, legacy: LEGACY, optimized: OPTIMIZED };
}

module.exports = {
  BUDGETS, LEGACY, OPTIMIZED, activeProfile,
  clampBudget, validateBudgets,
};
