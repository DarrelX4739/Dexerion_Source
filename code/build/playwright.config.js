'use strict';
// E2E harness for Dexerion. Tests launch the real Electron app (see e2e/app.js)
// against a local NIM mock, so no browser binaries and no network are needed.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  // These specs drive the real Electron app. A cold launch on a busy Windows
  // machine (measured: shell DOMContentLoaded 12-15 s here, see
  // scripts/perf.js) eats most of a short budget before the first assertion, so
  // each test gets five minutes; the individual waits keep their own timeouts.
  timeout: 300000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'off' },
});
