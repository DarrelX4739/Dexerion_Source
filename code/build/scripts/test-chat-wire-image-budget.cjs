'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createRequire } = require('node:module');
const { performance } = require('node:perf_hooks');
const { test } = require('node:test');

const file = path.resolve(__dirname, '../../code/src/main/ai.js');
const source = fs.readFileSync(file, 'utf8');
const requireAi = createRequire(file);
const realProviders = requireAi('./ai-providers');

function fixtures(code, { onSerialize, chat } = {}) {
  const capture = {};
  const hook = '  function buildWireMessages(';
  assert.ok(code.includes(hook));
  const localRequire = name => {
    if (name === 'electron') return { safeStorage: { isEncryptionAvailable: () => false } };
    if (name === './ai-providers' && chat) return { ...realProviders, chat };
    return requireAi(name);
  };
  let json = JSON;
  if (onSerialize) {
    json = {
      parse: JSON.parse,
      stringify(...args) {
        const output = JSON.stringify(...args);
        onSerialize(output);
        return output;
      },
    };
  }
  const module = { exports: {} };
  const instrumented = code.replace(hook, '  capture.buildWireMessages = buildWireMessages;\n' + hook);
  new Function('require', 'module', '__dirname', 'JSON', 'capture', instrumented)(
    localRequire, module, path.dirname(file), json, capture);
  const create = dir => module.exports.createAi({ profile: { dir } });
  create('');
  return { build: capture.buildWireMessages, create };
}

const image = (url) => ({ url });
const textPart = text => ({ type: 'text', text });
const imagePart = url => ({ type: 'image_url', image_url: { url } });
const turn = (text, ...images) => ({ role: 'user', text, images: images.map(image) });
const imageUrl = (length, mime = 'png') => {
  const prefix = 'data:image/' + mime + ';base64,';
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  return prefix + alphabet.repeat(Math.ceil((length - prefix.length) / alphabet.length)).slice(0, length - prefix.length);
};
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+x0E0AAAAASUVORK5CYII=';
const photo = imageUrl(640_000);
const unicode = 'Quoted "notes": \\t\t\n\u0000 你好 😀 \ud800';
const wireWith = (text, ...urls) => [{ role: 'user', content: (text ? [textPart(text)] : []).concat(urls.map(imagePart)) }];
const size = wire => JSON.stringify(wire).length;
const { build } = fixtures(source);

if (process.argv.includes('--bench')) {
  const oldSource = fs.readFileSync(process.argv.at(-1), 'utf8');
  const old = fixtures(oldSource);
  for (let i = 1; i <= 55; i++) {
    const urls = [pixel, photo, imageUrl(i * 3700, 'webp'), imageUrl(4_000_000, 'jpeg')];
    const c = turn(i % 5 ? unicode.repeat(i) : '', ...urls.slice(0, i % 5));
    const history = [
      turn('prior text', ...urls.slice(0, i % 3)),
      { role: 'assistant', text: 'got it', toolCalls: [{ id: 'tool-λ', name: 'fixture', input: { count: i, text: unicode } }] },
      { role: 'tool', results: [{ id: 'tool-λ', content: unicode }] },
      c,
    ];
    const first = size(wireWith(c.text, ...(c.images || []).map(x => x.url)));
    for (const budget of [0, 12000, first - 1, first, first + 1, 20_000_000]) {
      assert.deepEqual(build(history, budget, i % 2 ? 1_700 : 160_000), old.build(history, budget, i % 2 ? 1_700 : 160_000));
    }
  }
  for (const [label, messages, scans] of [
    ['ordinary text', Array.from({ length: 30 }, (_, i) => turn(unicode.repeat(18) + i)), 400],
    ['one medium screenshot', [turn('earlier notes'), turn(unicode, photo)], 180],
    ['one high resolution screenshot', [turn('earlier notes'), turn(unicode, imageUrl(3_200_000, 'jpeg'))], 45],
    ['upper bound: four full URLs', [turn('earlier notes'), turn(unicode, ...Array(4).fill(imageUrl(4_000_000)))], 14],
  ]) {
    const buildWithCount = script => {
      let maxJSON = 0;
      const { build: control } = fixtures(script, { onSerialize(output) { maxJSON = Math.max(maxJSON, output.length); } });
      control(messages, 74_000);
      return maxJSON;
    };
    assert.deepEqual(build(messages, 74_000), old.build(messages, 74_000));
    const measure = fn => {
      const t0 = performance.now();
      for (let i = 0; i < scans; i++) fn(messages, 74_000);
      return (performance.now() - t0) / scans;
    };
    for (let i = 0; i < 18; i++) { old.build(messages, 74_000); build(messages, 74_000); }
    const a = [], b = [];
    for (let i = 0; i < 11; i++) {
      if (i % 2) { b.push(measure(build)); a.push(measure(old.build)); }
      else { a.push(measure(old.build)); b.push(measure(build)); }
    }
    const med = values => values.toSorted((x, y) => x - y)[values.length >> 1];
    console.log(JSON.stringify({ label, oldMs: med(a), newMs: med(b), oldTransientJsonChars: buildWithCount(oldSource), newTransientJsonChars: buildWithCount(source) }));
  }
  process.exit(0);
}

