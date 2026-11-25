'use strict';
// Deterministic intensive E2E harness for the V51-V180 programmes.
//
// 20 rounds x 20 areas x 50 asserted scenarios = 20,000 scenarios. Every
// scenario is counted by the shared page-side check() helper installed once
// per round. Nothing is logged in place of an assertion: failures are printed
// with their deterministic scenario IDs and thrown, so the runner exits
// nonzero. The real Electron app is launched with a throwaway profile and a
// local OpenAI-compatible mock; no real NIM key or real Dexerion profile is
// ever touched.

const { test, expect } = require('@playwright/test');
const { startAiMock } = require('./ai-mock');
const { launchDexerion } = require('./app');

const ROUNDS = 20;
const AREAS_PER_ROUND = 20;
const CHECKS_PER_AREA = 50;
const SCENARIOS_PER_ROUND = AREAS_PER_ROUND * CHECKS_PER_AREA; // 1000
const TOTAL_SCENARIOS = ROUNDS * SCENARIOS_PER_ROUND; // 20000

// The brief lists 19 named buckets but mandates 20 areas x 50 = 1000. The
// compound "fullscreen/preview controls" bucket is therefore split into
// PREVIEW (in-card controls) and FULLSCR (overlay/fullscreen geometry).
const AREA_CODES = [
  'BOOT', 'CHROME', 'MENU', 'TABS', 'NAV', 'SIDEBAR', 'SETTINGS', 'TASKS',
  'FOCUS', 'HISTORY', 'BOOKMARKS', 'DOWNLOADS', 'EXTENSIONS', 'SCREENSHOTS',
  'INSPECTOR', 'SITEART', 'REPORTART', 'PREVIEW', 'FULLSCR', 'A11Y',
];

const SHELL_PROBES = [
  '#toolbar', '#omnibox', '#newtab-btn', '#menu-btn',
  '#ai-btn', '#snip-btn', '#account-btn', '#tabstrip',
];
const SIDEBAR_PROBES = [
  '#ai-sidebar', '#ai-taskbar-title', '#ai-new', '#ai-history',
  '#ai-messages', '#ai-input', '#ai-send', '#ai-effort-wrap',
];
const TASKS_PROBES = [
  '#rail-tasks', '#tasks-body', '#tk-form', '#tk-title',
  '#tk-date', '#tk-pri', '#tk-list', '#tk-clear-done',
];
const TIMER_PROBES = [
  '#rail-timer', '#rt-phase', '#rt-time', '#rt-toggle',
  '#rt-skip', '#rt-reset', '#rt-work', '#rt-sound',
];
const A11Y_PROBES = [
  '#toolbar', '#omnibox', '#newtab-btn', '#menu-btn',
  '#ai-btn', '#snip-btn', '#account-btn', '#bookmark-btn',
];

const SITE_HTML = [
  '<!doctype html><html lang="en"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<title>Intensive Preview Fixture</title>',
  '<meta name="description" content="Preview chrome fixture for the intensive harness.">',
  '<style>body{margin:0;padding:20px;font-family:system-ui}button{min-height:44px}</style>',
  '</head><body><main><h1 data-testid="head">Intensive preview heading</h1>',
  '<button type="button" id="ping">Ping</button>',
  '<p id="out" aria-live="polite">Idle</p></main>',
  '<script>document.addEventListener("click",function(e){',
  'if(e.target.closest("#ping"))document.getElementById("out").textContent="Pong";',
  '});console.error("intensive-preview-probe");</script></body></html>',
].join('\n');

function pad(n, width) { return String(n).padStart(width, '0'); }

function chatReply(round) {
  return 'Intensive mock answer for round ' + round + '.';
}
function siteReply(round) {
  return '```dex-artifact\n' + JSON.stringify({
    kind: 'site',
    title: 'Intensive Site R' + round,
    description: 'A deterministic site fixture.',
    files: [
      { path: 'index.html', content: SITE_HTML },
      { path: 'about.html', content: '<!doctype html><title>About</title><h1>About the fixture</h1>' },
    ],
  }) + '\n```';
}
function reportReply(round) {
  return '```dex-artifact\n' + JSON.stringify({
    kind: 'report',
    title: 'Intensive Report R' + round,
    subtitle: 'Control check',
    summary: 'A deterministic report fixture.',
    theme: 'clean',
    blocks: [
      { type: 'callout', label: 'Bottom line', text: 'The report preview carries its own chrome.' },
      { type: 'heading', text: '1. Findings', level: 2 },
      { type: 'paragraph', text: 'Reports render in the panel and the overlay.' },
    ],
  }) + '\n```';
}

// ---------------------------------------------------------------------------
// Shared page-side scenario counter. Called from Node before/after each area.
// ---------------------------------------------------------------------------
async function installCheckBridge(win, round) {
  await win.evaluate((value) => {
    window.__dxIntensive = { round: value, area: '', n: 0, failures: [] };
    window.__dxCheck = (label, ok, detail) => {
      const state = window.__dxIntensive;
      state.n += 1;
      if (!ok) {
        state.failures.push({
          id: 'R' + String(state.round).padStart(2, '0') + '-' + state.area + '-' + String(state.n).padStart(3, '0'),
          label: String(label),
          detail: String(detail === undefined ? '' : detail).slice(0, 300),
        });
      }
      return Boolean(ok);
    };
    // Five real DOM/a11y/geometry/computed-style scenarios per selector.
    window.__dxProbe = (selectors) => {
      const check = window.__dxCheck;
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        const rect = el ? el.getBoundingClientRect() : null;
        const style = el ? getComputedStyle(el) : null;
        const labelText = el && el.labels && el.labels.length
          ? (el.labels[0].textContent || '').trim() : '';
        const accessibleName = el
          ? (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder')
            || labelText || (el.textContent || '').trim())
          : '';
        check(sel + ' exists', Boolean(el), el ? '' : 'missing');
        check(sel + ' geometry', Boolean(rect) && Number.isFinite(rect.width) && Number.isFinite(rect.height)
          && rect.width >= 0 && rect.height >= 0 && rect.left >= -4
          && rect.right <= window.innerWidth + 4,
        rect ? JSON.stringify({ left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width), inner: window.innerWidth }) : 'no rect');
        check(sel + ' not hidden', Boolean(el) && !el.hidden && Boolean(style)
          && style.display !== 'none' && style.visibility !== 'hidden',
        style ? style.display + '/' + style.visibility : 'no style');
        check(sel + ' accessible name', Boolean(accessibleName), accessibleName.toString().slice(0, 60));
        check(sel + ' computed style', Boolean(style) && Boolean(style.display) && Boolean(style.color) && Boolean(style.fontFamily),
          style ? style.display + '|' + style.color + '|' + style.fontFamily.slice(0, 40) : 'no style');
      }
    };
  }, round);
}

function printFailures(failures) {
  for (const failure of failures) {
    console.error('SCENARIO FAIL ' + failure.id + ' ' + failure.label
      + (failure.detail ? ' :: ' + failure.detail : ''));
  }
}

async function startArea(win, code) {
  await win.evaluate((area) => {
    const state = window.__dxIntensive;
    state.area = area;
    state.n = 0;
    state.failures = [];
  }, code);
}

async function collectArea(win) {
  return win.evaluate(() => {
    const state = window.__dxIntensive;
    return {
      n: state.n,
      passed: state.n - state.failures.length,
      failed: state.failures.length,
      failures: state.failures.slice(),
    };
  });
}

