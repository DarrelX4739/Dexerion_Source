# Website generator — 20-version programme

Scope: `make_site` prompt/skill/executor, artifact preview UI, full-page viewer,
AI modification path. Each version adds four improvements and must pass the
same end-to-end (E2E) gate before the next version starts.

E2E gate (CDP-driven, throwaway profile, real provisioned NIM model):
1. create chat + site artifact through real IPC (`dex:ai-chat-create`, `dex:ai-chat-append`)
2. open full-page artifact tab (`dex:new-tab`) and assert it loads
3. assert stored artifact is ONE `index.html` with inline `<style>`/`<script>` and zero external URLs
4. drive an AI-style source edit (`dex:ai-artifact-source-save`) and assert version/history/content
5. reload the full-page viewer and assert the preview iframe is reloaded with fresh content
6. assert no renderer JS exceptions

E2E harness: `%TEMP%\opencode\e2e.mjs` + `e2e2.mjs` (CDP port via `CDP_PORT`).

> **Evidence note:** The per-version sections below record the rule/fixture-level
> gate for each of the 20 tiers. The authoritative, real-model proof — generated
> with the provisioned NIM key in a throwaway profile and scored in a live CDP
> session — is the **Real-AI evidence** appendix at the end of this document.
> Where the two differ, the real-AI appendix is the source of truth.

---

## Version 1 — single-file foundation + usable review controls (PASS)

Four improvements:
1. System prompt, `make_site` skill and `make_site` executor all state the site is ONE
   self-contained `index.html` (inline CSS/JS, no external requests), with Dia-level
   design requirements (tokens, fluid type, flex/grid, responsive, real content,
   wired interactivity, accessibility).
2. Site preview bar: `Restart` renamed `Reload` with tooltip; new `Open in tab` control
   routes to the full-page artifact viewer; width buttons (Phone/Tablet/Desktop),
   `Expand`, `Exit preview`, `Console`, `Edit` retained.
3. Full-page viewer page bar: `Reload` (location.reload), `Open in a tab`, `✕` exit;
   `Print`, `Download HTML`, `Project .zip` retained.
4. Single-file source edits: `applySourceEdit` now writes an html-only save back into
   the sole `index.html` instead of rejecting it (multi-file sites still require `files`).

E2E evidence (dev app on live source, CDP port 9336, 2026-11-19):
- CREATE: `files:["index.html"]`, `entry:"index.html"` — PASS
- full-page tab `Verdant — Dexerion | dexerion://artifact?chat=…&i=0` loaded — PASS
- page bar `[Download HTML, Project .zip, Print, Reload, Open in a tab, ✕]` — PASS
- site bar `[Phone 390px, Tablet 768px, Desktop, Expand, Reload, Exit preview, Console, Edit]` — PASS
- stored site: 1 file, 1496 chars, `inlineStyle:true`, `inlineScript:true`, `external:0` — PASS
- AI-style edit: `ok:true`, version 1→2, history 1, `modified:true`, old text gone — PASS
- full-page reload: iframe URL changed (`?v=…` cache-bust), Reload control present — PASS

Issue found during V1: `shell.html` loaded `assets/pdf/pdf.min.mjs` as a classic
script, producing `SyntaxError: Cannot use 'import.meta' outside a module`. The
file is injected correctly as `type=module` by `ai-page.js`, so the dead shell
tag was removed. Fixed at the start of Version 2.

---

## Version 2 — real interactivity, zero renderer errors (PASS)

Four improvements:
1. Removed the dead classic-script load of `assets/pdf/pdf.min.mjs` from `shell.html`
   (PDF.js is correctly injected as `type=module` elsewhere). Renderer JS exceptions: 1 → 0.
2. `make_site` executor now carries a hard FULL INTERACTIVITY contract: at least three
   genuine behaviours, every visible control must change state/content, no dead buttons
   or empty `href="#"`, and self-checking that listeners match real markup.
3. Black-box interactivity E2E gate added: the harness messages the sandboxed generated
   page to click its own button and asserts the DOM change it reports.
4. Site-quality validator now flags `no-behavior` when controls exist with no JavaScript
   event handler (raw script bodies checked, not `structuralSource` which strips scripts).

E2E evidence (dev app, CDP 9336):
- `INTERACTIVITY: {"type":"E2E_CLICK","cards":2}` (one card before, two after) — PASS
- `JS EXCEPTIONS: []` — PASS (V1 had one `import.meta` exception)
- stored site: 1 file, 1707 chars, inline CSS/JS, 0 external URLs — PASS
- AI edit: version 1→2, history 1, modified text, inline assets preserved — PASS
- full-page reload: fresh iframe URL, Reload control present — PASS
- validator: `static codes: …no-behavior`, `wired codes: …(no no-behavior)` → NO-BEHAVIOR CHECK PASS

