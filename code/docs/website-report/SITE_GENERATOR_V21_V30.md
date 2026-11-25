# Website generator — versions V21–V30 (combined V31–V40)

Scope: the ten appended **website-generator** tiers V21–V30, their four rules
each, and the real-AI/E2E gate that must prove them. This is a continuation of
[SITE_GENERATOR_V1_V20.md](SITE_GENERATOR_V1_V20.md), not a rewrite of it. V1–V20
rules remain byte-stable; V21–V30 are appended contiguously on top of them.

## Authoritative spec and tier map

The authoritative rules live in `src/main/site-version-spec.js`. It exports
`SITE_GENERATOR_VERSION` (= 30), `SITE_VERSION_SPEC`, `promptRulesThrough()` and
`focusThrough()`. Each tier contributes exactly four cumulative rules that are
fed to the single-turn site writer; the same four are what the E2E harness
scores. The earlier program's prompt/skill/executor and preview plumbing are
unchanged.

The combined programme is described in [V31_V50_PLAN.md](V31_V50_PLAN.md) and
manifested in `src/main/polish-version-spec.js`. Its mapping is fixed and
reversible (`SITE_COMBINED_OFFSET = 10`):

| Site tier | Combined tier | Focus |
| --- | --- | --- |
| V21 | V31 | Online-sourced artwork, inlined offline |
| V22 | V32 | Modern CSS with safe fallbacks |
| V23 | V33 | Complete runtime control coverage |
| V24 | V34 | View transitions with reduced-motion fallback |
| V25 | V35 | Print stylesheet |
| V26 | V36 | Storage fallback and resilience |
| V27 | V37 | Advanced JavaScript state |
| V28 | V38 | Runtime accessibility and focus checks |
| V29 | V39 | Performance budgets |
| V30 | V40 | Final self-contained release gate |

In other words: **site V21–V30 are combined V31–V40**. The report half of the
combined program is V41–V50 (report V11–V20) and is documented separately in
[REPORT_GENERATOR_V11_V20.md](REPORT_GENERATOR_V11_V20.md). The combined source
of truth for focus titles and the four acceptance summaries per tier is
`polish-version-spec.js`; the exact per-rule wording below is from
`site-version-spec.js`.

## Online-source-as-generation-time-material policy (site V21–V30)

Online material is permitted **only as generation-time source material**. It is
never a runtime dependency of the delivered page:

1. **Narrow research trigger.** Research is attempted only when the brief
   benefits from real imagery or design references. It is not a blanket step for
   every generation.
2. **Binary fetch adapter.** The pure `site-research-assets` module extracts
   candidate raster URLs from the research text and calls a `fetchBinary(url)`
   adapter injected by the main process (network I/O stays out of the pure
   module). Candidates are gated by URL safety, allowed raster content type,
   size and a fetch timeout; SVG and other formats are refused. Placeholder ids
   such as `dexref1` in the model output are replaced with inlined data URLs
   after generation.
3. **Data-URL / inline SVG / CSS inlining.** Every chosen asset is embedded in
   `index.html` as a base64 data URL or as inline SVG/CSS artwork. The delivered
   artifact remains exactly one self-contained file.
4. **Bounded caps.** 120KB per inlined raster data URL and 400KB total inlined
   asset payload (with the implementation enforcing at least as tight an
   internal ceiling). Oversized candidates are resized, compressed or replaced
   with inline SVG rather than shipped.
5. **Visible attribution.** Every externally sourced image or design reference
   gets one compact visible credit line (source name or host plus licence) in
   the footer or directly beneath the artwork. External work is never presented
   as original.
6. **Fail-closed remote-reference removal.** The final HTML is scanned for
   `http(s)` URLs in `src`, `href`, `srcset`, `url()`, `@import`, `fetch` and
   WebSocket usage, and any that remain are removed/replaced. If an asset cannot
   be safely inlined, it is replaced with inline SVG — a remote reference never
   survives into the emitted file.
7. **Exactly one `index.html` on direct generation.** `files[]` still contains
   one object with path `index.html` and no other files. The single-file source
   edit path writes an HTML-only save back into that sole file; legacy
   multi-file sites are still normalized/accepted only when they provide an
   explicit `files` list. The one-file contract is not weakened by inlining.
8. **No runtime network resources.** Zero `fetch`, XHR, WebSocket or `import`
   calls and zero external `src`/`href` values. First paint uses only markup,
   CSS and inline JS already in the file; the page is opened with the network
   disconnected as part of the final gate.
9. **No CSP relaxation.** Offline operation is achieved by inlining and removing
   remote references — never by adding remote origins to a Content-Security-
   Policy or otherwise permitting network loads in the artifact sandbox.