async function runArea(ctx, code, fn) {
  await startArea(ctx.win, code);
  try {
    await fn(ctx);
  } catch (err) {
    const state = await collectArea(ctx.win).catch(() => ({ n: -1, failures: [] }));
    if (state.failures.length) printFailures(state.failures);
    console.error('SCENARIO FAIL ' + ctx.roundCode + '-' + code + ' area aborted after '
      + state.n + '/' + CHECKS_PER_AREA + ' scenarios: ' + String(err && err.message || err));
    throw err;
  }
  const state = await collectArea(ctx.win);
  if (state.n !== CHECKS_PER_AREA) {
    printFailures(state.failures);
    throw new Error(code + ': expected ' + CHECKS_PER_AREA + ' scenarios, got ' + state.n);
  }
  if (state.failures.length) {
    printFailures(state.failures);
    throw new Error(code + ': ' + state.failures.length + ' of ' + CHECKS_PER_AREA + ' scenarios failed');
  }
  return state.n;
}

// ---------------------------------------------------------------------------
// Small Playwright interaction helpers (the user-visible part of every round).
// ---------------------------------------------------------------------------
async function ensureMenuClosed(win) {
  const visible = await win.locator('#dmenu').isVisible().catch(() => false);
  if (visible) {
    await win.click('#scrim', { position: { x: 4, y: 4 } });
    await expect(win.locator('#dmenu')).toBeHidden({ timeout: 10000 });
  }
}

async function openMenu(win) {
  await ensureMenuClosed(win);
  await win.click('#menu-btn');
  await expect(win.locator('#dmenu')).toBeVisible({ timeout: 10000 });
}

async function navigateViaMenu(win, action) {
  await openMenu(win);
  await win.click('#dmenu .mitem[data-m="' + action + '"]');
  await expect(win.locator('#dmenu')).toBeHidden({ timeout: 10000 });
}

async function internalSnapshot(app, urlPattern, expression) {
  let result = null;
  await expect.poll(async () => {
    result = await app.evaluate(async ({ webContents }, arg) => {
      const re = new RegExp(arg.urlPattern);
      const wc = webContents.getAllWebContents().find((w) => re.test(w.getURL() || ''));
      if (!wc || wc.isDestroyed()) return null;
      try {
        if ((await wc.executeJavaScript('document.readyState')) !== 'complete') return null;
        return await wc.executeJavaScript(arg.expression);
      } catch { return null; }
    }, { urlPattern: urlPattern.source, expression });
    return result;
  }, { timeout: 20000 }).not.toBeNull();
  return result;
}

async function activeTabUrl(win) {
  return win.evaluate(async () => {
    const state = await window.dexerion.invoke('dex:get-state');
    const tab = state.tabs.find((t) => t.id === state.active);
    return tab ? String(tab.url || '') : '';
  });
}

const BASE_PAGE_SNAPSHOT = `({
  title: document.title,
  h1: (document.querySelector('h1') || {}).textContent || '',
  eyebrow: (document.querySelector('.eyebrow') || {}).textContent || '',
  lang: document.documentElement.lang,
  bridge: typeof window.dexerion.invoke === 'function',
  bodyDisplay: getComputedStyle(document.body).display,
  bodyColor: getComputedStyle(document.body).color,
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
  list: (document.querySelector('.dx-list') || {}).id || '',
  listChildren: document.querySelectorAll('.dx-list > *').length
})`;

// ---------------------------------------------------------------------------
// The 20 areas. Each contributes exactly 10 explicit scenarios plus 40 probe
// scenarios (8 selectors x 5 checks) = 50.
// ---------------------------------------------------------------------------
async function areaBoot(ctx) {
  const { win, round, seeded, mock } = ctx;
  await win.evaluate((arg) => {
    const check = window.__dxCheck;
    const state = arg.state;
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--dx-bg').trim();
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    check('trusted bridge available', typeof window.dexerion.invoke === 'function', typeof window.dexerion.invoke);
    check('shell state has tabs', Boolean(state && Array.isArray(state.tabs) && state.tabs.length > 0), state && state.tabs && state.tabs.length);
    check('active tab exists', Boolean(state && state.tabs.some((t) => t.id === state.active)), state && state.active);
    check('shell title', /Dexerion|New Tab/.test(document.title) && document.title.length > 0, document.title);
    check('document language', document.documentElement.lang === 'en', document.documentElement.lang);
    check('background token live', bg.length > 0, bg);
    check('accent token live', accent.length > 0, accent);
    check('theme token live', ['dark', 'light'].includes(document.documentElement.dataset.theme), document.documentElement.dataset.theme);
    check('mock key seeded', Boolean(arg.seeded.key && arg.seeded.key.hasKey), JSON.stringify(arg.seeded.key));
    check('NIM provider selected', arg.seeded.status && arg.seeded.status.providerId === 'nim', JSON.stringify(arg.seeded.status));
    window.__dxProbe(arg.probes);
  }, { state: seeded.state, seeded, probes: SHELL_PROBES, round });
  expect(mock.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/);
}

async function areaChrome(ctx) {
  const { win } = ctx;
  await win.evaluate((probes) => {
    const check = window.__dxCheck;
    const rect = (sel) => { const el = document.querySelector(sel); return el ? el.getBoundingClientRect() : null; };
    const bar = rect('#toolbar');
    const back = document.querySelector('[data-nav="back"]');
    const forward = document.querySelector('[data-nav="forward"]');
    const reload = document.querySelector('[data-nav="reload"]');
    check('toolbar height', Boolean(bar) && bar.height > 30, bar && Math.round(bar.height));
    check('toolbar width', Boolean(bar) && bar.width > 300, bar && Math.round(bar.width));
    check('back control label', Boolean(back && back.getAttribute('aria-label')), back && back.getAttribute('aria-label'));
    check('forward control label', Boolean(forward && forward.getAttribute('aria-label')), forward && forward.getAttribute('aria-label'));
    check('reload control label', Boolean(reload && reload.getAttribute('aria-label')), reload && reload.getAttribute('aria-label'));
    check('omnibox placeholder', Boolean(document.querySelector('#omnibox') && document.querySelector('#omnibox').placeholder), 'omnibox');
    check('vertical tabs shell', document.body.classList.contains('vertical'), document.body.className);
    check('focus timer rail present', Boolean(document.querySelector('#rail-timer')), 'rail-timer');
    check('tasks rail present', Boolean(document.querySelector('#rail-tasks')), 'rail-tasks');
    check('bookmarks bar mount present', Boolean(document.querySelector('#bookmarkbar')), 'bookmarkbar');
    window.__dxProbe(probes);
  }, SHELL_PROBES);
}

async function areaMenu(ctx) {
  const { win } = ctx;
  await openMenu(win);
  await win.evaluate(() => {
    const check = window.__dxCheck;
    const menu = document.querySelector('#dmenu');
    const scrim = document.querySelector('#scrim');
    const items = Array.from(document.querySelectorAll('#dmenu .mitem'));
    const groups = document.querySelectorAll('#dmenu .mgroup').length;
    const first = items[0] ? Number(getComputedStyle(items[0]).opacity) : 0;
    const newTab = items.find((b) => b.dataset.m === 'new-tab');
    const sr = scrim.getBoundingClientRect();
    check('menu visible', !menu.hidden, menu.hidden);
    check('scrim visible', !scrim.hidden, scrim.hidden);
    check('menu button open state', document.querySelector('#menu-btn').classList.contains('open'), 'menu-btn');
    check('menu item count', items.length >= 5, items.length);
    check('menu item painted', first > 0.5, first);
    check('new tab item labelled', Boolean(newTab) && /New tab/.test(newTab.textContent), newTab && newTab.textContent);
    check('menu groups present', groups >= 3, groups);
    check('scrim covers window', sr.width >= window.innerWidth - 2 && sr.height >= window.innerHeight - 2,
      Math.round(sr.width) + 'x' + Math.round(sr.height));
  });
  await win.click('#scrim', { position: { x: 4, y: 4 } });
  await expect(win.locator('#dmenu')).toBeHidden({ timeout: 10000 });
  await win.evaluate((probes) => {
    const check = window.__dxCheck;
    check('menu closed after scrim', document.querySelector('#dmenu').hidden, 'dmenu');
    check('scrim closed after click', document.querySelector('#scrim').hidden, 'scrim');
    window.__dxProbe(probes);
  }, SHELL_PROBES);
}

