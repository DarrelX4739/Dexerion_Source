'use strict';
// V3 mechanism probe: which modules of the main-process AI dependency chain
// are loaded at BOOT, and what they weigh. Complements
// probe-memory-footprint.js (whole-tree WS, where a sub-MB main-process
// module delta is invisible inside +-1-2MB run noise): this probe reads the
// main process's own require.cache â€” the ground truth for "did boot load it"
// â€” plus process.memoryUsage() before and after the full chain is pulled in.
//
// It launches the real app (throwaway profile, e2e harness) and reports; it
// does not judge and it never opens the AI panel. Lines it prints:
//   AI_BOOT_LOADED     AI-chain modules present in require.cache at boot
//   AI_BOOT_BYTES      total source bytes of those modules
//   AI_DEFERRED        AI-chain modules NOT loaded at boot (the lazy set)
//   AI_TOUCH_LOADED    the same chain after every module is require()d once
//   MAIN_RSS_MB / MAIN_HEAP_MB / MAIN_EXTERNAL_MB   boot -> touch -> delta
// Kill switches under test behave here exactly as in the app:
//   DEX_EAGER_AI=1 or DEX_DEBLOAT_BASELINE=1 must show AI_DEFERRED = none.
//
// NOTE on app.evaluate: Playwright's ElectronApplication.evaluate always
// passes the electron module object as the function's first argument and
// ignores any second argument, so the two phases below are two SEPARATE
// self-contained functions (no flag argument) â€” the boot survey must never
// require anything itself.

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { launchDexerion } = require('../e2e/app');

const OUT = process.env.PROBE_AI_MODULES_OUT
  || path.join(os.tmpdir(), 'opencode', 'probe-ai-boot-modules.json');
const SETTLE_MS = Number(process.env.PROBE_AI_SETTLE_MS) || 5000;

// Both functions below run serialized inside the Electron MAIN process: they
// are self-contained by design (closure variables do not survive the hop) â€”
// they may only use their params, Node globals and modules they require
// themselves. Their first parameter is Playwright's electron module object.
async function surveyBoot() {
  const chain = [
    'ai.js',
    'ai-providers.js',
    'ai-router.js',
    'ai-artifacts.js',
    'ai-site-quality.js',
    'site-interactivity.js',
    'site-research-assets.js',
    'ai-search-read.js',
    'ai-search-rank.js',
    'ai-model-scout.js',
    'ai-prompts.js',
    'ai-skills.js',
  ];
  const mm = process.mainModule;
  if (!mm || typeof mm.require !== 'function') {
    return { error: 'no main-module require in the main process scope' };
  }
  const cache = mm.constructor._cache;
  if (!cache) return { error: 'no module cache on the main module' };
  const fsMod = mm.require('node:fs');
  const pathMod = mm.require('node:path');
  const mainFile = Object.keys(cache).find((f) => /src[\\/]main[\\/]browser\.js$/.test(f));
  if (!mainFile) return { error: 'browser.js not in require.cache' };
  const dir = pathMod.dirname(mainFile);
  const rows = chain.map((name) => {
    const file = pathMod.join(dir, name);
    let bytes = null;
    try { bytes = fsMod.statSync(file).size; } catch {}
    // parent chain: who pulled this module first (browser.js pin vs ai.js)
    const parents = [];
    let m = cache[file] || null;
    for (let i = 0; i < 4 && m; i++) {
      parents.push(m.filename ? pathMod.basename(m.filename) : String(m.id));
      m = m.parent || null;
    }
    return { name, loaded: Boolean(cache[file]), bytes, parents };
  });
  const mem = process.memoryUsage();
  const round1 = (v) => Math.round(v * 10) / 10;
  return {
    rows,
    loadedNames: rows.filter((r) => r.loaded).map((r) => r.name),
    deferredNames: rows.filter((r) => !r.loaded).map((r) => r.name),
    loadedBytes: rows.filter((r) => r.loaded).reduce((n, r) => n + (r.bytes || 0), 0),
    deferredBytes: rows.filter((r) => !r.loaded).reduce((n, r) => n + (r.bytes || 0), 0),
    rssMB: round1(mem.rss / 1048576),
    heapUsedMB: round1(mem.heapUsed / 1048576),
    externalMB: round1(mem.external / 1048576),
  };
}

