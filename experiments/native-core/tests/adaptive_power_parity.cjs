// Runs the shipped JS and the C++ candidate against identical normalized signals.
'use strict';
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const [binary, ...args] = process.argv.slice(2);
if (!binary) throw new Error('Usage: node adaptive_power_parity.cjs <native replay> [js module] [--bench]');
const js = require(path.resolve(args.find(x => x !== '--bench') ||
  path.resolve(__dirname, '../../../code/code/src/main/adaptive-power.js')));
const now = 10_000_000;
const defaultSignals = { focused: true, minimized: false, locked: false, onBattery: false,
  idleMs: 0, freeMemMB: 0, cpuPct: 0, activeTabCount: 1, video: false,
  webgl: false, animation: false, loading: false, audible: false, interacting: false };
const tiers = js.TIERS;
const defaults = { previous: '-', since: null, mode: 'adaptive', override: '-', sweep: 60_000,
  sleep: 180_000, deep: 0 };
const flagNames = ['focused', 'minimized', 'locked', 'onBattery', 'video', 'webgl', 'animation',
  'loading', 'audible', 'interacting'];
const cases = [];
function fixture(label, signals = {}, options = {}, contract = {}) {
  const s = { ...defaultSignals, ...signals }, o = { ...defaults, ...options };
  const state = o.since === null ? {} : { tierSince: o.since };
  const b = { sweepIntervalMs: o.sweep, idleSleepMs: o.sleep, sweepDeepIdleMs: o.deep };
  const p = js.runtimePlan(s, o.previous, now, state, b);
  for (const [k, v] of Object.entries(contract)) assert.equal(p[k], v, label + ': JS contract ' + k);
  const migration = js.migrateGpuMode(o.mode);
  const boot = js.startupGpuPlan({ mode: o.mode, override: o.override, onBattery: s.onBattery, freeMemMB: s.freeMemMB });
  assert.equal(migration.value, boot.mode); assert.equal(boot.mode, js.normalizeGpuMode(o.mode));
  assert.equal(p.gpuTier, js.decideGpuTier(s, o.previous, now, state));
  const expected = [boot.mode, +migration.changed, +boot.disableGpu, +boot.gpuRasterization,
    +boot.zeroCopy, +boot.forceLowPowerGpu, boot.gpuMemoryMB, boot.tier, boot.override ?? '-',
    js.demandScore(s), js.desiredTier(s), p.gpuTier, p.sweepIntervalMs, +p.deepIdleSweep,
    p.idleSleepMs, +p.hideInactiveViews, +p.hideMinimizedViews,
    +p.backgroundThrottling, +p.sampleMetrics].join(' ');
  const flags = flagNames.reduce((m, k, i) => m | (+s[k] << i), 0);
  const line = [flags, s.idleMs, s.freeMemMB, s.cpuPct, s.activeTabCount, now, +(o.since !== null),
    o.since ?? 0, o.previous, o.mode, o.override, o.sweep, o.sleep, o.deep].join(' ');
  cases.push({ label, s, previous: o.previous, state, b, expected, line });
}
fixture('idle default', {}, {}, { gpuTier: 'minimal', sweepIntervalMs: 60000, sampleMetrics: true });
fixture('finite budget with overflow when scaled', { locked: true },
  { sweep: Number.MAX_VALUE }, { sweepIntervalMs: 15000 });
fixture('representable budget just below half', {}, { sleep: 0.49999999999999994 }, { idleSleepMs: 0 });
fixture('immediate upgrade', { webgl: true }, { previous: 'minimal', since: now }, { gpuTier: 'accelerated' });
for (const name of ['locked', 'minimized']) fixture('suspend ' + name, { [name]: true, webgl: true },
  { previous: 'accelerated', since: now }, { gpuTier: 'suspended', sampleMetrics: false });
for (const idleMs of [599999, 600000, 600001]) fixture('suspend threshold', { idleMs }, {},
  { gpuTier: idleMs < 600000 ? 'minimal' : 'suspended' });
for (const n of ['video', 'webgl', 'audible']) fixture('playback exception ' + n, { idleMs: 600000, [n]: true },
  {}, { gpuTier: n === 'audible' ? 'minimal' : 'accelerated' });
for (const age of [-1, 0, 14999, 15000, 15001]) fixture('hysteresis age ' + age, {},
  { previous: 'accelerated', since: now - age }, { gpuTier: age < 15000 ? 'accelerated' : 'minimal' });
for (const freeMemMB of [0, 1, 1023.5, 1024, 2047.5, 2048]) fixture('RAM threshold', { freeMemMB, video: true });
for (const cpuPct of [0, 74.99, 75, 99]) fixture('CPU threshold', { cpuPct, video: true });
for (const x of [{ video: true }, { webgl: true }, { audible: true }, { loading: true },
  { interacting: true }, { focused: true }]) fixture('deep idle protection', { minimized: true, focused: false, ...x },
  { deep: 600000 }, { deepIdleSweep: false, sweepIntervalMs: 180000 });
