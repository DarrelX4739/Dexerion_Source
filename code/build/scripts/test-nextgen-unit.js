'use strict';
// Dependency-free unit gate for the V51-V130 UI overhaul and V131-V180
// debloat programmes. Run directly with node; no Electron or Playwright needed.
//
//   node scripts/test-nextgen-unit.js  (from code/build/)
//   node code/build/scripts/test-nextgen-unit.js  (from the distributable root)

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BUILD = __dirname;
const ROOT = path.resolve(BUILD, '..');
const CODE_ROOT = path.resolve(ROOT, '..', 'code');
const SRC = path.join(CODE_ROOT, 'src', 'main');
const ASSETS = path.join(CODE_ROOT, 'assets');
const DOCS = path.join(CODE_ROOT, 'docs', 'website-report');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log('PASS ' + name); }
  catch (err) { failed += 1; console.error('FAIL ' + name + ': ' + (err && err.message ? err.message : err)); }
}
function read(file) { return fs.readFileSync(file, 'utf8'); }

const spec = require(path.join(SRC, 'nextgen-version-spec.js'));
const budgets = require(path.join(SRC, 'debloat-budgets.js'));

check('nextgen spec validates', () => {
  const result = spec.validateNextGenSpec();
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(spec.UI_VERSION_SPEC.length, 80);
  assert.equal(spec.DEBLOAT_VERSION_SPEC.length, 50);
});

check('tiers are contiguous and carry exactly four rules/checks', () => {
  const all = [...spec.UI_VERSION_SPEC, ...spec.DEBLOAT_VERSION_SPEC];
  all.forEach((entry, i) => {
    assert.equal(entry.version, i < 80 ? 51 + i : 131 + i - 80);
    assert.equal(entry.rules.length, 4);
    assert.equal(entry.checks.length, 4);
    entry.checks.forEach((id, c) => assert.equal(id, (entry.version >= 131 ? 'DV' : 'UIV') + entry.version + '-C' + (c + 1)));
  });
});

check('check IDs do not collide with the V31-V50 space', () => {
  const oldIds = new Set();
  for (let v = 21; v <= 30; v += 1) for (let c = 1; c <= 4; c += 1) oldIds.add('SV' + v + '-C' + c);
  for (let v = 11; v <= 20; v += 1) for (let c = 1; c <= 4; c += 1) oldIds.add('RV' + v + '-C' + c);
  const ids = [...spec.UI_VERSION_SPEC, ...spec.DEBLOAT_VERSION_SPEC].flatMap((e) => e.checks);
  assert.equal(new Set(ids).size, 520);
  assert.equal(ids.some((id) => oldIds.has(id)), false);
});

