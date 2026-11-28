'use strict';
const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const { launchDexerion } = require('./app');
const { seedInactiveAccounts } = require('../scripts/cold-account-fixture.cjs');

test('activating an account after the dormant sweep retains its tasks and account isolation', async () => {
  const { app, win, profile } = await launchDexerion({
    seedProfile: (dir) => seedInactiveAccounts(dir, { count: 2, historyRows: 2, chats: 2 }),
  });
  const getTasks = (window) => window.evaluate(() => window.dexerion.invoke('dex:tasks-list'));
  try {
    expect(await getTasks(win)).toEqual([]);
    // Allow the native startup reminder sweep to run before activating.
    await win.waitForTimeout(6500);
    const ready = app.waitForEvent('window');
    await win.evaluate(() => window.dexerion.invoke('dex:account-switch', 'bench-cold-0'));
    const other = await ready;
    await expect(other.locator('#account-btn')).toHaveAttribute('title', /Signed in as Fixture 0/);
    expect(await getTasks(other)).toEqual([expect.objectContaining({ id: 'task-0', title: 'Fixture task 0', done: false })]);
    await other.evaluate(() => window.dexerion.invoke('dex:tasks-toggle', 'task-0', true));
    expect(await getTasks(other)).toEqual([expect.objectContaining({ id: 'task-0', done: true })]);
    expect(await getTasks(win)).toEqual([]);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(profile, { force: true, recursive: true, maxRetries: 3 });
  }
});
