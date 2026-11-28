'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeArtifact } = require('../../../code/src/main/ai-artifacts');
const { applySourceEdit } = require('../../../code/src/main/ai-artifact-edit');

function savedSiteChat(id = 'saved-site', offset = 0) {
  const css = 'body{font-family:system-ui;color:#243345;background:white}\n'
    + Array.from({ length: 260 }, (_, n) => '.fixture-' + n + '{padding:' + (n % 9 + 1)
      + 'px;color:#' + (0x324852 + n + offset).toString(16) + ';}').join('\n');
  function files(version) {
    return [
      { path: 'index.html', content: '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Site edition '
        + version + '</title><link rel="stylesheet" href="styles.css"></head><body><main>'
        + '<h1 data-testid="saved-site-edition">Saved site edition ' + version + '</h1>'
        + '<p>Local example text with a quoted "title", café ☕ and Unicode Ω.</p></main></body></html>' },
      { path: 'styles.css', content: css },
    ];
  }
  const first = normalizeArtifact({ kind: 'site', title: 'Saved local site', files: files(1) });
  assert.ok(first.ok, first.error);
  const second = applySourceEdit(first.artifact, { files: files(2), note: 'second edition' });
  assert.ok(second.ok && second.undoable, second.error);
  const third = applySourceEdit(second.artifact, { files: files(3), note: 'third edition' });
  assert.ok(third.ok && third.undoable, third.error);
  const now = Date.now();
  return {
    id, title: 'Saved site conversation', createdAt: now - 10_000, updatedAt: now,
    messages: [
      { id: 'request-site', role: 'user', text: 'Please make an offline site', ts: now - 1_000 },
      { id: 'answer-site', role: 'model', text: 'Here is the local website.', ts: now, artifact: third.artifact },
    ],
  };
}

function writeChats(profileDir, id, chats) {
  const account = path.join(profileDir, 'Accounts', id);
  fs.mkdirSync(account, { recursive: true });
  fs.writeFileSync(path.join(account, 'bookmarks.json'), JSON.stringify({ roots: { bar: [], other: [] } }));
  const filename = path.join(account, 'chats.json');
  fs.writeFileSync(filename, JSON.stringify(chats, null, 2));
  return filename;
}

module.exports = { savedSiteChat, writeChats };
