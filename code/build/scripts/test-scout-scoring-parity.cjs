'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { performance } = require('node:perf_hooks');

const file = path.join(__dirname, '../../code/src/main/ai-model-scout.js');
const current = fs.readFileSync(file, 'utf8');
const load = (code, extra = '') => {
  const mod = { exports: {} };
  new Function('module', code + '\n' + extra)(mod);
  return mod.exports;
};
const scout = load(current, 'module.exports.rankTable = typeof percentileByValue === "function" ? percentileByValue : null;');
const PIN_LOW = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning';
const PIN_HIGH = 'nvidia/nemotron-3.5-super-vl-120b-a12b';

function catalogue(n, {
  anchored = false, family = false, pinned = false, seed = 17, hardFloor = false, edgeCosts = true,
} = {}) {
  let state = seed >>> 0;
  const r = max => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) % max;
  const candidates = [], rows = [];
  for (let i = 0; i < n; i++) {
    const id = (family && i % 5 === 0 ? 'nvidia/nemotron-' : 'provider/model-') + i;
    candidates.push({ id, vision: !r(3), tools: r(9) !== 0, context: r(7) ? 128000 : 4000,
      fast: r(4) > 1, reasoning: r(3) > 1 });
    // Include ties, partial measurements, signed zero, and finite values
    // whose extrema/difference exceed ordinary provider measurements.
    const cost = r(55) / 10;
    const costs = [cost, -0, 0, null, 'missing', edgeCosts ? Number.MAX_VALUE : cost, edgeCosts ? -Number.MAX_VALUE : cost];
    rows.push({ id, intelligence: i % 9 ? r(27) * 2 : 'missing', speed: r(33) * 4,
      costPerTask: costs[r(costs.length)], lmarena: r(8), livebench: r(6) });
  }
  if (pinned) {
    for (const id of [PIN_LOW, PIN_HIGH]) {
      candidates.push({ id, vision: true, tools: true, context: 256000, fast: true, reasoning: true });
      rows.push({ id, intelligence: 64, speed: 92, costPerTask: 0.1 });
    }
  }
  return {
    candidates,
    snapshot: { models: rows, source: { primary: { name: 'Local control', capturedAt: '2026-05-05' } },
      anchor: { speed: hardFloor ? 10000 : anchored ? 101 : undefined } },
  };
}
function rankOld(values, value) {
  if (!values.length) return 0.5;
  const below = values.filter(v => v < value).length;
  const equal = values.filter(v => v === value).length;
  return (below + Math.max(0, equal - 1) / 2) / Math.max(1, values.length - 1);
}

