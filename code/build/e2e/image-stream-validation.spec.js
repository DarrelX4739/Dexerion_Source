'use strict';
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const { test, expect } = require('@playwright/test');
const { startAiMock } = require('./ai-mock');
const { launchDexerion } = require('./app');

const NOTE = 'Synthetic first view; no user-facing reply yet.';
const ANSWER = 'Both synthetic attachments arrived in order.';
const payloadHash = data => ({ length: data.length, digest: createHash('sha256').update(data).digest('hex') });
const imagesOf = body => (body.messages || []).flatMap(message => Array.isArray(message.content)
  ? message.content.filter(part => part.type === 'image_url').map(part => part.image_url.url) : []);

test('real file attachments retain the exact uploaded bytes and ordinary two-leg answer', async () => {
  const mock = await startAiMock({ replyFor: body => body.max_tokens === 300 ? NOTE : ANSWER });
  let launched;
  try {
    launched = await launchDexerion({ aiBase: mock.url });
    const { win } = launched;
    await win.evaluate(async () => {
      await window.dexerion.invoke('dex:ai-key-set', 'nvapi-e2e-attachment-validation');
      await window.dexerion.invoke('dex:ai-open');
    });
    await expect(win.locator('#ai-sidebar:not([hidden])')).toBeVisible();
    await expect(win.locator('#ai-setup')).toBeHidden();

    const images = await win.evaluate(() => [23, 417].map(seed => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 160;
      const ctx = canvas.getContext('2d');
      const pixels = ctx.createImageData(canvas.width, canvas.height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        pixels.data.set([seed & 255, (seed >>> 8) & 255, (seed >>> 16) & 255, 255], i);
      }
      ctx.putImageData(pixels, 0, 0);
      return canvas.toDataURL('image/png').split(',')[1];
    }));
    await win.locator('#ai-files').setInputFiles(images.map((bytes, i) => ({
      name: 'synthetic-' + (i+1) + '.png', mimeType: 'image/png', buffer: Buffer.from(bytes, 'base64'),
    })));
    const thumbnails = win.locator('#ai-pending img');
    await expect(thumbnails).toHaveCount(2);
    const attached = await thumbnails.evaluateAll(nodes => nodes.map(image => image.src));
    expect(attached.every(url => url.startsWith('data:image/jpeg;base64,') && url.length > 4096)).toBe(true);
    expect(attached[0]).not.toBe(attached[1]);
    const expected = attached.map(payloadHash);
    await win.fill('#ai-input', 'Compare these two fictional texture samples.');
    await win.press('#ai-input', 'Enter');
    await expect(win.locator('#ai-messages')).toContainText(ANSWER, { timeout: 30000 });
    await expect(win.locator('#ai-messages')).not.toContainText(NOTE);
    const sent = mock.requests.map(request => request.body).filter(body => body.stream && imagesOf(body).length);
    expect(sent.length).toBe(2);
    expect(sent.map(body => imagesOf(body).map(payloadHash))).toEqual([[expected[0]], [expected[1]]]);
    expect(sent[0].max_tokens).toBe(300);
    expect(JSON.stringify(sent[1].messages)).toContain(NOTE);
  } finally {
    try { if (launched) await launched.app.close(); } finally {
      await mock.close();
      if (launched) await fs.rm(launched.profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
    }
  }
});
