'use strict';
// Pure, Electron-free helpers for the V31–V50 offline-asset contract.
//
// This is a TEST helper, not product source: it encodes the final gate from
// src/main/site-version-spec.js V30 (and polish V31/V40) so the same assertion
// can run inside Playwright and inside the plain Node unit script in
// code/build/scripts/. It never imports Playwright or Electron.

const CAPS = Object.freeze({
  perRasterBytes: 120 * 1024,
  totalInlineBytes: 400 * 1024,
  documentBytes: 250 * 1024,
});

// http(s), ws(s) and scheme-relative URLs are all off-file destinations.
// A delivered page must contain none of them in a resource-bearing position.
const REMOTE = /^(?:https?:|wss?:)?\/\//i;

// Every place a generated document can point at the network. Each entry names
// the context so a failure tells the author what to fix, not just "found URL".
const CONTEXTS = [
  ['script-src', /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi],
  ['link-href', /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi],
  ['img-srcset', /<img\b[^>]*\b(?:src|srcset)\s*=\s*["']([^"']+)["']/gi],
  ['source-srcset', /<source\b[^>]*\bsrcset\s*=\s*["']([^"']+)["']/gi],
  ['iframe-src', /<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi],
  ['media-resource', /<(?:video|audio|track|embed|object|input)\b[^>]*\b(?:src|poster|data)\s*=\s*["']([^"']+)["']/gi],
  ['anchor-href', /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi],
  ['base-use-href', /<(?:base|use|area)\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi],
  ['css-url', /url\(\s*["']?([^"')]+)["']?\s*\)/gi],
  ['css-import', /@import\s+(?:url\(\s*)?["']([^"')]+)["']/gi],
  ['fetch-or-import', /\b(?:fetch|import)\s*\(\s*["']([^"']+)["']/gi],
  ['websocket', /\bnew\s+WebSocket\s*\(\s*["']([^"']+)["']/gi],
];

function scanRemoteReferences(html) {
  const raw = String(html || '');
  const found = [];
  for (const [context, re] of CONTEXTS) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(raw))) {
      // srcset is a comma list; the first non-remote token is still checked so
      // a mixed `data:…, https://…` value cannot slip through.
      for (const token of String(match[1] || '').split(/[\s,]+/)) {
        if (token && REMOTE.test(token)) found.push({ context, value: token });
      }
    }
  }
  return found;
}

function inlineAssetBudget(html) {
  const raw = String(html || '');
  const dataUrls = raw.match(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi) || [];
  const sizes = dataUrls.map((url) => {
    const payload = url.slice(url.indexOf(',') + 1);
    return Math.ceil((payload.length * 3) / 4);
  });
  const total = sizes.reduce((sum, n) => sum + n, 0);
  const inlineSvgs = (raw.match(/<svg\b/gi) || []).length;
  return {
    caps: CAPS,
    perAssetBytes: sizes,
    totalInlineBytes: total,
    inlineSvgs,
    perAssetOk: sizes.every((n) => n <= CAPS.perRasterBytes),
    totalOk: total <= CAPS.totalInlineBytes,
    documentBytes: Buffer.byteLength(raw, 'utf8'),
    documentOk: Buffer.byteLength(raw, 'utf8') <= CAPS.documentBytes,
  };
}

function isSingleIndexHtml(files) {
  const list = Array.isArray(files) ? files : [];
  return list.length === 1
    && Boolean(list[0])
    && String(list[0].path || '').toLowerCase() === 'index.html'
    && typeof list[0].content === 'string';
}

function visibleText(html) {
  return String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// A compact visible credit: "Source: Example Commons (CC BY 4.0)" or similar.
function hasAttribution(html) {
  return /(?:source|credit|attribution|image|artwork|photo)\s*[:\u2014-]/i.test(visibleText(html))
    && /(?:CC\s*BY|licen[cs]e|public domain|MIT|courtesy|by\s+[A-Z])/i.test(visibleText(html));
}

module.exports = {
  CAPS,
  scanRemoteReferences,
  inlineAssetBudget,
  isSingleIndexHtml,
  visibleText,
  hasAttribution,
};
