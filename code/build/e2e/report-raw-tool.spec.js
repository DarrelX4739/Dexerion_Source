'use strict';
// Regression: after several web searches Nemotron can emit a raw XML tool
// call for make_report, sometimes in the same reply as the last search and
// with the finished report as the call arguments. The skill loop must run the
// queued report proposal, validate its payload, and never leak the XML or
// create a card titled "<tool_call> ...".

const { test, expect } = require('@playwright/test');
const { startAiMock } = require('./ai-mock');
const { launchDexerion } = require('./app');

const REPORT = {
  kind: 'report',
  title: 'Raw tool call report',
  subtitle: 'comparison',
  theme: 'clean',
  blocks: [
    { type: 'callout', label: 'Bottom line', text: 'The report was built from the tool payload.' },
    { type: 'paragraph', text: 'Three searches supplied the evidence.' },
  ],
};

function searchFence(n) {
  return '```dex-skill\n' + JSON.stringify({
    skill: 'search_web',
    args: { query: 'example domain article ' + n, mode: 'quick' },
    why: 'research step ' + n,
  }) + '\n```';
}

function rawReportCall() {
  return '<toolcall> <function=make_report> '
    + '<parameter=title> ' + REPORT.title + ' </parameter> '
    + '<parameter=subtitle> ' + REPORT.subtitle + ' </parameter> '
    + '<parameter=theme> ' + REPORT.theme + ' </parameter> '
    + '<parameter=blocks> ' + JSON.stringify(REPORT.blocks) + ' </parameter> '
    + '</toolcall>';
}

test('raw tool calls after web searches build a valid report instead of leaking', async () => {
  const mock = await startAiMock({});
  const searchBase = mock.url.replace(/\/v1$/, '');
  mock.replyFor = (body) => {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const all = messages.map((m) => String((m && m.content) || '')).join('\n');
    // The search pipeline asks for a structured query plan first.
    if (/search planner/i.test(all)) return JSON.stringify({ queries: ['example domain article'] });
    const conversation = messages
      .filter((m) => m && m.role !== 'system')
      .map((m) => String(m.content || '')).join('\n');
    if (conversation.includes('three types of internet')) {
      const done = (conversation.match(/<skill-result skill="search_web"/g) || []).length;
      if (done === 0) return searchFence(1);
      if (done === 1) return searchFence(2);
      if (done === 2) {
        // Nemotron sometimes repeats the finished call. Both are parsed, but
        // the build must be shown and recorded once.
        return 'I have enough source material to build the report.\n\n'
          + searchFence(3) + '\n' + rawReportCall() + '\n' + rawReportCall();
      }
    }
    return 'Done.';
  };

  const { app, win } = await launchDexerion({
    aiBase: mock.url,
    env: { DEX_SEARCH_BASE: searchBase, DEX_SEARCH_ALLOW_PRIVATE: '1' },
  });
  try {
    await win.evaluate(async () => {
      await window.dexerion.invoke('dex:ai-key-set', 'nvapi-e2e-raw-tool-key');
    });
    await win.evaluate(() => window.dexerion.invoke('dex:ai-open'));
    await win.waitForSelector('#ai-sidebar:not([hidden])', { timeout: 15000 });

    await win.fill('#ai-input', 'Write me a report on the three types of internet. Search the web three times first.');
    await win.press('#ai-input', 'Enter');

    // Three search consents; the queued make_report consent follows the third.
    for (let i = 0; i < 4; i += 1) {
      await win.waitForSelector('#ai-ask:not([hidden])', { timeout: 30000 });
      const label = await win.locator('#ai-ask-what').innerText();
      expect(label).toMatch(/web search|make a report/i);
      await win.click('#ai-ask-yes');
    }
    await win.waitForFunction(() => {
      const b = document.querySelector('#ai-send');
      return b && !b.disabled;
    }, { timeout: 60000 });

    const stored = await win.evaluate(async () => {
      const list = await window.dexerion.invoke('dex:ai-chats-list');
      const chat = await window.dexerion.invoke('dex:ai-chat-open', list[0].id);
      const last = chat && Array.isArray(chat.messages) ? chat.messages[chat.messages.length - 1] : null;
      return {
        text: String((last && last.text) || ''),
        artifact: last && last.artifact ? last.artifact : null,
        steps: (last && Array.isArray(last.steps)) ? last.steps : [],
        log: await window.dexerion.invoke('dex:ai-skill-log'),
      };
    });

    expect(stored.artifact).not.toBeNull();
    expect(stored.artifact.kind).toBe('report');
    expect(stored.artifact.title).toBe(REPORT.title);
    expect(String(stored.artifact.blocks[0].text)).toContain('tool payload');
    expect(stored.text).not.toMatch(/<tool_?calls?|<function=|<parameter=/i);
    expect(stored.artifact.title).not.toMatch(/<tool_?calls?|<function=|<parameter=/i);

    // One visible build row even though the model emitted the call twice.
    expect(stored.steps.filter((s) => s.name === 'make_report').length).toBe(1);
    expect(stored.steps.find((s) => s.name === 'make_report').status).toBe('ok');

    const reportRows = stored.log.filter((row) => row.skill === 'make_report');
    expect(reportRows.length).toBe(1);
    expect(reportRows[0].ok).toBe(true);
    expect(reportRows[0].args).toContain('"preset":"standard"');
    expect(reportRows[0].args).toContain('"shape":"comparison"');
    expect(reportRows[0].args).toContain('"theme":"clean"');
    expect(stored.log.filter((row) => row.skill === 'search_web' && row.ok).length).toBe(3);

    // The structured provider was used (later identical queries may be cached
    // by the app, so the fetch count itself is not the step counter).
    expect(mock.fetches.some((u) => u.startsWith('/html/'))).toBe(true);
  } finally {
    await app.close().catch(() => {});
    await mock.close();
  }
});
