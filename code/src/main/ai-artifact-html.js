// Dexerion standalone artifact export — every artifact kind becomes one
// self-contained HTML document that works offline, opens in any browser, and
// needs no Dexerion runtime. No external CSS/JS/fonts/images are referenced:
// the file is the deliverable.
//
// Pure data in, string out. The renderer (and the main process) can call this
// without a DOM, so it is unit-testable headlessly.
'use strict';

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Inline markdown that survives export: **bold**, *italic*, `code`, [text](url).
// Everything else is escaped, so model text can never inject markup.
function inline(value) {
  let s = esc(value);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noreferrer noopener">$1</a>');
  return s;
}

function paras(value) {
  return String(value == null ? '' : value)
    .split(/\n{2,}/)
    .map((p) => '<p>' + inline(p).replace(/\n/g, '<br>') + '</p>')
    .join('\n');
}

function safeLink(url) {
  const s = String(url || '').trim();
  return /^https?:\/\//i.test(s) ? esc(s) : '';
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function compact(list) {
  return (Array.isArray(list) ? list : []).filter(Boolean);
}

// ---------------------------------------------------------------------------
// chart → inline SVG (no script, prints correctly, scales)
// ---------------------------------------------------------------------------

const SERIES_COLORS = ['#1f6f5c', '#c05a2e', '#3a5f9e', '#8a5cc0', '#b8860b', '#4a4a4a', '#2f8f8f', '#a13d63'];

function chartSvg(chart, opts) {
  const c = chart || {};
  const labels = compact(c.labels).map((l) => String(l));
  const series = compact(c.series);
  if (labels.length < 2 || !series.length) return '<p class="muted">Chart data was incomplete.</p>';
  const o = opts || {};
  const width = o.width || 720;
  const height = o.height || 340;
  const pad = { top: 24, right: 18, bottom: 52, left: 52 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  if (c.type === 'pie' || c.type === 'donut') {
    const values = compact(series[0].values).map(num);
    const total = values.reduce((a, b) => a + Math.max(0, b), 0) || 1;
    const cx = width / 2;
    const cy = height / 2;
    const r = Math.min(innerW, innerH) / 2;
    let angle = -Math.PI / 2;
    const slices = values.map((v, i) => {
      const sweep = (Math.max(0, v) / total) * Math.PI * 2;
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      angle += sweep;
      const x2 = cx + r * Math.cos(angle);
      const y2 = cy + r * Math.sin(angle);
      const large = sweep > Math.PI ? 1 : 0;
      const color = SERIES_COLORS[i % SERIES_COLORS.length];
      return `<path d="M${cx.toFixed(1)},${cy.toFixed(1)} L${x1.toFixed(1)},${y1.toFixed(1)} `
        + `A${r.toFixed(1)},${r.toFixed(1)} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z" fill="${color}">`
        + `<title>${esc(labels[i] || '')}: ${v}</title></path>`;
    }).join('');
    const legend = labels.map((l, i) => `<li><i style="background:${SERIES_COLORS[i % SERIES_COLORS.length]}"></i>`
      + `${esc(l)} <span class="muted">${values[i] == null ? '' : esc(values[i])}</span></li>`).join('');
    return `<figure class="chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(c.title || 'Chart')}">`
      + slices + '</svg>' + (o.legend === false ? '' : `<figcaption><ul class="legend">${legend}</ul></figcaption>`) + '</figure>';
  }

  // bar / line share the same axes
  const all = series.flatMap((s) => compact(s.values).map(num));
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  const span = max - min || 1;
  const y = (v) => pad.top + innerH - ((v - min) / span) * innerH;
  const bandW = innerW / labels.length;
  const x = (i) => pad.left + bandW * i + bandW / 2;

  const grid = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const value = max - span * t;
    const yy = pad.top + innerH * t;
    return `<line x1="${pad.left}" y1="${yy.toFixed(1)}" x2="${width - pad.right}" y2="${yy.toFixed(1)}" class="grid"/>`
      + `<text x="${pad.left - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end" class="axis">${esc(Math.round(value * 100) / 100)}</text>`;
  }).join('');

  let plot = '';
  if (c.type === 'line') {
    plot = series.map((s, si) => {
      const vals = compact(s.values).map(num);
      const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
      const dots = vals.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" fill="${SERIES_COLORS[si % SERIES_COLORS.length]}"><title>${esc(labels[i] || '')}: ${v}</title></circle>`).join('');
      return `<path d="${d}" fill="none" stroke="${SERIES_COLORS[si % SERIES_COLORS.length]}" stroke-width="2.5"/>` + dots;
    }).join('');
  } else {
    const perSeries = Math.max(1, series.length);
    const groupW = bandW * 0.62;
    const barW = groupW / perSeries;
    plot = series.map((s, si) => {
      const vals = compact(s.values).map(num);
      return vals.map((v, i) => {
        const top = y(Math.max(v, 0));
        const base = y(Math.min(v, 0));
        const bx = x(i) - groupW / 2 + barW * si;
        return `<rect x="${bx.toFixed(1)}" y="${top.toFixed(1)}" width="${Math.max(2, barW - 2).toFixed(1)}"`
          + ` height="${Math.max(1, base - top).toFixed(1)}" rx="2" fill="${SERIES_COLORS[si % SERIES_COLORS.length]}">`
          + `<title>${esc(labels[i] || '')}: ${v}</title></rect>`;
      }).join('');
    }).join('');
  }

  const ticks = labels.map((l, i) => (labels.length > 12 && i % 2 ? ''
    : `<text x="${x(i).toFixed(1)}" y="${height - pad.bottom + 20}" text-anchor="middle" class="axis">${esc(l)}</text>`)).join('');
  const legend = series.length > 1
    ? `<figcaption><ul class="legend">${series.map((s, i) => `<li><i style="background:${SERIES_COLORS[i % SERIES_COLORS.length]}"></i>${esc(s.name || 'Series')}</li>`).join('')}</ul></figcaption>`
    : '';
  return `<figure class="chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(c.title || 'Chart')}">`
    + grid + `<line x1="${pad.left}" y1="${y(0).toFixed(1)}" x2="${width - pad.right}" y2="${y(0).toFixed(1)}" class="axis-line"/>`
    + plot + ticks + (c.unit ? `<text x="${pad.left}" y="${pad.top - 8}" class="axis">${esc(c.unit)}</text>` : '')
    + '</svg>' + legend + '</figure>';
}

