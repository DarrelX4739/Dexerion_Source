'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { performance } = require('node:perf_hooks');
const { test } = require('node:test');

const profilePath = path.resolve(__dirname, '../../code/src/main/profile.js');
const source = fs.readFileSync(profilePath, 'utf8');

function profileFor(code, dir, file = profilePath) {
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = module.paths;
  const baseLoad = Module._load;
  Module._load = function (name, ...rest) {
    return name === 'electron' ? { app: { getPath: () => dir } } : baseLoad.call(this, name, ...rest);
  };
  try {
    loaded._compile(code, file);
    return new loaded.exports.ProfileStore();
  } finally { Module._load = baseLoad; }
}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexerion-reminder-bookmarks-'));
  const dispose = () => fs.rmSync(dir, { recursive: true, force: true });
  if (t) t.after(dispose);
  const profile = profileFor(source, dir);
  return { profile, dir, dispose };
}
function setFile(profile, id, name, bytes) {
  const dir = profile.accountDir(id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name + '.json'), bytes);
}
const tasks = [{ id: 'one', title: 'Kept task', dueMs: 2_000_000 }];
const legacyIsNull = bytes => {
  try { return JSON.parse(Buffer.from(bytes).toString('utf8').replace(/^\uFEFF/, '')) === null; }
  catch { return false; }
};

