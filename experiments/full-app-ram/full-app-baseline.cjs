'use strict';

// Actual Dexerion, throwaway profile, no monkey patch or Chromium sandbox switch.
// This verifies the stock app, not a proposed sandbox setting or Edge comparison.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { createRequire } = require('node:module');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');

const CONTENT = 'read-only-local-mv3-fixture';
const USER = 'dexerion-fixture-user';
const SECRET = 'Synthetic-Password-Only-39.';
const MARKER = 'full-app-ram-fixture-v1';
const RUN_PREFIX = 'dex-full-ram-browser-';
const ORIGIN_NAMES = ['owner.dex-test.localhost', 'other.dex-test.localhost'];
const ROUTES = ['/login', '/login?visit=2', '/login?visit=3', '/submitted', '/handshake'];
const LIMIT = 32;

function fixtureHtml(route) {
  let body = '';
  if (route === '/login') {
    body = '<form action="/submitted" method="get"><label>Local username<input id="username" autocomplete="username"></label>' +
      '<label>Local password<input id="password" type="password" autocomplete="current-password"></label>' +
      '<button id="submit" type="submit">Submit synthetic form</button></form>';
  }
  if (route === '/handshake') {
    body = '<button id="handshake" type="button">Send synthetic result</button>';
  }
  return '<!doctype html><meta charset=utf-8><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Full app RAM gate ' + route + '</title><main id="fixture" data-proof="' + MARKER +
    '"><h1>Local synthetic compatibility only</h1>' + body + '</main>';
}

async function startFixture() {
  let port;
  let requests = 0;
  const server = http.createServer((req, res) => {
    const legalHost = ORIGIN_NAMES.some(host => req.headers.host === host + ':' + port);
    if (!legalHost || req.method !== 'GET' || !ROUTES.includes(req.url) || requests >= LIMIT) {
      res.writeHead(404, { 'Connection': 'close' }).end(); return;
    }
    ++requests;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Connection': 'close' }).end(fixtureHtml(req.url.split('?', 1)[0]));
  });
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  port = server.address().port;
  return {
    owner: 'http://' + ORIGIN_NAMES[0] + ':' + port,
    other: 'http://' + ORIGIN_NAMES[1] + ':' + port,
    count: () => requests,
    close: () => new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve())),
  };
}

function seedExtension(profile) {
  assert.equal(path.dirname(profile), os.tmpdir());
  assert.ok(path.basename(profile).startsWith(RUN_PREFIX));
  const ext = path.join(profile, 'Extensions', 'fixture');
  fs.mkdirSync(ext, { recursive: true });
  const name = 'Dexerion RAM Gate Synthetic Extension';
  const version = '1.0.0';
  fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify({
    name, version, manifest_version: 3, content_scripts: [{
      matches: ORIGIN_NAMES.map(host => 'http://' + host + '/*'),
      run_at: 'document_end', js: ['marker.js'],
    }],
  }));
  fs.writeFileSync(path.join(ext, 'marker.js'),
    'document.documentElement.dataset.dexFixtureExtension = ' + JSON.stringify(CONTENT) + ';\n');
  // Snapshot of the public install format, created only inside the fixture.
  // The real extension manager restores it in the normal launch/partition path.
  fs.writeFileSync(path.join(profile, 'extensions.json'), JSON.stringify([{
    ids: {}, name, version, description: '', path: ext, enabled: true,
    manifestVersion: 3, permissions: [], hostPermissions: [], installedAt: 1700000000000,
  }]));
}

async function poll(fn, validate, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (true) {
    const value = await fn();
    if (validate(value)) return value;
    if (Date.now() >= end) throw new Error('Timed out: ' + label);
    await delay(100);
  }
}

function checkOwnerInputs(input) {
  assert.deepEqual(input, { user: true, secret: true, injected: true });
}

function runSettings(env = process.env) {
  const strict = env.DEX_RAM_REQUIRE_WINDOWS_SANDBOX_METRIC || '0';
  const want = env.DEX_RAM_EXPECT_WEB_SANDBOX || '0';
  assert.match(strict, /^[01]$/);
  assert.match(want, /^[01]$/);
  const repo = path.resolve(env.DEX_RAM_REPO || path.join(__dirname, '..', '..'));
  const build = path.join(repo, 'code', 'build');
  const electronPath = env.DEX_RAM_ELECTRON ? path.resolve(env.DEX_RAM_ELECTRON) : null;
  return { strict: strict === '1', want: want === '1', build, electronPath };
}

