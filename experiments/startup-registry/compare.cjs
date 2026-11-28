'use strict';

// Windows CI diagnostic, not a replacement for the product's registration.
// No real association or application registration key is modified.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const exec = promisify(execFile);
const BASE = 'HKCU\\Software\\DexerionPerformanceScratch\\';
const program = 'C:\\Program Files\\Dexerion Performance Fixture\\Dexerion.exe';

async function productWritePlan(file) {
  const source = fs.readFileSync(file, 'utf8');
  const plan = [];
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, process: { platform: 'win32' },
    require(name) {
      assert.equal(name, 'child_process');
      return { execFile(exe, args, options, complete) {
        assert.equal(exe, 'reg.exe');
        assert.equal(options.windowsHide, true);
        const [operation, key, valueMode, ...tail] = args;
        assert.equal(operation, 'add');
        assert.ok(/^HKCU\\Software\\(?:Classes\\DexerionHTML(?:\\|$)|Clients\\StartMenuInternet\\Dexerion(?:\\|$)|RegisteredApplications$)/.test(key));
        const [typeFlag, type, dataFlag, data, force] = valueMode === '/v' ? tail.slice(1) : tail;
        assert.ok(valueMode === '/ve' || valueMode === '/v');
        assert.deepEqual([typeFlag, type, dataFlag, force], ['/t', 'REG_SZ', '/d', '/f']);
        plan.push({ subkey: key.slice('HKCU\\Software\\'.length), name: valueMode === '/v' ? tail[0] : '', data });
        complete(null, '', '');
      } };
    },
  }, { timeout: 1000, filename: 'pinned-defaultbrowser.js' });
  assert.equal(await module.exports.registerBrowser(program), true);
  assert.equal(plan.length, 16);
  return plan;
}

