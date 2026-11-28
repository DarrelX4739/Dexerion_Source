'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const { generate, TARGET, UPSTREAM, SHELL } = require('./vendor-lucide-shell.cjs');
const { currentPlaceholders, renderReference } = require('./lucide-shell-oracle.cjs');

const shell = fs.readFileSync(SHELL, 'utf8');
const upstream = fs.readFileSync(UPSTREAM, 'utf8');
const subset = fs.readFileSync(TARGET, 'utf8');

test('the shell still loads Lucide synchronously and the exact ISC license is carried forward', () => {
  assert.equal(subset, generate());
  assert.ok(Buffer.byteLength(subset) < Buffer.byteLength(upstream) / 20);
  assert.doesNotMatch(shell, /<script[^>]*src="[^"]*lucide\.min\.js"/);
  assert.match(shell, /<script src="[^"]*lucide-shell\.js"><\/script>\s*<script src="ai-sidebar\.js"><\/script>/);
  const license = upstream.replace(/\r\n/g, '\n').match(/\/\*\*[\s\S]+?\*\//)?.[0];
  assert(license && /v1\.55\.0 - ISC/.test(license));
  assert(subset.includes(license));
});

test('all current static icons and the two detached aliases match upstream SVG and ARIA trees', () => {
  const attrs = currentPlaceholders();
  attrs.push({ 'data-lucide': 'square-pen', title: 'New chat', class: 'custom new-chat' });
  const actual = renderReference(subset, attrs);
  const expected = renderReference(upstream, attrs);
  assert.equal(actual.static.length, attrs.length);
  assert.deepEqual(actual.static, expected.static);
  assert.deepEqual(actual.detached, expected.detached);
  assert(actual.registryCount < expected.registryCount);
  assert.equal(actual.static[0].attrs['aria-hidden'], 'true');
  assert.equal(actual.static.at(-1).attrs.class, 'lucide lucide-square-pen custom new-chat');
  assert.equal(actual.static.at(-1).attrs['aria-hidden'], undefined);
});
