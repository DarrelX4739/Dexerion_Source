'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { launchDexerion } = require('./app');

test('new-tab tasks keep local timed and all-day labels, overdue state, and mark-done control', async () => {
  const now = Date.now();
  const timed = now - 3_600_000, allDay = now + 86_400_000;
  const { app, profile } = await launchDexerion({ seedProfile(dir) {
    const acct = path.join(dir, 'Accounts', 'default');
    fs.mkdirSync(acct, { recursive: true });
    fs.writeFileSync(path.join(acct, 'bookmarks.json'), JSON.stringify({ roots: { bar: [], other: [] } }));
    fs.writeFileSync(path.join(acct, 'tasks.json'), JSON.stringify([
      { id: 'timed', title: 'Timed task', notes: 'The whole description', dueMs: timed, hasTime: true, priority: 'high', createdAt: now },
      { id: 'all-day', title: 'All-day task', dueMs: allDay, hasTime: false, priority: 'medium', createdAt: now },
    ]));
  } });
  try {
    let page;
    await expect.poll(async () => {
      page = app.windows().find(w => /^dexerion:\/\/newtab/.test(w.url()));
      return Boolean(page);
    }).toBe(true);
    const expected = await page.evaluate(([withTime, withoutTime]) => {
      const a = new Date(withTime), b = new Date(withoutTime);
      const day = { month: 'short', day: 'numeric' };
      return [a.toLocaleDateString(undefined, day) + ' ' + a.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
        b.toLocaleDateString(undefined, day)];
    }, [timed, allDay]);
    const rows = page.locator('#tasks-nt .tk-todo');
    await expect(rows).toHaveCount(2);
    await expect(rows.first().locator('small')).toHaveText(expected[0]);
    await expect(rows.first().locator('small')).toHaveClass('overdue');
    await expect(rows.last().locator('small')).toHaveText(expected[1]);
    await expect(rows.last().locator('small')).not.toHaveClass('overdue');
    await rows.first().getByRole('button', { name: 'Show full description' }).click();
    await expect(rows.first().getByRole('button', { name: 'Collapse description' })).toHaveAttribute('aria-expanded', 'true');
    await expect(rows.first().locator('.tk-desc')).toHaveText('The whole description');
    await rows.first().getByRole('button', { name: 'Mark done: Timed task' }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first().locator('b')).toHaveText('All-day task');
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  }
});
