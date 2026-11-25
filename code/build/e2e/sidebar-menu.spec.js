'use strict';
// Regression gate for the AI sidebar overflow menu.
//
// The rejected visual overlay is gone, but the menu wiring itself is kept.
// This spec proves every item is the top-most hit target (the old failure was
// the conversation thread swallowing clicks) and that each item opens its
// sheet. It uses the normal throwaway-profile E2E launcher.

const { test, expect } = require('@playwright/test');
const { startAiMock } = require('./ai-mock');
const { launchDexerion } = require('./app');

const ITEMS = [
  ['msg-search', 'ai-msg-search-sheet'],
  ['recipes', 'ai-recipe-sheet'],
  ['memory', 'ai-memory-sheet'],
  ['missions', 'ai-mission-sheet'],
  ['projects', 'ai-project-sheet'],
  ['skill-log', 'ai-skill-log-sheet'],
  ['settings', 'ai-settings-sheet'],
];

test('AI sidebar menu buttons open their sheets', async () => {
  const mock = await startAiMock({ reply: 'Sidebar menu regression reply.' });
  const { app, win } = await launchDexerion({ aiBase: mock.url });
  const errors = [];
  win.on('pageerror', (err) => errors.push(String((err && err.message) || err)));
  try {
    await win.evaluate(async () => {
      await window.dexerion.invoke('dex:ai-key-set', 'nvapi-e2e-sidebar-menu');
      await window.dexerion.invoke('dex:ai-open');
    });
    await win.waitForSelector('#ai-sidebar:not([hidden])', { timeout: 20000 });
    await win.waitForTimeout(400);
    // "Search conversation" is intentionally inert until a chat is active.
    await win.click('#ai-new');
    await win.waitForTimeout(400);

    // The visual overlay must not be present after the user-requested revert.
    const reverted = await win.evaluate(() => ({
      ui2: document.documentElement.getAttribute('data-ui2'),
      controller: Boolean(window.DexUIv2),
      overlayCss: [...document.styleSheets].some((s) => /ui-v2\.css/.test(s.href || '')),
    }));
    expect(reverted.ui2).toBe(null);
    expect(reverted.controller).toBe(false);
    expect(reverted.overlayCss).toBe(false);

    // The lightning and eye controls are real, hit-testable buttons and their
    // persisted capability switches round-trip through main.
    const toggles = await win.$$eval('#ai-agent-toggle, #ai-vision-toggle', (els) => els.map((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { id: el.id, pressed: el.getAttribute('aria-pressed'), clickable: Boolean(top && (top === el || el.contains(top))) };
    }));
    expect(toggles.map((t) => t.id)).toEqual(['ai-agent-toggle', 'ai-vision-toggle']);
    expect(toggles.every((t) => t.clickable && (t.pressed === 'true' || t.pressed === 'false'))).toBe(true);
    await win.click('#ai-agent-toggle');
    await win.click('#ai-vision-toggle');
    await win.waitForFunction(() => document.getElementById('ai-agent-toggle').getAttribute('aria-pressed') === 'true'
      && document.getElementById('ai-vision-toggle').getAttribute('aria-pressed') === 'true');
    const caps = await win.evaluate(() => window.dexerion.invoke('dex:ai-caps-get'));
    expect(caps.agent).toBe(true);
    expect(caps.vision).toBe(true);
    await win.click('#ai-agent-toggle');
    await win.click('#ai-vision-toggle');
    await win.waitForFunction(() => document.getElementById('ai-agent-toggle').getAttribute('aria-pressed') === 'false'
      && document.getElementById('ai-vision-toggle').getAttribute('aria-pressed') === 'false');
    console.log('AI CAPABILITY TOGGLES PASS');

    await win.click('#ai-more');
    await win.waitForSelector('#ai-more-menu:not([hidden])', { timeout: 10000 });
    const hitTargets = await win.$$eval('#ai-more-menu .ai-overflow-item', (els) => els.map((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return {
        sheet: el.dataset.sheet,
        clickable: Boolean(top && (top === el || el.contains(top))),
      };
    }));
    expect(hitTargets.map((x) => x.sheet)).toEqual(ITEMS.map(([sheet]) => sheet));
    expect(hitTargets.every((x) => x.clickable)).toBe(true);
    await win.click('#ai-more');
    await win.waitForSelector('#ai-more-menu[hidden]', { state: 'hidden', timeout: 10000 });

    for (const [sheet, sheetId] of ITEMS) {
      await win.click('#ai-more');
      await win.waitForSelector('#ai-more-menu:not([hidden])', { timeout: 10000 });
      await win.click(`#ai-more-menu [data-sheet="${sheet}"]`);
      await win.waitForSelector(`#${sheetId}:not([hidden])`, { timeout: 10000 });
      const open = await win.$eval(`#${sheetId}`, (el) => !el.hidden && !el.inert);
      expect(open, sheet + ' sheet should be interactive').toBe(true);
      const menuClosed = await win.$eval('#ai-more-menu', (el) => el.hidden);
      expect(menuClosed, 'menu should close after an action').toBe(true);
      await win.keyboard.press('Escape');
      await win.waitForSelector(`#${sheetId}[hidden]`, { state: 'hidden', timeout: 10000 });
    }

    // Website access and document editing are separate Settings switches and
    // persist through main; they are not model-self-service toggles.
    await win.click('#ai-more');
    await win.click('#ai-more-menu [data-sheet="settings"]');
    await win.waitForSelector('#ai-settings-sheet:not([hidden])', { timeout: 10000 });
    await win.evaluate(() => {
      document.getElementById('ai-set-websites').click();
      document.getElementById('ai-set-documents').click();
    });
    await win.waitForTimeout(300);
    const settingsOn = await win.evaluate(() => window.dexerion.invoke('dex:ai-caps-get'));
    expect(settingsOn.websites).toBe(true);
    expect(settingsOn.documents).toBe(true);
    await win.evaluate(() => {
      document.getElementById('ai-set-websites').click();
      document.getElementById('ai-set-documents').click();
    });
    await win.waitForTimeout(300);
    const settingsOff = await win.evaluate(() => window.dexerion.invoke('dex:ai-caps-get'));
    expect(settingsOff.websites).toBe(false);
    expect(settingsOff.documents).toBe(false);
    console.log('AI CAPABILITY SETTINGS PASS');
    await win.keyboard.press('Escape');
    await win.waitForSelector('#ai-settings-sheet[hidden]', { state: 'hidden', timeout: 10000 });

    // Keyboard-only path still works after the revert.
    await win.focus('#ai-more');
    await win.keyboard.press('ArrowDown');
    await win.waitForSelector('#ai-more-menu:not([hidden])', { timeout: 10000 });
    const focused = await win.evaluate(() => document.activeElement && document.activeElement.dataset.sheet);
    expect(focused).toBe(ITEMS[0][0]);
    await win.keyboard.press('ArrowDown');
    const focusedSecond = await win.evaluate(() => document.activeElement && document.activeElement.dataset.sheet);
    expect(focusedSecond).toBe(ITEMS[1][0]);
    await win.keyboard.press('Escape');
    await win.waitForSelector('#ai-more-menu[hidden]', { state: 'hidden', timeout: 10000 });

    expect(errors).toEqual([]);
    console.log('AI SIDEBAR MENU PASS');
  } finally {
    await app.close().catch(() => {});
    await mock.close();
  }
});

