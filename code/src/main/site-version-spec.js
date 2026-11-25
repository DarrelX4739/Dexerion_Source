// Versioned website-generator specification.
//
// Each version contributes exactly four compact generator rules. They are fed
// to the single-turn site writer cumulatively, while the E2E harness scores
// the same four improvements per version. Keeping prompt rules and acceptance
// criteria adjacent makes it auditable that V20 is strictly better than V19.
'use strict';

const SITE_VERSION_SPEC = [
  {
    version: 1,
    focus: 'Single-file foundation',
    rules: [
      'Emit exactly one file: {"path":"index.html","content":"..."}. Put all CSS in one <style> in <head> and all JavaScript in one <script> near the end of <body>.',
      'Use valid HTML5 with <!DOCTYPE html>, <html lang="en">, <meta charset="utf-8">, a descriptive <title>, one <h1>, real headings, paragraphs, lists and a small footer.',
      'Write real, specific copy from the person\'s request. No lorem ipsum, no placeholders, no TODOs and no empty sections.',
      'The document must work offline from disk: no external URLs, CDN, webfont, remote image, import, fetch or second file.',
    ],
  },
  {
    version: 2,
    focus: 'Real interactivity',
    rules: [
      'Wire at least three genuinely different behaviours in vanilla JavaScript (for example theme toggle, form validation, product filter, count control, copy button).',
      'Every visible button and link must do something real. No dead buttons, no empty href="#" and no div/span click handlers.',
      'Attach listeners only after the elements exist (script at the end of body or DOMContentLoaded) and keep user text with textContent, never innerHTML.',
      'The page must load without JavaScript errors; check all ids used by scripts exist before emitting.',
    ],
  },
  {
    version: 3,
    focus: 'Responsive craft',
    rules: [
      'Add <meta name="viewport" content="width=device-width, initial-scale=1"> and design mobile-first with no horizontal scrolling.',
      'Use clamp() for display and section headings; keep body copy at least 16px.',
      'Include real @media breakpoints for tablet and desktop layouts.',
      'Use repeat(auto-fit, minmax(...)) for card grids so they reflow without many media queries.',
    ],
  },
  {
    version: 4,
    focus: 'Visual craft and motion',
    rules: [
      'Choose one restrained accent over a deliberate neutral palette; use CSS custom properties for colours.',
      'Use a hairline border, one restrained box-shadow and generous whitespace instead of heavy boxes.',
      'Add 150-250ms eased transitions on hover, focus and state changes; animate transform/opacity/colour, never layout properties.',
      'Include @media (prefers-reduced-motion: reduce) to disable or shorten motion.',
    ],
  },
  {
    version: 5,
    focus: 'Typography',
    rules: [
      'Use a system font stack (system-ui, -apple-system, "Segoe UI", Roboto, sans-serif); download no fonts.',
      'Tune headings with tighter letter-spacing and deliberate line-height; give each heading level a clear size step.',
      'Set body line-height around 1.5-1.7 and keep paragraphs short.',
      'Use font-variant-numeric: tabular-nums on prices, counts or statistics.',
    ],
  },
  {
    version: 6,
    focus: 'Accessibility foundation',
    rules: [
      'Use header, nav, main and footer landmarks with exactly one <h1> and a first "Skip to content" link.',
      'Give each nav an aria-label and every control an accessible name.',
      'Add a visible :focus-visible outline; never remove focus styling without replacing it.',
      'Support dark colours with @media (prefers-color-scheme: dark) or a data-theme variant plus readable contrast.',
    ],
  },
  {
    version: 7,
    focus: 'Navigation',
    rules: [
      'Nav links point at real in-page sections and the current section has aria-current="page" or aria-current="location".',
      'Use smooth scrolling with scroll-margin-top on target sections so a sticky header never covers headings.',
      'Give the nav an aria-label and keep the header compact when stuck.',
      'Every in-page link target id must exist; generate the ids before writing links.',
    ],
  },
  {
    version: 8,
    focus: 'Forms',
    rules: [
      'Give every input a real <label for="id"> (or wrapping label) and use native input types plus autocomplete hints.',
      'Validate on blur and submit with specific inline messages; mark invalid fields with aria-invalid or setCustomValidity.',
      'Show an inline success state after a valid submit without reloading the page.',
      'Disable the submit button while processing, then restore it; style :disabled visibly.',
    ],
  },
  {
    version: 9,
    focus: 'Feedback and states',
    rules: [
      'Add an aria-live="polite" region for validation, success and data-change announcements.',
      'Dynamic lists have a meaningful empty state, not a blank box.',
      'Buttons that change data give immediate visible feedback through a class toggle, label change or checkmark.',
      'Destructive actions ask for confirm() or are undoable; never fire on one careless click.',
    ],
  },
  {
    version: 10,
    focus: 'State and persistence',
    rules: [
      'Persist real user state in localStorage under a namespaced key and restore it on load.',
      'Seed the UI with realistic example data from the request so the first paint is complete.',
      'Derive counters and badges from the actual state array length or a filter/reduce, never hard-code them.',
      'Include a visible Reset control that clears persisted state and returns to the seeded data.',
    ],
  },
  {
    version: 11,
    focus: 'Imagery and icons',
    rules: [
      'Create all artwork with inline SVG, CSS shapes or gradients; no remote images or icon fonts.',
      'Give decorative SVG icons aria-hidden="true" and meaningful images alt text.',
      'Set aspect-ratio or explicit dimensions on artwork containers to prevent layout shift.',
      'Keep icon stroke width and optical size consistent across the page.',
    ],
  },
  {
    version: 12,
    focus: 'Performance',
    rules: [
      'Use vanilla JavaScript only; no framework, CDN script, build step or network wait for first paint.',
      'Keep the entire index.html under 200KB by reusing classes instead of repeating inline styles.',
      'Animate only transform and opacity for motion; batch DOM reads before writes.',
      'Render everything from local data synchronously immediately after DOMContentLoaded or from the end-of-body script.',
    ],
  },
  {
    version: 13,
    focus: 'Safe sandbox',
    rules: [
      'Never use eval, new Function or fetch/XHR/WebSocket.',
      'Never assign innerHTML with user-entered text; use textContent or createElement.',
      'Do not read document.cookie and do not store secrets, passwords or tokens in localStorage.',
      'Do not message, navigate or otherwise try to control the host browser window.',
    ],
  },
  {
    version: 14,
    focus: 'Content quality',
    rules: [
      'Write real, specific copy derived from the request, including the brand name where one is given.',
      'Use concrete numbers, names and examples; avoid generic filler and marketing clichés.',
      'Give the page one primary call to action with action-oriented wording such as Get, Join, Order, Subscribe or Explore.',
      'End with a short useful footer that names the project and adds context, not an empty legal line.',
    ],
  },
  {
    version: 15,
    focus: 'Responsive components',
    rules: [
      'Card grids use repeat(auto-fit, minmax(...)) and any wide data area has an overflow-x:auto wrapper.',
      'Include an accessible product/quick-view dialog using <dialog> or role="dialog" with aria-modal="true".',
      'The dialog closes on Escape and backdrop click and restores focus to its trigger when closed.',
      'Popovers or disclosure panels expose aria-expanded and close on outside click and Escape.',
    ],
  },
  {
    version: 16,
    focus: 'Theming',
    rules: [
      'Declare colours, radii, shadows, spacing and motion durations as custom properties on :root and reference them with var().',
      'Include a labelled theme toggle with aria-pressed or aria-label that switches a data-theme attribute on <html> or <body>.',
      'Persist the theme choice in localStorage and apply it before first paint with a tiny head script to avoid a wrong-theme flash.',
      'Respect forced-colors mode with @media (forced-colors: active) and set color-scheme appropriately.',
    ],
  },
  {
    version: 17,
    focus: 'Self-verification',
    rules: [
      'Before emitting, check every button and keyboard path; remove anything that does not respond.',
      'Give every element a unique id; never duplicate ids across repeated cards.',
      'Ensure every label[for], aria-labelledby, aria-controls and aria-describedby reference an existing id.',
      'Check the 390px layout: no horizontal scrolling, no overlapping controls and all touch targets at least 44px.',
    ],
  },
  {
    version: 18,
    focus: 'Small polish',
    rules: [
      'Style ::selection and :focus-visible to match the accent.',
      'Use cursor:pointer on real controls and a subtle :active press state.',
      'Any empty state includes a short explanation and an action button, not just an icon.',
      'Long pages include a restrained Back to top button that appears after scrolling.',
    ],
  },
  {
    version: 19,
    focus: 'Editable structure',
    rules: [
      'Use stable descriptive class names such as card, stat, cta and nav-link so later AI revisions can target them.',
      'Group CSS into commented sections: /* tokens */, /* reset */, /* layout */, /* components */, /* responsive */, /* motion */.',
      'Keep ids unique and meaningful; never use opaque generated identifiers for repeated items.',
      'Expose UI state with data-* attributes such as data-active, data-open, data-theme or data-filter.',
    ],
  },
  {
    version: 20,
    focus: 'Consumer readiness',
    rules: [
      'The result must feel like a finished independent product: complete content, coherent design and working interactions.',
      'Ensure the document produces no console errors or warnings when opened alone.',
      'Ensure every control has an accessible name, every image a text alternative and the page still has exactly one h1.',
      'Confirm the single index.html has a unique descriptive title and meta description and opens directly from disk intact.',
    ],
  },
  {
    version: 21,
    focus: 'Online-sourced artwork, inlined offline',
    rules: [
      'When the brief benefits from real imagery or design references, fetch or derive candidate assets from the web while generating, then embed the chosen ones in index.html as base64 data URLs or inline SVG/CSS artwork; never leave a remote URL as the delivered src or href.',
      'Keep each inlined raster data URL under 120KB and the total inlined asset payload under 400KB; resize, compress or replace an oversized photo with inline SVG instead of shipping it.',
      'Credit every externally sourced image or design reference in a compact visible attribution line (source name or host plus licence) in the footer or directly beneath the artwork; never present external work as original.',
      'After inlining, scan the final document for http(s) URLs in src, href, srcset, url(), @import, fetch or WebSocket usage and remove any that remain so the file is fully offline.',
    ],
  },
  {
    version: 22,
    focus: 'Modern CSS with safe fallbacks',
    rules: [
      'Use a container query with @container and container-type for at least one card or list component so it reflows from its own width, and keep a viewport @media fallback for engines without container query support.',
      'Apply text-wrap: balance to headings and text-wrap: pretty to short paragraphs inside @supports (text-wrap: balance), leaving ordinary wrapping as the fallback.',
      'Use :has() for at least one real parent-state style, such as a card containing a checked input, behind @supports selector(:has(*)) with a class-based fallback that works without :has().',
      'Prefer logical properties (padding-inline, margin-block, inset-inline) for layout, and add @property or color-mix() only inside @supports with a plain-colour fallback so no feature is required for legibility.',
    ],
  },
  {
    version: 23,
    focus: 'Complete runtime control coverage',
    rules: [
      'Before emitting, enumerate every button, role=button element, clickable card and action link; each one must have a registered handler or be removed.',
      'Implement repeated or dynamic controls with a single delegated listener on a stable parent using event.target.closest(), so items added later work without rebinding.',
      'Give every custom control keyboard activation with native buttons for actions or role=button plus tabindex=0 and Enter/Space handlers for non-native elements; no action may require a mouse.',
      'Add one fresh item at runtime through the delegated path and confirm the new control changes visible state (label, count or aria-pressed) without a page reload.',
    ],
  },
  {
    version: 24,
    focus: 'View transitions with reduced-motion fallback',
    rules: [
      'Wrap content-swapping DOM updates (tabs, filters, theme, detail views) in document.startViewTransition when available and give each changed region a unique view-transition-name.',
      'Keep ::view-transition-old and ::view-transition-new keyframes at 250ms or less and animate only opacity and transform.',
      'Guard every transition with typeof document.startViewTransition checks and @supports (view-transition-name: none), and apply the same final DOM directly when the API is missing.',
      'Skip startViewTransition entirely under @media (prefers-reduced-motion: reduce) and confirm the final state appears immediately with no animation.',
    ],
  },
  {
    version: 25,
    focus: 'Print stylesheet',
    rules: [
      'Include a dedicated @media print block that hides navigation, controls, overlays, back-to-top and decorative artwork while keeping the main content and the single h1.',
      'Use a single-column printed layout in mm/pt units, remove shadows and dark backgrounds, and force black-on-white text with print-color-adjust: exact only where a colour carries meaning.',
      'Expand accordions, details and tabs for print and add a short print-only source line for inlined externally sourced artwork; do not print raw URLs for every in-page nav link.',
      'Verify the printed page has no clipped cards, no split buttons and no empty header or footer bands when printed from the standalone file.',
    ],
  },
  {
    version: 26,
    focus: 'Storage fallback and resilience',
    rules: [
      'Wrap every localStorage read and write in try/catch and fall back to an in-memory state object when storage is blocked, unavailable or throws QuotaExceededError.',
      'Validate restored state against its expected shape and types before applying it; discard corrupt or stale values and reseed defaults instead of crashing.',
      'Expose a visible storage-status hint such as "Preferences saved" or "Session only" through an aria-live region when persistence is unavailable so the user is not misled.',
      'Confirm that with storage disabled the document opened from disk still supports every interaction for the session and Reset restores seeded data without exceptions.',
    ],
  },
  {
    version: 27,
    focus: 'Advanced JavaScript state',
    rules: [
      'Model interactive state in one plain object or small Map as the single source of truth and render from it through one pure render function instead of mutating scattered DOM snippets.',
      'Implement undo for at least one mutating or destructive action with a single-level snapshot, a visible Undo control and an aria-live announcement.',
      'Derive every counter, badge and empty-state visibility from state in the same render pass; no unrelated handler may write a derived value.',
      'Keep handlers idempotent so repeated clicks on a filter or sort control produce the same DOM and never duplicate listeners or list items.',
    ],
  },
  {
    version: 28,
    focus: 'Runtime accessibility and focus checks',
    rules: [
      'Run a compact startup self-check that asserts every button has an accessible name, every img has alt text, every label[for]/aria-labelledby/aria-controls target exists and ids are unique, while logging no errors when valid.',
      'Trap focus inside any open dialog or popover, move focus to its first labelled control on open and restore focus to the exact trigger on close.',
      'Make custom controls reachable by Tab in DOM order and operable with Enter/Space, and verify the tab sequence never lands on a hidden or aria-hidden element.',
      'Reflect dynamic state with aria-pressed, aria-expanded, aria-selected or aria-current as appropriate, announce material changes in an aria-live region and confirm with a keyboard-only walkthrough.',
    ],
  },
  {
    version: 29,
    focus: 'Performance budgets',
    rules: [
      'Keep the complete index.html at or under 250KB after inlined assets, with no single data URL above 120KB and no repeated inline style blocks.',
      'Load no runtime network resource: zero fetch, XHR, WebSocket or import calls and zero external src or href values; first paint uses only markup, CSS and inline JS already in the file.',
      'Use a single end-of-body script, batch DOM reads before writes and animate only transform and opacity after first paint.',
      'Render all initial DOM synchronously from the end-of-body script before the first requestAnimationFrame following DOMContentLoaded, with no parser-blocking script earlier in the document.',
    ],
  },
  {
    version: 30,
    focus: 'Final self-contained release gate',
    rules: [
      'Run a release-gate pass: files[] still contains exactly one object with path "index.html" and no other files, and the HTML parses with one h1, a title and a meta description.',
      'Scan the final content for remote references (http(s), protocol-relative URLs, @import, absolute srcset URLs, fetch, WebSocket, import) and remove any that remain; all artwork is inline data URL, SVG or CSS.',
      'Confirm every visible control has a working handler, every inlined external asset has attribution and every accessibility, keyboard, print and storage fallback from V21-V29 still holds after the last edit.',
      'Verify the file opens directly from disk with no console errors and works with the network disconnected; only then emit the single fenced dex-artifact block.',
    ],
  },
];

function promptRulesThrough(version) {
  const n = Math.max(1, Math.min(SITE_VERSION_SPEC.length, Number(version) || SITE_VERSION_SPEC.length));
  return SITE_VERSION_SPEC.slice(0, n).flatMap((entry) => entry.rules.map((rule) => 'V' + entry.version + ': ' + rule));
}

function focusThrough(version) {
  const n = Math.max(1, Math.min(SITE_VERSION_SPEC.length, Number(version) || SITE_VERSION_SPEC.length));
  return SITE_VERSION_SPEC.slice(0, n).map((entry) => 'V' + entry.version + ' ' + entry.focus.toLowerCase()).join('; ');
}

const SITE_GENERATOR_VERSION = SITE_VERSION_SPEC.length;

module.exports = { SITE_GENERATOR_VERSION, SITE_VERSION_SPEC, promptRulesThrough, focusThrough };
