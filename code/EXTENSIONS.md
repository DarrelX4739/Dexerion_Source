# Dexerion V1 — Extension support & limitations

## Supported (via Chromium's native extension engine)

- Loading **unpacked** extensions (`dexerion://extensions` → Load unpacked):
  reads `manifest.json`, validates, `session.loadExtension`, starts background
  service workers, injects content scripts, enables `chrome.*` APIs per manifest.
- Management page: icon, name, description, version, enabled state, details,
  reload, remove, unpacked error display.
- Toolbar: one button per enabled extension → opens its popup.
- Manifest V3 fully; Manifest V2 where the underlying Chromium still supports it.
- Tested APIs (through Chromium, not fakes): `tabs`, `storage`, `runtime`,
  `scripting`, `commands`, `contextMenus`, `cookies`,
  `webNavigation`, content scripts, extension pages, popups, service workers.
  `notifications` and `sidePanel` are best-effort (Electron does not expose
  those manifest permissions; sidePanel-style extensions still load and their
  popups/pages work, but the docked side panel is a tracked future feature).
- Loading also accepts a **folder, .zip or .crx** in one picker.

## Context-menu limitation

Dexerion renders right-click menus as its own styled popups (native OS menus
cannot match the UI). Extension-contributed `chrome.contextMenus` entries are
therefore not merged into Dexerion's page menu in V1 — the underlying
`chrome.contextMenus` API still registers without errors where Chromium
supports it. Merging extension items into the custom menu is tracked future work.
- Security: permissions enforced by Chromium (manifest-declared permissions,
  origin isolation, content-script isolated worlds, sandboxing).

## Chrome Web Store

Flow: open the item page in Dexerion → banner “Install in Dexerion”, or paste
the URL at `dexerion://extensions` → Dexerion fetches the CRX via Google's
update service (`clients2.google.com/service/update2/crx`) and loads it.

**Known limitations (Google-side, unavoidable for third-party browsers):**
1. Google may rate-limit/block automated CRX fetches, or require sign-in /
   licensing checks for some items. Dexerion surfaces the exact HTTP error
   instead of pretending success.
2. `chrome.webstore.install()` inline-install API only works in official
   Chrome. Dexerion replaces it with the download-and-load flow above.
3. Fallback: download the extension `.zip`/`.crx` from the developer → use
   “Install from .crx / .zip” or “Load unpacked”.

## Test record

See `scripts/smoke.js` and the V1 test log. `test-extensions/hello-mv3`
covers popup, content script, service worker, storage, permissions,
reload, remove.
