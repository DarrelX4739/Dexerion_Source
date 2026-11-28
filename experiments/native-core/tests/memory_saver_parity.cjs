// Differential test: compare the compiled C++ policy to the shipped JS module,
// not a second hand-written implementation of the algorithm. No real profile.
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const binary = process.argv[2];
if (!binary) throw new Error('Usage: node memory_saver_parity.cjs <native replay binary> [js module]');
const js = require(process.argv[3] ? path.resolve(process.argv[3]) :
  path.resolve(__dirname, '../../../code/code/src/main/memsaver.js'));
const now = 10_000_000;
const defaults = { totalMB: 2000, capMB: 1536, now, floorMs: js.IDLE_FLOOR_MS, activeMB: 500 };
function tab(i, overrides = {}) {
  return { winId: 1, tabId: 't' + i, pid: i + 1, memMB: 160, lastActive: now - 60_000,
    url: 'https://example.test/', active: false, loading: false, lazy: false, sleeping: false,
    hasView: true, audible: false, ...overrides };
}
const cases = [];
function add(label, tabs, options = {}, expectedVictims) {
  const opts = { ...defaults, ...options };
  const { victims, projectedMB, overMB } = js.planSweep(tabs, opts);
  const indices = victims.map(t => tabs.indexOf(t));
  if (expectedVictims) assert.deepEqual(indices, expectedVictims, 'JS contract: ' + label);
  const expected = [projectedMB, overMB, js.clampCapMB(opts.capMB), js.hogFloorMB(opts.capMB),
    +js.shouldNoticeHog(opts.activeMB, opts.capMB, overMB), ...indices];
  const lines = [`sweep ${tabs.length} ${opts.totalMB} ${opts.capMB} ${opts.now} ${opts.floorMs} ${opts.activeMB}`];
  for (const t of tabs) {
    const flags = +t.active | (+t.loading << 1) | (+t.lazy << 2) | (+t.sleeping << 3) |
      (+t.hasView << 4) | (+t.audible << 5);
    lines.push([t.winId, t.tabId, t.pid, t.memMB, t.lastActive, flags, t.url].join(' '));
  }
  cases.push({ label, expected, lines });
}

add('no tabs', [], {}, []);
for (const [label, options] of Object.entries({
  exact: { totalMB: 1536 }, under: { totalMB: 1200 }, disabled: { capMB: 0 },
})) add('budget ' + label, [tab(0)], options, []);
for (const guard of [{ active: true }, { loading: true }, { lazy: true }, { sleeping: true },
  { hasView: false }, { audible: true }, { url: 'dexerion://blocked/focus' },
  { lastActive: now - 59_999 }]) {
  add('protected: ' + Object.keys(guard)[0], [tab(0, guard), tab(1)], {}, [1]);
}
add('floor includes exact boundary', [tab(1)], {}, [0]);
add('zero age allowed with floor disabled', [tab(0, { lastActive: now })], { floorMs: 0 }, [0]);
add('heaviest then oldest then stable', [
  tab(0), tab(1, { lastActive: 1 }), tab(2, { memMB: 512 }), tab(3, { lastActive: 1 }),
], { totalMB: 5000 }, [2, 1, 3, 0]);
add('shared PID across windows is credited once', [
  tab(0, { pid: 7, memMB: 300 }), tab(1, { pid: 7, winId: 2, lastActive: 1, memMB: 200 }),
  tab(2, { pid: 9, memMB: 150 }),
], { totalMB: 1800 }, [1, 0, 2]);
add('full Windows PID range does not alias unknown renderers', [
  tab(0, { pid: 4294967295, winId: 2147483648, memMB: 350 }),
  tab(1, { pid: 2147483648, memMB: 150 }), tab(2, { pid: 4294967295, memMB: 350 }),
], {}, [0, 2, 1]);
add('stable group order uses first eligible, not oldest insertion', [
  tab(0, { pid: 7 }), tab(1, { pid: 9, lastActive: 10 }),
  tab(2, { pid: 7, lastActive: 10 }), tab(3, { pid: 9, lastActive: 10 }),
], {}, [2, 0, 1, 3]);
add('protected shared sibling remains protected', [
  tab(0, { pid: 7, active: true }), tab(1, { pid: 7, memMB: 512 }),
], {}, [1]);
add('missing PID fallback is scoped to window and tab', [
  tab(0, { pid: 0, tabId: 'same', memMB: 300 }), tab(1, { pid: 0, tabId: 'same', winId: 2 }),
  tab(2, { pid: 0, tabId: 'different' }), tab(3, { pid: 0, tabId: 'same' }),
], {}, [0, 3, 1, 2]);
add('projection saturates at zero', [tab(0, { memMB: 2048 })],
  { capMB: 1024, totalMB: 1024.5 }, [0]);
add('unmeasured renderer still included while over cap', [tab(0, { memMB: 0 })], {}, [0]);
for (const capMB of [0, 1, 999.5, 1024, 1199, 1200, 1201, 1202, 1203, 1536.75, 4096, 9999]) {
  const threshold = js.hogFloorMB(capMB);
  for (const activeMB of [threshold - 0.5, threshold, threshold + 0.5]) {
    add('notice threshold', [], { capMB, totalMB: capMB + 1, activeMB });
  }
}

// xorshift32, fixed seed for reproducible failures on all supported OSes.
let seed = 0x44455831;
function random(n) {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return (seed >>> 0) % n;
}
const flag = n => random(n) === 0;
for (let i = 0; i < 2048; ++i) {
  const n = random(65);
  const floorMs = [0, 1000, 60000, 90000][random(4)];
  const tabs = Array.from({ length: n }, (_, j) => tab(j, {
    winId: 1 + random(4), pid: random(10), tabId: 't' + random(32),
    memMB: [0, 50, 100, 400, random(20000) / 8][random(5)],
    lastActive: now - [0, floorMs, floorMs - 1, floorMs + 1, random(200000)][random(5)],
    active: flag(16), loading: flag(12), lazy: flag(10), sleeping: flag(9), hasView: !flag(12),
    audible: flag(9), url: flag(16) ? 'dexerion://blocked?test' : 'https://example.test/',
  }));
  add('seed case ' + i, tabs, { totalMB: random(64000) / 8,
    capMB: [0, 1024, 1536, random(32768) / 8][random(4)], activeMB: random(4096) / 2, floorMs });
}
const output = spawnSync(path.resolve(binary), [], { encoding: 'utf8', timeout: 30000,
  input: cases.flatMap(c => c.lines).join('\n') + '\n', maxBuffer: 16 * 1024 * 1024 });
if (output.error) throw output.error;
assert.equal(output.status, 0, output.stderr);
const lines = output.stdout.trimEnd().split('\n');
assert.equal(lines.length, cases.length, 'one result per case');
for (const [index, c] of cases.entries()) {
  const actual = lines[index].trim().split(/\s+/).map(Number);
  assert.deepEqual(actual, c.expected, c.label);
}
const snaps = cases.reduce((s, c) => s + c.lines.length - 1, 0);
console.log(`PASS Memory Saver: ${cases.length} native/JS sweeps, ${snaps} tab snapshots (seed 0x44455831)`);
