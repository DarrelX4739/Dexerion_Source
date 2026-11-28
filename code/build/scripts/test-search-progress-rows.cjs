'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');

const src = fs.readFileSync(path.join(__dirname, '../../code/src/renderer/ai-search.js'), 'utf8');

function fixture(source = src, t) {
  const dom = new JSDOM('<main></main>', { runScripts: 'outside-only' });
  const { window } = dom;
  const { document } = window;
  if (t) t.after(() => window.close());
  const icon = source.split('\n').find(line => line.includes('const CHECK_ICON = '));
  const start = source.indexOf('  function stepRow(');
  const end = source.indexOf('  function appendSearchMeta(', start);
  assert.ok(icon && start > 0 && end > start);
  const api = window.eval(icon + '\n' +
    'const state = { steps: [], current: null, live: null, reqId: "fixture", liveReq: "fixture" };\n' +
    'let stops = 0; function stop() { stops++; }\n' + source.slice(start, end) +
    '\n({state, paintWorking, mountWorking, setCurrent, beginWorking, finishWorking, stops: () => stops});');
  function mount() {
    const root = document.createElement('article');
    const body = document.createElement('div');
    root.appendChild(body);
    document.querySelector('main').replaceChildren(root);
    return api.state.live = { root, body };
  }
  return { window, document, mount, ...api };
}

function observeAdditions(f, live) {
  const observer = new f.window.MutationObserver(() => {});
  observer.observe(live.stepList, { childList: true });
  return () => observer.takeRecords().reduce((total, record) => total + record.addedNodes.length, 0);
}
function labelRows(n) {
  const phases = ['Searching Web', 'Searching articles', 'Reading', 'Writing'];
  return Array.from({ length: n }, (_, i) =>
    [phases[Math.min(3, Math.floor(i / Math.max(1, n / 4)))], i % 5 ? 'query or source ' + i : '']);
}
function paintSequence(f, n, collect) {
  const live = f.mount();
  f.beginWorking(live, 'Adapting your question');
  const takeAdditions = observeAdditions(f, live);
  let additions = 0;
  const start = performance.now();
  const states = [];
  for (const args of labelRows(n)) {
    f.setCurrent(...args);
    additions += takeAdditions();
    if (collect) states.push(live.root.innerHTML);
  }
  const elapsed = performance.now() - start;
  f.finishWorking(live);
  if (collect) states.push(live.root.innerHTML);
  return { additions, elapsed, states };
}

if (process.argv.includes('--bench')) {
  const old = fs.readFileSync(process.argv.at(-1), 'utf8');
  for (const n of [14, 44]) {
    const before = [], after = [];
    for (let i = 0; i < 7; i++) {
      const a = fixture(old), b = fixture(src);
      if (i % 2) after.push(paintSequence(b, n, false));
      before.push(paintSequence(a, n, false));
      if (!(i % 2)) after.push(paintSequence(b, n, false));
      a.window.close();
      b.window.close();
    }
    const a = fixture(old), b = fixture(src);
    try {
      assert.deepEqual(paintSequence(b, n, true).states, paintSequence(a, n, true).states);
    } finally { a.window.close(); b.window.close(); }
    const digest = (rows) => Object.fromEntries(['additions', 'elapsed'].map((key) =>
      [key, rows.map((r) => r[key]).sort((a, b) => a - b)[3]]));
    console.log(JSON.stringify({ n, before: digest(before), after: digest(after), markupParity: true }));
  }
} else {
  test('existing progress rows are retained until a changed trace; exact labels, details, icon and Stop survive', (t) => {
    const f = fixture(src, t);
    const live = f.mount();
    f.beginWorking(live, 'Adapting your question');
    const additions = observeAdditions(f, live);
    f.setCurrent('Searching', 'the question');
    assert.equal(additions(), 1);
    const first = live.stepList.firstChild;
    assert.equal(first.textContent, 'Adapting your question');
    assert.ok(first.querySelector('svg'));
    assert.equal(first.querySelector('.ais-step-ico').getAttribute('aria-hidden'), 'true');
    f.setCurrent('Searching', 'the question');
    assert.equal(additions(), 0);
    f.setCurrent('Reading', 'source.example');
    assert.equal(additions(), 1);
    assert.equal(live.stepList.firstChild, first);
    assert.equal(live.stepList.lastChild.querySelector('.ais-step-detail').textContent, 'the question');
    assert.equal(live.now.textContent, 'Reading');
    assert.equal(live.detail.textContent, 'source.example');
    live.work.querySelector('.ais-work-stop').click();
    assert.equal(f.stops(), 1);
    f.setCurrent('Writing');
    assert.equal(live.detail.hidden, true);
    f.finishWorking(live);
    assert.equal(live.root.querySelector('.ais-work'), null);
    const actions = live.root.querySelector('details.ais-actions');
    assert.equal(actions.open, false);
    assert.equal(actions.querySelector('summary').textContent, 'Actions (4)');
    assert.deepEqual([...actions.querySelectorAll('.ais-step-label')].map(el => el.textContent),
      ['Adapting your question', 'Searching', 'Reading', 'Writing']);
  });

  test('reopening and resetting a trace each preserve the same rows and current label', (t) => {
    const f = fixture(src, t);
    const first = f.mount();
    f.beginWorking(first, 'Planning');
    f.setCurrent('Searching', 'term');
    f.setCurrent('Reading');
    const oldMarkup = first.work.innerHTML;

    const second = f.mount();
    f.mountWorking(second);
    assert.equal(second.work.innerHTML, oldMarkup);
    assert.notEqual(second.stepList.firstChild, first.stepList.firstChild);
    f.setCurrent('Writing');
    assert.equal(first.work.innerHTML, oldMarkup);
    assert.equal(second.stepList.children.length, 3);
    assert.equal(second.now.textContent, 'Writing');

    f.beginWorking(second, 'New search');
    f.setCurrent('Reading again');
    assert.equal(second.stepList.children.length, 1);
    assert.equal(second.stepList.firstChild.textContent, 'New search');
    f.finishWorking(second, false);
    assert.equal(second.root.querySelector('.ais-work'), null);
    assert.equal(second.root.querySelector('.ais-actions'), null);
  });
}
