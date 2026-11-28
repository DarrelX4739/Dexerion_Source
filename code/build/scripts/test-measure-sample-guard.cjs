'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { verifiedNativeTree, stableCpuByRole, fourArmOrder, rendererRoleMap, memoryByRole, workloadOrder, optionalSample, requireTree, hasGpuSample, foregroundSample, workloadUrls, matchesInventory } = require('./measure-sample-guard.cjs');

test('collected power does not add an extra delay', async () => {
  const sample = { medianMW: 3000 };
  assert.deepEqual(await optionalSample(() => sample, 5000, {
    wait: () => assert.fail('successful sample should not delay'),
  }), { sample, error: null });
});

test('failed or explicitly skipped counters retain the sampling window', async () => {
  let now = 10;
  const waits = [];
  const clock = { now: () => now, wait: async (ms) => { waits.push(ms); } };
  const failed = await optionalSample(() => {
    now += 1000;
    throw Error('Counter unavailable\nextra detail');
  }, 5000, clock);
  assert.deepEqual(failed, { sample: null, error: 'Counter unavailable' });
  const skipped = await optionalSample(() => assert.fail('skip did not work'), 5000, { ...clock, skip: true });
  assert.equal(skipped.sample, null);
  assert.deepEqual(waits, [4000, 5000]);
});

test('missing process trees cannot generate zero-valued samples', () => {
  assert.deepEqual(requireTree([{ pid: 123 }], 'A'), [{ pid: 123 }]);
  assert.throws(() => requireTree([], 'B'), /missing at snapshot B/);
});

test('no GPU intervals is missing, but a measured zero tree can remain valid', () => {
  assert.equal(hasGpuSample({ intervalCount: 0, perPid: [] }), false);
  assert.equal(hasGpuSample(null), false);
  assert.equal(hasGpuSample({ intervalCount: 2, perPid: [] }), true);
});

test('foreground samples require visibility and verify animation advances', () => {
  const state = (frames, visible = true) => ({ frames, visible });
  assert.deepEqual(foregroundSample(state(20), state(260), 4, true), { visible: true, fps: 60 });
  assert.deepEqual(foregroundSample(state(0), state(0), 4, false), { visible: true, fps: null });
  assert.throws(() => foregroundSample(state(0, false), state(180), 4, true), /not visible/);
  assert.throws(() => foregroundSample(state(0), state(4), 4, true), /below the 15-fps/);
  assert.throws(() => foregroundSample(state(undefined), state(30), 4, true), /counter missing/);
});

test('multitasking uses one distinct foreground URL and a matching inventory', () => {
  const urls = workloadUrls('http://127.0.0.1:1234', { foreground: 'animated', backgroundTabs: 8 });
  assert.equal(urls.length, 9);
  assert.ok(urls[0].endsWith('/animated?role=foreground'));
  assert.equal(urls.filter((u) => u.includes('role=foreground')).length, 1);
  assert.ok(matchesInventory([...urls].reverse(), urls));
  assert.equal(matchesInventory([urls[1], ...urls.slice(1)], urls), false);
  assert.equal(matchesInventory(urls.slice(1), urls), false);
});


test('memory roles sum counts and counters independently without converting missing values to zero', () => {
  const result = memoryByRole([
    { role: 'browser', wsBytes: 10, privateBytes: 5, privateWsBytes: 2 },
    { role: 'renderer', wsBytes: 40, privateBytes: 20, privateWsBytes: 15 },
    { role: 'renderer', wsBytes: 50, privateBytes: null, privateWsBytes: 30 },
    { role: 'gpu-process', wsBytes: 0, privateBytes: 0, privateWsBytes: 0 },
  ], (p) => p.role);
  assert.deepEqual(result, {
    byRole: {
      browser: { count: 1, wsBytes: 10, privateBytes: 5, privateWsBytes: 2 },
      renderer: { count: 2, wsBytes: 90, privateBytes: null, privateWsBytes: 45 },
      'gpu-process': { count: 1, wsBytes: 0, privateBytes: 0, privateWsBytes: 0 },
    },
    totals: { count: 4, wsBytes: 100, privateBytes: null, privateWsBytes: 47 },
  });
  const missingWorkingSet = memoryByRole([{ role: 'renderer', privateBytes: 42 }], (p) => p.role);
  assert.deepEqual(missingWorkingSet.totals, { count: 1, wsBytes: null, privateBytes: 42, privateWsBytes: null });
});