function scratchKey() { return BASE + randomUUID(); }
function scoped(root, subkey) {
  assert.match(root, /^HKCU\\Software\\DexerionPerformanceScratch\\[a-f\d-]{36}$/);
  assert.match(subkey, /^(?:Classes\\DexerionHTML(?:\\|$)|Clients\\StartMenuInternet\\Dexerion(?:\\|$)|RegisteredApplications$)/);
  return root + '\\' + subkey;
}
function escapeReg(s) { return s.replaceAll('\\', '\\\\').replaceAll('"', '\\"'); }
function importText(root, plan) {
  const groups = Map.groupBy(plan, (p) => p.subkey);
  const lines = ['Windows Registry Editor Version 5.00', ''];
  for (const [key, values] of groups) {
    lines.push('[' + scoped(root, key).replace(/^HKCU/, 'HKEY_CURRENT_USER') + ']');
    for (const item of values) lines.push((item.name ? '"' + escapeReg(item.name) + '"' : '@') +
      '="' + escapeReg(item.data) + '"');
    lines.push('');
  }
  return '\ufeff' + lines.join('\r\n') + '\r\n';
}
const options = { windowsHide: true, timeout: 10000 };
async function originalPlan(root, plan) {
  for (const v of plan) await exec('reg.exe', ['add', scoped(root, v.subkey),
    ...(v.name ? ['/v', v.name] : ['/ve']), '/t', 'REG_SZ', '/d', v.data, '/f'], options);
}
async function oneImport(root, plan, dir) {
  const p = path.join(dir, 'synthetic.reg');
  fs.writeFileSync(p, importText(root, plan), 'utf16le');
  await exec('reg.exe', ['import', p], options);
}
async function nativeHelper(exe, root, plan, mode = 'write') {
  return exec(exe, [root, mode, ...plan.flatMap(({ subkey, name, data }) => [subkey, name, data])], options);
}
async function checkNativeStops(exe, plan) {
  const root = scratchKey();
  try {
    await assert.rejects(nativeHelper(exe, root, plan, 'verify-only'), (error) => error.code === 8);
    await assert.rejects(nativeHelper(exe, root, plan, 'stop-test'), (error) => error.code === 7);
    assert.deepEqual(sorted(await readValues(root)), sorted(plan.slice(0, 6)));
  } finally {
    await exec('reg.exe', ['delete', root, '/f'], options);
  }
  await assert.rejects(exec(exe, ['intentionally-invalid-scratch-root', 'write',
    ...plan.flatMap(({ subkey, name, data }) => [subkey, name, data])], options), (error) => error.code === 2);
}
async function readValues(root) {
  const script = `
  $ErrorActionPreference='Stop'
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($env:DEX_REGISTRY_MEASUREMENT_ROOT)
  if ($null -eq $key) { throw 'Synthetic registry key absent' }
  function ListValues($k, $rel) {
    foreach ($name in $k.GetValueNames()) {
      [PSCustomObject]@{ subkey=$rel; name=$name; data=$k.GetValue($name); type=$k.GetValueKind($name).ToString() }
    }
    foreach ($childName in $k.GetSubKeyNames()) {
      $sub=$k.OpenSubKey($childName)
      try { ListValues $sub $(if ($rel) { $rel + '\\' + $childName } else { $childName }) } finally { $sub.Dispose() }
    }
  }
  [Console]::OutputEncoding = [Text.Encoding]::UTF8
  try { ConvertTo-Json -InputObject @(ListValues $key '') -Compress } finally { $key.Dispose() }
  `;
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
    { ...options, env: { ...process.env, DEX_REGISTRY_MEASUREMENT_ROOT: root.replace(/^HKCU\\/, '') } });
  return JSON.parse(stdout);
}
function sorted(values) {
  return values.map((x) => [x.subkey, x.name, x.data, x.type || 'String'])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
}
async function run(file, out, nativeExe) {
  assert.equal(process.platform, 'win32');
  // Refuse to run outside a dedicated hosted GitHub Actions job.
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  const plan = await productWritePlan(file);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-registry-fixture-'));
  const native = path.resolve(nativeExe);
  assert.ok(fs.statSync(native).isFile());
  await checkNativeStops(native, plan);
  const rows = [];
  const arms = ['sequential', 'single', 'native'];
  try {
    for (let i = 0; i < 9; i++) {
      const order = [...arms.slice(i % arms.length), ...arms.slice(0, i % arms.length)];
      for (const arm of order) {
        const root = scratchKey();
        try {
          const timed = async () => {
            const start = performance.now();
            if (arm === 'sequential') await originalPlan(root, plan);
            else if (arm === 'single') await oneImport(root, plan, temp);
            else await nativeHelper(native, root, plan);
            return performance.now() - start;
          };
          const freshMs = await timed();
          assert.deepEqual(sorted(await readValues(root)), sorted(plan));
          const repeatMs = await timed();
          assert.deepEqual(sorted(await readValues(root)), sorted(plan));
          // Strict read-only check: all sixteen typed values must already match.
          // Keep it separate from the three writer timings.
          const beginVerify = performance.now();
          await nativeHelper(native, root, plan, 'verify-only');
          const alreadyCompleteMs = performance.now() - beginVerify;
          assert.deepEqual(sorted(await readValues(root)), sorted(plan));
          // A changed value must not permit a cached success.
          const mismatch = plan.map((x, n) => n === 15 ? { ...x, data: x.data + '-different' } : x);
          await assert.rejects(nativeHelper(native, root, mismatch, 'verify-only'), (error) => error.code === 8);
          rows.push({ arm, trial: i + 1, freshMs, repeatMs, alreadyCompleteMs });
        } finally {
          await exec('reg.exe', ['delete', root, '/f'], options);
        }
      }
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  const summary = Object.fromEntries(arms.map((arm) => [arm,
    Object.fromEntries(['freshMs', 'repeatMs'].map((key) => [key, rows.filter((r) => r.arm === arm)
      .map((r) => r[key]).sort((a, b) => a - b)[4]]))]));
  summary.alreadyCompleteMedianMs = rows.map((r) => r.alreadyCompleteMs).sort((a, b) => a - b)[13];
  const result = { rows, summary, verifiedStringValues: plan.length,
    scope: 'Synthetic registry paths only; excludes Electron launch and does not test genuine registration failures.' };
  console.log('REGISTRY FIXTURE COST: ' + JSON.stringify(summary));
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
}

if (require.main === module) {
  run(process.argv[2], process.argv[3], process.argv[4]).catch((error) => { console.error(error); process.exitCode = 1; });
}
module.exports = { productWritePlan, importText, scratchKey };
