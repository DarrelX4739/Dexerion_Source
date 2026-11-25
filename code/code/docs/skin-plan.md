# Skin Transformation Plan: nof1

> **Important input note:** The supplied `<skin-definition>` block was empty, so the registered `nof1` JSON could not be independently read or reconciled token-for-token. The plan below uses the requested **paper-minimal / premium / singular UI** direction and the current project’s existing accent-preservation behavior. The exact color/type values marked **proposed** must be replaced with the exported nof1 token values if the skin provider supplies them before implementation.

## Executive Summary

- **Current state:** Dexerion is an Electron browser with a dark-first “Obsidian Atelier” design system. The browser chrome uses `src/renderer/shell.css`; internal pages use `assets/page-theme.css`; the new-tab page contains a large inline theme; context menus and the snip overlay each duplicate the token set. This creates four styling authorities with repeated values and several small inconsistencies.
- **Target skin:** `nof1` v1.0.0 (exact JSON was not included in the request).
- **Skin philosophy:** Paper-like, quiet, editorial, minimal, premium, and cohesive; the user-selected accent remains a signal color for focus, active states, and primary actions rather than becoming a decorative wash.
- **Total scope:** Approximately **14 source files**, **4 token authorities**, **10+ UI surfaces**, and **150+ local style adjustments**.
- **Risk level:** Medium. The visual system is centralized enough for a staged migration, but shell/page/overlay parity and theme persistence are coupled to browser state.
- **Estimated effort:** 2–4 engineering days for the foundation and all pages, plus 1 day for visual regression, accessibility, and Electron interaction testing.

## Current vs Target Comparison

### Colors

| Token | Current | Proposed nof1 target | Status |
|---|---|---|---|
| Shell background | `#0a0a0c` | `#171614` | Change |
| Page background | `#0a0a0c` | `#f4f1eb` light / `#171614` dark | Change |
| Primary surface | `#131317` / `#17171c` | `#fbfaf7` light / `#211f1c` dark | Change |
| Field background | `#0c0c10` | `#fffefa` light / `#1b1a17` dark | Change |
| Primary text | `#eceef3` | `#24211d` light / `#f4f0e8` dark | Change |
| Secondary text | `#c3c6d1` | `#5f5a51` light / `#c7c0b5` dark | Change |
| Muted text | `#8a8c99` | `#817a70` light / `#a49c90` dark | Change |
| Faint text | `#5c5e6b` | `#aaa196` light / `#726d65` dark | Change |
| Border | white alpha `.075` | ink alpha `.12` | Change |
| Border strong | white alpha `.125` | ink alpha `.20` | Change |
| Hover | white alpha `.045–.06` | ink alpha `.045` | Change |
| Active | white alpha `.075–.10` | ink alpha `.075` | Change |
| Accent | runtime `#35c4ff` | Preserve runtime accent | Match/behavioral requirement |
| Accent ink | `#07131a` / white | Preserve runtime contrast pairing | Change/verify |
| Success | `#45d483` / `#14884a` | `#2f7d4a` / `#77c88d` | Change |
| Warning | `#f0b429` / `#9a6b00` | `#a56a00` / `#e0ad4d` | Change |
| Error | `#ff6b6b` / `#c43434` | `#b23b35` / `#e47c73` | Change |
| Recording | `#ff5a5a` | `#c2413b` | Change |
| Overlay scrim | `rgba(0,0,0,.32–.55)` | ink scrim at 28–48% | Change |

### Typography