// "AI stack actually used" endpoint of the A/B: require every still-missing
// chain module directly in the main process, then re-survey. Production touch
// paths (panel, search, skills, agent) are the Playwright suite's job; this
// probe only needs the fully-loaded extreme for the memory delta.
async function surveyAfterTouch() {
  const chain = [
    'ai.js',
    'ai-providers.js',
    'ai-router.js',
    'ai-artifacts.js',
    'ai-site-quality.js',
    'site-interactivity.js',
    'site-research-assets.js',
    'ai-search-read.js',
    'ai-search-rank.js',
    'ai-model-scout.js',
    'ai-prompts.js',
    'ai-skills.js',
  ];
  const mm = process.mainModule;
  if (!mm || typeof mm.require !== 'function') {
    return { error: 'no main-module require in the main process scope' };
  }
  const cache = mm.constructor._cache;
  if (!cache) return { error: 'no module cache on the main module' };
  const pathMod = mm.require('node:path');
  const mainFile = Object.keys(cache).find((f) => /src[\\/]main[\\/]browser\.js$/.test(f));
  if (!mainFile) return { error: 'browser.js not in require.cache' };
  const dir = pathMod.dirname(mainFile);
  const failures = [];
  for (const name of chain) {
    const file = pathMod.join(dir, name);
    if (!cache[file]) {
      try {
        mm.require(file);
        if (!cache[file]) failures.push(name + ': require did not populate the cache');
      } catch (err) {
        failures.push(name + ': ' + ((err && err.message) || err));
      }
    }
  }
  const fsMod = mm.require('node:fs');
  const rows = chain.map((name) => {
    const file = pathMod.join(dir, name);
    let bytes = null;
    try { bytes = fsMod.statSync(file).size; } catch {}
    const parents = [];
    let m = cache[file] || null;
    for (let i = 0; i < 4 && m; i++) {
      parents.push(m.filename ? pathMod.basename(m.filename) : String(m.id));
      m = m.parent || null;
    }
    return { name, loaded: Boolean(cache[file]), bytes, parents };
  });
  const mem = process.memoryUsage();
  const round1 = (v) => Math.round(v * 10) / 10;
  return {
    rows,
    loadedNames: rows.filter((r) => r.loaded).map((r) => r.name),
    loadedBytes: rows.filter((r) => r.loaded).reduce((n, r) => n + (r.bytes || 0), 0),
    rssMB: round1(mem.rss / 1048576),
    heapUsedMB: round1(mem.heapUsed / 1048576),
    externalMB: round1(mem.external / 1048576),
    failures,
  };
}

(async () => {
  const launched = await launchDexerion({ attempts: 2, gpu: process.env.DEX_PROBE_GPU || 'adaptive' });
  const { app, win } = launched;
  try {
    await win.waitForLoadState('domcontentloaded');
    await new Promise((r) => setTimeout(r, SETTLE_MS));

    const boot = await app.evaluate(surveyBoot);
    if (boot.error) throw new Error('boot survey failed: ' + boot.error);
    const touch = await app.evaluate(surveyAfterTouch);
    if (touch.error) throw new Error('touch survey failed: ' + touch.error);

    const result = {
      generatedAt: new Date().toISOString(),
      profile: process.env.DEX_DEBLOAT_BASELINE === '1' ? 'baseline' : 'optimized',
      eagerKillSwitch: process.env.DEX_EAGER_AI === '1',
      chain: boot.rows.map((r) => r.name),
      boot,
      touch,
    };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');

    console.log('AI_BOOT_LOADED: ' + boot.loadedNames.length + ' [' + boot.loadedNames.join(', ') + ']');
    console.log('AI_BOOT_BYTES: ' + boot.loadedBytes);
    console.log('AI_DEFERRED: ' + boot.deferredNames.length + ' [' + boot.deferredNames.join(', ') + '] bytes=' + boot.deferredBytes);
    console.log('AI_TOUCH_LOADED: ' + touch.loadedNames.length + '/' + boot.rows.length
      + (touch.failures.length ? ' failures=[' + touch.failures.join('; ') + ']' : ''));
    console.log('MAIN_RSS_MB: boot=' + boot.rssMB + ' touch=' + touch.rssMB + ' delta=' + Math.round((touch.rssMB - boot.rssMB) * 10) / 10);
    console.log('MAIN_HEAP_MB: boot=' + boot.heapUsedMB + ' touch=' + touch.heapUsedMB + ' delta=' + Math.round((touch.heapUsedMB - boot.heapUsedMB) * 10) / 10);
    console.log('MAIN_EXTERNAL_MB: boot=' + boot.externalMB + ' touch=' + touch.externalMB + ' delta=' + Math.round((touch.externalMB - boot.externalMB) * 10) / 10);
    console.log('AI BOOT MODULE PROBE EVIDENCE: ' + OUT);
    console.log('AI BOOT MODULE PROBE OK');
  } finally {
    try { await launched.app.close(); } catch {}
  }
})().catch((err) => {
  console.error('AI BOOT MODULE PROBE ERROR: ' + (err && err.stack || err));
  process.exitCode = 1;
});