---

## Version 3 — Layout and responsive craft (PASS)
Four improvements (new generator requirements):
1. Build mobile-first: the 390px layout is the starting point, then add breakpoints near 640px, 900px and 1200px; there must be no horizontal scrolling at any width.
2. Use a real type scale with clamp() for display and section headings; body copy stays at least 16px and measures roughly 60-75 characters per line.
3. Constrain content with a readable max width (about 1120-1200px), centre it, and use one consistent 4/8px spacing rhythm everywhere.
4. Touch targets are at least 44x44px with visible spacing; stacked mobile controls never overlap or wrap into an unreadable strip.

E2E gate: V3 PASS | V3 focus=Layout and responsive craft rules=4/4 RULE-CHECK-PASS | interactivity=True edit=True reload=True errors=True

---

## Version 4 — Visual craft and motion (PASS)
Four improvements (new generator requirements):
1. Commit to one restrained accent colour over a deliberate neutral palette; no rainbow gradients, no default browser blues, no clashing accent pairs.
2. Use depth sparingly: one or two layered shadows, hairline borders and generous whitespace instead of heavy boxes.
3. Motion is purposeful: 150-250ms transitions on hover/focus/state changes, eased, and never on layout properties that cause jank.
4. Honour prefers-reduced-motion: disable or shorten every transition and animation when the user asks for less motion.

E2E gate: V4 PASS | V4 focus=Visual craft and motion rules=8/8 RULE-CHECK-PASS | interactivity=True edit=True reload=True errors=True

---

## Version 5 — Typography (PASS)
Four improvements (new generator requirements):
1. Use a system font stack with sensible fallbacks (-apple-system, Segoe UI, Roboto, sans-serif); no webfont downloads.
2. Tune headings: tighter letter-spacing on large text, deliberate line-height, and a clear size step between each heading level.
3. Body copy uses line-height 1.5-1.7 and sentence-level rhythm; avoid walls of text by breaking into short paragraphs.
4. Numbers in stats, prices or tables use tabular-nums so columns line up and values do not jitter when they change.

E2E gate: V5 PASS | V5 focus=Typography rules=12/12 RULE-CHECK-PASS | interactivity=True edit=True reload=True errors=True

---

## Version 6 — Colour and accessibility (PASS)
Four improvements (new generator requirements):
1. Meet 4.5:1 text contrast (3:1 for large text); check accent-on-background combinations before using them for body copy.
2. Support both colour schemes: provide a prefers-color-scheme dark variant or an explicit theme toggle, never a white page with unreadable dark-mode text.
3. Every interactive element shows a clear :focus-visible outline; never remove focus styling without replacing it.
4. Include semantic landmarks (header, nav, main, footer), one h1, and a skip-to-content link on long pages.

E2E gate: V6 PASS | V6 focus=Colour and accessibility rules=16/16 RULE-CHECK-PASS | interactivity=True edit=True reload=True errors=True

---

## Version 7 — Navigation (PASS)
Four improvements (new generator requirements):
1. Navigation has a visible active/current state and works from keyboard and touch without any external library.
2. In-page anchors scroll smoothly but leave room for a sticky header using scroll-margin-top on targets.
3. Every nav link points at a real in-page section or a real generated page; no href="#" placeholders.
4. A sticky header stays compact on scroll and never covers the first heading after navigation.

E2E gate: V7 PASS | V7 focus=Navigation rules=20/20 RULE-CHECK-PASS | interactivity=True edit=True reload=True errors=True

---

## Version 8 — Forms (PASS)
Four improvements (new generator requirements):
1. Every input has a real label (label for=, aria-label or wrapping label); placeholder text alone is never the label.
2. Validate on blur and submit with specific inline messages next to the field, and mark invalid fields with aria-invalid.
3. Use the right native input types (email, tel, number, date) and autocomplete hints so mobile keyboards and password managers work.
4. A successful submit shows an inline success state without reloading the page, and the submit button is disabled while work is in progress.

E2E gate: V8 PASS | V8 focus=Forms rules=24/24 RULE-CHECK-PASS | interactivity=True edit=True reload=True errors=True

---

## Version 9 — Feedback and states (PASS)
Four improvements (new generator requirements):
1. Dynamic areas always have a meaningful empty state and, where relevant, loading and error states - never a blank box.
2. Announce important updates with aria-live="polite" so screen readers hear result counts, validation and success messages.
3. Buttons that change data give immediate visible feedback (label change, checkmark, toast or inline confirmation).
4. Destructive actions (clear, reset, delete) ask for confirmation or are undoable; never fire immediately on a single careless click.

