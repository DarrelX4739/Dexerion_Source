# Report table borders — fix

## Symptom

A table inside a report was visibly a table in the chat card (borders, shaded
header), but the same report opened in the dedicated viewer showed a plain,
borderless grid. Markdown pipe tables were affected too.

## Root cause (two gaps, one decisive)

1. **Scoped tokens.** `assets/ai-artifacts.css` declares the whole `--dxa-*`
   token set (`--dxa-hair`, `--dxa-bg2`, …) on `.dxa-card` only. The chat card
   has that wrapper, so `border: 1px solid var(--dxa-hair)` resolved. The
   standalone report viewer calls `DexArtifacts.renderBody()` straight into
   `#wrap` with no `.dxa-card`, so `--dxa-hair` was undefined, the whole
   `border` declaration became invalid, and computed border width was `0px`.
   This affected *every* bordered artifact block in the viewer, not just tables.
2. **No `.md-table` rules.** GFM pipe tables parsed by `DexMarkdown` produce
   `<table class="md-table">`. Only `shell.css` (loaded by the chat shell)
   styled that class; `report.html` does not load `shell.css`, so those tables
   fell back to browser defaults.

## Fix

- `assets/ai-artifacts.css`
  - Declare the `--dxa-*` tokens on `:root` as well (the chat card keeps its
    local copy for scoped shell themes). All token usage is confined to this
    file, so app chrome is unaffected.
  - Add `.md-table-wrap` / `.md-table` rules matching the structured
    `.dxa-table` visual language, using theme-aware `--dxa-hair`.
- `assets/ai-markdown.js` — wrap generated markdown tables in `.md-table-wrap`
  so wide ones scroll instead of clipping.
- `src/main/ai-artifacts.js`, `assets/ai-artifacts.js` — table normalizers now
  accept `headers`/`header`/`head` and `data`/`body` aliases plus object rows,
  instead of silently dropping an otherwise valid table.
- `src/main/report-system-prompt.js`, `src/main/ai-artifacts.js` — prompts now
  spell out the exact `{columns, rows}` shape (2–6 short headers, one cell per
  column, no pipe syntax or HTML inside the JSON).

## Verification

New E2E `code/build/e2e/report-tables.spec.js` generates a report containing
both a structured table block and a markdown pipe table, opens it in the real
overlay viewer, and asserts computed `border-collapse`, cell border widths,
wrapper border, scroll wrapper and shaded header on both.

Full gate: **8 passed** (`e2e-report-tables-final.log`).
