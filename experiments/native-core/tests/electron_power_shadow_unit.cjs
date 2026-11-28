// Exercise the observer boundary without a desktop. This is not the live
// integration test: failing or skipped live runs cannot be replaced by it.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { compareNative, captureInMain } = require('./electron_power_shadow.cjs');
const [binary, sourceRoot] = process.argv.slice(2);
assert.ok(binary);
const repo = path.resolve(sourceRoot || path.resolve(__dirname, '../../..'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dexerion-e2e-'));
const originalFlag = process.env.DEX_AI_TEST;
const app = { isPackaged: false, getPath: () => profile, getAppPath: () => path.join(repo, 'code/build') };
const js = require(path.join(repo, 'code/code/src/main/adaptive-power.js'));
const original = js.runtimePlan;
try {
  delete process.env.DEX_AI_TEST;
  assert.throws(() => captureInMain({ app }, profile), /non-test profile/);
  process.env.DEX_AI_TEST = '1';
  assert.throws(() => captureInMain({ app: { ...app, isPackaged: true } }, profile), /non-test profile/);
  assert.throws(() => captureInMain({ app }, profile + 'other'), /non-test profile/);
  assert.equal(js.runtimePlan, original);
  captureInMain({ app }, profile);
  const s = { focused: true, minimized: false, locked: false, onBattery: false,
    video: false, webgl: false, animation: false, loading: false, audible: false, interacting: true,
    idleMs: 500, freeMemMB: 4096, cpuPct: 5.25, activeTabCount: 1, SECRET: 'not-recorded' };
  const b = { sweepIntervalMs: 60000, idleSleepMs: 180000, sweepDeepIdleMs: 600000 };
  const args = [s, 'minimal', 1000000, { tierSince: 990000 }, b];
  assert.deepEqual(js.runtimePlan(...args), original(...args));
  s.minimized = true;
  assert.deepEqual(js.runtimePlan(...args), original(...args));
  const log = globalThis.__dexNativePolicyShadow.restore();
  assert.equal(js.runtimePlan, original); assert.equal(log.errors, 0);
  assert.equal(log.rows.length, 2); assert.equal(log.overflow, false);
  assert.equal(JSON.stringify(log).includes('not-recorded'), false);
  compareNative(binary, log.rows);
  assert.throws(() => compareNative(binary, []), /zero real decisions/);
  log.rows[0].plan.gpuTier = 'mismatch';
  assert.throws(() => compareNative(binary, log.rows), /actual browser decision #0/);
  console.log('PASS observer safeguards, JS return preservation, capture whitelist and negative native comparison');
} finally {
  globalThis.__dexNativePolicyShadow?.restore();
  if (originalFlag === undefined) delete process.env.DEX_AI_TEST;
  else process.env.DEX_AI_TEST = originalFlag;
  fs.rmSync(profile, { recursive: true, force: true });
}
