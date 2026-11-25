// Dexerion research helpers — pure, headless-testable (no Electron, no I/O).
//
// Three jobs, all deliberately data-only so they can be unit tested and reused
// by both the agent loop (src/main/ai-agent.js) and the tool dispatcher
// (src/main/browser.js):
//   1. Tab discovery — rank open tabs against a natural-language query by
//      title/URL, and find query terms inside page text with bounded snippets.
//   2. Plans — sanitize the model's plan (goal, steps, statuses, dependencies)
//      to a small, safe shape the UI and mission store can render.
//   3. Research projects — validate project drafts, findings/decisions/open
//      questions, and verify that a finding cites a page the run actually
//      read (never fabricated). Projects are separate from personal memory.
'use strict';

// ---- caps (one place to audit) ---------------------------------------------
const MAX_QUERY_TERMS = 12;
const MAX_PLAN_STEPS = 20;
const MAX_GOAL_CHARS = 300;
const MAX_STEP_CHARS = 300;
const MAX_PROJECT_TITLE = 80;
const MAX_PROJECT_GOAL = 400;
const MAX_SOURCES = 40;
const MAX_FINDINGS = 100;
const MAX_DECISIONS = 50;
const MAX_QUESTIONS = 50;
const MAX_FINDING_CHARS = 1500;
const MAX_QUOTE_CHARS = 500;
const MAX_ENTRY_CHARS = 1000;
const MIN_QUOTE_CHARS = 12;
const MAX_MATCH_SNIPPET = 400;
const MAX_MATCHES = 10;
const MAX_SCAN_TABS = 6;        // live content scans per search_tabs call
const MAX_RUN_NEW_TABS = 5;     // tabs an agent run may open
const MAX_RUN_READS = 40;       // read_tab + search_tabs calls per run

const PLAN_STATUSES = ['pending', 'doing', 'done', 'failed', 'blocked'];

function clean(v, max) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// ---- tab-id validation (stable internal ids only) --------------------------
// Tab ids are assigned by the browser ('t' + a global sequence) and are the
// only stable handle across windows; list positions, titles and search-result
// ranks are not. These helpers validate what the model emitted before it ever
// reaches the tab layer, so a missing/odd argument fails with an actionable
// message instead of a silent empty id.
const TAB_ID_RE = /^t\d+$/;
const TAB_ARG_ALIASES = ['tab_id', 'tabID', 'id', 'tab'];

// Normalize the arguments of tab-addressed tools. Returns {ok:true, args}
// (a shallow copy with a validated string tabId) or {ok:false, error}.
// Non-tab tools pass through untouched.
function normalizeTabArgs(name, input) {
  if (name !== 'read_tab' && name !== 'switch_tab' && name !== 'close_tab') {
    return { ok: true, args: input };
  }
  const src = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
  const a = { ...src };
  let raw = a.tabId;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    for (const key of TAB_ARG_ALIASES) {
      if (typeof a[key] === 'string' && a[key].trim()) { raw = a[key]; break; }
    }
  }
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return {
      ok: false,
      error: name + ' needs "tabId" — the exact id shown at the start of each list_tabs/search_tabs ' +
        'line (like "t7"). Call list_tabs or search_tabs, then retry with that id. Do not omit it.',
    };
  }
  const s = String(raw).trim().toLowerCase();
  if (!TAB_ID_RE.test(s)) {
    return {
      ok: false,
      error: 'Tab ids look like "t7" — got "' + clean(raw, 40) + '". Use the id at the start of each ' +
        'list_tabs/search_tabs line; never a position, a title or "undefined".',
    };
  }
  a.tabId = s;
  return { ok: true, args: a };
}

// One compact line per tab, ids first: what the model should retry with.
function compactTabList(tabs, limit) {
  const cap = Math.max(1, Math.min(20, parseInt(limit, 10) || 12));
  const list = (Array.isArray(tabs) ? tabs : []).slice(0, cap);
  return list.map(t => {
    const flags = [];
    if (t.active) flags.push('active');
    if (t.asleep) flags.push('asleep');
    else if (t.loading) flags.push('loading');
    if (t.readable === false) flags.push('not readable');
    return t.tabId + '  ' + clean(t.title || t.url || '(untitled)', 80) +
      '  ' + String(t.url || '').slice(0, 160) +
      (flags.length ? '  [' + flags.join(', ') + ']' : '');
  }).join('\n');
}

