'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { planSweep, clampCapMB, shouldNoticeHog } = require('../../code/src/main/memsaver.js');

const file = path.resolve(__dirname, '../../code/src/main/browser.js');
const source = fs.readFileSync(file, 'utf8');
const start = source.indexOf('  function collectTabSnaps(');
const end = source.indexOf('  // Adaptive power scheduler', start);
assert.ok(start > 0 && end > start);

function setup({ total = 1500, count = 100, enabled = true, notice = null } = {}) {
  const calls = { snapshots: 0, pid: 0, audible: 0, slept: [], layouts: [], pushes: [] };
  const tabs = new Map(Array.from({ length: count }, (_, i) => [
    i + 1, { id: i + 1, url: 'https://example.test/' + i, lastActive: 100,
      view: { webContents: {
        isDestroyed: () => false,
        getOSProcessId() { calls.pid++; return i + 11; },
        isCurrentlyAudible() { calls.audible++; return i === 1; },
      } } },
  ]));
  const st = { id: 1, tabs, active: 1, memNotice: notice };
  const S = { settings: { memorySaver: enabled, memoryCapMB: 2048 } };
  const snap = { workingSetMB: total, pidMB: new Map([[11, 800], [12, 500], [13, 400]]) };
  const sweep = vm.runInNewContext(source.slice(start, end) + '\nmemorySweep;', {
    windows: new Map([[1, st]]), S, planSweep, clampCapMB, shouldNoticeHog,
    Date: { now: () => 70000 },
    memSnapshot() { calls.snapshots++; return snap; },
    focusedState: () => st,
    sleepTabNow: (_, tab) => { calls.slept.push(tab.id); tab.sleeping = true; },
    layout: (id) => calls.layouts.push(id),
    pushState: (id) => calls.pushes.push(id),
  });
  return { run: (...args) => JSON.parse(JSON.stringify(sweep(...args))), calls, st, snap };
}

test('at or below memory cap uses no per-tab native metrics and clears stale notice', () => {
  const f = setup({ notice: { tabId: 1 } });
  assert.deepEqual(f.run(), { totalMB: 1500, capMB: 2048, slept: 0, projectedMB: 1500 });
  assert.deepEqual(f.run(2048), { totalMB: 2048, capMB: 2048, slept: 0, projectedMB: 2048 });
  assert.deepEqual(f.calls, { snapshots: 2, pid: 0, audible: 0, slept: [], layouts: [], pushes: [1] });
  assert.equal(f.st.memNotice, null);
});

test('forced over-cap sample still sleeps an eligible background tab, not active or audible tabs', () => {
  const f = setup({ count: 3, notice: { tabId: 1 } });
  assert.deepEqual(f.run(2300), { totalMB: 2300, capMB: 2048, slept: 1, projectedMB: 1900 });
  assert.deepEqual(f.calls, { snapshots: 1, pid: 3, audible: 3, slept: [3], layouts: [1], pushes: [1, 1] });
  assert.equal(f.st.memNotice, null);
});

test('when exhaustion leaves a large active tab, the original memory warning is still published', () => {
  const f = setup({ total: 2600, count: 2 });
  assert.deepEqual(f.run(), { totalMB: 2600, capMB: 2048, slept: 0, projectedMB: 2600 });
  assert.deepEqual(JSON.parse(JSON.stringify(f.st.memNotice)),
    { tabId: 1, mb: 800, total: 2600, capMB: 2048, at: 70000 });
  assert.deepEqual(f.calls, { snapshots: 1, pid: 3, audible: 2, slept: [], layouts: [], pushes: [1] });
});

test('disabled saver still clears notices without any metrics', () => {
  const f = setup({ total: 2600, count: 2, enabled: false, notice: { tabId: 1 } });
  assert.deepEqual(f.run(), { skipped: 'off' });
  assert.equal(f.st.memNotice, null);
  assert.deepEqual(f.calls, { snapshots: 0, pid: 0, audible: 0, slept: [], layouts: [], pushes: [1] });
});
