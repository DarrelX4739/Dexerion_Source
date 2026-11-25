// Audit probe for the website/report systems. Read-only: calls the real
// main-side functions on tricky inputs and prints what actually happens.
'use strict';
const A = require('../code/src/main/ai-artifacts');

const show = (label, v) => console.log('\n=== ' + label + ' ===\n' + v);

// 1. Multi-page site: index links to about.html
{
  const site = {
    kind: 'site', title: 'Two pages',
    files: [
      { path: 'index.html', content: '<html><body><h1>Home</h1><a href="about.html">About</a><a href="#top">Top</a></body></html>' },
      { path: 'about.html', content: '<html><body><h1>About</h1></body></html>' },
    ],
  };
  const r = A.normalizeArtifact(site);
  show('1) multi-page normalize', JSON.stringify({ ok: r.ok, warnings: r.warnings, html: String(r.artifact && r.artifact.html).slice(0, 300) }, null, 1));
  const diag = A.diagnoseArtifact(r.artifact);
  show('1b) diagnose multi-page', JSON.stringify(diag, null, 1));
}

// 2. Storage + fetch usage (what the preview does with them)
{
  const site = {
    kind: 'site', title: 'Stateful',
    files: [
      { path: 'index.html', content: '<html><body><div id="n"></div><script src="app.js"></script></body></html>' },
      { path: 'app.js', content: 'localStorage.setItem("n", "1"); document.getElementById("n").textContent = localStorage.getItem("n"); fetch("data.json").then(r=>r.json()).then(d=>console.log(d));' },
      { path: 'data.json', content: '{"a":1}' },
    ],
  };
  const r = A.normalizeArtifact(site);
  const html = String(r.artifact.html);
  show('2) storage/fetch site', JSON.stringify({
    ok: r.ok,
    keepsLocalStorageCall: /localStorage/.test(html),
    keepsFetch: /fetch\(/.test(html),
    csp: A.SITE_CSP,
  }, null, 1));
}

// 3. ES modules with relative imports
{
  const site = {
    kind: 'site', title: 'Modular',
    files: [
      { path: 'index.html', content: '<html><body><script type="module" src="app.js"></script></body></html>' },
      { path: 'app.js', content: 'import { greet } from "./util.js";\ngreet();' },
      { path: 'util.js', content: 'export function greet(){ document.title = "hi"; }' },
    ],
  };
  const r = A.normalizeArtifact(site);
  show('3) module site', JSON.stringify({
    ok: r.ok,
    warnings: r.warnings,
    importSurvives: /import\s*\{[^}]*\}\s*from\s*["']\.\/util\.js["']/.test(String(r.artifact.html)),
    utilInlinedAnywhere: /export function greet/.test(String(r.artifact.html)),
  }, null, 1));
}

// 4. CSS in subdirectory + @import
{
  const site = {
    kind: 'site', title: 'Styles',
    files: [
      { path: 'index.html', content: '<html><head><link rel="stylesheet" href="styles/main.css"></head><body>x</body></html>' },
      { path: 'styles/main.css', content: '@import "./theme.css";\nbody{color:var(--ink)}' },
      { path: 'styles/theme.css', content: ':root{--ink:#111}' },
    ],
  };
  const r = A.normalizeArtifact(site);
  const html = String(r.artifact.html);
  show('4) css subdir', JSON.stringify({
    ok: r.ok,
    warnings: r.warnings,
    themeInlined: /--ink:#111/.test(html),
    importLeftBehind: /@import/.test(html),
  }, null, 1));
}

// 5. favicon
{
  const site = {
    kind: 'site', title: 'Favicon',
    files: [
      { path: 'index.html', content: '<html><head><link rel="icon" href="favicon.svg" type="image/svg+xml"></head><body>x</body></html>' },
      { path: 'favicon.svg', content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3"/></svg>' },
    ],
  };
  const r = A.normalizeArtifact(site);
  show('5) favicon', JSON.stringify({
    ok: r.ok,
    iconKeptAsFileRef: /<link[^>]*rel="icon"[^>]*href="favicon\.svg"/.test(String(r.artifact.html)),
    warnings: r.warnings,
  }, null, 1));
}

// 6. Report citations: in-text [1] + references
{
  const report = {
    kind: 'report', title: 'Cited', summary: 's',
    blocks: [
      { type: 'paragraph', text: 'The Moon dominates the tide [1]. Sun adds less [2].' },
      { type: 'list', items: ['one', 'two'] },
    ],
    references: [
      { title: 'NOAA tides', url: 'https://oceanservice.noaa.gov/facts/tides.html' },
      { title: 'NASA moon', url: 'https://moon.nasa.gov/' },
    ],
  };
  const r = A.normalizeArtifact(report);
  const md = A.artifactToMarkdown(r.artifact);
  show('6) citations in markdown', JSON.stringify({
    ok: r.ok,
    mdExcerpt: md.slice(0, 600),
    inTextLinked: /\[1\]\(http/.test(md),
  }, null, 1));
}

console.log('\nprobe done');
