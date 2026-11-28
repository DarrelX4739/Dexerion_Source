'use strict';

async function optionalSample(sample, durationMs, { skip = false, now = Date.now, wait } = {}) {
  const start = now();
  let error = 'not collected on this runner';
  if (!skip) {
    try { return { sample: await sample(), error: null }; }
    catch (err) { error = String(err && err.message || err).split('\n')[0]; }
  }
  const remaining = durationMs - (now() - start);
  if (remaining > 0) await wait(remaining);
  return { sample: null, error };
}

function requireTree(tree, label) {
  if (!Array.isArray(tree) || !tree.length) throw new Error('Browser process tree missing at snapshot ' + label);
  return tree;
}

function hasGpuSample(gpu) {
  return Boolean(gpu && !gpu.error && gpu.intervalCount > 0 && Array.isArray(gpu.perPid));
}

function foregroundSample(before, after, seconds, animated) {
  if (!(before?.visible && after?.visible)) throw new Error('Foreground page was not visible across the sample');
  if (!animated) return { visible: true, fps: null };
  if (!(Number.isFinite(before.frames) && Number.isFinite(after.frames) && seconds > 0)) {
    throw new Error('Foreground frame counter missing');
  }
  const fps = (after.frames - before.frames) / seconds;
  if (!(fps >= 15)) throw new Error('Foreground animation below the 15-fps validation floor');
  return { visible: true, fps };
}

function workloadUrls(base, definition) {
  return [
    base + '/' + definition.foreground + '?role=foreground',
    ...Array.from({ length: definition.backgroundTabs }, (_, i) => base + '/animated?role=background&tab=' + (i + 1)),
  ];
}
function matchesInventory(tabs, expected) {
  return Array.isArray(tabs) && tabs.length === expected.length &&
    new Set(tabs).size === expected.length && expected.every((url) => tabs.includes(url));
}

function memoryByRole(tree, roleOf) {
  const byRole = new Map();
  const totals = { count: 0, wsBytes: 0, privateBytes: 0 };
  const add = (row, field, value) => {
    // Missing counters are not zeros. If any process lacks a measurement,
    // keep the affected total unavailable rather than under-reporting it.
    row[field] = row[field] !== null && Number.isFinite(value) && value >= 0
      ? row[field] + value : null;
  };
  for (const process of tree) {
    const role = roleOf(process);
    if (!byRole.has(role)) byRole.set(role, { count: 0, wsBytes: 0, privateBytes: 0 });
    for (const row of [byRole.get(role), totals]) {
      row.count++;
      add(row, 'wsBytes', process.wsBytes);
      add(row, 'privateBytes', process.privateBytes);
    }
  }
  return { byRole: Object.fromEntries(byRole), totals };
}

function workloadOrder(browsers, trial, reverseFirst) {
  return Boolean(reverseFirst) !== (trial % 2 === 0)
    ? [...browsers].reverse() : [...browsers];
}

module.exports = { memoryByRole, workloadOrder, optionalSample, requireTree, hasGpuSample, foregroundSample, workloadUrls, matchesInventory };
