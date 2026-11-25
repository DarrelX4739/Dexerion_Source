'use strict';
// Agent mode on the Dexerion new tab.
//
// The new tab is a trusted Dexerion page, not hostile web content. These tests
// drive the real agent loop against the local NIM mock and prove it can use the
// page's own search field and starred tiles. They also pin the cleanup path:
// a finished, failed or stopped run must clear both the runbar and the taskbar
// "Working…" line. Every launch uses the throwaway-profile harness.
//
// Navigation is captured inside the new tab page instead of being allowed to
// hit the network: the assertion is about the agent operating the page's own
// controls, not about Google/Ookla being reachable from CI.

const { test, expect } = require('@playwright/test');
const { startAiMock } = require('./ai-mock');
const { launchDexerion } = require('./app');

const SEARCH_MARKER = 'search the web for zebras in zanzibar';
const SEARCH_TEXT = 'zebras in zanzibar';
const STAR_MARKER = 'open my starred ookla speed test';
const FAIL_MARKER = 'try a tool that does not exist';
const STOP_MARKER = 'wait on this page for a while';
const SPEEDTEST = 'https://www.speedtest.net/';

function tool(name, args) {
  return { name, args: args || {} };
}

function done(summary) {
  return { content: '', toolCalls: [{ name: 'done', args: { summary } }] };
}

// The agent formats snapshot results as "#<ref> <kind> \"<label>\"" lines.
// Find the ref by label so the test follows the page instead of hard-coding a
// DOM position that could move when the new tab changes.
function refFor(messages, needle) {
  const turns = messages.filter((m) => m && m.role === 'tool');
  const last = turns[turns.length - 1];
  const content = String((last && (last.content ||
    (Array.isArray(last.results) && last.results[0] && last.results[0].content))) || '');
  const line = content.split('\n').find((s) =>
    s.toLowerCase().includes(needle.toLowerCase()) && /#\d+/.test(s));
  const match = line && line.match(/#(\d+)/);
  return match ? Number(match[1]) : 0;
}

function toolTurns(messages) {
  return messages.filter((m) => m && m.role === 'tool').length;
}

async function findNewTab(app) {
  return app.evaluate(async ({ webContents }) =>
    webContents.getAllWebContents().find((w) => /^dexerion:\/\/newtab/.test(w.getURL() || ''))
      ? true
      : false);
}

async function navCalls(app) {
  return app.evaluate(() => globalThis.__dexNavCalls || []);
}

async function boot(mock, { bookmark = true } = {}) {
  const { app, win } = await launchDexerion({ aiBase: mock.url });
  const errors = [];
  win.on('pageerror', (err) => errors.push(String((err && err.message) || err)));
  await win.evaluate(async ({ aiBase, addBookmark }) => {
    await window.dexerion.invoke('dex:ai-key-set', 'nvapi-e2e-agent-newtab');
    // Agent mode needs both the visible lightning switch (aiAgent.agent) and
    // the user-owned capability bit. Set each through its real IPC path.
    await window.dexerion.invoke('dex:ai-agent-set', { agent: true, agentAllowlistOn: false });
    await window.dexerion.invoke('dex:ai-caps-set', { agent: true, vision: true, websites: true });
    await window.dexerion.invoke('dex:ai-page-set', { usePage: true });
    if (addBookmark) {
      await window.dexerion.invoke('dex:bookmark-add', {
        title: 'Ookla Speed Test',
        url: 'https://www.speedtest.net/',
      });
    }
    await window.dexerion.invoke('dex:new-tab', 'dexerion://newtab', false);
  }, { aiBase: mock.url, addBookmark: bookmark });

  await findNewTab(app);
  await expect.poll(async () => app.evaluate(async ({ webContents }) => {
    const wc = webContents.getAllWebContents()
      .find((w) => /^dexerion:\/\/newtab/.test(w.getURL() || ''));
    if (!wc) return false;
    return wc.executeJavaScript('!!document.getElementById("q")');
  }), { timeout: 20000 }).toBe(true);

  // Capture the main-process navigation handler. The renderer bridge is
  // frozen, but this is the exact endpoint the new tab's search field and
  // starred tiles call. Replacing it keeps every test offline while still
  // proving the agent used the controls the person sees.
  await app.evaluate(async ({ ipcMain }) => {
    const handlers = ipcMain._invokeHandlers;
    if (!handlers || !handlers.has('dex:navigate')) {
      throw new Error('dex:navigate handler missing before navigation capture');
    }
    globalThis.__dexNavCalls = [];
    handlers.set('dex:navigate', async (event, tabId, input) => {
      globalThis.__dexNavCalls.push([tabId, input]);
      return true;
    });
  });

  await win.evaluate(() => window.dexerion.invoke('dex:ai-open'));
  await win.waitForSelector('#ai-sidebar:not([hidden])', { timeout: 20000 });
  await win.waitForFunction(() =>
    document.getElementById('ai-agent-toggle')?.getAttribute('aria-pressed') === 'true',
  { timeout: 20000 });
  return { app, win, errors };
}

async function waitIdle(win) {
  await win.waitForFunction(() => {
    const bar = document.getElementById('ai-runbar');
    const status = document.getElementById('ai-taskbar-status');
    return Boolean(bar && bar.hidden && status && status.hidden);
  }, { timeout: 120000 });
}

async function sendAndWait(win, text) {
  await win.fill('#ai-input', text);
  await win.press('#ai-input', 'Enter');
  // A run normally shows the runbar. An immediate refusal has no start event,
  // so the taskbar line is the other live surface. Waiting for both to clear
  // covers normal completion, refusal, failure and stop alike.
  await win.waitForFunction(() => {
    const bar = document.getElementById('ai-runbar');
    const status = document.getElementById('ai-taskbar-status');
    return (bar && !bar.hidden) || (status && !status.hidden);
  }, { timeout: 30000 });
  await waitIdle(win);
}

test('agent can search from the new tab page', async () => {
  const mock = await startAiMock({ reply: 'Mock agent reply.' });
  mock.replyFor = (body) => {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.some((m) => m && m.role === 'user' &&
      String(m.content || m.text || '').includes(SEARCH_MARKER))) return 'Unrelated.';
    const turns = toolTurns(messages);
    if (turns === 0) return { content: 'Looking at the new tab.', toolCalls: [tool('snapshot')] };
    if (turns === 1) {
      const ref = refFor(messages, 'Search Dexerion or type a URL');
      if (!ref) return done('Could not find the new tab search field.');
      return { content: 'Typing the search.', toolCalls: [tool('type', { ref, text: SEARCH_TEXT, submit: true })] };
    }
    return done('Searched from the new tab.');
  };
  const { app, win, errors } = await boot(mock);
  try {
    await sendAndWait(win, SEARCH_MARKER);
    const calls = await navCalls(app);
    expect(calls.some((args) => String(args && args[1] || '').includes(SEARCH_TEXT))).toBe(true);
    await expect(win.locator('#ai-messages')).toContainText('Searched from the new tab');
    expect(errors).toEqual([]);
    console.log('AGENT NEWTAB SEARCH PASS');
  } finally {
    await app.close().catch(() => {});
    await mock.close();
  }
});

test('agent can open a starred tile from the new tab page', async () => {
  const mock = await startAiMock({ reply: 'Mock agent reply.' });
  mock.replyFor = (body) => {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.some((m) => m && m.role === 'user' &&
      String(m.content || m.text || '').includes(STAR_MARKER))) return 'Unrelated.';
    const turns = toolTurns(messages);
    if (turns === 0) return { content: 'Looking at the starred tiles.', toolCalls: [tool('snapshot')] };
    if (turns === 1) {
      // A tile's snapshot label is its title attribute (the URL), not the
      // visible bookmark name, so match the host here.
      const ref = refFor(messages, 'speedtest.net');
      if (!ref) return done('Could not find the Ookla speed test tile.');
      return { content: 'Opening the starred tile.', toolCalls: [tool('click', { ref, why: 'open the Ookla speed test' })] };
    }
    return done('Opened your starred Ookla speed test.');
  };
  const { app, win, errors } = await boot(mock);
  try {
    await app.evaluate(async ({ webContents }) => {
      const wc = webContents.getAllWebContents()
        .find((w) => /^dexerion:\/\/newtab/.test(w.getURL() || ''));
      return wc ? wc.executeJavaScript('!!document.querySelector("#starred .tile")') : false;
    });
    await sendAndWait(win, STAR_MARKER);
    const calls = await navCalls(app);
    expect(calls.some((args) => String(args && args[1] || '') === SPEEDTEST)).toBe(true);
    await expect(win.locator('#ai-messages')).toContainText('Opened your starred Ookla speed test');
    expect(errors).toEqual([]);
    console.log('AGENT NEWTAB STARRED PASS');
  } finally {
    await app.close().catch(() => {});
    await mock.close();
  }
});

