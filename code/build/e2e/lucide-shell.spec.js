'use strict';
// The expected DOM geometry is derived from the full original bundle's own
// helpers and current shell markup. Test the shipped visible shell, not just
// a hand-built DOM, plus the real report-card path which uses a detached icon.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const { startAiMock } = require('./ai-mock');
const { launchDexerion } = require('./app');
const { upstreamFixture } = require('../scripts/lucide-shell-oracle.cjs');

const REPORT = ['```dex-artifact', JSON.stringify({
  kind: 'report', title: 'Lucide geometry fixture', summary: 'Three reference observations.',
  blocks: [{ type: 'heading', text: '1. Evidence', level: 2 },
    { type: 'paragraph', text: 'The report card uses the ellipsis geometry from the original build.' }],
}), '```'].join('\n');

function svgShapes(elements) {
  const read = node => ({ namespace: node.namespaceURI, tag: node.localName,
    attrs: Object.fromEntries([...node.attributes].map(attr => [attr.name, attr.value])),
    children: [...node.children].map(read) });
  return elements.map(read);
}

test('the current visible shell and report card preserve Lucide geometry and accessible names', async ({}, testInfo) => {
  const reference = upstreamFixture();
  const mode = process.env.DEX_LUCIDE_DIAGNOSTIC_EXPECT || 'subset';
  const mock = await startAiMock({ reply: REPORT });
  let launched;
  try {
    launched = await launchDexerion({ aiBase: mock.url });
    const { win } = launched;
    const shown = win.locator('#ai-sidebar:not([hidden])');
    await win.evaluate(async () => {
      await window.dexerion.invoke('dex:ai-key-set', 'nvapi-e2e-lucide-geometry');
      await window.dexerion.invoke('dex:ai-open');
    });
    await expect(shown).toBeVisible();
    await expect(win.locator('#ai-setup')).toBeHidden();
    await expect(win.locator('svg[data-lucide]')).toHaveCount(reference.static.length);
    const icons = await win.locator('svg[data-lucide]').evaluateAll(svgShapes);
    expect(icons).toEqual(reference.static);
    const bundle = await win.evaluate(() => ({ iconCount: Object.keys(window.lucide.icons).length,
      loaded: Array.from(document.scripts).map(s=>s.src).filter(s=>/\/lucide[^/]*\.js$/.test(s)).map(s=>s.split('/').at(-1)) }));
    expect(bundle.loaded).toEqual([mode === 'subset' ? 'lucide-shell.js' : 'lucide.min.js']);
    if (mode === 'subset') expect(bundle.iconCount).toBeLessThan(reference.registryCount / 20);
    else expect(bundle.iconCount).toBe(reference.registryCount);
    const newChat = shown.getByRole('button', { name: 'New chat', exact: true });
    const history = shown.getByRole('button', { name: 'Open chat history', exact: true });
    await expect(newChat.locator('svg')).toBeVisible();
    await expect(history.locator('svg')).toBeVisible();
    const bbox = await newChat.locator('svg').boundingBox();
    expect(bbox.width).toBeGreaterThan(0);
    expect(bbox.height).toBeGreaterThan(0);
    await win.fill('#ai-input', 'Create a report titled Lucide geometry fixture.');
    await win.press('#ai-input', 'Enter');
    const card = win.locator('#ai-messages .dxa-card[data-kind="report"]').last();
    await expect(card).toBeVisible({ timeout: 30000 });
    const more = card.getByRole('button', { name: 'More actions', exact: true });
    await expect(more.locator('svg')).toBeVisible();
    expect(await more.locator('svg').evaluateAll(svgShapes)).toEqual([reference.detached[0]]);
    // Compare the same painted state, not two arbitrary frames of the card
    // entrance transition. These Playwright capture options do not edit CSS.
    await expect(win.locator('#ai-send')).toHaveAttribute('aria-label', 'Send');
    await win.evaluate(() => document.fonts.ready.then(() => true));
    await win.screenshot({ path: testInfo.outputPath('lucide-shell-fixture.png'), animations: 'disabled', caret: 'hide' });
  } finally {
    try { if (launched) await launched.app.close(); } finally {
      await mock.close();
      if (launched) await fs.rm(launched.profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
    }
  }
});
