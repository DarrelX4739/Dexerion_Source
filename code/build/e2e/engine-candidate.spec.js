'use strict';
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const { launchDexerion } = require('./app');

test('the requested candidate runtime really boots Dexerion', async () => {
  const expected = process.env.DEX_ENGINE_CANDIDATE;
  test.skip(!expected, 'This gate runs only for the temporary runtime candidate.');
  const { app, win, profile } = await launchDexerion();
  try {
    expect(await app.evaluate(() => process.versions.electron)).toBe(expected);
    await expect(win.locator('#omnibox')).toBeVisible();
    const state = await win.evaluate(() => window.dexerion.invoke('dex:get-state'));
    expect(state.tabs.length).toBeGreaterThan(0);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(profile, { force: true, recursive: true, maxRetries: 3 });
  }
});
