// AI Search — the engine behind "Search With Dexerion AI", the omnibox Ask
// path and the sidebar's search_web skill.
//
// Pipeline (rework 3.10): plan -> retrieve -> rank -> read -> synthesise.
// The pure stages live in ai-search-plan / -providers / -rank / -read / -synth;
// this file is orchestration with every side effect injected (stream, fetchText,
// openTab/closeTab/readPage, emit, cancel) so it runs under plain node in
// tests. Search-engine pages are never scraped, opened or copied: retrieval is
// structured endpoints only, the denylist runs before opening a page and again
// on the final URL after redirects, and every citation is a page actually read.
'use strict';

const { serialize, deserialize } = require('node:v8');
const planModule = require('./ai-search-plan');
const providers = require('./ai-search-providers');
const rankModule = require('./ai-search-rank');
const readModule = require('./ai-search-read');
const synthModule = require('./ai-search-synth');

// Settings bounds, unchanged for the settings page.
const MIN_SOURCES = 4;
const MAX_SOURCES = 16;
const DEFAULT_SOURCES = 10;
const MIN_ADAPTATIONS = 2;
const MAX_ADAPTATIONS = 8;
const DEFAULT_ADAPTATIONS = 5;
const MAX_RESULT_LINKS = 10;
const FETCH_CONCURRENCY = 4;
const RETRIEVE_BUDGET_MS = 45000;
const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 80;
const MIN_BODY_FOR_ROW_CACHE = 16 * 1024;
const DIFFICULTIES = ['low', 'medium', 'high', 'max'];

