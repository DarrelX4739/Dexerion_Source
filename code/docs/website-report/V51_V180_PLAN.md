# V51–V180 next-generation programmes (UI overhaul + debloat)

Scope: `src/main/nextgen-version-spec.js` is the single source of truth for two new,
contiguous product ladders:

- **V51–V130 — full UI overhaul** (`program: "ui-overhaul"`, 80 tiers, check IDs `UIV<version>-C1` … `UIV<version>-C4`).
- **V131–V180 — debloat** (`program: "debloat"`, 50 tiers, check IDs `DV<version>-C1` … `DV<version>-C4`).

This is a **new product ladder**, not a rewrite of the site/report generator
prompts. No site or report rule text, generator prompt, JSON contract or
artifact format is replaced. The new tiers are appended above the existing
ladders and consume the same product surfaces through the existing chrome/token
system and named resource budgets (`src/main/debloat-budgets.js`). The earlier
`assets/ui-v2.css` / `assets/ui-v2.js` overlay was evaluated but removed after
user review; the UI tiers now certify the previous chrome with the menu
surfaces kept fully functional.

## Byte stability and numbering

- Site generator: **V1–V30 unchanged** (`site-version-spec.js`,
  `site-generator-versions.js`, site rules and summaries).
- Report generator: **V1–V20 unchanged** (`report-version-spec.js`,
  `report-system-prompt.js`, report rules and JSON contract).
- Combined polish ladder: **V31–V50 unchanged** (`polish-version-spec.js`,
  its manifest, mapping helpers and all historical evidence markers).
- UI ladder: **V51–V130**, 80 tiers, four improvements and four stable check
  IDs per tier = **320 new UI checks**.
- Debloat ladder: **V131–V180**, 50 tiers, four improvements and four stable
  check IDs per tier = **200 new debloat checks**.
- Total new work: **130 tiers / 520 check IDs**
  (`validateNextGenSpec()` asserts contiguity, four rules, four IDs per tier,
  exact ID spelling and zero duplicates).
- Older-tier override files (for example `dex-site-version` /
  `dex-report-version`) keep their existing behaviour; the newest tier remains
  the default for normal users.

## Four improvements and checks per tier

**UI tiers (V51–V130).** Each tier contributes exactly four improvements,
whose check IDs `C1`–`C4` map in order to the four spec rules:

1. Introduce the theme's focus through the shared design-token and component
   layer without changing existing behaviour (`C1`).
2. Apply it consistently across browser chrome, AI sidebar, settings and
   artifact surfaces with **no runtime network resources** (`C2`).
3. Preserve keyboard operation, visible focus, reduced-motion and
   high-contrast behaviour while it is active (`C3`).
4. Verify it with a user-visible Playwright scenario that names the four check
   IDs and records a pass marker (`C4`).

**Debloat tiers (V131–V180).** Each tier contributes exactly four
improvements, whose check IDs `C1`–`C4` map in order to the four spec rules:

1. Measure the focus against the recorded baseline **before** changing it
   (`C1`).
2. Apply it without removing a user-visible control or weakening an existing
   offline/privacy contract (`C2`).
3. Keep it bounded and reversible through a named runtime budget, flag or pure
   helper that can be unit-tested (`C3`).
4. Verify the resource delta and rerun the full functional smoke after the
   change (`C4`).

## Check-ID convention

- UI tier Vn → `UIVn-C1`, `UIVn-C2`, `UIVn-C3`, `UIVn-C4`.
- Debloat tier Vn → `DVn-C1`, `DVn-C2`, `DVn-C3`, `DVn-C4`.
- IDs are stable, unique and never reused across tiers or programmes.
- `C1`–`C4` always mean "introduce/measure", "apply without regression",
  "preserve/bound", "verify" in that order.
- Evidence is collected in [V51_V180_EVIDENCE.md](V51_V180_EVIDENCE.md).

## Full per-tier ladder (generated from `nextgen-version-spec.js`)