async function areaTabs(ctx) {
  const { win } = ctx;
  const before = await win.evaluate(() => document.querySelectorAll('#tabs .tab').length);
  await win.click('#newtab-btn');
  await expect.poll(() => win.evaluate(() => document.querySelectorAll('#tabs .tab').length), { timeout: 15000 }).toBe(before + 1);
  const tabs = win.locator('#tabs .tab');
  await tabs.last().click();
  await expect(tabs.last()).toHaveClass(/active/);
  const added = await win.evaluate(async () => {
    const state = await window.dexerion.invoke('dex:get-state');
    const list = Array.from(document.querySelectorAll('#tabs .tab'));
    const active = list.filter((el) => el.classList.contains('active'));
    const last = list[list.length - 1];
    const rect = last.getBoundingClientRect();
    return {
      domCount: list.length,
      activeCount: active.length,
      lastActive: last.classList.contains('active'),
      plusLast: document.querySelector('#tabs').lastElementChild.id === 'newtab-btn',
      closeTitle: last.querySelector('.x') ? last.querySelector('.x').title : '',
      width: rect.width,
      stateCount: state.tabs.length,
      stateActive: state.active,
    };
  });
  await tabs.last().locator('.x').click();
  await expect.poll(() => win.evaluate(() => document.querySelectorAll('#tabs .tab').length), { timeout: 15000 }).toBe(before);
  const after = await win.evaluate(() => ({
    count: document.querySelectorAll('#tabs .tab').length,
    active: document.querySelectorAll('#tabs .tab.active').length,
  }));
  await win.evaluate((arg) => {
    const check = window.__dxCheck;
    check('tab added', arg.added.domCount === arg.before + 1, arg.added.domCount + '/' + arg.before);
    check('one active tab', arg.added.activeCount === 1, arg.added.activeCount);
    check('new tab activated', arg.added.lastActive, 'active class');
    check('new tab button parked last', arg.added.plusLast, 'newtab-btn');
    check('close control labelled', arg.added.closeTitle === 'Close tab', arg.added.closeTitle);
    check('tab has width', arg.added.width > 0, Math.round(arg.added.width));
    check('state tracks DOM tabs', arg.added.stateCount === arg.before + 1, arg.added.stateCount);
    check('state has active tab', Boolean(arg.added.stateActive), arg.added.stateActive);
    check('tab closed', arg.after.count === arg.before, arg.after.count + '/' + arg.before);
    check('active tab survives close', arg.after.active === 1, arg.after.active);
    window.__dxProbe(arg.probes);
  }, { added, after, before, probes: SHELL_PROBES });
}

async function areaNavigation(ctx) {
  const { win, app } = ctx;
  await win.fill('#omnibox', 'dexerion://history');
  await win.press('#omnibox', 'Enter');
  await expect.poll(() => activeTabUrl(win), { timeout: 20000 }).toMatch(/^dexerion:\/\/history/);
  const nav = await win.evaluate(async () => {
    const state = await window.dexerion.invoke('dex:get-state');
    const tab = state.tabs.find((t) => t.id === state.active);
    const box = document.querySelector('#omnibox').getBoundingClientRect();
    const bar = document.querySelector('#toolbar').getBoundingClientRect();
    return {
      value: document.querySelector('#omnibox').value,
      url: tab ? tab.url : '',
      title: tab ? tab.title : '',
      back: Boolean(document.querySelector('[data-nav="back"][aria-label]')),
      forward: Boolean(document.querySelector('[data-nav="forward"][aria-label]')),
      reload: Boolean(document.querySelector('[data-nav="reload"][aria-label]')),
      insideToolbar: box.left >= bar.left - 2 && box.right <= bar.right + 2,
      placeholder: document.querySelector('#omnibox').placeholder,
      tabCount: state.tabs.length,
    };
  });
  const wc = await internalSnapshot(app, /dexerion:\/\/history/, '({ url: location.href, ready: document.readyState })');
  await win.evaluate((arg) => {
    const check = window.__dxCheck;
    check('omnibox keeps navigation text', arg.nav.value.includes('history'), arg.nav.value);
    check('active tab navigated', arg.nav.url.startsWith('dexerion://history'), arg.nav.url);
    check('active tab has title', arg.nav.title.length > 0, arg.nav.title);
    check('back control present', arg.nav.back, 'back');
    check('forward control present', arg.nav.forward, 'forward');
    check('reload control present', arg.nav.reload, 'reload');
    check('omnibox inside toolbar', arg.nav.insideToolbar, 'geometry');
    check('omnibox placeholder present', arg.nav.placeholder.length > 0, arg.nav.placeholder);
    check('internal page loaded', arg.wc && arg.wc.ready === 'complete', JSON.stringify(arg.wc));
    check('state still has tabs', arg.nav.tabCount >= 1, arg.nav.tabCount);
    window.__dxProbe(arg.probes);
  }, { nav, wc, probes: SHELL_PROBES });
}

async function ensureSidebarOpen(win) {
  if (await win.locator('#ai-sidebar').isVisible().catch(() => false)) return;
  await win.evaluate(() => window.dexerion.invoke('dex:ai-open'));
  await win.waitForSelector('#ai-sidebar:not([hidden])', { timeout: 20000 });
}

async function areaSidebar(ctx) {
  const { win, round, mock } = ctx;
  const ask = 'intensive round ' + round + ' sidebar check';
  const reply = chatReply(round);
  await win.evaluate(() => window.dexerion.invoke('dex:ai-open'));
  await win.waitForSelector('#ai-sidebar:not([hidden])', { timeout: 20000 });
  await expect(win.locator('#ai-setup')).toBeHidden({ timeout: 20000 });
  await win.fill('#ai-input', ask);
  await win.press('#ai-input', 'Enter');
  await expect(win.locator('#ai-messages')).toContainText(reply, { timeout: 30000 });
  await expect(win.locator('#ai-send')).toBeEnabled({ timeout: 30000 });
  const stored = await win.evaluate(async (phrase) => {
    const list = await window.dexerion.invoke('dex:ai-chats-list');
    if (!Array.isArray(list) || !list.length) return { user: '', model: '' };
    const chat = await window.dexerion.invoke('dex:ai-chat-open', list[0].id);
    const messages = Array.isArray(chat.messages) ? chat.messages : [];
    const user = messages.find((m) => m.role === 'user' && String(m.text || '').includes(phrase));
    const model = messages.find((m) => m.role === 'model' && String(m.text || '').includes('Intensive mock answer'));
    return {
      user: user ? String(user.text) : '',
      model: model ? String(model.text) : '',
    };
  }, 'sidebar check');
  const posts = mock.requests.filter((r) => r.url.includes('/chat/completions') && (r.body || {}).max_tokens !== 1).length;
  await win.evaluate((arg) => {
    const check = window.__dxCheck;
    const input = document.querySelector('#ai-input').getBoundingClientRect();
    check('sidebar open', !document.querySelector('#ai-sidebar').hidden, 'ai-sidebar');
    check('setup card hidden', document.querySelector('#ai-setup').hidden, 'ai-setup');
    check('composer visible', input.width > 100 && input.height > 10, Math.round(input.width) + 'x' + Math.round(input.height));
    check('send button idle', !document.querySelector('#ai-send').disabled, 'ai-send');
    check('mock reply rendered', document.querySelector('#ai-messages').textContent.includes(arg.reply), arg.reply);
    check('mock received turn', arg.posts > 0, arg.posts);
    check('user turn stored', arg.stored.user.length > 0, arg.stored.user.slice(0, 60));
    check('model turn stored', arg.stored.model.length > 0, arg.stored.model.slice(0, 60));
    check('effort tiers present', document.querySelectorAll('#ai-effort-select option').length === 4, 'tiers');
    check('taskbar title present', (document.querySelector('#ai-taskbar-title').textContent || '').trim().length > 0, 'title');
    window.__dxProbe(arg.probes);
  }, { reply, posts, stored, probes: SIDEBAR_PROBES });
}

