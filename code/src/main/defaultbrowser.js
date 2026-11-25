// Windows default-browser registration (HKCU only — no admin needed).
// Writes the ProgId + StartMenuInternet client + RegisteredApplications
// keys that make Dexerion appear in Settings > Apps > Default apps as a
// real browser. Windows 10/11 deliberately block apps from flipping the
// UserChoice themselves, so "make default" = ensure registration, then open
// the Default apps page for the user to pick Dexerion.
const { execFile } = require('child_process');

const PROG_ID = 'DexerionHTML';
const CLIENT = 'Dexerion';

function reg(args) {
  return new Promise((resolve, reject) => {
    execFile('reg.exe', args, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error('reg ' + args[0] + ' failed: ' + ((stderr || '').trim() || err.message)));
      else resolve(stdout || '');
    });
  });
}

async function add(key, name, data, type = 'REG_SZ') {
  const a = ['add', key];
  if (name) a.push('/v', name); else a.push('/ve');
  a.push('/t', type, '/d', data, '/f');
  await reg(a);
}

async function registerBrowser(exePath) {
  if (process.platform !== 'win32') throw new Error('Windows only');
  if (!exePath) throw new Error('no exe path');
  // ProgId: what opens .html files and http(s) links.
  await add(`HKCU\\Software\\Classes\\${PROG_ID}`, '', 'Dexerion HTML Document');
  await add(`HKCU\\Software\\Classes\\${PROG_ID}\\DefaultIcon`, '', `"${exePath}",0`);
  await add(`HKCU\\Software\\Classes\\${PROG_ID}\\shell\\open\\command`, '', `"${exePath}" "%1"`);
  // StartMenuInternet client = the "browser" entry Windows lists.
  const cli = `HKCU\\Software\\Clients\\StartMenuInternet\\${CLIENT}`;
  await add(cli, '', CLIENT);
  await add(cli + '\\DefaultIcon', '', `"${exePath}",0`);
  await add(cli + '\\shell\\open\\command', '', `"${exePath}"`);
  await add(cli + '\\Capabilities', 'ApplicationName', CLIENT);
  await add(cli + '\\Capabilities', 'ApplicationDescription', 'Dexerion — standalone Chromium-based desktop web browser.');
  await add(cli + '\\Capabilities', 'ApplicationIcon', `"${exePath}",0`);
  for (const scheme of ['http', 'https']) {
    await add(cli + '\\Capabilities\\URLAssociations', scheme, PROG_ID);
  }
  for (const ext of ['.htm', '.html', '.xhtml']) {
    await add(cli + '\\Capabilities\\FileAssociations', ext, PROG_ID);
  }
  await add(cli + '\\Capabilities\\StartMenu', 'StartMenuInternet', CLIENT);
  await add('HKCU\\Software\\RegisteredApplications', CLIENT,
    `Software\\Clients\\StartMenuInternet\\${CLIENT}\\Capabilities`);
  return true;
}

async function queryUserChoiceProgId(scheme) {
  try {
    const out = await reg(['query',
      `HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\${scheme}\\UserChoice`,
      '/v', 'ProgId']);
    const m = out.match(/ProgId\s+REG_SZ\s+([^\r\n]+)/);
    return m ? m[1].trim() : '';
  } catch {
    return '';
  }
}

async function defaultStatus() {
  if (process.platform !== 'win32') return { supported: false, registered: false, isDefault: false };
  let registered = false;
  try {
    const out = await reg(['query',
      `HKCU\\Software\\Clients\\StartMenuInternet\\${CLIENT}\\Capabilities`, '/v', 'ApplicationName']);
    registered = /dexerion/i.test(out);
  } catch {
    registered = false;
  }
  const http = await queryUserChoiceProgId('http');
  const https = await queryUserChoiceProgId('https');
  return { supported: true, registered, http, https, isDefault: http === PROG_ID && https === PROG_ID };
}

// First CLI arg that looks like a page: invoked with a link/file when
// Dexerion is the default browser (or "open with"). Skips flags.
function findLaunchUrl(argv) {
  const fs = require('fs');
  for (const a of (argv || []).slice(1)) {
    if (!a || a.startsWith('-')) continue;
    if (/^https?:\/\//i.test(a)) return a;
    if (/^file:\/\//i.test(a)) return a;
    if (/\.html?$/i.test(a)) {
      try {
        if (fs.existsSync(a)) return 'file:///' + a.replace(/\\/g, '/');
      } catch {}
    }
  }
  return null;
}

module.exports = { registerBrowser, defaultStatus, findLaunchUrl, PROG_ID };
