// Project export — one .zip that holds the artifact as files, not as a single
// blob. For a multi-file site that means the exact project the model wrote
// (index.html, styles.css, app.js, assets/…), which is what you hand to a
// static host. For the other kinds it means the standalone document plus an
// editable data copy (Markdown/CSV/JSON).
//
// Pure: artifact in, Buffer out. No dialogs, no disk.
'use strict';

const AdMZip = require('adm-zip');
const { artifactHtml } = require('./ai-artifact-html');
const { artifactToMarkdown, assembleSiteDocument } = require('./ai-artifacts');

const MAX_ZIP_BYTES = 8 * 1024 * 1024;

function slug(value) {
  return String(value || 'artifact').toLowerCase().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'artifact';
}

function csvCell(value) {
  const s = String(value == null ? '' : value);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function tableCsv(table) {
  const cols = Array.isArray(table && table.columns) ? table.columns : [];
  if (!cols.length) return '';
  const rows = Array.isArray(table && table.rows) ? table.rows : [];
  return [cols.map(csvCell).join(',')]
    .concat(rows.map((r) => cols.map((_, i) => csvCell((r || [])[i])).join(',')))
    .join('\n') + '\n';
}

// Flattens every table in a report into one CSV, headed by its section.
function reportCsv(artifact) {
  const blocks = Array.isArray(artifact.blocks) ? artifact.blocks : [];
  const chunks = blocks.filter((b) => b && b.type === 'table').map((b, i) => {
    const rows = Array.isArray(b.rows) ? b.rows : [];
    return '# table ' + (i + 1) + '\n' + tableCsv(b);
  });
  return chunks.join('\n');
}

function chartCsv(chart) {
  const c = chart || {};
  const labels = Array.isArray(c.labels) ? c.labels : [];
  const series = Array.isArray(c.series) ? c.series : [];
  if (!labels.length || !series.length) return '';
  return [['label'].concat(series.map((s) => s.name || 'series')).map(csvCell).join(',')]
    .concat(labels.map((l, i) => [l].concat(series.map((s) => (s.values || [])[i])).map(csvCell).join(',')))
    .join('\n') + '\n';
}

// Zipping an empty shell is never useful — refuse instead of writing a zip
// that contains one blank page.
function hasContent(a) {
  if (!a || typeof a !== 'object') return false;
  const many = (v) => Array.isArray(v) && v.length > 0;
  if (many(a.files)) return true;
  if (many(a.blocks) || many(a.findings) || many(a.references)) return true;
  if (many(a.questions) || many(a.cards) || many(a.entries)) return true;
  if (a.chart && many(a.chart.labels)) return true;
  for (const key of ['summary', 'description', 'html']) {
    if (typeof a[key] === 'string' && a[key].trim().length) return true;
  }
  return false;
}

// The files a person would expect to find in the zip. `opts.pdfs` (site only)
// carries pre-printed page PDFs: [{ name, buffer }].
function artifactFiles(artifact, opts) {
  const o = opts || {};
  const files = [];
  if (!hasContent(artifact)) return files;
  const kind = String(artifact.kind || 'artifact');
  const name = slug(artifact.title);
  const push = (path, content) => {
    if (typeof content === 'string') {
      if (content.length) files.push({ path, content });
    } else if (Buffer.isBuffer(content) && content.length) {
      files.push({ path, content });
    }
  };

  if (kind === 'site') {
    // One top-level folder (the researched layout): Explorer and Finder both
    // unpack a single tidy directory, and the entry file sits directly inside.
    const dir = name + '/';
    if (Array.isArray(artifact.files) && artifact.files.length) {
      for (const f of artifact.files) push(dir + f.path, f.content);
    } else {
      push(dir + 'index.html', artifact.html || '');
    }
    // Keep the inlined preview too: it is what runs inside Dexerion, and it is
    // the only file a non-technical person needs to double-click.
    push(dir + 'preview.html', artifactHtml(artifact));
    const pdfs = Array.isArray(o.pdfs) ? o.pdfs : [];
    for (const pdf of pdfs) {
      if (pdf && pdf.name && Buffer.isBuffer(pdf.buffer)) push(dir + 'pdf/' + pdf.name, pdf.buffer);
    }
    push(dir + 'README.txt', [
      name + ' — a website exported from Dexerion.',
      '',
      'Start at index.html (double-click it: the site runs offline).',
      'preview.html is a single-file copy of the first page for quick sharing.',
      ...(pdfs.length ? ['pdf/ holds one PDF per page.'] : []),
      '',
      'All sources are exactly what the model wrote — edit and re-publish them anywhere.',
      'One caveat: browsers block ES-module scripts on file:// URLs, so if this site',
      'uses <script type="module">, serve the folder with any static file server.',
      '',
    ].join('\n'));
    return files;
  }

  push(name + '.html', artifactHtml(artifact));
  push(name + '.md', artifactToMarkdown(artifact));

  if (kind === 'report') {
    const csv = reportCsv(artifact);
    if (csv) push(name + '.tables.csv', csv);
  } else if (kind === 'chart') {
    const csv = chartCsv(artifact.chart);
    if (csv) push(name + '.csv', csv);
  } else if (kind === 'quiz') {
    const questions = Array.isArray(artifact.questions) ? artifact.questions : [];
    const key = questions.map((q, i) => {
      const answer = Array.isArray(q.answer) ? q.answer.map((n) => (q.options || [])[n]).join(' / ')
        : q.type === 'truefalse' ? (q.answer ? 'True' : 'False')
          : q.type === 'short' ? q.answer
            : q.type === 'match' ? (q.pairs || []).map((p) => p.left + ' → ' + p.right).join('; ')
              : (q.options || [])[q.answer];
      return (i + 1) + '. ' + q.prompt + '\n   ' + (answer == null ? '' : answer)
        + (q.explanation ? '\n   Why: ' + q.explanation : '');
    }).join('\n\n');
    push(name + '.answer-key.txt', key);
  } else if (kind === 'deck') {
    const cards = Array.isArray(artifact.cards) ? artifact.cards : [];
    push(name + '.cards.csv', 'front,back\n' + cards.map((c) => csvCell(c.front) + ',' + csvCell(c.back)).join('\n') + '\n');
  }
  push(name + '.json', JSON.stringify(artifact, null, 2));
  return files;
}

function artifactZip(artifact, opts) {
  const o = opts || {};
  const files = artifactFiles(artifact || {}, o);
  if (!files.length) return { ok: false, error: 'This artifact has nothing to export.' };
  // The size guard protects the SOURCE set (V20 fix): printed PDFs ride in the
  // zip by design and are the point of the export — counting them against the
  // source budget refused whole exports for text-sized sites with many pages.
  const sourceBytes = files
    .filter((f) => !/(^|\/)pdf\//.test(f.path))
    .reduce((n, f) => n + (Buffer.isBuffer(f.content) ? f.content.length : Buffer.byteLength(f.content, 'utf8')), 0);
  if (sourceBytes > MAX_ZIP_BYTES) return { ok: false, error: 'This artifact is too large to zip.' };
  const zip = new AdMZip();
  for (const f of files) zip.addFile(f.path, Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content, 'utf8'));
  const buffer = zip.toBuffer();
  return {
    ok: true,
    buffer,
    bytes: buffer.length,
    name: slug(o.name || (artifact && artifact.title)),
    files: files.map((f) => f.path),
  };
}

// The whole site as ONE print document (V20) — the researched no-dependency
// alternative to a PDF merge library: every page's body is concatenated in
// order with page breaks between, and the site's own CSS is inlined once per
// file (deduped, exactly like the single-page export assembles it). One
// printToPDF then produces a combined PDF with native pagination and intact
// structure — no byte concatenation (which produces invalid PDFs) and no new
// dependency.
function wholeSitePrintHtml(artifact) {
  const files = artifact && Array.isArray(artifact.files) ? artifact.files : [];
  if (!files.length) return '';
  const warnings = [];
  const pages = files.filter((f) => f && /\.html?$/i.test(String(f.path || ''))).map((f) => f.path);
  if (!pages.length) return '';
  const cssBlocks = [];
  const bodies = [];
  for (const page of pages.slice(0, 12)) {
    let html = '';
    try {
      const built = assembleSiteDocument(files, warnings, page);
      if (built.error) continue;
      html = String(built.html || '');
    } catch { continue; }
    for (const m of html.matchAll(/<style data-src="([^"]*)">([\s\S]*?)<\/style>/gi)) {
      if (!cssBlocks.some((c) => c.src === m[1])) cssBlocks.push({ src: m[1], css: m[2] });
    }
    const bodyMatch = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
    const body = (bodyMatch ? bodyMatch[1] : html)
      .replace(/<script[\s\S]*?<\/script>/gi, '');   // print documents run with scripts off
    const safeName = String(page).replace(/[<>&"]/g, '');
    bodies.push('<section class="dex-page"' + (bodies.length ? ' style="break-before:page"' : '')
      + '><p class="dex-page-name">' + safeName + '</p>' + body + '</section>');
  }
  if (!bodies.length) return '';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><style>'
    + 'body{margin:0;background:#fff;color:#1c1a17}'
    + 'section.dex-page{padding:24px 28px}'
    + '.dex-page-name{font:600 10px system-ui,Segoe UI,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#5b564d;margin:0 0 12px}'
    + 'section.dex-page + section.dex-page{break-before:page}'
    + '</style>'
    + cssBlocks.map((c) => '<style data-src="' + c.src + '">' + c.css + '</style>').join('')
    + '</head><body>' + bodies.join('') + '</body></html>';
}

module.exports = { artifactZip, artifactFiles, wholeSitePrintHtml, MAX_ZIP_BYTES };
