// Website generator — versioned instruction layers (V3..V30).
//
// Every version contributes exactly four concrete, testable requirements to
// the `make_site` executor. They accumulate: V30 runs with V1+V2 baseline
// rules plus all of these. Keeping them as data makes each version auditable
// (see docs/website-report/SITE_GENERATOR_V1_V20.md and V31_V50_PLAN.md) and
// lets the validator assert that no version silently lost one of its four
// improvements.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const SITE_GENERATOR_VERSION = 30;

// Verification hook: a test harness can select an earlier version by writing
// `dex-site-version` into the temp dir. Normal users always get the latest.
function activeVersion() {
  try {
    const f = path.join(os.tmpdir(), 'dex-site-version');
    if (fs.existsSync(f)) {
      const n = Number(String(fs.readFileSync(f, 'utf8')).trim());
      if (Number.isInteger(n) && n >= 1 && n <= SITE_GENERATOR_VERSION) return n;
    }
  } catch {}
  return SITE_GENERATOR_VERSION;
}

const SITE_VERSION_RULES = [
  { version: 3, focus: 'Layout and responsive craft', rules: [
    'Build mobile-first: the 390px layout is the starting point, then add breakpoints near 640px, 900px and 1200px; there must be no horizontal scrolling at any width.',
    'Use a real type scale with clamp() for display and section headings; body copy stays at least 16px and measures roughly 60-75 characters per line.',
    'Constrain content with a readable max width (about 1120-1200px), centre it, and use one consistent 4/8px spacing rhythm everywhere.',
    'Touch targets are at least 44x44px with visible spacing; stacked mobile controls never overlap or wrap into an unreadable strip.',
  ] },
  { version: 4, focus: 'Visual craft and motion', rules: [
    'Commit to one restrained accent colour over a deliberate neutral palette; no rainbow gradients, no default browser blues, no clashing accent pairs.',
    'Use depth sparingly: one or two layered shadows, hairline borders and generous whitespace instead of heavy boxes.',
    'Motion is purposeful: 150-250ms transitions on hover/focus/state changes, eased, and never on layout properties that cause jank.',
    'Honour prefers-reduced-motion: disable or shorten every transition and animation when the user asks for less motion.',
  ] },
  { version: 5, focus: 'Typography', rules: [
    'Use a system font stack with sensible fallbacks (-apple-system, Segoe UI, Roboto, sans-serif); no webfont downloads.',
    'Tune headings: tighter letter-spacing on large text, deliberate line-height, and a clear size step between each heading level.',
    'Body copy uses line-height 1.5-1.7 and sentence-level rhythm; avoid walls of text by breaking into short paragraphs.',
    'Numbers in stats, prices or tables use tabular-nums so columns line up and values do not jitter when they change.',
  ] },
  { version: 6, focus: 'Colour and accessibility', rules: [
    'Meet 4.5:1 text contrast (3:1 for large text); check accent-on-background combinations before using them for body copy.',
    'Support both colour schemes: provide a prefers-color-scheme dark variant or an explicit theme toggle, never a white page with unreadable dark-mode text.',
    'Every interactive element shows a clear :focus-visible outline; never remove focus styling without replacing it.',
    'Include semantic landmarks (header, nav, main, footer), one h1, and a skip-to-content link on long pages.',
  ] },
  { version: 7, focus: 'Navigation', rules: [
    'Navigation has a visible active/current state and works from keyboard and touch without any external library.',
    'In-page anchors scroll smoothly but leave room for a sticky header using scroll-margin-top on targets.',
    'Every nav link points at a real in-page section or a real generated page; no href="#" placeholders.',
    'A sticky header stays compact on scroll and never covers the first heading after navigation.',
  ] },
  { version: 8, focus: 'Forms', rules: [
    'Every input has a real label (label for=, aria-label or wrapping label); placeholder text alone is never the label.',
    'Validate on blur and submit with specific inline messages next to the field, and mark invalid fields with aria-invalid.',
    'Use the right native input types (email, tel, number, date) and autocomplete hints so mobile keyboards and password managers work.',
    'A successful submit shows an inline success state without reloading the page, and the submit button is disabled while work is in progress.',
  ] },
  { version: 9, focus: 'Feedback and states', rules: [
    'Dynamic areas always have a meaningful empty state and, where relevant, loading and error states - never a blank box.',
    'Announce important updates with aria-live="polite" so screen readers hear result counts, validation and success messages.',
    'Buttons that change data give immediate visible feedback (label change, checkmark, toast or inline confirmation).',
    'Destructive actions (clear, reset, delete) ask for confirmation or are undoable; never fire immediately on a single careless click.',
  ] },
  { version: 10, focus: 'State and persistence', rules: [
    'Persist genuine user state (todos, preferences, filters) in localStorage with a namespaced key, and restore it on load.',
    'Seed the UI with realistic example data drawn from the request so the first paint is complete, not an empty shell.',
    'Counters, totals and badges derive from actual state; never hard-code a number that should update when the user acts.',
    'Offer a visible reset control that clears persisted state and returns to the seeded example.',
  ] },
  { version: 11, focus: 'Imagery and icons', rules: [
    'Use inline SVG, CSS shapes or gradients for all artwork and icons; no remote images, emoji-as-icon substitutes or icon fonts.',
    'Every informative image has meaningful alt text; decorative SVG icons use aria-hidden="true".',
    'Set aspect-ratio or explicit dimensions on media so layout never shifts while content appears.',
    'Icons are consistent in stroke width, size and optical alignment across the whole page.',
  ] },
  { version: 12, focus: 'Performance', rules: [
    'Write plain vanilla JavaScript - no frameworks, no CDN scripts, no build step.',
    'Keep the whole index.html comfortably small (well under 200KB); reuse CSS classes instead of repeating inline styles.',
    'Animate transform and opacity rather than width/height/top/left; batch DOM reads before writes.',
    'Do all work synchronously from local data; never wait on a network request to render the first screen.',
  ] },
  { version: 13, focus: 'Safe sandbox behaviour', rules: [
    'Never use eval, new Function or innerHTML with user-entered strings; write user text with textContent.',
    'Make no fetch/XHR/WebSocket calls and load no remote fonts, images, scripts or styles - the page must work fully offline.',
    'Do not read cookies or store secrets; localStorage is only for harmless UI preferences and example data.',
    'Keep all behaviour inside the document: no attempts to open, navigate or message the host browser window.',
  ] },
  { version: 14, focus: 'Content quality', rules: [
    'Write real, specific copy derived from the conversation - no lorem ipsum, no "Welcome to my website" filler, no TODO stubs.',
    'Use concrete numbers, names and examples where the request provides them; make every section say something true.',
    'Give each page one primary call to action with action-oriented text ("Get the checklist", not "Submit").',
    'End with a short footer that names the project and adds useful context, not an empty legal-sounding line.',
  ] },
  { version: 15, focus: 'Responsive components', rules: [
    'Card grids use repeat(auto-fit, minmax(...)) so they reflow without a dozen media queries.',
    'Wide tables live in a keyboard-scrollable wrapper on small screens instead of breaking the layout.',
    'Modals/dialogs trap focus, close on Escape and on backdrop click, and restore focus to the trigger when closed.',
    'Dropdowns and popovers close on outside click and Escape, and expose expanded/collapsed state with aria-expanded.',
  ] },
  { version: 16, focus: 'Theming', rules: [
    'Define every colour, radius, shadow and spacing value as a CSS custom property on :root; components reference tokens, not literals.',
    'A theme toggle (when present) updates the root tokens, is labelled, and persists the choice in localStorage.',
    'Apply the saved theme before first paint with a tiny inline script in <head> so there is no flash of the wrong theme.',
    'Respect forced-colors / high-contrast mode by keeping borders and focus outlines visible without relying on colour alone.',
  ] },
  { version: 17, focus: 'Self-verification', rules: [
    'Before emitting the block, mentally click every button and walk the primary task from start to finish; remove anything that does not respond.',
    'Check the layout at 390px: headings wrap cleanly, controls fit, nothing overflows horizontally.',
    'Check keyboard operation: every control is reachable by Tab, activatable by Enter/Space, and has a visible focus ring.',
    'Check offline behaviour: the document must render and work with the network completely unavailable.',
  ] },
  { version: 18, focus: 'Small polish details', rules: [
    'Style ::selection and focus rings to match the accent so interactions feel designed rather than browser-default.',
    'Use cursor: pointer on real controls and a subtle lift/press state on clickable cards.',
    'Empty states include a short explanatory line and an action, not just an icon.',
    'Long pages have a restrained back-to-top control that appears after scrolling.',
  ] },
  { version: 19, focus: 'Editable structure', rules: [
    'Use descriptive, stable class names (card, stat, cta, nav-link) so later AI revisions can target them precisely.',
    'Group CSS into commented sections (tokens, reset, layout, components, responsive, motion) so a revision can edit one area safely.',
    'Keep IDs unique and meaningful; never reuse the same id for repeated cards or list items.',
    'Expose state with data-attributes (data-active, data-open) instead of opaque generated class names.',
  ] },
  { version: 20, focus: 'Consumer readiness', rules: [
    'The final result should feel like a finished independent product: complete content, coherent design, working interactions, no scaffolding text.',
    'Ensure the generated document produces no console errors or warnings when opened on its own.',
    'Ensure every control has an accessible name and every image a text alternative before you finish.',
    'Confirm the single index.html can be saved to disk and opened directly in a browser with all styling and behaviour intact.',
  ] },
  { version: 21, focus: 'Online-sourced artwork, inlined offline', rules: [
    'Fetch or derive useful imagery and design references from the web while generating when the brief calls for real artwork, then embed the chosen assets in index.html as base64 data URLs or inline SVG/CSS artwork; the delivered src or href is never a remote URL.',
    'Keep each inlined raster data URL under 120KB and the combined inlined asset payload under 400KB; compress, resize or replace oversized photos with inline SVG.',
    'Credit every externally sourced image or design reference in a compact visible attribution line in the footer or beneath the artwork, including source name or host and licence; do not claim external work as original.',
    'Scan the finished document for http(s) URLs in src, href, srcset, url(), @import, fetch or WebSocket usage and remove any that remain so the final file is fully offline.',
  ] },
  { version: 22, focus: 'Modern CSS with safe fallbacks', rules: [
    'Reflow at least one component using a real container query (@container plus container-type on its wrapper) and retain a viewport @media fallback for browsers without container query support.',
    'Use text-wrap: balance on headings and text-wrap: pretty on short paragraphs inside @supports (text-wrap: balance), leaving normal wrapping as the fallback.',
    'Apply :has() to a genuine parent-state style behind @supports selector(:has(*)), with a class-based fallback that still works when :has() is unsupported.',
    'Write layout with logical properties (padding-inline, margin-block, inset-inline), and gate @property or color-mix() behind @supports with a plain-colour fallback so legibility never depends on them.',
  ] },
  { version: 23, focus: 'Complete runtime control coverage', rules: [
    'Enumerate every button, role=button element, clickable card and action link before emitting; each must have a working handler or be deleted.',
    'Handle repeated and dynamically added controls with one delegated listener on a stable parent using event.target.closest(), so new items work without rebinding individual nodes.',
    'Support keyboard activation everywhere: native buttons for actions, or role=button with tabindex=0 plus Enter and Space handlers for custom controls; no action may require a mouse.',
    'Exercise the delegated path with a freshly added item at runtime and confirm the new control changes visible state (label, count or aria-pressed) without reloading the page.',
  ] },
  { version: 24, focus: 'View transitions with reduced-motion fallback', rules: [
    'Wrap content-swapping updates (tabs, filters, theme changes, detail views) in document.startViewTransition where available and assign unique view-transition-name values to changed regions.',
    'Keep ::view-transition-old and ::view-transition-new keyframes at 250ms or less and animate only opacity and transform.',
    'Guard transitions with typeof document.startViewTransition checks and @supports (view-transition-name: none), applying the same final DOM directly when the API is absent.',
    'Skip startViewTransition entirely under prefers-reduced-motion: reduce and confirm the final state appears immediately with no animation.',
  ] },
  { version: 25, focus: 'Print stylesheet', rules: [
    'Include a dedicated @media print block that hides navigation, controls, overlays, back-to-top and decorative artwork while keeping the main content and the single h1 visible.',
    'Use a single-column print layout in mm/pt units, remove shadows and dark backgrounds and force black-on-white text with print-color-adjust: exact only where colour carries meaning.',
    'Expand accordions, details and tabs for print and add a short print-only source line for inlined externally sourced artwork; do not print raw URLs for every in-page nav link.',
    'Verify the printed page has no clipped cards, no split buttons and no empty header or footer bands when printed from the standalone file.',
  ] },
  { version: 26, focus: 'Storage fallback and resilience', rules: [
    'Wrap every localStorage read and write in try/catch and fall back to an in-memory state object when storage is blocked, unavailable or throws QuotaExceededError.',
    'Validate restored state against its expected shape and types before applying it; discard corrupt or stale values and reseed defaults instead of crashing.',
    'Expose a visible storage-status hint such as "Preferences saved" or "Session only" through an aria-live region when persistence is unavailable so the user is not misled.',
    'Confirm that with storage disabled the document opened from disk still supports every interaction for the session and that Reset restores seeded data without exceptions.',
  ] },
  { version: 27, focus: 'Advanced JavaScript state', rules: [
    'Keep one plain state object or small Map as the single source of truth and render from it through one pure render function instead of mutating scattered DOM snippets.',
    'Implement single-level undo for at least one mutating or destructive action with a visible Undo control that restores the prior state and announces the change.',
    'Derive all counters, badges and empty-state visibility from state in the same render pass; no unrelated handler may write a derived value.',
    'Make handlers idempotent so repeated clicks on a filter or sort control yield the same DOM and never duplicate listeners or list items.',
  ] },
  { version: 28, focus: 'Runtime accessibility and focus checks', rules: [
    'Run a compact startup self-check asserting that every button has an accessible name, every img has alt text, every label[for]/aria-labelledby/aria-controls target exists and ids are unique, while logging no errors when valid.',
    'Trap focus inside any open dialog or popover, move focus to its first labelled control on open and restore focus to the exact trigger on close.',
    'Keep custom controls in a logical Tab order and operable with Enter/Space, and verify the sequence never lands on a hidden or aria-hidden element.',
    'Reflect dynamic state with aria-pressed, aria-expanded, aria-selected or aria-current as appropriate, announce material changes in an aria-live region and confirm with a keyboard-only walkthrough.',
  ] },
  { version: 29, focus: 'Performance budgets', rules: [
    'Keep the complete index.html at or under 250KB after inlined assets, with no single data URL above 120KB and no repeated inline style blocks.',
    'Issue zero runtime network requests: no fetch, XHR, WebSocket or import calls and no external src or href values; first paint uses only markup, CSS and inline JS already in the file.',
    'Use one end-of-body script, batch DOM reads before writes and animate only transform and opacity after first paint.',
    'Render all initial DOM synchronously from the end-of-body script before the first requestAnimationFrame after DOMContentLoaded, with no parser-blocking script earlier in the document.',
  ] },
  { version: 30, focus: 'Final self-contained release gate', rules: [
    'Run a release-gate pass: files[] still holds exactly one object with path "index.html" and no other files, and the HTML parses with one h1, a title and a meta description.',
    'Remove every remote reference from the final content (http(s), protocol-relative URLs, @import, absolute srcset URLs, fetch, WebSocket, import); all artwork is inline data URL, SVG or CSS.',
    'Re-confirm that every visible control has a working handler, every inlined external asset has attribution and every accessibility, keyboard, print and storage fallback from V21-V29 still holds after the last edit.',
    'Verify the file opens directly from disk with no console errors and works with the network disconnected; only then emit the single fenced dex-artifact block.',
  ] },
];

