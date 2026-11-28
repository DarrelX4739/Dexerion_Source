'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const vendors = ['lucide', 'motion', 'open-props'];
const packageClosure = new Set([...vendors, 'framer-motion', 'motion-dom', 'motion-utils', 'tslib']);
const archivePackage = (entry) => /^node_modules\/([^/]+)(?:\/|$)/.exec(entry)?.[1];
const rewrite = (p) => {
  assert.ok(p.devDependencies && p.dependencies);
  for (const key of vendors) {
    assert.equal(typeof p.dependencies[key], 'string');
    assert.equal(p.devDependencies[key], undefined);
    p.devDependencies[key] = p.dependencies[key];
    delete p.dependencies[key];
  }
  return p;
};

function compareLock(base, next) {
  assert.deepEqual(Object.keys(next.packages).sort(), Object.keys(base.packages).sort());
  for (const [key, v] of Object.entries(base.packages)) {
    const after = next.packages[key];
    if (!key) {
      const original = structuredClone(v);
      rewrite(original);
      assert.deepEqual(after, original);
    } else {
      const original = { ...v };
      if (packageClosure.has(archivePackage(key))) original.dev = true;
      assert.deepEqual(after, original, 'only production classification may change: ' + key);
    }
  }
}

function snapshot(asar, archive) {
  const entries = new Map();
  for (const raw of asar.listPackage(archive)) {
    const entry = raw.replace(/\\/g, '/').replace(/^\//, '');
    const info = asar.statFile(archive, entry);
    if (info.files) continue;
    if (info.link) {
      entries.set(entry, { link: info.link });
    } else {
      const data = asar.extractFile(archive, entry);
      entries.set(entry, { bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') });
    }
  }
  return entries;
}

function compareArchives(asar, baseline, candidate) {
  const a = snapshot(asar, baseline), b = snapshot(asar, candidate);
  const removed = [];
  for (const [file, sig] of a) {
    if (file === 'package.json') continue;
    if (packageClosure.has(archivePackage(file))) {
      assert.ok(!b.has(file), 'redundant package still shipped: ' + file);
      removed.push([file, sig.bytes || 0]);
    } else {
      assert.deepEqual(b.get(file), sig, 'runtime file is missing or changed: ' + file);
    }
  }
  for (const file of b.keys()) assert.ok(a.has(file), 'new unexpected packaged runtime file: ' + file);
  assert.ok(removed.length > 0, 'baseline package had no duplicates to remove');
  for (const file of ['assets/vendor/lucide-shell.js', 'assets/vendor/lucide.min.js',
    'assets/vendor/open-props.min.css', 'assets/vendor/motion.js', 'node_modules/adm-zip/adm-zip.js']) {
    assert.ok(b.has(file), 'required packaged runtime asset absent: ' + file);
  }
  const readManifest = (file) => JSON.parse(asar.extractFile(file, 'package.json').toString());
  const original = readManifest(baseline), built = readManifest(candidate);
  for (const key of vendors) delete original.dependencies[key];
  assert.deepEqual(built, original, 'unexpected packaged package.json difference');
  const baselineBytes = fs.statSync(baseline).size, candidateBytes = fs.statSync(candidate).size;
  assert.ok(candidateBytes < baselineBytes);
  return { baselineBytes, candidateBytes, savedBytes: baselineBytes - candidateBytes,
    removedFiles: removed.length, removedFileBytes: removed.reduce((n, r) => n + r[1], 0),
    retainedRuntimeEntries: b.size };
}

if (require.main === module) {
  const [action, ...args] = process.argv.slice(2);
  if (action === 'rewrite') fs.writeFileSync(args[0], JSON.stringify(rewrite(JSON.parse(fs.readFileSync(args[0]))), null, 2) + '\n');
  else if (action === 'lock') compareLock(...args.map((p) => JSON.parse(fs.readFileSync(p))));
  else if (action === 'archives') {
    const asar = require(require.resolve('@electron/asar', { paths: [path.join(process.cwd(), 'node_modules')] }));
    const row = compareArchives(asar, ...args);
    fs.writeFileSync('package-footprint.json', JSON.stringify(row, null, 2) + '\n');
    console.log('PACKAGED FOOTPRINT: ' + JSON.stringify(row));
  } else throw new Error('unknown action');
}

module.exports = { compareLock, compareArchives };
