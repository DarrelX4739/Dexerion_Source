'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { grade, SCENARIOS } = require('./grade-edge-target.cjs');
const { packageInstance, requirePackageSample } = require('./power-meter.cjs');
const instance = packageInstance();
const meter = (medianMW) => ({ medianMW, instance, counter: '\\Energy Meter(' + instance + ')\\Power', unit: 'mW', sampleCount: 9 });

function evidence(dex = 80, edge = 100) {
  const group = (v) => ({ trials: Array.from({ length: 3 }, () => ({
    valid: true, cpu: { cpuCorePct: v }, ram: { wsMBB: v },
    gpu: { treeUtilPointsMean: v },
    floorMedianMW: 2000, floor: meter(2000), power: { ...meter(2000 + v), p10MW: 2040, p90MW: 2110 },
  })) });
  return { config: { powerInstance: instance }, scenarios: Object.fromEntries(SCENARIOS.map((s) => [s, { dexerion: group(dex), edge: group(edge) }])) };
}

test('grades all 16 cells at the unrounded 20% and 40% thresholds', () => {
  const report = grade(evidence());
  assert.equal(report.rows.length, 16);
  assert.equal(report.minimumMet, true);
  assert.equal(report.stretchMet, false);
  assert.equal(grade(evidence(60)).stretchMet, true);
  assert.equal(grade(evidence(80.001)).minimumMet, false);
});

test('missing scenarios, missing counters, and invalid trials cannot pass', () => {
  const input = evidence(60);
  delete input.scenarios.multitasking;
  const idle = input.scenarios.idle.dexerion.trials;
  delete idle[0].cpu;
  idle[1].valid = false;
  const report = grade(input);
  assert.equal(report.minimumMet, false);
  assert.equal(report.rows.filter((r) => r.verdict === 'UNVERIFIED').length, 8);
});

test('a measured zero Dexerion GPU value can pass, but zero Edge cannot', () => {
  const input = evidence(60);
  const pair = input.scenarios.idle;
  for (const t of pair.dexerion.trials) t.gpu.treeUtilPointsMean = 0;
  assert.equal(grade(input).stretchMet, true);
  for (const t of pair.edge.trials) t.gpu.treeUtilPointsMean = 0;
  assert.match(grade(input).rows.find((r) => r.scenario === 'idle' && r.axis === 'gpu').reason, /zero/);
  assert.equal(grade(input).minimumMet, false);
});

test('noise-limited and negative net power are not treated as wins', () => {
  const input = evidence(60);
  const tr = input.scenarios.idle.dexerion.trials;
  tr[0].power.p90MW = 2400;
  tr[1].power.medianMW = 1999;
  const row = grade(input).rows.find((r) => r.scenario === 'idle' && r.axis === 'power');
  assert.equal(row.dexSamples, 1);
  assert.equal(row.ratio, null);
});


test('power is unverified for absent, mismatched, unsupported or too-short meter samples', () => {
  for (const mutate of [
    (q) => { delete q.config.powerInstance; },
    (q,t) => { delete t.floor; },
    (q,t) => { t.power.instance = 'rapl_package1_pkg'; },
    (q,t) => { t.power.counter = '\\Energy Meter(rapl_dram)\\Power'; },
    (q,t) => { t.power.unit = 'W'; },
    (q,t) => { t.power.sampleCount = 2; },
    (q,t) => { t.floorMedianMW = 2100; },
  ]) {
    const q = evidence();
    mutate(q, q.scenarios.idle.dexerion.trials[0]);
    const rows = grade(q).rows.filter((r) => r.scenario === 'idle');
    assert.equal(rows.find((r) => r.axis === 'power').verdict, 'UNVERIFIED');
    assert.equal(rows.find((r) => r.axis === 'cpu').verdict, '20% TARGET');
  }
  assert.throws(() => packageInstance('rapl_dram'), /CPU package/);
  assert.throws(() => requirePackageSample(meter(100), 'rapl_package1_pkg'), /inconsistent/);
  assert.deepEqual(requirePackageSample(meter(100), instance), meter(100));
});
