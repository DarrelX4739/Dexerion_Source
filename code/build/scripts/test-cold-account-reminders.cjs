'use strict';

// Disposable on-disk profiles and real browser reminder/IPC bodies. Native
// Notification, sessions, windows and timers are deterministic stand-ins.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const { performance } = require('node:perf_hooks');
const { test } = require('node:test');
const tasks = require('../../code/src/main/tasks');

let dir, ProfileStore;
const load = Module._load;
try {
  Module._load = function (name, ...rest) {
    return name === 'electron' ? { app: { getPath: () => dir } } : load.call(this, name, ...rest);
  };
  ({ ProfileStore } = require('../../code/src/main/profile'));
} finally {
  Module._load = load;
}

const src = fs.readFileSync(path.join(__dirname, '../../code/src/main/browser.js'), 'utf8');
function section(from, to) {
  const start = src.indexOf(from);
  const end = src.indexOf(to, start);
  assert.ok(start >= 0 && end > start);
  return src.slice(start, end);
}
const core = new vm.Script(
  section('  const accountCache =', '  const cleanUaString =') +
  section("  ipcMain.handle('dex:account-delete',", '  // ---------- password manager IPC') +
  section('  function ensureTasks(', '  // ---------- snip tool') +
  '\n({ accData, accountCache, tasksPublic, flushAccounts, checkTaskReminders, armTaskHeartbeat });'
);
const START = 2_000_000;
const row = (title, opts) => ({
  id: title, title, notes: 'notes for ' + title, dueMs: START + 60_000, hasTime: true,
  priority: 'medium', createdAt: START - 1000, done: false, doneAt: 0,
  remindedPre: false, remindedDue: false, ...opts,
});
const defaultIds = ['default', 'cold-a', 'cold-b'];

function mkProfile() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-cold-account-'));
  dir = temp;
  const profile = new ProfileStore();
  return { profile, dispose: () => fs.rmSync(temp, { recursive: true, force: true }) };
}
function seed(profile, id, options = {}) {
  const data = profile.blankAccountData();
  data.history = [{ url: 'https://history.example/' + id, title: id }];
  data.bookmarks.roots.bar.push({ url: 'https://bookmarks.example/' + id, title: id });
  data.chats = [{ id, messages: [{ content: 'chat' }] }];
  Object.assign(data, options);
  assert.equal(profile.saveAccountData(id, data), true);
  return data;
}
function fixture(profile, { cold = true, adaptive = true, ids = defaultIds, now = START } = {}) {
  const reads = [], writes = [], notifications = [], broadcasts = [], closed = [], clearStorage = [], meta = [];
  const handlers = new Map(), timers = new Map(), windows = new Map();
  const S = { accounts: ids.map(id => ({ id })), defaultAccountId: 'default' };
  const store = Object.create(profile);
  store.saveSoon = () => meta.push(S.accounts.map(({ id }) => id));
  for (const [method, output] of [
    ['loadAccountData', reads], ['loadAccountReminderData', reads],
    ['saveAccountData', writes], ['saveAccountReminderData', writes],
  ]) {
    store[method] = function (id, ...args) {
      output.push([method, id]);
      return profile[method].call(profile, id, ...args);
    };
  }
  let seq = 0;
  function schedule(fn, delay, interval = false) {
    const key = ++seq;
    timers.set(key, { fn, delay, at: now + delay, interval });
    return key;
  }
  const ctx = {
    S, profile: store, fs, path, windows, tasks,
    process: { env: { DEX_COLD_ACCOUNT_TASKS: cold ? 'on' : 'off',
      DEX_TASK_HEARTBEAT: adaptive ? 'adaptive' : 'legacy' } },
    Date: { now: () => now },
    console, setTimeout: schedule, clearTimeout: (key) => timers.delete(key),
    setInterval: (fn, delay) => schedule(fn, delay, true),
    Notification: class { constructor(opts) { this.opts = opts; } show() { notifications.push([now, this.opts.title, this.opts.body]); } },
    BUDGETS: { taskHeartbeatNearMs: 30_000, taskHeartbeatIdleMs: 5 * 60_000, taskHeartbeatNearWindowMs: 10 * 60_000 },
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    needChrome: (e) => { assert.ok(windows.has(e)); return { st: windows.get(e) }; },
    Aof: (e) => { const { st } = ctx.needChrome(e); return { st, A: coreExports.accData(st.accountId) }; },
    accountSessions: new Map(),
    sesFor: (id) => ({ clearStorageData: async () => { clearStorage.push(id); } }),
    broadcastState: () => {},
  };
  const coreExports = core.runInNewContext(ctx);
  return {
    ...coreExports, reads, writes, notifications, broadcasts, closed, clearStorage, meta, timers,
    open(wid, accountId) {
      windows.set(wid, { accountId, win: { isDestroyed: () => false, close() { windows.delete(wid); closed.push(wid); },
        webContents: { send: (channel, payload) => broadcasts.push([wid, channel, structuredClone(payload)]) } } });
      return coreExports.accData(accountId);
    },
    invoke(cmd, wid, ...args) { return handlers.get('dex:' + cmd)(wid, ...args); },
    to(at) {
      assert.ok(at >= now);
      while (true) {
        const next = [...timers.entries()].sort(([, a], [, b]) => a.at - b.at)[0];
        if (!next || next[1].at > at) break;
        const [key, timer] = next;
        now = timer.at;
        if (timer.interval) timer.at += timer.delay; else timers.delete(key);
        timer.fn();
      }
      now = at;
    },
  };
}
function taskFile(profile, id) { return path.join(profile.accountDir(id), 'tasks.json'); }
function fromDisk(profile, id) { return JSON.parse(fs.readFileSync(taskFile(profile, id), 'utf8')); }