| Property | Current | Proposed nof1 target | Status |
|---|---|---|---|
| UI font | Segoe UI Variable / Segoe UI / system | `Inter`, `Segoe UI Variable Text`, system | Change |
| Display font | Bahnschrift / Segoe UI Variable Display | `Newsreader` or `Iowan Old Style` for editorial headings; UI sans elsewhere | Change |
| Mono font | Cascadia Mono / Consolas | `IBM Plex Mono`, `Cascadia Code`, monospace | Change |
| Base body size | 14px | 14px | Match |
| Page title | 27px | 30px / 1.1 | Change |
| Section label | 10–12px uppercase | 10px uppercase, 0.18em | Minor change |
| Card heading | 12px uppercase | 12px semibold, 0.12em | Change |
| Button | 13px / 600 | 13px / 600 | Match |
| Line height | 1.5 base; AI 1.6–1.7 | 1.55 base; 1.65 editorial copy | Minor change |

### Spacing & Radius

| Token | Current | Proposed nof1 target | Status |
|---|---|---|---|
| Base rhythm | 2–14px ad hoc | 4px base rhythm | Change |
| Small radius | 5px | 6px | Change |
| Control radius | 7–9px | 8px | Change |
| Card radius | 12–16px | 14px | Change |
| Overlay radius | 10–16px | 14px | Minor change |
| Pill | 999px | 999px | Match |
| Page max width | 860px | 920px | Change |
| Wide page max width | 1040px | 1120px | Change |
| Page padding | 44px 28px | 48px 32px | Change |
| Card spacing | 18px | 20px | Change |
| Toolbar | 48px | 52px | Change |
| Tab strip | 38px | 40px | Change |

## Foundation: Do This First

### 1.1 Establish one shared token contract

**Files:**

- `assets/page-theme.css:16-113`
- `src/renderer/shell.css:8-52`
- `src/renderer/ctxmenu.html:6-22`
- `src/renderer/snip.html:3-20`

These four files currently repeat the same neutral colors, typography, radii, and accent defaults. The shell and page systems also use different names (`--bg` vs `--pbg`, `--hair` vs `--pborder`, `--r` vs `--r-sm`/`--r-md`).

**Recommended approach:** keep the page prefix as an alias layer so existing page markup does not need a large rewrite.

```css
/* assets/page-theme.css — canonical token block */
:root {
  color-scheme: light;

  --paper: #f4f1eb;
  --paper-raised: #fbfaf7;
  --paper-field: #fffefa;
  --paper-ink: #24211d;
  --paper-ink-2: #5f5a51;
  --paper-muted: #817a70;
  --paper-faint: #aaa196;
  --paper-line: rgba(36, 33, 29, .12);
  --paper-line-strong: rgba(36, 33, 29, .20);
  --paper-hover: rgba(36, 33, 29, .045);
  --paper-active: rgba(36, 33, 29, .075);
  --paper-highlight: rgba(255, 255, 255, .82);

  --ok: #2f7d4a;
  --warn: #a56a00;
  --err: #b23b35;
  --rec: #c2413b;

  --font-ui: "Inter", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  --font-display: "Newsreader", "Iowan Old Style", Georgia, serif;
  --font-mono: "IBM Plex Mono", "Cascadia Mono", Consolas, monospace;

  --r-xs: 6px;
  --r-sm: 8px;
  --r-md: 10px;
  --r-lg: 14px;
  --r-xl: 16px;

  --accent: #35c4ff;
  --accent-ink: #07131a;
}

[data-theme="dark"] {
  color-scheme: dark;
  --paper: #171614;
  --paper-raised: #211f1c;
  --paper-field: #1b1a17;
  --paper-ink: #f4f0e8;
  --paper-ink-2: #c7c0b5;
  --paper-muted: #a49c90;
  --paper-faint: #726d65;
  --paper-line: rgba(255,255,255,.11);
  --paper-line-strong: rgba(255,255,255,.18);
  --paper-hover: rgba(255,255,255,.055);
  --paper-active: rgba(255,255,255,.09);
  --paper-highlight: rgba(255,255,255,.06);
}

/* Compatibility aliases: migrate markup gradually without breaking it. */
:root {
  --pbg: var(--paper);
  --pbg-2: var(--paper-raised);
  --pcard: var(--paper-raised);
  --pcard-2: var(--paper-field);
  --pfield: var(--paper-field);
  --pfg: var(--paper-ink);
  --pfg-2: var(--paper-ink-2);
  --pmuted: var(--paper-muted);
  --pfaint: var(--paper-faint);
  --pborder: var(--paper-line);
  --pborder-2: var(--paper-line-strong);
  --phover: var(--paper-hover);
  --pactive: var(--paper-active);
  --phl: var(--paper-highlight);
  --font: var(--font-ui);
}
```

