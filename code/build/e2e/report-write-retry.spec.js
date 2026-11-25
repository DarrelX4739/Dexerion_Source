'use strict';
// A report build is one visible step. If the model answers the arming turn
// with prose instead of the dex-artifact block, the loop nudges it once in the
// same run; it must not add another "Run Make a report" row or ask again.

const { test, expect } = require('@playwright/test');
const { startAiMock } = require('./ai-mock');
const { launchDexerion } = require('./app');

const ARTIFACT = {
  kind: 'report',
  title: 'Retry report',
  summary: 'Written after the nudge.',
  blocks: [{ type: 'paragraph', text: 'The artifact landed on the retried write turn.' }],
  theme: 'clean',
};

test('a missing report artifact is retried inside the same single run', async () => {
  const mock = await startAiMock({});
  let writeTurns = 0;
  mock.replyFor = (body) => {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const blob = messages
      .filter((m) => m && m.role !== 'system')
      .map((m) => String(m.content || ''))
      .join('\n');
    if (blob.includes('<skill-result skill="make_report"') && !blob.includes('"kind":"report"')) {
      writeTurns += 1;
      if (writeTurns === 1) return 'I am about to write the report now.';
      return '```dex-artifact\n' + JSON.stringify(ARTIFACT) + '\n```';
    }
    if (/build me a report/i.test(blob) && !/skill-(?:result|denied|note)/.test(blob)) {
      return '```dex-skill\n' + JSON.stringify({ skill: 'make_report', args: { preset: 'standard' } }) + '\n```';
    }
    return 'Done.';
  };

  const { app, win } = await launchDexerion({ aiBase: mock.url });
  try {
    await win.evaluate(async () => {
      await window.dexerion.invoke('dex:ai-key-set', 'nvapi-e2e-write-retry-key');
    });
    await win.evaluate(() => window.dexerion.invoke('dex:ai-open'));
    await win.waitForSelector('#ai-sidebar:not([hidden])', { timeout: 15000 });

    await win.fill('#ai-input', 'Please build me a report');
    await win.press('#ai-input', 'Enter');
    await win.waitForSelector('#ai-ask:not([hidden])', { timeout: 30000 });
    await expect(win.locator('#ai-ask-what')).toContainText('Make a report');
    await win.click('#ai-ask-yes');
    await win.waitForFunction(() => {
      const b = document.querySelector('#ai-send');
      return b && !b.disabled;
    }, { timeout: 60000 });

    const saved = await win.evaluate(async () => {
      const list = await window.dexerion.invoke('dex:ai-chats-list');
      const chat = await window.dexerion.invoke('dex:ai-chat-open', list[0].id);
      const last = chat && Array.isArray(chat.messages) ? chat.messages[chat.messages.length - 1] : null;
      return {
        steps: (last && Array.isArray(last.steps)) ? last.steps : [],
        artifact: last && last.artifact ? last.artifact : null,
        log: await window.dexerion.invoke('dex:ai-skill-log'),
      };
    });

    expect(writeTurns).toBe(2);
    expect(saved.artifact).not.toBeNull();
    expect(saved.artifact.kind).toBe('report');
    expect(saved.artifact.title).toBe(ARTIFACT.title);
    expect(saved.steps.filter((s) => s.name === 'make_report').length).toBe(1);
    expect(saved.steps.find((s) => s.name === 'make_report').status).toBe('ok');
    expect(saved.log.filter((r) => r.skill === 'make_report').length).toBe(1);
  } finally {
    await app.close().catch(() => {});
    await mock.close();
  }
});

test('an empty model turn on an explicit report request still builds one report', async () => {
  const mock = await startAiMock({});
  mock.replyFor = (body) => {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const blob = messages
      .filter((m) => m && m.role !== 'system')
      .map((m) => String(m.content || ''))
      .join('\n');
    if (blob.includes('<skill-result skill="make_report"') && !blob.includes('"kind":"report"')) {
      return '```dex-artifact\n' + JSON.stringify(ARTIFACT) + '\n```';
    }
    // Nemotron sometimes thinks about the call but emits an empty turn.
    return '';
  };

  const { app, win } = await launchDexerion({ aiBase: mock.url });
  try {
    await win.evaluate(async () => {
      await window.dexerion.invoke('dex:ai-key-set', 'nvapi-e2e-empty-report-key');
    });
    await win.evaluate(() => window.dexerion.invoke('dex:ai-open'));
    await win.waitForSelector('#ai-sidebar:not([hidden])', { timeout: 15000 });

    await win.fill('#ai-input', 'Write me a report on three types of internet');
    await win.press('#ai-input', 'Enter');
    await win.waitForSelector('#ai-ask:not([hidden])', { timeout: 30000 });
    await expect(win.locator('#ai-ask-what')).toContainText('Make a report');
    await win.click('#ai-ask-yes');
    await win.waitForFunction(() => {
      const b = document.querySelector('#ai-send');
      return b && !b.disabled;
    }, { timeout: 60000 });

    const saved = await win.evaluate(async () => {
      const list = await window.dexerion.invoke('dex:ai-chats-list');
      const chat = await window.dexerion.invoke('dex:ai-chat-open', list[0].id);
      const last = chat && Array.isArray(chat.messages) ? chat.messages[chat.messages.length - 1] : null;
      return {
        steps: (last && Array.isArray(last.steps)) ? last.steps : [],
        artifact: last && last.artifact ? last.artifact : null,
        log: await window.dexerion.invoke('dex:ai-skill-log'),
      };
    });

    expect(saved.artifact).not.toBeNull();
    expect(saved.artifact.title).toBe(ARTIFACT.title);
    expect(saved.steps.filter((s) => s.name === 'make_report').length).toBe(1);
    expect(saved.log.filter((r) => r.skill === 'make_report').length).toBe(1);
  } finally {
    await app.close().catch(() => {});
    await mock.close();
  }
});
