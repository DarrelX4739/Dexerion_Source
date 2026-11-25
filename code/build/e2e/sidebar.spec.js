'use strict';
// Phase 2 — the buttonless AI sidebar: task bar + thread + composer.
//   no action rail in the DOM, one persistent task-bar control,
//   difficulty chip instead of any model name (reply meta included),
//   typed intents run locally (never a model call),
//   Esc closes, and the keyboard-only path open -> ask -> answer works.

const { test, expect } = require('@playwright/test');
const { startAiMock } = require('./ai-mock');
const { launchDexerion } = require('./app');

test('the sidebar is task bar + thread + composer', async () => {
  const mock = await startAiMock({});
  const { app, win } = await launchDexerion({ aiBase: mock.url });
  try {
    await win.evaluate(async () => {
      await window.dexerion.invoke('dex:ai-key-set', 'nvapi-e2e-sidebar');
      await window.dexerion.invoke('dex:ai-open');
    });
    await win.waitForSelector('#ai-sidebar:not([hidden])', { timeout: 15000 });

    // 1. No rail, no model picker; the task bar has text controls only, and
    //    the effort chip lives at the bottom in the composer.
    expect(await win.locator('.ai-topbar-actions').count()).toBe(0);
    expect(await win.locator('#ai-model').count()).toBe(0);
    expect(await win.locator('.ai-taskbar .ai-icon-btn').count()).toBe(0);
    expect(await win.locator('#ai-new').count()).toBe(1);
    expect(await win.locator('#ai-history').count()).toBe(1);
    // The effort tier is a labelled select in the composer (the retired pill and
    // its hover menu are gone — see scripts/test-sidebar.js).
    expect(await win.locator('.ai-composer #ai-effort-select').count()).toBe(1);
    expect(await win.locator('#ai-effort-select option').count()).toBe(4);
    expect(await win.locator('#ai-effort-select')).toHaveValue('medium');
    expect(await win.locator('.ai-composer #ai-effort-wrap')).toBeVisible();
    expect(await win.evaluate(() => document.querySelector('#ai-hint').textContent)).toBe('');

    // The History control opens the same chat management as before.
    await win.click('#ai-history');
    await expect(win.locator('#ai-chat-sheet')).toBeVisible();
    await win.click('#ai-chats-close');

    // 2. Typed intents run locally: panels open, no model call is made.
    //    The sidebar deliberately fires a one-token background connection
    //    warm-up when it sees a key (max_tokens=1, content "hi"). That is not
    //    an intent turn, so exclude it — everything else must stay at zero.
    const posts = () => mock.requests.filter((r) => {
      if (!r.url.includes('/chat/completions')) return false;
      // A prewarm is a one-token connection probe, never an intent turn. The
      // wire request always carries max_tokens=1, whatever system/message
      // framing the provider adds, so that alone identifies it reliably.
      return (r.body || {}).max_tokens !== 1;
    }).length;
    const before = posts();
    await win.fill('#ai-input', 'show my chats');
    await win.press('#ai-input', 'Enter');
    await expect(win.locator('#ai-chat-sheet')).toBeVisible();
    await win.click('#ai-chats-close');
    await win.fill('#ai-input', 'open settings');
    await win.press('#ai-input', 'Enter');
    await expect(win.locator('#ai-settings-sheet')).toBeVisible();
    await win.click('#ai-settings-close');
    expect(posts()).toBe(before);

    // 3. Choosing an effort tier persists per account.
    await win.selectOption('#ai-effort-select', 'high');
    await expect(win.locator('#ai-effort-select')).toHaveValue('high');
    const saved = await win.evaluate(() => window.dexerion.invoke('dex:ai-difficulty-get'));
    expect(saved.difficulty).toBe('high');

    // 3b. Model switching status lives on its own single line. Regression:
    // the raw catalogue id used to be written into the crowded send row, where
    // it wrapped under the picker/send glyphs. It must now show a short label
    // in a dedicated row above the controls, with clipped overflow geometry.
    await expect(win.locator('#ai-model-wrap')).toBeVisible({ timeout: 15000 });
    const pick = await win.evaluate(() => {
      const sel = document.querySelector('#ai-model-select');
      const options = [...sel.options].map((o) => o.value);
      const other = options.find((id) => id !== sel.value) || options[0];
      sel.value = other;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return other;
    });
    await expect(win.locator('#ai-hint')).not.toBeEmpty({ timeout: 10000 });
    const pickerUi = await win.evaluate(() => {
      const hint = document.querySelector('#ai-hint');
      const send = document.querySelector('#ai-send');
      const model = document.querySelector('#ai-model-select');
      const h = hint.getBoundingClientRect();
      const s = send.getBoundingClientRect();
      const m = model.getBoundingClientRect();
      const style = getComputedStyle(hint);
      return {
        text: hint.textContent,
        overflow: style.overflow,
        whiteSpace: style.whiteSpace,
        hintBottom: h.bottom,
        sendTop: s.top,
        modelTop: m.top,
        intersectsSend: !(h.right <= s.left || h.left >= s.right || h.bottom <= s.top || h.top >= s.bottom),
        intersectsModel: !(h.right <= m.left || h.left >= m.right || h.bottom <= m.top || h.top >= m.bottom),
      };
    });
    expect(pickerUi.text).not.toContain(pick);
    expect(pickerUi.text).not.toContain('nvidia/');
    expect(pickerUi.overflow).toBe('hidden');
    expect(pickerUi.whiteSpace).toBe('nowrap');
    expect(pickerUi.intersectsSend).toBe(false);
    expect(pickerUi.intersectsModel).toBe(false);
    expect(pickerUi.hintBottom).toBeLessThanOrEqual(pickerUi.sendTop + 1);

    // 4. Esc closes the panel.
    await win.focus('#ai-input');
    await win.keyboard.press('Escape');
    await expect(win.locator('#ai-sidebar')).toBeHidden();

    // 5. Keyboard-only path: open -> ask -> answer. The streamed reply
    //    carries a reasoning channel + sentinels + markdown: the channel and
    //    tokens must never surface, and the bold must render as bold.
    mock.reply = '<|channel>thought hidden reasoning <channel|>**Bold** answer with <bos>tokens gone';
    await win.keyboard.press('Control+Shift+A');
    await expect(win.locator('#ai-sidebar')).toBeVisible({ timeout: 10000 });
    await win.fill('#ai-input', 'Say hi');
    await win.press('#ai-input', 'Enter');
    await expect(win.locator('#ai-messages')).toContainText('Bold answer with tokens gone', { timeout: 30000 });
    const leaked = await win.evaluate(() => document.querySelector('#ai-messages').innerText);
    expect(leaked).not.toContain('hidden reasoning');
    expect(leaked).not.toContain('<bos>');
    expect(await win.locator('#ai-messages strong').count()).toBeGreaterThan(0);

    // 6. The reply meta shows tokens, never a model name. Scoped to the thread:
    //    the composer's model picker names models on purpose (it is a picker),
    //    the conversation itself must not.
    const threadText = await win.evaluate(() => document.querySelector('#ai-messages').innerText);
    expect(threadText).not.toMatch(/nemotron|gemma|gpt-oss|lightning/i);
    await expect(win.locator('#ai-messages')).toContainText('in ·');

    // 7. The reasoning channel is available on demand (Thinking), never inline.
    expect(await win.locator('#ai-messages .ai-think').count()).toBeGreaterThan(0);
    await win.locator('#ai-messages .ai-think summary').first().click();
    await expect(win.locator('#ai-messages .ai-think-body').first()).toContainText('hidden reasoning');

    // 8. /help lists the skills; / and @ open their menus.
    await win.fill('#ai-input', '/help');
    await win.press('#ai-input', 'Enter');
    await expect(win.locator('#ai-messages')).toContainText('Read the page', { timeout: 10000 });
    await expect(win.locator('#ai-messages')).toContainText('Tier 1 asks once per chat');
    await win.fill('#ai-input', '/');
    await expect(win.locator('#ai-pop-menu')).toBeVisible({ timeout: 10000 });
    await expect(win.locator('#ai-pop-menu .ai-pop-row').first()).toBeVisible();
    await win.press('#ai-input', 'Escape');
    await expect(win.locator('#ai-pop-menu')).toBeHidden();
    await win.fill('#ai-input', '@');
    await expect(win.locator('#ai-pop-menu')).toContainText('Open tabs', { timeout: 10000 });
    await win.fill('#ai-input', '');

    // A snapshot for the visual review pass (captured, not just eyeballed).
    await win.screenshot({ path: 'test-results/sidebar-taskbar.png' });
  } finally {
    await app.close().catch(() => {});
    await mock.close();
  }
});
