// Test the original JS engine with fake time/timer/notification/profile
// adapters, without starting Electron or touching a real profile or clock.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const [binary, source] = process.argv.slice(2);
if (!binary) throw new Error('Usage: node focus_timer_parity.cjs <native replay> [js module]');
const jsPath = path.resolve(source || path.resolve(__dirname, '../../../code/code/src/main/pomodoro.js'));
let now = 1710000000000, handle, scheduled, cancelled, changes, notices, api;
const mod = { exports: {} };
vm.runInNewContext(fs.readFileSync(jsPath, 'utf8'), {
  module: mod, exports: mod.exports, require: createRequire(jsPath),
  Date: { now: () => now },
  setInterval(fn, ms) {
    assert.equal(ms, 500); assert.equal(handle, null);
    ++scheduled;
    handle = { fn, unref() {} }; return handle;
  },
  clearInterval(h) { assert.equal(h, handle); handle = null; ++cancelled; },
}, { filename: jsPath });
const input = [], expected = [], trace = [];
let traceCount = 0;
function step(op, advance = 0, a = 0, b = 0, present = 0) {
  now += advance;
  input.push([op, now, present, a, b].join(' '));
  trace.push({ op, now, a, b, present });
  scheduled = cancelled = 0; changes = []; notices = [];
  const hadTimer = Boolean(handle);
  if (op === 'new') {
    // New independent process/clock fixture, not an application transition.
    ++traceCount; handle = null;
    const settings = {};
    if (present & 1) settings.pomoWorkMin = a;
    if (present & 2) settings.pomoBreakMin = b;
    api = mod.exports.createPomodoro({
      profile: { data: { settings }, saveSoon() {} },
      notify: (title, body) => {
        assert.ok(title === 'Work done' || title === 'Break over'); assert.ok(body);
        notices.push(title === 'Work done' ? 1 : 2);
      },
      onChange: (kind, state) => changes.push({ kind, state }),
    });
  } else if (op === 'work' || op === 'break') api.start(op, { workMs: a, breakMs: a });
  else if (op === 'configure') {
    const patch = {};
    if (present & 1) patch.workMin = a;
    if (present & 2) patch.breakMin = b;
    api.configure(patch);
  } else if (op === 'tick') { if (handle) handle.fn(); }
  else if (op === 'state') api.state();
  else api[op]();
  const s = api.state();
  assert.equal(Boolean(handle), s.running, 'timer matches running state');
  if (scheduled) assert.equal(cancelled, +hadTimer, 'replacing interval cancels exactly the previous one');
  assert.ok(changes.length <= 1 && notices.length <= 1 && scheduled <= 1 && cancelled <= 1);
  if (changes.length) assert.deepEqual(changes[0].state, s, 'public callback snapshot matches state');
  const e = changes.length === 0 ? 0 : changes[0].kind === 'tick' ? 2 : 1;
  const timerEffect = scheduled ? 2 : cancelled ? 1 : 0;
  expected.push([s.phase, +s.running, s.remainMs, s.endsAt, s.workMin, s.breakMin,
    +s.blocking, e, notices[0] || 0, timerEffect].join(' '));
  return s;
}
// Named boundary contracts plus differential traces. A stalled process may
// deliver an overdue tick or an early user action before the next callback.
assert.equal(step('new', 0, 38, 8, 3).remainMs, 25 * 60000);
assert.equal(step('configure', 0, 1.9, 100, 3).workMin, 1);
assert.equal(step('state').breakMin, 60);
assert.equal(step('work', 0, 1999.5).remainMs, 2000);
assert.equal(step('tick', 999).remainMs, 1000);
assert.equal(step('pause', 999).blocking, true);
assert.equal(step('tick', 90000).phase, 'work');
assert.equal(step('toggle').running, true);
assert.equal(step('tick', 999).running, true);
const completedWork = step('tick', 1);
assert.equal(completedWork.phase, 'break'); assert.equal(completedWork.running, false);
assert.equal(completedWork.blocking, false);
step('break', 0, 100); step('configure', 0, 6, 5, 3);
const completedBreak = step('tick', 1000);
assert.equal(completedBreak.phase, 'work'); assert.equal(completedBreak.remainMs, 6 * 60000);
assert.equal(completedBreak.blocking, true); assert.equal(completedBreak.running, false);
assert.equal(step('reset').phase, 'idle'); assert.equal(step('skip').phase, 'idle');
step('work', 0, 1000); assert.equal(step('pause', 2000).remainMs, 0);
assert.equal(step('toggle').remainMs, 0); assert.equal(step('tick', 1000).phase, 'break');

let seed = 0xf0c05001;
function random(n) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % n; }
const pick = xs => xs[random(xs.length)];
const ops = ['work', 'break', 'toggle', 'toggle', 'tick', 'tick', 'tick', 'pause', 'skip', 'reset',
  'configure', 'state'];
for (let i = 0; i < 128; ++i) {
  now = 1710000000000 + i * 1000000;
  step('new', 0, random(200), random(80), random(4));
  for (let j = 0; j < 128; ++j) {
    const op = pick(ops);
    const elapsed = pick([-500, 0, 1, 499, 500, 999, 1000, 1001, 60_000, random(500000)]);
    if (op === 'configure') step(op, elapsed, random(256) - 10.5, random(128) - 5.5, random(4));
    else if (op === 'work' || op === 'break') step(op, elapsed, pick([-1, 0, 1, 999, 1000, 1001.5, random(120000)]));
    else step(op, elapsed);
  }
}
const out = spawnSync(path.resolve(binary), [], { encoding: 'utf8', input: input.join('\n') + '\n',
  timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
if (out.error) throw out.error;
assert.equal(out.status, 0, out.stderr);
const output = out.stdout.trimEnd().split(/\r?\n/);
assert.equal(output.length, expected.length);
for (let i = 0; i < expected.length; ++i) {
  assert.equal(output[i], expected[i], 'step ' + i + ': ' + JSON.stringify(trace[i]));
}
console.log(`PASS Focus Timer: ${expected.length} native/JS snapshots and effects in ${traceCount} deterministic clock traces (seed 0xf0c05001)`);