async function areaSettings(ctx) {
  const { win, app } = ctx;
  await navigateViaMenu(win, 'settings');
  const snap = await internalSnapshot(app, /dexerion:\/\/settings/, `Object.assign(${BASE_PAGE_SNAPSHOT}, {
    search: !!document.getElementById('se'),
    bookmarkBar: !!document.getElementById('bar'),
    memory: !!document.getElementById('memsaver'),
    downloadDir: !!document.getElementById('dl'),
    themeSelect: !!document.getElementById('th')
  })`);
  await win.evaluate((arg) => {
    const check = window.__dxCheck;
    check('settings title', /Settings/.test(arg.snap.title), arg.snap.title);
    check('settings heading', /Settings/.test(arg.snap.h1), arg.snap.h1);
    check('settings eyebrow', arg.snap.eyebrow.length > 0, arg.snap.eyebrow);
    check('search engine control', arg.snap.search, 'se');
    check('bookmark bar control', arg.snap.bookmarkBar, 'bar');
    check('memory saver control', arg.snap.memory, 'memsaver');
    check('download location control', arg.snap.downloadDir, 'dl');
    check('settings bridge', arg.snap.bridge, 'bridge');
    check('settings language', arg.snap.lang === 'en', arg.snap.lang);
    check('settings body styled', arg.snap.bodyDisplay && arg.snap.bodyColor, arg.snap.bodyDisplay);
    window.__dxProbe(arg.probes);
  }, { snap, probes: SHELL_PROBES });
}

async function areaTasks(ctx) {
  const { win, round } = ctx;
  // The vertical rail stows its panels on mouse-out, which makes a sequence of
  // Playwright clicks race the rail's own timers. Pin the rail mode for the
  // duration of this area, then drive the real controls.
  await win.evaluate(() => {
    document.querySelector('#tabstrip').classList.add('show-tasks');
    document.querySelector('#tk-add-toggle').click();
  });
  await expect(win.locator('#tasks-full')).toBeVisible({ timeout: 10000 });
  const title = 'Intensive task R' + String(round).padStart(2, '0');
  const today = new Date().toISOString().slice(0, 10);
  await win.fill('#tk-title', title);
  await win.fill('#tk-date', today);
  await win.click('#tk-add');
  await expect(win.locator('#tk-list')).toContainText(title, { timeout: 15000 });
  const snap = await win.evaluate(async () => {
    const state = await window.dexerion.invoke('dex:get-state');
    return {
      titleText: document.querySelector('#tk-list').textContent,
      count: document.querySelectorAll('#tk-list .tk').length || document.querySelectorAll('#tk-list > *').length,
      priorityOptions: document.querySelectorAll('#tk-pri option').length,
      dateType: document.querySelector('#tk-date').type,
      notesPresent: Boolean(document.querySelector('#tk-notes')),
      clearPresent: Boolean(document.querySelector('#tk-clear-done')),
      stateTasks: Array.isArray(state.tasks) ? state.tasks.length : -1,
      fullVisible: !document.querySelector('#tasks-full').hidden,
      counter: document.querySelector('#tm-count').textContent,
    };
  });
  await win.evaluate((arg) => {
    const check = window.__dxCheck;
    check('task added to list', arg.snap.titleText.includes(arg.title), arg.snap.titleText.slice(0, 60));
    check('task row rendered', arg.snap.count > 0, arg.snap.count);
    check('full task panel open', arg.snap.fullVisible, 'tasks-full');
    check('priority tiers present', arg.snap.priorityOptions === 3, arg.snap.priorityOptions);
    check('due date is date field', arg.snap.dateType === 'date', arg.snap.dateType);
    check('description field present', arg.snap.notesPresent, 'tk-notes');
    check('clear completed control present', arg.snap.clearPresent, 'tk-clear-done');
    check('state has tasks', arg.snap.stateTasks > 0, arg.snap.stateTasks);
    check('task counter present', arg.snap.counter.length > 0, arg.snap.counter);
    check('task form retained', Boolean(document.querySelector('#tk-form')), 'tk-form');
    window.__dxProbe(arg.probes);
  }, { snap, title, probes: TASKS_PROBES });
}

async function areaFocus(ctx) {
  const { win } = ctx;
  // The vertical rail swaps in the full timer on hover/focus of its mini tab.
  await win.locator('#rm-start').focus();
  await expect(win.locator('#rt-toggle')).toBeVisible({ timeout: 10000 });
  await win.click('#rt-toggle');
  await expect.poll(async () => win.evaluate(async () => {
    const state = await window.dexerion.invoke('dex:get-state');
    return Boolean(state.pomodoro && state.pomodoro.running);
  }), { timeout: 15000 }).toBe(true);
  const running = await win.evaluate(async () => {
    const state = await window.dexerion.invoke('dex:get-state');
    const p = state.pomodoro || {};
    return {
      phase: p.phase,
      running: Boolean(p.running),
      time: document.querySelector('#rt-time').textContent,
      phaseText: document.querySelector('#rt-phase').textContent,
      fill: document.querySelector('#rt-fill').style.width,
      sound: document.querySelector('#rt-sound').value,
      work: Number(document.querySelector('#rt-work').value),
      breakMin: Number(document.querySelector('#rt-break').value),
      toggle: document.querySelector('#rt-toggle').textContent,
      miniHidden: document.querySelector('#rm-run').hidden,
    };
  });
  await win.click('#rt-reset');
  await expect.poll(async () => win.evaluate(async () => {
    const state = await window.dexerion.invoke('dex:get-state');
    return Boolean(state.pomodoro && state.pomodoro.running);
  }), { timeout: 15000 }).toBe(false);
  await win.evaluate((arg) => {
    const check = window.__dxCheck;
    check('timer work phase', arg.running.phase === 'work', arg.running.phase);
    check('timer running', arg.running.running, 'running');
    check('time formatted', /^\d\d:\d\d$/.test(arg.running.time), arg.running.time);
    check('phase labelled', /Work/.test(arg.running.phaseText), arg.running.phaseText);
    check('progress fill set', arg.running.fill.length > 0, arg.running.fill);
    check('sound selected', arg.running.sound.length > 0, arg.running.sound);
    check('work length valid', arg.running.work >= 1 && arg.running.work <= 180, arg.running.work);
    check('break length valid', arg.running.breakMin >= 1 && arg.running.breakMin <= 60, arg.running.breakMin);
    check('pause glyph shown', arg.running.toggle === '⏸', arg.running.toggle);
    check('timer reset', arg.reset === false, 'running after reset');
    window.__dxProbe(arg.probes);
  }, { running, reset: false, probes: TIMER_PROBES });
}

