'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const fixtures = require('./full-app-baseline.cjs');

test('fixtures cannot transfer the synthetic password as a form field', () => {
  const login = fixtures.fixtureHtml('/login');
  assert.match(login, /type="password"/);
  assert.doesNotMatch(login, /name=(["'])password\1|Synthetic-Password/);
  assert.doesNotMatch(fixtures.fixtureHtml('/handshake'), /input|http/);
});

test('seed is valid, tied to disposable profile and grants no extension privileges', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-full-ram-browser-'));
  try {
    assert.throws(() => fixtures.seedExtension(path.join(root, 'non-test')));
    fixtures.seedExtension(root);
    const [entry] = JSON.parse(fs.readFileSync(path.join(root, 'extensions.json'), 'utf8'));
    assert.equal(path.relative(root,entry.path), path.join('Extensions','fixture'));
    const manifest = JSON.parse(fs.readFileSync(path.join(entry.path, 'manifest.json'), 'utf8'));
    assert.equal(manifest.manifest_version,3);
    assert.deepEqual(Object.keys(manifest).sort(), ['content_scripts','manifest_version','name','version']);
    assert.equal(manifest.content_scripts.length,1);
    assert.equal(manifest.content_scripts[0].matches.length,2);
    assert.ok(manifest.content_scripts[0].matches.every(x => /^http:\/\/(owner|other)\.dex-test\.localhost\/\*$/.test(x)));
  } finally { fs.rmSync(root, {recursive:true, force:true}); }
});

test('expectations are assertions only, not app switches', () => {
  assert.equal(fixtures.runSettings({}).want, false);
  assert.equal(fixtures.runSettings({}).strict, false);
  assert.equal(fixtures.runSettings({ DEX_RAM_EXPECT_WEB_SANDBOX:'1' }).want, true);
  assert.throws(() => fixtures.runSettings({DEX_RAM_EXPECT_WEB_SANDBOX:'yes'}));
});

test('local fixture permits only fixed host/method/route and never reflects strings', async () => {
  const fixture = await fixtures.startFixture();
  try {
    const expected = new URL(fixture.owner);
    const request = (route, host = expected.host, method = 'GET') => new Promise((resolve, reject) => {
      const req = http.request({ host:'127.0.0.1',port:Number(expected.port),path:route,method,headers:{host}},
        res => {let body='';res.setEncoding('utf8');res.on('data',s=>{body+=s;});res.on('end',()=>resolve([res.statusCode,body]));});
      req.on('error',reject);req.end();
    });
    const [code, body] = await request('/login?visit=2');
    assert.equal(code,200);assert.match(body,/full-app-ram-fixture-v1/);assert.doesNotMatch(body,/visit=2/);
    assert.equal((await request('/login?stray=data'))[0],404);
    assert.equal((await request('/login','foreign.invalid'))[0],404);
    assert.equal((await request('/login',expected.host,'POST'))[0],404);
    assert.equal(fixture.count(),1);
  } finally { await fixture.close(); }
});
