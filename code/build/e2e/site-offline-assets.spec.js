'use strict';
// V31 / V40 proof: online research is allowed as SOURCE material, but the
// delivered make_site artifact is exactly one index.html with inline artwork,
// a visible credit, zero remote resource references and no renderer errors.
//
// The local NIM mock plays both roles: its structured-search fixtures supply
// the "web research" (DEX_SEARCH_BASE, as in search.spec.js) and its chat
// completion returns the one-file site. No live network is used.

const { test, expect } = require('@playwright/test');
const { startAiMock } = require('./ai-mock');
const { launchDexerion } = require('./app');
const {
  scanRemoteReferences,
  inlineAssetBudget,
  isSingleIndexHtml,
  hasAttribution,
} = require('./offline-html');

const ONE_PIXEL_GIF = 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

const SITE_HTML = [
  '<!doctype html><html lang="en"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<title>Offline Atelier</title>',
  '<meta name="description" content="A self-contained gallery of inline artwork.">',
  '<style>',
  ':root{--ink:#16202a;--paper:#f7f5f0;--accent:#2b6cb0}',
  '*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;color:var(--ink);background:var(--paper);padding:24px}',
  'main{max-width:720px;margin:0 auto}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px}',
  '.card{border:1px solid var(--ink);border-radius:8px;padding:12px}button{min-height:44px}',
  '@media(prefers-reduced-motion:reduce){*{transition:none}}',
  '</style></head><body><main><h1>Offline Atelier</h1>',
  '<p id="status" role="status" aria-live="polite">Ready</p>',
  '<div class="gallery">',
  '<figure class="card"><img src="data:image/gif;base64,' + ONE_PIXEL_GIF + '" alt="One pixel test tile" data-dex-credit="Source: Example Commons — CC BY 4.0."><figcaption>Tiled artwork — Source: Example Commons (CC BY 4.0)</figcaption></figure>',
  '<figure class="card"><svg viewBox="0 0 40 40" role="img" aria-label="Blue circle"><circle cx="20" cy="20" r="16" fill="var(--accent)"></circle></svg><figcaption>Vector artwork</figcaption></figure>',
  '</div><div id="tools"><button type="button" data-act="add">Add a note</button>',
  '<button type="button" data-act="clear">Clear notes</button></div><ul id="notes"></ul></main>',
  '<footer>Source: Example Commons — CC BY 4.0. Vector artwork is original.</footer>',
  '<script>(function(){',
  'var board=document.getElementById("notes"),status=document.getElementById("status");',
  'document.addEventListener("click",function(event){',
  'var button=event.target.closest("button[data-act]");if(!button)return;',
  'var act=button.getAttribute("data-act");',
  'if(act==="add"){var li=document.createElement("li"),rm=document.createElement("button");',
  'rm.type="button";rm.setAttribute("data-act","remove");rm.textContent="Remove";',
  'li.textContent="Note "+(board.children.length+1)+" ";li.appendChild(rm);board.appendChild(li);',
  'status.textContent="Added note "+board.children.length;}',
  'else if(act==="clear"){board.textContent="";status.textContent="Cleared";}',
  'else if(act==="remove"){button.closest("li").remove();status.textContent="Removed a note";}',
  '});console.error("polish-offline-probe");})();</script></body></html>',
].join('\n');

const SITE_REPLY = [
  'Here is the self-contained gallery.',
  '```dex-artifact',
  JSON.stringify({
    kind: 'site',
    title: 'Offline Atelier',
    description: 'A single-file gallery of inline artwork.',
    files: [{ path: 'index.html', content: SITE_HTML }],
  }),
  '```',
].join('\n');

async function findSiteArtifact(win) {
  return win.evaluate(async () => {
    const list = await window.dexerion.invoke('dex:ai-chats-list');
    for (const item of Array.isArray(list) ? list : []) {
      const chat = await window.dexerion.invoke('dex:ai-chat-open', item.id);
      const found = (chat.messages || []).find((m) => m && m.artifact && m.artifact.kind === 'site');
      if (found) return found.artifact;
    }
    return null;
  });
}

