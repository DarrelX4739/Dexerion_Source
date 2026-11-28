'use strict';
// Directional software-rendering comparison on a Linux hosted CI runner.
// Not an Edge/Task Manager, hardware GPU, interactive, or power benchmark.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: sleep } = require('node:timers/promises');
const { chromium } = require('@playwright/test');
const { launchDexerion } = require('../e2e/app');
const { readTree, cpuDelta, sumPss } = require('./cloud-proc-metrics.cjs');

const WINDOW = { width: 1280, height: 900 };
const SCENARIOS = {
  idle: { animate: false, background: 0 },
  'active-browsing': { animate: true, background: 0 },
  'background-tabs': { animate: false, background: 8 },
  multitasking: { animate: true, background: 8 },
};
const TRIALS = Math.max(3, Number(process.env.DEX_CLOUD_TRIALS) || 5);
const SAMPLE_MS = Math.max(2500, Number(process.env.DEX_CLOUD_SAMPLE_MS) || 4000);
const SETTLE_MS = 3000;
const CHROME = process.env.DEX_CLOUD_CHROME || '/usr/bin/google-chrome';
const OUTPUT = process.env.DEX_CLOUD_OUTPUT || 'cloud-comparison.json';

const STATIC = '<meta charset="utf-8"><title>Browser comparison</title><h1>Idle comparison page</h1>';
const ANIMATED = '<meta charset="utf-8"><title>Browser comparison</title><canvas width="640" height="360"></canvas><script>(' + function () {
  const ctx = document.querySelector('canvas').getContext('2d');
  let frame = 0;
  function draw() {
    frame++;
    ctx.fillStyle = '#121826';
    ctx.fillRect(0, 0, 640, 360);
    for (let k = 0; k < 48; k++) {
      ctx.fillStyle = 'hsl(' + ((k * 29 + frame) % 360) + ' 75% 55%)';
      ctx.fillRect((k * 37 + frame * 2) % 614, (k * 53 + frame) % 330, 26, 28);
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}.toString() + ')();</script>';

async function openServer() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(req.url.startsWith('/animated') ? ANIMATED : STATIC);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

async function waitFor(fn, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  do {
    const value = await fn();
    if (value) return value;
    await sleep(125);
  } while (Date.now() < deadline);
  throw new Error(label + ' timed out');
}

const pagesFor = (base, def) => [
  base + (def.animate ? '/animated' : '/idle'),
  ...Array.from({ length: def.background }, (_, i) => base + '/animated?tab=' + i),
];

async function openChrome(urls) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-cloud-chrome-'));
  let child, browser;
  const close = async () => {
    if (browser) {
      try {
        const session = await browser.newBrowserCDPSession();
        await session.send('Browser.close');
      } catch { /* the debugging connection closes with the browser */ }
      await browser.close().catch(() => {});
    }
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      const done = once(child, 'exit');
      await Promise.race([done, sleep(2000)]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await Promise.race([done, sleep(2000)]);
      }
    }
    fs.rmSync(profile, { force: true, recursive: true, maxRetries: 3 });
  };
  try {
    child = spawn(CHROME, [
      '--user-data-dir=' + profile, '--remote-debugging-port=0', '--no-first-run',
      '--no-default-browser-check', '--no-sandbox', '--disable-gpu',
      '--window-size=' + WINDOW.width + ',' + WINDOW.height, 'about:blank',
    ], { stdio: 'ignore' });
    let launchError;
    child.on('error', (e) => { launchError = e; });
    const port = await waitFor(() => {
      if (launchError) throw launchError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('Chrome exited before CDP was ready');
      try {
        const p = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
        return Number.isInteger(p) && p > 0 && p <= 65535 ? p : 0;
      } catch { return 0; }
    }, 'Chrome debugging port');
    browser = await chromium.connectOverCDP('http://127.0.0.1:' + port, { timeout: 15000 });
    const context = browser.contexts()[0];
    const first = context.pages()[0] || await context.newPage();
    await first.goto(urls[0], { waitUntil: 'domcontentloaded' });
    for (const url of urls.slice(1)) {
      const tab = await context.newPage();
      await tab.goto(url, { waitUntil: 'domcontentloaded' });
    }
    await first.bringToFront();
    await waitFor(() => first.evaluate(() => document.visibilityState === 'visible'), 'Chrome foreground');
    if (context.pages().length !== urls.length) throw new Error('Unexpected Chrome page count');
    return { pid: child.pid, close };
  } catch (err) {
    await close();
    throw err;
  }
}

