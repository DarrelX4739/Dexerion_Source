'use strict';

const { app, BrowserWindow, ipcMain, screen, session } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { setTimeout: delay } = require('node:timers/promises');
const { inside, install, listFolders } = require('./install.cjs');

const setupRoot = process.env.DEX_SETUP_ROOT;
const mode = process.env.DEX_SETUP_MODE;
if (!setupRoot || !path.isAbsolute(setupRoot) || !['', '--preview', '--smoke-test'].includes(mode)) {
  console.error('Launch Dexerion Setup through the bundled .run file.');
  process.exit(1);
}
const preview = mode !== '';
const smokeTest = mode === '--smoke-test';
const page = path.join(__dirname, 'index.html');
const pageURL = pathToFileURL(page).href;
app.setName('Dexerion Setup');
app.setPath('userData', path.join(setupRoot, 'profile'));

let window, busy = false, result;
async function boot() {
  const testHome = path.join(setupRoot, 'smoke-home');
  if (smokeTest) await fs.mkdir(testHome);
  const home = await fs.realpath(smokeTest ? testHome : os.homedir());
  const configuredData = process.env.DEX_SETUP_ORIGINAL_DATA_HOME;
  const dataHome = configuredData && path.isAbsolute(configuredData) ? configuredData : path.join(home, '.local', 'share');
  const defaultPath = path.join(home, '.local', 'opt', 'Dexerion');
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  window = new BrowserWindow({
    title: 'Dexerion Setup',
    width: Math.min(704, workArea.width),
    height: Math.min(516, workArea.height),
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    show: false,
    center: true,
    backgroundColor: '#101010',
    icon: path.join(__dirname, 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: false
    }
  });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  session.defaultSession.setPermissionRequestHandler((_sender, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  window.on('close', event => { if (busy) event.preventDefault(); });
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('Setup window could not run:', details.reason);
    app.exit(1);
  });

  function handle(channel, callback) {
    ipcMain.handle('setup:' + channel, (event, value) => {
      if (event.sender !== window.webContents || event.senderFrame?.url !== pageURL ||
          event.senderFrame !== window.webContents.mainFrame) throw Error('Unexpected Setup request');
      return callback(value);
    });
  }

  handle('info', () => ({ defaultPath, preview }));
  handle('browse', async folder => {
    try { return await listFolders(home, folder); }
    catch (error) { return { error: error.message }; }
  });
  handle('target', destination => {
    try {
      const target = inside(home, destination).target.replace(/\/+$/, '') || '/';
      return { target: path.basename(target) === 'Dexerion' ? target : path.join(target, 'Dexerion') };
    } catch (error) { return { error: error.message }; }
  });
  handle('install', async destination => {
    if (busy || result) return { error: 'Setup is already running or has already finished.' };
    busy = true;
    try {
      inside(home, destination);
      if (preview) {
        await delay(smokeTest ? 20 : 800);
        result = { warning: '' };
      } else {
        result = await install({ home, dataHome, destination, payload: path.join(setupRoot, 'Dexerion.AppImage'),
          logo: path.join(__dirname, 'logo.png') });
      }
      return { warning: result.warning };
    } catch (error) {
      return { error: error.message };
    } finally {
      busy = false;
    }
  });
  handle('finish', async launch => {
    if (!result || typeof launch !== 'boolean') return { error: 'Setup has not finished.' };
    if (!preview && launch) {
      const env = { ...process.env, APPIMAGE_EXTRACT_AND_RUN: '1' };
      for (const key of ['CACHE_HOME', 'CONFIG_HOME', 'DATA_HOME']) {
        if (env['DEX_SETUP_ORIGINAL_' + key]) env['XDG_' + key] = env['DEX_SETUP_ORIGINAL_' + key];
        else delete env['XDG_' + key];
        delete env['DEX_SETUP_ORIGINAL_' + key];
      }
      for (const key of ['DEX_SETUP_ROOT', 'DEX_SETUP_MODE', 'CHROME_DESKTOP']) delete env[key];
      try {
        await new Promise((resolve, reject) => {
          const child = spawn(result.executable, [], { detached: true, stdio: 'ignore', env, cwd: home });
          child.once('error', reject);
          child.once('spawn', () => { child.unref(); resolve(); });
        });
      } catch {
        return { error: 'Dexerion is installed but could not be opened. Open it from the application menu.' };
      }
    }
    setImmediate(() => window.close());
    return {};
  });
  handle('minimize', () => window.minimize());
  handle('close', () => window.close());

  await window.loadFile(page);
  window.show();
  if (smokeTest) {
    await walkThrough(window);
    if ((await fs.readdir(home)).length !== 0) throw Error('Preview touched its test home directory');
    console.log('Dexerion Setup: real Electron preview walk-through passed.');
    app.exit(0);
  }
}

async function walkThrough(window) {
  const evaluate = script => window.webContents.executeJavaScript(script);
  async function stage(expected) {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(`document.body.dataset.stage === ${JSON.stringify(expected)} && !document.body.hasAttribute('aria-busy')`)) return;
      await delay(50);
    }
    throw Error('Preview did not reach: ' + expected);
  }
  await stage('welcome');
  if (!await evaluate(`(async () => { const logo = document.querySelector('.hero-logo'); await logo.decode(); return logo.naturalWidth > 0 &&
      getComputedStyle(document.querySelector('#primary')).backgroundColor === 'rgb(31, 111, 107)' &&
      document.querySelector('#preview').offsetWidth > 0 && window.setup.sandboxed === true; })()`)) throw Error('Preview branding or the sandboxed preload did not load');
  await evaluate("document.querySelector('#primary').click(); true");
  await stage('options');
  await evaluate("document.querySelector('#browse-button').click(); true");
  await stage('browse');
  await evaluate("document.querySelector('#primary').click(); true");
  await stage('options');
  await evaluate("document.querySelector('#primary').click(); true");
  await stage('options');
  if (!await evaluate("document.querySelector('#path-status').textContent.includes('confirm')")) throw Error('Preview did not verify the chosen installation directory');
  await evaluate("document.querySelector('#primary').click(); true");
  await stage('ready');
  if (!await evaluate("document.querySelector('h1').textContent === 'Preview complete'")) throw Error('Preview attempted a real install');
}

app.on('window-all-closed', () => app.quit());
app.whenReady().then(boot).catch(error => { console.error(error); app.exit(1); });