Reports are unaffected by this policy: they remain structured JSON blocks with
no HTML, CSS, scripts or network-loaded assets.

## End-to-end (E2E) gate (CDP-driven, throwaway profile, real provisioned NIM model)

For every version the harness proves, in a live CDP session:

1. create the chat and site artifact through real IPC
   (`dex:ai-chat-create`, `dex:ai-chat-append`, then real generation via
   `dex:ai-send` → `streamSite`);
2. open the full-page artifact tab (`dex:new-tab`) and assert it loads;
3. assert the stored artifact is ONE `index.html` with inline `<style>`/`<script>`
   and zero external URLs;
4. drive an AI-style source edit (`dex:ai-artifact-source-save`) and assert
   version/history/content;
5. reload the full-page viewer and assert the preview iframe is reloaded with
   fresh content;
6. assert no renderer JS exceptions.

The per-tier proof is the strict rule gate: **four NEW checks for that version,
plus every cumulative check through that version (no-regression)**, together
with the preview / edit / reload gates above. A tier is not accepted unless all
four new checks pass, no previously earned check id regresses, and the
cumulative score is strictly higher than the previous tier.

## Real-AI/E2E harness contract

The real-AI run (the only authoritative proof; rule-level assertions are
secondary) follows this contract:

- **Real NIM in a throwaway profile.** A fresh, disposable browser profile with
  the provisioned real model key — never a mock model and never the user's main
  profile.
- **Version override temp files.** Before each generation the harness writes
  the cumulative tier to the OS temp override (`%TEMP%\dex-site-version`), read
  by `site-generator-versions.js`; it is cleaned up in `finally`. Normal users
  always receive the newest tier (V30). Older tiers can be selected the same way
  for regression runs.
- **Live CDP IPC.** All actions go through the running app over CDP (`CDP_PORT`):
  chat create/append, `dex:ai-send` → `streamSite` generation, `dex:new-tab` full-
  page load, `dex:ai-artifact-source-save` AI-style edit, and readback of the
  stored artifact. Assertion is on real IPC results and DOM state, not on
  fixtures.
- **Per-version scoring.** Exactly four new checks per version (check ids
  `SV21-C1`…`SV30-C4`, from the combined manifest), every cumulative check
  through that version, plus preview / edit / reload and renderer-error checks.