### UI overhaul V51–V130 (80 tiers, 320 checks)

| Version | Program | Theme | Focus | 4 check IDs |
| --- | --- | --- | --- | --- |
| V51 | ui-overhaul | Design foundation | the single token contract for colour, type, spacing, radius and motion | `UIV51-C1`, `UIV51-C2`, `UIV51-C3`, `UIV51-C4` |
| V52 | ui-overhaul | Design foundation | a compact density scale shared by chrome, sidebar and pages | `UIV52-C1`, `UIV52-C2`, `UIV52-C3`, `UIV52-C4` |
| V53 | ui-overhaul | Design foundation | one accent and status colour map with verified light/dark contrast | `UIV53-C1`, `UIV53-C2`, `UIV53-C3`, `UIV53-C4` |
| V54 | ui-overhaul | Design foundation | a documented non-generic visual identity for every surface | `UIV54-C1`, `UIV54-C2`, `UIV54-C3`, `UIV54-C4` |
| V55 | ui-overhaul | Browser chrome | a quieter tab strip with explicit active, loading and sleeping states | `UIV55-C1`, `UIV55-C2`, `UIV55-C3`, `UIV55-C4` |
| V56 | ui-overhaul | Browser chrome | a single-line toolbar with intentional grouping and no dead controls | `UIV56-C1`, `UIV56-C2`, `UIV56-C3`, `UIV56-C4` |
| V57 | ui-overhaul | Browser chrome | an address field with clear security, source and focus states | `UIV57-C1`, `UIV57-C2`, `UIV57-C3`, `UIV57-C4` |
| V58 | ui-overhaul | Browser chrome | window controls and overlays that never cover focus or content | `UIV58-C1`, `UIV58-C2`, `UIV58-C3`, `UIV58-C4` |
| V59 | ui-overhaul | AI sidebar | a persistent sidebar workspace with clear chat and artifact boundaries | `UIV59-C1`, `UIV59-C2`, `UIV59-C3`, `UIV59-C4` |
| V60 | ui-overhaul | AI sidebar | compact model, provider and effort readouts with honest status | `UIV60-C1`, `UIV60-C2`, `UIV60-C3`, `UIV60-C4` |
| V61 | ui-overhaul | AI sidebar | stable message grouping and streaming state that never jumps | `UIV61-C1`, `UIV61-C2`, `UIV61-C3`, `UIV61-C4` |
| V62 | ui-overhaul | AI sidebar | context chips and attachments with removable, labelled states | `UIV62-C1`, `UIV62-C2`, `UIV62-C3`, `UIV62-C4` |
| V63 | ui-overhaul | Tabs and navigation | keyboard-first tab creation, switching, closing and restoration | `UIV63-C1`, `UIV63-C2`, `UIV63-C3`, `UIV63-C4` |
| V64 | ui-overhaul | Tabs and navigation | tab groups with visible identity and predictable collapse behaviour | `UIV64-C1`, `UIV64-C2`, `UIV64-C3`, `UIV64-C4` |
| V65 | ui-overhaul | Tabs and navigation | back/forward/reload states with accessible progress feedback | `UIV65-C1`, `UIV65-C2`, `UIV65-C3`, `UIV65-C4` |
| V66 | ui-overhaul | Tabs and navigation | session restore that preserves focus, scroll and sidebar context | `UIV66-C1`, `UIV66-C2`, `UIV66-C3`, `UIV66-C4` |
| V67 | ui-overhaul | AI features | prompt recipes that insert without overwriting user text | `UIV67-C1`, `UIV67-C2`, `UIV67-C3`, `UIV67-C4` |
| V68 | ui-overhaul | AI features | web-search status with source counts and honest failure text | `UIV68-C1`, `UIV68-C2`, `UIV68-C3`, `UIV68-C4` |
| V69 | ui-overhaul | AI features | memory and project controls with explicit consent state | `UIV69-C1`, `UIV69-C2`, `UIV69-C3`, `UIV69-C4` |
| V70 | ui-overhaul | AI features | mission and task handoffs that keep the conversation on thread | `UIV70-C1`, `UIV70-C2`, `UIV70-C3`, `UIV70-C4` |
| V71 | ui-overhaul | Artifact previews | site and report previews with a shared control vocabulary | `UIV71-C1`, `UIV71-C2`, `UIV71-C3`, `UIV71-C4` |
| V72 | ui-overhaul | Artifact previews | device presets, fullscreen, reload, console and edit affordances | `UIV72-C1`, `UIV72-C2`, `UIV72-C3`, `UIV72-C4` |
| V73 | ui-overhaul | Artifact previews | preview health and error states that explain instead of blanking | `UIV73-C1`, `UIV73-C2`, `UIV73-C3`, `UIV73-C4` |
| V74 | ui-overhaul | Artifact previews | image, table and citation rendering with consistent typography | `UIV74-C1`, `UIV74-C2`, `UIV74-C3`, `UIV74-C4` |
| V75 | ui-overhaul | Settings and account | a settings information architecture with one clear path per task | `UIV75-C1`, `UIV75-C2`, `UIV75-C3`, `UIV75-C4` |
| V76 | ui-overhaul | Settings and account | provider and model controls that never lose the current draft | `UIV76-C1`, `UIV76-C2`, `UIV76-C3`, `UIV76-C4` |
| V77 | ui-overhaul | Settings and account | account and sync status with explicit offline and error states | `UIV77-C1`, `UIV77-C2`, `UIV77-C3`, `UIV77-C4` |
| V78 | ui-overhaul | Settings and account | key management and privacy controls with plain-language warnings | `UIV78-C1`, `UIV78-C2`, `UIV78-C3`, `UIV78-C4` |
| V79 | ui-overhaul | Tasks and focus timer | task creation with validation and visible due/priority chips | `UIV79-C1`, `UIV79-C2`, `UIV79-C3`, `UIV79-C4` |
| V80 | ui-overhaul | Tasks and focus timer | completed-task handling that preserves undo and history | `UIV80-C1`, `UIV80-C2`, `UIV80-C3`, `UIV80-C4` |
| V81 | ui-overhaul | Tasks and focus timer | focus timer phases that are legible without reading the clock | `UIV81-C1`, `UIV81-C2`, `UIV81-C3`, `UIV81-C4` |
| V82 | ui-overhaul | Tasks and focus timer | site blocking and sound controls with persistent state | `UIV82-C1`, `UIV82-C2`, `UIV82-C3`, `UIV82-C4` |
| V83 | ui-overhaul | Menus and overlays | the main menu with guaranteed visible items and scrim dismissal | `UIV83-C1`, `UIV83-C2`, `UIV83-C3`, `UIV83-C4` |
| V84 | ui-overhaul | Menus and overlays | context menus with stable roles, icons and keyboard parity | `UIV84-C1`, `UIV84-C2`, `UIV84-C3`, `UIV84-C4` |
| V85 | ui-overhaul | Menus and overlays | modal dialogs with focus trap, Escape and trigger restore | `UIV85-C1`, `UIV85-C2`, `UIV85-C3`, `UIV85-C4` |
| V86 | ui-overhaul | Menus and overlays | toasts and banners that announce status without stealing focus | `UIV86-C1`, `UIV86-C2`, `UIV86-C3`, `UIV86-C4` |
| V87 | ui-overhaul | Search, history and bookmarks | unified search entry with scoped results and clear empty states | `UIV87-C1`, `UIV87-C2`, `UIV87-C3`, `UIV87-C4` |
| V88 | ui-overhaul | Search, history and bookmarks | history grouping with deterministic ordering and restore | `UIV88-C1`, `UIV88-C2`, `UIV88-C3`, `UIV88-C4` |
| V89 | ui-overhaul | Search, history and bookmarks | bookmark add/edit states with inline validation | `UIV89-C1`, `UIV89-C2`, `UIV89-C3`, `UIV89-C4` |
| V90 | ui-overhaul | Search, history and bookmarks | top sites and recent work with privacy-aware labels | `UIV90-C1`, `UIV90-C2`, `UIV90-C3`, `UIV90-C4` |
| V91 | ui-overhaul | Extensions and downloads | extension buttons with loading, error and disabled states | `UIV91-C1`, `UIV91-C2`, `UIV91-C3`, `UIV91-C4` |
| V92 | ui-overhaul | Extensions and downloads | downloads list with progress, pause/cancel and open actions | `UIV92-C1`, `UIV92-C2`, `UIV92-C3`, `UIV92-C4` |
| V93 | ui-overhaul | Extensions and downloads | permission prompts that are specific and dismissible by keyboard | `UIV93-C1`, `UIV93-C2`, `UIV93-C3`, `UIV93-C4` |
| V94 | ui-overhaul | Extensions and downloads | extension management with consistent install/uninstall feedback | `UIV94-C1`, `UIV94-C2`, `UIV94-C3`, `UIV94-C4` |
| V95 | ui-overhaul | Screenshot and inspector | capture modes with visible region, delay and destination state | `UIV95-C1`, `UIV95-C2`, `UIV95-C3`, `UIV95-C4` |
| V96 | ui-overhaul | Screenshot and inspector | recording controls that are obvious, cancellable and accessible | `UIV96-C1`, `UIV96-C2`, `UIV96-C3`, `UIV96-C4` |
| V97 | ui-overhaul | Screenshot and inspector | inspector panes with readable DOM/CSS/console hierarchy | `UIV97-C1`, `UIV97-C2`, `UIV97-C3`, `UIV97-C4` |
| V98 | ui-overhaul | Screenshot and inspector | clipboard and save status that survive failure | `UIV98-C1`, `UIV98-C2`, `UIV98-C3`, `UIV98-C4` |
| V99 | ui-overhaul | Accessibility | visible focus rings on every interactive surface | `UIV99-C1`, `UIV99-C2`, `UIV99-C3`, `UIV99-C4` |
| V100 | ui-overhaul | Accessibility | accessible names for icon-only controls and status regions | `UIV100-C1`, `UIV100-C2`, `UIV100-C3`, `UIV100-C4` |
| V101 | ui-overhaul | Accessibility | contrast and target-size conformance in both themes | `UIV101-C1`, `UIV101-C2`, `UIV101-C3`, `UIV101-C4` |
| V102 | ui-overhaul | Accessibility | reduced-motion and high-contrast alternatives with no lost state | `UIV102-C1`, `UIV102-C2`, `UIV102-C3`, `UIV102-C4` |
| V103 | ui-overhaul | Keyboard and power user | a documented shortcut map with conflict-free bindings | `UIV103-C1`, `UIV103-C2`, `UIV103-C3`, `UIV103-C4` |
| V104 | ui-overhaul | Keyboard and power user | command palette entries for browser and AI actions | `UIV104-C1`, `UIV104-C2`, `UIV104-C3`, `UIV104-C4` |
| V105 | ui-overhaul | Keyboard and power user | focus memory when moving between chrome, page and sidebar | `UIV105-C1`, `UIV105-C2`, `UIV105-C3`, `UIV105-C4` |
| V106 | ui-overhaul | Keyboard and power user | Escape layering that closes one surface at a time | `UIV106-C1`, `UIV106-C2`, `UIV106-C3`, `UIV106-C4` |
| V107 | ui-overhaul | Responsive and density | compact, comfortable and spacious density presets | `UIV107-C1`, `UIV107-C2`, `UIV107-C3`, `UIV107-C4` |
| V108 | ui-overhaul | Responsive and density | narrow-window behaviour with no clipped or unreachable controls | `UIV108-C1`, `UIV108-C2`, `UIV108-C3`, `UIV108-C4` |
| V109 | ui-overhaul | Responsive and density | sidebar width states with keyboard resizing and persistence | `UIV109-C1`, `UIV109-C2`, `UIV109-C3`, `UIV109-C4` |
| V110 | ui-overhaul | Responsive and density | zoom and text scaling that preserve layout integrity | `UIV110-C1`, `UIV110-C2`, `UIV110-C3`, `UIV110-C4` |
| V111 | ui-overhaul | Theme and personalisation | light/dark/system themes with no flash of wrong theme | `UIV111-C1`, `UIV111-C2`, `UIV111-C3`, `UIV111-C4` |
| V112 | ui-overhaul | Theme and personalisation | accent colour application that respects contrast minimums | `UIV112-C1`, `UIV112-C2`, `UIV112-C3`, `UIV112-C4` |
| V113 | ui-overhaul | Theme and personalisation | wallpaper and page background states that stay quiet | `UIV113-C1`, `UIV113-C2`, `UIV113-C3`, `UIV113-C4` |
| V114 | ui-overhaul | Theme and personalisation | profile identity that is visible without dominating chrome | `UIV114-C1`, `UIV114-C2`, `UIV114-C3`, `UIV114-C4` |
| V115 | ui-overhaul | Interface performance | compositor-friendly animation limited to transform and opacity | `UIV115-C1`, `UIV115-C2`, `UIV115-C3`, `UIV115-C4` |
| V116 | ui-overhaul | Interface performance | deferred non-critical UI work outside first interaction | `UIV116-C1`, `UIV116-C2`, `UIV116-C3`, `UIV116-C4` |
| V117 | ui-overhaul | Interface performance | bounded DOM lists and virtualised long chat/task histories | `UIV117-C1`, `UIV117-C2`, `UIV117-C3`, `UIV117-C4` |
| V118 | ui-overhaul | Interface performance | idle UI that performs no polling or layout work | `UIV118-C1`, `UIV118-C2`, `UIV118-C3`, `UIV118-C4` |
| V119 | ui-overhaul | Reliability | deterministic error states with retry and recovery actions | `UIV119-C1`, `UIV119-C2`, `UIV119-C3`, `UIV119-C4` |
| V120 | ui-overhaul | Reliability | stale update guards for chat, preview and settings patches | `UIV120-C1`, `UIV120-C2`, `UIV120-C3`, `UIV120-C4` |
| V121 | ui-overhaul | Reliability | safe persistence with corrupt-state recovery | `UIV121-C1`, `UIV121-C2`, `UIV121-C3`, `UIV121-C4` |
| V122 | ui-overhaul | Reliability | crash-safe teardown and reconnection for background work | `UIV122-C1`, `UIV122-C2`, `UIV122-C3`, `UIV122-C4` |
| V123 | ui-overhaul | Installer and first run | a custom installer surface consistent with the product identity | `UIV123-C1`, `UIV123-C2`, `UIV123-C3`, `UIV123-C4` |
| V124 | ui-overhaul | Installer and first run | first-run setup that explains AI, privacy and defaults briefly | `UIV124-C1`, `UIV124-C2`, `UIV124-C3`, `UIV124-C4` |
| V125 | ui-overhaul | Installer and first run | welcome content that is useful and dismissible in one action | `UIV125-C1`, `UIV125-C2`, `UIV125-C3`, `UIV125-C4` |
| V126 | ui-overhaul | Installer and first run | update and uninstall feedback that never blocks the browser | `UIV126-C1`, `UIV126-C2`, `UIV126-C3`, `UIV126-C4` |
| V127 | ui-overhaul | Final UI release gate | a full visual regression pass across all major surfaces | `UIV127-C1`, `UIV127-C2`, `UIV127-C3`, `UIV127-C4` |
| V128 | ui-overhaul | Final UI release gate | a full keyboard and screen-reader pass with no dead controls | `UIV128-C1`, `UIV128-C2`, `UIV128-C3`, `UIV128-C4` |
| V129 | ui-overhaul | Final UI release gate | a full performance pass against the idle and active budgets | `UIV129-C1`, `UIV129-C2`, `UIV129-C3`, `UIV129-C4` |
| V130 | ui-overhaul | Final UI release gate | a final installed-app pass proving the overhaul shipped | `UIV130-C1`, `UIV130-C2`, `UIV130-C3`, `UIV130-C4` |