// Append the currently open tabs to an error so a failed id can be replaced
// with a fresh one on the retry (never a substitution inside the same call).
function withTabRefs(error, tabs) {
  const body = compactTabList(tabs);
  return String(error || 'Something went wrong.') + '\n' +
    (body ? 'Open tabs right now:\n' + body : 'No tabs are open right now.');
}

// ---- all-tabs inspection (shared by the Read button and the agent tool) ----
// One job: given adapters that list tabs and read one tab by its stable id,
// read every discovered tab individually, in order, and produce a
// consolidated report. The workflow never invents ids, never substitutes a
// tab, records every failure with a reason and keeps going. Pure + async so
// the same code is exercised by both entry points and by the tests.
const INSPECT_MAX_TABS = 40;
const INSPECT_SETTLE_MS = 3000;
const INSPECT_EXTRACT_MS = 12000;
const INSPECT_TOTAL_MS = 120000;

// A tab's "content summary": its own description/outline plus a bounded
// excerpt of the actual extracted text — never generated, never invented.
function summarizeSnapshot(snap, opts) {
  const o = opts || {};
  const maxText = Math.max(80, Math.min(2000, parseInt(o.maxText, 10) || 320));
  const s = snap || {};
  const bits = [];
  const desc = clean(s.description, 200);
  if (desc) bits.push(desc);
  const outline = String(s.outline || '').split('\n')
    .map(l => l.trim()).filter(Boolean).slice(0, 3)
    .map(l => clean(l, 90)).join(' | ');
  if (outline) bits.push('Sections: ' + outline);
  const excerpt = clean(s.text, maxText);
  if (excerpt) bits.push(excerpt);
  return bits.join(' · ').slice(0, maxText + 320);
}

// Confirmed duplicates: tabs whose current URLs are the same after
// normalisation (fragment/trailing-slash noise removed).
function findDuplicateTabs(entries) {
  const groups = new Map();
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || !e.url) continue;
    const key = normUrl(e.url);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { url: e.url, title: e.title || '', tabs: [] });
    groups.get(key).tabs.push({ tabId: e.tabId, windowId: e.windowId, title: e.title || '' });
  }
  const out = [];
  for (const g of groups.values()) {
    if (g.tabs.length > 1) out.push({ url: g.url, title: g.title, tabIds: g.tabs.map(t => t.tabId), tabs: g.tabs });
  }
  return out;
}

// The consolidated report as text: counts, one line per tab (title, URL,
// content summary or failure reason), then the confirmed duplicate groups.
function inspectionReportText(report, opts) {
  const o = opts || {};
  const per = Math.max(60, Math.min(2000, parseInt(o.perTabText, 10) || 240));
  const r = report || {};
  const c = r.counts || {};
  const discovered = c.discovered || 0, inspected = c.inspected || 0, failed = c.failed || 0, skipped = c.skipped || 0;
  const head = 'All-tabs inspection — ' + discovered + ' discovered · ' + inspected + ' read · ' +
    failed + ' failed' + (skipped ? ' · ' + skipped + ' skipped' : '') +
    ((c.duplicateGroups || 0) ? ' · ' + c.duplicateGroups + ' duplicate group(s)' : '');
  const tabs = Array.isArray(r.tabs) ? r.tabs : [];
  if (!tabs.length) return head + '\nNo open tabs to inspect.';
  const lines = [head];
  tabs.forEach((t, i) => {
    const idx = t.position || (i + 1);
    const title = t.title || t.url || '(untitled)';
    const url = t.url ? ' — ' + t.url : '';
    if (t.ok) {
      lines.push(idx + '. **' + title + '**' + url + (t.summary ? ' — ' + clean(t.summary, per) : ''));
    } else {
      lines.push(idx + '. **' + title + '**' + url + ' — failed (' + (t.reason || 'read failed') + ')');
    }
  });
  lines.push('');
  if (r.duplicates && r.duplicates.length) {
    lines.push('Confirmed duplicates (same URL):');
    for (const g of r.duplicates) lines.push('- ' + g.url + ' — ' + (g.tabIds || []).join(', '));
  } else {
    lines.push('No duplicate tabs.');
  }
  return lines.join('\n');
}

