'use strict';
// Search With Dexerion AI, end to end against the local mock:
//   - the surface shows difficulty only (no model picker, no model names),
//   - retrieval goes through the structured provider fixture (no SERP tab),
//   - engine/consent results in the fixture are dropped before reading,
//   - the answer is written from pages that were actually read (local article),
//   - the stored sources contain no search/consent host,
//   - the difficulty choice persists per account.

const { test, expect } = require('@playwright/test');
const { startAiMock } = require('./ai-mock');
const { launchDexerion } = require('./app');

test('search reads result pages, cites them, and shows difficulty only', async () => {
  const mock = await startAiMock({});
  const searchBase = mock.url.replace(/\/v1$/, '');
  mock.replyFor = (body) => {
    const blob = Array.isArray(body.messages) ? body.messages.map((m) => String(m.content || '')).join('\n') : '';
    if (/search planner/i.test(blob)) {
      return JSON.stringify({ queries: ['example domain article'] });
    }
    if (/report writer/i.test(blob)) {
      return '```dex-artifact\n' + JSON.stringify({
        kind: 'report',
        title: 'Example Domain Research',
        subtitle: 'What the example domain is for',
        summary: 'The example domain is reserved for documentation examples; it is maintained by IANA.',
        theme: 'clean',
        blocks: [
          { type: 'callout', label: 'Bottom line', text: 'It is a reserved documentation domain [1].' },
          { type: 'heading', text: '1. Overview', level: 2 },
          { type: 'paragraph', text: 'The example domain is set aside for use in examples [1].' },
          { type: 'heading', text: '2. What to do next', level: 2 },
          { type: 'paragraph', text: 'Use it in documentation instead of a real site [1].' },
        ],
        references: [{ title: 'Example Domain', url: 'https://example.com' }],
      }) + '\n```';
    }
    if (/Dexerion AI Search/i.test(blob)) {
      return 'The article explains the example domain [1].';
    }
    return 'ok';
  };
  const { app, win } = await launchDexerion({
    aiBase: mock.url,
    env: { DEX_SEARCH_BASE: searchBase, DEX_SEARCH_ALLOW_PRIVATE: '1' },
  });
  try {
    await win.evaluate(async () => {
      await window.dexerion.invoke('dex:ai-key-set', 'nvapi-e2e-search-key');
    });

    // The surface shows difficulty only: the chip exists, the old model
    // picker is gone, and no model name appears anywhere on the surface.
    await win.evaluate(() => window.dexerion.invoke('dex:aisearch-open'));
    await win.waitForSelector('#ais:not([hidden])', { timeout: 15000 });
    await expect(win.locator('#ais-difficulty')).toBeVisible();
    await expect(win.locator('#ais-difficulty .ais-diff')).toHaveCount(4);
    await expect(win.locator('#ais-model')).toHaveCount(0);
    const surfaceText = await win.evaluate(() => document.querySelector('#ais').innerText);
    expect(surfaceText).not.toMatch(/nemotron|gemma|gpt-oss|lightning/i);

    // Run the search; the mock plans one query and stream-writes the answer.
    await win.fill('#ais-input', 'what is the example domain');
    await win.press('#ais-input', 'Enter');
    await expect(win.locator('#ais-msgs')).toContainText('example domain [1]', { timeout: 60000 });

    // The live working list settles into the same ordered, collapsed Actions
    // disclosure when the answer completes.
    const actions = win.locator('#ais-msgs .ais-actions');
    const disclosure = actions.locator('summary');
    await expect(disclosure).toHaveText(/^Actions \(\d+\)$/);
    await expect(actions).not.toHaveAttribute('open', '');
    await disclosure.click();
    const labels = actions.locator('.ais-step-label');
    await expect(labels.first()).toHaveText('Adapting your question');
    await expect(labels.last()).toHaveText('Writing the answer');

    // Retrieval went through the structured provider fixture, never a SERP tab.
    expect(mock.fetches.some((u) => u.startsWith('/html/'))).toBe(true);

    // The sources saved with the answer are only pages that were actually
    // read — the engine and consent results from the fixture were dropped.
    const sources = await win.evaluate(async () => {
      const list = await window.dexerion.invoke('dex:ai-chats-list');
      if (!Array.isArray(list) || !list.length) return null;
      const chat = await window.dexerion.invoke('dex:ai-chat-open', list[0].id);
      const last = chat && Array.isArray(chat.messages) ? chat.messages[chat.messages.length - 1] : null;
      return last && last.search ? last.search.sources : null;
    });
    expect(Array.isArray(sources)).toBe(true);
    expect(sources.length).toBeGreaterThanOrEqual(1);
    for (const source of sources) {
      expect(String(source.url)).toContain('127.0.0.1');
      expect(String(source.url)).not.toMatch(/google|consent|yahoo/i);
    }

    // The grounded findings can be turned into a finished report. The action
    // uses the same report writer and lands in the same document viewer.
    await expect(win.locator('#ais-msgs .ais-to-report')).toHaveCount(1);
    await win.click('#ais-msgs .ais-to-report');
    await expect(win.locator('#ais-msgs .ais-to-report')).toHaveText(/View report/, { timeout: 60000 });
    const report = await win.evaluate(async () => {
      const list = await window.dexerion.invoke('dex:ai-chats-list');
      for (const item of list) {
        const chat = await window.dexerion.invoke('dex:ai-chat-open', item.id);
        const found = (chat.messages || []).find((m) => m && m.artifact && m.artifact.kind === 'report');
        if (found) return found.artifact;
      }
      return null;
    });
    expect(report).not.toBeNull();
    expect(String(report.title)).toContain('Example Domain');
    expect(Array.isArray(report.blocks) && report.blocks.length).toBeGreaterThanOrEqual(3);

    // The chip persists the tier (the scout owns the model; nothing else).
    await win.click('#ais-difficulty .ais-diff[data-tier="high"]');
    await expect(win.locator('#ais-difficulty .ais-diff[data-tier="high"]')).toHaveClass(/on/);
    const saved = await win.evaluate(() => window.dexerion.invoke('dex:ai-difficulty-get'));
    expect(saved.difficulty).toBe('high');
  } finally {
    await app.close().catch(() => {});
    await mock.close();
  }
});
