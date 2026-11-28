// Dexerion structured artifacts — validation, recovery and serialization.
//
// The model proposes an artifact inside one fenced `dex-artifact` block. This
// module is the only place that decides whether it is usable, and the result
// is plain data rendered by application-owned components. Model HTML is only
// ever run inside an opaque-origin sandbox with a deny-by-default CSP.
'use strict';

const { validateSiteQuality } = require('./ai-site-quality');

const KINDS = ['report', 'site', 'quiz', 'deck', 'chart', 'timeline'];

const LIMITS = {
  jsonChars: 800000,
  title: 180,
  subtitle: 240,
  summary: 8000,
  sectionBody: 12000,
  sections: 40,
  blocks: 240,
  listItems: 100,
  statItems: 8,
  timelineItems: 120,
  cards: 24,
  steps: 24,
  findings: 30,
  references: 40,
  tableColumns: 12,
  tableRows: 200,
  tableCell: 500,
  chartSeries: 8,
  chartPoints: 200,
  quizQuestions: 100,
  quizOptions: 12,
  quizText: 4000,
  deckCards: 200,
  timelineEntries: 200,
  html: 400000,
  siteFiles: 24,
  siteFileChars: 120000,
  siteFileTotal: 400000,
  annotations: 200,
  conditions: 40,
  dependencies: 40,
  versions: 60,
  dynamicData: 40,
};

// Closed sets: the model picks a name, the renderer owns the look. Unknown
// values fall back instead of failing the whole report.
const REPORT_THEMES = ['clean', 'editorial', 'brief', 'modern', 'magazine', 'academic', 'notebook', 'executive', 'minimal', 'creative', 'technical', 'playful'];
const REPORT_PAPERS = ['paper', 'white', 'pink', 'blue', 'green', 'lavender', 'peach', 'grey', 'sand', 'slate', 'ivory', 'mist'];
const REPORT_PATTERNS = ['solid', 'hatch', 'diagonal'];
const REPORT_FONTS = ['editorial', 'neutral', 'typewriter'];
const BLOCK_TYPES = ['heading', 'paragraph', 'list', 'table', 'stats', 'chart', 'timeline', 'proscons', 'cards', 'steps', 'quote', 'callout', 'divider', 'spacer', 'code', 'image', 'embed', 'accordion', 'tabs', 'metric', 'checklist', 'comparison'];

function pickOne(value, list, fallback) {
  const s = String(value || '').toLowerCase();
  return list.includes(s) ? s : fallback;
}

const SITE_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
  + "img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; "
  + "form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'";

function clampInt(value, lo, hi, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function text(value, max) {
  return String(value == null ? '' : value).replace(/\r\n/g, '\n').trim().slice(0, max);
}

function oneLine(value, max) {
  return text(value, max).replace(/\s+/g, ' ');
}

function bool(value) {
  if (value === true || value === 'true' || value === 1) return true;
  if (value === false || value === 'false' || value === 0) return false;
  return null;
}

function safeUrl(value) {
  const url = String(value || '').trim().slice(0, 2048);
  return /^https?:\/\//i.test(url) ? url : '';
}

// Report images are self-contained: the internal-page CSP allows data:/blob:
// but NOT remote http(s). A model that emits a data URL must therefore survive
// normalization byte-for-byte, and a research placeholder is resolved to a
// data URL after generation. Remote URLs are kept here only so that the
// report-generation path can fetch and inline them before the artifact is
// stored — they are never shipped as runtime resources.
const IMAGE_SRC_MAX = 2 * 1024 * 1024;
function safeImageUrl(value) {
  let url = text(value, IMAGE_SRC_MAX);
  if (!url) return '';
  if (/^dexref[1-4]$/i.test(url)) return url.toLowerCase();
  if (/^https?:\/\//i.test(url)) return url.slice(0, 2048);
  if (!/^data:image\//i.test(url)) return '';
  // Base64 payloads may arrive wrapped across lines; whitespace inside a
  // base64 data URL is not reliable in Chromium. Non-base64 data URLs (for
  // example URL-encoded SVG) keep their payload exactly as written.
  const comma = url.indexOf(',');
  if (comma < 0) return '';
  const head = url.slice(0, comma + 1);
  const payload = url.slice(comma + 1);
  return /;base64,$/i.test(head) ? head + payload.replace(/\s+/g, '') : url;
}

function normalizeTable(raw) {
  if (!raw || typeof raw !== 'object') return null;
  // Models occasionally name the header row "headers"/"header"/"head" and the
  // body "data"/"body". Accept those spellings (and object rows keyed by
  // column name) so a good table is never silently dropped by the guard.
  const pick = (...values) => values.find((v) => Array.isArray(v) && v.length) || [];
  const columns = pick(raw.columns, raw.headers, raw.header, raw.head)
    .slice(0, LIMITS.tableColumns).map((c) => oneLine(c, 120)).filter(Boolean);
  if (columns.length < 2) return null;
  const cellAt = (row, i) => {
    if (Array.isArray(row)) return row[i];
    if (row && typeof row === 'object') return row[columns[i]];
    return '';
  };
  const rows = pick(raw.rows, raw.data, raw.body).slice(0, LIMITS.tableRows)
    .map((row) => columns.map((_, i) => text(cellAt(row, i), LIMITS.tableCell)))
    .filter((row) => row.some(Boolean));
  if (!rows.length) return null;
  return { columns, rows };
}

function normalizeChart(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = ['bar', 'line', 'pie'].includes(raw.type) ? raw.type : 'bar';
  const labels = (Array.isArray(raw.labels) ? raw.labels : [])
    .slice(0, LIMITS.chartPoints).map((l) => oneLine(l, 80));
  const series = (Array.isArray(raw.series) ? raw.series : []).slice(0, LIMITS.chartSeries)
    .map((s) => {
      if (!s || typeof s !== 'object') return null;
      const values = (Array.isArray(s.values) ? s.values : []).slice(0, labels.length)
        .map((v) => Number(v)).map((v) => (Number.isFinite(v) ? v : 0));
      if (!values.length) return null;
      return { name: oneLine(s.name || 'Series', 80) || 'Series', values };
    }).filter(Boolean);
  if (labels.length < 2 || !series.length) return null;
  return {
    type,
    title: oneLine(raw.title, LIMITS.title),
    labels,
    series,
    unit: oneLine(raw.unit, 40),
  };
}

// One validator for every report block. A block that is malformed is dropped
// with the rest of the report still valid, so a single bad row cannot cost
// the person their document.
function normalizeBlock(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = String(raw.type || '').toLowerCase();
  if (type === 'heading') {
    const value = oneLine(raw.text || raw.heading, LIMITS.title);
    return value ? { type: 'heading', text: value, level: clampInt(raw.level, 2, 3, 2) } : null;
  }
  if (type === 'paragraph') {
    const value = text(raw.text, LIMITS.sectionBody);
    return value ? { type: 'paragraph', text: value } : null;
  }
  if (type === 'list') {
    const items = (Array.isArray(raw.items) ? raw.items : []).slice(0, LIMITS.listItems)
      .map((item) => text(item, 2000)).filter(Boolean);
    return items.length ? { type: 'list', items, ordered: raw.ordered === true } : null;
  }
  if (type === 'table') {
    const table = normalizeTable(raw);
    return table ? { type: 'table', ...table } : null;
  }
  if (type === 'stats') {
    const items = (Array.isArray(raw.items) ? raw.items : []).slice(0, LIMITS.statItems)
      .map((item) => ({ value: oneLine(item && item.value, 80), label: oneLine(item && item.label, 160) }))
      .filter((item) => item.value || item.label);
    return items.length ? { type: 'stats', items } : null;
  }
  if (type === 'chart') {
    const chart = normalizeChart(raw.chart || raw);
    return chart ? { type: 'chart', chart } : null;
  }
  if (type === 'timeline') {
    const items = (Array.isArray(raw.items) ? raw.items : []).slice(0, LIMITS.timelineItems)
      .map((item) => ({ when: oneLine(item && item.when, 80), text: text(item && item.text, 2000) }))
      .filter((item) => item.text);
    return items.length ? { type: 'timeline', items } : null;
  }
  if (type === 'proscons') {
    const pros = (Array.isArray(raw.pros) ? raw.pros : []).slice(0, 20).map((item) => oneLine(item, 600)).filter(Boolean);
    const cons = (Array.isArray(raw.cons) ? raw.cons : []).slice(0, 20).map((item) => oneLine(item, 600)).filter(Boolean);
    return pros.length || cons.length ? { type: 'proscons', pros, cons } : null;
  }
  if (type === 'cards') {
    const items = (Array.isArray(raw.items) ? raw.items : []).slice(0, LIMITS.cards)
      .map((item) => ({ title: oneLine(item && item.title, 160), text: text(item && item.text, 2000) }))
      .filter((item) => item.title || item.text);
    return items.length ? { type: 'cards', items } : null;
  }
  if (type === 'steps') {
    const items = (Array.isArray(raw.items) ? raw.items : []).slice(0, LIMITS.steps)
      .map((item) => ({ title: oneLine(item && item.title, 160), text: text(item && item.text, 2000) }))
      .filter((item) => item.title || item.text);
    return items.length ? { type: 'steps', items } : null;
  }
  if (type === 'quote') {
    const value = text(raw.text, 3000);
    return value ? { type: 'quote', text: value, attribution: oneLine(raw.attribution, 200) } : null;
  }
  if (type === 'callout') {
    const value = text(raw.text, 4000);
    return value ? { type: 'callout', text: value, label: oneLine(raw.label, 80) } : null;
  }
  if (type === 'code') {
    const value = text(raw.text || raw.code, LIMITS.sectionBody);
    const lang = oneLine(raw.lang || raw.language || '', 40);
    return value ? { type: 'code', text: value, lang } : null;
  }
  if (type === 'image') {
    // NEVER oneLine() here: collapsing whitespace corrupts base64 payloads.
    const src = safeImageUrl(raw.src || raw.url || '');
    if (!src) return null;
    return {
      type: 'image',
      src,
      alt: oneLine(raw.alt || '', 200),
      caption: text(raw.caption, 1000),
    };
  }
  if (type === 'embed') {
    const value = safeUrl(raw.src || raw.url || '');
    if (!value) return null;
    return {
      type: 'embed',
      src: value,
      title: oneLine(raw.title || '', 200),
      caption: text(raw.caption, 1000),
    };
  }
  if (type === 'accordion') {
    const items = (Array.isArray(raw.items) ? raw.items : []).slice(0, LIMITS.cards)
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const heading = oneLine(item.heading || item.title || '', 200);
        const body = text(item.body || item.text || '', LIMITS.sectionBody);
        return heading || body ? { heading, body, open: item.open === true } : null;
      })
      .filter(Boolean);
    return items.length ? { type: 'accordion', items } : null;
  }
  if (type === 'tabs') {
    const tabs = (Array.isArray(raw.tabs) ? raw.tabs : []).slice(0, LIMITS.cards)
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const heading = oneLine(item.heading || item.title || '', 200);
        const body = text(item.body || item.text || '', LIMITS.sectionBody);
        return heading || body ? { heading, body, active: item.active === true } : null;
      })
      .filter(Boolean);
    return tabs.length ? { type: 'tabs', tabs } : null;
  }
  if (type === 'metric') {
    const value = oneLine(raw.value || raw.label || '', 200);
    if (!value) return null;
    const trend = ['up', 'down', 'flat', 'none'].includes(String(raw.trend || '').toLowerCase())
      ? String(raw.trend || '').toLowerCase() : 'none';
    return {
      type: 'metric',
      value,
      subtitle: oneLine(raw.subtitle || '', 200),
      trend,
      delta: oneLine(raw.delta || '', 120),
    };
  }
  if (type === 'checklist') {
    const items = (Array.isArray(raw.items) ? raw.items : []).slice(0, LIMITS.listItems)
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const t = text(item.text || item.label || '', 2000);
        return t ? { text: t, done: item.done === true } : null;
      })
      .filter(Boolean);
    return items.length ? { type: 'checklist', items } : null;
  }
  if (type === 'comparison') {
    const left = normalizeComparisonSide(raw.left);
    const right = normalizeComparisonSide(raw.right);
    if (!left && !right) return null;
    return { type: 'comparison', left, right, title: oneLine(raw.title || '', 200) };
  }
  if (type === 'divider') return { type: 'divider' };
  if (type === 'spacer') return { type: 'spacer' };
  return null;
}

