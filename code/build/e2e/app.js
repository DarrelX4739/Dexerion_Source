'use strict';
// Launches the real Dexerion app for e2e tests.
//
// Every run gets a throwaway --user-data-dir (never the real profile) and the
// DEX_AI_TEST flag, which is the only way the NIM base can be redirected to
// the local mock. The shell window is returned first because it owns the
// trusted bridge the tests use to seed keys and open the sidebar.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('@playwright/test');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launchOnce(options) {
  const buildDir = options.buildDir ? path.resolve(options.buildDir) : path.join(__dirname, '..');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dexerion-e2e-'));
  const buildModules = path.join(buildDir, 'node_modules');
  const env = {
    ...process.env,
    // Source lives in ../code while dependencies live in build/node_modules.
    // Keep that search path here so the clean distributable needs no junction.
    NODE_PATH: process.env.NODE_PATH
      ? buildModules + path.delimiter + process.env.NODE_PATH
      : buildModules,
    DEX_AI_TEST: '1',
    ...(options.aiBase ? { DEX_AI_BASE: options.aiBase } : {}),
    ...(options.env || {}),
  };
  let app = null;
  try {
    // Generous: this is Chromium's cold start plus Playwright's CDP handshake,
    // and on a busy machine the handshake alone has been seen to exceed a
    // minute (measured app-side cold start is 12-15 s; the rest is contention).
    app = await electron.launch({
      executablePath: options.executablePath || require('electron'),
      cwd: buildDir,
      // Throwaway-profile E2E only. Compositor timing inside a sandboxed
      // iframe was flaky with a real GPU, so the default harness forces
      // software compositing. Power benchmarks pass gpu:'adaptive' to launch
      // the shipped Adaptive GPU policy instead; it is not a user setting.
      args: ['.', '--user-data-dir=' + profile,
        ...(options.gpu === 'adaptive' ? [] : ['--gpu=off'])],
      env,
      timeout: Number(process.env.E2E_LAUNCH_TIMEOUT_MS) || 120000,
    });
    const win = await app.firstWindow({ timeout: Number(process.env.E2E_LAUNCH_TIMEOUT_MS) || 120000 });
    await win.waitForLoadState('domcontentloaded');
    return { app, win, profile };
  } catch (err) {
    // Never leave a half-launched Electron behind: it would hold the DevTools
    // port and the next attempt would fail for the wrong reason.
    if (app) { try { await app.close(); } catch {} }
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
    throw err;
  }
}

// Playwright attaches over CDP, and on a loaded machine that handshake can time
// out before the app has even finished booting (the app logs its own boot line
// while the attach is still waiting). Launching is not the thing under test, so
// it gets bounded retries with a fresh throwaway profile each time.
async function launchDexerion(options = {}) {
  const attempts = Math.max(1, Math.min(4, Number(options.attempts) || 3));
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await launchOnce(options);
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        console.warn('[e2e] launch attempt ' + attempt + ' failed (' +
          String(err && err.message || err).split('\n')[0] + '); retrying');
        await sleep(1500 * attempt);
      }
    }
  }
  throw lastError;
}

module.exports = { launchDexerion };
