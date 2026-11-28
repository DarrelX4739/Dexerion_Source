'use strict';

const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const { launchDexerion } = require('./app');
const { savedSiteChat, writeChats } = require('../scripts/fixtures/saved-site-history.cjs');

test('opening a saved site renders its exact source and restores a previous saved version', async () => {
  const saved = savedSiteChat();
  const original = saved.messages[1].artifact;
  const stylesheet = original.files.find(f => f.path === 'styles.css').content;
  expect(stylesheet.length).toBeGreaterThan(4096);
  const { app, win, profile } = await launchDexerion({ seedProfile: dir => writeChats(dir, 'default', [saved]) });
  try {
    await win.evaluate(() => window.dexerion.invoke('dex:ai-open'));
    await expect(win.locator('#ai-sidebar')).toBeVisible();
    await expect(win.locator('#ai-taskbar-title')).toHaveText(saved.title);
    const preview = win.frameLocator('#ai-messages .dxa-card[data-kind="site"] iframe.dxa-frame:not([style*="visibility: hidden"])');
    await expect(preview.getByTestId('saved-site-edition')).toHaveText('Saved site edition 3', { timeout: 30000 });
    const loaded = await win.evaluate(id => window.dexerion.invoke('dex:ai-chat-open', id), saved.id);
    expect(loaded.messages[1].artifact).toEqual(original);

    const response = await win.evaluate(({ id, at }) => window.dexerion.invoke('dex:ai-artifact-restore', {
      chatId: id, index: 1, at,
    }), { id: saved.id, at: original.history[0].at });
    expect(response.ok).toBe(true);
    expect(response.artifact.files).toEqual(original.history[0].artifact.files);
    expect(response.artifact.files.find(f => f.path === 'styles.css').content).toBe(stylesheet);
    const restored = await win.evaluate(id => window.dexerion.invoke('dex:ai-chat-open', id), saved.id);
    expect(restored.messages[1].artifact.files).toEqual(original.history[0].artifact.files);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  }
});