function normalizeComparisonSide(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const heading = oneLine(raw.heading || raw.title || '', 200);
  const items = (Array.isArray(raw.items) ? raw.items : []).slice(0, 20)
    .map((item) => ({ label: oneLine(item && item.label, 160), value: text(item && item.value, 2000) }))
    .filter((item) => item.label || item.value);
  const body = text(raw.body || raw.text, 3000);
  return heading || items.length || body ? { heading, items, body } : null;
}

function normalizeBlocks(list) {
  const out = [];
  for (const item of (Array.isArray(list) ? list : []).slice(0, LIMITS.blocks)) {
    const block = normalizeBlock(item);
    if (block) out.push(block);
  }
  return out;
}

// v1 reports are section-based. They become blocks so the new renderer is the
// only path, and blocks become a simple sections list so anything still on the
// old renderer (older stored chats) keeps painting.
function blocksFromSections(sections) {
  const out = [];
  for (const section of sections) {
    if (section.heading) out.push({ type: 'heading', text: section.heading, level: 2 });
    if (section.body) {
      for (const paragraph of String(section.body).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)) {
        const bullet = paragraph.match(/^(?:[-*]|\d+\.)\s+/);
        out.push(bullet ? { type: 'list', items: [paragraph.replace(/^(?:[-*]|\d+\.)\s+/, '')], ordered: /^\d+\./.test(paragraph) } : { type: 'paragraph', text: paragraph });
      }
    }
    if (section.table) out.push({ type: 'table', ...section.table });
    if (section.chart) out.push({ type: 'chart', chart: section.chart });
  }
  return out;
}

function sectionsFromBlocks(blocks) {
  const sections = [];
  let current = null;
  const push = () => {
    if (current && (current.heading || current.body || current.table || current.chart)) sections.push(current);
    current = null;
  };
  const addBody = (value) => { current.body = current.body ? current.body + '\n\n' + value : value; };
  for (const block of blocks) {
    if (block.type === 'heading' && block.level === 2) { push(); current = { heading: block.text }; continue; }
    if (!current) current = {};
    if (block.type === 'heading') addBody('**' + block.text + '**');
    else if (block.type === 'paragraph') addBody(block.text);
    else if (block.type === 'list') addBody(block.items.map((item) => (block.ordered ? '1. ' : '- ') + item).join('\n'));
    else if (block.type === 'quote') addBody('> ' + block.text);
    else if (block.type === 'callout') addBody('> ' + (block.label ? block.label + ': ' : '') + block.text);
    else if (block.type === 'stats') addBody(block.items.map((item) => item.value + ' ' + item.label).join(' · '));
    else if (block.type === 'timeline') addBody(block.items.map((item) => (item.when ? item.when + ' — ' : '') + item.text).join('\n'));
    else if (block.type === 'proscons') addBody('Pros: ' + block.pros.join('; ') + '\nCons: ' + block.cons.join('; '));
    else if (block.type === 'cards' || block.type === 'steps') addBody(block.items.map((item) => (item.title ? '**' + item.title + '** ' : '') + item.text).join('\n'));
    else if (block.type === 'table' && !current.table) current.table = { columns: block.columns, rows: block.rows };
    else if (block.type === 'chart' && !current.chart) current.chart = block.chart;
    else if (block.type === 'code') addBody('```' + (block.lang || '') + '\n' + block.text + '\n```');
    else if (block.type === 'image') addBody('![Image' + (block.alt ? ' ' + block.alt : '') + '](' + block.src + ')' + (block.caption ? ' — ' + block.caption : ''));
    else if (block.type === 'embed') addBody('[Embed](' + block.src + ')' + (block.title ? ' — ' + block.title : ''));
    else if (block.type === 'accordion') addBody((block.items || []).map((i) => '▸ ' + i.heading + ': ' + i.body).join('\n'));
    else if (block.type === 'tabs') addBody((block.tabs || []).map((i) => i.heading + ': ' + i.body).join('\n'));
    else if (block.type === 'metric') addBody(block.value + (block.delta ? ' ' + block.delta : '') + (block.subtitle ? ' — ' + block.subtitle : ''));
    else if (block.type === 'checklist') addBody((block.items || []).map((i) => (i.done ? '[x] ' : '[ ] ') + i.text).join('\n'));
    else if (block.type === 'comparison') {
      const left = (block.left && block.left.heading) ? block.left.heading : 'Left';
      const right = (block.right && block.right.heading) ? block.right.heading : 'Right';
      addBody('Comparison — ' + left + ' vs ' + right + (block.title ? ': ' + block.title : ''));
    }
  }
  push();
  return sections;
}

function normalizeReference(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const url = safeUrl(raw.url);
  if (!url) return null;
  return {
    title: oneLine(raw.title || url, 240),
    url,
    publisher: oneLine(raw.publisher, 160),
  };
}

function normalizeSection(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const heading = oneLine(raw.heading || raw.title, LIMITS.title);
  let body = text(raw.body || raw.text, LIMITS.sectionBody);
  if (!body && Array.isArray(raw.paragraphs)) {
    body = raw.paragraphs.slice(0, 40).map((p) => text(p, 3000)).filter(Boolean).join('\n\n');
  }
  const table = normalizeTable(raw.table);
  const chart = normalizeChart(raw.chart);
  if (!heading && !body && !table && !chart) return null;
  const section = {};
  if (heading) section.heading = heading;
  if (body) section.body = body;
  if (table) section.table = table;
  if (chart) section.chart = chart;
  return section;
}

function normalizeAnnotation(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const note = text(raw.note, 2000);
  if (!note) return null;
  const out = {
    blockId: oneLine(raw.blockId || raw.block || '', 40),
    note,
    who: oneLine(raw.who || 'You', 120),
    at: clampInt(raw.at, 0, Date.now(), Date.now()),
  };
  // The anchor a selection note carries (V15): quote + context + offset hint.
  // Kept bounded and typed here, because this is the re-normalization every
  // export path runs through — dropping these fields would silently orphan
  // every note the moment a report is exported. The renderer's resolve
  // cascade decides at paint time whether an anchor is exact, moved or
  // orphaned; normalization only preserves the evidence.
  const quote = text(raw.quote, 200);
  if (quote) {
    // An id is how the rail targets one note (Show/Edit/Delete); notes that
    // arrive without one (model-authored shapes) get a generated id so the
    // actions never collapse onto the first row (V20 polish pass).
    out.id = oneLine(raw.id, 48) || 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    out.quote = quote;
    out.prefix = text(raw.prefix, 64);
    out.suffix = text(raw.suffix, 64);
    out.offset = clampInt(raw.offset, 0, 999999, 0);
    out.occurrence = clampInt(raw.occurrence, 1, 99, 1);
  }
  // V17 annotation status: the renderer resolves each anchor at paint time and
  // shows an orphaned note with its status instead of dropping it. Preserve the
  // evidence so a re-normalization (edit/export/reload) cannot silently turn a
  // resolved note into an orphan with no recorded reason.
  const status = oneLine(raw.status, 48);
  if (status) out.status = status;
  if (raw.unresolved != null) out.unresolved = raw.unresolved === true;
  return out;
}

// Self-describing export/version contract. Every value here describes a real
// app behaviour (title-derived filenames, a bounded generation with Retry,
// re-read stale-patch guards, byte-identical rollback on rejection, orphaned
// note status). Keeping it on the artifact means the viewer, the export paths
// and the E2E gate all observe the same truth without re-deriving it per
// surface. Model-supplied values are accepted only when they are well-typed;
// the defaults are the app's actual capabilities, not invented facts.
function normalizeReportStatus(raw, title) {
  const base = String(title || 'report')
    .replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'report';
  const meta = {
    exportFilename: oneLine(raw.exportFilename, 120) || base,
    deriveFilename: raw.deriveFilename !== false,
    filenameFromTitle: true,
    exportStatus: oneLine(raw.exportStatus, 120),
    exportFeedback: raw.exportFeedback === true,
    copyStatus: raw.copyStatus === true,
    copyFeedback: oneLine(raw.copyFeedback, 120),
    busyState: raw.busyState === true,
    restyleScroll: raw.restyleScroll !== false,
    selectionPreserved: raw.selectionPreserved !== false,
    restyle: raw.restyle !== false,
    restyleMode: 'tokens',
    annotationBadge: raw.annotationBadge !== false,
    annotationLive: raw.annotationLive !== false,
    annotationsUpdated: raw.annotationsUpdated !== false,
    unresolvedSupported: true,
    annotationStatus: true,
    printBreakInside: true,
    printHideChrome: true,
    printExpand: true,
    generationTimeout: true,
    timeoutMs: clampInt(raw.timeoutMs, 1000, 600000, 120000),
    stalePatchGuard: true,
    patchRejectedNoop: true,
    rollback: true,
  };
  const revision = clampInt(raw.revision, 1, 999, 0) || clampInt(raw.version, 1, 999, 1);
  meta.revision = revision;
  meta.revisionToken = oneLine(raw.revisionToken, 80)
    || ('rev-' + revision + '-' + String(raw.updatedAt || Date.now()).slice(-6));
  const token = Number(raw.token);
  if (Number.isFinite(token) && token > 0) meta.token = token;
  return meta;
}

function normalizeCondition(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const blockId = oneLine(raw.blockId || raw.block || '', 40);
  const when = raw.when && typeof raw.when === 'object' ? raw.when : {};
  const type = ['metric-gte', 'metric-lt', 'checkbox'].includes(when.type) ? when.type : 'metric-gte';
  const path = oneLine(when.path, 200);
  const value = when.value == null ? null : Number(when.value);
  if (!blockId || !path || value === null || !Number.isFinite(value)) return null;
  return { blockId, when: { type, path, value } };
}

function normalizeDependency(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const blockId = oneLine(raw.blockId || raw.block || '', 40);
  const dependsOn = (Array.isArray(raw.dependsOn) ? raw.dependsOn : [])
    .map((d) => oneLine(d, 40)).filter(Boolean);
  if (!blockId || !dependsOn.length) return null;
  return { blockId, dependsOn };
}

function normalizeVersion(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const blockId = oneLine(raw.blockId || raw.block || '', 40);
  const version = clampInt(raw.version, 1, 999, 1);
  const changedBy = oneLine(raw.changedBy, 120);
  const changedAt = clampInt(raw.changedAt, 0, Date.now(), Date.now());
  const note = text(raw.note, 1000);
  if (!blockId || !changedBy) return null;
  return { blockId, version, changedBy, changedAt, note };
}

function normalizeDynamicData(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const blockId = oneLine(raw.blockId || raw.block || '', 40);
  const source = ['live', 'static'].includes(String(raw.source || '').toLowerCase()) ? String(raw.source || '').toLowerCase() : 'static';
  const query = text(raw.query, 2000);
  if (!blockId || !query) return null;
  return { blockId, source, query };
}

function normalizeReport(raw, warnings) {
  const legacySections = (Array.isArray(raw.sections) ? raw.sections : []).slice(0, LIMITS.sections)
    .map(normalizeSection).filter(Boolean);
  const blocks = normalizeBlocks(
    Array.isArray(raw.blocks) && raw.blocks.length ? raw.blocks : blocksFromSections(legacySections),
  );
  const findings = (Array.isArray(raw.findings) ? raw.findings : []).slice(0, LIMITS.findings)
    .map((f) => text(f, 2000)).filter(Boolean);
  const references = (Array.isArray(raw.references) ? raw.references : []).slice(0, LIMITS.references)
    .map(normalizeReference).filter(Boolean);
  const summary = text(raw.summary || raw.executiveSummary, LIMITS.summary);
  const topChart = normalizeChart(raw.chart);
  if (!blocks.length && !summary && !findings.length && !topChart) {
    return { error: 'The report has no blocks, summary, findings or chart.' };
  }
  if (Array.isArray(raw.references) && raw.references.length > references.length) {
    warnings.push('Some references were dropped because their links were not http(s).');
  }
  // A model can choose the look but never define one: theme/paper/pattern/font
  // are closed sets, and the renderer owns every pixel.
  const theme = pickOne(raw.theme, REPORT_THEMES, 'clean');
  const defaultFont = (theme === 'editorial' || theme === 'magazine' || theme === 'academic' || theme === 'notebook')
    ? 'editorial' : 'neutral';
  const artifact = {
    kind: 'report',
    title: oneLine(raw.title, LIMITS.title) || 'Report',
    kicker: oneLine(raw.kicker, 120),
    subtitle: oneLine(raw.subtitle, LIMITS.subtitle),
    summary,
    blocks,
    // Kept so older stored chats and the legacy renderer still paint; the new
    // renderer prefers blocks.
    sections: sectionsFromBlocks(blocks),
    findings,
    references,
    chart: topChart || (blocks.find((b) => b.type === 'chart') || {}).chart || null,
    theme,
    paper: pickOne(raw.paper, REPORT_PAPERS, 'paper'),
    pattern: pickOne(raw.pattern, REPORT_PATTERNS, 'solid'),
    font: pickOne(raw.font, REPORT_FONTS, defaultFont),
    version: clampInt(raw.version, 1, 999, 1),
    updatedAt: Date.now(),
    toc: raw.toc === true,
    searchable: raw.searchable === true,
    annotations: (Array.isArray(raw.annotations) ? raw.annotations : []).slice(0, LIMITS.annotations).map(normalizeAnnotation).filter(Boolean),
    conditions: (Array.isArray(raw.conditions) ? raw.conditions : []).slice(0, LIMITS.conditions).map(normalizeCondition).filter(Boolean),
    dependencies: (Array.isArray(raw.dependencies) ? raw.dependencies : []).slice(0, LIMITS.dependencies).map(normalizeDependency).filter(Boolean),
    versions: (Array.isArray(raw.versions) ? raw.versions : []).slice(0, LIMITS.versions).map(normalizeVersion).filter(Boolean),
    dynamicData: (Array.isArray(raw.dynamicData) ? raw.dynamicData : []).slice(0, LIMITS.dynamicData).map(normalizeDynamicData).filter(Boolean),
  };
  // V15-V19 self-describing contract. These fields describe real app
  // behaviours and let the viewer/export/E2E paths observe them consistently.
  Object.assign(artifact, normalizeReportStatus(raw, artifact.title));
  return { artifact };
}