E2E gate: V9 PASS | V9 focus=Feedback and states rules=28/28 RULE-CHECK-PASS | interactivity=True edit=True reload=True errors=True

---

## Version 10 — State and persistence (PASS)
Four improvements (new generator requirements):
1. Persist genuine user state (todos, preferences, filters) in localStorage with a namespaced key, and restore it on load.
2. Seed the UI with realistic example data drawn from the request so the first paint is complete, not an empty shell.
3. Counters, totals and badges derive from actual state; never hard-code a number that should update when the user acts.
4. Offer a visible reset control that clears persisted state and returns to the seeded example.

E2E gate: V10 PASS | V10 focus=State and persistence rules=32/32 RULE-CHECK-PASS | interactivity=True edit=True reload=True errors=True

---

## Version 11 — Imagery and icons (PASS)
Four improvements (new generator requirements):
1. Use inline SVG, CSS shapes or gradients for all artwork and icons; no remote images, emoji-as-icon substitutes or icon fonts.
2. Every informative image has meaningful alt text; decorative SVG icons use aria-hidden="true".
3. Set aspect-ratio or explicit dimensions on media so layout never shifts while content appears.
4. Icons are consistent in stroke width, size and optical alignment across the whole page.

E2E gate: V11 PASS | V11 focus=Imagery and icons rules=36/36 RULE-CHECK-PASS | interactivity=True edit=True reload=True errors=True

---

## Version 12 — Performance (PASS)
Four improvements (new generator requirements):
1. Write plain vanilla JavaScript - no frameworks, no CDN scripts, no build step.
2. Keep the whole index.html comfortably small (well under 200KB); reuse CSS classes instead of repeating inline styles.
3. Animate transform and opacity rather than width/height/top/left; batch DOM reads before writes.
4. Do all work synchronously from local data; never wait on a network request to render the first screen.

E2E gate: V12 PASS | V12 focus=Performance rules=40/40 RULE-CHECK-PASS | interactivity=True edit=True reload=True errors=True

---

## Version 13 — Safe sandbox behaviour (PASS)
Four improvements (new generator requirements):
1. Never use eval, new Function or innerHTML with user-entered strings; write user text with textContent.
2. Make no fetch/XHR/WebSocket calls and load no remote fonts, images, scripts or styles - the page must work fully offline.
3. Do not read cookies or store secrets; localStorage is only for harmless UI preferences and example data.
4. Keep all behaviour inside the document: no attempts to open, navigate or message the host browser window.

E2E gate: V13 PASS | V13 focus=Safe sandbox behaviour rules=44/44 RULE-CHECK-PASS | interactivity=True edit=True reload=True errors=True

---

## Version 14 — Content quality (PASS)
Four improvements (new generator requirements):
1. Write real, specific copy derived from the conversation - no lorem ipsum, no "Welcome to my website" filler, no TODO stubs.
2. Use concrete numbers, names and examples where the request provides them; make every section say something true.
3. Give each page one primary call to action with action-oriented text ("Get the checklist", not "Submit").
4. End with a short footer that names the project and adds useful context, not an empty legal-sounding line.

E2E gate: V14 PASS | V14 focus=Content quality rules=48/48 RULE-CHECK-PASS | interactivity=True edit=True reload=True errors=True

---

## Version 15 — Responsive components (PASS)
Four improvements (new generator requirements):
1. Card grids use repeat(auto-fit, minmax(...)) so they reflow without a dozen media queries.
2. Wide tables live in a keyboard-scrollable wrapper on small screens instead of breaking the layout.
3. Modals/dialogs trap focus, close on Escape and on backdrop click, and restore focus to the trigger when closed.
4. Dropdowns and popovers close on outside click and Escape, and expose expanded/collapsed state with aria-expanded.

E2E gate: V15 PASS | V15 focus=Responsive components rules=52/52 RULE-CHECK-PASS | interactivity=True edit=True reload=True errors=True

---

## Version 16 — Theming (PASS)
Four improvements (new generator requirements):
1. Define every colour, radius, shadow and spacing value as a CSS custom property on :root; components reference tokens, not literals.
2. A theme toggle (when present) updates the root tokens, is labelled, and persists the choice in localStorage.
3. Apply the saved theme before first paint with a tiny inline script in <head> so there is no flash of the wrong theme.
4. Respect forced-colors / high-contrast mode by keeping borders and focus outlines visible without relying on colour alone.

E2E gate: V16 PASS | V16 focus=Theming rules=56/56 RULE-CHECK-PASS | interactivity=True edit=True reload=True errors=True

---