test('trial orders alternate from either starting browser without mutating the input', () => {
  const pair = ['edge', 'dexerion'];
  assert.deepEqual([1, 2, 3, 4, 5].map((i) => workloadOrder(pair, i, false)), [
    pair, ['dexerion', 'edge'], pair, ['dexerion', 'edge'], pair,
  ]);
  assert.deepEqual(workloadOrder(pair, 1, true), ['dexerion', 'edge']);
  assert.deepEqual(workloadOrder(pair, 2, true), pair);
  assert.deepEqual(workloadOrder(['edge'], 1, true), ['edge']);
  assert.deepEqual(pair, ['edge', 'dexerion']);
});


test('native renderer attribution does not count shared process memory twice', () => {
  const labels = rendererRoleMap([
    { pid: 10, kind: 'shell' }, { pid: 11, kind: 'foreground' },
    { pid: 12, kind: 'background' }, { pid: 12, kind: 'background' },
    { pid: 13, kind: 'background' }, { pid: 13, kind: 'foreground' },
    { pid: 0, kind: 'other' }, { pid: 14, kind: 'invalid' },
  ]);
  assert.deepEqual([...labels], [[10, 'renderer-shell'], [11, 'renderer-foreground'],
    [12, 'renderer-background'], [13, 'renderer-mixed']]);
});


test('each arm appears once in every position in the four-arm launch control', () => {
  const arms = ['edge', 'edge-automation', 'dexerion', 'dexerion-automation'];
  for (let anchor = 0; anchor < 4; anchor++) {
    const orders = [1, 2, 3, 4].map((trial) => fourArmOrder(arms, trial, anchor));
    for (let pos = 0; pos < 4; pos++) assert.deepEqual(new Set(orders.map((order) => order[pos])), new Set(arms));
    for (const order of orders) assert.deepEqual(new Set(order), new Set(arms));
  }
});


test('uses the foreground page clock rather than the different CPU snapshot boundaries', () => {
  const before = { visible: true, frames: 14, clockMs: 20, timeOrigin: 1000 };
  const after = { visible: true, frames: 134, clockMs: 2020, timeOrigin: 1000 };
  assert.deepEqual(foregroundSample(before, after, 1, true), { visible: true, fps: 60 });
  assert.throws(() => foregroundSample(before, { ...after, timeOrigin: 1001 }, 1, true), /navigation or clock/);
  assert.throws(() => foregroundSample(before, { ...after, clockMs: 10 }, 1, true), /navigation or clock/);
});

test('stable process CPU splits exact matching PIDs by role, not reused or missing processes', () => {
  const p = (pid, name, startedUtc, cpu100ns) => ({ pid, name, startedUtc, cpu100ns });
  const a = [p(1, 'browser', 't0', 10), p(2, 'renderer', 't0', 20),
    p(3, 'gpu', 't0', 30), p(5, 'renderer', 't0', 10), p(8, 'utility', null, 7)];
  const b = [p(1, 'browser', 't0', 40), p(2, 'renderer', 't0', 41),
    p(3, 'gpu', 'changed', 300), p(6, 'renderer', 'new', 100), p(8, 'utility', null, 25)];
  assert.deepEqual(stableCpuByRole(a, b, (row) => row.name), {
    measured: 2, skippedAtEnd: 3, missingAtEnd: 3, total100ns: 51,
    roles: { browser: { processes: 1, cpu100ns: 30 }, renderer: { processes: 1, cpu100ns: 21 } },
  });
});

test('native attribution rejects stale Windows PPIDs even under an otherwise valid launched root', () => {
  const p = (pid, ppid, time, active = false) => ({ pid, ppid,
    startedUtc: time == null ? null : '2026-01-01T00:00:' + time + 'Z', active });
  const data = [p(10, 2, '12.0000020', true), p(20, 10, '12.0000021'),
    p(21, 10, '12.0000010'), p(22, 21, '05.0000000'), p(23, 20, '13.0000000'),
    p(24, 23, null), p(25, 20, '12.0000011'), p(26, 23, '17.0000000'), p(99, 2, '11.0000000')];
  const g = verifiedNativeTree(data, 10, (proc) => proc.active);
  assert.deepEqual(g.rows.map((x) => x.pid), [10, 20, 23, 26]);
  assert.deepEqual([g.staleParentReferences, g.unknownParentReferences], [2, 1]);
  assert.throws(() => verifiedNativeTree(data, 99, (proc) => proc.active), /launch process/);
});
