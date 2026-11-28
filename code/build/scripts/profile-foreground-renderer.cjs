'use strict';

// Research tool. Runs on a disposable profile and only a local test page.
// Collects scoped V8/Blink metrics separately from live process memory.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { once } = require('node:events');
const { setTimeout: sleep } = require('node:timers/promises');
const { launchDexerion } = require('../e2e/app');
const { execFileSync } = require('node:child_process');

function processSnapshot(profile) {
  if (process.platform !== 'win32') return new Map();
  const out = path.join(profile, 'process-metrics.json');
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-File',
      path.join(__dirname, 'measure-tree-snapshot.ps1'), '-IncludePrivateWorkingSet', '-OutFile', out],
    { stdio: 'ignore', timeout: 60000 });
    return new Map(JSON.parse(fs.readFileSync(out, 'utf8')).processes.map((p) => [p.pid, p]));
  } finally {
    try { fs.rmSync(out, { force: true }); } catch {}
  }
}

async function collect(app, fixtureUrl, profile) {
  // Capture resident memory before attaching the JavaScript profiler.
  const processMemory = processSnapshot(profile);
  const metrics = await app.evaluate(async ({ app, BrowserWindow, webContents }, exactUrl) => {
    const window = BrowserWindow.getAllWindows()[0];
    const targets = [['shell', window.webContents]];
    if (exactUrl) {
      const page = webContents.getAllWebContents().find((wc) => wc.getURL() === exactUrl);
      if (!page) throw new Error('Known foreground fixture not found');
      targets.push(['page', page]);
    }
    const appMemory = new Map(app.getAppMetrics().map((p) => [p.pid, p.memory]));
    return Promise.all(targets.map(async ([name, wc]) => {
      const p = wc.getOSProcessId();
      const debuggerApi = wc.debugger;
      debuggerApi.attach('1.3');
      try {
        const heap = await debuggerApi.sendCommand('Runtime.getHeapUsage');
        const dom = await debuggerApi.sendCommand('Memory.getDOMCounters');
        return { name, pid: p, engineMemory: appMemory.get(p), heap, dom };
      } finally { debuggerApi.detach(); }
    }));
  }, fixtureUrl);
  return metrics.map((m) => {
    const process = processMemory.get(m.pid);
    return { ...m, osMemory: process ? {
      wsBytes: process.wsBytes ?? null, privateBytes: process.privateBytes ?? null,
      privateWsBytes: process.privateWsBytes ?? null,
    } : null };
  });
}

async function collectTrial() {
  const server = http.createServer((_req, res) => res.end('<!doctype html><title>Local foreground profile</title><main>Benchmark fixture</main>'));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = 'http://127.0.0.1:' + server.address().port + '/benchmark';
  let launch;
  try {
    launch = await launchDexerion({ gpu: 'adaptive', attempts: 2 });
    const { app, win, profile } = launch;
    const active = await win.waitForFunction(async () => (await window.dexerion.invoke('dex:get-state')).active);
    const id = await active.jsonValue();
    await win.evaluate(({ id, url }) => window.dexerion.invoke('dex:navigate', id, url), { id, url });
    await win.waitForFunction(async (url) => {
      const st = await window.dexerion.invoke('dex:get-state');
      return st.tabs.length === 1 && st.tabs[0].url === url && !st.tabs[0].loading;
    }, url);
    await sleep(6000);
    return await collect(app, url, profile);
  } finally {
    if (launch) {
      await launch.app.close().catch(() => {});
      fs.rmSync(launch.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    }
    server.close();
  }
}

(async () => {
  const trialCount = 3;
  const samples = [];
  for (let n = 0; n < trialCount; n++) {
    const sample = await collectTrial();
    console.log('FOREGROUND RENDERER SAMPLE: ' + JSON.stringify(sample));
    samples.push(sample);
  }
  fs.writeFileSync('cloud-foreground-renderer-profile.json', JSON.stringify({ trialCount, samples }, null, 2));
})().catch((e) => { console.error(e); process.exitCode = 1; });