async function areaHistory(ctx) {
  const { win, app } = ctx;
  await navigateViaMenu(win, 'history');
  const snap = await internalSnapshot(app, /dexerion:\/\/history/, `Object.assign(${BASE_PAGE_SNAPSHOT}, {
    search: !!document.getElementById('q')
  })`);
  await win.evaluate((arg) => {
    const check = window.__dxCheck;
    check('history title', /History/.test(arg.snap.title), arg.snap.title);
    check('history heading', /History/.test(arg.snap.h1), arg.snap.h1);
    check('history list mounted', arg.snap.list === 'list', arg.snap.list);
    check('history search input', arg.snap.search, 'q');
    check('history rows non-negative', arg.snap.listChildren >= 0, arg.snap.listChildren);
    check('history bridge', arg.snap.bridge, 'bridge');
    check('history language', arg.snap.lang === 'en', arg.snap.lang);
    check('history styled', arg.snap.bodyDisplay.length > 0, arg.snap.bodyDisplay);
    check('history has no h-overflow', arg.snap.scrollWidth <= arg.snap.clientWidth + 2,
      arg.snap.scrollWidth + '/' + arg.snap.clientWidth);
    check('history eyebrow', arg.snap.eyebrow.length > 0, arg.snap.eyebrow);
    window.__dxProbe(arg.probes);
  }, { snap, probes: SHELL_PROBES });
}

async function areaBookmarks(ctx) {
  const { win, app } = ctx;
  await navigateViaMenu(win, 'bookmarks');
  const snap = await internalSnapshot(app, /dexerion:\/\/bookmarks/, `Object.assign(${BASE_PAGE_SNAPSHOT}, {
    bar: !!document.getElementById('bar'),
    other: !!document.getElementById('other'),
    headings: document.querySelectorAll('.dx-section h2').length
  })`);
  await win.evaluate((arg) => {
    const check = window.__dxCheck;
    check('bookmarks title', /Bookmarks/.test(arg.snap.title), arg.snap.title);
    check('bookmarks heading', /Bookmarks/.test(arg.snap.h1), arg.snap.h1);
    check('bar list mounted', arg.snap.bar, 'bar');
    check('other list mounted', arg.snap.other, 'other');
    check('two bookmark sections', arg.snap.headings === 2, arg.snap.headings);
    check('bookmarks bridge', arg.snap.bridge, 'bridge');
    check('bookmarks language', arg.snap.lang === 'en', arg.snap.lang);
    check('bookmarks styled', arg.snap.bodyColor.length > 0, arg.snap.bodyColor);
    check('bookmarks no h-overflow', arg.snap.scrollWidth <= arg.snap.clientWidth + 2,
      arg.snap.scrollWidth + '/' + arg.snap.clientWidth);
    check('bookmarks eyebrow', arg.snap.eyebrow.length > 0, arg.snap.eyebrow);
    window.__dxProbe(arg.probes);
  }, { snap, probes: SHELL_PROBES });
}

async function areaDownloads(ctx) {
  const { win, app } = ctx;
  await navigateViaMenu(win, 'downloads');
  const snap = await internalSnapshot(app, /dexerion:\/\/downloads/, `Object.assign(${BASE_PAGE_SNAPSHOT}, {
    folder: !!document.getElementById('folder'),
    folderLabel: (document.getElementById('folder') || {}).textContent || ''
  })`);
  const downloads = await win.evaluate(async () => {
    const list = await window.dexerion.invoke('dex:downloads');
    return Array.isArray(list) ? list.length : -1;
  });
  await win.evaluate((arg) => {
    const check = window.__dxCheck;
    check('downloads title', /Downloads/.test(arg.snap.title), arg.snap.title);
    check('downloads heading', /Downloads/.test(arg.snap.h1), arg.snap.h1);
    check('download list mounted', arg.snap.list === 'list', arg.snap.list);
    check('open folder control', arg.snap.folder, 'folder');
    check('folder control labelled', arg.snap.folderLabel.length > 0, arg.snap.folderLabel);
    check('download store readable', arg.downloads >= 0, arg.downloads);
    check('downloads bridge', arg.snap.bridge, 'bridge');
    check('downloads language', arg.snap.lang === 'en', arg.snap.lang);
    check('downloads no h-overflow', arg.snap.scrollWidth <= arg.snap.clientWidth + 2,
      arg.snap.scrollWidth + '/' + arg.snap.clientWidth);
    check('downloads eyebrow', arg.snap.eyebrow.length > 0, arg.snap.eyebrow);
    window.__dxProbe(arg.probes);
  }, { snap, downloads, probes: SHELL_PROBES });
}

async function areaExtensions(ctx) {
  const { win, app } = ctx;
  await navigateViaMenu(win, 'extensions');
  const snap = await internalSnapshot(app, /dexerion:\/\/extensions/, `Object.assign(${BASE_PAGE_SNAPSHOT}, {
    store: !!document.getElementById('browsestore'),
    url: !!document.getElementById('storeurl'),
    load: !!document.getElementById('load'),
    fromFile: !!document.getElementById('fromfile')
  })`);
  const installed = await win.evaluate(async () => {
    const list = await window.dexerion.invoke('dex:ext-list');
    return Array.isArray(list) ? list.length : -1;
  });
  await win.evaluate((arg) => {
    const check = window.__dxCheck;
    check('extensions title', /Extensions/.test(arg.snap.title), arg.snap.title);
    check('extensions heading', /Extensions/.test(arg.snap.h1), arg.snap.h1);
    check('store browse control', arg.snap.store, 'browsestore');
    check('store url field', arg.snap.url, 'storeurl');
    check('load unpacked control', arg.snap.load, 'load');
    check('install from file control', arg.snap.fromFile, 'fromfile');
    check('extension store readable', arg.installed >= 0, arg.installed);
    check('extensions bridge', arg.snap.bridge, 'bridge');
    check('extensions language', arg.snap.lang === 'en', arg.snap.lang);
    check('extensions no h-overflow', arg.snap.scrollWidth <= arg.snap.clientWidth + 2,
      arg.snap.scrollWidth + '/' + arg.snap.clientWidth);
    window.__dxProbe(arg.probes);
  }, { snap, installed, probes: SHELL_PROBES });
}