if (process.argv.includes('--bench')) {
  const original = load(fs.readFileSync(process.argv.at(-1), 'utf8'));
  // Every returned field (including strict comparison ordering and rationale)
  // is equal to the exact prior source across generated inputs.
  for (let seed = 1; seed <= 80; seed++) {
    const f = catalogue(seed % 70, {
      seed, anchored: seed % 2 === 0, family: seed % 3 !== 0, pinned: seed % 5 === 0, hardFloor: seed % 7 === 0,
    });
    assert.deepEqual(scout.pickAll(f.candidates, f.snapshot), original.pickAll(f.candidates, f.snapshot));
    f.candidates.reverse(); // a different tie ordering must remain stable
    assert.deepEqual(scout.pickAll(f.candidates, f.snapshot), original.pickAll(f.candidates, f.snapshot));
  }
  for (const [name, n, options, repetitions] of [
    ['pinned catalogue', 180, { pinned: true, family: true }, 75],
    ['fallback catalogue', 180, {}, 75],
    ['large fallback catalogue', 1000, {}, 15],
    ['anchor and exhausted floors', 300, { hardFloor: true }, 35],
  ]) {
    const f = catalogue(n, { edgeCosts: false, ...options });
    assert.deepEqual(scout.pickAll(f.candidates, f.snapshot), original.pickAll(f.candidates, f.snapshot));
    function time(mod) {
      let result;
      for (let warm = 0; warm < 4; warm++) mod.pickAll(f.candidates, f.snapshot);
      const start = performance.now();
      for (let i = 0; i < repetitions; i++) result = mod.pickAll(f.candidates, f.snapshot);
      assert.ok(result);
      return (performance.now() - start) / repetitions;
    }
    const old = [], next = [];
    for (let i = 0; i < 9; i++) {
      if (i % 2) next.push(time(scout));
      old.push(time(original));
      if (!(i % 2)) next.push(time(scout));
    }
    const med = values => values.sort((a,b) => a-b)[4];
    console.log(JSON.stringify({ name, n, oldMs: med(old), newMs: med(next), fullParity: true }));
  }
} else {
  test('numeric lookup produces the same old percentile for every duplicate and signed-zero edge', () => {
    assert.equal(typeof scout.rankTable, 'function');
    for (const values of [[0], [-0], [7, 7, 7], [1, 5, 3, 3, 7], [-0, 0, 0, 3, -27, Number.MAX_VALUE]]) {
      const result = scout.rankTable(values.slice());
      assert.equal(result.size, new Set(values).size);
      for (const value of values) assert.equal(result.get(value), rankOld(values, value));
    }
    for (let i = 0; i < 50; i++) {
      const values = Array.from({ length: i + 1 }, (_, k) => (3 * k + i) % 17 - 4);
      const result = scout.rankTable(values.slice());
      for (const value of values) assert.equal(result.get(value), rankOld(values, value));
    }
  });

  test('a cold fallback catalog with tied scores preserves input ordering and evidence', () => {
    const c1 = { id: 'provider/a', context: 128000, vision: true, tools: true };
    const c2 = { ...c1, id: 'provider/b' };
    const snapshot = { anchor: { speed: 10000 }, models: [
      { id: 'provider/a', intelligence: 50, speed: 30, costPerTask: 0, lmarena: 1 },
      { id: 'provider/b', intelligence: 50, speed: 30, costPerTask: -0, lmarena: 1 },
    ] };
    const input = [c1, c2];
    const originalBefore = structuredClone({ input, snapshot });
    const result = scout.pickAll(input, snapshot);
    assert.deepEqual({ input, snapshot }, originalBefore);
    for (const pick of Object.values(result)) {
      assert.equal(pick.model, c1.id);
      assert.equal(pick.evidence.floorTokens, 0);
      assert.equal(pick.evidence.lineup, 'open');
      assert.equal(pick.evidence.costPerTask, 0);
    }
    assert.equal(result.low.evidence.relaxations.at(-1), 'exhausted');
    assert.deepEqual(result.max.evidence.relaxations, []);
    for (const pick of Object.values(scout.pickAll([c2, c1], snapshot))) assert.equal(pick.model, c2.id);
  });

  test('pins, aliases, family fallback and the speed anchor still win without changing rescan status', () => {
    const f = catalogue(16, { pinned: true, family: true, anchored: true });
    const selected = scout.pickAll(f.candidates, f.snapshot);
    assert.equal(selected.low.model, PIN_LOW);
    assert.equal(selected.medium.model, PIN_LOW);
    assert.equal(selected.high.model, PIN_HIGH);
    assert.equal(selected.max.model, PIN_HIGH);
    assert.ok(Object.values(selected).every(pick => pick.evidence.pinned));
    const anchor = { id: scout.LOW_ANCHOR_ID, context: 256000, tools: true, vision: true };
    const other = { ...anchor, id: 'provider/fallback' };
    assert.equal(scout.pickAll([other, anchor], {}).low.model, anchor.id);
    assert.deepEqual(scout.shouldRescan({ reason: 'restart', policy: scout.LINEUP.policy, storedPolicy: scout.LINEUP.policy }),
      { rescan: false, why: 'stable' });
  });
}
