'use strict';

// Used only by hosted benchmarks with disposable profiles. Keep automation
// out of launch defaults: the Playwright Electron loader changes Chromium
// switches even when the underlying executable is not replaced.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: sleep } = require('node:timers/promises');

function browserArgs(kind, profile, { packaged = false } = {}) {
  const args = [
    '--user-data-dir=' + profile,
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
  ];
  if (kind === 'dexerion') return packaged ? args : ['.', ...args];
  if (kind === 'edge') return [...args, '--no-first-run', '--no-default-browser-check', 'about:blank'];
  throw new TypeError('Unknown browser: ' + kind);
}

function debugPort(profile) {
  try {
    const first = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/, 1)[0];
    const port = /^\d{1,5}$/.test(first) ? Number(first) : 0;
    return port > 0 && port <= 65535 ? port : 0;
  } catch { return 0; }
}

function edgeExecutable(env = process.env, exists = fs.existsSync) {
  const roots = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean);
  const files = roots.map((root) => path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  const file = files.find(exists);
  if (!file) throw new Error('Microsoft Edge binary not found in the standard install locations');
  return file;
}

function copySeedProfile(source, target) {
  fs.cpSync(source, target, {
    recursive: true,
    filter(candidate) {
      const relative = path.relative(source, candidate);
      return !/^(devtoolsactiveport|singletonlock|singletonsocket|singletoncookie|lockfile)$/i.test(relative);
    },
  });
}

async function waitFor(fn, label, time = 20000) {
  const last = Date.now() + time;
  do {
    const result = await fn();
    if (result) return result;
    await sleep(125);
  } while (Date.now() < last);
  throw new Error(label + ' not ready');
}

async function openNative(kind, { chromium, executable, cwd, packaged = false, seedDir, preserveProfile = false, env = process.env }) {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-native-' + kind + '-'));
  let child, browser, devtools, launchError, stderr = '', kept = false;
  const close = async (keep = preserveProfile) => {
    if (devtools) {
      try { await Promise.race([devtools.send('Browser.close'), sleep(2000)]); } catch {}
    }
    if (browser) await browser.close().catch(() => {});
    let forced = false;
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      const done = once(child, 'exit').catch(() => {});
      await Promise.race([done, sleep(2000)]);
      if (child.exitCode === null && child.signalCode === null) {
        forced = true;
        try { child.kill(); } catch {}
        await Promise.race([done, sleep(2000)]);
      }
    }
    kept = keep && !forced && child?.exitCode === 0;
    // Never remove a directory outside the path created for this trial.
    if (!kept) {
      try { fs.rmSync(profileDir, { force: true, recursive: true, maxRetries: 5, retryDelay: 300 }); } catch {}
    }
    return { kept };
  };
  try {
    if (seedDir) copySeedProfile(seedDir, profileDir);
    child = spawn(executable, browserArgs(kind, profileDir, { packaged }), { cwd, env, stdio: ['ignore', 'ignore', 'pipe'] });
    child.on('error', (error) => { launchError = error; });
    child.stderr.on('data', (data) => { stderr = (stderr + String(data)).slice(-400); });
    const port = await waitFor(() => {
      if (launchError) throw launchError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(kind + ' exited before DevTools was ready: ' + stderr.trim());
      return debugPort(profileDir);
    }, kind + ' isolated DevTools port', 45000);
    browser = await chromium.connectOverCDP('http://127.0.0.1:' + port, {
      timeout: 15000, noDefaults: true, isLocal: true,
    });
    devtools = await browser.newBrowserCDPSession();
    return { browser, devtools, profileDir, close };
  } catch (err) {
    await close(false);
    throw err;
  }
}

// Electron windows may not be listed in the default Chromium context; probe
// only URLs owned by this launch. For transient navigations use CDP discovery.
function pagesIn(browser) {
  return browser.contexts().flatMap((c) => c.pages());
}
function isShellUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'file:' && u.pathname.endsWith('/src/renderer/shell.html');
  } catch { return false; }
}
const samplePage = (page) => page.evaluate(() => ({
  visible: document.visibilityState === 'visible',
  frames: window.__dexMeasureFrames || 0,
  clockMs: performance.now(),
  timeOrigin: performance.timeOrigin,
  width: innerWidth,
  height: innerHeight,
  scale: devicePixelRatio,
}));

module.exports = { copySeedProfile, browserArgs, debugPort, edgeExecutable, openNative, waitFor, pagesIn, isShellUrl, samplePage };
