'use strict';
// Isolate the cold-account optimisation within the same Dexerion build.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');
const { launchDexerion } = require('../e2e/app');
const { seedInactiveAccounts } = require('./cold-account-fixture.cjs');
const { sumPss, readTree } = require('./cloud-proc-metrics.cjs');

async function sample(flag) {
  let fixture;
  const { app, win, profile } = await launchDexerion({
    attempts: 1, gpu: 'off', seedProfile: (dir) => { fixture = seedInactiveAccounts(dir); },
    env: { DEX_COLD_ACCOUNT_TASKS: flag },
  });
  try {
    // The initial reminder sweep starts five seconds after browser creation.
    // Both arms wait the same interval and keep all secondary accounts idle.
    await sleep(12000);
    const main = app.process().pid;
    const current = await win.evaluate(() => window.dexerion.invoke('dex:get-state'));
    if (current.account.id !== 'default' || current.accounts.length !== fixture.dormantAccounts + 1) {
      throw new Error('The expected default and dormant accounts did not load');
    }
    const tree = readTree(main);
    const mainPssMiB = sumPss(new Map([[main, tree.get(main)]]));
    const totalPssMiB = sumPss(tree);
    const mainHeapMiB = await app.evaluate(() => process.memoryUsage().heapUsed / 1024 / 1024);
    if (![mainPssMiB, totalPssMiB, mainHeapMiB].every((n) => Number.isFinite(n) && n > 0)) {
      throw new Error('Memory counters unavailable');
    }
    return { fixture, mainPssMiB, totalPssMiB, mainHeapMiB };
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(profile, { force: true, recursive: true, maxRetries: 3 });
  }
}

async function main() {
  if (process.platform !== 'linux' || !process.env.DISPLAY) throw new Error('Run on Linux with a display.');
  const report = {
    arm: { prior: 'DEX_COLD_ACCOUNT_TASKS=off', candidate: 'DEX_COLD_ACCOUNT_TASKS=on' },
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    prior: [], candidate: [],
  };
  for (let i = 0; i < 6; i++) {
    for (const arm of (i % 2 ? ['candidate', 'prior'] : ['prior', 'candidate'])) {
      report[arm].push(await sample(arm === 'prior' ? 'off' : 'on'));
    }
  }
  const med = (rows, key) => {
    const values = rows.map((r) => r[key]).sort((a, b) => a - b);
    return (values[2] + values[3]) / 2;
  };
  report.medians = Object.fromEntries(['mainPssMiB', 'totalPssMiB', 'mainHeapMiB'].map((key) => {
    const prior = med(report.prior, key), candidate = med(report.candidate, key);
    return [key, { prior, candidate, reductionPct: 100 * (1 - candidate / prior) }];
  }));
  fs.writeFileSync('cloud-cold-account-comparison.json', JSON.stringify(report, null, 2) + '\n');
  console.log('cold-accounts: ' + JSON.stringify(report));
}
if (require.main === module) main().catch((err) => { console.error(err.stack || err); process.exitCode = 1; });
