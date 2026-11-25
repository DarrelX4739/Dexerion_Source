// Filter and rank for the rebuilt search pipeline (3.10, step 3).
//
// Pure module. The hard rules live here: search-engine / consent / redirect
// hosts can never become sources (unless the person's own query targeted one
// with `site:`), duplicates collapse, and the reading budget favours the most
// relevant, most authoritative and freshest pages with at most two per domain.
'use strict';

const MAX_PER_HOST = 2;
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with',
  'is', 'are', 'was', 'were', 'be', 'been', 'it', 'this', 'that', 'these',
  'those', 'as', 'at', 'by', 'from', 'how', 'what', 'when', 'where', 'which',
  'who', 'why', 'does', 'do', 'did', 'can', 'could', 'should', 'would', 'into',
  'about', 'over', 'after', 'before', 'between', 'vs', 'versus',
]);

function hostOf(url) {
  try { return new URL(String(url || '')).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

const TWO_PART_TLDS = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk', 'sch.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'net.nz', 'org.nz', 'govt.nz',
  'co.jp', 'ne.jp', 'or.jp', 'go.jp', 'ac.jp',
  'com.br', 'net.br', 'org.br', 'gov.br',
  'com.mx', 'com.ar', 'com.co', 'com.tw', 'com.hk', 'com.sg', 'com.my',
  'co.in', 'net.in', 'org.in', 'gov.in', 'ac.in',
  'co.za', 'org.za', 'gov.za', 'co.kr', 'or.kr', 'go.kr',
]);

function rootDomain(host) {
  const labels = String(host || '').toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  if (TWO_PART_TLDS.has(lastTwo)) return labels.slice(-3).join('.');
  return lastTwo;
}

// URL identity for dedupe: no fragment, no tracking params, no trailing slash.
const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|igshid$|mc_cid$|mc_eid$|ref$|ref_src$|source$|cmpid$)/i;
function canonicalUrl(url) {
  try {
    const u = new URL(String(url || ''));
    u.hash = '';
    const drop = [];
    for (const key of u.searchParams.keys()) {
      if (TRACKING_PARAMS.test(key)) drop.push(key);
    }
    for (const key of drop) u.searchParams.delete(key);
    let out = u.toString();
    out = out.replace(/\/$/, '');
    return out.toLowerCase();
  } catch { return ''; }
}

// ---------- the hard denylist ----------------------------------------------
// `site:` in the person's queries re-allows that domain for this run only.
function siteAllowFrom(queries) {
  const allow = [];
  const list = Array.isArray(queries) ? queries : [];
  for (const entry of list) {
    const q = typeof entry === 'string' ? entry : String((entry && entry.q) || '');
    const re = /\bsite:\s*([a-z0-9.-]+)/gi;
    let m;
    while ((m = re.exec(q))) {
      const domain = m[1].toLowerCase().replace(/^\./, '');
      if (domain) allow.push(domain);
    }
  }
  return allow;
}

function matchesAllow(host, allow) {
  for (const domain of allow) {
    const d = String(domain || '').toLowerCase().replace(/^\./, '');
    if (!d) continue;
    if (host === d || host.endsWith('.' + d)) return true;
  }
  return false;
}

const REDIRECT_PATH = /^\/(?:url|redirect|out|away|link|goto)\/?$/i;