// One-line condensed rules per version for the compact single-turn site
// prompt. These carry the actual 4 improvements into generation without the
// 10k-char rule dump that made the model reason itself into an empty reply.
const SITE_VERSION_SUMMARIES = {
  3: 'mobile-first layout, clamp() type, 44px touch targets, no horizontal scroll at 390/768/1440px',
  4: 'one restrained accent on neutrals, sparse layered shadows, 150-250ms eased motion, reduced-motion fallback',
  5: 'system font stack, tuned heading tracking and line-height, tabular-nums for numbers, short paragraphs',
  6: '4.5:1 contrast, prefers-color-scheme variant, visible :focus-visible, landmarks, skip link, one h1',
  7: 'nav with aria-current active state, real in-page links, smooth scroll with scroll-margin, compact sticky header',
  8: 'real label for every input, native input types and autocomplete, inline validation with aria-invalid, success state',
  9: 'empty/loading/error states, aria-live announcements, visible feedback on every data change, safe destructive actions',
  10: 'localStorage state with namespaced key, realistic seeded data, derived counters, visible reset control',
  11: 'inline SVG/CSS artwork only, meaningful alt, aria-hidden decorative icons, aspect-ratio to prevent layout shift',
  12: 'vanilla JS only, compact markup, transform/opacity animation, no network wait for first paint',
  13: 'no eval, no fetch, no user text through innerHTML, no cookies or secrets, self-contained offline behaviour',
  14: 'real specific copy from the request, concrete numbers, one primary action with active wording, useful footer',
  15: 'auto-fit card grids, scrollable table wrapper, accessible dialog with Escape/focus restore, dismissible popovers',
  16: 'all colours/radii/shadows/spacing as :root tokens, labelled persisted theme toggle, no flash of wrong theme, forced-colors safe',
  17: 'self-check every button and keyboard path, verify 390px layout and offline behaviour before emitting',
  18: 'styled ::selection and focus, pointer and press states, actionable empty states, restrained back-to-top',
  19: 'stable descriptive class names, commented CSS sections, unique ids, data-* state attributes',
  20: 'finished-product feel, no console errors, accessible names on every control, opens directly from disk intact',
  21: 'fetch web imagery during generation but inline it as data URL/SVG/CSS, cap assets at 120KB each and 400KB total, visible source attribution, zero remote URLs',
  22: 'container queries with viewport fallback, text-wrap balance/pretty behind @supports, :has() with class fallback, logical props plus gated @property/color-mix()',
  23: 'enumerate and wire every button/link, one delegated listener with closest(), Enter/Space on custom controls, runtime test with a newly added item',
  24: 'startViewTransition for content swaps with unique names, 250ms opacity/transform keyframes, API/@supports guards, reduced-motion skips transitions entirely',
  25: 'print CSS hides chrome and keeps one h1, single-column black-on-white layout, expanded disclosures and print-only source lines, no clipped or split output',
  26: 'try/catch localStorage with in-memory fallback, validate or reseed corrupt state, visible aria-live storage status, all interactions work with storage disabled',
  27: 'single state object with pure render, visible single-level undo, derived counters/badges/empty states in one pass, idempotent handlers',
  28: 'startup labels/alt/id/aria self-check, dialog focus trap and trigger restore, Tab order without hidden targets, ARIA state plus live announcements',
  29: '250KB total with 120KB asset cap, zero runtime network requests, one end-of-body script with batched reads, initial DOM before first requestAnimationFrame',
  30: 'release gate: exactly one index.html, no remote references, re-verify handlers/attribution/all V21-V29 fallbacks, opens offline with no console errors',
};

function versionSummariesThrough(version) {
  const n = Math.max(1, Math.min(SITE_VERSION_RULES.length + 2, Number(version) || SITE_GENERATOR_VERSION));
  return Object.keys(SITE_VERSION_SUMMARIES)
    .map(Number).filter(v => v <= n)
    .map(v => 'V' + v + ': ' + SITE_VERSION_SUMMARIES[v]);
}

function rulesThrough(version) {
  const n = Math.max(1, Math.min(SITE_VERSION_RULES.length + 2, Number(version) || SITE_GENERATOR_VERSION));
  return SITE_VERSION_RULES.filter(v => v.version <= n).flatMap(v => v.rules.map(rule => 'V' + v.version + ' ' + focusLabel(v) + ': ' + rule));
}
function focusLabel(v) { return v.focus.toLowerCase(); }

module.exports = { SITE_GENERATOR_VERSION, SITE_VERSION_RULES, SITE_VERSION_SUMMARIES, versionSummariesThrough, rulesThrough, activeVersion };
