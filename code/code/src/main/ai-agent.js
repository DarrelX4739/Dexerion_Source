// Dexerion agent runner — the scAI agent loop (sidebar runAgentLoop/runAction)
// re-homed to the main process, because the NIM key and the tab both live
// here. The sidebar renders the trace and answers confirmations; it never
// sees the key or drives the loop.
//
// Stopping mirrors scAI's three layers:
//   1. Cooperative — stopRun() sets halted; checked before every model call
//      and before and after every action. A parked tier-3 confirmation
//      resolves false so the loop can never wait forever.
//   2. Dead-man — the browser calls tabClosed()/windowClosed(); a run whose
//      tab or window is gone halts unconditionally. While a run is paused
//      the same check keeps running, so a frozen panel still ends it.
//   3. Lease — the sidebar pings every second during a run; dispatch refuses
//      a run whose lease is stale (frozen renderer).
// On top: a hard step ceiling, a repeat detector, per-run read/open budgets
// for browser-wide work, plan-aware completion (done is verified against the
// plan's open steps), and a single retry for transient provider outages.
//
// Deps (wired by src/main/browser.js, which owns windows/tabs/IPC):
//   streamTurn(reqId, wireMessages, opts, onText) -> turn {text, toolCalls}
//   dispatch(run, action, args, refs) -> result object (page/tab action)
//   askUser(run, what, why) -> Promise<boolean> (sidebar confirmation)
//   emit(run, event) — step/runbar/ask/plan/end pushes to the sidebar
'use strict';
const aiTools = require('./ai-tools');
const research = require('./ai-research');
const aiArtifacts = require('./ai-artifacts');

const LEASE_MS = 3500;
// How long an agent confirmation may sit unanswered before the run gives up on
// it (the skill queue uses the same two minutes).
const ASK_TIMEOUT_MS = 120000;
// A model that answers with prose and no tool call must not loop forever: the
// step ceiling only counts real actions, so the loop itself is capped too.
const LOOP_MULTIPLIER = 3;
const LOOP_FLOOR = 12;
// A run may ask the person at most this many clarifying questions.
const MAX_USER_ASKS = 3;
// The same call failing this many times ends the run with a clear explanation
// (counted across the whole run, even when other calls are interleaved).
const FAILED_CALL_LIMIT = 2;

// Pure: pull a dex-artifact block out of a run's final text. Exported so the
// rule (what becomes a card, what stays prose) is testable on its own.
function deliverableFrom(value, opts) {
  const text = String(value || '');
  if (!text) return { text };
  const parsed = aiArtifacts.parseArtifactBlock(text, { wantsArtifact: Boolean(opts && opts.wantsArtifact) });
  if (!parsed.found) return { text };
  if (parsed.artifact) {
    return { text: parsed.text, artifact: parsed.artifact, warnings: parsed.warnings || [] };
  }
  const cleaned = String(parsed.text || text).trim();
  return {
    text: (cleaned ? cleaned + '\n\n' : '') + 'The deliverable could not be used: ' + parsed.error,
    artifactError: parsed.error,
  };
}

