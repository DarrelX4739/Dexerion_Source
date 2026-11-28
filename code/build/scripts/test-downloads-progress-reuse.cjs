'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '../../code/src/renderer/pages/downloads.html'), 'utf8');
const active = (changes = {}) => ({
  id: 'moving', fileName: 'slow-transfer.bin', path: '/downloads/slow-transfer.bin',
  url: 'http://localhost/moving', received: 1024, total: 4096, percent: 0.25,
  bytesPerSecond: 2_097_152, canResume: true, state: 'progressing', active: true, error: '', ...changes,
});
const complete = (i, changes = {}) => ({
  id: 'done-' + i, fileName: 'finished-' + i + '.txt', path: 'C:\\Downloads\\finished-' + i + '.txt',
  url: 'http://localhost/finished-' + i, received: 4096, total: 4096,
  percent: 1, bytesPerSecond: 0, canResume: false, state: 'completed', active: false, error: '', ...changes,
});

function fixture(source = html, t) {
  const dom = new JSDOM(source, { runScripts: 'outside-only' });
  const { window } = dom;
  const { document } = window;
  if (t) t.after(() => window.close());
  const calls = [];
  const hooks = new Map();
  const invoke = new Map();
  let downloads = [];
  let additions = 0;
  const list = document.getElementById('list');
  const watch = new window.MutationObserver(rows => { additions += count(rows); });
  const count = rows => rows.reduce((n, m) => n + m.addedNodes.length, 0);
  watch.observe(list, { childList: true });
  window.dexerion = {
    invoke(channel, ...args) {
      calls.push([channel, ...args]);
      if (channel === 'dex:downloads') return Promise.resolve(structuredClone(downloads));
      if (invoke.has(channel)) return invoke.get(channel)(...args);
      return Promise.resolve(true);
    },
    on(name, handler) { hooks.set(name, handler); },
  };
  window.DexPage = { guard: async fn => fn() };
  const inline = [...document.querySelectorAll('script')].find(s => !s.src);
  assert.ok(inline);
  const reload = window.eval(inline.textContent + '\nload');
  async function update(next) {
    downloads = next;
    await reload();
  }
  return { window, document, list, calls, hooks, invoke, update,
    additions() { const sum = additions + count(watch.takeRecords()); additions = 0; return sum; } };
}
const button = (row, label) => [...row.querySelectorAll('button')].find(b => b.textContent === label);
const settle = () => new Promise(resolve => setImmediate(resolve));

if (process.argv.includes('--bench')) {
  const old = fs.readFileSync(process.argv.at(-1), 'utf8');
  (async () => {
    async function run(source, size, ticks, parity) {
      const f = fixture(source);
      await settle(); // initial production load
      const stable = Array.from({ length: size }, (_, i) => complete(i));
      await f.update([active(), ...stable]);
      f.additions();
      const markup = [];
      const t0 = performance.now();
      for (let i = 0; i < ticks; i++) {
        await f.update([active({ received: 1536 + i, percent: .35 + i / 200, bytesPerSecond: 1_280_000 + i }), ...stable]);
        if (parity) markup.push(f.list.innerHTML);
      }
      const elapsed = performance.now() - t0;
      const insertions = f.additions();
      f.window.close();
      return { elapsed, insertions, markup };
    }
    for (const [size, ticks] of [[20, 16], [200, 24]]) {
      const reference = [], next = [];
      for (let i = 0; i < 7; i++) {
        if (i % 2) next.push(await run(html, size, ticks, false));
        reference.push(await run(old, size, ticks, false));
        if (!(i % 2)) next.push(await run(html, size, ticks, false));
      }
      assert.deepEqual((await run(old, size, ticks, true)).markup, (await run(html, size, ticks, true)).markup);
      const median = (rows, k) => rows.map(r => r[k]).sort((a, b) => a - b)[3];
      const digest = rows => Object.fromEntries(['insertions', 'elapsed'].map(k => [k, median(rows, k)]));
      console.log(JSON.stringify({ size, ticks, reference: digest(reference), next: digest(next), markupParity: true }));
    }
  })().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  test('live progress replaces only changed rows and keeps accurate transfer, ARIA, and route controls', async (t) => {
    const f = fixture(html, t);
    await f.update([active(), complete(1), complete(2)]);
    const [first, saved, other] = f.list.children;
    const changed = active({ received: 2560, percent: .625, bytesPerSecond: 1_572_864 });
    await f.update([changed, complete(1), complete(2)]);
    assert.notEqual(f.list.children[0], first);
    assert.equal(f.list.children[1], saved);
    assert.equal(f.list.children[2], other);
    assert.equal(f.list.children[0].querySelector('small').textContent, '2.5 KB of 4.0 KB  ·  1.5 MB/s');
    const progress = f.list.children[0].querySelector('[role=progressbar]');
    assert.equal(progress.getAttribute('aria-valuenow'), '63');
    assert.equal(progress.getAttribute('aria-label'), 'slow-transfer.bin progress');
    assert.equal(f.list.children[0].querySelector('.dl-progress span').style.width, '62.5%');
    button(saved, 'Open').click();
    f.invoke.set('dex:confirm', async () => false);
    button(other, 'Delete').click();
    await settle();
    assert.deepEqual(structuredClone(f.calls.filter(c => c[0] !== 'dex:downloads')),
      [['dex:download-open', 'done-1'], ['dex:confirm', { message: 'Delete finished-2.txt?' }]]);
    assert.equal(f.hooks.has('dex:downloads-updated'), true);
  });

  test('focus, pending deletion, state changes, ordering and empty/error paths retain existing behavior', async (t) => {
    const f = fixture(html, t);
    const rows = [active(), complete(1), complete(2)];
    await f.update(rows);

    let old = f.list.children[1];
    button(old, 'Open').focus();
    await f.update(rows);
    assert.notEqual(f.list.children[1], old);
    assert.equal(f.document.activeElement, f.document.body, 'focused rows still take the old rebuild path');

    old = f.list.children[1];
    let finishDelete;
    f.invoke.set('dex:download-delete', () => new Promise(resolve => { finishDelete = resolve; }));
    button(old, 'Delete').click();
    await settle();
    assert.equal(button(old, 'Delete').disabled, true);
    await f.update(rows);
    assert.notEqual(f.list.children[1], old);
    assert.equal(button(f.list.children[1], 'Delete').disabled, false);
    finishDelete(true);
    await settle();

    const changed = complete(1, { received: 8192, total: 8192, fileName: 'renamed.txt', path: '/tmp/renamed.txt', error: 'Could not move file' });
    const next = [active({ state: 'paused' }), changed, complete(2)];
    await f.update(next);
    assert.equal(f.list.children[0].querySelector('.st').textContent, 'Paused');
    assert.ok(button(f.list.children[0], 'Resume'));
    assert.equal(f.list.children[1].querySelector('.dl-title').textContent, 'renamed.txt');
    assert.equal(f.list.children[1].querySelector('.dl-path').textContent, '/tmp');
    assert.equal(f.list.children[1].querySelector('.dl-error').textContent, 'Could not move file');
    await f.update([changed, next[0]]);
    assert.equal(f.list.children[0].querySelector('.dl-title').textContent, 'renamed.txt');
    const prior = f.list.innerHTML;
    f.window.DexPage.guard = async () => null;
    await f.update([]);
    assert.equal(f.list.innerHTML, prior);
    f.window.DexPage.guard = async fn => fn();
    await f.update([]);
    assert.equal(f.list.children.length, 1);
    assert.equal(f.list.querySelector('.dx-empty b').textContent, 'No downloads yet');
  });
}
