// Bounded, online-source asset support for the one-file website writer.
//
// PURE MODULE: no Electron, no network I/O. The main process injects a binary
// fetch adapter (net.fetch + the shared URL guard), and every cap is enforced
// here again so the prompt evidence and the delivered HTML stay small and,
// above all, offline. Online material is generation-time SOURCE MATERIAL only:
// the shipped index.html carries inlined data URLs, visible plain-text credit,
// and not a single runtime resource URL.
'use strict';

const aiSearchRead = require('./ai-search-read');

const MAX_ASSETS = 4;
const MAX_ASSET_RAW_BYTES = 96 * 1024;       // wire cap per source image before base64
// The advertised contract is measured on the DELIVERED data URL, not the raw
// download. A 96KB raw file base64-expands to ~128KB, so enforce the 120KB
// encoded ceiling again here; an oversized candidate is replaced or skipped.
const MAX_ASSET_BASE64_CHARS = 120 * 1024;
const MAX_TOTAL_BASE64_CHARS = 256 * 1024;   // combined inlined payload ceiling
const ASSET_FETCH_TIMEOUT_MS = 6000;
const MAX_CREDIT_CHARS = 240;
const MAX_CANDIDATES = 12;
const MAX_EVIDENCE_CHARS = 5000;
const MAX_ATTRIBUTION_CHARS = 700;
const PLACEHOLDER_IDS = ['dexref1', 'dexref2', 'dexref3', 'dexref4'];

// SVG and every other format are refused: raster only, because the delivered
// file must stay deterministic and offline.
const ALLOWED_IMAGE_TYPES = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
  'image/gif': 'gif',
});

function toBase64(bytes) {
  const arr = bytes && typeof bytes.byteLength === 'number'
    ? new Uint8Array(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength)
    : new Uint8Array(bytes || []);
  if (typeof Buffer !== 'undefined') return Buffer.from(arr).toString('base64');
  let out = '';
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let i = 0; i < arr.length; i += 3) {
    const a = arr[i], b = i + 1 < arr.length ? arr[i + 1] : 0, c = i + 2 < arr.length ? arr[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += table[(n >> 18) & 63] + table[(n >> 12) & 63]
      + (i + 1 < arr.length ? table[(n >> 6) & 63] : '=')
      + (i + 2 < arr.length ? table[n & 63] : '=');
  }
  return out;
}

// Base64 (not literal markup) so no `http` substring from the SVG namespace
// ever appears in the delivered HTML's fail-closed scan.
const SAFE_SVG_DATA_URL = 'data:image/svg+xml;base64,' + toBase64(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1">'
  + '<rect width="1" height="1" fill="#eceff1"/></svg>'
);

function sanitizeText(value, max) {
  const limit = Math.max(1, Number(max) || MAX_CREDIT_CHARS);
  return String(value == null ? '' : value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}
const sanitizeCredit = (value) => sanitizeText(value, MAX_CREDIT_CHARS);

function hostOfUrl(url) {
  try { return new URL(String(url || '')).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

function isAllowedImageType(contentType) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(ALLOWED_IMAGE_TYPES, type);
}

const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
const IMAGE_EXT_RE = /https?:\/\/[^\s<>"'`)\]]+\.(?:png|jpe?g|webp|gif)(?:\?[^\s<>"'`)\]]*)?/gi;
const MD_IMAGE_RE = /!\[[^\]]*\]\(\s*(https?:\/\/[^\s)]+)/gi;

function extractUrls(text, limit) {
  const list = [];
  const seen = new Set();
  const source = String(text || '');
  const re = new RegExp(URL_RE.source, 'gi');
  let m;
  while ((m = re.exec(source))) {
    const url = m[0].replace(/[.,;:!?)\]}'"]+$/, '');
    if (seen.has(url)) continue;
    seen.add(url);
    list.push(url);
    if (list.length >= (Number(limit) || MAX_CANDIDATES)) break;
  }
  return list;
}

// Markdown image URLs first, then bare raster URLs. Both are only *candidates*
// — the fetch layer still gates content type, size and URL safety.
function extractImageUrls(text, limit) {
  const out = [];
  const seen = new Set();
  const source = String(text || '');
  const add = (url) => {
    const u = String(url || '').replace(/[.,;:!?)\]}'"]+$/, '');
    if (!u || seen.has(u)) return;
    seen.add(u);
    out.push(u);
  };
  for (const re of [MD_IMAGE_RE, IMAGE_EXT_RE]) {
    const pattern = new RegExp(re.source, 'gi');
    let m;
    while ((m = pattern.exec(source))) {
      add(m[1] || m[0]);
      if (out.length >= (Number(limit) || MAX_CANDIDATES)) return out;
    }
  }
  return out;
}

