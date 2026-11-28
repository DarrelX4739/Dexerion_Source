'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../../code/src/renderer/shell.js'), 'utf8');
const start = source.indexOf('const TASK_DATE_OPTIONS = ');
const end = source.indexOf('function tkShowErr', start);
assert.ok(start > 0 && end > start);

const dateOptions = { month: 'short', day: 'numeric' };
const timeOptions = { hour: '2-digit', minute: '2-digit' };
const epoch = Date.UTC(2026, 9, 3, 16, 15); // around the Sydney DST change
const task = (id, dueMs = epoch, opts = {}) => ({
  id, title: 'Task ' + id, notes: 'Keep details', dueMs, hasTime: true,
  priority: 'high', done: false, ...opts,
});

function setup(locale = 'en-AU', timeZone = 'Australia/Sydney') {
  const nodes = new Map(), calls = [], formats = [];
  let now = epoch - 1;
  function node() {
    const classes = new Set();
    return {
      attrs: {}, children: [], style: {},
      setAttribute(k, v) { this.attrs[k] = v; },
      append(...n) { this.children.push(...n); },
      appendChild(n) { this.children.push(n); },
      replaceChildren() { this.children = []; },
      querySelectorAll() { return []; },
      classList: { add(c) { classes.add(c); }, contains(c) { return classes.has(c); } },
    };
  }
  const ctx = {
    TASKS: [],
    $: (sel) => { if (!nodes.has(sel)) nodes.set(sel, node()); return nodes.get(sel); },
    document: { createElement: node },
    window: { dexerion: { invoke(...args) { calls.push(args); return Promise.resolve(); } } },
    Date: class extends Date {
      static now() { return now; }
      toLocaleDateString(_, opts) { return super.toLocaleDateString(locale, { ...opts, timeZone }); }
      toLocaleTimeString(_, opts) { return super.toLocaleTimeString(locale, { ...opts, timeZone }); }
    },
    Intl: { DateTimeFormat: class {
      constructor(_, opts) {
        formats.push([locale, timeZone, opts.month ? 'date' : 'time']);
        return new Intl.DateTimeFormat(locale, { ...opts, timeZone });
      }
    } },
  };
  const { render, format } = vm.runInNewContext(source.slice(start, end) +
    '\n({render: renderTasks, format: tkDueText});', ctx);
  return { nodes, calls, formats, format,
    render(rows) { ctx.TASKS = rows; render(); },
    clock(value) { now = value; },
    settings(nextLocale, nextZone) { locale = nextLocale; timeZone = nextZone; },
  };
}

function oldLabel(t, locale, timeZone) {
  if (!t || !t.dueMs) return '';
  const d = new Date(t.dueMs);
  const day = d.toLocaleDateString(locale, { ...dateOptions, timeZone });
  return t.hasTime ? day + ' ' + d.toLocaleTimeString(locale, { ...timeOptions, timeZone }) : day;
}

function taskMeta(row) { return row.children[1].children[1]; }

test('due text is exact for timed, all-day, null and out-of-range dates across locale/time zone/DST', () => {
  const variants = [
    ['en-AU', 'Australia/Sydney'], ['en-US', 'America/New_York'], ['en-GB', 'UTC'],
    ['de-DE', 'Europe/Berlin'], ['ar-EG', 'Africa/Cairo'], ['th-TH', 'Asia/Bangkok'],
  ];
  const dates = [null, task('missing', null), task('invalid', 9e15), task('invalid-untimed', 9e15, { hasTime: false }),
    task('before', epoch - 1_800_000), task('after'), task('all-day', epoch, { hasTime: false })];
  for (const [locale, zone] of variants) {
    const f = setup(locale, zone), formats = {};
    for (const t of dates) assert.equal(f.format(t, formats), oldLabel(t, locale, zone));
    assert.deepEqual(f.formats.map((x) => x[2]), ['date', 'time']);
  }
});

test('the real task render shares two formatters across both views but recomputes deadlines and locale per render', () => {
  const f = setup();
  const items = [task('1'), task('2', epoch + 48_000), task('3', epoch + 98_000, { hasTime: false }),
    task('4', epoch - 56_000, { done: true })];
  f.render(items);
  const peek = f.nodes.get('#tk-peek');
  const list = f.nodes.get('#tk-list');
  assert.equal(peek.children.length, 3);
  assert.equal(list.children.length, 4);
  assert.equal(f.nodes.get('#tk-count').textContent, '3 open');
  const first = taskMeta(peek.children[0]);
  assert.equal(first.classList.contains('overdue'), false);
  assert.equal(first.textContent, 'Keep details · ' + oldLabel(items[0], 'en-AU', 'Australia/Sydney'));
  assert.deepEqual(f.formats.map((x) => x[2]), ['date', 'time']);
  f.clock(epoch + 1);
  f.settings('de-DE', 'Europe/Berlin');
  f.render(items);
  const changed = taskMeta(peek.children[0]);
  assert.equal(changed.classList.contains('overdue'), true);
  assert.equal(changed.textContent, 'Keep details · ' + oldLabel(items[0], 'de-DE', 'Europe/Berlin'));
  assert.equal(taskMeta(list.children[3]).classList.contains('overdue'), false);
  assert.deepEqual(f.formats, [
    ['en-AU', 'Australia/Sydney', 'date'], ['en-AU', 'Australia/Sydney', 'time'],
    ['de-DE', 'Europe/Berlin', 'date'], ['de-DE', 'Europe/Berlin', 'time'],
  ]);
  peek.children[0].children[0].onclick();
  list.children[3].children[3].onclick();
  assert.deepEqual(f.calls, [['dex:tasks-toggle', '1', true], ['dex:tasks-delete', '4']]);
});

test('empty and all-day lists do not initialize unused formatters', () => {
  const f = setup();
  f.render([]);
  assert.equal(f.formats.length, 0);
  f.render([task('all-day', epoch, { hasTime: false })]);
  assert.deepEqual(f.formats.map((x) => x[2]), ['date']);
});
