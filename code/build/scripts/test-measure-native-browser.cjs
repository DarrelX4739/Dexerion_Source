'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { browserArgs, debugPort, edgeExecutable, pagesIn, isShellUrl } = require('./measure-native-browser.cjs');

test('launches each binary with no automation flags that change isolation or throttling', () => {
  const profile = path.join(os.tmpdir(), 'isolated profile');
  const common = ['--user-data-dir=' + profile, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'];
  assert.deepEqual(browserArgs('dexerion', profile), ['.', ...common]);
  assert.deepEqual(browserArgs('edge', profile), [...common, '--no-first-run', '--no-default-browser-check', 'about:blank']);
  assert.throws(() => browserArgs('unknown', profile), /Unknown browser/);
});

test('accepts only an ephemeral port from the known temporary profile', (t) => {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-native-port-test-'));
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  const f = path.join(p, 'DevToolsActivePort');
  assert.equal(debugPort(p), 0);
  fs.writeFileSync(f, '39921\r\n/devtools/browser/sample');
  assert.equal(debugPort(p), 39921);
  for (const invalid of ['0', '65536', '8080.1', 'http://localhost:8080', '8080junk']) {
    fs.writeFileSync(f, invalid);
    assert.equal(debugPort(p), 0);
  }
});

test('looks up the installed Edge binary and matches only local Dexerion shell targets', () => {
  const roots = { 'ProgramFiles(x86)': 'first', ProgramFiles: 'second' };
  const edge = path.join('second', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
  assert.equal(edgeExecutable(roots, (f) => f === edge), edge);
  assert.throws(() => edgeExecutable({}, () => true), /not found/);
  assert.equal(isShellUrl('file:///C:/test/code/src/renderer/shell.html'), true);
  assert.equal(isShellUrl('https://example.test/src/renderer/shell.html'), false);
  assert.equal(isShellUrl('file:///C:/test/code/src/renderer/shell.html.old'), false);
  assert.deepEqual(pagesIn({ contexts: () => [{ pages: () => [1] }, { pages: () => [2, 3] }] }), [1, 2, 3]);
});
