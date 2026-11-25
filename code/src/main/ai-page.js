// Dexerion page reader — exact port of the scAI extension's read process.
//
// scAI reads pages by injecting content/extract.js on demand (never a
// persistent content script) and returning a compact, readable snapshot.
// Dexerion has no chrome.scripting, but every tab is a Dexerion-owned
// WebContentsView, so the same function runs via
// webContents.executeJavaScript('(' + extractPageSnapshot.toString() + ')()')
// in src/main/browser.js (dex:ai-read-page). The extraction logic below is
// deliberately verbatim: same STRIP set, same pickRoot() heuristic, same
// whitespace normalisation, same {ok,url,title,description,outline,
// selection,text,fullText} shape.
//
// extractPageSnapshot must stay self-contained (no requires, no closure
// state): it is stringified into the page. Everything else in this module
// is pure and headless-testable (see scripts/smoke.js).
'use strict';

const fs = require('fs');
const path = require('path');
const prompts = require('./ai-prompts');

// @mozilla/readability, vendored by `npm run vendor:ai`. Loaded once so the
// injected read script can include it; a dev tree without the vendored file
// simply falls back to the built-in extractor.
let READABILITY_SOURCE = '';
try {
  READABILITY_SOURCE = fs.readFileSync(path.join(__dirname, '../../assets/vendor/readability.js'), 'utf8');
} catch { READABILITY_SOURCE = ''; }