async function openDexerion(urls) {
  const { app, win, profile } = await launchDexerion({ attempts: 1, gpu: 'off' });
  const close = async () => {
    await app.close().catch(() => {});
    fs.rmSync(profile, { force: true, recursive: true, maxRetries: 3 });
  };
  try {
    await app.evaluate(({ BrowserWindow }, size) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.setBounds(size);
      w.show();
      w.focus();
    }, WINDOW);
    const state = () => win.evaluate(() => window.dexerion.invoke('dex:get-state'));
    const first = (await state()).active;
    if (!first) throw new Error('Dexerion boot tab missing');
    await win.evaluate(({ id, url }) => window.dexerion.invoke('dex:navigate', id, url), { id: first, url: urls[0] });
    for (const url of urls.slice(1)) {
      await win.evaluate((u) => window.dexerion.invoke('dex:new-tab', u, true), url);
    }
    await waitFor(async () => {
      const s = await state();
      return s.active === first && s.tabs.length === urls.length &&
        s.tabs.every((t) => urls.includes(t.url) && !t.loading);
    }, 'Dexerion matched workload');
    return { pid: app.process().pid, close };
  } catch (err) {
    await close();
    throw err;
  }
}

async function trial(open, urls, hz) {
  const session = await open(urls);
  try {
    await sleep(SETTLE_MS);
    const a = readTree(session.pid);
    const start = performance.now();
    await sleep(SAMPLE_MS);
    const b = readTree(session.pid);
    const seconds = (performance.now() - start) / 1000;
    return { ...cpuDelta(a, b, hz, seconds), pssMiB: sumPss(b), processes: b.size, seconds };
  } finally { await session.close(); }
}

function summarise(trials, key) {
  const data = trials.map((t) => t[key]).filter(Number.isFinite).sort((a, b) => a - b);
  const quantile = (q) => {
    const p = (data.length - 1) * q;
    const i = Math.floor(p);
    return data[i] + (data[Math.ceil(p)] - data[i]) * (p - i);
  };
  return { valid: data.length, median: data.length >= 3 ? quantile(0.5) : null,
    iqr: data.length >= 3 ? [quantile(0.25), quantile(0.75)] : null };
}

async function main() {
  if (process.platform !== 'linux' || !process.env.DISPLAY) throw new Error('Run on Linux with a display (for example xvfb-run).');
  const hz = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim());
  const chromeVersion = execFileSync(CHROME, ['--version'], { encoding: 'utf8' }).trim();
  const report = {
    format: 'cloud-linux-directional-v1', startedAt: new Date().toISOString(),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    os: os.release(), logicalCores: os.cpus().length, chromeVersion,
    electron: require('electron/package.json').version, trialCount: TRIALS, sampleMs: SAMPLE_MS,
    rendering: 'Linux virtual display; both arms request software rendering',
    cpu: 'percent of one logical core, process tree', ram: 'whole-tree proportional set size (MiB)',
    gpu: null, power: null, scenarios: {},
  };
  const server = await openServer();
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    for (const [name, def] of Object.entries(SCENARIOS)) {
      const pair = report.scenarios[name] = { chrome: { trials: [] }, dexerion: { trials: [] } };
      for (let i = 0; i < TRIALS; i++) {
        for (const browser of (i % 2 ? ['dexerion', 'chrome'] : ['chrome', 'dexerion'])) {
          try {
            pair[browser].trials.push(await trial(browser === 'chrome' ? openChrome : openDexerion, pagesFor(base, def), hz));
          } catch (err) { pair[browser].trials.push({ error: String(err.message || err).split('\n')[0] }); }
        }
      }
      for (const browser of ['chrome', 'dexerion']) {
        pair[browser].cpu = summarise(pair[browser].trials, 'pctOfOneCore');
        pair[browser].ram = summarise(pair[browser].trials, 'pssMiB');
      }
      pair.pctOfChrome = Object.fromEntries(['cpu', 'ram'].map((key) => {
        const dex = pair.dexerion[key].median, baseline = pair.chrome[key].median;
        return [key, dex !== null && baseline > 0 ? dex / baseline * 100 : null];
      }));
      console.log(name + ': ' + JSON.stringify(pair));
      fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2) + '\n');
    }
    if (Object.values(report.scenarios).some((s) => s.pctOfChrome.cpu === null || s.pctOfChrome.ram === null)) process.exitCode = 1;
  } finally { server.close(); }
}

if (require.main === module) main().catch((err) => { console.error(err.message || err); process.exitCode = 2; });