- [ ] Replace duplicated color literals with canonical tokens in `assets/page-theme.css`.
- [ ] Add `[data-theme="dark"]` explicitly; current CSS treats absence of `data-theme="light"` as dark but does not make the default light direction explicit.
- [ ] Add `--paper`, `--paper-raised`, `--paper-field`, `--paper-ink`, `--paper-line`, `--paper-line-strong`, and semantic status aliases.
- [ ] Keep runtime `--accent` injection unchanged; never overwrite it during theme bootstrap.
- [ ] Add dark-mode status tokens rather than relying on a single status color to work in both themes.
- [ ] Remove `--bg2`/`--surface` duplication from the shell once aliases are proven.
- [ ] Add one shared stylesheet URL for internal pages; do not maintain page-specific theme copies.

### 1.2 Unify bootstrap and theme propagation

**Files:**

- `assets/page-theme.js:1-11`
- `src/renderer/shell.js:40-45`
- `src/renderer/ctxmenu.html:101-106`
- `src/renderer/snip.html:164-167`

Current behavior is directionally correct, but each surface receives a slightly different default and token application path. Extract a small shared helper or ensure all surfaces apply the same contract:

```js
function applyUiTheme(ui = {}) {
  const root = document.documentElement;
  root.dataset.theme = ui.theme === 'light' ? 'light' : 'dark';
  root.style.setProperty('--accent', ui.accent || '#35c4ff');
}
```

- [ ] Centralize default theme as `dark` only if nof1 requires dark-first; otherwise default to the exported nof1 theme.
- [ ] Apply the same `--accent` value to shell, pages, context menu, and snip.
- [ ] Keep runtime state as the only source of truth; do not persist CSS changes independently.
- [ ] Verify theme changes propagate to already-open internal pages, context menus, and snip overlays.

## Phase 1: Browser Chrome

### 2.1 Tabs, toolbar, and omnibox

**File:** `src/renderer/shell.css:63-202`

Current surface: 38px tab strip, 48px toolbar, dark translucent surfaces, 2px active accent rail, and 32px omnibox.

**Before:**

```css
#tabstrip { height:38px; padding:6px 10px 0; }
.tab { min-width:124px; height:32px; border-radius:var(--r) var(--r) 0 0; }
#toolbar { height:48px; background:var(--bg2); }
#omnibox { height:32px; border-radius:var(--r); }
```

**Target implementation:**

```css
#tabstrip {
  height:40px;
  padding:7px 12px 0;
  background:var(--paper);
}

.tab {
  min-width:128px;
  height:33px;
  border:1px solid transparent;
  border-radius:var(--r-md) var(--r-md) 0 0;
  color:var(--paper-muted);
}

.tab.active {
  color:var(--paper-ink);
  background:var(--paper-raised);
  border-color:var(--paper-line);
  box-shadow:inset 0 1px 0 var(--paper-highlight);
}

.tab.active::after { background:var(--accent); height:2px; }

#toolbar {
  height:52px;
  padding:0 12px;
  background:var(--paper-raised);
  border-bottom:1px solid var(--paper-line);
}

#omnibox {
  height:36px;
  padding:0 16px;
  border:1px solid var(--paper-line);
  border-radius:var(--r-lg);
  background:var(--paper-field);
}
```