check('rejected UI overlay is absent from shell, internal pages and settings', () => {
  const shell = read(path.join(CODE_ROOT, 'src', 'renderer', 'shell.html'));
  const shellJs = read(path.join(CODE_ROOT, 'src', 'renderer', 'shell.js'));
  const settings = read(path.join(CODE_ROOT, 'src', 'renderer', 'pages', 'settings.html'));
  const browser = read(path.join(SRC, 'browser.js'));
  assert.doesNotMatch(shell, /ui-v2\.css/, 'shell must not load the rejected stylesheet');
  assert.doesNotMatch(shell, /ui-v2\.js/, 'shell must not load the rejected controller');
  assert.doesNotMatch(browser, /ui-v2\.css/, 'internal pages must not inject the rejected stylesheet');
  assert.doesNotMatch(shellJs, /DexUIv2|uiDensity/, 'density hook must not survive the revert');
  assert.doesNotMatch(settings, /uiDensity|uidensity|Interface density/, 'overlay density control must not survive the revert');
  assert.equal(fs.existsSync(path.join(ASSETS, 'ui-v2.css')), false);
  assert.equal(fs.existsSync(path.join(ASSETS, 'ui-v2.js')), false);
  assert.equal(/\bhttps?:\/\//i.test(shell), false, 'no runtime network URLs');
});

check('previous chrome and sidebar menu stay functional', () => {
  const css = read(path.join(CODE_ROOT, 'src', 'renderer', 'shell.css'));
  const shellHtml = read(path.join(CODE_ROOT, 'src', 'renderer', 'shell.html'));
  const shellJs = read(path.join(CODE_ROOT, 'src', 'renderer', 'shell.js'));
  const sidebar = read(path.join(CODE_ROOT, 'src', 'renderer', 'ai-sidebar.js'));
  const main = read(path.join(SRC, 'browser.js'));
  const skills = read(path.join(SRC, 'ai-skills.js'));
  // Functional menu repairs stay even though the visual overlay was reverted.
  assert.match(css, /\.ai-taskbar \{ position:relative; z-index:5;/, 'sidebar task bar must paint above the thread');
  assert.match(css, /#scrim \{ position:fixed; inset:0; z-index:260;/);
  assert.match(css, /#dmenu \{[\s\S]*?z-index:270;/);
  assert.match(css, /@keyframes pop \{ from \{ transform:translateY\(-6px\) scale\(\.98\); \} to \{ transform:none; \} \}/);
  assert.match(css, /\.mitem \{[\s\S]*?opacity:1;/);
  assert.match(shellJs, /Set the state and paint the overlay FIRST/);
  assert.doesNotMatch(css, /data-tone="ready"\] \{ color:var\(--ok/);
  // The agentic controls are real buttons, not dead menu copy.
  assert.match(shellHtml, /id="ai-agent-toggle"/);
  assert.match(shellHtml, /id="ai-vision-toggle"/);
  assert.match(shellHtml, /id="ai-set-websites"/);
  assert.match(shellHtml, /id="ai-set-documents"/);
  assert.doesNotMatch(shellHtml, /Pick a difficulty on the task bar/);
  assert.match(sidebar, /dex:ai-caps-get/);
  assert.match(sidebar, /type === 'capability-ask'/);
  assert.match(sidebar, /if \(effortBtn && effortMenu\)/);
  assert.match(sidebar, /if \(chipReply\)/);
  assert.match(main, /dex:ai-cap-decide/);
  assert.match(skills, /id: 'enable_agent'/);
  assert.match(skills, /id: 'use_vision'/);
  assert.match(skills, /id: 'open_website'/);
  assert.match(skills, /id: 'edit_document'/);
});

check('site/report CSP relaxations were not introduced', () => {
  const artifacts = read(path.join(SRC, 'ai-artifacts.js'));
  const host = read(path.join(SRC, 'ai-site-host.js'));
  assert.match(host, /img-src 'self' data: blob:/);
  assert.match(host, /connect-src 'self'/);
  assert.equal(/connect-src[^;]*https?:/i.test(host), false);
  assert.equal(/connect-src[^;]*https?:/i.test(artifacts), false);
});

check('debloat budgets halve or better the legacy worst cases', () => {
  const result = budgets.validateBudgets();
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.ok(result.optimized.siteRegistryBytes * 2 <= result.legacy.siteRegistryBytes);
  assert.equal(result.optimized.siteRegistryHosts * 2, result.legacy.siteRegistryHosts);
  assert.equal(result.optimized.diagnoseCacheEntries * 2, result.legacy.diagnoseCacheEntries);
  assert.equal(result.optimized.sweepIntervalMs / 2, result.legacy.sweepIntervalMs);
  assert.equal(result.optimized.previewMessageLimit * 2, result.legacy.previewMessageLimit);
});

check('debloat budgets are clamped and reversible', () => {
  assert.equal(budgets.clampBudget('sweepIntervalMs', 1), 15000);
  assert.equal(budgets.clampBudget('diagnoseCacheEntries', 999), 32);
  assert.equal(budgets.clampBudget('notARealBudget', 5), undefined);
});

check('runtime modules consume the named budgets', () => {
  const host = read(path.join(SRC, 'ai-site-host.js'));
  const browser = read(path.join(SRC, 'browser.js'));
  assert.match(host, /require\('\.\/debloat-budgets'\)/);
  assert.match(host, /BUDGETS\.siteRegistryBytes/);
  assert.match(host, /BUDGETS\.siteRegistryHosts/);
  assert.match(host, /BUDGETS\.previewMessageLimit/);
  assert.match(browser, /BUDGETS\.idleSleepMs/);
  assert.match(browser, /BUDGETS\.sweepIntervalMs/);
  assert.match(browser, /BUDGETS\.diagnoseCacheEntries/);
  assert.match(browser, /dex:debloat-metrics/);
});

check('plans and evidence cover every new tier exactly once', () => {
  const plan = read(path.join(DOCS, 'V51_V180_PLAN.md'));
  const evidence = read(path.join(DOCS, 'V51_V180_EVIDENCE.md'));
  const ids = [...spec.UI_VERSION_SPEC, ...spec.DEBLOAT_VERSION_SPEC].flatMap((e) => e.checks);
  for (const id of ids) {
    assert.equal(plan.split(id).length - 1, 1, 'plan missing or duplicating ' + id);
    assert.equal(evidence.split(id).length - 1, 1, 'evidence missing or duplicating ' + id);
  }
});

console.log('nextgen unit: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
