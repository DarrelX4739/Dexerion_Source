'use strict';

// Purpose-built local diagnostic, not an Edge benchmark. No production
// instrumentation, debugger port, persistent user profile or external pages.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { once } = require('node:events');
const { setTimeout: sleep } = require('node:timers/promises');
const { launchDexerion } = require('../../code/build/e2e/app');
const { summarize } = require('./profile-summary.cjs');

const TITLE = 'Local title fixture';
const TABS = 9;
const DURATION = 15000;
const SETTLE = 4000;

async function profileMain(app, profile) {
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
    const post = (method, params = {}) => new Promise((resolve, reject) =>
      session.post(method, params, (err, value) => err ? reject(err) : resolve(value)));
    try {
      await post('Profiler.enable');
      await post('Profiler.setSamplingInterval', { interval: 1000 });
      await post('Profiler.start');
      const before = process.cpuUsage();
      const start = process.hrtime.bigint();
      await new Promise((resolve) => setTimeout(resolve, duration));
      const cpu = process.cpuUsage(before);
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
      const { profile: captured } = await post('Profiler.stop');
      return { captured, elapsedMs, cpuMs: (cpu.user + cpu.system) / 1000 };
    } finally {
      session.disconnect();
    }
  }, { profile, duration: DURATION });
}

function fixture(dynamic) {
  return `<!doctype html><meta charset="UTF-8"><title>${TITLE}</title>
<main>Same local page and interval in both arms.</main>
<script>
let ticks = 0;
const dynamic = ${dynamic};
setInterval(function () {
  ticks += 1;
  if (dynamic) document.title = '${TITLE} ' + ticks;
}, 500);
</script>`;
}

async function prepare(win, urls) {
  await win.waitForFunction(async () => {
    const s = await window.dexerion.invoke('dex:get-state');
    return s.active && s.tabs.some((t) => t.id === s.active && !t.loading);
  });
  await win.evaluate(async ({ urls }) => {
    const bridge = window.dexerion;
    const state = await bridge.invoke('dex:get-state');
    const active = state.active;
    for (const tab of state.tabs) if (tab.id !== active) await bridge.invoke('dex:close-tab', tab.id);
    await bridge.invoke('dex:navigate', active, urls[0]);
    for (const url of urls.slice(1)) await bridge.invoke('dex:new-tab', url, true);
  }, { urls });
  await win.waitForFunction(async ({ urls }) => {
    const st = await window.dexerion.invoke('dex:get-state');
    return st.tabs.length === urls.length && st.tabs.some((t) => t.id === st.active && t.url === urls[0]) &&
      urls.every((url) => st.tabs.some((t) => t.url === url && !t.loading));
  }, { urls });
}

async function observe(win, urls, dynamic) {
  await win.evaluate(async ({ urls }) => {
    const bridge = window.dexerion;
    const st = await bridge.invoke('dex:get-state');
    const prior = new Map(st.tabs.map((t) => [t.id, t.title]));
    const ids = new Set(st.tabs.filter((t) => urls.includes(t.url)).map((t) => t.id));
    window.__dexTitleProfileCounts = { fullStates: 0, changedTitles: 0, foreground: 0, background: 0 };
    bridge.on('dex:state', (next) => {
      const v = window.__dexTitleProfileCounts;
      ++v.fullStates;
      for (const t of next.tabs) {
        if (!ids.has(t.id) || prior.get(t.id) === t.title) continue;
        prior.set(t.id, t.title);
        ++v.changedTitles;
        if (t.id === next.active) ++v.foreground; else ++v.background;
      }
    });
  }, { urls });
  const start = await win.evaluate(() => performance.now());
  return async () => {
    const o = await win.evaluate(() => ({ ...window.__dexTitleProfileCounts, at: performance.now() }));
    const state = await win.evaluate(() => window.dexerion.invoke('dex:get-state'));
    const front = state.tabs.find((t) => t.id === state.active);
    assert(front?.url === urls[0]);
    assert(dynamic ? front.title.startsWith(TITLE + ' ') : front.title === TITLE);
    assert(dynamic ? o.foreground >= 10 : o.changedTitles === 0, 'Unexpected title observation');
    return { fullStates: o.fullStates, changedTitles: o.changedTitles,
      foreground: o.foreground, background: o.background, observedMs: o.at - start };
  };
}

async function main(path) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname !== '/probe' || !['0', '1'].includes(url.searchParams.get('dynamic'))) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(fixture(url.searchParams.get('dynamic') === '1'));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const trials = [];
  try {
    for (let pair = 1; pair <= 3; pair++) {
      for (const dynamic of (pair % 2 ? [false, true] : [true, false])) {
        const urls = Array.from({ length: TABS }, (_, i) =>
          'http://title-' + i + '.localhost:' + server.address().port + '/probe?dynamic=' + Number(dynamic));
        const run = await launchDexerion({ attempts: 2, gpu: 'adaptive' });
        try {
          await prepare(run.win, urls);
          await sleep(SETTLE);
          const finish = await observe(run.win, urls, dynamic);
          const capture = await profileMain(run.app, run.profile);
          const counts = await finish();
          assert(capture.elapsedMs >= DURATION - 100 && capture.elapsedMs < DURATION + 4000);
          assert(counts.observedMs >= capture.elapsedMs && counts.observedMs < capture.elapsedMs + 3000);
          const row = { pair, dynamic, counts, cpuMs: capture.cpuMs,
            elapsedMs: capture.elapsedMs, ...summarize(capture.captured) };
          console.log('TITLE PROFILE: ' + JSON.stringify(row));
          trials.push(row);
        } finally {
          await run.app.close().catch(() => {});
          fs.rmSync(run.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
        }
      }
    }
    fs.writeFileSync(path, JSON.stringify({ platform: process.platform, tabCount: TABS, trials,
      method: 'Title-only 500ms timer; both arms have identical page timers. Counts are observed trusted-shell full-state deliveries and title field changes, and include setup/stop inspector overhead; V8 reports exclusive sampled wall time. Fresh synthetic profile per trial, no Edge or whole-process-tree result.' }, null, 2));
  } finally { server.close(); }
}

if (require.main === module) main(process.argv[2] || 'runtime-title-profile.json').catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