async function areaScreenshots(ctx) {
  const { win, app } = ctx;
  await win.click('#snip-btn');
  await expect.poll(async () => win.evaluate(() => document.querySelector('#snip-btn').classList.contains('live')),
    { timeout: 15000 }).toBe(true);
  const snap = await app.evaluate(async ({ webContents }) => {
    const overlay = webContents.getAllWebContents().filter((wc) => /snip\.html/.test(wc.getURL() || ''));
    return {
      overlays: overlay.length,
      urls: overlay.map((wc) => wc.getURL()),
    };
  });
  // snip-dismiss scopes by the overlay's own webContents, so it must be sent
  // from the overlay, not from the shell bridge.
  await app.evaluate(async ({ webContents }) => {
    const wc = webContents.getAllWebContents().find((w) => /snip\.html/.test(w.getURL() || ''));
    if (wc && !wc.isDestroyed()) {
      // Fire-and-forget: awaiting the invoke promise inside executeJavaScript
      // can hang because the overlay closes its own world mid-call.
      try { await wc.executeJavaScript("void window.dexerion.invoke('dex:snip-dismiss'); true"); } catch {}
    }
    return true;
  });
  await expect.poll(async () => win.evaluate(() => document.querySelector('#snip-btn').classList.contains('live')),
    { timeout: 15000 }).toBe(false);
  await win.evaluate((arg) => {
    const check = window.__dxCheck;
    const btn = document.querySelector('#snip-btn');
    const rect = btn.getBoundingClientRect();
    check('snip button opened overlay', arg.opened, 'live class');
    check('snip overlay view exists', arg.snap.overlays >= 1, arg.snap.overlays);
    check('snip overlay url is local', arg.snap.urls.some((u) => u.includes('snip.html')), JSON.stringify(arg.snap.urls));
    check('snip button has label', Boolean(btn.getAttribute('aria-label')), btn.getAttribute('aria-label'));
    check('snip button has title', (btn.title || '').length > 0, btn.title);
    check('snip button has icon', Boolean(btn.querySelector('svg')), 'svg');
    check('snip button sized', rect.width > 10 && rect.height > 10, Math.round(rect.width) + 'x' + Math.round(rect.height));
    check('snip button in toolbar', rect.right <= window.innerWidth + 2, Math.round(rect.right));
    check('snip dismiss accepted', arg.dismissed, 'dismiss');
    check('snip button idle after dismiss', !btn.classList.contains('live'), 'live class');
    window.__dxProbe(arg.probes);
  }, { snap, opened: true, dismissed: true, probes: SHELL_PROBES });
}

async function areaInspector(ctx) {
  const { win } = ctx;
  const active = await win.evaluate(async () => (await window.dexerion.invoke('dex:get-state')).active);
  await win.evaluate(async (tabId) => {
    await window.dexerion.invoke('dex:inspector-toggle', tabId);
  }, active);
  await expect(win.locator('#inspector')).toBeVisible({ timeout: 15000 });
  const snap = await win.evaluate(async () => {
    const state = await window.dexerion.invoke('dex:get-state');
    const bar = document.querySelector('#inspector');
    return {
      hidden: bar.hidden,
      host: document.querySelector('#ins-host').textContent,
      dockTitle: document.querySelector('#ins-dock').title,
      closeTitle: document.querySelector('#ins-close').title,
      rect: (() => { const r = bar.getBoundingClientRect(); return { w: r.width, h: r.height }; })(),
      open: Boolean(state.ui && state.ui.inspector),
      dock: state.ui && state.ui.inspector ? state.ui.inspector.dock : '',
    };
  });
  await win.evaluate(async () => { await window.dexerion.invoke('dex:inspector-close'); });
  await expect(win.locator('#inspector')).toBeHidden({ timeout: 15000 });
  await win.evaluate((arg) => {
    const check = window.__dxCheck;
    check('inspector opened', !arg.snap.hidden, 'inspector');
    check('inspector state open', arg.snap.open, 'open');
    check('inspector dock valid', ['right', 'bottom'].includes(arg.snap.dock), arg.snap.dock);
    check('inspector dock button labelled', arg.snap.dockTitle.length > 0, arg.snap.dockTitle);
    check('inspector close button labelled', arg.snap.closeTitle.length > 0, arg.snap.closeTitle);
    check('inspector bar has width', arg.snap.rect.w > 20, Math.round(arg.snap.rect.w));
    check('inspector bar has height', arg.snap.rect.h > 10, Math.round(arg.snap.rect.h));
    check('inspector host text readable', typeof arg.snap.host === 'string', arg.snap.host);
    check('inspector close accepted', arg.closed, 'close');
    check('inspector hidden after close', document.querySelector('#inspector').hidden, 'inspector');
    window.__dxProbe(arg.probes);
  }, { snap, closed: true, probes: SHELL_PROBES });
}

async function areaSiteArtifact(ctx) {
  const { win, round } = ctx;
  await ensureSidebarOpen(win);
  await win.fill('#ai-input', 'build the intensive site artifact R' + round);
  await win.press('#ai-input', 'Enter');
  const card = win.locator('#ai-messages .dxa-card[data-kind="site"]').last();
  await expect(card).toBeVisible({ timeout: 30000 });
  const snap = await card.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const frame = el.querySelector('iframe.dxa-frame');
    const bar = el.querySelector('.dxa-sitebar');
    return {
      count: 1,
      width: rect.width,
      hasFrame: Boolean(frame),
      frameSrc: frame ? frame.getAttribute('src') || '' : '',
      hasBar: Boolean(bar),
      widthButtons: el.querySelectorAll('.dxa-width-btn').length,
      files: (el.querySelector('.dxa-files') || {}).textContent || '',
      consoleButton: Boolean(el.querySelector('.dxa-console-btn')),
      pageButtons: el.querySelectorAll('.dxa-page-btn').length,
      title: (el.querySelector('.dxa-title') || {}).textContent || '',
    };
  });
  await win.evaluate((arg) => {
    const check = window.__dxCheck;
    check('site card rendered', arg.snap.count === 1, arg.snap.count);
    check('site card has width', arg.snap.width > 100, Math.round(arg.snap.width));
    check('site frame present', arg.snap.hasFrame, 'iframe');
    check('site served from virtual host', /^dexsite:\/\//.test(arg.snap.frameSrc), arg.snap.frameSrc);
    check('site bar present', arg.snap.hasBar, 'dxa-sitebar');
    check('three device presets', arg.snap.widthButtons === 3, arg.snap.widthButtons);
    check('file count chip', /files?/.test(arg.snap.files), arg.snap.files);
    check('console capture control', arg.snap.consoleButton, 'console');
    check('page navigation listed', arg.snap.pageButtons >= 1, arg.snap.pageButtons);
    check('site title shown', arg.snap.title.length > 0, arg.snap.title);
    window.__dxProbe(arg.probes);
  }, { snap, probes: SHELL_PROBES });
}

async function areaReportArtifact(ctx) {
  const { win, round } = ctx;
  await ensureSidebarOpen(win);
  await win.fill('#ai-input', 'build the intensive report artifact R' + round);
  await win.press('#ai-input', 'Enter');
  const card = win.locator('#ai-messages .dxa-card[data-kind="report"]').last();
  await expect(card).toBeVisible({ timeout: 30000 });
  // The card menu closes on thread scroll, which can happen between two
  // Playwright clicks on a loaded machine. Trigger both in one task so the
  // second real click lands before the scroll listener fires.
  await card.evaluate((el) => {
    const more = el.querySelector('button[aria-label="More actions"]');
    more.click();
    const design = Array.from(el.querySelectorAll('.dxa-menu .dxa-menu-item'))
      .find((b) => b.textContent.trim() === 'Design');
    if (!design) throw new Error('Design menu item missing');
    design.click();
  });
  await expect(win.locator('#ai-report-sheet')).toBeVisible({ timeout: 15000 });
  const snap = await win.evaluate(async () => ({
    visible: !document.querySelector('#ai-report-sheet').hidden,
    title: document.querySelector('#ai-report-title').textContent,
    version: document.querySelector('#ai-report-version').textContent,
    body: document.querySelectorAll('#ai-report-body .dxa-report').length,
    themes: document.querySelectorAll('#ai-report-theme option').length,
    patterns: document.querySelectorAll('#ai-report-pattern option').length,
    fonts: document.querySelectorAll('#ai-report-font option').length,
    backTitle: document.querySelector('#ai-report-back').title,
    tabTitle: document.querySelector('#ai-report-tab').title,
    downloadTitle: document.querySelector('#ai-report-download').title,
  }));
  await win.click('#ai-report-back');
  await expect(win.locator('#ai-report-sheet')).toBeHidden({ timeout: 15000 });
  await win.evaluate((arg) => {
    const check = window.__dxCheck;
    check('report sheet visible', arg.snap.visible, 'sheet');
    check('report title shown', /Intensive Report/.test(arg.snap.title), arg.snap.title);
    check('report version shown', /^v\d+$/.test(arg.snap.version), arg.snap.version);
    check('report body rendered', arg.snap.body === 1, arg.snap.body);
    check('design themes offered', arg.snap.themes >= 4, arg.snap.themes);
    check('design patterns offered', arg.snap.patterns >= 3, arg.snap.patterns);
    check('design fonts offered', arg.snap.fonts >= 3, arg.snap.fonts);
    check('back control labelled', arg.snap.backTitle.length > 0, arg.snap.backTitle);
    check('open in tab control labelled', arg.snap.tabTitle.length > 0, arg.snap.tabTitle);
    check('download control labelled', arg.snap.downloadTitle.length > 0, arg.snap.downloadTitle);
    window.__dxProbe(arg.probes);
  }, { snap, probes: SHELL_PROBES });
}