// adapter = { listTabs(): Promise<tabs>, readTab(tabId, tab): Promise<result> }.
// opts = { maxTabs, includeText, deadlineMs, summaryChars, skipTab(tab),
//          onProgress({i,total,tabId,title,url,status,reason}), now() }.
async function inspectTabs(adapter, opts) {
  const o = opts || {};
  const now = typeof o.now === 'function' ? o.now : Date.now;
  const started = now();
  const totalBudget = Number.isFinite(o.deadlineMs) ? o.deadlineMs : INSPECT_TOTAL_MS;
  const cap = Math.max(1, Math.min(200, parseInt(o.maxTabs, 10) || INSPECT_MAX_TABS));
  const includeText = o.includeText === true;
  let list;
  try { list = await adapter.listTabs(); }
  catch (err) { return { ok: false, error: 'Could not list tabs: ' + String((err && err.message) || err) }; }
  list = Array.isArray(list) ? list : [];
  const entries = [];
  let inspected = 0, failed = 0, skipped = 0;
  for (let i = 0; i < list.length; i++) {
    const tb = list[i] || {};
    const base = {
      position: i + 1,
      tabId: String(tb.tabId || ''),
      windowId: String(tb.windowId || ''),
      title: String(tb.title || ''),
      url: String(tb.url || ''),
    };
    let entry;
    if (i >= cap) {
      skipped++;
      entry = { ...base, ok: false, reason: 'inspection limit reached', error: 'Only the first ' + cap + ' tabs are inspected in one pass.' };
    } else if (now() - started > totalBudget) {
      skipped++;
      entry = { ...base, ok: false, reason: 'inspection took too long', error: 'The all-tabs pass stopped after ' + Math.round(totalBudget / 1000) + 's.' };
    } else if (!TAB_ID_RE.test(base.tabId)) {
      // A listing without a usable id is recorded as a failure; readTab is
      // never called with an undefined or invented id.
      failed++;
      entry = { ...base, ok: false, reason: 'missing tab id', error: 'The tab list entry had no usable id, so it was not read.' };
    } else {
      const skip = typeof o.skipTab === 'function' ? o.skipTab(base, i) : null;
      if (skip) {
        failed++;
        entry = { ...base, ok: false, reason: skip.reason || 'skipped', error: skip.error || '' };
      } else {
        try {
          if (typeof o.onProgress === 'function') {
            try {
              o.onProgress({
                i: i + 1, total: list.length,
                tabId: base.tabId, title: base.title, url: base.url,
                status: 'reading', reason: '',
              });
            } catch {}
          }
          const r = await adapter.readTab(base.tabId, base);
          if (r && r.ok) {
            inspected++;
            entry = {
              ...base,
              ok: true,
              title: String(r.title || base.title || ''),
              url: String(r.url || base.url || ''),
              finalUrl: String(r.finalUrl || r.url || ''),
              description: String(r.description || '').slice(0, 400),
              outline: String(r.outline || '').slice(0, 1500),
              summary: summarizeSnapshot(
                { description: r.description, outline: r.outline, text: r.text },
                { maxText: o.summaryChars || 320 }),
            };
            if (includeText) entry.text = String(r.text || '').slice(0, 12000);
          } else {
            failed++;
            entry = { ...base, ok: false, reason: String((r && r.reason) || 'read failed'), error: String((r && r.error) || '') };
          }
        } catch (err) {
          failed++;
          entry = { ...base, ok: false, reason: 'read failed', error: String((err && err.message) || err) };
        }
      }
    }
    entries.push(entry);
    if (typeof o.onProgress === 'function') {
      try {
        o.onProgress({
          i: i + 1, total: list.length,
          tabId: base.tabId, title: entry.title || base.title, url: entry.url || base.url,
          status: entry.ok ? 'ok' : 'failed',
          reason: entry.ok ? '' : (entry.reason || ''),
        });
      } catch {}
    }
  }
  const duplicates = findDuplicateTabs(entries);
  return {
    ok: true,
    tabs: entries,
    duplicates,
    counts: { discovered: list.length, inspected, failed, skipped, duplicateGroups: duplicates.length },
    at: Date.now(),
  };
}

function newId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// URL identity for comparisons: drop the fragment, normalise case of the
// scheme+host, drop one trailing slash. Query strings are kept — two tabs of
// the same page with different queries are different sources.
function normUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    u.hash = '';
    let out = u.toString();
    if (out.endsWith('/') && u.pathname === '/' && !u.search) out = out.slice(0, -1);
    return out;
  } catch {
    return s.replace(/#.*$/, '');
  }
}

// Search terms from a natural-language query: word-ish tokens, lowercased,
// deduped, common filler dropped so "find the tab about releases" weights
// "releases" and not "the" or "tab".
const STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on',
  'for', 'with', 'about', 'my', 'me', 'i', 'is', 'are', 'was', 'were', 'be',
  'that', 'this', 'it', 'at', 'by', 'from', 'as', 'find', 'tab', 'tabs',
  'page', 'pages', 'open', 'opened', 'show', 'which', 'where', 'what']);