// Accepts the gathered search sources, the numbered research text and the
// person's own words. Order matters: URLs the person typed are tried first.
function collectResearchCandidates(input) {
  const i = input || {};
  const userText = String(i.userText || i.query || '');
  const researchText = String(i.researchText || i.gatheredText || '');
  const sources = Array.isArray(i.sources) ? i.sources : [];
  const candidates = [];
  const seen = new Set();

  function add(entry) {
    const raw = String((entry && entry.url) || '').trim();
    if (!raw) return;
    const check = aiSearchRead.checkFetchUrl(raw);
    if (!check.ok) return;
    const url = check.url;
    if (seen.has(url)) return;
    seen.add(url);
    candidates.push({
      url,
      source: sanitizeText((entry && entry.source) || hostOfUrl(url), 80),
      title: sanitizeText((entry && entry.title) || '', 160),
      credit: sanitizeCredit((entry && entry.credit) || ''),
    });
  }

  for (const url of extractUrls(userText, MAX_CANDIDATES)) {
    add({ url, source: hostOfUrl(url), credit: 'User-supplied URL' });
  }
  for (const source of sources.slice(0, MAX_CANDIDATES)) {
    if (!source || !source.url) continue;
    const host = sanitizeText(source.title || hostOfUrl(source.url), 80);
    const credit = sanitizeCredit([source.title, source.date].filter(Boolean).join(' — '));
    for (const key of ['imageUrl', 'image', 'thumbnail', 'ogImage', 'previewUrl']) {
      if (source[key]) add({ url: source[key], source: host, title: source.title, credit });
    }
    for (const url of extractImageUrls(String(source.text || ''), 4)) {
      add({ url, source: host, title: source.title, credit });
    }
    // Page URLs go last: they are usually HTML and fail the image gate, but a
    // direct image link supplied as a source should still be considered.
    add({ url: source.url, source: host, title: source.title, credit });
  }
  for (const url of extractImageUrls(researchText, MAX_CANDIDATES)) {
    add({ url, source: hostOfUrl(url) || 'Research', credit: 'Online research' });
  }
  return candidates.slice(0, MAX_CANDIDATES);
}

function errorText(value) {
  return sanitizeText((value && value.message) || value || 'Image could not be fetched.', 160);
}

// `fetchBinary(url, {timeoutMs, maxBytes})` -> {ok, url, contentType, bytes}.
// Every cap is repeated here; the injected adapter enforces the same ones on
// the wire.
async function fetchSiteAssets(candidates, opts) {
  const o = opts || {};
  const fetchBinary = typeof o.fetchBinary === 'function' ? o.fetchBinary : null;
  const list = Array.isArray(candidates) ? candidates : [];
  const assets = [];
  const errors = [];
  let total = 0;
  if (!fetchBinary) return { assets, errors: ['No image fetch adapter is available.'], totalBase64Chars: 0 };

  for (const candidate of list) {
    if (assets.length >= MAX_ASSETS) break;
    if (!candidate || !candidate.url) continue;
    let res;
    try {
      res = await fetchBinary(candidate.url, {
        timeoutMs: o.timeoutMs || ASSET_FETCH_TIMEOUT_MS,
        maxBytes: o.maxBytes || MAX_ASSET_RAW_BYTES,
      });
    } catch (err) { errors.push(errorText(err)); continue; }
    if (!res || !res.ok) { errors.push(errorText(res && res.error)); continue; }
    const type = String(res.contentType || '').split(';')[0].trim().toLowerCase();
    if (!isAllowedImageType(type)) { errors.push('Unsupported image type: ' + (type || 'unknown')); continue; }
    const bytes = res.bytes;
    const rawBytes = bytes && typeof bytes.byteLength === 'number' ? bytes.byteLength : (bytes && bytes.length) || 0;
    if (rawBytes <= 0) { errors.push('Empty image.'); continue; }
    if (rawBytes > MAX_ASSET_RAW_BYTES) { errors.push('Image exceeds the per-image byte cap.'); continue; }
    let b64;
    try { b64 = toBase64(bytes); } catch { errors.push('Image could not be encoded.'); continue; }
    if (b64.length > MAX_ASSET_BASE64_CHARS) {
      errors.push('Inlined image exceeds the 120KB data-URL cap.');
      continue;
    }
    if (total + b64.length > MAX_TOTAL_BASE64_CHARS) { errors.push('Total inlined asset budget reached.'); break; }
    total += b64.length;
    assets.push({
      id: PLACEHOLDER_IDS[assets.length],
      url: String(res.url || candidate.url),
      source: sanitizeText(candidate.source || hostOfUrl(res.url || candidate.url), 80),
      title: sanitizeText(candidate.title, 160),
      credit: sanitizeCredit(candidate.credit),
      mimeType: type,
      dataUrl: 'data:' + type + ';base64,' + b64,
      rawBytes,
      base64Chars: b64.length,
    });
  }
  return { assets, errors: errors.slice(0, 8), totalBase64Chars: total };
}

