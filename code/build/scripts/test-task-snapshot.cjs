'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const tasks = require('../../code/src/main/tasks');

const src = fs.readFileSync(path.join(__dirname, '../../code/src/main/browser.js'), 'utf8');
const snapshotLine = src.split('\n').find((line) => line.includes('const taskSnapshots = '));
const start = src.indexOf('  function ensureTasks(');
const end = src.indexOf('  // B2', start);
assert.ok(snapshotLine && start > 0 && end > start);
assert.match(src, /\btasks: tasksPublic\(st\.accountId\)/);

const original = { id: 'a1', title: ' Trim me ', notes: 'Remember', dueMs: 2_000_000,
  hasTime: true, priority: 'high', createdAt: 100, done: false, doneAt: 0,
  remindedPre: false, remindedDue: false };

function setup({ accounts = { a: { tasks: [{ ...original }] }, b: { tasks: [] } }, cache = true } = {}) {
  const calls = { normalize: 0, sort: 0, saves: [], notifications: [], pushes: [], heartbeats: 0 };
  let now = 1_000_000;
  const handlers = new Map();
  const windows = new Map(Object.keys(accounts).map((accountId) => [accountId, {
    accountId, win: { isDestroyed: () => false,
      webContents: { send: (channel, data) => calls.pushes.push([accountId, channel, structuredClone(data)]) } },
  }]));
  const ctx = {
    process: { env: cache ? {} : { DEX_TASK_SNAPSHOT_CACHE: 'off' } },
    tasks: { ...tasks,
      sanitizeList(list) { calls.normalize++; return tasks.sanitizeList(list); },
      sortTasks(list) { calls.sort++; return tasks.sortTasks(list); } },
    windows,
    accData: (id) => accounts[id],
    reminderData: (id) => accounts[id],
    Aof: (e) => ({ st: e, A: accounts[e.accountId] }),
    needChrome: (e) => ({ st: e }),
    listAccounts: () => Object.keys(accounts).map((id) => ({ id })),
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    saveAcc: (id) => calls.saves.push(id),
    armTaskHeartbeat: () => { calls.heartbeats++; },
    Notification: class { constructor(detail) { this.detail = detail; } show() { calls.notifications.push(this.detail); } },
    Date: { now: () => now },
  };
  const { get, reminders } = vm.runInNewContext(snapshotLine + '\n' + src.slice(start, end) +
    '\n({get: tasksPublic, reminders: checkTaskReminders});', ctx);
  return { accounts, get, reminders, calls, clock: (value) => { now = value; },
    invoke: (cmd, accountId, ...args) => handlers.get('dex:tasks-' + cmd)({ accountId }, ...args) };
}

test('repeated serial/IPC reads normalize and sort once, preserving exact public rows', () => {
  const accounts = { a: { tasks: [original, { ...original, title: 'duplicate' }, null, { title: 'invalid' },
    { ...original, id: 'a2', title: 'Later', dueMs: 3_000_000 }] }, b: { tasks: 'invalid array' } };
  const f = setup({ accounts });
  const expected = tasks.sortTasks(accounts.a.tasks);
  const first = f.get('a');
  assert.deepEqual(structuredClone(first), expected);
  assert.ok(Object.isFrozen(first) && first.every(Object.isFrozen));
  for (let i = 0; i < 200; i++) assert.equal(f.invoke('list', 'a'), first);
  assert.equal(f.calls.normalize, 1);
  assert.equal(f.calls.sort, 1);
  assert.equal(f.get('b').length, 0);
  assert.equal(f.get('a'), first);
  // A new account instance under the same ID must not inherit old state.
  accounts.a = { tasks: [{ ...original, id: 'fresh' }] };
  assert.equal(f.get('a')[0].id, 'fresh');
  assert.equal(first[0].id, 'a1');
});

test('real task IPC mutations invalidate only the affected account and retain sort/order and wire fields', () => {
  const f = setup();
  const beforeA = f.get('a');
  const beforeB = f.get('b');
  const add = f.invoke('add', 'a', { title: 'New', date: '2027-01-12', time: '10:45', priority: 'low' });
  const id = add.find((row) => row.title === 'New').id;
  assert.deepEqual(structuredClone(f.get('a')), structuredClone(add));
  assert.equal(f.get('b'), beforeB);
  assert.equal(beforeA.length, 1);
  const toggle = f.invoke('toggle', 'a', 'a1', true);
  assert.deepEqual(structuredClone(f.get('a')), structuredClone(toggle));
  assert.equal(f.get('a')[0].id, id);
  assert.equal(f.get('a')[1].doneAt, 1_000_000);
  assert.equal(beforeA[0].done, false);
  const clear = f.invoke('clear-done', 'a');
  assert.deepEqual(structuredClone(f.get('a')), structuredClone(clear));
  assert.deepEqual(f.get('a').map((row) => row.id), [id]);
  const del = f.invoke('delete', 'a', id);
  assert.deepEqual(structuredClone(f.get('a')), structuredClone(del));
  assert.equal(f.get('a').length, 0);
  assert.equal(f.calls.heartbeats, 4);
  assert.deepEqual(f.calls.saves, ['a', 'a', 'a', 'a']);
  assert.deepEqual(f.calls.pushes.map(([id, channel]) => [id, channel]),
    Array.from({ length: 4 }, () => ['a', 'dex:tasks-updated']));
});

test('actual reminder sweep publishes updated flags in future snapshots and never re-fires', () => {
  const f = setup();
  const old = f.get('a');
  f.reminders();
  const pre = f.get('a');
  assert.equal(pre[0].remindedPre, true);
  assert.equal(old[0].remindedPre, false);
  f.clock(2_000_001);
  f.reminders();
  const due = f.get('a');
  assert.equal(due[0].remindedDue, true);
  assert.equal(pre[0].remindedDue, false);
  f.reminders();
  assert.deepEqual(f.calls.notifications.map((n) => n.title),
    ['Dexerion Tasks — due in 30 minutes', 'Dexerion Tasks — due now']);
  assert.deepEqual(f.calls.saves, ['a', 'a']);
});

test('the escape hatch performs fresh work and matches serialized task payloads', () => {
  const off = setup({ cache: false });
  const on = setup();
  const first = off.get('a');
  assert.notEqual(off.get('a'), first);
  assert.equal(off.calls.sort, 2);
  assert.deepEqual(structuredClone(on.get('a')), structuredClone(first));
  for (const s of [off, on]) s.invoke('toggle', 'a', 'a1');
  assert.deepEqual(structuredClone(on.get('a')), structuredClone(off.get('a')));
});