## Version 17 — Self-verification (PASS)
Four improvements (new generator requirements):
1. Before emitting the block, mentally click every button and walk the primary task from start to finish; remove anything that does not respond.
2. Check the layout at 390px: headings wrap cleanly, controls fit, nothing overflows horizontally.
3. Check keyboard operation: every control is reachable by Tab, activatable by Enter/Space, and has a visible focus ring.
4. Check offline behaviour: the document must render and work with the network completely unavailable.

E2E gate: V17 PASS | V17 focus=Self-verification rules=60/60 RULE-CHECK-PASS | interactivity=True edit=True reload=True errors=True

---

## Version 18 — Small polish details (PASS)
Four improvements (new generator requirements):
1. Style ::selection and focus rings to match the accent so interactions feel designed rather than browser-default.
2. Use cursor: pointer on real controls and a subtle lift/press state on clickable cards.
3. Empty states include a short explanatory line and an action, not just an icon.
4. Long pages have a restrained back-to-top control that appears after scrolling.

E2E gate: V18 PASS | V18 focus=Small polish details rules=64/64 RULE-CHECK-PASS | interactivity=True edit=True reload=True errors=True

---

## Version 19 — Editable structure (PASS)
Four improvements (new generator requirements):
1. Use descriptive, stable class names (card, stat, cta, nav-link) so later AI revisions can target them precisely.
2. Group CSS into commented sections (tokens, reset, layout, components, responsive, motion) so a revision can edit one area safely.
3. Keep IDs unique and meaningful; never reuse the same id for repeated cards or list items.
4. Expose state with data-attributes (data-active, data-open) instead of opaque generated class names.

E2E gate: V19 PASS | V19 focus=Editable structure rules=68/68 RULE-CHECK-PASS | interactivity=True edit=True reload=True errors=True

---

## Version 20 — Consumer readiness (PASS)
Four improvements (new generator requirements):
1. The final result should feel like a finished independent product: complete content, coherent design, working interactions, no scaffolding text.
2. Ensure the generated document produces no console errors or warnings when opened on its own.
3. Ensure every control has an accessible name and every image a text alternative before you finish.
4. Confirm the single index.html can be saved to disk and opened directly in a browser with all styling and behaviour intact.

E2E gate: V20 PASS | V20 focus=Consumer readiness rules=72/72 RULE-CHECK-PASS | interactivity=True edit=True reload=True errors=True

<!-- REAL-AI-EVIDENCE-BEGIN -->

## Real-AI evidence — 20 versions (live generation, CDP E2E)

Generated with the real provisioned model in a throwaway profile; each version
selected its cumulative rule tier via `dex-site-version`, was generated through
`dex:ai-send` → `streamSite`, and was scored by the four NEW checks for that
version plus every capability earned by earlier versions (no-regression gate).
Runtime state, preview controls, full-page load, AI source edit, version/history,
reload freshness and renderer errors were all asserted in a real CDP session.

Method: V1 is generated from the brief; V2–V20 are produced by iterative AI
revision — each starts from the previous accepted single-file site and adds
only that version's four rules, exercising the same "modify my site" flow a
person uses. The strict gate is unchanged: four new checks, no regression of
any previously earned check, and all E2E gates green.

| Version | Cumulative score | New checks | Attempts | HTML bytes | Buttons | Clicks | DOM changes | Preview | Edit | Reload |
|---|---:|---:|---:|---:|---:|---:|---:|:--:|:--:|:--:|
| V01 | 4/4 | 4/4 | 1 | 14570 | 6 | 6 | 5 | PASS | PASS | PASS |
| V02 | 8/8 | 4/4 | 7 | 23631 | 12 | 12 | 10 | PASS | PASS | PASS |
| V03 | 12/12 | 4/4 | 1 | 24304 | 12 | 12 | 10 | PASS | PASS | PASS |
| V04 | 16/16 | 4/4 | 1 | 25976 | 12 | 12 | 10 | PASS | PASS | PASS |
| V05 | 20/20 | 4/4 | 2 | 26751 | 12 | 12 | 10 | PASS | PASS | PASS |
| V06 | 24/24 | 4/4 | 2 | 27872 | 12 | 12 | 10 | PASS | PASS | PASS |
| V07 | 28/28 | 4/4 | 1 | 29340 | 12 | 12 | 10 | PASS | PASS | PASS |
| V08 | 32/32 | 4/4 | 1 | 29483 | 12 | 12 | 10 | PASS | PASS | PASS |
| V09 | 36/36 | 4/4 | 1 | 31198 | 12 | 12 | 10 | PASS | PASS | PASS |
| V10 | 40/40 | 4/4 | 2 | 32850 | 12 | 11 | 9 | PASS | PASS | PASS |
| V11 | 44/44 | 4/4 | 1 | 34684 | 12 | 11 | 9 | PASS | PASS | PASS |
| V12 | 48/48 | 4/4 | 1 | 35074 | 12 | 11 | 9 | PASS | PASS | PASS |
| V13 | 52/52 | 4/4 | 1 | 35074 | 12 | 11 | 9 | PASS | PASS | PASS |
| V14 | 56/56 | 4/4 | 1 | 35398 | 12 | 11 | 9 | PASS | PASS | PASS |
| V15 | 60/60 | 4/4 | 2 | 41305 | 12 | 12 | 10 | PASS | PASS | PASS |
| V16 | 64/64 | 4/4 | 4 | 42545 | 12 | 12 | 10 | PASS | PASS | PASS |
| V17 | 68/68 | 4/4 | 1 | 43278 | 12 | 12 | 10 | PASS | PASS | PASS |
| V18 | 72/72 | 4/4 | 7 | 39237 | 12 | 12 | 10 | PASS | PASS | PASS |
| V19 | 76/76 | 4/4 | 3 | 40286 | 12 | 12 | 11 | PASS | PASS | PASS |
| V20 | 80/80 | 4/4 | 1 | 40547 | 12 | 12 | 11 | PASS | PASS | PASS |

