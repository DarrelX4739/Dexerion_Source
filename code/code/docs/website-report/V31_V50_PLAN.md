# V31–V50 polish programme (site + report version specs)

Scope: `src/main/site-version-spec.js`, `src/main/site-generator-versions.js`,
`src/main/site-system-prompt.js`, `src/main/report-version-spec.js`,
`src/main/report-system-prompt.js`, and the combined manifest
`src/main/polish-version-spec.js`.

This programme extends the two existing version ladders by ten tiers each. It
does **not** rewrite any earlier rule: V1–V20 site rules and V1–V10 report rules
remain byte-stable, and the new tiers are appended contiguously.

- Site cap: **30** in both `site-version-spec.js` (derived from the array) and
  `site-generator-versions.js` (`SITE_GENERATOR_VERSION = 30`). Summaries exist
  for every tier, including V21–V30.
- Report cap: **20**, auto-derived from `REPORT_VERSION_SPEC.length`.
- Temporary override behaviour is preserved: `dex-site-version` and
  `dex-report-version` in the OS temp directory still select an older tier;
  normal users get the newest one.
- `report-system-prompt.js` already consumes `report-version-spec.js`, so the
  extended rules flow through it with no JSON-contract change.
- `polish-version-spec.js` maps combined V31–V50 to these source tiers and
  exports the manifest plus helpers for tests (`validatePolishSpec()` checks
  contiguity, four summaries per tier and reversible source mapping).

## Online-asset policy (site tiers only)

Online research is permitted as **source material**: the generator may fetch or
study real images and design references while composing the page. The delivered
artifact is still a single offline file:

1. Every chosen asset is embedded in `index.html` as a base64 data URL, inline
   SVG or CSS artwork. No remote `src`, `href`, `srcset`, `url()`, `@import`,
   `fetch`, WebSocket or second file at runtime.
2. Caps: **120KB per inlined raster data URL** and **400KB for the total
   inlined asset payload**. Oversized assets are compressed, resized or
   replaced with inline SVG.
3. Each externally sourced image or design reference gets one short visible
   attribution line (source name or host plus licence) in the footer or beside
   the artwork. External work is never claimed as original.
4. The final gate scans the emitted HTML for remote references and opens the
   file with the network disconnected. This does **not** weaken the V1/V20
   offline contract: `files[]` still contains exactly one `index.html`.
5. Reports are unaffected: they remain structured JSON blocks with no HTML,
   CSS, scripts or network-loaded assets.

## Primary MDN sources already researched

These references informed the modern-CSS and interaction rules; they are
research sources only and are not runtime dependencies of generated output.

- CSS container queries (`@container`, `container-type`) — https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_container_queries
- `text-wrap: balance` / `pretty` — https://developer.mozilla.org/en-US/docs/Web/CSS/text-wrap
- View Transitions API (`startViewTransition`, `::view-transition-*`) — https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API
- `@property` — https://developer.mozilla.org/en-US/docs/Web/CSS/@property
- Fullscreen API — https://developer.mozilla.org/en-US/docs/Web/API/Fullscreen_API
- Popover API — https://developer.mozilla.org/en-US/docs/Web/API/Popover_API
- `inert` — https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/inert

Supporting topics: `:has()` and `@supports selector()`, `color-mix()`, CSS
logical properties, `prefers-reduced-motion`, `@media print`, `dialog` focus
management and `aria-live`. Every one of these is used with a fallback; final
output remains offline and self-contained.

## Combined tier map (four improvements + gate each)

