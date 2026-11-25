// Dexerion site quality checks — the zero-dependency validator behind the
// preview's health strip and the revision prompts.
//
// String-level by design: every check states what it can and cannot see, and
// anything that needs computed layout (colour contrast, touch-target size,
// focus order, keyboard traps) is deliberately absent rather than guessed.
// The rule set comes from the "Generated Site Spec v1" research pass over the
// W3C WAI tutorials, the WAI-ARIA APG, MDN, web.dev and the design-system-
// for-AI literature (sources recorded in Website_Report_X_Line.md).
'use strict';

const MAX_ISSUES = 24;
const MAX_FILES = 24;

function issue(level, code, file, message, hint) {
  const out = { level, code, file, message };
  if (hint) out.hint = hint;   // the concrete repair, shown by Fix with AI
  return out;
}

// Code-fence and template content must not trip structural checks.
function structuralSource(html) {
  return String(html || '')
    .replace(/<template\b[\s\S]*?<\/template>/gi, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

function styleSources(pathStr, content) {
  // Everything that can carry CSS: the file itself when it is a stylesheet,
  // plus inline <style> blocks when it is an HTML document.
  const out = [];
  if (/\.css$/i.test(String(pathStr || ''))) out.push(String(content));
  for (const m of String(content || '').matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) out.push(m[1]);
  return out;
}

function checkHead(html, file) {
  const issues = [];
  // The head checks read the <head> slice when one exists: an inline SVG
  // <title> in the body (or a <title> inside a script string) must not mask
  // a missing page title, and vice versa.
  const headMatch = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html);
  const head = headMatch ? headMatch[1] : html;
  if (!/<meta\s+charset/i.test(head)) issues.push(issue('warn', 'head-charset', file, 'no <meta charset="utf-8"> — add it first in <head>.', 'Add <meta charset="utf-8"> as the first element inside <head>.'));
  const viewport = /<meta[^>]+name\s*=\s*["']viewport["'][^>]*>/i.exec(head);
  if (!viewport) issues.push(issue('warn', 'head-viewport', file, 'no viewport meta — add <meta name="viewport" content="width=device-width, initial-scale=1">.', 'Add the standard responsive viewport meta.'));
  else if (/user-scalable\s*=\s*["']?no|maximum-scale\s*=\s*["']?1(\.0)?["'\s>]/i.test(viewport[0])) {
    issues.push(issue('warn', 'head-zoom', file, 'the viewport meta blocks zoom (user-scalable/maximum-scale) — remove it.', 'Keep only width=device-width, initial-scale=1; never forbid zoom.'));
  }
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  if (!title || !title[1].trim()) issues.push(issue('warn', 'head-title', file, 'no non-empty <title> — every page needs a unique, descriptive one.', 'Add <title>Page — Site</title>, unique per page.'));
  // The practical meta minimum: a one-sentence description per page (search
  // results and link previews read it; the generation prompt requires it).
  const descTag = /<meta[^>]+name\s*=\s*["']description["'][^>]*>/i.exec(head);
  const descContent = descTag ? ((/content\s*=\s*["']([^"']*)["']/i.exec(descTag[0]) || [])[1] || '') : '';
  if (!descContent.trim()) {
    issues.push(issue('warn', 'head-description', file, 'no meta description — search results and link previews read it.', 'Add <meta name="description" content="One sentence about this page">.'));
  }
  if (/<html\b/i.test(html) && !/<html\b[^>]*\blang\s*=/i.test(html)) issues.push(issue('warn', 'head-lang', file, 'no lang attribute on <html>.', 'Start the document with <html lang="en"> (or the site\'s language).'));
  if (/<meta[^>]+http-equiv\s*=\s*["']?refresh/i.test(head)) issues.push(issue('warn', 'head-refresh', file, 'meta refresh is an accessibility anti-pattern — navigate in script instead.', 'Replace it with an explicit link/button or a scripted redirect.'));
  return issues;
}

function checkStructure(html, file) {
  const issues = [];
  const src = structuralSource(html);
  const mains = (src.match(/<main\b/gi) || []).length;
  if (mains === 0) issues.push(issue('warn', 'landmark-main', file, 'no <main> landmark — wrap the page content in one.', 'Wrap the page\'s primary content in a single <main id="main">.'));
  else if (mains > 1) issues.push(issue('warn', 'landmark-main', file, 'more than one <main> — only one per page.', 'Merge the sections into one <main>.'));
  const h1s = (src.match(/<h1\b/gi) || []).length;
  if (h1s === 0) issues.push(issue('warn', 'heading-h1', file, 'no <h1> — every page has exactly one.', 'Add one <h1> that names the page.'));
  else if (h1s > 1) issues.push(issue('warn', 'heading-h1', file, h1s + ' <h1> elements — keep exactly one per page.', 'Demote the extras to <h2> (or style them without heading semantics).'));
  const navs = src.match(/<nav\b[^>]*>/gi) || [];
  if (navs.length > 1 && !navs.some((n) => /aria-label/i.test(n))) {
    issues.push(issue('warn', 'landmark-nav-labels', file, 'several <nav> regions without aria-label — label each one.'));
  }
  if (navs.length && !/class\s*=\s*["'][^"']*skip|>\s*skip\b/i.test(src)) {
    issues.push(issue('warn', 'skip-link', file, 'no skip link found (a first "Skip to content" link) — keyboard users need one on pages with navigation.'));
  }
  return issues;
}

function checkHeadings(html, file) {
  const src = structuralSource(html);
  const levels = [];
  for (const m of src.matchAll(/<h([1-6])\b/gi)) levels.push(Number(m[1]));
  const issues = [];
  for (let i = 1; i < levels.length && issues.length < 3; i++) {
    if (levels[i] - levels[i - 1] > 1) {
      issues.push(issue('warn', 'heading-order', file, 'heading jumps from h' + levels[i - 1] + ' to h' + levels[i] + ' — do not skip levels when going deeper.', 'Use the next level down (h' + (levels[i - 1] + 1) + ') or restructure the section.'));
    }
  }
  return issues;
}

function checkImages(html, file) {
  const src = structuralSource(html);
  const issues = [];
  let missing = 0;
  let vague = 0;
  for (const m of src.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    // An attribute boundary, not \b: `data-alt="…"` is not an alt attribute.
    const alt = /(?<![\w-])alt\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (!alt) missing += 1;
    else if (/^\s*(image|picture|photo)\s+of\b/i.test(alt[1])) vague += 1;
  }
  if (missing) issues.push(issue('warn', 'img-alt', file, missing + ' image(s) without alt — add alt="" for decorative images, a description otherwise.', 'Add alt="…" to every <img>; use alt="" only when the image carries no meaning.'));
  if (vague) issues.push(issue('warn', 'img-alt-vague', file, vague + ' alt text(s) start with "image/picture of" — describe the content, not the medium.', 'Describe what the image shows, e.g. alt="Tide chart for March".'));
  return issues;
}

function checkInteractives(html, file) {
  const issues = [];
  const src = structuralSource(html);
  // Attribute-boundary lookbehind: `data-onclick` is not an event handler.
  const divClicks = [...src.matchAll(/<(?:div|span)\b[^>]*(?<![\w-])on\w+\s*=/gi)];
  if (divClicks.length) issues.push(issue('warn', 'fake-control', file, divClicks.length + ' click handler(s) on <div>/<span> — use <button>/<a> so keyboards and AT work.', 'Swap the element for <button type="button"> and keep the handler on it.'));
  const roleButtons = [...src.matchAll(/<([a-z][\w-]*)\b[^>]*\brole\s*=\s*["']button["'][^>]*>/gi)]
    .filter((m) => m[1].toLowerCase() !== 'button');
  if (roleButtons.length) issues.push(issue('warn', 'role-button', file, 'role="button" on a non-button element — prefer a real <button>; if kept, it must handle Enter/Space and carry tabindex.', 'Use <button>; a styled button is always cheaper than a reimplemented one.'));
  const positiveTab = [...src.matchAll(/tabindex\s*=\s*["']([2-9]|\d{2,})["']/gi)];
  if (positiveTab.length) issues.push(issue('warn', 'tabindex-positive', file, 'positive tabindex reorders the whole page — use DOM order instead.', 'Remove the positive tabindex and place the element in DOM order.'));
  const hashLinks = [...src.matchAll(/<a\b[^>]*href\s*=\s*["']#?["'][^>]*>/gi)];
  if (hashLinks.length) issues.push(issue('warn', 'href-empty', file, hashLinks.length + ' link(s) with an empty href="#" - a link must go somewhere; use a <button> for actions.', 'Point the link at a real target, or make the control a <button>.'));
  // structuralSource() strips scripts, so read the raw document here: a page
  // full of buttons with no event handler is a mockup, not an interactive site.
  const raw = String(html || '');
  const scriptBodies = [...raw.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n');
  const hasControls = /<(?:button|form|input|select|textarea)\b/i.test(raw);
  const wired = /addEventListener\s*\(|\.on(?:click|submit|change|input|keydown|keyup)\s*=/i.test(scriptBodies)
    || /<\w[^>]*\son(?:click|submit|change|input|keydown|keyup)\s*=/i.test(raw);
  if (hasControls && !wired) {
    issues.push(issue('warn', 'no-behavior', file,
      'controls are present but no JavaScript event handler was found - they will look clickable but do nothing.',
      'Wire at least one real behaviour: addEventListener("click", ...) or a form submit handler.'));
  }
  return issues;
}

function checkReferences(files) {
  const issues = [];
  // Per document: duplicate ids, dangling label/aria references.
  for (const file of files.filter((f) => /\.html?$/i.test(f.path))) {
    const src = structuralSource(file.content);
    const ids = [];
    // Attribute boundary, not \b: `data-id="42"` is an entity marker, not an
    // HTML id (and it must not hide a genuinely dangling label reference).
    for (const m of src.matchAll(/(?<![\w-])id\s*=\s*["']([^"']+)["']/gi)) ids.push(m[1]);
    const seen = new Set();
    const dups = new Set();
    for (const id of ids) { if (seen.has(id)) dups.add(id); seen.add(id); }
    if (dups.size) issues.push(issue('warn', 'dup-id', file.path, 'duplicate id(s): ' + [...dups].slice(0, 4).join(', ') + '.', 'Make every id unique — labels and scripts resolve the first match.'));
    const refs = [];
    for (const m of src.matchAll(/(?<![\w-])for\s*=\s*["']([^"']+)["']/gi)) refs.push(m[1]);
    for (const m of src.matchAll(/\baria-(?:labelledby|controls|describedby|owns)\s*=\s*["']([^"']+)["']/gi)) {
      for (const id of m[1].split(/\s+/)) if (id) refs.push(id);
    }
    const dangling = [...new Set(refs.filter((id) => !seen.has(id)))];
    if (dangling.length) issues.push(issue('warn', 'dangling-ref', file.path, 'reference(s) to ids that do not exist on this page: ' + dangling.slice(0, 4).join(', ') + '.', 'Give the target element that id, or point the reference at one that exists.'));
  }
  // Across the file set: custom properties must be declared somewhere. A
  // token can be declared three ways: `--x: …` in CSS, `@property --x`, or
  // `setProperty('--x', …)` in script — all three count, comments do not.
  let declared = '';
  for (const file of files) {
    const content = String(file.content);
    if (/\.css$/i.test(file.path)) declared += '\n' + content;
    for (const m of content.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) declared += '\n' + m[1];
    for (const m of content.matchAll(/@property\s+(--[\w-]+)/g)) declared += '\n' + m[1] + ':0';
    for (const m of content.matchAll(/setProperty\(\s*["'](--[\w-]+)/g)) declared += '\n' + m[1] + ':0';
  }
  declared = declared.replace(/\/\*[\s\S]*?\*\//g, '');
  const declaredNames = new Set([...declared.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const used = new Set([...declared.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]));
  for (const file of files) {
    const body = /\.css$/i.test(file.path) ? String(file.content) : String(file.content);
    if (!/var\(\s*--/.test(body)) continue;
    for (const m of body.matchAll(/var\(\s*(--[\w-]+)/g)) used.add(m[1]);
  }
  const undeclared = [...used].filter((name) => !declaredNames.has(name));
  if (undeclared.length) issues.push(issue('warn', 'css-var-undeclared', '', 'var() used without a declaration: ' + undeclared.slice(0, 5).join(', ') + ' — keep every token in the :root block.', 'Declare the missing token(s) in :root, or use the existing token name.'));
  return issues;
}

function checkFocus(content, pathStr, hasFocusVisible) {
  const issues = [];
  for (const css of styleSources(pathStr, content)) {
    // Block-wise: a rule that replaces the ring (box-shadow/border/background)
    // is a replacement, and the :focus-visible guard counts site-wide (a
    // reset.css + main.css split is a normal shape).
    for (const m of css.matchAll(/(:focus\b(?!-visible)[^{]*)\{([^}]*)\}/gi)) {
      const block = m[2];
      if (!/outline\s*:\s*(?:none|0)\b/i.test(block)) continue;
      if (/box-shadow|border|background|outline\s*:\s*(?!none|0)/i.test(block)) continue;
      if (hasFocusVisible) continue;
      issues.push(issue('warn', 'focus-outline', pathStr, 'outline removed on :focus with no :focus-visible ring anywhere in the site — keyboards lose the focus indicator.', 'Keep the global ring, or add a :focus-visible rule (any stylesheet) with an outline or box-shadow.'));
      return issues;   // one finding per file is enough
    }
  }
  return issues;
}

// Generated-code quality: the spec's banned list, checked at string level.
function checkCssQuality(css, pathStr) {
  const issues = [];
  // Comments are not code.
  const source = String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');
  if (!source.trim()) return issues;
  // 1) Native nesting cannot concatenate class names. `&__title` is invalid
  //    CSS and Chromium drops the whole nested rule — sections silently lose
  //    their styles, which is the worst failure mode to debug.
  const concat = [...source.matchAll(/&(?:\s*)(?:__|--)[\w-]+/g)];
  if (concat.length) {
    issues.push(issue('warn', 'css-nesting-concat', pathStr,
      concat.length + ' nested &__/&-- concatenation(s) — native nesting cannot build class names; the rule is dropped silently.',
      'Write component classes at the top level (.card__title { … }); use & only for pseudo/state/compound (e.g. &:hover).'));
  }
  // 2) !important — the token/method approach should never need it.
  const bangs = [...source.matchAll(/!important\b/g)];
  if (bangs.length) {
    issues.push(issue('warn', 'css-important', pathStr,
      bangs.length + ' !important declaration(s).',
      'Fix the specificity instead — flatter selectors and BEM-lite names.'));
  }
  // 3) Raw colour literals outside the token declarations (var() fallbacks
  //    are a documented pattern and are not counted; url() is not a colour,
  //    even when an SVG fragment id looks like a hex value).
  const withoutTokens = source
    .replace(/--[\w-]+\s*:\s*[^;}]*[;}]/g, ' ')
    .replace(/var\([^)]*\)/g, ' ')
    .replace(/url\([^)]*\)/g, ' ');
  const raw = [...withoutTokens.matchAll(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g)];
  // Value-scoped CSS named colours: a selector like `.green` must not match,
  // and `--danger: red` lives in the token layer (already stripped).
  const named = [...withoutTokens.matchAll(/(?:^|[;{])\s*(?!-)[\w-]+\s*:\s*[^;}]*?(?<![\w-])(?:red|blue|green|black|white|gray|grey|orange|purple|pink|teal|navy|maroon|olive|lime|aqua|fuchsia|silver|yellow)(?![\w-])/gi)];
  const rawCount = raw.length + named.length;
  if (rawCount) {
    issues.push(issue('warn', 'css-raw-color', pathStr,
      rawCount + ' raw colour value(s) outside the custom-property declarations.',
      'Move every literal into the :root token block and reference var(--token) here.'));
  }
  // 3b) Responsive sizing: a literal width of 500px+ breaks small screens,
  //     and 100vw includes the scrollbar (horizontal overflow by design).
  const fixed = [...source.matchAll(/(?:^|[;{])\s*(?:width|min-width)\s*:\s*(?:[5-9]\d{2}|\d{4,})px\b/gi)];
  if (fixed.length) {
    issues.push(issue('warn', 'css-fixed-width', pathStr,
      fixed.length + ' fixed width(s) of 500px or more break small screens.',
      'Use max-width:100%, auto-fit grids and clamp() instead of fixed widths.'));
  }
  if (/\b100vw\b/.test(source)) {
    issues.push(issue('warn', 'css-vw-overflow', pathStr,
      '100vw includes the scrollbar width and causes horizontal overflow.',
      'Use width:100% (or 100dvw deliberately) instead of 100vw.'));
  }
  // 4) Motion that animates everything, or layout itself. A time-only
  //    shorthand (`transition: .3s ease`) means all properties too.
  const allShorthand = /transition\s*:\s*all\b/i.test(source)
    || /\btransition\s*:\s*[\d.]+m?s(?:\s+(?:ease(?:-(?:in|out|in-out))?|linear|cubic-bezier\([^)]*\)))?\s*[;}]/i.test(source);
  if (allShorthand) {
    issues.push(issue('warn', 'css-transition-all', pathStr,
      'this transition has no property list, so it animates every property (including layout).',
      'Name the properties explicitly (transform, opacity, colour).'));
  }
  if (/(?:^|[;{])\s*(?:transition|animation)(?:-property)?\s*:\s*[^;}]*\b(?:width|height|top|left|right|bottom|margin|padding)\b/i.test(source)) {
    issues.push(issue('warn', 'css-layout-animation', pathStr,
      'a transition/animation names a layout property (width/height/offsets/margins).',
      'Animate transform/opacity instead; layout animation reflows every frame.'));
  }
  // 5) Keyboard parity for hover styling: a class that reacts to :hover with
  //    no :focus-visible rule in the same sheet behaves differently under the
  //    keyboard. Deliberately soft — decorative hovers are legitimate.
  const hoverClasses = new Set();
  for (const m of source.matchAll(/\.([\w-]+)\s*:hover\b/g)) hoverClasses.add(m[1]);
  if (hoverClasses.size) {
    const focusClasses = new Set();
    for (const m of source.matchAll(/\.([\w-]+)\s*:focus-visible\b/g)) focusClasses.add(m[1]);
    const missing = [...hoverClasses].filter((c) => !focusClasses.has(c));
    if (missing.length) {
      issues.push(issue('warn', 'hover-no-focus', pathStr,
        missing.length + ' class(es) change on :hover without a matching :focus-visible rule: ' + missing.slice(0, 4).join(', ') + '.',
        'Mirror the hover treatment with :focus-visible (ignore this for purely decorative hovers).'));
    }
  }
  return issues;
}

// Disabled controls need a visible state, or they look clickable but do
// nothing. One finding per site, and only when nothing styles them.
function checkDisabledStates(files) {
  const hasDisabled = files.some((f) => /\.html?$/i.test(f.path)
    && /<(?:button|input|select|textarea|fieldset)\b[^>]*(?<![\w-])disabled\b/i.test(structuralSource(f.content)));
  if (!hasDisabled) return [];
  const styled = files.some((f) => styleSources(f.path, f.content)
    .some((css) => /:disabled|\[disabled\]|\[aria-disabled/i.test(css)));
  if (styled) return [];
  return [issue('warn', 'disabled-no-style', '', 'disabled controls are used but nothing styles :disabled — they will not look inactive.', 'Add a :disabled rule (reduced contrast, cursor:not-allowed, no hover lift) for the affected controls.')];
}

function checkMotion(files) {
  let motionFile = null;
  let guarded = false;
  for (const file of files) {
    for (const css of styleSources(file.path, file.content)) {
      // Comments are not motion, and `animation: none` disables it.
      const code = String(css).replace(/\/\*[\s\S]*?\*\//g, '');
      if (/@keyframes\b|animation\s*:(?!\s*none\b)/i.test(code)) motionFile = motionFile || file.path;
      if (/prefers-reduced-motion/i.test(code)) guarded = true;
    }
  }
  if (motionFile && !guarded) {
    return [issue('warn', 'motion-guard', motionFile, 'animation without a prefers-reduced-motion guard — wrap non-essential motion in @media (prefers-reduced-motion: no-preference).', 'Wrap the animated rules in @media (prefers-reduced-motion: no-preference) { … }.')];
  }
  return [];
}

function checkOfflineAssets(files) {
  const issues = [];
  for (const file of files.filter((f) => !/\.html?$/i.test(f.path))) {
    const body = String(file.content);
    const hits = [...body.matchAll(/(?:url\(\s*|@import\s+(?:url\()?\s*|from\s*|fetch\(\s*)["']?(https?:)?\/\/[^"'\s)]+/gi)]
      .filter((m) => !dataish(m[0]));
    if (hits.length) issues.push(issue('warn', 'offline-asset', file.path, 'external reference(s) in ' + file.path + ' — the preview runs offline; inline or bundle them.', 'Remove the URL or inline the asset; nothing external can load.'));
  }
  return issues;
}

function dataish(s) {
  return /data:|blob:/i.test(String(s));
}

// --- Zero-network-resource hardening -------------------------------------
// The preview runs fully offline. These checks look ONLY at constructs that
// actually load something (tags, CSS url()/@import, scripted network calls),
// never at prose: a visible "Photo by X — https://example.com" attribution is
// plain text and is deliberately not flagged.
//
// Prefix matching is intentional. A data:image/svg+xml URI almost always embeds
// `xmlns="http://www.w3.org/2000/svg"`; searching anywhere in a value would
// report that namespace as a network fetch. Only a value that STARTS with a
// network scheme (http, https, ws, wss, or protocol-relative //) is remote.
// data:, blob:, #, mailto:, tel: and relative/internal paths are all allowed.
function isRemoteResourceUrl(value) {
  return /^\s*(?:(?:https?|wss?):)?\/\//i.test(String(value == null ? '' : value));
}

function htmlAttribute(tag, name) {
  const m = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i')
    .exec(String(tag || ''));
  if (!m) return '';
  return m[1] != null ? m[1] : (m[2] != null ? m[2] : (m[3] || ''));
}

function remoteCssUrls(css) {
  const out = [];
  const code = String(css || '').replace(/\/\*[\s\S]*?\*\//g, ' ');
  // url(http(s)://…), url("//…"), @import url(…), @import "https://…".
  for (const m of code.matchAll(/\burl\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
    const value = (m[1] != null ? m[1] : (m[2] != null ? m[2] : (m[3] || ''))).trim();
    if (isRemoteResourceUrl(value)) out.push(value);
  }
  for (const m of code.matchAll(/@import\s+((?:url\s*\(\s*)?["']?[^\s;"')]+)/gi)) {
    const value = m[1].replace(/^url\s*\(\s*/i, '').replace(/^["']|["']$/g, '').trim();
    if (isRemoteResourceUrl(value)) out.push(value);
  }
  return out;
}

// Scripted network calls we can see without executing the page. "Where
// detectable": string literals only — hosts assembled at runtime are outside
// a string scan. Comments are safe: a bare "// see https://example.com" never
// matches a call pattern here.
function remoteScriptCalls(js) {
  const out = [];
  const patterns = [
    /\b(?:fetch|import|importScripts|sendBeacon|EventSource|WebSocket)\s*\(\s*["'`]((?:https?|wss?):\/\/[^"'`\s]*)["'`]/gi,
    /\b(?:import|export)\s+[^"'`\n;]*?\bfrom\s+["'`]((?:https?|wss?):\/\/[^"'`\s]*)["'`]/gi,
    /\bimport\s+["'`]((?:https?|wss?):\/\/[^"'`\s]*)["'`]/gi,
    /\b(?:open|sendBeacon)\s*\(\s*["'][^"']*["']\s*,\s*["'`]((?:https?|wss?):\/\/[^"'`\s]*)["'`]/gi,
    /\.src\s*=\s*["'`]((?:https?|wss?):\/\/[^"'`\s]*)["'`]/gi,
  ];
  for (const re of patterns) {
    for (const m of String(js || '').matchAll(re)) out.push(m[1]);
  }
  return out;
}

// Stable issue code: external-resource. One finding per file with examples, so
// a CDN-heavy page cannot flood the MAX_ISSUES-truncated report.
function checkExternalResources(files) {
  const issues = [];
  for (const file of (Array.isArray(files) ? files : [])) {
    if (!file || typeof file.content !== 'string') continue;
    const pathStr = String(file.path || '');
    const content = file.content;
    const hits = [];
    const add = (label, value) => hits.push(label + ': ' + String(value).slice(0, 80));

    // a) Tags that load a resource. Anchor/area href is intentionally NOT
    //    scanned: fragments, relative pages, mailto:, tel: and visible
    //    attribution links are legitimate and must keep working.
    const srcAttrs = [
      ['script', ['src']], ['img', ['src', 'srcset']], ['source', ['src', 'srcset']],
      ['video', ['src', 'poster']], ['audio', ['src']], ['iframe', ['src']],
      ['embed', ['src']], ['object', ['src', 'data']], ['track', ['src']],
      ['input', ['src']],
    ];
    for (const [tagName, attrs] of srcAttrs) {
      const tagRe = new RegExp('<' + tagName + '\\b[^>]*>', 'gi');
      for (const m of content.matchAll(tagRe)) {
        for (const name of attrs) {
          const value = htmlAttribute(m[0], name);
          if (!value) continue;
          if (name === 'srcset') {
            for (const candidate of value.split(',')) {
              const url = candidate.trim().split(/\s+/)[0];
              if (isRemoteResourceUrl(url)) { add('<' + tagName + ' ' + name, url); break; }
            }
          } else if (isRemoteResourceUrl(value)) {
            add('<' + tagName + ' ' + name, value);
          }
        }
      }
    }

    // b) <link rel=stylesheet|icon|preload|… href="http(s)://…">. Metadata
    //    rels (canonical, alternate, author) do not load anything.
    for (const m of content.matchAll(/<link\b[^>]*>/gi)) {
      const rel = htmlAttribute(m[0], 'rel');
      if (!/(?:^|[\s-])(?:stylesheet|icon|preload|prefetch|modulepreload|manifest)(?=[\s-]|$)/i.test(rel)) continue;
      const href = htmlAttribute(m[0], 'href');
      if (isRemoteResourceUrl(href)) add('<link rel="' + rel + '" href', href);
    }

    // c) CSS url()/@import: standalone stylesheets, inline <style> blocks and
    //    inline style="" attributes (styleSources covers the first two).
    for (const css of styleSources(pathStr, content)) {
      for (const url of remoteCssUrls(css)) add('CSS url/@import', url);
    }
    for (const m of content.matchAll(/(?<![\w-])style\s*=\s*["']([^"']*)["']/gi)) {
      for (const url of remoteCssUrls(m[1])) add('style= url()', url);
    }

    // d) Scripted network calls in inline scripts and in JS files.
    let js = '';
    if (/\.html?$/i.test(pathStr)) {
      for (const m of content.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) js += '\n' + (m[1] || '');
    } else if (/\.(?:js|mjs|cjs|ts|tsx|jsx)$/i.test(pathStr)) {
      js = content;
    }
    for (const url of remoteScriptCalls(js)) add('script network call', url);

    if (hits.length) {
      const unique = [...new Set(hits)];
      issues.push(issue('warn', 'external-resource', pathStr,
        unique.length + ' remote resource reference(s) in ' + (pathStr || 'this file') + ' — the preview runs fully offline: ' + unique.slice(0, 4).join('; ') + '.',
        'Remove every remote URL. Inline assets as data:/blob: URIs or relative site files; use #, mailto: or tel: for links; keep source credits as visible text; and delete fetch/XHR/WebSocket/import calls to remote hosts.'));
    }
  }
  return issues;
}

// Soft attribution nudge: an inline data:image without a nearby credit. It is
// a warning only — a legitimate decorative image must never fail validation.
function checkDataImageCredits(files) {
  const issues = [];
  const creditTag = /<(figcaption|small)\b[^>]*>[\s\S]*?\S[\s\S]*?<\/\1\s*>/i;
  // The offline-asset contract allows one compact footer credit line to cover
  // the page's sourced artwork, so a document-level visible credit counts too.
  const visibleCredit = (html) => {
    const text = String(html || '')
      .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ')
      .replace(/<[^>]*>/g, ' ');
    return /(?:source|credit|attribution|photo|image|artwork|courtesy|via)\b/i.test(text)
      && /(?:licen[cs]e|CC\s*(?:BY|SA|0)|public domain|MIT|courtesy|by\s+[A-Z])/i.test(text);
  };
  for (const file of (Array.isArray(files) ? files : [])) {
    if (!file || typeof file.content !== 'string' || !/\.html?$/i.test(String(file.path || ''))) continue;
    const src = structuralSource(file.content);
    const figures = [...src.matchAll(/<figure\b[^>]*>[\s\S]*?<\/figure\s*>/gi)];
    const pageCredited = visibleCredit(src);
    let uncredited = 0;
    for (const m of src.matchAll(/<img\b[^>]*>/gi)) {
      const tag = m[0];
      if (!/(?<![\w-])src\s*=\s*["']\s*data:image\//i.test(tag)) continue;
      if (/\bdata-(?:dex-)?credit\b/i.test(tag)) continue;
      if (pageCredited) continue;
      const start = m.index + m[0].length;
      const inCreditedFigure = figures.some((f) => m.index >= f.index
        && m.index < f.index + f[0].length && creditTag.test(f[0]));
      if (inCreditedFigure) continue;
      const after = src.slice(start, start + 400);
      const before = src.slice(Math.max(0, m.index - 400), m.index).trim();
      if (creditTag.test(after) || /<\/(?:figcaption|small)\s*>$/i.test(before)) continue;
      uncredited += 1;
    }
    if (uncredited) issues.push(issue('warn', 'data-image-without-credit', String(file.path || ''),
      uncredited + ' inline data:image(s) have no visible credit — add a source caption or a data-dex-credit attribute.',
      'Add a <figcaption> or <small> credit next to the image (or inside its <figure>), or put data-dex-credit="Source — Creator" on the <img>. This is a soft attribution check, not a failure.'));
  }
  return issues;
}

// What legitimately differs between two pages' shared chrome: the current-page
// marker (any position/attribute shape), an active class token, and comments.
// Component hygiene: a class in the markup must have a rule and vice versa.
// State hooks (is-/has-/js-…), classes the scripts add or remove, and
// media-scoped definitions all count as legitimate, so the checks only fire
// on genuinely orphaned names. Wording stays soft ("appears unused") because
// class names can be composed at runtime in ways a string scan cannot see.
const STATE_CLASS = /^(?:is-|has-|js-)|^(?:no-js|active|open|current|selected|visible|hidden|loading|disabled)$/i;

function checkComponentHygiene(files) {
  const htmlFiles = files.filter((f) => /\.html?$/i.test(f.path));
  if (!htmlFiles.length) return [];
  const jsText = files.filter((f) => /\.(?:js|mjs|json)$/i.test(f.path)).map((f) => String(f.content)).join('\n');
  const defined = new Set();
  for (const file of files) {
    for (const css of styleSources(file.path, file.content)) {
      const code = String(css)
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/url\([^)]*\)/g, ' ')
        .replace(/content\s*:\s*("[^"]*"|'[^']*')/g, 'content:');
      for (const m of code.matchAll(/\.([A-Za-z_][\w-]*)/g)) defined.add(m[1]);
    }
  }
  const used = new Set();
  for (const file of htmlFiles) {
    const src = structuralSource(file.content);
    for (const m of src.matchAll(/\bclass\s*=\s*["']([^"']*)["']/gi)) {
      for (const cls of m[1].split(/\s+/)) if (cls) used.add(cls);
    }
  }
  const issues = [];
  if (defined.size) {
    const unused = [...defined].filter((cls) => !used.has(cls) && !jsText.includes(cls));
    if (unused.length) {
      issues.push(issue('warn', 'css-unused-class', '', unused.length + ' class(es) appear defined in CSS but never used in the markup: ' + unused.slice(0, 5).join(', ') + '.', 'Remove the dead rules, or apply the class in the markup — one of the two is wrong.'));
    }
  }
  if (used.size) {
    const unstyled = [...used].filter((cls) => !defined.has(cls) && !STATE_CLASS.test(cls) && !jsText.includes(cls));
    if (unstyled.length) {
      issues.push(issue('warn', 'html-unstyled-class', '', unstyled.length + ' class(es) are used in the markup with no CSS definition: ' + unstyled.slice(0, 5).join(', ') + '.', 'Define the class in the stylesheet, or drop it from the markup (components need their styles).'));
    }
  }
  return issues;
}

// Dead navigation: a link to a .html file that is not part of the site is a
// page nobody can reach (the preview serves a friendly 404 instead of the
// page, and the nav just looks broken). Anchors, external links and
// directory-style targets are out of scope by design.
function checkBrokenLinks(files) {
  const pages = files.filter((f) => /\.html?$/i.test(f.path));
  if (pages.length < 2) return [];
  const known = new Set(pages.map((f) => f.path.toLowerCase()));
  const issues = [];
  for (const page of pages) {
    const src = structuralSource(page.content);
    const broken = new Set();
    for (const m of src.matchAll(/<a\b[^>]*(?<![\w-])href\s*=\s*["']([^"']+)["']/gi)) {
      const href = m[1].split(/[?#]/)[0].trim();
      if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
      if (!/\.html?$/i.test(href)) continue;
      const clean = href.replace(/^\.\//, '').toLowerCase();
      if (!known.has(clean)) broken.add(href);
    }
    if (broken.size) {
      issues.push(issue('warn', 'broken-link', page.path, 'link(s) to pages that are not part of this website: ' + [...broken].slice(0, 4).join(', ') + '.', 'Create the missing file or point the link at an existing page.'));
    }
  }
  return issues;
}

// Orphaned pages: an HTML page that no other page links to is unreachable
// through navigation — the person can only see it by guessing the URL. The
// entry page (index / first HTML) is exempt: it is reachable by opening the
// site itself. A page linked from JavaScript only is not counted here; a
// string scan cannot see runtime-assembled links, so this stays soft.
function checkOrphanedPages(files) {
  const pages = files.filter((f) => /\.html?$/i.test(f.path));
  if (pages.length < 2) return [];
  // The entry page: index.html / index.htm, else the first HTML file.
  const byLower = new Map(pages.map((f) => [f.path.toLowerCase(), f.path]));
  let entry = '';
  if (byLower.has('index.html')) entry = byLower.get('index.html');
  else if (byLower.has('index.htm')) entry = byLower.get('index.htm');
  else entry = pages[0].path;
  const entryLower = entry.toLowerCase();
  // Every href target that points to another page in the site.
  const linked = new Set();
  for (const page of pages) {
    const src = structuralSource(page.content);
    for (const m of src.matchAll(/<a\b[^>]*(?<![\w-])href\s*=\s*["']([^"']+)["']/gi)) {
      const href = m[1].split(/[?#]/)[0].trim();
      if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
      if (!/\.html?$/i.test(href)) continue;
      const clean = href.replace(/^\.\//, '').toLowerCase();
      if (knownPage(clean, pages)) linked.add(clean);
    }
  }
  const issues = [];
  for (const page of pages) {
    const lower = page.path.toLowerCase();
    if (lower === entryLower) continue;
    if (linked.has(lower)) continue;
    issues.push(issue('warn', 'orphaned-page', page.path, 'no page links to "' + page.path + '" — it is unreachable through navigation.', 'Add a link to it from another page\'s nav, or remove the file if it is not needed.'));
  }
  return issues;
}

function knownPage(clean, pages) {
  for (const f of pages) {
    if (f.path.toLowerCase() === clean) return true;
  }
  return false;
}

// Dead-end pages: a page with no outgoing links to other pages in the site
// traps the person there — the back button is the only way out. Only flagged
// for multi-page sites; a single-page site has nowhere to go by design.
function checkDeadEndPages(files) {
  const pages = files.filter((f) => /\.html?$/i.test(f.path));
  if (pages.length < 2) return [];
  const known = new Set(pages.map((f) => f.path.toLowerCase()));
  const issues = [];
  for (const page of pages) {
    const src = structuralSource(page.content);
    let hasOutgoing = false;
    for (const m of src.matchAll(/<a\b[^>]*(?<![\w-])href\s*=\s*["']([^"']+)["']/gi)) {
      const href = m[1].split(/[?#]/)[0].trim();
      if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
      if (!/\.html?$/i.test(href)) continue;
      const clean = href.replace(/^\.\//, '').toLowerCase();
      if (known.has(clean) && clean !== page.path.toLowerCase()) { hasOutgoing = true; break; }
    }
    if (!hasOutgoing) {
      issues.push(issue('warn', 'dead-end-page', page.path, 'no links lead away from "' + page.path + '" — it is a dead end.', 'Add a nav link or a "Back to ..." link so the person can leave the page.'));
    }
  }
  return issues;
}

// Multi-page navigation: the link for the current page must say so
// (aria-current="page") — USWDS/NN-g both treat it as the marking convention,
// and a nav that never marks the current page is a silent wayfinding loss.
function checkNavCurrent(files) {
  const pages = files.filter((f) => /\.html?$/i.test(f.path));
  if (pages.length < 2) return [];
  const issues = [];
  for (const page of pages) {
    const base = page.path.toLowerCase().split('/').pop();
    const src = structuralSource(page.content);
    let mentionsSelf = false;
    let marked = false;
    for (const nav of src.matchAll(/<nav\b[\s\S]*?<\/nav>/gi)) {
      for (const a of nav[0].matchAll(/<a\b[^>]*>/gi)) {
        const href = /(?<![\w-])href\s*=\s*["']([^"']+)["']/i.exec(a[0]);
        if (!href) continue;
        const target = href[1].split(/[?#]/)[0].toLowerCase();
        if (!target) continue;
        if (target === base || target.endsWith('/' + base)) {
          mentionsSelf = true;
          if (/aria-current\s*=/.test(a[0])) marked = true;
        }
      }
    }
    if (mentionsSelf && !marked) {
      issues.push(issue('warn', 'nav-current', page.path, 'the navigation links to this page but none of its links carries aria-current="page".', 'Add aria-current="page" to the nav link for the current page.'));
    }
  }
  return issues;
}

// WCAG 2.4.2: every page needs its own title — and its own description.
function checkPageTitles(files) {
  const pages = files.filter((f) => /\.html?$/i.test(f.path));
  if (pages.length < 2) return [];
  const byTitle = new Map();
  const byDesc = new Map();
  for (const page of pages) {
    const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(page.content);
    const t = m ? m[1].replace(/\s+/g, ' ').trim() : '';
    if (t) {
      if (!byTitle.has(t)) byTitle.set(t, []);
      byTitle.get(t).push(page.path);
    }
    const dm = /<meta[^>]+name\s*=\s*["']description["'][^>]*>/i.exec(page.content);
    const d = dm ? ((/content\s*=\s*["']([^"']*)["']/i.exec(dm[0]) || [])[1] || '').replace(/\s+/g, ' ').trim() : '';
    if (d) {
      if (!byDesc.has(d)) byDesc.set(d, []);
      byDesc.get(d).push(page.path);
    }
  }
  const issues = [];
  for (const [t, paths] of byTitle) {
    if (paths.length > 1) {
      issues.push(issue('warn', 'title-duplicate', '', 'the same <title> ("' + t.slice(0, 60) + '") is used on ' + paths.join(', ') + ' — every page needs its own.', 'Give each page a unique, descriptive <title>.'));
    }
  }
  for (const [d, paths] of byDesc) {
    if (paths.length > 1) {
      issues.push(issue('warn', 'description-duplicate', '', 'the same meta description is used on ' + paths.join(', ') + ' — describe each page in its own words.', 'Write one sentence per page; copy-pasted descriptions read as spam.'));
    }
  }
  return issues;
}

// Forms: every field needs a real label, by for=, aria-label(ledby), title, or
// being wrapped in <label>. Honeypot shapes (tabindex="-1"/aria-hidden) are
// deliberately exempt.
function checkForms(content, pathStr) {
  const src = structuralSource(content);
  const labelRanges = [];
  for (const m of src.matchAll(/<label\b[\s\S]*?<\/label>/gi)) labelRanges.push([m.index, m.index + m[0].length]);
  const labelledIds = new Set([...src.matchAll(/<label\b[^>]*(?<![\w-])for\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]));
  let unlabeled = 0;
  for (const m of src.matchAll(/<(input|select|textarea)\b[^>]*>/gi)) {
    const tag = m[0];
    const name = m[1].toLowerCase();
    if (name === 'input' && /type\s*=\s*["']?(?:hidden|submit|button|reset|image)\b/i.test(tag)) continue;
    if (/tabindex\s*=\s*["']-1["']|aria-hidden\s*=\s*["']true["']/i.test(tag)) continue;   // honeypots
    if (labelRanges.some(([a, b]) => m.index > a && m.index < b)) continue;   // wrapped in <label>
    const id = /(?<![\w-])id\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (id && labelledIds.has(id[1])) continue;
    if (/(?<![\w-])aria-label\s*=|aria-labelledby\s*=|(?<![\w-])title\s*=/i.test(tag)) continue;
    unlabeled += 1;
  }
  if (unlabeled) {
    return [issue('warn', 'form-label', pathStr, unlabeled + ' form field(s) without a label.', 'Use <label for="id">, aria-label for icon-only controls, or wrap the field in <label>.')];
  }
  return [];
}

function normShared(block) {
  return String(block || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+aria-current\s*=\s*["'][^"']*["']/gi, '')
    .replace(/\bclass\s*=\s*["']([^"']*)["']/gi, (whole, value) => {
      const kept = value.split(/\s+/).filter((t) => t && !/^(?:is-)?(?:active|current|selected)$/i.test(t));
      // A marker-only class must vanish, not become class="" — otherwise the
      // page that marks its current link compares as "different" from the
      // page whose link has no class attribute at all.
      return kept.length ? 'class="' + kept.join(' ') + '"' : '';
    })
    .replace(/<title[\s\S]*?<\/title>/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+>/g, '>')
    .trim();
}

function checkMultiPageDrift(files) {
  const pages = files.filter((f) => /\.html?$/i.test(f.path));
  if (pages.length < 2) return [];
  const issues = [];
  for (const [what, re] of [['header', /<header\b[\s\S]*?<\/header>/i], ['footer', /<footer\b[\s\S]*?<\/footer>/i]]) {
    const groups = new Map();
    const missing = [];
    for (const page of pages) {
      const m = re.exec(page.content);
      if (!m) { missing.push(page.path); continue; }
      const hash = normShared(m[0]);
      if (!groups.has(hash)) groups.set(hash, []);
      groups.get(hash).push(page.path);
    }
    // A page that simply lacks the shared chrome is the same defect wearing a
    // different face: it is navigation dead-ending, not a "difference".
    if (missing.length && groups.size >= 1) {
      issues.push(issue('warn', 'multipage-drift', '', 'the shared ' + what + ' is missing on: ' + missing.slice(0, 4).join(', ') + ' — every page needs it.', 'Copy the exact same ' + what + ' markup into every page.'));
    }
    if (groups.size > 1) {
      const names = [...groups.values()].map((paths) => paths.join(' + ')).join(' | ');
      issues.push(issue('warn', 'multipage-drift', '', 'the shared ' + what + ' markup differs across pages (' + names + ') — keep it byte-identical everywhere (only the current-page marker may change).', 'Copy the exact same ' + what + ' markup into every page; mark the current link with aria-current="page".'));
    }
  }
  return issues;
}

// The public entry point: takes the artifact's file list (already bounded and
// validated by the model layer) and returns at most MAX_ISSUES findings.
function validateSiteQuality(files) {
  const list = (Array.isArray(files) ? files : []).slice(0, MAX_FILES)
    .filter((f) => f && typeof f.path === 'string' && typeof f.content === 'string');
  if (!list.length) return { ok: true, issues: [] };
  const issues = [];
  const htmlFiles = list.filter((f) => /\.html?$/i.test(f.path));
  const cssFiles = list.filter((f) => /\.css$/i.test(f.path));
  // The focus-ring guard is site-wide: a reset.css that strips the ring and a
  // main.css that restores one is the normal shape, not a defect.
  const hasFocusVisible = list.some((f) => styleSources(f.path, f.content).some((css) => /:focus-visible/.test(css)));
  for (const file of htmlFiles) {
    issues.push(...checkHead(file.content, file.path));
    issues.push(...checkStructure(file.content, file.path));
    issues.push(...checkHeadings(file.content, file.path));
    issues.push(...checkImages(file.content, file.path));
    issues.push(...checkInteractives(file.content, file.path));
    issues.push(...checkForms(file.content, file.path));
    issues.push(...checkFocus(file.content, file.path, hasFocusVisible));   // inline <style> blocks
    for (const css of styleSources(file.path, file.content)) issues.push(...checkCssQuality(css, file.path));
    // Inline style attributes are code too: a raw colour there is a raw colour.
    for (const m of structuralSource(file.content).matchAll(/style\s*=\s*["']([^"']+)["']/gi)) {
      const value = m[1].replace(/var\([^)]*\)/g, ' ').replace(/url\([^)]*\)/g, ' ');
      if (/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(value)) {
        issues.push(issue('warn', 'css-raw-color', file.path, 'inline style with a raw colour literal.', 'Move the colour into the :root token layer or a class.'));
        break;
      }
    }
  }
  // Stylesheet files carry their own checks (focus, motion, tokens, method).
  for (const file of cssFiles) {
    issues.push(...checkFocus(file.content, file.path, hasFocusVisible));
    for (const css of styleSources(file.path, file.content)) issues.push(...checkCssQuality(css, file.path));
  }
  issues.push(...checkReferences(list));
  issues.push(...checkMotion(list));
  issues.push(...checkOfflineAssets(list));
  issues.push(...checkComponentHygiene(list));
  issues.push(...checkDisabledStates(list));
  issues.push(...checkBrokenLinks(list));
  issues.push(...checkNavCurrent(list));
  issues.push(...checkPageTitles(list));
  issues.push(...checkMultiPageDrift(list));
  issues.push(...checkOrphanedPages(list));
  issues.push(...checkDeadEndPages(list));
  // Appended hardening rules: earlier checks keep their slots when the report
  // is truncated to MAX_ISSUES. checkExternalResources walks every file type,
  // including inline HTML (<script>/<link>/media tags, <style>, style= and
  // inline script calls) as well as standalone CSS/JS files.
  issues.push(...checkDataImageCredits(list));
  issues.push(...checkExternalResources(list));
  return { ok: issues.length === 0, issues: issues.slice(0, MAX_ISSUES) };
}

module.exports = { validateSiteQuality, MAX_ISSUES };
