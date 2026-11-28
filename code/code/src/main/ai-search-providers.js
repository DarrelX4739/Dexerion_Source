// Structured, keyless retrieval for the rebuilt search pipeline (3.10, step 2).
//
// Pure module: URL builders and parsers only — the runner owns fetch, timeouts,
// budgets and caching. Every parser returns the one normalised shape the rest
// of the pipeline speaks: { provider, title, url, snippet, date, host }.
// No SERPs are scraped; these are the documented HTML/RSS/JSON endpoints.
'use strict';

const MAX_TITLE = 240;
const MAX_SNIPPET = 500;

function hostOf(url) {
  try { return new URL(String(url || '')).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

// ---------- text helpers ----------------------------------------------------
function decodeEntities(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function stripTags(value) {
  return decodeEntities(String(value || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function stripCdata(value) {
  const m = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(String(value || ''));
  return m ? m[1] : String(value || '');
}

// Accepts ISO dates, RFC822, YYYY-MM, bare years and unix seconds.
function normalizeDate(value) {
  if (value == null) return '';
  if (typeof value === 'number' || /^\d{10}$/.test(String(value))) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 1000000000 && n < 4102444800) {
      return new Date(n * 1000).toISOString().slice(0, 10);
    }
  }
  const s = String(value).trim();
  if (!s) return '';
  if (/^\d{4}$/.test(s)) return s + '-01-01';
  if (/^\d{4}-\d{2}$/.test(s)) return s + '-01';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // "2023 Jan" / "2023 January 15" (PubMed and friends).
  const named = /^(\d{4})\s+([A-Za-z]{3})/.exec(s);
  if (named) {
    const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
    const month = months[named[2].toLowerCase()];
    if (month) return named[1] + '-' + String(month).padStart(2, '0') + '-01';
  }
  const parsed = Date.parse(s);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return '';
}

function normalizeResult(provider, item) {
  const url = String((item && item.url) || '').trim();
  if (!/^https?:\/\//i.test(url)) return null;
  const title = String((item && item.title) || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
  return {
    provider: String(provider || ''),
    title: title || hostOf(url),
    url,
    snippet: String((item && item.snippet) || '').replace(/\s+/g, ' ').trim().slice(0, MAX_SNIPPET),
    date: normalizeDate(item && item.date),
    host: hostOf(url),
  };
}

function attr(tagAttrs, name) {
  const m = new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i').exec(String(tagAttrs || ''));
  return m ? m[1] : '';
}

// ---------- redirect unwrapping --------------------------------------------
function decodeDdgRedirect(href) {
  const raw = String(href || '');
  if (!/duckduckgo\.com\/l\//i.test(raw)) return raw;
  const abs = raw.startsWith('//') ? 'https:' + raw : raw;
  try {
    const target = new URL(abs).searchParams.get('uddg');
    if (target && /^https?:\/\//i.test(target)) return target;
  } catch {}
  return '';
}

function decodeBingRedirect(href) {
  const raw = String(href || '');
  if (!/bing\.com\/ck\/a/i.test(raw)) return raw;
  try {
    const u = new URL(raw.startsWith('//') ? 'https:' + raw : raw).searchParams.get('u') || '';
    if (u.startsWith('a1')) {
      const padded = u.slice(2).replace(/-/g, '+').replace(/_/g, '/');
      const text = Buffer.from(padded, 'base64').toString('utf8');
      if (/^https?:\/\//i.test(text)) return text;
    }
  } catch {}
  return '';
}

function cleanHref(href) {
  const ddg = decodeDdgRedirect(href);
  if (!ddg) return '';
  const bing = decodeBingRedirect(ddg);
  return bing || ddg;
}

// ---------- provider parsers ------------------------------------------------
function parseDuckDuckGoHtml(html) {
  const out = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (!/class\s*=\s*"[^"]*result__a/i.test(m[1])) continue;
    const href = cleanHref(attr(m[1], 'href'));
    if (!href) continue;
    const rest = String(html).slice(re.lastIndex, re.lastIndex + 4000);
    const snippetMatch = /<a\b[^>]*class\s*=\s*"[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(rest);
    const dateMatch = /class\s*=\s*"[^"]*result__timestamp[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(rest);
    out.push({
      title: stripTags(m[2]),
      url: href,
      snippet: snippetMatch ? stripTags(snippetMatch[1]) : '',
      date: dateMatch ? stripTags(dateMatch[1]) : '',
    });
    if (out.length >= 10) break;
  }
  return out;
}

function parseBingRss(xml) {
  const out = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml))) {
    const body = m[1];
    const tag = (name) => {
      const t = new RegExp('<' + name + '\\b[^>]*>([\\s\\S]*?)<\\/' + name + '>', 'i').exec(body);
      return t ? stripTags(stripCdata(t[1])) : '';
    };
    out.push({
      title: tag('title'),
      url: tag('link'),
      snippet: tag('description'),
      date: tag('pubDate'),
    });
    if (out.length >= 10) break;
  }
  return out;
}

function parseWikipediaJson(json) {
  const pages = json && Array.isArray(json.pages) ? json.pages : [];
  return pages.map((page) => ({
    title: String((page && page.title) || ''),
    url: page && page.key ? 'https://en.wikipedia.org/wiki/' + encodeURIComponent(String(page.key)) : '',
    snippet: stripTags((page && (page.excerpt || page.description)) || ''),
    date: '',
  }));
}

function parseArxivXml(xml) {
  const out = [];
  const entryRe = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  let m;
  while ((m = entryRe.exec(xml))) {
    const body = m[1];
    const tag = (name) => {
      const t = new RegExp('<' + name + '\\b[^>]*>([\\s\\S]*?)<\\/' + name + '>', 'i').exec(body);
      return t ? stripTags(stripCdata(t[1])) : '';
    };
    const id = tag('id').replace(/^http:/i, 'https:');
    out.push({
      title: tag('title'),
      url: id,
      snippet: tag('summary'),
      date: tag('published') || tag('updated'),
    });
    if (out.length >= 8) break;
  }
  return out;
}

function parseCrossrefJson(json) {
  const items = json && json.message && Array.isArray(json.message.items) ? json.message.items : [];
  return items.map((item) => {
    const titles = item && Array.isArray(item.title) ? item.title : [];
    const issued = item && item.issued && Array.isArray(item.issued['date-parts'])
      ? (item.issued['date-parts'][0] || []).join('-') : '';
    const doi = String((item && item.DOI) || '');
    return {
      title: titles[0] || '',
      url: (item && item.URL) || (doi ? 'https://doi.org/' + doi : ''),
      snippet: stripTags((item && item.abstract) || ''),
      date: issued,
    };
  });
}

function parsePubmedIds(json) {
  const ids = json && json.esearchresult && Array.isArray(json.esearchresult.idlist)
    ? json.esearchresult.idlist : [];
  return ids.map(String);
}

function parsePubmedSummary(json) {
  const result = json && json.result ? json.result : {};
  const uids = Array.isArray(result.uids) ? result.uids : [];
  const out = [];
  for (const uid of uids) {
    const row = result[String(uid)];
    if (!row) continue;
    out.push({
      title: String(row.title || ''),
      url: 'https://pubmed.ncbi.nlm.nih.gov/' + encodeURIComponent(String(uid)) + '/',
      snippet: String(row.source || '') + (row.elocationid ? ' · ' + String(row.elocationid) : ''),
      date: row.pubdate || row.epubdate || '',
    });
  }
  return out;
}

function parseGitHubJson(json) {
  const items = json && Array.isArray(json.items) ? json.items : [];
  return items.map((item) => ({
    title: String((item && item.full_name) || ''),
    url: String((item && item.html_url) || ''),
    snippet: String((item && item.description) || '') + (item && item.stargazers_count != null ? ' · ' + item.stargazers_count + ' stars' : ''),
    date: String((item && item.updated_at) || ''),
  }));
}

function parseStackExchangeJson(json) {
  const items = json && Array.isArray(json.items) ? json.items : [];
  return items.map((item) => ({
    title: String((item && item.title) || ''),
    url: String((item && item.link) || ''),
    snippet: 'Score ' + String((item && item.score) || 0) + (item && item.is_answered ? ' · answered' : ' · unanswered'),
    date: item && item.creation_date ? Number(item.creation_date) : '',
  }));
}

// ---------- registry --------------------------------------------------------
const PROVIDERS = {
  duckduckgo: {
    id: 'duckduckgo', label: 'DuckDuckGo', mode: 'web', max: 8,
    url: (q) => 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q),
    parse: parseDuckDuckGoHtml,
  },
  bing: {
    id: 'bing', label: 'Bing', mode: 'web', max: 8,
    url: (q) => 'https://www.bing.com/search?format=rss&q=' + encodeURIComponent(q),
    parse: parseBingRss,
  },
  wikipedia: {
    id: 'wikipedia', label: 'Wikipedia', mode: 'web', max: 5,
    url: (q) => 'https://en.wikipedia.org/w/rest.php/v1/search/page?limit=5&q=' + encodeURIComponent(q),
    parse: (body) => {
      let json = null;
      try { json = JSON.parse(body); } catch {}
      return parseWikipediaJson(json);
    },
  },
  arxiv: {
    id: 'arxiv', label: 'arXiv', mode: 'source', max: 6,
    url: (q) => 'https://export.arxiv.org/api/query?start=0&max_results=6&search_query=all:' + encodeURIComponent(q),
    parse: parseArxivXml,
  },
  crossref: {
    id: 'crossref', label: 'Crossref', mode: 'source', max: 6,
    url: (q) => 'https://api.crossref.org/works?rows=6&query=' + encodeURIComponent(q),
    parse: (body) => {
      let json = null;
      try { json = JSON.parse(body); } catch {}
      return parseCrossrefJson(json);
    },
  },
  pubmed: {
    id: 'pubmed', label: 'PubMed', mode: 'source', max: 6, twoStep: true,
    url: (q) => 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=6&term=' + encodeURIComponent(q),
    secondUrl: (ids) => 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=' + encodeURIComponent(ids.join(',')),
    parseIds: (body) => {
      let json = null;
      try { json = JSON.parse(body); } catch {}
      return parsePubmedIds(json);
    },
    parse: (body) => {
      let json = null;
      try { json = JSON.parse(body); } catch {}
      return parsePubmedSummary(json);
    },
  },
  github: {
    id: 'github', label: 'GitHub', mode: 'source', max: 6,
    url: (q) => 'https://api.github.com/search/repositories?per_page=6&q=' + encodeURIComponent(q),
    parse: (body) => {
      let json = null;
      try { json = JSON.parse(body); } catch {}
      return parseGitHubJson(json);
    },
  },
  stackexchange: {
    id: 'stackexchange', label: 'Stack Overflow', mode: 'source', max: 6,
    url: (q) => 'https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&site=stackoverflow&pagesize=6&q=' + encodeURIComponent(q),
    parse: (body) => {
      let json = null;
      try { json = JSON.parse(body); } catch {}
      return parseStackExchangeJson(json);
    },
  },
};

const WEB_PROVIDERS = ['duckduckgo', 'bing', 'wikipedia'];

// Intent routing for on-demand source APIs: only ask arXiv/Crossref/PubMed
// when the question (or the model's plan) actually sounds scholarly, and so on.
const SCHOLARLY = /(?:^|[\s(])(stud(?:y|ies)|papers?|research|meta[- ]analysis|systematic review|clinical trial|preprint|journal|doi|citation|arxiv|pubmed)(?:$|[\s).,?])/i;
const CODE_INTENT = /\b(github|repositor(?:y|ies)|repo|open[- ]source|source code|npm|pypi|library|package|sdk)\b/i;
const QA_INTENT = /\b(error|exception|traceback|stack ?overflow|segfault|crash(?:es|ing)?|how (?:do|to) (?:i |you )?fix)\b/i;
const FIX_HINT = /(?:typeerror|referenceerror|syntaxerror|undefined|null pointer|econnrefused|enoent|cannot read)/i;

function wantsSourceApis(question) {
  const s = String(question || '');
  const out = [];
  if (SCHOLARLY.test(s)) out.push('arxiv', 'crossref', 'pubmed');
  if (CODE_INTENT.test(s)) out.push('github');
  if (QA_INTENT.test(s) || FIX_HINT.test(s)) out.push('stackexchange');
  return out;
}

// One request per query per provider. Source APIs run on the first queries
// only (the runner caps the list); web providers run on all of them.
function providerRequests(queries, opts) {
  const options = opts || {};
  const list = Array.isArray(queries) ? queries : [];
  const web = Array.isArray(options.web) && options.web.length ? options.web : WEB_PROVIDERS;
  const source = Array.isArray(options.source) ? options.source : [];
  const sourceQueryCap = Number.isFinite(options.sourceQueryCap) ? options.sourceQueryCap : 2;
  const out = [];
  list.forEach((entry, qi) => {
    const q = String((entry && entry.q != null ? entry.q : entry) || '').trim();
    if (!q) return;
    for (const id of web) {
      const provider = PROVIDERS[id];
      if (!provider) continue;
      out.push({ provider: id, query: q, queryIndex: qi, url: provider.url(q) });
    }
    if (qi >= sourceQueryCap) return;
    for (const id of source) {
      const provider = PROVIDERS[id];
      if (!provider) continue;
      out.push({ provider: id, query: q, queryIndex: qi, url: provider.url(q) });
    }
  });
  return out;
}

// Parses a provider body into normalised results. `body` is text for all
// providers; the caller fetches pubmed's second step separately.
function parseProvider(providerId, body) {
  const provider = PROVIDERS[String(providerId || '')];
  if (!provider) return [];
  let raw = [];
  try { raw = provider.parse(body) || []; } catch { raw = []; }
  const out = [];
  for (const item of raw.slice(0, provider.max + 2)) {
    const result = normalizeResult(provider.id, item);
    if (result) out.push(result);
  }
  return out;
}

module.exports = {
  MAX_TITLE,
  MAX_SNIPPET,
  PROVIDERS,
  WEB_PROVIDERS,
  hostOf,
  decodeEntities,
  stripTags,
  normalizeDate,
  normalizeResult,
  decodeDdgRedirect,
  decodeBingRedirect,
  cleanHref,
  parseDuckDuckGoHtml,
  parseBingRss,
  parseWikipediaJson,
  parseArxivXml,
  parseCrossrefJson,
  parsePubmedIds,
  parsePubmedSummary,
  parseGitHubJson,
  parseStackExchangeJson,
  wantsSourceApis,
  providerRequests,
  parseProvider,
};