| Combined | Artifact | Source tier | Focus | Four improvements | Gate |
| --- | --- | --- | --- | --- | --- |
| V31 | Site | V21 | Online-sourced artwork, inlined offline | 1. Fetch web imagery/references during generation. 2. Inline chosen assets as data URL or inline SVG/CSS. 3. Cap 120KB per raster and 400KB total. 4. Visible source/licence attribution. | Final HTML has zero remote URLs; caps and attribution verified; file opens offline. |
| V32 | Site | V22 | Modern CSS with safe fallbacks | 1. Container query for a real component. 2. `text-wrap` balance/pretty behind `@supports`. 3. `:has()` parent style with class fallback. 4. Logical props plus gated `@property`/`color-mix()`. | Every modern feature has a legible fallback; no feature required for layout or contrast. |
| V33 | Site | V23 | Complete runtime control coverage | 1. Enumerate and wire every control. 2. One delegated listener with `closest()`. 3. Enter/Space on custom controls. 4. Runtime test with a newly added item. | Clicking every button/link changes state; new items work without rebinding. |
| V34 | Site | V24 | View transitions with reduced-motion fallback | 1. `startViewTransition` for content swaps. 2. 250ms opacity/transform keyframes. 3. API + `@supports` guards with direct DOM fallback. 4. Skip entirely under reduced motion. | Transitions work where supported; final state applies immediately when absent or reduced. |
| V35 | Site | V25 | Print stylesheet | 1. `@media print` hides chrome, keeps one h1. 2. Single-column black-on-white layout. 3. Expand disclosures and print source lines. 4. Check for clipped/split output. | Printed standalone file has no clipped cards, split buttons or empty header/footer bands. |
| V36 | Site | V26 | Storage fallback and resilience | 1. `try/catch` around localStorage with in-memory fallback. 2. Validate or reseed corrupt state. 3. Visible `aria-live` storage status. 4. Interactions work with storage disabled. | Disk-opened file works for the session and Reset restores seeded data without exceptions. |
| V37 | Site | V27 | Advanced JavaScript state | 1. Single state object/Map with pure render. 2. Visible single-level undo. 3. Derived counters/badges/empty states in one pass. 4. Idempotent handlers. | Repeated clicks never duplicate listeners/items; undo restores exact prior state. |
| V38 | Site | V28 | Runtime accessibility and focus checks | 1. Startup labels/alt/id/aria self-check. 2. Dialog focus trap and trigger restore. 3. Tab order skips hidden targets. 4. ARIA state plus live announcements. | Keyboard-only walkthrough passes with no console errors or duplicate ids. |
| V39 | Site | V29 | Performance budgets | 1. 250KB total / 120KB asset cap. 2. Zero runtime network requests. 3. One end-of-body script, batched reads. 4. Initial DOM before first `requestAnimationFrame`. | Size caps met; no external requests; first paint uses only inline markup/CSS/JS. |
| V40 | Site | V30 | Final self-contained release gate | 1. Exactly one `index.html`. 2. No remote references. 3. Re-verify handlers, attribution and V21–V29 fallbacks. 4. Disk + network-off check. | `files[]` holds one file; no console errors; all earlier site gates still pass. |
| V41 | Report | V11 | Chat/report prompt parity | 1. Trace every claim to brief or citation. 2. Preserve exact names/terms/numbers. 3. Restate the asked question verbatim. 4. No system rules or scratch reasoning. | Every block maps to a user-visible prompt line or real reference. |
| V42 | Report | V12 | Block-level revision preservation | 1. Self-contained blocks. 2. Fixed heading-to-block order. 3. Preserve metadata on text-only edits. 4. Standalone valid JSON per block. | A targeted patch changes one block only; JSON still parses after the edit. |
| V43 | Report | V13 | Search navigation 1/N | 1. Sequential 1/N markers. 2. N matches references. 3. Unique markers and consistent wording. 4. Ordered Search path note. | Every fraction resolves to a distinct real source and matching query. |
| V44 | Report | V14 | Panel dialog semantics and focus restore | 1. `role=dialog`, `aria-modal`, accessible name. 2. Focus in/trap/Escape/restore. 3. Background inert or aria-hidden. 4. Scroll and disclosure state restored. | Keyboard and screen-reader users cannot reach background content while a panel is open. |
| V45 | Report | V15 | Visible Copy and export status | 1. Copied confirmation ≥2s plus live region. 2. Format-named export result including failure. 3. Controls disabled during work. 4. Text/icon status, not colour alone. | Every Copy/export action ends in visible, accessible status text. |
| V46 | Report | V16 | Scroll preservation on restyle | 1. Keep scrollTop and active section. 2. Keep selection, disclosures, annotations. 3. Swap root tokens/classes, not DOM. 4. Announce style via aria-live. | Restyle never jumps to top, loses selection or moves focus. |
| V47 | Report | V17 | Annotation selection and status | 1. Anchor to explicit selected quote and blockId. 2. Active/pending state on quote and Notes. 3. Immediate highlight/list update and announcement. 4. Mark unresolved when quote vanishes. | Notes stay consistent with highlights after edits and revisions. |
| V48 | Report | V18 | Print and export polish | 1. Single-column with `break-inside: avoid`. 2. Hide viewer chrome, keep citations. 3. Expand interactive blocks. 4. Title-derived filename and intact links/tables. | Print and exported files are complete, readable and unclipped. |
| V49 | Report | V19 | Timeout and stale patch guard | 1. Increasing revision token. 2. Timeout with Retry status. 3. Re-read target block before patch. 4. No state change on rejection. | Late or stale patches never apply; document, scroll and panels are unchanged. |
| V50 | Report | V20 | Final consumer-readiness gate | 1. Complete coherent content. 2. JSON contract and metadata verified. 3. V11–V19 behaviours walked end to end. 4. Cold-open viewer check. | Answer-first reading, working controls, readable print and zero console errors. |

## Gate summary

A tier passes only when all four of its acceptance summaries are demonstrably
true and the cumulative gates of all lower tiers still hold. The two terminal
gates are V40 for sites (single offline `index.html`, inline-only artwork, no
runtime network, all fallbacks intact) and V50 for reports (stable JSON
contract, working viewer behaviours, clean print, no placeholders). The
combined manifest exposes `validatePolishSpec()`, `sourceFor()`,
`combinedVersionFor()` and `acceptanceSummariesThrough()` so a test can assert
this table without parsing the Markdown.

## Evidence gates and exact check-ID map

The run tracker is [V31_V50_EVIDENCE.md](V31_V50_EVIDENCE.md). It carries one
row per combined version, a status, and a place to paste the real-AI/E2E log.
Its check IDs are stable and derived from the four improvements in the table
above:

