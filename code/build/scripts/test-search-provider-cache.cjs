'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createAiSearchRunner, CACHE_TTL_MS } = require('../../code/src/main/ai-search');

function response(url, larger, mode) {
  const u = new URL(url);
  const append = larger ? 'unused but valid profile metadata '.repeat(1000) : '';
  const title = 'Battery timing and measurement research';
  const page = 'https://' + (u.hostname === 'www.bing.com' ? 'rss' : 'doi') + '-fixture.example.org/measurement';
  if (u.hostname === 'www.bing.com')
    return '<rss><channel><!--' + append + '--><item><title>' + title + '</title><link>' + page
      + '</link><description>Battery reference data.</description><pubDate>Mar 5 2025 23:38:03</pubDate></item></channel></rss>';
  if (u.hostname === 'eutils.ncbi.nlm.nih.gov') {
    if (u.pathname.endsWith('esearch.fcgi')) return JSON.stringify({ esearchresult: { idlist:['24567701','24567702'] } });
    if (mode === 'broken-summary') return '[fixture invalid JSON ' + append;
    return JSON.stringify({ result: { uids:['24567701','24567702'],
      '24567701': { title, source:'Journal of synthetic controls', pubdate:'March 5, 2025 23:38:03', affiliations:[append] },
      '24567702': { title:'Different article', source:'Fixture', pubdate:'2025 Jan', affiliations:[append] } } });
  }
  if (u.hostname === 'api.crossref.org')
    return JSON.stringify({ message: { items: [ { title:[title], URL:page, abstract:'Fixture abstract',
      issued:{ 'date-parts':[[2025,3,5]] }, reference:[append] } ] } });
  return '';
}

async function exercise(larger, mode) {
  const requests = [];
  const fetchText = async (url) => {
    requests.push(url);
    return { ok:true, url, text:response(url,larger,mode) };
  };
  const runner = createAiSearchRunner({
    fetchText,
    async stream() { return { text:'{"queries":["battery engineering study","latency lab notes"]}' }; },
    openTab: (_win,url) => url, closeTab() {}, emit() {}, cancel() {},
    async readPage(_win,url) {
      return { url, title:'Battery timing and measurement research', text:'Battery timing and measurement under controlled load. '.repeat(30) };
    },
  });
  const prevDate = Date.now, prevZone = process.env.TZ;
  let now = 1741219200000;
  Date.now = () => now;
  const run = id => runner.gather({ reqId:id, query:'battery research study DOI', mode:'max', sources:16, planCount:2 });
  try {
    process.env.TZ = 'UTC';
    const cold = await run('cold');
    assert.ok(cold.sources.some(s => s.url.includes('rss-fixture.example.org')));
    assert.equal(cold.sources.some(s => s.url.includes('pubmed.ncbi')), mode !== 'broken-summary');
    assert.ok(requests.some(u => u.includes('/esearch.fcgi')));
    assert.ok(requests.some(u => u.includes('/esummary.fcgi')));
    const cacheable = u => /bing\.com|ncbi\.nlm\.nih\.gov|crossref\.org/.test(u);
    const before = requests.filter(cacheable);
    process.env.TZ = 'America/Los_Angeles';
    now += CACHE_TTL_MS - 1;
    const warm = await run('warm');
    assert.deepEqual(requests.filter(cacheable), before);
    const date = (result) => result.sources.find(s => s.url.includes('rss-fixture.example.org')).date;
    assert.equal(date(cold), '2025-03-05');
    assert.equal(date(warm), '2025-03-06');
    now += 1;
    const expired = await run('expired');
    assert.deepEqual(requests.filter(cacheable).sort(), before.concat(before).sort());
    return [cold,warm,expired];
  } finally {
    Date.now = prevDate;
    if (prevZone === undefined) delete process.env.TZ; else process.env.TZ = prevZone;
  }
}

test('large cacheable XML/JSON results retain ranking, dates and the exact cache lifetime', async () => {
  assert.deepEqual(await exercise(true,'normal'),await exercise(false,'normal'));
});

test('compacting a malformed large summary preserves empty-result behavior and later requests', async () => {
  assert.deepEqual(await exercise(true,'broken-summary'),await exercise(false,'broken-summary'));
});