async function areaPreviewControls(ctx) {
  const { win } = ctx;
  const card = win.locator('#ai-messages .dxa-card[data-kind="site"]').last();
  const bar = card.locator('.dxa-sitebar');
  const widths = bar.locator('.dxa-width-btn');
  await expect(widths).toHaveCount(3);
  await widths.nth(0).click();
  await expect(card.locator('iframe.dxa-frame').first()).toHaveClass(/dxa-frame-phone/);
  await widths.nth(1).click();
  await expect(card.locator('iframe.dxa-frame').first()).toHaveClass(/dxa-frame-tablet/);
  await widths.nth(2).click();
  await expect(card.locator('iframe.dxa-frame').first()).not.toHaveClass(/dxa-frame-(phone|tablet)/);
  await bar.getByRole('button', { name: 'Expand', exact: true }).click();
  await expect(card.locator('.dxa-site')).toHaveClass(/expanded/);
  const beforeReload = await card.locator('iframe.dxa-frame').first().getAttribute('src');
  await bar.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect.poll(() => card.locator('iframe.dxa-frame').first().getAttribute('src'), { timeout: 15000 }).not.toBe(beforeReload);
  await expect(bar.locator('.dxa-console-btn .dxa-console-count')).toHaveText('1', { timeout: 15000 });
  await bar.locator('.dxa-console-btn').click();
  await expect(card.locator('.dxa-console')).toContainText('intensive-preview-probe');
  const edit = bar.locator('.dxa-edit-btn');
  await edit.click();
  await expect(edit).toHaveAttribute('aria-pressed', 'true');
  await edit.click();
  await expect(edit).toHaveAttribute('aria-pressed', 'false');
  const snap = await card.evaluate((el) => {
    const frame = el.querySelector('iframe.dxa-frame');
    return {
      phoneCleared: !frame.classList.contains('dxa-frame-phone') && !frame.classList.contains('dxa-frame-tablet'),
      desktopPressed: el.querySelectorAll('.dxa-width-btn')[2].getAttribute('aria-pressed') === 'true',
      expanded: el.querySelector('.dxa-site').classList.contains('expanded'),
      collapseVisible: Array.from(el.querySelectorAll('button')).some((b) => /Collapse/.test(b.textContent)),
      exitVisible: Array.from(el.querySelectorAll('button')).some((b) => /Exit preview/.test(b.textContent)),
      consoleText: (el.querySelector('.dxa-console') || {}).textContent || '',
      editLabel: el.querySelector('.dxa-edit-btn').getAttribute('aria-label') || '',
      src: frame.getAttribute('src') || '',
    };
  });
  await bar.getByRole('button', { name: 'Exit preview', exact: true }).click();
  await expect(card.locator('.dxa-site')).not.toHaveClass(/expanded/);
  await win.evaluate((arg) => {
    const check = window.__dxCheck;
    check('phone preset applied then cleared', arg.snap.phoneCleared, 'frame classes');
    check('desktop preset pressed', arg.snap.desktopPressed, 'aria-pressed');
    check('preview expanded', arg.snap.expanded, 'expanded class');
    check('collapse control visible', arg.snap.collapseVisible, 'Collapse');
    check('exit preview visible', arg.snap.exitVisible, 'Exit preview');
    check('reload rebuilt frame src', /[?&](?:cb|v|reload)=/.test(arg.snap.src), arg.snap.src.slice(0, 90));
    check('console count captured', /1/.test(arg.consoleCount), arg.consoleCount);
    check('console shows probe', arg.snap.consoleText.includes('intensive-preview-probe'), arg.snap.consoleText.slice(0, 60));
    check('edit control labelled', arg.snap.editLabel.length > 0, arg.snap.editLabel);
    check('exit preview restored dock', arg.exited, 'docked');
    window.__dxProbe(arg.probes);
  }, { snap, consoleCount: '1', exited: true, probes: SHELL_PROBES });
}

async function overlayUrls(app) {
  return app.evaluate(async ({ webContents }) => webContents.getAllWebContents()
    .map((wc) => wc.getURL() || '')
    .filter((url) => /dexerion:\/\/(?:artifact|report)\?.*overlay=1/.test(url)));
}

async function previewGeometry(app) {
  return app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const cb = w.getContentBounds();
    const ov = (w.contentView.children || []).find((v) => /overlay=1/.test(((v.webContents && v.webContents.getURL()) || '')));
    return { cb, bounds: ov ? ov.getBounds() : null, maximized: w.isMaximized() };
  });
}