- Site V21–V30 (combined V31–V40) contribute **40 checks**:
  `SV<source-tier>-C1` … `SV<source-tier>-C4` for each source tier.
- Report V11–V20 (combined V41–V50) contribute **40 checks**:
  `RV<source-tier>-C1` … `RV<source-tier>-C4` for each source tier.
- `C1`–`C4` correspond, in order, to the four numbered improvements/gates in
  the combined tier map. No ID is reused across products.

| Combined | Product | Source tier | Exact check IDs | Evidence placeholder |
| --- | --- | --- | --- | --- |
| V31 | Site | V21 | `SV21-C1`, `SV21-C2`, `SV21-C3`, `SV21-C4` | `[V31 run log: TBD]` |
| V32 | Site | V22 | `SV22-C1`, `SV22-C2`, `SV22-C3`, `SV22-C4` | `[V32 run log: TBD]` |
| V33 | Site | V23 | `SV23-C1`, `SV23-C2`, `SV23-C3`, `SV23-C4` | `[V33 run log: TBD]` |
| V34 | Site | V24 | `SV24-C1`, `SV24-C2`, `SV24-C3`, `SV24-C4` | `[V34 run log: TBD]` |
| V35 | Site | V25 | `SV25-C1`, `SV25-C2`, `SV25-C3`, `SV25-C4` | `[V35 run log: TBD]` |
| V36 | Site | V26 | `SV26-C1`, `SV26-C2`, `SV26-C3`, `SV26-C4` | `[V36 run log: TBD]` |
| V37 | Site | V27 | `SV27-C1`, `SV27-C2`, `SV27-C3`, `SV27-C4` | `[V37 run log: TBD]` |
| V38 | Site | V28 | `SV28-C1`, `SV28-C2`, `SV28-C3`, `SV28-C4` | `[V38 run log: TBD]` |
| V39 | Site | V29 | `SV29-C1`, `SV29-C2`, `SV29-C3`, `SV29-C4` | `[V39 run log: TBD]` |
| V40 | Site | V30 | `SV30-C1`, `SV30-C2`, `SV30-C3`, `SV30-C4` | `[V40 run log: TBD]` |
| V41 | Report | V11 | `RV11-C1`, `RV11-C2`, `RV11-C3`, `RV11-C4` | `[V41 run log: TBD]` |
| V42 | Report | V12 | `RV12-C1`, `RV12-C2`, `RV12-C3`, `RV12-C4` | `[V42 run log: TBD]` |
| V43 | Report | V13 | `RV13-C1`, `RV13-C2`, `RV13-C3`, `RV13-C4` | `[V43 run log: TBD]` |
| V44 | Report | V14 | `RV14-C1`, `RV14-C2`, `RV14-C3`, `RV14-C4` | `[V44 run log: TBD]` |
| V45 | Report | V15 | `RV15-C1`, `RV15-C2`, `RV15-C3`, `RV15-C4` | `[V45 run log: TBD]` |
| V46 | Report | V16 | `RV16-C1`, `RV16-C2`, `RV16-C3`, `RV16-C4` | `[V46 run log: TBD]` |
| V47 | Report | V17 | `RV17-C1`, `RV17-C2`, `RV17-C3`, `RV17-C4` | `[V47 run log: TBD]` |
| V48 | Report | V18 | `RV18-C1`, `RV18-C2`, `RV18-C3`, `RV18-C4` | `[V48 run log: TBD]` |
| V49 | Report | V19 | `RV19-C1`, `RV19-C2`, `RV19-C3`, `RV19-C4` | `[V49 run log: TBD]` |
| V50 | Report | V20 | `RV20-C1`, `RV20-C2`, `RV20-C3`, `RV20-C4` | `[V50 run log: TBD]` |

### Automated gates added for this programme

These gates are intentionally split between a pure Node script (no Electron,
no Playwright, no `package.json` wiring) and focused E2E specs against the
existing local mock harness:

- `node code/build/scripts/test-polish-unit.js` — manifest/source-spec mapping,
  80-check ID space, asset caps, `site-research-assets` candidate/fetch/inliner
  policy, `site-quality`, `site-interactivity`, `site-policy` and ai-mock
  research fixtures.
- `code/build/e2e/polish-smoke.spec.js` — replaces the assertion-free
  `debug.spec.js`; proves boot, key seeding, real mock turn, stored chat.
- `code/build/e2e/site-offline-assets.spec.js` — online-source research via
  `DEX_SEARCH_BASE`, then one-file `index.html` with inline raster/SVG, visible
  credit, zero remote references and all asset caps.
- `code/build/e2e/site-runtime-controls.spec.js` — every control wired,
  delegated `closest()` handler, runtime-added item, Enter/Space, undo, form.
- `code/build/e2e/preview-controls.spec.js` — Phone/Tablet/Desktop, Expand,
  Exit, Reload, Console, Edit, site overlay Fullscreen and report preview
  parity/fullscreen/exit.
