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
  let duration = seconds;
  if (before.clockMs !== undefined || after.clockMs !== undefined) {
    if (!(Number.isFinite(before.clockMs) && Number.isFinite(after.clockMs) &&
        Number.isFinite(before.timeOrigin) && before.timeOrigin === after.timeOrigin &&
        after.clockMs > before.clockMs)) {
      throw new Error('Foreground navigation or clock changed during the sample');
    }
    duration = (after.clockMs - before.clockMs) / 1000;
  }
  const fps = (after.frames - before.frames) / duration;
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
  const totals = { count: 0, wsBytes: 0, privateBytes: 0, privateWsBytes: 0 };
  const add = (row, field, value) => {
    // Missing counters are not zeros. If any process lacks a measurement,
    // keep the affected total unavailable rather than under-reporting it.
    row[field] = row[field] !== null && Number.isFinite(value) && value >= 0
      ? row[field] + value : null;
  };
  for (const process of tree) {
    const role = roleOf(process);
    if (!byRole.has(role)) byRole.set(role, { count: 0, wsBytes: 0, privateBytes: 0, privateWsBytes: 0 });
    for (const row of [byRole.get(role), totals]) {
      row.count++;
      add(row, 'wsBytes', process.wsBytes);
      add(row, 'privateBytes', process.privateBytes);
      add(row, 'privateWsBytes', process.privateWsBytes);
    }
  }
  return { byRole: Object.fromEntries(byRole), totals };
}

function workloadOrder(browsers, trial, reverseFirst) {
  return Boolean(reverseFirst) !== (trial % 2 === 0)
    ? [...browsers].reverse() : [...browsers];
}

// In a four-arm direct-launch vs automation control, pair on one host while
// cycling every arm through each position rather than favouring one launch.
function fourArmOrder(browsers, trial, anchor) {
  const offsets = [0, 1, 3, 2];
  return offsets.map((n) => browsers[(n + trial - 1 + anchor) % 4]);
}
function rendererRoleMap(observations) {
  const labels = new Map();
  for (const { pid, kind } of observations) {
    if (!Number.isInteger(pid) || pid <= 0 || !['shell', 'foreground', 'background', 'other'].includes(kind)) continue;
    const label = 'renderer-' + kind;
    const old = labels.get(pid);
    labels.set(pid, !old || old === label ? label : 'renderer-mixed');
  }
  return labels;
}

// Conservative subset of CPU, not a replacement for whole-tree accounting:
// only the same process in both snapshots with a monotonic CPU counter.
function stableCpuByRole(treeA, treeB, classify) {
  const a = new Map(treeA.map((p) => [p.pid, p]));
  const used = new Map();
  let measured = 0;
  let total100ns = 0;
  for (const p of treeB) {
    const previous = a.get(p.pid);
    if (!previous || typeof p.startedUtc !== 'string' || !p.startedUtc ||
        p.startedUtc !== previous.startedUtc || !Number.isFinite(previous.cpu100ns) ||
        !Number.isFinite(p.cpu100ns) || p.cpu100ns < previous.cpu100ns) continue;
    const delta = p.cpu100ns - previous.cpu100ns;
    const role = classify(p);
    const b = used.get(role) || { processes: 0, cpu100ns: 0 };
    b.processes++;
    b.cpu100ns += delta;
    used.set(role, b);
    total100ns += delta;
    measured++;
  }
  return { measured, skippedAtEnd: treeB.length - measured,
    missingAtEnd: treeA.length - measured, total100ns, roles: Object.fromEntries(used) };
}

module.exports = { stableCpuByRole, fourArmOrder, rendererRoleMap, memoryByRole, workloadOrder, optionalSample, requireTree, hasGpuSample, foregroundSample, workloadUrls, matchesInventory };
