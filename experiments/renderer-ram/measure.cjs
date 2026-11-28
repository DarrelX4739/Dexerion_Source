'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');
const root = path.resolve(__dirname, '../..');
const executable = require(path.join(root, 'code/build/node_modules/electron'));
const snapshot = path.join(root, 'code/build/scripts/measure-tree-snapshot.ps1');
const { fourArmOrder, verifiedNativeTree } = require(path.join(root, 'code/build/scripts/measure-sample-guard.cjs'));

async function waitFor(read, ms) {
  const end = Date.now() + ms;
  do { const value = read(); if (value) return value; await sleep(100); } while (Date.now() < end);
  throw new Error('Timed out waiting for fixture');
}
async function observe(kind) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-renderer-ram-'));
  fs.mkdirSync(path.join(dir, 'profile'));
  const child = spawn(executable, [path.join(__dirname, 'electron.cjs'), kind, '--ram-control=' + dir], {
    stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true,
  });
  let errors = '';
  let exited;
  child.stderr.on('data', (s) => { errors = (errors + s).slice(-8000); });
  child.once('error', (error) => { exited = { error: error.message }; });
  child.once('exit', (code, signal) => { exited = { code, signal }; });
  try {
    const ready = await waitFor(() => {
      if (exited) throw new Error('Electron quit before ready: ' + JSON.stringify(exited) + '\n' + errors);
      const file = path.join(dir, 'ready.json');
      return fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8'));
    }, 60000);
    assert.equal(ready.appPid, child.pid);
    assert.equal(kind, Number(ready.sandbox) + ':' + ready.count);
    assert.equal(ready.bridgeChannels, 3);
    assert.equal(ready.visible, 'visible');
    assert.equal(ready.tabs.length, ready.count);
    await sleep(8000);
    const samples = [];
    for (let i = 0; i < 3; ++i) {
      const data = JSON.parse(execFileSync('powershell.exe', [
        '-NoProfile', '-File', snapshot, '-IncludePrivateWorkingSet',
      ], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 30000 }));
      const { rows, unknownParentReferences } = verifiedNativeTree(data.processes, child.pid,
        (p) => p.cmdline?.includes(dir) && /electron\.exe$/i.test(p.name));
      assert.equal(unknownParentReferences, 0);
      assert.equal(new Set(ready.tabs.map(t => t.pid)).size, ready.count);
      for (const row of rows) assert(Number.isFinite(row.privateWsBytes) && row.privateWsBytes > 0);
      const tabs = ready.tabs.map(({ pid }) => {
        const row = rows.find((r) => r.pid === pid && /--type=renderer(?:\s|$)/.test(r.cmdline ?? ''));
        assert(row, 'Missing verified renderer PID ' + pid);
        return { pid, startedUtc: row.startedUtc, privateWsBytes: row.privateWsBytes };
      });
      if (samples.length) assert.deepEqual(tabs.map(t => t.startedUtc), samples[0].tabs.map(t => t.startedUtc));
      samples.push({ tabs, privateRendererBytes: tabs.reduce((n, t) => n + t.privateWsBytes, 0),
        privateTreeBytes: rows.reduce((n, row) => n + row.privateWsBytes, 0) });
      if (i < 2) await sleep(1200);
    }
    return { kind, electron: ready.electron, chromium: ready.chromium, samples };
  } finally {
    if (!exited) {
      fs.writeFileSync(path.join(dir, 'stop'), '');
      try { await waitFor(() => exited, 6000); } catch { child.kill(); await waitFor(() => exited, 4000); }
    }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
  }
}
function median(xs) { return [...xs].sort((a,b) => a-b)[Math.floor(xs.length / 2)]; }
(async () => {
  const arms = ['0:1', '1:1', '0:9', '1:9'];
  const rounds = [];
  for (let i = 1; i <= 4; ++i) {
    const order = fourArmOrder(arms, i, 0);
    const trials = [];
    for (const kind of order) {
      const row = await observe(kind);
      row.privateRendererMiB = median(row.samples.map(x => x.privateRendererBytes)) / 2**20;
      row.privateTreeMiB = median(row.samples.map(x => x.privateTreeBytes)) / 2**20;
      trials.push(row);
      console.log(JSON.stringify({ round: i, kind, privateRendererMiB: row.privateRendererMiB, privateTreeMiB: row.privateTreeMiB }));
    }
    rounds.push({ i, order, trials });
  }
  fs.writeFileSync(process.argv[2], JSON.stringify({ rounds, host: os.release(), method:
    'Same host and Electron binary; shipping preload; synthetic loopback pages; three private working-set samples; not a production browser or Edge benchmark.' }, null, 2));
})().catch((e) => { console.error(e.stack); process.exitCode = 1; });
