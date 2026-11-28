'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { performance } = require('node:perf_hooks');

const modulePath = path.resolve(__dirname, '../../code/src/main/ai-providers.js');
const current = require(modulePath);

function provider(code) {
  const module = { exports: {} };
  new Function('require', 'module', code)(require, module);
  return module.exports;
}

function events(thoughts) {
  const lines = thoughts.map((thought, i) =>
    ({ choices: [{ delta: i % 2 ? { reasoning: thought } : { reasoning_content: thought } }] }));
  lines.push({ choices: [{ delta: { content: '<|chan' } }] });
  lines.push({ choices: [{ delta: { content: 'nel>hidden channel<channel|>First ' } }] });
  lines.push({ choices: [{ delta: { content: 'answer 😀',
    tool_calls: [{ index: 0, id: 'local-call', function: { name: 'local', arguments: '{"value":' } }],
  } }] });
  lines.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '42}' } }] } }] });
  const data = [...lines.map(value => 'data: ' + JSON.stringify(value) + '\r\n\r\n'), 'data: [DONE]\n',
    ': metadata ignored\n', 'data: {not json}\n',
    'data: ' + JSON.stringify({ choices: [{ finish_reason: 'stop' }], usage: { prompt_tokens: 13, completion_tokens: 27 } })];
  return Buffer.from(data.join(''), 'utf8');
}

function fixedChunks(buffer, sizes) {
  const chunks = [];
  for (let at = 0, i = 0; at < buffer.length; i++) {
    const next = at + sizes[i % sizes.length];
    chunks.push(buffer.subarray(at, next));
    at = next;
  }
  return chunks;
}

async function chatWith(impl, chunks, observe = true) {
  const progress = [];
  const visible = [];
  let at = 0, released = 0, reasonCount = 0;
  const outcome = await impl.chat('nim', {
    apiKey: 'local-control',
    model: 'nvidia/local-fixture',
    stream: true,
    messages: [{ role: 'user', content: 'A synthetic prompt.' }],
    fetch: async () => ({
      ok: true, body: { getReader: () => ({
        async read() { return at < chunks.length ? { value: chunks[at++], done: false } : { done: true }; },
        releaseLock() { released++; },
      }) },
    }),
    onText(delta, all) { visible.push([delta, all]); },
    onReasoning(delta) { reasonCount++; if (observe) progress.push(delta); },
  });
  return { outcome, progress, visible, released, reasonCount };
}

const checkedPrefix = thoughts => thoughts.join('').slice(0, 8_000);

test('all reasoning callbacks survive the cap; split SSE and final tool/usage/finish output stay exact', async () => {
  // Crossing cap in a surrogate pair keeps the exact old UTF-16 prefix,
  // rather than reinterpreting it as a cap in complete code points.
  const thoughts = ['B', 'a'.repeat(7_998), '😀z', 'additional ⛅', 'later content'];
  const result = await chatWith(current, fixedChunks(events(thoughts), [2, 17, 1, 71, 489]));
  assert.deepEqual(result.progress, thoughts);
  assert.equal(result.outcome.thinking, checkedPrefix(thoughts).trim());
  assert.equal(result.outcome.thinking.at(-1).charCodeAt(0), 0xd83d);
  assert.deepEqual(result.visible, [['First ', 'First '], ['answer 😀', 'First answer 😀']]);
  assert.deepEqual(result.outcome.toolCalls, [{ id: 'local-call', name: 'local', input: { value: 42 }, parseError: '' }]);
  assert.deepEqual(result.outcome.usage, { input_tokens: 13, output_tokens: 27 });
  assert.equal(result.outcome.finishReason, 'stop');
  assert.equal(result.released, 1);
});

test('short reasoning keeps distinct hidden marker content and none is emitted inline', async () => {
  const thoughts = ['\t', 'Here is private context', '\n', 'Mixed fields', '  '];
  const { progress, outcome, reasonCount } = await chatWith(current, fixedChunks(events(thoughts), [4_096]));
  assert.equal(reasonCount, thoughts.length);
  assert.deepEqual(progress, thoughts);
  assert.equal(outcome.thinking, 'Here is private context\nMixed fields  \nhidden channel');
  assert.equal(outcome.text, 'First answer 😀');
});

test('a full reasoning prefix is not copied for each additional progress event', async () => {
  const sandbox = { module: { exports: {} }, TextDecoder, require, process: { env: {} }, oversizedSlices: 0 };
  const source = fs.readFileSync(modulePath, 'utf8');
  vm.runInNewContext(`
    const savedSlice = String.prototype.slice;
    String.prototype.slice = function (from, to) {
      if (from === 0 && to === 8000 && this.length > to && this.startsWith('slice control ')) oversizedSlices++;
      return savedSlice.call(this, from, to);
    };
  ` + source, sandbox);
  const thoughts = ['slice control '.padEnd(8_000, 'x'), ...Array(80).fill('further model progress')];
  const result = await chatWith(sandbox.module.exports, fixedChunks(events(thoughts), [4_096]));
  assert.deepEqual(result.progress, thoughts);
  assert.equal(result.outcome.thinking, thoughts[0]);
  // The final formatting of the combined provider/channel output remains.
  assert.equal(sandbox.oversizedSlices, 1, 'only the final visible reasoning summary should truncate a full prefix');
});

if (process.argv.includes('--bench')) {
  const old = provider(fs.readFileSync(process.argv.at(-1), 'utf8'));
  const packetText = [35, 10, 65, 22, 30, 90].map((length, i) => Array(length).fill(i % 3 ? 'x' : 'á').join(''));
  (async () => {
    for (const [label, eventCount, scans] of [
      ['short answer below cap', 80, 250], ['long reasoning', 2_500, 40], ['deep reasoning near context limit', 10_000, 13],
    ]) {
      const thoughts = Array.from({ length: eventCount }, (_, i) => packetText[i % packetText.length]);
      const chunks = fixedChunks(events(thoughts), [512, 129, 700, 92, 151, 4096, 32]);
      assert.deepEqual(await chatWith(current, chunks), await chatWith(old, chunks));
      for (let i = 0; i < 15; i++) { await chatWith(old, chunks, false); await chatWith(current, chunks, false); }
      const measure = async (impl) => {
        const t0 = performance.now();
        for (let i = 0; i < scans; i++) await chatWith(impl, chunks, false);
        return (performance.now() - t0) / scans;
      };
      const before = [], after = [];
      for (let i = 0; i < 11; i++) {
        if (i % 2) { after.push(await measure(current)); before.push(await measure(old)); }
        else { before.push(await measure(old)); after.push(await measure(current)); }
      }
      const med = values => values.toSorted((a, b) => a - b)[5];
      console.log(JSON.stringify({ label, eventCount, oldMs: med(before), newMs: med(after), parity: true }));
    }
  })().catch(err => { console.error(err); process.exitCode = 1; });
}
