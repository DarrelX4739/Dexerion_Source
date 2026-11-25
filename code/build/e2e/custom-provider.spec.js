'use strict';
// Custom OpenAI-compatible endpoints must be probed on the Base URL the user
// saved — not silently against NVIDIA. This regression locks that in.

const { test, expect } = require('@playwright/test');
const { startAiMock } = require('./ai-mock');
const { launchDexerion } = require('./app');

test('a custom Base URL is used for model loading, testing and verification', async () => {
  const defaultMock = await startAiMock({ reply: 'unused' });
  const customMock = await startAiMock({
    reply: 'Custom endpoint reply.',
    models: ['custom/model-a'],
  });
  const { app, win } = await launchDexerion({ aiBase: defaultMock.url });
  try {
    await win.evaluate(async (baseUrl) => {
      await window.dexerion.invoke('dex:ai-key-set', 'custom-e2e-key');
      await window.dexerion.invoke('dex:ai-baseurl-set', baseUrl);
    }, customMock.url);

    const refreshed = await win.evaluate(async () => window.dexerion.invoke('dex:ai-models-refresh'));
    expect(refreshed.ok, refreshed.error || '').toBe(true);

    const tested = await win.evaluate(async () => window.dexerion.invoke('dex:ai-test'));
    expect(tested.ok, tested.error || '').toBe(true);

    const modelSeen = [].concat(refreshed.models || [], refreshed.allModels || [])
      .some((m) => m && (m === 'custom/model-a' || m.id === 'custom/model-a'));
    expect(modelSeen, JSON.stringify(refreshed).slice(0, 400)).toBe(true);
    expect(customMock.requests.some((r) => r.url.includes('/v1/chat/completions'))).toBe(true);

    const wrongPage = await win.evaluate(async () => {
      await window.dexerion.invoke('dex:ai-baseurl-set', 'https://console.groq.com/keys');
      return window.dexerion.invoke('dex:ai-test');
    });
    expect(wrongPage.ok).toBe(false);
    expect(String(wrongPage.error || '')).toContain('key/console page');
    expect(String(wrongPage.error || '')).not.toContain('datagrail');

    await win.evaluate(async (baseUrl) => window.dexerion.invoke('dex:ai-baseurl-set', baseUrl), customMock.url);
    const verified = await win.evaluate(async () => window.dexerion.invoke('dex:ai-model-set', 'custom/model-a'));
    expect(verified.ok, verified.error || verified.warning || '').toBe(true);
    expect(customMock.requests.some((r) => r.body && r.body.model === 'custom/model-a')).toBe(true);
  } finally {
    await app.close().catch(() => {});
    await defaultMock.close();
    await customMock.close();
  }
});