// Replace any existing document shell with one we control. The CSP is first
// in the head; a model-supplied CSP can only make the result stricter.
// Multi-file sites -----------------------------------------------------------
// A site can arrive as a set of files (`index.html`, `styles.css`, `app.js`, …)
// instead of one long HTML string. Producing a real project is much easier for
// the model to get right than one giant escaped string, and it lets the app
// export the same files a person would have written. For preview and export we
// inline everything into one self-contained document, which is what the sandbox
// and the standalone HTML export both need.

const SITE_FILE_EXT = /\.(html?|css|js|mjs|json|svg|txt|md|xml)$/i;

// A path is accepted only when it is relative, forward-slashed and stays inside
// the artifact: no absolute paths, no traversal, no protocol tricks.
function safeSitePath(value) {
  const raw = String(value == null ? '' : value).trim().replace(/^\.\//, '');
  if (!raw || raw.length > 160) return '';
  if (/^[a-z]+:/i.test(raw)) return '';
  if (raw.startsWith('/') || raw.includes('\\')) return '';
  if (raw.split('/').some((part) => part === '..' || part === '.' || !part)) return '';
  if (!/^[\w./-]+$/.test(raw)) return '';
  return raw;
}

function normalizeSiteFiles(raw, warnings) {
  const list = Array.isArray(raw) ? raw : [];
  const files = [];
  const seen = new Set();
  let total = 0;
  for (const entry of list.slice(0, LIMITS.siteFiles)) {
    if (!entry || typeof entry !== 'object') continue;
    const path = safeSitePath(entry.path || entry.name);
    if (!path) {
      warnings.push('Skipped a site file with an unsafe path (' + String(entry.path || entry.name || '?') + ').');
      continue;
    }
    if (seen.has(path.toLowerCase())) {
      warnings.push('Skipped a duplicate site file (' + path + ').');
      continue;
    }
    if (!SITE_FILE_EXT.test(path)) {
      warnings.push('Skipped ' + path + ' — only html, css, js, json, svg, txt and xml files are supported.');
      continue;
    }
    const content = text(entry.content != null ? entry.content : entry.body, LIMITS.siteFileChars);
    if (!content) {
      warnings.push('Skipped the empty site file ' + path + '.');
      continue;
    }
    total += content.length;
    if (total > LIMITS.siteFileTotal) {
      warnings.push('The site is larger than the preview limit; later files were dropped.');
      break;
    }
    seen.add(path.toLowerCase());
    files.push({ path, content });
  }
  return files;
}

function siteEntryPath(files) {
  const byLower = new Map(files.map((f) => [f.path.toLowerCase(), f.path]));
  if (byLower.has('index.html')) return byLower.get('index.html');
  if (byLower.has('index.htm')) return byLower.get('index.htm');
  const first = files.find((f) => /\.html?$/i.test(f.path));
  return first ? first.path : '';
}

function svgDataUri(markup) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
}

