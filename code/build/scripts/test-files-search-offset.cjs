'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { searchArtifacts } = require('../../code/src/main/ai-artifacts');

const report = (title, extra = {}) => ({ kind: 'report', title, ...extra });
const corpus = (...artifacts) => [{ id: 'chat-fixture', title: 'Saved conversation', updatedAt: 10,
  messages: artifacts.map((artifact) => ({ artifact })) }];

// Search snippets have always used the UTF-16 offset in the folded string, not
// a separately normalized index. Case expansion and surrogate halves exercise
// the important distinction (including an offset beyond the original length).
test('a single body lookup preserves the displayed snippet across Unicode folding', () => {
  const fixtures = [
    ['plain prefix ' + 'b'.repeat(72) + ' MiXeD ' + 'c'.repeat(100), '  mixed  '],
    ['𝒜 🍃 ' + 'İ'.repeat(110) + ' MiXeD ' + 'c'.repeat(130), 'MiXeD'],
    ['𝒜 ' + 'İ'.repeat(120) + ' MiXeD', 'mixed'],
    [' Greek ΣΟΣ and Straße ', 'Σος'],
    ['Leading A\ud800 B repeated text ' + 'x'.repeat(145), 'a\ud800 b'],
  ];
  for (const [body, q] of fixtures) {
    const text = ('Fixture ' + body).replace(/\s+/g, ' ').trim();
    const query = q.trim();
    const offset = text.toLowerCase().indexOf(query.toLowerCase());
    assert(offset >= 0, q);
    const start = Math.max(0, offset - 60);
    const end = Math.min(text.length, offset + query.length + 80);
    const expected = (start ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
    const hit = searchArtifacts(corpus(report('Fixture', { blocks: [{ text: body }] })), q)[0];
    assert.equal(hit.snippet, expected, q);
    assert.equal(hit.blockIndex, 0);
    assert.equal(hit.noteHit, false);
  }
});

test('title, kind, body and note matches retain ranking, stable ties, snippets and anchors', () => {
  const chats = corpus(
    report('First section', { updatedAt: 4, blocks: [{ text: 'Opening' }, { text: 'A JaSpEr finding' }] }),
    report('Second section', { updatedAt: 4, blocks: [{ text: 'Jasper from a block' }] }),
    report('Jasper title', { updatedAt: 1, blocks: [{ text: 'Heading' }] }),
    report('Notes', { updatedAt: 8, annotations: [{ note: 'Check jasper', quote: '', blockId: '42' }] }),
    { kind: 'jasper', title: 'Type only', updatedAt: 16, blocks: [{ text: 'x'.repeat(185) }] },
    report('Other'));
  assert.deepEqual(searchArtifacts(chats, '  jasPER  '), [
    { chatId: 'chat-fixture', chatTitle: 'Saved conversation', index: 2, kind: 'report', title: 'Jasper title', score: 10,
      snippet: 'Jasper title Heading', at: 1, blockIndex: null, noteHit: false },
    { chatId: 'chat-fixture', chatTitle: 'Saved conversation', index: 4, kind: 'jasper', title: 'Type only', score: 2,
      snippet: ('Type only ' + 'x'.repeat(185)).slice(0, 140), at: 16, blockIndex: null, noteHit: false },
    { chatId: 'chat-fixture', chatTitle: 'Saved conversation', index: 3, kind: 'report', title: 'Notes', score: 0,
      snippet: 'Notes Check jasper', at: 8, blockIndex: 42, noteHit: true },
    { chatId: 'chat-fixture', chatTitle: 'Saved conversation', index: 0, kind: 'report', title: 'First section', score: 0,
      snippet: 'First section Opening A JaSpEr finding', at: 4, blockIndex: 1, noteHit: false },
    { chatId: 'chat-fixture', chatTitle: 'Saved conversation', index: 1, kind: 'report', title: 'Second section', score: 0,
      snippet: 'Second section Jasper from a block', at: 4, blockIndex: 0, noteHit: false },
  ]);
  assert.deepEqual(searchArtifacts(chats, 'jasPER', { limit: '3' }).map((x) => x.index), [2, 4, 3]);
  assert.deepEqual(searchArtifacts(chats, 'missing fixture'), []);
  assert.deepEqual(searchArtifacts(chats, '  j '), []);
});

test('site source and rendered text remain searchable without treating either as a report block', () => {
  const chats = corpus({ kind: 'site', title: 'Weekend site',
    files: [{ path: 'workshop.js', content: '// Studio schedule' }], html: '<p>Mixed Café</p>' });
  for (const q of ['workshop.js', 'STUDIO SCHEDULE', 'café']) {
    const [hit] = searchArtifacts(chats, q);
    assert.equal(hit.kind, 'site');
    assert.equal(hit.blockIndex, null);
    assert.match(hit.snippet, /Mixed Café/);
    assert.equal(hit.noteHit, false);
  }
});

test('anchor validation still runs for a matched legacy row outside the result limit', () => {
  const chats = corpus(report('Jasper heading'), report('Invalid persisted anchor', {
    annotations: [{ note: 'jasper', blockId: { toString: false, valueOf: false } }],
  }));
  assert.throws(() => searchArtifacts(chats, 'jasper', { limit: 1 }), { name: 'TypeError' });
});
