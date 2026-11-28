'use strict';

// A diagnostic of unchanged Electron main-process work; CDP/inspector make this
// unsuitable as a whole-browser or Edge benchmark. No remote inspector is added
// by the profiler. Do not use with an existing profile or an external page.
const fs = require('node:fs');
const http = require('node:http');
const { once } = require('node:events');
const { setTimeout: sleep } = require('node:timers/promises');
const { launchDexerion } = require('../../code/build/e2e/app');
const { summarize } = require('./profile-summary.cjs');

async function capture(app, profile, duration) {
  return app.evaluate(async ({ app }, { profile, duration }) => {
    const path = process.getBuiltinModule('path');
    const fs = process.getBuiltinModule('fs');
    if (fs.realpathSync(app.getPath('userData')) !== fs.realpathSync(profile) ||
        !path.basename(profile).startsWith('dexerion-e2e-')) {
      throw new Error('Not the expected disposable profile');
    }
    const { Session } = process.getBuiltinModule('inspector');
    const session = new Session();
    session.connect();
    const post = (name, params = {}) => new Promise((resolve, reject) => {
      session.post(name, params, (error, data) => (error ? reject(error) : resolve(data)));
    });
    try {
      await post('Profiler.enable');
      await post('Profiler.setSamplingInterval', { interval: 1000 });
      await post('Profiler.start');
      const beforeCpu = process.cpuUsage();
      const beforeClock = process.hrtime.bigint();
      await new Promise((resolve) => setTimeout(resolve, duration));
      const cpu = process.cpuUsage(beforeCpu);
      const elapsedMs = Number(process.hrtime.bigint() - beforeClock) / 1e6;
      const { profile: result } = await post('Profiler.stop');
      return { result, cpuMs: (cpu.user + cpu.system) / 1000, elapsedMs };
    } finally { session.disconnect(); }
  }, { profile, duration });
}

async function prepare(win, urls, state) {
  const tabCount = state === 'background-tabs' ? 5 : 1;
  await win.waitForFunction(async () => !!(await window.dexerion.invoke('dex:get-state')).active);
  await win.evaluate(async ({ urls, tabCount, state }) => {
    const api = window.dexerion;
    const s = await api.invoke('dex:get-state');
    await api.invoke('dex:navigate', s.active, urls[0]);
    for (const url of urls.slice(1, tabCount)) await api.invoke('dex:new-tab', url, true);
    if (state === 'focus-timer') {
      await api.invoke('dex:pomo-configure', { workMin: 5, sound: 'off',
        blocklist: ['blocked-fixture.example', 'another-fixture.example'] });
      await api.invoke('dex:pomo-start', 'work');
    }
  }, { urls, tabCount, state });
  await win.waitForFunction(async ({ state, urls, tabCount }) => {
    const s = await window.dexerion.invoke('dex:get-state');
    return s.tabs.length === tabCount && urls.slice(0, tabCount).every(
      (url) => s.tabs.some((t) => t.url === url && !t.loading)
    ) && (state !== 'focus-timer' || document.querySelector('#rt-phase')?.textContent.trim() === 'Work');
  }, { state, urls, tabCount });
  return tabCount;
}

async function main(output) {
  const server = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><title>Dexerion runtime profile fixture</title><main>Local static workload</main>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  const urls = Array.from({ length: 5 }, (_, i) => origin + '/fixture/' + i);
  const trials = [];
  try {
    const states = ['idle-one-tab', 'background-tabs', 'focus-timer'];
    for (let repeat = 0; repeat < 2; repeat += 1) {
      const order = repeat === 0 ? states : [...states].reverse();
      for (const state of order) {
        const launch = await launchDexerion({ attempts: 2, gpu: 'adaptive' });
        try {
          const tabCount = await prepare(launch.win, urls, state);
          await sleep(9000);
          const got = await capture(launch.app, launch.profile, 22000);
          if (got.elapsedMs < 21500 || got.elapsedMs > 34000) throw new Error('Invalid CPU sample interval');
          const diagnostic = { state, repeat, tabCount, cpuMs: got.cpuMs,
            elapsedMs: got.elapsedMs, ...summarize(got.result) };
          console.log('MAIN PROCESS DIAGNOSTIC: ' + JSON.stringify(diagnostic));
          trials.push(diagnostic);
        } finally {
          await launch.app.close().catch(() => {});
          fs.rmSync(launch.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
        }
      }
    }
    fs.writeFileSync(output, JSON.stringify({ platform: process.platform, trials,
      method: 'Electron main-process V8 exclusive sampled wall time (not exact CPU), plus process.cpuUsage across main-browser threads. Disposable profiles; Playwright plus in-process Node inspector. Not an Edge/whole-tree comparison.' }, null, 2));
  } finally { server.close(); }
}

main(process.argv[2] || 'runtime-main-profile.json').catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
