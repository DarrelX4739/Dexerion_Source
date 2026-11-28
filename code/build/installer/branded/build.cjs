'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const buildDir = path.join(__dirname, '..', '..');
const configPath = path.join(buildDir, 'electron-builder.json');
const config = require(configPath);
const metadata = require(path.join(buildDir, 'package.json'));
const previewOnly = process.argv.slice(2).includes('--preview-only');
if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Build branded Setup from an x64 Node session on Windows.');
}
if (process.argv.slice(2).some(arg => arg !== '--preview-only')) {
  throw new Error('Only --preview-only is accepted. This build never publishes.');
}
// This front end models Dexerion's assisted x64 installer, not the generic
// one-click/per-machine-only configurations in electron-builder.
if (config.nsis.oneClick !== false || config.nsis.perMachine !== false ||
    !config.nsis.allowToChangeInstallationDirectory || config.nsis.runAfterFinish !== true)
  throw new Error('Stock installer options changed. Review and update branded Setup before building.');

function run(executable, args, cwd = buildDir) {
  const child = spawnSync(executable, args, { cwd, stdio: 'inherit', windowsHide: true });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(`${path.basename(executable)} exited with ${child.status}`);
}
function sha(file) {
  const fd = fs.openSync(file, 'r');
  const hash = crypto.createHash('sha256');
  const buf = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null));) hash.update(buf.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
function frameworkFile(folder, name) {
  for (const dir of [folder, path.join(folder, 'WPF')]) {
    const absolute = path.join(dir, name);
    if (fs.existsSync(absolute)) return absolute;
  }
  throw new Error(`Windows .NET Framework 4.8 component missing: ${name}`);
}

const framework = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319');
const csc = frameworkFile(framework, 'csc.exe');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'Dexerion-Branded-'));
const { UUID } = require(require.resolve('builder-util-runtime', {
  paths: [path.dirname(require.resolve('app-builder-lib/package.json', { paths: [buildDir] }))]
}));
const guid = config.nsis.guid || UUID.v5(config.appId, UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3'));
const product = config.productName || metadata.productName;
if (product !== 'Dexerion' || !config.appId) throw new Error('Dexerion package identity has changed.');

const stock = path.join(output, 'Main_Exe_Dexerion.exe');
const branded = path.join(output, previewOnly ? 'Dexerion-Setup-Preview.exe' : 'Dexerion-Setup-Branded.exe');
let executableHash = 'preview-only';
if (!previewOnly) {
  const builderPackage = require.resolve('electron-builder/package.json', { paths: [buildDir] });
  const cli = path.resolve(path.dirname(builderPackage), require(builderPackage).bin['electron-builder']);
  run(process.execPath, [cli, '--win', '--x64', '--config', configPath, '--publish', 'never',
    `-c.directories.output=${output}`]);
  if (!fs.existsSync(stock)) throw new Error('The expected stock installer was not built.');
  executableHash = sha(path.join(output, 'win-unpacked', 'Dexerion.exe'));
}

const payloadInfo = path.join(output, 'payload.txt');
fs.writeFileSync(payloadInfo, [guid, 'Dexerion.exe', 'Dexerion', executableHash,
  config.nsis.allowElevation === false ? 'no' : 'yes',
  config.nsis.selectPerMachineByDefault === true ? 'yes' : 'no',
  previewOnly ? 'preview-only' : sha(stock)].join('\n'), 'utf8');

const refs = ['PresentationFramework.dll', 'PresentationCore.dll', 'WindowsBase.dll', 'System.Xaml.dll',
  'UIAutomationTypes.dll'].map(name => `/reference:${frameworkFile(framework, name)}`);
const assets = path.resolve(buildDir, '..', 'code', 'assets');
run(csc, ['/nologo', '/codepage:65001', '/target:winexe', '/platform:x64', '/optimize+', `/out:${branded}`,
  `/win32icon:${path.join(assets, 'icon.ico')}`,
  `/win32manifest:${path.join(__dirname, 'Setup.manifest')}`,
  ...refs,
  `/resource:${payloadInfo},Dexerion.PayloadInfo`,
  `/resource:${path.join(assets, 'logo.png')},Dexerion.BrandLogo`,
  `/resource:${path.join(__dirname, 'Setup.xaml')},Dexerion.SetupXaml`,
  ...(previewOnly ? [] : [`/resource:${stock},Dexerion.Nsis`]),
  path.join(__dirname, 'SetupEngine.cs'), path.join(__dirname, 'Setup.cs')]);

fs.unlinkSync(payloadInfo);
console.log(`\nBuilt ${branded}\nSHA-256: ${sha(branded)}`);
console.log(previewOnly ? 'No NSIS payload is embedded. This executable cannot install anything.' :
  'The unchanged stock NSIS package is also in the output directory.');
