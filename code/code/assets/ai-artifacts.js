// Dexerion artifact renderer — application-owned components for generated
// reports, quizzes, flashcards, charts, timelines and sandboxed websites.
//
// Model text never enters this module as markup. Every string is written with
// textContent; the only raw HTML is the site artifact's `srcdoc`, which runs
// in an opaque-origin iframe with `allow-scripts` (no same-origin, no top
// navigation) and a deny-by-default CSP. Shared by the AI sidebar and the new
// tab chat; both pages load it after DexMarkdown.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DexArtifacts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const GLOBAL = typeof globalThis !== 'undefined' ? globalThis : null;
  // The real window: in the app GLOBAL.window is the renderer window, and under
  // the test harness GLOBAL.window is the jsdom window.
  const HOST = (GLOBAL && GLOBAL.window) || (typeof window !== 'undefined' ? window : null);

  const KINDS = ['report', 'site', 'quiz', 'deck', 'chart', 'timeline'];
  const LABELS = {
    report: 'Report',
    site: 'Interactive preview',
    quiz: 'Quiz',
    deck: 'Flashcards',
    chart: 'Chart',
    timeline: 'Timeline',
  };
  const SITE_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
    + "img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; "
    + "form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'";
  // Mirror of main's DEX_VIEWPORT_FILL_CSS for the srcdoc fallback: a tiny
  // generated card must still render as a full-frame page when the served-host
  // path is unavailable. Same marker, same rules; never touches site scripts.
  const SITE_VIEWPORT_CSS = '<style data-dex-viewport="1">'
    + 'html,html>body{margin:0!important;padding:0!important;width:100%!important;max-width:none!important;min-width:0!important;box-sizing:border-box!important;}'
    + 'html>body{min-height:100vh!important;min-height:100dvh!important;display:block!important;place-items:initial!important;align-items:initial!important;justify-content:initial!important;}'
    + 'html>body>*:not(script):not(style):not(template):not(dialog){width:100%!important;max-width:none!important;min-width:0!important;margin-left:0!important;margin-right:0!important;box-sizing:border-box!important;}'
    + '</style>';
  const MAX_HTML = 400000;

  function node(doc, tag, cls, text) {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null && text !== '') n.textContent = String(text);
    return n;
  }

  function svgNode(doc, tag, attrs) {
    const n = doc.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const key of Object.keys(attrs || {})) n.setAttribute(key, String(attrs[key]));
    return n;
  }

  function str(value, max) {
    return String(value == null ? '' : value).slice(0, max || 4000);
  }

  function arr(value) {
    return Array.isArray(value) ? value : [];
  }

  // In-text citation markers ("[1]", "[2]" …) become links to their numbered
  // reference, so a claim and its source are one click apart in the render and
  // in every export. Code spans and fenced code are left untouched, and a
  // marker without a matching reference stays literal text.
  // (The main process keeps a mirror of this for its Markdown export; both are
  // pinned by tests.)
  function linkifyCitations(value, urls) {
    const list = Array.isArray(urls) ? urls : [];
    if (!list.length) return String(value == null ? '' : value);
    const parts = String(value).split(/(```[\s\S]*?```|`[^`]*`)/g);
    return parts.map((part, i) => {
      if (i % 2 === 1) return part;   // captured code span / fenced block
      return part.replace(/\[(\d{1,2})\]/g, (whole, n) => {
        const url = list[Number(n) - 1];
        return url ? '[' + n + '](' + url + ')' : whole;
      });
    }).join('');
  }

  // Best-effort memory of the last preview state per chat (page + width), so
  // reopening a site lands where the person left it. localStorage can be
  // unavailable; every access is wrapped and failure is silent — memory is a
  // courtesy, never a correctness dependency.
  function previewPrefsGet(chatId) {
    try {
      const ls = HOST && HOST.localStorage;
      const raw = ls && chatId ? ls.getItem('dxa-preview:' + chatId) : null;
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch { return {}; }
  }
  function previewPrefsSet(chatId, patch) {
    try {
      const ls = HOST && HOST.localStorage;
      if (!ls || !chatId) return;
      ls.setItem('dxa-preview:' + chatId, JSON.stringify(Object.assign({}, previewPrefsGet(chatId), patch)));
    } catch { /* memory is optional */ }
  }

  // ---------- annotation anchors (V15) --------------------------------------
  // A note anchors to a passage: its block + the exact quote + a little
  // surrounding context + a UTF-16 offset hint. Quote failures are loud and
  // offsets fail silently, so resolution is a cascade (exact → quote search
  // with context/occurrence tie-breakers → prefix-tail fuzzy) that ends in an
  // explicit 'orphaned' state — a note is never silently dropped because the
  // text around it moved.
  const ANNO_QUOTE_MAX = 200;
  const ANNO_CONTEXT = 32;

  function blockTextOf(el) {
    return String(el && el.textContent != null ? el.textContent : '');
  }

  // The UTF-16 offset of a DOM point inside the element's concatenated text.
  function offsetInBlock(el, node, nodeOffset) {
    const doc = (el && el.ownerDocument) || GLOBAL.document;
    if (!doc || !node) return -1;
    if (node === el) {
      // A point on the element itself: offset counts child NODES, so sum the
      // text of the children before it.
      let sum = 0;
      for (const kid of Array.from(el.childNodes).slice(0, nodeOffset)) {
        sum += String(kid.textContent || '').length;
      }
      return sum;
    }
    let sum = 0;
    const walker = doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */, null);
    let n;
    while ((n = walker.nextNode())) {
      if (n === node) return sum + Math.min(nodeOffset, n.data.length);
      sum += n.data.length;
    }
    return -1;
  }

  function pointAtOffset(el, offset) {
    const doc = (el && el.ownerDocument) || GLOBAL.document;
    if (!doc) return null;
    const walker = doc.createTreeWalker(el, 4, null);
    let sum = 0;
    let last = null;
    let n;
    while ((n = walker.nextNode())) {
      last = n;
      const len = n.data.length;
      if (offset <= sum + len) return { node: n, off: Math.max(0, offset - sum) };
      sum += len;
    }
    // Offsets past the end clamp to the last text node instead of failing:
    // a collapsed tail is more honest than a lost highlight.
    if (last) return { node: last, off: last.data.length };
    return null;
  }

  function rangeFromOffsets(el, start, length) {
    const doc = (el && el.ownerDocument) || GLOBAL.document;
    if (!doc || start < 0 || length <= 0) return null;
    const a = pointAtOffset(el, start);
    const b = pointAtOffset(el, start + length);
    if (!a || !b) return null;
    try {
      const range = doc.createRange();
      range.setStart(a.node, a.off);
      range.setEnd(b.node, b.off);
      return range;
    } catch { return null; }
  }

  // A Range → a storable anchor. Returns null when the range carries no text.
  function anchorFromRange(blockEl, range) {
    if (!blockEl || !range) return null;
    let quote = '';
    try { quote = String(range.toString ? range.toString() : ''); } catch { quote = ''; }
    quote = quote.replace(/^\s+|\s+$/g, '').slice(0, ANNO_QUOTE_MAX);
    if (!quote) return null;
    const text = blockTextOf(blockEl);
    const start = offsetInBlock(blockEl, range.startContainer, range.startOffset);
    if (start < 0) return null;
    let occurrence = 1;
    let at = text.indexOf(quote);
    while (at !== -1 && at < start) { occurrence += 1; at = text.indexOf(quote, at + 1); }
    return {
      blockId: String(blockEl.dataset ? blockEl.dataset.blockIndex : ''),
      quote,
      prefix: text.slice(Math.max(0, start - ANNO_CONTEXT), start),
      suffix: text.slice(start + quote.length, start + quote.length + ANNO_CONTEXT),
      offset: start,
      occurrence,
    };
  }

  // The resolve cascade: { status: 'ok' | 'moved' | 'orphaned', range }.
  function resolveAnchor(blockEl, ann) {
    const a = ann || {};
    const quote = String(a.quote || '');
    if (!blockEl || !quote) return { status: 'orphaned', range: null };
    const text = blockTextOf(blockEl);
    const offset = Number(a.offset);
    if (Number.isInteger(offset) && offset >= 0 && text.slice(offset, offset + quote.length) === quote) {
      const range = rangeFromOffsets(blockEl, offset, quote.length);
      if (range) return { status: 'ok', range };
    }
    const hits = [];
    let at = text.indexOf(quote);
    while (at !== -1) { hits.push(at); at = text.indexOf(quote, at + 1); }
    if (hits.length) {
      let pick = hits.length === 1 ? hits[0] : null;
      // Context disambiguation only when there IS context: an empty prefix
      // and suffix would "match" every occurrence and win the first one
      // outright, defeating the occurrence counter.
      if (pick === null && (a.prefix || a.suffix)) {
        const pre = String(a.prefix || '');
        const post = String(a.suffix || '');
        const scored = hits.find((h) => {
          const p = pre ? text.slice(Math.max(0, h - pre.length), h).endsWith(pre) : true;
          const s = post ? text.slice(h + quote.length, h + quote.length + post.length).startsWith(post) : true;
          return p && s;
        });
        if (scored !== undefined) pick = scored;
      }
      if (pick === null) {
        const occ = Math.max(1, Number(a.occurrence) || 1);
        pick = hits[Math.min(occ - 1, hits.length - 1)];
      }
      const range = rangeFromOffsets(blockEl, pick, quote.length);
      if (range) return { status: 'moved', range };
    }
    // Fuzzy: the passage itself changed; follow the context when it survives.
    const pre = String(a.prefix || '');
    const want = Math.max(4, Math.min(ANNO_QUOTE_MAX, quote.length));
    for (let cut = pre.length; cut >= 8; cut -= 4) {
      const probe = pre.slice(-cut);
      const hit = probe ? text.indexOf(probe) : -1;
      if (hit === -1) continue;
      const start = hit + probe.length;
      const len = Math.min(want, Math.max(0, text.length - start));
      if (len < 4) continue;
      const range = rangeFromOffsets(blockEl, start, len);
      if (range) return { status: 'moved', range };
    }
    return { status: 'orphaned', range: null };
  }

  // ---------- integration: one URL builder (V18) -----------------------------
  // The URL a listing or search hit opens. Reports deep-link to the matched
  // block (`&b=N` — the viewer lands on that section and flashes it) and can
  // arrive with a feature panel open (`?panel=notes|toc|search`); every other
  // kind opens in the artifact view. One builder, so Files, the card's notes
  // chip and anything later cannot drift apart.
  function artifactUrl(target, opts) {
    const t = target || {};
    const o = opts || {};
    const route = (t.kind && t.kind !== 'report') ? 'artifact' : 'report';
    const q = ['chat=' + encodeURIComponent(String(t.chatId || ''))];
    const idx = Number(t.index);
    if (Number.isInteger(idx) && idx >= 0) q.push('i=' + String(idx));
    if (route === 'report') {
      const b = Number(o.blockIndex != null ? o.blockIndex : t.blockIndex);
      if (Number.isInteger(b) && b >= 0) q.push('b=' + String(b));
      if (o.panel && ['notes', 'toc', 'search'].includes(String(o.panel))) {
        q.push('panel=' + encodeURIComponent(String(o.panel)));
      }
    }
    return 'dexerion://' + route + '?' + q.join('&');
  }

  // ---------- reading navigation (V16) --------------------------------------
  // Which table-of-contents row is "current": the last heading whose offset is
  // at or above the reading line; the first while the top is still above the
  // page. Pure (offsets in px, no DOM) so it is testable without a viewport.
  function tocActiveIndex(positions, line) {
    const list = Array.isArray(positions) ? positions : [];
    const threshold = Number.isFinite(line) ? line : 96;
    if (!list.length) return -1;
    let active = 0;
    for (let i = 0; i < list.length; i++) {
      const top = Number(list[i]);
      if (Number.isFinite(top) && top <= threshold) active = i;
    }
    return active;
  }

  // "1 file" reads like a count; "1 files" reads like a bug.
  function fileCountLabel(n) {
    const k = Math.max(0, Math.round(num(n)));
    return k === 1 ? '1 file' : k + ' files';
  }

  function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  // The closed look sets, shared with the main process validator and the
  // report page's design controls.
  const REPORT_THEMES = ['clean', 'editorial', 'brief', 'modern', 'magazine', 'academic', 'notebook', 'executive', 'minimal', 'creative', 'technical', 'playful'];
  const REPORT_PAPERS = ['paper', 'white', 'pink', 'blue', 'green', 'lavender', 'peach', 'grey', 'sand', 'slate', 'ivory', 'mist'];
  const REPORT_PATTERNS = ['solid', 'hatch', 'diagonal'];
  const REPORT_FONTS = ['editorial', 'neutral', 'typewriter'];

  function markdown(doc, value, opts) {
    const cites = opts && opts.citations;
    const source = cites && cites.length ? linkifyCitations(value, cites) : value;
    const holder = doc.createElement('div');
    holder.className = 'dxa-md';
    if (opts && typeof opts.markdown === 'function') {
      opts.markdown(holder, source);
    } else if (GLOBAL && GLOBAL.DexMarkdown && typeof GLOBAL.DexMarkdown.render === 'function') {
      GLOBAL.DexMarkdown.render(holder, source, { onLink: opts && opts.onLink });
    } else {
      holder.textContent = String(source || '');
    }
    // The linkifier emits the only marker syntax the markdown pipeline keeps
    // intact — `[n](url)`, whose visible text is the bare number. The reader-
    // facing form is `[n]`, so the brackets are restored here on the anchors
    // this pass created (matched by label + exact reference URL). Exports that
    // go through this DOM renderer (HTML, Word, PDF) keep the brackets too.
    if (cites && cites.length) {
      try {
        for (const a of holder.querySelectorAll('a')) {
          const href = a.getAttribute('href');
          const n = Number(a.textContent);
          if (href && Number.isInteger(n) && n >= 1 && n <= cites.length && href === cites[n - 1]) {
            a.textContent = '[' + n + ']';
            a.classList.add('dxa-cite');
          }
        }
      } catch { /* decoration only — never fail a render over it */ }
    }
    return holder;
  }

  function toast(opts, message) {
    if (opts && typeof opts.onToast === 'function') { try { opts.onToast(message); } catch {} }
  }

  function linkButton(doc, label, url, opts) {
    const b = node(doc, 'button', 'dxa-link', label);
    b.type = 'button';
    b.title = url;
    b.onclick = () => { if (opts && typeof opts.onLink === 'function') opts.onLink(url); };
    return b;
  }

  // Live progress while a reply is still streaming: "Building the artifact —
  // 6 blocks" beats a spinner nobody can trust. Reads the partial JSON with
  // counting regexes only, so a half-written document is never parsed (and a
  // half-written document can never throw).
  function progress(source) {
    const s = String(source || '');
    const fence = s.lastIndexOf('```dex-artifact');
    const open = fence >= 0 ? fence : s.lastIndexOf('```dex_artifact');
    const start = open >= 0 ? open : s.lastIndexOf('```artifact');
    if (start < 0) return null;
    const body = s.slice(start);
    const closed = body.indexOf('```', body.indexOf('\n') + 1);
    const kind = (/"kind"\s*:\s*"(\w+)"/.exec(body) || [])[1] || '';
    const title = (/"title"\s*:\s*"((?:[^"\\]|\\.){0,80})/.exec(body) || [])[1] || '';
    const count = (re) => (body.match(re) || []).length;
    const blocks = count(/"type"\s*:\s*"/g);
    const files = count(/"path"\s*:\s*"/g);
    const parts = [];
    if (kind) parts.push(kind);
    if (blocks) parts.push(blocks + (kind === 'quiz' ? ' question' : kind === 'deck' ? ' card' : ' block') + (blocks === 1 ? '' : 's'));
    if (files) parts.push(files + ' file' + (files === 1 ? '' : 's'));
    return {
      kind,
      title: title ? title.replace(/\\"/g, '"') : '',
      blocks,
      files,
      complete: closed > 0,
      label: parts.length ? 'Building ' + parts.join(' · ') : 'Building the artifact',
    };
  }

  // The sources behind a card: the files a site was built from, plus the
  // artifact JSON the model produced. Read-only for now (editing lands in the
  // live-edit pass); shipped so the Code panel can show what actually ran.
  function sources(artifact) {
    const out = [];
    if (!artifact) return out;
    if (artifact.kind === 'site' && arr(artifact.files).length) {
      arr(artifact.files).forEach((f) => out.push({ name: f.path || 'file', content: String(f.content || '') }));
    } else if (artifact.kind === 'site') {
      out.push({ name: 'index.html', content: String(artifact.html || '') });
    }
    out.push({ name: 'artifact.json', content: JSON.stringify(artifact, null, 2) });
    return out;
  }

  // Code panel: one tab per source file. Website artifacts are editable in
  // place — Save writes through the validator and keeps the previous version,
  // so the card can be edited, reverted and restored without a model round
  // trip. Everything else is read-only source plus copy.
  function renderSources(doc, artifact, ctx) {
    const options = ctx || {};
    const wrap = node(doc, 'div', 'dxa-code');
    const tabs = node(doc, 'div', 'dxa-code-tabs');
    const body = node(doc, 'pre', 'dxa-code-body');
    const code = node(doc, 'code', '');
    body.appendChild(code);
    const editable = artifact.kind === 'site' && options.chatId && Number.isInteger(options.index);
    const drafts = new Map();
    const files = sources(artifact);
    let active = 0;
    const applyNext = (next) => {
      if (!next) return;
      const card = wrap.closest ? wrap.closest('.dxa-card') : null;
      const frame = card ? card.querySelector('.dxa-frame') : null;
      const site = card ? card.querySelector('.dxa-site') : null;
      // A served site reloads through its own hook (re-register + navigate);
      // the srcdoc form falls back to the flattened document as before.
      if (site && typeof site.__dxaReload === 'function') site.__dxaReload(next);
      else if (frame && next.html) frame.srcdoc = safeSiteHtml(next.html);
      const chip = card ? card.querySelector('.dxa-files') : null;
      if (chip && arr(next.files).length) chip.textContent = fileCountLabel(arr(next.files).length);
      // A saved fix replaces the old symptoms: clear the health strip so a
      // pre-edit error message does not sit over working code.
      const strip = card ? card.querySelector('.dxa-issues') : null;
      if (strip && next.html && String(next.html).trim()) strip.hidden = true;
      if (typeof options.onSaved === 'function') options.onSaved(next);
    };
    const paint = () => {
      const file = files[active];
      Array.from(tabs.children).forEach((b, i) => {
        b.classList.toggle('on', i === active);
        // The active file tab is a state, not an independent toggle.
        b.setAttribute('aria-pressed', i === active ? 'true' : 'false');
      });
      if (editor) editor.dataset.file = file ? file.name : '';
      else code.textContent = file ? file.content : '';
      body.dataset.file = file ? file.name : '';
    };
    // The editable surface is a plain textarea inside the body: monospace,
    // scrollable, and it keeps the file name in a data attribute for tests and
    // for the save payload.
    const editor = editable ? doc.createElement('textarea') : null;
    if (editor) {
      editor.className = 'dxa-code-edit';
      editor.spellcheck = false;
      editor.setAttribute('aria-label', 'Edit source file');
      body.textContent = '';
      body.appendChild(editor);
    }
    // Drafts are keyed by file name so adding or removing a file never has to
    // re-index anyone else's unsaved text.
    const remember = () => { if (editor) drafts.set(files[active].name, editor.value); };
    const select = (file) => {
      if (editor) remember();
      const at = files.indexOf(file);
      if (at < 0) return;
      active = at;
      paint();
      if (editor) editor.value = drafts.has(file.name) ? drafts.get(file.name) : file.content;
    };
    files.forEach((file) => {
      const tab = node(doc, 'button', 'dxa-code-tab', file.name);
      tab.type = 'button';
      tab.setAttribute('aria-pressed', 'false');
      tab.onclick = () => select(file);
      tabs.appendChild(tab);
    });
    // Closing lives in the panel itself: the card's ⋯ menu is gone by the time
    // the panel is open.
    if (typeof options.onClose === 'function') {
      const closeBtn = node(doc, 'button', 'dxa-btn dxa-btn-quiet dxa-code-close', 'Close');
      closeBtn.type = 'button';
      closeBtn.onclick = () => options.onClose();
      tabs.appendChild(closeBtn);
    }
    const copyBtn = node(doc, 'button', 'dxa-btn dxa-btn-quiet dxa-code-copy', 'Copy file');
    copyBtn.type = 'button';
    copyBtn.onclick = () => {
      const value = editor ? editor.value : (files[active] ? files[active].content : '');
      try {
        const p = navigator.clipboard.writeText(value);
        if (p && p.then) p.catch(() => {});
      } catch { /* clipboard unavailable */ }
    };
    tabs.appendChild(copyBtn);

    // Adding and removing files turns the panel into a small project editor:
    // a single-page result can be split up, and a stray file deleted, without
    // another model round trip.
    const addFile = (name) => {
      const path = String(name || '').trim();
      if (!path) return false;
      if (!/^[\w./-]+$/.test(path) || path.includes('..') || path.startsWith('/')) {
        toast(options, 'Use a relative path like assets/app.js.');
        return false;
      }
      if (files.some((f) => f.name.toLowerCase() === path.toLowerCase())) {
        toast(options, 'That file already exists.');
        return false;
      }
      const fileObj = { name: path, content: '' };
      files.push(fileObj);
      drafts.set(path, '');
      const tab = node(doc, 'button', 'dxa-code-tab', path);
      tab.type = 'button';
      tab.onclick = () => select(fileObj);
      tabs.insertBefore(tab, copyBtn);
      select(fileObj);
      return true;
    };

    if (editor && options.chatId && Number.isInteger(options.index)) {
      const newName = doc.createElement('input');
      newName.type = 'text';
      newName.className = 'dxa-code-newfile';
      newName.placeholder = 'new file…';
      newName.setAttribute('aria-label', 'New file path');
      const add = node(doc, 'button', 'dxa-btn dxa-btn-quiet dxa-code-add', '＋ File');
      add.type = 'button';
      add.onclick = () => { if (addFile(newName.value)) newName.value = ''; };
      newName.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); if (addFile(newName.value)) newName.value = ''; }
      });
      const remove = node(doc, 'button', 'dxa-btn dxa-btn-quiet dxa-code-remove', 'Delete file');
      remove.type = 'button';
      remove.onclick = () => {
        const gone = files[active];
        if (!gone || gone.name === 'artifact.json') { toast(options, 'That view cannot be deleted.'); return; }
        const remaining = files.filter((f) => f.name !== 'artifact.json');
        if (remaining.length <= 1) { toast(options, 'A website needs at least one file.'); return; }
        drafts.delete(gone.name);
        const goneTab = Array.from(tabs.children).find((b) => b.textContent === gone.name);
        if (goneTab) goneTab.remove();
        files.splice(active, 1);
        active = 0;
        paint();
        if (editor) editor.value = files[0] ? files[0].content : '';
        toast(options, 'Removed ' + gone.name + ' (unsaved).');
      };
      tabs.append(newName, add, remove);
      const save = node(doc, 'button', 'dxa-btn dxa-btn-primary dxa-code-save', 'Save');
      save.type = 'button';
      let saving = false;
      save.onclick = () => {
        const bridge = GLOBAL && GLOBAL.dexerion;
        if (!bridge || typeof bridge.invoke !== 'function') { toast(options, 'Editing needs the app.'); return; }
        // A double-click used to fire two saves: two history snapshots and a
        // double version bump for one edit (V20 polish pass).
        if (saving) { toast(options, 'Already saving — one moment.'); return; }
        saving = true;
        if (editor) remember();
        const payloadFiles = files
          .filter((f) => f.name !== 'artifact.json')
          .map((f) => ({ path: f.name, content: drafts.has(f.name) ? drafts.get(f.name) : f.content }));
        Promise.resolve(bridge.invoke('dex:ai-artifact-source-save', {
          chatId: options.chatId, index: options.index, files: payloadFiles, note: 'edited in Code',
        })).then((res) => {
          saving = false;
          if (!res || !res.ok) { toast(options, (res && res.error) || 'Save failed.'); return; }
          toast(options, 'Saved v' + res.version + ' (' + payloadFiles.length + ' files).');
          applyNext(res.artifact);
          rerender(res.artifact);
        }, () => {
          saving = false;
          toast(options, 'Save failed.');
        });
      };
      const revert = node(doc, 'button', 'dxa-btn dxa-btn-quiet dxa-code-revert', 'Revert');
      revert.type = 'button';
      revert.onclick = () => {
        drafts.clear();
        if (editor) { editor.value = files[active] ? files[active].content : ''; }
        toast(options, 'Reverted the unsaved edit.');
      };
      tabs.append(save, revert);
    }

    // Version list: restore any kept snapshot (newest first).
    const history = arr(artifact.history);
    if (history.length) {
      const versions = node(doc, 'div', 'dxa-versions');
      versions.appendChild(node(doc, 'span', 'dxa-versions-label',
        'v' + (Number(artifact.version) || 1) + ' · ' + history.length + ' earlier'));
      history.forEach((h) => {
        const at = Number(h.at) || 0;
        const label = 'v' + (Number(h.artifact && h.artifact.version) || 1)
          + (at ? ' · ' + new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '');
        const restore = node(doc, 'button', 'dxa-code-tab dxa-restore', label);
        restore.type = 'button';
        restore.title = h.note || 'Restore this version';
        restore.onclick = () => {
          const bridge = GLOBAL && GLOBAL.dexerion;
          if (!bridge || typeof bridge.invoke !== 'function') { toast(options, 'Restore needs the app.'); return; }
          Promise.resolve(bridge.invoke('dex:ai-artifact-restore', {
            chatId: options.chatId, index: options.index, at: h.at,
          })).then((res) => {
            if (!res || !res.ok) { toast(options, (res && res.error) || 'Restore failed.'); return; }
            toast(options, 'Restored.');
            applyNext(res.artifact);
            rerender(res.artifact);
          }, () => toast(options, 'Restore failed.'));
        };
        versions.appendChild(restore);
      });
      wrap.appendChild(versions);
    }

    function rerender(next) {
      const mine = wrap;
      const fresh = renderSources(doc, next, options);
      mine.replaceWith(fresh);
    }

    wrap.append(tabs, body);
    if (editor) editor.value = files[0] ? files[0].content : '';
    paint();
    return wrap;
  }

  // Project export: the real files as a .zip, written by the main process.
  function downloadProject(artifact, opts) {
    const bridge = GLOBAL && GLOBAL.dexerion;
    if (!bridge || typeof bridge.invoke !== 'function') { toast(opts, 'Project download needs the app.'); return; }
    Promise.resolve(bridge.invoke('dex:ai-artifact-zip', { artifact })).then((res) => {
      if (res && res.ok) toast(opts, 'Saved ' + (res.files ? res.files.length : '') + ' files.');
      else if (res && res.canceled) return;
      else toast(opts, (res && res.error) || 'Could not save the project.');
    }, () => toast(opts, 'Could not save the project.'));
  }

  function copyArtifact(artifact, opts) {
    const text = toMarkdown(artifact);
    try {
      const p = navigator.clipboard.writeText(text);
      if (p && p.then) p.then(() => toast(opts, 'Copied.'), () => toast(opts, 'Copy failed.'));
      else toast(opts, 'Copied.');
    } catch { toast(opts, 'Copy failed.'); }
  }

  function blobSave(doc, text, name, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = doc.createElement('a');
    a.href = url;
    a.download = (String(name || 'dexerion-artifact').replace(/[^\w.-]+/g, '-').slice(0, 80) || 'dexerion-artifact');
    doc.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} }, 1000);
  }

  function downloadArtifact(doc, artifact, opts) {
    // Every kind downloads as one self-contained HTML file that works offline.
    // The bytes come from the main process so the export is identical to the
    // one the report viewer writes; if the bridge is unavailable (tests, a
    // detached document) fall back to the old Markdown/site-HTML behaviour.
    const fallback = () => {
      try {
        const site = artifact.kind === 'site';
        blobSave(doc, site ? artifact.html : toMarkdown(artifact),
          String(artifact.title || 'dexerion-artifact') + (site ? '.html' : '.md'),
          site ? 'text/html;charset=utf-8' : 'text/markdown;charset=utf-8');
      } catch { toast(opts, 'Download failed.'); }
    };
    // For a served multi-page site, "Download HTML" exports the page the
    // person is looking at (the card passes a getter); everything else
    // exports whole, exactly as before.
    const page = (opts && typeof opts.page === 'function') ? String(opts.page() || '') : '';
    const bridge = GLOBAL && GLOBAL.dexerion;
    if (!bridge || typeof bridge.invoke !== 'function') return fallback();
    let pending;
    try { pending = bridge.invoke('dex:ai-artifact-html', page ? { artifact, page } : { artifact }); } catch { return fallback(); }
    if (!pending || typeof pending.then !== 'function') return fallback();
    return pending.then((res) => {
      if (res && res.ok && res.html) {
        blobSave(doc, res.html, String(res.title || artifact.title || 'dexerion-artifact') + '.html', 'text/html;charset=utf-8');
        toast(opts, 'Downloaded HTML.');
      } else fallback();
    }, fallback);
  }

  function chartMarkdown(chart) {
    if (!chart) return '';
    const labels = arr(chart.labels);
    const series = arr(chart.series);
    if (!labels.length || !series.length) return '';
    const head = ['Label'].concat(series.map((s) => s.name || 'Series'));
    const rows = labels.map((label, i) => [label].concat(series.map((s) => (s.values || [])[i])));
    const rule = '| ' + head.map(() => '---').join(' | ') + ' |';
    return ['| ' + head.join(' | ') + ' |', rule]
      .concat(rows.map((r) => '| ' + r.map((v) => String(v == null ? '' : v)).join(' | ') + ' |'))
      .join('\n');
  }

  function tableMarkdown(table) {
    if (!table) return '';
    const cols = arr(table.columns);
    if (!cols.length) return '';
    const rule = '| ' + cols.map(() => '---').join(' | ') + ' |';
    return ['| ' + cols.join(' | ') + ' |', rule]
      .concat(arr(table.rows).map((row) => '| ' + cols.map((_, i) => String((row || [])[i] == null ? '' : row[i])).join(' | ') + ' |'))
      .join('\n');
  }

  // One report block -> Markdown, mirroring the main-process writer so Copy,
  // Download and the exports always agree.
  function blockMarkdown(block) {
    if (!block || typeof block !== 'object') return '';
    if (block.type === 'heading') return (block.level === 3 ? '### ' : '## ') + block.text;
    if (block.type === 'paragraph') return block.text;
    if (block.type === 'list') return arr(block.items).map((item, i) => (block.ordered ? (i + 1) + '. ' : '- ') + item).join('\n');
    if (block.type === 'table') return tableMarkdown(block);
    if (block.type === 'stats') return arr(block.items).map((item) => '**' + item.value + '**' + (item.label ? ' ' + item.label : '')).join(' · ');
    if (block.type === 'chart') return chartMarkdown(block.chart);
    if (block.type === 'timeline') return arr(block.items).map((item) => '- ' + (item.when ? '**' + item.when + '** — ' : '') + item.text).join('\n');
    if (block.type === 'proscons') {
      return ['**Pros**'].concat(arr(block.pros).map((p) => '- ' + p))
        .concat(['', '**Cons**']).concat(arr(block.cons).map((c) => '- ' + c)).join('\n');
    }
    if (block.type === 'cards') return arr(block.items).map((item) => '**' + (item.title || '') + '**' + (item.text ? ' — ' + item.text : '')).join('\n');
    if (block.type === 'steps') return arr(block.items).map((item, i) => (i + 1) + '. **' + (item.title || '') + '**' + (item.text ? ' — ' + item.text : '')).join('\n');
    if (block.type === 'quote') return '> ' + block.text + (block.attribution ? '\n> — ' + block.attribution : '');
    if (block.type === 'callout') return '> ' + (block.label ? '**' + block.label + ':** ' : '') + block.text;
    if (block.type === 'divider') return '---';
    if (block.type === 'code') return '```' + (block.lang || '') + '\n' + block.text + '\n```';
    if (block.type === 'image') return '![Image' + (block.alt ? ' ' + block.alt : '') + '](' + block.src + ')' + (block.caption ? ' — ' + block.caption : '');
    if (block.type === 'embed') return '[Embed](' + block.src + ')' + (block.title ? ' — ' + block.title : '') + (block.caption ? '\n_' + block.caption + '_' : '');
    if (block.type === 'accordion') return arr(block.items).map((i) => '## ' + i.heading + '\n' + i.body).join('\n\n');
    if (block.type === 'tabs') return arr(block.tabs).map((i) => '### ' + i.heading + '\n' + i.body).join('\n\n');
    if (block.type === 'metric') return '**' + block.value + '**' + (block.delta ? ' ' + block.delta : '') + (block.subtitle ? '\n*' + block.subtitle + '*' : '');
    if (block.type === 'checklist') return arr(block.items).map((i) => (i.done ? '- [x] ' : '- [ ] ') + i.text).join('\n');
    if (block.type === 'comparison') {
      const parts = [];
      if (block.title) parts.push('## ' + block.title);
      if (block.left) {
        parts.push('### ' + (block.left.heading || 'Left'));
        for (const it of arr(block.left.items)) parts.push('- ' + it.label + ': ' + it.value);
        if (block.left.body) parts.push(block.left.body);
      }
      if (block.right) {
        parts.push('### ' + (block.right.heading || 'Right'));
        for (const it of arr(block.right.items)) parts.push('- ' + it.label + ': ' + it.value);
        if (block.right.body) parts.push(block.right.body);
      }
      return parts.join('\n').trim();
    }
    return '';
  }

  function toMarkdown(artifact) {
    if (!artifact || typeof artifact !== 'object') return '';
    const lines = [];
    const title = artifact.title || 'Artifact';
    if (artifact.kind === 'report') {
      // The exported Markdown links in-text [n] markers the same way the
      // rendered report does, so citations survive both exports.
      const cites = arr(artifact.references).map((r) => r && r.url).filter(Boolean);
      const linked = (s) => linkifyCitations(s, cites);
      lines.push('# ' + title);
      if (artifact.kicker) lines.push('', '_' + artifact.kicker + '_');
      if (artifact.subtitle) lines.push('', '_' + artifact.subtitle + '_');
      if (artifact.summary) lines.push('', linked(artifact.summary));
      if (arr(artifact.blocks).length) {
        for (const block of artifact.blocks) {
          const md = linked(blockMarkdown(block));
          if (md) lines.push('', md);
        }
      } else {
        for (const section of arr(artifact.sections)) {
          if (section.heading) lines.push('', '## ' + section.heading);
          if (section.body) lines.push('', linked(section.body));
          if (section.table) lines.push('', tableMarkdown(section.table));
          if (section.chart) lines.push('', chartMarkdown(section.chart));
        }
        if (artifact.chart) lines.push('', chartMarkdown(artifact.chart));
      }
      if (arr(artifact.findings).length) {
        lines.push('', '## Key findings');
        for (const f of artifact.findings) lines.push('- ' + linked(f));
      }
      if (arr(artifact.references).length) {
        lines.push('', '## References');
        for (const r of artifact.references) lines.push('- [' + r.title + '](' + r.url + ')' + (r.publisher ? ' — ' + r.publisher : ''));
      }
      // Reading notes travel with the document (V17): the quote keeps the
      // note–text link even where no highlight can be painted. (Main-side
      // copy mirrors this; both are pinned by tests.)
      if (arr(artifact.annotations).length) {
        lines.push('', '## Notes');
        for (const a of artifact.annotations) {
          lines.push('- “' + String(a.quote || '') + '” — ' + String(a.note || ''));
        }
      }
    } else if (artifact.kind === 'quiz') {
      lines.push('# ' + title);
      if (artifact.topic) lines.push('', 'Topic: ' + artifact.topic);
      arr(artifact.questions).forEach((q, i) => {
        lines.push('', '## ' + (i + 1) + '. ' + q.prompt);
        if (q.type === 'short') lines.push('', 'Answer: ' + q.answer);
        else if (q.type === 'match') for (const p of arr(q.pairs)) lines.push('- ' + p.left + ' → ' + p.right);
        else if (q.options) {
          q.options.forEach((o, oi) => {
            const correct = q.type === 'multi' ? arr(q.answer).includes(oi) : q.answer === oi;
            lines.push('- ' + (correct ? '**' + o + '**' : o));
          });
        }
        if (q.explanation) lines.push('', q.explanation);
      });
    } else if (artifact.kind === 'deck') {
      lines.push('# ' + title);
      for (const card of arr(artifact.cards)) lines.push('', '- **' + card.front + '**', '  ' + card.back);
    } else if (artifact.kind === 'timeline') {
      lines.push('# ' + title);
      for (const entry of arr(artifact.entries)) lines.push('', '- **' + (entry.date ? entry.date + ' — ' : '') + entry.title + '**', '  ' + entry.text);
    } else if (artifact.kind === 'chart') {
      lines.push('# ' + title, '', chartMarkdown(artifact.chart));
    } else if (artifact.kind === 'site') {
      lines.push('# ' + title, '', '```html', artifact.html || '', '```');
    }
    return lines.join('\n').trim();
  }

  // Mirrors the server validator's most important checks. Saved chat data is
  // already validated, but a corrupted profile must not crash or inject.
  function sanitize(raw, shallow) {
    if (!raw || typeof raw !== 'object' || !KINDS.includes(raw.kind)) return null;
    const out = { kind: raw.kind, title: str(raw.title, 180) || LABELS[raw.kind] };
    if (raw.kind === 'report') {
      out.subtitle = str(raw.subtitle, 240);
      out.summary = str(raw.summary, 8000);
      out.sections = arr(raw.sections).slice(0, 40).map((s) => {
        if (!s || typeof s !== 'object') return null;
        return {
          heading: str(s.heading, 180),
          body: str(s.body, 12000),
          table: sanitizeTable(s.table),
          chart: sanitizeChart(s.chart),
        };
      }).filter(Boolean);
      out.findings = arr(raw.findings).slice(0, 30).map((f) => str(f, 2000)).filter(Boolean);
      out.references = arr(raw.references).slice(0, 40).map((r) => {
        if (!r || !/^https?:\/\//i.test(String(r.url || ''))) return null;
        return { title: str(r.title, 240) || String(r.url), url: str(r.url, 2048), publisher: str(r.publisher, 160) };
      }).filter(Boolean);
      out.chart = sanitizeChart(raw.chart);
      out.kicker = str(raw.kicker, 120);
      out.blocks = arr(raw.blocks).slice(0, 240).map(sanitizeBlock).filter(Boolean);
      out.theme = ['clean', 'editorial', 'brief', 'modern', 'magazine', 'academic', 'notebook', 'executive', 'minimal', 'creative', 'technical', 'playful'].includes(raw.theme) ? raw.theme : 'clean';
      out.paper = ['paper', 'white', 'pink', 'blue', 'green', 'lavender', 'peach', 'grey', 'sand', 'slate', 'ivory', 'mist'].includes(raw.paper) ? raw.paper : 'paper';
      out.pattern = ['solid', 'hatch', 'diagonal'].includes(raw.pattern) ? raw.pattern : 'solid';
      out.font = ['editorial', 'neutral', 'typewriter'].includes(raw.font) ? raw.font : 'neutral';
      out.version = Math.max(1, Math.min(999, Math.round(num(raw.version) || 1)));
      out.toc = raw.toc === true;
      out.searchable = raw.searchable === true;
      // Report edit history must survive sanitize (V20 fix): the card's
      // "Undo edit" visibility reads it, and a chat reopen rebuilds through
      // this function — without it, undo vanished after every reopen even
      // though snapshots existed in the store. Same mapping as the site branch.
      out.history = shallow ? [] : arr(raw.history).slice(0, 5).map((h) => {
        const inner = h && h.artifact ? sanitize(h.artifact, true) : null;
        return inner ? { at: num(h.at), note: str(h.note, 160), artifact: inner } : null;
      }).filter(Boolean);
      out.annotations = arr(raw.annotations).slice(0, 200).map((a) => {
        if (!a || typeof a !== 'object') return null;
        const note = str(a.note, 2000);
        if (!note) return null;
        const clean = { blockId: str(a.blockId || a.block || '', 40), note, who: str(a.who || 'You', 120), at: num(a.at) || 0 };
        // Selection anchors (V15) must survive sanitize or the card's Copy /
        // Download exports would lose the note–text link; resolution happens
        // at paint time through the usual cascade.
        const quote = str(a.quote, 200);
        if (quote) {
          clean.id = str(a.id, 48);
          clean.quote = quote;
          clean.prefix = str(a.prefix, 64);
          clean.suffix = str(a.suffix, 64);
          clean.offset = Math.max(0, Math.round(num(a.offset) || 0));
          clean.occurrence = Math.max(1, Math.round(num(a.occurrence) || 1));
        }
        return clean;
      }).filter(Boolean);
      out.conditions = arr(raw.conditions).slice(0, 40).map((c) => {
        if (!c || typeof c !== 'object') return null;
        const w = c.when && typeof c.when === 'object' ? c.when : {};
        const type = ['metric-gte', 'metric-lt', 'checkbox'].includes(w.type) ? w.type : 'metric-gte';
        const path = str(w.path, 200);
        const value = num(w.value);
        const blockId = str(c.blockId || c.block || '', 40);
        return blockId && path ? { blockId, when: { type, path, value } } : null;
      }).filter(Boolean);
      out.dependencies = arr(raw.dependencies).slice(0, 40).map((d) => {
        if (!d || typeof d !== 'object') return null;
        const blockId = str(d.blockId || d.block || '', 40);
        const dependsOn = arr(d.dependsOn).map((x) => str(x, 40)).filter(Boolean);
        return blockId && dependsOn.length ? { blockId, dependsOn } : null;
      }).filter(Boolean);
      out.versions = arr(raw.versions).slice(0, 60).map((v) => {
        if (!v || typeof v !== 'object') return null;
        const blockId = str(v.blockId || v.block || '', 40);
        const version = Math.max(1, Math.min(999, Math.round(num(v.version) || 1)));
        const changedBy = str(v.changedBy, 120);
        const changedAt = num(v.changedAt) || 0;
        const note = str(v.note, 1000);
        return blockId && changedBy ? { blockId, version, changedBy, changedAt, note } : null;
      }).filter(Boolean);
      out.dynamicData = arr(raw.dynamicData).slice(0, 40).map((dd) => {
        if (!dd || typeof dd !== 'object') return null;
        const blockId = str(dd.blockId || dd.block || '', 40);
        const source = ['live', 'static'].includes(String(dd.source || '').toLowerCase()) ? String(dd.source || '').toLowerCase() : 'static';
        const query = str(dd.query, 2000);
        return blockId && query ? { blockId, source, query } : null;
      }).filter(Boolean);
    } else if (raw.kind === 'site') {
      out.description = str(raw.description, 4000);
      out.html = str(raw.html, MAX_HTML);
      // Multi-file sites keep their manifest (path + content) so the preview
      // can say how many files it inlined; content is already in `html`.
      if (arr(raw.files).length) {
        out.files = arr(raw.files).slice(0, 24).map((f) => ({
          path: str(f && f.path, 160),
          content: str(f && f.content, 120000),
        })).filter((f) => f.path);
        out.entry = str(raw.entry, 160);
      }
      // Edit history (newest first) so the card can offer "Restore". Nested
      // snapshots are one level deep by construction.
      out.history = shallow ? [] : arr(raw.history).slice(0, 5).map((h) => {
        const inner = h && h.artifact ? sanitize(h.artifact, true) : null;
        return inner ? { at: num(h.at), note: str(h.note, 160), artifact: inner } : null;
      }).filter(Boolean);
    } else if (raw.kind === 'quiz') {
      out.topic = str(raw.topic, 160);
      out.difficulty = ['easy', 'medium', 'hard'].includes(raw.difficulty) ? raw.difficulty : '';
      out.passing = Math.max(0, Math.min(100, Math.round(num(raw.passing) || 60)));
      out.questions = arr(raw.questions).slice(0, 100).map(sanitizeQuestion).filter(Boolean);
    } else if (raw.kind === 'deck') {
      out.topic = str(raw.topic, 160);
      out.cards = arr(raw.cards).slice(0, 200).map((c) => {
        if (!c || !c.front || !c.back) return null;
        return { front: str(c.front, 4000), back: str(c.back, 4000) };
      }).filter(Boolean);
    } else if (raw.kind === 'chart') {
      out.chart = sanitizeChart(raw.chart);
    } else if (raw.kind === 'timeline') {
      out.subtitle = str(raw.subtitle, 240);
      out.entries = arr(raw.entries).slice(0, 200).map((e) => {
        if (!e || (!e.title && !e.text)) return null;
        return { date: str(e.date, 80), title: str(e.title, 240), text: str(e.text, 12000) };
      }).filter(Boolean);
    }
    return out;
  }

  function sanitizeTable(raw) {
    if (!raw || typeof raw !== 'object') return null;
    // Mirror the main-process normalizer: alternate header/body key names and
    // object rows must survive here too, or a table that passed validation is
    // dropped at render time.
    const pick = (...values) => values.find((v) => Array.isArray(v) && v.length) || [];
    const columns = pick(raw.columns, raw.headers, raw.header, raw.head).slice(0, 12).map((c) => str(c, 120)).filter(Boolean);
    if (columns.length < 2) return null;
    const cellAt = (row, i) => {
      if (Array.isArray(row)) return row[i];
      if (row && typeof row === 'object') return row[columns[i]];
      return '';
    };
    const rows = pick(raw.rows, raw.data, raw.body).slice(0, 200)
      .map((row) => columns.map((_, i) => str(cellAt(row, i), 500)));
    return rows.length ? { columns, rows } : null;
  }

  function sanitizeChart(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const type = ['bar', 'line', 'pie'].includes(raw.type) ? raw.type : 'bar';
    const labels = arr(raw.labels).slice(0, 200).map((l) => str(l, 80));
    const series = arr(raw.series).slice(0, 8).map((s) => {
      if (!s || typeof s !== 'object') return null;
      const values = arr(s.values).slice(0, labels.length).map(num);
      return values.length ? { name: str(s.name, 80) || 'Series', values } : null;
    }).filter(Boolean);
    if (labels.length < 2 || !series.length) return null;
    return { type, labels, series, title: str(raw.title, 180), unit: str(raw.unit, 40) };
  }

  // v2 report block, re-checked at render time like everything else.
  function sanitizeBlock(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const type = String(raw.type || '');
    if (type === 'heading') {
      const text = str(raw.text, 180);
      return text ? { type, text, level: num(raw.level) >= 3 ? 3 : 2 } : null;
    }
    if (type === 'paragraph') {
      const text = str(raw.text, 12000);
      return text ? { type, text } : null;
    }
    if (type === 'list') {
      const items = arr(raw.items).slice(0, 100).map((item) => str(item, 2000)).filter(Boolean);
      return items.length ? { type, items, ordered: raw.ordered === true } : null;
    }
    if (type === 'table') {
      const table = sanitizeTable(raw);
      return table ? { type, ...table } : null;
    }
    if (type === 'stats') {
      const items = arr(raw.items).slice(0, 8)
        .map((item) => ({ value: str(item && item.value, 80), label: str(item && item.label, 160) }))
        .filter((item) => item.value || item.label);
      return items.length ? { type, items } : null;
    }
    if (type === 'chart') {
      const chart = sanitizeChart(raw.chart || raw);
      return chart ? { type, chart } : null;
    }
    if (type === 'timeline') {
      const items = arr(raw.items).slice(0, 120)
        .map((item) => ({ when: str(item && item.when, 80), text: str(item && item.text, 2000) }))
        .filter((item) => item.text);
      return items.length ? { type, items } : null;
    }
    if (type === 'proscons') {
      const pros = arr(raw.pros).slice(0, 20).map((item) => str(item, 600)).filter(Boolean);
      const cons = arr(raw.cons).slice(0, 20).map((item) => str(item, 600)).filter(Boolean);
      return (pros.length || cons.length) ? { type, pros, cons } : null;
    }
    if (type === 'cards' || type === 'steps') {
      const items = arr(raw.items).slice(0, 24)
        .map((item) => ({ title: str(item && item.title, 160), text: str(item && item.text, 2000) }))
        .filter((item) => item.title || item.text);
      return items.length ? { type, items } : null;
    }
    if (type === 'quote') {
      const text = str(raw.text, 3000);
      return text ? { type, text, attribution: str(raw.attribution, 200) } : null;
    }
    if (type === 'callout') {
      const text = str(raw.text, 4000);
      return text ? { type, text, label: str(raw.label, 80) } : null;
    }
    if (type === 'code') {
      const text = str(raw.text || raw.code, 12000);
      return text ? { type, text, lang: str(raw.lang || raw.language || '', 40) } : null;
    }
    if (type === 'image') {
      // Reports are offline documents: embedded data URLs are the canonical
      // image source. Remote URLs are accepted only so the main process can
      // fetch and inline them before storage; dexrefN placeholders are
      // resolved on the same path. Never collapse whitespace inside base64.
      const src = str(raw.src || raw.url || '', 2 * 1024 * 1024);
      if (!/^(https?:\/\/|data:image\/|dexref[1-4]$)/i.test(src)) return null;
      return { type, src, alt: str(raw.alt || '', 200), caption: str(raw.caption, 1000) };
    }
    if (type === 'embed') {
      const src = str(raw.src || raw.url || '', 2048);
      if (!/^https?:\/\//i.test(src)) return null;
      return { type, src, title: str(raw.title || '', 200), caption: str(raw.caption, 1000) };
    }
    if (type === 'accordion') {
      const items = arr(raw.items).slice(0, 24).map((item) => {
        if (!item || typeof item !== 'object') return null;
        const heading = str(item.heading || item.title || '', 200);
        const body = str(item.body || item.text || '', 12000);
        return heading || body ? { heading, body, open: item.open === true } : null;
      }).filter(Boolean);
      return items.length ? { type, items } : null;
    }
    if (type === 'tabs') {
      const tabs = arr(raw.tabs).slice(0, 24).map((item) => {
        if (!item || typeof item !== 'object') return null;
        const heading = str(item.heading || item.title || '', 200);
        const body = str(item.body || item.text || '', 12000);
        return heading || body ? { heading, body, active: item.active === true } : null;
      }).filter(Boolean);
      return tabs.length ? { type, tabs } : null;
    }
    if (type === 'metric') {
      const value = str(raw.value || raw.label || '', 200);
      if (!value) return null;
      const trend = ['up', 'down', 'flat', 'none'].includes(String(raw.trend || '').toLowerCase()) ? String(raw.trend || '').toLowerCase() : 'none';
      return { type, value, subtitle: str(raw.subtitle || '', 200), trend, delta: str(raw.delta || '', 120) };
    }
    if (type === 'checklist') {
      const items = arr(raw.items).slice(0, 100).map((item) => {
        if (!item || typeof item !== 'object') return null;
        const t = str(item.text || item.label || '', 2000);
        return t ? { text: t, done: item.done === true } : null;
      }).filter(Boolean);
      return items.length ? { type, items } : null;
    }
    if (type === 'comparison') {
      const left = normalizeComparisonSide(raw.left);
      const right = normalizeComparisonSide(raw.right);
      if (!left && !right) return null;
      return { type, left, right, title: str(raw.title || '', 200) };
    }
    if (type === 'divider' || type === 'spacer') return { type };
    return null;
  }

  function normalizeComparisonSide(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const heading = str(raw.heading || raw.title || '', 200);
    const items = arr(raw.items).slice(0, 20).map((item) => ({ label: str(item && item.label, 160), value: str(item && item.value, 2000) })).filter((item) => item.label || item.value);
    const body = str(raw.body || raw.text, 3000);
    return heading || items.length || body ? { heading, items, body } : null;
  }

  function sanitizeQuestion(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const prompt = str(raw.prompt, 4000);
    if (!prompt) return null;
    const type = ['single', 'multi', 'truefalse', 'short', 'match'].includes(raw.type) ? raw.type : 'single';
    const out = { type, prompt, explanation: str(raw.explanation, 4000) };
    if (type === 'truefalse') {
      if (typeof raw.answer !== 'boolean') return null;
      out.options = ['True', 'False'];
      out.answer = raw.answer;
      return out;
    }
    if (type === 'single' || type === 'multi') {
      out.options = arr(raw.options).slice(0, 12).map((o) => str(o, 500)).filter(Boolean);
      if (out.options.length < 2) return null;
      if (type === 'single') {
        const n = Number(raw.answer);
        if (!Number.isInteger(n) || n < 0 || n >= out.options.length) return null;
        out.answer = n;
      } else {
        out.answer = [...new Set(arr(raw.answer).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < out.options.length))].sort((a, b) => a - b);
        if (!out.answer.length) return null;
      }
      return out;
    }
    if (type === 'short') {
      out.answer = str(raw.answer, 4000);
      if (!out.answer) return null;
      out.accept = arr(raw.accept).slice(0, 20).map((a) => str(a, 500)).filter(Boolean);
      return out;
    }
    out.pairs = arr(raw.pairs).slice(0, 12).map((p) => (p && p.left && p.right ? { left: str(p.left, 240), right: str(p.right, 240) } : null)).filter(Boolean);
    return out.pairs.length >= 2 ? out : null;
  }

  // Mirror of the main-process dexStorage shim (both carry `dexStorage`).
  // Chromium denies DOM storage to the custom dexsite:// scheme in a sandboxed
  // frame; a generated site's own localStorage call then throws at load and
  // aborts its script. Install a compatible shim before any page script,
  // keeping native Storage where it works. window.name backs it so state
  // survives the frame navigation after an edit.
  const STORAGE_SHIM = '<script>/*dexStorage*/(function(){'
    + 'var NS="__DEX_SITE_ID__",LIMIT=262144;'
    + 'var bytes=function(s){try{if(typeof TextEncoder!=="undefined")return new TextEncoder().encode(s).length;}catch(err){}'
    + 'try{return unescape(encodeURIComponent(s)).length;}catch(err){return String(s).length;}};'
    + 'var warn=function(n){try{console.warn("[preview] Storage payload exceeds 256 KB ("+n+" bytes); the value was not stored.");}catch(err){}};'
    + 'function make(prefix){'
    + 'var mem={},full=prefix+"_"+NS;'
    + 'try{var raw=String(window.name||""),i=raw.indexOf("|"+full+"=");'
    + 'if(i>=0){var s=raw.slice(i+full.length+2),e=s.indexOf("|"),p=JSON.parse(s.slice(0,e<0?s.length:e));'
    + 'if(p&&typeof p==="object")mem=p;}}catch(err){}'
    + 'var flush=function(){var payload=JSON.stringify(mem),n=bytes(payload);'
    + 'if(n>LIMIT){warn(n);return false;}'
    + 'try{var raw=String(window.name||""),mark="|"+full+"=";'
    + 'var i=raw.indexOf(mark),end=i>=0?raw.indexOf("|",i+mark.length):-1;'
    + 'window.name=i>=0?(raw.slice(0,i)+mark+payload+(end>=0?raw.slice(end):"")):(raw+mark+payload+"|");return true;'
    + '}catch(err){return false;}};'
    + 'var api={getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(mem,k)?mem[k]:null;},'
    + 'setItem:function(k,v){k=String(k);var had=Object.prototype.hasOwnProperty.call(mem,k),old=mem[k];'
    + 'mem[k]=String(v);if(!flush()){if(had)mem[k]=old;else delete mem[k];}},'
    + 'removeItem:function(k){delete mem[String(k)];flush();},'
    + 'clear:function(){mem={};flush();},'
    + 'key:function(i){var ks=Object.keys(mem);return i>=0&&i<ks.length?ks[i]:null;}};'
    + 'Object.defineProperty(api,"length",{get:function(){return Object.keys(mem).length;}});'
    + 'return api;}'
    + 'function install(name,prefix){var native=null;try{native=window[name];}catch(err){}'
    + 'if(native&&typeof native.getItem==="function")return;'
    + 'try{Object.defineProperty(window,name,{value:make(prefix),configurable:true,writable:false});}catch(err){}}'
    + 'install("localStorage","dls");install("sessionStorage","dss");'
    + '})();</scr' + 'ipt>';

  // Mirror of the main-process dexClip shim (both carry `dexClip`). The sandbox
  // frame is not a secure context, so navigator.clipboard is undefined and a
  // generated site's copy button throws. Install a promise-returning compatible
  // clipboard before any page script; keep the native one where it works.
  const CLIPBOARD_SHIM = '<script>/*dexClip*/(function(){'
    + 'var api=null;try{api=navigator.clipboard;}catch(err){}'
    + 'if(api&&typeof api.writeText==="function")return;'
    + 'var buf="";'
    + 'var textOf=function(b){try{return typeof b.text==="function"?b.text():Promise.resolve(String(b));}catch(err){return Promise.resolve("");}};'
    + 'var shim={'
    + 'writeText:function(t){var value=String(t==null?"":t),ok=false;'
    + 'try{var el=document.createElement("textarea");el.value=value;el.setAttribute("readonly","");'
    + 'el.style.cssText="position:fixed;top:-1000px;left:-1000px;opacity:0";'
    + 'var host=document.body||document.documentElement;'
    + 'if(host){host.appendChild(el);try{el.select();el.setSelectionRange(0,el.value.length);}catch(err){}'
    + 'try{ok=!!document.execCommand("copy");}catch(err){ok=false;}try{host.removeChild(el);}catch(err){}}}'
    + 'catch(err){ok=false;}'
    + 'if(!ok)return Promise.reject(new Error("Copy failed"));'
    + 'buf=value;return Promise.resolve();},'
    + 'readText:function(){return Promise.resolve(buf);},'
    + 'write:function(item){try{if(item&&typeof item.getType==="function"){'
    + 'var p=item.getType("text/plain");if(p&&typeof p.then==="function")'
    + 'return p.then(textOf).then(function(t){buf=String(t);}).catch(function(){});}}catch(err){}'
    + 'return Promise.resolve();},'
    + 'read:function(){return Promise.resolve([]);}};'
    + 'try{Object.defineProperty(navigator,"clipboard",{value:shim,configurable:true,writable:true});}'
    + 'catch(err){try{navigator.clipboard=shim;}catch(err2){}}'
    + '})();</scr' + 'ipt>';

  // Reports what went wrong inside the sandbox. The frame is opaque-origin, so
  // the outer page can never inspect it — but the frame itself can tell us. The
  // reporter is injected before the artifact's own scripts, so the first throw
  // is caught, and it only ever sends short strings.
  const PREVIEW_REPORTER = '<script>(function(){'
    + 'var rawPost=function(o){try{parent.postMessage(Object.assign({dexPreview:1},o),"*");}catch(e){}};'
    // Rate limit: 100 messages/second; one debounced dropped-count notice and
    // a replay of the LAST error keep a burst honest without flooding.
    + 'var RL_MAX=100,rlStart=Date.now(),rlUsed=0,rlDropped=0,rlLastError=null,rlTimer=null,rlNotice=false;'
    + 'var isErr=function(k,l){return k==="error"||(k==="console"&&l==="error");};'
    + 'var rlFlush=function(){rlTimer=null;var last=rlLastError;rlLastError=null;'
    + 'if(rlDropped>0&&!rlNotice){rawPost({kind:"console",level:"warn",text:"Preview messages dropped: "+rlDropped+" (rate limit 100/s).",stack:""});rlNotice=true;}'
    + 'if(last)rawPost(last);};'
    + 'var post=function(o){var now=Date.now();if(now-rlStart>=1000){rlStart=now;rlUsed=0;rlDropped=0;rlNotice=false;}'
    + 'if(rlUsed<RL_MAX){rlUsed++;rawPost(o);return;}'
    + 'rlDropped++;if(isErr(o.kind,o.level))rlLastError=o;'
    + 'if(!rlTimer)rlTimer=setTimeout(rlFlush,200);};'
    + 'var send=function(kind,message,line){post({kind:kind,message:String(message==null?"":message).slice(0,300),line:Number(line)||0});};'
    + 'window.addEventListener("error",function(e){'
    + 'var t=e&&e.target;'
    + 'if(t&&t!==window&&t.tagName)send("error","Could not load "+t.tagName.toLowerCase()+(t.src||t.href?": "+(t.src||t.href):""),0);'
    + 'else send("error",(e&&(e.message||e.reason))||"Script error",e&&e.lineno);'
    + '},true);'
    + 'window.addEventListener("unhandledrejection",function(e){'
    + 'var r=e&&e.reason;send("error","Unhandled promise rejection: "+(r&&r.message?r.message:r),0);'
    + '});'
    // Escape the generated page did not handle belongs to the overlay; checks
    // after propagation so dialogs/menus that preventDefault keep their Escape.
    + 'window.addEventListener("keydown",function(e){if(!e||e.key!=="Escape"||e.defaultPrevented)return;'
    + 'setTimeout(function(){try{if(!e.defaultPrevented)post({kind:"escape"});}catch(err){}},0);},false);/*dexEscape*/'
    // The fit probe (/*dexFit*/): a page wider than its slot explains itself
    // once per width change. Deliberately soft — a scrollable table is often
    // intentional — and it never spams on every resize tick.
    + 'var lastW=0,fit=function(){try{var de=document.documentElement,w=window.innerWidth||0;if(!de||!w)return;if(Math.abs(w-lastW)>40){lastW=w;if(de.scrollWidth>w+1)send("overflow","This page is wider than the preview ("+w+"px) — horizontal scrolling appeared. If that is intentional (a scrollable table), ignore this.",0);}}catch(e){}};'
    + 'window.addEventListener("load",function(){setTimeout(fit,300);});'
    + 'window.addEventListener("resize",fit);/*dexFit*//*dexConsole*/'
    // Console capture — mirror of the main-process copy. The ancestor set is
    // popped on return so shared siblings are not reported as circular.
    + 'var fmt=function(v,d,seen){try{if(v===null)return"null";if(v===undefined)return"undefined";'
    + 'var t=typeof v;if(t==="string")return v.length>300?v.slice(0,300)+"…":v;'
    + 'if(t==="number"||t==="boolean")return String(v);'
    + 'if(t==="function")return "[function "+(v.name||"anonymous")+"]";'
    + 'if(v instanceof Error)return v.name+": "+String(v.message||"").slice(0,300);'
    + 'if(t==="object"){if(seen.has(v))return"[circular]";seen.add(v);'
    + 'try{'
    + 'if(v.nodeType===1)return"<"+v.tagName.toLowerCase()+(v.id?"#"+v.id:"")+">";'
    + 'if(d<=0)return"[…]";var out="";'
    + 'if(Array.isArray(v)){for(var i=0;i<v.length&&i<5;i++)out+=(out?",":"")+fmt(v[i],d-1,seen);return"["+out+(v.length>5?",…":"")+"]";}'
    + 'var ks=Object.keys(v).slice(0,6);for(var j=0;j<ks.length;j++){var k=ks[j];try{var dv=Object.getOwnPropertyDescriptor(v,k);if(dv&&dv.get){out+=(out?",":"")+k+":[getter]";continue;}}catch(e){}out+=(out?",":"")+k+":"+fmt(v[k],d-1,seen);}return"{"+out+"}";}'
    + 'finally{seen.delete(v);}'
    + '}'
    + 'return String(v);}catch(e){return"[unserialisable]"}};'
    + 'var fmtSeen=new WeakSet();'
    + '["log","info","warn","error","debug","trace","assert"].forEach(function(level){'
    + 'var orig=console[level];if(typeof orig!=="function")return;'
    + 'console[level]=function(){var raw=arguments;try{var args=Array.prototype.slice.call(raw);'
    + 'if(level==="assert"){if(args[0]){return orig.apply(console,raw);}args=args.slice(1);}'
    + 'var text="";for(var i=0;i<args.length&&i<8;i++){fmtSeen=new WeakSet();text+=(text?" ":"")+fmt(args[i],3,fmtSeen);}'
    + 'if(text.length>1500)text=text.slice(0,1500)+"…";'
    + 'var stack="";if(level==="error"||level==="warn"){try{var e2={};Error.captureStackTrace(e2);stack=String(e2.stack||"").split("\\n").slice(2,5).join(" | ").slice(0,500);}catch(e3){}}'
    + 'post({kind:"console",level:level==="trace"?"debug":level,text:text,stack:stack});'
    + '}catch(err){}return orig.apply(console,raw);};});'
    // Preview editing — mirror of the main-process copy.
    + 'var editOn=false;/*dexPick*/'
    + 'var cssPath=function(el){var parts=[];var n=el;for(var d=0;n&&n!==document.body&&d<8;d++){if(n.id){parts.unshift("#"+n.id);break;}'
    + 'var tag=n.tagName?n.tagName.toLowerCase():"";if(!tag)break;var i=1,sib=n;while((sib=sib.previousElementSibling)){if(sib.tagName&&sib.tagName.toLowerCase()===tag)i++;}'
    + 'parts.unshift(tag+":nth-of-type("+i+")");n=n.parentElement;}try{return parts.join(">")||"body";}catch(e){return"?"}};'
    + 'document.addEventListener("mouseover",function(e){if(!editOn)return;var el=e.target;if(el&&el!==document.body&&el.classList)try{el.classList.add("__dexEditHover");}catch(err){}},true);'
    + 'document.addEventListener("mouseout",function(e){if(e&&e.target&&e.target.classList)try{e.target.classList.remove("__dexEditHover");}catch(err){}},true);'
    + 'document.addEventListener("click",function(e){if(!editOn)return;e.preventDefault();e.stopPropagation();'
    + 'var el=e.target;if(!el||el===document.documentElement)return;'
    + 'var txt=String(el.textContent||"").replace(/\\s+/g," ").trim().slice(0,200);'
    + 'post({kind:"pick",tag:(el.tagName||"").toLowerCase(),path:cssPath(el),text:txt});},true);'
    + 'window.addEventListener("message",function(e){if(e&&e.data&&e.data.dexEdit!==undefined)editOn=!!e.data.dexEdit;});'
    + 'try{var st=document.createElement("style");st.textContent=".__dexEditHover{outline:2px solid #3da9fc !important;outline-offset:1px !important;cursor:text !important}";document.head.appendChild(st);}catch(e){}'
    + '})();</scr' + 'ipt>';

  // Srcdoc fallback copy of the main-process nav guard (both carry the
  // `dexGuard` / `dexPreview` markers, cross-checked in the artifact tests).
  // Blocks schemes, target=_blank, form[action] submits, window.open and
  // location.assign/replace; hashes and relative in-page links stay live.
  const PREVIEW_NAV_GUARD = '<script>/*dexGuard*/(function(){'
    + 'var send=function(what,link){try{parent.postMessage({dexPreview:1,kind:"blocked",'
    + 'message:(link?"External link blocked in preview: ":"Blocked in preview: ")+String(what).slice(0,160),line:0},"*");}catch(err){}};'
    + 'var external=function(h){return /^[a-z][a-z0-9+.-]*:/i.test(String(h||""));};'
    + 'document.addEventListener("click",function(e){'
    + 'var el=e.target;'
    + 'while(el&&el!==document&&!(el.tagName&&/^(A|FORM)$/i.test(el.tagName)))el=el.parentNode;'
    + 'if(!el||el===document)return;'
    + 'var tag=String(el.tagName||"").toLowerCase();'
    + 'if(tag==="a"){'
    + 'var h=el.getAttribute("href")||"";'
    + 'if(!h||/^#/.test(h))return;'
    + 'var t=String(el.getAttribute("target")||"").toLowerCase();'
    + 'if(t==="_blank"||t==="_new"||external(h)){e.preventDefault();e.stopPropagation();send(h,true);}'
    + 'return;'
    + '}'
    + 'if(tag==="form"){'
    + 'var t=String(el.getAttribute("target")||"").toLowerCase();'
    + 'if(t==="_blank"||t==="_new"){e.preventDefault();e.stopPropagation();send("Form target "+t,false);}'
    + '}'
    + '},true);'
    + 'document.addEventListener("submit",function(e){'
    + 'var f=e.target;if(!f||String(f.tagName||"").toLowerCase()!=="form")return;'
    + 'var a=f.getAttribute("action")||"";var t=String(f.getAttribute("target")||"").toLowerCase();'
    + 'if((a&&external(a)&&!/^dexsite:/i.test(a))||t==="_blank"||t==="_new"){'
    + 'e.preventDefault();send("Form submission "+(a||t),false);}'
    + '},true);'
    + 'try{window.open=function(u){send("window.open "+(u==null?"":String(u)),false);return null;};}catch(err){}'
    + 'try{var loc=window.location;'
    + 'var origAssign=loc.assign,origReplace=loc.replace;'
    + 'var guarded=function(u,orig,name){var s=String(u==null?"":u);'
    + 'if(!external(s)||/^dexsite:/i.test(s)){'
    + 'try{return orig.call(loc,s);}catch(err){try{return orig(s);}catch(err2){}}return;}'
    + 'send(name+" "+s,false);};'
    + 'var assign=function(u){guarded(u,origAssign,"location.assign");};'
    + 'var replace=function(u){guarded(u,origReplace,"location.replace");};'
    + 'try{Object.defineProperty(loc,"assign",{value:assign,configurable:false,writable:false});}catch(err){}'
    + 'try{Object.defineProperty(loc,"replace",{value:replace,configurable:false,writable:false});}catch(err){}'
    + 'try{if(typeof Location!=="undefined"){'
    + 'Object.defineProperty(Location.prototype,"assign",{value:assign,configurable:true,writable:true});'
    + 'Object.defineProperty(Location.prototype,"replace",{value:replace,configurable:true,writable:true});}}catch(err){}'
    + '}catch(err){}'
    + 'try{var fs=HTMLFormElement.prototype.submit;'
    + 'HTMLFormElement.prototype.submit=function(){'
    + 'var a=this.getAttribute?this.getAttribute("action")||"":"";'
    + 'var t=this.getAttribute?String(this.getAttribute("target")||"").toLowerCase():"";'
    + 'if((a&&external(a)&&!/^dexsite:/i.test(a))||t==="_blank"||t==="_new"){'
    + 'send("Form submission "+(a||t),false);return;}return fs.apply(this,arguments);};}catch(err){}'
    + '})();</scr' + 'ipt>';

  // Stable namespace for the srcdoc storage shim. The dexsite:// path uses a
  // content hash for its host; the srcdoc fallback hashes the same files here
  // so two artifacts never collide in their shared window.name backing store.
  function shimNamespace(opts, html) {
    const o = opts || {};
    const files = arr(o.files)
      .map((f) => String((f && f.path) || '') + '\u0000' + String((f && f.content) || ''))
      .join('\u0001');
    const seed = String(o.siteId || o.chatId || '') + '\u0002'
      + String(html || '').slice(0, 4000) + '\u0002' + files.slice(0, 40000);
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }

  function safeSiteHtml(html, opts) {
    let doc = str(html, MAX_HTML);
    doc = doc.replace(/<base\b[^>]*>/gi, '').replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '');
    // The reporter rides with the CSP but before any page script; a page that
    // already reports errors itself is left alone.
    const reporter = (opts && opts.reporter === false) || /dexPreview/.test(doc) ? '' : PREVIEW_REPORTER;
    // The nav guard mirrors the main-process copy (both carry `dexPreview`);
    // it keeps the "network is blocked" promise when a site links out by
    // stopping the navigation and reporting it to the card instead.
    const navGuard = /dexGuard/.test(doc) ? '' : PREVIEW_NAV_GUARD;
    const storage = /dexStorage/.test(doc) ? '' : STORAGE_SHIM.replace(/__DEX_SITE_ID__/g, shimNamespace(opts, doc));
    const head = '<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + SITE_CSP + '">'
      + '<meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1">'
      + SITE_VIEWPORT_CSS
      + storage + (/dexClip/.test(doc) ? '' : CLIPBOARD_SHIM) + reporter + navGuard;
    if (/<head\b[^>]*>/i.test(doc)) return doc.replace(/<head\b([^>]*)>/i, '<head$1>' + head);
    if (/<html\b[^>]*>/i.test(doc)) return doc.replace(/<html\b([^>]*)>/i, '<html$1><head>' + head + '</head>');
    return '<!doctype html><html><head>' + head + '</head><body>' + doc + '</body></html>';
  }

  // ---------- chart ---------------------------------------------------------
  const SERIES_CLASS = ['dxa-s0', 'dxa-s1', 'dxa-s2', 'dxa-s3', 'dxa-s4', 'dxa-s5', 'dxa-s6', 'dxa-s7'];

  function renderChart(doc, chart) {
    const wrap = node(doc, 'div', 'dxa-chart');
    if (!chart) return wrap;
    const width = 640, height = 300;
    const left = 46, right = 20, top = 22, bottom = 46;
    const plotW = width - left - right;
    const plotH = height - top - bottom;
    const svg = svgNode(doc, 'svg', {
      viewBox: '0 0 ' + width + ' ' + height,
      role: 'img',
      'aria-label': chart.title || 'Chart',
      class: 'dxa-chart-svg',
    });
    const title = svgNode(doc, 'title');
    title.textContent = chart.title || 'Chart';
    svg.appendChild(title);
    const all = [];
    for (const s of chart.series) for (const v of s.values) all.push(v);
    let min = Math.min(0, ...all);
    let max = Math.max(0, ...all);

    if (chart.type === 'pie') {
      const values = chart.series[0].values.map((v) => Math.max(0, v));
      const total = values.reduce((n, v) => n + v, 0) || 1;
      let angle = -Math.PI / 2;
      const cx = width / 2, cy = height / 2 + 4, r = Math.min(plotW, plotH) / 2 - 8;
      values.forEach((value, i) => {
        const sweep = (value / total) * Math.PI * 2;
        const x1 = cx + r * Math.cos(angle);
        const y1 = cy + r * Math.sin(angle);
        const x2 = cx + r * Math.cos(angle + sweep);
        const y2 = cy + r * Math.sin(angle + sweep);
        const large = sweep > Math.PI ? 1 : 0;
        const path = svgNode(doc, 'path', {
          d: 'M ' + cx + ' ' + cy + ' L ' + x1.toFixed(2) + ' ' + y1.toFixed(2)
            + ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + ' Z',
          class: 'dxa-slice ' + SERIES_CLASS[i % SERIES_CLASS.length],
        });
        svg.appendChild(path);
        if (value / total > 0.08) {
          const mid = angle + sweep / 2;
          const tx = cx + Math.cos(mid) * (r * 0.62);
          const ty = cy + Math.sin(mid) * (r * 0.62);
          const label = svgNode(doc, 'text', { x: tx.toFixed(2), y: ty.toFixed(2), class: 'dxa-pie-label', 'text-anchor': 'middle' });
          label.textContent = Math.round((value / total) * 100) + '%';
          svg.appendChild(label);
        }
        angle += sweep;
      });
    } else {
      if (max === min) { max = min + 1; }
      const grid = 4;
      for (let i = 0; i <= grid; i++) {
        const value = min + ((max - min) * i) / grid;
        const y = top + plotH - (plotH * (value - min)) / (max - min);
        svg.appendChild(svgNode(doc, 'line', { x1: left, y1: y, x2: left + plotW, y2: y, class: 'dxa-grid' }));
        const label = svgNode(doc, 'text', { x: left - 8, y: y + 3.5, class: 'dxa-axis', 'text-anchor': 'end' });
        label.textContent = Math.abs(value) >= 1000 ? Math.round(value / 100) / 10 + 'k' : String(Math.round(value * 10) / 10);
        svg.appendChild(label);
      }
      const groupW = plotW / chart.labels.length;
      if (chart.type === 'bar') {
        const barW = Math.max(3, (groupW * 0.72) / chart.series.length);
        chart.series.forEach((series, si) => {
          series.values.forEach((value, i) => {
            const x = left + groupW * i + groupW * 0.14 + barW * si;
            const y = top + plotH - (plotH * (value - min)) / (max - min);
            svg.appendChild(svgNode(doc, 'rect', {
              x: x.toFixed(2), y: y.toFixed(2), width: barW.toFixed(2),
              height: Math.max(1, top + plotH - y).toFixed(2),
              class: 'dxa-bar ' + SERIES_CLASS[si % SERIES_CLASS.length],
              rx: 2,
            }));
          });
        });
      } else {
        chart.series.forEach((series, si) => {
          const points = series.values.map((value, i) => {
            const x = left + groupW * i + groupW / 2;
            const y = top + plotH - (plotH * (value - min)) / (max - min);
            return x.toFixed(2) + ',' + y.toFixed(2);
          }).join(' ');
          svg.appendChild(svgNode(doc, 'polyline', { points, class: 'dxa-line ' + SERIES_CLASS[si % SERIES_CLASS.length] }));
          series.values.forEach((value, i) => {
            const x = left + groupW * i + groupW / 2;
            const y = top + plotH - (plotH * (value - min)) / (max - min);
            svg.appendChild(svgNode(doc, 'circle', { cx: x.toFixed(2), cy: y.toFixed(2), r: 3, class: 'dxa-dot ' + SERIES_CLASS[si % SERIES_CLASS.length] }));
          });
        });
      }
      const every = Math.ceil(chart.labels.length / 8);
      chart.labels.forEach((label, i) => {
        if (i % every !== 0 && i !== chart.labels.length - 1) return;
        const x = left + groupW * i + groupW / 2;
        const text = svgNode(doc, 'text', { x: x.toFixed(2), y: top + plotH + 18, class: 'dxa-axis', 'text-anchor': 'middle' });
        text.textContent = label;
        svg.appendChild(text);
      });
    }
    wrap.appendChild(svg);
    if (chart.series.length > 1 || chart.type === 'pie') {
      const legend = node(doc, 'div', 'dxa-legend');
      chart.series.forEach((series, i) => {
        const item = node(doc, 'span', 'dxa-legend-item');
        item.appendChild(node(doc, 'i', 'dxa-swatch ' + SERIES_CLASS[i % SERIES_CLASS.length]));
        item.appendChild(node(doc, 'span', '', series.name));
        legend.appendChild(item);
      });
      wrap.appendChild(legend);
    }
    return wrap;
  }

  // ---------- report --------------------------------------------------------
  function renderTable(doc, table) {
    const wrap = node(doc, 'div', 'dxa-table-wrap');
    const t = node(doc, 'table', 'dxa-table');
    const thead = doc.createElement('thead');
    const hr = doc.createElement('tr');
    for (const col of table.columns) {
      const th = doc.createElement('th');
      th.scope = 'col';
      th.textContent = col;
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    t.appendChild(thead);
    const tbody = doc.createElement('tbody');
    for (const row of table.rows) {
      const tr = doc.createElement('tr');
      for (let i = 0; i < table.columns.length; i++) {
        const td = doc.createElement('td');
        td.textContent = row[i] || '';
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    t.appendChild(tbody);
    wrap.appendChild(t);
    return wrap;
  }

  // One v2 block. Everything is built with textContent/DOM nodes; a report can
  // never bring its own markup.
  function renderBlock(doc, block, opts) {
    if (!block || typeof block !== 'object') return null;
    if (block.type === 'heading') {
      const lvl = Math.max(1, Math.min(3, block.level || 2));
      const cls = 'dxa-h dxa-h' + lvl;
      return node(doc, lvl === 1 ? 'h2' : lvl === 2 ? 'h3' : 'h4', cls, block.text);
    }
    if (block.type === 'paragraph') return markdown(doc, block.text, opts);
    if (block.type === 'list') {
      const list = node(doc, block.ordered ? 'ol' : 'ul', 'dxa-list');
      for (const item of block.items || []) list.appendChild(node(doc, 'li', '', item));
      return list;
    }
    if (block.type === 'table') return renderTable(doc, block);
    if (block.type === 'stats') {
      const wrap = node(doc, 'div', 'dxa-stats');
      for (const item of block.items || []) {
        const stat = node(doc, 'div', 'dxa-stat');
        stat.appendChild(node(doc, 'b', 'dxa-stat-value', item.value));
        if (item.label) stat.appendChild(node(doc, 'span', 'dxa-stat-label', item.label));
        wrap.appendChild(stat);
      }
      return wrap;
    }
    if (block.type === 'chart') return renderChart(doc, block.chart);
    if (block.type === 'timeline') {
      const list = node(doc, 'ul', 'dxa-timeline');
      for (const item of block.items || []) {
        const li = doc.createElement('li');
        if (item.when) li.appendChild(node(doc, 'span', 'dxa-when', item.when));
        li.appendChild(node(doc, 'span', 'dxa-timeline-text', item.text));
        list.appendChild(li);
      }
      return list;
    }
    if (block.type === 'proscons') {
      const wrap = node(doc, 'div', 'dxa-proscons');
      const side = (title, items, cls) => {
        const col = node(doc, 'div', 'dxa-' + cls);
        col.appendChild(node(doc, 'b', '', title));
        const list = node(doc, 'ul', 'dxa-list');
        for (const item of items || []) list.appendChild(node(doc, 'li', '', item));
        col.appendChild(list);
        return col;
      };
      wrap.appendChild(side('Pros', block.pros, 'pros'));
      wrap.appendChild(side('Cons', block.cons, 'cons'));
      return wrap;
    }
    if (block.type === 'cards' || block.type === 'steps') {
      const wrap = node(doc, 'div', block.type === 'cards' ? 'dxa-cards' : 'dxa-steps');
      (block.items || []).forEach((item, i) => {
        const card = node(doc, 'div', block.type === 'cards' ? 'dxa-card-item' : 'dxa-step');
        if (block.type === 'steps') card.appendChild(node(doc, 'i', 'dxa-step-n', String(i + 1)));
        if (item.title) card.appendChild(node(doc, 'b', 'dxa-card-title', item.title));
        if (item.text) card.appendChild(node(doc, 'span', 'dxa-card-text', item.text));
        wrap.appendChild(card);
      });
      return wrap;
    }
    if (block.type === 'quote') {
      const quote = node(doc, 'blockquote', 'dxa-quote');
      quote.appendChild(node(doc, 'p', '', block.text));
      if (block.attribution) quote.appendChild(node(doc, 'cite', '', block.attribution));
      return quote;
    }
    if (block.type === 'callout') {
      const callout = node(doc, 'div', 'dxa-callout');
      if (block.label) callout.appendChild(node(doc, 'b', 'dxa-callout-label', block.label));
      callout.appendChild(markdown(doc, block.text, opts));
      return callout;
    }
    if (block.type === 'code') return renderCode(doc, block);
    if (block.type === 'image') return renderImage(doc, block);
    if (block.type === 'embed') return renderEmbed(doc, block);
    if (block.type === 'accordion') return renderAccordion(doc, block, opts);
    if (block.type === 'tabs') return renderTabs(doc, block, opts);
    if (block.type === 'metric') return renderMetric(doc, block);
    if (block.type === 'checklist') return renderChecklist(doc, block, opts);
    if (block.type === 'comparison') return renderComparison(doc, block);
    if (block.type === 'divider') return node(doc, 'hr', 'dxa-divider');
    if (block.type === 'spacer') return node(doc, 'div', 'dxa-spacer');
    return null;
  }

  // ---------- new block renderers -------------------------------------------
  function renderCode(doc, block) {
    const wrap = node(doc, 'div', 'dxa-code');
    const pre = doc.createElement('pre');
    const code = doc.createElement('code');
    if (block.lang) code.setAttribute('data-lang', block.lang);
    code.textContent = block.text || '';
    pre.appendChild(code);
    wrap.appendChild(pre);
    if (block.lang) {
      const cap = node(doc, 'div', 'dxa-code-cap');
      cap.textContent = block.lang;
      wrap.insertBefore(cap, pre);
    }
    return wrap;
  }

  function renderImage(doc, block) {
    const wrap = node(doc, 'div', 'dxa-image');
    const img = doc.createElement('img');
    const src = block.src || '';
    img.alt = block.alt || '';
    img.setAttribute('decoding', 'async');
    img.setAttribute('referrerpolicy', 'no-referrer');
    // Eager: a lazy image inside the report's scroll container can stay blank
    // in print/export snapshots. Reports are bounded, so load them up front.
    if (src) img.src = src;
    img.addEventListener('error', () => {
      // Keep the caption and alt text visible instead of a broken-image box.
      wrap.classList.add('dxa-image-error');
      img.removeAttribute('src');
    });
    wrap.appendChild(img);
    if (block.alt || block.caption) {
      const cap = node(doc, 'div', 'dxa-image-cap');
      if (block.alt) cap.appendChild(node(doc, 'b', 'dxa-image-alt', block.alt));
      if (block.caption) cap.appendChild(node(doc, 'span', '', block.caption));
      wrap.appendChild(cap);
    }
    return wrap;
  }

  function renderEmbed(doc, block) {
    const wrap = node(doc, 'div', 'dxa-embed');
    const frame = doc.createElement('iframe');
    frame.className = 'dxa-embed-frame';
    frame.title = block.title || 'Embedded content';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.src = block.src || '';
    wrap.appendChild(frame);
    if (block.title || block.caption) {
      const cap = node(doc, 'div', 'dxa-embed-cap');
      if (block.title) cap.appendChild(node(doc, 'b', 'dxa-embed-title', block.title));
      if (block.caption) cap.appendChild(node(doc, 'span', '', block.caption));
      wrap.appendChild(cap);
    }
    return wrap;
  }

  function renderAccordion(doc, block, opts) {
    const wrap = node(doc, 'div', 'dxa-accordion');
    for (const item of block.items || []) {
      const itemEl = node(doc, 'div', 'dxa-accordion-item');
      const head = node(doc, 'button', 'dxa-accordion-head');
      head.type = 'button';
      head.appendChild(node(doc, 'span', 'dxa-accordion-title', item.heading));
      const chev = node(doc, 'span', 'dxa-accordion-chev', '▾');
      head.appendChild(chev);
      const panel = node(doc, 'div', 'dxa-accordion-panel');
      panel.appendChild(markdown(doc, item.body, opts));
      if (item.open) { head.setAttribute('aria-expanded', 'true'); panel.hidden = false; }
      else { head.setAttribute('aria-expanded', 'false'); panel.hidden = true; chev.textContent = '▸'; }
      head.onclick = () => {
        const open = !panel.hidden;
        panel.hidden = open;
        head.setAttribute('aria-expanded', String(!open));
        chev.textContent = open ? '▸' : '▾';
      };
      itemEl.append(head, panel);
      wrap.appendChild(itemEl);
    }
    return wrap;
  }

  function renderTabs(doc, block, opts) {
    const wrap = node(doc, 'div', 'dxa-tabs');
    const tablist = node(doc, 'div', 'dxa-tablist');
    const panels = node(doc, 'div', 'dxa-tabpanels');
    let activeSet = false;
    for (const tab of block.tabs || []) {
      const btn = node(doc, 'button', 'dxa-tab');
      btn.type = 'button';
      btn.textContent = tab.heading;
      const panel = node(doc, 'div', 'dxa-tabpanel');
      panel.appendChild(markdown(doc, tab.body, opts));
      const active = !activeSet && tab.active;
      activeSet = activeSet || tab.active;
      if (active) { btn.setAttribute('aria-selected', 'true'); panel.hidden = false; btn.classList.add('dxa-tab-active'); }
      else { btn.setAttribute('aria-selected', 'false'); panel.hidden = true; }
      btn.onclick = () => {
        for (const b of tablist.children) { b.setAttribute('aria-selected', 'false'); b.classList.remove('dxa-tab-active'); }
        for (const p of panels.children) p.hidden = true;
        btn.setAttribute('aria-selected', 'true'); btn.classList.add('dxa-tab-active'); panel.hidden = false;
      };
      tablist.appendChild(btn);
      panels.appendChild(panel);
    }
    // If no tab was marked active, activate the first.
    if (!activeSet && tablist.children.length) {
      tablist.children[0].setAttribute('aria-selected', 'true');
      tablist.children[0].classList.add('dxa-tab-active');
      panels.children[0].hidden = false;
    }
    wrap.append(tablist, panels);
    return wrap;
  }

  function renderMetric(doc, block) {
    const wrap = node(doc, 'div', 'dxa-metric');
    wrap.appendChild(node(doc, 'div', 'dxa-metric-value', block.value));
    if (block.delta) wrap.appendChild(node(doc, 'span', 'dxa-metric-delta dxa-trend-' + block.trend, block.delta));
    if (block.subtitle) wrap.appendChild(node(doc, 'div', 'dxa-metric-sub', block.subtitle));
    return wrap;
  }

  function renderChecklist(doc, block, opts) {
    const wrap = node(doc, 'div', 'dxa-checklist');
    for (const item of block.items || []) {
      const li = node(doc, 'div', 'dxa-checklist-item');
      const cb = doc.createElement('input');
      cb.type = 'checkbox';
      cb.checked = item.done === true;
      cb.onchange = () => { item.done = cb.checked; };
      const label = node(doc, 'label', 'dxa-checklist-label');
      label.appendChild(cb);
      label.appendChild(node(doc, 'span', '', item.text));
      li.appendChild(label);
      wrap.appendChild(li);
    }
    return wrap;
  }

  function renderComparison(doc, block) {
    const wrap = node(doc, 'div', 'dxa-comparison');
    const side = (heading, items, body, cls) => {
      const col = node(doc, 'div', 'dxa-comparison-side ' + cls);
      if (heading) col.appendChild(node(doc, 'h4', 'dxa-h', heading));
      if (items && items.length) {
        const list = node(doc, 'ul', 'dxa-list');
        for (const it of items) {
          const li = doc.createElement('li');
          li.appendChild(node(doc, 'b', '', it.label));
          li.appendChild(node(doc, 'span', 'dxa-comparison-value', ': ' + it.value));
          list.appendChild(li);
        }
        col.appendChild(list);
      }
      if (body) col.appendChild(markdown(doc, body, {}));
      return col;
    };
    wrap.appendChild(side(block.left && block.left.heading ? block.left.heading : 'Left', block.left && block.left.items, block.left && block.left.body, 'dxa-comp-left'));
    wrap.appendChild(side(block.right && block.right.heading ? block.right.heading : 'Right', block.right && block.right.items, block.right && block.right.body, 'dxa-comp-right'));
    if (block.title) {
      const t = node(doc, 'h4', 'dxa-h', block.title);
      wrap.insertBefore(t, wrap.firstChild);
    }
    return wrap;
  }

  // The closed look sets: theme (structure), paper (colour), pattern (chart
  // fills) and font (face). The model names them; this file owns them.
  function applyReportLook(doc, body, artifact) {
    const theme = artifact.theme || 'clean';
    body.dataset.theme = theme;
    body.dataset.paper = artifact.paper || 'paper';
    body.dataset.pattern = artifact.pattern || 'solid';
    body.dataset.font = artifact.font || ((theme === 'editorial' || theme === 'magazine' || theme === 'academic' || theme === 'notebook') ? 'editorial' : 'neutral');
  }

  function renderReport(doc, artifact, opts) {
    // Numbered references turn in-text [n] markers into links across the whole
    // report body (summary, blocks, actions) in one place.
    const citations = arr(artifact.references).map((r) => r && r.url).filter(Boolean);
    opts = citations.length ? Object.assign({}, opts, { citations }) : opts;
    const body = node(doc, 'div', 'dxa-report');
    applyReportLook(doc, body, artifact);
    if (artifact.kicker) body.appendChild(node(doc, 'p', 'dxa-kicker', artifact.kicker));
    if (artifact.subtitle) body.appendChild(node(doc, 'p', 'dxa-subtitle', artifact.subtitle));
    if (artifact.summary) body.appendChild(markdown(doc, artifact.summary, opts));
    const blocks = Array.isArray(artifact.blocks) ? artifact.blocks : [];
    if (blocks.length) {
      let sec = null;
      const openSection = () => {
        sec = node(doc, 'section', 'dxa-section');
        body.appendChild(sec);
        return sec;
      };
      // Blocks whose DOM text is a 1:1 projection of one JSON field carry
      // editing hooks (V14): heading/paragraph/callout/quote → their `text`.
      // The map lives next to the renderer so the two cannot drift.
      const EDIT_HOOKS = {
        heading: (el) => el,
        paragraph: (el) => el,
        callout: (el) => (el.querySelector ? el.querySelector('.dxa-md') : null) || el,
        quote: (el) => (el.querySelector ? el.querySelector('p') : null) || el,
      };
      blocks.forEach((block, index) => {
        if (block.type === 'heading' && block.level === 2) openSection();
        if (!sec) openSection();
        const el = renderBlock(doc, block, opts);
        if (!el) return;
        // Every block carries its identity exactly once (annotation anchors
        // find their block by it); only the text-projection blocks also carry
        // the edit-field marker, so edit mode arms exactly those.
        const hook = EDIT_HOOKS[block.type];
        const target = hook ? (hook(el) || el) : el;
        target.dataset.blockIndex = String(index);
        if (hook) target.dataset.dxaField = 'text';
        sec.appendChild(el);
      });
      // A leading level-3 heading can leave the first section empty; trim it.
      for (const section of Array.from(body.querySelectorAll('.dxa-section'))) {
        if (!section.childNodes.length) section.remove();
      }
    } else {
      for (const section of artifact.sections || []) {
        const sec = node(doc, 'section', 'dxa-section');
        if (section.heading) sec.appendChild(node(doc, 'h3', 'dxa-h', section.heading));
        if (section.body) sec.appendChild(markdown(doc, section.body, opts));
        if (section.table) sec.appendChild(renderTable(doc, section.table));
        if (section.chart) sec.appendChild(renderChart(doc, section.chart));
        if (sec.childNodes.length) body.appendChild(sec);
      }
      if (artifact.chart) body.appendChild(renderChart(doc, artifact.chart));
    }
    if ((artifact.findings || []).length) {
      const sec = node(doc, 'section', 'dxa-section');
      sec.appendChild(node(doc, 'h3', 'dxa-h', 'Key findings'));
      const list = node(doc, 'ul', 'dxa-list');
      for (const finding of artifact.findings) list.appendChild(node(doc, 'li', '', finding));
      sec.appendChild(list);
      body.appendChild(sec);
    }
    if ((artifact.references || []).length) {
      const sec = node(doc, 'section', 'dxa-section dxa-refs');
      sec.appendChild(node(doc, 'h3', 'dxa-h', 'References'));
      const list = node(doc, 'ol', 'dxa-list');
      for (const ref of artifact.references) {
        const li = doc.createElement('li');
        li.appendChild(linkButton(doc, ref.title, ref.url, opts));
        if (ref.publisher) li.appendChild(node(doc, 'span', 'dxa-ref-pub', ' — ' + ref.publisher));
        list.appendChild(li);
      }
      sec.appendChild(list);
      body.appendChild(sec);
    }
    return body;
  }

  // ---------- quiz ----------------------------------------------------------
  function normalizeShort(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\b(?:a|an|the)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function shortMatches(question, value) {
    const given = normalizeShort(value);
    if (!given) return false;
    const accepted = [question.answer].concat(question.accept || []);
    return accepted.some((candidate) => {
      const want = normalizeShort(candidate);
      if (!want) return false;
      if (given === want) return true;
      if (want.length >= 4 && given.length >= 4 && (given.includes(want) || want.includes(given))) return true;
      return false;
    });
  }

  function evaluateQuestion(question, value, order) {
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
      return { answered: false, correct: false, score: 0 };
    }
    if (question.type === 'single') {
      const original = order ? order[value] : value;
      return { answered: true, correct: original === question.answer, score: original === question.answer ? 1 : 0 };
    }
    if (question.type === 'multi') {
      const picked = arr(value).map((v) => (order ? order[v] : v)).sort((a, b) => a - b);
      const want = arr(question.answer).slice().sort((a, b) => a - b);
      const correct = picked.length === want.length && picked.every((v, i) => v === want[i]);
      if (!picked.length) return { answered: false, correct: false, score: 0 };
      const hits = picked.filter((v) => want.includes(v)).length;
      const wrong = picked.filter((v) => !want.includes(v)).length;
      const score = Math.max(0, Math.min(1, (hits - wrong) / Math.max(1, want.length)));
      return { answered: true, correct, score: correct ? 1 : score };
    }
    if (question.type === 'truefalse') {
      return { answered: true, correct: value === question.answer, score: value === question.answer ? 1 : 0 };
    }
    if (question.type === 'short') {
      const correct = shortMatches(question, value);
      return { answered: true, correct, score: correct ? 1 : 0, needsMarking: !correct };
    }
    if (question.type === 'match') {
      const pairs = question.pairs || [];
      const picks = arr(value);
      let hits = 0;
      pairs.forEach((pair, i) => { if (picks[i] && picks[i] === pair.right) hits++; });
      const answered = picks.some(Boolean);
      return { answered, correct: hits === pairs.length && pairs.length > 0, score: pairs.length ? hits / pairs.length : 0 };
    }
    return { answered: false, correct: false, score: 0 };
  }

  function renderQuiz(doc, artifact, opts) {
    const wrap = node(doc, 'div', 'dxa-quiz');
    const questions = artifact.questions || [];
    const answers = new Map();
    const checked = new Map();
    const orders = new Map();
    let current = 0;
    let finished = false;

    const status = node(doc, 'div', 'dxa-quiz-status');
    const bar = node(doc, 'div', 'dxa-progress');
    const fill = node(doc, 'i', 'dxa-progress-fill');
    bar.appendChild(fill);
    const stage = node(doc, 'div', 'dxa-quiz-stage');
    const nav = node(doc, 'div', 'dxa-quiz-nav');
    wrap.append(status, bar, stage, nav);

    function orderFor(index) {
      if (!orders.has(index)) {
        const q = questions[index];
        const n = q.type === 'match' ? (q.pairs || []).length : (q.options || []).length;
        const list = Array.from({ length: n }, (_, i) => i);
        if (q.type === 'match') {
          for (let i = list.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [list[i], list[j]] = [list[j], list[i]];
          }
        }
        orders.set(index, list);
      }
      return orders.get(index);
    }

    function progress() {
      status.textContent = finished
        ? 'Result'
        : 'Question ' + (current + 1) + ' of ' + questions.length + (artifact.topic ? ' · ' + artifact.topic : '');
      const done = finished ? questions.length : current;
      fill.style.width = Math.round((done / Math.max(1, questions.length)) * 100) + '%';
      fill.setAttribute('aria-valuenow', String(done));
    }

    function capture() {
      const q = questions[current];
      if (!q) return;
      const box = stage.querySelector('[data-dxa-answer]');
      if (!box) return;
      if (q.type === 'single') {
        const picked = box.querySelector('input[type="radio"]:checked');
        if (picked) answers.set(current, Number(picked.value));
        else answers.delete(current);
      } else if (q.type === 'truefalse') {
        const picked = box.querySelector('input[type="radio"]:checked');
        if (picked) answers.set(current, picked.value === 'true');
        else answers.delete(current);
      } else if (q.type === 'multi') {
        const picked = Array.from(box.querySelectorAll('input[type="checkbox"]:checked')).map((i) => Number(i.value));
        if (picked.length) answers.set(current, picked);
        else answers.delete(current);
      } else if (q.type === 'short') {
        const field = box.querySelector('textarea');
        const value = field ? field.value : '';
        if (value.trim()) answers.set(current, value);
        else answers.delete(current);
      } else if (q.type === 'match') {
        const picks = Array.from(box.querySelectorAll('select')).map((s) => s.value || '');
        if (picks.some(Boolean)) answers.set(current, picks);
        else answers.delete(current);
      }
    }

    function showFeedback(result) {
      const q = questions[current];
      const fb = stage.querySelector('.dxa-feedback');
      if (!fb) return;
      fb.replaceChildren();
      fb.className = 'dxa-feedback ' + (result.correct ? 'ok' : result.answered ? 'bad' : 'warn');
      if (!result.answered) {
        fb.textContent = 'No answer given.';
        return;
      }
      fb.appendChild(node(doc, 'strong', '', result.correct ? 'Correct' : (q.type === 'match' ? Math.round(result.score * 100) + '% of pairs correct' : 'Not quite')));
      if (q.explanation) fb.appendChild(node(doc, 'p', '', q.explanation));
      if (q.type === 'short') {
        fb.appendChild(node(doc, 'p', 'dxa-answer-line', 'Model answer: ' + q.answer));
      }
      if (q.type === 'match' && !result.correct) {
        const list = node(doc, 'ul', 'dxa-list');
        for (const pair of q.pairs || []) list.appendChild(node(doc, 'li', '', pair.left + ' → ' + pair.right));
        fb.appendChild(list);
      }
      if (q.type === 'short' && opts && typeof opts.onGradeShort === 'function') {
        const button = node(doc, 'button', 'dxa-btn dxa-btn-quiet', 'Ask Dexerion to mark this');
        button.type = 'button';
        button.onclick = async () => {
          button.disabled = true;
          button.textContent = 'Marking…';
          try {
            const marked = await opts.onGradeShort({
              question: q.prompt,
              answer: answers.get(current) || '',
              expected: q.answer,
              rubric: q.explanation || '',
            });
            if (!marked || marked.ok === false) throw new Error((marked && marked.error) || 'Could not mark this answer.');
            const verdict = marked.verdict || 'partial';
            const score = Number(marked.score);
            checked.set(current, {
              answered: true,
              correct: verdict === 'correct',
              score: Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : verdict === 'correct' ? 1 : verdict === 'incorrect' ? 0 : 0.5,
              ai: true,
            });
            const note = node(doc, 'div', 'dxa-ai-mark');
            note.appendChild(node(doc, 'strong', '', 'AI marking: ' + verdict));
            note.appendChild(node(doc, 'p', '', marked.feedback || 'No feedback returned.'));
            note.appendChild(node(doc, 'small', '', marked.disclaimer || 'AI marking is a guide, not a verdict.'));
            fb.appendChild(note);
            button.remove();
          } catch (error) {
            button.disabled = false;
            button.textContent = 'Ask Dexerion to mark this';
            fb.appendChild(node(doc, 'p', 'dxa-err', error.message || 'Could not mark this answer.'));
          }
        };
        fb.appendChild(button);
      }
    }

    function renderQuestion() {
      finished = false;
      stage.replaceChildren();
      nav.replaceChildren();
      const q = questions[current];
      if (!q) return;
      const prompt = node(doc, 'div', 'dxa-q-prompt');
      prompt.appendChild(node(doc, 'span', 'dxa-q-n', String(current + 1)));
      prompt.appendChild(node(doc, 'span', '', q.prompt));
      stage.appendChild(prompt);
      const box = node(doc, 'div', 'dxa-answer');
      box.dataset.dxaAnswer = '1';
      const order = orderFor(current);
      const saved = answers.get(current);
      const uid = 'dxa' + Math.random().toString(36).slice(2, 8) + current;
      if (q.type === 'single') {
        const list = order;
        for (let display = 0; display < list.length; display++) {
          const label = node(doc, 'label', 'dxa-option');
          const input = doc.createElement('input');
          input.type = 'radio';
          input.name = uid;
          input.value = String(display);
          if (saved === display) input.checked = true;
          label.appendChild(input);
          label.appendChild(node(doc, 'span', '', q.options[list[display]]));
          box.appendChild(label);
        }
      } else if (q.type === 'truefalse') {
        for (const value of [true, false]) {
          const label = node(doc, 'label', 'dxa-option');
          const input = doc.createElement('input');
          input.type = 'radio';
          input.name = uid;
          input.value = value ? 'true' : 'false';
          if (saved === value) input.checked = true;
          label.appendChild(input);
          label.appendChild(node(doc, 'span', '', q.options[value ? 0 : 1]));
          box.appendChild(label);
        }
      } else if (q.type === 'multi') {
        for (let display = 0; display < order.length; display++) {
          const original = order[display];
          const label = node(doc, 'label', 'dxa-option');
          const input = doc.createElement('input');
          input.type = 'checkbox';
          input.value = String(display);
          if (arr(saved).includes(display)) input.checked = true;
          label.appendChild(input);
          label.appendChild(node(doc, 'span', '', q.options[original]));
          box.appendChild(label);
        }
      } else if (q.type === 'short') {
        const field = doc.createElement('textarea');
        field.rows = 4;
        field.className = 'dxa-text';
        field.placeholder = 'Write your answer…';
        field.value = saved || '';
        box.appendChild(field);
      } else if (q.type === 'match') {
        const pairs = q.pairs || [];
        const right = pairs.map((p) => p.right);
        const shuffled = [];
        for (const i of order) shuffled.push(right[i]);
        pairs.forEach((pair, i) => {
          const row = node(doc, 'label', 'dxa-match');
          row.appendChild(node(doc, 'span', '', pair.left));
          const select = doc.createElement('select');
          select.className = 'dxa-select';
          const blank = doc.createElement('option');
          blank.value = '';
          blank.textContent = 'Choose…';
          select.appendChild(blank);
          for (const option of shuffled) {
            const o = doc.createElement('option');
            o.value = option;
            o.textContent = option;
            select.appendChild(o);
          }
          const picked = arr(saved)[i];
          if (picked && shuffled.includes(picked)) select.value = picked;
          row.appendChild(select);
          box.appendChild(row);
        });
      }
      stage.appendChild(box);
      const fb = node(doc, 'div', 'dxa-feedback');
      fb.hidden = true;
      stage.appendChild(fb);
      if (checked.has(current)) {
        const result = checked.get(current);
        fb.hidden = false;
        showFeedback(result);
      }
      const back = node(doc, 'button', 'dxa-btn dxa-btn-quiet', 'Back');
      back.type = 'button';
      back.disabled = current === 0 || finished;
      back.onclick = () => { capture(); current = Math.max(0, current - 1); renderQuestion(); };
      const check = node(doc, 'button', 'dxa-btn', 'Check answer');
      check.type = 'button';
      check.disabled = checked.has(current);
      check.onclick = () => {
        capture();
        const result = evaluateQuestion(q, answers.get(current), order);
        checked.set(current, result);
        fb.hidden = false;
        showFeedback(result);
        check.disabled = true;
      };
      const next = node(doc, 'button', 'dxa-btn dxa-btn-primary', current === questions.length - 1 ? 'Finish' : 'Next');
      next.type = 'button';
      next.onclick = () => {
        capture();
        const prior = checked.get(current);
        if (prior && prior.ai !== true) checked.set(current, evaluateQuestion(q, answers.get(current), order));
        if (current >= questions.length - 1) finish();
        else { current += 1; renderQuestion(); }
      };
      nav.append(back, node(doc, 'span', 'dxa-spacer'), check, next);
      progress();
    }

    function answerText(q, value, order) {
      if (value === undefined) return '(no answer)';
      if (q.type === 'short') return String(value);
      if (q.type === 'match') return arr(value).map((v, i) => ((q.pairs || [])[i] || { left: '?' }).left + ' → ' + (v || '(none)')).join('; ');
      if (q.type === 'multi') return arr(value).map((v) => q.options[order ? order[v] : v]).filter(Boolean).join(', ');
      if (q.type === 'single') return q.options[order ? order[value] : value] || '';
      if (q.type === 'truefalse') return value ? 'True' : 'False';
      return String(value);
    }

    function finish() {
      finished = true;
      capture();
      let total = 0;
      questions.forEach((q, i) => {
        let result = checked.get(i);
        if (!result || result.ai !== true) {
          result = evaluateQuestion(q, answers.get(i), orderFor(i));
          checked.set(i, result);
        }
        total += result.score;
      });
      const pct = Math.round((total / Math.max(1, questions.length)) * 100);
      const passed = pct >= artifact.passing;
      stage.replaceChildren();
      nav.replaceChildren();
      progress();
      const result = node(doc, 'div', 'dxa-quiz-result');
      const score = node(doc, 'div', 'dxa-score ' + (passed ? 'ok' : 'bad'));
      score.appendChild(node(doc, 'strong', '', pct + '%'));
      score.appendChild(node(doc, 'span', '', passed ? 'Passed' : 'Below the ' + artifact.passing + '% pass mark'));
      result.appendChild(score);
      const review = node(doc, 'div', 'dxa-review');
      const wrong = questions.map((q, i) => ({ q, i, r: checked.get(i) })).filter((row) => !row.r.correct);
      review.appendChild(node(doc, 'h4', 'dxa-h', wrong.length ? 'Review (' + wrong.length + ' to improve)' : 'Every answer was correct'));
      if (!wrong.length) review.appendChild(node(doc, 'p', '', 'Nothing to review — try the shuffle for a fresh run.'));
      for (const row of wrong) {
        const item = node(doc, 'div', 'dxa-review-item');
        item.appendChild(node(doc, 'p', 'dxa-review-q', row.i + 1 + '. ' + row.q.prompt));
        item.appendChild(node(doc, 'p', 'dxa-review-a', 'Your answer: ' + answerText(row.q, answers.get(row.i), orderFor(row.i))));
        if (row.q.type === 'short') item.appendChild(node(doc, 'p', 'dxa-review-a', 'Model answer: ' + row.q.answer));
        if (row.q.type === 'match') item.appendChild(node(doc, 'p', 'dxa-review-a', 'Correct: ' + (row.q.pairs || []).map((p) => p.left + ' → ' + p.right).join('; ')));
        if (row.q.explanation) item.appendChild(node(doc, 'p', 'dxa-review-e', row.q.explanation));
        review.appendChild(item);
      }
      result.appendChild(review);
      const actions = node(doc, 'div', 'dxa-quiz-nav');
      const retry = node(doc, 'button', 'dxa-btn', 'Retry');
      retry.type = 'button';
      retry.onclick = () => {
        answers.clear(); checked.clear(); orders.clear(); current = 0; finished = false; renderQuestion();
      };
      const shuffle = node(doc, 'button', 'dxa-btn dxa-btn-primary', 'Shuffle & retry');
      shuffle.type = 'button';
      shuffle.onclick = () => {
        answers.clear(); checked.clear(); orders.clear(); current = 0; finished = false;
        questions.forEach((q, i) => {
          const n = q.type === 'match' ? (q.pairs || []).length : (q.options || []).length;
          const list = Array.from({ length: n }, (_, k) => k);
          for (let k = list.length - 1; k > 0; k--) {
            const j = Math.floor(Math.random() * (k + 1));
            [list[k], list[j]] = [list[j], list[k]];
          }
          orders.set(i, list);
        });
        renderQuestion();
      };
      actions.append(retry, shuffle);
      result.appendChild(actions);
      stage.appendChild(result);
    }

    // Progress survives a reload when the host supplies somewhere to put it:
    // answers, which questions were already checked, and where the person was.
    const snapshot = () => ({
      current,
      finished,
      answers: Array.from(answers.entries()),
      checked: Array.from(checked.entries()).map(([i, r]) => [i, { correct: Boolean(r.correct), score: Number(r.score) || 0 }]),
      // The per-question option order is what saved answers are expressed in;
      // without it a shuffled quiz re-derived a different order on reload and
      // the same index pointed at a different option.
      orders: Array.from(orders.entries()),
    });
    const emit = () => { if (typeof opts.onState === 'function') { try { opts.onState(snapshot()); } catch {} } };
    if (opts.state && typeof opts.state === 'object' && !opts.state.__applied) {
      const saved = opts.state;
      try {
        // Order first: answers are display indices, so the saved order has to be
        // in place before anything reads an option list.
        if (Array.isArray(saved.orders)) {
          for (const [i, list] of saved.orders) {
            const at = Number(i);
            const q = questions[at];
            if (!q || !Array.isArray(list)) continue;
            const n = q.type === 'match' ? (q.pairs || []).length : (q.options || []).length;
            const clean = list.map(Number).filter((v) => Number.isInteger(v) && v >= 0 && v < n);
            if (clean.length === n) orders.set(at, clean);
          }
        }
        if (Array.isArray(saved.answers)) for (const [i, v] of saved.answers) answers.set(Number(i), v);
        if (Array.isArray(saved.checked)) {
          for (const [i, r] of saved.checked) checked.set(Number(i), { answered: true, correct: Boolean(r && r.correct), score: Number(r && r.score) || 0, ai: false });
        }
        current = Number.isInteger(saved.current) ? Math.max(0, Math.min(questions.length - 1, saved.current)) : 0;
        // The result screen is rebuilt from answers on demand; a reload lands
        // on the question the person was on, with every answer kept.
        opts.state.__applied = true;
      } catch { /* a corrupt snapshot just means starting over */ }
    }
    // Interactions report state on the way out (bubble phase, so the quiz's own
    // handler has already run), plus once after mount.
    const wrappedEmit = () => { try { emit(); } catch {} };
    if (typeof opts.onState === 'function') {
      wrap.addEventListener('click', wrappedEmit);
      wrap.addEventListener('change', wrappedEmit);
      const raf = (GLOBAL && typeof GLOBAL.requestAnimationFrame === 'function')
        ? GLOBAL.requestAnimationFrame.bind(GLOBAL) : (fn) => fn();
      raf(wrappedEmit);
    }

    renderQuestion();
    return wrap;
  }

  // ---------- flashcards ----------------------------------------------------
  function renderDeck(doc, artifact, opts) {
    const options = opts || {};
    const wrap = node(doc, 'div', 'dxa-deck');
    const cards = artifact.cards || [];
    let index = 0;
    let flipped = false;
    const known = new Set();
    if (options.state && typeof options.state === 'object' && !options.state.__applied) {
      try {
        if (Array.isArray(options.state.known)) {
          for (const i of options.state.known) {
            const n = Number(i);
            if (Number.isInteger(n) && n >= 0 && n < cards.length) known.add(n);
          }
        }
        index = Number.isInteger(options.state.index) ? Math.max(0, Math.min(cards.length - 1, options.state.index)) : 0;
        options.state.__applied = true;
      } catch { /* start fresh */ }
    }
    const status = node(doc, 'div', 'dxa-deck-status');
    const card = node(doc, 'button', 'dxa-flash');
    card.type = 'button';
    const face = node(doc, 'span', 'dxa-flash-face');
    card.appendChild(face);
    const hint = node(doc, 'span', 'dxa-flash-hint', 'Click to flip');
    const nav = node(doc, 'div', 'dxa-quiz-nav');
    const prev = node(doc, 'button', 'dxa-btn dxa-btn-quiet', 'Back');
    const next = node(doc, 'button', 'dxa-btn', 'Next');
    const know = node(doc, 'button', 'dxa-btn dxa-btn-quiet', 'Got it');
    const review = node(doc, 'button', 'dxa-btn dxa-btn-quiet', 'Review');
    prev.type = next.type = know.type = review.type = 'button';
    const progress = node(doc, 'div', 'dxa-progress');
    const fill = node(doc, 'i', 'dxa-progress-fill');
    progress.appendChild(fill);

    function paint() {
      const c = cards[index] || { front: '', back: '' };
      status.textContent = 'Card ' + (index + 1) + ' of ' + cards.length + ' · ' + known.size + ' known';
      face.textContent = flipped ? c.back : c.front;
      face.className = 'dxa-flash-face' + (flipped ? ' back' : '');
      hint.textContent = flipped ? 'Click to see the prompt' : 'Click to flip';
      fill.style.width = Math.round(((index + 1) / Math.max(1, cards.length)) * 100) + '%';
      prev.disabled = index === 0;
      next.textContent = index === cards.length - 1 ? 'Restart' : 'Next';
      know.classList.toggle('on', known.has(index));
    }
    card.onclick = () => { flipped = !flipped; paint(); };
    prev.onclick = () => { index = Math.max(0, index - 1); flipped = false; paint(); };
    next.onclick = () => {
      if (index >= cards.length - 1) { index = 0; known.clear(); }
      else index += 1;
      flipped = false; paint();
    };
    know.onclick = () => { known.add(index); paint(); };
    review.onclick = () => { known.delete(index); paint(); };
    nav.append(prev, know, review, next);
    wrap.append(status, progress, card, hint, nav);
    paint();
    // Same progress contract as the quiz: the known set and the card last seen
    // survive a reload when the host stores them.
    if (typeof options.onState === 'function') {
      const emit = () => {
        try { options.onState({ index, known: Array.from(known).sort((a, b) => a - b) }); } catch {}
      };
      wrap.addEventListener('click', emit);
      const raf = (GLOBAL && typeof GLOBAL.requestAnimationFrame === 'function')
        ? GLOBAL.requestAnimationFrame.bind(GLOBAL) : (fn) => fn();
      raf(emit);
    }
    return wrap;
  }

  // ---------- timeline ------------------------------------------------------
  function renderTimeline(doc, artifact, opts) {
    const wrap = node(doc, 'div', 'dxa-timeline');
    if (artifact.subtitle) wrap.appendChild(node(doc, 'p', 'dxa-subtitle', artifact.subtitle));
    for (const entry of artifact.entries || []) {
      const item = node(doc, 'div', 'dxa-tl-item');
      const mark = node(doc, 'span', 'dxa-tl-dot');
      const body = node(doc, 'div', 'dxa-tl-body');
      if (entry.date) body.appendChild(node(doc, 'span', 'dxa-tl-date', entry.date));
      if (entry.title) body.appendChild(node(doc, 'h4', 'dxa-h', entry.title));
      if (entry.text) body.appendChild(markdown(doc, entry.text, opts));
      item.append(mark, body);
      wrap.appendChild(item);
    }
    return wrap;
  }

  // ---------- sandboxed website --------------------------------------------
  function renderSite(doc, artifact, opts) {
    // An in-place save replaces the artifact (the card's `artifact` binding is
    // reassigned through onSaved), but this function closed over the object it
    // was built with — so Restart silently reloaded the pre-edit page and the
    // person thought their save had failed. Read through the getter the card
    // provides; fall back to the parameter for the standalone artifact viewer.
    const liveArtifact = () => (opts && typeof opts.getArtifact === 'function' ? opts.getArtifact() : null) || artifact;
    const wrap = node(doc, 'div', 'dxa-site');
    if (artifact.description) wrap.appendChild(markdown(doc, artifact.description, opts));
    const bar = node(doc, 'div', 'dxa-sitebar');
    bar.appendChild(node(doc, 'span', 'dxa-site-note', 'Sandboxed preview · scripts run, network is blocked'));
    // Which page is on screen, named. Main's frame-navigation events keep it
    // true even when a link inside the preview is what navigated.
    const pageLabel = node(doc, 'span', 'dxa-site-page', '');
    pageLabel.hidden = true;
    bar.appendChild(pageLabel);
    const expand = node(doc, 'button', 'dxa-btn dxa-btn-quiet', 'Expand');
    expand.type = 'button';
    const restart = node(doc, 'button', 'dxa-btn dxa-btn-quiet', 'Reload');
    restart.type = 'button';
    restart.title = 'Reload the preview from its source';
    bar.append(expand, restart);
    // One click out of the inline preview: the same artifact as a full page in
    // a real tab (the focus overlay's page bar already has its own route out).
    if (GLOBAL && GLOBAL.dexerion && typeof GLOBAL.dexerion.invoke === 'function'
        && opts && opts.chatId && Number.isInteger(opts.index)) {
      const openTab = node(doc, 'button', 'dxa-btn dxa-btn-quiet', 'Open in tab');
      openTab.type = 'button';
      openTab.title = 'Open this site as a full page in a new tab';
      openTab.onclick = () => {
        if (typeof opts.onOpenTab === 'function') { opts.onOpenTab(); return; }
        GLOBAL.dexerion.invoke('dex:new-tab',
          'dexerion://artifact?chat=' + encodeURIComponent(String(opts.chatId)) + '&i=' + String(opts.index), false)
          .catch(() => {});
      };
      bar.append(openTab);
    }
    // Phone / Desktop: generated pages are usually responsive, but the preview
    // is the only way to check that. The toggle only changes the frame width.
    const widths = node(doc, 'div', 'dxa-width');
    // The frame lives in its own box so a staged (double-buffered) frame can
    // load behind it without touching layout — see stageFrame below.
    const frameBox = node(doc, 'div', 'dxa-frame-box');
    let frame = doc.createElement('iframe');
    frame.className = 'dxa-frame';
    frame.title = artifact.title || 'Interactive artifact preview';
    // Capabilities the page is likely to call. Modals (alert/confirm),
    // downloads and popups stay inside the sandbox; top navigation stays
    // denied. Same-origin is added only when the site is served from its own
    // dexsite:// host (below) — the shell is a different origin either way,
    // so the served form buys real storage/modules for the SITE, not access
    // to Dexerion.
    frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-downloads allow-popups');
    frame.setAttribute('allow', '');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    // ---- virtual-host serving + multi-page chrome ----
    const siteFiles = arr(artifact.files);
    // Per-chat preview memory (page + width) — see previewPrefsGet above.
    const chatKey = (opts && opts.chatId) ? String(opts.chatId) : '';
    let siteInfo = null;          // { id, entry, url, pages } once served
    let currentPage = '';
    const pagesRow = node(doc, 'div', 'dxa-pages');
    pagesRow.hidden = true;
    const paintPages = (info, entry) => {
      const list = arr(info);
      pagesRow.replaceChildren();
      pagesRow.hidden = list.length <= 1;
      if (list.length <= 1) return;
      for (const page of list) {
        const path = String((page && page.path) || '');
        if (!path) continue;
        // The page's own <title> when it has one (parsed once at registration
        // in main), the file name otherwise.
        const b = node(doc, 'button', 'dxa-page-btn' + (path === entry ? ' on' : ''),
          (page && page.title) || path.split('/').pop());
        b.type = 'button';
        b.title = path;
        // Single-select semantics: the active page is the current one, not an
        // independent toggle (V20 a11y pass).
        if (path === entry) b.setAttribute('aria-current', 'page');
        b.setAttribute('aria-pressed', path === entry ? 'true' : 'false');
        b.onclick = () => navigatePage(path);
        pagesRow.appendChild(b);
      }
    };
    const paintActive = (page) => {
      Array.from(pagesRow.children).forEach((b) => {
        const on = b.title === page;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    };
    const paintPageLabel = (path) => {
      const info = siteInfo && arr(siteInfo.pageInfo).find((p) => p && p.path === path);
      const title = (info && info.title) || '';
      pageLabel.textContent = path ? (title || path) : '';
      pageLabel.hidden = !path;
    };
    const navigatePage = (page) => {
      if (!siteInfo || !page) return;
      currentPage = page;
      previewPrefsSet(chatKey, { page });
      frame.src = 'dexsite://' + siteInfo.id + '/' + page + '?v=' + Date.now();
      paintActive(page);
      paintPageLabel(page);
    };
    // Main's frame-navigation bridge lands here: follow the page WITHOUT
    // reloading — the frame has already navigated; only the chrome catches up.
    wrap.__dxaSetPage = (path) => {
      if (!siteInfo || !path) return;
      if (!arr(siteInfo.pages).includes(path)) return;
      currentPage = path;
      previewPrefsSet(chatKey, { page: path });
      paintActive(path);
      paintPageLabel(path);
    };
    // Double-buffered swaps (V20, the research's anti-flash fix): a save or
    // regenerate loads the next page into a hidden twin and swaps on load —
    // the old preview stays on screen until the new one is ready. Swapping
    // rebinds `frame`, so every closure that touches the live preview
    // (console capture, edit mode, restart, width presets) follows. The first
    // serve navigates in place: there is nothing on screen to flash.
    const stageFrame = (src, sandboxAttr) => {
      const next = doc.createElement('iframe');
      next.className = frame.className;
      next.title = frame.title;
      if (sandboxAttr) next.setAttribute('sandbox', sandboxAttr);
      next.setAttribute('allow', '');
      next.setAttribute('referrerpolicy', 'no-referrer');
      next.style.position = 'absolute';
      next.style.inset = '0';
      next.style.width = '100%';
      next.style.height = '100%';
      next.style.visibility = 'hidden';
      const old = frame;
      frameBox.appendChild(next);
      let swapped = false;
      const swap = () => {
        if (swapped) return;
        swapped = true;
        try {
          next.style.position = '';
          next.style.inset = '';
          next.style.width = '';
          next.style.height = '';
          next.style.visibility = '';
          frameBox.replaceChild(next, old);
          frame = next;
        } catch { /* keep the old frame on any swap failure */ }
      };
      next.addEventListener('load', swap, { once: true });
      // If the staged page never loads (host gone, navigation refused), fall
      // back to navigating the live frame in place — never leave a dead
      // preview hidden behind a twin.
      setTimeout(() => {
        if (swapped || frame === next) return;
        try { next.remove(); } catch {}
        try { old.src = src; } catch {}
      }, 12000);
      next.src = src;
      return next;
    };
    // Serve the file set from its virtual host. Returns false when serving is
    // not possible (no bridge, or no files), so the caller keeps the flattened
    // single-document fallback. Responses are token-guarded: a slow first
    // serve landing after a save's re-serve must never point the preview back
    // at the old host (found by the V20 polish pass).
    let serveSeq = 0;
    const serveAndLoad = (next) => {
      const source = next || liveArtifact();
      const bridge = GLOBAL && GLOBAL.dexerion;
      if (!arr(source.files).length || !bridge || typeof bridge.invoke !== 'function') return false;
      const seq = ++serveSeq;
      Promise.resolve(bridge.invoke('dex:ai-site-serve', { artifact: source })).then((res) => {
        if (seq !== serveSeq) return;   // a newer serve superseded this one
        if (!res || !res.ok || !res.id) throw new Error((res && res.error) || 'Could not serve the site');
        siteInfo = res;
        const sandbox = 'allow-scripts allow-same-origin allow-forms allow-modals allow-downloads allow-popups';
        // Stay on the page the person is looking at when it still exists
        // (a save reloads in place instead of jumping back to index); a fresh
        // render resumes the remembered page for this chat.
        const want = currentPage || previewPrefsGet(chatKey).page || '';
        const target = (want && arr(res.pages).includes(want)) ? want : res.entry;
        currentPage = target;
        const src = 'dexsite://' + res.id + '/' + target + '?v=' + Date.now();
        if (frame.getAttribute('srcdoc') !== null || !frame.getAttribute('src')) {
          // First serve (or the srcdoc fallback form): nothing is on screen
          // yet — navigate in place.
          frame.setAttribute('sandbox', sandbox);
          frame.removeAttribute('srcdoc');
          frame.src = src;
        } else {
          // A live preview exists: stage the twin and swap when it loads.
          stageFrame(src, sandbox);
        }
        const info = arr(res.pageInfo).length
          ? res.pageInfo
          : arr(res.pages).map((path) => ({ path, title: '' }));
        paintPages(info, target);
        paintPageLabel(target);
      }).catch(() => {
        if (siteInfo) {
          // A reload failure keeps the running preview — but it must SAY so,
          // or the person believes the save is live in the preview (V20).
          showIssue('warn', 'Reload failed — the preview still shows the previous version. Press Restart to try again.', []);
          return;
        }
        frame.srcdoc = safeSiteHtml(source.html, { files: arr(source.files) });
      });
      return true;
    };
    // The Code panel's save calls this: re-serve the edited files and reload.
    wrap.__dxaReload = (next) => {
      if (!next) return;
      if (!serveAndLoad(next)) frame.srcdoc = safeSiteHtml(next.html, { files: arr(next.files) });
    };
    // Which page is on screen — the card's Download HTML exports this one.
    wrap.__dxaPage = () => currentPage;
    // Three of the researched device-mode presets, the ones that matter for a
    // sidebar preview: a common phone (390), a tablet (768), the full pane.
    [['Phone', 'dxa-frame-phone', 390], ['Tablet', 'dxa-frame-tablet', 768], ['Desktop', '', null]].forEach(([label, cls, px], i) => {
      const b = node(doc, 'button', 'dxa-btn dxa-btn-quiet dxa-width-btn' + (i === 2 ? ' on' : ''), label + (px ? ' ' + px + 'px' : ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', i === 2 ? 'true' : 'false');
      b.title = px ? label + ' (' + px + 'px)' : label + ' (full pane)';
      b.onclick = () => {
        frame.classList.toggle('dxa-frame-phone', cls === 'dxa-frame-phone');
        frame.classList.toggle('dxa-frame-tablet', cls === 'dxa-frame-tablet');
        Array.from(widths.children).forEach((other) => {
          other.classList.toggle('on', other === b);
          other.setAttribute('aria-pressed', other === b ? 'true' : 'false');
        });
        previewPrefsSet(chatKey, { w: label.toLowerCase() });
      };
      widths.appendChild(b);
    });
    // Resume the remembered width for this chat (a clicked preset keeps its
    // own bookkeeping in step because this goes through the same handlers).
    {
      const remembered = previewPrefsGet(chatKey).w;
      if (remembered === 'phone' || remembered === 'tablet') {
        const idx = remembered === 'phone' ? 0 : 1;
        if (widths.children[idx]) widths.children[idx].click();
      }
    }
    bar.insertBefore(widths, expand);
    bar.insertBefore(pagesRow, expand);
    expand.onclick = () => {
      const on = wrap.classList.toggle('expanded');
      expand.textContent = on ? 'Collapse' : 'Expand';
      exitBtn.hidden = !on;
    };
    const exitBtn = node(doc, 'button', 'dxa-btn dxa-btn-quiet', 'Exit preview');
    exitBtn.type = 'button';
    exitBtn.hidden = true;
    exitBtn.title = 'Collapse the preview and return to the chat';
    exitBtn.onclick = () => {
      wrap.classList.remove('expanded');
      expand.textContent = 'Expand';
      exitBtn.hidden = true;
    };
    bar.appendChild(exitBtn);
    restart.onclick = () => {
      if (siteInfo) {
        restart.textContent = 'Reloading…';
        restart.disabled = true;
        navigatePage(currentPage || siteInfo.entry);
        // Re-enable once the frame starts loading (the navigatePage above sets src immediately).
        setTimeout(() => { restart.textContent = 'Reload'; restart.disabled = false; }, 300);
        return;
      }
      restart.textContent = 'Reloading…';
      restart.disabled = true;
      frame.srcdoc = safeSiteHtml(liveArtifact().html, { files: arr(liveArtifact().files) });
      setTimeout(() => { restart.textContent = 'Reload'; restart.disabled = false; }, 300);
    };
    wrap.append(bar, frameBox);
    frameBox.appendChild(frame);
    // Number keys 1-9 switch preview pages (multi-page sites only).
    wrap.addEventListener('keydown', (e) => {
      if (!siteInfo || !arr(siteInfo.pages).length) return;
      const n = Number(e.key);
      if (n < 1 || n > 9) return;
      const pages = arr(siteInfo.pages);
      if (n > pages.length) return;
      e.preventDefault();
      navigatePage(pages[n - 1].path);
    }, true);
    if (siteFiles.length) {
      if (!serveAndLoad(artifact)) frame.srcdoc = safeSiteHtml(artifact.html, { files: siteFiles });
    } else {
      frame.srcdoc = safeSiteHtml(artifact.html, { files: siteFiles });
    }

    // Preview health. The iframe is opaque-origin, so nothing inside it can be
    // inspected; instead the main process diagnoses the artifact (empty page,
    // stripped references, unresolved files) and the frame's own load/error
    // events catch a document that never starts. Both surface as one strip in
    // the CHAT card, never over the preview: the renderer's full-page viewer
    // omits `issueHost`, and hides the fallback strip entirely. The strip is a
    // real two-action control: a text line plus explicit buttons ("Open Code",
    // and "Fix with AI" when the host offers a fix path). No clickable
    // container pretending to be a button — nested interactives were the old
    // shape's accessibility problem.
    const issueHost = opts && opts.issueHost;
    const issues = node(doc, 'div', 'dxa-issues');
    issues.hidden = true;
    if (issueHost) {
      issueHost.hidden = true;
      issueHost.appendChild(issues);
    } else {
      wrap.appendChild(issues);
    }
    const issueText = node(doc, 'span', 'dxa-issues-text');
    const issueActions = node(doc, 'div', 'dxa-issues-actions');
    const openCodeBtn = node(doc, 'button', 'dxa-issue-btn', 'Open Code');
    openCodeBtn.type = 'button';
    openCodeBtn.title = 'Open the source behind this preview';
    openCodeBtn.onclick = () => {
      const code = wrap.parentElement && wrap.parentElement.querySelector('.dxa-code');
      if (!code) {
        const btn = wrap.parentElement && wrap.parentElement.querySelector('.dxa-actions .dxa-btn');
        const all = wrap.parentElement ? Array.from(wrap.parentElement.querySelectorAll('.dxa-actions button')) : [];
        const codeBtn = all.find((b) => b.textContent.trim() === 'Code');
        if (codeBtn) codeBtn.click();
        else if (btn) btn.click();
      }
    };
    const fixBtn = node(doc, 'button', 'dxa-issue-btn dxa-issue-fix', 'Fix with AI');
    fixBtn.type = 'button';
    fixBtn.title = 'Ask the model to repair these issues';
    fixBtn.hidden = true;
    let lastIssues = [];
    const hasFixHost = () => Boolean(opts && typeof opts.onFixIssues === 'function');
    fixBtn.onclick = () => {
      if (hasFixHost() && lastIssues.length) opts.onFixIssues(lastIssues.slice(0, 8));
      else toast(opts, 'Nothing to fix.');
    };
    issueActions.append(openCodeBtn, fixBtn);
    issues.append(issueText, issueActions);
    const showIssue = (level, text, fixables) => {
      issues.hidden = false;
      if (issueHost) issueHost.hidden = false;
      issues.dataset.level = level;
      issueText.textContent = text;
      if (Array.isArray(fixables) && fixables.length) lastIssues = fixables.map((s) => String(s));
      fixBtn.hidden = !(hasFixHost() && lastIssues.length);
    };
    // Console panel (V10): the page's own console output, deduped and capped.
    // The badge carries the signal; the panel carries the detail; the strip is
    // never spammed with log lines (research: badge + panel, not strip flood).
    const consoleLog = [];
    const consoleIndex = new Map();
    const consoleBtn = node(doc, 'button', 'dxa-btn dxa-btn-quiet dxa-console-btn', '');
    consoleBtn.type = 'button';
    consoleBtn.hidden = true;
    consoleBtn.title = 'Console output from this site';
    const consoleCountEl = node(doc, 'span', 'dxa-console-count', '');
    consoleBtn.append(node(doc, 'span', '', 'Console'), consoleCountEl);
    bar.appendChild(consoleBtn);

    // Preview editing (V12): toggle text-edit mode in the served frame; picks
    // resolve to ONE source occurrence and save through the same validated
    // path the Code panel uses (history, persistence, re-serve).
    const canEditText = Boolean(opts && opts.chatId) && Number.isInteger(opts && opts.index);
    const editBtn = node(doc, 'button', 'dxa-btn dxa-btn-quiet dxa-edit-btn', 'Edit');
    editBtn.type = 'button';
    editBtn.hidden = !canEditText;
    editBtn.title = 'Edit text in the preview';
    editBtn.setAttribute('aria-label', 'Edit text in the preview');
    editBtn.setAttribute('aria-pressed', 'false');
    bar.appendChild(editBtn);
    let editMode = false;
    const setEditMode = (on) => {
      editMode = Boolean(on);
      editBtn.classList.toggle('on', editMode);
      editBtn.setAttribute('aria-pressed', editMode ? 'true' : 'false');
      try { if (frame.contentWindow) frame.contentWindow.postMessage({ dexEdit: editMode ? 1 : 0 }, '*'); } catch { /* frame not ready yet */ }
    };
    editBtn.onclick = () => setEditMode(!editMode);
    const editBar = node(doc, 'div', 'dxa-editbar');
    editBar.hidden = true;
    const editWhere = node(doc, 'span', 'dxa-editbar-where', '');
    const editInput = doc.createElement('input');
    editInput.type = 'text';
    editInput.className = 'dxa-editbar-input';
    editInput.setAttribute('aria-label', 'New text');
    // "Update", not "Save": a second button labelled Save in the same card
    // would shadow the Code panel's in text-based lookups (and read as a
    // duplicate action to a person scanning the card).
    const editSaveBtn = node(doc, 'button', 'dxa-issue-btn dxa-console-fix dxa-editbar-save', 'Update');
    editSaveBtn.type = 'button';
    const editCancelBtn = node(doc, 'button', 'dxa-issue-btn dxa-editbar-cancel', 'Cancel');
    editCancelBtn.type = 'button';
    editBar.append(editWhere, editInput, editSaveBtn, editCancelBtn);
    wrap.appendChild(editBar);
    let pendingPick = null;
    const hideEditBar = () => { editBar.hidden = true; pendingPick = null; };
    const openEditBar = (pick) => {
      if (!pick || !pick.text) {
        toast(opts, 'That element has no text to edit — click a heading, paragraph or button label.');
        return;
      }
      pendingPick = pick;
      editWhere.textContent = (pick.tag || 'element') + ' · ' + String(pick.path || '').slice(0, 60);
      editInput.value = pick.text;
      editBar.hidden = false;
      try { editInput.focus(); editInput.select(); } catch {}
    };
    // Resolve a picked text to exactly ONE occurrence: the page on screen
    // first, then any single file — otherwise refuse (the Code panel exists
    // for ambiguous edits; guessing would corrupt the wrong text).
    const applyTextEdit = (oldText, newText) => {
      const files = arr(liveArtifact().files);
      if (!oldText || !newText || oldText === newText) return null;
      const countIn = (s) => String(s).split(oldText).length - 1;
      const html = files.filter((f) => /\.html?$/i.test(f.path));
      let target = html.find((f) => f.path === currentPage && countIn(f.content) === 1) || null;
      if (!target) {
        const hits = files.filter((f) => countIn(f.content) === 1);
        if (hits.length === 1) target = hits[0];
      }
      if (!target) return null;
      return files.map((f) => (f === target ? { path: f.path, content: f.content.replace(oldText, newText) } : f));
    };
    editSaveBtn.onclick = () => {
      const pick = pendingPick;
      const nextFiles = pick ? applyTextEdit(pick.text, String(editInput.value || '').trim()) : null;
      if (!nextFiles) {
        toast(opts, 'Could not locate that text uniquely — it may appear more than once; use the Code panel instead.');
        hideEditBar();
        return;
      }
      const bridge = GLOBAL && GLOBAL.dexerion;
      if (!bridge || typeof bridge.invoke !== 'function') { hideEditBar(); return; }
      Promise.resolve(bridge.invoke('dex:ai-artifact-source-save', {
        chatId: opts.chatId, index: opts.index, files: nextFiles, note: 'edited text in the preview',
      })).then((res) => {
        if (res && res.ok && res.artifact) {
          if (typeof opts.setArtifact === 'function') opts.setArtifact(res.artifact);
          if (typeof opts.onArtifactSaved === 'function') opts.onArtifactSaved(res.artifact);
          wrap.__dxaReload(res.artifact);
          toast(opts, 'Text updated.');
        } else {
          toast(opts, (res && res.error) || 'Could not save the edit.');
        }
        hideEditBar();
      }).catch(() => { toast(opts, 'Could not save the edit.'); hideEditBar(); });
    };
    editCancelBtn.onclick = hideEditBar;
    const consolePanel = node(doc, 'div', 'dxa-console');
    consolePanel.hidden = true;
    const consoleHead = node(doc, 'div', 'dxa-console-head');
    const consoleClearBtn = node(doc, 'button', 'dxa-issue-btn', 'Clear');
    consoleClearBtn.type = 'button';
    const consoleFixBtn = node(doc, 'button', 'dxa-issue-btn dxa-console-fix', 'Ask to fix');
    consoleFixBtn.type = 'button';
    consoleFixBtn.hidden = true;
    consoleHead.append(node(doc, 'span', 'dxa-console-title', 'Console'), consoleClearBtn, consoleFixBtn);
    const consoleList = node(doc, 'div', 'dxa-console-list');
    consolePanel.append(consoleHead, consoleList);
    wrap.appendChild(consolePanel);

    const paintConsole = () => {
      consoleBtn.hidden = consoleLog.length === 0;
      if (consoleBtn.hidden) consolePanel.hidden = true;
      const worst = consoleLog.some((e) => e.level === 'error') ? 'error'
        : consoleLog.some((e) => e.level === 'warn') ? 'warn' : 'log';
      consoleCountEl.textContent = String(consoleLog.length);
      consoleBtn.dataset.level = worst;
      consoleFixBtn.hidden = !(typeof opts.onFixIssues === 'function' && consoleLog.some((e) => e.level === 'error'));
      if (consolePanel.hidden) return;
      consoleList.replaceChildren();
      for (const e of consoleLog.slice(-120)) {
        const row = node(doc, 'div', 'dxa-console-row');
        row.dataset.level = e.level;
        row.append(
          node(doc, 'span', 'dxa-console-level', e.level === 'error' ? 'E' : e.level === 'warn' ? 'W' : e.level === 'debug' ? 'D' : 'L'),
          node(doc, 'span', 'dxa-console-text', e.text),
          node(doc, 'span', 'dxa-console-n', e.count > 1 ? '×' + e.count : ''),
        );
        if (e.stack) row.title = e.stack;
        consoleList.appendChild(row);
      }
    };
    const pushConsole = (level, text, stack) => {
      if (!text) return;
      const lv = ['log', 'info', 'warn', 'error', 'debug'].includes(level) ? level : 'log';
      const key = lv + '|' + text;
      const existing = consoleIndex.get(key);
      if (existing) { existing.count += 1; existing.at = Date.now(); }
      else {
        const entry = { level: lv, text, stack: stack || '', count: 1, at: Date.now() };
        consoleLog.push(entry);
        consoleIndex.set(key, entry);
        if (consoleLog.length > 300) {
          const gone = consoleLog.shift();
          const goneKey = gone ? gone.level + '|' + gone.text : '';
          if (gone && consoleIndex.get(goneKey) === gone) consoleIndex.delete(goneKey);
        }
      }
      paintConsole();
    };
    consoleBtn.onclick = () => { consolePanel.hidden = !consolePanel.hidden; paintConsole(); };
    consoleClearBtn.onclick = () => { consoleLog.length = 0; consoleIndex.clear(); paintConsole(); };
    consoleFixBtn.onclick = () => {
      const texts = consoleLog.filter((e) => e.level === 'error').slice(-5)
        .map((e) => 'Console error: ' + e.text + (e.stack ? ' (' + e.stack + ')' : ''));
      if (texts.length && typeof opts.onFixIssues === 'function') opts.onFixIssues(texts);
    };

    let previewFailed = false;
    // Runtime errors from inside the sandbox (only short strings, only from
    // this frame). The first real error is the one worth showing.
    const onMessage = (ev) => {
      try {
        if (!ev || !ev.data || ev.data.dexPreview !== 1) return;
        if (ev.source && frame.contentWindow && ev.source !== frame.contentWindow) return;
        // A blocked external link is information, not a failure: the preview
        // still works, and the strip says what was stopped and why.
        if (ev.data.kind === 'blocked') {
          const blocked = String(ev.data.message || 'External link blocked in preview.').slice(0, 300);
          showIssue('warn', blocked, [blocked]);
          return;
        }
        // The fit probe: a page wider than its slot (soft — sometimes a
        // scrollable table is the point).
        if (ev.data.kind === 'overflow') {
          const wide = String(ev.data.message || 'This page is wider than the preview.').slice(0, 300);
          showIssue('warn', wide, [wide]);
          return;
        }
        // Console output goes to the Console panel (badge), never the strip.
        if (ev.data.kind === 'console') {
          pushConsole(String(ev.data.level || 'log'), String(ev.data.text || '').slice(0, 2000), String(ev.data.stack || '').slice(0, 600));
          return;
        }
        // A text pick from edit mode opens the little editor.
        if (ev.data.kind === 'pick') {
          openEditBar(ev.data);
          return;
        }
        // The generated page's reporter only forwards Escape that the page
        // itself did not preventDefault (dialogs/menus keep their own). Relay
        // it as a namespaced DOM event: an overlay listens, a chat card does
        // not, so the chat sidebar is never closed by a preview's Escape.
        if (ev.data.kind === 'escape') {
          try {
            const view = doc.defaultView || GLOBAL;
            const target = (view && view.document) ? view.document : doc;
            const E = (view && view.Event) || (typeof Event !== 'undefined' ? Event : null);
            if (E) target.dispatchEvent(new E('dex:preview-escape', { bubbles: true }));
          } catch (err2) { /* a malformed relay is ignored */ }
          return;
        }
        if (previewFailed) return;
        const line = Number(ev.data.line) || 0;
        const what = String(ev.data.message || 'Something went wrong inside the preview.');
        showIssue('error', (line ? 'Preview error (line ' + line + '): ' : 'Preview error: ') + what, [what]);
      } catch { /* a malformed message is ignored */ }
    };
    if (HOST && typeof HOST.addEventListener === 'function') HOST.addEventListener('message', onMessage);
    frame.addEventListener('error', () => { previewFailed = true; showIssue('error', 'This preview could not be loaded — open Code to inspect the page.'); });
    frame.addEventListener('load', () => {
      // Edit mode lives inside the frame; a (re)load starts it off, so the
      // flag is re-sent to whatever document just loaded.
      if (editMode && frame.contentWindow) {
        try { frame.contentWindow.postMessage({ dexEdit: 1 }, '*'); } catch { /* best effort */ }
      }
      // Only the srcdoc form is checked here: a served page's HTML already
      // exists (it was in the file set), and srcdoc is '' for served frames.
      if (!frame.srcdoc) return;
      if (previewFailed) return;
      if (!String(liveArtifact().html || '').trim()) showIssue('error', 'This page has no HTML to render.');
    });
    const bridge = GLOBAL && GLOBAL.dexerion;
    if (bridge && typeof bridge.invoke === 'function') {
      Promise.resolve(bridge.invoke('dex:ai-artifact-diagnose', { artifact: liveArtifact() })).then((res) => {
        if (previewFailed || !res || !Array.isArray(res.issues)) return;
        const worst = res.issues.filter((i) => i.level === 'error' || i.level === 'warn');
        if (!worst.length) return;
        const first = worst[0];
        const more = worst.length > 1 ? ' (+' + (worst.length - 1) + ' more)' : '';
        // The repair list is deduplicated and prioritised (errors first), and
        // when there are more distinct findings than it can carry, the last
        // line says so — the count on the strip and the list the model
        // receives must not disagree about what was found.
        const seenIssues = new Set();
        const unique = [];
        const ordered = worst.slice().sort((a, b) => (a.level === 'error' ? 0 : 1) - (b.level === 'error' ? 0 : 1));
        for (const i of ordered) {
          const key = (i.code || '') + '|' + i.message;
          if (seenIssues.has(key)) continue;
          seenIssues.add(key);
          unique.push(i.message + (i.hint ? ' → ' + i.hint : ''));
        }
        // Multi-page scans produce findings on several pages: group the repair
        // ask by file so the model reads one page's work at a time. A single
        // page (or unprefixed runtime errors) keeps the flat list.
        let fixLines = [];
        const fileOf = (line) => (/^([\w./-]+\.html?): /.exec(line) || [])[1] || '';
        const distinctFiles = new Set(unique.map(fileOf).filter(Boolean));
        if (distinctFiles.size > 1) {
          unique.sort((x, y) => fileOf(x).localeCompare(fileOf(y)));
          let currentFile = '';
          for (const line of unique) {
            const file = fileOf(line);
            if (file && file !== currentFile) {
              fixLines.push('— ' + file);
              currentFile = file;
            }
            fixLines.push('   ' + (file ? line.slice(file.length + 2) : line));
          }
        } else {
          fixLines = unique.slice();
        }
        let droppedIssues = 0;
        if (fixLines.length > 7) { droppedIssues = fixLines.length - 7; fixLines = fixLines.slice(0, 7); }
        if (droppedIssues) fixLines.push('…and ' + droppedIssues + ' more finding line(s) — fix these, then Dexerion re-checks the site.');
        showIssue(first.level === 'error' ? 'error' : 'warn', first.message + more, fixLines);
      }).catch(() => {});
    }
    return wrap;
  }

  function kindLabel(kind) {
    return LABELS[kind] || 'Artifact';
  }

  // The artifact body on its own (no card header/actions), for the report
  // view which draws its own chrome around it.
  function renderBody(container, raw, opts) {
    const options = opts || {};
    const doc = options.document || (container && container.ownerDocument) || (GLOBAL && GLOBAL.document);
    if (!doc || !container) return null;
    const artifact = sanitize(raw);
    if (!artifact) return null;
    let body;
    if (artifact.kind === 'report') body = renderReport(doc, artifact, options);
    else if (artifact.kind === 'site') body = renderSite(doc, artifact, options);
    else if (artifact.kind === 'quiz') body = renderQuiz(doc, artifact, options);
    else if (artifact.kind === 'deck') body = renderDeck(doc, artifact, options);
    else if (artifact.kind === 'chart') body = renderChart(doc, artifact.chart);
    else body = renderTimeline(doc, artifact, options);
    container.appendChild(body);
    return body;
  }

  function render(container, raw, opts) {
    const options = opts || {};
    const doc = options.document || (container && container.ownerDocument) || (GLOBAL && GLOBAL.document);
    if (!doc || !container) return null;
    // `let`: an in-place save in the Code panel replaces the artifact this card
    // acts on, so Download / Project / Restart / Regenerate must not keep using
    // the version that was on screen when the card was built.
    let artifact = sanitize(raw);
    if (!artifact) return null;
    const card = node(doc, 'div', 'dxa-card');
    card.dataset.kind = artifact.kind;
    // Issue strips are chat content, not preview chrome. renderSite() fills
    // this host; the standalone viewer omits it and never sees an overlay.
    const issueHost = node(doc, 'div', 'dxa-preview-issues');
    issueHost.hidden = true;
    const head = node(doc, 'div', 'dxa-head');
    const ident = node(doc, 'div', 'dxa-ident');
    ident.appendChild(node(doc, 'span', 'dxa-kind', kindLabel(artifact.kind)));
    ident.appendChild(node(doc, 'h3', 'dxa-title', artifact.title));
    head.appendChild(ident);
    const actions = node(doc, 'div', 'dxa-actions');
    // Two levels, so the row always fits: Open + Download HTML stay visible,
    // everything else lives behind ⋯ More. Seven flat buttons used to push
    // "Download HTML" off the edge of the panel.
    const menu = node(doc, 'div', 'dxa-menu');
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    const menuItem = (label, title, run) => {
      const b = node(doc, 'button', 'dxa-menu-item', label);
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      if (title) b.title = title;
      b.onclick = () => { closeMenu(); run(); };
      menu.appendChild(b);
      return b;
    };

    // Direct report editing state (V14): edit mode lives on the card, blocks
    // carry their own hooks, and every save goes through the main process —
    // the response artifact is authoritative. `syncReportEditChrome` is
    // assigned once the body exists.
    const reportEdit = { on: false, busy: false };
    let syncReportEditChrome = () => {};

    // Open, for every kind. A report keeps its in-panel overlay as the primary
    // action (design controls, versions, revision box); everything else opens
    // straight into its own tab.
    const opensBesideChat = artifact.kind === 'report' && typeof options.onOpen === 'function';
    if (opensBesideChat) {
      const open = node(doc, 'button', 'dxa-btn dxa-btn-primary', 'Open');
      open.type = 'button';
      open.onclick = () => options.onOpen(artifact);
      actions.appendChild(open);
    } else if (artifact.kind === 'site' && typeof options.onFocusOverlay === 'function') {
      // The dedicated preview is the primary act for a site: Focus beside the
      // chat, with the chat still visible. A full tab stays one menu item away.
      const focus = node(doc, 'button', 'dxa-btn dxa-btn-primary', 'Preview');
      focus.type = 'button';
      focus.title = 'Open this website in the Focus preview beside the chat';
      focus.onclick = () => options.onFocusOverlay();
      actions.appendChild(focus);
    } else if (typeof options.onOpenTab === 'function') {
      const open = node(doc, 'button', 'dxa-btn dxa-btn-primary', 'Open');
      open.type = 'button';
      open.onclick = () => options.onOpenTab(artifact);
      actions.appendChild(open);
    }
    const save = node(doc, 'button', 'dxa-btn dxa-btn-quiet', 'Download HTML');
    save.type = 'button';
    save.title = 'One self-contained file that opens offline';
    save.onclick = () => {
      // A served site exports the page on screen; the site body knows which
      // one that is (the head is built before the body, so look it up now).
      const siteEl = card.querySelector ? card.querySelector('.dxa-site') : null;
      const page = siteEl && typeof siteEl.__dxaPage === 'function' ? siteEl.__dxaPage() : '';
      downloadArtifact(doc, artifact, Object.assign({}, options, { page: () => page }));
    };
    actions.appendChild(save);
    // Direct report editing: an explicit mode, because blocks only become
    // editable while it is on (the card is a document, not a form). It needs
    // a chat location so the save can reach the stored message; without one
    // the button is not built at all, so the primary row never grows for a
    // card that cannot use it.
    const canEditReport = artifact.kind === 'report' && Boolean(options.chatId) && Number.isInteger(options.index);
    let editBtn = null;
    if (canEditReport) {
      editBtn = node(doc, 'button', 'dxa-btn dxa-btn-quiet dxa-edit-btn dxa-report-edit-btn', 'Edit');
      editBtn.type = 'button';
      editBtn.title = 'Edit the report text: click a heading or paragraph, Enter saves, Escape cancels';
      editBtn.setAttribute('aria-label', 'Edit report text directly');
      editBtn.setAttribute('aria-pressed', 'false');
      editBtn.onclick = () => toggleReportEdit();
      actions.appendChild(editBtn);
    }

    // Secondary actions, in the menu.
    if (typeof options.onOpenTab === 'function') {
      menuItem('Open in a tab', 'Open this artifact as a full page', () => options.onOpenTab(artifact));
    }
    if (artifact.kind === 'report' && typeof options.onDesign === 'function') {
      menuItem('Design', 'Look controls, versions and revisions', () => options.onDesign(artifact));
    }
    if (typeof options.onRegenerate === 'function') {
      menuItem('Regenerate', 'Ask for another version of this deliverable', () => options.onRegenerate(artifact));
    }
    menuItem('Copy', 'Copy as Markdown', () => copyArtifact(artifact, options));
    const sourcesBtn = node(doc, 'button', 'dxa-btn dxa-btn-quiet', 'Code');
    sourcesBtn.type = 'button';
    sourcesBtn.setAttribute('aria-expanded', 'false');
    sourcesBtn.onclick = () => {
      const open = card.querySelector('.dxa-code');
      if (open) {
        open.remove();
        sourcesBtn.setAttribute('aria-expanded', 'false');
        return;
      }
      sourcesBtn.setAttribute('aria-expanded', 'true');
      const panel = renderSources(doc, artifact, {
        document: doc,
        chatId: options.chatId,
        index: options.index,
        onSaved: (next) => {
          // The card follows its own edits: exports and the preview restart read
          // this binding, and the host hears about it too.
          if (next) artifact = next;
          if (typeof options.onArtifactSaved === 'function') options.onArtifactSaved(next);
        },
        // `toast()` reads onToast, not `toast`: with the wrong key every message
        // from the Code panel (saved / failed / reverted) went nowhere.
        onToast: options.onToast,
        onClose: () => {
          const current = card.querySelector('.dxa-code');
          if (current) current.remove();
          sourcesBtn.setAttribute('aria-expanded', 'false');
        },
      });
      card.appendChild(panel);
    };
    // Code stays a real button (it is the editing affordance people reach for),
    // but it sits in the menu row so the primary pair never moves.
    menuItem('Code', 'See and edit the source behind this card', () => sourcesBtn.click());
    // Undo for direct edits: restore the newest snapshot. It appears only when
    // a snapshot exists — a fresh report has nothing to undo.
    let undoEditBtn = null;
    if (canEditReport) {
      undoEditBtn = menuItem('Undo edit', 'Restore the report text from before the last edit', () => undoLastEdit());
      undoEditBtn.hidden = true;
    }
    // A multi-file site also exports its real project, not just the preview.
    if (artifact.kind === 'site' && arr(artifact.files).length) {
      menuItem('Project .zip', 'Download the source files as a zip', () => downloadProject(artifact, options));
    }
    // And a PDF of the page on screen, through the real print pipeline.
    if (artifact.kind === 'site') {
      menuItem('Download PDF', 'Save the page on screen as a PDF', () => {
        const siteEl = card.querySelector ? card.querySelector('.dxa-site') : null;
        const page = siteEl && typeof siteEl.__dxaPage === 'function' ? siteEl.__dxaPage() : '';
        const bridge = GLOBAL && GLOBAL.dexerion;
        if (!bridge || typeof bridge.invoke !== 'function') return;
        bridge.invoke('dex:ai-site-pdf', { artifact, page })
          .then((res) => {
            if (res && res.ok) toast(options, 'PDF saved.');
            else if (!(res && res.canceled)) toast(options, (res && res.error) || 'Could not save the PDF.');
          })
          .catch(() => toast(options, 'Could not save the PDF.'));
      });
    }

    const moreBtn = node(doc, 'button', 'dxa-btn dxa-btn-quiet dxa-more-btn', '⋯');
    moreBtn.type = 'button';
    // The design system's icon set is lucide. Build the SVG directly from the
    // vendored bundle's registry: `createIcons()` scans the *document* for
    // `[data-lucide]`, and this card is still detached when it renders, so the
    // element was never converted (the button came out blank). The ⋯ glyph is
    // the fallback for pages that do not load the bundle.
    (function putMoreIcon() {
      const lucide = GLOBAL && GLOBAL.lucide;
      if (!lucide || typeof lucide.createElement !== 'function') return;
      const glyph = (lucide.icons && (lucide.icons.Ellipsis || lucide.icons.MoreHorizontal)) || null;
      if (!glyph) return;
      try {
        const svg = lucide.createElement(glyph);
        svg.setAttribute('aria-hidden', 'true');
        moreBtn.textContent = '';
        moreBtn.appendChild(svg);
      } catch { /* keep the glyph */ }
    })();
    moreBtn.title = 'More actions';
    moreBtn.setAttribute('aria-haspopup', 'menu');
    moreBtn.setAttribute('aria-expanded', 'false');
    moreBtn.setAttribute('aria-label', 'More actions');
    const more = node(doc, 'div', 'dxa-more');
    // The menu is position:fixed, so a real scroll of the thread would leave it
    // attached to nothing — close on scroll, but ignore the sub-pixel reflow
    // that happens when the menu itself changes the layout (that closed the menu
    // before a click could land).
    let openedAtScrollTop = null;
    function onThreadScroll() {
      const thread = doc.getElementById ? doc.getElementById('ai-messages') : null;
      if (!thread) { closeMenu(); return; }
      if (openedAtScrollTop !== null && Math.abs(thread.scrollTop - openedAtScrollTop) < 4) return;
      closeMenu();
    }
    function closeMenu() {
      menu.hidden = true;
      moreBtn.setAttribute('aria-expanded', 'false');
      openedAtScrollTop = null;
      if (HOST && typeof HOST.removeEventListener === 'function') HOST.removeEventListener('click', onDocClick, true);
      if (doc.removeEventListener) doc.removeEventListener('keydown', onKey, true);
      const thread = doc.getElementById ? doc.getElementById('ai-messages') : null;
      if (thread && thread.removeEventListener) thread.removeEventListener('scroll', onThreadScroll);
    }
    function onDocClick(ev) {
      const t = ev.target;
      if (t && typeof t.closest === 'function' && t.closest('.dxa-more')) return;
      closeMenu();
    }
    function onKey(ev) {
      if (!ev) return;
      if (ev.key === 'Escape') {
        closeMenu();
        try { moreBtn.focus(); } catch { /* focus is best effort */ }
        return;
      }
      // Tabbing out closes the menu instead of walking focus behind it.
      if (ev.key === 'Tab') { closeMenu(); return; }
      // Arrow keys walk the menu, and the ends wrap, so the whole action set is
      // reachable without a mouse.
      if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
      const items = Array.from(menu.children).filter((el) => el && el.tagName === 'BUTTON');
      if (!items.length || menu.hidden) return;
      ev.preventDefault();
      const current = items.indexOf(doc.activeElement);
      const step = ev.key === 'ArrowDown' ? 1 : -1;
      const next = current < 0 ? (step > 0 ? 0 : items.length - 1) : (current + step + items.length) % items.length;
      try { items[next].focus({ preventScroll: true }); } catch { /* focus is best effort */ }
    }
    // The menu is position:fixed, so its place is computed from the button when
    // it opens (and kept in view on a narrow panel).
    function placeMenu() {
      try {
        const rect = moreBtn.getBoundingClientRect();
        const width = menu.offsetWidth || 172;
        const left = Math.max(8, Math.min(rect.right - width, (HOST && HOST.innerWidth ? HOST.innerWidth : rect.right) - width - 8));
        const below = rect.bottom + 4;
        const height = menu.offsetHeight || 0;
        const viewport = (HOST && HOST.innerHeight) || below + height;
        const top = (height && below + height > viewport - 8) ? Math.max(8, rect.top - height - 4) : below;
        menu.style.left = Math.round(left) + 'px';
        menu.style.top = Math.round(top) + 'px';
      } catch { /* fall back to the CSS defaults */ }
    }
    moreBtn.onclick = () => {
      const next = menu.hidden;
      closeMenu();
      if (!next) return;
      menu.hidden = false;
      moreBtn.setAttribute('aria-expanded', 'true');
      placeMenu();
      // Click-away and Escape close it; capture phase so a card click cannot
      // open the report behind the menu.
      if (HOST && typeof HOST.addEventListener === 'function') HOST.addEventListener('click', onDocClick, true);
      if (doc.addEventListener) doc.addEventListener('keydown', onKey, true);
      const thread = doc.getElementById ? doc.getElementById('ai-messages') : null;
      openedAtScrollTop = thread ? thread.scrollTop : null;
      if (thread && thread.addEventListener) thread.addEventListener('scroll', onThreadScroll);
      // Keep keyboard focus on the first action, but do not let focus
      // scroll the thread: that would dismiss this fixed menu immediately.
      const first = Array.from(menu.children).find((el) => el && el.tagName === 'BUTTON');
      if (first) { try { first.focus({ preventScroll: true }); } catch { /* focus is best effort */ } }
    };
    more.append(moreBtn, menu);
    actions.appendChild(more);
    // A site says how many files it was built from — the files were inlined for
    // this preview and are what the download contains. Shown for one file too
    // (it used to disappear at exactly one), worded for one file correctly.
    if (artifact.kind === 'site' && arr(artifact.files).length) {
      const chip = node(doc, 'span', 'dxa-files', fileCountLabel(arr(artifact.files).length));
      chip.title = arr(artifact.files).map((f) => f.path).join('\n');
      ident.appendChild(chip);
    }
    // Reading notes are part of the document: the card says how many there
    // are and opens the viewer's notes panel in one click (V18).
    if (artifact.kind === 'report' && arr(artifact.annotations).length && typeof options.onOpen === 'function') {
      const notes = arr(artifact.annotations).length;
      const chip = node(doc, 'button', 'dxa-notes-chip', notes + ' note' + (notes === 1 ? '' : 's'));
      chip.type = 'button';
      chip.title = 'Open the reading notes';
      chip.onclick = () => {
        if (typeof options.onOpenNotes === 'function') options.onOpenNotes();
        else options.onOpen(artifact);
      };
      ident.appendChild(chip);
    }
    head.appendChild(actions);
    card.appendChild(head);

    // The body builder is a function: a saved edit rebuilds the body from the
    // artifact the store returned — the DOM is a projection, never the source
    // of truth.
    const buildBody = (art) => {
      if (art.kind === 'report') return renderReport(doc, art, options);
      // The getter (and setter), not the object: `artifact` is reassigned when
      // the Code panel — or a preview text edit — saves, and the preview must
      // follow it (Restart, reload checks, diagnostics, later downloads).
      if (art.kind === 'site') return renderSite(doc, art, {
        ...options,
        issueHost,
        getArtifact: () => artifact,
        setArtifact: (next) => { if (next) artifact = next; },
      });
      if (art.kind === 'quiz') return renderQuiz(doc, art, options);
      if (art.kind === 'deck') return renderDeck(doc, art, options);
      if (art.kind === 'chart') return renderChart(doc, art.chart);
      return renderTimeline(doc, art, options);
    };
    let body = buildBody(artifact);
    card.appendChild(body);
    card.appendChild(issueHost);

    // Chat previews cap the report body (see ai-artifacts.css): when the
    // document overflows the cap, fade the cut. The check waits one frame so
    // the message is attached and laid out; outside a message nothing changes.
    function noteCap(el) {
      if (artifact.kind !== 'report') return;
      const raf = (GLOBAL && typeof GLOBAL.requestAnimationFrame === 'function')
        ? GLOBAL.requestAnimationFrame.bind(GLOBAL) : (fn) => {};
      raf(() => {
        try {
          if (!el.closest || !el.closest('.ai-message')) return;
          if (el.scrollHeight > el.clientHeight + 4) el.classList.add('dxa-capped');
        } catch { /* preview stays uncapped */ }
      });
    }

    // A report edit's response artifact is authoritative: the body is replaced
    // wholesale (patching the DOM would drift from the stored JSON), the host
    // hears about it, and edit mode re-arms if it is on.
    function replaceCardArtifact(next) {
      if (!next) return;
      artifact = next;
      if (typeof options.onArtifactSaved === 'function') options.onArtifactSaved(next);
      // Old diagnostics describe the old site; clear them before the fresh
      // render attaches its own issue strip to the same chat-level host.
      issueHost.hidden = true;
      issueHost.replaceChildren();
      const fresh = buildBody(next);
      if (body && body.parentNode === card) card.replaceChild(fresh, body);
      else card.appendChild(fresh);
      body = fresh;
      noteCap(body);
      syncReportEditChrome();
    }

    // ---- direct report editing (V14) ----
    // Editable blocks are the ones whose DOM text mirrors one JSON field
    // (heading/paragraph/callout/quote `text`). A block whose render consumed
    // markdown formatting is refused at commit time — flattening it would
    // silently destroy the formatting, so the Code panel stays the honest path.
    const normText = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    function bindReportBlock(el) {
      if (!el || el.__dxaEditBound) return;
      el.__dxaEditBound = true;
      el.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && !ev.shiftKey) {
          ev.preventDefault();
          commitReportBlock(el);
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          el.textContent = el.__dxaShown || '';
          el.__dxaPending = false;
          try { el.blur(); } catch { /* focus is best effort */ }
        }
      });
      // Blur cancels: an abandoned edit is never left half-applied.
      el.addEventListener('blur', () => {
        if (el.__dxaPending) {
          el.textContent = el.__dxaShown || '';
          el.__dxaPending = false;
        }
      });
      el.addEventListener('input', () => { el.__dxaPending = true; });
    }
    function commitReportBlock(el) {
      if (reportEdit.busy) { toast(options, 'Saving the previous edit — one moment.'); return; }
      const index = Number(el.dataset.blockIndex);
      const field = String(el.dataset.dxaField || 'text');
      const block = arr(artifact.blocks)[index];
      const nextText = normText(el.textContent);
      const revert = () => { el.textContent = el.__dxaShown || ''; el.__dxaPending = false; };
      if (!block) { revert(); return; }
      if (el.__dxaRich) {
        revert();
        toast(options, 'That block has formatting — edit it from Code instead.');
        return;
      }
      if (!nextText || nextText === normText(block[field])) { revert(); return; }
      const bridge = GLOBAL && GLOBAL.dexerion;
      if (!bridge || typeof bridge.invoke !== 'function') { revert(); toast(options, 'Editing needs the app.'); return; }
      reportEdit.busy = true;
      el.__dxaPending = false;
      Promise.resolve(bridge.invoke('dex:ai-report-edit', {
        chatId: options.chatId, index: options.index, blockIndex: index, field, value: nextText,
      })).then((res) => {
        reportEdit.busy = false;
        if (res && res.ok && res.artifact) {
          replaceCardArtifact(res.artifact);
          toast(options, 'Saved v' + (res.version || ''));
        } else {
          revert();
          toast(options, (res && res.error) || 'Could not save the edit.');
        }
      }, () => {
        reportEdit.busy = false;
        revert();
        toast(options, 'Could not save the edit.');
      });
    }
    function toggleReportEdit(on) {
      reportEdit.on = typeof on === 'boolean' ? on : !reportEdit.on;
      syncReportEditChrome();
    }
    function undoLastEdit() {
      const bridge = GLOBAL && GLOBAL.dexerion;
      if (!bridge || typeof bridge.invoke !== 'function') { toast(options, 'Undo needs the app.'); return; }
      Promise.resolve(bridge.invoke('dex:ai-artifact-restore', {
        chatId: options.chatId, index: options.index,
      })).then((res) => {
        if (!res || !res.ok) { toast(options, (res && res.error) || 'Undo failed.'); return; }
        replaceCardArtifact(res.artifact);
        toast(options, 'Edit undone.');
      }, () => toast(options, 'Undo failed.'));
    }
    syncReportEditChrome = function () {
      if (!canEditReport || !editBtn) return;
      const inEdit = reportEdit.on;
      editBtn.classList.toggle('on', inEdit);
      editBtn.setAttribute('aria-pressed', inEdit ? 'true' : 'false');
      editBtn.textContent = inEdit ? 'Done' : 'Edit';
      // The visible text flips, so the accessible name must flip with it —
      // a button showing "Done" cannot keep announcing "Edit report text".
      editBtn.setAttribute('aria-label', inEdit ? 'Finish editing the report' : 'Edit report text directly');
      card.classList.toggle('dxa-report-editing', inEdit);
      // Only the 1:1 text projections are editable; every block has an index
      // now (annotation anchors), so the field marker is the selector.
      for (const el of Array.from(body.querySelectorAll('[data-dxa-field]'))) {
        if (inEdit) {
          const field = String(el.dataset.dxaField || 'text');
          const block = arr(artifact.blocks)[Number(el.dataset.blockIndex)];
          el.__dxaShown = String(el.textContent || '');
          el.__dxaRich = normText(el.__dxaShown) !== normText(block && block[field]);
          el.setAttribute('contenteditable', 'plaintext-only');
          el.setAttribute('spellcheck', 'false');
          el.title = 'Edit this text — Enter saves, Escape cancels';
          bindReportBlock(el);
        } else {
          el.removeAttribute('contenteditable');
          el.removeAttribute('spellcheck');
          el.removeAttribute('title');
          el.__dxaPending = false;
        }
      }
      if (undoEditBtn) undoEditBtn.hidden = !(arr(artifact.history).length);
    };
    container.appendChild(card);
    // The whole card is the affordance (Dia/Claude-style): clicking anywhere
    // on it opens the report viewer. Controls inside and text selections keep
    // their own behaviour.
    if (typeof options.onOpen === 'function') {
      card.dataset.openable = 'true';
      card.addEventListener('click', (ev) => {
        // While edit mode is on, clicks belong to the text (placing the caret
        // in an editable block must not open the viewer over it).
        if (reportEdit.on) return;
        const t = ev.target;
        if (t && typeof t.closest === 'function' &&
          t.closest('button, a, input, select, textarea, label, summary, details, iframe, [role="button"]')) return;
        const sel = GLOBAL && GLOBAL.getSelection ? String(GLOBAL.getSelection() || '') : '';
        if (sel.trim()) return;
        options.onOpen(artifact);
      });
    }
    noteCap(body);
    return card;
  }

  // Text the user should see while the reply is still streaming.
  const OPEN = /```[ \t]*(?:dex-artifact|dex_artifact|artifact)[ \t]*\r?\n/i;
  function visibleText(value) {
    const source = String(value == null ? '' : value);
    const open = OPEN.exec(source);
    if (open) return source.slice(0, open.index).trimEnd();
    const last = source.lastIndexOf('```');
    if (last >= 0) {
      const tail = source.slice(last + 3).trimStart();
      const word = tail.split(/\s/)[0] || '';
      const lower = word.toLowerCase();
      if (lower && ('dex-artifact'.startsWith(lower) || 'artifact'.startsWith(lower) || 'dex_artifact'.startsWith(lower))) {
        return source.slice(0, last).trimEnd();
      }
    }
    return source;
  }

  return {
    KINDS,
    kindLabel,
    render,
    renderBody,
    sanitize,
    safeSiteHtml,
    SITE_VIEWPORT_CSS,
    shimNamespace,
    visibleText,
    toMarkdown,
    linkifyCitations,
    anchorFromRange,
    resolveAnchor,
    tocActiveIndex,
    artifactUrl,
    sources,
    progress,
    REPORT_THEMES,
    REPORT_PAPERS,
    REPORT_PATTERNS,
    REPORT_FONTS,
  };
});