// ---------------------------------------------------------------------------
// report blocks → semantic HTML
// ---------------------------------------------------------------------------

function renderList(items, ordered) {
  const tag = ordered ? 'ol' : 'ul';
  return `<${tag}>${items.map((i) => '<li>' + inline(typeof i === 'string' ? i : i && i.text) + '</li>').join('')}</${tag}>`;
}

function renderTable(table) {
  const cols = compact(table.columns);
  const rows = compact(table.rows);
  if (cols.length < 2 || !rows.length) return '';
  const head = `<thead><tr>${cols.map((c) => '<th>' + inline(c) + '</th>').join('')}</tr></thead>`;
  const body = `<tbody>${rows.map((r) => '<tr>' + cols.map((_, i) => '<td>' + inline((r || [])[i] || '') + '</td>').join('') + '</tr>').join('')}</tbody>`;
  return `<div class="table-wrap"><table>${head}${body}</table></div>`;
}

function renderStats(items) {
  const list = compact(items);
  if (!list.length) return '';
  return `<div class="stats">${list.map((s) => `<div class="stat"><b>${inline(s.value)}</b><span>${inline(s.label)}</span></div>`).join('')}</div>`;
}

function renderTimeline(items) {
  const list = compact(items);
  if (!list.length) return '';
  return `<ol class="timeline">${list.map((t) => `<li><b>${inline(t.when || t.date)}</b><div>${inline(t.text || t.title)}</div></li>`).join('')}</ol>`;
}

