// Site blocklist matching — pure functions, no Electron.
//
// A list of domains ("example.com", "docs.google.com"). A URL is blocked
// when its host equals a listed domain or is a subdomain of one.
// Dexerion's own pages (dexerion://), extensions and local files are never
// blocked — they are the browser's own chrome and the escape hatch.
'use strict';

// Normalize user input ("https://www.Example.com/path", "Example.com", "*.")
// into a bare lowercase hostname. Returns '' when nothing usable remains.
function normalizeDomain(input) {
  let s = String(input == null ? '' : input).trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^\*\./, '');
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // strip scheme
  s = s.replace(/^\/\//, '');
  s = s.split('/')[0].split('?')[0].split('#')[0];
  s = s.split('@').pop();        // drop userinfo
  s = s.replace(/:\d+$/, '');    // drop port
  s = s.replace(/^\[|\]$/g, ''); // IPv6 brackets
  s = s.replace(/\.+$/, '');     // trailing dot
  if (s.startsWith('www.') && s.length > 4) s = s.slice(4);
  if (!/^[a-z0-9._-]+$/.test(s)) return '';
  return s;
}

// De-duplicate + normalize a raw allowlist (accepts strings and {domain} objs).
function normalizeAllowlist(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const d = normalizeDomain(typeof raw === 'string' ? raw : raw && raw.domain);
    if (!d || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out;
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(String(url || ''));
}

function hostOf(url) {
  try { return new URL(String(url)).hostname.toLowerCase(); } catch { return ''; }
}

// Does `domains` permit `host`? Empty allowlist permits nothing (an active
// session with no configured sites is a deliberate full block).
function hostAllowed(host, domains) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!h) return false;
  for (const d of normalizeAllowlist(domains)) {
    if (h === d || h.endsWith('.' + d)) return true;
  }
  return false;
}

// Full URL decision. Non-http(s) schemes (dexerion://, chrome-extension://,
// about:, file:, data:) are always allowed — the allowlist governs the web.
function urlAllowed(url, domains) {
  if (!isHttpUrl(url)) return true;
  const h = hostOf(url);
  if (!h) return false;
  return hostAllowed(h, domains);
}

// A mode either ALLOWS only the listed sites (default) or BLOCKS the listed
// sites and permits everything else.
function urlPermitted(url, { policy = 'allow', list = [] } = {}) {
  if (!isHttpUrl(url)) return true;
  const h = hostOf(url);
  const match = h ? hostAllowed(h, list) : false;
  return policy === 'block' ? !match : Boolean(h) && match;
}

module.exports = { normalizeDomain, normalizeAllowlist, hostAllowed, urlAllowed, urlPermitted, isHttpUrl, hostOf };