async function main() {
  const { strict, want, build, electronPath } = runSettings();
  if (strict) assert.equal(process.platform, 'win32');
  const req = createRequire(path.join(build, 'package.json'));
  const { _electron } = req('@playwright/test');
  // Do not inherit generic flags which turn off the sandbox or redirect app startup.
  for (const key of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'ELECTRON_DISABLE_SECURITY_WARNINGS',
    'PLAYWRIGHT_ELECTRON_LEGACY_PAGE_CLOSE', 'CHROME_DEVEL_SANDBOX']) {
    assert.equal(process.env[key], undefined, 'Inherited test environment is not clean: ' + key);
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), RUN_PREFIX));
  const fixture = await startFixture();
  let app;
  const checks = {};
  try {
    seedExtension(profile);
    app = await _electron.launch({
      executablePath: electronPath || req('electron'), cwd: build,
      args: ['.', '--user-data-dir=' + profile], chromiumSandbox: true,
      env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^DEX_/i.test(key))),
        NODE_PATH: path.join(build, 'node_modules'), DEX_AI_TEST: '1' },
      timeout: 60000,
    });
    console.error('[full-app-ram] desktop launch');
    const runtime = await app.evaluate(({ app: main }, key) => {
      const p = process.getBuiltinModule('path');
      return { version: process.versions.electron, profile: p.relative(main.getPath('userData'), key),
        shellBypass: ['no-sandbox', 'disable-setuid-sandbox', 'disable-web-security',
          'disable-site-isolation-trials', 'no-zygote'].filter(s => main.commandLine.hasSwitch(s)) };
    }, profile);
    assert.deepEqual(runtime, {version:'44.4.5', profile:'', shellBypass:[]});
    const shell = await app.firstWindow({ timeout: 30000 });
    await shell.waitForLoadState('domcontentloaded');
    const invoke = (page, channel, ...args) =>
      page.evaluate(({ channel, args }) => window.dexerion.invoke(channel, ...args), { channel, args });
    const state = page => invoke(page, 'dex:get-state');
    const show = (url, page = shell) => invoke(page, 'dex:new-tab', url, false);
    assert.equal((await state(shell)).account.id, 'default');
    const activeFixture = async (url, page = shell) => {
      const id = await show(url, page);
      const st = await poll(() => state(page),
        x => x?.active === id && x.tabs.some(t => t.id === id && t.url === url && !t.loading),
        'active loaded content tab: ' + new URL(url).pathname);
      assert.deepEqual(st.tabs.filter(t => t.url === url).map(t => t.id), [id]);
      return poll(() => app.evaluate(({ webContents }, url) => {
        const exact = webContents.getAllWebContents().filter(w => !w.isDestroyed() && w.getURL() === url);
        if (exact.length > 1) throw new Error('Duplicate renderer for unique fixture route');
        return exact[0]?.id;
      }, url), Number.isInteger, 'ready exact URL: ' + new URL(url).pathname);
    };
    const exec = (id, code, gesture = false) => app.evaluate(async ({ webContents }, payload) => {
      const wc = webContents.fromId(payload.id);
      if (!wc || wc.isDestroyed()) throw new Error('Selected fixture surface disappeared');
      const parsed = new URL(wc.getURL());
      if (!payload.origins.includes(parsed.origin) || !payload.routes.includes(parsed.pathname + parsed.search))
        throw new Error('Refusing to drive a non-fixture renderer');
      return wc.executeJavaScript(payload.code, payload.gesture);
    }, { id, code, gesture, origins:[fixture.owner, fixture.other], routes:ROUTES });
    const marker = id => poll(() => exec(id, '(document.querySelector("#fixture")?.dataset.proof || "") + ":" + (document.documentElement.dataset.dexFixtureExtension || "")'),
      result => result === MARKER + ':' + CONTENT, 'browser-visible fixture and installed extension');
    const exactMetrics = id => poll(() => app.evaluate(({ app: main, webContents }, id) => {
      const wc = webContents.fromId(id);
      const pid = wc?.getOSProcessId();
      const row = main.getAppMetrics().find(m => m.pid === pid && m.type === 'Tab');
      return row && { pid:row.pid, creationTime:row.creationTime, sandboxed:row.sandboxed ?? null,
        workingSetKiB:row.memory?.workingSetSize ?? null };
    }, id), x => Number.isInteger(x?.pid) && x.pid > 0 && x.creationTime > 0, 'exact renderer OS process counter');
    async function checkedMetrics(id) {
      const a = await exactMetrics(id);
      const b = await exactMetrics(id);
      assert.equal(a.pid, b.pid);
      assert.equal(a.creationTime, b.creationTime);
      assert.equal(a.sandboxed, b.sandboxed);
      if (strict || b.sandboxed != null) assert.equal(b.sandboxed, want);
      // This single process reading may be shared by multiple same-site
      // surfaces and is working set, not private resident or a RAM delta.
      return { sandboxed:b.sandboxed, stablePid:true, workingSetKiB:b.workingSetKiB };
    }
    const probe = id => exec(id, `(async()=>{
      const api = window.dexerion;
      const privilegeDenied = await api.invoke('dex:get-state').then(() => false, e => /not available/.test(String(e.message)));
      const foreignOriginDenied = await api.invoke('dex:login-query', {origin: 'http://foreign.invalid'}).then(() => false, e => /denied/.test(String(e.message)));
      const nonGoogleAccepted = await api.invoke('dex:google-detected', {email:'fixture@example.invalid'});
      return { privilegeDenied, foreignOriginDenied, nonGoogleAccepted,
        node: typeof process !== 'undefined' || typeof require !== 'undefined' };
    })()`);
    const guards = { privilegeDenied:true, foreignOriginDenied:true, nonGoogleAccepted:false, node:false };
    const originLogin = fixture.owner + '/login';
    console.error('[full-app-ram] credential manager and renderer guards');
    const tab = await activeFixture(originLogin);
    await marker(tab);
    const tabMetric = await checkedMetrics(tab);
    assert.deepEqual(await probe(tab), guards);
    checks.tabMetric = tabMetric;

    // Exercise the product's *injected* helper and real Save button, not a stub
    // login IPC or stored profile-password injection. Inputs have no name, so
    // the fake password cannot appear in the HTTP request.
    await poll(() => exec(tab, '!!window.__dexCred && !!document.querySelector("form")?.__dexWatched'),
      Boolean, 'product login capture helper');
    await exec(tab, `(() => {
      const f=document.querySelector('form');
      f.addEventListener('submit', e=>e.preventDefault(),{once:true});
      document.querySelector('#username').value=${JSON.stringify(USER)};
      document.querySelector('#password').value=${JSON.stringify(SECRET)};
      f.requestSubmit();
    })()`, true);
    await shell.waitForSelector('#loginbar:not([hidden])', { timeout: 15000 });
    assert.match(await shell.locator('#loginbar-tx').innerText(), /dexerion-fixture-user/);
    await shell.locator('#loginbar-save').click();
    await poll(async () => (await invoke(shell,'dex:logins')).some(r => r.origin === fixture.owner && r.username === USER),
      Boolean, 'saved via real trusted shell');
    // Navigate to a fresh document before checking autofill. Same origin,
    // separate owned surface so prior input values cannot satisfy it.
    const tab2 = await activeFixture(originLogin + '?visit=2');
    assert.notEqual(tab2, tab);
    await marker(tab2);
    const autofill = await poll(() => exec(tab2,`({
      user: document.querySelector('#username')?.value === ${JSON.stringify(USER)},
      secret: document.querySelector('#password')?.value === ${JSON.stringify(SECRET)},
      injected: !!window.__dexCred
    })`), x => x?.user && x?.secret && x?.injected, 'actual normal-tab password autofill');
    checkOwnerInputs(autofill);
    checks.realCredentialManager = true;

    // Existing local web opener contract, not a Google endpoint or a
    // replacement authentication flow. The named open carries no credentials.
    console.error('[full-app-ram] native popup and opener/storage handshake');
    const popupUrl = fixture.owner + '/handshake';
    const opened = await exec(tab2, `(() => {
      window.__ramFixtureAck = false;
      addEventListener('message', e => {
        if (e.origin === location.origin && e.data === 'synthetic-opener-ack') window.__ramFixtureAck=true;
      }, { once:true });
      localStorage.setItem('dex-full-app-marker','default-account');
      window.open(${JSON.stringify(popupUrl)},'oauth2','popup,width=520,height=460');
      return true;
    })()`, true);
    assert.equal(opened, true);
    const popup = await poll(() => app.evaluate(({ BrowserWindow }, url) =>
      BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.webContents.getURL() === url)?.webContents.id,
    popupUrl), Number.isInteger, 'actual popup window');
    await marker(popup);
    const popupMetric = await checkedMetrics(popup);
    assert.equal(await exec(popup, `(() => {
      if (localStorage.getItem('dex-full-app-marker') !== 'default-account' || !window.opener) return false;
      window.opener.postMessage('synthetic-opener-ack',location.origin);
      return true;
    })()`), true);
    await poll(() => exec(tab2, 'window.__ramFixtureAck === true'), Boolean, 'popup opener round trip');
    assert.deepEqual(await probe(popup), guards);
    // The app does not register ordinary popup contents as credential-tab senders.
    assert.equal(await exec(popup, `window.dexerion.invoke('dex:login-query',{origin:location.origin}).then(()=>false,e=>/denied/.test(e.message))`), true);
    checks.popup = { sharesStorage: true, liveOpener: true, plainPopupCredentialAccessDenied: true, metric: popupMetric };
    await app.evaluate(({ BrowserWindow }, id) => {
      BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.webContents.id === id)?.close();
    }, popup);

    console.error('[full-app-ram] account and origin isolation');
    const foreign = await activeFixture(fixture.other + '/login');
    await marker(foreign);
    const sameOriginUse = `window.dexerion.invoke('dex:login-query',{origin:location.origin}).then(xs=>xs.length)`;
    assert.equal(await exec(foreign, sameOriginUse), 0, 'origin B incorrectly obtained origin A credential');
    assert.equal(await exec(foreign, 'localStorage.getItem("dex-full-app-marker")'), null);

    const account = await invoke(shell, 'dex:account-create', { name:'RAM Gate Synthetic Account' });
    assert.ok(account?.id && account.id !== 'default');
    await invoke(shell, 'dex:account-switch', account.id);
    let secondary;
    await poll(async () => {
      for (const w of app.windows()) {
        if (w === shell || !w.url().startsWith('file:')) continue;
        try { if ((await state(w))?.account?.id === account.id) { secondary = w; return true; } } catch {}
      }
      return false;
    }, Boolean, 'second account shell');
    const separate = await activeFixture(originLogin + '?visit=3', secondary);
    assert.notEqual(separate, tab); assert.notEqual(separate, tab2);
    await marker(separate);
    assert.equal(await exec(separate, sameOriginUse), 0, 'second account incorrectly obtained default account credential');
    assert.equal(await exec(separate, 'localStorage.getItem("dex-full-app-marker")'), null);
    assert.deepEqual(await invoke(secondary, 'dex:logins'), []);
    assert.deepEqual(await exec(tab2, 'localStorage.getItem("dex-full-app-marker")'), 'default-account');
    checks.isolation = { wrongOriginDenied: true, differentAccountSeparated: true, extensionRestoredBoth: true };

    assert.ok(fixture.count() >= 5);
    return { electron: runtime.version, platform: process.platform, sandboxExpectation: want,
      windowsCounterRequired: strict, appModified: false, checks,
      limitation: 'Synthetic standalone real-app baseline only. No Edge, RAM reduction, real OAuth, extension store, or alternative sandbox configuration tested.' };
  } finally {
    try { if (app) await app.close(); }
    finally {
      try { await fixture.close(); }
      finally { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 }); }
    }
  }
}

