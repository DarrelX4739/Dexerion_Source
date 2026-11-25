// Deterministic interactivity guard for generated single-file websites.
//
// A reasoning model can happily emit a polished, content-complete page whose
// buttons are decorative. The prompt asks for working behaviour, but a prompt
// request is not a guarantee. This module inspects the emitted index.html for
// REAL event wiring. If the page is static, or it contains controls that no
// script ever touches, streamSite sends one focused repair turn back to the
// model with the exact problem listed. The strict rule is simple and matches
// the user-facing promise: if a control is on the page, it must do something.
'use strict';

// Events that count as real interaction wiring. Deliberately generous: a false
// repair is worse than a missed one, and every name here is a user action.
const EVENTS = 'click|change|submit|input|keydown|keyup|keypress|mousedown|mouseup|pointerdown|touchstart|toggle|focusin';
const INLINE_HANDLER = new RegExp('(?:^|\\s)on(?:' + EVENTS + ')\\s*=', 'i');
const INLINE_HANDLER_IN_SOURCE = new RegExp('<[a-z][\\w-]*\\b[^>]*\\son(?:' + EVENTS + ')\\s*=', 'i');
const LISTENER = new RegExp('addEventListener\\s*\\(\\s*["\'](?:' + EVENTS + ')|\\.on(?:' + EVENTS + ')\\s*=', 'i');
const LISTENER_ANY = /addEventListener\s*\(/i;
const DELEGATION_HELPER = /\b(?:closest|matches)\s*\(/i;

function scriptText(html) {
  const out = [];
  const re = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html))) out.push(m[1] || '');
  return out.join('\n');
}

// Script bodies are blanked (not removed) for markup scans so string literals
// containing fake tags cannot invent controls, while every index stays valid
// for the form/<details> ancestor ranges.
function markupOnly(html) {
  return String(html || '').replace(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi,
    (whole) => whole.replace(/[^\n]/g, ' '));
}

function attr(attrs, name) {
  const m = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*["\']([^"\']*)["\']', 'i').exec(attrs || '');
  return m ? m[1] : '';
}