// Bounded prompt evidence. Deliberately contains NO base64: the model only
// needs the stable ids and the credit text; the inliner does the byte work.
function researchEvidenceBlock(assets, input) {
  const i = input || {};
  const notes = sanitizeText(i.text || i.researchText || '', 1800);
  const lines = [
    '<site-research-assets>',
    'Online source material for THIS generation only. Use none, some or all of these images. Inlining is automatic: never copy a data URL or base64 into your reply.',
    'For every image you use, emit exactly src="dexref1" data-dex-asset="dexref1" (swap the number) on its <img>. Keep those placeholder strings verbatim - they are replaced with inlined data URLs after generation.',
    'Add ONE short visible plain-text credit line per used image (or one compact footer line) using the source/credit text below: host plus title or licence. No remote href, src or url() and no clickable attribution link.',
    'Available assets (id | type | source | title | credit):',
  ];
  for (const a of (Array.isArray(assets) ? assets : []).slice(0, MAX_ASSETS)) {
    if (!a || !a.id) continue;
    lines.push('- ' + sanitizeText(a.id, 20) + ' | ' + sanitizeText(a.mimeType, 30)
      + ' | ' + sanitizeText(a.source, 60) + ' | ' + sanitizeText(a.title, 120)
      + ' | ' + sanitizeCredit(a.credit));
  }
  if (notes) lines.push('Research notes: ' + notes);
  lines.push('</site-research-assets>');
  let block = lines.join('\n');
  if (block.length > MAX_EVIDENCE_CHARS) {
    block = block.slice(0, Math.max(0, MAX_EVIDENCE_CHARS - 40)) + '\n...(truncated)\n</site-research-assets>';
  }
  return block;
}

