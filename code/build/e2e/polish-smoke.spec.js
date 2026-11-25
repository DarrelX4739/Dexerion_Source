'use strict';
// Real smoke assertions for the V31–V50 programme.
//
// Replaces the old assertion-free debug.spec.js. Nothing here is diagnostic
// logging: every step asserts a user-visible fact through the trusted bridge.
// It is deliberately cheap (one launch, one mock reply) so it can gate a full
// E2E run before the heavier polish specs execute.

const { test, expect } = require('@playwright/test');
const { startAiMock } = require('./ai-mock');
const { launchDexerion } = require('./app');

const REPLY = 'Smoke reply from the local mock.';

test('polish smoke: app boots, key seeds, mock answer is stored and rendered', async () => {
  const mock = await startAiMock({ reply: REPLY });
  const { app, win } = await launchDexerion({ aiBase: mock.url });
  const pageErrors = [];
  win.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));
  try {
    // 1. Boot: the shell owns the bridge and the sidebar can be provisioned.
    const seeded = await win.evaluate(async () => ({
      hasBridge: Boolean(window.dexerion && typeof window.dexerion.invoke === 'function'),
      key: await window.dexerion.invoke('dex:ai-key-set', 'nvapi-e2e-polish-smoke'),
    }));
    expect(seeded.hasBridge).toBe(true);
    expect(seeded.key.hasKey).toBe(true);

    await win.evaluate(() => window.dexerion.invoke('dex:ai-open'));
    await win.waitForSelector('#ai-sidebar:not([hidden])', { timeout: 20000 });
    await expect(win.locator('#ai-setup')).toBeHidden({ timeout: 20000 });
    await expect(win.locator('#ai-input')).toBeVisible();
    await expect(win.locator('#ai-send')).toBeEnabled();

    // 2. Send: the mock really receives the turn and answers through the same
    //    stream path the product uses (not a hand-seeded chat).
    await win.fill('#ai-input', 'Say the smoke phrase');
    await win.press('#ai-input', 'Enter');
    await expect(win.locator('#ai-messages')).toContainText(REPLY, { timeout: 30000 });

    const stored = await win.evaluate(async () => {
      const list = await window.dexerion.invoke('dex:ai-chats-list');
      if (!Array.isArray(list) || !list.length) return null;
      const chat = await window.dexerion.invoke('dex:ai-chat-open', list[0].id);
      return {
        title: String(chat.title || ''),
        messages: (chat.messages || []).map((m) => ({ role: m.role, text: String(m.text || '') })),
      };
    });
    expect(stored).not.toBeNull();
    expect(stored.messages.some((m) => m.role === 'user' && m.text.includes('smoke phrase'))).toBe(true);
    expect(stored.messages.some((m) => m.role === 'model' && m.text.includes(REPLY))).toBe(true);
    expect(mock.requests.length).toBeGreaterThan(0);

    // 3. The idle send button is the observable "turn finished" state.
    await expect(win.locator('#ai-send')).toBeEnabled({ timeout: 30000 });
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close().catch(() => {});
    await mock.close();
  }
});

test('polish smoke: overlay menu opens with visible, clickable items', async () => {
  const mock = await startAiMock({ reply: REPLY });
  const { app, win } = await launchDexerion({ aiBase: mock.url });
  try {
    await win.evaluate(() => {
      const m = document.querySelector('#dmenu');
      if (m) m.hidden = true;
      const s = document.querySelector('#scrim');
      if (s) s.hidden = true;
    });
    await win.click('#menu-btn');
    await expect(win.locator('#dmenu')).toBeVisible({ timeout: 10000 });
    await expect(win.locator('#scrim')).toBeVisible({ timeout: 10000 });

    // Regression: the container was unhidden but items stayed at opacity:0
    // because their entrance animation never attached inside display:none.
    const opacities = await win.$$eval('#dmenu .mitem', (els) =>
      els.map((el) => Number(getComputedStyle(el).opacity)));
    expect(opacities.length).toBeGreaterThanOrEqual(5);
    expect(opacities.every((o) => o > 0.5)).toBe(true);
    await expect(win.locator('#dmenu .mitem[data-m="new-tab"]')).toBeVisible();

    await win.click('#scrim', { position: { x: 4, y: 4 } });
    await expect(win.locator('#dmenu')).toBeHidden({ timeout: 10000 });
  } finally {
    await app.close().catch(() => {});
    await mock.close();
  }
});