// The new tab is a Dexerion-owned page, not hostile web content: the agent is
// allowed to read and act on it (search box, starred tiles, tasks) because it
// is the person's own start page. Every other internal page stays off limits.
// Keep this exact: dexerion://newtab, /newtab.html, optional query/fragment.
const NEW_TAB_URL_RE = /^dexerion:\/\/newtab(?:\/(?:newtab\.html)?)?(?:\?[^#]*)?(?:#.*)?$/i;
function isAgentNewTab(url) {
  return NEW_TAB_URL_RE.test(String(url || '').trim());
}

function isUnreadable(url) {
  if (!url) return true;
  if (isAgentNewTab(url)) return false;
  if (/^(about:|chrome:|chrome-extension:|moz-extension:|edge:|devtools:|chrome-search:|chrome-untrusted:|resource:|view-source:|dexerion:|file:|data:|blob:)/i.test(url)) {
    return true;
  }
  return /^https?:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i.test(url);
}

// Runs IN THE PAGE. Verbatim scAI content/extract.js, re-expressed as a
// named function so the main process can stringify it. Returns a plain,
// structured-cloneable object.
function extractPageSnapshot() {
  var STRIP = [
    'script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe',
    'nav', 'footer', 'aside', 'form', 'button', 'select',
    '[aria-hidden="true"]', '[hidden]', '[role="navigation"]',
    '[role="banner"]', '[role="complementary"]', '[role="search"]'
  ].join(',');

  function pickRoot() {
    var candidates = [
      document.querySelector('article'),
      document.querySelector('main'),
      document.querySelector('[role="main"]'),
      document.querySelector('#content, .content, #main, .main, .post, .article-body')
    ].filter(Boolean);

    var best = null, bestLen = 0;
    for (var i = 0; i < candidates.length; i++) {
      var len = ((candidates[i].innerText) || '').trim().length;
      if (len > bestLen) { best = candidates[i]; bestLen = len; }
    }
    var bodyLen = ((document.body && document.body.innerText) || '').trim().length;
    // Only trust a container if it holds a meaningful share of the page.
    return (best && bestLen > 400 && bestLen > bodyLen * 0.25) ? best : document.body;
  }

  function readable(root) {
    if (!root) return '';
    var clone;
    try {
      clone = root.cloneNode(true);
    } catch (e) {
      return (root.innerText || '').trim();
    }
    clone.querySelectorAll(STRIP).forEach(function (n) { n.remove(); });
    // innerText on a detached node loses layout-based line breaks, so
    // re-introduce them around block elements before reading textContent.
    clone.querySelectorAll('p,div,section,li,tr,h1,h2,h3,h4,h5,h6,br,pre,blockquote')
      .forEach(function (n) { n.appendChild(document.createTextNode('\n')); });
    return (clone.textContent || '')
      .replace(/[ \t ]+/g, ' ')
      .replace(/ ?\n ?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function meta(name) {
    var el = document.querySelector(
      'meta[name="' + name + '"], meta[property="og:' + name + '"], meta[property="' + name + '"]'
    );
    return el ? (el.getAttribute('content') || '').trim() : '';
  }

  function headings() {
    return Array.from(document.querySelectorAll('h1,h2,h3'))
      .slice(0, 25)
      .map(function (h) { return '  '.repeat(Math.max(0, parseInt(h.tagName[1], 10) - 1)) + (h.innerText || '').trim(); })
      .filter(function (t) { return t.trim(); })
      .join('\n');
  }

  var selection = '';
  try {
    var sel = window.getSelection();
    selection = sel ? String(sel).replace(/\s+\n/g, '\n').trim() : '';
  } catch (e) { selection = ''; }

  function everything() {
    // The raw, unfiltered text of the whole document — nav, footers and all.
    // innerText keeps CSS visibility rules in play, which is what a reader sees.
    var root = document.body || document.documentElement;
    if (!root) return '';
    return ((root.innerText || root.textContent || '') + '')
      .replace(/[ \t ]+/g, ' ')
      .replace(/ ?\n ?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // Readability (when the vendored source is embedded above) gives the model
  // the article proper; the heuristic stays as the fallback for pages it
  // cannot parse. Both are read-only and operate on a clone.
  var articleText = '';
  try {
    if (typeof Readability === 'function') {
      var article = new Readability(document.cloneNode(true)).parse();
      if (article && article.textContent) {
        articleText = String(article.textContent)
          .replace(/[ \t ]+/g, ' ')
          .replace(/ ?\n ?/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
      }
    }
  } catch (e) { articleText = ''; }
  var bodyText = readable(pickRoot());

  return {
    ok: true,
    url: location.href,
    title: document.title || '',
    description: meta('description'),
    outline: headings(),
    selection: selection,
    text: (articleText.length > 400 && articleText.length > bodyText.length * 0.75) ? articleText : bodyText,
    fullText: everything()
  };
}

// The full injected script for one read: the vendored Readability source and
// the extractor in the same function scope, so the extractor can use it
// without a bundler.
function snapshotScript() {
  return '(function(){'
    + (READABILITY_SOURCE ? READABILITY_SOURCE + '\n' : '')
    + extractPageSnapshot.toString()
    + '\nreturn extractPageSnapshot();})()';
}

const YOUTUBE_HOSTS = ['www.youtube.com', 'm.youtube.com', 'youtube.com'];
function isYouTubeWatch(url) {
  try {
    const u = new URL(String(url || ''));
    if (!YOUTUBE_HOSTS.includes(u.hostname.toLowerCase())) return false;
    const p = u.pathname;
    return p === '/watch' || p.indexOf('/shorts/') === 0 || p.indexOf('/live/') === 0;
  } catch { return false; }
}

// Presses "Show transcript" the way a person would, then reads the segments.
// Self-contained (stringified into the page); resolves { ok, title, segments }.
function youtubeTranscriptScript() {
  return `(async () => {
  const SEGMENTS = 'ytd-transcript-segment-renderer, transcript-segment-view-model';
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const read = () => Array.from(document.querySelectorAll(SEGMENTS))
    .map((segment) => (segment.innerText || '').replace(/\\s+/g, ' ').trim())
    .filter(Boolean);
  let title = '';
  try {
    const heading = document.querySelector('ytd-watch-metadata h1') || document.querySelector('h1.ytd-watch-metadata');
    title = (heading && heading.innerText) || document.title || '';
  } catch (e) { title = document.title || ''; }
  let segments = read();
  if (!segments.length) {
    try {
      const expand = document.querySelector('#description-inline-expander #expand');
      if (expand) { expand.click(); await sleep(300); }
    } catch (e) {}
    const button = document.querySelector('ytd-video-description-transcript-section-renderer button');
    if (!button) return { ok: false, reason: 'no-transcript' };
    try { button.click(); } catch (e) { return { ok: false, reason: 'no-transcript' }; }
    for (let waited = 0; waited < 8000 && !segments.length; waited += 200) {
      await sleep(200);
      segments = read();
    }
  }
  if (!segments.length) return { ok: false, reason: 'no-transcript' };
  return { ok: true, title: String(title).trim(), segments };
})()`;
}

// Reads a PDF opened in the current tab. Injects PDF.js (vendored) and
// extracts text page by page. Self-contained (stringified into the page);
// resolves { ok, text }.
function pdfExtractScript(pagesParam) {
  return `(async () => {
  const pagesParam = ${JSON.stringify(pagesParam)};
  const want = pagesParam ? new Set(String(pagesParam).split(/[,\\s]+/).map(String).filter(Boolean)) : null;
  const results = [];
  let loaded = false;
  try {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'dexerion://assets/pdf/pdf.min.mjs';
      s.type = 'module';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
    loaded = true;
  } catch (e) { return { ok: false, reason: 'pdfjs-load-failed' }; }
  if (!loaded || typeof pdfjsLib === 'undefined') return { ok: false, reason: 'pdfjs-not-available' };
  const url = window.location.href;
  const task = await pdfjsLib.getDocument({ url }).promise;
  const numPages = task.numPages;
  const start = 1, end = Math.min(numPages, 20);
  for (let p = start; p <= end; p++) {
    if (want && !want.has(String(p))) continue;
    try {
      const page = await task.getPage(p);
      const content = await page.getTextContent();
      const items = content.items || [];
      const str = items.map((i) => i.str || '').join(' ');
      if (str.trim()) results.push('--- Page ' + p + ' ---\\n' + str);
    } catch (e) { /* skip a page that will not extract */ }
  }
  if (!results.length) return { ok: false, reason: 'no-text' };
  return { ok: true, text: results.join('\\n\\n') };
})()`;
}

// Runs IN THE PAGE before extraction. Wakes lazy/below-fold content by
// sweeping the viewport top-to-bottom, then restores the user's exact scroll
// position. Read-only: no clicks, no input, bounded (~20 steps × 120ms).
// Self-contained like extractPageSnapshot (stringified into the page).
// Resolves true when a sweep ran, false when the page already fits on screen.
function pageSweep() {
  return (async function () {
    try {
      var sx = window.scrollX || 0, sy = window.scrollY || 0;
      var doc = document.documentElement;
      var h = Math.max(
        (document.body && document.body.scrollHeight) || 0,
        (doc && doc.scrollHeight) || 0
      );
      var vh = window.innerHeight || 800;
      if (!h || h <= vh * 1.2) return false;
      var steps = Math.min(20, Math.max(2, Math.ceil(h / vh)));
      try {
        for (var i = 1; i <= steps; i++) {
          window.scrollTo(0, Math.round((h * i) / steps));
          await new Promise(function (r) { setTimeout(r, 120); });
        }
      } finally {
        window.scrollTo(sx, sy);
      }
      return true;
    } catch (e) { return false; }
  })();
}
// Runs IN THE PAGE. Port of the scAI content/act.js branches Dexerion's
// agent needs. Injected on demand like extractPageSnapshot, with the job set
// first: window.__dexJob = { action, args, refs, runId }. Returns a plain,
// structured-cloneable object (or a Promise of one for wait_for).
// Self-contained: stringified into the page, no closure state.
function actPage() {
  var job = (window.__dexJob && typeof window.__dexJob === 'object')
    ? window.__dexJob
    : { action: 'snapshot', args: {}, refs: null };
  var action = job.action || 'snapshot';
  var args = job.args || {};

  var STRIP = [
    'script', 'style', 'noscript', 'template', 'svg', 'canvas',
    '[aria-hidden="true"]', '[hidden]'
  ].join(',');

  function visible(node) {
    if (!node || node.nodeType !== 1) return false;
    var style = getComputedStyle(node);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    if (parseFloat(style.opacity || '1') < 0.05) return false;
    var r = node.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (r.bottom < -2000 || r.top > (window.innerHeight || 0) + 8000) return false;
    return true;
  }

  function label(node) {
    if (!node) return '';
    var bits = [
      node.getAttribute && node.getAttribute('aria-label'),
      node.getAttribute && node.getAttribute('title'),
      node.tagName === 'INPUT' && node.getAttribute('placeholder'),
      node.tagName === 'IMG' && node.getAttribute('alt'),
      (node.innerText || node.textContent || '')
    ];
    for (var i = 0; i < bits.length; i++) {
      var t = String(bits[i] || '').replace(/\s+/g, ' ').trim();
      if (t) return t.length > 140 ? t.slice(0, 140) + '…' : t;
    }
    if (node.value) return String(node.value).slice(0, 80);
    return '';
  }

  function pathOf(node) {
    var parts = [];
    var n = node;
    while (n && n !== document.documentElement) {
      var parent = n.parentNode;
      if (!parent) break;
      parts.unshift(Array.prototype.indexOf.call(parent.children, n));
      n = parent;
    }
    return parts.join('.');
  }

  function nodeAt(path) {
    if (path === '' || path == null) return document.documentElement;
    var n = document.documentElement;
    var segs = String(path).split('.');
    for (var i = 0; i < segs.length; i++) {
      var idx = parseInt(segs[i], 10);
      if (!n || !n.children || !n.children[idx]) return null;
      n = n.children[idx];
    }
    return n;
  }

  var INTERACTIVE = [
    'a[href]', 'button', 'input', 'select', 'textarea', 'summary',
    '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
    '[role="tab"]', '[role="menuitem"]', '[role="combobox"]', '[role="switch"]',
    '[role="option"]', '[contenteditable="true"]', '[onclick]', '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  var SECRET_RE = /pass|passwd|password|cvv|cvc|card|credit|ssn|secret|otp|pin\b|security.?code/i;

  function kindOf(node) {
    var tag = node.tagName.toLowerCase();
    if (tag === 'input') {
      var t = (node.getAttribute('type') || 'text').toLowerCase();
      return t === 'submit' || t === 'button' ? 'button' : ('input:' + t);
    }
    if (tag === 'a') return 'link';
    if (tag === 'textarea') return 'input:textarea';
    if (node.isContentEditable) return 'input:rich';
    if (tag === 'button' || tag === 'summary') return 'button';
    var role = (node.getAttribute('role') || '').toLowerCase();
    return role || tag;
  }

  function dangerOf(node, kind) {
    var name = (node.getAttribute && (node.getAttribute('name') || node.getAttribute('id') ||
      node.getAttribute('autocomplete') || '')) || '';
    if (kind === 'input:password') return 'a password field';
    if (SECRET_RE.test(name) || SECRET_RE.test(label(node))) return 'a sensitive field';
    if (kind === 'input:file') return 'a file upload';
    if (node.tagName === 'BUTTON' && (node.getAttribute('type') || 'submit') === 'submit' &&
        node.form) {
      return 'submits a form';
    }
    if (kind === 'button' && node.tagName === 'INPUT') return 'submits a form';
    if (node.tagName === 'A' && node.href) {
      try {
        var u = new URL(node.href, location.href);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'opens ' + u.protocol;
      } catch (e) { /* unparseable href */ }
    }
    return '';
  }

  function readableText(limit) {
    var root = document.body;
    if (!root) return '';
    var clone;
    try { clone = root.cloneNode(true); } catch (e) { return (root.innerText || '').trim(); }
    clone.querySelectorAll(STRIP).forEach(function (n) { n.remove(); });
    var BLOCK = /^(P|DIV|SECTION|ARTICLE|HEADER|FOOTER|LI|TR|H1|H2|H3|H4|H5|H6|BR|PRE|BLOCKQUOTE)$/;
    clone.querySelectorAll('*').forEach(function (n) {
      if (BLOCK.test(n.tagName)) n.insertAdjacentText('beforebegin', '\n');
    });
    var text = (clone.textContent || '').replace(/[ \t ]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n').trim();
    if (limit && text.length > limit) {
      var head = Math.floor(limit * 0.6);
      text = text.slice(0, head).trimEnd() +
        '\n\n…[' + (text.length - limit) + ' characters trimmed]…\n\n' +
        text.slice(text.length - (limit - head)).trimStart();
    }
    return text;
  }

  function snapshot() {
    var nodes = [];
    var refs = {};
    var ref = 1;
    var seen = new Set();
    var all = document.querySelectorAll(INTERACTIVE);
    for (var i = 0; i < all.length; i++) {
      var node = all[i];
      if (nodes.length >= 300) break;
      if (seen.has(node) || !visible(node)) continue;
      if (node.disabled) continue;
      seen.add(node);
      var kind = kindOf(node);
      var entry = { ref: ref, kind: kind, text: label(node), danger: dangerOf(node, kind) };
      if (node.tagName === 'A' && node.href) {
        try { entry.href = new URL(node.href, location.href).href.slice(0, 300); }
        catch (e) { /* skip */ }
      }
      if (kind.indexOf('input') === 0 && node.value) entry.value = String(node.value).slice(0, 120);
      if (node.tagName === 'SELECT') {
        entry.options = Array.prototype.slice.call(node.options, 0, 40)
          .map(function (o) { return o.label || o.value; });
      }
      if (kind.indexOf('input') === 0 || node.tagName === 'BUTTON') entry.inForm = !!node.form;
      if (kind === 'input:password' || SECRET_RE.test(
        (node.getAttribute('name') || '') + ' ' + (node.getAttribute('id') || '')
      )) entry.secret = true;
      var r = node.getBoundingClientRect();
      entry.offscreen = r.bottom < 0 || r.top > (window.innerHeight || 0);
      nodes.push(entry);
      refs[ref] = pathOf(node);
      ref++;
    }
    var doc = document.documentElement || {};
    var selText = '';
    try { selText = String((window.getSelection && window.getSelection().toString()) || ''); } catch (e) {}
    return {
      ok: true,
      action: 'snapshot',
      url: location.href,
      title: document.title || '',
      text: readableText(args.limit || 8000),
      nodes: nodes,
      refs: refs,
      scroll: {
        y: Math.round(window.scrollY || 0),
        height: Math.round(doc.scrollHeight || 0),
        viewport: Math.round(window.innerHeight || 0),
        atBottom: (window.scrollY || 0) + (window.innerHeight || 0) >= (doc.scrollHeight || 0) - 4
      },
      selection: selText.replace(/\s+/g, ' ').trim().slice(0, 2000)
    };
  }

  function resolve(ref) {
    var map = job.refs || {};
    var path = map[ref] !== undefined ? map[ref] : map[String(ref)];
    if (path === undefined) {
      return { error: 'No element #' + ref + ' in the last snapshot. Take a new snapshot.' };
    }
    var node = nodeAt(path);
    if (!node || !node.isConnected) {
      return { error: 'Element #' + ref + ' is no longer on the page. Take a new snapshot.' };
    }
    return { node: node };
  }

  function nodeSummary(node) {
    var kind = kindOf(node);
    return { kind: kind, text: label(node), danger: dangerOf(node, kind) };
  }

  function nativeSet(node, value) {
    var proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : node instanceof HTMLInputElement ? HTMLInputElement.prototype
      : null;
    var desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(node, value);
    else node.value = value;
  }

  function fire(node, type, init) {
    var Ctor = type.indexOf('key') === 0 ? KeyboardEvent
      : (type.indexOf('mouse') === 0 || type === 'click') ? MouseEvent : Event;
    node.dispatchEvent(new Ctor(type, Object.assign({ bubbles: true, cancelable: true }, init || {})));
  }

  function setValue(node, text, append) {
    if (node.isContentEditable) {
      if (!append) node.textContent = '';
      node.focus();
      node.textContent = (append ? node.textContent : '') + text;
      fire(node, 'input');
      return;
    }
    node.focus();
    var next = append ? String(node.value || '') + text : text;
    nativeSet(node, next);
    fire(node, 'input');
    fire(node, 'change');
  }

  function chooseOption(node, value) {
    var want = String(value).toLowerCase();
    var opts = Array.prototype.slice.call(node.options);
    var hit = null;
    for (var i = 0; i < opts.length && !hit; i++) {
      if (String(opts[i].value).toLowerCase() === want) hit = opts[i];
    }
    for (i = 0; i < opts.length && !hit; i++) {
      if (String(opts[i].label || opts[i].text).toLowerCase() === want) hit = opts[i];
    }
    for (i = 0; i < opts.length && !hit; i++) {
      if (String(opts[i].label || opts[i].text).toLowerCase().indexOf(want) >= 0) hit = opts[i];
    }
    if (!hit) {
      return {
        error: 'No option matching "' + value + '".',
        options: opts.slice(0, 40).map(function (o) { return o.label || o.text; })
      };
    }
    node.focus();
    node.value = hit.value;
    fire(node, 'input');
    fire(node, 'change');
    return { chose: hit.label || hit.text };
  }

  function doClick(node) {
    node.scrollIntoView({ block: 'center', inline: 'nearest' });
    var r = node.getBoundingClientRect();
    var at = {
      clientX: Math.round(r.left + r.width / 2),
      clientY: Math.round(r.top + r.height / 2),
      view: window
    };
    fire(node, 'pointerdown', at);
    fire(node, 'mousedown', at);
    fire(node, 'mouseup', at);
    if (typeof node.click === 'function') node.click();
    else fire(node, 'click', at);
  }

  function keyInit(key) {
    var named = {
      Enter: 13, Escape: 27, Tab: 9, Backspace: 8, Delete: 46,
      ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
      PageUp: 33, PageDown: 34, Home: 36, End: 35, ' ': 32
    };
    var code = named[key] !== undefined ? named[key] : (key.length === 1 ? key.charCodeAt(0) : 0);
    return { key: key, code: key.length === 1 ? 'Key' + key.toUpperCase() : key, keyCode: code, which: code };
  }

  function pressKey(node, key) {
    var target = node || document.activeElement || document.body;
    if (target.focus) target.focus();
    fire(target, 'keydown', keyInit(key));
    fire(target, 'keypress', keyInit(key));
    fire(target, 'keyup', keyInit(key));
    if (key === 'Enter' && target.form && typeof target.form.requestSubmit === 'function') {
      try { target.form.requestSubmit(); } catch (e) { try { target.form.submit(); } catch (e2) {} }
    }
  }

  function waitFor(text, ms) {
    var ceiling = Math.min(10000, Math.max(200, parseInt(ms, 10) || 4000));
    var started = Date.now();
    return new Promise(function (resolve) {
      var quiet = null;
      var obs = new MutationObserver(function () {
        if (quiet) clearTimeout(quiet);
        quiet = setTimeout(settle, 350);
      });
      function found() {
        if (!text) return false;
        var hay = (document.body && document.body.innerText) || '';
        return hay.toLowerCase().indexOf(String(text).toLowerCase()) >= 0;
      }
      function finish(why) {
        obs.disconnect();
        if (quiet) clearTimeout(quiet);
        clearInterval(poll);
        resolve({
          ok: why !== 'halted',
          action: 'wait_for',
          waited: Date.now() - started,
          settled: why === 'quiet' || why === 'found',
          found: why === 'found',
          halted: why === 'halted',
          note: why === 'timeout'
            ? (text ? 'Gave up after ' + ceiling + 'ms; "' + text + '" never appeared.'
                    : 'Page was still changing after ' + ceiling + 'ms.')
            : why === 'halted' ? 'Stopped by the user.' : ''
        });
      }
      function settle() { finish(found() ? 'found' : 'quiet'); }
      var poll = setInterval(function () {
        if (window.__dexHalt) return finish('halted');
        if (found()) return finish('found');
        if (Date.now() - started >= ceiling) return finish('timeout');
      }, 120);
      if (found()) return finish('found');
      obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      quiet = setTimeout(settle, 350);
    });
  }

  function findText(query) {
    var q = String(query || '').toLowerCase();
    if (!q) return { ok: false, error: 'find_text needs a query.' };
    var hits = [];
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue || n.nodeValue.toLowerCase().indexOf(q) < 0) return NodeFilter.FILTER_REJECT;
        var p = n.parentElement;
        if (!p || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(p.tagName)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while ((n = walker.nextNode()) && hits.length < 20) {
      var around = String(n.nodeValue).replace(/\s+/g, ' ').trim();
      var el = n.parentElement;
      var clickable = el && el.closest(INTERACTIVE);
      hits.push({
        text: around.length > 220 ? around.slice(0, 220) + '…' : around,
        inClickable: clickable ? label(clickable).slice(0, 80) : '',
        onScreen: el ? visible(el) : false
      });
    }
    return { ok: true, action: 'find_text', query: query, matches: hits.length, hits: hits };
  }

  function run() {
    if (window.__dexHalt) {
      return { ok: false, halted: true, error: 'Stopped by the user before this action ran.' };
    }
    switch (action) {
      case 'snapshot':
        return snapshot();
      case 'find_text':
        return findText(args.query);
      case 'wait_for':
        return waitFor(args.text, args.ms);
      case 'scroll': {
        if (args.ref != null) {
          var sr = resolve(args.ref);
          if (sr.error) return { ok: false, error: sr.error };
          sr.node.scrollIntoView({ block: 'center' });
          return { ok: true, action: 'scroll', to: 'element', node: nodeSummary(sr.node) };
        }
        var vh = window.innerHeight || 600;
        var to = args.to || 'down';
        if (to === 'top') window.scrollTo(0, 0);
        else if (to === 'bottom') window.scrollTo(0, document.documentElement.scrollHeight);
        else window.scrollBy(0, to === 'up' ? -Math.round(vh * 0.9) : Math.round(vh * 0.9));
        return {
          ok: true, action: 'scroll', to: to,
          y: Math.round(window.scrollY || 0),
          atBottom: (window.scrollY || 0) + vh >= (document.documentElement.scrollHeight || 0) - 4
        };
      }
      case 'click': {
        var cr = resolve(args.ref);
        if (cr.error) return { ok: false, error: cr.error };
        var before = location.href;
        var summary = nodeSummary(cr.node);
        doClick(cr.node);
        return {
          ok: true, action: 'click', node: summary,
          navigated: location.href !== before,
          url: location.href,
          note: 'Take a snapshot to see what changed.'
        };
      }
      case 'type': {
        var tr = resolve(args.ref);
        if (tr.error) return { ok: false, error: tr.error };
        var tsummary = nodeSummary(tr.node);
        setValue(tr.node, String(args.text == null ? '' : args.text), !!args.append);
        if (args.submit) pressKey(tr.node, 'Enter');
        return {
          ok: true, action: 'type', node: tsummary,
          submitted: !!args.submit,
          typed: String(args.text || '').length + ' characters',
          note: 'Take a snapshot to see what changed.'
        };
      }
      case 'fill_form': {
        var fields = Array.isArray(args.fields) ? args.fields : [];
        var results = [];
        for (var i = 0; i < fields.length; i++) {
          var f = fields[i];
          var fr = resolve(f && f.ref);
          if (fr.error) { results.push({ ref: f && f.ref, ok: false, error: fr.error }); continue; }
          var value = String(f.value == null ? '' : f.value);
          if (fr.node.tagName === 'SELECT') {
            var chosen = chooseOption(fr.node, value);
            if (chosen.error) results.push({ ref: f.ref, ok: false, error: chosen.error, options: chosen.options });
            else results.push({ ref: f.ref, ok: true, field: label(fr.node).slice(0, 60), chose: chosen.chose });
            continue;
          }
          setValue(fr.node, value, false);
          results.push({ ref: f.ref, ok: true, field: label(fr.node).slice(0, 60) });
        }
        var anyOk = false;
        for (var k = 0; k < results.length; k++) if (results[k].ok) anyOk = true;
        return {
          ok: anyOk, action: 'fill_form', fields: results,
          note: 'Nothing was submitted. Take a snapshot to check the values landed.'
        };
      }
      case 'select': {
        var lr = resolve(args.ref);
        if (lr.error) return { ok: false, error: lr.error };
        if (lr.node.tagName !== 'SELECT') return { ok: false, error: 'Element #' + args.ref + ' is not a dropdown.' };
        var picked = chooseOption(lr.node, String(args.value == null ? '' : args.value));
        if (picked.error) return { ok: false, error: picked.error, options: picked.options };
        return { ok: true, action: 'select', chose: picked.chose };
      }
      case 'hover': {
        var hr = resolve(args.ref);
        if (hr.error) return { ok: false, error: hr.error };
        hr.node.scrollIntoView({ block: 'center' });
        var rect = hr.node.getBoundingClientRect();
        var at = {
          clientX: Math.round(rect.left + rect.width / 2),
          clientY: Math.round(rect.top + rect.height / 2),
          view: window
        };
        fire(hr.node, 'pointerover', at);
        fire(hr.node, 'mouseover', at);
        fire(hr.node, 'mousemove', at);
        return { ok: true, action: 'hover', node: nodeSummary(hr.node) };
      }
      case 'press_key': {
        var pkNode = null;
        if (args.ref != null) {
          var pr = resolve(args.ref);
          if (pr.error) return { ok: false, error: pr.error };
          pkNode = pr.node;
        }
        pressKey(pkNode, String(args.key || 'Enter'));
        return { ok: true, action: 'press_key', key: args.key, note: 'Take a snapshot to see what changed.' };
      }
      case 'halt':
        window.__dexHalt = true;
        return { ok: true, action: 'halt' };
      case 'get_page_data': {
        var kind = String(args.kind || 'all').toLowerCase();
        var out = { ok: true, action: 'get_page_data', kind: kind, url: location.href, title: document.title };
        var data = {};
        if (kind === 'tables' || kind === 'all') {
          var tables = [];
          var tableEls = document.querySelectorAll('table');
          for (var ti = 0; ti < Math.min(tableEls.length, 8); ti++) {
            var t = tableEls[ti];
            var rows = [];
            var trs = t.querySelectorAll('tr');
            for (var ri = 0; ri < Math.min(trs.length, 30); ri++) {
              var cells = [];
              var tds = trs[ri].querySelectorAll('th,td');
              for (var ci = 0; ci < tds.length; ci++) cells.push(String(tds[ci].innerText || tds[ci].textContent || '').trim());
              if (cells.length) rows.push(cells);
            }
            if (rows.length) tables.push({ caption: (t.caption && t.caption.textContent) || '', rows: rows });
          }
          data.tables = tables;
        }
        if (kind === 'links' || kind === 'all') {
          var links = [];
          var las = document.querySelectorAll('a[href]');
          for (var li = 0; li < Math.min(las.length, 40); li++) {
            var a = las[li];
            var txt = String(a.innerText || a.textContent || '').replace(/\s+/g, ' ').trim();
            var href = a.getAttribute('href') || '';
            try { href = new URL(href, location.href).href; } catch {}
            if (txt || href) links.push({ text: txt.slice(0, 120), url: href });
          }
          data.links = links;
        }
        if (kind === 'forms' || kind === 'all') {
          var forms = [];
          var fs = document.querySelectorAll('form');
          for (var fi = 0; fi < Math.min(fs.length, 6); fi++) {
            var f = fs[fi];
            var fields = [];
            var inputs = f.querySelectorAll('input,select,textarea');
            for (var ii = 0; ii < inputs.length; ii++) {
              var inp = inputs[ii];
              fields.push({ kind: kindOf(inp), label: label(inp).slice(0, 80), name: inp.getAttribute('name') || '', type: inp.getAttribute('type') || inp.tagName.toLowerCase() });
            }
            forms.push({ action: f.getAttribute('action') || '', method: f.getAttribute('method') || 'get', fields: fields });
          }
          data.forms = forms;
        }
        if (kind === 'headings' || kind === 'all') {
          var heads = [];
          var hs = document.querySelectorAll('h1,h2,h3,h4,h5,h6');
          for (var hi = 0; hi < Math.min(hs.length, 30); hi++) {
            heads.push({ level: hs[hi].tagName.charAt(1), text: String(hs[hi].innerText || hs[hi].textContent || '').trim() });
          }
          data.headings = heads;
        }
        out.data = data;
        return out;
      }
      default:
        return { ok: false, error: 'Unknown action: ' + action };
    }
  }

  try {
    return run();
  } catch (err) {
    return { ok: false, error: (err && err.message) ? err.message : String(err) };
  }
}

// Trim from the middle so both the top and the tail of a long page survive —
// headers and conclusions are usually where the answer lives. (scAI sidebar.)
function clampMiddle(text, limit) {
  var s = String(text || '');
  var n = Math.max(1000, Math.min(60000, parseInt(limit, 10) || 12000));
  if (s.length <= n) return s;
  var head = Math.floor(n * 0.6);
  var tail = n - head;
  return s.slice(0, head).trimEnd() +
    '\n\n…[' + (s.length - n) + ' characters trimmed]…\n\n' +
    s.slice(s.length - tail).trimStart();
}

// Shape one message's page context, exactly as scAI's capturePageContext
// does. Default is the readable article text (nav/footers stripped); opt in
// to fullPage for the whole document including navigation and footers.
// Selection wins when the user highlighted a real passage and selection
// reading is on.
// Returns { kind, label, text } — text is the <page_context> block for the
// model, label feeds the "Reading: …" chip.
function buildPageContext(snap, opts) {
  var o = opts || {};
  var limit = Math.max(1000, Math.min(60000, parseInt(o.contextChars, 10) || 12000));
  var sel = String((snap && snap.selection) || '').trim();
  var useSel = o.useSelection !== false && sel.length > 40;
  var full = o.fullPage === true;

  var head = [
    '<page_context>',
    'The user is looking at this page. Ground your answer in it.',
    'Title: ' + prompts.neutralise((snap && snap.title) || '(untitled)'),
    'URL: ' + ((snap && snap.url) || '')
  ];
  if (snap && snap.description) head.push('Description: ' + prompts.neutralise(snap.description));

  var text, kind, label;
  if (useSel) {
    kind = 'selection';
    label = 'Selected text · ' + ((snap && snap.title) || 'page');
    head.push('', 'The user has highlighted this passage:', '<selection>',
      clampMiddle(prompts.neutralise(sel), limit), '</selection>');
  } else {
    kind = 'page';
    label = (full ? 'Full page · ' : 'Page · ') + ((snap && snap.title) || (snap && snap.url) || 'this page');
    if (snap && snap.outline) head.push('', 'Outline:', snap.outline);
    var bodyText = full ? ((snap && snap.fullText) || (snap && snap.text) || '') : ((snap && snap.text) || '');
    head.push('');
    if (full) head.push('Full page text, including navigation and footers:');
    head.push('<page_text>', clampMiddle(prompts.neutralise(bodyText), limit), '</page_text>');
  }
  head.push('</page_context>');
  text = head.join('\n');

  return { kind: kind, label: label, text: text };
}

module.exports = {
  isUnreadable,
  isAgentNewTab,
  extractPageSnapshot,
  snapshotScript,
  isYouTubeWatch,
  youtubeTranscriptScript,
  pdfExtractScript,
  pageSweep,
  actPage,
  clampMiddle,
  buildPageContext,
};
