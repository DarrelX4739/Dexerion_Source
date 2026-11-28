'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '../../code/src/renderer/pages/newtab.html'), 'utf8');
const SYDNEY_CHANGE = Date.UTC(2026, 9, 3, 16, 0);
const title = i => 'Task ' + i;
const task = (i, dueMs, changes = {}) => ({
  id: 't' + i, title: title(i), dueMs, hasTime: true, priority: 'medium',
  done: false, notes: i % 2 ? ' A description with spacing  ' : '', ...changes,
});
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(code = source, t, locale = 'en-AU', zone = 'Australia/Sydney') {
  const dom = new JSDOM('<span id="tasks-n"></span><div id="tasks-nt"></div>', { runScripts: 'outside-only' });
  const { window } = dom;
  const { document } = window;
  if (t) t.after(() => window.close());
  const box = document.getElementById('tasks-nt');
  const calls = [], built = [], checks = [];
  let fallbacks = 0, now = SYDNEY_CHANGE, payload = [];
  const NativeDate = window.Date;
  const NativeFormat = window.Intl.DateTimeFormat;
  window.Date = class extends NativeDate {
    static now() { checks.push(now); return now; }
    toLocaleDateString(_, options) { fallbacks++; return super.toLocaleDateString(locale, { ...options, timeZone: zone }); }
    toLocaleTimeString(_, options) { fallbacks++; return super.toLocaleTimeString(locale, { ...options, timeZone: zone }); }
  };
  window.Intl.DateTimeFormat = class {
    constructor(_, options) {
      built.push(options.month ? 'day' : 'time');
      return new NativeFormat(locale, { ...options, timeZone: zone });
    }
  };
  Object.defineProperties(window.HTMLElement.prototype, {
    offsetHeight: { get() { return this.classList.contains('tk-todo') ? 24 : 0; } },
    offsetTop: { get() {
      return this.classList.contains('tk-todo') ? 12 + [...box.children].indexOf(this) * 33 : 12;
    } },
  });
  window.dexerion = { async invoke(channel, ...args) {
    calls.push([channel, ...args]);
    return channel === 'dex:tasks-list' ? structuredClone(payload) : [];
  } };
  const start = code.indexOf('(async function tasksNt(){');
  const end = code.indexOf('/* ================= Dexerion AI', start);
  assert.ok(start > 0 && end > start);
  const instrumented = code.slice(start, end).replace(/  load\(\);\r?\n\}\)\(\);/, '  window.__taskFixture={paint,load};\n  load();\n})();');
  assert.ok(instrumented.includes('window.__taskFixture'), 'new-tab fixture hook was not inserted');
  window.eval(instrumented);
  return { window, box, calls, built, checks,
    fallbacks: () => fallbacks, ...window.__taskFixture, close: () => window.close(),
    count: () => document.getElementById('tasks-n').textContent,
    payload(value) { payload = value; },
    clock(value) { now = value; },
    prefs(nextLocale, nextZone) { locale = nextLocale; zone = nextZone; },
  };
}
function label(row, locale, zone) {
  const d = new Date(row.dueMs);
  const day = d.toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone: zone });
  return row.hasTime ? day + ' ' + d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: zone }) : day;
}

