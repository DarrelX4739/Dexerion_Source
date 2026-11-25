'use strict';
// V33 proof: every control in the delivered site is wired, and one delegated
// listener (target.closest()) keeps brand-new items working without rebinding.
// Enter/Space parity, single-level undo and a form submission are exercised as
// real DOM interactions inside the sandboxed preview — not element presence.

const { test, expect } = require('@playwright/test');
const { startAiMock } = require('./ai-mock');
const { launchDexerion } = require('./app');

const SITE_HTML = [
  '<!doctype html><html lang="en"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<title>Control Room</title><meta name="description" content="A control-coverage fixture.">',
  '<style>:root{--ink:#15202b;--paper:#fff;--accent:#2764b2}',
  '*{box-sizing:border-box}body{margin:0;padding:20px;font-family:system-ui,sans-serif;color:var(--ink);background:var(--paper)}',
  'main{max-width:640px;margin:0 auto}button{min-height:44px;margin:4px}',
  '.on{outline:2px solid var(--accent)}[aria-pressed="true"]{font-weight:700}',
  'label{display:block;margin-top:12px}input{min-height:40px}',
  '@media(prefers-reduced-motion:reduce){*{transition:none}}</style></head><body>',
  '<main><h1>Control Room</h1><p id="status" role="status" aria-live="polite">Ready</p>',
  '<div id="toolbar">',
  '<button type="button" id="add" data-act="add">Add item</button>',
  '<button type="button" id="clear" data-act="clear">Clear</button>',
  '<button type="button" id="toggle" data-act="toggle" aria-pressed="false">Toggle</button>',
  '<button type="button" id="undo" data-act="undo" disabled>Undo</button>',
  '<a href="#ledger">Jump to ledger</a>',
  '<span id="custom" role="button" tabindex="0" data-key-act="custom">Custom action</span>',
  '</div><ul id="ledger"></ul>',
  '<form id="note-form"><label for="who">Your name</label>',
  '<input id="who" name="who" required><button type="submit">Send note</button></form>',
  '</main><script>(function(){',
  'var ledger=document.getElementById("ledger"),status=document.getElementById("status");',
  'var undoButton=document.getElementById("undo"),previous=null;',
  'function render(count){status.textContent="Items: "+count;undoButton.disabled=!previous;}',
  'function addItem(label){',
  '  previous=ledger.innerHTML;',
  '  var li=document.createElement("li"),remove=document.createElement("button");',
  '  remove.type="button";remove.setAttribute("data-act","remove");remove.textContent="Remove "+label;',
  '  li.textContent=label+" ";li.appendChild(remove);ledger.appendChild(li);render(ledger.children.length);',
  '}',
  'document.addEventListener("click",function(event){',
  '  var button=event.target.closest("button[data-act]");if(!button)return;',
  '  var act=button.getAttribute("data-act");',
  '  if(act==="add"){addItem("Note "+(ledger.children.length+1));}',
  '  else if(act==="remove"){previous=ledger.innerHTML;button.closest("li").remove();render(ledger.children.length);}',
  '  else if(act==="clear"){previous=ledger.innerHTML;ledger.textContent="";render(0);}',
  '  else if(act==="toggle"){var on=button.getAttribute("aria-pressed")==="true";',
  '    button.setAttribute("aria-pressed",on?"false":"true");status.textContent=on?"Toggle off":"Toggle on";}',
  '  else if(act==="undo"&&previous){ledger.innerHTML=previous;previous=null;render(ledger.children.length);status.textContent="Undone";}',
  '});',
  'document.addEventListener("keydown",function(event){',
  '  if(event.key!=="Enter"&&event.key!==" ")return;',
  '  var custom=event.target.closest("[data-key-act]");if(!custom)return;',
  '  event.preventDefault();status.textContent="Custom key action";',
  '});',
  'document.getElementById("note-form").addEventListener("submit",function(event){',
  '  event.preventDefault();status.textContent="Note from "+document.getElementById("who").value;',
  '});',
  'render(0);})();</script></body></html>',
].join('\n');

