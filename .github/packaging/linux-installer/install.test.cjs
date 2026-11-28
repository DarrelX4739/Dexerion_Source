'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { desktopEntry, install, listFolders } = require('./install.cjs');

async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dexerion-install-test-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const home = path.join(temp, 'test home');
  await fs.mkdir(home);
  const config = {
    home,
    dataHome: path.join(home, '.local', 'share'),
    destination: path.join(home, 'Example %$User', 'Dexerion'),
    payload: path.join(temp, 'source.AppImage'),
    logo: path.join(temp, 'source.png')
  };
  await fs.writeFile(config.payload, 'app bytes');
  await fs.writeFile(config.logo, 'image bytes');
  return config;
}
function shortcut(config) {
  return path.join(config.dataHome, 'applications', 'com.dexerion.browser.desktop');
}

test('installs and upgrades within the disposable account and preserves profile', async t => {
  const config = await fixture(t);
  const profile = path.join(config.home, 'browser-profile');
  await fs.writeFile(profile, 'untouched');
  const { executable, warning } = await install(config);
  assert.equal(warning, '');
  assert.equal(await fs.readFile(executable, 'utf8'), 'app bytes');
  assert.equal((await fs.stat(executable)).mode & 0o111, 0o111);
  const desktop = await fs.readFile(shortcut(config), 'utf8');
  assert.ok(desktop.includes('%%'));
  assert.ok(desktop.includes('APPIMAGE_EXTRACT_AND_RUN=1'));
  try { execFileSync('desktop-file-validate', [shortcut(config)]); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.writeFile(config.payload, 'app bytes v2');
  assert.equal((await install(config)).warning, '');
  assert.equal(await fs.readFile(executable, 'utf8'), 'app bytes v2');
  assert.equal(await fs.readFile(profile, 'utf8'), 'untouched');
});

test('refuses a populated unmanaged destination', async t => {
  const config = await fixture(t);
  await fs.mkdir(config.destination, { recursive: true });
  const other = path.join(config.destination, 'my-project');
  await fs.writeFile(other, 'do not touch');
  await assert.rejects(install(config), /will not replace an unrelated installation/);
  assert.equal(await fs.readFile(other, 'utf8'), 'do not touch');
  assert.deepEqual(await fs.readdir(config.destination), ['my-project']);
});

test('refuses symlink traversal, outside folders and an unrelated shortcut', async t => {
  const config = await fixture(t);
  const link = path.join(config.home, 'link');
  await fs.symlink(path.dirname(config.home), link, 'dir');
  await assert.rejects(install({ ...config, destination: path.join(link, 'Dexerion') }), /not a symbolic link/);
  await assert.rejects(install({ ...config, destination: '/usr/local/Dexerion' }), /inside your home directory/);
  await fs.mkdir(path.dirname(shortcut(config)), { recursive: true });
  await fs.writeFile(shortcut(config), '[Desktop Entry]\nName=Unrelated\n');
  await assert.rejects(install(config), /unrelated Dexerion application shortcut/);
  await assert.rejects(fs.lstat(config.destination), { code: 'ENOENT' });
});

test('refuses to overwrite linked payloads on upgrade', async t => {
  const config = await fixture(t);
  const { executable } = await install(config);
  await fs.unlink(executable);
  await fs.symlink(config.payload, executable);
  await assert.rejects(install(config), /will not replace the existing Dexerion.AppImage/);
  assert.equal(await fs.readlink(executable), config.payload);
});

test('folder picker handles uncreated defaults and shows only safe visible folders', async t => {
  const config = await fixture(t);
  await fs.mkdir(path.join(config.home, 'Applications'));
  await fs.mkdir(path.join(config.home, '.private'));
  await fs.symlink(path.dirname(config.home), path.join(config.home, 'linked'), 'dir');
  assert.deepEqual(await listFolders(config.home, config.destination), {
    current: config.home, parent: null,
    folders: [{ path: path.join(config.home, 'Applications'), name: 'Applications' }]
  });
});

test('quotes Desktop Entry paths without shell syntax or accidental field codes', () => {
  const entry = desktopEntry('/home/Demo/\\"$100%/Dexerion.AppImage', '/home/Demo/\\icon.png');
  assert.match(entry, /100%%/);
  assert.ok(entry.split('\n').find(line => line.startsWith('Exec=')).endsWith('" %U'));
  assert.ok(entry.includes('Icon=/home/Demo/\\\\icon.png\n'));
});

test('Linux and Windows branded installer theme tokens stay in sync', async () => {
  const windows = path.resolve(__dirname, '../../../code/build/installer/branded/Setup.xaml');
  const [xaml, css] = await Promise.all([fs.readFile(windows, 'utf8'), fs.readFile(path.join(__dirname, 'style.css'), 'utf8')]);
  for (const [wpf, web] of Object.entries({
    Ground: 'ground', Ink: 'ink', Muted: 'muted', Line: 'line', Panel: 'panel', Hover: 'hover',
    FocusedSurface: 'focused', Accent: 'accent', OnAccent: 'on-accent'
  })) {
    const color = value => value?.length === 3 ? value.split('').map(char => char.repeat(2)).join('') : value;
    const wpfColor = xaml.match(new RegExp(`x:Key="${wpf}" Color="#([a-fA-F0-9]+)"`))?.[1];
    const webColor = css.match(new RegExp(`--${web}: #([a-fA-F0-9]+)`))?.[1];
    assert.ok(wpfColor && webColor, 'Missing brand token: ' + wpf);
    assert.equal(color(webColor.toLowerCase()), color(wpfColor.toLowerCase()), 'Mismatched brand token: ' + wpf);
  }
});