function createAgentRunner(deps) {
  const runs = new Map(); // runId -> run
  let seq = 0;

  function getRun(runId) {
    return runs.get(String(runId || '')) || null;
  }

  function checkHalt(run) {
    if (!run) return 'no such run';
    if (run.halted) return run.haltReason || 'stopped';
    if (run.done) return 'finished';
    return null;
  }

  function checkLease(run) {
    if (Date.now() - (run.lease || 0) > LEASE_MS) {
      run.halted = true;
      run.haltReason = 'the panel stopped responding, so the run was ended';
      return run.haltReason;
    }
    return null;
  }

  function ping(runId) {
    const run = getRun(runId);
    if (run && !run.done) run.lease = Date.now();
    return Boolean(run);
  }

  function halt(run, reason) {
    if (!run || run.halted) return;
    run.halted = true;
    run.haltReason = reason || 'stopped';
    if (run.pendingAsk) {
      const ask = run.pendingAsk;
      run.pendingAsk = null;
      try { ask.resolve(false); } catch {}
    }
    try { deps.emit(run, { type: 'runbar', label: 'Stopping…', halted: true }); } catch {}
  }

  function stopRun(runId, reason) {
    const run = getRun(runId);
    if (!run) return false;
    halt(run, reason || 'stopped');
    try { deps.onStop(run); } catch {}
    return true;
  }

  function tabClosed(tabId) {
    for (const run of runs.values()) {
      if (!run.done && run.tabId === tabId) {
        halt(run, 'the tab is gone');
        try { deps.onStop(run); } catch {}
      }
    }
  }

  function windowClosed(winId) {
    for (const run of runs.values()) {
      if (!run.done && (run.winId === winId || run.actWinId === winId)) {
        halt(run, 'the window closed');
        try { deps.onStop(run); } catch {}
      }
    }
  }

  // The answer is whatever the host sent: a boolean for a confirmation, a string
  // for the ask_user question. Coercing here turned every typed answer into
  // `true`, so the model was told "yes" instead of what the person wrote.
  function answerAsk(runId, askId, ok) {
    const run = getRun(runId);
    if (!run || !run.pendingAsk || run.pendingAsk.id !== askId) return false;
    const ask = run.pendingAsk;
    const value = typeof ok === 'string' ? ok : Boolean(ok);
    run.pendingAsk = null;
    try { ask.resolve(value); } catch {}
    return true;
  }

  // ---------- pause / resume --------------------------------------------------
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // Park the loop while paused. The lease is still enforced (a frozen panel
  // ends the run), and a stop during a pause halts immediately: the poll
  // exits on halt/done/lease, and the caller's halt check does the rest.
  async function waitIfPaused(run) {
    while (run && run.paused && !run.halted && !run.done) {
      if (checkLease(run)) return;
      await sleep(250);
    }
  }

  function setPaused(runId, paused) {
    const run = getRun(runId);
    if (!run || run.done || run.halted) return false;
    const next = Boolean(paused);
    if (run.paused === next) return true;
    run.paused = next;
    run.pausedAt = next ? Date.now() : 0;
    try { deps.emit(run, { type: 'runbar', label: next ? 'Paused' : 'Working…', paused: next }); } catch {}
    return true;
  }

  // ---------- run budgets + read recording (browser-wide work) ----------------
  const BUDGETS = {
    open_tab: { field: 'newTabs', max: aiTools.MAX_RUN_NEW_TABS, what: 'new tabs' },
    read_tab: { field: 'reads', max: aiTools.MAX_RUN_READS, what: 'page reads' },
    // A fan-out charges one read per tab that actually landed.
    read_tabs: { field: 'reads', max: aiTools.MAX_RUN_READS, what: 'page reads' },
    search_tabs: { field: 'reads', max: aiTools.MAX_RUN_READS, what: 'page reads' },
    // A full sweep is cheap to ask for and expensive to run: cap it per run.
    inspect_tabs: { field: 'inspections', max: 2, what: 'all-tabs inspections' },
  };

  // Parallel multi-tab read. The tabs go out together (one round trip) and come
  // back condensed per tab, so a five-source question costs one step instead of
  // five. Every tab that really landed counts against the run's read budget —
  // the budget is charged up front so a hostile loop cannot fan out for free.
  const MAX_FANOUT = 6;

  async function fanOutReads(run, args, budget) {
    const a = args || {};
    const ids = (Array.isArray(a.tabIds) ? a.tabIds : []).map(String).filter(Boolean).slice(0, MAX_FANOUT);
    const unique = [...new Set(ids)];
    if (unique.length < 2) {
      return { ok: false, error: 'read_tabs needs 2-6 distinct tab ids. For one tab use read_tab.' };
    }
    const maxChars = Math.max(500, Math.min(12000, Number(a.maxChars) || 4000));
    if (budget && run[budget.field] + unique.length > budget.max) {
      const left = Math.max(0, budget.max - run[budget.field]);
      return {
        ok: false,
        error: 'Budget reached: this run has ' + left + ' of ' + budget.max + ' page reads left, so ' +
          unique.length + ' tabs cannot be read. Use the pages you already have or call done.',
      };
    }
    const settled = await Promise.all(unique.map((tabId) => Promise.resolve()
      .then(() => deps.dispatch(run, 'read_tab', { tabId }, run.refs))
      .then((res) => ({ tabId, res: res || { ok: false, error: 'no result' } }))
      .catch((err) => ({ tabId, res: { ok: false, error: String((err && err.message) || err) } }))));
    let read = 0;
    const tabs = [];
    for (const { tabId, res } of settled) {
      if (res && res.ok !== false) {
        read += 1;
        if (budget) run[budget.field] += 1;
        recordRead(run, res);
        tabs.push({
          tabId,
          ok: true,
          title: String(res.title || '').slice(0, 200),
          url: String(res.url || ''),
          text: String(res.text || '').slice(0, maxChars),
          chars: String(res.text || '').length,
        });
      } else {
        tabs.push({ tabId, ok: false, error: String((res && res.error) || 'could not be read') });
      }
    }
    return { ok: read > 0, tabs, read, failed: unique.length - read };
  }

  // Hand the browser back tidy: close only the tabs this run opened itself.
  async function closeOpenedTabs(run) {
    const opened = (run.openedTabs || []).slice();
    if (!opened.length) return { ok: true, closed: 0, note: 'This run did not open any tabs.' };
    let closed = 0;
    const failed = [];
    for (const tabId of opened) {
      try {
        const res = await deps.dispatch(run, 'close_tab', { tabId }, run.refs);
        if (res && res.ok !== false) closed += 1;
        else failed.push(tabId);
      } catch { failed.push(tabId); }
    }
    run.openedTabs = failed;
    return { ok: true, closed, failed };
  }

  // A free-text question to the person, parked under the same ceiling and lease
  // watch as a confirmation. Resolves { ok, text, reason }.
  async function askUserText(run, question, opts) {
    const o = opts || {};
    const answer = Promise.resolve()
      .then(() => deps.askUser(run, question, o.why || 'The task needs an answer to continue.',
        { input: true, placeholder: o.placeholder }))
      .then((value) => (typeof value === 'string' ? value : value === true ? 'yes' : ''))
      .catch(() => '');
    let answerTimeout = null;
    const configured = Number(run.settings && run.settings.askTimeoutMs);
    const waitMs = Number.isFinite(configured) && configured > 0
      ? Math.max(200, Math.min(ASK_TIMEOUT_MS, configured))
      : ASK_TIMEOUT_MS;
    const timeout = new Promise((resolve) => {
      answerTimeout = setTimeout(() => resolve('__timeout__'), waitMs);
    });
    const watch = (async () => {
      for (;;) {
        await sleep(500);
        if (run.halted || run.done) return '__halted__';
        if (Date.now() - (run.lease || 0) > LEASE_MS) return '__lease__';
      }
    })();
    const winner = await Promise.race([answer, timeout, watch]);
    clearTimeout(answerTimeout);
    if (winner === '__timeout__' || winner === '__halted__' || winner === '__lease__') {
      if (run.pendingAsk) {
        const ask = run.pendingAsk;
        run.pendingAsk = null;
        try { ask.resolve(false); } catch {}
      }
      if (winner === '__lease__') halt(run, 'the panel stopped responding, so the run was ended');
      try { deps.emit(run, { type: 'runbar', label: winner === '__timeout__' ? 'Timed out waiting for you' : 'Stopping…' }); } catch {}
      return { ok: false, text: '', reason: winner.replace(/__/g, '') };
    }
    return { ok: Boolean(String(winner).trim()), text: String(winner).trim(), reason: 'answered' };
  }

  // A parked confirmation must not park forever. The renderer may be gone
  // (closed panel, crashed renderer) or the person may simply walk away, so an
  // agent approval has a ceiling and its own lease/dead-man watch — the loop's
  // boundary checks never run while it is parked.
  async function askWithLimits(run, what, why) {
    const answer = Promise.resolve()
      .then(() => deps.askUser(run, what, why))
      .then((ok) => (ok ? 'yes' : 'no'))
      .catch(() => 'no');
    const configured = Number(run.settings && run.settings.askTimeoutMs);
    const waitMs = Number.isFinite(configured) && configured > 0
      ? Math.max(200, Math.min(ASK_TIMEOUT_MS, configured))
      : ASK_TIMEOUT_MS;
    let answerTimeout = null;
    const timeout = new Promise((resolve) => {
      answerTimeout = setTimeout(() => resolve('timeout'), waitMs);
    });
    const watch = (async () => {
      for (;;) {
        await sleep(500);
        if (run.halted || run.done) return 'halted';
        if (Date.now() - (run.lease || 0) > LEASE_MS) return 'lease';
      }
    })();
    const winner = await Promise.race([answer, timeout, watch]);
    clearTimeout(answerTimeout);
    if (winner !== 'yes' && winner !== 'no') {
      // Take the card down and never leave a resolver dangling.
      if (run.pendingAsk) {
        const ask = run.pendingAsk;
        run.pendingAsk = null;
        try { ask.resolve(false); } catch {}
      }
      if (winner === 'lease') halt(run, 'the panel stopped responding, so the run was ended');
      try { deps.emit(run, { type: 'runbar', label: winner === 'timeout' ? 'Timed out waiting for you' : 'Stopping…' }); } catch {}
      return { ok: false, reason: winner };
    }
    return { ok: winner === 'yes', reason: winner };
  }

  function usesRefs(name, args) {
    const a = args || {};
    if (a.ref != null) return true;
    if (name === 'fill_form' && Array.isArray(a.fields)) {
      return a.fields.some(f => f && f.ref != null);
    }
    return false;
  }

  // Canonical key for one tool call, order-insensitive at the top level, so
  // the failure ledger cannot be evaded by re-emitting the same arguments in
  // a different order.
  function callKey(name, input) {
    const src = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
    const parts = Object.keys(src).sort().map(k => k + '=' + JSON.stringify(src[k]));
    return name + '|' + parts.join('&');
  }

  // Pages this run actually read, for citation checks (note_finding) and for
  // grounding: newest 12, text capped so a long run cannot balloon memory.
  function recordRead(run, page) {
    const url = String((page && page.url) || '');
    if (!url) return;
    run.readPages.push({
      url,
      finalUrl: String((page && page.finalUrl) || ''),
      title: String((page && page.title) || '').slice(0, 200),
      text: String((page && page.text) || '').slice(0, 20000),
      at: Date.now(),
    });
    if (run.readPages.length > 12) run.readPages.shift();
  }

  // ---------- provider resilience --------------------------------------------
  // A transient failure is one worth one silent retry: network-level errors
  // (no HTTP status) and 5xx. 4xx (bad key, rate limit, bad request) is not.
  function transientError(err) {
    if (!err) return false;
    const s = err.nimStatus;
    if (s === undefined || s === null) return true;
    return s >= 500;
  }

  async function streamTurnWithRetry(run, tools) {
    for (let attempt = 0; ; attempt++) {
      // A failed attempt may already have streamed partial text into the
      // transcript; the retry must not leave that fragment behind.
      const mark = run.transcript.length;
      try {
        // Transcript accumulates across turns (scAI placeholder behavior);
        // `full` forwarded per chunk is the running total, matching the
        // dex:ai-chunk consumer.
        return await deps.streamTurn(run.loopReqId, wireMessages(run), {
          memory: run.memory,
          tools,
          systemSuffix: aiTools.AGENT_PROMPT,
        }, (delta) => {
          run.transcript += delta;
          try { deps.onText(run, delta, run.transcript); } catch {}
        });
      } catch (err) {
        if (attempt >= 1 || run.halted || (err && err.aborted) || !transientError(err)) throw err;
        run.transcript = run.transcript.slice(0, mark);
        await sleep(700);
        if (run.halted) throw err;
      }
    }
  }

  // Whatever goes back to the model is text, kept small and framed as data.
  function nodeLine(nd) {
    const bits = ['#' + nd.ref, nd.kind];
    if (nd.text) bits.push('"' + nd.text + '"');
    if (nd.value) bits.push('value=' + JSON.stringify(nd.value));
    if (nd.options) bits.push('options=' + JSON.stringify(nd.options.slice(0, 12)));
    if (nd.href) bits.push('→ ' + nd.href);
    if (nd.offscreen) bits.push('(off-screen)');
    if (nd.danger) bits.push('(needs confirmation: ' + nd.danger + ')');
    return bits.join(' ');
  }

  function formatResult(name, res) {
    const cap = aiTools.MAX_TOOL_RESULT;
    if (!res) return 'No result.';
    if (res.ok === false) {
      return 'FAILED: ' + (res.error || 'unknown error') +
        (res.options ? '\nAvailable options: ' + JSON.stringify(res.options) : '');
    }
    if (name === 'snapshot') {
      const sc = res.scroll || {};
      const lines = [
        'url: ' + res.url,
        'title: ' + res.title,
        'scroll: ' + (sc.y || 0) + ' of ' + (sc.height || 0) +
          ' (viewport ' + (sc.viewport || 0) + ')' + (sc.atBottom ? ' — at the bottom' : ''),
        '',
      ];
      if (res.selection) lines.push('user selection: ' + res.selection, '');
      lines.push('elements you can act on (' + res.nodes.length + '):');
      for (const nd of res.nodes) lines.push('  ' + nodeLine(nd));
      lines.push('', '<page_data>', String(res.text || '').slice(0, cap), '</page_data>');
      return lines.join('\n');
    }
    if (name === 'find_text') {
      if (!res.matches) return 'No matches for "' + res.query + '".';
      return res.matches + ' match(es):\n<page_data>\n' +
        res.hits.map((h, i) => (i + 1) + '. ' + h.text +
          (h.inClickable ? '  [inside "' + h.inClickable + '"]' : '') +
          (h.onScreen ? '' : '  (off-screen)')).join('\n') +
        '\n</page_data>';
    }
    if (name === 'read_tab') {
      return 'tab ' + res.tabId + ' — ' + res.title + '\n' + res.url +
        '\n<page_data>\n' + String(res.text || '').slice(0, cap) + '\n</page_data>';
    }
    if (name === 'read_tabs') {
      const lines = [res.read + ' of ' + (res.tabs || []).length + ' tab(s) read:'];
      for (const t of res.tabs || []) {
        if (!t.ok) { lines.push('- ' + t.tabId + ' FAILED: ' + t.error); continue; }
        lines.push('', 'tab ' + t.tabId + ' — ' + t.title, t.url,
          '<page_data>', String(t.text || '').slice(0, cap), '</page_data>',
          t.chars > cap ? '(' + (t.chars - cap) + ' more characters not shown)' : '');
      }
      return lines.join('\n').trim();
    }
    if (name === 'close_opened_tabs') {
      if (!res.closed) return res.note || 'Nothing to close.';
      return 'Closed ' + res.closed + ' tab(s) this run opened' +
        ((res.failed || []).length ? '; ' + res.failed.length + ' could not be closed.' : '.');
    }
    if (name === 'list_tabs') {
      return (res.tabs || []).map(t => t.tabId + (t.active ? ' (active)' : '') + ' ' +
        t.title + ' — ' + t.url +
        (t.windowId ? ' [window ' + t.windowId + ']' : '') +
        (t.readable ? '' : ' (not readable)') +
        (t.asleep ? ' (asleep)' : t.loading ? ' (loading)' : '')).join('\n');
    }
    if (name === 'search_tabs') {
      const lines = [(res.matches || []).length + ' match(es) for "' + res.query + '":'];
      for (const m of res.matches || []) {
        lines.push('- ' + m.tabId + (m.active ? ' (active)' : '') +
          (m.windowId ? ' [window ' + m.windowId + ']' : '') + ' ' +
          (m.title || '(untitled)') + ' — ' + m.url +
          (m.why ? '  [' + m.why + ']' : '') +
          (m.asleep ? '  (asleep)' : m.loading ? '  (loading)' : ''));
      }
      const withSnippets = (res.matches || []).filter(m => m.snippet);
      if (withSnippets.length) {
        lines.push('', '<page_data>');
        for (const m of withSnippets) lines.push('[' + m.tabId + '] …' + m.snippet + '…');
        lines.push('</page_data>');
      }
      if (res.skipped && res.skipped.length) {
        lines.push('Skipped: ' + res.skipped.map(s => s.tabId + ' (' + s.reason + ')').join(', '));
      }
      lines.push('Use read_tab with a tab id to read a page in full.');
      return lines.join('\n');
    }
    if (name === 'open_project') {
      const p = res.project || {};
      return 'Research project "' + p.title + '" is open (' + p.id + '). Findings, decisions and open ' +
        'questions you file with note_finding are saved under it for the user.';
    }
    if (name === 'inspect_tabs') {
      const text = research.inspectionReportText(res.report || {}, { perTabText: 90 });
      return text.length > cap
        ? text.slice(0, cap) + '\n…(report truncated — use list_tabs for the rest, or read_tab a specific id in full)'
        : text;
    }
    if (name === 'note_finding') {
      return (res.note || 'Saved.') + (res.project ? ' Project: "' + res.project.title + '".' : '');
    }
    if (name === 'update_plan') return res.note || 'Plan updated.';
    if (name === 'screenshot') return 'Screenshot attached.';
    if (name === 'get_page_data') {
      const d = res.data || {};
      const lines = ['Page data from ' + res.url + ' — ' + res.title + ' (kind: ' + res.kind + '):'];
      if (d.tables) {
        lines.push('Tables (' + d.tables.length + '):');
        for (const t of d.tables) {
          lines.push('  "' + t.caption + '": ' + t.rows.length + ' row(s) x ' +
            (t.rows[0] ? t.rows[0].length : 0) + ' col(s)');
        }
      }
      if (d.links) lines.push('Links (' + d.links.length + '): ' +
        d.links.map(l => l.text ? l.text + ' → ' + l.url : l.url).slice(0, 10).join('; '));
      if (d.forms) lines.push('Forms (' + d.forms.length + '): ' +
        d.forms.map(f => f.fields.length + ' field(s)').join('; '));
      if (d.headings) lines.push('Headings (' + d.headings.length + '): ' +
        d.headings.map(h => 'h' + h.level + ' ' + h.text).slice(0, 8).join('; '));
      return lines.join('\n');
    }
    const copy = Object.assign({}, res);
    delete copy.refs;
    delete copy.image;
    const text = JSON.stringify(copy);
    return text.length > cap ? text.slice(0, cap) + '…' : text;
  }

  function wireMessages(run) {
    // Chat history (user/model text turns) first, then the live agent turns.
    const out = [];
    for (const m of run.history) {
      if (!m) continue;
      if (m.role === 'user') out.push({ role: 'user', text: m.text || '' });
      else if (m.role === 'model' && m.text) out.push({ role: 'assistant', text: m.text });
    }
    for (const t of run.turns) out.push(t);
    return out.slice(-80);
  }

  function pushAssistant(run, text, calls) {
    run.turns.push({ role: 'assistant', text: text || '', toolCalls: calls || [] });
  }

  function pushResults(run, results) {
    run.turns.push({ role: 'tool', results });
  }

  // ---------- agentic enhancements: timing, caching, chaining, confidence ---
  // Start a timer for a step (called before dispatch).
  function startStepTimer(run, stepId, name) {
    run.stepTimers.set(stepId, { startedAt: Date.now(), name });
  }

  // End a timer and record a metric (called after dispatch).
  function endStepTimer(run, stepId, status, detail, approach) {
    const timer = run.stepTimers.get(stepId);
    const endedAt = Date.now();
    const startedAt = timer ? timer.startedAt : endedAt;
    const name = timer ? timer.name : '';
    run.stepTimers.delete(stepId);
    // The trace shows how long each action took, so a slow run has a visible
    // reason instead of a spinner.
    const step = run.steps.find((s) => s.id === stepId);
    if (step) step.ms = endedAt - startedAt;
    stepMetric(run, stepId, name, status, startedAt, endedAt, detail, approach);
  }

  function stepMetric(run, stepId, name, status, startedAt, endedAt, detail, approach) {
    const duration = endedAt - startedAt;
    run.stepMetrics.push({
      stepId, name, status, startedAt, endedAt, durationMs: duration,
      detail: detail || '', approach: approach || 1,
    });
    recalculateConfidence(run);
  }

  // Recompute the agent's confidence in plan execution from step outcomes.
  function recalculateConfidence(run) {
    const metrics = run.stepMetrics || [];
    if (!metrics.length) { run.confidence = 1.0; return; }
    const ok = metrics.filter(m => m.status === 'ok').length;
    const total = metrics.length;
    let confidence = total ? ok / total : 1.0;
    // Penalty for steps that needed multiple approaches (self-correction).
    const multiApproach = metrics.filter(m => (m.approach || 1) > 1).length;
    confidence *= Math.max(0.5, 1.0 - multiApproach * 0.1);
    // Open plan steps lower confidence.
    if (run.plan) {
      const open = research.planOpenSteps(run.plan);
      if (open.length) confidence *= 0.9;
    }
    // Very long runs are less certain.
    if (total > 10) confidence *= 0.95;
    run.confidence = Math.max(0, Math.min(1, confidence));
  }

  // Cache key for a step: tool name + normalized args, order-insensitive.
  function cacheKeyFor(name, args) {
    const src = (args && typeof args === 'object' && !Array.isArray(args)) ? args : {};
    const parts = Object.keys(src).sort().map(k => k + '=' + JSON.stringify(src[k]));
    return name + '|' + parts.join('&');
  }

  // Return a cached result for an identical step, or null. Entries older than
  // 5 minutes are treated as stale.
  function getCachedStep(run, key) {
    const entry = run.stepCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.at > 300000) return null;
    return entry.result;
  }

  function storeCachedStep(run, key, result) {
    run.stepCache.set(key, { result, at: Date.now() });
    if (run.stepCache.size > 50) {
      const first = run.stepCache.keys().next().value;
      if (first !== undefined) run.stepCache.delete(first);
    }
  }

  // Tool chaining: substitute ${{stepId.field}} references in tool inputs with
  // values from prior step results. Supports dotted paths ({{s1.result.text}}).
  function substituteChain(run, input) {
    if (typeof input === 'string') {
      return input.replace(/\$\{\{([^}]+)\}\}/g, (match, expr) => chainValue(run, expr));
    }
    if (Array.isArray(input)) return input.map(v => substituteChain(run, v));
    if (input && typeof input === 'object') {
      const out = {};
      for (const k of Object.keys(input)) out[k] = substituteChain(run, input[k]);
      return out;
    }
    return input;
  }

  function chainValue(run, expr) {
    const parts = expr.split('.');
    const stepId = parts[0];
    const entry = run.stepResults.get(stepId);
    if (!entry) return undefined;
    let val = entry.result;
    for (let i = 1; i < parts.length; i++) {
      if (val == null || typeof val !== 'object') return undefined;
      val = val[parts[i]];
    }
    return val === undefined ? undefined : val;
  }

  // Which pending plan steps are unblocked (all dependencies done)?
  function unblockedPlanSteps(plan, doneIds) {
    const steps = (plan && Array.isArray(plan.steps)) ? plan.steps : [];
    const doneSet = new Set(doneIds || []);
    return steps.filter(s => {
      if (s.status !== 'pending') return false;
      const deps = Array.isArray(s.dependsOn) ? s.dependsOn : [];
      return deps.length > 0 && deps.every(d => doneSet.has(d));
    });
  }

  // Evaluate a step's if/else condition against prior step results.
  // Supports a narrow subset: ${{stepId.field}} ==/!= "value".
  function evaluateCondition(condition, stepResults) {
    if (!condition || typeof condition !== 'string') return true;
    const c = condition.trim();
    const m = c.match(/^\$\{\{([^}]+)\}\}\s*(==|!=|===|!==)\s*(.+)$/);
    if (!m) return true; // unknown condition → run the step
    const [, expr, op, expected] = m;
    const actual = chainValueFromMap(stepResults, expr);
    const expStr = String(expected || '').replace(/^['"]|['"]$/g, '');
    switch (op) {
      case '==': case '===': return String(actual == null ? '' : actual) === expStr;
      case '!=': case '!==': return String(actual == null ? '' : actual) !== expStr;
      default: return true;
    }
  }

  function chainValueFromMap(stepResults, expr) {
    const parts = expr.split('.');
    const stepId = parts[0];
    const entry = stepResults.get(stepId);
    if (!entry) return undefined;
    let val = entry.result;
    for (let i = 1; i < parts.length; i++) {
      if (val == null || typeof val !== 'object') return undefined;
      val = val[parts[i]];
    }
    return val;
  }

  async function runAction(run, call, opts = {}) {
    const name = call.name;
    const stepId = opts.stepId || ('s' + (run.steps.length + 1));
    const groupId = opts.groupId || null;
    const timeoutMs = opts.timeoutMs || 0;
    const approach = opts.approach || 1;
    // Validate before anything else runs: a tab tool with a missing or
    // malformed id fails here with an actionable message and never reaches
    // the tab layer (which would otherwise treat it as an empty id).
    const norm = research.normalizeTabArgs(name, call.input || {});
    let args = norm.ok ? norm.args
      : ((call.input && typeof call.input === 'object' && !Array.isArray(call.input)) ? call.input : {});
    const node = (run.nodes && args.ref != null) ? run.nodes[args.ref] : null;
    const risk = aiTools.classify(name, args, node, { url: run.snapUrl });
    const what = aiTools.describe(name, args, node);

    const step = {
      n: run.steps.length + 1, id: stepId, name, args, what, groupId, timeoutMs,
      status: 'live', detail: '', approach,
    };
    run.steps.push(step);
    try { deps.emit(run, { type: 'step', step: { ...step } }); } catch {}
    try { deps.emit(run, { type: 'runbar', label: what }); } catch {}

    // Tool chaining: substitute ${{stepId.field}} references before anything
    // else uses the args.
    if (args && typeof args === 'object') {
      const substituted = substituteChain(run, args);
      if (substituted !== args) args = substituted;
    }

    // Step result caching: serve identical steps from cache instead of
    // re-dispatching (unless the caller opts out via opts.skipCache).
    if (!opts.skipCache) {
      const key = cacheKeyFor(name, args);
      const cached = getCachedStep(run, key);
      if (cached) {
        step.status = 'ok';
        step.detail = '(cached) ' + formatResult(name, cached);
        try { deps.emit(run, { type: 'step', step: { ...step } }); } catch {}
        storeCachedStep(run, key, cached); // refresh TTL
        run.stepResults.set(stepId, { name, args, result: cached, ok: true, text: step.detail });
        endStepTimer(run, stepId, 'ok', step.detail, approach);
        return { text: step.detail, isError: false, cached: true };
      }
    }

    await waitIfPaused(run);
    const stopped = checkHalt(run) || checkLease(run);
    if (stopped) {
      step.status = 'bad';
      step.detail = 'Not run — ' + stopped + '.';
      try { deps.emit(run, { type: 'step', step: { ...step } }); } catch {}
      endStepTimer(run, stepId, 'bad', step.detail, approach);
      return { text: 'Stopped by the user before this action ran.', halted: true };
    }

    if (!norm.ok) {
      step.status = 'bad';
      step.detail = norm.error;
      try { deps.emit(run, { type: 'step', step: { ...step } }); } catch {}
      return { text: norm.error, isError: true };
    }

    // update_plan writes run state only: no page, no dispatch, nothing to
    // confirm — the plan is checked again when the model calls done.
    if (name === 'update_plan') {
      const pass = research.sanitizePlan(args);
      if (!pass.ok) {
        step.status = 'bad';
        step.detail = pass.error;
        try { deps.emit(run, { type: 'step', step: { ...step } }); } catch {}
        return { text: 'The plan was not saved: ' + pass.error, isError: true };
      }
      run.plan = pass.plan;
      run.doneNudged = false;
      try { deps.emit(run, { type: 'plan', plan: pass.plan }); } catch {}
      // Plan review: when the person asked to see the plan first, the run parks
      // here until they approve it. One review per run — a declined plan is
      // handed back to the model with the reason, and the next one runs.
      if (run.planFirst && !run.planReviewed) {
        run.planReviewed = true;
        step.status = 'asked';
        step.detail = 'Waiting for you…';
        try { deps.emit(run, { type: 'step', step: { ...step } }); } catch {}
        try { deps.emit(run, { type: 'runbar', label: 'Waiting for you' }); } catch {}
        const review = await askWithLimits(run,
          'Run this plan?',
          'Goal: ' + pass.plan.goal + ' — ' + (pass.plan.steps || []).length + ' step(s): ' +
            (pass.plan.steps || []).slice(0, 5).map(s => s.text).join('; '));
        if (!review.ok) {
          step.status = 'bad';
          step.detail = 'You did not approve the plan.';
          try { deps.emit(run, { type: 'step', step: { ...step } }); } catch {}
          return {
            text: 'The user did not approve that plan. Do not start the work. Either propose a different, ' +
              'smaller plan (update_plan again) or call done explaining what you would need to proceed.',
            declined: true,
          };
        }
        step.status = 'ok';
      }
      const text = 'Plan updated - goal: "' + pass.plan.goal + '"; ' +
        research.planProgress(pass.plan) + ' steps done.';
      step.status = 'ok';
      step.detail = text;
      try { deps.emit(run, { type: 'step', step: { ...step } }); } catch {}
      return { text };
    }

    // Refs only exist against the newest snapshot; acting on stale numbers
    // could hit elements from a different page state.
    if (usesRefs(name, args) && !run.snapUrl) {
      const text = 'You have not snapshotted the page since it last changed. Call snapshot, then act ' +
        'on the ref numbers from that fresh snapshot.';
      step.status = 'bad';
      step.detail = 'No fresh snapshot.';
      try { deps.emit(run, { type: 'step', step: { ...step } }); } catch {}
      return { text, isError: true };
    }

    // Per-run budgets keep browser-wide work bounded (no unbounded tab
    // opening or reading loops).
    const budget = BUDGETS[name];
    if (budget && run[budget.field] >= budget.max) {
      const text = 'Budget reached: this run already used its ' + budget.max + ' ' + budget.what +
        '. Work with what you have read, or call done explaining what is left.';
      step.status = 'bad';
      step.detail = text;
      try { deps.emit(run, { type: 'step', step: { ...step } }); } catch {}
      return { text, isError: true };
    }

    let fieldRisk = '';
    if (name === 'fill_form' && Array.isArray(args.fields)) {
      for (const f of args.fields) {
        const nd = run.nodes && f ? run.nodes[f.ref] : null;
        if (nd && (nd.secret || nd.danger)) { fieldRisk = nd.danger || 'a sensitive field'; break; }
      }
    }

    if (risk.tier >= 3 || fieldRisk) {
      step.status = 'asked';
      step.detail = 'Waiting for you…';
      try { deps.emit(run, { type: 'step', step: { ...step } }); } catch {}
      try { deps.emit(run, { type: 'runbar', label: 'Waiting for you' }); } catch {}
      const asked = await askWithLimits(run, what, fieldRisk || risk.reason);
      if (!asked.ok) {
        step.status = 'bad';
        step.detail = asked.reason === 'timeout'
          ? 'No answer came, so this was not run.'
          : asked.reason === 'lease'
            ? 'The panel stopped responding, so the run ended.'
            : 'Not run.';
        try { deps.emit(run, { type: 'step', step: { ...step } }); } catch {}
        if (asked.reason === 'lease') {
          return { text: 'The run ended because the panel stopped responding.', halted: true };
        }
        return {
          text: asked.reason === 'timeout'
            ? 'Nobody answered the confirmation in time, so the action was not run. Do not try it ' +
              'again or work around it. Either continue without it or call done explaining the wait.'
            : 'The user declined this action. Do not try it again or work around it. ' +
              'Either continue without it or call done explaining what you could not do.',
          declined: true,
        };
      }
      step.status = 'live';
    }

    // The confirmation may have sat parked while the run was paused: never
    // dispatch until the run is running again, and never after a stop.
    await waitIfPaused(run);
    if (checkHalt(run) || checkLease(run)) {
      step.status = 'bad';
      step.detail = 'Not run — stopped.';
      try { deps.emit(run, { type: 'step', step: { ...step } }); } catch {}
      endStepTimer(run, stepId, 'bad', step.detail, approach);
      return { text: 'Stopped by the user before this action ran.', halted: true };
    }

    startStepTimer(run, stepId, name);

    // A question to the person: parks like a confirmation, but the answer is
    // text the model can act on. Capped per run so a run cannot turn into an
    // interview.
    if (name === 'ask_user') {
      const question = String((args && args.question) || '').trim().slice(0, 300);
      if (!question) {
        // The timer already started: every early return has to close it, or the
        // step's duration and the run's confidence metric keep a phantom step.
        step.status = 'bad';
        step.detail = 'ask_user needs a question.';
        try { deps.emit(run, { type: 'step', step: { ...step } }); } catch {}
        endStepTimer(run, stepId, 'bad', step.detail, approach);
        return { text: 'ask_user needs a question.', isError: true };
      }
      run.asks = (run.asks || 0) + 1;
      if (run.asks > MAX_USER_ASKS) {
        const capped = 'You have already asked ' + MAX_USER_ASKS + ' questions this run. Decide with what you ' +
          'have, or call done explaining what is missing.';
        step.status = 'bad';
        step.detail = capped;
        try { deps.emit(run, { type: 'step', step: { ...step } }); } catch {}
        endStepTimer(run, stepId, 'bad', capped, approach);
        return { text: capped, isError: true };
      }
      step.status = 'asked';
      step.detail = 'Waiting for your answer…';
      try { deps.emit(run, { type: 'step', step: { ...step } }); } catch {}
      try { deps.emit(run, { type: 'runbar', label: 'Waiting for you' }); } catch {}
      const asked = await askUserText(run, question, { why: String((args && args.why) || '').slice(0, 200) });
      const text = asked.ok
        ? 'The user answered: "' + asked.text + '"'
        : asked.reason === 'timeout'
          ? 'Nobody answered that question in time. Continue without it or call done explaining the wait.'
          : asked.reason === 'lease'
            ? 'The run ended because the panel stopped responding.'
            : 'The user gave no answer. Continue without it or call done explaining what you need.';
      step.status = asked.ok ? 'ok' : 'bad';
      step.detail = text;
      try { deps.emit(run, { type: 'step', step: { ...step } }); } catch {}
      run.stepResults.set(stepId, { name, args, result: { ok: asked.ok, answer: asked.text }, ok: asked.ok, text });
      endStepTimer(run, stepId, step.status, text, approach);
      if (asked.reason === 'lease') return { text, halted: true };
      return { text, isError: !asked.ok, asked: true };
    }

    // Two calls are the runner's own composite work, not one browser action:
    // read_tabs fans a parallel read across several tabs, and close_opened_tabs
    // hands back the tabs this run opened. Both still count against budgets.
    if (name === 'read_tabs') {
      const res = await fanOutReads(run, args, budget);
      const text = formatResult(name, res);
      const ok = res && res.ok !== false;
      step.status = ok ? 'ok' : 'bad';
      step.detail = text;
      try { deps.emit(run, { type: 'step', step: { ...step } }); } catch {}
      run.stepResults.set(stepId, { name, args, result: res, ok, text });
      endStepTimer(run, stepId, step.status, text, approach);
      return { text, isError: !ok, result: res };
    }
    if (name === 'close_opened_tabs') {
      const res = await closeOpenedTabs(run);
      const text = formatResult(name, res);
      step.status = res.ok ? 'ok' : 'bad';
      step.detail = text;
      try { deps.emit(run, { type: 'step', step: { ...step } }); } catch {}
      run.stepResults.set(stepId, { name, args, result: res, ok: res.ok, text });
      endStepTimer(run, stepId, step.status, text, approach);
      return { text, isError: !res.ok, result: res };
    }

    // Report the existing deadline without changing how dispatch is cancelled.
    const dispatchPromise = deps.dispatch(run, name, args, run.refs);
    let res;
    if (timeoutMs && timeoutMs > 0) {
      let deadline;
      const timeout = new Promise((_, rej) => {
        deadline = setTimeout(() => rej(new Error('step timeout after ' + timeoutMs + 'ms')), timeoutMs);
      });
      try { res = await Promise.race([dispatchPromise, timeout]); }
      catch (err) { res = { ok: false, error: (err && err.message) ? err.message : String(err) }; }
      finally { clearTimeout(deadline); }
    } else {
      try { res = await dispatchPromise; }
      catch (err) { res = { ok: false, error: (err && err.message) ? err.message : String(err) }; }
    }

    if (res && res.halted) {
      halt(run, res.error || 'stopped');
      step.status = 'bad';
      step.detail = res.error || 'Stopped.';
      try { deps.emit(run, { type: 'step', step: { ...step } }); } catch {}
      return { text: res.error || 'Stopped.', halted: true };
    }

    const after = checkHalt(run);
    if (after) {
      step.status = 'bad';
      step.detail = 'Stopped while this was running; the result was discarded.';
      try { deps.emit(run, { type: 'step', step: { ...step } }); } catch {}
      return { text: 'Stopped by the user.', halted: true };
    }

    // Per-run budgets count work that actually happened: reusing a tab that was
    // already open is not new-tab spend.
    const reused = Boolean(res && res.reused);
    if (budget && res && res.ok !== false && !reused) run[budget.field]++;

    // Remember what this run opened, so close_opened_tabs can hand the browser
    // back tidy without ever touching a tab the person opened themselves. A
    // reused tab is never ours to close.
    if (name === 'open_tab' && res && res.ok !== false && res.tabId && !reused) {
      run.openedTabs.push(String(res.tabId));
    }

    // A fresh snapshot replaces the ref map. Nothing else may, or the model
    // could act on numbers from two different page states.
    if (name === 'snapshot' && res && res.ok) {
      run.refs = res.refs || null;
      run.nodes = {};
      for (const nd of res.nodes || []) run.nodes[nd.ref] = nd;
      run.snapUrl = String(res.url || '');
    }

    // Pages read this run feed citation checks (note_finding) and stay
    // capped. Navigation invalidates every ref — a click that moved the page
    // must be followed by a fresh snapshot (the snapshot branch re-arms it).
    if (res && res.ok !== false) {
      if (name === 'snapshot' || name === 'read_tab') recordRead(run, res);
      if (name === 'search_tabs') {
        for (const sc of res.scanned || []) recordRead(run, sc);
      }
      // Every tab an inspection read is a page this run has read, so
      // findings may cite them (most recent 12 are kept).
      if (name === 'inspect_tabs' && res.report) {
        for (const t of res.report.tabs || []) {
          if (t && t.ok) recordRead(run, { url: t.url, title: t.title, finalUrl: t.finalUrl, text: t.text || t.summary || '' });
        }
      }
      if (name === 'navigate' || name === 'back' || name === 'switch_tab') {
        run.refs = null;
        run.nodes = {};
        run.snapUrl = '';
        // Navigation changes page state, so cached step results are stale.
        run.stepCache.clear();
      }
    }

    const text = formatResult(name, res);
    const ok = res && res.ok !== false;
    step.status = ok ? 'ok' : 'bad';
    step.detail = text;
    try { deps.emit(run, { type: 'step', step: { ...step } }); } catch {}

    // Store result for tool chaining + cache (skip cache for non-idempotent writes).
    // Only read-only calls are cacheable. A denylist here was a trap: `click`,
    // `type`, `press_key`, `wait_for`, `open_tab` and friends were cached, so a
    // second identical call came back "(cached)" and did nothing while reporting
    // success — the worst possible failure for an agent (silent no-op).
    const CACHEABLE = {
      read_tab: 1, read_tabs: 1, find_text: 1, get_page_data: 1, synthesize_tabs: 1,
    };
    if (ok && CACHEABLE[name]) {
      const key = cacheKeyFor(name, args);
      storeCachedStep(run, key, res);
    }
    run.stepResults.set(stepId, { name, args, result: res, ok, text });
    endStepTimer(run, stepId, step.status, text, approach);

    const out = { text, isError: !ok };
    if (name === 'screenshot' && res && res.image) {
      out.images = [{ name: 'screenshot', url: res.image }];
    }
    return out;
  }

  async function runLoop(run) {
    const limit = aiTools.stepLimit(run.settings.agentMaxSteps);
    // The step ceiling counts actions; a turn that produces only prose is not a
    // step, so the loop itself needs a ceiling too or a chatty model loops
    // forever. Generous, but finite.
    const loopCeiling = Math.max(LOOP_FLOOR, limit * LOOP_MULTIPLIER);
    const tools = aiTools.openaiTools();
    let text = '', outcome = '';
    try {
      while (true) {
        await waitIfPaused(run);
        const stopped = checkHalt(run) || checkLease(run);
        if (stopped) { outcome = 'Stopped: ' + stopped + '.'; break; }
        if (run.steps.length >= limit) {
          outcome = 'Reached the ' + limit + '-step limit for one run, so I stopped. ' +
            'Ask again to continue from here.';
          break;
        }
        run.loops = (run.loops || 0) + 1;
        if (run.loops >= loopCeiling) {
          outcome = 'I kept answering without taking an action (' + run.loops +
            ' turns), so I stopped rather than looping. Ask again with a more specific ' +
            'instruction, or tell me the exact step to take.';
          break;
        }
        try { deps.emit(run, { type: 'runbar', label: 'Thinking…' }); } catch {}

        // Plan-based execution: surface the next unblocked plan step(s) to the
        // model as context so it drives dependency-aware execution.
        if (run.plan) {
          const doneIds = (run.plan.steps || [])
            .filter(s => s.status === 'done').map(s => s.id);
          const ready = unblockedPlanSteps(run.plan, doneIds);
          if (ready.length) {
            try { deps.emit(run, {
              type: 'plan',
              plan: run.plan,
              nextSteps: ready.map(s => ({ id: s.id, text: s.text, dependsOn: s.dependsOn })),
            }); } catch {}
          }
        }

        let turn;
        try {
          turn = await streamTurnWithRetry(run, tools);
        } catch (err) {
          if (err && (err.aborted || run.halted)) { outcome = 'Stopped.'; break; }
          // Provider outage: end the run cleanly with a clear message. The
          // browser itself is untouched — this only stops the assistant.
          outcome = 'I could not reach the assistant service (' +
            String((err && err.message) || err).slice(0, 200) +
            '). Nothing in your browser was affected — check the connection and ask again.';
          try { deps.emit(run, { type: 'runbar', label: 'Service unreachable' }); } catch {}
          break;
        }
        if (!turn || turn.cancelled || checkHalt(run)) { outcome = 'Stopped.'; break; }

        const calls = (turn.toolCalls || []).filter(c => c && c.name);
        pushAssistant(run, turn.text || '', calls);

        // Multi-turn reasoning: if the model emitted reasoning text without
        // tool calls, record it in the reasoning chain and keep going so the
        // model can chain multiple thoughts before acting. Only end the run
        // when there is genuinely nothing (no reasoning, no transcript).
        if (!calls.length) {
          if (turn.text && turn.text.trim()) {
            run.reasoningChain.push({
              at: Date.now(),
              text: turn.text.trim(),
              turn: run.turns.length,
            });
            try { deps.emit(run, { type: 'runbar', label: 'Reasoning…' }); } catch {}
            continue;
          }
          if (!String(run.transcript).trim()) {
            outcome = 'The model returned no action and no answer. If this provider has no ' +
              'tool-calling support, turn acting off and ask again.';
          }
          break;
        }

        const call = calls[0];
        if (calls.length > 1) {
          pushResults(run, calls.slice(1).map(c => ({
            id: c.id, name: c.name,
            content: 'Not run: take one action per turn. Re-issue this after seeing the result of ' + call.name + '.',
            isError: true,
          })));
        }

        if (call.parseError) {
          pushResults(run, [{ id: call.id, name: call.name, content: call.parseError, isError: true }]);
          continue;
        }

        if (call.name === 'done') {
          // Completion verification: a plan with unfinished steps is not done.
          // The model gets one nudge to update the plan or finish the work;
          // a second done is accepted (the trace shows what was left open).
          const open = research.planOpenSteps(run.plan);
          if (open.length && !run.doneNudged) {
            run.doneNudged = true;
            pushResults(run, [{
              id: call.id, name: 'done',
              content: 'Not done yet: the plan still has ' + open.length + ' unfinished step(s): ' +
                open.slice(0, 5).map(s => '"' + s.text + '"').join('; ') + '. ' +
                'Update the plan (mark each step done, failed or blocked with a short note) or finish ' +
                'them, then call done again. If you are blocked, mark that step and explain in the summary.',
              isError: true,
            }]);
            continue;
          }
          const summary = String((call.input && call.input.summary) || '').trim();
          if (summary) text = (text ? text + '\n\n' : '') + summary;
          // A model that answers in prose on the closing turn and leaves the
          // done summary empty still gets that answer shown; earlier turns are
          // deliberately excluded.
          else if (turn.text && turn.text.trim()) text = (text ? text + '\n\n' : '') + turn.text.trim();
          pushResults(run, [{ id: call.id, name: 'done', content: 'Acknowledged.' }]);
          run.finishedByDone = true;
          break;
        }

        // Bounded retries with self-correction: the same call may fail twice.
        // On the second failure the agent tries a different approach (new
        // approach number) before giving up. Only after exhausting approaches
        // does the run end.
        const failKey = callKey(call.name, call.input);
        const fails = run.failCounts.get(failKey) || 0;
        const approach = fails + 1;
        const maxApproaches = FAILED_CALL_LIMIT;

        if (fails >= maxApproaches) {
          outcome = 'The same call failed ' + fails + ' times across ' +
            maxApproaches + ' approaches (' +
            aiTools.describe(call.name, call.input || {}, null) + '). I stopped instead of ' +
            'repeating it again. Check the ids with list_tabs or search_tabs, change approach, or ' +
            'call done explaining what blocked you.';
          break;
        }

        if (fails > 0) {
          // Self-correction: tell the model the previous approach failed and
          // it should try something different on this attempt.
          pushResults(run, [{
            id: call.id, name: call.name,
            content: 'Self-correction: this call previously failed (' + fails + ' time(s)). ' +
              'Try a different approach — refresh ids with list_tabs/search_tabs, use a different ' +
              'element ref, or phrase the action differently. This is approach ' + approach +
              ' of ' + maxApproaches + '.',
            isError: true,
            approach,
          }]);
        }

        if (aiTools.sameCall(call, run.lastCall)) {
          run.repeats++;
          if (run.repeats >= aiTools.REPEAT_LIMIT - 1) {
            outcome = 'I tried the same action three times in a row, so the run was stopped.';
            break;
          }
        } else {
          run.repeats = 0;
        }
        run.lastCall = call;

        // Plan-based execution: resolve the tool call to a plan step, check
        // dependencies, evaluate conditional branching, and attach group/
        // timeout metadata. Resolution order: the id the model passed, then the
        // single step it marked as doing, then an exact text match.
        let planStep = null;
        let planNote = '';
        if (run.plan) {
          const steps = run.plan.steps || [];
          const wanted = String((call.input && call.input.stepId) || call.stepRef || '').trim();
          planStep = wanted ? steps.find(s => s.id === wanted) : null;
          if (!planStep) {
            const doing = steps.filter(s => s.status === 'doing');
            if (doing.length === 1) planStep = doing[0];
          }
          if (!planStep && wanted) {
            // A stale or unknown id is worth saying out loud: otherwise the
            // checklist silently stops tracking the work.
            planNote = 'Note: stepId "' + wanted + '" is not in the current plan, so this action was not ' +
              'tied to a step. Use the ids from update_plan.';
          }
        }
        let runOpts = { approach };
        if (planStep) {
          // Dependency check: all dependencies must be done.
          const depsList = Array.isArray(planStep.dependsOn) ? planStep.dependsOn : [];
          const doneIds = (run.plan.steps || [])
            .filter(s => s.status === 'done').map(s => s.id);
          const blocked = depsList.filter(d => !doneIds.includes(d));
          if (blocked.length) {
            pushResults(run, [{
              id: call.id, name: call.name,
              content: 'Blocked: plan step "' + planStep.text + '" depends on ' +
                blocked.map(d => '"' + d + '"').join(', ') + ' which are not done yet. ' +
                'Complete those steps first.',
              isError: true,
            }]);
            continue;
          }
          // Conditional branching: skip step if its condition is false.
          if (planStep.condition && !evaluateCondition(planStep.condition, run.stepResults)) {
            pushResults(run, [{
              id: call.id, name: call.name,
              content: 'Skipped: plan step "' + planStep.text + '" condition was false.',
              isError: false,
              skipped: true,
            }]);
            // Mark the step done so the plan can proceed.
            planStep.status = 'done';
            planStep.note = 'Skipped (condition false)';
            try { deps.emit(run, { type: 'plan', plan: run.plan }); } catch {}
            continue;
          }
          runOpts.groupId = planStep.groupId || null;
          runOpts.timeoutMs = planStep.timeoutMs || 0;
          planStep.status = 'doing';
          try { deps.emit(run, { type: 'plan', plan: run.plan }); } catch {}
        }

        let result = await runAction(run, call, runOpts);
        // Automatic recovery for the one failure that is always worth fixing
        // without asking the model: a ref-based action refused because the page
        // moved on. Take the fresh snapshot here, hand it back with the result,
        // and save a whole model round trip.
        if (result.isError && usesRefs(call.name, call.input) && /snapshot/i.test(String(result.text || '').slice(0, 240))) {
          const snap = await runAction(run, { id: 'auto-snap-' + call.id, name: 'snapshot', input: {} }, { approach });
          if (snap && !snap.isError) {
            result = {
              ...result,
              text: 'That action was refused because the page had changed, so a fresh snapshot was taken ' +
                'for you — use these ref numbers:\n\n' + snap.text,
              recovered: true,
            };
          }
        }
        let content = planNote ? planNote + '\n' + result.text : result.text;
        if (result.isError) {
          const n = (run.failCounts.get(failKey) || 0) + 1;
          run.failCounts.set(failKey, n);
          if (n >= FAILED_CALL_LIMIT) {
            content += '\n(That was this call\'s ' + n + (n === 2 ? 'nd' : 'th') + ' failure. One more ' +
              'identical attempt ends the run — refresh ids with list_tabs/search_tabs, change ' +
              'approach, or call done with what blocked you.)';
          }
        } else {
          // A success clears the call's failure debt.
          run.failCounts.delete(failKey);
        }
        pushResults(run, [{
          id: call.id, name: call.name,
          content,
          isError: Boolean(result.isError),
        }]);
        // Update plan step status based on the result.
        if (planStep) {
          if (result.isError) {
            planStep.status = 'failed';
            planStep.note = content;
          } else {
            planStep.status = 'done';
            planStep.note = content;
          }
          try { deps.emit(run, { type: 'plan', plan: run.plan }); } catch {}
        }
        // A screenshot rides back as a following user turn (OpenAI dialect
        // carries no images inside tool messages) — scAI's api.js pattern.
        if (result.images && result.images.length) {
          run.turns.push({
            role: 'user',
            text: '(screenshot for ' + call.name + ')',
            images: result.images.map(img => ({ name: img.name || 'screenshot', url: img.url })),
          });
        }
        if (result.halted) { outcome = 'Stopped: ' + (run.haltReason || 'stopped') + '.'; break; }
        try { deps.onProgress(run); } catch {}
      }
    } finally {
      run.done = true;
      try { deps.onStop(run); } catch {}
    }

    // The visible reply is the model's closing summary (the `done` call), not
    // the running transcript: every earlier turn is reasoning or a one-line
    // "about to act" note, so concatenating them made the answer repeat the
    // whole run. The transcript stays on the run for diagnostics.
    const parts = [];
    if (text.trim()) parts.push(text.trim());
    if (outcome) parts.push('_' + outcome + '_');
    const finalText = parts.join('\n\n') || '_(nothing to report)_';
    // A run that ends with a finished deliverable becomes a card, exactly like
    // a chat reply does — otherwise agent work had nowhere to land.
    const deliverable = deliverableFrom(finalText, { wantsArtifact: Boolean(run.wantsArtifact) });
    // "Partial" means the run stopped without the model calling done: a step
    // cap, a repeat stop, a halt — including the person pressing Stop. That
    // case used to be excluded, and the user-simulator walkthrough showed the
    // result: no chip, no Continue, no way back into a stopped task. Offering
    // to carry on costs nothing; ignoring the chip is free.
    const partial = !run.finishedByDone;
    const remaining = run.plan ? research.planOpenSteps(run.plan).map(s => s.text).slice(0, 5) : [];
    return {
      ok: true,
      text: partial
        ? deliverable.text + '\n\n_(Stopped before finishing' +
          (remaining.length ? ' — still open: ' + remaining.join('; ') : '') +
          '. Say "continue" and I will carry on from here.)_'
        : deliverable.text,
      steps: run.steps.slice(),
      plan: run.plan || null,
      halted: run.halted,
      partial,
      remaining,
      ...(deliverable.artifact ? { artifact: deliverable.artifact, artifactWarnings: deliverable.warnings } : {}),
      ...(deliverable.artifactError ? { artifactError: deliverable.artifactError } : {}),
    };
  }



  function startRun({ tabId, winId, url, settings, memory, history }) {
    const runId = 'run-' + Date.now().toString(36) + '-' + (++seq);
    const run = {
      id: runId,
      loopReqId: 'agent-' + runId,
      tabId, winId, startUrl: url || '',
      startedAt: Date.now(),
      settings: settings || {},
      memory: Array.isArray(memory) ? memory : [],
      history: Array.isArray(history) ? history.slice(-80) : [],
      turns: [],
      transcript: '',
      refs: null,
      nodes: {},
      steps: [],
      halted: false,
      haltReason: '',
      done: false,
      lease: Date.now(),
      lastCall: null,
      repeats: 0,
      pendingAsk: null,
      failCounts: new Map(),
      // planning + research state (browser-wide work)
      plan: null,
      doneNudged: false,
      loops: 0,
      paused: false,
      pausedAt: 0,
      newTabs: 0,
      reads: 0,
      inspections: 0,
      openedTabs: [],
      readPages: [],
      snapUrl: '',
      projectId: '',
      // ---------- agentic enhancements ----------
      stepTimers: new Map(),       // stepId -> { startedAt, name }
      stepMetrics: [],             // per-step timing + outcome metrics
      stepCache: new Map(),        // cacheKey -> { result, at } (dedup identical steps)
      stepResults: new Map(),      // stepId -> { name, args, result, ok, text } (tool chaining)
      stepApproaches: new Map(),   // stepId -> number of approaches tried (self-correction)
      confidence: 1.0,             // 0-1 plan execution confidence
      reasoningChain: [],          // multi-turn reasoning trace
    };
    runs.set(runId, run);
    return run;
  }

  // Replay a saved recipe with no model call. Refs are recorded numbers,
  // so every ref-bearing step re-snapshots silently first — the numbers only
  // make sense against a fresh snapshot. Tier-3 confirmation still applies:
  // a recipe shortcuts the model, never the gate.
  const REPLAYABLE = {
    snapshot: 1, click: 1, type: 1, select: 1, hover: 1, press_key: 1,
    scroll: 1, wait_for: 1, fill_form: 1, navigate: 1, back: 1, find_text: 1,
  };

  async function replayRun(run, steps) {
    let note = '';
    // Cap replay length: a corrupt/long recipe must not run the tab forever.
    const list = (Array.isArray(steps) ? steps : []).slice(0, 60);
    try {
      for (const step of list) {
        if (!step || !REPLAYABLE[step.name]) continue;
        if (checkHalt(run) || checkLease(run)) { note = 'Stopped: ' + (run.haltReason || 'stopped') + '.'; break; }
        try { deps.emit(run, { type: 'runbar', label: 'Replaying…' }); } catch {}
        if (step.args && step.args.ref != null && step.name !== 'snapshot') {
          await runAction(run, { name: 'snapshot', input: {} });
          if (checkHalt(run)) { note = 'Stopped.'; break; }
        }
        const result = await runAction(run, { name: step.name, input: (step.args && typeof step.args === 'object') ? step.args : {} });
        if (result.halted) { note = 'Stopped: ' + (run.haltReason || 'stopped') + '.'; break; }
        if (result.declined) { note = 'You declined a step, so the replay stopped.'; break; }
        if (result.isError) {
          note = 'A step failed, so the replay stopped. The page has probably changed since ' +
            'this recipe was recorded — run it as a normal request instead.';
          break;
        }
      }
    } finally {
      run.done = true;
      try { deps.onStop(run); } catch {}
    }
    return {
      ok: true,
      text: note || ('Replayed ' + run.steps.length + ' step(s).'),
      steps: run.steps.slice(),
      halted: run.halted,
    };
  }

  function endRun(runId) {
    runs.delete(String(runId || ''));
  }

  return {
    startRun, runLoop, replayRun, stopRun, ping, answerAsk,
    setPaused, waitIfPaused,
    tabClosed, windowClosed, getRun, endRun,
    formatResult, nodeLine,
  };
}

// The renderer-facing shape of a finished run (browser.js sends this straight
// back over IPC). It lives beside the loop's own return value on purpose: a
// field dropped in this mapping is invisible until a person notices a missing
// artifact card or Continue button — which is exactly what happened. Keeping
// the mapping here makes it testable without Electron.
function agentReplyFrom(reqId, out) {
  const o = out || {};
  return {
    ok: true,
    reqId,
    text: o.text || '',
    steps: o.steps || [],
    plan: o.plan || null,
    halted: Boolean(o.halted),
    artifact: o.artifact || null,
    artifactError: o.artifactError || '',
    artifactWarnings: o.artifactWarnings || [],
    partial: Boolean(o.partial),
    remaining: o.remaining || [],
  };
}

module.exports = { createAgentRunner, agentReplyFrom, LEASE_MS, ASK_TIMEOUT_MS, deliverableFrom };