function termsOf(query) {
  const seen = new Set();
  const out = [];
  for (const raw of String(query || '').toLowerCase().split(/[^a-z0-9\u00c0-\u024f_-]+/)) {
    const t = raw.replace(/^[-_]+|[-_]+$/g, '');
    if (t.length < 2 || STOP_WORDS.has(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_QUERY_TERMS) break;
  }
  return out;
}

// One tab against the terms. Title hits weigh double; URL hits single.
// Returns {score, why} — 0 means no match.
function scoreTab(tab, terms) {
  const title = String((tab && tab.title) || '').toLowerCase();
  const url = String((tab && tab.url) || '').toLowerCase();
  let score = 0;
  const titleHits = [], urlHits = [];
  for (const t of terms || []) {
    if (title.includes(t)) { score += 2; titleHits.push(t); }
    if (url.includes(t)) { score += 1; urlHits.push(t); }
  }
  let why = '';
  if (titleHits.length && urlHits.length) why = 'title and URL';
  else if (titleHits.length) why = 'title';
  else if (urlHits.length) why = 'URL';
  return { score, why };
}

// Rank tabs against a query. Returns the matching tabs, best first, capped.
function rankTabs(tabs, query, limit) {
  const terms = termsOf(query);
  const cap = Math.max(1, Math.min(MAX_MATCHES, parseInt(limit, 10) || MAX_MATCHES));
  if (!terms.length) return [];
  const out = [];
  for (const tab of Array.isArray(tabs) ? tabs : []) {
    const { score, why } = scoreTab(tab, terms);
    if (score > 0) out.push({ tab, score, why, terms });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, cap);
}

// Query terms inside a page's text. Returns up to a few snippets around the
// first hits; used by search_tabs content scans and nothing else.
function matchInText(text, terms, opts) {
  const o = opts || {};
  const hay = String(text || '');
  const lower = hay.toLowerCase();
  const hits = [];
  const seenAt = new Set();
  for (const t of terms || []) {
    let at = lower.indexOf(t);
    while (at >= 0 && hits.length < (o.maxHits || 3)) {
      // One snippet per term per nearby cluster.
      const bucket = Math.floor(at / 200);
      if (!seenAt.has(t + ':' + bucket)) {
        seenAt.add(t + ':' + bucket);
        const start = Math.max(0, at - 80);
        const end = Math.min(hay.length, at + t.length + 160);
        hits.push({
          term: t,
          text: clean(hay.slice(start, end), o.snippetChars || MAX_MATCH_SNIPPET),
          at,
        });
      }
      at = lower.indexOf(t, at + t.length);
    }
  }
  return hits.slice(0, o.maxHits || 3);
}

// ---- plans -----------------------------------------------------------------

// Validate + normalise a model-supplied plan. Steps get stable ids (s1..)
// when the model does not supply them; statuses are constrained; dependencies
// must reference other steps in the same plan (pruned, never invented).
function sanitizePlan(input) {
  const p = input && typeof input === 'object' ? input : {};
  const goal = clean(p.goal, MAX_GOAL_CHARS);
  const rawSteps = Array.isArray(p.steps) ? p.steps.slice(0, MAX_PLAN_STEPS) : [];
  if (!goal) return { ok: false, error: 'A plan needs a goal sentence.' };
  if (!rawSteps.length) return { ok: false, error: 'A plan needs at least one step.' };
  const steps = [];
  const ids = new Set();
  for (let i = 0; i < rawSteps.length; i++) {
    const s = rawSteps[i] && typeof rawSteps[i] === 'object' ? rawSteps[i] : {};
    const text = clean(s.text, MAX_STEP_CHARS);
    if (!text) continue;
    let id = clean(s.id, 24) || ('s' + (i + 1));
    if (ids.has(id)) id = 's' + (i + 1) + '-' + Math.random().toString(36).slice(2, 5);
    ids.add(id);
    const status = PLAN_STATUSES.includes(s.status) ? s.status : 'pending';
    const step = { id, text, status, note: clean(s.note, MAX_STEP_CHARS) };
    // Conditional branching: if/else condition evaluated against prior results.
    if (typeof s.condition === 'string' && s.condition.trim()) {
      step.condition = clean(s.condition, MAX_STEP_CHARS);
    }
    // Step grouping: steps sharing a groupId can execute together.
    if (typeof s.groupId === 'string' && s.groupId.trim()) {
      step.groupId = clean(s.groupId, 24);
    }
    // Step timeout: individual step ceiling in milliseconds.
    const timeoutMs = parseInt(s.timeoutMs, 10);
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      step.timeoutMs = Math.min(timeoutMs, 30000);
    }
    // The raw index rides along: steps without text are skipped, so a plain
    // index could not be used to find a step's own `dependsOn` any more (the
    // dependency would land on the wrong step).
    steps.push({ ...step, __raw: i });
  }
  if (!steps.length) return { ok: false, error: 'None of the plan steps had any text.' };
  // Dependencies are an array of step ids that must exist in this plan.
  for (const step of steps) {
    const raw = rawSteps[step.__raw];
    const deps = Array.isArray(raw && raw.dependsOn) ? raw.dependsOn : [];
    const kept = deps.map(d => clean(d, 24)).filter(d => d && d !== step.id && ids.has(d));
    if (kept.length) step.dependsOn = kept.slice(0, 6);
    delete step.__raw;
  }
  return { ok: true, plan: { goal, steps, updatedAt: Date.now() } };
}

