'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { test } = require('node:test');

const file = path.resolve(__dirname, '../../code/src/main/ai-search.js');
const endpoint = 'https://article.example.com/guide';
const excerpt = 'An authoritative page about this useful topic, with enough detail to qualify. '.repeat(9);

function load(file, clock) {
  const requireApp = createRequire(file);
  const original = fs.readFileSync(file, 'utf8');
  const close = 'return { run, gather, stop, releaseWindow };';
  assert.ok(original.includes(close));
  const code = original.replace(close, 'return { run, gather, stop, releaseWindow, entries: () => Array.from(fetchCache) };');
  const module = { exports: {} };
  class FixedDate extends Date { static now() { return clock.now; } }
  new Function('require', 'module', 'Date', code)(requireApp, module, FixedDate);
  return module.exports;
}

function webResponse(url, setting) {
  if (url.hostname.includes('duckduckgo')) {
    if (setting.malformed) return '<a class="result__a" href="' + endpoint + '">&#9999999;</a>' + ' '.repeat(48_000);
    const markup = '<ul><li><a class="result__a" href="' + endpoint + '?utm_source=provider#section">Guide &amp; review 😀</a>'
      + '<a class="result__snippet" href="#">Short source text &quot;with quotes&quot;</a>'
      + '<span class="result__timestamp">February 1, 2024 23:45:00</span></li>'
      + '<li><a class="result__a" href="https://www.google.com/search?q=test">Must not be opened</a></li></ul>';
    return '<html><body>' + markup + '<!-- unrelated response bytes -->'.repeat(setting.large ? 3_000 : 0) + '</body></html>';
  }
  const unused = setting.largeOther ? 'Fixture metadata '.repeat(1800) : '';
  if (url.hostname.includes('bing')) return '<rss><channel><!--' + unused + '--><item><title>Duplicate copy</title>'
    + '<link>' + endpoint + '</link><description>Richer comparison text repeated in this source.</description></item></channel></rss>';
  if (url.hostname.endsWith('wikipedia.org'))
    return JSON.stringify({ pages:[{ title:'History',key:'History_fixture',excerpt:'Notes',description:unused }] });
  if (url.pathname.endsWith('esearch.fcgi'))
    return JSON.stringify({ esearchresult: { idlist:[47,15], querytranslation:unused } });
  if (url.pathname.endsWith('esummary.fcgi')) {
    return JSON.stringify({ result: { uids:[47,15], 47:{title:'Study fixture',pubdate:'2024 Jan 2',affiliations:[unused]}, 15:{title:'Other study'} } });
  }
  if (url.hostname.includes('arxiv.org')) return '<feed><entry><title>Review</title><id>https://arxiv.org/abs/2345</id><summary>Review text</summary></entry></feed>';
  return '{"message":{"items":[]}}';
}

function fixture(impl, settings = {}) {
  const trace = { request: [], opened: [], closed: [], cancelled: [], events: [] };
  const options = { large: true, ...settings };
  let serial = 0;
  let plan = 'unique topic';
  const runner = impl.createAiSearchRunner({
    async fetchText(u, rest) {
      const url = new URL(u);
      trace.request.push(u);
      if (options.hold && url.hostname.includes('duckduckgo')) await options.hold(rest.signal);
      if (options.fail && url.hostname.includes('duckduckgo')) return { ok: false, text: 'Unavailable' };
      if (options.empty && url.hostname.includes('duckduckgo')) return { ok: true, text: '' };
      return { ok: true, url: u, text: webResponse(url, options), contentType: 'text/plain' };
    },
    async stream(reqId, _messages, onText) {
      if (reqId.endsWith(':plan')) return { text: JSON.stringify({ queries: [plan + ' definition', plan + ' application'] }) };
      onText('Grounded answer [1]', 'Grounded answer [1]');
      return { text: 'Grounded answer [1]' };
    },
    emit(_wid, event) { trace.events.push(event); },
    cancel(id) { trace.cancelled.push(id); },
    openTab(_wid, u) { trace.opened.push(u); return u; },
    closeTab(_wid, u) { trace.closed.push(u); },
    async readPage(_wid, u) { return { url: u, title: '', text: excerpt }; },
  });
  function search(topic, synth = false, query = 'Explain this topic', reqId) {
    plan = topic;
    return runner[synth ? 'run' : 'gather']({ query, mode: 'quick', reqId: reqId || 'cache-' + (++serial), winId: 1, planCount: 2 });
  }
  return { trace, options, runner, search };
}

const at = Date.UTC(2026, 8, 1, 12);
const makeFixture = options => {
  const clock = { now: at };
  const impl = load(file, clock);
  return { ...fixture(impl, options), clock, impl };
};

test('warm search reads and ranks the same pages and reruns local date normalization', async t => {
  const oldTZ = process.env.TZ;
  t.after(() => { if (oldTZ === undefined) delete process.env.TZ; else process.env.TZ = oldTZ; });
  process.env.TZ = 'Asia/Tokyo';
  const f = makeFixture();
  const first = await f.search('explanation');
  const docs = result => result.sources.find(item => item.url.startsWith(endpoint));
  assert.equal(docs(first).date, '2024-02-01');
  process.env.TZ = 'America/New_York';
  const second = await f.search('explanation');
  assert.equal(docs(second).date, '2024-02-02');
  assert.equal(f.trace.request.length, 6, 'warm hits must not issue network fetches');
  const comparable = result => result.sources.map(row => ({ ...row, date: '' }));
  assert.deepEqual(comparable(first), comparable(second));
  assert.ok(!f.trace.opened.some(u => /google\.com/.test(u)));
  assert.deepEqual(f.trace.opened, f.trace.closed);
});