function verifyResult(result, {strict, want} = runSettings()) {
  assert.equal(result.electron, '44.4.5');
  assert.equal(result.platform, process.platform);
  assert.equal(result.appModified, false);
  assert.equal(result.windowsCounterRequired, strict);
  assert.equal(result.sandboxExpectation, want);
  if (strict) assert.equal(result.platform, 'win32');
  const { tabMetric, realCredentialManager, popup, isolation } = result.checks;
  assert.equal(realCredentialManager, true);
  assert.deepEqual(isolation, { wrongOriginDenied:true, differentAccountSeparated:true, extensionRestoredBoth:true });
  assert.deepEqual([popup.sharesStorage, popup.liveOpener, popup.plainPopupCredentialAccessDenied], [true,true,true]);
  for (const m of [tabMetric, popup.metric]) {
    assert.equal(m.stablePid, true);
    assert.ok(Number.isInteger(m.workingSetKiB) && m.workingSetKiB > 0);
    if (strict || m.sandboxed !== null) assert.equal(m.sandboxed, want);
  }
  return result;
}

function outputPath(args) {
  if (!args.length) return null;
  assert.ok(args.length === 2 && args[0] === '--out' && args[1], 'Usage: full-app-baseline.cjs [--out JSON_FILE]');
  return path.resolve(args[1]);
}

if (require.main === module) Promise.resolve().then(async () => {
  const file = outputPath(process.argv.slice(2));
  const result = verifyResult(await main());
  const report = JSON.stringify(result, null, 2) + '\n';
  if (file) fs.writeFileSync(file, report, { encoding:'utf8', flag:'wx' });
  process.stdout.write(report);
}).catch(e => { console.error(e.stack || e); process.exitCode = 1; });
module.exports = { startFixture, seedExtension, runSettings, fixtureHtml, outputPath, verifyResult };
