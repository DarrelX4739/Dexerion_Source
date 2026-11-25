'use strict';
// Full functional E2E smoke: every deterministic spec EXCEPT the 20,000-scenario
// intensive suite (which has its own runner and marker). This proves the app is
// still functionally complete after the V51-V180 UI and debloat work — not just
// visually plausible. All runs use the shared e2e/app.js throwaway-profile
// harness and the local AI mock; the installed/developer profiles are untouched.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const BUILD_DIR = path.resolve(__dirname, '..');
const CLI = path.join(BUILD_DIR, 'node_modules', '@playwright', 'test', 'cli.js');
const RESULT = process.env.FUNCTIONAL_SMOKE_OUT
  || 'C:\\Users\\Darre\\AppData\\Local\\Temp\\opencode\\functional-smoke.json';

const specs = fs.readdirSync(path.join(BUILD_DIR, 'e2e'))
  .filter((name) => name.endsWith('.spec.js') && name !== 'nextgen-intensive.spec.js')
  .sort()
  .map((name) => 'e2e/' + name);

if (!fs.existsSync(CLI)) {
  console.error('FUNCTIONAL SMOKE ERROR: Playwright CLI not found at ' + CLI);
  process.exit(1);
}

let captured = '';
const child = spawn(process.execPath, [CLI, 'test', ...specs, '--workers=1', '--reporter=list'], {
  cwd: BUILD_DIR,
  env: { ...process.env, FORCE_COLOR: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const relay = (chunk, stream) => {
  const text = chunk.toString('utf8');
  captured += text;
  stream.write(text);
};
child.stdout.on('data', (chunk) => relay(chunk, process.stdout));
child.stderr.on('data', (chunk) => relay(chunk, process.stderr));
child.on('error', (err) => {
  console.error('FUNCTIONAL SMOKE ERROR: ' + String(err && err.message || err));
});

child.on('close', (code) => {
  const passed = Array.from(captured.matchAll(/^\s*✓\s/gm)).length;
  const failed = Array.from(captured.matchAll(/^\s*✘\s/gm)).length;
  const result = {
    ok: code === 0,
    marker: code === 0 ? 'FULL FUNCTIONAL SMOKE PASS' : 'FULL FUNCTIONAL SMOKE FAIL',
    specs,
    passed,
    failed,
    exitCode: code,
    generatedAt: new Date().toISOString(),
  };
  try { fs.writeFileSync(RESULT, JSON.stringify(result, null, 2), 'utf8'); } catch {}
  if (code === 0) {
    console.log('FULL FUNCTIONAL SMOKE PASS: ' + passed + ' tests, 0 failed');
    console.log('FUNCTIONAL SMOKE RESULT: ' + RESULT);
  } else {
    console.error('FULL FUNCTIONAL SMOKE FAIL: exit=' + code + ', ' + failed + ' failed');
  }
  process.exitCode = code === 0 ? 0 : 1;
});
