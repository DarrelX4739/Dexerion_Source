# Preview fullscreen, Fix with AI, and longer context

Post-ship polish on the latest source. Verified with the full Playwright suite:
**7/7 passed** (`e2e-final-after-all-changes.log`).

## 1. Previews can fill the whole screen

Previously a site or report preview was bounded to the tab page area: the
204px rail, the browser toolbar and the 480px AI sidebar were all left in
place, so the preview only covered part of the window and there was no
fullscreen path.

- `src/main/browser.js` — `overlayViewBounds()` returns the full window
  content bounds when an overlay is in fullscreen; `layout()` and both
  overlay-open paths use it. Entering fullscreen maximizes the window;
  `exitOverlayFullscreen()` restores the exact prior bounds/maximized state,
  including when the preview is closed or moved to a tab.
- New IPCs: `dex:overlay-fullscreen`, `dex:overlay-fullscreen-state`.
- `src/renderer/pages/artifact.html`, `report.html` — a `Fullscreen`
  button in the overlay bar toggles it (label becomes `Exit fullscreen`).
  `Esc` leaves fullscreen first, then closes the preview.
- E2E (`artifacts.spec.js`) proves the button is present in the overlay,
  that docked bounds have a gutter, that fullscreen bounds start at 0,0 with
  the window maximized and cover the full content area, and that exiting
  restores the gutter.

## 2. "Fix with AI" error

`Fix with AI` injects a repair ask containing the words "website checker"
and "whole site". `site-intent.js` excluded any message containing a strong
site noun from its modification branch, so the detector returned `null` and
the repair fell into the generic skill loop — where it produced prose, a
consent card, or a rejected `revise_artifact` proposal instead of a repaired
site.

- `src/main/site-intent.js` — an existing site plus a modification signal now
  routes to `revise_artifact` even when the ask names a website. Fresh
  requests ("build a new website") still win via `NEW_REQUEST`.
- `src/renderer/ai-sidebar.js` — a missing chat/index now shows a visible
  hint instead of failing silently.
- E2E (`artifacts.spec.js`, new test) actually clicks the health strip's
  `Fix with AI` button and asserts a second site artifact comes back with the
  repair prompt preserved.

## 3. Longer, stickier AI context

Chat used a flat 12,000-character budget and a 40-turn window; older turns
were dropped with no summary, and tool results could consume the whole
budget. Search follow-ups kept only 6 turns.

- `src/main/ai.js` — conversation budget scales with the model window up to
  60,000 chars; wire window raised to 80 turns; normal per-message and
  tool-result caps raised to 16,000 chars.
- `src/main/browser.js` / `ai-agent.js` — main chat and agent keep 80 turns.
  The chat's original substantive user goal is injected as a compact
  `Conversation focus` system note on every turn, surviving budget trimming.
- `src/main/ai-prompts.js` — explicit stay-on-thread rule in the persona.
- AI Search planner/synthesis and renderer keep 12 turns (1,500 chars each)
  instead of 6 × 900.

## Gate

`playwright test`: **7 passed**, including all six pre-existing suites and
the two new regression tests. No renderer errors, and the installed-app
real-AI smoke test was rerun after the installer rebuild.