- [ ] Increase tab strip and toolbar heights by 2–4px only after checking content positioning.
- [ ] Use paper surfaces for the chrome instead of translucent dark-only fills.
- [ ] Preserve the active accent rail; it is part of product identity.
- [ ] Preserve loading progress and favicon/letter avatar behavior.
- [ ] Preserve vertical tab rail dimensions and update its tokens to canonical names.
- [ ] Add a consistent toolbar icon hit area of 32px with 8px radius.
- [ ] Keep disabled navigation controls visibly quieter without reducing contrast below accessibility requirements.

### 2.2 Menu, group editor, and transient bars

**Files:** `src/renderer/shell.css:204-343`, `src/renderer/shell.js:186-257`, `src/renderer/shell.html:45-66`

- [ ] Make `#loginbar` and `#store-banner` use `--paper-raised`, `--paper-line`, and a shared `.dx-action`/button treatment.
- [ ] Use a paper floating surface for `#gedit` and `#dmenu`; reserve blur for native overlay separation if Chromium requires it.
- [ ] Change menu group labels to muted small caps, menu items to 36px minimum height, and kbd chips to mono 10px.
- [ ] Ensure menu separators use one shared border token.
- [ ] Make danger actions use `--err` on hover but never remove the normal button label contrast.
- [ ] Keep menu animation subtle: 120–160ms, no spring overshoot.

## Phase 2: Internal Pages

### 3.1 New Tab page

**File:** `src/renderer/pages/newtab.html:3-290`

This is the largest page-specific style block and currently contains its own layout, cards, AI chat, thinking animation, and empty states. Migrate it to the canonical page tokens while retaining the intentional accent signals.

**Required changes:**

- [ ] Replace `var(--pbg)`, `var(--pcard)`, `var(--pborder)`, and radius references with the canonical names or compatibility aliases.
- [ ] Reduce the page’s card-heavy appearance: use a paper background, outlined search field, and flat bookmark tiles with a single hairline border.
- [ ] Change `.mark .crest` from a glossy/gradient card to a quiet paper logo plate with a restrained shadow.
- [ ] Use the display serif only for the wordmark and major headings; keep body/search UI in the UI sans.
- [ ] Keep the AI action as a secondary outlined button; use accent only on icon, focus ring, and hover border.
- [ ] Preserve image attachment, streaming, thinking, reduced-motion, and keyboard behavior; these are functional, not skin changes.
- [ ] Move shared `.btn`, `.hbtn`, input, card, badge, and empty-state patterns into `assets/page-theme.css` rather than leaving page-local duplicates.

**Target core snippets:**

```css
.mark .crest {
  background:var(--paper-field);
  border:1px solid var(--paper-line);
  box-shadow:var(--sh-2), inset 0 1px 0 var(--paper-highlight);
}
.mark h1 { font-family:var(--font-display); font-size:32px; }
#q {
  height:56px;
  background:var(--paper-field);
  border:1px solid var(--paper-line-strong);
  border-radius:var(--r-lg);
}
```

### 3.2 Settings

**File:** `src/renderer/pages/settings.html:3-126`

- [ ] Replace hardcoded miniature theme colors at lines 17–26 with nof1 preview tokens or a class-driven preview that reads CSS variables.
- [ ] Use one card pattern for all settings groups.
- [ ] Make the Appearance card the visual anchor: theme previews, accent swatches, vertical tabs, and bookmarks bar.
- [ ] Keep accent swatch presets unchanged as user-selectable accent colors; only change the surrounding selection treatment.
- [ ] Convert inline widths at lines 80, 97, 101, 122–123 into utility classes or responsive CSS.
- [ ] Keep the current live-save behavior and toast.

### 3.3 History, Bookmarks, Downloads, Extensions, Accounts

**Files:**

- `src/renderer/pages/history.html:1-64`
- `src/renderer/pages/bookmarks.html:1-71`
- `src/renderer/pages/downloads.html:1-190`
- `src/renderer/pages/extensions.html:1-126`
- `src/renderer/pages/accounts.html:1-241`

