'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const shell = fs.readFileSync(path.join(__dirname, '../../code/src/renderer/shell.js'), 'utf8');
const start = shell.indexOf('let lastTabKey = ');
const end = shell.indexOf('// Tab-group colors', start);
assert.ok(start > 0 && end > start);
assert.match(shell, /\bupdateTabRail\(s\);\s*updateChromeRest\(s\);/);

function setup() {
  const builds = [], hooks = new Map();
  let keyPasses = 0;
  const ctx = {
    document: { addEventListener(name, callback) { hooks.set(name, callback); } },
    buildTabs: (s) => builds.push(s),
    render: (s) => update(s),
    S: null,
  };
  const { update, invalidate } = vm.runInNewContext(shell.slice(start, end) +
    '\n({update: updateTabRail, invalidate: () => { lastTabKey = ""; }});', ctx);
  return { builds, invalidate, hook: (name, event) => hooks.get(name)(event),
    update(s) {
      ctx.S = s;
      for (const array of [s.tabs, s.groups].filter(Boolean)) {
        Object.defineProperty(array, 'map', { configurable: true, value(callback) {
          keyPasses++;
          return Array.prototype.map.call(this, callback);
        } });
      }
      update(s);
    },
    keyPasses: () => keyPasses,
  };
}

const favicon = 'data:image/png;base64,' + 'A'.repeat(1500);
const snapshot = () => ({
  active: 't1',
  tabs: [
    { id: 't1', url: 'https://example.test/1', title: 'First', groupId: 'g1', favicon },
    { id: 't2', url: 'https://example.test/2', title: 'Second', groupId: 'g1', favicon },
    { id: 't3', url: 'https://elsewhere.test/', title: 'Third' },
  ],
  groups: [{ id: 'g1', name: 'Read later', color: 'blue' }],
});

test('fresh identical rail snapshots bypass fingerprint assembly with no extra DOM rebuild', () => {
  const f = setup();
  f.update(snapshot());
  for (let i = 0; i < 200; i++) {
    const state = snapshot();
    state.tabs[0].canBack = i % 2 === 0; // consumed by chrome, not the rail
    state.account = { id: String(i) };
    f.update(state);
  }
  assert.equal(f.builds.length, 1);
  assert.equal(f.keyPasses(), 2); // initial tabs + groups only
});

test('every original dependency, order, and active change still takes the exact rebuild path', () => {
  const changes = [
    (s) => { s.active = 't3'; },
    (s) => { s.tabs.reverse(); },
    (s) => { s.tabs.pop(); },
    (s) => { s.tabs[0].id = 'other'; },
    (s) => { s.tabs[0].title = 'Updated'; },
    (s) => { s.tabs[0].url += '?a=b'; },
    (s) => { s.tabs[0].favicon = favicon + 'B'; },
    (s) => { s.tabs[0].loading = true; },
    (s) => { s.tabs[0].sleeping = true; },
    (s) => { s.tabs[0].groupId = null; },
    (s) => { s.groups[0].id = 'renumbered'; },
    (s) => { s.groups[0].name = 'Updated'; },
    (s) => { s.groups[0].color = 'grey'; },
    (s) => { s.groups.length = 0; },
  ];
  for (const change of changes) {
    const f = setup();
    f.update(snapshot());
    const changed = snapshot();
    change(changed);
    f.update(changed);
    assert.equal(f.builds.length, 2, change.toString());
    assert.equal(f.builds[1], changed);
    assert.equal(f.keyPasses(), 4);
  }
});

test('group reset and actual drag listeners retain full-build timing', () => {
  const f = setup();
  f.update(snapshot());
  f.invalidate(); // same sentinel used by the group collapse handler
  f.update(snapshot());
  assert.equal(f.builds.length, 2);
  f.hook('dragstart', { target: { closest: () => true } });
  const moved = snapshot();
  moved.tabs.reverse();
  f.update(moved);
  assert.equal(f.builds.length, 2);
  assert.equal(f.keyPasses(), 4);
  f.hook('dragend');
  assert.equal(f.builds.length, 3);
  assert.equal(f.builds[2], moved);
  f.hook('drop');
  f.update(moved);
  assert.equal(f.builds.length, 4);
});

test('the fallback retains legacy delimiters, including a collision that did not rebuild before', () => {
  const f = setup();
  const a = snapshot();
  a.tabs[0].title = 'a|b';
  a.tabs[0].url = 'c';
  const b = snapshot();
  b.tabs[0].title = 'a';
  b.tabs[0].url = 'b|c';
  f.update(a);
  f.update(b);
  f.update(b);
  assert.equal(f.builds.length, 1);
  assert.equal(f.keyPasses(), 4);
});
