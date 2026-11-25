// Read guards and budgets for the rebuilt search pipeline (3.10, step 4).
//
// Pure module: private-network refusal, the post-redirect denylist re-check,
// content-type gating for fetched bodies, and the quick/deep read budget. The
// actual fetching (Chromium net.fetch for providers; background tabs plus the
// shared page reader for result pages) lives in the runner's injected deps.
'use strict';

const rank = require('./ai-search-rank');

const MIN_PAGE_CHARS = 400;      // shorter extracts are not treated as read
const QUICK_READS = 4;           // result pages fetched for a quick search
const DEEP_READS = 10;           // result pages fetched for a deep search
const MAX_READS = 16;
const FETCH_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const PRIVATE_V4 = [
  /^0\./,            // "this network"
  /^10\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,  // CGNAT 100.64/10
  /^127\./,
  /^169\.254\./,     // link-local
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^192\.0\.0\./,    // IETF protocol assignments
  /^198\.1[89]\./,   // benchmarking
  /^22[4-9]\./, /^2[3-5]\d\./  // multicast + reserved
];

// The e2e suite runs the whole pipeline against a local mock (DEX_SEARCH_BASE)
// and sets this so the read guard accepts that mock's loopback URLs. The flag
// is read at module load; production never sets it, and the unit suite asserts
// the guard is fully on without it.
const ALLOW_PRIVATE_FOR_TESTS = String(process.env.DEX_SEARCH_ALLOW_PRIVATE || '') === '1';

function isPrivateHost(host) {
  if (ALLOW_PRIVATE_FOR_TESTS) return false;
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === 'metadata.google.internal') return true;
  if (h === '::1' || h === '::') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;      // unique local fc00::/7
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true;      // link-local fe80::/10
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
  const v4 = mapped ? mapped[1] : h;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
    return PRIVATE_V4.some((re) => re.test(v4));
  }
  return false;
}

// Network safety only: protocol and private-network refusal. Provider
// endpoints (which are search hosts by design) use this; it deliberately does
// not apply the source denylist.
function checkFetchUrl(url) {
  let u;
  try { u = new URL(String(url || '')); } catch { return { ok: false, error: 'Not a valid URL.' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'Only http(s) requests are allowed.' };
  if (isPrivateHost(u.hostname)) return { ok: false, error: 'Local and private-network hosts are off limits.' };
  return { ok: true, url: u.toString() };
}

// The full pre-flight for any URL the pipeline is about to read or cite.
function checkReadUrl(url, allow) {
  const base = checkFetchUrl(url);
  if (!base.ok) return base;
  if (rank.isDeniedUrl(url, allow || [])) return { ok: false, error: 'Search engines and consent pages are never sources.' };
  return { ok: true, url: base.url };
}

// Fetched bodies: text-ish content types only (providers are HTML/RSS/JSON).
const TEXT_TYPE = /^(?:text\/|application\/(?:json|xml|rss\+xml|atom\+xml|xhtml\+xml)|application\/[a-z0-9.+-]+\+(?:json|xml))/i;
function isTextType(contentType) {
  const type = String(contentType || '').split(';')[0].trim();
  if (!type) return true; // missing header: let the parser decide
  return TEXT_TYPE.test(type);
}

// The reading budget: quick reads a handful, deep reads properly; the person's
// source setting is the ceiling, the mode is the floor of ambition.
function readBudget(mode, sourcesSetting) {
  const n = Number(sourcesSetting);
  const has = sourcesSetting !== null && sourcesSetting !== undefined && sourcesSetting !== '' && Number.isFinite(n);
  const ceiling = has ? Math.max(2, Math.min(MAX_READS, Math.round(n))) : MAX_READS;
  const want = mode === 'quick' ? QUICK_READS : DEEP_READS;
  return Math.max(1, Math.min(want, ceiling));
}

// A read "landed" only if the final URL still passes the denylist (redirects
// are the classic way an engine page sneaks back in) and the text is real.
function acceptRead(page, candidate, allow) {
  const finalUrl = String((page && page.url) || (candidate && candidate.url) || '');
  const check = checkReadUrl(finalUrl, allow || []);
  if (!check.ok) return { ok: false, reason: check.error };
  const text = String((page && page.text) || '').trim();
  if (text.length < MIN_PAGE_CHARS) return { ok: false, reason: 'Too little readable text.' };
  return {
    ok: true,
    source: {
      title: String((page && page.title) || (candidate && candidate.title) || '').slice(0, 240),
      url: finalUrl,
      date: String((candidate && candidate.date) || ''),
      text,
    },
  };
}

module.exports = {
  MIN_PAGE_CHARS,
  QUICK_READS,
  DEEP_READS,
  MAX_READS,
  FETCH_TIMEOUT_MS,
  MAX_BODY_BYTES,
  isPrivateHost,
  checkFetchUrl,
  checkReadUrl,
  isTextType,
  readBudget,
  acceptRead,
};
