'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseStat, selectTree, readTree, cpuDelta, sumPss } = require('./cloud-proc-metrics.cjs');

function stat(pid, ppid, user, sys, started) {
  const cols = Array(22).fill('0');
  cols[0] = 'S'; cols[1] = ppid; cols[11] = user; cols[12] = sys; cols[19] = started;
  return pid + ' (app name (worker)) ' + cols.join(' ');
}

test('stat sample parses command names containing spaces and parentheses', () => {
  assert.deepEqual(parseStat(stat(12, 5, 80, 20, 100)), { pid: 12, ppid: 5, ticks: 100, started: 100 });
  assert.equal(parseStat('unreadable'), null);
});

test('only root and descendants count, and missing metrics cannot count as zero', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexerion-proc-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [pid, ppid, pss] of [[10, 1, 1024], [30, 20, 2048], [20, 10, 4096], [99, 1, 3000]]) {
    fs.mkdirSync(path.join(dir, String(pid)));
    fs.writeFileSync(path.join(dir, String(pid), 'stat'), stat(pid, ppid, 4, 3, 100));
    fs.writeFileSync(path.join(dir, String(pid), 'smaps_rollup'), 'Rss: 5000 kB\nPss: ' + pss + ' kB\nPss_Dirty: 3 kB\n');
  }
  const tree = readTree(10, dir);
  assert.deepEqual([...tree.keys()], [10, 20, 30]);
  assert.equal(sumPss(tree, dir), 7);
  assert.throws(() => readTree(100, dir), /root missing/i);
  fs.unlinkSync(path.join(dir, '30', 'smaps_rollup'));
  assert.equal(sumPss(tree, dir), null);
});

test('normalises CPU to one core and withholds samples with process churn or PID reuse', () => {
  const tree = (...rows) => selectTree(rows.map((r) => parseStat(stat(...r))), 10);
  const a = tree([10, 1, 20, 0, 100], [30, 10, 5, 0, 101]);
  const b = tree([10, 1, 70, 0, 100], [30, 10, 55, 0, 101]);
  assert.deepEqual(cpuDelta(a, b, 100, 2), { started: 0, exited: 0, pctOfOneCore: 50 });
  const c = tree([10, 1, 70, 0, 100], [30, 10, 2, 0, 301]);
  assert.deepEqual(cpuDelta(a, c, 100, 2), { started: 1, exited: 1, pctOfOneCore: null });
  assert.throws(() => cpuDelta(b, a, 100, 2), /backwards/);
});
