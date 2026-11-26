'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const afterPack = require('./after-pack.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dexerion packaging '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const appOutDir = path.join(root, 'app with spaces');
  await fs.mkdir(path.join(appOutDir, 'resources'), { recursive: true });
  const original = '#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2))); process.exit(Number(process.env.TEST_EXIT || 0));\n';
  const archive = Buffer.from('Application archive must remain byte-identical.');
  await fs.writeFile(path.join(appOutDir, 'dexerion'), original, { mode: 0o755 });
  await fs.writeFile(path.join(appOutDir, 'resources', 'app.asar'), archive);
  const context = { electronPlatformName: 'linux', appOutDir, packager: { config: { linux: { executableName: 'dexerion' } } } };
  return { root, appOutDir, original, archive, context };
}

function launch(executable, env = {}, args = []) {
  return spawnSync(executable, args, {
    encoding: 'utf8',
    env: { ...process.env, DISPLAY: '', WAYLAND_DISPLAY: '', XDG_SESSION_TYPE: '', TEST_EXIT: '0', ...env },
  });
}

for (const [name, env, prefix] of [
  ['Kubuntu Wayland with XWayland', { DISPLAY: ':1', WAYLAND_DISPLAY: 'wayland-0', XDG_SESSION_TYPE: 'wayland' }, ['--ozone-platform=x11']],
  ['Wayland detected from session type', { DISPLAY: ':1', XDG_SESSION_TYPE: 'wayland' }, ['--ozone-platform=x11']],
  ['Wayland detected from socket name', { DISPLAY: ':1', WAYLAND_DISPLAY: 'wayland-0' }, ['--ozone-platform=x11']],
  ['native X11 session', { DISPLAY: ':0', XDG_SESSION_TYPE: 'x11' }, []],
  ['Wayland without XWayland', { WAYLAND_DISPLAY: 'wayland-0', XDG_SESSION_TYPE: 'wayland' }, []],
  ['session without display variables', {}, []],
]) {
  test(name, async t => {
    const f = await fixture(t);
    await afterPack(f.context);
    const args = ['--user-data-dir=/tmp/a profile', 'https://example.invalid/?q=a b&x=1', 'literal;$(not-a-command)'];
    const result = launch(path.join(f.appOutDir, 'dexerion'), env, args);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [...prefix, ...args]);
  });
}

for (const flags of [['--ozone-platform=wayland'], ['--ozone-platform', 'wayland'], ['--ozone-platform=auto']]) {
  test(`explicit backend is preserved: ${flags.join(' ')}`, async t => {
    const f = await fixture(t);
    await afterPack(f.context);
    const result = launch(path.join(f.appOutDir, 'dexerion'), { DISPLAY: ':1', WAYLAND_DISPLAY: 'wayland-0' }, flags);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), flags);
  });
}

test('hook preserves application archive and native executable bytes and permissions', async t => {
  const f = await fixture(t);
  await afterPack(f.context);
  assert.equal(await fs.readFile(path.join(f.appOutDir, 'dexerion-bin'), 'utf8'), f.original);
  assert.deepEqual(await fs.readFile(path.join(f.appOutDir, 'resources', 'app.asar')), f.archive);
  assert.equal((await fs.stat(path.join(f.appOutDir, 'dexerion'))).mode & 0o777, 0o755);
  assert.equal((await fs.stat(path.join(f.appOutDir, 'dexerion-bin'))).mode & 0o777, 0o755);
});

test('Debian-style executable symlinks resolve to the packaged binary', async t => {
  const f = await fixture(t);
  await afterPack(f.context);
  const link = path.join(f.root, 'dexerion-link');
  await fs.symlink(path.join(f.appOutDir, 'dexerion'), link);
  const result = launch(link, { DISPLAY: ':1', WAYLAND_DISPLAY: 'wayland-0' }, ['argument with spaces']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ['--ozone-platform=x11', 'argument with spaces']);
});

test('native process exit status is propagated', async t => {
  const f = await fixture(t);
  await afterPack(f.context);
  assert.equal(launch(path.join(f.appOutDir, 'dexerion'), { TEST_EXIT: '37' }).status, 37);
});

for (const platform of ['win32', 'darwin']) {
  test(`${platform} packaging is untouched`, async t => {
    const f = await fixture(t);
    await afterPack({ ...f.context, electronPlatformName: platform });
    assert.equal(await fs.readFile(path.join(f.appOutDir, 'dexerion'), 'utf8'), f.original);
    await assert.rejects(fs.access(path.join(f.appOutDir, 'dexerion-bin')), { code: 'ENOENT' });
  });
}

test('hook rejects unexpected executable names', async t => {
  const f = await fixture(t);
  f.context.packager.config.linux.executableName = 'different';
  await assert.rejects(afterPack(f.context), /requires executableName/);
  assert.equal(await fs.readFile(path.join(f.appOutDir, 'dexerion'), 'utf8'), f.original);
});

test('hook refuses to overwrite an already-staged native binary', async t => {
  const f = await fixture(t);
  await afterPack(f.context);
  await assert.rejects(afterPack(f.context), /Refusing to overwrite/);
  assert.equal(await fs.readFile(path.join(f.appOutDir, 'dexerion-bin'), 'utf8'), f.original);
});
