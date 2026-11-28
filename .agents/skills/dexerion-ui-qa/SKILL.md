---
name: dexerion-ui-qa
description: Reproduce and verify Dexerion browser chrome, tab rail, native overlays, themes, screenshots and Dexi identity changes.
---

Read the root AGENTS.md and DESIGN.md. Work on the requested branch and capture baseline and candidate states at the same viewport, theme and saved accent.

- Prefer a disposable native app profile for chrome over web content. Renderer fixtures can verify component layout, keyboard and IPC intent. Native child-view stacking must be checked in Electron.
- Set the project Playwright MCP to a disposable browser and local fixtures. The repository's Playwright harness is also available. Use screenshots and computed bounds together.
- For a rail overlay, check both rail widths, collapse during edit, click and keyboard dismissal, and narrow or short windows. Menus must fit their owning surface.
- Use the existing colour and spacing tokens. Keep selection readable with row fill and text as well as an accent. Preserve custom group colours and keyboard focus visibility.
- Use the checked-in Dexi face or idle pose at the intended scale. Reserve the idle pose for large placements, the face for small chrome, and keep identity artwork static.
- Compare the exact view reported by the user. Record fixture-only and unverified native behaviour in the handoff.
