'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const { savedSiteChat, writeChats } = require('./fixtures/saved-site-history.cjs');
const { applySourceEdit, restoreVersion } = require('../../code/src/main/ai-artifact-edit');

const sourceFile = path.resolve(__dirname, '../../code/src/main/profile.js');
function fixture(t, onRepeat) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-saved-source-share-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = fs.readFileSync(sourceFile, 'utf8');
  const module = { exports: {} };
  const realRequire = createRequire(sourceFile);
  const localRequire = name => name === 'electron' ? { app: { getPath: () => dir } } : realRequire(name);
  const TrackedMap = onRepeat ? class extends Map {
    get(key) {
      const old = super.get(key);
      if (old !== undefined) onRepeat(key);
      return old;
    }
  } : Map;
  new Function('require', 'module', 'Map', source)(localRequire, module, TrackedMap);
  return { dir, store: new module.exports.ProfileStore() };
}

const siteOf = chat => chat.messages[1].artifact;
const styleOf = site => site.files.find(file => file.path === 'styles.css');

test('the account reader shares repeated long source values without aliasing versions or re-writing a file', (t) => {
  const repeated = [];
  const { dir, store } = fixture(t, value => repeated.push(value));
  const original = savedSiteChat();
  const expected = JSON.parse(JSON.stringify([original]));
  const filename = writeChats(dir, 'default', [original]);
  const bytes = fs.readFileSync(filename);
  const [loaded] = store.loadAccountData('default').chats;
  assert.deepEqual([loaded], expected);
  assert.deepEqual(fs.readFileSync(filename), bytes);
  const current = siteOf(loaded);
  const previous = current.history[0].artifact;
  assert.ok(repeated.some(value => value === styleOf(current).content), 'the repeated stylesheet must use the shared backing path');
  assert.notEqual(current, previous);
  assert.notEqual(current.files, previous.files);
  assert.notEqual(styleOf(current), styleOf(previous));
  const previousStyle = styleOf(previous).content;
  styleOf(current).content = 'body{color:red}';
  assert.equal(styleOf(previous).content, previousStyle);

  const empty = store.loadAccountData('missing').chats;
  assert.deepEqual(empty, []);
  const other = savedSiteChat('other', 2123);
  writeChats(dir, 'work', [other]);
  assert.deepEqual(store.loadAccountData('work').chats, JSON.parse(JSON.stringify([other])));
});

test('Unicode-distinct values and malformed saved rows are not changed', (t) => {
  const { dir, store } = fixture(t);
  const alpha = 'sample'.repeat(1_000) + '\ud800';
  const beta = 'sample'.repeat(1_000) + '\ud801';
  const weird = [
    null, { messages: [null, false, { artifact: 8 }, { artifact: { kind: 'report', html: alpha } },
      { artifact: { kind: 'site', html: alpha, files: [null, { content: beta }, { content: alpha }],
        history: [null, { artifact: { kind: 'site', html: beta, files: [] } }] } }] }, { messages: 'legacy' },
  ];
  const filename = writeChats(dir, 'default', weird);
  assert.deepEqual(store.loadAccountData('default').chats, weird);
  fs.writeFileSync(filename, '{"incomplete":');
  assert.deepEqual(store.loadAccountData('default').chats, []);
});

test('saved code, undo and atomic re-save preserve the same artifacts after restart', (t) => {
  const { dir, store } = fixture(t);
  const original = savedSiteChat();
  writeChats(dir, 'default', [original]);
  const loaded = store.loadAccountData('default');
  const chat = loaded.chats[0];
  const current = siteOf(chat);
  const before = current.history[0].artifact;
  const expectedUndo = restoreVersion(JSON.parse(JSON.stringify(siteOf(original))), current.history[0].at);
  const undo = restoreVersion(current, current.history[0].at);
  assert.ok(undo.ok && expectedUndo.ok, undo.error);
  assert.equal(undo.artifact.html, before.html);
  assert.deepEqual(undo.artifact.files, before.files);
  assert.equal(undo.artifact.html, expectedUndo.artifact.html);
  const changed = applySourceEdit(undo.artifact, {
    files: undo.artifact.files.map(file => file.path === 'index.html'
      ? { ...file, content: file.content.replace('Saved site edition 2', 'After restart') } : file),
    note: 'after startup',
  });
  assert.ok(changed.ok, changed.error);
  chat.messages[1].artifact = changed.artifact;
  assert.equal(store.saveAccountData('default', loaded), true);
  assert.deepEqual(store.loadAccountData('default').chats, JSON.parse(JSON.stringify(loaded.chats)));
  const content = fs.readFileSync(path.join(dir, 'Accounts', 'default', 'chats.json'), 'utf8');
  assert.equal(content, JSON.stringify(loaded.chats, null, 2));
});
