'use strict';
const { test } = require('node:test');
const { deepEqual, throws } = require('node:assert/strict');
const { summarize } = require('./profile-summary.cjs');

function fixture() {
  const f = (id, functionName, url = '') => ({ id, callFrame: { functionName, url, lineNumber: 1 } });
  return {
    startTime: 100, endTime: 5100,
    nodes: [f(1, '(idle)'), f(2, 'sweep', 'file:///D:/a/code/code/browser.js'),
      f(3, '(garbage collector)'), f(4, 'callback', '/a/code/code/node_modules/m.js')],
    samples: [1, 2, 2, 3, 4],
    timeDeltas: [1000, 1000, 1000, 1000, 1000],
  };
}
test('keeps exclusive application, idle, GC, and non-product time separate and removes machine paths', () => {
  const s = summarize(fixture());
  deepEqual(s.bucketMs, { idle: 1, gc: 1, product: 2, other: 1 });
  deepEqual(s.productExclusiveTop, [{ location: 'browser.js:2 sweep', sampleMs: 2 }]);
});
test('rejects partial and invalid timing evidence', () => {
  const p = fixture();
  throws(() => summarize({ ...p, samples: [] }), /lacks/);
  throws(() => summarize({ ...p, endTime: 100000 }), /clock/);
  throws(() => summarize({ ...p, timeDeltas: [-1, 1000, 1000, 1000, 1000] }), /Invalid/);
  throws(() => summarize({ ...p, samples: [5, 2, 2, 3, 4] }), /Invalid/);
});