if (process.argv.includes('--bench')) {
  const original = fs.readFileSync(process.argv.at(-1), 'utf8');
  (async () => {
    async function measure(code, rows, paints) {
      const f = fixture(code);
      await tick();
      f.clock(SYDNEY_CHANGE);
      const start = performance.now();
      for (let i = 0; i < paints; i++) f.paint(rows);
      const result = { ms: performance.now() - start, built: f.built.length, fallbacks: f.fallbacks(),
        markup: f.box.outerHTML };
      f.close();
      return result;
    }
    for (const [size, paints] of [[8, 20], [160, 5]]) {
      const rows = Array.from({ length: size }, (_, i) => task(i, SYDNEY_CHANGE + (i - 2) * 60_000, { hasTime: i % 4 !== 0 }));
      const old = [], next = [];
      for (let i = 0; i < 7; i++) {
        if (i % 2) next.push(await measure(source, rows, paints));
        old.push(await measure(original, rows, paints));
        if (!(i % 2)) next.push(await measure(source, rows, paints));
      }
      for (let i = 0; i < 7; i++) assert.equal(next[i].markup, old[i].markup);
      const med = (values, key) => values.map(v => v[key]).sort((a, b) => a - b)[3];
      const digest = values => Object.fromEntries(['ms', 'built', 'fallbacks'].map(k => [k, med(values, k)]));
      console.log(JSON.stringify({ size, paints, old: digest(old), next: digest(next), identicalMarkup: true }));
    }
  })().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  test('the source fixture can instrument a Windows CRLF checkout', async (t) => {
    const f = fixture(source.replace(/\r?\n/g, '\r\n'), t);
    await tick();
    f.paint([]);
    assert.equal(f.box.querySelector('.empty b').textContent, 'No open tasks');
  });

  test('real new-tab task renders share two formatters and keep the exact date text across current locale, time zone and DST', async (t) => {
    const f = fixture(source, t);
    await tick();
    const rows = [
      task(0, SYDNEY_CHANGE - 1), task(1, SYDNEY_CHANGE), task(2, SYDNEY_CHANGE + 1),
      task(3, SYDNEY_CHANGE, { hasTime: false }), task(4, 0), task(5, null),
      task(6, 9.9e15), task(7, undefined, { hasTime: false }),
    ];
    for (const [locale, zone] of [
      ['en-AU', 'Australia/Sydney'], ['en-US', 'America/New_York'],
      ['de-DE', 'Europe/Berlin'], ['ar-EG', 'Africa/Cairo'], ['th-TH', 'Asia/Bangkok'],
    ]) {
      f.prefs(locale, zone);
      f.paint(rows);
      assert.deepEqual([...f.box.querySelectorAll('small')].map(el => el.textContent),
        rows.map(row => label(row, locale, zone)));
      assert.deepEqual(f.built.splice(0), ['day', 'time']);
    }
    assert.equal(f.fallbacks(), 15, 'invalid dates still receive the original invalid-date text');
  });

  test('empty and all-day tasks avoid unused formatters; due checks, layout cap, expand and mark-done are unchanged', async (t) => {
    const f = fixture(source, t);
    await tick();
    assert.equal(f.count(), '');
    assert.match(f.box.textContent, /No open tasks/);
    assert.equal(f.built.length, 0);
    const rows = [
      task(1, SYDNEY_CHANGE, { hasTime: false }), task(2, SYDNEY_CHANGE + 1000, { hasTime: false }),
      task(3, SYDNEY_CHANGE - 1000, { hasTime: false, priority: 'high' }),
      task(4, SYDNEY_CHANGE + 2000, { hasTime: false }), task(5, SYDNEY_CHANGE + 3000, { done: true }),
    ];
    f.paint(rows);
    assert.deepEqual(f.built.splice(0), ['day']);
    assert.equal(f.count(), '4');
    assert.equal(f.box.style.maxHeight, '92px');
    assert.deepEqual([...f.box.querySelectorAll('small')].map(el => el.classList.contains('overdue')), [false, false, true, false]);
    assert.equal(f.checks.length, 4, 'each open task still checks current time');
    const first = f.box.firstElementChild;
    assert.equal(first.style.animationDelay, '0ms');
    assert.equal(f.box.children[2].style.animationDelay, '76ms');
    const expand = first.querySelector('.tk-exp');
    expand.click();
    assert.equal(first.classList.contains('expanded'), true);
    assert.equal(expand.getAttribute('aria-expanded'), 'true');
    assert.equal(first.querySelector('.tk-desc').textContent, 'A description with spacing');
    expand.click();
    assert.equal(expand.getAttribute('aria-expanded'), 'false');

    f.clock(SYDNEY_CHANGE + 1);
    f.payload(rows.slice(1));
    first.querySelector('.tk-box').click();
    await tick();
    assert.deepEqual(f.calls.slice(-2), [['dex:tasks-toggle', 't1', true], ['dex:tasks-list']]);
    assert.equal(f.count(), '3');
    assert.equal(f.box.style.maxHeight, '');
    assert.equal(f.box.firstElementChild.querySelector('b').textContent, 'Task 2');
  });
}
