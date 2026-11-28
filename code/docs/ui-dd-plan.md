# UI-DD browser design plan

**Goal:** Make the browser quieter and easier to scan without replacing Dexerion’s identity or changing how anything works. This is browser presentation work only; the custom Windows installer is separate. Keep the original palette, backgrounds, skin files, shortcuts, rail behavior, and renderer/main-process logic. Work only on `UI-DD`.

## 1. What to take from Arc and Zen

| Review or feedback | Lesson for Dexerion |
| --- | --- |
| [The Verge: Arc browser review](https://www.theverge.com/23462235/arc-web-browser-review) likes vertical organization but describes learning a new vocabulary for familiar browser tasks. | Clarify the groups users already have. Don't introduce Spaces, favorites tiers, automatic archiving, or new gestures. |
| [Tom’s Guide: using Arc in place of Chrome](https://www.tomsguide.com/opinion/i-almost-ditched-chrome-for-the-arc-web-browser-heres-why) found distinct sidebar sections helpful after initially adjusting to the new layout. | Give the rail a visible rhythm: groups should read as headings, their members as a set, and the active tab as a distinct state. Keep existing labels. |
| [Four months using Zen](https://blog.shuochen.me/en/articles/zen-browser/) values the compact sidebar’s screen space and vertical organization. [Zen user feedback](https://www.reddit.com/r/zen_browser/comments/1vhdlrg/looking_for_feedback_for_the_latest_release/) discusses differing expectations for compact hover behavior; [another Zen user asks to keep the URL bar on top](https://www.reddit.com/r/zen_browser/comments/1rbtrpe/how_can_i_move_the_url_bar_from_the_sidebar_to/). These are examples, not a consensus. | Keep both rail widths, existing reveal timing, and the familiar top address bar. Don't make navigation depend on hovering. |
| [Apple’s toolbar guidance](https://developer.apple.com/design/human-interface-guidelines/toolbars) recommends grouping related items. [WCAG’s target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) gives 24 CSS pixels as a useful minimum benchmark, with exceptions. | Keep navigation, address/security, and tools in familiar positions. Use spacing rather than decorative separators. Preserve the 32px toolbar targets and the 24px close target from the first geometry pass. |

## 2. Implementation sequence

1. **Rail and groups.** Give expanded group headers and their counts a stable alignment. Inset group-member content without shrinking the hit area. Set a clearer active marker in both rail states using its existing color. Don't reveal extra labels or badges in compact mode merely to fill space.
2. **Navigation.** Separate the leading navigation trio, the address/security area, and the trailing tools with unequal gaps; retain their order, hit sizes, and keyboard access. At smaller widths, give the address field back that extra space instead of hiding a button or changing the suggestion anchor logic.
3. **Secondary surfaces.** Match menu labels and rows on an alignment grid, harmonize focus timer/task utility shapes, and refine the hierarchy of Welcome, New Tab, and internal search rows. Use the styling already present rather than adding panels, gradients, font assets, or animation.
4. **Compare and verify.** Use the restored appearance as the palette baseline, compare the first geometry pass with this iteration, and remove refinements that make text harder to scan or controls harder to hit.

## 3. Acceptance checks

- Only CSS and this plan change. No JS, HTML, tokens, brand assets, skins, timings, or new paint values.
- Check unchanged computed colors and background paint in both themes. Directly compare at least one alternate skin.
- Verify 48px collapsed / 204px expanded rail and 52px toolbar, 32px toolbar controls, and 24px tab close control. Check narrow and wider viewports and a higher pixel density where tooling allows.
- Use the actual renderer with a test bridge for group toggle, rename, keyboard focus, drop routing, tab close/new, omnibox search, bookmarks, Welcome, and New Tab. Check no new errors versus baseline. Treat native window/overlay behavior as unverified unless tested in Electron.