function renderBlock(block) {
  if (!block || typeof block !== 'object') return '';
  const t = String(block.type || '');
  switch (t) {
    case 'heading': {
      const level = block.level === 3 ? 'h3' : block.level === 4 ? 'h4' : 'h2';
      return `<${level}>${inline(block.text)}</${level}>`;
    }
    case 'paragraph': return paras(block.text);
    case 'list': return renderList(compact(block.items), Boolean(block.ordered));
    case 'table': return renderTable(block);
    case 'stats': return renderStats(block.items);
    case 'chart': return chartSvg(block.chart || block);
    case 'timeline': return renderTimeline(block.items);
    case 'proscons': {
      const side = (title, list, cls) => (compact(list).length
        ? `<div class="${cls}"><h4>${esc(title)}</h4><ul>${compact(list).map((i) => '<li>' + inline(typeof i === 'string' ? i : i.text) + '</li>').join('')}</ul></div>` : '');
      return `<div class="cols">${side('Pros', block.pros, 'pros')}${side('Cons', block.cons, 'cons')}</div>`;
    }
    case 'cards': {
      const list = compact(block.items);
      if (!list.length) return '';
      return `<div class="cards">${list.map((c) => `<div class="card"><h4>${inline(c.title)}</h4>${paras(c.text)}</div>`).join('')}</div>`;
    }
    case 'steps': {
      const list = compact(block.items);
      if (!list.length) return '';
      return `<ol class="steps">${list.map((s) => `<li><b>${inline(s.title)}</b>${paras(s.text)}</li>`).join('')}</ol>`;
    }
    case 'quote': return `<blockquote>${paras(block.text)}${block.attribution ? `<cite>${inline(block.attribution)}</cite>` : ''}</blockquote>`;
    case 'callout': return `<aside class="callout">${block.label ? `<b>${inline(block.label)}</b>` : ''}${paras(block.text)}</aside>`;
    case 'divider': return '<hr>';
    case 'spacer': return '<div class="spacer"></div>';
    case 'code': return `<pre><code${block.lang ? ` data-lang="${esc(block.lang)}"` : ''}>${esc(block.text)}</code></pre>`;
    case 'image': {
      const src = /^data:image\//i.test(String(block.src || '')) ? esc(block.src) : safeLink(block.src);
      if (!src) return '';
      return `<figure><img src="${src}" alt="${esc(block.alt || '')}" loading="lazy">${block.caption ? `<figcaption>${inline(block.caption)}</figcaption>` : ''}</figure>`;
    }
    case 'embed': {
      const href = safeLink(block.src);
      if (!href) return '';
      return `<p class="embed"><a href="${href}" rel="noreferrer noopener">${esc(block.title || block.src)}</a></p>`;
    }
    case 'accordion': {
      const list = compact(block.items);
      return list.length
        ? `<div class="accordion">${list.map((i) => `<details${i.open ? ' open' : ''}><summary>${inline(i.heading)}</summary>${paras(i.body)}</details>`).join('')}</div>`
        : '';
    }
    case 'tabs': {
      const list = compact(block.tabs);
      return list.length
        ? `<div class="tabset">${list.map((i) => `<section><h4>${inline(i.heading)}</h4>${paras(i.body)}</section>`).join('')}</div>`
        : '';
    }
    case 'metric': {
      const trend = block.trend && block.trend !== 'none' ? `<span class="trend ${esc(block.trend)}">${esc(block.delta || '')}</span>` : '';
      return `<div class="metric"><b>${inline(block.value)}</b>${trend}<span>${inline(block.subtitle)}</span></div>`;
    }
    case 'checklist': {
      const list = compact(block.items);
      return list.length
        ? `<ul class="checklist">${list.map((i) => `<li class="${i.done ? 'done' : ''}"><span class="box"></span>${inline(i.text)}</li>`).join('')}</ul>`
        : '';
    }
    case 'comparison': {
      const side = (s, cls) => (!s ? '' : `<div class="${cls}"><h4>${inline(s.heading)}</h4><dl>${compact(s.items).map((i) => `<dt>${inline(i.label)}</dt><dd>${inline(i.value)}</dd>`).join('')}</dl></div>`);
      return `<div class="compare">${side(block.left, 'left')}${side(block.right, 'right')}${block.body ? paras(block.body) : ''}</div>`;
    }
    default: {
      const fallback = block.text || block.body;
      return fallback ? '<p>' + inline(fallback) + '</p>' : '';
    }
  }
}

function renderBlocks(blocks) {
  return compact(blocks).map(renderBlock).join('\n');
}

function renderReferences(refs) {
  const list = compact(refs);
  if (!list.length) return '';
  return '<section class="refs"><h2>References</h2><ol>'
    + list.map((r) => {
      const href = safeLink(r.url);
      const link = href ? `<a href="${href}" rel="noreferrer noopener">${esc(r.title || r.url)}</a>` : inline(r.title || '');
      return `<li>${link}${r.publisher ? ` <span class="muted">— ${esc(r.publisher)}</span>` : ''}</li>`;
    }).join('')
    + '</ol></section>';
}