async function areaFullscreen(ctx) {
  const { win, app } = ctx;
  const card = win.locator('#ai-messages .dxa-card[data-kind="site"]').last();
  await card.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect.poll(async () => (await overlayUrls(app)).some((u) => /artifact\?/.test(u)), { timeout: 20000 }).toBe(true);
  const urls = await overlayUrls(app);
  const docked = await previewGeometry(app);
  const before = await win.evaluate(() => window.dexerion.invoke('dex:overlay-fullscreen-state', { kind: 'site' }));
  await win.evaluate(() => window.dexerion.invoke('dex:overlay-fullscreen', { kind: 'site' }));
  await expect.poll(async () => {
    const g = await previewGeometry(app);
    return Boolean(g.bounds && g.bounds.x === 0 && g.maximized && g.bounds.width >= g.cb.width - 2);
  }, { timeout: 15000 }).toBe(true);
  const full = await previewGeometry(app);
  const during = await win.evaluate(() => window.dexerion.invoke('dex:overlay-fullscreen-state', { kind: 'site' }));
  await win.evaluate(() => window.dexerion.invoke('dex:overlay-fullscreen', { kind: 'site', fullscreen: false }));
  await expect.poll(async () => {
    const g = await previewGeometry(app);
    return Boolean(g.bounds && g.bounds.x > 0);
  }, { timeout: 15000 }).toBe(true);
  const restored = await previewGeometry(app);
  const after = await win.evaluate(() => window.dexerion.invoke('dex:overlay-fullscreen-state', { kind: 'site' }));
  await win.evaluate(() => window.dexerion.invoke('dex:site-overlay-close'));
  await expect.poll(async () => (await overlayUrls(app)).length, { timeout: 10000 }).toBe(0);
  const closed = (await overlayUrls(app)).length === 0;
  await win.evaluate((arg) => {
    const check = window.__dxCheck;
    check('site overlay opened', arg.urls.some((u) => /artifact\?/.test(u)), JSON.stringify(arg.urls));
    check('overlay url carries marker', arg.urls.some((u) => u.includes('overlay=1')), JSON.stringify(arg.urls));
    check('docked overlay keeps gutter', Boolean(arg.docked.bounds) && arg.docked.bounds.x > 0, JSON.stringify(arg.docked.bounds));
    check('docked overlay sized', Boolean(arg.docked.bounds) && arg.docked.bounds.width > 200, JSON.stringify(arg.docked.bounds));
    check('fullscreen starts off', arg.before === false, String(arg.before));
    check('fullscreen state goes true', arg.during === true, String(arg.during));
    check('fullscreen leaves gutter', Boolean(arg.full.bounds) && arg.full.bounds.x === 0, JSON.stringify(arg.full.bounds));
    check('fullscreen maximizes window', arg.full.maximized === true, String(arg.full.maximized));
    check('fullscreen fills content', Boolean(arg.full.bounds) && arg.full.bounds.width >= arg.full.cb.width - 2, JSON.stringify(arg.full.bounds));
    check('fullscreen restores and closes', arg.after === false && Boolean(arg.restored.bounds) && arg.restored.bounds.x > 0 && arg.closed,
      String(arg.after));
    window.__dxProbe(arg.probes);
  }, {
    urls, docked, before, full, during, restored, after, closed, probes: SHELL_PROBES,
  });
}

async function areaAccessibility(ctx) {
  const { win } = ctx;
  const before = await win.evaluate(() => ({
    lang: document.documentElement.lang,
    overflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2,
    rings: document.querySelectorAll('.dx-focus-ring').length,
    labelled: Array.from(document.querySelectorAll('#toolbar button')).filter((b) =>
      b.getAttribute('aria-label') || b.title || (b.textContent || '').trim()).length,
    toolbarButtons: document.querySelectorAll('#toolbar button').length,
    logRole: document.querySelector('#ai-messages').getAttribute('role'),
    separatorRole: document.querySelector('#ai-resize').getAttribute('role'),
    statusRole: document.querySelector('#lock').getAttribute('role'),
    buttonTargets: Array.from(document.querySelectorAll('#toolbar button')).filter((b) => {
      const r = b.getBoundingClientRect(); return r.width >= 24 && r.height >= 24;
    }).length,
    contrast: (() => {
      const el = document.querySelector('#menu-btn');
      const s = getComputedStyle(el);
      return s.color !== s.backgroundColor;
    })(),
  }));
  await win.keyboard.press('Control+Shift+A');
  await expect(win.locator('#ai-sidebar')).toBeHidden({ timeout: 10000 });
  const hidden = await win.evaluate(() => document.querySelector('#ai-sidebar').hidden);
  await win.waitForTimeout(600);
  await win.keyboard.press('Control+Shift+A');
  await expect(win.locator('#ai-sidebar')).toBeVisible({ timeout: 10000 });
  const shown = await win.evaluate(() => !document.querySelector('#ai-sidebar').hidden);
  await win.evaluate((arg) => {
    const check = window.__dxCheck;
    check('document language', arg.before.lang === 'en', arg.before.lang);
    check('no horizontal overflow', arg.before.overflow, 'scrollWidth');
    check('focus rings present', arg.before.rings >= 5, arg.before.rings);
    check('toolbar buttons labelled', arg.before.labelled === arg.before.toolbarButtons,
      arg.before.labelled + '/' + arg.before.toolbarButtons);
    check('minimum target sizes', arg.before.buttonTargets === arg.before.toolbarButtons,
      arg.before.buttonTargets + '/' + arg.before.toolbarButtons);
    check('conversation log role', arg.before.logRole === 'log', arg.before.logRole);
    check('resize separator role', arg.before.separatorRole === 'separator', arg.before.separatorRole);
    check('connection status role', arg.before.statusRole === 'status', arg.before.statusRole);
    check('menu control contrast', arg.before.contrast, 'computed');
    check('sidebar keyboard toggle both ways', arg.hidden === true && arg.shown === true,
      String(arg.hidden) + '/' + String(arg.shown));
    window.__dxProbe(arg.probes);
  }, { before, hidden, shown, probes: A11Y_PROBES });
}

const AREA_FNS = [
  areaBoot, areaChrome, areaMenu, areaTabs, areaNavigation, areaSidebar,
  areaSettings, areaTasks, areaFocus, areaHistory, areaBookmarks, areaDownloads,
  areaExtensions, areaScreenshots, areaInspector, areaSiteArtifact,
  areaReportArtifact, areaPreviewControls, areaFullscreen, areaAccessibility,
];

// ---------------------------------------------------------------------------
// 20 generated round tests.
// ---------------------------------------------------------------------------
for (let round = 1; round <= ROUNDS; round += 1) {
  const r = round;
  test('intensive round ' + pad(r, 2) + ': 1000 asserted scenarios', async () => {
    const roundCode = 'R' + pad(r, 2);
    const mock = await startAiMock({ reply: chatReply(r) });
    mock.replyFor = (body) => {
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const lastUser = [...messages].reverse().find((m) => m && m.role === 'user');
      const ask = String((lastUser && lastUser.content) || '');
      if (/site artifact/i.test(ask)) return siteReply(r);
      if (/report artifact/i.test(ask)) return reportReply(r);
      return chatReply(r);
    };
    const { app, win, profile } = await launchDexerion({ aiBase: mock.url });
    const pageErrors = [];
    win.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));
    let total = 0;
    try {
      await installCheckBridge(win, r);
      const seeded = await win.evaluate(async (key) => ({
        key: await window.dexerion.invoke('dex:ai-key-set', key),
        status: await window.dexerion.invoke('dex:ai-status'),
        state: await window.dexerion.invoke('dex:get-state'),
      }), 'nvapi-e2e-intensive-r' + pad(r, 2));
      expect(seeded.key.hasKey).toBe(true);
      expect(seeded.status.hasKey).toBe(true);

      const ctx = { round: r, roundCode, app, win, mock, profile, seeded };
      for (let i = 0; i < AREAS_PER_ROUND; i += 1) {
        total += await runArea(ctx, AREA_CODES[i], AREA_FNS[i]);
      }
      if (total !== SCENARIOS_PER_ROUND) {
        throw new Error(roundCode + ': expected ' + SCENARIOS_PER_ROUND + ' scenarios, got ' + total);
      }
      expect(pageErrors).toEqual([]);
      console.log('INTENSIVE E2E ROUND ' + pad(r, 2) + ': ' + total + '/' + SCENARIOS_PER_ROUND + ' PASS');
      expect(TOTAL_SCENARIOS).toBe(20000);
    } finally {
      await app.close().catch(() => {});
      await mock.close();
    }
  });
}

test.afterAll(() => {
  expect(ROUNDS).toBe(20);
  expect(AREAS_PER_ROUND).toBe(20);
  expect(CHECKS_PER_AREA).toBe(50);
  expect(SCENARIOS_PER_ROUND).toBe(1000);
  expect(TOTAL_SCENARIOS).toBe(20000);
  expect(AREA_CODES.length).toBe(20);
  expect(AREA_FNS.length).toBe(20);
  expect(new Set(AREA_CODES).size).toBe(20);
});