test('large provider HTML is released; small HTML/XML/JSON stay in the raw cache', async () => {
  const f = makeFixture();
  await f.search('large');
  f.options.large = false;
  await f.search('small');
  const entries = f.runner.entries();
  assert.equal(entries.length, 12);
  let compactCount = 0;
  for (const [url, entry] of entries) {
    if (url.includes('duckduckgo.com') && url.includes('large')) {
      assert.equal(entry.body, '', 'cache retained the full DuckDuckGo response');
      assert.ok(Buffer.isBuffer(entry.providerRows) && entry.providerRows.byteLength < 2_048);
      compactCount++;
    } else {
      assert.ok(entry.body);
      assert.equal(entry.providerRows, undefined);
    }
  }
  assert.equal(compactCount, 2);
});

test('large XML/JSON result payloads compact but PubMed e-search IDs keep their raw body', async () => {
  const f = makeFixture({ largeOther:true });
  await f.search('archive', false, 'Find the scientific studies');
  const stored = f.runner.entries();
  for (const part of ['bing.com','wikipedia.org','esummary.fcgi']) {
    const candidates = stored.filter(([url]) => url.includes(part));
    assert.ok(candidates.length, 'missing ' + part);
    for (const [,entry] of candidates) {
      assert.equal(entry.body, '');
      assert.ok(Buffer.isBuffer(entry.providerRows) && entry.providerRows.byteLength < 2048);
    }
  }
  for (const [,entry] of stored.filter(([url]) => url.includes('esearch.fcgi'))) {
    assert.ok(entry.body.length >= 16384);
    assert.equal(entry.providerRows, undefined);
  }
  const requests = f.trace.request.slice();
  await f.search('archive', false, 'Find the scientific studies');
  assert.deepEqual(f.trace.request, requests);
});

test('expiry, size resets, failed and malformed responses, and PubMed two-step remain unchanged', async () => {
  const f = makeFixture();
  await f.search('expiry');
  f.clock.now += f.impl.CACHE_TTL_MS - 1;
  await f.search('expiry');
  assert.equal(f.trace.request.length, 6);
  f.clock.now++;
  await f.search('expiry');
  assert.equal(f.trace.request.length, 12);
  for (let i = 0; i < 13; i++) await f.search('unique ' + i);
  assert.equal(f.trace.request.length, 90);
  assert.equal(f.runner.entries().length, 2, 'capacity still clears the same cache on miss');

  const invalid = makeFixture({ malformed: true });
  await invalid.search('malformed');
  await invalid.search('malformed');
  assert.equal(invalid.trace.request.length, 6, 'nonempty malformed bodies are still warm');
  assert.ok(invalid.trace.opened.every(url => !url.includes('utm_source=provider')));
  for (const option of ['fail', 'empty']) {
    const broken = makeFixture({ [option]: true });
    await broken.search('no hits');
    await broken.search('no hits');
    assert.equal(broken.trace.request.length, 8, 'failed/empty response remains uncached');
  }

  const mixed = makeFixture();
  await mixed.search('science', false, 'Find the scientific studies');
  const requests = mixed.trace.request.slice();
  assert.ok(requests.some(u => u.includes('esearch.fcgi')));
  assert.ok(requests.some(u => u.includes('esummary.fcgi') && u.includes('id=47%2C15')));
  await mixed.search('science', false, 'Find the scientific studies');
  assert.deepEqual(mixed.trace.request, requests);
});

test('stopping an in-flight request still forwards the abort without caching a failed fetch', async () => {
  let sawAbort = 0;
  let go;
  const held = new Promise(resolve => { go = resolve; });
  const f = makeFixture({
    hold: async signal => {
      go();
      await new Promise((resolve, reject) => {
        if (signal.aborted) { sawAbort++; reject(new Error('Stopped')); return; }
        signal.addEventListener('abort', () => { sawAbort++; reject(new Error('Stopped')); }, { once: true });
      });
    },
  });
  const run = f.search('pending', true, 'Explain', 'stopped');
  await held;
  assert.ok(f.runner.stop('stopped'));
  const result = await run;
  assert.equal(result.cancelled, true);
  assert.ok(sawAbort > 0);
  assert.equal(f.runner.entries().filter(([u]) => u.includes('duckduckgo.com')).length, 0);
  assert.deepEqual(f.trace.cancelled, ['stopped:plan', '']);
  assert.deepEqual(f.trace.opened, []);
});

if (process.argv.includes('--compare')) {
  const old = path.resolve(process.argv.at(-1), 'code/code/src/main/ai-search.js');
  test('full old-source output and user-visible progress parity across cold, warm and refreshed scans', async () => {
    async function exercise(source, opts) {
      const clock = { now: at };
      const impl = load(source, clock);
      const f = fixture(impl, opts);
      const results = [];
      for (let i = 0; i < 6; i++) {
        const query = i % 2 ? 'Find studies on the topic' : 'Explain this subject';
        results.push(await f.search('same fixture', i % 2 === 1, query));
        clock.now += i === 3 ? impl.CACHE_TTL_MS : 1;
      }
      return { results, trace: f.trace };
    }
    for (const opts of [{}, { large: false }, { malformed: true }, { fail: true }, { empty: true }]) {
      assert.deepEqual(await exercise(file, opts), await exercise(old, opts));
    }
  });
}