test('a failed agent run clears the Working status', async () => {
  const mock = await startAiMock({ reply: 'Mock agent reply.' });
  mock.replyFor = (body) => {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.some((m) => m && m.role === 'user' &&
      String(m.content || m.text || '').includes(FAIL_MARKER))) return 'Unrelated.';
    // A bad ref is a tier-2 action that fails honestly twice; the bounded retry
    // then ends the run without an approval card (unknown tools are tier 3).
    return { content: 'Trying that element.', toolCalls: [tool('click', { ref: 999999, why: 'test the failure path' })] };
  };
  const { app, win, errors } = await boot(mock, { bookmark: false });
  try {
    await sendAndWait(win, FAIL_MARKER);
    await expect(win.locator('#ai-messages')).not.toContainText('ReferenceError');
    await expect(win.locator('#ai-messages')).toContainText('stopped');
    expect(errors).toEqual([]);
    console.log('AGENT FAILURE CLEARS STATUS PASS');
  } finally {
    await app.close().catch(() => {});
    await mock.close();
  }
});

test('stopping an agent run clears the Working status', async () => {
  const mock = await startAiMock({ reply: 'Mock agent reply.' });
  mock.replyFor = (body) => {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.some((m) => m && m.role === 'user' &&
      String(m.content || m.text || '').includes(STOP_MARKER))) return 'Unrelated.';
    // wait_for parks the run inside the page long enough to press Stop.
    return { content: 'Waiting.', toolCalls: [tool('wait_for', { text: 'this will never appear', ms: 8000 })] };
  };
  const { app, win, errors } = await boot(mock, { bookmark: false });
  try {
    await win.fill('#ai-input', STOP_MARKER);
    await win.press('#ai-input', 'Enter');
    await win.waitForSelector('#ai-runbar:not([hidden])', { timeout: 30000 });
    await win.click('#ai-send'); // the same glyph is Stop while a run is live
    await waitIdle(win);
    expect(errors).toEqual([]);
    console.log('AGENT STOP CLEARS STATUS PASS');
  } finally {
    await app.close().catch(() => {});
    await mock.close();
  }
});