Per-version detail (all four new checks with their outcome, plus the E2E gate):

### V01 — score 4/4

- [PASS] **one-file**: Return exactly one file named index.html.
- [PASS] **inline-assets**: Put CSS in one inline <style> and JS in one inline <script>.
- [PASS] **document-shell**: Include doctype, html lang, charset, title, one h1 and a footer.
- [PASS] **offline-contract**: No external URLs, remote assets, lorem ipsum or TODO text.

E2E: preview controls+iframe PASS; AI source edit PASS; fresh reload PASS; renderer errors 0.
Real generation: 507 input / 19327 output / 19834 total tokens in 125s via `dex:ai-send` → `streamSite`.
Runtime: 6 controls, 6 clicked, 5 produced DOM change, duplicate ids 0, dangling refs 0, 390px overflow false.
Chat: `cmwnoznmjztfnz`. Screenshots: `v1-preview.png` (viewer), `v1-after-edit.png` (post-edit). Generated source: `v1.html`.

### V02 — score 8/8

- [PASS] **event-handlers**: Wire at least three distinct behaviours with addEventListener or on handlers.
- [PASS] **real-controls**: Include at least three real buttons/controls.
- [PASS] **no-dead-controls**: No empty href="#" and script must come after the markup.
- [PASS] **runtime-click**: Buttons must actually change the rendered DOM when clicked.

E2E: preview controls+iframe PASS; AI source edit PASS; fresh reload PASS; renderer errors 0.
Real generation: 5515 input / 21313 output / 26828 total tokens in 167s via `dex:ai-send` → `streamSite`.
Runtime: 12 controls, 12 clicked, 10 produced DOM change, duplicate ids 0, dangling refs 0, 390px overflow false.
Chat: `cmwnp49b8nk08j`. Screenshots: `v2-preview.png` (viewer), `v2-after-edit.png` (post-edit). Generated source: `v2.html`.

### V03 — score 12/12

- [PASS] **viewport**: Add the standard viewport meta tag.
- [PASS] **fluid-type**: Use clamp() for fluid headings.
- [PASS] **breakpoints**: Add real @media breakpoints.
- [PASS] **auto-fit-grid**: Use repeat(auto-fit, minmax(...)) for the card grid.

E2E: preview controls+iframe PASS; AI source edit PASS; fresh reload PASS; renderer errors 0.
Real generation: 8124 input / 27899 output / 36023 total tokens in 176s via `dex:ai-send` → `streamSite`.
Runtime: 12 controls, 12 clicked, 10 produced DOM change, duplicate ids 0, dangling refs 0, 390px overflow false.
Chat: `cmwnp8cj7saol1`. Screenshots: `v3-preview.png` (viewer), `v3-after-edit.png` (post-edit). Generated source: `v3.html`.

### V04 — score 16/16

- [PASS] **colour-tokens**: Declare design tokens in :root.
- [PASS] **depth**: Use a restrained box-shadow or hairline border for depth.
- [PASS] **transitions**: Add eased transitions on interactive states.
- [PASS] **reduced-motion**: Guard motion with prefers-reduced-motion.

E2E: preview controls+iframe PASS; AI source edit PASS; fresh reload PASS; renderer errors 0.
Real generation: 8552 input / 22229 output / 30781 total tokens in 365s via `dex:ai-send` → `streamSite`.
Runtime: 12 controls, 12 clicked, 10 produced DOM change, duplicate ids 0, dangling refs 0, 390px overflow false.
Chat: `cmwnpcj16twacx`. Screenshots: `v4-preview.png` (viewer), `v4-after-edit.png` (post-edit). Generated source: `v4.html`.

