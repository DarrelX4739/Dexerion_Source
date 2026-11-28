'use strict';
// The reference is the checked-in unmodified Lucide bundle; build a minimal
// SVG sink rather than duplicating Lucide's AMD/DOM behavior or path strings.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { SHELL, UPSTREAM } = require('./vendor-lucide-shell.cjs');
const aliasNames = ['Ellipsis', 'MoreHorizontal'];

function currentPlaceholders() {
  const html = fs.readFileSync(SHELL, 'utf8');
  const markup = [...html.matchAll(/<i\s+([^>]*\bdata-lucide\s*=\s*["'][^"']+["'][^>]*)>/g)];
  assert.equal(markup.length, [...html.matchAll(/\bdata-lucide\s*=/g)].length);
  assert(markup.length > 0);
  return markup.map(([, text]) => Object.fromEntries([...text.matchAll(/([\w-]+)\s*=\s*(['"])(.*?)\2/g)]
    .map(([, name, _quote, value]) => [name, value])));
}

function renderReference(source, attrs) {
  const rendered = [];
  const draft = attrs.map(props => ({
    attributes: Object.entries(props).map(([name, value]) => ({ name, value })),
    getAttribute: name => Object.hasOwn(props, name) ? props[name] : null,
    parentNode: { replaceChild(node) { rendered.push(node); } },
  }));
  const doc = {
    querySelectorAll(sel) { return sel === '[data-lucide]' ? draft : []; },
    createElementNS(namespace, tag) {
      return { namespace, tag, attrs: {}, children: [],
        setAttribute(name, value) { this.attrs[name] = String(value); },
        appendChild(node) { this.children.push(node); } };
    },
  };
  const context = vm.createContext({ document: doc, console: { warn: (text) => assert.fail(text) } });
  new vm.Script(source).runInContext(context);
  const { lucide } = context;
  lucide.createIcons();
  const detached = aliasNames.map(name => {
    const glyph = lucide.createElement(lucide.icons[name]);
    glyph.setAttribute('aria-hidden', 'true');
    return glyph;
  });
  const tree = ({ namespace, tag, attrs, children }) => ({ namespace, tag, attrs, children: children.map(tree) });
  return { static: rendered.map(tree), detached: detached.map(tree), registryCount: Object.keys(lucide.icons).length };
}

function upstreamFixture() {
  return renderReference(fs.readFileSync(UPSTREAM, 'utf8'), currentPlaceholders());
}

module.exports = { currentPlaceholders, renderReference, upstreamFixture };