These pages already use the shared page system. The work is consistency and token cleanup, not a redesign.

- [ ] Apply the same 14px list radius, 20px list gaps, and shared row height to every list page.
- [ ] Keep hover action visibility and keyboard focus behavior consistent.
- [ ] Replace `hsl(var(--h...))` avatar styling in history/bookmarks/newtab with a shared `.site-avatar` class and nof1-compatible contrast rules.
- [ ] Replace hardcoded download paused color `#ffb020` at `downloads.html:9` with `var(--warn)`.
- [ ] Replace hardcoded `#fff` text and `#0a0a0c` avatar gradient endings in accounts and AI code with theme-aware tokens.
- [ ] Convert accounts’ inline styles at lines 181, 183, 198, 204, 217, 219, and 222 to classes.
- [ ] Keep extension error blocks, download progress, account badges, and destructive actions in semantic status colors.
- [ ] Ensure empty states in all pages use the same `.dx-empty` hierarchy and copy rhythm.

## Phase 3: Context Menu and Snip Overlay

### 4.1 Context menu

**File:** `src/renderer/ctxmenu.html:2-64`

- [ ] Replace the duplicated `:root` token block with aliases matching `assets/page-theme.css`.
- [ ] Use `--paper-raised`, `--paper-field`, `--paper-ink`, and `--paper-line` for the panel.
- [ ] Keep backdrop blur only for the native floating menu; use a paper fallback when transparency is unavailable.
- [ ] Normalize menu item height to 36px, separator height to 12px, and panel radius to 14px.
- [ ] Preserve `GLYPH`, keyboard selection, mouse-down activation, and `dex:ctx-result` behavior unchanged.
- [ ] Verify selected and disabled states are distinguishable without relying on color alone.

### 4.2 Snip overlay

**File:** `src/renderer/snip.html:2-120`

- [ ] Share the same token aliases as the context menu.
- [ ] Keep the dark stage scrim for capture affordance, but use a nof1 neutral scrim derived from the paper ink token.
- [ ] Align toolbar, actions, record panel, preview card, busy card, and toast with the context menu’s radius, border, and shadow scale.
- [ ] Preserve the red recording signal and add a non-color cue where possible (`Recording`, `Stop`, pulse).
- [ ] Keep capture selection border tied to `--accent`.
- [ ] Preserve reduced-motion behavior by adding `prefers-reduced-motion` handling for the recording pulse, busy spinner, and overlay entrances.

## Phase 4: Accent and Semantic State System

**Files:** `src/main/profile.js:16`, `src/main/browser.js:64,177,742,791,820,1008,1949`, `src/renderer/shell.js:40-61`, `src/renderer/pages/settings.html:132-155`

- [ ] Keep `#35c4ff`, `#8b7bff`, `#3ddc84`, `#ffb020`, and `#ff6b9d` as accent presets unless the exported nof1 JSON specifies different presets.
- [ ] Do not replace account colors or tab-group colors with the main accent; they are identity colors and must remain distinguishable.
- [ ] Define contrast-safe `--accent-ink` calculation or approved preset pairings. A user-selected accent must never produce unreadable primary button text.
- [ ] Keep accent usage limited to focus rings, active rails, primary actions, selected rows, progress, and small status indicators.
- [ ] Avoid accent background washes above roughly 14% alpha except for selected state surfaces.
- [ ] Add a settings contrast check for all presets in light and dark themes.

## Phase 5: Quality, Accessibility, and Regression

### Testing checklist

