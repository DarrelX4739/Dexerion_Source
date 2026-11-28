'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const shell = fs.readFileSync(path.join(__dirname, '../../code/src/renderer/shell.js'), 'utf8');
const start = shell.indexOf('let bookmarkBarRows = ');
const end = shell.indexOf('// Memoised chrome measurements.', start);
assert.ok(start >= 0 && end > start, 'bookmark bar implementation must be present');
assert.match(shell, /function updateChromeRest\(s\) \{[\s\S]*?\bupdateBookmarksBar\(s\);/);

function fixture() {
  const calls = [];
  let allocations = 0;
  let replacements = 0;
  const bar = {
    style: {},
    children: [],
    replaceChildren(fragment) { replacements++; this.children = fragment.children; },
  };
  const update = vm.runInNewContext(shell.slice(start, end) + '\nupdateBookmarksBar;', {
    $: (selector) => { assert.equal(selector, '#bookmarkbar'); return bar; },
    document: {
      createDocumentFragment: () => ({ children: [], appendChild(node) { this.children.push(node); } }),
      createElement: (tag) => { assert.equal(tag, 'a'); allocations++; return {}; },
    },
    window: { dexerion: { invoke: (...args) => calls.push(args) } },
  });
  return { bar, calls, update, counts: () => ({ allocations, replacements }) };
}

const first = { title: 'Docs', url: 'https://example.test/docs' };
const second = { title: '', url: 'https://example.test/help' };
const state = (active, bar, bookmarksBar = true) => ({ active, bookmarksBar, bookmarks: { roots: { bar } } });

test('equivalent chrome state preserves bookmark nodes and navigates the latest active tab', () => {
  const f = fixture();
  const items = Array.from({ length: 100 }, (_, i) => ({ title: 'Bookmark ' + i, url: 'https://example.test/' + i }));
  f.update(state(0, items));
  const original = f.bar.children;
  for (let i = 1; i <= 250; i++) f.update(state(i, items.map((b) => ({ ...b }))));
  assert.equal(f.bar.children, original);
  assert.deepEqual(f.counts(), { allocations: 100, replacements: 1 });
  f.bar.children[99].onclick();
  assert.deepEqual(f.calls, [['dex:navigate', 250, 'https://example.test/99']]);
});

test('rename, replacement, order, visibility, and deletion retain their existing output', () => {
  const f = fixture();
  f.update(state(1, [first, second]));
  assert.equal(f.bar.style.display, 'flex');
  assert.deepEqual(f.bar.children.map((a) => [a.textContent, a.title]), [
    [first.title, first.url], [second.url, second.url],
  ]);
  const original = f.bar.children;
  f.update(state(2, [first, second], false));
  assert.equal(f.bar.style.display, 'none');
  f.update(state(3, [first, second]));
  assert.equal(f.bar.style.display, 'flex');
  assert.equal(f.bar.children, original);
  f.update(state(4, [second, { ...first, title: 'Renamed' }]));
  assert.deepEqual(f.bar.children.map((a) => a.textContent), [second.url, 'Renamed']);
  const newUrl = 'https://example.test/updated';
  f.update(state(5, [second, { title: 'Renamed', url: newUrl }]));
  f.bar.children[1].onclick();
  assert.deepEqual(f.calls, [['dex:navigate', 5, newUrl]]);
  f.update(state(6, []));
  assert.equal(f.bar.style.display, 'none');
  assert.equal(f.bar.children.length, 0);
  f.update(state(7, [first]));
  assert.equal(f.bar.style.display, 'flex');
  assert.deepEqual(f.bar.children.map((a) => a.textContent), ['Docs']);
});
