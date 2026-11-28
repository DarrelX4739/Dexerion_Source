'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { aggregateGpu } = require('./measure-gpu-aggregate.cjs');
const sample = (ms, engines) => ({ trialTimestamp: new Date(ms).toISOString(), engines });
const row = (pid, engine, utilPoints) => ({ pid, engine, utilPoints });

test('uses common intervals and observes simultaneous, not individual, peaks', () => {
  const aggregate = aggregateGpu([
    sample(100, [row(7, 'graphics', 33), row(90, 'graphics', 40)]),
    sample(200, [row(8, 'graphics', 12), row(8, 'copy', 8)]),
    sample(300, []),
    sample(400, [row(8, 'graphics', 100)]), // outside the window
  ], new Set([7, 8]), 100, 300);
  assert.deepEqual(aggregate, {
    intervalCount: 3, treeUtilPointsMean: 17.667, treeUtilPointsPeak: 33, treeBusiestEnginePctMean: 15,
    perPid: [
      { pid: 7, utilPointsMean: 11, utilPointsPeak: 33 },
      { pid: 8, utilPointsMean: 6.667, utilPointsPeak: 20 },
    ],
  });
});

test('sums contributions sharing an engine, ignores bad rows, and does not invent samples', () => {
  const x = aggregateGpu([sample(100, [row(7, 'a', 33), row(8, 'a', 20), row(8, 'b', 25), row(8, 'b', -1)])], new Set([7, 8]), 0, 100);
  assert.equal(x.treeBusiestEnginePctMean, 53);
  assert.equal(x.treeUtilPointsMean, 78);
  assert.equal(aggregateGpu([sample(100, [])], new Set([7]), 0, 100).treeUtilPointsMean, 0);
  assert.equal(aggregateGpu([{ trialTimestamp: 'bad', engines: [] }], new Set([7]), 0, 100), null);
  assert.equal(aggregateGpu([sample(100, [])], new Set([]), 0, 100), null);
});