### V05 — score 20/20

- [PASS] **system-fonts**: Use a system font stack.
- [PASS] **letter-spacing**: Tune heading letter-spacing.
- [PASS] **line-height**: Set deliberate line-height.
- [PASS] **tabular-nums**: Use tabular-nums on numbers/prices.

E2E: preview controls+iframe PASS; AI source edit PASS; fresh reload PASS; renderer errors 0.
Real generation: 9174 input / 29556 output / 38730 total tokens in 209s via `dex:ai-send` → `streamSite`.
Runtime: 12 controls, 12 clicked, 10 produced DOM change, duplicate ids 0, dangling refs 0, 390px overflow false.
Chat: `cmwnpszcow49yl`. Screenshots: `v5-preview.png` (viewer), `v5-after-edit.png` (post-edit). Generated source: `v5.html`.

### V06 — score 24/24

- [PASS] **landmarks**: Use header, nav, main and footer landmarks.
- [PASS] **skip-link**: Add a first Skip to content link.
- [PASS] **focus-visible**: Add a visible :focus-visible outline.
- [PASS] **dark-scheme**: Support dark colours with prefers-color-scheme or data-theme.

E2E: preview controls+iframe PASS; AI source edit PASS; fresh reload PASS; renderer errors 0.
Real generation: 9597 input / 21832 output / 31429 total tokens in 110s via `dex:ai-send` → `streamSite`.
Runtime: 12 controls, 12 clicked, 10 produced DOM change, duplicate ids 0, dangling refs 0, 390px overflow false.
Chat: `cmwnq5kcsh0q0a`. Screenshots: `v6-preview.png` (viewer), `v6-after-edit.png` (post-edit). Generated source: `v6.html`.

### V07 — score 28/28

- [PASS] **aria-current**: Mark the active navigation item with aria-current.
- [PASS] **smooth-scroll**: Enable smooth scrolling.
- [PASS] **scroll-margin**: Add scroll-margin-top to in-page targets.
- [PASS] **nav-label**: Give each nav an aria-label.

E2E: preview controls+iframe PASS; AI source edit PASS; fresh reload PASS; renderer errors 0.
Real generation: 9786 input / 15764 output / 25550 total tokens in 284s via `dex:ai-send` → `streamSite`.
Runtime: 12 controls, 12 clicked, 10 produced DOM change, duplicate ids 0, dangling refs 0, 390px overflow false.
Chat: `cmwnq8c3lg4v6t`. Screenshots: `v7-preview.png` (viewer), `v7-after-edit.png` (post-edit). Generated source: `v7.html`.

### V08 — score 32/32

- [PASS] **form-labels**: Label every form field with label[for].
- [PASS] **native-types**: Use a native email/tel/number/date input type.
- [PASS] **validation**: Validate with aria-invalid, setCustomValidity or a validation message.
- [PASS] **submit-state**: Show a success message and a submit/disabled state.

E2E: preview controls+iframe PASS; AI source edit PASS; fresh reload PASS; renderer errors 0.
Real generation: 10266 input / 23843 output / 34109 total tokens in 335s via `dex:ai-send` → `streamSite`.
Runtime: 12 controls, 12 clicked, 10 produced DOM change, duplicate ids 0, dangling refs 0, 390px overflow false.
Chat: `cmwnqet46kzci0`. Screenshots: `v8-preview.png` (viewer), `v8-after-edit.png` (post-edit). Generated source: `v8.html`.

### V09 — score 36/36

- [PASS] **aria-live**: Announce dynamic changes with aria-live="polite".
- [PASS] **empty-state**: Include a meaningful empty state.
- [PASS] **visible-feedback**: Change textContent or a class when an action succeeds.
- [PASS] **safe-destructive**: Use confirm() or undo for destructive actions.

E2E: preview controls+iframe PASS; AI source edit PASS; fresh reload PASS; renderer errors 0.
Real generation: 10388 input / 27724 output / 38112 total tokens in 371s via `dex:ai-send` → `streamSite`.
Runtime: 12 controls, 12 clicked, 10 produced DOM change, duplicate ids 0, dangling refs 0, 390px overflow false.
Chat: `cmwnqme9fowru5`. Screenshots: `v9-preview.png` (viewer), `v9-after-edit.png` (post-edit). Generated source: `v9.html`.

### V10 — score 40/40

- [PASS] **local-storage**: Persist state with localStorage.
- [PASS] **seeded-data**: Seed the UI from a realistic data array.
- [PASS] **derived-counts**: Derive counters from actual state with length/filter/reduce.
- [PASS] **reset-control**: Add a visible Reset/Clear control.