// ---------------------------------------------------------------------------
// kinds
// ---------------------------------------------------------------------------

function documentShell(title, body, extraCss, script) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Dexerion">
<title>${esc(title || 'Dexerion artifact')}</title>
<style>${BASE_CSS}${extraCss || ''}</style>
</head>
<body>
${body}
${script ? `<script>${script}</script>` : ''}
</body>
</html>
`;
}

function reportBody(artifact) {
  const parts = [];
  const kicker = artifact.kicker ? `<p class="kicker">${inline(artifact.kicker)}</p>` : '';
  parts.push(`<header class="doc-head">${kicker}<h1>${inline(artifact.title)}</h1>`
    + (artifact.subtitle ? `<p class="sub">${inline(artifact.subtitle)}</p>` : '')
    + (artifact.generatedAt ? `<p class="meta">${esc(artifact.generatedAt)}</p>` : '')
    + '</header>');
  if (artifact.summary) parts.push(`<section class="summary">${paras(artifact.summary)}</section>`);
  parts.push(renderBlocks(artifact.blocks));
  if (compact(artifact.findings).length) {
    parts.push('<section class="findings"><h2>Findings</h2><ul>'
      + compact(artifact.findings).map((f) => '<li>' + inline(typeof f === 'string' ? f : f.text) + '</li>').join('')
      + '</ul></section>');
  }
  parts.push(renderReferences(artifact.references));
  // Reading notes travel with the single-file export too (V17): quote + note,
  // so the note–text link survives even without highlight ranges.
  const notes = Array.isArray(artifact.annotations) ? artifact.annotations.slice(0, 200) : [];
  if (notes.length) {
    parts.push('<section class="notes"><h2>Notes</h2><ol>'
      + notes.map((a) => '<li><em>“' + esc(String((a && a.quote) || '')) + '”</em> — ' + esc(String((a && a.note) || '')) + '</li>').join('')
      + '</ol></section>');
  }
  return `<main class="doc">${parts.filter(Boolean).join('\n')}</main>`;
}

function quizBody(artifact) {
  const data = { questions: artifact.questions, passing: artifact.passing, immediate: artifact.immediate !== false };
  const body = `<main class="doc quiz">
<header class="doc-head"><h1>${esc(artifact.title)}</h1>
${artifact.topic ? `<p class="sub">${esc(artifact.topic)}</p>` : ''}
<p class="meta">${artifact.questions.length} question${artifact.questions.length === 1 ? '' : 's'}${artifact.difficulty ? ' · ' + esc(artifact.difficulty) : ''}${artifact.passing ? ' · pass mark ' + esc(artifact.passing) + '%' : ''}</p></header>
<form id="quiz" class="quiz-form"></form>
<div class="quiz-bar"><button type="button" id="check">Check answers</button><button type="button" id="reset" class="ghost">Reset</button><output id="score" class="score" role="status"></output></div>
<template id="q-tpl"><section class="q"><p class="prompt"></p><div class="opts"></div><p class="explain" hidden></p></section></template>
</main>`;
  return { body, script: QUIZ_SCRIPT, json: data };
}

function deckBody(artifact) {
  const slides = compact(artifact.cards);
  const body = `<main class="deck" tabindex="0">
<header class="doc-head"><h1>${esc(artifact.title)}</h1>${artifact.topic ? `<p class="sub">${esc(artifact.topic)}</p>` : ''}</header>
<div id="slides">${slides.map((c, i) => `<section class="slide"${i ? ' hidden' : ''}><div class="front">${paras(c.front)}</div><div class="back">${paras(c.back)}</div></section>`).join('')}</div>
<div class="deck-bar"><button type="button" id="prev" class="ghost">← Back</button><span id="count"></span><button type="button" id="next">Next →</button><button type="button" id="flip" class="ghost">Flip card</button></div>
</main>`;
  return { body, script: DECK_SCRIPT };
}

function timelineBody(artifact) {
  const entries = compact(artifact.entries);
  const body = `<main class="doc"><header class="doc-head"><h1>${esc(artifact.title)}</h1>${artifact.subtitle ? `<p class="sub">${esc(artifact.subtitle)}</p>` : ''}</header>
