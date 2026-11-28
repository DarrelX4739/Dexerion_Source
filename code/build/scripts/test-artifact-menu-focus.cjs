'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '../../code/assets/ai-artifacts.js'), 'utf8');

function fixture(t) {
  const dom = new JSDOM('<div id="ai-messages"><article></article></div><button id="outside">Outside</button>',
    { runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const { window } = dom;
  const { document } = window;
  window.eval(source);
  const thread = document.querySelector('#ai-messages');
  thread.scrollTop = 120;
  const actions = [];
  window.DexArtifacts.render(thread.querySelector('article'), {
    kind: 'report', title: 'A report', blocks: [{ type: 'paragraph', text: 'A finding' }],
  }, {
    onOpenTab: (artifact) => actions.push(['Open in a tab', artifact.title]),
    onDesign: (artifact) => actions.push(['Design', artifact.title]),
    onRegenerate: (artifact) => actions.push(['Regenerate', artifact.title]),
  });
  const opener = thread.querySelector('button[aria-label="More actions"]');
  const menu = thread.querySelector('[role="menu"]');
  const entries = [...menu.querySelectorAll('[role="menuitem"]')];
  const design = entries.find(b => b.textContent === 'Design');
  const scroll = (pixels) => {
    thread.scrollTop += pixels;
    thread.dispatchEvent(new window.Event('scroll'));
  };
  return { window, document, thread, opener, menu, entries, design, actions, scroll };
}

function key(f, name) {
  const e = new f.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  f.document.activeElement.dispatchEvent(e);
  return e;
}

test('opening and arrow navigation focus the visible menu without scrolling its thread', async (t) => {
  const f = fixture(t);
  const nativeFocus = f.window.HTMLElement.prototype.focus;
  f.window.HTMLElement.prototype.focus = function (opts) {
    nativeFocus.call(this, opts);
    // jsdom has no layout scrolling. Model a browser which needs to scroll a
    // nested scroller to focus a fixed descendant when not told otherwise.
    if (this.getAttribute('role') === 'menuitem' && !opts?.preventScroll) {
      queueMicrotask(() => f.scroll(12));
    }
  };
  f.opener.click();
  await Promise.resolve();
  assert.equal(f.menu.hidden, false, 'opening cannot dismiss itself');
  assert.equal(f.opener.getAttribute('aria-expanded'), 'true');
  assert.equal(f.document.activeElement, f.entries[0]);
  assert.equal(f.thread.scrollTop, 120);

  assert.equal(key(f, 'ArrowDown').defaultPrevented, true);
  await Promise.resolve();
  assert.equal(f.document.activeElement, f.design);
  assert.equal(f.menu.hidden, false, 'arrow focus cannot dismiss the menu');
  assert.equal(f.thread.scrollTop, 120);
  key(f, 'ArrowUp');
  key(f, 'ArrowUp');
  assert.equal(f.document.activeElement, f.entries.at(-1), 'up wraps to the last item');
  key(f, 'ArrowDown');
  assert.equal(f.document.activeElement, f.entries[0], 'down wraps to the first item');

  // Actual menu-item DOM event, not a direct invocation of the callback.
  f.design.click();
  assert.deepEqual(f.actions, [['Design', 'A report']]);
  assert.equal(f.menu.hidden, true);
  assert.equal(f.opener.getAttribute('aria-expanded'), 'false');
});

test('scroll threshold, outside click, Escape focus restoration, and Tab dismissal are unchanged', (t) => {
  const f = fixture(t);
  f.opener.click();
  f.scroll(3);
  assert.equal(f.menu.hidden, false);
  f.scroll(1);
  assert.equal(f.menu.hidden, true);
  assert.deepEqual(f.actions, []);

  f.opener.click();
  f.document.getElementById('outside').click();
  assert.equal(f.menu.hidden, true);

  f.opener.click();
  key(f, 'Escape');
  assert.equal(f.menu.hidden, true);
  assert.equal(f.document.activeElement, f.opener);

  f.opener.click();
  assert.equal(key(f, 'Tab').defaultPrevented, false);
  assert.equal(f.menu.hidden, true);
  assert.equal(f.opener.getAttribute('aria-expanded'), 'false');
});