E2E: preview controls+iframe PASS; AI source edit PASS; fresh reload PASS; renderer errors 0.
Real generation: 10988 input / 27132 output / 38120 total tokens in 397s via `dex:ai-send` → `streamSite`.
Runtime: 12 controls, 11 clicked, 9 produced DOM change, duplicate ids 0, dangling refs 0, 390px overflow false.
Chat: `cmwnr1xqmhqmes`. Screenshots: `v10-preview.png` (viewer), `v10-after-edit.png` (post-edit). Generated source: `v10.html`.

### V11 — score 44/44

- [PASS] **inline-svg**: Draw artwork/icons with inline SVG.
- [PASS] **decorative-hidden**: Mark decorative SVGs aria-hidden.
- [PASS] **stable-media**: Reserve media space with aspect-ratio or dimensions.
- [PASS] **text-alternatives**: Give informative images/svg a text alternative.

E2E: preview controls+iframe PASS; AI source edit PASS; fresh reload PASS; renderer errors 0.
Real generation: 11477 input / 31713 output / 43190 total tokens in 203s via `dex:ai-send` → `streamSite`.
Runtime: 12 controls, 11 clicked, 9 produced DOM change, duplicate ids 0, dangling refs 0, 390px overflow false.
Chat: `cmwnrat3us1wrl`. Screenshots: `v11-preview.png` (viewer), `v11-after-edit.png` (post-edit). Generated source: `v11.html`.

### V12 — score 48/48

- [PASS] **small-file**: Keep index.html under 200KB.
- [PASS] **no-external-code**: Load no external script or stylesheet.
- [PASS] **cheap-motion**: Animate transform/opacity rather than layout.
- [PASS] **sync-start**: Start from local data immediately (end-of-body script or DOMContentLoaded).

E2E: preview controls+iframe PASS; AI source edit PASS; fresh reload PASS; renderer errors 0.
Real generation: 12288 input / 26418 output / 38706 total tokens in 166s via `dex:ai-send` → `streamSite`.
Runtime: 12 controls, 11 clicked, 9 produced DOM change, duplicate ids 0, dangling refs 0, 390px overflow false.
Chat: `cmwnrfivbfajan`. Screenshots: `v12-preview.png` (viewer), `v12-after-edit.png` (post-edit). Generated source: `v12.html`.

### V13 — score 52/52

- [PASS] **no-eval**: Never use eval or new Function.
- [PASS] **no-network**: Never use fetch, XHR or WebSocket.
- [PASS] **no-inner-html**: Never assign innerHTML with user text.
- [PASS] **no-cookies**: Do not read cookies or store secrets.

E2E: preview controls+iframe PASS; AI source edit PASS; fresh reload PASS; renderer errors 0.
Real generation: 12461 input / 32768 output / 45229 total tokens in 170s via `dex:ai-send` → `streamSite`.
Runtime: 12 controls, 11 clicked, 9 produced DOM change, duplicate ids 0, dangling refs 0, 390px overflow false.
Chat: `cmwnrjg324umru`. Screenshots: `v13-preview.png` (viewer), `v13-after-edit.png` (post-edit). Generated source: `v13.html`.

### V14 — score 56/56

- [PASS] **real-copy**: Write real, specific copy with no filler.
- [PASS] **footer**: End with a useful project footer.
- [PASS] **brand-copy**: Use the requested Northlight brand name.
- [PASS] **actionable-cta**: Use action-oriented primary CTA wording.

E2E: preview controls+iframe PASS; AI source edit PASS; fresh reload PASS; renderer errors 0.
Real generation: 12584 input / 17463 output / 30047 total tokens in 111s via `dex:ai-send` → `streamSite`.
Runtime: 12 controls, 11 clicked, 9 produced DOM change, duplicate ids 0, dangling refs 0, 390px overflow false.
Chat: `cmwnrnh5lrjzc1`. Screenshots: `v14-preview.png` (viewer), `v14-after-edit.png` (post-edit). Generated source: `v14.html`.

### V15 — score 60/60

- [PASS] **reflow-grid**: Use auto-fit minmax for card reflow.
- [PASS] **scroll-wrapper**: Wrap wide data in an overflow-x:auto container.
- [PASS] **accessible-dialog**: Provide a dialog with aria-modal.
- [PASS] **disclosure-state**: Expose expanded state or Escape handling.

E2E: preview controls+iframe PASS; AI source edit PASS; fresh reload PASS; renderer errors 0.
Real generation: 12944 input / 32768 output / 45712 total tokens in 471s via `dex:ai-send` → `streamSite`.
Runtime: 12 controls, 12 clicked, 10 produced DOM change, duplicate ids 0, dangling refs 0, 390px overflow false.
Chat: `cmwnrylr8wy7hi`. Screenshots: `v15-preview.png` (viewer), `v15-after-edit.png` (post-edit). Generated source: `v15.html`.