- [ ] Run `npm test`.
- [ ] Run `npm run test:self` when an Electron display is available.
- [ ] Verify new tab, settings, history, bookmarks, downloads, extensions, and accounts at 320px, 600px, 900px, and desktop widths.
- [ ] Verify horizontal and vertical tab layouts.
- [ ] Verify theme switching in shell, internal page, context menu, and snip overlay.
- [ ] Verify every accent preset in light and dark mode.
- [ ] Verify focus-visible rings on keyboard-only navigation.
- [ ] Verify reduced-motion mode disables non-essential animation.
- [ ] Verify disabled, hover, active, loading, error, success, and destructive states.
- [ ] Verify text contrast against the paper surfaces and translucent overlays.
- [ ] Verify no hardcoded old graphite values remain outside intentional overlay scrims and semantic colors.
- [ ] Run a color-token grep after implementation for `#0a0a0c`, `#131317`, `#17171c`, and duplicated white alpha borders.

## Files Changed Summary

| File | Planned changes | Risk |
|---|---:|---|
| `assets/page-theme.css` | Canonical nof1 tokens, typography, cards, controls, states | High |
| `assets/page-theme.js` | Shared theme/accent application | Medium |
| `src/renderer/shell.css` | Chrome parity, paper surfaces, controls, overlays, AI sidebar | High |
| `src/renderer/shell.js` | Token names, default accents, avatar styling | Low |
| `src/renderer/shell.html` | Shared class names and accessibility labels | Low |
| `src/renderer/pages/newtab.html` | Migrate inline styles and AI surface | Medium |
| `src/renderer/pages/settings.html` | Tokenized theme preview and utilities | Medium |
| `src/renderer/pages/history.html` | Shared list/avatar styling | Low |
| `src/renderer/pages/bookmarks.html` | Shared list/avatar styling | Low |
| `src/renderer/pages/downloads.html` | Semantic warning token and shared rows | Low |
| `src/renderer/pages/extensions.html` | Shared extension rows and status surfaces | Low |
| `src/renderer/pages/accounts.html` | Remove inline styles and tokenize avatars | Medium |
| `src/renderer/ctxmenu.html` | Shared overlay token contract | Medium |
| `src/renderer/snip.html` | Shared overlay token contract and reduced motion | Medium |
| `src/main/profile.js` | Accent defaults only if exported nof1 JSON requires it | Medium |
| `src/main/browser.js` | Accent/avatar defaults only if token migration changes defaults | Medium |

## Dependency Order

1. Obtain/export the actual `nof1` skin JSON and reconcile the proposed token values.
2. Create the canonical token aliases in `assets/page-theme.css`.
3. Update page bootstrap and verify theme/accent propagation.
4. Migrate shell chrome and overlays.
5. Migrate the new-tab page, because it contains the largest inline style surface.
6. Migrate the remaining internal pages and remove inline styles.
7. Tokenize `ctxmenu.html` and `snip.html`.
8. Run visual, interaction, accessibility, and reduced-motion checks.
9. Run `graphify update .` after the code changes and inspect the updated graph.

## Migration Notes

- **Breaking changes:** none intended. Preserve existing class names and IPC contracts.
- **Deprecations:** remove duplicated token names only after all consumers use the shared aliases.
- **New additions:** canonical paper/ink/surface aliases, shared status colors, shared avatar class, and shared action/button classes.
- **Preserve:** user accent selection, account colors, tab-group colors, extension icons, favicon fallbacks, and all keyboard behavior.
- **Potential conflict:** the current shell treats dark as the implicit default while the page system names tokens with a `p` prefix. Resolve this before changing defaults; otherwise pages and chrome can disagree after a failed state load.

## Acceptance Criteria

- [ ] Every browser-owned surface reads as the same nof1 visual system.
- [ ] The shell, internal pages, context menu, and snip overlay use the same semantic tokens.
- [ ] The result feels paper-like, modern, minimal, premium, and polished rather than a collection of themed pages.
- [ ] Existing accent colors remain visible but restrained.
- [ ] All existing browser functionality and IPC behavior remains intact.
- [ ] No stale old-theme literals remain except intentional scrims, image processing, or semantic recording colors.

---
Generated by opencode-reskin | Skin: nof1 v1.0.0 | Token JSON not supplied in request