### Debloat V131–V180 (50 tiers, 200 checks)

| Version | Program | Theme | Focus | 4 check IDs |
| --- | --- | --- | --- | --- |
| V131 | debloat | Process topology | baseline process count and working set | `DV131-C1`, `DV131-C2`, `DV131-C3`, `DV131-C4` |
| V132 | debloat | Process topology | background renderer reuse | `DV132-C1`, `DV132-C2`, `DV132-C3`, `DV132-C4` |
| V133 | debloat | Process topology | utility process minimisation | `DV133-C1`, `DV133-C2`, `DV133-C3`, `DV133-C4` |
| V134 | debloat | Process topology | windowless helper elimination | `DV134-C1`, `DV134-C2`, `DV134-C3`, `DV134-C4` |
| V135 | debloat | Startup deferral | lazy source-spec loading | `DV135-C1`, `DV135-C2`, `DV135-C3`, `DV135-C4` |
| V136 | debloat | Startup deferral | deferred provider catalogue refresh | `DV136-C1`, `DV136-C2`, `DV136-C3`, `DV136-C4` |
| V137 | debloat | Startup deferral | delayed settings hydration | `DV137-C1`, `DV137-C2`, `DV137-C3`, `DV137-C4` |
| V138 | debloat | Startup deferral | on-demand artifact renderer loading | `DV138-C1`, `DV138-C2`, `DV138-C3`, `DV138-C4` |
| V139 | debloat | Renderer scheduling | idle callback batching | `DV139-C1`, `DV139-C2`, `DV139-C3`, `DV139-C4` |
| V140 | debloat | Renderer scheduling | passive event listeners | `DV140-C1`, `DV140-C2`, `DV140-C3`, `DV140-C4` |
| V141 | debloat | Renderer scheduling | reduced timer cardinality | `DV141-C1`, `DV141-C2`, `DV141-C3`, `DV141-C4` |
| V142 | debloat | Renderer scheduling | occluded renderer throttling | `DV142-C1`, `DV142-C2`, `DV142-C3`, `DV142-C4` |
| V143 | debloat | Memory bounds | site registry budget reduction | `DV143-C1`, `DV143-C2`, `DV143-C3`, `DV143-C4` |
| V144 | debloat | Memory bounds | diagnostic cache bound | `DV144-C1`, `DV144-C2`, `DV144-C3`, `DV144-C4` |
| V145 | debloat | Memory bounds | chat history window cap | `DV145-C1`, `DV145-C2`, `DV145-C3`, `DV145-C4` |
| V146 | debloat | Memory bounds | image payload cap | `DV146-C1`, `DV146-C2`, `DV146-C3`, `DV146-C4` |
| V147 | debloat | GPU and compositor | GPU raster watchdog settings | `DV147-C1`, `DV147-C2`, `DV147-C3`, `DV147-C4` |
| V148 | debloat | GPU and compositor | transform-only motion | `DV148-C1`, `DV148-C2`, `DV148-C3`, `DV148-C4` |
| V149 | debloat | GPU and compositor | shadow and blur reduction | `DV149-C1`, `DV149-C2`, `DV149-C3`, `DV149-C4` |
| V150 | debloat | GPU and compositor | layer count minimisation | `DV150-C1`, `DV150-C2`, `DV150-C3`, `DV150-C4` |
| V151 | debloat | Network idle | prewarm suppression when idle | `DV151-C1`, `DV151-C2`, `DV151-C3`, `DV151-C4` |
| V152 | debloat | Network idle | connection pool reuse | `DV152-C1`, `DV152-C2`, `DV152-C3`, `DV152-C4` |
| V153 | debloat | Network idle | search cache ttl | `DV153-C1`, `DV153-C2`, `DV153-C3`, `DV153-C4` |
| V154 | debloat | Network idle | offline-first internal pages | `DV154-C1`, `DV154-C2`, `DV154-C3`, `DV154-C4` |
| V155 | debloat | AI transport | stream chunk coalescing | `DV155-C1`, `DV155-C2`, `DV155-C3`, `DV155-C4` |
| V156 | debloat | AI transport | bounded retry backoff | `DV156-C1`, `DV156-C2`, `DV156-C3`, `DV156-C4` |
| V157 | debloat | AI transport | context pruning | `DV157-C1`, `DV157-C2`, `DV157-C3`, `DV157-C4` |
| V158 | debloat | AI transport | memory extraction scheduling | `DV158-C1`, `DV158-C2`, `DV158-C3`, `DV158-C4` |
| V159 | debloat | Artifact registry | preview host eviction | `DV159-C1`, `DV159-C2`, `DV159-C3`, `DV159-C4` |
| V160 | debloat | Artifact registry | single-file output budget | `DV160-C1`, `DV160-C2`, `DV160-C3`, `DV160-C4` |
| V161 | debloat | Artifact registry | report block cap | `DV161-C1`, `DV161-C2`, `DV161-C3`, `DV161-C4` |
| V162 | debloat | Artifact registry | stale artifact disposal | `DV162-C1`, `DV162-C2`, `DV162-C3`, `DV162-C4` |
| V163 | debloat | DOM and CSS | selector simplification | `DV163-C1`, `DV163-C2`, `DV163-C3`, `DV163-C4` |
| V164 | debloat | DOM and CSS | stylesheet split deferral | `DV164-C1`, `DV164-C2`, `DV164-C3`, `DV164-C4` |
| V165 | debloat | DOM and CSS | list virtualisation | `DV165-C1`, `DV165-C2`, `DV165-C3`, `DV165-C4` |
| V166 | debloat | DOM and CSS | layout thrash removal | `DV166-C1`, `DV166-C2`, `DV166-C3`, `DV166-C4` |
| V167 | debloat | Timers and animation | sweep interval tuning | `DV167-C1`, `DV167-C2`, `DV167-C3`, `DV167-C4` |
| V168 | debloat | Timers and animation | timer deduplication | `DV168-C1`, `DV168-C2`, `DV168-C3`, `DV168-C4` |
| V169 | debloat | Timers and animation | reduced-motion fast path | `DV169-C1`, `DV169-C2`, `DV169-C3`, `DV169-C4` |
| V170 | debloat | Timers and animation | visibility-aware animation pause | `DV170-C1`, `DV170-C2`, `DV170-C3`, `DV170-C4` |
| V171 | debloat | Storage and I/O | batched writes | `DV171-C1`, `DV171-C2`, `DV171-C3`, `DV171-C4` |
| V172 | debloat | Storage and I/O | atomic profile save debounce | `DV172-C1`, `DV172-C2`, `DV172-C3`, `DV172-C4` |
| V173 | debloat | Storage and I/O | history index compaction | `DV173-C1`, `DV173-C2`, `DV173-C3`, `DV173-C4` |
| V174 | debloat | Storage and I/O | log volume cap | `DV174-C1`, `DV174-C2`, `DV174-C3`, `DV174-C4` |
| V175 | debloat | Installer and runtime | package asset deduplication | `DV175-C1`, `DV175-C2`, `DV175-C3`, `DV175-C4` |
| V176 | debloat | Installer and runtime | unused dependency removal | `DV176-C1`, `DV176-C2`, `DV176-C3`, `DV176-C4` |
| V177 | debloat | Installer and runtime | smaller install payload | `DV177-C1`, `DV177-C2`, `DV177-C3`, `DV177-C4` |
| V178 | debloat | Installer and runtime | startup switch audit | `DV178-C1`, `DV178-C2`, `DV178-C3`, `DV178-C4` |
| V179 | debloat | Final resource gate | 50% CPU and RAM reduction proof | `DV179-C1`, `DV179-C2`, `DV179-C3`, `DV179-C4` |
| V180 | debloat | Final resource gate | 50% GPU and power-proxy reduction proof with functional regression gate | `DV180-C1`, `DV180-C2`, `DV180-C3`, `DV180-C4` |