// Resolves a reference written inside the artifact to a real file. Accepts
// both the exact project path and a bare basename (`./app.js`, `app.js`).
function resolveSiteFile(files, ref) {
  const clean = String(ref || '').trim().split(/[?#]/)[0].replace(/^\.?\//, '');
  if (!clean) return null;
  const lower = clean.toLowerCase();
  const exact = files.find((f) => f.path.toLowerCase() === lower);
  if (exact) return exact;
  const base = lower.split('/').pop();
  const loose = files.filter((f) => f.path.toLowerCase().split('/').pop() === base);
  return loose.length === 1 ? loose[0] : null;
}

function inlineCssImports(css, files, depth, warnings) {
  if (depth > 3) return css;
  return css.replace(/@import\s+(?:url\()?["']([^"')]+)["']\)?\s*;?/gi, (whole, ref) => {
    const file = resolveSiteFile(files, ref);
    if (!file) { warnings.push('Missing stylesheet import ' + ref + '.'); return ''; }
    return inlineCssImports(file.content, files, depth + 1, warnings);
  });
}

function cssAssetUrls(css, files, warnings) {
  return css.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi, (whole, ref) => {
    if (/^(data:|https?:|#)/i.test(ref)) return whole;
    const file = resolveSiteFile(files, ref);
    if (!file) { warnings.push('Missing asset ' + ref + ' referenced from CSS.'); return 'none'; }
    if (/\.svg$/i.test(file.path)) return 'url("' + svgDataUri(file.content) + '")';
    return whole;
  });
}

// Builds one self-contained HTML document from the file set. `entryPath`
// picks which page to build (defaults to index.html). The single-document
// form is the srcdoc fallback and the base of the exports; the live preview
// serves the real files over dexsite:// instead (see resolveSiteRequest).
function assembleSiteDocument(files, warnings, entryPath) {
  const wanted = String(entryPath || '').trim();
  let entry = wanted ? (files.find((f) => f.path.toLowerCase() === wanted.toLowerCase()) || {}).path : '';
  if (wanted && !entry) warnings.push('The page "' + wanted + '" is not part of this website.');
  if (!entry) entry = siteEntryPath(files);
  if (!entry) return { error: 'The website has no index.html (or any HTML file) to open.' };
  const entryFile = files.find((f) => f.path === entry);
  let html = entryFile.content;
  const missing = [];

  // <link>: stylesheets are inlined; icons resolve to a data URI (the favicon
  // survives preview and export); every other kind (preload, manifest, …) is
  // kept as written — deleting them silently dropped real markup, and without
  // a network they are harmless.
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (/rel\s*=\s*["']?stylesheet/i.test(tag)) {
      if (!href) return '';
      const file = resolveSiteFile(files, href[1]);
      if (!file) { missing.push(href[1]); return ''; }
      const css = cssAssetUrls(inlineCssImports(file.content, files, 0, warnings), files, warnings);
      return '<style data-src="' + file.path + '">' + css + '</style>';
    }
    if (href && /rel\s*=\s*["']?[^"'>]*icon/i.test(tag)) {
      const file = resolveSiteFile(files, href[1]);
      if (file && /\.svg$/i.test(file.path)) return tag.replace(href[0], 'href="' + svgDataUri(file.content) + '"');
    }
    return tag;
  });

  // <script src=x></script> -> <script>…</script> (module scripts kept as-is)
  html = html.replace(/<script\b([^>]*)>\s*<\/script>/gi, (tag, attrs) => {
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs || '');
    if (!src) return tag;
    const file = resolveSiteFile(files, src[1]);
    if (!file) { missing.push(src[1]); return ''; }
    const type = /\btype\s*=\s*["']module["']/i.test(attrs || '') ? ' type="module"' : '';
    return '<script' + type + ' data-src="' + file.path + '">' + file.content + '</script>';
  });

  // <img src=x> for inline SVG files -> data URI
  html = html.replace(/<img\b([^>]*)>/gi, (tag, attrs) => {
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs || '');
    if (!src || /^(data:|https?:)/i.test(src[1])) return tag;
    const file = resolveSiteFile(files, src[1]);
    if (!file) { missing.push(src[1]); return tag; }
    if (!/\.svg$/i.test(file.path)) return tag;
    return tag.replace(src[0], 'src="' + svgDataUri(file.content) + '"');
  });

  for (const ref of [...new Set(missing)]) warnings.push('Missing file referenced by the page: ' + ref + '.');
  if (!/<html\b/i.test(html)) {
    html = '<!doctype html><html><head><meta charset="utf-8"></head><body>' + html + '</body></html>';
  }
  return { html, entry };
}

function safeSiteDocument(source, warnings, opts) {
  let html = text(source, LIMITS.html);
  if (!html) return { error: 'The website artifact has no HTML.' };
  // The structural check compares only against the two replaces below. It used
  // to compare after the external-reference strips as well, so every stripped
  // link produced a bogus "Removed a base or refresh tag" warning.
  const beforeStructural = html.length;
  html = html
    .replace(/<base\b[^>]*>/gi, '')
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '');
  const structural = html.length !== beforeStructural;
  // With the file set at hand, a relative link that resolves to a real file is
  // *internal navigation* (it works over the virtual host, and exported file
  // sets keep their links); only the genuinely external references are
  // stripped from the single-document form.
  const files = opts && Array.isArray(opts.files) ? opts.files : null;
  const isExternalHref = (href) => {
    if (/^(#|mailto:|tel:|javascript:)/i.test(href)) return false;
    if (files && resolveSiteFile(files, href)) return false;
    return true;
  };
  // Strip external resource references — keep inline resources only
  const externalScripts = (html.match(/<script\b[^>]*src\s*=/gi) || []).length;
  const externalStyles = (html.match(/<link\b[^>]*rel\s*=\s*["']stylesheet["'][^>]*>/gi) || []).length;
  const externalImages = (html.match(/<img\b[^>]*src\s*=\s*["'](?!data:)[^"']*["']/gi) || []).length;
  const externalLinks = (html.match(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi) || [])
    .filter((tag) => {
      const m = /href\s*=\s*["']([^"']+)["']/i.exec(tag);
      return !m || isExternalHref(m[1]);
    }).length;
  html = html
    // Strip src attribute from script tags (keep inline scripts). The match must
    // start at an attribute boundary so `data-src` is never mistaken for `src`.
    .replace(/<script\b([^>]*)\s+src\s*=\s*["'][^"']*["']([^>]*)>/gi, '<script$1$2></script>')
    // Remove external stylesheet links
    .replace(/<link\b[^>]*rel\s*=\s*["']stylesheet["'][^>]*>/gi, '')
    // Strip src from external images (keep data: URIs)
    .replace(/<img\b([^>]*)\s+src\s*=\s*["'](?!data:)[^"']*["']([^>]*)>/gi, '<img$1$2>')
    // Strip href from external links (keep anchors/internal pages/mailto/tel/javascript)
    .replace(/<a\b([^>]*)href\s*=\s*["']([^"']+)["']([^>]*)>/gi, (tag, pre, href, post) =>
      isExternalHref(href) ? '<a' + pre + post + '>' : tag);
  const removed = externalScripts + externalStyles + externalImages + externalLinks;
  if (removed) warnings.push('Removed ' + removed + ' external resource reference(s) from website sandbox.');
  if (structural) warnings.push('Removed a base or refresh tag from the preview.');
  const head = '<meta charset="utf-8">'
    + '<meta http-equiv="Content-Security-Policy" content="' + SITE_CSP + '">'
    + '<meta name="referrer" content="no-referrer">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">';
  if (/<head\b[^>]*>/i.test(html)) {
    html = html.replace(/<head\b([^>]*)>/i, '<head$1>' + head);
  } else if (/<html\b[^>]*>/i.test(html)) {
    html = html.replace(/<html\b([^>]*)>/i, '<html$1><head>' + head + '</head>');
  } else {
    html = '<!doctype html><html><head>' + head + '</head><body>' + html + '</body></html>';
  }
  return { html };
}

// All the HTML pages of a site, entry first (the multi-page chrome and the
// saved artifact both carry this list). The virtual host module builds on it.
function sitePages(files) {
  const entry = siteEntryPath(files);
  const pages = files.filter((f) => /\.html?$/i.test(f.path)).map((f) => f.path);
  pages.sort((a, b) => (a === entry ? -1 : b === entry ? 1 : a.localeCompare(b)));
  return pages.slice(0, LIMITS.siteFiles);
}

function normalizeAnswerIndex(value, options) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < options.length) return value;
  if (typeof value === 'string') {
    const exact = options.findIndex((o) => o.toLowerCase() === value.trim().toLowerCase());
    if (exact >= 0) return exact;
    const n = parseInt(value.trim(), 10);
    if (Number.isInteger(n) && n >= 0 && n < options.length) return n;
  }
  return -1;
}

function normalizeQuestion(raw, warnings, index) {
  if (!raw || typeof raw !== 'object') return null;
  const type = ['single', 'multi', 'truefalse', 'short', 'match'].includes(raw.type) ? raw.type : 'single';
  const prompt = text(raw.prompt || raw.question, LIMITS.quizText);
  if (!prompt) return null;
  const explanation = text(raw.explanation, LIMITS.quizText);
  const base = { type, prompt, explanation };

  if (type === 'single' || type === 'multi' || type === 'truefalse') {
    let options;
    let answer;
    if (type === 'truefalse') {
      options = ['True', 'False'];
      const b = bool(raw.answer);
      if (b === null) { warnings.push('Question ' + (index + 1) + ': true/false answer was invalid.'); return null; }
      answer = b;
    } else {
      options = (Array.isArray(raw.options) ? raw.options : [])
        .slice(0, LIMITS.quizOptions).map((o) => oneLine(o, 500)).filter(Boolean);
      if (options.length < 2) { warnings.push('Question ' + (index + 1) + ': fewer than two options.'); return null; }
      if (type === 'multi') {
        const list = Array.isArray(raw.answer) ? raw.answer : [raw.answer];
        const picks = [...new Set(list.map((v) => normalizeAnswerIndex(v, options)).filter((n) => n >= 0))].sort((a, b) => a - b);
        if (!picks.length) { warnings.push('Question ' + (index + 1) + ': no valid correct options.'); return null; }
        answer = picks;
      } else {
        const pick = normalizeAnswerIndex(raw.answer, options);
        if (pick < 0) { warnings.push('Question ' + (index + 1) + ': correct answer did not match an option.'); return null; }
        answer = pick;
      }
    }
    return { ...base, options, answer };
  }

  if (type === 'short') {
    const answer = text(raw.answer, LIMITS.quizText);
    if (!answer) { warnings.push('Question ' + (index + 1) + ': short answer has no model answer.'); return null; }
    const accept = (Array.isArray(raw.accept) ? raw.accept : [])
      .slice(0, 20).map((a) => oneLine(a, 500)).filter(Boolean);
    return { ...base, answer, accept };
  }

  const pairs = (Array.isArray(raw.pairs) ? raw.pairs : []).slice(0, 12)
    .map((p) => (p && typeof p === 'object')
      ? { left: oneLine(p.left, 240), right: oneLine(p.right, 240) }
      : null)
    .filter((p) => p && p.left && p.right);
  if (pairs.length < 2) { warnings.push('Question ' + (index + 1) + ': matching needs at least two pairs.'); return null; }
  return { ...base, pairs };
}

function normalizeQuiz(raw) {
  const warnings = [];
  const questions = (Array.isArray(raw.questions) ? raw.questions : []).slice(0, LIMITS.quizQuestions)
    .map((q, i) => normalizeQuestion(q, warnings, i)).filter(Boolean);
  if (!questions.length) return { error: 'The quiz has no valid questions.' };
  const artifact = {
    kind: 'quiz',
    title: oneLine(raw.title, LIMITS.title) || 'Quiz',
    topic: oneLine(raw.topic, 160),
    difficulty: ['easy', 'medium', 'hard'].includes(String(raw.difficulty || '').toLowerCase())
      ? String(raw.difficulty).toLowerCase() : '',
    passing: clampInt(raw.passing, 0, 100, 60),
    immediate: raw.immediate !== false,
    questions,
  };
  return { artifact, warnings };
}

function normalizeDeck(raw) {
  const cards = (Array.isArray(raw.cards) ? raw.cards : []).slice(0, LIMITS.deckCards)
    .map((c) => (c && typeof c === 'object')
      ? { front: text(c.front || c.question, LIMITS.quizText), back: text(c.back || c.answer, LIMITS.quizText) }
      : null)
    .filter((c) => c && c.front && c.back);
  if (!cards.length) return { error: 'The deck has no valid cards.' };
  return {
    artifact: {
      kind: 'deck',
      title: oneLine(raw.title, LIMITS.title) || 'Flashcards',
      topic: oneLine(raw.topic, 160),
      cards,
    },
  };
}

function normalizeTimeline(raw) {
  const entries = (Array.isArray(raw.entries || raw.events) ? (raw.entries || raw.events) : [])
    .slice(0, LIMITS.timelineEntries).map((e) => {
      if (!e || typeof e !== 'object') return null;
      const title = oneLine(e.title || e.label, 240);
      const body = text(e.text || e.body, LIMITS.sectionBody);
      if (!title && !body) return null;
      return { date: oneLine(e.date || e.when, 80), title, text: body };
    }).filter(Boolean);
  if (!entries.length) return { error: 'The timeline has no entries.' };
  return {
    artifact: {
      kind: 'timeline',
      title: oneLine(raw.title, LIMITS.title) || 'Timeline',
      subtitle: oneLine(raw.subtitle, LIMITS.subtitle),
      entries,
    },
  };
}

function normalizeArtifact(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'The artifact is not a JSON object.' };
  }
  let size = 0;
  try { size = JSON.stringify(raw).length; } catch { return { ok: false, error: 'The artifact could not be read.' }; }
  if (size > LIMITS.jsonChars) return { ok: false, error: 'The artifact is too large.' };
  const kind = String(raw.kind || '').toLowerCase();
  if (!KINDS.includes(kind)) return { ok: false, error: 'Unknown artifact type "' + kind + '".' };
  const warnings = [];
  let out;
  if (kind === 'report') out = normalizeReport(raw, warnings);
  else if (kind === 'site') {
    const rawFiles = Array.isArray(raw.files) ? raw.files : (Array.isArray(raw.assets) ? raw.assets : []);
    const files = rawFiles.length ? normalizeSiteFiles(rawFiles, warnings) : [];
    let rawHtml = String(raw.html || raw.source || '');
    let entry = '';
    if (files.length) {
      const built = assembleSiteDocument(files, warnings);
      if (built.error) return { ok: false, error: built.error };
      rawHtml = built.html;
      entry = built.entry;
    }
    if (rawHtml.length > LIMITS.html) return { ok: false, error: 'The website preview is too large to render safely.' };
    const site = safeSiteDocument(rawHtml, warnings, files.length ? { files } : undefined);
    out = site.error ? site : {
      artifact: {
        kind: 'site',
        title: oneLine(raw.title, LIMITS.title) || 'Interactive preview',
        description: text(raw.description, 4000),
        html: site.html,
        ...(files.length ? { files, entry, pages: sitePages(files) } : {}),
      },
    };
  } else if (kind === 'quiz') out = normalizeQuiz(raw);
  else if (kind === 'deck') out = normalizeDeck(raw);
  else if (kind === 'chart') {
    const chart = normalizeChart(raw.chart || raw);
    // The top-level title is the artifact's name; the inner chart title is a
    // caption. Losing the outer one renamed every chart to "Chart".
    out = chart ? { artifact: { kind: 'chart', title: oneLine(raw.title, LIMITS.title) || chart.title || 'Chart', chart } }
      : { error: 'The chart has no usable labels or series.' };
  } else out = normalizeTimeline(raw);
  if (out.error) return { ok: false, error: out.error };
  const artifact = out.artifact;
  if (artifact.version === undefined) artifact.version = 1;
  const qWarnings = kind === 'report' ? validateReportQuality(artifact) : [];
  return { ok: true, artifact, warnings: (out.warnings || warnings).concat(qWarnings).slice(0, 12) };
}

// Preview diagnostics --------------------------------------------------------
// One honest checklist behind the preview: what is wrong with this artifact,
// how bad is it, and is it safe to export. Pure data, no rendering.
function countWords(value) {
  return String(value || '').split(/\s+/).filter(Boolean).length;
}

function diagnoseArtifact(input) {
  const issues = [];
  const add = (level, code, message, extra) => issues.push(Object.assign({ level, code, message }, extra || {}));
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, level: 'error', issues: [{ level: 'error', code: 'not-object', message: 'This artifact is not a readable object.' }], stats: {} };
  }
  const kind = String(input.kind || '').toLowerCase();
  if (!KINDS.includes(kind)) add('error', 'kind', 'Unknown artifact type "' + kind + '".');
  if (!String(input.title || '').trim()) add('warn', 'title', 'The artifact has no title.');

  const stats = { kind };
  let words = 0;

  if (kind === 'report') {
    const blocks = Array.isArray(input.blocks) ? input.blocks : [];
    stats.blocks = blocks.length;
    if (!blocks.length && !input.summary && !(Array.isArray(input.findings) && input.findings.length)) {
      add('error', 'empty', 'The report has no content.');
    }
    for (const b of blocks) {
      if (!b || typeof b !== 'object') continue;
      if (!BLOCK_TYPES.includes(String(b.type))) add('warn', 'block-type', 'Unknown block type "' + b.type + '" was dropped.');
      words += countWords(b.text) + countWords(b.body);
    }
    words += countWords(input.summary);
    if (words > 0 && words < 60) add('warn', 'short', 'The report is very short (' + words + ' words).');
    for (const ref of (Array.isArray(input.references) ? input.references : [])) {
      if (ref && ref.url && !/^https?:\/\//i.test(String(ref.url))) add('warn', 'reference', 'Reference "' + (ref.title || ref.url) + '" does not use an http(s) link.');
    }
    const embeds = blocks.filter((b) => b && (b.type === 'embed' || b.type === 'image'));
    for (const b of embeds) {
      const src = String(b.src || '');
      if (src && !/^(https?:\/\/|data:image\/|dexref[1-4]$)/i.test(src)) add('warn', 'media', 'A media block points at an unusable source (' + src.slice(0, 60) + ').');
    }
  } else if (kind === 'site') {
    const html = String(input.html || '');
    stats.files = Array.isArray(input.files) ? input.files.length : 0;
    stats.bytes = html.length;
    if (!html) add('error', 'empty', 'The site has no HTML.');
    const external = (html.match(/(?:src|href)\s*=\s*["']https?:\/\//gi) || []).length;
    if (external) add('warn', 'external', external + ' external reference(s) were removed — the preview runs offline.');
    stats.scripts = (html.match(/<script\b/gi) || []).length;
    stats.styles = (html.match(/<style\b/gi) || []).length;
    // Multi-file sites are served from their own offline host now, not
    // flattened: pages link to each other, storage works, and the site's own
    // files can be fetched. (The inlining note stays for the older
    // single-document form, which the Downloads still build from.)
    if (stats.files > 1) {
      const pages = Array.isArray(input.pages) && input.pages.length ? input.pages.length : 1;
      add('info', 'files', stats.files + ' files are served from this site\'s own offline host'
        + (pages > 1 ? ' — ' + pages + ' linked pages, real navigation, storage and fetch of its own files.' : '.'));
    }
    if (!stats.scripts && !stats.styles) add('info', 'static', 'This page has no CSS or JavaScript of its own.');
    // The Generated Site Spec validator (string-level only — contrast,
    // layout and keyboard behaviour need a live browser and are not guessed).
    if (Array.isArray(input.files) && input.files.length) {
      const quality = validateSiteQuality(input.files);
      stats.qualityIssues = quality.issues.length;
      for (const q of quality.issues.slice(0, 16)) {
        add(q.level, 'quality-' + q.code, (q.file ? q.file + ': ' : '') + q.message, q.hint ? { hint: q.hint } : undefined);
      }
    }
  } else if (kind === 'quiz') {
    const qs = Array.isArray(input.questions) ? input.questions : [];
    stats.questions = qs.length;
    if (!qs.length) add('error', 'empty', 'The quiz has no questions.');
    qs.forEach((q, i) => {
      if (!q || typeof q !== 'object') return;
      if ((q.type === 'single' || q.type === 'truefalse') && !(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < (q.options || []).length)) {
        add('error', 'answer', 'Question ' + (i + 1) + ' has no valid correct answer.');
      }
      if (q.type === 'multi' && !(Array.isArray(q.answer) && q.answer.length)) add('error', 'answer', 'Question ' + (i + 1) + ' has no correct options marked.');
      if (q.type === 'match' && !(Array.isArray(q.pairs) && q.pairs.length >= 2)) add('warn', 'pairs', 'Question ' + (i + 1) + ' needs at least two matching pairs.');
    });
  } else if (kind === 'deck') {
    const cards = Array.isArray(input.cards) ? input.cards : [];
    stats.cards = cards.length;
    if (!cards.length) add('error', 'empty', 'The deck has no cards.');
    else if (cards.length < 3) add('info', 'thin', 'Only ' + cards.length + ' card(s) — a deck usually needs more.');
  } else if (kind === 'chart') {
    const chart = input.chart || {};
    stats.series = Array.isArray(chart.series) ? chart.series.length : 0;
    stats.points = Array.isArray(chart.labels) ? chart.labels.length : 0;
    if (!stats.series) add('error', 'empty', 'The chart has no series.');
    else if (stats.points < 2) add('error', 'labels', 'The chart needs at least two labels.');
    for (const s of (Array.isArray(chart.series) ? chart.series : [])) {
      if (s && Array.isArray(s.values) && s.values.length !== stats.points) {
        add('warn', 'series-length', 'Series "' + (s.name || 'Series') + '" has ' + s.values.length + ' value(s) for ' + stats.points + ' label(s).');
      }
    }
  } else if (kind === 'timeline') {
    const entries = Array.isArray(input.entries) ? input.entries : [];
    stats.entries = entries.length;
    if (!entries.length) add('error', 'empty', 'The timeline has no entries.');
    else if (entries.length < 3) add('info', 'thin', 'Only ' + entries.length + ' entr(y/ies) — a timeline usually needs more.');
  }

  const worst = issues.some((i) => i.level === 'error') ? 'error'
    : issues.some((i) => i.level === 'warn') ? 'warn' : 'ok';
  return { ok: worst !== 'error', level: worst, issues, stats };
}

// Follow-up context ----------------------------------------------------------
// A message that asks for a change to the thing just made ("make it shorter",
// "change the heading", "add a footer") has to see the actual source, or the
// model answers from a one-line summary and rewrites from memory. Anything else
// keeps the cheap summary.
const CHANGE_ASK = /\b(change|edit|update|fix|redo|rewrite|revise|make it|turn it|tweak|adjust|add|remove|delete|rename|shorten|shorter|longer|expand|simplify|restyle|recolour|recolor|colour|color|theme|font|style|layout|split|merge|fix up|polish|improve)\b/i;
const FOLLOW_UP_REF = /\b(it|this|that|these|those|the (?:report|site|page|website|quiz|deck|chart|timeline|artifact|document|app))\b/i;
const FOLLOW_UP_SOURCE_CHARS = 24000;

function artifactFollowUpNote(artifact, userText) {
  const a = artifact || {};
  const text = String(userText || '');
  if (!text || !a.kind) return '';
  const change = CHANGE_ASK.test(text);
  const refers = FOLLOW_UP_REF.test(text);
  // A change request always gets the source; a bare reference gets it only for
  // the artifact a person can only talk about concretely (a site).
  if (!change && !(refers && (a.kind === 'site' || a.kind === 'chart'))) return '';
  const source = revisionSource(a).slice(0, FOLLOW_UP_SOURCE_CHARS);
  const summary = artifactSummary(a);
  return [
    'The person is talking about the ' + a.kind + ' you already made' + (a.title ? ' ("' + a.title + '")' : '') + '.',
    summary ? 'Summary: ' + summary : '',
    'Its current content:',
    source,
    'Edit that content instead of starting over; return the whole ' + a.kind + ' as one dex-artifact block when the change is done.',
  ].filter(Boolean).join('\n');
}

// Revision prompt ------------------------------------------------------------
// A revision is an edit, not a fresh generation: the model needs the artifact
// as it stands, or it will rewrite from scratch and lose details. The source is
// bounded so a huge site cannot blow the context budget.
const REVISION_SOURCE_CHARS = 60000;

function revisionSource(artifact) {
  const a = artifact || {};
  if (a.kind === 'site' && Array.isArray(a.files) && a.files.length) {
    const parts = [];
    let used = 0;
    for (const f of a.files) {
      const body = String(f.content || '');
      const room = REVISION_SOURCE_CHARS - used;
      if (room <= 200) { parts.push('… (remaining files omitted for length)'); break; }
      const slice = body.length > room ? body.slice(0, room) + '\n… (file truncated)' : body;
      parts.push('--- FILE ' + f.path + ' ---\n```\n' + slice + '\n```');
      used += slice.length;
    }
    return parts.join('\n');
  }
  if (a.kind === 'site') {
    return '--- FILE index.html ---\n```\n' + String(a.html || '').slice(0, REVISION_SOURCE_CHARS) + '\n```';
  }
  let json = '';
  try { json = JSON.stringify({ ...a, history: undefined }, null, 1); } catch { json = ''; }
  return json.length > REVISION_SOURCE_CHARS
    ? json.slice(0, REVISION_SOURCE_CHARS) + '\n… (truncated)'
    : json;
}

function artifactRevisionPrompt(artifact, instructions, opts) {
  const a = artifact || {};
  const o = opts || {};
  const kind = String(a.kind || 'report');
  const title = a.title || 'the artifact';
  const lines = [
    'Revise the existing ' + kind + ' "' + title + '" and return ONE fenced dex-artifact block of the same kind.',
    'Change instructions: ' + String(instructions || '').trim(),
    'REVISION CONTRACT: this is an edit of the existing artifact, not a new one. Keep the same subject, title, purpose, files and overall code architecture unless the instructions ask otherwise.',
    'How to work: treat the current source below as the truth. Keep every part the instructions do not ask you to change, byte for byte where you can, and never drop content the person already approved.',
  ];
  if (kind === 'site') {
    lines.push('VIEWPORT CONTRACT: keep the page filling the full preview iframe — html/body margin:0 and width:100%, a top-level root with width:100% and min-height:100vh, no small centred card or browser mockup. JAVASCRIPT IS MANDATORY: keep or repair one end-of-body <script> with real listeners for every control.');
    lines.push('Reuse the existing class names, ids, CSS custom properties and JavaScript state where they still fit. Change only the requested parts plus the quality issues below. Do not create a new site or artifact.');
    lines.push(Array.isArray(a.files) && a.files.length
      ? 'Return the same file set (same paths) as a "files" array; add or remove files only if the instructions ask.'
      : 'Return the page as a single "html" string (this site has one file).');
    if (Array.isArray(a.files) && a.files.length) {
      const quality = validateSiteQuality(a.files).issues.slice(0, 10);
      if (quality.length) {
        lines.push('While you are here, fix these quality issues unless the change instructions say otherwise:');
        // Group by page so a multi-file site is fixed one page at a time instead
        // of a flat list the model can misplace.
        const byFile = new Map();
        for (const q of quality) {
          const key = q.file || '(site-wide)';
          if (!byFile.has(key)) byFile.set(key, []);
          byFile.get(key).push(q);
        }
        for (const [file, qs] of byFile) {
          lines.push('  ' + file + ':');
          for (const q of qs) {
            lines.push('    - [' + (q.level === 'error' ? 'error' : 'warning') + '] ' + q.message
              + (q.hint ? ' (fix: ' + q.hint + ')' : ''));
          }
        }
      }
    }
  }
  lines.push('Do not invent new claims, citations or data. If a change needs information you do not have, make the smallest reasonable edit instead.',
    'Current source:', revisionSource(a));
  return lines.join('\n');
}

// Artifact search ------------------------------------------------------------
// "Find that report I made last week": one flat text index per artifact plus a
// ranked search over every chat. Pure so it can be tested without a store.
// The text one block contributes to search (and to "where did it match").
function blockSearchText(b) {
  if (!b || typeof b !== 'object') return '';
  const parts = [b.text, b.body, b.label, b.attribution, b.value, b.subtitle];
  for (const item of (Array.isArray(b.items) ? b.items : [])) {
    parts.push(typeof item === 'string' ? item : (item && (item.text || item.title || item.label || item.value)));
  }
  for (const col of (Array.isArray(b.columns) ? b.columns : [])) parts.push(col);
  for (const row of (Array.isArray(b.rows) ? b.rows : [])) {
    for (const cell of (Array.isArray(row) ? row : [])) parts.push(cell);
  }
  return parts.filter(Boolean).join(' ');
}

function artifactSearchText(artifact) {
  const a = artifact || {};
  const parts = [a.title, a.subtitle, a.kicker, a.summary, a.description, a.topic];
  for (const b of (Array.isArray(a.blocks) ? a.blocks : [])) {
    parts.push(blockSearchText(b));
  }
  for (const q of (Array.isArray(a.questions) ? a.questions : [])) parts.push(q && q.prompt, q && q.explanation);
  for (const c of (Array.isArray(a.cards) ? a.cards : [])) parts.push(c && c.front, c && c.back);
  for (const e of (Array.isArray(a.entries) ? a.entries : [])) parts.push(e && e.title, e && e.text, e && e.date);
  for (const r of (Array.isArray(a.references) ? a.references : [])) parts.push(r && r.title, r && r.publisher);
  // Reading notes are part of the document (V18): a person can find a report
  // by what their own note says, not just by the generated text.
  for (const an of (Array.isArray(a.annotations) ? a.annotations : [])) parts.push(an && an.note, an && an.quote);
  for (const f of (Array.isArray(a.files) ? a.files : [])) parts.push(f && f.path, String((f && f.content) || '').slice(0, 20000));
  if (a.kind === 'site' && a.html) parts.push(String(a.html).replace(/<[^>]+>/g, ' ').slice(0, 20000));
  return parts.filter(Boolean).join('\n').replace(/\s+/g, ' ').trim();
}

// Where a query matched (V18): the block index to land on, and whether the
// match is in a reading note — Files says so, and the viewer opens the notes
// panel when that is the reason the report was found.
function findHitSpot(a, lower) {
  const notes = Array.isArray(a && a.annotations) ? a.annotations : [];
  for (const an of notes) {
    const hay = (String((an && an.note) || '') + ' ' + String((an && an.quote) || '')).toLowerCase();
    if (hay.includes(lower)) {
      const b = Number(an.blockId);
      return { blockIndex: Number.isInteger(b) && b >= 0 ? b : null, noteHit: true };
    }
  }
  const blocks = Array.isArray(a && a.blocks) ? a.blocks : [];
  for (let i = 0; i < blocks.length; i++) {
    if (blockSearchText(blocks[i]).toLowerCase().includes(lower)) return { blockIndex: i, noteHit: false };
  }
  return { blockIndex: null, noteHit: false };
}

function searchSnippet(text, query, at) {
  if (at < 0) return text.slice(0, 140);
  const start = Math.max(0, at - 60);
  const end = Math.min(text.length, at + query.length + 80);
  return (start ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
}

// The extraction cache (V20): keyed by the artifact object itself, so a
// repeat search over unchanged chats skips the multi-hundred-KB regex work.
// Bounded by the store's lifetime — objects are dropped when chats reload.
const searchTextCache = new WeakMap();
function artifactSearchTextCached(a) {
  if (!a || typeof a !== 'object') return '';
  if (searchTextCache.has(a)) return searchTextCache.get(a);
  const text = artifactSearchText(a);
  try { searchTextCache.set(a, text); } catch { /* cache is an optimisation */ }
  return text;
}

function searchArtifacts(chats, query, opts) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const lower = q.toLowerCase();
  const o = opts || {};
  const limit = Math.max(1, Math.min(100, Number(o.limit) || 20));
  const hits = [];
  for (const chat of (Array.isArray(chats) ? chats : [])) {
    const messages = Array.isArray(chat && chat.messages) ? chat.messages : [];
    messages.forEach((m, index) => {
      const a = m && m.artifact;
      if (!a || typeof a !== 'object') return;
      const title = String(a.title || '');
      const titleHit = title.toLowerCase().includes(lower);
      const kindHit = String(a.kind || '').toLowerCase().includes(lower);
      // Full-text extraction is expensive (all blocks + up to 400KB of HTML
      // per site artifact) and the Files page runs it on every keystroke over
      // the same store objects: repeat queries reuse the extracted text (V20).
      const text = artifactSearchTextCached(a);
      // Reuse the folded-string offset for the snippet, rather than folding
      // and searching the same cached body again for every match.
      const bodyAt = text.toLowerCase().indexOf(lower);
      if (!titleHit && bodyAt < 0 && !kindHit) return;
      const spot = findHitSpot(a, lower);
      hits.push({
        chatId: String(chat.id || ''),
        chatTitle: String(chat.title || 'Chat'),
        index,
        kind: String(a.kind || ''),
        title: title || 'Artifact',
        score: (titleHit ? 10 : 0) + (kindHit ? 2 : 0),
        snippet: searchSnippet(text, q, bodyAt),
        at: Number(a.updatedAt || chat.updatedAt || 0) || 0,
        blockIndex: spot.blockIndex,
        noteHit: spot.noteHit,
      });
    });
  }
  hits.sort((x, y) => (y.score - x.score) || (y.at - x.at));
  return hits.slice(0, limit);
}

// Interactive artifact state -------------------------------------------------
// Quiz answers and flashcard "known" marks are the person's work, not the
// model's: they are stored beside the artifact so a reload does not throw them
// away. Bounded and typed, keyed by question/card index.
const MAX_STATE_ENTRIES = 300;

function normalizeArtifactState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const state = {};
  const answers = Array.isArray(raw.answers) ? raw.answers : [];
  const keptAnswers = answers.slice(0, MAX_STATE_ENTRIES).map((pair) => {
    if (!Array.isArray(pair) || pair.length < 2) return null;
    const at = Math.round(Number(pair[0]));
    if (!Number.isInteger(at) || at < 0 || at > MAX_STATE_ENTRIES) return null;
    const value = pair[1];
    if (typeof value === 'string') return [at, value.slice(0, 2000)];
    if (typeof value === 'boolean') return [at, value];
    if (typeof value === 'number' && Number.isFinite(value)) return [at, value];
    if (Array.isArray(value)) {
      const list = value.slice(0, 12).map((v) => Number(v)).filter((v) => Number.isFinite(v));
      return list.length ? [at, list] : null;
    }
    if (Array.isArray(value)) return null;
    if (value && typeof value === 'object') return null;
    return null;
  }).filter(Boolean);
  if (keptAnswers.length) state.answers = keptAnswers;
  const checked = Array.isArray(raw.checked) ? raw.checked : [];
  const keptChecked = checked.slice(0, MAX_STATE_ENTRIES).map((pair) => {
    if (!Array.isArray(pair) || pair.length < 2) return null;
    const at = Math.round(Number(pair[0]));
    const r = pair[1] && typeof pair[1] === 'object' ? pair[1] : null;
    if (!Number.isInteger(at) || !r) return null;
    return [at, { correct: Boolean(r.correct), score: Math.max(0, Math.min(1, Number(r.score) || 0)) }];
  }).filter(Boolean);
  if (keptChecked.length) state.checked = keptChecked;
  // Quiz option order: answers are stored as display indices, so the shuffled
  // order they were made in has to survive too — otherwise a restored shuffled
  // quiz re-derived identity order and the same index pointed at a different
  // option (the answers were right, the marks were not).
  const orders = Array.isArray(raw.orders) ? raw.orders : [];
  const keptOrders = orders.slice(0, MAX_STATE_ENTRIES).map((pair) => {
    if (!Array.isArray(pair) || pair.length < 2 || !Array.isArray(pair[1])) return null;
    const at = Math.round(Number(pair[0]));
    if (!Number.isInteger(at) || at < 0 || at > MAX_STATE_ENTRIES) return null;
    const list = pair[1].slice(0, 50)
      .map((v) => Math.round(Number(v)))
      .filter((v) => Number.isInteger(v) && v >= 0 && v <= MAX_STATE_ENTRIES);
    return list.length ? [at, list] : null;
  }).filter(Boolean);
  if (keptOrders.length) state.orders = keptOrders;
  if (Number.isInteger(raw.current)) state.current = Math.max(0, Math.min(MAX_STATE_ENTRIES, raw.current));
  if (raw.finished === true) state.finished = true;
  const known = Array.isArray(raw.known) ? raw.known : [];
  const keptKnown = known.slice(0, MAX_STATE_ENTRIES)
    .map((v) => Math.round(Number(v)))
    .filter((v) => Number.isInteger(v) && v >= 0 && v <= MAX_STATE_ENTRIES);
  if (keptKnown.length) state.known = keptKnown;
  if (Number.isInteger(raw.index) && raw.index >= 0 && raw.index <= MAX_STATE_ENTRIES) state.index = raw.index;
  if (raw.flipped === true) state.flipped = true;
  return Object.keys(state).length ? state : null;
}

// Source view ----------------------------------------------------------------
// What the "Code" panel shows: the files a site was built from, or the artifact
// JSON the model actually produced. Pure, safe to call on anything.
function langFor(path) {
  const ext = String(path || '').toLowerCase().split('.').pop();
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'css') return 'css';
  if (ext === 'js' || ext === 'mjs') return 'js';
  if (ext === 'json') return 'json';
  if (ext === 'svg') return 'xml';
  if (ext === 'md') return 'md';
  return 'text';
}

function artifactSources(artifact) {
  const a = artifact || {};
  const out = [];
  if (a.kind === 'site' && Array.isArray(a.files) && a.files.length) {
    for (const f of a.files) out.push({ name: f.path, lang: langFor(f.path), content: String(f.content || '') });
  } else if (a.kind === 'site') {
    out.push({ name: 'index.html', lang: 'html', content: String(a.html || '') });
  }
  out.push({ name: 'artifact.json', lang: 'json', content: JSON.stringify(a, null, 2) });
  return out;
}

function stripFences(value) {
  return String(value || '')
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

function parseJsonLoose(value) {
  const source = stripFences(value);
  try { return JSON.parse(source); } catch {}
  const first = source.indexOf('{');
  const last = source.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const slice = source.slice(first, last + 1);
    try { return JSON.parse(slice); } catch {}
    const repaired = slice.replace(/,\s*([}\]])/g, '$1');
    try { return JSON.parse(repaired); } catch {}
  }
  return null;
}

const OPEN = /```[ \t]*(?:dex-artifact|dex_artifact|artifact)[ \t]*\r?\n/i;

// Detect whether a reply looks like it was meant to be an artifact but the
// model emitted plain code/markdown instead of a fenced dex-artifact block.
// Returns a report artifact wrapping the content, or null.
function autoWrapArtifact(source, wants) {
  // Only when a deliverable was asked for: an ordinary code answer must stay
  // a code answer, not become a one-block "report" card.
  if (!wants) return null;
  const s = String(source || '');
  // Look for a fenced code block or any structured content.
  const codeOpen = /```[ \t]*(\w+)?[ \t]*\r?\n/i;
  const m = codeOpen.exec(s);
  if (!m) return null;
  const close = s.indexOf('```', m.index + m[0].length);
  if (close < 0) return null;
  const code = s.slice(m.index + m[0].length, close).trim();
  if (!code.length) return null;
  const lang = (m[1] || 'text').toLowerCase();
  const before = s.slice(0, m.index).trimEnd();
  const after = s.slice(close + 3).trimEnd();
  const visible = [before, after].filter(Boolean).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  const blocks = [];
  if (lang && lang !== 'text' && lang !== 'plaintext') {
    blocks.push({ type: 'code', text: code, lang });
  } else {
    blocks.push({ type: 'paragraph', text: code });
  }
  if (visible) blocks.unshift({ type: 'paragraph', text: visible });
  const title = (before.match(/^(?:#+\s*)?(.{1,120})$/m) && RegExp.$1) || 'Report';
  const artifact = {
    kind: 'report',
    title: oneLine(title, LIMITS.title) || 'Report',
    blocks,
    theme: 'clean',
    paper: 'paper',
    pattern: 'solid',
    font: 'neutral',
    version: 1,
    updatedAt: Date.now(),
  };
  const normalized = normalizeArtifact({ ...artifact, blocks });
  if (!normalized.ok) return null;
  const text = visible ? visible + '\n\n' : '';
  return { found: true, pending: false, text, artifact: normalized.artifact, warnings: [], error: '', autoWrapped: true };
}

// Does plain text look like a finished report? Conservative for ordinary
// chat; when the person asked for a report (wantsArtifact), any structured
// answer counts. This is what makes the card exist no matter which model
// wrote the reply and whether or not it used the fence.
function looksLikeReportMarkdown(source, wants) {
  const s = String(source || '');
  if (s.trim().length < (wants ? 120 : 240)) return false;
  const headingCount = (s.match(/^#{1,4}\s+\S/gm) || []).length;
  // Standalone short lines followed by a blank line read as section labels
  // ("Summary", "Conversion Table") in models that never emit # headings.
  const labelCount = (s.match(/(^|\n)[^\s|>#`*][^\n]{1,58}\n[ \t]*\n/g) || []).length;
  const hasTable = /(^|\n)\|[^\n]*\|\s*(\n|$)/.test(s) && /(^|\n)\|?[\s:-]*-[\s:|-]*\|?\s*(\n|$)/.test(s);
  const hasRefs = /(^|\n)#{0,4}\s*(?:references|sources|citations)\s*:?\s*(\n|$)/i.test(s);
  const bulletCount = (s.match(/^\s*(?:[-*+]|\d+[.)])\s+\S/gm) || []).length;
  if (wants) return headingCount >= 1 || labelCount >= 2 || hasTable || bulletCount >= 3 || s.length >= 700;
  return headingCount >= 2 && (hasTable || hasRefs);
}

// Plain markdown -> report blocks. Inline markdown stays as-is (the renderer
// paints it). Returns { title, intro, blocks } or null. The intro is the
// opening paragraph the person still reads in the chat above the card.
function markdownReportBlocks(source) {
  const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let title = '';
  let intro = '';
  let i = 0;
  const tableCells = (row) => row.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const isListLine = (line) => /^\s*(?:[-*+]|\d+[.)])\s+/.test(line);
  const isDivider = (line) => /^(?:-{3,}|\*{3,}|_{3,})$/.test(line.trim());
  while (i < lines.length && blocks.length < 240) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) { i++; continue; }
    const fence = /^```[ \t]*([\w+#-]*)[ \t]*$/.exec(trimmed);
    if (fence) {
      const code = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) { code.push(lines[i]); i++; }
      i++;
      blocks.push({ type: 'code', text: code.join('\n').slice(0, 12000), lang: (fence[1] || '').slice(0, 40) });
      continue;
    }
    const head = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(trimmed);
    if (head) {
      const text = head[2].replace(/[*_`]/g, '').trim();
      const level = head[1].length;
      if (!title && (level === 1 || (!blocks.length && !intro))) title = text;
      else blocks.push({ type: 'heading', text: text.slice(0, 180), level: level <= 2 ? 2 : 3 });
      i++;
      continue;
    }
    // Section labels without markdown: a short standalone line followed by a
    // blank line ("Summary", "Conversion Table") is a heading to the reader,
    // so it becomes one here too — this is only run on report-shaped text.
    if (
      trimmed.length <= 60 && trimmed.split(/\s+/).length <= 8 &&
      !/[.,;:!?]$/.test(trimmed) && !/^[|>#`*_-]/.test(trimmed) &&
      !(lines[i + 1] || '').trim() && (lines[i + 2] || '').trim()
    ) {
      blocks.push({ type: 'heading', text: trimmed.replace(/[*_`]/g, '').slice(0, 180), level: 2 });
      i++;
      continue;
    }
    if (/^\|/.test(trimmed) && i + 1 < lines.length && /^\|?[\s:|-]*-[\s:|-]*\|?$/.test(lines[i + 1].trim())) {
      const columns = tableCells(trimmed).slice(0, 12);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i].trim()) && rows.length < 200) {
        rows.push(tableCells(lines[i].trim()).slice(0, columns.length));
        i++;
      }
      if (columns.length >= 2 && rows.length) blocks.push({ type: 'table', columns, rows });
      continue;
    }
    if (/^\|/.test(trimmed)) {
      // A pipe row without its separator header (models mix formats): keep
      // the cells as a quiet line instead of dropping the data.
      const cells = tableCells(trimmed).filter((c) => c && !/^:?-+:?$/.test(c));
      if (cells.length) blocks.push({ type: 'paragraph', text: cells.join(' · ').slice(0, 2000) });
      i++;
      continue;
    }
    if (isListLine(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items = [];
      while (i < lines.length && isListLine(lines[i]) && items.length < 100) {
        items.push(lines[i].replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim().slice(0, 2000));
        i++;
      }
      if (items.length) blocks.push({ type: 'list', items, ordered });
      continue;
    }
    if (/^>\s?/.test(trimmed)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        buf.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'quote', text: buf.join(' ').slice(0, 3000) });
      continue;
    }
    if (isDivider(line)) { blocks.push({ type: 'divider' }); i++; continue; }
    const buf = [];
    while (
      i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\||>\s?)/.test(lines[i].trim()) &&
      !isListLine(lines[i]) && !isDivider(lines[i])
    ) {
      buf.push(lines[i].trim());
      i++;
    }
    const text = buf.join(' ').trim().slice(0, 12000);
    if (!text) { i++; continue; }
    if (!intro && !title && !blocks.length) intro = text;
    else blocks.push({ type: 'paragraph', text });
  }
  if (!blocks.length) return null;
  if (!title) {
    // No heading anywhere: the first paragraph's opening words name the
    // document, the way a chat model would title its own first line.
    const first = blocks.find((b) => b.type === 'paragraph' && b.text);
    if (first) {
      title = first.text.split(/\s+/).slice(0, 9).join(' ')
        .replace(/[*_`#]+/g, '').replace(/[.,;:!?]+$/, '');
    }
  }
  return { title: (title || 'Report').slice(0, 180), intro, blocks };
}

// Wrap a plain-markdown report as an artifact. Returns the parse result shape
// or null when the text does not look like a report.
function autoWrapMarkdownReport(source, wants) {
  if (!looksLikeReportMarkdown(source, wants)) return null;
  const parsed = markdownReportBlocks(source);
  if (!parsed || !parsed.blocks.length) return null;
  const artifact = {
    kind: 'report',
    title: parsed.title,
    blocks: parsed.blocks,
    theme: 'clean',
    paper: 'paper',
    pattern: 'solid',
    font: 'neutral',
    version: 1,
    updatedAt: Date.now(),
  };
  const normalized = normalizeArtifact(artifact);
  if (!normalized.ok) return null;
  const text = parsed.intro ? parsed.intro + '\n\n' : '';
  return { found: true, pending: false, text, artifact: normalized.artifact, warnings: [], error: '', autoWrapped: true };
}

function parseArtifactBlock(value, opts) {
  const source = String(value == null ? '' : value);
  const open = OPEN.exec(source);
  if (!open) {
    // A raw XML tool call is a proposal/artifact payload, not prose. If it is
    // left to the auto-wrapper it becomes a card titled "<tool_call> …", which
    // is exactly the leak the skill parser is meant to catch.
    if (/<tool_?calls?\b|<function\s*=|<parameter\s*=/i.test(source)) {
      return { found: false, pending: false, text: source, artifact: null, error: '', toolCallText: true };
    }
    // No dex-artifact fence: try auto-wrapping code/structured content as a
    const wants = Boolean(opts && opts.wantsArtifact);
    // Plain markdown report first (any model, no fence): headings/tables/
    // labels are the richest structure — a single code fence inside such a
    // reply must not flatten the whole document into one code card. Card
    // creation still requires a deliverable was asked for, so an ordinary
    // code answer stays a code answer.
    const md = autoWrapMarkdownReport(source, wants);
    if (md) return md;
    // A fence-less report or a bare code block: wrap it as a report so the
    // model never "forgets" the fence and loses its work.
    const wrapped = autoWrapArtifact(source, wants);
    if (wrapped) return wrapped;
    return { found: false, text: source, artifact: null, error: '' };
  }
  const start = open.index + open[0].length;
  const close = source.indexOf('```', start);
  const before = source.slice(0, open.index);
  if (close < 0) {
    return {
      found: true, pending: true, text: before.trimEnd(), artifact: null,
      error: 'The artifact block was not closed.',
    };
  }
  const raw = source.slice(start, close);
  const after = source.slice(close + 3);
  const visible = (before + after).replace(/\n{3,}/g, '\n\n').trim();
  const parsed = parseJsonLoose(raw);
  if (!parsed) {
    return {
      found: true, pending: false, text: visible, artifact: null,
      error: 'The artifact was not valid JSON.',
    };
  }
  const normalized = normalizeArtifact(parsed);
  if (!normalized.ok) {
    return { found: true, pending: false, text: visible, artifact: null, error: normalized.error };
  }
  return { found: true, pending: false, text: visible, artifact: normalized.artifact, warnings: normalized.warnings, error: '' };
}

function isArtifactPrefix(value) {
  const s = String(value || '').toLowerCase();
  return 'dex-artifact'.startsWith(s) || 'artifact'.startsWith(s) || 'dex_artifact'.startsWith(s);
}

// Text the user should see while a reply is still streaming. Once an artifact
// fence starts, everything after it is hidden — a half-written JSON object is
// never worth painting.
function visibleText(value) {
  const source = String(value == null ? '' : value);
  const open = OPEN.exec(source);
  if (open) return source.slice(0, open.index).trimEnd();
  const last = source.lastIndexOf('```');
  if (last >= 0) {
    const tail = source.slice(last + 3).trimStart();
    const word = tail.split(/\s/)[0] || '';
    if (word && isArtifactPrefix(word)) return source.slice(0, last).trimEnd();
  }
  return source;
}

function artifactSummary(artifact) {
  if (!artifact || typeof artifact !== 'object') return '';
  const title = String(artifact.title || '').slice(0, 120);
  if (artifact.kind === 'report') {
    const count = (artifact.blocks || []).length || (artifact.sections || []).length;
    return '[Artifact: report "' + title + '" — ' + count + ' blocks · v' + (artifact.version || 1) + ']';
  }
  if (artifact.kind === 'site') return '[Artifact: interactive website "' + title + '"]';
  if (artifact.kind === 'quiz') return '[Artifact: quiz "' + title + '" — ' + (artifact.questions || []).length + ' questions]';
  if (artifact.kind === 'deck') return '[Artifact: flashcards "' + title + '" — ' + (artifact.cards || []).length + ' cards]';
  if (artifact.kind === 'chart') return '[Artifact: chart "' + title + '"]';
  if (artifact.kind === 'timeline') return '[Artifact: timeline "' + title + '"]';
  return '';
}

function tableMarkdown(table) {
  if (!table) return '';
  const head = '| ' + table.columns.join(' | ') + ' |';
  const rule = '| ' + table.columns.map(() => '---').join(' | ') + ' |';
  return [head, rule].concat(table.rows.map((r) => '| ' + table.columns.map((_, i) => r[i] || '').join(' | ') + ' |')).join('\n');
}

// One block -> Markdown, used by Copy, Download and the export writers.
function blockMarkdown(block) {
  if (!block || typeof block !== 'object') return '';
  switch (block.type) {
    case 'heading': return (block.level === 3 ? '### ' : '## ') + block.text;
    case 'paragraph': return block.text;
    case 'list': return (block.items || []).map((item, i) => (block.ordered ? (i + 1) + '. ' : '- ') + item).join('\n');
    case 'table': return tableMarkdown(block);
    case 'stats': return (block.items || []).map((item) => '**' + item.value + '**' + (item.label ? ' ' + item.label : '')).join(' · ');
    case 'chart': return chartMarkdown(block.chart);
    case 'timeline': return (block.items || []).map((item) => '- ' + (item.when ? '**' + item.when + '** — ' : '') + item.text).join('\n');
    case 'proscons':
      return ['**Pros**'].concat((block.pros || []).map((p) => '- ' + p))
        .concat(['', '**Cons**']).concat((block.cons || []).map((c) => '- ' + c)).join('\n');
    case 'cards': return (block.items || []).map((item) => '**' + (item.title || '') + '**' + (item.text ? ' — ' + item.text : '')).join('\n');
    case 'steps': return (block.items || []).map((item, i) => (i + 1) + '. **' + (item.title || '') + '**' + (item.text ? ' — ' + item.text : '')).join('\n');
    case 'quote': return '> ' + block.text + (block.attribution ? '\n> — ' + block.attribution : '');
    case 'callout': return '> ' + (block.label ? '**' + block.label + ':** ' : '') + block.text;
    case 'divider': return '---';
    case 'code': return '```' + (block.lang || '') + '\n' + block.text + '\n```';
    case 'image': return '![Image' + (block.alt ? ' ' + block.alt : '') + '](' + block.src + ')' + (block.caption ? ' — ' + block.caption : '');
    case 'embed': return '[Embed](' + block.src + ')' + (block.title ? ' — ' + block.title : '') + (block.caption ? '\n_' + block.caption + '_' : '');
    case 'accordion': return (block.items || []).map((i) => '## ' + i.heading + '\n' + i.body).join('\n\n');
    case 'tabs': return (block.tabs || []).map((i) => '### ' + i.heading + '\n' + i.body).join('\n\n');
    case 'metric': return '**' + block.value + '**' + (block.delta ? ' ' + block.delta : '') + (block.subtitle ? '\n*' + block.subtitle + '*' : '');
    case 'checklist': return (block.items || []).map((i) => (i.done ? '- [x] ' : '- [ ] ') + i.text).join('\n');
    case 'comparison': {
      const parts = [];
      if (block.title) parts.push('## ' + block.title);
      if (block.left) {
        parts.push('### ' + (block.left.heading || 'Left'));
        for (const it of block.left.items || []) parts.push('- ' + it.label + ': ' + it.value);
        if (block.left.body) parts.push(block.left.body);
      }
      if (block.right) {
        parts.push('### ' + (block.right.heading || 'Right'));
        for (const it of block.right.items || []) parts.push('- ' + it.label + ': ' + it.value);
        if (block.right.body) parts.push(block.right.body);
      }
      return parts.join('\n').trim();
    }
    default: return '';
  }
}

// In-text citation markers ("[1]", "[2]" …) become links to their numbered
// reference, in the render and in every export. Code spans and fenced code are
// left untouched, and a marker without a matching reference stays literal.
// (The renderer asset keeps a mirror of this; both are pinned by tests.)
function linkifyCitations(value, urls) {
  const list = Array.isArray(urls) ? urls : [];
  if (!list.length) return String(value == null ? '' : value);
  const parts = String(value).split(/(```[\s\S]*?```|`[^`]*`)/g);
  return parts.map((part, i) => {
    if (i % 2 === 1) return part;   // captured code span / fenced block
    return part.replace(/\[(\d{1,2})\]/g, (whole, n) => {
      const url = list[Number(n) - 1];
      return url ? '[' + n + '](' + url + ')' : whole;
    });
  }).join('');
}

function artifactToMarkdown(artifact) {
  if (!artifact || typeof artifact !== 'object') return '';
  const lines = [];
  const title = artifact.title || 'Artifact';
  if (artifact.kind === 'report') {
    const cites = (artifact.references || []).map((r) => r && r.url).filter(Boolean);
    const linked = (s) => linkifyCitations(s, cites);
    lines.push('# ' + title);
    if (artifact.kicker) lines.push('', '_' + artifact.kicker + '_');
    if (artifact.subtitle) lines.push('', '_' + artifact.subtitle + '_');
    if (artifact.summary) lines.push('', linked(artifact.summary));
    if ((artifact.blocks || []).length) {
      for (const block of artifact.blocks) {
        const md = linked(blockMarkdown(block));
        if (md) lines.push('', md);
      }
    } else {
      for (const section of artifact.sections || []) {
        if (section.heading) lines.push('', '## ' + section.heading);
        if (section.body) lines.push('', linked(section.body));
        if (section.table) lines.push('', tableMarkdown(section.table));
        if (section.chart) lines.push('', chartMarkdown(section.chart));
      }
    }
    if (!(artifact.blocks || []).length && artifact.chart) lines.push('', chartMarkdown(artifact.chart));
    if ((artifact.findings || []).length) {
      lines.push('', '## Key findings');
      for (const f of artifact.findings) lines.push('- ' + linked(f));
    }
    if ((artifact.references || []).length) {
      lines.push('', '## References');
      for (const r of artifact.references) lines.push('- [' + r.title + '](' + r.url + ')' + (r.publisher ? ' - ' + r.publisher : ''));
    }
    // Reading notes travel with the document (V17): the quote keeps the
    // note–text link even where no highlight can be painted. (Renderer copy
    // mirrors this; both are pinned by tests.)
    if ((artifact.annotations || []).length) {
      lines.push('', '## Notes');
      for (const a of artifact.annotations) {
        lines.push('- “' + String(a.quote || '') + '” — ' + String(a.note || ''));
      }
    }
  } else if (artifact.kind === 'quiz') {
    lines.push('# ' + title);
    if (artifact.topic) lines.push('', 'Topic: ' + artifact.topic);
    (artifact.questions || []).forEach((q, i) => {
      lines.push('', '## ' + (i + 1) + '. ' + q.prompt);
      if (q.options) q.options.forEach((o, oi) => lines.push('- ' + (oi === q.answer || (Array.isArray(q.answer) && q.answer.includes(oi)) ? '**' + o + '**' : o)));
      if (q.type === 'short') lines.push('', 'Answer: ' + q.answer);
      if (q.type === 'match') for (const p of q.pairs || []) lines.push('- ' + p.left + ' → ' + p.right);
      if (q.explanation) lines.push('', q.explanation);
    });
  } else if (artifact.kind === 'deck') {
    lines.push('# ' + title);
    for (const card of artifact.cards || []) lines.push('', '- **' + card.front + '**', '  ' + card.back);
  } else if (artifact.kind === 'timeline') {
    lines.push('# ' + title);
    for (const e of artifact.entries || []) lines.push('', '- **' + (e.date ? e.date + ' — ' : '') + e.title + '**', '  ' + e.text);
  } else if (artifact.kind === 'chart') {
    lines.push('# ' + title, '', chartMarkdown(artifact.chart));
  } else if (artifact.kind === 'site') {
    lines.push('# ' + title, '', '```html', artifact.html || '', '```');
  }
  return lines.join('\n').trim();
}

function chartMarkdown(chart) {
  if (!chart) return '';
  if (chart.type === 'pie') {
    const series = (chart.series || [])[0];
    return chart.labels.map((label, i) => '- ' + label + ': ' + (series ? series.values[i] : '')).join('\n');
  }
  const header = ['Label'].concat((chart.series || []).map((s) => s.name));
  const rows = chart.labels.map((label, i) => [label].concat((chart.series || []).map((s) => s.values[i])));
  return tableMarkdown({ columns: header, rows });
}

const PROTOCOL = [
  'Finished-deliverable protocol.',
  'When the user asks for a finished deliverable — a report or document, interactive website or mini-app, quiz, study guide/flashcards, chart, or timeline — produce it as ONE fenced block exactly like this:',
  '```dex-artifact',
  '{"kind":"report","title":"…","subtitle":"…","summary":"…","theme":"clean","paper":"paper","pattern":"solid","font":"neutral","blocks":[{"type":"heading","text":"…","level":2},{"type":"paragraph","text":"…"},{"type":"stats","items":[{"value":"42%","label":"of visitors"}]},{"type":"table","columns":["A","B"],"rows":[["1","2"]]},{"type":"callout","label":"Bottom line","text":"…"}]}',
  '```',
  'Kinds and required fields:',
  '- report: title + blocks (a summary alone is also accepted). Block types: heading {text, level 2|3}, paragraph {text}, list {items, ordered}, table {columns, rows}, stats {items:[{value,label}]} (max 4), chart {chart:{type:"bar"|"line"|"pie",labels,series:[{name,values}]}}, timeline {items:[{when,text}]}, proscons {pros,cons}, cards {items:[{title,text}]}, steps {items:[{title,text}]}, quote {text,attribution}, callout {label,text}, divider, spacer, code {text, lang}, image {src, alt, caption}, embed {src, title, caption}, accordion {items:[{heading, body, open}]}, tabs {tabs:[{heading, body, active}]}, metric {value, subtitle, trend:"up|down|flat|none", delta}, checklist {items:[{text, done}]}, comparison {title, left:{heading, items:[{label,value}]}, body}, right:{heading, items:[{label,value}]}, body}}. Optional: kicker, subtitle, references [{title,url,publisher}], theme (clean|editorial|brief|modern|magazine|academic|notebook|executive|minimal|creative|technical|playful), paper (paper|white|pink|blue|green|lavender|peach|grey|sand|slate|ivory|mist), pattern (solid|hatch|diagonal), font (editorial|neutral|typewriter). Optional report meta: toc (auto table of contents), searchable (true to enable in-report search), annotations [{blockId, note}], versions [{blockId, version, changedBy, changedAt, note}], dependencies [{blockId, dependsOn:[blockId]}], conditions [{blockId, when:{type:"metric-gte"|"metric-lt"|"checkbox", path, value}}], dynamicData [{blockId, source:"live|static", query}]. Never HTML or CSS inside a report.',
  '- site: title + files [{path:"index.html",content:"…"}] — ONE self-contained document is the default for every website, with CSS in one inline <style>, JavaScript in an end-of-body <script>, and artwork as inline SVG/CSS or base64 data URLs. Only when the person explicitly asks for separate pages/files may you add extra entries (styles.css, app.js, additional .html); then wire them with normal relative <link>/<script> and internal links. Everything must run offline: no external URLs, no fetch/CDN/network resources. Online research is source material only: inline every chosen asset and keep a short visible source credit. Make every advertised control work — including dynamically added controls via one delegated listener — and include empty/error states.',
  'Site house style (an in-app validator checks these; build them in from the start): head carries charset, the viewport meta (never block zoom), a unique descriptive <title> and a one-sentence meta description per page; <html lang="en">; exactly one <h1> with no skipped heading levels; header/nav/main/footer landmarks, a first "Skip to content" link, and aria-label on each <nav>; real <button>/<a> for every control (never div+onclick, no empty href="#"); every image has alt ("" when decorative); forms use label[for] and validate with :user-invalid; the first CSS block of the file is a :root design-token layer (colours, type scale, --space-1…6, radii, --ease, --dur) and raw values nowhere else; BEM-lite class names; container queries (container-type: inline-size + @container) with a viewport @media fallback so components respond to their slot; mobile-first auto-fit grids; motion only via transform/opacity inside @media (prefers-reduced-motion: no-preference); multi-page sites duplicate identical header/footer markup on every page (no fetch-based includes).',
  'Viewport contract for every website (the live preview enforces this too): the page lives directly in a full-window preview iframe. Do not wrap it in a small centred card, fixed-width island, browser mockup or phone shell. Start with html,body{margin:0;width:100%;min-height:100%} and a top-level root with width:100%;min-height:100vh;box-sizing:border-box. Backgrounds and layout span the full iframe; only inner content sections may use max-width for reading.',
  'JAVASCRIPT IS MANDATORY in every website: emit one <script> just before </body> with real listeners and at least three working behaviours. Never return a static visual mockup; if a control exists, it must work.',
  'Multi-page sites: a real site is several files — one .html per destination, each with its own unique <title> and meta description; never dress anchor links as navigation. Home orients (hero, 3 teasers, proof, one call to action); every subpage opens with a compact page-header band (not another full-height hero) and carries 4-8 sections. The header (logo → home, 4-7 nav items, aria-current="page" on the current one) and the footer (doormat nav, contact email, copyright) are byte-identical on every page; add breadcrumbs (a labelled <ol>) at depth 2+. Reusable sections, use the ones that fit: text-led hero; feature grid with heading links; alternating text/media detail rows; story + facts strip; team grid (alt="Name, role"); testimonial blockquote with <cite> (never a carousel); pricing tiers with "recommended" stated in text; FAQ via <details>/<summary> (share the name attribute for one-open-at-a-time); contact page with email/phone/hours + response window and a form whose submit builds a prefilled mailto: URL, stores the draft in localStorage inside try/catch and also says "or email us"; CTA band; changelog with <time datetime>; docs sidebar (one labelled secondary <nav>, aria-current) with breadcrumbs; article layout at 60-75ch. Forms: visible <label for> always, never placeholder-as-label, add a honeypot field, never gate content behind a form.',
  'Components: build every repeated block once as a named class component (BEM-lite) and reuse its exact markup on every page — never restyle a shared component inside one page. Variations are modifier classes (.card--compact), interaction states are :hover/:focus-visible, and state flags are is-*/has-* classes toggled by script. A class in the markup must have a rule in the shared stylesheet and vice versa: no dead CSS, no unstyled hooks (the validator checks both directions). Give each component its full state set (default, hover, focus-visible, and disabled where it applies).',
  'Responsive sizing: size with max-width, flex and auto-fit grids — never a fixed width of 500px or more, and never 100vw (it counts the scrollbar). Fluid display type uses clamp(); the layout must hold at 390, 768 and 1440 px. Components respond to their own slot with container queries; viewport media queries belong to the page shell only.',
  'Interactions: mirror every :hover treatment with :focus-visible (keyboard parity), give :disabled and [aria-disabled] a visible state (reduced contrast, cursor:not-allowed, no hover lift), use :active for press feedback, and keep state transitions 120–260 ms on transform/opacity/colour with the shared --ease/--dur tokens. Every interactive element must be reachable and operable with Tab plus Enter/Space (real <button>/<a>, never hover-only affordances, never positive tabindex).',
  '- quiz: title + questions. type single|multi|truefalse|short|match. single answer = option index; multi answer = array of indices; truefalse answer = true/false; short answer = model answer + accept[] variants; match pairs = [{left,right}]. Include explanation. Keep answer keys consistent with the options.',
  '- deck: title + cards [{front,back}].',
  '- chart: title + chart object (same shape as blocks[].chart).',
  '- timeline: title + entries [{date,title,text}].',
  'Report tables: use a table block {"type":"table","columns":["Header A","Header B"],"rows":[["value","value"]]} with 2-6 short headers and exactly one cell per column in every row. Never put pipe syntax (| --- |), HTML tables or markdown in a cell — the renderer owns the borders and styling.',
  'Report style: a working document, not a landing page. Open with the answer (callout or summary), then numbered sections with one idea each, then the evidence (table/stats/chart/timeline), then what to do next. Use real data only, note the source of a figure in its label, and never use emoji.',
  'Put one short sentence of introduction before the block, then the block, then nothing after it. Valid JSON only inside the block: escape quotes and newlines. Do not invent citations, URLs or research findings. For ordinary conversation, do NOT emit an artifact.',
  'Never stall a deliverable on clarifying questions: if the person asks for a report without naming a kind, theme or format, pick the standard shape yourself and produce the block now — restyling (theme, paper, layout) and revisions happen afterwards in the report viewer.',
].join('\n');

function artifactPrompt() {
  return PROTOCOL;
}

// Report quality validator: checks that a report meets basic quality standards
// (opening summary, enough sections, references if sources were used). Returns
// an array of warning strings — empty means the report is well-formed.
function validateReportQuality(artifact) {
  const warnings = [];
  if (!artifact || artifact.kind !== 'report') return warnings;
  const blocks = Array.isArray(artifact.blocks) ? artifact.blocks : [];
  const hasSummary = Boolean(artifact.summary && artifact.summary.trim().length);
  const hasOpeningCallout = blocks.some(b => b.type === 'callout');
  const hasOpeningSummary = blocks.some(b => b.type === 'paragraph') && blocks[0] && blocks[0].type === 'paragraph';
  const sectionCount = blocks.filter(b => b.type === 'heading').length;
  const referenceCount = Array.isArray(artifact.references) ? artifact.references.length : 0;
  const findingCount = Array.isArray(artifact.findings) ? artifact.findings.length : 0;
  if (!hasSummary && !hasOpeningCallout && !hasOpeningSummary) {
    warnings.push('Report has no opening summary or callout — add one so the key answer is immediate.');
  }
  if (sectionCount < 2 && blocks.length > 0) {
    warnings.push('Report has fewer than 2 sections — consider breaking it into numbered sections.');
  }
  if (referenceCount === 0 && findingCount > 0) {
    warnings.push('Report has findings but no references — cite the pages you read.');
  }
  if (blocks.length === 0 && !artifact.summary && !artifact.findings.length) {
    warnings.push('Report has no content blocks — add sections with headings, tables or stats.');
  }
  return warnings;
}

module.exports = {
  KINDS,
  LIMITS,
  normalizeAnnotation,
  normalizeCondition,
  normalizeDependency,
  normalizeVersion,
  normalizeDynamicData,
  SITE_CSP,
  REPORT_THEMES,
  REPORT_PAPERS,
  REPORT_PATTERNS,
  REPORT_FONTS,
  BLOCK_TYPES,
  normalizeArtifact,
  normalizeBlock,
  normalizeBlocks,
  normalizeChart,
  validateReportQuality,
  normalizeTable,
  parseArtifactBlock,
  parseJsonLoose,
  visibleText,
  artifactSummary,
  artifactToMarkdown,
  linkifyCitations,
  artifactPrompt,
  safeSiteDocument,
  sitePages,
  normalizeSiteFiles,
  assembleSiteDocument,
  safeSitePath,
  diagnoseArtifact,
  artifactSearchText,
  searchArtifacts,
  artifactSources,
  artifactRevisionPrompt,
  revisionSource,
  artifactFollowUpNote,
  normalizeArtifactState,
};