test('payload budgeting never allocates a full base64 JSON string', () => {
  const serialised = [];
  const counter = fixtures(source, { onSerialize(value) { serialised.push(value); } });
  const output = counter.build([turn(unicode, photo, pixel)], 60_000);
  assert.deepEqual(output, wireWith(unicode, photo, pixel));
  assert.equal(serialised.length, 1);
  assert.ok(serialised[0].length < 1_000, 'budget check must not stringify the full image payload');
});

test('image-bearing history preserves the exact UTF-16 cutoff including its non-ASCII and escaped text', () => {
  const older = turn(unicode, pixel, photo);
  const current = turn('Which image from the earlier message?');
  const legacyCost = size(wireWith(older.text, pixel, photo)) + size([{ role: 'user', content: current.text }]);
  assert.deepEqual(build([older, current], legacyCost, 16_000), [
    ...wireWith(older.text, pixel, photo), { role: 'user', content: current.text },
  ]);
  assert.deepEqual(build([older, current], legacyCost - 1, 16_000), [{ role: 'user', content: current.text }]);
  assert.deepEqual(build([older], 1, 16_000), wireWith(older.text, pixel, photo));
  assert.deepEqual(build([turn('', pixel)], 1, 16_000), wireWith('', pixel));
});

test('URL checks, maximum URL length, four-image scan and non-user filtering stay unchanged', () => {
  const largest = imageUrl(4_000_000, 'webp');
  const tooBig = largest + 'A';
  assert.deepEqual(build([turn('', ...Array(5).fill(largest))], 100), wireWith('', ...Array(4).fill(largest)));
  const text = 'keep the exact URL';
  assert.deepEqual(build([turn(text, tooBig, pixel + '\n', pixel.replace('png', 'svg'), pixel, imageUrl(900))], 500),
    wireWith(text, pixel)); // valid fifth slot still not examined
  const result = build([turn('first'), { role: 'assistant', text: unicode, images: [image(pixel)] }], 100_000);
  assert.deepEqual(result, [{ role: 'user', content: 'first' }, { role: 'assistant', content: unicode }]);
});

test('the public chat path still hands the provider the complete, unchanged image request', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-wire-image-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'ai-config.json'), JSON.stringify({
    routing: { mode: 'off' }, providers: { nim: { key: 'local-test', model: realProviders.PROVIDERS.nim.defaultModel } },
  }));
  const outgoing = [];
  const { create } = fixtures(source, { chat: async (providerId, options) => {
    outgoing.push({ providerId, stream: options.stream, messages: options.messages });
    options.onText('Found it', 'Found it');
    return { text: 'Found it', toolCalls: [] };
  } });
  const result = await create(dir).stream('local-attachment', [turn(unicode, pixel)], () => {}, {});
  assert.equal(result.text, 'Found it');
  assert.deepEqual(outgoing, [{ providerId: 'nim', stream: true, messages: wireWith(unicode, pixel) }]);
});

test('large shared image is revalidated when a later fan-out leg observes a different URL', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-image-registration-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'ai-config.json'), JSON.stringify({
    providers: { nim: { key: 'local-test', model: realProviders.PROVIDERS.nim.defaultModel } },
  }));
  const original = imageUrl(40_000, 'png');
  for (const { replacement, shouldUpload } of [
    { replacement: imageUrl(40_000, 'webp'), shouldUpload: true },
    { replacement: original.slice(0, -1) + '!', shouldUpload: false },
    { replacement: imageUrl(4_000_001, 'webp'), shouldUpload: false },
  ]) {
    const sameImage = { url: original };
    const calls = [];
    const { create } = fixtures(source, { chat: async (_provider, options) => {
      calls.push(options.messages.flatMap(message => Array.isArray(message.content)
        ? message.content.filter(part => part.type === 'image_url').map(part => part.image_url.url) : []));
      if (calls.length === 1) sameImage.url = replacement;
      return { text: calls.length === 1 ? 'First visual note.' : 'Complete answer.', toolCalls: [] };
    } });
    const result = await create(dir).stream('shared-image-check', [
      { role: 'user', text: 'Initial attachment.', images: [sameImage] },
      { role: 'user', text: 'Compare both attachments.', images: [sameImage] },
    ], () => {}, {});
    assert.equal(result.text, 'Complete answer.');
    assert.deepEqual(calls, [[original], shouldUpload ? [replacement] : []]);
  }
});