## Acceptance and cumulative gate rules

- A tier passes only when all four of its check IDs are demonstrably true in
  the recorded run. There is no partial or averaged pass.
- Every pass is cumulative: all lower tiers in the same ladder must still be
  green. A regression in any earlier tier fails the later tier too.
- The two terminal gates are **V130** (full installed-app UI pass: visual,
  keyboard/screen-reader, performance and shipped-overlay proof) and **V180**
  (≥50% CPU/RAM/GPU/power-proxy reduction versus the recorded baseline, with
  a clean functional regression smoke).
- The UI and debloat ladders are separate contracts; V130 does not imply
  V180, and V180 does not waive V130.
- The final cross-programme gate requires both ladder markers plus the
  installer/finalization checks below:
  `ALL 80 UI VERSIONS PASS`, `ALL 50 DEBLOAT VERSIONS PASS`,
  `FINAL UI + DEBLOAT GATE PASS`.
- The V31–V50 historical markers stay in `V31_V50_EVIDENCE.md` and are not
  edited or superseded by this ladder.

## Automated gates

- Pure spec gate: `validateNextGenSpec()` over
  `nextgen-version-spec.js` — 80 UI + 50 debloat tiers, contiguous
  numbering, four rules and four correctly spelled, unique IDs per tier.
- UI static layer gate: shell and internal pages must not load the rejected
  `assets/ui-v2.css` / `assets/ui-v2.js` overlay; the functional menu repairs
  (top-most sidebar task bar, visible menu items, first-paint before IPC) stay.
  No runtime network, no new font families and safe degradation when a
  component is absent.