const SITE_REPLY = [
  '```dex-artifact',
  JSON.stringify({
    kind: 'site',
    title: 'Control Room',
    description: 'Every control is wired through delegation.',
    files: [{ path: 'index.html', content: SITE_HTML }],
  }),
  '```',
].join('\n');

test('every generated control works, including a runtime-added delegated item', async () => {
  const mock = await startAiMock({ reply: SITE_REPLY });
  const { app, win } = await launchDexerion({ aiBase: mock.url });
  const pageErrors = [];
  win.on('pageerror', (err) => pageErrors.push(String((err && err.message) || err)));
  try {
    await win.evaluate(async () => {
      await window.dexerion.invoke('dex:ai-key-set', 'nvapi-e2e-polish-controls');
      await window.dexerion.invoke('dex:ai-open');
    });
    await win.waitForSelector('#ai-sidebar:not([hidden])', { timeout: 15000 });
    await win.fill('#ai-input', 'build a site with every control wired');
    await win.press('#ai-input', 'Enter');
    const card = win.locator('#ai-messages .dxa-card[data-kind="site"]').first();
    await expect(card).toBeVisible({ timeout: 30000 });
    const frame = win.frameLocator('#ai-messages .dxa-card[data-kind="site"] iframe.dxa-frame:not([style*="visibility: hidden"])');

    // The fixture's own self-check rendered: one state object, one status line.
    await expect(frame.locator('#status')).toHaveText('Items: 0', { timeout: 15000 });
    await expect(frame.locator('#undo')).toBeDisabled();

    // 1. Native button -> visible state change.
    await frame.locator('#toggle').click();
    await expect(frame.locator('#status')).toHaveText('Toggle on');
    await expect(frame.locator('#toggle')).toHaveAttribute('aria-pressed', 'true');
    await frame.locator('#toggle').click();
    await expect(frame.locator('#status')).toHaveText('Toggle off');

    // 2. A new item appears at runtime and its Remove button was NOT present
    //    when the listener was bound: the delegated document listener catches it.
    await frame.locator('#add').click();
    await expect(frame.locator('#status')).toHaveText('Items: 1');
    await expect(frame.locator('#ledger li')).toHaveCount(1);
    const dynamicRemove = frame.locator('#ledger li button[data-act="remove"]');
    await expect(dynamicRemove).toHaveCount(1);
    await dynamicRemove.click();
    await expect(frame.locator('#status')).toHaveText('Items: 0');
    await expect(frame.locator('#ledger li')).toHaveCount(0);

    // 3. Add two items, then single-level undo restores the exact prior state.
    await frame.locator('#add').click();
    await frame.locator('#add').click();
    await expect(frame.locator('#status')).toHaveText('Items: 2');
    await expect(frame.locator('#undo')).toBeEnabled();
    await frame.locator('#undo').click();
    await expect(frame.locator('#status')).toHaveText('Undone');
    await expect(frame.locator('#ledger li')).toHaveCount(1);

    // 4. Idempotence: clearing twice leaves the same empty state.
    await frame.locator('#clear').click();
    await expect(frame.locator('#status')).toHaveText('Items: 0');
    await frame.locator('#clear').click();
    await expect(frame.locator('#status')).toHaveText('Items: 0');

    // 5. Keyboard parity for a custom role=button control (Enter and Space).
    await frame.locator('#custom').focus();
    await frame.locator('#custom').press('Enter');
    await expect(frame.locator('#status')).toHaveText('Custom key action');
    await frame.locator('#custom').press('Space');
    await expect(frame.locator('#status')).toHaveText('Custom key action');

    // 6. The real in-page link and the form both act; neither is a dead control.
    await frame.locator('a[href="#ledger"]').click();
    await expect.poll(async () => frame.locator('a[href="#ledger"]').evaluate((el) => location.hash)).toBe('#ledger');
    await frame.locator('#who').fill('Ada');
    await frame.locator('#note-form button[type="submit"]').click();
    await expect(frame.locator('#status')).toHaveText('Note from Ada');

    expect(pageErrors).toEqual([]);
  } finally {
    await app.close().catch(() => {});
    await mock.close();
  }
});
