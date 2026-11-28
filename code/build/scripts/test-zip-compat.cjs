'use strict';

// Valid archives only: exercise Dexerion's ZIP import and export paths, not
// upstream advisory reproduction. Run with the npm dependency tree installed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
// Match the source-tree Electron test boot: the build's dependency tree
// is a sibling of the app source, not an ancestor.
const deps = path.join(__dirname, '../node_modules');
process.env.NODE_PATH = [deps, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
Module._initPaths();
const AdmZip = require('adm-zip');
const { artifactFiles, artifactZip } = require('../../code/src/main/ai-artifact-zip');

const load = Module._load;
let createExtensionManager;
try {
  // Only native Chromium loading is substituted. The app still reads,
  // extracts, flattens, and persists through its real import code.
  Module._load = function (name, ...rest) {
    return name === 'electron' ? {} : load.call(this, name, ...rest);
  };
  ({ createExtensionManager } = require('../../code/src/main/extensions'));
} finally {
  Module._load = load;
}

const icon = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+x0E0AAAAASUVORK5CYII=', 'base64');
const pngPath = 'assets/icon.png';

function readArchive(buffer) {
  const entries = new AdmZip(buffer).getEntries().filter((e) => !e.isDirectory);
  return Object.fromEntries(entries.map((e) => [e.entryName, e.getData()]));
}

function checkExport(artifact) {
  const result = artifactZip(artifact);
  assert.ok(result.ok);
  assert.equal(result.bytes, result.buffer.length);
  const expected = Object.fromEntries(artifactFiles(artifact)
    .map(({ path: name, content }) => [name, Buffer.from(content)]));
  assert.deepEqual([...result.files].sort(), Object.keys(expected).sort());
  assert.deepEqual(readArchive(result.buffer), expected);
  return expected;
}

test('site exports preserve nested Unicode names, text, binary assets and offline preview', () => {
  const expected = checkExport({
    kind: 'site', title: 'Offline Fixture',
    html: '<!doctype html><title>Offline Fixture</title><h1>Café</h1>',
    files: [
      { path: 'index.html', content: '<!doctype html><title>Offline Fixture</title><h1>Café</h1>' },
      { path: 'styles/base.css', content: 'h1 { color: navy; }\n' },
      { path: 'docs/naïve.txt', content: 'Notes\r\nParagraph\n' },
      { path: pngPath, content: icon },
    ],
  });
  assert.deepEqual(expected['offline-fixture/' + pngPath], icon);
  assert.match(expected['offline-fixture/preview.html'].toString(), /Café/);
  assert.match(expected['offline-fixture/README.txt'].toString(), /Start at index\.html/);
});

test('report exports preserve HTML, Markdown, JSON and quoted table CSV bytes', () => {
  const report = {
    kind: 'report', title: 'Quarterly Notes', summary: 'Review sales',
    blocks: [
      { type: 'heading', level: 2, text: 'Regional notes' },
      { type: 'table', columns: ['Region', 'Note'], rows: [['South', 'Needs, review']] },
    ],
  };
  const expected = checkExport(report);
  assert.deepEqual(Object.keys(expected).sort(),
    ['quarterly-notes.html', 'quarterly-notes.json', 'quarterly-notes.md', 'quarterly-notes.tables.csv']);
  assert.deepEqual(JSON.parse(expected['quarterly-notes.json']), report);
  assert.equal(expected['quarterly-notes.tables.csv'].toString(), '# table 1\nRegion,Note\nSouth,"Needs, review"\n');
});

for (const prefix of ['', 'extension-fixture/']) {
  test('valid MV3 ZIP imports through the extension manager' + (prefix ? ' with a wrapper folder' : ''), async (t) => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-zip-compat-'));
    t.after(() => fs.rmSync(work, { recursive: true, force: true }));
    const files = {
      'manifest.json': Buffer.from(JSON.stringify({
        manifest_version: 3, name: 'ZIP Import Fixture', version: '1.2.3',
        action: { default_popup: 'panel.html', default_icon: pngPath },
      })),
      'panel.html': Buffer.from('<!doctype html><title>ZIP Import Fixture</title>'),
      'docs/credits.txt': Buffer.from('Café fixture\n'),
      [pngPath]: icon,
    };
    const archive = new AdmZip();
    for (const [name, bytes] of Object.entries(files)) archive.addFile(prefix + name, bytes);
    const zipFile = path.join(work, 'input.zip');
    fs.writeFileSync(zipFile, archive.toBuffer());

    let saves = 0;
    const loads = [];
    const profile = { dir: path.join(work, 'profile'), data: { extensions: [] }, saveSoon() { saves++; } };
    const manager = createExtensionManager({ profile, session: { extensions: {
      async loadExtension(dir) {
        loads.push(dir);
        for (const [name, bytes] of Object.entries(files)) assert.deepEqual(fs.readFileSync(path.join(dir, name)), bytes);
        return { id: 'abcdefghijklmnopabcdefghijklmnop' };
      },
    } } });
    const record = await manager.installFromCrxOrZip(zipFile);
    assert.equal(record.name, 'ZIP Import Fixture');
    assert.equal(record.version, '1.2.3');
    assert.equal(record.manifestVersion, 3);
    assert.equal(record.unpacked, false);
    assert.equal(record.enabled, true);
    assert.equal(manager.displayId(record), 'abcdefghijklmnopabcdefghijklmnop');
    assert.deepEqual(loads, [record.path]);
    assert.deepEqual(manager.records(), [record]);
    assert.equal(saves, 1);
  });
}
