'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setImmediate: drain } = require('node:timers/promises');
const { test } = require('node:test');

const shell = fs.readFileSync(path.join(__dirname, '../../code/src/renderer/shell.js'), 'utf8');
const start = shell.indexOf('const toolbarExtensions = ');
const end = shell.indexOf('// Keep existing links', start);
const iconStart = shell.indexOf('function setExtBtnIcon(');
const iconEnd = shell.indexOf('function ringEl(', iconStart);
assert.ok(start > 0 && end > start && iconStart > end && iconEnd > iconStart);
assert.match(shell, /\bupdateExtensionsToolbar\(s\.extensions\);/);

function setup() {
  const icons = [], popups = [];
  let buttons = 0, images = 0, toolbarInsertions = 0;
  const doc = { activeElement: null, createElement(tag) {
    if (tag === 'button') buttons++;
    if (tag === 'img') images++;
    return node(tag);
  } };
  function node(tag) {
    const classes = new Set();
    return {
      tag, children: [], parentNode: null, title: '',
      classList: { toggle(c, b) { if (b) classes.add(c); else classes.delete(c); },
        contains(c) { return classes.has(c); } },
      get firstElementChild() { return this.children[0] || null; },
      get nextElementSibling() {
        return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null;
      },
      set innerHTML(s) {
        for (const child of [...this.children]) child.remove();
        this.markup = s;
      },
      remove() {
        if (!this.parentNode) return;
        const siblings = this.parentNode.children;
        siblings.splice(siblings.indexOf(this), 1);
        this.parentNode = null;
        if (doc.activeElement === this) doc.activeElement = null;
      },
      appendChild(child) { this.insertBefore(child, null); },
      insertBefore(child, ref) {
        if (this.tag === 'toolbar') toolbarInsertions++;
        assert.notEqual(child, ref);
        child.remove();
        this.children.splice(ref === null ? this.children.length : this.children.indexOf(ref), 0, child);
        child.parentNode = this;
      },
      focus(opts) { this.focusOptions = opts; doc.activeElement = this; },
    };
  }
  const bar = node('toolbar');
  const update = vm.runInNewContext(shell.slice(start, end) + shell.slice(iconStart, iconEnd) + '\nupdateExtensionsToolbar;', {
    $: (sel) => { assert.equal(sel, '#extbar'); return bar; },
    document: doc,
    setIcon: (btn, name) => { btn._icon = name; btn.innerHTML = '<svg></svg>'; },
    window: { dexerion: { invoke(channel, id) {
      if (channel === 'dex:ext-popup') { popups.push(id); return Promise.resolve(); }
      assert.equal(channel, 'dex:ext-icon');
      return new Promise((resolve, reject) => icons.push({ id, resolve, reject }));
    } } },
  });
  return { update, doc, bar, icons, popups, counts: () => ({ buttons, images, toolbarInsertions }) };
}

const ext = (id, overrides = {}) => ({ id, name: 'Extension ' + id, version: '1.2', enabled: true, ...overrides });
const data = (id) => 'data:image/png;base64,' + id;

test('unrelated states preserve toolbar identity, focus, actions, and deduplicate pending image lookups', async () => {
  const f = setup();
  const installed = Array.from({ length: 12 }, (_, i) => ext(String(i)));
  f.update(installed);
  const old = [...f.bar.children];
  old[4].focus();
  for (let i = 0; i < 200; i++) f.update(installed.map((x) => ({ ...x })));
  assert.deepEqual(f.bar.children, old);
  assert.equal(f.doc.activeElement, old[4]);
  assert.deepEqual(f.counts(), { buttons: 12, images: 0, toolbarInsertions: 12 });
  assert.deepEqual(f.icons.map((call) => call.id), installed.map((x) => x.id));
  await old[4].onclick();
  assert.deepEqual(f.popups, ['4']);
  for (const req of f.icons) req.resolve(data(req.id));
  await drain();
  assert.deepEqual(f.bar.children, old);
  assert.equal(old[4].firstElementChild.src, data('4'));
  assert.equal(old[4].firstElementChild.draggable, false);
  assert.equal(f.doc.activeElement, old[4]);
  f.update(installed);
  assert.deepEqual(f.counts(), { buttons: 12, images: 12, toolbarInsertions: 12 });
  old[4].firstElementChild.onerror();
  assert.equal(old[4]._icon, 'ext');
});

test('enable, disable, rename, error, and reorder preserve order, action IDs and surviving focus', async () => {
  const f = setup();
  f.update([ext('a'), ext('b'), ext('c')]);
  const [a, b, c] = f.bar.children;
  c.focus();
  f.update([ext('c', { name: 'Renamed', version: '', loadError: 'Cannot load' }), ext('a'), ext('b', { enabled: false })]);
  assert.deepEqual(f.bar.children, [c, a]);
  assert.equal(f.doc.activeElement, c);
  assert.equal(c.focusOptions.preventScroll, true);
  assert.equal(c.title, 'Renamed  — error: Cannot load');
  assert.equal(c.classList.contains('exterr'), true);
  assert.equal(b.parentNode, null);
  f.icons.find((req) => req.id === 'b').resolve(data('b'));
  await drain();
  f.update([ext('a'), ext('b'), ext('c')]);
  assert.deepEqual(f.bar.children.map((n) => n.title), ['Extension a 1.2', 'Extension b 1.2', 'Extension c 1.2']);
  assert.equal(c.classList.contains('exterr'), false);
  assert.equal(f.bar.children[1].firstElementChild.src, data('b'));
  assert.equal(f.doc.activeElement, c);
  assert.equal(f.icons.length, 3);
  await f.bar.children[1].onclick();
  assert.deepEqual(f.popups, ['b']);
});

test('removing a pending ID fences off a stale reply when that ID is later installed again', async () => {
  const f = setup();
  f.update([ext('a')]);
  const firstRequest = f.icons[0];
  f.update([]);
  f.update([ext('a')]);
  const current = f.bar.children[0];
  firstRequest.resolve(data('old'));
  await drain();
  assert.equal(current.firstElementChild, null);
  assert.equal(current._icon, 'ext');
  f.icons[1].resolve(data('new'));
  await drain();
  assert.equal(current.firstElementChild.src, data('new'));
});

test('failed requests retry once on the next update, and duplicate display IDs keep distinct buttons', async () => {
  const f = setup();
  const installed = [ext('', { name: 'Broken one', loadError: 'missing' }), ext('', { name: 'Broken two' }), ext('third')];
  f.update(installed);
  const old = [...f.bar.children];
  assert.deepEqual(old.map((n) => n.title), ['Broken one 1.2 — error: missing', 'Broken two 1.2', 'Extension third 1.2']);
  assert.deepEqual(f.icons.map((req) => req.id), ['', 'third']);
  f.icons[0].reject(new Error('sender disconnected'));
  f.icons[1].resolve(null);
  await drain();
  f.update(installed);
  f.update(installed);
  assert.deepEqual(f.icons.map((req) => req.id), ['', 'third', '']);
  f.icons[2].resolve(null);
  await drain();
  assert.deepEqual(f.bar.children, old);
  assert.deepEqual(old.map((n) => n._icon), ['ext', 'ext', 'ext']);
  await old[1].onclick();
  assert.deepEqual(f.popups, ['']);
});