function clampInt(value, lo, hi, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function clampSources(value) {
  return clampInt(value, MIN_SOURCES, MAX_SOURCES, DEFAULT_SOURCES);
}

function clampAdaptations(value) {
  return clampInt(value, MIN_ADAPTATIONS, MAX_ADAPTATIONS, DEFAULT_ADAPTATIONS);
}

function createAiSearchRunner(deps) {
  const runs = new Map();
  const fetchCache = new Map(); // url -> { at, ok, finalUrl, contentType, body, providerRows? }

  function emit(run, event) {
    try { deps.emit(run.winId, Object.assign({ reqId: run.reqId }, event)); } catch {}
  }

  function closeRunTabs(run) {
    for (const tabId of run.tabs) {
      try { deps.closeTab(run.winId, tabId); } catch {}
    }
    run.tabs.clear();
  }

  function stop(reqId) {
    const run = runs.get(String(reqId || ''));
    if (!run) return false;
    run.cancelled = true;
    try { deps.cancel(run.planReq); } catch {}
    try { deps.cancel(run.writeReq); } catch {}
    try { run.controller.abort(); } catch {}
    closeRunTabs(run);
    return true;
  }

  function releaseWindow(winId) {
    for (const run of runs.values()) {
      if (run.winId === winId) stop(run.reqId);
    }
  }

  function statsOf(run, sources, searches, unread, mode) {
    return {
      sources,
      searches,
      unread,
      mode,
      ms: Date.now() - run.startedAt,
    };
  }

  function lightSources(sources) {
    return (Array.isArray(sources) ? sources : []).map((s) => ({ title: s.title, url: s.url, date: s.date || '' }));
  }

  // One small in-memory cache so re-running a question does not re-fetch the
  // providers (and a quick follow-up is instant).
  async function fetchCached(url, signal) {
    const now = Date.now();
    const hit = fetchCache.get(url);
    if (hit && now - hit.at < CACHE_TTL_MS) return hit;
    if (fetchCache.size >= MAX_CACHE_ENTRIES) fetchCache.clear();
    const res = (await deps.fetchText(url, { signal, timeoutMs: readModule.FETCH_TIMEOUT_MS })) || {};
    const entry = {
      at: now,
      ok: res.ok !== false,
      finalUrl: String(res.url || url),
      contentType: String(res.contentType || ''),
      body: String(res.text || ''),
    };
    if (entry.ok && entry.body) fetchCache.set(url, entry);
    return entry;
  }

  // Provider responses can be much larger than the handful of extracted
  // rows, including XML markup and unconsumed JSON metadata. A serialized
  // snapshot also releases substrings that would retain the response.
  // Normalize fresh rows on every hit, including dates relative to local time.
  // PubMed's e-search response is not a row cache; only its summary is.
  function cachedProviderRows(provider, entry) {
    if (entry.providerRows) return providers.normalizeProviderRows(provider, deserialize(entry.providerRows));
    const rawRows = providers.parseProviderRows(provider, entry.body);
    const rows = providers.normalizeProviderRows(provider, rawRows);
    if (entry.body.length < MIN_BODY_FOR_ROW_CACHE) return rows;
    try {
      // normalizeProviderRows never sees rows beyond max+2; a large or
      // nonconforming response must not grow the snapshot with unused rows.
      const limit = provider.max + 2;
      const packed = serialize(rawRows.length > limit ? rawRows.slice(0, limit) : rawRows);
      if (packed.length < entry.body.length / 2) {
        entry.providerRows = packed;
        entry.body = '';
      }
    } catch {}
    return rows;
  }

  async function planStep(run, query, count, history, streamOpts) {
    emit(run, { phase: 'adapt', label: 'Adapting your question', i: 0, n: 1 });
    run.planReq = run.reqId + ':plan';
    let text = '';
    try {
      const planned = await deps.stream(run.planReq, planModule.planMessages(query, count, history), () => {}, streamOpts || {});
      text = String((planned && planned.text) || '');
    } catch (err) {
      if (run.cancelled) return null;
      text = '';
    }
    const queries = planModule.parsePlan(text, count, query);
    emit(run, { phase: 'adapted', adaptations: queries.map((entry) => entry.q), label: queries.length + ' searches' });
    return queries;
  }

  // Bounded-concurrency retrieval across the structured provider requests.
  async function retrieveStep(run, query, queries, mode) {
    const requests = providers.providerRequests(queries, {
      web: providers.WEB_PROVIDERS,
      source: providers.wantsSourceApis(query),
      sourceQueryCap: mode === 'quick' ? 1 : 2,
    });
    const total = requests.length;
    const deadline = run.startedAt + RETRIEVE_BUDGET_MS;
    const results = [];
    let done = 0;
    const worker = async () => {
      for (;;) {
        if (run.cancelled || Date.now() > deadline) return;
        const req = requests.shift();
        if (!req) return;
        done += 1;
        const provider = providers.PROVIDERS[req.provider];
        emit(run, {
          phase: 'search',
          i: done,
          n: total,
          label: 'Searching ' + (provider ? provider.label : req.provider),
          query: req.query,
        });
        try {
          // Provider endpoints are search hosts by design: only the network
          // safety half applies here. Result URLs face the denylist at rank
          // and again through acceptRead after redirects.
          const pre = readModule.checkFetchUrl(req.url);
          if (!pre.ok) continue;
          const first = await fetchCached(req.url, run.controller.signal);
          if (!first.ok || (!first.body && !first.providerRows)) continue;
          let rows = [];
          if (req.provider === 'pubmed') {
            const ids = providers.PROVIDERS.pubmed.parseIds(first.body);
            if (!ids.length) continue;
            const second = await fetchCached(providers.PROVIDERS.pubmed.secondUrl(ids.slice(0, MAX_RESULT_LINKS)), run.controller.signal);
            if (!second.ok || (!second.body && !second.providerRows)) continue;
            rows = cachedProviderRows(provider, second);
          } else {
            rows = cachedProviderRows(provider, first);
          }
          for (const row of rows.slice(0, MAX_RESULT_LINKS)) results.push(row);
        } catch {
          // One provider down never fails the search; its pages are simply not
          // in the candidate pool and the answer says what it could not cover.
        }
      }
    };
    await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));
    return { results, searched: total };
  }

  // Reads the chosen pages in background tabs through the shared page reader.
  // The denylist runs before opening and again through acceptRead on the final
  // URL, so a redirect onto an engine/consent page is discarded, never cited.
  async function readStep(run, queries, ranked, budget) {
    const picks = rankModule.pickForReading(ranked, { max: budget });
    const siteAllow = rankModule.siteAllowFrom(queries.map((entry) => entry.q));
    const deadline = run.startedAt + RETRIEVE_BUDGET_MS;
    const sources = [];
    const unread = [];
    for (let i = 0; i < picks.length; i++) {
      if (run.cancelled || Date.now() > deadline) break;
      const candidate = picks[i];
      emit(run, {
        phase: 'read',
        i: sources.length + 1,
        n: picks.length,
        label: 'Reading ' + (sources.length + 1) + ' of ' + picks.length,
        host: candidate.host,
      });
      const pre = readModule.checkReadUrl(candidate.url, siteAllow);
      if (!pre.ok) {
        unread.push({ url: candidate.url, reason: pre.error });
        continue;
      }
      let tabId = null;
      try {
        tabId = deps.openTab(run.winId, candidate.url);
        run.tabs.add(tabId);
        const page = await deps.readPage(run.winId, tabId);
        const outcome = readModule.acceptRead(page, candidate, siteAllow);
        if (outcome.ok) sources.push(outcome.source);
        else unread.push({ url: candidate.url, reason: outcome.reason });
      } catch (err) {
        unread.push({ url: candidate.url, reason: String((err && err.message) || err) });
      } finally {
        if (tabId) {
          run.tabs.delete(tabId);
          try { deps.closeTab(run.winId, tabId); } catch {}
        }
      }
    }
    return { sources, unread };
  }

  // The shared execute: everything up to and including the reads. With
  // `synthesize` the answer is streamed on the same run; without it the
  // caller (the chat-side search_web executor) gets the numbered material.
  async function execute(opts, synthesize) {
    const reqId = String(opts.reqId || ('ais' + Date.now())).slice(0, 80);
    if (runs.has(reqId)) return { ok: false, error: 'That search is already running.' };
    const query = planModule.cleanQuery(opts.query);
    if (!query) return { ok: false, error: 'Type a question first.' };
    const mode = opts.mode === 'quick' ? 'quick' : 'deep';
    // The person's "question adaptations" setting is the number of searches
    // the planner writes. It used to be passed in but silently ignored, so
    // changing the setting changed nothing. Prefer an explicit planCount (the
    // chat-side search_web caller uses it), otherwise honour adaptations.
    const wanted = opts.planCount != null ? opts.planCount : opts.adaptations;
    const count = planModule.clampPlanCount(wanted, mode);
    const history = Array.isArray(opts.history) ? opts.history : [];
    // The difficulty chip's tier rides every model call this run makes; the
    // scout's pick for that tier is what ai.stream actually resolves.
    const difficulty = DIFFICULTIES.includes(opts.difficulty) ? opts.difficulty : '';
    const streamOpts = difficulty ? { difficulty } : {};
    const run = {
      reqId,
      winId: opts.winId,
      cancelled: false,
      tabs: new Set(),
      planReq: '',
      writeReq: '',
      startedAt: Date.now(),
      controller: new AbortController(),
    };
    runs.set(reqId, run);

    const base = (extra) => Object.assign({
      ok: true,
      reqId,
      query,
      mode,
      cancelled: run.cancelled,
    }, extra);

    try {
      const queries = await planStep(run, query, count, history, streamOpts);
      if (!queries || run.cancelled) {
        return base({ text: '', sources: [], adaptations: [], unread: [], stats: statsOf(run, 0, 0, 0, mode) });
      }
      const queryTexts = queries.map((entry) => entry.q);
      const { results, searched } = await retrieveStep(run, query, queries, mode);
      const ranked = rankModule.rankResults(results, {
        queries: queryTexts,
        now: Date.now(),
        siteAllow: rankModule.siteAllowFrom(queries),
      });
      const { sources, unread } = await readStep(run, queries, ranked, readModule.readBudget(mode, opts.sources));

      if (!synthesize) {
        return base({
          queries: queryTexts,
          sources,
          unread,
          stats: statsOf(run, sources.length, searched, unread.length, mode),
        });
      }

      emit(run, {
        phase: 'write',
        label: sources.length ? 'Writing the answer' : 'No readable sources — writing a limits answer',
        i: sources.length,
        n: Math.max(1, sources.length),
      });
      run.writeReq = reqId + ':write';
      let streamed = '';
      try {
        const written = await deps.stream(
          run.writeReq,
          synthModule.synthMessages(query, sources, { history, queries: queryTexts, unread: unread.length }),
          (delta, full) => {
            streamed = String(full != null ? full : streamed + String(delta || ''));
            emit(run, { phase: 'chunk', delta: String(delta || ''), full: streamed });
          },
          streamOpts
        );
        if (written && written.text) streamed = String(written.text);
      } catch (err) {
        if (!run.cancelled && !streamed) {
          return {
            ok: false,
            reqId,
            error: String((err && err.message) || err || 'The answer could not be written.'),
            sources: lightSources(sources),
            adaptations: queryTexts,
            stats: statsOf(run, sources.length, searched, unread.length, mode),
          };
        }
      }
      emit(run, { phase: 'done', label: 'Done', stats: statsOf(run, sources.length, searched, unread.length, mode) });
      return base({
        text: streamed,
        sources: lightSources(sources),
        adaptations: queryTexts,
        queries: queryTexts,
        unread,
        stats: statsOf(run, sources.length, searched, unread.length, mode),
      });
    } finally {
      closeRunTabs(run);
      runs.delete(reqId);
    }
  }

  // Full pipeline with the grounded synthesis (search surface + omnibox).
  function run(options) {
    return execute(options || {}, true);
  }

  // Retrieval + reads only, with the numbered material for the caller.
  function gather(options) {
    return execute(options || {}, false);
  }

  return { run, gather, stop, releaseWindow };
}

module.exports = {
  MIN_SOURCES, MAX_SOURCES, DEFAULT_SOURCES,
  MIN_ADAPTATIONS, MAX_ADAPTATIONS, DEFAULT_ADAPTATIONS,
  FETCH_CONCURRENCY, RETRIEVE_BUDGET_MS, CACHE_TTL_MS,
  clampSources, clampAdaptations,
  createAiSearchRunner,
};
