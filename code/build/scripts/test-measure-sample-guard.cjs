'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { optionalSample, requireTree, hasGpuSample } = require('./measure-sample-guard.cjs');

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
