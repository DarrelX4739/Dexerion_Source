'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');

const src = fs.readFileSync(path.join(__dirname, '../../code/src/renderer/ai-sidebar.js'), 'utf8');

function fixture(source = src, t) {
  const dom = new JSDOM('<div id="ai-messages"><div id="empty">Empty</div></div>',
    { runScripts: 'outside-only' });
  const { window } = dom;
  const { document } = window;
  if (t) t.after(() => window.close());
  const thread = document.getElementById('ai-messages');
  let reads = 0, scrollTop = 0;
  const writes = [], floatChecks = [];
  // Observe the exact layout-related accesses in the actual renderer
  // functions. jsdom doesn't perform Chromium layout; do not infer its cost.
  Object.defineProperties(thread, {
    scrollHeight: { get() { reads++; return this.children.length * 27; } },
    scrollTop: { get() { return scrollTop; }, set(v) { scrollTop = v; writes.push(v); } },
  });
  Object.assign(window, {
    $: (sel) => document.querySelector(sel),
    messages: thread, empty: document.getElementById('empty'),
    activeChat: null, targetedMessage: null, editingMessageId: null,
    uiPrefs: { showUsage: false }, msgSearchActive: false,
    paintTaskbarTitle() {}, renderSuggestions() {}, dateLabel() { return 'fixture time'; },
    updateScrollFloats() { floatChecks.push([thread.children.length, thread.scrollTop]); },
  });
  function section(from, to) {
    const start = source.indexOf(from);
    const end = source.indexOf(to, start);
    assert.ok(start >= 0 && end > start);
    return source.slice(start, end);
  }
  const fns = window.eval(section('  function scrollToBottom(', '  // Float scroll buttons') +
    section('  function renderMessages()', '  let hasKey = false;') +
    '\n({ render: renderMessages, single: addMessage });');
  return { window, thread, writes, floatChecks, reads: () => reads,
    clearCounts() { reads = 0; writes.length = 0; floatChecks.length = 0; },
    render(rows) {
      window.activeChat = rows ? { title: 'Fixture chat', messages: rows } : null;
      fns.render();
    },
    single() { return fns.single('model', 'One live reply', false); } };
}
const makeRows = (n) => Array.from({ length: n }, (_, i) => ({
  id: 'm' + i, role: i % 2 ? 'model' : 'user',
  text: 'Row ' + i + ' with **markdown**, [a link](https://example.test/) and user text', ts: 2_000_000 + i,
  edited: i % 6 === 0, editedAt: 2_000_000 + i,
  ...i % 5 === 0 ? { context: { label: 'Saved context', text: 'A paragraph of context' } } : {},
}));

if (process.argv.includes('--bench')) {
  const before = fs.readFileSync(process.argv.at(-1), 'utf8');
  function run(source, rows) {
    const f = fixture(source);
    const t0 = performance.now();
    f.render(rows);
    const elapsed = performance.now() - t0;
    const result = { reads: f.reads(), writes: f.writes.length, elapsed };
    assert.equal(f.thread.children.length, Math.min(rows.length, 200) + 1);
    f.window.close();
    return result;
  }
  for (const n of [40, 240]) {
    const rows = makeRows(n), old = [], next = [];
    for (let i = 0; i < 7; i++) {
      if (i % 2) next.push(run(src, rows));
      old.push(run(before, rows));
      if (!(i % 2)) next.push(run(src, rows));
    }
    const medians = (values) => Object.fromEntries(Object.keys(values[0]).map((field) =>
      [field, values.map((r) => r[field]).sort((a, b) => a - b)[3]]));
    console.log(JSON.stringify({ n, old: medians(old), next: medians(next) }));
  }
} else {
  test('bulk redraw retains the 200-message cap, scrolls once to the bottom before updating controls, and keeps message DOM', (t) => {
    const f = fixture(src, t);
    f.render(makeRows(240));
    const rows = f.thread.querySelectorAll('.ai-message');
    assert.equal(rows.length, 200);
    assert.equal(rows[0].dataset.msgId, 'm40');
    assert.equal(rows[199].dataset.msgId, 'm239');
    assert.match(rows[0].textContent, /Row 40/);
    assert.equal(rows[0].querySelector('.ai-ctx').textContent, '◉ Saved context');
    assert.equal(rows[199].querySelector('.ai-msg-meta .ai-usage').textContent, 'fixture time');
    const bottom = (200 + 1) * 27;
    assert.equal(f.reads(), 1);
    assert.deepEqual(f.writes, [bottom]);
    assert.deepEqual(f.floatChecks, [[201, bottom]]);
  });

  test('streaming single-message appends still scroll immediately and empty redraws add no layout reads', (t) => {
    const f = fixture(src, t);
    f.render([]);
    f.render(null);
    assert.equal(f.reads(), 0);
    assert.deepEqual(f.writes, []);
    assert.equal(f.thread.children.length, 1);
    f.render(makeRows(2));
    f.clearCounts();
    const bubble = f.single();
    assert.equal(bubble.textContent, 'One live reply');
    assert.equal(f.reads(), 1);
    assert.deepEqual(f.writes, [4 * 27]);
    assert.deepEqual(f.floatChecks, []);
  });
}