if (process.argv.includes('--bench')) {
  assert.ok(global.gc, 'run --bench with node --expose-gc');
  const original = fs.readFileSync(process.argv.at(-1), 'utf8');
  const f = fixture();
  // Compare an anchored expression and an imperative character scanner
  // with the unanchored non-whitespace searches in the shipped helper.
  const first = source.indexOf('function isNullJson(');
  const last = source.indexOf('// Atomic write:', first);
  assert.ok(first > 0 && last > first);
  const variant = body => source.slice(0, first) +
    'function isNullJson(text) {' + body + '}\n\n' + source.slice(last);
  const anchored = variant('return /^\\uFEFF?[ \\t\\r\\n]*null[ \\t\\r\\n]*(?![\\s\\S])/.test(text);');
  const scanner = variant(`
    let start = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
    const ws = c => c === 32 || c === 9 || c === 13 || c === 10;
    while (ws(text.charCodeAt(start))) start++;
    if (!text.startsWith('null', start)) return false;
    let end = start + 4;
    while (ws(text.charCodeAt(end))) end++;
    return end === text.length;
  `);
  const modes = {
    old: profileFor(original, f.dir), lexical: f.profile,
    anchored: profileFor(anchored, f.dir), scanner: profileFor(scanner, f.dir),
  };
  try {
    for (const [accounts, count] of [[6, 150], [12, 3500]]) {
      const ids = Array.from({ length: accounts }, (_, i) => 'dormant-' + i);
      for (const id of ids) {
        const bar = Array.from({ length: count }, (_, i) => ({
          id: 'b' + i, type: 'bookmark', title: id + ' bookmark ' + i,
          url: 'https://example.test/' + i + '/' + id, added: 1_900_000 + i,
        }));
        setFile(f.profile, id, 'bookmarks', JSON.stringify({ roots: { bar, other: [] } }, null, 2));
        setFile(f.profile, id, 'tasks', JSON.stringify(tasks));
      }
      const bytes = ids.reduce((sum, id) => sum + fs.statSync(path.join(f.profile.accountDir(id), 'bookmarks.json')).size, 0);
      const samples = Object.fromEntries(Object.keys(modes).map(key => [key, []]));
      function sample(prof) {
        global.gc();
        const baseline = process.memoryUsage().heapUsed;
        let peak = 0;
        let time = 0;
        for (const id of ids) {
          const t0 = performance.now();
          const result = prof.loadAccountReminderData(id);
          time += performance.now() - t0;
          peak = Math.max(peak, process.memoryUsage().heapUsed - baseline);
          assert.deepEqual(result.tasks, tasks);
        }
        global.gc();
        return { time, peak, retained: process.memoryUsage().heapUsed - baseline };
      }
      const keys = Object.keys(modes);
      for (let i = 0; i < 9; i++) {
        for (let j = 0; j < keys.length; j++) {
          const name = keys[(i + j) % keys.length];
          samples[name].push(sample(modes[name]));
        }
      }
      const modeStats = Object.fromEntries(keys.map(key => [key, Object.fromEntries(
        ['time', 'peak', 'retained'].map(field => [field, samples[key].map(x => x[field]).sort((a,b) => a-b)[4]]))]));
      console.log(JSON.stringify({ accounts, count, bytes, ...modeStats }));
    }
  } finally { f.dispose(); }
} else {
  test('the file probe is exactly the old JSON-null result across BOM, whitespace and malformed bytes', (t) => {
    const f = fixture(t);
    const id = 'dormant';
    setFile(f.profile, id, 'tasks', JSON.stringify(tasks));
    const candidates = [
      'null', '\uFEFFnull', '\uFEFF \t\r\nnull\r\t\n ', ' \uFEFFnull', '\uFEFF\uFEFFnull',
      'null\u2028', 'null\u2029', 'null\uFEFF', 'null\u0000', 'null\r\nnull', 'NULL', '"null"', '[null]',
      '{}', 'true', '1', '', 'nul', '{"roots":null}', '{truncated:', 'null /* comment */',
      Buffer.from([0xef, 0xbb, 0xbf, 0x6e, 0x75, 0x6c, 0x6c, 0xff]),
      Buffer.from([0xef, 0xbb, 0x6e, 0x75, 0x6c, 0x6c]),
      ' '.repeat(65536) + 'null' + '\n'.repeat(65536),
      'null' + ' '.repeat(1048576) + '\u2028',
    ];
    const spaces = Array.from({ length: 33 }, (_, i) => String.fromCharCode(i)).concat([
      '\u0085', '\u00A0', '\u1680', '\u2000', '\u2003', '\u200B', '\u2028', '\u2029', '\u202F', '\u205F', '\u3000', '\uFEFF',
    ]);
    for (const space of spaces) {
      candidates.push(space + 'null', 'null' + space, '\uFEFF' + space + 'null' + space);
    }
    for (const bytes of candidates) {
      setFile(f.profile, id, 'bookmarks', bytes);
      if (legacyIsNull(bytes)) {
        assert.throws(() => f.profile.loadAccountReminderData(id), { name: 'TypeError', message: 'Invalid account bookmarks' });
        assert.throws(() => f.profile.loadAccountData(id), TypeError);
      } else {
        assert.deepEqual(f.profile.loadAccountReminderData(id), { tasks });
        assert.deepEqual(f.profile.loadAccountData(id).tasks, tasks);
      }
    }
  });

  test('missing or unreadable bookmarks still return tasks and full activation still parses its real bookmark tree', (t) => {
    const f = fixture(t);
    const id = 'dormant';
    setFile(f.profile, id, 'tasks', '\uFEFF' + JSON.stringify(tasks));
    assert.deepEqual(f.profile.loadAccountReminderData(id), { tasks });
    const bookmarks = { roots: { bar: [{ id: 'bookmark-1', url: 'https://example.test', title: 'A bookmark' }], other: [] } };
    setFile(f.profile, id, 'bookmarks', '\uFEFF' + JSON.stringify(bookmarks));
    const oldRead = fs.readFileSync;
    fs.readFileSync = function (file, ...opts) {
      if (file === path.join(f.profile.accountDir(id), 'bookmarks.json')) {
        assert.equal(opts[0], 'utf8');
        throw Object.assign(new Error('Permission denied'), { code: 'EACCES' });
      }
      return oldRead.call(this, file, ...opts);
    };
    try { assert.deepEqual(f.profile.loadAccountReminderData(id), { tasks }); }
    finally { fs.readFileSync = oldRead; }
    assert.deepEqual(f.profile.loadAccountReminderData(id), { tasks });
    assert.deepEqual(f.profile.loadAccountData(id).bookmarks, bookmarks);
    setFile(f.profile, id, 'bookmarks', 'null');
    setFile(f.profile, id, 'tasks', 'bad task JSON');
    assert.throws(() => f.profile.loadAccountReminderData(id), TypeError, 'a null bookmark probe still runs before loading tasks');
  });

  test('reminders parse only tasks, while normal account activation continues to parse bookmarks', (t) => {
    const f = fixture(t);
    const id = 'dormant';
    const bookmarks = { roots: { bar: [{ id: 'bookmark-1', url: 'https://example.test', title: 'A bookmark' }], other: [] } };
    setFile(f.profile, id, 'bookmarks', JSON.stringify(bookmarks));
    setFile(f.profile, id, 'tasks', JSON.stringify(tasks));
    const oldParse = JSON.parse;
    const reads = [];
    JSON.parse = function (text, ...rest) {
      reads.push(text);
      return oldParse.call(this, text, ...rest);
    };
    try {
      assert.deepEqual(f.profile.loadAccountReminderData(id), { tasks });
      assert.deepEqual(reads, [JSON.stringify(tasks)]);
      assert.deepEqual(f.profile.loadAccountData(id).bookmarks, bookmarks);
      assert.ok(reads.includes(JSON.stringify(bookmarks)));
    } finally { JSON.parse = oldParse; }
  });
}