- UI user-visible gate: intensive Playwright E2E — 20 rounds / 20,000
  scenarios — recorded with the exact marker
  `ALL 20 INTENSIVE E2E ROUNDS PASS — 20000/20000 SCENARIOS`.
- Design-judge gate: in-repo Playwright + static-token review (no external
  design MCP was available); its exact pass marker is pasted into the final
  run record in the evidence doc.
- Debloat gate: `src/main/debloat-budgets.js` `validateBudgets()` and
  `clampBudget()` bound the named budgets; measured process counters,
  CDP target counts and process counts under a fixed workload are compared
  with the recorded baseline, followed by a full functional smoke. The
  measurement marker is pasted into the final run record in the evidence doc.
- No `package.json` wiring or source changes are introduced by this
  documentation programme; harness work is owned separately.

## Installer and finalization requirements

1. Rebuild from a non-OneDrive staging tree (the V31–V50 ASAR failure was
   caused by OneDrive reparse points), hash-verify staged inputs, validate
   every ASAR entry against the staged sources, then silently install.
2. Record final hashes and the verification log in
   `installer/FINAL_HASHES.txt`.
3. Installed-app smoke: open CDP, verify the UI overlay surfaces, tab/menu
   visibility, report imagery, preview shims, and a real AI-generated
   artifact; confirm zero console errors.
4. Re-run the functional smoke and the debloat measurement on the installed
   package; re-verify the byte-stable site V1–V30 / report V1–V20 /
   combined V31–V50 contracts.
5. Only after all three programme markers are recorded in the evidence doc:
   finalize, clean dev-only artifacts, confirm the distributable root, and
   restart the app on its default profile with `--disable-gpu`
   (`FINALIZE DONE`).
6. If any gate is missing or fails, the final marker stays unrecorded and the
   release is not signed off.
