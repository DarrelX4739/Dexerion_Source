'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../../code/src/renderer/shell.js'), 'utf8');
const start = source.indexOf('function pomoFmt(');
const end = source.indexOf('function pomoEnsureAudio(', start);
assert.ok(start > 0 && end > start);

function setup() {
  const calls = [];
  let allocations = 0, replacements = 0;
  function node(tag) {
    return {
      tag, attrs: {}, children: [], style: {},
      append(...nodes) { this.children.push(...nodes); },
      appendChild(child) { this.children.push(child); },
      setAttribute(name, value) { this.attrs[name] = value; },
      classList: { toggle() {} },
    };
  }
  const nodes = new Map(['#rt-phase', '#rt-time', '#rt-fill', '#rt-toggle', '#rt-work', '#rt-break',
    '#rt-sound', '#rt-vol', '#rt-sites', '#rm-start', '#rm-run', '#rm-time', '#rm-toggle', '#rm-sound']
    .map((id) => [id, node('div')]));
  const document = { activeElement: null, createElement(tag) { allocations++; return node(tag); } };
  nodes.get('#rt-sites').replaceChildren = function () {
    replacements++;
    if (this.children.some((row) => row.children.includes(document.activeElement))) document.activeElement = null;
    this.children = [];
  };
  const update = vm.runInNewContext(source.slice(start, end) + '\nupdateTimer;', {
    $: (id) => nodes.get(id),
    window: { dexerion: { invoke(...args) { calls.push(args); return Promise.resolve(); } } },
    document,
    syncPomoAudio: (p, on) => calls.push(['audio', p.running, on]),
  });
  return { update, nodes, document, calls, counts: () => ({ allocations, replacements }) };
}

const timing = (blocklist, overrides = {}) => ({ pomoAudio: true, pomodoro: {
  phase: 'work', workMin: 25, breakMin: 5, running: true, remainMs: 63000,
  sound: 'rain', volume: 45, blocklist, ...overrides,
} });

test('500 ms timer updates still update clocks, controls and audio but do not recreate unchanged site buttons', () => {
  const f = setup();
  const mt = f.nodes.get('#rt-sites');
  const sites = Array.from({ length: 25 }, (_, i) => 'example-' + i + '.test');
  f.update(timing(sites));
  const rows = mt.children;
  const remove = rows[3].children[1];
  f.document.activeElement = remove;
  for (let i = 1; i <= 120; i++) f.update(timing(sites.slice(), { remainMs: 63000 - i * 500 }));
  assert.equal(mt.children, rows);
  assert.equal(f.document.activeElement, remove);
  assert.equal(f.nodes.get('#rt-time').textContent, '00:03');
  assert.equal(f.nodes.get('#rm-time').textContent, '00:03');
  assert.equal(f.nodes.get('#rt-toggle').textContent, '⏸');
  assert.equal(f.nodes.get('#rm-toggle').title, 'Pause');
  assert.equal(f.nodes.get('#rm-start').hidden, true);
  assert.equal(f.calls.length, 121);
  assert.deepEqual(f.calls.at(-1), ['audio', true, true]);
  assert.deepEqual(f.counts(), { allocations: 75, replacements: 1 });
  remove.onclick();
  assert.deepEqual(f.calls.at(-1), ['dex:pomo-block-remove', 'example-3.test']);
});

test('ordered updates rebuild the correct controls, including empty list and paused/mute state', () => {
  const f = setup();
  const mt = f.nodes.get('#rt-sites');
  f.update(timing([]));
  assert.equal(mt.children[0].textContent, 'Nothing blocked.');
  f.update(timing(['one.test', 'two.test']));
  assert.deepEqual(mt.children.map((n) => n.children[0].textContent), ['one.test', 'two.test']);
  f.update(timing(['two.test', 'one.test'], { running: false, sound: 'off' }));
  assert.deepEqual(mt.children.map((n) => n.children[0].title), ['two.test', 'one.test']);
  assert.equal(f.nodes.get('#rt-phase').textContent, 'Work · paused');
  assert.equal(f.nodes.get('#rt-toggle').textContent, '▶');
  assert.equal(f.nodes.get('#rm-sound').title, 'Unmute (restore White noise)');
  const remove = mt.children[0].children[1];
  assert.equal(remove.attrs['aria-label'], 'Unblock two.test');
  remove.onclick();
  assert.deepEqual(f.calls.at(-1), ['dex:pomo-block-remove', 'two.test']);
  f.update(timing([]));
  assert.equal(mt.children.length, 1);
  assert.equal(mt.children[0].textContent, 'Nothing blocked.');
});
