// Standalone report exporter for the renderer: turns a validated report
// artifact into a self-contained HTML document (embedded print CSS) or
// Markdown. The main process writes the bytes (and prints PDFs); this file
// never touches the filesystem.
//
// The CSS below mirrors the report section of ai-artifacts.css so an export
// opens with the same paper, ink and theme structure outside the app. Vendored
// fonts are not embedded; the stacks fall back to system faces.
(function (root, factory) {
  const api = factory(
    typeof module === 'object' && module.exports ? require('./ai-artifacts') : root && root.DexArtifacts
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DexReportExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (artifacts) {
  'use strict';

  const PRINT_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; padding: 28px 18px 60px; background: #f9f9f9; color: #1c1a17;
  font: 13px/1.55 "Segoe UI", system-ui, -apple-system, sans-serif; }
.dxa-report { --ink: #1c1a17; --ink2: #5b564d; --hair: rgba(28,26,23,.28); --hair-soft: rgba(28,26,23,.14);
  --face: "Segoe UI", system-ui, sans-serif;
  max-width: 760px; margin: 0 auto; background: #f7f5ef; color: var(--ink);
  padding: 34px 38px 40px; border: 1px solid var(--hair-soft); }
.dxa-report[data-paper="white"] { background: #fff; }
.dxa-report[data-paper="pink"] { background: #f6e8ea; }
.dxa-report[data-paper="blue"] { background: #e8eef5; }
.dxa-report[data-paper="green"] { background: #e9f0e8; }
.dxa-report[data-paper="lavender"] { background: #eee9f4; }
.dxa-report[data-paper="peach"] { background: #f8ece2; }
.dxa-report[data-paper="grey"] { background: #eee; }
.dxa-report[data-paper="sand"] { background: #f3efe7; }
.dxa-report[data-paper="slate"] { background: #e7e9ec; }
.dxa-report[data-paper="ivory"] { background: #fbfaf5; }
.dxa-report[data-paper="mist"] { background: #eef3f3; }
.dxa-report[data-font="editorial"] { --face: Georgia, "Times New Roman", serif; }
.dxa-report[data-font="typewriter"] { --face: "Cascadia Mono", Consolas, monospace; }
.dxa-report .dxa-md, .dxa-report .dxa-list { font-family: var(--face); }
.dxa-report .dxa-h { font-family: var(--face); font-weight: 650; font-size: 15px;
  margin: 20px 0 8px; padding-bottom: 4px; border-bottom: 1px solid var(--hair); }
.dxa-report .dxa-h3 { font-size: 13px; }
.dxa-report .dxa-section:first-child .dxa-h:first-child { margin-top: 0; }
.dxa-kicker { margin: 0 0 6px; font: 600 9.5px "Cascadia Mono", Consolas, monospace;
  letter-spacing: .14em; text-transform: uppercase; color: var(--ink2); }
.dxa-subtitle { margin: -2px 0 12px; color: var(--ink2); }
.dxa-md p { margin: 0 0 10px; }
.dxa-list { margin: 6px 0 10px; padding-left: 20px; }
.dxa-list li { margin: 3px 0; }
.dxa-list li::marker { color: var(--ink2); }
.dxa-stats { display: flex; flex-wrap: wrap; gap: 16px 26px; margin: 12px 0; }
.dxa-stat-value { display: block; font: 700 22px "Cascadia Mono", Consolas, monospace; }
.dxa-stat-label { display: block; margin-top: 2px; font: 600 10px "Segoe UI", system-ui, sans-serif;
  letter-spacing: .1em; text-transform: uppercase; color: var(--ink2); }
.dxa-callout { border-left: 3px solid var(--ink); padding: 6px 0 6px 12px; margin: 12px 0; }
.dxa-callout-label { display: block; margin-bottom: 3px; font: 700 10px "Segoe UI", system-ui, sans-serif;
  letter-spacing: .12em; text-transform: uppercase; }
.dxa-quote { margin: 14px 0; padding: 0 0 0 14px; border-left: 1px solid var(--hair);
  font-family: var(--face); font-size: 15px; }
.dxa-quote cite { display: block; margin-top: 4px; font: 600 10.5px "Segoe UI", system-ui, sans-serif;
  font-style: normal; letter-spacing: .08em; text-transform: uppercase; color: var(--ink2); }
.dxa-timeline { list-style: none; margin: 10px 0; padding: 0; }
.dxa-timeline li { display: flex; gap: 10px; padding: 5px 0; border-top: 1px solid var(--hair-soft); }
.dxa-timeline li:first-child { border-top: 0; }
.dxa-when { flex: none; min-width: 58px; font: 600 11px "Cascadia Mono", Consolas, monospace; color: var(--ink2); }
.dxa-proscons { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 12px 0; }
.dxa-proscons b { font: 700 11px "Segoe UI", system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; }
.dxa-pros { border-top: 2px solid var(--ink); padding-top: 6px; }
.dxa-cons { border-top: 2px solid var(--hair); padding-top: 6px; }
.dxa-cards, .dxa-steps { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 12px 0; }
.dxa-steps { grid-template-columns: 1fr; }
.dxa-card-item, .dxa-step { border-top: 1px solid var(--hair); padding-top: 6px; }
.dxa-step { display: grid; grid-template-columns: 22px 1fr; column-gap: 8px; }
.dxa-step-n { grid-row: 1 / span 2; font: 700 12px "Cascadia Mono", Consolas, monospace; }
.dxa-card-title { font: 700 11px "Segoe UI", system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; }
.dxa-card-text { display: block; margin-top: 3px; font-size: 12px; color: var(--ink2); }
.dxa-table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 12px; }
.dxa-table th, .dxa-table td { border: 1px solid var(--hair-soft); padding: 5px 7px; text-align: left; }
.dxa-table th { background: rgba(28,26,23,.05); font-weight: 650; }
.dxa-chart svg { max-width: 100%; height: auto; }
.dxa-axis { fill: var(--ink2); }
.dxa-report[data-pattern="hatch"] .dxa-bar { stroke: var(--ink); stroke-width: .8; stroke-dasharray: 2 2; }
.dxa-report[data-pattern="diagonal"] .dxa-bar { stroke: var(--ink); stroke-width: .8; stroke-dasharray: 5 3; }
.dxa-divider { border: 0; border-top: 1px solid var(--hair); margin: 16px 0; }
.dxa-spacer { height: 10px; }
.dxa-code { margin: 10px 0; border: 1px solid var(--hair); border-radius: 7px; overflow: auto; background: #2d2d2d; color: #d4d4d4; }
.dxa-code pre { margin: 0; padding: 10px 12px; font: 12px/1.5 "Cascadia Mono", Consolas, monospace; }
.dxa-image { margin: 10px 0; text-align: center; }
.dxa-image img { max-width: 100%; height: auto; border: 1px solid var(--hair); border-radius: 7px; display: inline-block; background: #fff; }
.dxa-image-cap { margin-top: 5px; font-size: 11.5px; color: var(--ink2); text-align: center; line-height: 1.45; }
.dxa-embed { margin: 10px 0; border: 1px solid var(--hair); border-radius: 7px; overflow: hidden; background: #fff; }
.dxa-embed-frame { width: 100%; height: 300px; border: 0; display: block; }
.dxa-embed-cap { padding: 6px 10px; font-size: 11.5px; color: var(--ink2); border-top: 1px solid var(--hair); line-height: 1.45; }
.dxa-accordion { margin: 10px 0; border: 1px solid var(--hair); border-radius: 7px; overflow: hidden; }
.dxa-accordion-item + .dxa-accordion-item { border-top: 1px solid var(--hair-soft); }
.dxa-accordion-head { width: 100%; text-align: left; padding: 9px 12px; background: transparent; border: 0; cursor: pointer; font: 600 12.5px var(--face); color: var(--ink); display: flex; align-items: center; justify-content: space-between; }
.dxa-accordion-head:hover { background: color-mix(in srgb, var(--ink2) 5%, transparent); }
.dxa-accordion-panel { padding: 0 12px 10px; font-family: var(--face); font-size: 13px; line-height: 1.55; color: var(--ink2); }
.dxa-accordion-panel[hidden] { display: none; }
.dxa-accordion-panel p { margin: 0 0 8px; }
.dxa-tabs { margin: 12px 0; border: 1px solid var(--hair); border-radius: 7px; overflow: hidden; display: flex; flex-direction: column; }
.dxa-tablist { display: flex; border-bottom: 1px solid var(--hair); background: color-mix(in srgb, var(--ink2) 4%, transparent); }
.dxa-tab { flex: 1; padding: 9px 10px; border: 0; background: transparent; cursor: pointer; font: 600 11px var(--face); color: var(--ink2); text-align: center; border-right: 1px solid var(--hair-soft); }
.dxa-tab:last-child { border-right: 0; }
.dxa-tab:hover { background: color-mix(in srgb, var(--ink2) 6%, transparent); }
.dxa-tab[aria-selected="true"] { color: var(--ink); font-weight: 700; border-bottom: 2px solid var(--ink); margin-bottom: -1px; }
.dxa-tabpanel { padding: 12px; font-family: var(--face); font-size: 13px; line-height: 1.55; color: var(--ink2); }
.dxa-tabpanel[hidden] { display: none; }
.dxa-tabpanel p { margin: 0 0 8px; }
.dxa-metric { display: inline-flex; align-items: baseline; gap: 8px; padding: 12px 14px; border: 1px solid var(--hair); border-radius: 8px; background: color-mix(in srgb, var(--ink2) 4%, transparent); margin: 10px 0; }
.dxa-metric-value { font: 700 26px "Cascadia Mono", Consolas, monospace; color: var(--ink); letter-spacing: -.02em; }
.dxa-metric-delta { font: 600 11px var(--face); letter-spacing: .08em; text-transform: uppercase; color: var(--ink2); }
.dxa-metric-sub { margin-top: 4px; font-size: 12px; color: var(--ink2); }
.dxa-checklist { margin: 10px 0; padding-left: 2px; }
.dxa-checklist-item { display: flex; align-items: flex-start; gap: 8px; padding: 5px 0; border-bottom: 1px solid var(--hair-soft); }
.dxa-checklist-item:last-child { border-bottom: 0; }
.dxa-checklist-label { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; color: var(--ink); line-height: 1.5; }
.dxa-checklist-label input { flex: none; accent-color: var(--ink); }
.dxa-checklist-label input:checked + span { text-decoration: line-through; color: var(--ink2); }
.dxa-comparison { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 12px 0; border: 1px solid var(--hair); border-radius: 8px; overflow: hidden; }
.dxa-comparison-side { padding: 12px; font-family: var(--face); font-size: 13px; line-height: 1.55; }
.dxa-comp-left { border-right: 1px solid var(--hair); background: color-mix(in srgb, var(--ink2) 3%, transparent); }
.dxa-comp-right { background: color-mix(in srgb, var(--ink2) 2%, transparent); }
.dxa-comparison-side .dxa-h { margin: 0 0 8px; font-size: 13px; }
.dxa-comparison-side .dxa-list { margin: 4px 0 0; padding-left: 0; list-style: none; }
.dxa-comparison-side .dxa-list li { padding: 4px 0; border-bottom: 1px solid var(--hair-soft); }
.dxa-comparison-side .dxa-list li:last-child { border-bottom: 0; }
.dxa-comparison-value { color: var(--ink2); font-weight: 500; }
.dxa-refs a { color: inherit; }
.dxa-summary { margin: 0 0 10px; }
.dxa-report[data-theme="editorial"] .dxa-h { font-size: 17px; }
.dxa-report[data-theme="magazine"] .dxa-h { font-size: 20px; }
.dxa-report[data-theme="modern"], .dxa-report[data-theme="academic"] { counter-reset: dxa-sec; }
.dxa-report[data-theme="modern"] .dxa-section, .dxa-report[data-theme="academic"] .dxa-section { counter-increment: dxa-sec; }
.dxa-report[data-theme="modern"] .dxa-section > .dxa-h:first-child::before {
  content: counter(dxa-sec, decimal-leading-zero) "."; margin-right: 8px;
  font: 700 11px "Cascadia Mono", Consolas, monospace; color: var(--ink2); }
.dxa-report[data-theme="academic"] .dxa-section > .dxa-h:first-child::before {
  content: counter(dxa-sec, upper-roman) ". "; font: 600 12px var(--face); }
.dxa-report[data-theme="notebook"] .dxa-h { border-bottom-style: dashed; }
@media print {
  body { background: #fff; padding: 0; }
  .dxa-report { max-width: none; border: 0; }
  .dxa-section, .dxa-stats, .dxa-callout, .dxa-quote, .dxa-table { break-inside: avoid; }
}
/* Reading notes (V17): the export copy carries real <mark> highlights — the
   live DOM stays paint-only (wrapping live ranges breaks re-renders). Marks
   render behind nothing and cover nothing: an inline background with an
   underline, printing exactly via print-color-adjust. */
mark.dxa-ann {
  background: rgba(53, 196, 255, .22);
  color: inherit; padding: 0;
  text-decoration: underline;
  text-decoration-color: rgba(53, 196, 255, .65);
  text-decoration-thickness: 2px; text-underline-offset: 3px;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.dxa-notes { margin-top: 24px; padding-top: 10px; border-top: 1px dashed var(--hair); }
.dxa-notes .dxa-note-orphan { opacity: .75; font-style: italic; }
@media print { .dxa-notes { break-before: auto; } }
`;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function name(artifact) {
    const base = String((artifact && artifact.title) || 'report').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
    return base || 'report';
  }

  // The export copy's notes layer (V17): resolve every anchor against the
  // freshly rendered blocks with the same cascade the viewer uses, wrap the
  // found ranges in <mark> (in a detached copy — the supported shape), and
  // append a Notes section that carries every note, resolved or not. Nothing
  // is dropped: an orphaned note is listed with its status.
  function annotateExport(doc, artifact) {
    const annos = Array.isArray(artifact && artifact.annotations) ? artifact.annotations : [];
    if (!annos.length || !artifacts || typeof artifacts.resolveAnchor !== 'function') return;
    const byIndex = new Map();
    for (const el of Array.from(doc.querySelectorAll('[data-block-index]'))) {
      byIndex.set(String(el.dataset.blockIndex), el);
    }
    const resolved = [];
    for (const a of annos) {
      const el = byIndex.get(String(a.blockId));
      const res = el ? artifacts.resolveAnchor(el, a) : { status: 'orphaned', range: null };
      resolved.push({ a, res });
      if (res.range) {
        try {
          const mark = doc.createElement('mark');
          mark.className = 'dxa-ann';
          mark.setAttribute('data-note', String(a.note || '').slice(0, 120));
          mark.title = String(a.note || '');
          mark.appendChild(res.range.extractContents());
          res.range.insertNode(mark);
        } catch { /* the appendix still carries this note */ }
      }
    }
    const report = doc.querySelector('.dxa-report') || doc.body;
    const sec = doc.createElement('section');
    sec.className = 'dxa-section dxa-notes';
    const h = doc.createElement('h3');
    h.className = 'dxa-h';
    h.textContent = 'Notes';
    const list = doc.createElement('ol');
    list.className = 'dxa-list';
    for (const { a, res } of resolved) {
      const li = doc.createElement('li');
      const quote = doc.createElement('em');
      quote.textContent = '“' + String(a.quote || '') + '” ';
      li.appendChild(quote);
      li.appendChild(doc.createTextNode(String(a.note || '')));
      if (res.status === 'orphaned') {
        const flag = doc.createElement('span');
        flag.className = 'dxa-note-orphan';
        flag.textContent = ' (the annotated text is no longer in the report)';
        li.appendChild(flag);
      }
      list.appendChild(li);
    }
    sec.append(h, list);
    report.appendChild(sec);
  }

  // Renders the artifact through the same DOM renderer the app uses, then
  // serializes it into a document with embedded CSS.
  function html(artifact) {
    if (!artifacts || typeof document === 'undefined') return '';
    const doc = document.implementation.createHTMLDocument((artifact && artifact.title) || 'Report');
    artifacts.renderBody(doc.body, artifact, { document: doc });
    annotateExport(doc, artifact);
    return '<!doctype html><html lang="en" dir="auto"><head><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width, initial-scale=1">'
      + '<title>' + esc((artifact && artifact.title) || 'Report') + '</title>'
      + '<style>' + PRINT_CSS + '</style></head><body>'
      + doc.body.innerHTML
      + '</body></html>';
  }

  function markdown(artifact) {
    return artifacts && typeof artifacts.toMarkdown === 'function' ? artifacts.toMarkdown(artifact) : '';
  }

  return { html, markdown, name, PRINT_CSS };
});