// Steps the plan still expects to happen.
function planOpenSteps(plan) {
  const steps = (plan && Array.isArray(plan.steps)) ? plan.steps : [];
  return steps.filter(s => s.status === 'pending' || s.status === 'doing');
}

// One-line progress for the runbar / result text.
function planProgress(plan) {
  const steps = (plan && Array.isArray(plan.steps)) ? plan.steps : [];
  const done = steps.filter(s => s.status === 'done').length;
  return done + '/' + steps.length;
}

// ---- research projects -----------------------------------------------------

// Validate a project draft the model wants to create (user approves it).
function sanitizeProjectDraft(input) {
  const p = input && typeof input === 'object' ? input : {};
  const title = clean(p.title, MAX_PROJECT_TITLE);
  const goal = clean(p.goal, MAX_PROJECT_GOAL);
  if (!title) return { ok: false, error: 'A research project needs a title.' };
  if (!goal) return { ok: false, error: 'A research project needs a goal the user can approve.' };
  return { ok: true, title, goal };
}

function makeProject(draft) {
  const now = Date.now();
  return {
    id: newId('p'),
    title: draft.title,
    goal: draft.goal,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    sources: [],
    findings: [],
    decisions: [],
    questions: [],
  };
}

// Rebuild one stored project into a clean shape; null when unrecoverable so
// one corrupt record can never break the sheet.
function normalizeProject(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = clean(raw.title, MAX_PROJECT_TITLE);
  if (!title) return null;
  const status = raw.status === 'done' ? 'done' : 'active';
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : d);
  const sources = [];
  const seen = new Set();
  for (const s of Array.isArray(raw.sources) ? raw.sources : []) {
    if (!s || typeof s !== 'object') continue;
    const url = String(s.url || '').slice(0, 2048);
    if (!url) continue;
    const key = normUrl(url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    sources.push({ url, title: clean(s.title, 200), at: num(s.at, Date.now()) });
    if (sources.length >= MAX_SOURCES) break;
  }
  const entries = (kind, max, chars) => (Array.isArray(raw[kind]) ? raw[kind] : [])
    .filter(e => e && typeof e === 'object' && clean(e.text, chars))
    .slice(0, max)
    .map(e => {
      const out = { id: String(e.id || newId('e')), text: clean(e.text, chars), at: num(e.at, Date.now()) };
      if (e.url) out.url = String(e.url).slice(0, 2048);
      if (e.quote) out.quote = clean(e.quote, MAX_QUOTE_CHARS);
      return out;
    });
  return {
    id: String(raw.id || newId('p')),
    title,
    goal: clean(raw.goal, MAX_PROJECT_GOAL),
    status,
    createdAt: num(raw.createdAt, Date.now()),
    updatedAt: num(raw.updatedAt, Date.now()),
    sources,
    findings: entries('findings', MAX_FINDINGS, MAX_FINDING_CHARS),
    decisions: entries('decisions', MAX_DECISIONS, MAX_ENTRY_CHARS),
    questions: entries('questions', MAX_QUESTIONS, MAX_ENTRY_CHARS),
  };
}

