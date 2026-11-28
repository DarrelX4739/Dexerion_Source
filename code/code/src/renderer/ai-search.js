// Search With Dexerion AI — the fullscreen search surface.
//
// Owns the hero/docked layout, the Search/Chat modes, the difficulty chip, the
// suggestions list, and the rendering of streamed answers with their sources.
// The search pipeline itself lives in the main process (ai-search.js +
// browser.js); this file only drives it and paints the result.
(function () {
  'use strict';

  const MARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M3 12h3M18 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/><circle cx="12" cy="12" r="4"/></svg>';
  const SEARCH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
  const CHECK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

  const $ = (sel) => document.querySelector(sel);
  const el = {};
  const state = {
    open: false,
    modes: { search: true, chat: false },
    config: { suggestions: false, sources: 8, adaptations: 4, difficulty: 'medium' },
    difficulty: 'medium',
    mode: 'search',
    runMode: 'search',
    chat: null,
    busy: false,
    reqId: null,
    live: null,
    liveReq: '',
    streamed: '',
    steps: [],
    current: null,
    chunkReq: '',
    suggestItems: [],
    suggestIndex: -1,
    suggestTimer: null,
    hasKey: false,
  };

  function hostOf(url) {
    try { return new URL(String(url || '')).hostname.replace(/^www\./i, ''); } catch { return ''; }
  }

  function scrollToEnd() {
    if (!el.scroll) return;
    el.scroll.scrollTop = el.scroll.scrollHeight;
  }

  function autosize() {
    if (!el.input) return;
    el.input.style.height = 'auto';
    el.input.style.height = Math.min(170, el.input.scrollHeight) + 'px';
  }

  function focusInput() {
    if (!el.input || !state.open) return;
    setTimeout(() => { try { el.input.focus(); } catch {} }, 30);
  }

  function renderMarkdown(node, text) {
    if (!node) return;
    if (window.DexMarkdown && typeof window.DexMarkdown.render === 'function') {
      window.DexMarkdown.render(node, String(text || ''), { onLink: (url) => openUrl(url) });
      return;
    }
    node.textContent = String(text || '');
  }

  function openUrl(url) {
    const href = String(url || '').trim();
    if (!/^https?:\/\//i.test(href)) return;
    close();
    setTimeout(() => {
      try { window.dexerion.invoke('dex:new-tab', href, false).catch(() => {}); } catch {}
    }, 60);
  }

  function hasMessages() {
    return Boolean(state.chat && Array.isArray(state.chat.messages) && state.chat.messages.length);
  }

  function paintHero() {
    if (!el.root) return;
    const busyChat = hasMessages();
    el.root.classList.toggle('hero', !busyChat);
    el.input.placeholder = busyChat
      ? 'Ask a follow up…'
      : (state.mode === 'chat' ? 'Message Dexerion AI…' : 'Search With Dexerion AI…');
    el.hint.textContent = state.mode === 'chat' ? 'Enter to send · Esc to close' : 'Enter to search · Esc to close';
  }

  // ---------- model picker ---------------------------------------------------
  async function loadStatus() {
    let status = null;
    try { status = await window.dexerion.invoke('dex:ai-status'); } catch {}
    state.hasKey = Boolean(status && status.hasKey);
    if (el.connect) el.connect.hidden = state.hasKey;
    if (el.form) el.form.hidden = !state.hasKey;
    // The connect card follows whichever provider is active, so a Gemini or
    // OpenAI user is not told to look for an NVIDIA key.
    if (status) {
      const help = $('#ais-connect-help');
      const label = status.providerLabel || 'provider';
      if (help) help.textContent = 'Paste your ' + label + ' API key. It is stored encrypted on this device.';
      if (el.key) el.key.placeholder = status.keyPlaceholder || (label + ' API key');
    }
  }

  // ---------- difficulty chip ------------------------------------------------
  // The person picks how hard to think; the scout owns the model. No model
  // names appear anywhere on this surface.
  function paintDifficulty() {
    if (!el.difficulty) return;
    for (const btn of el.difficulty.querySelectorAll('.ais-diff')) {
      const on = btn.dataset.tier === state.difficulty;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }

  async function setDifficulty(tier) {
    const value = ['low', 'medium', 'high', 'max'].includes(tier) ? tier : 'medium';
    state.difficulty = value;
    paintDifficulty();
    try { await window.dexerion.invoke('dex:ai-difficulty-set', value); } catch {}
  }

  // ---------- suggestions ----------------------------------------------------
  function closeSuggest() {
    state.suggestItems = [];
    state.suggestIndex = -1;
    if (el.suggest) { el.suggest.hidden = true; el.suggest.replaceChildren(); }
  }

  function renderSuggest(items) {
    if (!el.suggest) return;
    state.suggestItems = (Array.isArray(items) ? items : []).filter(x => typeof x === 'string' && x.trim()).slice(0, 8);
    state.suggestIndex = state.suggestItems.length ? 0 : -1;
    el.suggest.replaceChildren();
    if (!state.suggestItems.length) { el.suggest.hidden = true; return; }
    state.suggestItems.forEach((text, index) => {
      const row = document.createElement('div');
      row.className = 'row' + (index === state.suggestIndex ? ' sel' : '');
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', index === state.suggestIndex ? 'true' : 'false');
      const mark = document.createElement('span');
      mark.className = 'mark';
      mark.innerHTML = SEARCH_ICON;
      const q = document.createElement('span');
      q.className = 'q';
      q.textContent = text;
      row.append(mark, q);
      row.onmousedown = (event) => { event.preventDefault(); pickSuggest(index); };
      el.suggest.appendChild(row);
    });
    el.suggest.hidden = false;
  }

  function moveSuggest(delta) {
    if (!state.suggestItems.length) return;
    state.suggestIndex = (state.suggestIndex + delta + state.suggestItems.length) % state.suggestItems.length;
    el.suggest.querySelectorAll('.row').forEach((row, index) => {
      const on = index === state.suggestIndex;
      row.classList.toggle('sel', on);
      row.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function pickSuggest(index) {
    const text = state.suggestItems[index];
    if (!text) return;
    el.input.value = text;
    closeSuggest();
    autosize();
    submit();
  }

  function scheduleSuggest() {
    if (state.mode !== 'search' || !state.config.suggestions) { closeSuggest(); return; }
    clearTimeout(state.suggestTimer);
    const query = el.input.value.trim();
    if (!query) { closeSuggest(); return; }
    state.suggestTimer = setTimeout(async () => {
      let items = [];
      try { items = await window.dexerion.invoke('dex:aisearch-suggest', query); } catch {}
      if (!state.open || state.mode !== 'search' || !state.config.suggestions) return;
      if (el.input.value.trim() !== query) return;
      renderSuggest(items);
    }, 160);
  }

  // ---------- message rendering ----------------------------------------------
  function addUser(text) {
    const row = document.createElement('div');
    row.className = 'ais-msg user';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    row.appendChild(bubble);
    el.msgs.appendChild(row);
    return row;
  }

  function addModel(text, search) {
    const row = document.createElement('div');
    row.className = 'ais-msg model';
    const who = document.createElement('span');
    who.className = 'who';
    who.innerHTML = MARK;
    who.setAttribute('aria-hidden', 'true');
    const body = document.createElement('div');
    body.className = 'text';
    if (text) renderMarkdown(body, text);
    row.append(who, body);
    if (search) appendSearchMeta(row, search);
    el.msgs.appendChild(row);
    return { root: row, body };
  }

  // Only the in-flight bubble is "live": completed history messages must never
  // receive streamed chunks after a close/reopen.
  function addLive(text) {
    const live = addModel(text);
    state.live = live;
    state.liveReq = state.reqId;
    return live;
  }

  // A run can outlive one surface open (close -> reopen mid-run). Completion
  // must paint the bubble that is on screen now, not the detached one it began
  // with — otherwise the answer text arrives via chunks but its source list is
  // written into a node nobody can see.
  function liveBubbleFor(reqId, fallback) {
    return (state.reqId === reqId && state.live && state.liveReq === reqId) ? state.live : fallback;
  }

  // ---------- working feed: dots + actions inside the assistant bubble -------
  function stepRow(step) {
    const row = document.createElement('div');
    row.className = 'ais-step';
    const ico = document.createElement('span');
    ico.className = 'ais-step-ico';
    ico.setAttribute('aria-hidden', 'true');
    ico.innerHTML = CHECK_ICON;
    const label = document.createElement('span');
    label.className = 'ais-step-label';
    label.textContent = step.label;
    row.append(ico, label);
    if (step.detail) {
      const detail = document.createElement('span');
      detail.className = 'ais-step-detail';
      detail.textContent = step.detail;
      row.appendChild(detail);
    }
    return row;
  }

  function paintWorking(live) {
    if (!live || !live.work) return;
    live.now.textContent = state.current ? state.current.label : 'Working…';
    const detail = state.current ? state.current.detail : '';
    live.detail.textContent = detail;
    live.detail.hidden = !detail;
    // Completed steps are append-only until the next trace. Keep their DOM
    // and SVGs; only a newly mounted bubble or reset needs the whole list.
    if (live.paintedSteps !== state.steps) {
      live.stepList.replaceChildren();
      live.paintedSteps = state.steps;
    }
    for (let i = live.stepList.childElementCount; i < state.steps.length; i++) {
      live.stepList.appendChild(stepRow(state.steps[i]));
    }
  }

  function mountWorking(live) {
    if (!live || live.work) return;
    const work = document.createElement('div');
    work.className = 'ais-work';
    const head = document.createElement('div');
    head.className = 'ais-work-head';
    const dots = document.createElement('span');
    dots.className = 'ais-dots';
    dots.setAttribute('aria-hidden', 'true');
    dots.innerHTML = '<i></i><i></i><i></i>';
    const now = document.createElement('span');
    now.className = 'ais-work-now';
    const detail = document.createElement('span');
    detail.className = 'ais-work-detail';
    detail.hidden = true;
    const stopButton = document.createElement('button');
    stopButton.type = 'button';
    stopButton.className = 'ais-work-stop';
    stopButton.textContent = 'Stop';
    stopButton.onclick = () => stop();
    head.append(dots, now, detail, stopButton);
    const list = document.createElement('div');
    list.className = 'ais-steps';
    work.append(head, list);
    live.root.insertBefore(work, live.body);
    live.work = work;
    live.now = now;
    live.detail = detail;
    live.stepList = list;
    paintWorking(live);
  }

  function beginWorking(live, label) {
    state.steps = [];
    state.current = label ? { label, detail: '' } : null;
    mountWorking(live);
  }

  function setCurrent(label, detail) {
    if (!label) return;
    const next = { label: String(label), detail: String(detail || '') };
    if (state.current && state.current.label === next.label && state.current.detail === next.detail) return;
    if (state.current) state.steps.push(state.current);
    state.current = next;
    if (state.live && state.liveReq === state.reqId) paintWorking(state.live);
  }

  function finishWorking(live, showActions) {
    if (live && live.work) live.work.remove();
    if (live) live.paintedSteps = null;
    if (state.current) state.steps.push(state.current);
    state.current = null;
    const steps = state.steps.slice();
    state.steps = [];
    if (!live || showActions === false || !steps.length) return;
    const details = document.createElement('details');
    details.className = 'ais-actions';
    const summary = document.createElement('summary');
    summary.textContent = 'Actions (' + steps.length + ')';
    details.appendChild(summary);
    const list = document.createElement('div');
    list.className = 'ais-steps';
    steps.forEach(step => list.appendChild(stepRow(step)));
    details.appendChild(list);
    // Settle under the answer, above the sources when they are present.
    const sources = live.root.querySelector('.ais-sources');
    live.root.insertBefore(details, sources || null);
    live.work = null;
    live.now = null;
    live.detail = null;
    live.stepList = null;
  }

  function appendSearchMeta(root, data) {
    const sources = (Array.isArray(data && data.sources) ? data.sources : [])
      .filter(s => s && /^https?:\/\//i.test(String(s.url || '')));
    const adaptations = (Array.isArray(data && data.adaptations) ? data.adaptations : [])
      .filter(q => typeof q === 'string' && q.trim());
    const stats = (data && data.stats) || {};
    const wrap = document.createElement('div');
    wrap.className = 'ais-sources';
    const head = document.createElement('h4');
    const seconds = stats.ms ? Math.max(1, Math.round(Number(stats.ms) / 1000)) : 0;
    head.textContent = 'Sources (' + sources.length + ')'
      + (seconds ? ' · ' + seconds + 's' : '')
      + (stats.blocked ? ' · some results were blocked' : '');
    wrap.appendChild(head);
    sources.forEach((source, index) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'ais-source';
      row.title = source.url;
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = '[' + (index + 1) + ']';
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = source.title || source.url;
      const d = document.createElement('span');
      d.className = 'd';
      d.textContent = hostOf(source.url);
      row.append(n, t, d);
      row.onclick = () => openUrl(source.url);
      wrap.appendChild(row);
    });
    if (adaptations.length) {
      const details = document.createElement('details');
      details.className = 'ais-adapt';
      const summary = document.createElement('summary');
      summary.textContent = 'Adapted searches (' + adaptations.length + ')';
      const chips = document.createElement('div');
      chips.className = 'chips';
      for (const query of adaptations) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = query;
        chips.appendChild(chip);
      }
      details.append(summary, chips);
      wrap.appendChild(details);
    }
    // Turn the grounded findings into a finished report in the same polished
    // document preview used everywhere else in Dexerion.
    if ((data && data.text) || (sources.length && data && data.query)) {
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'ais-to-report';
      action.textContent = 'Turn findings into a report';
      let madeRef = null; // set on success so the button becomes a reopen action
      action.onclick = async () => {
        if (action.disabled) return;
        if (madeRef) {
          try { await window.dexerion.invoke('dex:report-overlay-open', { chatId: madeRef.chatId, index: madeRef.index }); } catch {}
          return;
        }
        action.disabled = true;
        action.textContent = 'Writing report\u2026';
        try {
          const findings = {
            question: String((data && data.query) || ''),
            answer: String((data && data.text) || ''),
            sources: sources.map((s) => ({ title: s.title || '', url: s.url || '' })),
            searches: adaptations,
          };
          const made = await window.dexerion.invoke('dex:ai-report-generate', {
            reqId: 'search-report-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            prompt: 'Write a finished research report answering this question, using only the findings below as evidence.\n\nQuestion: ' + findings.question,
            context: JSON.stringify(findings),
          });
          if (!made || !made.ok) throw new Error((made && made.error) || 'The report could not be written.');
          madeRef = { chatId: made.chatId, index: made.index };
          action.textContent = 'View report';
          action.dataset.state = 'ready';
          await window.dexerion.invoke('dex:report-overlay-open', { chatId: made.chatId, index: made.index });
        } catch (err) {
          action.textContent = 'Could not write report \u2014 try again';
          setTimeout(() => { if (!madeRef) action.textContent = 'Turn findings into a report'; }, 2600);
        } finally {
          action.disabled = false;
        }
      };
      wrap.appendChild(action);
    }
    root.appendChild(wrap);
  }

  function renderThread() {
    if (!el.msgs) return;
    el.msgs.replaceChildren();
    state.live = null;
    const messages = hasMessages() ? state.chat.messages : [];
    for (const message of messages) {
      if (!message) continue;
      if (message.role === 'user') addUser(message.text || '');
      else addModel(message.text || '', message.search);
    }
    paintHero();
    scrollToEnd();
  }

  // ---------- chat persistence ----------------------------------------------
  async function ensureChat(title) {
    if (state.chat) return state.chat;
    try {
      state.chat = await window.dexerion.invoke('dex:ai-chat-create', { title: String(title || 'AI search').slice(0, 48) });
    } catch { state.chat = null; }
    return state.chat;
  }

  async function appendMessage(message) {
    if (!state.chat) return null;
    try {
      const updated = await window.dexerion.invoke('dex:ai-chat-append', { id: state.chat.id, message });
      if (updated) state.chat = updated;
    } catch {}
    return state.chat;
  }

  // ---------- status + busy ---------------------------------------------------
  function setStatus(label, steps) {
    if (!el.status) return;
    if (!label) { el.status.hidden = true; return; }
    el.status.hidden = false;
    el.statusLabel.textContent = label;
    if (el.statusSteps) el.statusSteps.textContent = steps || '';
  }

  function setBusy(next) {
    state.busy = Boolean(next);
    if (el.send) el.send.disabled = state.busy;
    if (el.status && !state.busy) el.status.hidden = true;
  }

  function stop() {
    if (!state.busy) return;
    if (state.runMode === 'search') {
      try { window.dexerion.invoke('dex:ai-search-stop', state.reqId).catch(() => {}); } catch {}
    } else {
      try { window.dexerion.invoke('dex:ai-stop', state.reqId).catch(() => {}); } catch {}
    }
  }

  // ---------- submit ----------------------------------------------------------
  function submit() {
    const text = el.input.value.replace(/\s+/g, ' ').trim();
    if (!text || state.busy) return;
    if (!state.hasKey) { el.connect.hidden = false; return; }
    closeSuggest();
    el.input.value = '';
    autosize();
    if (state.mode === 'chat') runChat(text);
    else runSearch(text);
  }

  async function runSearch(text) {
    await ensureChat(text);
    if (!state.chat) { setStatus('Could not open a chat', ''); return; }
    const chatId = state.chat.id;
    await appendMessage({ role: 'user', text });
    if (!state.chat || state.chat.id !== chatId) return; // a reset landed while the append was in flight
    addUser(text);
    paintHero();
    scrollToEnd();
    setBusy(true);
    const reqId = 'ais-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    state.reqId = reqId;
    state.runMode = 'search';
    state.streamed = '';
    const live = addLive('');
    beginWorking(live, 'Adapting your question');
    let result = null;
    try {
      const history = (state.chat.messages || []).slice(0, -1).slice(-12).map(m => ({ role: m.role, text: m.text }));
      result = await window.dexerion.invoke('dex:ai-search-run', { reqId, query: text, history });
    } catch (err) {
      result = { ok: false, error: String((err && err.message) || err || 'The search could not run.') };
    }
    try {
      // The run belongs to the chat it started in: a New chat or a reset while
      // the pipeline was working must not receive this late answer.
      if (!state.chat || state.chat.id !== chatId) return;
      const target = liveBubbleFor(reqId, live);
      if (!result || !result.ok) {
        target.body.textContent = (result && result.error) || 'The search could not run.';
        // A failed synthesis still read real pages: keep them visible.
        if (result && Array.isArray(result.sources) && result.sources.length) appendSearchMeta(target.root, result);
        finishWorking(target);
        return;
      }
      const answer = String(result.text || '').trim();
      if (!answer) {
        target.body.textContent = result.cancelled
          ? 'Stopped before an answer was written.'
          : 'No answer came back — try rephrasing the question.';
        finishWorking(target);
        return;
      }
      target.body.replaceChildren();
      renderMarkdown(target.body, answer);
      appendSearchMeta(target.root, result);
      finishWorking(target);
      await appendMessage({
        role: 'model',
        text: answer,
        search: {
          adaptations: result.adaptations || [],
          sources: result.sources || [],
          stats: result.stats || null,
        },
      });
      scrollToEnd();
    } finally {
      if (state.reqId === reqId) {
        state.live = null;
        state.liveReq = '';
        setBusy(false);
        setStatus('', '');
        paintHero();
        scrollToEnd();
      }
    }
  }

  async function runChat(text) {
    await ensureChat(text);
    if (!state.chat) { setStatus('Could not open a chat', ''); return; }
    const chatId = state.chat.id;
    await appendMessage({ role: 'user', text });
    if (!state.chat || state.chat.id !== chatId) return;
    addUser(text);
    paintHero();
    scrollToEnd();
    setBusy(true);
    const reqId = 'aischat-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    state.reqId = reqId;
    state.runMode = 'chat';
    state.chunkReq = reqId;
    state.streamed = '';
    const live = addLive('');
    beginWorking(live, 'Thinking');
    let result = null;
    try {
      result = await window.dexerion.invoke('dex:ai-send', {
        reqId,
        chatId,
        messages: state.chat.messages,
      });
    } catch (err) {
      result = { ok: false, error: String((err && err.message) || err || 'The message could not be sent.') };
    }
    try {
      if (!state.chat || state.chat.id !== chatId) return;
      const target = liveBubbleFor(reqId, live);
      if (!result || !result.ok) {
        target.body.textContent = (result && result.error) || 'The message could not be sent.';
        finishWorking(target, false);
        return;
      }
      const answer = String(result.text || '').trim();
      if (!answer) {
        target.body.textContent = result.cancelled ? 'Stopped.' : 'No reply came back.';
        finishWorking(target, false);
        return;
      }
      target.body.replaceChildren();
      renderMarkdown(target.body, answer);
      finishWorking(target, false);
      await appendMessage({ role: 'model', text: answer });
      scrollToEnd();
    } finally {
      if (state.reqId === reqId) {
        state.chunkReq = '';
        state.live = null;
        state.liveReq = '';
        setBusy(false);
        setStatus('', '');
        paintHero();
        scrollToEnd();
      }
    }
  }

  // ---------- open / close / new ---------------------------------------------
  function setMode(mode) {
    state.mode = mode === 'chat' ? 'chat' : 'search';
    document.querySelectorAll('.ais-mode').forEach(button => {
      const on = button.dataset.mode === state.mode;
      button.classList.toggle('on', on);
      button.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    closeSuggest();
    paintHero();
    focusInput();
  }

  function open(config) {
    if (!el.root) return;
    state.open = true;
    state.config = Object.assign({ suggestions: false, sources: 8, adaptations: 4, difficulty: 'medium' }, config || {});
    if (['low', 'medium', 'high', 'max'].includes(state.config.difficulty)) state.difficulty = state.config.difficulty;
    paintDifficulty();
    if (state.config.accent) {
      try { el.root.style.setProperty('--accent', String(state.config.accent)); } catch {}
    }
    el.root.hidden = false;
    document.body.classList.add('ais-open');
    renderThread();
    // Reopened mid-run: attach a live bubble for the still-running request so
    // the stream lands in the right place (never in a completed message).
    if (state.busy && state.reqId) {
      const live = addLive(state.streamed);
      mountWorking(live);
    }
    paintHero();
    focusInput();
    loadStatus();
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    closeSuggest();
    el.root.hidden = true;
    document.body.classList.remove('ais-open');
    try { window.dexerion.invoke('dex:aisearch-close').catch(() => {}); } catch {}
  }

  function fresh() {
    if (state.busy) stop();
    state.chat = null;
    state.reqId = null;
    state.chunkReq = '';
    state.live = null;
    state.liveReq = '';
    state.streamed = '';
    state.steps = [];
    state.current = null;
    setBusy(false);
    if (el.msgs) el.msgs.replaceChildren();
    setStatus('', '');
    setMode('search');
    if (el.input) { el.input.value = ''; autosize(); }
    paintHero();
    focusInput();
  }

  function onKeydown(event) {
    if (!state.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (el.suggest && !el.suggest.hidden) { closeSuggest(); return; }
      close();
      return;
    }
    if (!el.suggest || el.suggest.hidden) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); moveSuggest(1); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); moveSuggest(-1); return; }
    if (event.key === 'Enter' && state.suggestIndex >= 0) {
      event.preventDefault();
      pickSuggest(state.suggestIndex);
    }
  }

  function init() {
    el.root = $('#ais');
    if (!el.root) return;
    el.scroll = $('#ais-scroll');
    el.hero = $('#ais-hero');
    el.msgs = $('#ais-msgs');
    el.form = $('#ais-form');
    el.input = $('#ais-input');
    el.send = $('#ais-send');
    el.difficulty = $('#ais-difficulty');
    el.hint = $('#ais-hint');
    el.suggest = $('#ais-suggest');
    el.status = $('#ais-status');
    el.statusLabel = $('#ais-status-label');
    el.connect = $('#ais-connect');
    el.key = $('#ais-key');
    el.keySave = $('#ais-key-save');
    el.keyMsg = $('#ais-key-msg');

    el.form.addEventListener('submit', (event) => { event.preventDefault(); submit(); });
    el.input.addEventListener('input', () => { autosize(); scheduleSuggest(); });
    el.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        if (el.suggest && !el.suggest.hidden && state.suggestIndex >= 0) pickSuggest(state.suggestIndex);
        else submit();
      }
      // Escape is handled once by the document listener (closing the surface
      // twice would also fire when the suggestion list is open).
    });
    document.querySelectorAll('.ais-mode').forEach(button => {
      button.onclick = () => setMode(button.dataset.mode || 'search');
    });
    $('#ais-new').onclick = () => fresh();
    $('#ais-close').onclick = () => close();
    document.addEventListener('keydown', onKeydown);
    if (el.difficulty) {
      el.difficulty.addEventListener('click', (event) => {
        const btn = event.target && event.target.closest ? event.target.closest('.ais-diff') : null;
        if (btn && btn.dataset.tier) setDifficulty(btn.dataset.tier);
      });
    }

    el.keySave.onclick = async () => {
      const key = String(el.key.value || '').trim();
      if (!key) return;
      el.keyMsg.textContent = 'Checking your key and loading models…';
      try {
        await window.dexerion.invoke('dex:ai-key-set', key);
        await window.dexerion.invoke('dex:ai-models-refresh').catch(() => {});
        const result = await window.dexerion.invoke('dex:ai-test');
        if (!result || !result.ok) throw new Error((result && result.error) || 'Connection failed.');
        el.key.value = '';
        el.keyMsg.textContent = 'Connected.';
        await loadStatus();
        focusInput();
      } catch (err) {
        el.keyMsg.textContent = String((err && err.message) || err || 'Could not save the key.');
      }
    };

    window.dexerion.on('dex:aisearch-show', (config) => open(config));
    window.dexerion.on('dex:ai-chunk', (payload) => {
      if (!payload || !state.chunkReq || payload.reqId !== state.chunkReq) return;
      if (!state.live || state.liveReq !== payload.reqId) return;
      state.streamed = payload.full != null ? String(payload.full) : (state.streamed + String(payload.delta || ''));
      state.live.body.textContent = state.streamed;
      scrollToEnd();
    });
    window.dexerion.on('dex:ai-search-progress', (payload) => {
      if (!payload || payload.reqId !== state.reqId) return;
      if (payload.phase === 'chunk') {
        state.streamed = payload.full != null ? String(payload.full) : (state.streamed + String(payload.delta || ''));
        if (state.live && state.liveReq === payload.reqId) { state.live.body.textContent = state.streamed; scrollToEnd(); }
        return;
      }
      if (payload.phase === 'adapt') setCurrent('Adapting your question');
      else if (payload.phase === 'adapted') {
        const n = Array.isArray(payload.adaptations) ? payload.adaptations.length : 0;
        setCurrent(n ? 'Wrote ' + n + ' searches' : 'Planned the searches');
      } else if (payload.phase === 'search') {
        setCurrent(payload.label || ('Searching ' + payload.i + ' of ' + payload.n), payload.query || '');
      } else if (payload.phase === 'read') {
        setCurrent(payload.label || ('Reading ' + payload.i + ' of ' + payload.n), payload.host || '');
      } else if (payload.phase === 'write') {
        setCurrent('Writing the answer');
      }
    });

    window.dexAiSearch = { open, close, focus: focusInput };
  }

  init();
})();
