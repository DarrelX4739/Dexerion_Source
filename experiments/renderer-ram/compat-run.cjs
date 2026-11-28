'use strict';
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const binary = require('../../code/build/node_modules/electron');
const out = [];
for (const [i, arm] of ['sandbox-0', 'sandbox-1', 'sandbox-1', 'sandbox-0'].entries()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-renderer-compat-'));
  try {
    const p = spawnSync(binary, [path.join(__dirname, 'compat.cjs'), arm, '--ram-compat=' + root],
      { encoding: 'utf8', timeout: 60000, windowsHide: true });
    assert.equal(p.status, 0, JSON.stringify({ status:p.status, error:p.error?.message, stderr:p.stderr?.slice(-5000) }));
    const x = JSON.parse(fs.readFileSync(path.join(root,'result.json'), 'utf8'));
    assert.equal(x.arm, arm);
    assert.equal(x.sandbox, arm === 'sandbox-1');
    assert.equal(x.electron, '44.4.5');
    assert.equal(x.tests.length, 5);
    out.push({ order:i+1, ...x });
    console.log(JSON.stringify(out.at(-1)));
  } finally { fs.rmSync(root, { recursive:true, force:true, maxRetries:8, retryDelay:300 }); }
}
fs.writeFileSync(process.argv[2], JSON.stringify({ trials:out,
  limit:'Local fixture stubs; no real Google authentication, product password storage, third-party extensions, or product browser parity.' }, null, 2));