// Append a source (dedup by normalised URL). Returns a NEW project.
function addSource(project, source) {
  const p = normalizeProject(project) || project;
  const url = String((source && source.url) || '').slice(0, 2048);
  if (!url) return p;
  const key = normUrl(url);
  if (p.sources.some(s => normUrl(s.url) === key)) return p;
  const next = {
    ...p,
    sources: p.sources.concat([{ url, title: clean(source.title, 200), at: Date.now() }]).slice(-MAX_SOURCES),
    updatedAt: Date.now(),
  };
  return next;
}

// Append a finding / decision / open question. Findings carry the source URL
// and optional quote; validation against what the run actually read happens
// in findingCheck() before this is called.
function addEntry(project, kind, entry) {
  const p = normalizeProject(project) || project;
  const e = entry && typeof entry === 'object' ? entry : {};
  const max = kind === 'findings' ? MAX_FINDINGS : kind === 'decisions' ? MAX_DECISIONS : MAX_QUESTIONS;
  const chars = kind === 'findings' ? MAX_FINDING_CHARS : MAX_ENTRY_CHARS;
  const text = clean(e.text, chars);
  if (!text) return { project: p, added: false, error: 'Nothing to save — the text was empty.' };
  const rec = { id: newId('e'), text, at: Date.now() };
  if (e.url) rec.url = String(e.url).slice(0, 2048);
  if (kind === 'findings' && e.quote) rec.quote = clean(e.quote, MAX_QUOTE_CHARS);
  return {
    project: {
      ...p,
      [kind]: p[kind].concat([rec]).slice(-max),
      updatedAt: Date.now(),
    },
    added: true,
    entry: rec,
  };
}

// The anti-fabrication gate: a finding may only cite a page this run read
// (url must match a recorded read page), and a quote, when given, must be
// present in the text captured from that page. Whitespace and case are
// normalised; markdown-ish punctuation is left alone on purpose — a quote
// that does not occur is rejected, not fuzzily accepted.
function normForQuote(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function findingCheck(readPages, input) {
  const url = String((input && input.url) || '').trim();
  const quote = clean(input && input.quote, MAX_QUOTE_CHARS);
  if (!url) return { ok: false, error: 'A finding needs the source URL. Read the page first, then cite it.' };
  const pages = Array.isArray(readPages) ? readPages : [];
  const want = normUrl(url);
  const page = pages.find(p => p && (normUrl(p.url) === want ||
    (p.finalUrl && normUrl(p.finalUrl) === want)));
  if (!page) {
    return {
      ok: false,
      error: 'You have not read that page in this run, so it cannot be cited. Use read_tab (or snapshot for the current tab) first, then save the finding with that URL.',
    };
  }
  if (quote) {
    if (quote.length < MIN_QUOTE_CHARS) {
      return { ok: false, error: 'That quote is too short to check (' + MIN_QUOTE_CHARS + '+ characters). Paraphrase in the finding text instead.' };
    }
    const hay = normForQuote(page.text);
    if (!hay || !hay.includes(normForQuote(quote))) {
      return { ok: false, error: 'That quote does not appear in the text you read from ' + page.url + '. Quote the page exactly, or drop the quote and paraphrase in the finding text.' };
    }
  }
  return { ok: true, page, url: page.url };
}

module.exports = {
  // caps
  MAX_QUERY_TERMS, MAX_PLAN_STEPS, MAX_GOAL_CHARS, MAX_STEP_CHARS,
  MAX_PROJECT_TITLE, MAX_PROJECT_GOAL, MAX_SOURCES, MAX_FINDINGS,
  MAX_DECISIONS, MAX_QUESTIONS, MAX_FINDING_CHARS, MAX_QUOTE_CHARS,
  MAX_ENTRY_CHARS, MIN_QUOTE_CHARS, MAX_MATCH_SNIPPET, MAX_MATCHES,
  MAX_SCAN_TABS, MAX_RUN_NEW_TABS, MAX_RUN_READS, PLAN_STATUSES,
  // helpers
  clean, normUrl, termsOf, scoreTab, rankTabs, matchInText,
  sanitizePlan, planOpenSteps, planProgress,
  sanitizeProjectDraft, makeProject, normalizeProject, addSource, addEntry,
  findingCheck, normForQuote,
  // tab-id validation + refresh hints
  TAB_ID_RE, normalizeTabArgs, compactTabList, withTabRefs,
  // all-tabs inspection workflow (shared: Read button + agent tool)
  INSPECT_MAX_TABS, INSPECT_SETTLE_MS, INSPECT_EXTRACT_MS, INSPECT_TOTAL_MS,
  summarizeSnapshot, findDuplicateTabs, inspectionReportText, inspectTabs,
};