for (const deep of [300000, 300000.49, 300000.5, 900000]) fixture('deep idle ceiling', { locked: true, focused: false },
  { deep }, { deepIdleSweep: true, sweepIntervalMs: Math.round(deep) > 300000 ? Math.round(deep) : 180000 });
for (const [i, mode] of ['adaptive', 'off', 'cap10', 'balanced', 'full', 'unknown'].entries()) {
  fixture('startup and migration ' + i, { onBattery: i % 2 === 1 }, { mode, override: i === 0 ? 'off' : '-' });
}
let seed = 0xa4d4f710;
function random(n) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % n; }
const pick = a => a[random(a.length)];
// Cover every Boolean signal combination, then add pressure/cadence boundary and random cases.
for (let i = 0; i < 5120; ++i) {
  const mask = i < 1024 ? i : random(1024);
  const signals = Object.fromEntries(flagNames.map((k, bit) => [k, Boolean(mask & (1 << bit))]));
  fixture('signal case ' + i, { ...signals, idleMs: pick([0, 119999, 120000, 599999, 600000, random(1200000)]),
    freeMemMB: pick([0, 1, 1023.5, 1024, 2047.5, 2048, random(16384)]),
    cpuPct: pick([0, 74.99, 75, 100, random(800) / 8]), activeTabCount: random(5),
  }, { previous: pick(['-', ...tiers]), since: pick([null, now + 1, now, now - 14999, now - 15000, now - random(60000)]),
    mode: pick(['adaptive', 'off', 'balanced', 'full', 'cap10', 'unknown']), override: pick(['-', 'off', 'unknown']),
    sweep: pick([0, 1, 14999.5, 15000, 60000, 100000.25, 300000, random(450000)]),
    sleep: pick([0, 30000, 60000, 90000.5, 180000, random(300000)]),
    deep: pick([0, 300000, 300000.5, 600000, random(900000)]) });
}
function invoke(mode, passes) {
  const out = spawnSync(path.resolve(binary), [], { encoding: 'utf8', timeout: 60000,
    input: [`${mode} ${cases.length} ${passes}`, ...cases.map(c => c.line)].join('\n') + '\n',
    maxBuffer: 4 * 1024 * 1024 });
  if (out.error) throw out.error;
  assert.equal(out.status, 0, out.stderr);
  return out.stdout.trimEnd().split(/\r?\n/);
}
const output = invoke('replay', 1);
assert.equal(output.length, cases.length);
for (const [i, c] of cases.entries()) assert.equal(output[i], c.expected, c.label);
console.log(`PASS Adaptive Power: ${cases.length} native/JS signal sets, including all 1,024 Boolean combinations (seed 0xa4d4f710)`);

if (args.includes('--bench')) {
  const passes = 32, rounds = 7;
  function jsPass() {
    let n = 0;
    for (const { s, previous, state, b } of cases) {
      const p = js.runtimePlan(s, previous, now, state, b);
      n = (n + p.sweepIntervalMs + p.idleSleepMs + tiers.indexOf(p.gpuTier) +
        +p.deepIdleSweep + +p.sampleMetrics) >>> 0;
    }
    return n;
  }
  const warm = jsPass();
  const expected = Math.imul(warm, passes) >>> 0;
  const jsTimes = [], cppTimes = [];
  function timeJS() {
    let sum = 0; const t = performance.now();
    for (let p = 0; p < passes; ++p) sum = (sum + jsPass()) >>> 0;
    jsTimes.push(performance.now() - t); assert.equal(sum, expected);
  }
  function timeCpp() {
    const [w, sum, ms] = invoke('bench', passes)[0].split(' ').map(Number);
    assert.equal(w, warm); assert.equal(sum, expected); cppTimes.push(ms);
  }
  for (let i = 0; i < rounds; ++i) {
    if (i % 2 === 0) { timeCpp(); timeJS(); } else { timeJS(); timeCpp(); }
  }
  const median = a => [...a].sort((x,y) => x - y)[Math.floor(a.length / 2)];
  const summary = a => ({ medianMs: +median(a).toFixed(3), minMs: +Math.min(...a).toFixed(3),
    maxMs: +Math.max(...a).toFixed(3) });
  console.log(JSON.stringify({ scope: 'isolated runtimePlan kernel; excludes process startup, IPC, Chromium and rendering',
    node: process.version, platform: os.platform(), arch: os.arch(), cpuModel: os.cpus()[0]?.model,
    rounds, plansPerRound: cases.length * passes, checksum: expected,
    js: summary(jsTimes), cpp: summary(cppTimes) }, null, 2));
}
