'use strict';
// Report imagery is offline-only: the internal-page CSP allows data:/blob: but
// not http(s). This drives a REAL report through the mock model and inspects the
// rendered <img> in the standalone report overlay, proving an embedded image is
// no longer stripped by normalization or dropped by the renderer sanitizer.

const { test, expect } = require('@playwright/test');
const { startAiMock } = require('./ai-mock');
const { launchDexerion } = require('./app');

const DATA_URL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const REPORT_REPLY = [
  'Here is the report.',
  '```dex-artifact',
  JSON.stringify({
    kind: 'report',
    title: 'Image pipeline check',
    subtitle: 'Embedded offline imagery',
    summary: 'The report carries one embedded image.',
    theme: 'clean',
    blocks: [
      { type: 'heading', text: '1. Evidence', level: 2 },
      { type: 'image', src: DATA_URL, alt: 'One pixel test tile', caption: 'Embedded offline image' },
      { type: 'paragraph', text: 'The image is embedded as a data URL and must render without a network request.' },
    ],
    references: [{ title: 'Example', url: 'https://example.com' }],
  }),
  '```',
].join('\n');

test('report images survive normalization and render in the viewer', async () => {
  const mock = await startAiMock({ reply: REPORT_REPLY });
  const { app, win } = await launchDexerion({ aiBase: mock.url });
  try {
    await win.evaluate(async () => {
      await window.dexerion.invoke('dex:ai-key-set', 'nvapi-e2e-report-image-key');
      await window.dexerion.invoke('dex:ai-open');
    });
    await win.waitForSelector('#ai-sidebar:not([hidden])', { timeout: 20000 });
    await expect(win.locator('#ai-setup')).toBeHidden({ timeout: 20000 });

    await win.fill('#ai-input', 'Make a report with an image');
    await win.press('#ai-input', 'Enter');
    const card = win.locator('#ai-messages .dxa-card[data-kind="report"]').last();
    await expect(card).toBeVisible({ timeout: 30000 });
    // The chat card must also show the image (same sanitizer as the viewer).
    await expect(card.locator('.dxa-image img')).toHaveCount(1);

    await card.getByRole('button', { name: 'Open', exact: true }).click();

    const inReport = (js) => app.evaluate(async ({ webContents }, code) => {
      const wc = webContents.getAllWebContents()
        .find((w) => /^dexerion:\/\/report/.test(w.getURL() || ''));
      if (!wc) return null;
      return wc.executeJavaScript(code);
    }, js);

    const inspect = `(() => {
      const img = document.querySelector('.dxa-report .dxa-image img');
      if (!img) return { present: false };
      const r = img.getBoundingClientRect();
      return {
        present: true,
        complete: img.complete,
        naturalWidth: img.naturalWidth,
        srcPrefix: String(img.src).slice(0, 21),
        width: Math.round(r.width),
        height: Math.round(r.height),
        caption: document.querySelector('.dxa-report .dxa-image-cap')?.textContent || '',
        broken: document.querySelector('.dxa-report .dxa-image')?.classList.contains('dxa-image-error') || false,
      };
    })()`;
    await expect.poll(async () => inReport(inspect), { timeout: 20000 }).toEqual(
      expect.objectContaining({ present: true })
    );
    const image = await inReport(inspect);
    expect(image.present).toBe(true);
    expect(image.complete).toBe(true);
    expect(image.naturalWidth).toBe(1);
    expect(image.srcPrefix).toBe('data:image/gif;base64');
    expect(image.broken).toBe(false);
    expect(image.caption).toContain('Embedded offline image');
  } finally {
    await app.close().catch(() => {});
    await mock.close();
  }
});
