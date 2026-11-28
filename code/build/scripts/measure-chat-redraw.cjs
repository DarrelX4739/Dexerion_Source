'use strict';

// Real Electron, synthetic profiles. Measures the browser renderer's layout
// and script costs of reopening the same saved conversation, not whole-app RAM.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launchDexerion } = require('../e2e/app');
const { seedProfile } = require('../e2e/chat-scroll-fixture');

const counters = ['LayoutCount', 'LayoutDuration', 'RecalcStyleCount', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration'];
async function measure(buildDir) {
  const { app, win, profile } = await launchDexerion({ seedProfile, attempts: 2, buildDir });
  let session;
  try {
    await win.evaluate(() => window.dexerion.invoke('dex:ai-open'));
    await win.waitForFunction(() => document.getElementById('ai-taskbar-title')?.textContent === 'Short saved conversation');
    await win.getByRole('button', { name: 'Open chat history', exact: true }).click();
    const choice = win.locator('#ai-chat-sheet').getByText('Long saved conversation', { exact: true });
    await choice.waitFor({ state: 'visible' });
    session = await app.context().newCDPSession(win);
    await session.send('Performance.enable');
    const values = async () => Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]));
    const before = await values();
    const targetStart = await win.evaluate(() => performance.now());
    await choice.click();
    await win.waitForFunction(() => document.querySelectorAll('#ai-messages .ai-message').length === 200);
    const targetEnd = await win.evaluate(() => performance.now());
    const after = await values();
    const pageCost = {};
    for (const k of counters) {
      assert(Number.isFinite(before[k]) && Number.isFinite(after[k]), 'Missing Chromium counter ' + k);
      pageCost[k] = after[k] - before[k];
    }
    return { ...pageCost, wallMs: targetEnd - targetStart };
  } finally {
    if (session) await session.detach().catch(() => {});
    await app.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

(async () => {
  const ref = process.env.DEX_CHAT_REFERENCE_BUILD;
  if (!ref) throw new Error('DEX_CHAT_REFERENCE_BUILD must point to the control build');
  const trials = 5, arms = { reference: [], candidate: [] };
  for (let i = 0; i < trials; i++) {
    const order = i % 2 ? ['candidate', 'reference'] : ['reference', 'candidate'];
    for (const arm of order) {
      const result = await measure(arm === 'reference' ? path.resolve(ref) : undefined);
      arms[arm].push(result);
      console.log(arm + ' chat redraw: ' + JSON.stringify(result));
    }
  }
  const middle = (list, key) => list.map((row) => row[key]).sort((a, b) => a - b)[Math.floor(list.length / 2)];
  const medians = Object.fromEntries(Object.entries(arms).map(([arm, list]) => [
    arm, Object.fromEntries([...counters, 'wallMs'].map((k) => [k, middle(list, k)])),
  ]));
  const data = { paintedMessages: 200, trials, medians, arms };
  console.log('PAIRED NATIVE CHAT REDRAW ' + JSON.stringify(data));
  fs.writeFileSync('cloud-chat-redraw.json', JSON.stringify(data, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
