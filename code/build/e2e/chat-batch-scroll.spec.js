'use strict';

const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const { launchDexerion } = require('./app');

const { seedProfile } = require('./chat-scroll-fixture');

test('reopening a long saved chat measures and scrolls its thread once, after painting the same last 200 messages', async () => {
  const { app, win, profile } = await launchDexerion({ seedProfile });
  try {
    await win.evaluate(() => window.dexerion.invoke('dex:ai-open'));
    await expect(win.locator('#ai-sidebar')).toBeVisible();
    await expect(win.locator('#ai-taskbar-title')).toHaveText('Short saved conversation');
    await win.evaluate(() => {
      const thread = document.getElementById('ai-messages');
      const native = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
      let writes = 0;
      Object.defineProperty(thread, 'scrollTop', {
        get() { return native.get.call(this); },
        set(value) { writes++; native.set.call(this, value); },
      });
      window.__testChatScrollWrites = () => writes;
    });
    await win.getByRole('button', { name: 'Open chat history', exact: true }).click();
    const history = win.locator('#ai-chat-sheet');
    await history.getByText('Long saved conversation', { exact: true }).click();
    await expect(win.locator('#ai-taskbar-title')).toHaveText('Long saved conversation');
    await history.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(history).toBeHidden();
    const rows = win.locator('#ai-messages .ai-message');
    await expect(rows).toHaveCount(200);
    await expect(rows.first()).toContainText('Saved message 25');
    await expect(rows.last()).toContainText('Saved message 224');
    const thread = win.locator('#ai-messages');
    await expect.poll(() => thread.evaluate((el) =>
      el.scrollHeight > el.clientHeight && el.scrollHeight - el.clientHeight - el.scrollTop <= 2)).toBe(true);
    expect(await win.evaluate(() => window.__testChatScrollWrites())).toBe(1);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  }
});
