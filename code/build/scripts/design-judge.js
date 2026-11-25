'use strict';
// V51-V130 design judge. No design MCP is exposed in this environment, so the
// judgement combines deterministic in-app geometry/a11y/token checks with
// screenshots that are reviewed directly. It never launches the installed app.

const fs = require('node:fs');
const path = require('node:path');
const { startAiMock } = require('../e2e/ai-mock');
const { launchDexerion } = require('../e2e/app');

const OUT = process.env.DESIGN_JUDGE_OUT
  || 'C:\\Users\\Darre\\AppData\\Local\\Temp\\opencode\\design-judge.json';
const SHOT_DIR = process.env.DESIGN_JUDGE_SHOTS
  || 'C:\\Users\\Darre\\AppData\\Local\\Temp\\opencode\\design-shots';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseRgb(value) {
  const m = /rgba?\(([^)]+)\)/.exec(String(value || ''));
  if (!m) return null;
  const parts = m[1].split(',').map((x) => Number.parseFloat(x));
  return parts.length >= 3 ? parts.slice(0, 3) : null;
}
function luminance(rgb) {
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => {
    const c = Math.max(0, Math.min(1, v / 255));
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const l1 = luminance(parseRgb(a));
  const l2 = luminance(parseRgb(b));
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  let launched = null;
  const mock = await startAiMock({ reply: 'Design judge reply.' });
  try {
    launched = await launchDexerion({ aiBase: mock.url, attempts: 2 });
    const { win } = launched;
    await win.waitForTimeout(900);
    await win.evaluate(async () => {
      await window.dexerion.invoke('dex:ai-key-set', 'nvapi-design-judge');
      await window.dexerion.invoke('dex:ai-open');
    });
    await win.waitForSelector('#ai-sidebar:not([hidden])', { timeout: 20000 });
    await win.waitForTimeout(500);

    const probe = await win.evaluate(() => {
      const visible = (el) => {
        if (!el) return false;
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.05) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const nameOf = (el) => {
        const aria = el.getAttribute('aria-label');
        if (aria && aria.trim()) return aria.trim();
        const title = el.getAttribute('title');
        if (title && title.trim()) return title.trim();
        const text = (el.innerText || el.textContent || '').trim();
        return text;
      };
      const controls = [...document.querySelectorAll('button, [role="button"], input, select, textarea')]
        .filter(visible);
      const unnamed = controls.filter((el) => !nameOf(el)).map((el) => el.id || el.className || el.tagName);
      const remote = [...document.querySelectorAll('[src], link[href]')]
        .map((el) => el.getAttribute('src') || el.getAttribute('href'))
        .filter((u) => /^https?:/i.test(u || ''));
      const shell = document.documentElement;
      const body = document.body;
      const color = getComputedStyle(body).color;
      const background = getComputedStyle(document.querySelector('#toolbar') || body).backgroundColor;
      const buttons = [...document.querySelectorAll('#toolbar > button, #tabstrip button')].filter(visible);
      const minTarget = buttons.map((el) => Math.min(el.getBoundingClientRect().width, el.getBoundingClientRect().height));
      const focusEl = document.getElementById('newtab-btn');
      let focusOutline = '0px';
      if (focusEl) {
        focusEl.focus();
        focusOutline = getComputedStyle(focusEl).outlineWidth || '0px';
        focusEl.blur();
      }
      const capToggles = ['ai-agent-toggle', 'ai-vision-toggle'].map((id) => {
        const el = document.getElementById(id);
        if (!el || !visible(el)) return { id, visible: false, clickable: false };
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return {
          id,
          visible: true,
          clickable: Boolean(top && (top === el || el.contains(top))),
          pressed: el.getAttribute('aria-pressed'),
        };
      });
      return {
        overlayAbsent: shell.getAttribute('data-ui2') === null
          && ![...document.styleSheets].some((s) => /ui-v2\.css/.test(s.href || '')),
        noController: !window.DexUIv2,
        sidebarMenuPresent: Boolean(document.querySelector('#ai-more-menu .ai-overflow-item')),
        capToggles,
        capabilitySettings: Boolean(document.getElementById('ai-set-websites') && document.getElementById('ai-set-documents')),
        overflowX: Math.max(0, shell.scrollWidth - shell.clientWidth),
        bodyOverflowX: Math.max(0, body.scrollWidth - body.clientWidth),
        unnamed,
        remote,
        color,
        background,
        minTarget: minTarget.length ? Math.min(...minTarget) : 0,
        focusOutline,
        density: shell.getAttribute('data-density'),
        sidebarVisible: visible(document.getElementById('ai-sidebar')),
        composerVisible: visible(document.getElementById('ai-input')),
        toolbarVisible: visible(document.getElementById('toolbar')),
      };
    });

    // Menu regression: every item must be painted, not merely attached.
    await win.click('#menu-btn');
    await win.waitForSelector('#dmenu:not([hidden])', { timeout: 10000 });
    const menu = await win.$$eval('#dmenu .mitem', (els) => els.map((el) => ({
      text: (el.innerText || '').trim().split('\n')[0],
      opacity: Number(getComputedStyle(el).opacity),
      visible: el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0,
    })));
    const menuShot = path.join(SHOT_DIR, 'shell-menu.png');
    await win.screenshot({ path: menuShot });
    await win.click('#scrim', { position: { x: 4, y: 4 } });
    await sleep(250);
    const shellShot = path.join(SHOT_DIR, 'shell-sidebar.png');
    await win.screenshot({ path: shellShot });

    // AI sidebar overflow menu: every item must be the top-most hit target,
    // not just attached to the DOM behind the conversation thread.
    await win.click('#ai-more');
    await win.waitForSelector('#ai-more-menu:not([hidden])', { timeout: 10000 });
    const sidebarMenu = await win.$$eval('#ai-more-menu .ai-overflow-item', (els) => els.map((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return {
        text: (el.innerText || '').trim(),
        clickable: Boolean(top && (top === el || el.contains(top))),
      };
    }));
    await win.click('#ai-more-menu [data-sheet="memory"]');
    await sleep(250);
    const memoryOpened = await win.$eval('#ai-memory-sheet', (el) => !el.hidden && !el.inert);
    await win.keyboard.press('Escape');

    const contrastRatio = contrast(probe.color, probe.background);
    const failures = [];
    if (!probe.overlayAbsent) failures.push('rejected ui-v2 overlay is still loaded');
    if (!probe.noController) failures.push('DexUIv2 controller should be absent after revert');
    if (!probe.sidebarMenuPresent) failures.push('AI sidebar menu missing');
    if (sidebarMenu.length < 7 || sidebarMenu.some((m) => !m.clickable)) failures.push('AI sidebar menu items are not clickable');
    if (probe.capToggles.some((t) => !t.visible || !t.clickable || (t.pressed !== 'true' && t.pressed !== 'false'))) failures.push('agent/vision toggles are missing or not clickable');
    if (!probe.capabilitySettings) failures.push('website/document capability settings missing');
    if (!memoryOpened) failures.push('AI sidebar menu action did not open its sheet');
    if (probe.overflowX > 2 || probe.bodyOverflowX > 2) failures.push('horizontal overflow');
    if (probe.unnamed.length) failures.push('unnamed controls: ' + probe.unnamed.join(', '));
    if (probe.remote.length) failures.push('remote resources: ' + probe.remote.join(', '));
    if (contrastRatio < 4.5) failures.push('body contrast below 4.5:1 (' + contrastRatio.toFixed(2) + ')');
    if (probe.minTarget < 20) failures.push('target below 20px (' + probe.minTarget + ')');
    if (!/px/.test(probe.focusOutline) || Number.parseFloat(probe.focusOutline) < 1) failures.push('no visible focus ring');
    if (!probe.sidebarVisible || !probe.composerVisible || !probe.toolbarVisible) failures.push('core surface hidden');
    if (menu.length < 9 || menu.some((m) => m.opacity < 0.9 || !m.visible)) failures.push('menu items not fully visible');

    const score = Math.max(0, 100 - failures.length * 12);
    const result = {
      ok: failures.length === 0,
      score,
      failures,
      probe,
      menu,
      sidebarMenu,
      memoryOpened,
      contrastRatio: Number(contrastRatio.toFixed(2)),
      screenshots: [shellShot, menuShot],
      generatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');
    console.log('DESIGN JUDGE PROBE: ' + JSON.stringify({
      score, failures, contrast: result.contrastRatio,
      menu: menu.length, sidebarMenu: sidebarMenu.length, memoryOpened,
      capToggles: probe.capToggles, capabilitySettings: probe.capabilitySettings,
      shots: result.screenshots,
    }));
    if (result.ok) {
      console.log('DESIGN JUDGE PASS: reverted previous UI with working sidebar menu, ' + score + '/100');
      console.log('ALL 80 UI VERSIONS PASS');
    } else {
      console.error('DESIGN JUDGE FAIL: ' + failures.join('; '));
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('DESIGN JUDGE ERROR: ' + (err && err.stack || err));
    process.exitCode = 1;
  } finally {
    if (launched) { try { await launched.app.close(); } catch {} }
    await mock.close();
  }
})();
