'use strict';
// Standalone runner for the deterministic 20,000-scenario intensive suite.
//
// It invokes only the real Electron e2e spec. e2e/app.js allocates a unique
// throwaway --user-data-dir per round and never touches %APPDATA%\Dexerion.
// Nothing here kills Electron processes or changes app/source files.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const BUILD_DIR = path.resolve(__dirname, '..');
// Playwright clears `test-results` on every run, so the durable log lives in
// its own directory.
const LOG_DIR = path.join(BUILD_DIR, 'e2e-logs');
const LOG_PATH = path.join(LOG_DIR, 'intensive-e2e.log');
const CLI = path.join(BUILD_DIR, 'node_modules', '@playwright', 'test', 'cli.js');
const SPEC = 'e2e/nextgen-intensive.spec.js';

const EXPECTED_ROUNDS = 20;
const EXPECTED_PER_ROUND = 1000;
const EXPECTED_TOTAL = 20000;

fs.mkdirSync(LOG_DIR, { recursive: true });
fs.writeFileSync(LOG_PATH, '', 'utf8');

const started = Date.now();
let captured = '';
let logStream;

function relay(chunk, stream) {
  const text = chunk.toString('utf8');
  captured += text;
  if (stream) stream.write(text);
  else process.stdout.write(text);
  try { fs.appendFileSync(LOG_PATH, text, 'utf8'); } catch {}
}

function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes + 'm ' + String(seconds).padStart(2, '0') + 's (' + ms + ' ms)';
}

function roundMarkers() {
  const markers = [];
  const re = /INTENSIVE E2E ROUND (\d{2}): (\d+)\/(\d+) PASS/g;
  let match;
  while ((match = re.exec(captured)) !== null) {
    markers.push({ round: Number(match[1]), passed: Number(match[2]), expected: Number(match[3]) });
  }
  return markers;
}

function failureIds() {
  const ids = new Set();
  const re = /SCENARIO FAIL (R\d{2}-[A-Z0-9]+-\d{3})/g;
  let match;
  while ((match = re.exec(captured)) !== null) ids.add(match[1]);
  return [...ids].sort();
}

function finishLine(text) {
  process.stdout.write(text + '\n');
  try { fs.appendFileSync(LOG_PATH, text + '\n', 'utf8'); } catch {}
}

if (!fs.existsSync(CLI)) {
  finishLine('INTENSIVE E2E RUNNER ERROR: Playwright CLI not found at ' + CLI);
  process.exit(1);
}

logStream = fs.createWriteStream(LOG_PATH, { flags: 'a' });
const child = spawn(process.execPath, [CLI, 'test', SPEC, '--workers=1', '--reporter=list'], {
  cwd: BUILD_DIR,
  env: { ...process.env, FORCE_COLOR: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.on('data', (chunk) => relay(chunk, process.stdout));
child.stderr.on('data', (chunk) => relay(chunk, process.stderr));

child.on('error', (err) => {
  relay('\nINTENSIVE E2E RUNNER ERROR: ' + String(err && err.message || err) + '\n', process.stderr);
});

child.on('close', (code) => {
  if (logStream) logStream.end();
  const elapsed = Date.now() - started;
  const markers = roundMarkers();
  const ids = failureIds();
  const goodRounds = markers.filter((m) => m.round >= 1 && m.round <= EXPECTED_ROUNDS
    && m.passed === EXPECTED_PER_ROUND && m.expected === EXPECTED_PER_ROUND);
  const uniqueRounds = new Set(goodRounds.map((m) => m.round));

  if (ids.length) {
    finishLine('FAILING SCENARIO IDS (' + ids.length + '): ' + ids.join(', '));
  }

  if (code === 0 && uniqueRounds.size === EXPECTED_ROUNDS) {
    finishLine('ALL 20 INTENSIVE E2E ROUNDS PASS — 20000/20000 SCENARIOS');
    finishLine('INTENSIVE E2E TOTAL RUNTIME: ' + formatDuration(elapsed));
    finishLine('INTENSIVE E2E LOG: ' + LOG_PATH);
    process.exitCode = 0;
    return;
  }

  finishLine('INTENSIVE E2E FAILED: exit=' + code
    + ', valid round markers=' + uniqueRounds.size + '/' + EXPECTED_ROUNDS
    + ', runtime=' + formatDuration(elapsed));
  finishLine('INTENSIVE E2E LOG: ' + LOG_PATH);
  process.exitCode = 1;
});
