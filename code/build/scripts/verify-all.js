'use strict';
// Fast source-tree verification used by `npm run verify`.
//
// The full browser E2E suite lives in `e2e/` and is intentionally slower. This
// script catches syntax drift and broken version-spec invariants before a
// build: every source/e2e JavaScript file parses, the site/report version
// ladders have the promised contiguous tiers, the combined V31-V50 manifest
// maps one-to-one onto them, and the offline delivery contracts are intact.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BUILD = __dirname;
const ROOT = path.resolve(BUILD, '..');
const SRC = path.resolve(ROOT, '../code/src/main');
const E2E = path.join(ROOT, 'e2e');

function jsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = (p) => {
    for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function checkSyntax() {
  const files = [...jsFiles(SRC), ...jsFiles(E2E)];
  assert(files.length > 50, 'expected a substantial source tree, found ' + files.length + ' JS files');
  for (const file of files) {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  }
  return files.length;
}

function load(rel) {
  return require(path.resolve(SRC, rel));
}

function checkVersions() {
  const site = load('site-version-spec.js');
  const report = load('report-version-spec.js');
  const polish = load('polish-version-spec.js');
  const siteGen = load('site-generator-versions.js');
  const nextgen = load('nextgen-version-spec.js');

  assert(site.SITE_VERSION_SPEC.length === 30, 'site ladder must contain 30 tiers, got ' + site.SITE_VERSION_SPEC.length);
  assert(report.REPORT_VERSION_SPEC.length === 20, 'report ladder must contain 20 tiers, got ' + report.REPORT_VERSION_SPEC.length);
  assert(site.SITE_GENERATOR_VERSION === 30, 'site generator cap must be 30');
  assert(report.REPORT_GENERATOR_VERSION === 20, 'report generator cap must be 20');
  assert(siteGen.SITE_GENERATOR_VERSION === 30, 'site-generator-versions cap must be 30');
  assert(site.SITE_VERSION_SPEC.every((e, i) => e.version === i + 1 && e.rules.length === 4), 'site tiers must be contiguous with 4 rules');
  assert(report.REPORT_VERSION_SPEC.every((e, i) => e.version === i + 1 && e.rules.length === 4), 'report tiers must be contiguous with 4 rules');
  assert(polish.POLISH_VERSION_SPEC.length === 20, 'combined manifest must contain 20 tiers');
  assert(polish.POLISH_VERSION_SPEC.every((e) => e.version >= 31 && e.version <= 50 && e.summaries.length === 4), 'combined tiers must be V31-V50 with 4 summaries');
  if (typeof polish.validatePolishSpec === 'function') {
    const result = polish.validatePolishSpec();
    assert(result && result.ok, 'validatePolishSpec failed: ' + JSON.stringify(result && result.errors));
  }

  // V51-V180 continue the programme on a separate product ladder. They do not
  // alter the site/report prompts, but they obey the same four-improvement and
  // four-check tier contract as the previous 50 versions.
  const ui = nextgen.UI_VERSION_SPEC;
  const debloat = nextgen.DEBLOAT_VERSION_SPEC;
  assert(ui.length === 80, 'UI ladder must contain 80 tiers, got ' + ui.length);
  assert(debloat.length === 50, 'debloat ladder must contain 50 tiers, got ' + debloat.length);
  assert(nextgen.UI_FIRST_VERSION === 51 && nextgen.UI_LAST_VERSION === 130, 'UI ladder must be V51-V130');
  assert(nextgen.DEBLOAT_FIRST_VERSION === 131 && nextgen.DEBLOAT_LAST_VERSION === 180, 'debloat ladder must be V131-V180');
  const allNext = [...ui, ...debloat];
  assert(allNext.every((e, i) => e.version === (i < ui.length ? 51 + i : 131 + i - ui.length)), 'next-gen tiers must be contiguous');
  assert(allNext.every((e) => e.rules.length === 4 && e.rules.every((r) => typeof r === 'string' && r.trim())), 'every next-gen tier must have four non-empty rules');
  assert(allNext.every((e) => e.checks.length === 4 && e.checks.every((id, i) => id === (e.version >= 131 ? 'DV' : 'UIV') + e.version + '-C' + (i + 1))), 'next-gen check IDs must be stable');
  const nextResult = nextgen.validateNextGenSpec();
  assert(nextResult && nextResult.ok, 'validateNextGenSpec failed: ' + JSON.stringify(nextResult && nextResult.errors));

  const budgets = load('debloat-budgets.js');
  assert(budgets && budgets.BUDGETS && typeof budgets.BUDGETS.sweepIntervalMs === 'number', 'debloat budgets module must expose numeric budgets');
  assert(typeof budgets.clampBudget === 'function' && typeof budgets.validateBudgets === 'function', 'debloat budgets helpers must exist');
}

function checkContracts() {
  const sitePrompt = load('site-system-prompt.js').siteSystemPrompt(30);
  assert(sitePrompt.includes('exactly ONE object'), 'site prompt lost the one-index.html contract');
  assert(/online research|source material/i.test(sitePrompt), 'site prompt lost the online-source-as-material rule');
  assert(/base64 data URL|inline SVG|CSS artwork/.test(sitePrompt), 'site prompt lost the inline-asset rule');
  assert(sitePrompt.includes('FRONT-END REASONING'), 'site prompt lost the HTML/CSS/JS reasoning block');
  assert(sitePrompt.includes('JAVASCRIPT IS MANDATORY'), 'site prompt lost the mandatory-JavaScript rule');
  assert(sitePrompt.includes('VIEWPORT CONTRACT'), 'site prompt lost the full-screen preview contract');
  assert(/Apply silently/i.test(sitePrompt), 'reasoning block must stay silent, not instruct the model to print a plan');

  const artifacts = fs.readFileSync(path.resolve(SRC, 'ai-artifacts.js'), 'utf8');
  const renderer = fs.readFileSync(path.resolve(SRC, '..', '..', 'assets', 'ai-artifacts.js'), 'utf8');
  assert(artifacts.includes('REVISION CONTRACT'), 'revision prompt lost the edit-the-existing-artifact anchor');
  assert(artifacts.includes('JAVASCRIPT IS MANDATORY'), 'revision prompt lost the mandatory-JavaScript rule');
  assert(artifacts.includes('VIEWPORT CONTRACT'), 'revision prompt lost the full-screen preview contract');
  const host = fs.readFileSync(path.resolve(SRC, 'ai-site-host.js'), 'utf8');
  assert(/img-src 'self' data: blob:/.test(host), 'dexsite CSP lost data/blob imagery');
  assert(/connect-src 'self'/.test(host), 'dexsite CSP lost its self-only connect guard');
  assert(!/connect-src[^;]*https?:/i.test(host), 'dexsite CSP must never allow network origins');
  assert(!/connect-src[^;]*https?:/i.test(artifacts), 'export CSP must never allow network origins');
  assert(host.includes('DEX_VIEWPORT_FILL_CSS'), 'served sites lost the full-frame rendering guard');
  assert(renderer.includes('SITE_VIEWPORT_CSS'), 'srcdoc fallback lost the full-frame rendering guard');
  assert(/data-dex-viewport/.test(host) && /data-dex-viewport/.test(renderer), 'viewport guards drifted between served and srcdoc previews');
  assert(renderer.includes('opts.issueHost') && renderer.includes('dxa-preview-issues'), 'renderer lost the chat-level issue host');
  const viewer = fs.readFileSync(path.resolve(SRC, '..', 'renderer', 'pages', 'artifact.html'), 'utf8');
  assert(viewer.includes('dxa-site-preview') && viewer.includes('height: 100dvh'), 'standalone preview lost its full-height frame chain');
  assert(/dxa-site-preview \.dxa-page-body \{[^}]*margin: 0; width: 100%/.test(viewer), 'standalone preview inherited the centred 300px artifact body');
  assert(/dxa-site-preview \.dxa-issues,[\s\S]{0,160}display: none !important/.test(viewer), 'diagnostics can still cover the standalone preview');
  for (const id of ['siteWidths', 'btnPhone', 'btnTablet', 'btnDesktop']) {
    assert(!viewer.includes('id="' + id + '"'), 'standalone preview still exposes the ' + id + ' device control');
  }
  const aiMain = fs.readFileSync(path.resolve(SRC, 'ai.js'), 'utf8');
  const browserMain = fs.readFileSync(path.resolve(SRC, 'browser.js'), 'utf8');
  const aiProviders = fs.readFileSync(path.resolve(SRC, 'ai-providers.js'), 'utf8');
  assert(aiMain.includes('const catalogFetches = new Map()'), 'NIM catalogue refresh lost its in-flight dedupe');
  assert(aiMain.includes('const running = catalogFetches.get(fetchKey)'), 'NIM catalogue refresh no longer reuses an in-flight fetch');
  assert(!/if \(verdict\.ok\) \{[\s\S]{0,300}ai\.prewarm\(true\)/.test(browserMain), 'model verification still queues a redundant forced prewarm');
  assert(browserMain.includes('aiArtifacts.artifactRevisionPrompt(currentArtifact, instructions)'), 'site revision route lost the current-artifact anchor');
  assert(browserMain.includes('SITE REVISION MODE'), 'site revision route lost its no-new-subject system guard');
  const mainJs = fs.readFileSync(path.resolve(SRC, '..', '..', 'main.js'), 'utf8');
  assert(/testChat\(c\.provider, \{ apiKey: p\.key, model: model\.id, baseUrl: p\.baseUrl \}\)/.test(aiMain), 'Save & test lost the custom Base URL');
  assert(/testChat\(c\.provider, \{ apiKey: p\.key, model: m, baseUrl: p\.baseUrl \}\)/.test(aiMain), 'model verification lost the custom Base URL');
  assert(/patch\.baseUrl !== undefined[\s\S]{0,200}catalogues\.delete\(active\)/.test(aiMain), 'Base URL edits no longer invalidate the model catalogue');
  assert(/replace\(/.test(mainJs) && /Electron\|Dexerion/.test(mainJs), 'the browser UA still leaks an app token');
  assert(/web-contents-created/.test(mainJs) && /did-frame-navigate/.test(mainJs), 'cross-origin challenge frames can keep the default Electron UA');
  assert(/app\.userAgentFallback/.test(mainJs), 'cross-origin challenge iframes can keep Electron/Dexerion in navigator.userAgent without a clean app.userAgentFallback');
  assert(!/disable-site-isolation-trials/.test(mainJs), 'disabling site isolation breaks Cloudflare challenge iframes in Electron');
  assert(/Sec-CH-UA/.test(mainJs) && /Accept-Language/.test(mainJs), 'cleaned UA requests must carry consistent client-hint and language headers');
  assert(/CalculateNativeWinOcclusion/.test(mainJs), 'Windows occlusion misfires can mark focused windows hidden and fail Cloudflare challenges');
  assert(/setVisible\(true\)/.test(browserMain) && /view\.setVisible\(false\)/.test(browserMain), 'activated tab views no longer force document visibility visible');
  assert(/setUserAgent\(cleanUaString/.test(browserMain), 'tab webContents no longer scrub the app UA token');
  assert(/CUSTOM_ENDPOINT_HINT/.test(aiProviders), 'custom Base URL page errors are no longer explained clearly');
  assert(/KEY_PAGE_HOST/.test(aiProviders), 'console/key pages can still be used as custom API Base URLs');
  assert(/NET_CODE_MAYBE = new Set\(\[-21/.test(browserMain), 'transient network changes can still kill a challenge');
  assert(!/NET_CODE_OFFLINE = new Set\(\[-106[^\]]*-20/.test(browserMain), 'client-blocked loads are still treated as offline');
  assert(aiMain.includes('REASONING_CHAT_OUTPUT_TOKENS'), 'reasoning chat lost its larger output budget');
  assert(/maxTokens: e\.reasoningOnly \? MAX_OUTPUT_TOKENS/.test(aiMain), 'reasoning-only empty replies no longer retry with a larger budget');
  const settingsHtml = fs.readFileSync(path.resolve(ROOT, '../code/src/renderer/pages/settings.html'), 'utf8');
  assert(/dex:ai-baseurl-set[\s\S]{0,260}dex:ai-key-set[\s\S]{0,260}dex:ai-models-refresh/.test(settingsHtml), 'Save & test no longer commits Base URL before key/model refresh/test');
}

function checkPlan() {
  const plan = path.resolve(ROOT, '../code/docs/website-report/V31_V50_PLAN.md');
  assert(fs.existsSync(plan), 'V31_V50_PLAN.md is missing');
  const text = fs.readFileSync(plan, 'utf8');
  for (const v of [31, 40, 41, 50]) assert(text.includes('V' + v), 'plan does not mention V' + v);

  const nextPlan = path.resolve(ROOT, '../code/docs/website-report/V51_V180_PLAN.md');
  assert(fs.existsSync(nextPlan), 'V51_V180_PLAN.md is missing');
  const nextText = fs.readFileSync(nextPlan, 'utf8');
  for (const v of [51, 130, 131, 180]) assert(nextText.includes('V' + v), 'next-gen plan does not mention V' + v);
  for (const id of ['UIV51-C1', 'UIV130-C4', 'DV131-C1', 'DV180-C4']) {
    assert(nextText.includes(id), 'next-gen plan does not mention ' + id);
  }
}

const syntaxFiles = checkSyntax();
checkVersions();
checkContracts();
checkPlan();
console.log('verify-all: ' + syntaxFiles + ' files parsed; site 30 / report 20 / combined V31-V50 / ui V51-V130 / debloat V131-V180 contracts OK');
