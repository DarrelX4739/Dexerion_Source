'use strict';
const fs = require('node:fs/promises');
const { test, expect } = require('@playwright/test');
const { launchDexerion } = require('./app');

test('the group editor stays inside the native rail and keeps group actions accessible', async () => {
  const { app, win, profile } = await launchDexerion();
  const errors = [];
  win.on('pageerror', e => errors.push(e.message));
  try {
    const rail = win.locator('#tabstrip');
    const panel = win.getByRole('dialog', { name:'Edit tab group' });
    const chip = win.locator('#tabs .gchip').first();
    const state = () => win.evaluate(() => window.dexerion.invoke('dex:get-state'));
    const groupId = await win.evaluate(async () => {
      const add = () => window.dexerion.invoke('dex:new-tab', 'dexerion://newtab', false);
      const a = await add(), b = await add();
      await window.dexerion.invoke('dex:activate-tab', a);
      await window.dexerion.invoke('dex:tab-group', a, b);
      const current = await window.dexerion.invoke('dex:get-state');
      return current.tabs.find(t => t.id === a).groupId;
    });
    const group = async () => (await state()).groups.find(g => g.id === groupId);
    const before = await group();
    await expect(chip).toBeVisible();
    await expect(rail).toHaveClass(/rail-collapsed/);
    await app.evaluate(({ BrowserWindow }) => {
      const owner = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('shell.html'));
      owner.setSize(760, 540);
    });
    // Right-click the compact chip without waiting for the usual hover expansion.
    await chip.click({ button:'right' });
    await expect(panel).toBeVisible();

    await expect.poll(async () => {
      const native = await app.evaluate(({ BrowserWindow }) => {
        const owner = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('shell.html'));
        const view = owner.contentView.children.find(v => v.webContents?.getURL().startsWith('dexerion://newtab') &&
          v.getVisible() && v.getBounds().width > 100 && v.getBounds().height > 100);
        return view?.getBounds().x;
      });
      const bounds = await panel.boundingBox();
      return !!bounds && bounds.x >= 8 && Math.round(bounds.x + bounds.width) <= native - 7;
    }).toBe(true);

    const name = panel.getByRole('textbox', { name:'Group name' });
    const disclosure = panel.getByRole('button', { name:/^Color:/ });
    const colors = panel.getByRole('group', { name:'Group colors' });
    await expect(name).toBeFocused();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await disclosure.hover();
    await expect(colors.getByRole('button')).toHaveCount(9);
    await expect(colors.locator('[aria-pressed="true"]')).toHaveAttribute('aria-label', before.color);
    await win.mouse.move(350, 25);
    await expect(colors).toBeHidden();
    await win.keyboard.press('Tab');
    await expect(disclosure).toBeFocused();
    await win.keyboard.press('Space');
    const swatch = colors.getByRole('button', { name:before.color === 'purple' ? 'blue' : 'purple' });
    await expect(swatch).toBeVisible();
    await name.fill('Review tabs');
    await swatch.click();
    await expect(panel).toBeHidden();
    await expect.poll(group).toMatchObject({ name:'Review tabs', color:before.color === 'purple' ? 'blue' : 'purple' });

    await chip.click({ button:'right' });
    await name.fill('Do not save');
    await name.press('Escape');
    await expect(panel).toBeHidden();
    expect((await group()).name).toBe('Review tabs');
    expect(errors).toEqual([]);
  } finally {
    await app.close().catch(() => {});
    await fs.rm(profile, { recursive:true, force:true }).catch(() => {});
  }
});
