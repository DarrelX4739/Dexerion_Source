'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const { generate, TARGET, UPSTREAM, SHELL } = require('./vendor-lucide-shell.cjs');

const shell = fs.readFileSync(SHELL, 'utf8');
const upstream = fs.readFileSync(UPSTREAM, 'utf8');
const subset = fs.readFileSync(TARGET, 'utf8');

function fakeDom(placeholders) {
  const document = {
    querySelectorAll(sel) {
      return sel === '[data-lucide]' ? [...placeholders] : [];
    },
    createElementNS(namespace, tag) {
      return {
        namespace, tag, attrs: {}, children: [],
        setAttribute(name, value) { this.attrs[name] = value; },
        appendChild(child) { this.children.push(child); },
      };
    },
  };
  const replaced = [];
  for (const node of placeholders) {
    node.getAttribute = (name) => node.attributes.find((a) => a.name === name)?.value ?? null;
    node.parentNode = { replaceChild(next, prev) { replaced.push({ next, prev }); } };
  }
  return { document, replaced };
}

function render(source, attrs) {
  const { document, replaced } = fakeDom(attrs.map((props) => ({
    attributes: Object.entries(props).map(([name, value]) => ({ name, value })),
  })));
  const ctx = vm.createContext({ document, console: { warn: (text) => assert.fail(text) } });
  new vm.Script(source).runInContext(ctx);
  ctx.lucide.createIcons();
  const dynamic = Object.fromEntries(['Ellipsis', 'MoreHorizontal'].map((name) => {
    const icon = ctx.lucide.createElement(ctx.lucide.icons[name]);
    icon.setAttribute('aria-hidden', 'true'); // artifact detached-card path
    return [name, icon];
  }));
  const tree = ({ namespace, tag, attrs, children }) => ({ namespace, tag, attrs, children: children.map(tree) });
  return { replaced: replaced.map(({ next }) => tree(next)),
    dynamic: Object.fromEntries(Object.entries(dynamic).map(([name, icon]) => [name, tree(icon)])) };
}

test('shell loads the generated subset synchronously, with no full bundle in its boot path', () => {
  assert.equal(subset, generate());
  assert.ok(Buffer.byteLength(subset) < Buffer.byteLength(upstream) / 20);
  assert.doesNotMatch(shell, /<script[^>]*src="[^"]*lucide\.min\.js"/);
  assert.match(shell, /<script src="[^"]*lucide-shell\.js"><\/script>\s*<script src="ai-sidebar\.js"><\/script>/);
});

test('all current shell placeholders produce the upstream SVG tree and ARIA attributes', () => {
  const attrs = [...shell.matchAll(/<i\s+([^>]*\bdata-lucide\s*=\s*["'][^"']+["'][^>]*)>/g)]
    .map(([, text]) => Object.fromEntries([...text.matchAll(/([\w-]+)\s*=\s*(['"])(.*?)\2/g)]
      .map(([, name, _quote, value]) => [name, value])));
  assert.equal(attrs.length, [...shell.matchAll(/\bdata-lucide\s*=/g)].length);
  assert.ok(attrs.length > 0);
  // Exercise attribute merging even if the current static markup doesn't.
  attrs.push({ 'data-lucide': 'square-pen', title: 'New chat', class: 'custom new-chat' });
  const actual = render(subset, attrs);
  const expected = render(upstream, attrs);
  assert.equal(actual.replaced.length, attrs.length);
  assert.deepEqual(actual, expected);
  assert.equal(actual.replaced[0].attrs['aria-hidden'], 'true');
  assert.equal(actual.replaced.at(-1).attrs.class, 'lucide lucide-square-pen custom new-chat');
  assert.equal(actual.replaced.at(-1).attrs['aria-hidden'], undefined);
});
