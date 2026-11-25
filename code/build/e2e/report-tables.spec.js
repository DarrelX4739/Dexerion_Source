'use strict';
// Report tables must look the same in every surface. The chat card loads
// shell.css (which used to be the only place that styled .md-table), but the
// standalone report viewer does not — so a pipe table inside a paragraph lost
// all of its borders there. This drives a real report through the mock model
// and inspects BOTH table flavours in the real viewer.

const { test, expect } = require('@playwright/test');
const { startAiMock } = require('./ai-mock');
const { launchDexerion } = require('./app');

const REPORT_REPLY = [
  'Here is the report.',
  '```dex-artifact',
  JSON.stringify({
    kind: 'report',
    title: 'Tide table check',
    subtitle: 'Structured and markdown tables',
    summary: 'Both tables must carry the same borders.',
    blocks: [
      { type: 'heading', text: '1. Evidence', level: 2 },
      { type: 'table', columns: ['Body', 'Level'], rows: [['Moon', '1.0'], ['Sun', '0.46']] },
      {
        type: 'paragraph',
        text: 'Markdown table inside a paragraph:\n\n| Source | Measured |\n| --- | --- |\n| Moon | 1.0 |\n| Sun | 0.46 |',
      },
    ],
  }),
  '```',
].join('\n');

test('structured and markdown report tables keep their borders in the viewer', async () => {
  const mock = await startAiMock({ reply: REPORT_REPLY });
  const { app, win } = await launchDexerion({ aiBase: mock.url });
  try {
    await win.evaluate(async () => {
      await window.dexerion.invoke('dex:ai-key-set', 'nvapi-e2e-report-table-key');
      await window.dexerion.invoke('dex:ai-open');
    });
    await win.waitForSelector('#ai-sidebar:not([hidden])', { timeout: 20000 });
    await expect(win.locator('#ai-setup')).toBeHidden({ timeout: 20000 });

    await win.fill('#ai-input', 'Make a report with tables');
    await win.press('#ai-input', 'Enter');
    const card = win.locator('#ai-messages .dxa-card[data-kind="report"]').last();
    await expect(card).toBeVisible({ timeout: 30000 });
    // Both tables reach the card: a structured block and a pipe table in prose.
    await expect(card.locator('table.dxa-table')).toHaveCount(1);
    await expect(card.locator('table.md-table')).toHaveCount(1);

    await card.getByRole('button', { name: 'Open', exact: true }).click();

    // The report is an overlay WebContentsView, so inspect it in the main
    // process the same way the boot suite does.
    const inReport = (js) => app.evaluate(async ({ webContents }, code) => {
      const wc = webContents.getAllWebContents()
        .find((w) => /^dexerion:\/\/report/.test(w.getURL() || ''));
      if (!wc) return null;
      return wc.executeJavaScript(code);
    }, js);

    const inspect = `(() => {
      const read = (table) => {
        const cs = getComputedStyle(table);
        const cell = table.querySelector('td');
        const head = table.querySelector('th');
        const cc = cell ? getComputedStyle(cell) : null;
        const hc = head ? getComputedStyle(head) : null;
        const wrap = table.closest('.dxa-table-wrap, .md-table-wrap');
        const wc = wrap ? getComputedStyle(wrap) : null;
        return {
          width: Math.round(table.getBoundingClientRect().width),
          collapse: cs.borderCollapse,
          cellRight: cc ? parseFloat(cc.borderRightWidth) : 0,
          cellBottom: cc ? parseFloat(cc.borderBottomWidth) : 0,
          headerBg: hc ? hc.backgroundColor : '',
          wrapBorder: wc ? parseFloat(wc.borderTopWidth) : 0,
          wrapped: !!wrap,
        };
      };
      const structured = document.querySelector('.dxa-report table.dxa-table');
      const markdown = document.querySelector('.dxa-report table.md-table');
      return {
        structured: structured ? read(structured) : null,
        markdown: markdown ? read(markdown) : null,
      };
    })()`;

    await expect.poll(async () => inReport(inspect), { timeout: 20000 }).toEqual(
      expect.objectContaining({
        structured: expect.anything(),
        markdown: expect.anything(),
      })
    );
    const styles = await inReport(inspect);
    for (const [name, s] of Object.entries(styles)) {
      expect(s.width, name + ' fills the measure').toBeGreaterThan(180);
      expect(s.collapse, name + ' collapses borders').toBe('collapse');
      expect(s.cellRight, name + ' cell right border').toBeGreaterThan(0);
      expect(s.cellBottom, name + ' cell bottom border').toBeGreaterThan(0);
      expect(s.wrapped, name + ' scroll wrapper').toBe(true);
      expect(s.wrapBorder, name + ' wrapper border').toBeGreaterThan(0);
      expect(s.headerBg, name + ' shaded header').not.toBe('rgba(0, 0, 0, 0)');
    }
  } finally {
    await app.close();
    await mock.close();
  }
});