if (process.argv.includes('--bench')) {
  assert.ok(global.gc, 'run the benchmark with node --expose-gc');
  const { profile, dispose } = mkProfile();
  const ids = ['default', ...Array.from({ length: 8 }, (_, i) => 'cold-' + i)];
  const fields = (id, key, count, bytes) =>
    Array.from({ length: count }, (_, i) => ({ id: key + i, data: (id + '/' + key + '/' + i + ' ').padEnd(bytes, 'x') }));
  try {
    seed(profile, 'default');
    for (const id of ids.slice(1)) {
      seed(profile, id, {
        history: fields(id, 'history', 5000, 130),
        bookmarks: { roots: { bar: fields(id, 'bookmark', 400, 160), other: [] } },
        closedTabs: fields(id, 'tab', 60, 100),
        topSites: Object.fromEntries(fields(id, 'sites', 70, 100).map(x => [x.id, x])),
        logins: fields(id, 'login', 30, 120),
        chats: fields(id, 'chat', 300, 1400),
        memory: fields(id, 'memory', 50, 120),
        tasks: Array.from({ length: 12 }, (_, i) => row(id + '-task-' + i, { dueMs: START + 86_400_000 })),
        projects: fields(id, 'project', 40, 900),
        missions: fields(id, 'mission', 30, 900),
      });
    }
    const result = { off: [], on: [] };
    const readFileSync = fs.readFileSync;
    function measure(cold) {
      const f = fixture(profile, { cold, ids });
      f.open('main', 'default');
      global.gc();
      const heap0 = process.memoryUsage().heapUsed;
      let files = 0, bytes = 0;
      fs.readFileSync = function (file, ...args) {
        const data = readFileSync.call(this, file, ...args);
        if (typeof file === 'string' && file.startsWith(profile.dir)) {
          files++;
          bytes += Buffer.byteLength(data);
        }
        return data;
      };
      const t0 = performance.now();
      try { f.to(START + 5000); } finally { fs.readFileSync = readFileSync; }
      const elapsedMs = performance.now() - t0;
      global.gc();
      const heap = process.memoryUsage().heapUsed - heap0;
      assert.equal(f.accountCache.size, ids.length);
      assert.equal(f.notifications.length, 0);
      return { files, bytes, elapsedMs, heap };
    }
    for (let i = 0; i < 8; i++) {
      const order = i % 2 ? [true, false] : [false, true];
      for (const cold of order) result[cold ? 'on' : 'off'].push(measure(cold));
    }
    for (const key of Object.keys(result)) {
      const med = (field) => result[key].map(v => v[field]).sort((a, b) => a - b).slice(3, 5).reduce((a, b) => a + b) / 2;
      console.log(key, JSON.stringify(Object.fromEntries(['files', 'bytes', 'elapsedMs', 'heap'].map(field => [field, med(field)]))));
    }
  } finally { dispose(); }
} else {
  test('same notification and promotion ordering with multiple accounts/windows, then restart', async () => {
    async function run(cold, adaptive) {
      const { profile, dispose } = mkProfile();
      try {
        seed(profile, 'default', { tasks: [row('Active'), row('Completed', { done: true, doneAt: START-1 })] });
        const expected = seed(profile, 'cold-a', { tasks: [row('Cold pre'), row('Cold overdue', { dueMs: START-1 }), null] });
        seed(profile, 'cold-b', { tasks: [row('Other', { dueMs: START + 86_400_000 })] });
        const f = fixture(profile, { cold, adaptive });
        f.open('one', 'default');
        f.to(START + 4999);
        assert.equal(f.notifications.length, 0);
        f.to(START + 5000);
        assert.deepEqual(f.notifications.map(n => n[2]), ['Active', 'Cold pre', 'Cold overdue']);
        assert.equal(f.accountCache.get('cold-a').full, !cold);
        const pending = f.accountCache.get('cold-a').data.tasks;
        const promoted = f.open('two', 'cold-a');
        assert.equal(promoted.tasks, pending);
        assert.equal(f.open('three', 'cold-a'), promoted);
        assert.deepEqual(promoted.history, expected.history);
        assert.deepEqual(promoted.chats, expected.chats);
        const firstView = structuredClone(f.invoke('tasks-list', 'two'));
        assert.ok(firstView.find(t => t.title === 'Cold pre').remindedPre);
        assert.ok(firstView.find(t => t.title === 'Cold overdue').remindedDue);
        f.invoke('tasks-toggle', 'three', 'Cold pre', true);
        assert.deepEqual(f.broadcasts.map(b => b.slice(0, 2)),
          [['two', 'dex:tasks-updated'], ['three', 'dex:tasks-updated']]);
        assert.equal(f.invoke('tasks-list', 'one').length, 2);
        assert.deepEqual(f.invoke('tasks-list', 'two'), f.invoke('tasks-list', 'three'));
        f.to(START + 5400);
        const persisted = fromDisk(profile, 'cold-a');
        assert.equal(persisted.find(t => t.title === 'Cold overdue').remindedDue, true);
        assert.equal(persisted.find(t => t.title === 'Cold pre').done, true);
        f.flushAccounts();
        const f2 = fixture(profile, { cold, adaptive, now: START + 100_000 });
        f2.open('one', 'default');
        f2.to(START + 105_000);
        assert.deepEqual(f2.notifications.map(n => n[2]), ['Active']);
        assert.equal(f2.notifications[0][1], 'Dexerion Tasks — due now');
        f2.flushAccounts();
        return { notifications: [f.notifications, f2.notifications], persisted, broadcasts: f.broadcasts,
          delays: [...f2.timers.values()].map(t => t.delay) };
      } finally { dispose(); }
    }
    for (const adaptive of [false, true]) assert.deepEqual(await run(true, adaptive), await run(false, adaptive));
  });

  test('cold profile persists at 400ms or on quit, without touching other files', () => {
    for (const viaQuit of [false, true]) {
      const { profile, dispose } = mkProfile();
      try {
        seed(profile, 'default');
        seed(profile, 'cold-a', { tasks: [row('Cold')] });
        const chats = path.join(profile.accountDir('cold-a'), 'chats.json');
        fs.writeFileSync(chats, ' [ ]\n');
        const f = fixture(profile, { ids: ['default', 'cold-a'] });
        f.open('one', 'default');
        f.to(START + 5399);
        assert.equal(fromDisk(profile, 'cold-a')[0].remindedPre, false);
        if (viaQuit) f.flushAccounts(); else f.to(START + 5400);
        assert.equal(fromDisk(profile, 'cold-a')[0].remindedPre, true);
        assert.equal(fs.readFileSync(chats, 'utf8'), ' [ ]\n');
        assert.equal(f.accountCache.get('cold-a').full, false);
        assert.equal(fs.existsSync(taskFile(profile, 'cold-a') + '.tmp'), false);
        const next = fixture(profile, { ids: ['default', 'cold-a'], now: START + 10_000 });
        next.to(START + 15_000);
        assert.equal(next.notifications.length, 0);
      } finally { dispose(); }
    }
  });

  test('an interrupted cold save leaves old task data readable and a quit retry succeeds', () => {
    const { profile, dispose } = mkProfile();
    const rename = fs.renameSync;
    try {
      seed(profile, 'cold-a', { tasks: [row('Cold')] });
      const f = fixture(profile, { ids: ['cold-a'] });
      f.to(START + 5000);
      fs.renameSync = function (from, to) {
        if (to === taskFile(profile, 'cold-a')) throw new Error('simulated locked destination');
        return rename.call(this, from, to);
      };
      f.to(START + 5400);
      assert.equal(fromDisk(profile, 'cold-a')[0].remindedPre, false);
      assert.match(profile.lastError, /locked destination/);
      fs.renameSync = rename;
      f.flushAccounts();
      assert.equal(fromDisk(profile, 'cold-a')[0].remindedPre, true);
      assert.equal(fs.existsSync(taskFile(profile, 'cold-a') + '.tmp'), false);
    } finally { fs.renameSync = rename; dispose(); }
  });

  test('deleting during a pending cold write cannot resurrect deleted account data', async () => {
    for (const cold of [false, true]) {
      const { profile, dispose } = mkProfile();
      try {
        seed(profile, 'default');
        seed(profile, 'cold-a', { tasks: [row('Delete me')] });
        const f = fixture(profile, { cold, ids: ['default', 'cold-a'] });
        f.open('one', 'default');
        f.to(START + 5000);
        assert.equal(f.notifications.length, 1);
        assert.equal(await f.invoke('account-delete', 'one', 'cold-a'), true);
        f.to(START + 100_000);
        f.checkTaskReminders();
        f.flushAccounts();
        assert.equal(f.accountCache.has('cold-a'), false);
        assert.equal(fs.existsSync(profile.accountDir('cold-a')), false);
        assert.deepEqual(f.meta, [['default']]);
        assert.deepEqual(f.clearStorage, ['cold-a']);
        assert.equal(f.notifications.length, 1);
      } finally { dispose(); }
    }
  });

  test('missing, corrupt and BOM-prefixed data match the existing loader during the reminder sweep', () => {
    const { profile, dispose } = mkProfile();
    try {
      seed(profile, 'bad-bookmarks', { tasks: [row('Do not show')] });
      seed(profile, 'bom', { tasks: [row('Show BOM')] });
      seed(profile, 'corrupt');
      fs.writeFileSync(path.join(profile.accountDir('bad-bookmarks'), 'bookmarks.json'), 'null');
      fs.writeFileSync(taskFile(profile, 'bom'), '\uFEFF' + fs.readFileSync(taskFile(profile, 'bom'), 'utf8'));
      fs.writeFileSync(taskFile(profile, 'corrupt'), '{truncated:');
      for (const cold of [false, true]) {
        const f = fixture(profile, { cold, ids: ['missing', 'bad-bookmarks', 'bom', 'corrupt'] });
        f.to(START + 5000);
        assert.deepEqual(f.notifications.map(n => n[2]), ['Show BOM']);
        assert.equal(f.accountCache.has('bad-bookmarks'), false);
        for (const id of ['missing', 'corrupt']) assert.equal(f.accountCache.get(id).data.tasks.length, 0);
      }
    } finally { dispose(); }
  });
}
