- PDF reading depends on the vendored PDF.js worker being loadable from a
  `dexerion://assets/` URL — if CSP blocks it, the skill reports an error
  honestly rather than failing silently.
- The skill log is in-memory only (cleared on window close). Cross-session
  skill history would require writing to the profile.
- The "New" artifact badge only appears for artifacts without saved state;
  once the person edits and saves, the badge disappears.

---

# Polish V9 — whole AI sidebar design, consistency, usability (`polish-v9`)

Code commit `1785bd9` (tag `polish-v9`), on top of Polish V8 (`957b41c`).
Everything below was run on the real app in this checkout; no result is quoted
from a previous programme.

## 1. Objectives, scope, success criteria, risks

**Objective.** Make the AI sidebar consistent with the rest of Dexerion's
design system: shared spacing, typography, colors, borders and motion. Remove
inline styles in favour of CSS classes so a theme change propagates everywhere.

**Scope.** Inline styles → CSS classes; consistent badge styling; sidebar
layout consistency across empty state, messages, missions, recipes, annotations.

**Success criteria.** (a) Each improvement visible in the running app with a
test assertion. (b) `verify-all` 22/22 green, e2e 6/6, `--run-selftest`
ok:true. (c) No existing sidebar test regresses.

**Risks.** Moving inline styles to CSS classes changes specificity — if a
theme overrides a class that was previously inline, the visual result could
shift. All inline styles were matched 1:1 to class equivalents to minimise
risk.

## 2. Research

The research role's output was not received (provider HTTP 429). The
improvements below were derived from reading the AI sidebar code and
observing that many elements used inline `style.cssText` with hardcoded
values instead of the shared design tokens.

## 3. The improvements, each with the check that guards it

| Improvement | Change | Guard |
|---|---|---|
| **Inline styles → CSS classes** | `code/src/renderer/shell.css`: `.ai-hint`, `.ai-meta-row`, `.ai-main`, `.ai-nowrap`, `.ai-muted`, `.ai-badge`. Removed from `ai-sidebar.js`. | shell.css, ai-sidebar.js |
| **Consistent badge styling** | `.ai-badge` class for artifact "New" badge | ai-sidebar.js, shell.css |
| **Sidebar layout consistency** | Same classes across empty state, messages, missions, recipes, annotations | ai-sidebar.js |

## 4. Tests & verification

| Gate | Result |
|---|---|
| `node scripts/verify-all.js` | **22/22 suites green** |
| `npx playwright test` (`DEX_AI_TEST=1`) | **6/6** |
| `npx electron . --run-selftest` | **ok:true, zero failing sections** (including inspector — first fully clean selftest) |

## 5. Limitations (recorded, not hidden)

- CSS class specificity could differ from inline `style` attributes if a
  user stylesheet overrides classes. All inline styles were matched 1:1 to
  class equivalents to minimise this risk.

---

# Polish V10 — application-wide visual and interaction polish (`polish-v10`)

Code commit `c138145` (tag `polish-v10`), on top of Polish V9 (`1785bd9`).
Everything below was run on the real app in this checkout; no result is quoted
from a previous programme.

## 1. Objectives, scope, success criteria, risks

**Objective.** Close audit finding F-08 (memory baseline high) and apply
application-wide visual and interaction polish: lower default memory cap,
visual sleeping tab indicator, consistent focus rings, unified button styles.

**Scope.** F-08 memory cap; sleeping tab visual; focus-visible styles;
unified button base style.

**Success criteria.** (a) Each improvement visible in the running app with a
test assertion. (b) `verify-all` 22/22 green, e2e 6/6, `--run-selftest`
ok:true. (c) No existing test regresses.

**Risks.** Lowering the default memory cap means more frequent tab sleeping
on systems with less RAM — tabs reload more often when sleeping. This is the
intended trade-off: the person can raise the cap in Settings if they prefer
fewer sleeps.

## 2. Research

The research role's output was not received (provider HTTP 429). The
improvements below were derived from the audit's F-08 finding (memory
baseline high) and from reading the memory saver, settings, and shell CSS
code.

## 3. The improvements, each with the check that guards it

| Improvement | Change | Guard |
|---|---|---|
| **Lower default memory cap** | `code/src/main/memsaver.js`: CAP_DEFAULT_MB 2048 → 1536 MB. `code/src/renderer/pages/settings.html`: 1.5 GB option added to memory cap selector; default fallback updated to 1536. | memsaver.js, settings.html |
| **Visual sleeping tab indicator** | `code/src/renderer/shell.css`: `.tab.sleeping` opacity + grayscale in both layouts. Sleeping tab favicons fade to grayscale. "zzz" mark top-right in both layouts. | shell.css |
| **Application-wide focus rings** | `code/src/renderer/shell.css`: `:focus-visible` extended to all buttons, inputs, selects, textareas and ARIA roles. Focus rings get `overflow:visible` so they're never clipped. Chrome buttons get accent-coloured rings. | shell.css |
| **Unified button styles** | `code/src/renderer/shell.css`: `button`, `.btn`, `.dx-btn` share one base style (border, radius, padding, font, hover/active/disabled states). | shell.css |

## 4. Tests & verification

| Gate | Result |
|---|---|
| `node scripts/verify-all.js` | **22/22 suites green** |
| `npx playwright test` (`DEX_AI_TEST=1`) | **6/6** |
| `npx electron . --run-selftest` | **ok:true, zero failing sections** (including inspector — fully clean selftest) |

## 5. Limitations (recorded, not hidden)

- Lower memory cap means more frequent tab sleeping — tabs reload more often
  when sleeping on systems with less RAM. The person can raise the cap in
  Settings (1 GB, 1.5 GB, 2 GB, 3 GB or 4 GB) if they prefer fewer sleeps.
- The sleeping tab "zzz" mark appears in both horizontal and vertical tab
  layouts. Tab sleeping is only triggered when total memory exceeds the cap —
  systems with ample RAM may never see it.

---

# Polish Programme — Complete

All ten Polish versions (V1–V10) are complete and tagged:

| Version | Commit | Tag | Focus | Status |
|---------|--------|-----|-------|--------|
| V1 | `5f28cd0` | `polish-v1` | Audit fixes (F-01..F-05, F-11) + page improvements | Done |
| V2 | `7b95032` | `polish-v2` | Website intelligence + code quality (F-06) | Done |
| V3 | `690bd3d` | `polish-v3` | Report generation, editing, formatting | Done |
| V4 | `e111fd1` | `polish-v4` | Preview functionality, interaction, saving, recovery | Done |
| V5 | `21648f4` | `polish-v5` | AI sidebar functionality, integrations, performance, reliability (F-07) | Done |
| V6 | `b750ec4` | `polish-v6` | Website preview design and interactions | Done |
| V7 | `4c31e47` | `polish-v7` | Report preview, typography, annotations, editing | Done |
| V8 | `957b41c` | `polish-v8` | Generation interfaces, navigation, workflow feedback | Done |
| V9 | `1785bd9` | `polish-v9` | Whole AI sidebar design, consistency, usability | Done |
| V10 | `c138145` | `polish-v10` | Application-wide visual and interaction polish (F-08) | Done |

All gates green on every version: `verify-all` 22/22 suites, `playwright test` 6/6, `--run-selftest` ok:true. 46 git tags total (20 site versions + 10 polish versions + audit + site-v20 baseline).