<ol class="timeline big">${entries.map((e) => `<li><b>${esc(e.date || '')}</b><div><h3>${esc(e.title)}</h3>${paras(e.text)}</div></li>`).join('')}</ol></main>`;
  return { body };
}

function chartBody(artifact) {
  const chart = artifact.chart || {};
  return `<main class="doc"><header class="doc-head"><h1>${esc(artifact.title || chart.title || 'Chart')}</h1>${chart.unit ? `<p class="sub">Units: ${esc(chart.unit)}</p>` : ''}</header>
${chartSvg({ ...chart, title: artifact.title || chart.title })}</main>`;
}

// ---------------------------------------------------------------------------
// the public entry point
// ---------------------------------------------------------------------------

function artifactHtml(artifact, opts) {
  const a = artifact || {};
  const o = opts || {};
  switch (String(a.kind || '')) {
    case 'site': {
      const html = String(a.html || '');
      // A site artifact is already a complete, self-contained document.
      return html || documentShell(a.title || 'Site', '<main class="doc"><p class="muted">This site artifact had no content.</p></main>');
    }
    case 'quiz': {
      const q = quizBody(a);
      const padded = q.body.replace('</main>', `<script>window.__quiz=${JSON.stringify(q.json).replace(/</g, '\\u003c')}</script></main>`);
      return documentShell(a.title, padded, QUIZ_CSS, q.script);
    }
    case 'deck': {
      const d = deckBody(a);
      return documentShell(a.title, d.body, DECK_CSS, d.script);
    }
    case 'timeline': return documentShell(a.title, timelineBody(a).body);
    case 'chart': return documentShell(a.title, chartBody(a));
    case 'report':
    default: {
      const body = a.kind === 'report'
        ? reportBody(a)
        : `<main class="doc"><header class="doc-head"><h1>${esc(a.title || 'Document')}</h1></header>${renderBlocks(a.blocks)}</main>`;
      return documentShell(a.title, body + (o.footer === false ? '' : '<footer class="doc-foot">Created with Dexerion</footer>'));
    }
  }
}

// ---------------------------------------------------------------------------
// css + scripts
// ---------------------------------------------------------------------------

const BASE_CSS = `
:root{color-scheme:light dark;--ink:#1c1b19;--muted:#6b6660;--paper:#fbfaf7;--line:#e2ddd5;--accent:#c05a2e;--card:#fff}
@media (prefers-color-scheme:dark){:root{--ink:#ece9e4;--muted:#9b958d;--paper:#141312;--line:#2e2b28;--accent:#e07a4d;--card:#1b1a18}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.doc{max-width:52rem;margin:0 auto;padding:3rem 1.5rem 5rem}
.doc-head{margin-bottom:2rem;padding-bottom:1.25rem;border-bottom:1px solid var(--line)}
h1{font-size:2.15rem;line-height:1.15;letter-spacing:-.02em;margin:0 0 .5rem}
h2{font-size:1.32rem;line-height:1.3;margin:2.4rem 0 .6rem;letter-spacing:-.01em}
h3,h4{font-size:1.06rem;margin:1.6rem 0 .4rem}
p{margin:0 0 .9rem}
.kicker{margin:0 0 .6rem;font-size:.78rem;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);font-weight:600}
.sub{font-size:1.1rem;color:var(--muted);margin:0 0 .4rem}
.meta{font-size:.82rem;color:var(--muted);margin:0}
.summary{font-size:1.06rem;border-left:3px solid var(--accent);padding:.1rem 0 .1rem 1rem;margin:0 0 2rem}
a{color:var(--accent)}
ul,ol{margin:0 0 1rem;padding-left:1.35rem}
li{margin:.25rem 0}
code{font:.9em ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;background:color-mix(in srgb,var(--ink) 7%,transparent);padding:.1em .35em;border-radius:4px}
pre{background:color-mix(in srgb,var(--ink) 6%,transparent);border:1px solid var(--line);border-radius:8px;padding:1rem;overflow:auto}
pre code{background:none;padding:0}
blockquote{margin:1.4rem 0;padding:.2rem 0 .2rem 1.1rem;border-left:3px solid var(--line);color:var(--muted)}
blockquote cite{display:block;font-style:normal;font-size:.85rem;margin-top:.3rem}
hr{border:0;border-top:1px solid var(--line);margin:2rem 0}
.spacer{height:1.5rem}
.callout{border:1px solid var(--line);border-left:3px solid var(--accent);background:var(--card);border-radius:8px;padding:1rem 1.1rem;margin:1.4rem 0}
.callout b{display:block;font-size:.78rem;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin-bottom:.4rem}
.table-wrap{overflow-x:auto;margin:1.2rem 0}
table{border-collapse:collapse;width:100%;font-size:.94rem}
th,td{text-align:left;padding:.55rem .7rem;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:.78rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:.75rem;margin:1.4rem 0}
.stat{border:1px solid var(--line);border-radius:8px;padding:.9rem 1rem;background:var(--card)}
.stat b{display:block;font-size:1.7rem;line-height:1.1;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.stat span{font-size:.82rem;color:var(--muted)}
.chart{margin:1.6rem 0}
.chart svg{width:100%;height:auto;display:block;overflow:visible}
.chart .grid{stroke:var(--line);stroke-width:1}
.chart .axis-line{stroke:var(--muted);stroke-width:1}
.chart .axis{fill:var(--muted);font-size:11px}
.legend{list-style:none;display:flex;flex-wrap:wrap;gap:.35rem 1rem;padding:0;margin:.6rem 0 0;font-size:.82rem;color:var(--muted)}
.legend i{display:inline-block;width:.6rem;height:.6rem;border-radius:2px;margin-right:.4rem}
.timeline{list-style:none;padding:0;margin:1.6rem 0;border-left:2px solid var(--line)}
.timeline li{position:relative;padding:0 0 1.2rem 1.2rem}
.timeline li::before{content:"";position:absolute;left:-5px;top:.5rem;width:8px;height:8px;border-radius:50%;background:var(--accent)}
.timeline b{display:block;font-size:.8rem;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
.timeline.big li{padding-bottom:1.8rem}
.cols,.compare{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin:1.4rem 0}
.cols>div,.compare>div{border:1px solid var(--line);border-radius:8px;padding:.9rem 1rem;background:var(--card)}
.cols h4,.compare h4{margin:0 0 .5rem;font-size:.8rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.compare dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:.3rem .8rem;font-size:.9rem}
.compare dt{color:var(--muted)}
.compare dd{margin:0}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(13rem,1fr));gap:.9rem;margin:1.4rem 0}
.card{border:1px solid var(--line);border-radius:8px;padding:1rem 1.1rem;background:var(--card)}
.card h4{margin:0 0 .4rem}
.steps{counter-reset:s;list-style:none;padding:0}
.steps li{counter-increment:s;position:relative;padding:0 0 1.1rem 2.2rem}
.steps li::before{content:counter(s);position:absolute;left:0;top:0;width:1.5rem;height:1.5rem;border-radius:50%;background:var(--accent);color:#fff;font-size:.78rem;font-weight:700;display:grid;place-items:center}
.steps b{display:block}
.metric{display:inline-flex;align-items:baseline;gap:.6rem;border:1px solid var(--line);border-radius:8px;padding:.7rem 1rem;margin:.6rem 0;background:var(--card)}
.metric b{font-size:1.6rem;font-variant-numeric:tabular-nums}
.metric span{font-size:.85rem;color:var(--muted)}
.trend.up{color:#1f6f5c}.trend.down{color:#b4341f}
.checklist{list-style:none;padding:0}
.checklist .box{display:inline-block;width:.95rem;height:.95rem;border:1.5px solid var(--muted);border-radius:3px;margin-right:.6rem;vertical-align:-2px}
.checklist .done .box{background:var(--accent);border-color:var(--accent)}
.checklist .done{color:var(--muted);text-decoration:line-through}
.accordion details{border:1px solid var(--line);border-radius:8px;padding:.7rem .9rem;margin:.5rem 0;background:var(--card)}
.accordion summary{cursor:pointer;font-weight:600}
.tabset section{border-bottom:1px solid var(--line);padding:.6rem 0}
figure{margin:1.4rem 0}
figure img{max-width:100%;height:auto;border-radius:8px}
figcaption{font-size:.82rem;color:var(--muted);margin-top:.4rem}
.muted{color:var(--muted)}
.refs ol{font-size:.9rem}
.doc-foot{max-width:52rem;margin:0 auto;padding:1.5rem;border-top:1px solid var(--line);color:var(--muted);font-size:.78rem}
@media print{:root{--paper:#fff;--ink:#111;--line:#ccc}.doc{padding:0}.doc-foot{display:none}a{color:inherit;text-decoration:underline}}
@media (max-width:640px){.cols,.compare{grid-template-columns:1fr}.doc{padding:2rem 1.1rem 3rem}h1{font-size:1.7rem}}
`;

const QUIZ_CSS = `
.quiz-form .q{border:1px solid var(--line);border-radius:10px;padding:1rem 1.1rem;margin:1rem 0;background:var(--card)}
.quiz-form .prompt{font-weight:600;margin:0 0 .7rem}
.quiz-form label{display:flex;gap:.6rem;align-items:flex-start;padding:.4rem .5rem;border-radius:6px;cursor:pointer}
.quiz-form label:hover{background:color-mix(in srgb,var(--ink) 5%,transparent)}
.quiz-form input[type=text]{font:inherit;padding:.5rem .6rem;border:1px solid var(--line);border-radius:6px;background:var(--paper);color:var(--ink);width:100%}
.quiz-form .q.right{border-color:#1f6f5c}
.quiz-form .q.wrong{border-color:#b4341f}
.explain{font-size:.88rem;color:var(--muted);margin:.6rem 0 0;border-top:1px dashed var(--line);padding-top:.6rem}
.quiz-bar{position:sticky;bottom:0;display:flex;align-items:center;gap:.6rem;padding:.8rem 0;background:linear-gradient(transparent,var(--paper) 40%)}
button{font:inherit;font-weight:600;padding:.55rem 1rem;border-radius:6px;border:1px solid transparent;background:var(--ink);color:var(--paper);cursor:pointer}
button.ghost{background:transparent;border-color:var(--line);color:var(--ink)}
.score{margin-left:auto;font-variant-numeric:tabular-nums;font-weight:600}
`;

const DECK_CSS = `
.deck{max-width:46rem;margin:0 auto;padding:2.5rem 1.5rem;min-height:100vh;display:flex;flex-direction:column}
#slides{flex:1;display:grid;place-items:center}
.slide{width:100%;border:1px solid var(--line);border-radius:12px;padding:2.2rem;background:var(--card);min-height:16rem;display:flex;flex-direction:column;justify-content:center;gap:1.2rem;text-align:center}
.slide .front{font-size:1.5rem;font-weight:650;line-height:1.3}
.slide .back{font-size:1.05rem;color:var(--muted);border-top:1px solid var(--line);padding-top:1rem;display:none}
.slide.flipped .back{display:block}
.deck-bar{display:flex;align-items:center;gap:.6rem;justify-content:center;padding:1.2rem 0}
.deck-bar span{font-variant-numeric:tabular-nums;color:var(--muted);font-size:.88rem;min-width:4rem;text-align:center}
`;

const QUIZ_SCRIPT = `
(function(){
  var data=window.__quiz||{questions:[]};
  var form=document.getElementById('quiz');
  if(!form)return;
  var out=document.getElementById('score');
  (data.questions||[]).forEach(function(q,qi){
    var s=document.createElement('section');
    s.className='q';s.dataset.i=qi;s.dataset.type=q.type;
    var p=document.createElement('p');p.className='prompt';p.textContent=(qi+1)+'. '+q.prompt;s.appendChild(p);
    var wrap=document.createElement('div');wrap.className='opts';
    if(q.type==='short'){
      var inp=document.createElement('input');inp.type='text';inp.name='q'+qi;inp.setAttribute('aria-label',q.prompt);wrap.appendChild(inp);
    }else if(q.type==='match'){
      (q.pairs||[]).forEach(function(pair,pi){
        var row=document.createElement('label');row.style.display='block';
        var b=document.createElement('b');b.textContent=pair.left+' → ';row.appendChild(b);
        var sel=document.createElement('select');sel.name='q'+qi+'p'+pi;sel.setAttribute('aria-label',pair.left);
        var o0=document.createElement('option');o0.value='';o0.textContent='Choose…';sel.appendChild(o0);
        (q.pairs||[]).slice().sort(function(){return Math.random()-0.5}).forEach(function(opt){
          var o=document.createElement('option');o.value=opt.right;o.textContent=opt.right;sel.appendChild(o);
        });
        row.appendChild(sel);wrap.appendChild(row);
      });
    }else{
      (q.options||[]).forEach(function(opt,oi){
        var label=document.createElement('label');
        var input=document.createElement('input');input.type=q.type==='multi'?'checkbox':'radio';input.name='q'+qi;input.value=oi;
        var span=document.createElement('span');span.textContent=opt;
        label.appendChild(input);label.appendChild(span);wrap.appendChild(label);
      });
    }
    s.appendChild(wrap);
    if(q.explanation){var e=document.createElement('p');e.className='explain';e.hidden=true;e.textContent=q.explanation;s.appendChild(e);}
    form.appendChild(s);
  });
  function check(q,el){
    var type=q.type,ok=false;
    if(type==='short'){
      var v=(el.querySelector('input[type=text]').value||'').trim().toLowerCase();
      var accept=[q.answer].concat(q.accept||[]).map(function(a){return String(a||'').trim().toLowerCase();}).filter(Boolean);
      ok=accept.indexOf(v)>=0;
    }else if(type==='match'){
      ok=(q.pairs||[]).every(function(pair,pi){
        var sel=el.querySelector('select[name="q'+el.dataset.i+'p'+pi+'"]');
        return sel&&sel.value===pair.right;
      });
    }else if(type==='multi'){
      var picks=[].slice.call(el.querySelectorAll('input:checked')).map(function(i){return Number(i.value);}).sort();
      var want=(q.answer||[]).slice().sort();
      ok=picks.length===want.length&&picks.every(function(v,i){return v===want[i];});
    }else if(type==='truefalse'){
      var sel2=el.querySelector('input:checked');
      ok=sel2?(sel2.value==='0')===Boolean(q.answer):false;
    }else{
      var pick=el.querySelector('input:checked');
      ok=pick?Number(pick.value)===q.answer:false;
    }
    el.classList.toggle('right',ok);el.classList.toggle('wrong',!ok);
    var ex=el.querySelector('.explain');if(ex)ex.hidden=false;
    return ok;
  }
  document.getElementById('check').addEventListener('click',function(){
    var total=0,right=0;
    [].forEach.call(form.querySelectorAll('.q'),function(el){
      var q=data.questions[Number(el.dataset.i)];if(!q)return;
      total++;if(check(q,el))right++;
    });
    var pct=total?Math.round(right/total*100):0;
    out.textContent=right+'/'+total+' correct · '+pct+'%'+(pct>=(data.passing||60)?' — passed':' — keep going');
  });
  document.getElementById('reset').addEventListener('click',function(){
    form.reset();
    [].forEach.call(form.querySelectorAll('.q'),function(el){el.classList.remove('right','wrong');var e=el.querySelector('.explain');if(e)e.hidden=true;});
    out.textContent='';
  });
})();
`;

const DECK_SCRIPT = `
(function(){
  var slides=[].slice.call(document.querySelectorAll('.slide'));
  var i=0;
  var count=document.getElementById('count');
  function show(n){
    if(!slides.length)return;
    i=Math.max(0,Math.min(slides.length-1,n));
    slides.forEach(function(s,k){s.hidden=k!==i;s.classList.remove('flipped');});
    if(count)count.textContent=(i+1)+' / '+slides.length;
  }
  function flip(){var s=slides[i];if(s)s.classList.toggle('flipped');}
  document.getElementById('next').addEventListener('click',function(){show(i+1);});
  document.getElementById('prev').addEventListener('click',function(){show(i-1);});
  document.getElementById('flip').addEventListener('click',flip);
  document.addEventListener('keydown',function(e){
    if(e.key==='ArrowRight'||e.key==='PageDown'||e.key===' '){e.preventDefault();show(i+1);}
    else if(e.key==='ArrowLeft'||e.key==='PageUp'){e.preventDefault();show(i-1);}
    else if(e.key==='Enter'||e.key==='f'){e.preventDefault();flip();}
    else if(e.key==='Home'){show(0);}
    else if(e.key==='End'){show(slides.length-1);}
  });
  show(0);
})();
`;

module.exports = {
  artifactHtml,
  chartSvg,
  renderBlock,
  renderBlocks,
  esc,
  BASE_CSS,
};
