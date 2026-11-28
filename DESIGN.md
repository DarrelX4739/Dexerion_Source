# Dexerion design

## Browser chrome

The webpage is the main surface. The vertical rail works as its index. The selected tab has one filled row, a stronger title and a squared neutral key on the page edge. Group membership has a separate thin leading seam in the existing group color. Use disclosure, the group name and the count to keep group structure readable independently of color. Keep New Tab visible while scrolling, with a label in the expanded default rail and its icon in the compact rail.

Use dark monochrome surfaces, restrained borders and SC Teal (#1F6F6B) for intentional product branding. Use the original logo on the dark Welcome page. Keep saved accent and skin selection semantics. A selected tab and keyboard focus remain legible with a low-contrast saved accent or in grayscale.

The toolbar uses separate 32px buttons and a recessed persistent address field. Keep control order and popup anchors on their existing elements. At widths where the controls exceed available space, the default toolbar can scroll horizontally so the address field and buttons keep separate hit areas. Keep the wider layout and each alternate skin's established sizing. Use solid menu and editor surfaces, square swatches with a visible selection ring, and distinct drag indicators. A solid horizontal rule shows insertion and a dashed rectangle shows grouping. Keep the native click and drag handlers as the source of these states.

Dexi marks the existing AI toolbar button and the empty conversation. The button uses a head crop and the empty conversation uses a full idle pose from the supplied Dexi Robot Pixel Art Sprite Atlas. Both assets are static, retaining the original expression and teal details. Keep the accessible name on the control and the image decorative. The primary Dexerion mark remains the product logo.

## References

- Use stable sidebar hierarchy and explicit disclosure. [Arc tour](https://www.youtube.com/watch?v=sKUdS1LUzhs) · [Arc pinned tabs](https://resources.arc.net/hc/en-us/articles/19231060187159-Pinned-Tabs-Tabs-you-want-to-stick-around)
- Keep content central and preserve a stable chrome footprint. [Zen Compact Mode](https://docs.zen-browser.app/user-manual/compact-mode)
- Keep navigation and tab actions readable and discoverable. [Dia changelog](https://www.diabrowser.com/changelog) · [Opera vertical tabs](https://blogs.opera.com/news/2026/09/opera-turns-vertical-tabs-upside-down/)
- Preserve familiar location and search, plus established keyboard routes. [Safari Search](https://support.apple.com/guide/safari/search-sfria1042d31/mac) · [Chrome shortcuts](https://support.google.com/chrome/answer/157179) · [Edge shortcuts](https://support.microsoft.com/en-us/edge/keyboard-shortcuts-in-microsoft-edge)
- Give grouping a cue distinct from moving between rows. [Vivaldi tab stacks](https://help.vivaldi.com/desktop/tabs/tab-stacks/)

## Review gates

1. Capture the exact baseline with at least 15 mixed tabs. Measure complete rows before scrolling on expanded, compact and short views.
2. Inspect matched rail and branded-page captures. Preserve full-row hit targets and test long and duplicate titles, loading, sleeping and pinned fixtures.
3. Launch address, menu, toolbar and editor states. Check independent controls, swatches and bookmark height.
4. Check normal text at 4.5:1 and meaningful focus indicators at 3:1. Test keyboard, mouse, reorder versus grouping, light and alternate skins, reduced motion and forced colors. Use 1200×800, 760×510, 600×390 and 480px where supported. The default geometry is a 48px or 204px rail, a 52px toolbar and a 30px bookmark bar.
5. Run matched repeated baseline and candidate measurements for startup, New Tab, tab switching, rail expansion, long-list scrolling, drag and idle CPU/memory. Review visual evidence independently. Record separately any native window, popup, accelerators or performance gate that the renderer fixture cannot exercise.

## UI-DD review history

Base `cfe8aca4edd3f8e2a2c7548357c40bca4a2d79e1` restored the prior browser presentation. Astra High established the approved direction and captured the first two visual milestones. Darrel directed the implementation to continue on GPT-6.2 Sol for this task to conserve usage. The baseline has a 248px group editor beside a 204px rail and can lose keyboard focus when group disclosure rebuilds the list. Keep those baseline observations separate from candidate regressions.
