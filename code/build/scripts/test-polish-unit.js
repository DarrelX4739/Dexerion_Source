'use strict';
// Dependency-free Node unit checks for the V31–V50 polish programme.
//
// No Electron, no Playwright, no package.json script. Run directly:
//   node code/build/scripts/test-polish-unit.js
// (from the repository root), or:
//   node scripts/test-polish-unit.js
// (from code/build/). All paths are resolved relative to this file.
//
// Covers the pure modules behind the revised E2E suite: the combined manifest,
// the site/report source specs, the offline-asset contract (site-research-assets
// policy), site-quality, site-interactivity, site-policy and the ai-mock
// research fixtures used by DEX_SEARCH_BASE.

const assert = require('node:assert/strict');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'code', 'src', 'main');
const { POLISH_VERSION_SPEC, POLISH_FIRST_VERSION, POLISH_LAST_VERSION, validatePolishSpec, combinedVersionFor, sourceFor, acceptanceSummariesThrough } = require(path.join(SRC, 'polish-version-spec'));
const { SITE_VERSION_SPEC, SITE_GENERATOR_VERSION } = require(path.join(SRC, 'site-version-spec'));
const { REPORT_VERSION_SPEC, REPORT_GENERATOR_VERSION } = require(path.join(SRC, 'report-version-spec'));
const { validateSiteQuality } = require(path.join(SRC, 'ai-site-quality'));
const { analyze } = require(path.join(SRC, 'site-interactivity'));
const { isHttpUrl, urlAllowed } = require(path.join(SRC, 'site-policy'));
const { scanRemoteReferences, inlineAssetBudget, isSingleIndexHtml, hasAttribution } = require(path.join(__dirname, '..', 'e2e', 'offline-html'));
const { normalizeArtifact } = require(path.join(SRC, 'ai-artifacts'));
const {
  MAX_ASSETS,
  MAX_ASSET_RAW_BYTES,
  MAX_TOTAL_BASE64_CHARS,
  isRemote,
  isAllowedImageType,
  extractImageUrls,
  collectResearchCandidates,
  fetchSiteAssets,
  researchEvidenceBlock,
  inlineSiteAssets,
} = require(path.join(SRC, 'site-research-assets'));

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('PASS  ' + name);
  } catch (err) {
    failed += 1;
    console.error('FAIL  ' + name + '\n      ' + (err && err.message || err));
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log('PASS  ' + name);
  } catch (err) {
    failed += 1;
    console.error('FAIL  ' + name + '\n      ' + (err && err.message || err));
  }
}

const INLINE_FIXTURE = [
  '<!doctype html><html lang="en"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<title>Offline Unit Fixture</title>',
  '<meta name="description" content="An offline single-file fixture.">',
  '<style>:root{--ink:#15202b;--accent:#2a6db0}',
  '*{box-sizing:border-box}body{margin:0;padding:16px;font-family:system-ui;color:var(--ink)}',
  'main{max-width:640px;margin:0 auto}button{min-height:44px}',
  '@media(prefers-reduced-motion:reduce){*{transition:none}}</style></head><body>',
  '<main><h1>Offline Unit Fixture</h1><p id="status" role="status" aria-live="polite">Ready</p>',
  '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" alt="One pixel test tile" data-dex-credit="Source: Example Commons — CC BY 4.0.">',
  '<svg viewBox="0 0 10 10" role="img" aria-label="Square"><rect width="10" height="10" fill="var(--accent)"></rect></svg>',
  '<button type="button" data-act="add" id="add">Add</button><ul id="list"></ul></main>',
  '<footer>Source: Example Commons — CC BY 4.0.</footer>',
  '<script>document.addEventListener("click",function(e){',
  'if(e.target.closest("button[data-act]"))document.getElementById("status").textContent="Clicked";',
  '});</script></body></html>',
].join('\n');

const STATIC_FIXTURE = [
  '<!doctype html><html lang="en"><head><meta charset="utf-8">',
  '<title>Static</title></head><body><main><h1>Static</h1><button>Click</button></main></body></html>',
].join('\n');

