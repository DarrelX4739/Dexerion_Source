# Stock Dexerion full-app compatibility baseline

The Windows RAM A/B measured a separate minimal Electron fixture; this script
establishes the existing Dexerion behavior before anyone evaluates an approved
product change. It does **not** change sandbox settings, change the app, run
Edge or measure a RAM reduction. Playwright attaches locally to locked Electron
44.4.5, which launches the repository's `electron .` app entry with a new
profile and no sandbox, site-isolation, or web security bypass flags.

The app itself loads a fixture MV3 extension restored from its regular
persisted profile format. Its only content script marks two loopback test
origins. A real page submits a synthetic credential through Dexerion's injected
capture helper and the normal shell Save button, then a new tab autofills
both fields. Different origins and a second account must not receive the
credential or local storage. The real app's allowlisted opener routing
opens a same-origin auth-style popup with a live opener and shared account
storage; the expected existing denial of credential access from plain popup
contents is checked. No third-party authentication, credentials, extension
store or actual user profile is involved. Only booleans and the two exact PID
sandbox metric *observations* and single-process working sets are reported;
working sets may be shared and must not be summed or compared to the prior
private-resident result.

From the repository root after `cd code/build && npm ci`:

```powershell
$env:DEX_RAM_REQUIRE_WINDOWS_SANDBOX_METRIC = '1'
$env:DEX_RAM_EXPECT_WEB_SANDBOX = '0'
node --test experiments/full-app-ram/full-app-baseline.test.cjs
node experiments/full-app-ram/full-app-baseline.cjs
```

The `DEX_RAM_EXPECT_WEB_SANDBOX` input is an assertion, not a product switch.
A non-Windows run can verify behavior without the Windows-only OS sandbox
metric if the desktop host permits Unix sockets. This branch-only GitHub
workflow expects the current Windows sandbox behavior and fails on a missing
or inconsistent metric. It does not build a package, push code, or release.
