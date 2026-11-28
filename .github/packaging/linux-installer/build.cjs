'use strict';

const { createHash } = require('node:crypto');
const { createReadStream, createWriteStream } = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { promisify } = require('node:util');
const run = promisify(require('node:child_process').execFile);

async function digest(file) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}

async function checkBinary(file, arch, appImage) {
  const handle = await fs.open(file);
  try {
    const header = Buffer.alloc(20);
    const { bytesRead } = await handle.read(header);
    const expected = { x64: 62, arm64: 183 }[arch];
    if (!expected || bytesRead !== 20 || header.subarray(0, 4).toString('hex') !== '7f454c46' ||
        header[4] !== 2 || header[5] !== 1 || header.readUInt16LE(18) !== expected ||
        (appImage && header.subarray(8, 11).toString('hex') !== '414902')) {
      throw Error(`${file} is not a ${arch} Linux ${appImage ? 'type-2 AppImage' : 'ELF executable'}`);
    }
    if (appImage && (await handle.stat()).size < 1024 * 1024) throw Error('AppImage is suspiciously small');
  } finally {
    await handle.close();
  }
}

async function build({ runtime, payload, output, arch = 'x64' }) {
  await checkBinary(path.join(runtime, 'dexerion-bin'), arch, false);
  await checkBinary(payload, arch, true);
  await fs.mkdir(path.dirname(output), { recursive: true });
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'dexerion-linux-build-'));
  const newOutput = path.join(await fs.mkdtemp(path.join(path.dirname(output), '.dex-setup-')), 'setup.run');
  try {
    const distro = path.join(stage, 'bundle', 'runtime');
    const app = path.join(distro, 'resources', 'app');
    await fs.mkdir(app, { recursive: true });

    // Copy only Electron's runtime dependencies; never copy Dexerion's app.asar,
    // archives, launcher wrapper, or Electron's default app from this directory.
    for (const entry of await fs.readdir(runtime, { withFileTypes: true })) {
      if (!/^(?:dexerion-bin|chrome(?:[-_][\w.-]+)?|icudtl\.dat|.*\.so(?:\.[\d.]+)?|.*\.bin|.*\.pak|vk_swiftshader_icd\.json|LICENSE(?:S\.chromium\.html)?(?:\.electron\.txt)?|locales)$/.test(entry.name)) continue;
      if (!(entry.isFile() || (entry.name === 'locales' && entry.isDirectory()))) throw Error('Unexpected Electron runtime link');
      await fs.cp(path.join(runtime, entry.name), path.join(distro, entry.name === 'dexerion-bin' ? 'dexerion-setup' : entry.name), { recursive: true });
    }
    for (const file of ['package.json', 'main.cjs', 'preload.cjs', 'install.cjs', 'index.html', 'style.css', 'view.js']) {
      await fs.copyFile(path.join(__dirname, file), path.join(app, file));
    }
    await fs.copyFile(path.join(__dirname, '../../../code/code/assets/logo.png'), path.join(app, 'logo.png'));
    const packedPayload = path.join(stage, 'bundle', 'Dexerion.AppImage');
    await fs.copyFile(payload, packedPayload);
    await fs.chmod(packedPayload, 0o755);
    await fs.writeFile(path.join(stage, 'bundle', 'SHA256SUMS'), `${await digest(packedPayload)}  Dexerion.AppImage\n`);

    const archive = path.join(stage, 'bundle.tar.gz');
    await run('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '--hard-dereference',
      '-czf', archive, '-C', path.join(stage, 'bundle'), '.']);
    const stub = (await fs.readFile(path.join(__dirname, 'extractor.sh'), 'utf8')).trimEnd();
    const firstArchiveLine = stub.split('\n').length + 1;
    await pipeline(Readable.from((async function* () {
      yield stub.replace('__ARCHIVE_LINE__', String(firstArchiveLine)) + '\n';
      yield* createReadStream(archive);
    })()), createWriteStream(newOutput, { flags: 'wx', mode: 0o755 }));
    await fs.chmod(newOutput, 0o755);
    await fs.link(newOutput, output); // No partial artifact and never overwrite an existing path.
    return output;
  } finally {
    await Promise.all([stage, path.dirname(newOutput)].map(dir => fs.rm(dir, { recursive: true, force: true })));
  }
}

if (require.main === module) {
  const { values } = require('node:util').parseArgs({ options: {
    runtime: { type: 'string' }, payload: { type: 'string' }, output: { type: 'string' }, arch: { type: 'string' }
  } });
  if (!values.runtime || !values.payload || !values.output) {
    console.error('Usage: node build.cjs --runtime linux-unpacked --payload Dexerion.AppImage --output Dexerion-Setup-Linux-x64.run [--arch x64|arm64]');
    process.exitCode = 1;
  } else build(values).then(console.log, error => { console.error(error.message); process.exitCode = 1; });
}
