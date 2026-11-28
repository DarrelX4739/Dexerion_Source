'use strict';
// See the actual Files search go from a real saved report through main-process
// ranking, the Files renderer's 30-result cut and its note-anchor deep link.
const fs = require('node:fs/promises');
const { test, expect } = require('@playwright/test');
const { launchDexerion } = require('./app');

test('Files keeps capped search order, Unicode snippets and a reading-note link', async () => {
  const { app, win, profile } = await launchDexerion({ attempts: 2 });
  try {
    const fixture = await win.evaluate(async () => {
      const { id } = await window.dexerion.invoke('dex:ai-chat-create', { title: 'Files ranking fixture' });
      // This older report's title outranks all the newer body matches. A note
      // with the same phrase wins the anchor over a matching content block.
      const title = 'Amber ledger: anchored reading result';
      for (let i = 0; i < 35; i += 1) {
        const artifact = { kind: 'report', title: i ? 'Evidence record ' + i : title,
          blocks: [{ type: 'paragraph', text: 'Collected the AmBeR LeDgEr and Café receipts.' },
            { type: 'paragraph', text: 'Notes are attached to this section.' }],
          ...(!i ? { annotations: [{ blockId: '1', note: 'Check AmBeR LeDgEr against the original Café receipts.',
            quote: 'Notes are attached to this section.' }] } : {}) };
        await window.dexerion.invoke('dex:ai-chat-append', { id, message: { role: 'model', text: 'Saved report.', artifact } });
      }
      await window.dexerion.invoke('dex:new-tab', 'dexerion://files', false);
      return { id, title };
    });
    const files = (source) => app.evaluate(async ({ webContents }, script) => {
      const page = webContents.getAllWebContents().find((w) => /^dexerion:\/\/files(?:\/|$)/.test(w.getURL() || ''));
      if (!page) return null;
      try { return await page.executeJavaScript(script); } catch { return null; }
    }, source);
    await expect.poll(() => files("document.readyState === 'complete' && !!document.querySelector('#q')"),
      { timeout: 20000 }).toBe(true);
    await files(`(() => {
      const input = document.querySelector('#q'); input.value = '  AMBer leDGer  ';
      input.dispatchEvent(new Event('input', { bubbles: true })); return true;
    })()`);
    await expect.poll(() => files(`(() => {
      const rows = Array.from(document.querySelectorAll('#reports .dx-item'));
      const first = rows[0];
      return first && { size: rows.length, title: first.querySelector('b').textContent,
        noteChip: first.querySelector('small').textContent.startsWith('note · Files ranking fixture · '),
        containsFoldedMatch: first.querySelector('small').title.includes('AmBeR LeDgEr and Café') };
    })()`), { timeout: 20000 }).toEqual({ size: 30, title: fixture.title, noteChip: true, containsFoldedMatch: true });
    await files("document.querySelector('#reports .dx-item .actions button').click()");
    await expect.poll(() => app.evaluate(({ webContents }) => {
      const page = webContents.getAllWebContents().find((w) => /^dexerion:\/\/report\?/.test(w.getURL() || ''));
      if (!page) return null;
      const query = new URL(page.getURL()).searchParams;
      return { chat: query.get('chat'), index: query.get('i'), block: query.get('b') };
    }), { timeout: 20000 }).toEqual({ chat: fixture.id, index: '0', block: '1' });
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
  }
});
