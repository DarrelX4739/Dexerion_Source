'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');

const appPath = path.join(__dirname, '../../code/src/renderer');
const shell = fs.readFileSync(path.join(appPath, 'shell.js'), 'utf8');
const html = fs.readFileSync(path.join(appPath, 'shell.html'), 'utf8');

function section(source, from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

function setup(t, skin = '', source = shell) {
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  if (t) t.after(() => dom.window.close());
  const { window } = dom;
  const { document } = window;
  const start = source.includes('const chromeTitle =') ? 'const chromeTitle =' : 'function updateChromeRest(';
  const executed = 'const SKIN = ' + JSON.stringify(skin) + ';\n' +
    section(source, 'const SKIN_LABELS =', 'const SKIN_QUERY =') +
    section(source, 'const ICONS =', 'async function refresh(') +
    section(source, start, '// Reconcile the toolbar') +
    section(source, 'function displayUrl(', '// Local mirror of the bookmarked');
  const boundary = { star: [], bookmarks: [], extensions: [], measures: 0, value: 0 };
  const $ = (selector) => document.querySelector(selector);
  Object.assign(window, { $, updateBookmarkStar: (act) => boundary.star.push(act),
    updateBookmarksBar: (s) => boundary.bookmarks.push(s), updateExtensionsToolbar: (e) => boundary.extensions.push(e),
    reportChrome: () => { boundary.measures++; } });
  const render = window.eval(executed + '\nupdateChromeRest');
  const omni = $('#omnibox');
  const value = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  Object.defineProperty(omni, 'value', { get() { return value.get.call(this); },
    set(v) { boundary.value++; value.set.call(this, v); } });
  return { $, boundary, window, document, omni, render, close: () => window.close() };
}

function snapshot() {
  return { tabs: [
    { id: 'a', title: 'Actual page', url: 'https://example.test/a', loading: false, canBack: true, canForward: false },
    { id: 'b', title: 'New tab', url: 'dexerion://newtab', loading: true, canBack: false, canForward: true },
  ], active: 'a', account: { id: 'first', name: 'Personal', googleEmail: 'user@example.test' },
  defaultAccountId: 'first', extensions: [] };
}
function observe(f) {
  const observer = new f.window.MutationObserver(() => {});
  for (const sel of ['title', '#account-av', '#dmenu-acc']) observer.observe(f.$(sel), { childList: true });
  observer.observe(f.$('#account-btn'), { attributes: true, attributeFilter: ['title'] });
  return observer;
}

if (process.argv.includes('--bench')) {
  const unguarded = fs.readFileSync(process.argv.at(-1), 'utf8');
  function run(source, mixed) {
    const f = setup(null, '', source);
    let mutations = 0;
    const watch = observe(f);
    const states = Array.from({length: 4}, snapshot);
    states[1].tabs[0].title = 'Actual page2';
    states[1].account.name = 'Work';
    states[2].tabs[0].url += '/new-path';
    states[3].tabs[0].title = 'Actual page3';
    for (let i = 0; i < 100; i++) f.render(states[0]);
    watch.takeRecords();
    const setters = f.boundary.value;
    const t0 = performance.now();
    for (let i = 0; i < 500; i++) {
      f.render(states[mixed && i % 5 === 0 ? (i % 3) + 1 : 0]);
      mutations += watch.takeRecords().length;
    }
    const ms = performance.now() - t0;
    const valueWrites = f.boundary.value - setters;
    f.close();
    return { ms, mutations, valueWrites };
  }
  for (const mixed of [false, true]) {
    const old = [], next = [];
    for (let i = 0; i < 7; i++) {
      if (i % 2) next.push(run(shell, mixed));
      old.push(run(unguarded, mixed));
      if (!(i % 2)) next.push(run(shell, mixed));
    }
    const median = (rows, key) => rows.map(r => r[key]).sort((a, b) => a - b)[3];
    const digest = (rows) => Object.fromEntries(Object.keys(rows[0]).map(key => [key, median(rows, key)]));
    console.log(mixed ? 'mixed' : 'steady', JSON.stringify({ old: digest(old), next: digest(next) }));
  }
} else {
  test('fresh duplicate payloads do not rewrite real title/account nodes or the unfocused input', (t) => {
    const f = setup(t);
    f.render(snapshot());
    const records = observe(f);
    const titleText = f.$('title').firstChild;
    const avatarText = f.$('#account-av').firstChild;
    const menuText = f.$('#dmenu-acc').firstChild;
    assert.equal(f.boundary.value, 1);
    for (let i = 0; i < 50; i++) f.render(snapshot());
    assert.equal(records.takeRecords().length, 0);
    assert.equal(f.$('title').firstChild, titleText);
    assert.equal(f.$('#account-av').firstChild, avatarText);
    assert.equal(f.$('#dmenu-acc').firstChild, menuText);
    assert.equal(f.boundary.value, 1);
    assert.equal(f.boundary.measures, 51, 'never skip existing chrome/rail layout reporting');
  });

  test('active navigation, loading, preview titles and raw title whitespace still update', (t) => {
    const f = setup(t, 'halo');
    const s = snapshot();
    s.tabs[0].title = 'Actual  page';
    f.render(s);
    assert.equal(f.$('title').textContent, 'Dexerion — Halo · Actual  page');
    assert.equal(f.document.title, 'Dexerion — Halo · Actual page');
    s.tabs[0].title = 'Actual page';
    f.render(s);
    assert.equal(f.$('title').textContent, 'Dexerion — Halo · Actual page');
    assert.equal(f.omni.value, 'https://example.test/a');
    assert.equal(f.$('[data-nav=back]').disabled, false);
    assert.equal(f.$('[data-nav=forward]').disabled, true);
    assert.equal(f.$('[data-nav=reload]').dataset.mode, 'reload');
    assert.equal(f.$('#lock').title, 'Connection is secure');

    s.active = 'b';
    f.render(s);
    assert.equal(f.document.title, 'Dexerion — Halo · New tab');
    assert.equal(f.omni.value, '');
    assert.equal(f.$('[data-nav=back]').disabled, true);
    assert.equal(f.$('[data-nav=forward]').disabled, false);
    assert.equal(f.$('[data-nav=reload]').dataset.mode, 'stop');
    assert.equal(f.$('#lock').title, 'Dexerion internal page');
    assert.equal(f.boundary.star.at(-1), s.tabs[1]);
    assert.equal(f.boundary.bookmarks.at(-1), s);
    assert.equal(f.boundary.extensions.at(-1), s.extensions);
    s.tabs = [];
    f.render(s);
    assert.equal(f.document.title, 'Dexerion — Halo');
  });

  test('typing and selection are untouched by navigation state until the input is unfocused', (t) => {
    const f = setup(t);
    f.render(snapshot());
    f.omni.focus();
    f.omni.value = 'typed draft';
    f.omni.setSelectionRange(2, 5, 'backward');
    const count = f.boundary.value;
    const next = snapshot();
    next.active = 'b';
    f.render(next);
    next.tabs[1].url = 'http://example.test/b';
    f.render(next);
    assert.equal(f.document.activeElement, f.omni);
    assert.equal(f.omni.value, 'typed draft');
    assert.deepEqual([f.omni.selectionStart, f.omni.selectionEnd, f.omni.selectionDirection], [2, 5, 'backward']);
    assert.equal(f.boundary.value, count);
    f.omni.blur();
    f.render(next);
    assert.equal(f.omni.value, 'http://example.test/b');
    assert.equal(f.boundary.value, count + 1);
  });

  test('avatar images retain identity and error, retry, removal and account changes retain fallbacks', (t) => {
    const f = setup(t);
    const s = snapshot();
    s.account.avatar = 'dexerion://avatar/first';
    f.render(s);
    const original = f.$('#account-av img');
    assert.equal(original.alt, '');
    assert.equal(original.draggable, false);
    f.render(s);
    assert.equal(f.$('#account-av img'), original);
    original.dispatchEvent(new f.window.Event('error'));
    assert.equal(f.$('#account-av').textContent, 'P');
    assert.equal(f.$('#account-av').dataset.src, '');
    f.render(s);
    assert.notEqual(f.$('#account-av img'), original);
    assert.equal(f.$('#account-av img').src, s.account.avatar);
    s.account = { id: 'second', name: 'Other' };
    f.render(s);
    assert.equal(f.$('#account-av img'), null);
    assert.equal(f.$('#account-av').textContent, 'O');
    assert.equal(f.$('#dmenu-acc').textContent, 'Other');
    assert.equal(f.$('#account-btn').title, 'Signed in as Other — manage accounts');
    s.defaultAccountId = 'second';
    s.account.name = ' Updated';
    f.render(s);
    assert.equal(f.$('#account-av').textContent, 'U');
    assert.equal(f.$('#dmenu-acc').textContent, ' Updated (default)');
    delete s.account;
    f.render(s);
    assert.equal(f.$('#account-av').textContent, 'D');
    assert.equal(f.$('#dmenu-acc').textContent, 'D');
  });
}
