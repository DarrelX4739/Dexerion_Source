'use strict';
// The one-card capability flow: the model may ask, but only the person can
// switch a capability on. "Turn on" persists it for the account; "No" leaves
// it off. No new preload channel is involved — this rides the existing skill
// consent card and the normal dex:ai-skill / dex:ai-cap-decide bridge.

const { test, expect } = require('@playwright/test');
const { startAiMock } = require('./ai-mock');
const { launchDexerion } = require('./app');

const MARKER = 'please switch on agent mode for me';
const SKILL = 'enable_agent';

test('AI capability requests need one explicit Turn on', async () => {
  const mock = await startAiMock({});
  mock.replyFor = (body) => {
    const blob = Array.isArray(body.messages)
      ? body.messages.filter((m) => m && m.role !== 'system').map((m) => String(m.content || '')).join('\n').toLowerCase()
      : '';
    if (blob.includes('<skill-result skill="' + SKILL + '"')) return 'Understood.';
    if (blob.includes(MARKER) && !/skill-(?:result|denied|note)/.test(blob)) {
      return '```dex-skill\n' + JSON.stringify({ skill: SKILL, args: {}, why: 'you asked to turn on acting' }) + '\n```';
    }
    return 'Understood.';
  };
  const { app, win } = await launchDexerion({ aiBase: mock.url });
  const errors = [];
  win.on('pageerror', (err) => errors.push(String(err)));
  try {
    await win.evaluate(async () => {
      await window.dexerion.invoke('dex:ai-key-set', 'nvapi-e2e-capability-key');
    });
    await win.evaluate(() => window.dexerion.invoke('dex:ai-open'));
    await win.waitForSelector('#ai-sidebar:not([hidden])', { timeout: 15000 });

    const caps = () => win.evaluate(() => window.dexerion.invoke('dex:ai-caps-get'));
    const idle = () => win.waitForFunction(() => {
      const b = document.querySelector('#ai-send');
      return b && !b.disabled;
    }, { timeout: 60000 });
    const send = async () => {
      await win.fill('#ai-input', MARKER);
      await win.press('#ai-input', 'Enter');
    };

    expect((await caps()).agent).toBe(false);

    // 1. The model asks; the card is a single "Turn on" decision with no
    //    reusable "Always" option, and the switch stays off until we click.
    await send();
    await win.waitForSelector('#ai-ask:not([hidden])', { timeout: 30000 });
    await expect(win.locator('#ai-ask-what')).toContainText('Turn on Agent mode');
    await expect(win.locator('#ai-ask-yes')).toHaveText('Turn on');
    await expect(win.locator('#ai-ask-always')).toBeHidden();
    expect((await caps()).agent).toBe(false);
    await win.click('#ai-ask-yes');
    await idle();
    expect((await caps()).agent).toBe(true);
    await expect(win.locator('#ai-agent-toggle')).toHaveAttribute('aria-pressed', 'true');

    // 2. A denial is final for this ask: the switch stays exactly as it was.
    await win.click('#ai-agent-toggle');
    await win.waitForFunction(() => document.getElementById('ai-agent-toggle').getAttribute('aria-pressed') === 'false');
    await send();
    await win.waitForSelector('#ai-ask:not([hidden])', { timeout: 30000 });
    await win.click('#ai-ask-no');
    await idle();
    expect((await caps()).agent).toBe(false);
    await expect(win.locator('#ai-agent-toggle')).toHaveAttribute('aria-pressed', 'false');

    expect(errors).toEqual([]);
    console.log('AI CAPABILITY ASK PASS');
  } finally {
    await app.close().catch(() => {});
    await mock.close();
  }
});