test('online research stays source-only: delivered site is one offline index.html', async () => {
  const mock = await startAiMock();
  const searchBase = mock.url.replace(/\/v1$/, '');
  mock.replyFor = (body) => {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const blob = messages.map((m) => String((m && m.content) || '')).join('\n');
    if (/search planner/i.test(blob)) return JSON.stringify({ queries: ['example domain article'] });
    // The grounded synthesis call carries the AI Search system prompt. It must
    // be answered before the generic site matcher: the same user phrase
    // ("...offline gallery") drives both surfaces, and only this branch is the
    // cited research answer asserted below.
    if (/research assistant inside the Dexerion browser/i.test(blob)) {
      return 'The example domain is reserved for documentation examples [1].';
    }
    const lastUser = [...messages].reverse().find((m) => m && m.role === 'user');
    const ask = String((lastUser && lastUser.content) || '');
    if (/offline gallery/i.test(ask)) return SITE_REPLY;
    if (/research|search/i.test(ask)) return 'The example domain is reserved for documentation examples [1].';
    return 'Done.';
  };

  const { app, win } = await launchDexerion({
    aiBase: mock.url,
    env: { DEX_SEARCH_BASE: searchBase, DEX_SEARCH_ALLOW_PRIVATE: '1' },
  });
  const pageErrors = [];
  win.on('pageerror', (err) => pageErrors.push(String((err && err.message) || err)));
  try {
    await win.evaluate(async () => {
      await window.dexerion.invoke('dex:ai-key-set', 'nvapi-e2e-polish-offline');
    });

    // 1. The online-source path really ran through the structured provider
    //    fixture (no real host is contacted; DEX_SEARCH_BASE redirects it).
    await win.evaluate(() => window.dexerion.invoke('dex:aisearch-open'));
    await win.waitForSelector('#ais:not([hidden])', { timeout: 15000 });
    await win.fill('#ais-input', 'research the example domain for an offline gallery');
    await win.press('#ais-input', 'Enter');
    await expect(win.locator('#ais-msgs')).toContainText('documentation examples [1]', { timeout: 60000 });
    expect(mock.fetches.some((u) => u.startsWith('/html/'))).toBe(true);
    expect(mock.fetches.some((u) => u.startsWith('/article'))).toBe(true);

    // 2. The generated deliverable is ONE file, named index.html.
    await win.evaluate(() => window.dexerion.invoke('dex:ai-open'));
    await win.waitForSelector('#ai-sidebar:not([hidden])', { timeout: 15000 });
    await win.fill('#ai-input', 'build the offline gallery site');
    await win.press('#ai-input', 'Enter');
    const card = win.locator('#ai-messages .dxa-card[data-kind="site"]').first();
    await expect(card).toBeVisible({ timeout: 30000 });

    const artifact = await findSiteArtifact(win);
    expect(artifact).not.toBeNull();
    expect(isSingleIndexHtml(artifact.files)).toBe(true);
    expect(String(artifact.files[0].path)).toBe('index.html');
    expect(await card.locator('.dxa-files')).toHaveText('1 file');

    const html = String(artifact.files[0].content);
    // 3. Inlined raster data URL, inline SVG and a visible source credit.
    expect(html).toMatch(/<img[^>]+src="data:image\/gif;base64,[A-Za-z0-9+/=]+"/);
    expect(html).toMatch(/<svg\b/i);
    expect(hasAttribution(html)).toBe(true);
    // The credit lives inside the sandboxed document, not the card chrome
    // (which only holds the preview buttons). Read it through the live frame.
    const siteFrame = win.frameLocator('#ai-messages .dxa-card[data-kind="site"] iframe.dxa-frame:not([style*="visibility: hidden"])');
    await expect(siteFrame.locator('body')).toContainText(/Source:/i, { timeout: 15000 });

    // 4. Zero remote references in every resource-bearing context, in both the
    //    stored artifact and the standalone Download-HTML form.
    expect(scanRemoteReferences(html)).toEqual([]);
    const budget = inlineAssetBudget(html);
    expect(budget.perAssetBytes.length).toBeGreaterThanOrEqual(1);
    expect(budget.perAssetOk).toBe(true);
    expect(budget.totalOk).toBe(true);
    expect(budget.documentOk).toBe(true);
    expect(budget.inlineSvgs).toBeGreaterThanOrEqual(1);

    const standalone = await win.evaluate(async () => {
      const a = await (async () => {
        const list = await window.dexerion.invoke('dex:ai-chats-list');
        for (const item of list) {
          const chat = await window.dexerion.invoke('dex:ai-chat-open', item.id);
          const found = (chat.messages || []).find((m) => m && m.artifact && m.artifact.kind === 'site');
          if (found) return found.artifact;
        }
        return null;
      })();
      return a ? window.dexerion.invoke('dex:ai-artifact-html', { artifact: a }) : null;
    });
    expect(standalone).not.toBeNull();
    expect(standalone.ok).toBe(true);
    expect(scanRemoteReferences(standalone.html)).toEqual([]);
    expect(standalone.html).not.toMatch(/<link[^>]*stylesheet/i);
    expect(standalone.html).not.toMatch(/<script[^>]*\ssrc=/i);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close().catch(() => {});
    await mock.close();
  }
});
