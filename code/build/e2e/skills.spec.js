'use strict';
// The skill loop, end to end through the real sidebar:
//   proposal -> consent card -> executor -> result -> answer,
//   denial continues without the skill,
//   "Always in this chat" skips the next ask for that tier-1 skill,
//   tier 2 asks again every single time,
//   and the audit ring records every outcome.
//
// The mock NIM proposes a dex-skill fence for marker phrases and answers
// "Understood." once that proposal's outcome has been fed back.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { startAiMock } = require('./ai-mock');
const { launchDexerion } = require('./app');

const REPORT_ARTIFACT = {
  kind: 'report',
  title: 'E2E report',
  summary: 'A short report.',
  blocks: [{ type: 'paragraph', text: 'Body from the conversation.' }],
  theme: 'clean',
};

// Note the phrasing: "remember ..." / "forget ..." sentences are answered by
// the legacy local memory-command path and never reach the model, so the
// skill-proposal phrases deliberately avoid those keywords.
const PROPOSALS = [
  { marker: 'my dog is Rex', skill: 'remember', args: { fact: 'my dog is Rex' }, why: 'you asked me to keep it in mind' },
  { marker: 'drop the dog from your notes', skill: 'forget', args: { query: 'my dog' }, why: 'you asked me to drop it' },
  { marker: 'my cat is Mimi', skill: 'remember', args: { fact: 'my cat is Mimi' }, why: '' },
  { marker: 'my bird is Kiki', skill: 'remember', args: { fact: 'my bird is Kiki' }, why: '' },
  { marker: 'act on the page for me', skill: 'agent', args: { goal: 'click the thing' }, why: 'you asked me to act' },
  { marker: 'build me a report', skill: 'make_report', args: { preset: 'brief' }, why: 'you asked for one' },
  { marker: 'export it as markdown', skill: 'export_report', args: { format: 'md' }, why: 'you asked for the file' },
  { marker: 'fresh conversation for me', skill: 'new_chat', args: {}, why: 'you asked for a clean slate' },
];