// --- Combined manifest -------------------------------------------------------
check('combined manifest spans V31–V50 with 20 contiguous tiers', () => {
  assert.equal(POLISH_FIRST_VERSION, 31);
  assert.equal(POLISH_LAST_VERSION, 50);
  assert.equal(POLISH_VERSION_SPEC.length, 20);
  POLISH_VERSION_SPEC.forEach((entry, i) => assert.equal(entry.version, 31 + i));
});

check('validatePolishSpec() reports no errors', () => {
  const result = validatePolishSpec();
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

check('every combined tier carries exactly four non-empty acceptance summaries', () => {
  for (const entry of POLISH_VERSION_SPEC) {
    assert.equal(entry.summaries.length, 4, 'V' + entry.version);
    assert.equal(entry.acceptance, entry.summaries, 'V' + entry.version);
    for (const summary of entry.summaries) assert.ok(typeof summary === 'string' && summary.trim());
  }
  assert.equal(acceptanceSummariesThrough(50).length, 80);
});

check('site V21–V30 maps to V31–V40; report V11–V20 maps to V41–V50 (reversible)', () => {
  for (let v = 21; v <= 30; v += 1) {
    assert.equal(combinedVersionFor('site', v), v + 10);
    assert.equal(sourceFor(v + 10).version, v);
    assert.equal(sourceFor(v + 10).product, 'site');
  }
  for (let v = 11; v <= 20; v += 1) {
    assert.equal(combinedVersionFor('report', v), v + 30);
    assert.equal(sourceFor(v + 30).version, v);
    assert.equal(sourceFor(v + 30).product, 'report');
  }
});

check('check-ID space is 40 site + 40 report IDs with no collision', () => {
  const ids = [];
  for (let v = 21; v <= 30; v += 1) for (let c = 1; c <= 4; c += 1) ids.push('SV' + v + '-C' + c);
  for (let v = 11; v <= 20; v += 1) for (let c = 1; c <= 4; c += 1) ids.push('RV' + v + '-C' + c);
  assert.equal(ids.length, 80);
  assert.equal(new Set(ids).size, 80);
  assert.equal(ids.filter((id) => id.startsWith('SV')).length, 40);
  assert.equal(ids.filter((id) => id.startsWith('RV')).length, 40);
});

// --- Source specs ------------------------------------------------------------
check('source caps are site 30 / report 20 and every new tier has four rules', () => {
  assert.equal(SITE_GENERATOR_VERSION, 30);
  assert.equal(REPORT_GENERATOR_VERSION, 20);
  for (let v = 21; v <= 30; v += 1) {
    const tier = SITE_VERSION_SPEC.find((t) => t.version === v);
    assert.ok(tier, 'site V' + v);
    assert.equal(tier.rules.length, 4, 'site V' + v);
  }
  for (let v = 11; v <= 20; v += 1) {
    const tier = REPORT_VERSION_SPEC.find((t) => t.version === v);
    assert.ok(tier, 'report V' + v);
    assert.equal(tier.rules.length, 4, 'report V' + v);
  }
});

check('site V21 asset caps and V30 single-file offline gate are present in the spec', () => {
  const v21 = SITE_VERSION_SPEC.find((t) => t.version === 21).rules.join(' ');
  assert.match(v21, /120KB/);
  assert.match(v21, /400KB/);
  const v30 = SITE_VERSION_SPEC.find((t) => t.version === 30).rules.join(' ');
  assert.match(v30, /index\.html/);
  assert.match(v30, /remote references|https?/i);
});

// --- site-research-assets: online source -> offline delivery -----------------
check('site-research-assets exposes bounded, image-only source policy', () => {
  assert.equal(MAX_ASSETS, 4);
  assert.equal(MAX_ASSET_RAW_BYTES, 96 * 1024);
  assert.equal(MAX_TOTAL_BASE64_CHARS, 256 * 1024);
  // The generator's own budget is tighter than the delivered 400KB ceiling.
  assert.ok(MAX_TOTAL_BASE64_CHARS <= 400 * 1024);
  assert.equal(isRemote('https://example.com/a.png'), true);
  assert.equal(isRemote('http://example.com/a.png'), true);
  assert.equal(isRemote('//example.com/a.png'), true);
  assert.equal(isRemote('data:image/png;base64,AAAA'), false);
  assert.equal(isAllowedImageType('image/png; charset=binary'), true);
  assert.equal(isAllowedImageType('image/webp'), true);
  // SVG is deliberately not fetchable as a candidate; inline SVG is authored.
  assert.equal(isAllowedImageType('image/svg+xml'), false);
});

check('research candidates prefer user URLs, then source images, then page text', () => {
  const candidates = collectResearchCandidates({
    userText: 'See https://user.example/hero.png',
    sources: [{
      url: 'https://source.example/page',
      imageUrl: 'https://cdn.example/photo.jpg',
      title: 'Example source',
      date: '2026-11-21',
      text: 'Inline: https://article.example/diagram.webp',
    }],
    researchText: 'Also https://research.example/picture.gif',
  });
  const urls = candidates.map((c) => c.url);
  assert.ok(urls.indexOf('https://user.example/hero.png') < urls.indexOf('https://cdn.example/photo.jpg'));
  assert.ok(urls.indexOf('https://cdn.example/photo.jpg') < urls.indexOf('https://source.example/page'));
  assert.ok(urls.includes('https://article.example/diagram.webp'));
  assert.ok(urls.includes('https://research.example/picture.gif'));
  assert.ok(candidates.length <= 12);
  assert.equal(candidates[0].source, 'user.example');
  assert.equal(extractImageUrls('![alt](https://md.example/a.png)').includes('https://md.example/a.png'), true);
});

// --- site-research-assets policy (pure offline helper) -----------------------
check('remote scan catches resource, anchor, CSS and scripted network references', () => {
  const hostile = [
    '<script src="https://cdn.example/a.js"></script>',
    '<link rel="stylesheet" href="https://cdn.example/a.css">',
    '<img src="http://cdn.example/a.png">',
    '<style>.x{background:url(https://cdn.example/b.png)}</style>',
    '<video poster="https://cdn.example/poster.jpg"></video>',
    '<a href="https://remote.example/credit">Credit</a>',
    '<script>fetch("https://api.example/x");new WebSocket("wss://api.example/s");</script>',
  ].join('\n');
  const found = scanRemoteReferences(hostile);
  for (const context of ['script-src', 'link-href', 'img-srcset', 'css-url', 'media-resource', 'anchor-href', 'fetch-or-import', 'websocket']) {
    assert.ok(found.some((f) => f.context === context), context);
  }
});

check('inline fixture has zero remote references and stays inside all asset caps', () => {
  assert.deepEqual(scanRemoteReferences(INLINE_FIXTURE), []);
  const budget = inlineAssetBudget(INLINE_FIXTURE);
  assert.ok(budget.perAssetBytes.length >= 1);
  assert.equal(budget.perAssetOk, true);
  assert.equal(budget.totalOk, true);
  assert.equal(budget.documentOk, true);
  assert.ok(budget.inlineSvgs >= 1);
});

check('one index.html recogniser and visible attribution recogniser', () => {
  assert.equal(isSingleIndexHtml([{ path: 'index.html', content: INLINE_FIXTURE }]), true);
  assert.equal(isSingleIndexHtml([{ path: 'INDEX.HTML', content: INLINE_FIXTURE }]), true);
  assert.equal(isSingleIndexHtml([
    { path: 'index.html', content: INLINE_FIXTURE },
    { path: 'styles.css', content: 'body{}' },
  ]), false);
  assert.equal(isSingleIndexHtml([]), false);
  assert.equal(hasAttribution(INLINE_FIXTURE), true);
  assert.equal(hasAttribution(INLINE_FIXTURE.replace(/Source:.*?<\/footer>/, '</footer>')), false);
});

// --- site-quality / interactivity / policy -----------------------------------
check('site-quality accepts the inline single-file fixture', () => {
  const result = validateSiteQuality([{ path: 'index.html', content: INLINE_FIXTURE }]);
  assert.equal(result.ok, true, JSON.stringify(result.issues.map((i) => i.code + ': ' + i.message)));
});

check('site-quality flags a remote asset in a stylesheet', () => {
  const result = validateSiteQuality([
    { path: 'index.html', content: INLINE_FIXTURE },
    { path: 'styles.css', content: '.x{background:url(https://cdn.example/a.png)}' },
  ]);
  assert.ok(result.issues.some((i) => i.code === 'offline-asset'));
});

check('site-quality flags missing alt text and static controls', () => {
  const noAlt = validateSiteQuality([{ path: 'index.html', content: INLINE_FIXTURE.replace(' alt="One pixel test tile"', '') }]);
  assert.ok(noAlt.issues.some((i) => i.code === 'img-alt'));
  const staticSite = validateSiteQuality([{ path: 'index.html', content: STATIC_FIXTURE }]);
  assert.ok(staticSite.issues.some((i) => i.code === 'no-behavior'));
  const wired = validateSiteQuality([{ path: 'index.html', content: INLINE_FIXTURE }]);
  assert.ok(!wired.issues.some((i) => i.code === 'no-behavior'));
});

check('site-interactivity recognises the delegated listener and rejects dead controls', () => {
  const wired = analyze(INLINE_FIXTURE);
  assert.equal(wired.interactive, true);
  assert.equal(wired.deadCount, 0);
  assert.ok(wired.controls >= 1);
  const dead = analyze(STATIC_FIXTURE);
  assert.equal(dead.interactive, false);
  assert.ok(dead.deadCount >= 1);
  assert.ok(dead.issues.length >= 1);
});

check('site-policy treats data URLs as offline and blocks unlisted http hosts', () => {
  assert.equal(isHttpUrl('https://example.com'), true);
  assert.equal(isHttpUrl('data:image/gif;base64,AAAA'), false);
  assert.equal(urlAllowed('https://example.com/x', []), false);
  assert.equal(urlAllowed('data:image/gif;base64,AAAA', []), true);
});

check('report images keep embedded data URLs and research placeholders', () => {
  const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
  const wrapped = 'data:image/png;base64,\n  iVBORw0KGgoAAAANSUh\n EUgAAAAEAAAAB';
  const checked = normalizeArtifact({
    kind: 'report', title: 'Images', subtitle: 'Offline imagery',
    summary: 'A report with embedded images.', theme: 'clean',
    blocks: [
      { type: 'image', src: dataUrl, alt: 'Embedded', caption: 'Inline image' },
      { type: 'image', src: wrapped, alt: 'Wrapped' },
      { type: 'image', src: 'dexref2', alt: 'Research' },
      { type: 'image', src: 'javascript:alert(1)', alt: 'Blocked' },
    ],
  });
  assert.equal(checked.ok, true);
  const images = checked.artifact.blocks.filter((b) => b.type === 'image');
  assert.equal(images.length, 3, 'unsafe image sources must be dropped, valid ones kept');
  assert.equal(images[0].src, dataUrl);
  assert.equal(images[1].src, dataUrl, 'base64 must survive whitespace compaction');
  assert.doesNotMatch(images[1].src, /\s/);
  assert.equal(images[2].src, 'dexref2');
});

// --- async pure-module checks (still no Electron) ----------------------------
let researchAsset = null;

(async () => {
  await checkAsync('fetchSiteAssets inlines capped raster assets and rejects unsafe candidates', async () => {
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const result = await fetchSiteAssets([
      { url: 'https://cdn.example/hero.png', source: 'cdn.example', title: 'Hero', credit: 'Example Commons — CC BY 4.0' },
      { url: 'https://cdn.example/oversized.png', source: 'cdn.example' },
      { url: 'https://cdn.example/vector.svg', source: 'cdn.example' },
    ], {
      fetchBinary: async (url) => {
        if (url.includes('oversized')) return { ok: true, url, contentType: 'image/png', bytes: Buffer.alloc(MAX_ASSET_RAW_BYTES + 1) };
        if (url.includes('vector')) return { ok: true, url, contentType: 'image/svg+xml', bytes };
        return { ok: true, url, contentType: 'image/png; charset=binary', bytes };
      },
    });
    assert.equal(result.assets.length, 1);
    assert.equal(result.assets[0].id, 'dexref1');
    assert.match(result.assets[0].dataUrl, /^data:image\/png;base64,/);
    assert.equal(result.assets[0].rawBytes, bytes.length);
    assert.ok(result.totalBase64Chars <= MAX_TOTAL_BASE64_CHARS);
    assert.ok(result.errors.some((e) => /byte cap/i.test(e)));
    assert.ok(result.errors.some((e) => /unsupported image type/i.test(e)));
    researchAsset = result.assets[0];
  });

  await checkAsync('research evidence block names placeholders and visible credit, never base64', () => {
    assert.ok(researchAsset, 'fetchSiteAssets check must run first');
    const block = researchEvidenceBlock([researchAsset], { text: 'A reserved example-domain article.' });
    assert.match(block, /<site-research-assets>/);
    assert.match(block, /dexref1/);
    assert.match(block, /Example Commons/);
    assert.match(block, /visible plain-text credit/i);
    assert.doesNotMatch(block, /data:image\/png;base64,/);
  });

  await checkAsync('inlineSiteAssets inlines, scrubs remote URLs and adds visible attribution', () => {
    assert.ok(researchAsset, 'fetchSiteAssets check must run first');
    const hostileHtml = [
      '<!doctype html><html><head>',
      '<link rel="stylesheet" href="https://cdn.example/theme.css">',
      '<style>.hero{background:url(https://cdn.example/bg.png)}</style>',
      '</head><body><main><h1>Gallery</h1>',
      '<img src="dexref1" data-dex-asset="dexref1" alt="Hero">',
      '<a href="https://remote.example/credit">Credit the source</a>',
      '</main></body></html>',
    ].join('\n');
    const result = inlineSiteAssets([{ path: 'index.html', content: hostileHtml }], [researchAsset]);
    const html = String(result.files[0].content);
    assert.match(html, /data:image\/png;base64,/);
    assert.doesNotMatch(html, /\bdexref1\b/);
    assert.match(html, /data-dex-attribution="1"/);
    assert.match(html, /cdn\.example/);
    assert.ok(result.stats.resources >= 1, JSON.stringify(result.stats));
    assert.equal(result.stats.links, 1);
    assert.equal(result.stats.css, 1);
    assert.deepEqual(scanRemoteReferences(html), []);
    assert.ok(result.warnings.some((w) => /offline-safe/i.test(w)));
    assert.ok(result.warnings.some((w) => /plain text/i.test(w)));
  });

  // --- ai-mock research fixtures (no Electron) ---------------------------------
  await checkAsync('ai-mock serves the DEX_SEARCH_BASE research fixtures without Electron', async () => {
    const { startAiMock } = require(path.join(__dirname, '..', 'e2e', 'ai-mock'));
    const mock = await startAiMock();
    try {
      const base = mock.url.replace(/\/v1$/, '');
      const serp = await fetch(base + '/html/q=example%20domain');
      assert.equal(serp.status, 200);
      const serpBody = await serp.text();
      assert.match(serpBody, /result__a/);
      assert.match(serpBody, /article\?p=1/);
      const article = await fetch(base + '/article?p=1');
      assert.equal(article.status, 200);
      const articleBody = await article.text();
      assert.match(articleBody, /<article>/);
      assert.match(articleBody, /Example Domain/);
      assert.ok(mock.fetches.some((u) => u.startsWith('/html/')));
      assert.ok(mock.fetches.some((u) => u.startsWith('/article')));
    } finally {
      await mock.close();
    }
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})();