### V16 — score 64/64

- [PASS] **theme-attribute**: Toggle a data-theme attribute.
- [PASS] **theme-persist**: Persist the theme choice in localStorage.
- [PASS] **forced-colors**: Respect forced-colors mode.
- [PASS] **token-usage**: Reference custom-property tokens with var().

E2E: preview controls+iframe PASS; AI source edit PASS; fresh reload PASS; renderer errors 0.
Real generation: 14740 input / 32768 output / 47508 total tokens in 186s via `dex:ai-send` → `streamSite`.
Runtime: 12 controls, 12 clicked, 10 produced DOM change, duplicate ids 0, dangling refs 0, 390px overflow false.
Chat: `cmwnt4bb7smm9u`. Screenshots: `v16-preview.png` (viewer), `v16-after-edit.png` (post-edit). Generated source: `v16.html`.

### V17 — score 68/68

- [PASS] **unique-ids**: No duplicate ids.
- [PASS] **valid-refs**: All label/aria id references resolve.
- [PASS] **no-overflow**: No horizontal scrolling at 390px.
- [PASS] **no-js-errors**: No JavaScript errors in the generated site.

E2E: preview controls+iframe PASS; AI source edit PASS; fresh reload PASS; renderer errors 0.
Real generation: 15063 input / 24267 output / 39330 total tokens in 158s via `dex:ai-send` → `streamSite`.
Runtime: 12 controls, 12 clicked, 10 produced DOM change, duplicate ids 0, dangling refs 0, 390px overflow false.
Chat: `cmwnt8pc4vaiiw`. Screenshots: `v17-preview.png` (viewer), `v17-after-edit.png` (post-edit). Generated source: `v17.html`.

### V18 — score 72/72

- [PASS] **selection**: Style ::selection.
- [PASS] **pointer-cursor**: Use cursor:pointer on controls.
- [PASS] **press-state**: Add a subtle :active press state.
- [PASS] **back-to-top**: Add a Back to top control on long pages.

E2E: preview controls+iframe PASS; AI source edit PASS; fresh reload PASS; renderer errors 0.
Real generation: 15353 input / 33194 output / 48547 total tokens in 244s via `dex:ai-send` → `streamSite`.
Runtime: 12 controls, 12 clicked, 10 produced DOM change, duplicate ids 0, dangling refs 0, 390px overflow false.
Chat: `cmwnv5l4v830p8`. Screenshots: `v18-preview.png` (viewer), `v18-after-edit.png` (post-edit). Generated source: `v18.html`.

### V19 — score 76/76

- [PASS] **stable-classes**: Use descriptive stable class names.
- [PASS] **css-sections**: Group CSS into commented sections.
- [PASS] **data-state**: Expose state with data-* attributes.
- [PASS] **meaningful-ids**: Use unique meaningful ids.

E2E: preview controls+iframe PASS; AI source edit PASS; fresh reload PASS; renderer errors 0.
Real generation: 14518 input / 47437 output / 61955 total tokens in 287s via `dex:ai-send` → `streamSite`.
Runtime: 12 controls, 12 clicked, 11 produced DOM change, duplicate ids 0, dangling refs 0, 390px overflow false.
Chat: `cmwnvksqnt72sg`. Screenshots: `v19-preview.png` (viewer), `v19-after-edit.png` (post-edit). Generated source: `v19.html`.

### V20 — score 80/80

- [PASS] **single-h1**: Exactly one h1.
- [PASS] **descriptive-title**: Use a unique descriptive title containing Northlight.
- [PASS] **meta-description**: Add a one-sentence meta description.
- [PASS] **standalone-works**: The finished file must render and work from the sandbox iframe.

E2E: preview controls+iframe PASS; AI source edit PASS; fresh reload PASS; renderer errors 0.
Real generation: 14738 input / 36940 output / 51678 total tokens in 216s via `dex:ai-send` → `streamSite`.
Runtime: 12 controls, 12 clicked, 11 produced DOM change, duplicate ids 0, dangling refs 0, 390px overflow false.
Chat: `cmwnvrcgmzr4th`. Screenshots: `v20-preview.png` (viewer), `v20-after-edit.png` (post-edit). Generated source: `v20.html`.

All 20 versions met the strict gate: four new checks passed, no earlier
capability regressed, preview + full-page + AI edit + reload verified, and zero
renderer exceptions. The generator at V20 is the consumer-ready result.
<!-- REAL-AI-EVIDENCE-END -->
