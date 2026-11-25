// Query planning for the rebuilt search pipeline (rework 3.10, step 1).
//
// Pure module: the caller runs the model call; this file writes the prompt and
// parses whatever came back into 2-5 standalone queries, each with an optional
// angle, a recency floor and a domain hint. Anything malformed degrades to the
// person's own question rather than failing the search.
'use strict';

const MIN_QUERIES = 2;
const MAX_QUERIES = 5;
const MAX_QUERY_CHARS = 400;
const MAX_PLAN_QUERY_CHARS = 180;
const MAX_ANGLE_CHARS = 40;
const MAX_MATCH_CHARS = 80;
const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_CHARS = 1500;

function cleanQuery(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_CHARS);
}

function historyText(history) {
  const list = Array.isArray(history) ? history.slice(-MAX_HISTORY_MESSAGES) : [];
  if (!list.length) return '';
  const lines = [];
  for (const message of list) {
    const who = message && message.role === 'model' ? 'Assistant' : 'User';
    const text = String((message && message.text) || '').replace(/\s+/g, ' ').trim().slice(0, MAX_HISTORY_CHARS);
    if (text) lines.push(who + ': ' + text);
  }
  return lines.length ? 'Conversation so far:\n' + lines.join('\n') : '';
}

// Queries per mode: quick searches a little, deep searches properly.
function clampPlanCount(value, mode) {
  const fallback = mode === 'quick' ? 2 : MAX_QUERIES;
  const n = Math.round(Number(value));
  const base = Number.isFinite(n) ? n : fallback;
  return Math.max(MIN_QUERIES, Math.min(MAX_QUERIES, base));
}

// Recency floors the person's own words imply, so "latest" queries do not pin
// five-year-old pages through the ranking freshness term.
function recencyAfter(question, now) {
  const s = String(question || '').toLowerCase();
  const at = now instanceof Date ? now.getTime() : (Number.isFinite(Number(now)) ? Number(now) : Date.now());
  const day = 86400000;
  const iso = (ms) => new Date(at - ms).toISOString().slice(0, 10);
  if (/\b(today|right now|just now)\b/.test(s)) return iso(2 * day);
  if (/\b(this week|past week|last week|weekly)\b/.test(s)) return iso(9 * day);
  if (/\b(this month|past month|last month|monthly)\b/.test(s)) return iso(35 * day);
  if (/\b(this year|past year|last year|annual|latest|newest|recent|current|nowadays)\b/.test(s)) return iso(400 * day);
  return '';
}

function planMessages(question, count, history) {
  const n = clampPlanCount(count);
  const q = cleanQuery(question);
  const convo = historyText(history);
  const system = [
    'You are the search planner for Dexerion AI Search.',
    'Turn the question into exactly ' + n + ' independent search queries that together find the best sources for answering it.',
    'Every query must stand alone (no pronouns from the conversation), use the natural language of the question, and take a genuinely different angle so the sources complement rather than duplicate each other.',
    'Cover these angles where they fit: the direct answer; a precise technical or definitional detail; a comparison or trade-off; recent coverage; and an authoritative or first-party view (set "site" for official docs, standards or primary sources). Prefer queries that are likely to surface primary sources over opinion pieces.',
    'If the question depends on time (news, prices, releases, "latest"/"current"), add an "after" recency floor. If a named organisation, product or publication is central, use "site" to target it directly.',
    'Return ONLY a JSON object: {"queries":[{"q":"first query","angle":"direct","after":"YYYY-MM-DD","site":"example.org"}]}. "angle" is one short word. "after" and "site" are optional and only when genuinely useful. No markdown, no commentary.'
  ].join(' ');
  const user = [
    'Question: ' + q,
    convo,
    'Write exactly ' + n + ' queries and return the JSON object now.'
  ].filter(Boolean).join('\n\n');
  return [{ role: 'system', text: system }, { role: 'user', text: user }];
}

const SITE_DOMAIN = /^(?:[a-z0-9-]+\.)+[a-z]{2,24}$/i;
const SITE_TLD = /^\.?[a-z]{2,24}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function cleanSite(value) {
  const site = String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!site) return '';
  if (SITE_DOMAIN.test(site) || SITE_TLD.test(site)) return site;
  return '';
}

function cleanAfter(value) {
  const after = String(value || '').trim().slice(0, 10);
  if (!ISO_DATE.test(after)) return '';
  const year = Number(after.slice(0, 4));
  if (year < 1990 || year > 2100) return '';
  return after;
}

// Tolerant JSON extraction: models wrap JSON in prose or fences constantly.
function extractJson(text) {
  const raw = String(text || '').replace(/```(?:json)?/gi, '').replace(/```/g, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch {}
  }
  const aStart = raw.indexOf('[');
  const aEnd = raw.lastIndexOf(']');
  if (aStart >= 0 && aEnd > aStart) {
    try { return JSON.parse(raw.slice(aStart, aEnd + 1)); } catch {}
  }
  return null;
}

// Returns [{ q, angle, after, site }]; always at least one query (the question).
function parsePlan(text, count, question, now) {
  const n = clampPlanCount(count);
  let data = extractJson(text);
  let list = [];
  if (Array.isArray(data)) list = data;
  else if (data && Array.isArray(data.queries)) list = data.queries;
  else if (data && Array.isArray(data.search_queries)) list = data.search_queries;
  const fallbackAfter = recencyAfter(question, now);
  const out = [];
  const seen = new Set();
  for (const item of list) {
    let entry = null;
    if (typeof item === 'string') entry = { q: item };
    else if (item && typeof item === 'object' && !Array.isArray(item)) entry = item;
    if (!entry) continue;
    const q = String(entry.q || entry.query || '').replace(/\s+/g, ' ').trim().slice(0, MAX_PLAN_QUERY_CHARS);
    if (!q) continue;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      q,
      angle: String(entry.angle || '').replace(/\s+/g, ' ').trim().slice(0, MAX_ANGLE_CHARS),
      after: cleanAfter(entry.after) || fallbackAfter,
      site: cleanSite(entry.site),
    });
    if (out.length >= n) break;
  }
  if (!out.length) {
    const q = cleanQuery(question);
    if (q) out.push({ q: q.slice(0, MAX_PLAN_QUERY_CHARS), angle: 'direct', after: fallbackAfter, site: '' });
  }
  return out;
}

module.exports = {
  MIN_QUERIES,
  MAX_QUERIES,
  MAX_QUERY_CHARS,
  MAX_PLAN_QUERY_CHARS,
  MAX_MATCH_CHARS,
  cleanQuery,
  clampPlanCount,
  recencyAfter,
  planMessages,
  parsePlan,
  cleanSite,
  cleanAfter,
};