function isDeniedUrl(url, allow) {
  let u;
  try { u = new URL(String(url || '')); } catch { return true; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = u.pathname || '';
  if (matchesAllow(host, allow || [])) return false;
  if (/(^|\.)googleadservices\.com$|(^|\.)googlesyndication\.com$|(^|\.)doubleclick\.net$/.test(host)) return true;
  if (/(^|\.)google\.[a-z]{2,}(?:\.[a-z]{2,})?$/.test(host)) return true;
  if (/^(consent|accounts)\./.test(host)) return true;
  if (/(^|\.)bing\.com$/.test(host) && (/^\/search\b/.test(path) || /^\/ck\//.test(path) || /^\/images\b/.test(path) || path === '/')) return true;
  if (/(^|\.)duckduckgo\.com$/.test(host) && (/^\/html\b/.test(path) || /^\/l\//.test(path) || path === '/')) return true;
  if (REDIRECT_PATH.test(path) && /[?&](?:url|q|u|target|redirect)=/i.test(u.search)) return true;
  return false;
}

// ---------- scoring ---------------------------------------------------------
const AUTHORITY = [
  [/(^|\.)wikipedia\.org$/, 1.0],
  [/(^|\.)arxiv\.org$/, 0.95],
  [/(^|\.)pubmed\.ncbi\.nlm\.nih\.gov$|(^|\.)ncbi\.nlm\.nih\.gov$/, 0.95],
  [/(^|\.)doi\.org$|(^|\.)nature\.com$|(^|\.)science\.org$|(^|\.)acm\.org$|(^|\.)ieee\.org$|(^|\.)springer\.com$|(^|\.)sciencedirect\.com$/, 0.9],
  [/(^|\.)github\.com$/, 0.85],
  [/(^|\.)stackoverflow\.com$|(^|\.)stackexchange\.com$|(^|\.)serverfault\.com$|(^|\.)superuser\.com$/, 0.8],
  [/(^|\.)reuters\.com$|(^|\.)apnews\.com$|(^|\.)bbc\.co\.uk$|(^|\.)bbc\.com$|(^|\.)npr\.org$/, 0.85],
  [/\.gov$/, 0.85],
  [/\.edu$/, 0.8],
  [/(^|\.)developer\.mozilla\.org$|(^|\.)mdn\.mozilla\.org$/, 0.85],
  [/(^|\.)w3\.org$/, 0.85],
  [/(^|\.)rust-lang\.org$|(^|\.)python\.org$|(^|\.)nodejs\.org$|(^|\.)typescriptlang\.org$/, 0.8],
  [/(^|\.)microsoft\.com$|(^|\.)apple\.com$|(^|\.)google\.com\/[a-z-]+(-[a-z-]+)*\/[a-z-]+/, 0.7],
];

function authorityScore(host) {
  for (const [re, value] of AUTHORITY) {
    if (re.test(host)) return value;
  }
  return 0.5;
}

function tokensOf(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function relevanceScore(result, queryTokens) {
  if (!queryTokens.length) return 0.5;
  const title = String(result.title || '').toLowerCase();
  const snippet = String(result.snippet || '').toLowerCase();
  const host = String(result.host || '').toLowerCase();
  const url = String(result.url || '').toLowerCase();
  let hits = 0;
  for (const token of queryTokens) {
    if (title.includes(token)) { hits += 1; continue; }
    if (snippet.includes(token)) { hits += 0.6; continue; }
    if (host.includes(token) || url.includes(token)) hits += 0.3;
  }
  return Math.min(1, hits / queryTokens.length);
}

function freshnessScore(date, nowMs) {
  if (!date) return 0.5;
  const t = Date.parse(String(date));
  if (!Number.isFinite(t)) return 0.5;
  const days = Math.max(0, (nowMs - t) / 86400000);
  // Base decay over 2 years; recent content (7 days) gets a freshness bonus
  // so "latest" queries surface recent pages first.
  const base = Math.max(0, Math.min(1, 1 - days / 730));
  const bonus = days <= 7 ? 0.15 : days <= 30 ? 0.08 : 0;
  return Math.min(1, base + bonus);
}

// Weights: relevance first, then authority, then freshness.
function scoreResult(result, ctx) {
  const relevance = relevanceScore(result, ctx.queryTokens);
  const authority = authorityScore(String(result.host || ''));
  const freshness = freshnessScore(result.date, ctx.now);
  return {
    score: Number((0.5 * relevance + 0.3 * authority + 0.2 * freshness).toFixed(4)),
    parts: { relevance: Number(relevance.toFixed(3)), authority, freshness: Number(freshness.toFixed(3)) },
  };
}

function dedupe(results) {
  const out = [];
  const seen = new Map();
  for (const result of Array.isArray(results) ? results : []) {
    if (!result || !result.url) continue;
    const key = canonicalUrl(result.url);
    if (!key) continue;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, result);
      out.push(result);
      continue;
    }
    // Same page from several queries/providers: keep the richer copy.
    if (String(result.snippet || '').length > String(existing.snippet || '').length) {
      existing.snippet = result.snippet;
    }
    if (!existing.date && result.date) existing.date = result.date;
  }
  return out;
}

// Filter -> dedupe -> score -> sort (stable). Returns results with .score.
function rankResults(results, opts) {
  const options = opts || {};
  const allow = Array.isArray(options.siteAllow) ? options.siteAllow : [];
  const nowMs = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const queryText = [];
  for (const entry of Array.isArray(options.queries) ? options.queries : []) {
    queryText.push(typeof entry === 'string' ? entry : String((entry && entry.q) || ''));
  }
  const queryTokens = Array.from(new Set(tokensOf(queryText.join(' '))));
  const kept = [];
  for (const result of dedupe(results)) {
    if (isDeniedUrl(result.url, allow)) continue;
    const scored = scoreResult(result, { queryTokens, now: nowMs });
    kept.push(Object.assign({}, result, { score: scored.score, parts: scored.parts }));
  }
  kept.sort((a, b) => b.score - a.score);
  return kept;
}

// The reading budget: highest scores first, at most two pages per root domain.
function pickForReading(ranked, opts) {
  const options = opts || {};
  const max = Number.isFinite(options.max) ? Math.max(1, Math.floor(options.max)) : 6;
  const perHost = Number.isFinite(options.perHost) ? Math.max(1, Math.floor(options.perHost)) : MAX_PER_HOST;
  const out = [];
  const counts = new Map();
  for (const result of Array.isArray(ranked) ? ranked : []) {
    if (out.length >= max) break;
    const domain = rootDomain(String(result.host || hostOf(result.url)));
    const used = counts.get(domain) || 0;
    if (used >= perHost) continue;
    counts.set(domain, used + 1);
    out.push(result);
  }
  return out;
}

module.exports = {
  MAX_PER_HOST,
  hostOf,
  rootDomain,
  canonicalUrl,
  siteAllowFrom,
  matchesAllow,
  isDeniedUrl,
  authorityScore,
  relevanceScore,
  freshnessScore,
  scoreResult,
  dedupe,
  rankResults,
  pickForReading,
};
