'use strict';
// Phase 0 exit check: the app boots on the shared design tokens and a chat
// message round-trips through the assistant against a local OpenAI-compatible
// NIM mock — no network, no real key, throwaway profile.

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { startAiMock } = require('./ai-mock');
const { launchDexerion } = require('./app');

// Recursively look for a marker string inside the throwaway profile, so the
// "not saved" assertion is about bytes on disk rather than UI state.
function findMarker(dir, marker) {
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { stack.push(full); continue; }
      try {
        if (fs.statSync(full).size < 4 * 1024 * 1024 && fs.readFileSync(full, 'utf8').includes(marker)) return true;
      } catch {}
    }
  }
  return false;
}

test('boots with shared tokens and streams a mock NIM reply', async ({}, testInfo) => {
  const mock = await startAiMock({ reply: 'Dexerion e2e reply.' });
  const { app, win, profile } = await launchDexerion({ aiBase: mock.url });
  try {
    // 1. The shared token layer is live (tokens.css, aliased into the shell).
    //    Either theme is valid; the point is that the token exists and holds a
    //    value from tokens.css rather than a legacy paper colour.
    const ground = await win.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--dx-bg').trim().toLowerCase());
    expect(['#f9f9f9', '#171717']).toContain(ground);
    const accent = await win.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    expect(accent.length).toBeGreaterThan(0);

    // 2. Seed a key through the trusted shell bridge (test seam only;
    //    production would paste the key in the setup card).
    const status = await win.evaluate(async () => {
      await window.dexerion.invoke('dex:ai-key-set', 'nvapi-e2e-test-key');
      return await window.dexerion.invoke('dex:ai-status');
    });
    expect(status.hasKey).toBe(true);
    expect(status.providerId).toBe('nim');

    // 3. Open the sidebar (dex:ai-open notifies the panel, which then loads
    //    status and refreshes models from the mock) and send.
    await win.evaluate(() => window.dexerion.invoke('dex:ai-open'));
    await win.waitForSelector('#ai-sidebar:not([hidden])', { timeout: 15000 });
    await expect(win.locator('#ai-setup')).toBeHidden({ timeout: 15000 });
    await win.fill('#ai-input', 'Say hello');
    await win.press('#ai-input', 'Enter');

    // 4. The mock reply lands in the conversation.
    await expect(win.locator('#ai-messages')).toContainText('Dexerion e2e reply.', { timeout: 30000 });

    // 5. The request actually went to the mock, on the NIM default model.
    const sawChat = mock.requests.some((r) => r.url.includes('/chat/completions') && r.body && r.body.model === 'nvidia/nemotron-3-lightning-30b-a3b');
    expect(sawChat).toBe(true);

    // 6. Phase 1 controls: Ctrl+Shift+A toggles, the width preference applies
    //    (persisted and clamped in main), and one-click Summarise sends.
    await win.keyboard.press('Control+Shift+A');
    await expect(win.locator('#ai-sidebar')).toBeHidden();
    await win.evaluate(async () => {
      await window.dexerion.invoke('dex:ai-page-set', { usePage: true });
      await window.dexerion.invoke('dex:ai-ui-set', { width: 600 });
    });
    // The shell dedupes repeated shortcuts for 350ms (one press can arrive
    // from both the shell handler and the app-menu accelerator).
    await win.waitForTimeout(600);
    await win.keyboard.press('Control+Shift+A');
    await expect(win.locator('#ai-sidebar')).toBeVisible();
    await expect(win.locator('#ai-resize')).toHaveCount(1);
    const panel = win.locator('#ai-sidebar');
    const readGeometry = () => panel.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width), inner: window.innerWidth };
    });
    const appliedWidth = () => panel.evaluate(element => getComputedStyle(element).getPropertyValue('--ai-w').trim());
    await expect.poll(appliedWidth).toBe('600px');

    // The preference is 600px on every desktop, but a narrow host correctly
    // renders the panel inside the production breakpoint budget. Assert its
    // exact visible width and both edges, rather than changing the viewport.
    const geometry = await readGeometry();
    const cap = geometry.inner <= 650 ? geometry.inner
      : geometry.inner <= 1100 ? geometry.inner * 0.52 : 720;
    const visibleWidth = Math.round(Math.min(600, cap));
    expect(geometry.width).toBe(visibleWidth);
    expect(Math.abs(geometry.right - geometry.inner)).toBeLessThanOrEqual(2);
    expect(Math.abs(geometry.left - (geometry.inner - visibleWidth))).toBeLessThanOrEqual(2);

    // The real drag must still move visible pixels and persist that exact
    // rendered width. Start below the cap so it has runway on small CI screens.
    const dragStart = Math.min(600, Math.max(320, Math.floor(cap) - 100));
    const dragPixels = Math.min(80, Math.floor(cap) - dragStart - 4);
    expect(dragPixels, 'desktop must leave sufficient visible drag room').toBeGreaterThanOrEqual(16);
    if (dragStart !== 600) {
      await win.locator('#ai-btn').click();
      await expect(panel).toBeHidden();
      await win.evaluate(width => window.dexerion.invoke('dex:ai-ui-set', { width }), dragStart);
      await win.locator('#ai-btn').click();
      await expect(panel).toBeVisible();
      await expect.poll(appliedWidth).toBe(dragStart + 'px');
    }
    expect((await readGeometry()).width).toBe(dragStart);

    const handle = win.locator('#ai-resize');
    await expect(handle).toBeVisible();
    const handleBox = await handle.boundingBox();
    expect(handleBox).not.toBeNull();
    const startX = handleBox.x + handleBox.width / 2;
    const dragY = handleBox.y + Math.min(160, handleBox.height / 2);
    await win.mouse.move(startX, dragY);
    await win.mouse.down();
    await win.mouse.move(startX - dragPixels, dragY, { steps: 8 });
    await win.mouse.up();
    const savedWidth = () => win.evaluate(() => window.dexerion.invoke('dex:ai-ui-get').then(prefs => prefs.width));
    await expect.poll(savedWidth).toBeGreaterThanOrEqual(dragStart + dragPixels - 2);
    const afterDrag = await readGeometry();
    expect(afterDrag.width).toBeGreaterThanOrEqual(dragStart + dragPixels - 2);
    expect(Math.abs(afterDrag.width - await savedWidth())).toBeLessThanOrEqual(1);
    expect(Math.abs(afterDrag.right - afterDrag.inner)).toBeLessThanOrEqual(2);
    expect(Math.abs(afterDrag.left - (afterDrag.inner - afterDrag.width))).toBeLessThanOrEqual(2);
    // The one-click Summarise button is gone; the same job is now a sentence.
    const posts = () => mock.requests.filter((r) => r.url.includes('/chat/completions')).length;
    const before = posts();
    await win.fill('#ai-input', 'Summarise this page in five bullet points.');
    await win.press('#ai-input', 'Enter');
    await expect.poll(posts, { timeout: 30000 }).toBeGreaterThan(before);
    const summarySent = mock.requests.some((r) => JSON.stringify(r.body).includes('Summarise this page'));
    expect(summarySent).toBe(true);
    // Wait for the in-flight send to settle before the next section.
    await win.waitForFunction(() => !document.querySelector('#ai-send').classList.contains('is-stop'), { timeout: 30000 });

    // 7. Per-site off: reading refuses while off, and turning it back on works.
    const site = await win.evaluate(async () => {
      const before = await window.dexerion.invoke('dex:ai-site-get');
      const off = await window.dexerion.invoke('dex:ai-site-set', { off: true });
      const read = await window.dexerion.invoke('dex:ai-read-page').catch((error) => ({ ok: false, error: error.message }));
      const back = await window.dexerion.invoke('dex:ai-site-set', { off: false });
      return { host: before.host, off: off.off, readOk: read && read.ok, readError: read && read.error, back: back.off };
    });
    expect(site.host.length).toBeGreaterThan(0);
    expect(site.off).toBe(true);
    expect(site.readOk).toBe(false);
    expect(String(site.readError)).toMatch(/off for/);
    expect(site.back).toBe(false);

    // 8. Conversations switch: saved while on, session-only while off, and
    //    the off case leaves no bytes on disk.
    const markerOn = 'E2E-CHAT-SAVED-777';
    const markerOff = 'E2E-CHAT-UNSAVED-888';
    await win.evaluate(async (marker) => {
      const chat = await window.dexerion.invoke('dex:ai-chat-create', { title: 'E2E control' });
      await window.dexerion.invoke('dex:ai-chat-append', { id: chat.id, message: { role: 'user', text: marker } });
    }, markerOn);
    await win.waitForTimeout(900);
    expect(findMarker(profile, markerOn)).toBe(true);

    const sessionState = await win.evaluate(async (marker) => {
      await window.dexerion.invoke('dex:ai-ui-set', { saveChats: false });
      const chat = await window.dexerion.invoke('dex:ai-chat-create', { title: 'E2E session' });
      await window.dexerion.invoke('dex:ai-chat-append', { id: chat.id, message: { role: 'user', text: marker } });
      const list = await window.dexerion.invoke('dex:ai-chats-list');
      return list.map((item) => item.title);
    }, markerOff);
    await win.waitForTimeout(900);
    expect(findMarker(profile, markerOff)).toBe(false);
    // While the switch is off the session chat is listed but the previously
    // saved one is hidden; the title is the first message (auto-titled).
    expect(sessionState).toContain(markerOff);
    expect(sessionState).not.toContain(markerOn);

    // 9. Reports: a v2 artifact renders a card, opens the report view, and the
    //    look control persists to the stored chat.
    mock.reply = [
      'Here is the report.',
      '```dex-artifact',
      JSON.stringify({
        kind: 'report',
        title: 'E2E tides',
        blocks: [
          { type: 'heading', text: 'Why it matters', level: 2 },
          { type: 'paragraph', text: 'The Moon dominates the tide.' },
          { type: 'stats', items: [{ value: '1.0', label: 'Moon' }] },
        ],
      }),
      '```',
    ].join('\n');
    await win.fill('#ai-input', 'Make a report');
    await win.press('#ai-input', 'Enter');
    const card = win.locator('#ai-messages .dxa-card[data-kind="report"]').last();
    await expect(card).toBeVisible({ timeout: 30000 });
    // A report card may appear before its stream settles. The fixed menu
    // closes on a real chat scroll, so prepare its trigger before opening and
    // use its existing keyboard path instead of scrolling a fixed item into view.
    const chooseCardAction = async name => {
      const trigger = card.getByRole('button', { name: 'More actions' });
      const action = card.getByRole('menuitem', { name, exact: true });
      await expect(win.locator('#ai-send')).not.toHaveClass(/\bis-stop\b/);
      await trigger.scrollIntoViewIfNeeded();
      await trigger.focus();
      await expect(trigger).toBeFocused();
      const stableScroll = () => win.evaluate(async () => {
        const thread = document.getElementById('ai-messages');
        const start = thread.scrollTop;
        for (let i = 0; i < 3; i++) {
          await new Promise(resolve => requestAnimationFrame(resolve));
        }
        return Math.abs(thread.scrollTop - start) < 1;
      });
      await expect.poll(stableScroll, { timeout: 5000 }).toBe(true);
      // Read-only trace of the synthetic card so an intermittent
      // Windows dismiss produces evidence instead of a 30 second selector wait.
      await card.evaluate(el => {
        const thread = document.getElementById('ai-messages');
        const menu = el.querySelector('[role="menu"]');
        const trigger = el.querySelector('button[aria-label="More actions"]');
        const rows = [];
        function record(event, detail = '') {
          if (rows.length >= 80) return;
          rows.push({ event, detail, now:Math.round(performance.now()), scrollTop:thread.scrollTop,
            active:document.activeElement === trigger ? 'trigger' : document.activeElement?.getAttribute('role'),
            expanded:trigger.getAttribute('aria-expanded'), hidden:menu.hidden, connected:trigger.isConnected });
        }
        const scroll = () => record('scroll');
        const focus = event => record('focus', event.target === trigger ? 'trigger' : event.target.getAttribute?.('role') || event.target.tagName);
        const key = event => { if (/^(Enter|ArrowDown|Escape|Tab)$/.test(event.key)) record('key', event.key); };
        const mutation = new MutationObserver(list => {
          for (const m of list) record('mutation', m.attributeName);
        });
        thread.addEventListener('scroll', scroll, true);
        document.addEventListener('focusin', focus, true);
        document.addEventListener('keydown', key, true);
        mutation.observe(trigger, {attributes:true,attributeFilter:['aria-expanded']});
        mutation.observe(menu, {attributes:true,attributeFilter:['hidden']});
        window.__dexTestReportMenuSnapshot = {
          read() {
            return { innerWidth, innerHeight, devicePixelRatio, scrollHeight:thread.scrollHeight, connected:trigger.isConnected,
              thread:thread.getBoundingClientRect().toJSON(), trigger:trigger.getBoundingClientRect().toJSON(),
              menu:menu.getBoundingClientRect().toJSON(), rows };
          },
          close() {
            mutation.disconnect();
            thread.removeEventListener('scroll', scroll, true);
            document.removeEventListener('focusin', focus, true);
            document.removeEventListener('keydown', key, true);
            delete window.__dexTestReportMenuSnapshot;
          },
        };
        record('ready');
      });
      try {
        await win.keyboard.press('Enter');
        await expect(trigger).toHaveAttribute('aria-expanded', 'true', { timeout: 5000 });
        await expect(action).toBeVisible({ timeout: 5000 });
        const items = await card.getByRole('menuitem').count();
        for (let i = 0; i < items; i++) {
          await expect(trigger, 'menu closed before focus reached its intended action').toHaveAttribute('aria-expanded','true', { timeout:2000 });
          const hasFocus = await card.evaluate((el, label) =>
            el.contains(document.activeElement) && document.activeElement?.getAttribute('role') === 'menuitem' &&
            document.activeElement?.textContent.trim() === label, name);
          if (hasFocus) break;
          await win.keyboard.press('ArrowDown');
        }
        await expect(action).toBeFocused({ timeout: 3000 });
        await win.keyboard.press('Enter');
      } catch (e) {
        const state = await win.evaluate(() => window.__dexTestReportMenuSnapshot?.read()).catch(() => ({}));
        const f = testInfo.outputPath('report-menu-' + name.toLowerCase().replace(/\s+/g,'-') + '.json');
        fs.mkdirSync(path.dirname(f), {recursive:true});
        fs.writeFileSync(f,JSON.stringify(state,null,2)+'\n','utf8');
        await testInfo.attach('report-menu-diagnostic', {path:f,contentType:'application/json'});
        console.error('[report-menu-fixture]', JSON.stringify(state));
        throw e;
      } finally {
        await win.evaluate(() => window.__dexTestReportMenuSnapshot?.close()).catch(() => {});
      }
    };

    // Open lands the report as a full page beside the sidebar: a dedicated
    // overlay WebContentsView over the content area — NOT a new tab, because
    // the tab strip belongs to the person.
    const tabsBefore = await win.evaluate(() => document.querySelectorAll('#tabs .tab').length);
    await card.getByRole('button', { name: 'Open', exact: true }).click();
    const overlay = async () => app.evaluate(async ({ BrowserWindow, webContents }) => {
      const w = BrowserWindow.getAllWindows()[0];
      const reports = webContents.getAllWebContents()
        .filter((wc) => /dexerion:\/\/report/.test(wc.getURL() || ''));
      return {
        urls: reports.map((wc) => wc.getURL()),
        title: reports[0] ? reports[0].getTitle() : '',
        viewChildren: w ? w.contentView.children.length : 0,
      };
    });
    await expect.poll(async () => (await overlay()).urls.length, { timeout: 20000 }).toBe(1);
    const shown = await overlay();
    expect(shown.urls[0]).toContain('dexerion://report?');
    expect(shown.urls[0]).toContain('overlay=1');
    expect(shown.viewChildren).toBeGreaterThanOrEqual(2);
    await expect.poll(async () => (await overlay()).title, { timeout: 20000 }).toContain('E2E tides');
    // …and the overlay did not touch the person's tabs.
    expect(await win.evaluate(() => document.querySelectorAll('#tabs .tab').length)).toBe(tabsBefore);
    // …and Design opens the in-panel view with versions and look controls
    // (it lives in the card's ⋯ menu so the primary pair always fits).
    await chooseCardAction('Design');
    await expect(win.locator('#ai-report-sheet')).toBeVisible();
    await expect(win.locator('#ai-report-version')).toHaveText('v1');
    await expect(win.locator('#ai-report-body .dxa-report')).toHaveCount(1);
    await win.selectOption('#ai-report-theme', 'modern');
    await expect(win.locator('#ai-report-body .dxa-report')).toHaveAttribute('data-theme', 'modern');
    await win.waitForTimeout(300);
    const persisted = await win.evaluate(async () => {
      const list = await window.dexerion.invoke('dex:ai-chats-list');
      for (const row of list) {
        const chat = await window.dexerion.invoke('dex:ai-chat-open', row.id);
        const message = (chat.messages || []).find((m) => m.artifact && m.artifact.kind === 'report');
        if (message) return { theme: message.artifact.theme, title: message.artifact.title };
      }
      return null;
    });
    expect(persisted).toEqual({ theme: 'modern', title: 'E2E tides' });
    await win.click('#ai-report-back');
    await expect(win.locator('#ai-report-sheet')).toBeHidden();
    // Leave the overlay closed: later steps drive the tab underneath.
    await win.evaluate(() => window.dexerion.invoke('dex:report-overlay-close')).catch(() => {});
    await expect.poll(async () => (await overlay()).urls.length, { timeout: 10000 }).toBe(0);

    // 9b. Direct report editing (V14): edit a paragraph in the card; Enter
    //     saves through the store (history grows); Undo edit restores it.
    await card.getByRole('button', { name: 'Edit report text directly' }).click();
    const para = card.locator('.dxa-report [data-block-index="1"]');
    await expect(para).toHaveAttribute('contenteditable', 'plaintext-only');
    await para.click();
    await para.fill('The Moon dominates the tide. Edited.');
    await para.press('Enter');
    await expect(card.locator('.dxa-report [data-block-index="1"]')).toHaveText(
      'The Moon dominates the tide. Edited.', { timeout: 15000 });
    const storedReport = () => win.evaluate(async () => {
      const list = await window.dexerion.invoke('dex:ai-chats-list');
      for (const row of list) {
        const chat = await window.dexerion.invoke('dex:ai-chat-open', row.id);
        const message = (chat.messages || []).find((m) => m.artifact && m.artifact.kind === 'report' && m.artifact.title === 'E2E tides');
        if (message) {
          return {
            text: (message.artifact.blocks.find((b) => b.type === 'paragraph') || {}).text || '',
            history: (message.artifact.history || []).length,
          };
        }
      }
      return null;
    });
    await expect.poll(async () => (await storedReport()).text, { timeout: 15000 }).toBe('The Moon dominates the tide. Edited.');
    expect((await storedReport()).history).toBe(1);
    // Undo edit: the newest snapshot comes back through the shared restore.
    await chooseCardAction('Undo edit');
    await expect(card.locator('.dxa-report [data-block-index="1"]')).toHaveText(
      'The Moon dominates the tide.', { timeout: 15000 });
    await expect.poll(async () => (await storedReport()).text, { timeout: 15000 }).toBe('The Moon dominates the tide.');
    await card.getByRole('button', { name: 'Finish editing the report' }).click();

    // 9c. Annotations (V15): select a passage in the report overlay, add a
    //     note; the CSS Custom Highlight API paints it (asserted through the
    //     real registry) and the anchor persists on the stored artifact.
    await card.getByRole('button', { name: 'Open', exact: true }).click();
    await expect.poll(async () => (await overlay()).urls.length, { timeout: 20000 }).toBe(1);
    const inReport = (code) => app.evaluate(async ({ webContents }, js) => {
      const wc = webContents.getAllWebContents().find((w) => /^dexerion:\/\/report/.test(w.getURL() || ''));
      if (!wc) return null;
      return wc.executeJavaScript(js);
    }, code);
    await expect.poll(async () => inReport(`Boolean(document.querySelector('.dxa-report [data-block-index="1"]'))`), { timeout: 20000 }).toBe(true);
    const composerState = await inReport(`(function(){
      const block = document.querySelector('.dxa-report [data-block-index="1"]');
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
      const tn = walker.nextNode();
      const quote = 'Moon dominates';
      const at = tn.data.indexOf(quote);
      const range = document.createRange();
      range.setStart(tn, at);
      range.setEnd(tn, at + quote.length);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.getElementById('btnAnnotations').click();
      document.getElementById('annoAdd').click();
      return {
        composerOpen: !document.getElementById('annoCompose').hidden,
        quote: document.getElementById('annoQuote').textContent,
      };
    })()`);
    expect(composerState.composerOpen).toBe(true);
    expect(composerState.quote).toContain('Moon dominates');
    await inReport(`(function(){
      document.getElementById('annoNote').value = 'Check this figure';
      document.getElementById('annoSave').click();
      return true;
    })()`);
    // A real Highlight is a Set of ranges (no `.ranges` property); iterate it.
    await expect.poll(async () => inReport(`(function(){
      const hl = window.CSS && CSS.highlights && CSS.highlights.get('dxa-note');
      if (!hl || !hl.size) return '';
      const range = Array.from(hl)[0];
      return range ? range.toString() : '';
    })()`), { timeout: 15000 }).toBe('Moon dominates');
    expect(await inReport(`document.querySelectorAll('#annotationsBody .anno').length`)).toBe(1);
    await expect.poll(async () => win.evaluate(async () => {
      const list = await window.dexerion.invoke('dex:ai-chats-list');
      for (const row of list) {
        const chat = await window.dexerion.invoke('dex:ai-chat-open', row.id);
        const message = (chat.messages || []).find((m) => m.artifact && m.artifact.kind === 'report' && m.artifact.title === 'E2E tides');
        const annos = message && message.artifact ? (message.artifact.annotations || []) : [];
        return annos.length ? annos[0].note : '';
      }
      return '';
    }), { timeout: 15000 }).toBe('Check this figure');
    const storedAnchor = await win.evaluate(async () => {
      const list = await window.dexerion.invoke('dex:ai-chats-list');
      for (const row of list) {
        const chat = await window.dexerion.invoke('dex:ai-chat-open', row.id);
        const message = (chat.messages || []).find((m) => m.artifact && m.artifact.kind === 'report' && m.artifact.title === 'E2E tides');
        const a = message && message.artifact ? (message.artifact.annotations || [])[0] : null;
        return a ? { quote: a.quote, blockId: a.blockId, offset: a.offset, hasContext: Boolean(a.prefix || a.suffix) } : null;
      }
      return null;
    });
    expect(storedAnchor).toMatchObject({ quote: 'Moon dominates', blockId: '1' });
    expect(Number.isInteger(storedAnchor.offset)).toBe(true);
    expect(storedAnchor.hasContext).toBe(true);
    // Persistence proof (V17): reload the report page from the store — the
    // note comes back in the rail and the highlight re-registers from the
    // stored anchor alone (nothing lives in page memory).
    await app.evaluate(async ({ webContents }) => {
      const wc = webContents.getAllWebContents().find((w) => /^dexerion:\/\/report/.test(w.getURL() || ''));
      if (wc) await wc.reload();
      return true;
    });
    await expect.poll(async () => inReport(`document.querySelectorAll('#annotationsBody .anno').length`), { timeout: 20000 }).toBe(1);
    await expect.poll(async () => inReport(`(function(){
      const hl = window.CSS && CSS.highlights && CSS.highlights.get('dxa-note');
      if (!hl || !hl.size) return '';
      const range = Array.from(hl)[0];
      return range ? range.toString() : '';
    })()`), { timeout: 15000 }).toBe('Moon dominates');

    // 9d. Report UI (V16): the reading typography is real CSS (tabular figures
    //     for numbers, a ~70ch measure for prose), the TOC tracks the current
    //     section with a block-keyed button, and the back-to-top button
    //     appears only once the report is scrolled.
    // The reload above can settle annotations before the final layout pass;
    // wait for real width instead of sampling a zero-width frame.
    await expect.poll(async () => inReport(`(function(){
      const para = document.querySelector('.dxa-report .dxa-md');
      return para ? Math.round(para.getBoundingClientRect().width) : -1;
    })()`), { timeout: 15000 }).toBeGreaterThan(180);
    const ui = await inReport(`(function(){
      const stat = document.querySelector('.dxa-report .dxa-stat-value');
      const para = document.querySelector('.dxa-report .dxa-md');
      const rows = Array.from(document.querySelectorAll('#tocBody .toc-item'));
      return {
        tabular: stat ? getComputedStyle(stat).fontVariantNumeric : '',
        paraWidth: para ? Math.round(para.getBoundingClientRect().width) : -1,
        topHidden: document.getElementById('btnTop').hidden,
        tocRows: rows.length,
        tocTag: rows[0] ? rows[0].tagName : '',
      };
    })()`);
    expect(ui.tabular).toBe('tabular-nums');
    expect(ui.paraWidth).toBeGreaterThan(180);
    expect(ui.paraWidth).toBeLessThan(760);
    expect(ui.topHidden).toBe(true);
    expect(ui.tocRows).toBe(1);
    expect(ui.tocTag).toBe('BUTTON');
    // Give the fixture enough height that a real scroll is possible, scroll,
    // and let the button prove itself both ways.
    await inReport(`(function(){
      document.getElementById('wrap').style.minHeight = '2400px';
      window.scrollTo(0, 900);
      return true;
    })()`);
    await expect.poll(async () => inReport(`document.getElementById('btnTop').hidden`), { timeout: 10000 }).toBe(false);
    await inReport(`document.getElementById('btnTop').click()`);
    await expect.poll(async () => inReport(`Math.round(window.scrollY)`), { timeout: 10000 }).toBeLessThan(120);
    await expect.poll(async () => inReport(`document.getElementById('btnTop').hidden`), { timeout: 10000 }).toBe(true);
    // The TOC click keeps the deep link in step (?b=<block>).
    await inReport(`document.querySelector('#tocBody .toc-item').click()`);
    await expect.poll(async () => inReport(`location.search.includes('b=0')`), { timeout: 10000 }).toBe(true);
    await win.evaluate(() => window.dexerion.invoke('dex:report-overlay-close')).catch(() => {});
    await expect.poll(async () => (await overlay()).urls.length, { timeout: 10000 }).toBe(0);

    // 10. Report presets by intent: no menu chrome; the chip stays as the
    //     reminder and its × clears it.
    await win.fill('#ai-input', 'use the research brief preset');
    await win.press('#ai-input', 'Enter');
    await expect(win.locator('#ai-preset-chip')).toBeVisible({ timeout: 10000 });
    await expect(win.locator('#ai-preset-name')).not.toHaveText('');
    await win.click('#ai-preset-clear');
    await expect(win.locator('#ai-preset-chip')).toBeHidden();

    // 11. Exports: HTML, Markdown, Word and PDF all reach disk (the test seam
    //     names the target path so no native save dialog opens).
    const exports = await win.evaluate(async (base) => {
      const list = await window.dexerion.invoke('dex:ai-chats-list');
      let artifact = null;
      for (const row of list) {
        const chat = await window.dexerion.invoke('dex:ai-chat-open', row.id);
        const message = (chat.messages || []).find((m) => m.artifact && m.artifact.kind === 'report');
        if (message) { artifact = message.artifact; break; }
      }
      if (!artifact || !window.DexReportExport) return null;
      const html = window.DexReportExport.html(artifact);
      const markdown = window.DexArtifacts.toMarkdown(artifact);
      const out = {};
      for (const format of ['html', 'md', 'docx', 'pdf']) {
        out[format] = await window.dexerion.invoke('dex:ai-report-export', {
          format,
          name: 'e2e-report',
          html,
          markdown,
          artifact,
          path: base + '\\export.' + format,
        });
      }
      return out;
    }, profile);
    expect(exports).not.toBeNull();
    for (const format of ['html', 'md', 'docx', 'pdf']) {
      expect(exports[format].ok, format + ' export: ' + JSON.stringify(exports[format])).toBe(true);
      expect(fs.statSync(exports[format].path).size, format + ' size').toBeGreaterThan(20);
    }
    expect(fs.readFileSync(exports.html.path, 'utf8').slice(0, 15)).toContain('<!doctype html>');
    expect(fs.readFileSync(exports.md.path, 'utf8')).toContain('##');
    expect(fs.readFileSync(exports.docx.path).slice(0, 2).toString()).toBe('PK');
    expect(fs.readFileSync(exports.pdf.path).slice(0, 4).toString()).toBe('%PDF');

    // 11b. The exports carry the reading notes (V17): a real <mark> in the
    //      HTML (which the PDF prints from), the appendix in the Markdown —
    //      then the two-step delete through the UI empties the store again.
    const exportedHtml = fs.readFileSync(exports.html.path, 'utf8');
    expect(exportedHtml).toContain('class="dxa-ann"');
    expect(exportedHtml).toContain('Check this figure');
    expect(exportedHtml).toContain('class="dxa-section dxa-notes"');
    expect(fs.readFileSync(exports.md.path, 'utf8')).toContain('## Notes');
    // Reopen with the notes panel ready (V18): the path the card's chip uses
    // — dex:report-overlay-open carries the panel param through to the viewer.
    const reopened = await win.evaluate(async () => {
      const list = await window.dexerion.invoke('dex:ai-chats-list');
      for (const row of list) {
        const chat = await window.dexerion.invoke('dex:ai-chat-open', row.id);
        const idx = (chat.messages || []).findIndex((m) => m.artifact && m.artifact.kind === 'report' && m.artifact.title === 'E2E tides');
        if (idx >= 0) {
          await window.dexerion.invoke('dex:report-overlay-open', { chatId: row.id, index: idx, panel: 'notes' });
          return true;
        }
      }
      return false;
    });
    expect(reopened).toBe(true);
    await expect.poll(async () => (await overlay()).urls.length, { timeout: 20000 }).toBe(1);
    await expect.poll(async () => inReport(`document.getElementById('panelAnnotations').classList.contains('open')`), { timeout: 20000 }).toBe(true);
    await expect.poll(async () => inReport(`document.querySelectorAll('#annotationsBody .anno').length`), { timeout: 20000 }).toBe(1);
    await inReport(`(function(){
      const btn = Array.from(document.querySelectorAll('#annotationsBody .acts button')).find((b) => b.textContent === 'Delete');
      if (btn) { btn.click(); btn.click(); }
      return true;
    })()`);
    await expect.poll(async () => win.evaluate(async () => {
      const list = await window.dexerion.invoke('dex:ai-chats-list');
      for (const row of list) {
        const chat = await window.dexerion.invoke('dex:ai-chat-open', row.id);
        const message = (chat.messages || []).find((m) => m.artifact && m.artifact.kind === 'report' && m.artifact.title === 'E2E tides');
        return message && message.artifact ? (message.artifact.annotations || []).length : -1;
      }
      return -1;
    }), { timeout: 15000 }).toBe(0);
    await win.evaluate(() => window.dexerion.invoke('dex:report-overlay-close')).catch(() => {});
    await expect.poll(async () => (await overlay()).urls.length, { timeout: 10000 }).toBe(0);

    // 11c. Files deep-links a search hit to the section (V18): searching a
    //      phrase from inside the report and opening the row lands a viewer
    //      tab on the matching block (&b=1) — the whole chain through the
    //      real page, hit shape and shared URL builder together.
    await win.evaluate(() => window.dexerion.invoke('dex:new-tab', 'dexerion://files', false));
    const filesRows = await app.evaluate(async ({ webContents }, code) => {
      const [setup, click] = code;
      for (let i = 0; i < 30; i += 1) {
        const wc = webContents.getAllWebContents().find((w) => /dexerion:\/\/files/.test(w.getURL() || ''));
        if (!wc) { await new Promise((r) => setTimeout(r, 400)); continue; }
        try {
          if ((await wc.executeJavaScript('document.readyState')) !== 'complete') { await new Promise((r) => setTimeout(r, 400)); continue; }
          await wc.executeJavaScript(setup);
          await new Promise((r) => setTimeout(r, 1200));
          const rows = await wc.executeJavaScript("document.querySelectorAll('#reports .dx-item').length");
          if (!rows) { await new Promise((r) => setTimeout(r, 600)); continue; }
          await wc.executeJavaScript(click);
          return rows;
        } catch { /* retry */ }
      }
      return 0;
    }, [
      "(() => { const q = document.getElementById('q'); q.value = 'Moon dominates'; q.dispatchEvent(new Event('input', { bubbles: true })); return true; })()",
      "(() => { const open = document.querySelector('#reports .dx-item .actions .btn'); if (open) open.click(); return true; })()",
    ]);
    expect(filesRows).toBeGreaterThan(0);
    await expect.poll(async () => app.evaluate(async ({ webContents }) => {
      const wc = webContents.getAllWebContents().find((w) => /^dexerion:\/\/report\?/.test(w.getURL() || '') && /[?&]b=1(&|$)/.test(w.getURL() || ''));
      return wc ? wc.getURL() : '';
    }), { timeout: 20000 }).toContain('b=1');

    // 12. Files handoff: opening a chat from another page stashes it, opens
    //     the panel and selects that chat.
    const opened = await win.evaluate(async () => {
      const chat = await window.dexerion.invoke('dex:ai-chat-create', { title: 'Files handoff' });
      await window.dexerion.invoke('dex:ai-chat-append', { id: chat.id, message: { role: 'user', text: 'handoff message' } });
      const ok = await window.dexerion.invoke('dex:ai-open-chat', chat.id);
      return { ok };
    });
    expect(opened.ok).toBe(true);
    // The chat auto-titles from its first message; the panel must show it.
    await expect(win.locator('#ai-messages')).toContainText('handoff message', { timeout: 15000 });

    // 13. Page reader: the vendored Readability runs inside the real tab and
    //     the article text comes back as page context.
    const articleOrigin = mock.url.replace(/\/v1$/, '');
    const readResult = await win.evaluate(async (target) => {
      await window.dexerion.invoke('dex:navigate', null, target);
      const started = Date.now();
      while (Date.now() - started < 25000) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const page = await window.dexerion.invoke('dex:ai-read-page').catch(() => null);
        if (page && page.ok && page.context && page.context.text) {
          return { ok: true, text: page.context.text };
        }
      }
      return { ok: false };
    }, articleOrigin + '/article');
    expect(readResult.ok).toBe(true);
    expect(readResult.text).toContain('Example Domain');
    expect(readResult.text).not.toContain('Navigation junk');
  } finally {
    await app.close().catch(() => {});
    await mock.close();
  }
});