test('skills propose, ask, run, deny, and remember consent', async () => {
  const mock = await startAiMock({});
  mock.replyFor = (body) => {
    // Case-insensitive: the person's own wording rides through unchanged. The
    // system message is excluded: it carries the finished-deliverable protocol,
    // whose example JSON already contains `"kind":"report"`, and a mock that
    // counted it would conclude the model had written a report already.
    const blob = Array.isArray(body.messages)
      ? body.messages
        .filter((m) => m && m.role !== 'system')
        .map((m) => String(m.content || '')).join('\n').toLowerCase()
      : '';
    // After the make_report arming note, the model writes the report itself.
    if (blob.includes('<skill-result skill="make_report"') && !blob.includes('"kind":"report"')) {
      return 'Here is the report.\n\n```dex-artifact\n' + JSON.stringify(REPORT_ARTIFACT) + '\n```';
    }
    // The newest marker mention across all phrases wins; then, only if no
    // outcome note follows it yet, propose. (Within one send the loop quotes
    // the outcome note back; across sends it does not exist in the chat, so
    // the "latest mention" rule keeps older markers from re-firing.)
    let best = null;
    let bestAt = -1;
    for (const entry of PROPOSALS) {
      const at = blob.lastIndexOf(entry.marker.toLowerCase());
      if (at > bestAt) { bestAt = at; best = entry; }
    }
    if (best) {
      const rest = blob.slice(bestAt);
      if (!/skill-(?:result|denied|note)/.test(rest)) {
        return '```dex-skill\n' + JSON.stringify({ skill: best.skill, args: best.args, why: best.why }) + '\n```';
      }
    }
    return 'Understood.';
  };
  const { app, win } = await launchDexerion({ aiBase: mock.url });
  try {
    await win.evaluate(async () => {
      await window.dexerion.invoke('dex:ai-key-set', 'nvapi-e2e-skills-key');
    });
    await win.evaluate(() => window.dexerion.invoke('dex:ai-open'));
    await win.waitForSelector('#ai-sidebar:not([hidden])', { timeout: 15000 });

    const idle = () => win.waitForFunction(() => {
      const b = document.querySelector('#ai-send');
      return b && !b.disabled;
    }, { timeout: 60000 });
    const send = async (text) => {
      await win.fill('#ai-input', text);
      await win.press('#ai-input', 'Enter');
    };
    const memory = () => win.evaluate(() => window.dexerion.invoke('dex:ai-memory-list'));

    // 1. Tier 1, allow once: the card appears, the executor really runs
    //    (the fact lands in the persisted memory), and the step row shows.
    await send('My dog is Rex, please keep that in mind');
    await win.waitForSelector('#ai-ask:not([hidden])', { timeout: 30000 });
    await expect(win.locator('#ai-ask-what')).toContainText('Remember this');
    await win.click('#ai-ask-yes');
    await idle();
    expect((await memory()).some((f) => f.text === 'my dog is Rex')).toBe(true);
    await expect(win.locator('#ai-messages')).toContainText('Run Remember this');

    // 2. Denial: the skill is skipped, the model continues, nothing changed.
    await send('Please drop the dog from your notes');
    await win.waitForSelector('#ai-ask:not([hidden])', { timeout: 30000 });
    await win.click('#ai-ask-no');
    await idle();
    expect((await memory()).some((f) => f.text === 'my dog is Rex')).toBe(true);
    await expect(win.locator('#ai-messages')).toContainText('Skipped Forget this');

    // 3. "Always in this chat": the grant skips the next ask entirely — the
    //    second remember completes with no click at all.
    await send('A note for you: my cat is Mimi');
    await win.waitForSelector('#ai-ask:not([hidden])', { timeout: 30000 });
    await win.click('#ai-ask-always');
    await idle();
    expect((await memory()).some((f) => f.text === 'my cat is Mimi')).toBe(true);
    await send('Another note: my bird is Kiki');
    await idle();
    expect((await memory()).some((f) => f.text === 'my bird is Kiki')).toBe(true);
    await expect(win.locator('#ai-ask')).toBeHidden();

    // 4. Tier 2 asks again every single time: two sends, two cards.
    await send('Please act on the page for me');
    await win.waitForSelector('#ai-ask:not([hidden])', { timeout: 30000 });
    await expect(win.locator('#ai-ask-what')).toContainText('Act on the page');
    await win.click('#ai-ask-no');
    await idle();
    await send('Please act on the page for me again');
    await win.waitForSelector('#ai-ask:not([hidden])', { timeout: 30000 });
    await win.click('#ai-ask-no');
    await idle();

    // 5. make_report arms the request; the model's next reply carries the
    //    dex-artifact block, which the artifact pipeline stores (and strips
    //    from the visible text).
    await send('Please build me a report from what we discussed');
    await win.waitForSelector('#ai-ask:not([hidden])', { timeout: 30000 });
    await expect(win.locator('#ai-ask-what')).toContainText('Make a report');
    await win.click('#ai-ask-yes');
    await idle();
    const made = await win.evaluate(async () => {
      const list = await window.dexerion.invoke('dex:ai-chats-list');
      const chat = await window.dexerion.invoke('dex:ai-chat-open', list[0].id);
      const last = chat && Array.isArray(chat.messages) ? chat.messages[chat.messages.length - 1] : null;
      return {
        hasArtifact: Boolean(last && last.artifact && last.artifact.kind === 'report'),
        title: last && last.artifact ? last.artifact.title : '',
        text: String((last && last.text) || ''),
      };
    });
    expect(made.hasArtifact).toBe(true);
    expect(made.title).toBe('E2E report');
    expect(made.text).not.toContain('dex-artifact');

    // 6. export_report writes the open report to disk (DEX_AI_TEST path).
    await send('Please export it as markdown');
    await win.waitForSelector('#ai-ask:not([hidden])', { timeout: 30000 });
    await expect(win.locator('#ai-ask-what')).toContainText('Export the report');
    await win.click('#ai-ask-yes');
    await idle();
    const exported = fs.readFileSync(path.join(os.tmpdir(), 'dex-skill-export.md'), 'utf8');
    expect(exported).toContain('E2E report');

    // 7. A surface executor really acts: new_chat adds and persists a chat.
    const chatsBefore = await win.evaluate(async () => (await window.dexerion.invoke('dex:ai-chats-list')).length);
    await send('Please start a fresh conversation for me');
    await win.waitForSelector('#ai-ask:not([hidden])', { timeout: 30000 });
    await expect(win.locator('#ai-ask-what')).toContainText('New chat');
    await win.click('#ai-ask-yes');
    await idle();
    const chatsAfter = await win.evaluate(async () => (await window.dexerion.invoke('dex:ai-chats-list')).length);
    expect(chatsAfter).toBe(chatsBefore + 1);

    // 8. The audit ring recorded every decision and outcome.
    const log = await win.evaluate(() => window.dexerion.invoke('dex:ai-skill-log'));
    expect(log.some((r) => r.skill === 'remember' && r.decision === 'once' && r.ok === true)).toBe(true);
    expect(log.some((r) => r.skill === 'remember' && r.decision === 'always' && r.ok === true)).toBe(true);
    expect(log.some((r) => r.skill === 'forget' && r.decision === 'deny' && r.ok === false)).toBe(true);
    expect(log.filter((r) => r.skill === 'agent' && r.decision === 'deny').length).toBe(2);
    expect(log.some((r) => r.skill === 'new_chat' && r.decision === 'once' && r.ok === true)).toBe(true);
  } finally {
    await app.close().catch(() => {});
    await mock.close();
  }
});
