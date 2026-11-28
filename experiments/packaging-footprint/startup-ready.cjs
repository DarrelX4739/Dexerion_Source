'use strict';
// Same-host paired app readiness, not stock launch or Edge.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { setTimeout: sleep } = require('node:timers/promises');
const { _electron } = require(require.resolve('@playwright/test', { paths: [process.cwd()] }));
const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function trial(executable) {
  const exe = path.resolve(executable);
  assert.ok(fs.statSync(exe).isFile());
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-package-ready-'));
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ welcomeDaily: false }));
  let app;
  try {
    const launch = performance.now();
    app = await _electron.launch({ executablePath: exe, cwd: path.dirname(exe),
      args: ['--user-data-dir=' + profile], timeout: 45000 });
    const connectedMs = performance.now() - launch;
    const win = await app.firstWindow({ timeout: 45000 });
    await win.waitForFunction(async () => {
      const field = document.getElementById('omnibox');
      if (!field || !field.getClientRects().length || document.visibilityState !== 'visible') return false;
      const state = await window.dexerion?.invoke('dex:get-state');
      return !!state?.active && Array.isArray(state.tabs) && state.tabs.length === 1 && typeof state.tabs[0].url === 'string' && state.tabs[0].url.startsWith('dexerion://newtab');
    }, null, { timeout: 24000 });
    const readyMs = performance.now() - launch;
    const info = await app.evaluate(({ app }) => ({ archive: app.getAppPath(),
      packaged: app.isPackaged, electron: process.versions.electron }));
    assert.equal(info.packaged, true);
    assert.equal(info.electron, '44.4.5');
    assert.equal(path.basename(info.archive), 'app.asar');
    return { connectedMs, readyMs };
  } finally {
    try { if (app) await app.close(); }
    finally { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
  }
}
async function main() {
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  const [original, candidate] = process.argv.slice(2);
  assert.ok(original && candidate && path.resolve(original) !== path.resolve(candidate));
  const rows = [];
  for (let i = 0; i < 9; i += 1) {
    const pair = {};
    const order = i % 2 ? ['candidate', 'original'] : ['original', 'candidate'];
    const arms = { original, candidate };
    for (const arm of order) {
      pair[arm] = await trial(arms[arm]);
      await sleep(700);
    }
    rows.push({ order, ...pair });
  }
  const changeMs = rows.map((r) => r.candidate.readyMs - r.original.readyMs);
  const summary = { originalReadyMedMs: med(rows.map((r) => r.original.readyMs)),
    candidateReadyMedMs: med(rows.map((r) => r.candidate.readyMs)),
    pairedDeltaMedMs: med(changeMs), pairedDeltaRangeMs: [Math.min(...changeMs), Math.max(...changeMs)] };
  const report = { platform: process.platform, rows, summary,
    scope: 'Identical locked Electron builds except removal of redundant packed modules. Instrumented spawn to usable omnibox and visible new tab; not stock startup.' };
  console.log('PACKAGED READINESS: ' + JSON.stringify(summary));
  fs.writeFileSync('package-readiness.json', JSON.stringify(report, null, 2) + '\n');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