// Report counterpart of researchEvidenceBlock(). Reports use JSON blocks, not
// HTML, so the placeholder goes in the image block's `src` field. No base64 is
// ever shown to the model; the inliner does the byte work after generation.
function reportResearchEvidenceBlock(assets, input) {
  const i = input || {};
  const notes = sanitizeText(i.text || i.researchText || '', 1800);
  const lines = [
    '<report-research-images>',
    'Verified images available for THIS report only. Use none, some or all. To include one, emit an image block with src set to its id (for example "dexref1") verbatim; it is replaced with an embedded, offline image before the report is shown. Never copy a data URL or base64 into your reply. Put a short source credit in the image caption.',
    'Available images (id | type | source | title | credit):',
  ];
  for (const a of (Array.isArray(assets) ? assets : []).slice(0, MAX_ASSETS)) {
    if (!a || !a.id) continue;
    lines.push('- ' + sanitizeText(a.id, 20) + ' | ' + sanitizeText(a.mimeType, 30)
      + ' | ' + sanitizeText(a.source, 60) + ' | ' + sanitizeText(a.title, 120)
      + ' | ' + sanitizeCredit(a.credit));
  }
  if (notes) lines.push('Research notes: ' + notes);
  lines.push('</report-research-images>');
  let block = lines.join('\n');
  if (block.length > MAX_EVIDENCE_CHARS) {
    block = block.slice(0, Math.max(0, MAX_EVIDENCE_CHARS - 40)) + '\n...(truncated)\n</report-research-images>';
  }
  return block;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function isRemote(value) {
  return /^(?:https?:)?\/\//i.test(String(value || '').trim());
}

// --- place-holder inlining -------------------------------------------------

function inlinePlaceholders(html, assets, used) {
  const byId = new Map();
  for (const a of assets) if (a && a.id) byId.set(String(a.id).toLowerCase(), a);
  if (!byId.size) return html;

  let out = html.replace(/<[a-z][^>]*>/gi, (tag) => {
    if (!/\b(?:src|srcset|poster|data-dex-asset)\s*=/i.test(tag)) return tag;
    let foundId = '';
    const next = tag.replace(/\b(src|srcset|poster|data-dex-asset)\s*=\s*(["'])([\s\S]*?)\2/gi,
      (full, name, quote, value) => {
        const m = /\b(dexref[1-4])\b/i.exec(value);
        if (!m) return full;
        const id = m[1].toLowerCase();
        const asset = byId.get(id);
        if (!asset) return full;
        if (!used.some((u) => u.id === id)) used.push(asset);
        foundId = id;
        if (name.toLowerCase() === 'srcset') {
          return name + '=' + quote + value.replace(/\bdexref[1-4]\b/gi, asset.dataUrl) + quote;
        }
        return name + '=' + quote + asset.dataUrl + quote;
      });
    // A model may put the id only in data-dex-asset with no usable src.
    if (foundId && !/\bsrc\s*=\s*["'][^"']+["']/i.test(next)) {
      const asset = byId.get(foundId);
      return next.replace(/^<([a-z][\w-]*)/i, '<$1 src="' + asset.dataUrl + '"');
    }
    return next;
  });

  // CSS artwork using url(dexrefN) is supported too.
  out = out.replace(/\burl\(\s*(["']?)(dexref[1-4])\1\s*\)/gi, (full, quote, id) => {
    const asset = byId.get(String(id).toLowerCase());
    if (!asset) return full;
    if (!used.some((u) => u.id === asset.id)) used.push(asset);
    return 'url(' + quote + asset.dataUrl + quote + ')';
  });
  return out;
}

function attributionHtml(used) {
  if (!used.length) return '';
  const text = used.map((a) => {
    const host = a.source || hostOfUrl(a.url);
    const label = a.credit || a.title || a.id;
    return escapeHtml(host ? host + ' — ' + label : label);
  }).join(' · ').slice(0, MAX_ATTRIBUTION_CHARS);
  return '<p data-dex-attribution="1" style="font:11px/1.4 system-ui,sans-serif;opacity:.72;margin:10px 0">'
    + 'Image credits: ' + text + '</p>';
}

function applyAttribution(html, used) {
  if (!used.length) return html;
  const block = attributionHtml(used);
  const existing = /<(p|figcaption|small|div)\b([^>]*\bdata-dex-attribution\b[^>]*)>[\s\S]*?<\/\1>/i;
  if (existing.test(html)) return html.replace(existing, block);
  if (/<\/body\s*>/i.test(html)) return html.replace(/<\/body\s*>/i, block + '\n</body>');
  return html + '\n' + block;
}

// --- fail-closed scrubbing -------------------------------------------------

function scrubRemote(html, stats) {
  let out = html;

  // Resource-bearing elements: any remote src/srcset/poster/data becomes an
  // inert, inlined 1x1 SVG. No request can be made by the delivered file.
  out = out.replace(/<(img|source|video|audio|iframe|track|embed|object|script|link|input)\b[^>]*>/gi, (tag) =>
    tag.replace(/\b(src|srcset|poster|data)\s*=\s*(["'])([\s\S]*?)\2/gi, (full, name, quote, value) => {
      if (!isRemote(value)) return full;
      stats.resources++;
      return name + '=' + quote + SAFE_SVG_DATA_URL + quote;
    }));
  // Sloppy unquoted markup must fail closed too.
  out = out.replace(/<(img|source|video|audio|iframe|track|embed|object|script|link|input)\b[^>]*>/gi, (tag) =>
    tag.replace(/\b(src|srcset|poster|data)=([^\s>]+)/gi, (full, name, value) => {
      if (!isRemote(value)) return full;
      stats.resources++;
      return name + '="' + SAFE_SVG_DATA_URL + '"';
    }));

  // Remote anchors become plain text: no outbound navigation at runtime.
  out = out.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (full, attrs, inner) => {
    const m = /\bhref\s*=\s*(["'])([\s\S]*?)\1/i.exec(attrs);
    if (!m || !isRemote(m[2])) return full;
    const url = String(m[2]).slice(0, 240);
    const clean = attrs.replace(m[0], '');
    const plain = String(inner).replace(/<[^>]*>/g, '').trim();
    const addition = plain.indexOf(url) >= 0 ? '' : ' (' + escapeHtml(url) + ')';
    stats.links++;
    return '<a' + (clean.trim() ? clean : '') + '>' + inner + addition + '</a>';
  });

  // Other href-bearing tags (stylesheets, base, SVG <use>, area) get `none`,
  // which cannot fetch. Forms must not post off-file either.
  out = out.replace(/<(link|base|use|area)\b[^>]*>/gi, (tag) =>
    tag.replace(/\bhref\s*=\s*(["'])([\s\S]*?)\1/gi, (full, quote, value) => {
      if (!isRemote(value)) return full;
      stats.resources++;
      return 'href=' + quote + 'none' + quote;
    }));
  out = out.replace(/<form\b[^>]*>/gi, (tag) =>
    tag.replace(/\baction\s*=\s*(["'])([\s\S]*?)\1/gi, (full) => { stats.resources++; return ''; }));

  // Remote CSS url() in inline styles and <style> blocks -> none.
  const cssUrl = /\burl\(\s*(["']?)([\s\S]*?)\1\s*\)/gi;
  const cleanCss = (css) => String(css)
    .replace(/@import\s+(["'])([\s\S]*?)\1/gi, (full, quote, value) => {
      if (!isRemote(value)) return full;
      stats.css++;
      return '';
    })
    .replace(cssUrl, (full, quote, value) => {
      const v = String(value || '').trim();
      if (!isRemote(v)) return full;
      stats.css++;
      return 'none';
    });
  out = out.replace(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/gi, (full, quote, css) =>
    'style=' + quote + cleanCss(css) + quote);
  out = out.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi,
    (full, open, css, close) => open + cleanCss(css) + close);

  // Last line of defence: an unmatched asset id or a remote url() must never
  // survive as a resource, even in malformed markup.
  out = out.replace(/\b(src|srcset|poster|data-dex-asset)\s*=\s*(["'])([^"']*\bdexref[1-4]\b[^"']*)\2/gi,
    (full, name, quote) => { stats.missing++; return name + '=' + quote + SAFE_SVG_DATA_URL + quote; });
  out = out.replace(/\burl\(\s*(["']?)([^)'"]*\bdexref[1-4]\b[^)'"]*)\1\s*\)/gi, () => {
    stats.missing++;
    return 'none';
  });
  return out;
}

// Inlines chosen assets into the artifact's file copies, adds compact visible
// attribution and fails closed on any resource URL a model still emitted.
// The input files array is never mutated.
function inlineSiteAssets(files, assets) {
  const chosen = (Array.isArray(assets) ? assets : []).filter((a) => a && a.id && a.dataUrl);
  const warnings = [];
  const stats = { resources: 0, links: 0, css: 0, missing: 0 };
  const list = Array.isArray(files) ? files : [];
  const allUsed = [];

  const outFiles = list.map((file) => {
    const next = { ...(file || {}) };
    const content = String(next.content || '');
    const isHtml = /\.x?html?$/i.test(String(next.path || ''))
      || /<html[\s>]/i.test(content) || /\bdexref[1-4]\b/i.test(content);
    if (!isHtml) return next;
    const used = [];
    let html = inlinePlaceholders(content, chosen, used);
    html = scrubRemote(html, stats);
    html = applyAttribution(html, used);
    for (const asset of used) {
      if (!allUsed.some((entry) => entry.id === asset.id)) allUsed.push(asset);
    }
    next.content = html;
    return next;
  });

  if (stats.resources) warnings.push('Replaced ' + stats.resources + ' remote resource URL(s) with an offline-safe value.');
  if (stats.links) warnings.push('Converted ' + stats.links + ' remote link(s) to plain text; the site has no outbound navigation.');
  if (stats.css) warnings.push('Replaced ' + stats.css + ' remote CSS url() with none.');
  if (stats.missing) warnings.push('Neutralised ' + stats.missing + ' asset placeholder(s) with no matching fetched asset.');
  return { files: outFiles, warnings: warnings.slice(0, 8), used: allUsed, stats };
}

module.exports = {
  MAX_ASSETS,
  MAX_ASSET_RAW_BYTES,
  MAX_ASSET_BASE64_CHARS,
  MAX_TOTAL_BASE64_CHARS,
  ASSET_FETCH_TIMEOUT_MS,
  MAX_CREDIT_CHARS,
  MAX_CANDIDATES,
  MAX_EVIDENCE_CHARS,
  MAX_ATTRIBUTION_CHARS,
  PLACEHOLDER_IDS,
  ALLOWED_IMAGE_TYPES,
  SAFE_SVG_DATA_URL,
  sanitizeText,
  sanitizeCredit,
  hostOfUrl,
  isAllowedImageType,
  isRemote,
  extractUrls,
  extractImageUrls,
  collectResearchCandidates,
  collectCandidates: collectResearchCandidates,
  fetchSiteAssets,
  researchEvidenceBlock,
  reportResearchEvidenceBlock,
  buildResearchEvidenceBlock: researchEvidenceBlock,
  buildEvidenceBlock: researchEvidenceBlock,
  inlineSiteAssets,
};