- **Separate evidence dirs.** Site evidence is written to its own dedicated
  site-version directory under `%TEMP%\opencode\`, distinct from the report
  ladder's `real-report-versions\` directory, so a site score can never be
  mistaken for a report score. JSON logs and generated sources are primary;
  screenshots are secondary.

## Versions and their exact four rules

The rules below are reproduced verbatim from `SITE_VERSION_SPEC`. Each tier is
cumulative: it inherits V1–V20 plus every earlier rule in this ladder. The
`Acceptance` lines quote the four summaries/check ids from
`polish-version-spec.js` and the [plan](V31_V50_PLAN.md); they are the gate's
scoring contract, not a claim of result.

### Site V21 — combined V31 — Online-sourced artwork, inlined offline

1. When the brief benefits from real imagery or design references, fetch or derive candidate assets from the web while generating, then embed the chosen ones in index.html as base64 data URLs or inline SVG/CSS artwork; never leave a remote URL as the delivered src or href.
2. Keep each inlined raster data URL under 120KB and the total inlined asset payload under 400KB; resize, compress or replace an oversized photo with inline SVG instead of shipping it.
3. Credit every externally sourced image or design reference in a compact visible attribution line (source name or host plus licence) in the footer or directly beneath the artwork; never present external work as original.
4. After inlining, scan the final document for http(s) URLs in src, href, srcset, url(), @import, fetch or WebSocket usage and remove any that remain so the file is fully offline.

Acceptance (combined V31; `SV21-C1`…`SV21-C4`): Fetch web imagery and design references during generation, then inline chosen assets as base64 data URLs or inline SVG/CSS. · Cap each inlined raster asset at 120KB and the total inlined payload at 400KB; compress or replace oversized assets. · Credit externally sourced artwork in a compact visible attribution line with source name or host and licence. · Scan the final HTML for remote src/href/url()/fetch references and remove them so the delivered file stays offline. Gate: **pending**.

### Site V22 — combined V32 — Modern CSS with safe fallbacks

1. Use a container query with @container and container-type for at least one card or list component so it reflows from its own width, and keep a viewport @media fallback for engines without container query support.
2. Apply text-wrap: balance to headings and text-wrap: pretty to short paragraphs inside @supports (text-wrap: balance), leaving ordinary wrapping as the fallback.
3. Use :has() for at least one real parent-state style, such as a card containing a checked input, behind @supports selector(:has(*)) with a class-based fallback that works without :has().
4. Prefer logical properties (padding-inline, margin-block, inset-inline) for layout, and add @property or color-mix() only inside @supports with a plain-colour fallback so no feature is required for legibility.

Acceptance (combined V32; `SV22-C1`…`SV22-C4`): Reflow at least one component with a container query and keep a viewport media-query fallback. · Use text-wrap balance and pretty behind @supports with ordinary wrapping as the fallback. · Use :has() for a real parent-state style behind @supports selector(:has(*)) with a class fallback. · Prefer logical properties and gate @property/color-mix() behind @supports with plain-colour fallbacks. Gate: **pending**.

### Site V23 — combined V33 — Complete runtime control coverage

1. Before emitting, enumerate every button, role=button element, clickable card and action link; each one must have a registered handler or be removed.
2. Implement repeated or dynamic controls with a single delegated listener on a stable parent using event.target.closest(), so items added later work without rebinding.
3. Give every custom control keyboard activation with native buttons for actions or role=button plus tabindex=0 and Enter/Space handlers for non-native elements; no action may require a mouse.
4. Add one fresh item at runtime through the delegated path and confirm the new control changes visible state (label, count or aria-pressed) without a page reload.

Acceptance (combined V33; `SV23-C1`…`SV23-C4`): Enumerate every button, role=button and action link before emitting; wire it or remove it. · Use one delegated listener with target.closest() so dynamically added controls work without rebinding. · Support Enter/Space on custom controls and native buttons for actions; no mouse-only activation. · Add a fresh item at runtime and confirm the new control changes visible state without a reload. Gate: **pending**.

### Site V24 — combined V34 — View transitions with reduced-motion fallback

1. Wrap content-swapping DOM updates (tabs, filters, theme, detail views) in document.startViewTransition when available and give each changed region a unique view-transition-name.
2. Keep ::view-transition-old and ::view-transition-new keyframes at 250ms or less and animate only opacity and transform.
3. Guard every transition with typeof document.startViewTransition checks and @supports (view-transition-name: none), and apply the same final DOM directly when the API is missing.
4. Skip startViewTransition entirely under @media (prefers-reduced-motion: reduce) and confirm the final state appears immediately with no animation.

Acceptance (combined V34; `SV24-C1`…`SV24-C4`): Wrap content-swapping updates in document.startViewTransition with unique view-transition-name values. · Keep view-transition keyframes at 250ms or less and animate opacity/transform only. · Guard the API with typeof checks and @supports, updating the DOM directly when unavailable. · Skip transitions entirely under prefers-reduced-motion and confirm the final state appears with no animation. Gate: **pending**.

### Site V25 — combined V35 — Print stylesheet

1. Include a dedicated @media print block that hides navigation, controls, overlays, back-to-top and decorative artwork while keeping the main content and the single h1.
2. Use a single-column printed layout in mm/pt units, remove shadows and dark backgrounds, and force black-on-white text with print-color-adjust: exact only where a colour carries meaning.
3. Expand accordions, details and tabs for print and add a short print-only source line for inlined externally sourced artwork; do not print raw URLs for every in-page nav link.
4. Verify the printed page has no clipped cards, no split buttons and no empty header or footer bands when printed from the standalone file.

Acceptance (combined V35; `SV25-C1`…`SV25-C4`): Provide @media print that hides navigation, controls, overlays and decorative art while keeping main content and one h1. · Use a single-column black-on-white print layout with no shadows or dark backgrounds. · Expand accordions and details and print a short source line for inlined external artwork. · Verify no clipped cards, split buttons or empty header/footer bands in printed output. Gate: **pending**.

### Site V26 — combined V36 — Storage fallback and resilience

1. Wrap every localStorage read and write in try/catch and fall back to an in-memory state object when storage is blocked, unavailable or throws QuotaExceededError.
2. Validate restored state against its expected shape and types before applying it; discard corrupt or stale values and reseed defaults instead of crashing.
3. Expose a visible storage-status hint such as "Preferences saved" or "Session only" through an aria-live region when persistence is unavailable so the user is not misled.
4. Confirm that with storage disabled the document opened from disk still supports every interaction for the session and Reset restores seeded data without exceptions.

Acceptance (combined V36; `SV26-C1`…`SV26-C4`): Wrap localStorage reads and writes in try/catch with an in-memory fallback when blocked or full. · Validate restored state shape and reseed defaults when data is corrupt or stale. · Show a visible aria-live storage-status hint when persistence is unavailable. · Confirm all interactions and Reset work with storage disabled from a disk-opened file. Gate: **pending**.

### Site V27 — combined V37 — Advanced JavaScript state

1. Model interactive state in one plain object or small Map as the single source of truth and render from it through one pure render function instead of mutating scattered DOM snippets.
2. Implement undo for at least one mutating or destructive action with a single-level snapshot, a visible Undo control and an aria-live announcement.
3. Derive every counter, badge and empty-state visibility from state in the same render pass; no unrelated handler may write a derived value.
4. Keep handlers idempotent so repeated clicks on a filter or sort control produce the same DOM and never duplicate listeners or list items.

Acceptance (combined V37; `SV27-C1`…`SV27-C4`): Keep one state object or Map as the source of truth and render through a single pure render function. · Provide single-level undo for a mutating action with a visible Undo control and announcement. · Derive all counters, badges and empty states in the same render pass. · Make handlers idempotent so repeated clicks never duplicate listeners or items. Gate: **pending**.

### Site V28 — combined V38 — Runtime accessibility and focus checks

1. Run a compact startup self-check that asserts every button has an accessible name, every img has alt text, every label[for]/aria-labelledby/aria-controls target exists and ids are unique, while logging no errors when valid.
2. Trap focus inside any open dialog or popover, move focus to its first labelled control on open and restore focus to the exact trigger on close.
3. Make custom controls reachable by Tab in DOM order and operable with Enter/Space, and verify the tab sequence never lands on a hidden or aria-hidden element.
4. Reflect dynamic state with aria-pressed, aria-expanded, aria-selected or aria-current as appropriate, announce material changes in an aria-live region and confirm with a keyboard-only walkthrough.

Acceptance (combined V38; `SV28-C1`…`SV28-C4`): Run a startup self-check for accessible names, alt text, unique ids and valid aria/id references. · Trap focus in open dialogs and popovers, focus the first labelled control and restore the exact trigger. · Keep Tab order in DOM order and skip hidden or aria-hidden elements. · Reflect state with aria-pressed/expanded/selected/current and announce material changes via aria-live. Gate: **pending**.

### Site V29 — combined V39 — Performance budgets

1. Keep the complete index.html at or under 250KB after inlined assets, with no single data URL above 120KB and no repeated inline style blocks.
2. Load no runtime network resource: zero fetch, XHR, WebSocket or import calls and zero external src or href values; first paint uses only markup, CSS and inline JS already in the file.
3. Use a single end-of-body script, batch DOM reads before writes and animate only transform and opacity after first paint.
4. Render all initial DOM synchronously from the end-of-body script before the first requestAnimationFrame following DOMContentLoaded, with no parser-blocking script earlier in the document.

Acceptance (combined V39; `SV29-C1`…`SV29-C4`): Keep index.html at or under 250KB with no data URL over 120KB and no repeated inline styles. · Issue zero runtime network requests: no fetch, XHR, WebSocket, import or external src/href. · Use one end-of-body script, batch DOM reads before writes and animate only transform/opacity. · Render all initial DOM synchronously before the first requestAnimationFrame after DOMContentLoaded. Gate: **pending**.

### Site V30 — combined V40 — Final self-contained release gate

1. Run a release-gate pass: files[] still contains exactly one object with path "index.html" and no other files, and the HTML parses with one h1, a title and a meta description.
2. Scan the final content for remote references (http(s), protocol-relative URLs, @import, absolute srcset URLs, fetch, WebSocket, import) and remove any that remain; all artwork is inline data URL, SVG or CSS.
3. Confirm every visible control has a working handler, every inlined external asset has attribution and every accessibility, keyboard, print and storage fallback from V21-V29 still holds after the last edit.
4. Verify the file opens directly from disk with no console errors and works with the network disconnected; only then emit the single fenced dex-artifact block.

Acceptance (combined V40; `SV30-C1`…`SV30-C4`): Confirm files[] holds exactly one index.html and the HTML parses with one h1, title and description. · Remove every remote URL or network primitive from the final content; all artwork is inline. · Re-verify handlers, attribution and every V21-V29 fallback after the last edit. · Open the file with the network disconnected and emit only when there are no console errors. This is the **terminal site gate**. Gate: **pending**.

## Evidence placeholder

No result is recorded here. The real-AI run log and the check-ID proof
(`SV21-C1`…`SV30-C4`, plus cumulative no-regression and preview/edit/reload
results) belong in [V31_V50_EVIDENCE.md](V31_V50_EVIDENCE.md), which is the run
tracker for the combined V31–V50 programme. Those rows are finalized only from
the actual gate results: a tier may be marked `PASS` there only when all four of
its check IDs and every cumulative gate are demonstrably true.

**Status of this ladder: gates still running. No version V21–V30 is claimed as
PASS in this document.** This file records the specification and the gate
contract only.