function visibleText(inner) {
  return String(inner || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Every user-operable element is a control: buttons, all inputs, selects,
// textareas, anchors, <summary>, role="button" and explicit tab stops. A bare
// href="#" / javascript: anchor is still an action-shaped control (and is the
// classic dead link), but a real href is functional navigation by itself.
function controlTags(html) {
  const src = markupOnly(html);
  const found = [];
  const add = (type, index, whole, attrs, inner) => {
    found.push({
      type,
      attrs: attrs || '',
      text: visibleText(inner) || (type === 'input'
        ? (attr(attrs, 'value') || attr(attrs, 'aria-label') || attr(attrs, 'placeholder')) : ''),
      index,
      end: index + whole.length,
    });
  };

  // Paired controls: their inner text is used to name exact dead controls.
  const paired = [
    ['button', /<(button)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi],
    ['a', /<(a)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi],
    ['select', /<(select)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi],
    ['textarea', /<(textarea)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi],
    ['summary', /<(summary)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi],
  ];
  for (const [type, re] of paired) {
    let m;
    while ((m = re.exec(src))) add(type, m.index, m[0], m[2], m[3]);
  }

  // Void controls — all of them, not just type=button|submit|reset.
  for (const m of src.matchAll(/<input\b([^>]*)>/gi)) add('input', m.index, m[0], m[1], '');

  // ARIA buttons and explicit tab stops. tabindex="-1" is programmatic focus
  // (modal containers, roving tabindex), not a user-reachable control.
  for (const m of src.matchAll(/<([a-z][\w-]*)\b([^>]*?)\/?>/gi)) {
    const name = m[1].toLowerCase();
    const attrs = m[2] || '';
    const isRoleButton = /\srole\s*=\s*["']button["']/i.test(attrs) && name !== 'button';
    const ti = /(?<![\w-])tabindex\s*=\s*["']([^"']*)["']/i.exec(attrs);
    const isTabStop = ti && ti[1].trim() !== '-1'
      && !/^(?:button|a|input|select|textarea|summary)$/.test(name);
    if (!isRoleButton && !isTabStop) continue;
    add(isRoleButton ? 'role-button' : 'tabindex', m.index, m[0], attrs, '');
  }

  // One finding per source position: <button role="button" tabindex="0"> is
  // still one control, and the more specific type wins.
  const seen = new Set();
  return found.filter((c) => {
    if (seen.has(c.index)) return false;
    seen.add(c.index);
    return true;
  });
}

// Delegation shapes: a listener on a global/root container, a property handler
// on body/document, an inline handler on body/html/form, or any listener that
// funnels through closest()/matches(). All plausibly cover every control, so
// none of them may be reported as dead.
function delegationDetected(scripts, raw) {
  const roots = '(?:document|window|body|documentElement|html|app|root|main|container|list|grid|form|wrapper|panel|toolbar|nav|menu|table|parent)';
  const rootListener = new RegExp(roots + '\\s*\\.addEventListener\\s*\\(\\s*["\'](?:' + EVENTS + ')', 'i').test(scripts);
  const rootProperty = new RegExp(roots + '\\s*\\.on(?:' + EVENTS + ')\\s*=', 'i').test(scripts);
  const rootInline = new RegExp('<(?:body|html|form)\\b[^>]*\\son(?:' + EVENTS + ')\\s*=', 'i').test(raw);
  return rootListener || rootProperty || rootInline || (LISTENER_ANY.test(scripts) && DELEGATION_HELPER.test(scripts));
}

function describeControl(c) {
  const id = attr(c.attrs, 'id');
  const href = c.type === 'a' ? attr(c.attrs, 'href') : '';
  return c.type
    + (c.text ? ' "' + c.text.slice(0, 40) + '"' : '')
    + (id ? ' #' + id : '')
    + (href ? ' href="' + href.slice(0, 40) + '"' : '');
}

function hasRealHref(attrs) {
  const href = String(attr(attrs, 'href') || '').trim();
  return Boolean(href) && href !== '#' && !/^javascript:/i.test(href);
}

function controlWired(c, ctx) {
  if (INLINE_HANDLER.test(c.attrs)) return true;
  if (ctx.delegated) return true;
  // Native disclosure and real navigation work without JavaScript.
  if (c.type === 'summary' && ctx.details.some(([a, b]) => c.index > a && c.index < b)) return true;
  if (c.type === 'a' && hasRealHref(c.attrs)) return true;

  // Direct wiring by id / class / data-* / name.
  const id = attr(c.attrs, 'id');
  if (id && ctx.scripts.includes(id)) return true;
  const cls = attr(c.attrs, 'class');
  if (cls && cls.split(/\s+/).some((name) => name && ctx.scripts.includes(name))) return true;
  for (const m of c.attrs.matchAll(/\b(?:data-[\w-]+|name)\s*=\s*["']([^"']+)["']/gi)) {
    if (m[1] && ctx.scripts.includes(m[1])) return true;
  }
  if (c.text && c.text.length >= 2 && ctx.scripts.includes(c.text)) return true;

  // FormData-style handlers on the enclosing form cover every field in it.
  const form = ctx.forms.find(([a, b]) => c.index > a && c.index < b);
  if (form) {
    const tag = form[2];
    if (INLINE_HANDLER.test(tag)) return true;
    for (const key of ['id', 'name']) {
      const value = attr(tag, key);
      if (value && ctx.scripts.includes(value)) return true;
    }
    const formClass = attr(tag, 'class');
    if (formClass && formClass.split(/\s+/).some((name) => name && ctx.scripts.includes(name))) return true;
  }
  return false;
}

// Inspect the HTML emitted by the site writer. Conservative by design: a
// plausible delegated handler counts as wiring for every control, and a control
// is considered wired when its id / class / data-* / text appears in a script.
// That keeps false repairs rare while still catching a truly static page.
function analyze(html) {
  const src = String(html || '');
  const scripts = scriptText(src);
  const markup = markupOnly(src);
  const controls = controlTags(src);
  const hasInlineHandler = INLINE_HANDLER_IN_SOURCE.test(src);
  const hasScript = (/<script\b/i.test(src) && /\S/.test(scripts)) || hasInlineHandler;
  const hasListeners = LISTENER.test(scripts) || hasInlineHandler;
  const delegated = delegationDetected(scripts, src);

  const ctx = {
    scripts,
    delegated,
    details: [...markup.matchAll(/<details\b[^>]*>[\s\S]*?<\/details\s*>/gi)]
      .map((m) => [m.index, m.index + m[0].length]),
    forms: [...markup.matchAll(/<form\b[^>]*>[\s\S]*?<\/form\s*>/gi)]
      .map((m) => [m.index, m.index + m[0].length, m[0]]),
  };

  const dead = controls.filter((c) => !controlWired(c, ctx));
  const deadNames = dead.map(describeControl);

  const issues = [];
  if (!hasScript) {
    issues.push('The page has no working JavaScript at all — it is a static mockup.');
  } else if (!hasListeners) {
    issues.push('The page has a <script> but no event listeners or handlers, so nothing responds to the user.');
  }
  if (dead.length) {
    issues.push('These controls are never wired and do nothing when used: '
      + deadNames.slice(0, 12).join(', ')
      + '. Bind each one directly or add a real delegated handler that actually matches it.');
  }

  return {
    interactive: Boolean(hasScript && hasListeners && dead.length === 0),
    hasScript,
    hasListeners,
    delegated,
    controls: controls.length,
    deadCount: dead.length,
    dead: deadNames,
    issues,
  };
}

// Focused second turn: keep everything the model already produced, add only
// the missing behaviour. Small, exact instructions are far more reliable with
// this reasoning model than repeating the entire 80-rule generation spec.
function repairInstruction(analysis, brief) {
  const a = analysis || {};
  const issues = Array.isArray(a.issues) ? a.issues : [];
  const named = Array.isArray(a.dead) && a.dead.length ? a.dead
    : issues.filter((s) => /controls are never wired|do nothing when used/i.test(s));
  return [
    'You are revising a website you just generated. It is NOT acceptable yet: it is static, has dead controls, or loads remote resources.',
    ...issues,
    named.length ? 'EXACT unbound controls that must work after the repair: ' + named.slice(0, 20).join(' | ') + '.' : '',
    'Rewrite the SAME website as ONE file: index.html only. Keep every piece of content, layout, styling and copy exactly as it is. Add the missing REAL JavaScript only.',
    'INTERACTIVITY RULES (mandatory):',
    '- Put one <script> just before </body>; attach listeners after the elements exist.',
    '- Every button, input, select, textarea, <summary>, role="button" element and focusable [tabindex] control must perform a visible, meaningful action: toggle state, filter/sort a list, add/remove an item, open a <dialog>, copy text, validate a form, update a counter or live search.',
    '- If you use event delegation it MUST actually work, for example: document.addEventListener("click", e => { const el = e.target.closest("button, [data-action]"); if (!el) return; /* act on el */ }); or a parent listener that checks e.target.matches(...). A listener that never matches a control does not count.',
    '- A bare href="#" or href="javascript:void(0)" with no handler is dead: replace it with a real in-page link or a <button> with a real action.',
    '- Forms must preventDefault, validate inline with a specific message, and show a success state without reloading.',
    '- Add an aria-live="polite" status region and announce each change.',
    '- Wire each control by its real id, class or data-* attribute; verify every id/class you reference exists in the markup.',
    '- Do not change the visual design or the written copy. Only add behaviour and any ids/data-attributes the scripts need.',
    'OFFLINE / ONE-FILE RULES (mandatory):',
    '- Return ONE self-contained index.html. Inline all CSS in <style> and all JavaScript in <script>; do not reference separate .css/.js files.',
    '- Inline images and icons as data:image/... (SVG or base64) or blob: URIs; use fragments (#), mailto: or tel: for links. Keep credits as visible text (figcaption/small or data-dex-credit).',
    '- NO remote resources of any kind: no https?:// or //host in <script src>, <link href>, media src/srcset, CSS url()/@import, and no fetch/XHR/WebSocket/import to remote URLs. The preview is offline and will strip them.',
    brief ? 'Original website brief: ' + String(brief).slice(0, 1500) : '',
    'Reply with ONLY the complete corrected file in one block, exactly like this:',
    '```dex-artifact',
    '{"kind":"site","title":"Site title","subtitle":"One-line tagline","files":[{"path":"index.html","content":"<!DOCTYPE html><html lang=\\"en\\">...complete corrected document...</html>"}]}',
    '```',
  ].filter(Boolean).join('\n');
}

module.exports = { analyze, repairInstruction };
