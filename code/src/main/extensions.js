// Extension manager: unpacked loading, enable/disable/reload/remove,
// Chrome Web Store install (best-effort), persistence.
// Uses the shared Chromium session's native extension engine
// (session.loadExtension) — Manifest V3 + supported V2 — so APIs like
// tabs, storage, runtime, scripting, commands, contextMenus, notifications,
// cookies, webNavigation, contentScripts, popups, service workers work
// through Chromium itself, not fakes.
const { dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const safeUnzip = require('./safe-unzip');

function readManifest(dir) {
  const p = path.join(dir, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!m.manifest_version || !m.name || !m.version) throw new Error('manifest.json missing name/version/manifest_version');
  return m;
}

function createExtensionManager({ profile, session }) {
  // Multi-session: the default session plus one persist partition per
  // Dexerion account. Each session loads the same records; per-session
  // Chromium ids are tracked in rec.ids[key].
  const sessions = new Map(); // key -> extApi
  function apiFor(ses) {
    const s = ses.defaultSession || ses;
    return (s.extensions && s.extensions.loadExtension) ? s.extensions : s;
  }
  sessions.set('default', apiFor(session.defaultSession || session));
  const extDir = path.join(profile.dir, 'Extensions');
  fs.mkdirSync(extDir, { recursive: true });

  function records() { return profile.data.extensions; }
  function saveSoon() { profile.saveSoon(); }

  function normalize(rec) {
    if (!rec.ids) rec.ids = rec.id ? { default: rec.id } : {};
    return rec;
  }
  function findRec(id) {
    if (!id) return null;
    return records().map(normalize).find(r =>
      Object.values(r.ids).includes(id) || r.id === id) || null;
  }
  function displayId(rec) {
    normalize(rec);
    return rec.ids.default || Object.values(rec.ids)[0] || rec.id || '';
  }

  async function loadInto(key, rec) {
    const api = sessions.get(key);
    if (!api) return null;
    // Clear first: a failed load must never leave a stale Chromium id behind
    // (a dead id makes the popup/content resolve against a ghost extension).
    if (rec.ids) delete rec.ids[key];
    const ext = await api.loadExtension(rec.path);
    rec.ids[key] = ext.id;
    return ext;
  }
  async function unloadFrom(key, rec) {
    const api = sessions.get(key);
    const eid = rec.ids && rec.ids[key];
    if (!api || !eid) return;
    try { await api.removeExtension(eid); } catch {}
    // Keep rec.ids[key]: Chromium ids are stable per path, and the mapping
    // is how a disabled extension is re-identified for re-enable/reload.
  }

  function addSession(key, ses) {
    sessions.set(key, apiFor(ses));
    // Load all enabled extensions into the new session.
    return (async () => {
      for (const rec of records().map(normalize)) {
        if (rec.enabled === false) continue;
        if (!rec.path || !fs.existsSync(rec.path)) continue;
        try { await loadInto(key, rec); delete rec.loadError; }
        catch (e) { rec.loadError = String(e.message || e); }
      }
      saveSoon();
    })();
  }

  function baseRec(manifest, dest, extra = {}) {
    return {
      ids: {}, name: manifest.name, version: manifest.version,
      description: manifest.description || '', path: dest,
      enabled: true, manifestVersion: manifest.manifest_version,
      permissions: manifest.permissions || [], hostPermissions: manifest.host_permissions || [],
      installedAt: Date.now(), ...extra,
    };
  }

  // Developer mode uses the SAME structure as a web install: the folder is
  // copied into the profile's Extensions dir and loaded from there, so the
  // browser owns a real, persistent copy (identical record shape to a
  // store/zip install). The original folder is remembered as sourceDir so
  // Reload can re-sync edits from it — dev workflow without diverging from
  // the installed-extension path. The user's own folder is never modified
  // or deleted.
  async function loadUnpacked(dir) {
    const picked = path.resolve(dir);
    const stat = fs.statSync(picked);
    if (!stat.isDirectory()) throw new Error('Pick the extension FOLDER that contains manifest.json.');
    // Developers often pick the wrapper folder (e.g. myext-main/ from a
    // GitHub zip) instead of the inner folder holding manifest.json. The
    // zip installer already flattens that case — do the same here rather
    // than failing with a raw ENOENT.
    const src = resolveUnpackedDir(picked);
    const manifest = readManifest(src);
    const dest = path.join(extDir, sanitize(manifest.name) + '-' + Date.now());
    fs.rmSync(dest, { recursive: true, force: true });
    copyDir(src, dest);
    if (!fs.existsSync(path.join(dest, 'manifest.json'))) {
      throw new Error('manifest.json was not copied into the browser. Check the folder for OneDrive placeholder files.');
    }
    // A partial copy (unreadable/cloud-placeholder files are skipped one by
    // one in copyDir) yields an extension that loads but malfunctions. Fail
    // loudly with the exact missing files instead.
    const missing = missingManifestFiles(dest, manifest);
    if (missing.length) {
      fs.rmSync(dest, { recursive: true, force: true });
      throw new Error('Extension files missing after copy: ' + missing.join(', ') +
        '. Check the folder for OneDrive placeholder or unreadable files.');
    }
    const rec = baseRec(manifest, dest, { unpacked: true, sourceDir: src });
    for (const key of sessions.keys()) {
      try { await loadInto(key, rec); }
      catch (e) { rec.loadError = String(e.message || e); }
    }
    if (!Object.keys(rec.ids).length && rec.loadError) {
      fs.rmSync(dest, { recursive: true, force: true });
      throw new Error(rec.loadError);
    }
    records().push(rec);
    saveSoon();
    return rec;
  }

  // Re-copy the developer's folder over the browser-owned copy, then reload
  // — so edits go live exactly like Chrome's "Reload" in developer mode.
  function syncUnpacked(rec) {
    if (!rec.unpacked || !rec.sourceDir) return false;
    const src = resolveUnpackedDir(rec.sourceDir);
    if (!src || !fs.existsSync(src)) return false;
    try {
      // Remove files the developer deleted since install; otherwise stale
      // background/content scripts linger in the browser copy and the reload
      // appears to do nothing (or runs deleted code).
      pruneExtraneous(src, rec.path);
      copyDir(src, rec.path);
      return true;
    } catch {
      return false;
    }
  }

  async function restore() {
    for (const rec of records().map(normalize)) {
      if (rec.enabled === false) continue;
      if (!rec.path || !fs.existsSync(rec.path)) {
        rec.loadError = 'Extension directory not found: ' + (rec.path || '(none)');
        continue;
      }
      delete rec.loadError;
      for (const key of sessions.keys()) {
        try { await loadInto(key, rec); }
        catch (e) { rec.loadError = `[${key}] ` + String(e.message || e); }
      }
    }
    saveSoon();
  }

  async function setEnabled(id, enabled) {
    const rec = findRec(id);
    if (!rec) throw new Error('unknown extension');
    rec.enabled = enabled;
    delete rec.loadError;
    try {
      if (enabled) {
        for (const key of sessions.keys()) {
          try { await loadInto(key, rec); }
          catch (e) { rec.loadError = `[${key}] ` + String(e.message || e); }
        }
        if (!Object.keys(rec.ids).length && rec.loadError) throw new Error(rec.loadError);
      } else {
        for (const key of sessions.keys()) await unloadFrom(key, rec);
      }
    } catch (e) { rec.loadError = String(e.message || e); if (enabled) throw e; }
    saveSoon();
    return rec;
  }

  async function reload(id) {
    const rec = findRec(id);
    if (!rec) throw new Error('unknown extension');
    for (const key of sessions.keys()) await unloadFrom(key, rec);
    // Developer mode: pull the latest code from the original folder first.
    syncUnpacked(rec);
    delete rec.loadError;
    for (const key of sessions.keys()) {
      try { await loadInto(key, rec); }
      catch (e) { rec.loadError = `[${key}] ` + String(e.message || e); }
    }
    if (!Object.keys(rec.ids || {}).length && rec.loadError) throw new Error(rec.loadError);
    saveSoon();
    return rec;
  }

  async function remove(id) {
    const rec = findRec(id);
    if (!rec) throw new Error('unknown extension');
    const i = records().indexOf(rec);
    if (i >= 0) records().splice(i, 1);
    for (const key of sessions.keys()) await unloadFrom(key, rec);
    // Only delete Dexerion-owned copies (pre-in-place-loading records);
    // a developer's own folder is never touched.
    if (rec.unpacked && rec.path && rec.path.startsWith(extDir)) {
      fs.rmSync(rec.path, { recursive: true, force: true });
    }
    saveSoon();
    return true;
  }

  // --- Chrome Web Store install ---
  // Preferred flow: user opens a Web Store item page in Dexerion; the
  // extensions page (or the auto-detected banner) calls
  // installFromWebStoreUrl(itemUrl). We download the CRX via Google's
  // update service and load it with the native engine.
  // LIMITATION (documented in EXTENSIONS.md): Google may rate-limit or block
  // third-party CRX fetches and some items require a signed-in Chrome
  // account or proprietary licensing. In that case Dexerion reports the exact
  // error and offers the manual fallback: download the .zip/.crx from the
  // developer and use "Load unpacked" / "Install from file". We never
  // pretend the install succeeded.
  function parseStoreId(url) {
    const m = String(url).match(/\/detail\/[^/]+\/([a-p]{32})/i);
    return m ? m[1].toLowerCase() : null;
  }

  function fetchCrx(extensionId) {
    const updateUrl = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=120.0&acceptformat=crx2,crx3&x=id%3D${extensionId}%26installsource%3Dondemand%26uc`;
    return new Promise((resolve, reject) => {
      https.get(updateUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          https.get(res.headers.location, (r2) => {
            if (r2.statusCode !== 200) return reject(new Error('Web Store download failed: HTTP ' + r2.statusCode));
            const chunks = [];
            r2.on('data', c => chunks.push(c));
            r2.on('end', () => resolve(Buffer.concat(chunks)));
            r2.on('error', reject);
          }).on('error', reject);
          return;
        }
        if (res.statusCode !== 200) return reject(new Error('Web Store download failed: HTTP ' + res.statusCode));
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }).on('error', reject);
    });
  }

  async function installFromWebStoreUrl(url, browser) {
    const id = parseStoreId(url);
    if (!id) throw new Error('Not a Chrome Web Store item URL.');
    const buf = await fetchCrx(id);
    if (buf.subarray(0, 4).toString() !== 'CrX3' && buf.subarray(0, 4).toString() !== 'Cr24') {
      throw new Error('Download did not return a valid CRX package (store may have blocked the request).');
    }
    const dest = path.join(extDir, 'store-' + id);
    fs.mkdirSync(dest, { recursive: true });
    const crxPath = path.join(dest, id + '.crx');
    fs.writeFileSync(crxPath, buf);
    // Chromium loads unpacked dirs; for .crx we extract via Electron by
    // loading once through a temp dir is NOT supported, so we install the
    // CRX with the session API: loadExtension requires a directory.
    // Robust path: keep the .crx and use chrome-extension load via unzip.
    const AdmUnzip = tryRequireUnzip();
    if (!AdmUnzip) throw new Error('CRX downloaded but no unzip available. Save the .crx at ' + crxPath + ' and contact support.');
    // CRX3 header: skip magic(4)+version(4)+headerLen(4)+header bytes.
    const headerLen = buf.readUInt32LE(8);
    const zipStart = 12 + headerLen;
    const zipBuf = buf.subarray(zipStart);
    const tmpZip = path.join(dest, 'pkg.zip');
    fs.writeFileSync(tmpZip, zipBuf);
    // Hardened extraction (see src/main/safe-unzip.js): a store package is
    // downloaded content, so it gets the same limits as a local zip.
    safeUnzip.extractZipSafely(AdmUnzip, tmpZip, dest);
    const manifest = readManifest(dest);
    const rec = baseRec(manifest, dest, { unpacked: false, storeId: id, storeUrl: url });
    for (const key of sessions.keys()) {
      try { await loadInto(key, rec); }
      catch (e) { rec.loadError = `[${key}] ` + String(e.message || e); }
    }
    if (!Object.keys(rec.ids).length && rec.loadError) throw new Error(rec.loadError);
    records().push(rec);
    saveSoon();
    return rec;
  }

  async function installFromCrxOrZip(filePath) {
    const dest = path.join(extDir, 'file-' + Date.now());
    fs.mkdirSync(dest, { recursive: true });
    if (filePath.endsWith('.crx')) {
      const buf = fs.readFileSync(filePath);
      const headerLen = buf.readUInt32LE(8);
      fs.writeFileSync(path.join(dest, 'pkg.zip'), buf.subarray(12 + headerLen));
      filePath = path.join(dest, 'pkg.zip');
    }
    const AdmUnzip = tryRequireUnzip();
    if (!AdmUnzip) {
      // No unzip dep: if user pointed at an extracted dir, copy it directly.
      if (fs.statSync(filePath).isDirectory()) { copyDir(filePath, dest); }
      else throw new Error('Install a folder, or add unzip support.');
    } else if (filePath.endsWith('.zip')) {
      // Hardened extraction: adm-zip's own extractAllTo() follows symlinks at
      // the destination and trusts the archive's declared sizes (the HIGH
      // advisory npm reports for adm-zip). See src/main/safe-unzip.js.
      safeUnzip.extractZipSafely(AdmUnzip, filePath, dest);
      // Handle zips with a single top-level folder.
      const entries = fs.readdirSync(dest);
      if (entries.length === 1 && fs.statSync(path.join(dest, entries[0])).isDirectory()
          && fs.existsSync(path.join(dest, entries[0], 'manifest.json'))) {
        const inner = path.join(dest, entries[0]);
        for (const f of fs.readdirSync(inner)) fs.renameSync(path.join(inner, f), path.join(dest, f));
        fs.rmdirSync(inner);
      }
    } else if (fs.statSync(filePath).isDirectory()) {
      copyDir(filePath, dest);
    }
    const manifest = readManifest(dest);
    const rec = baseRec(manifest, dest, { unpacked: false });
    for (const key of sessions.keys()) {
      try { await loadInto(key, rec); }
      catch (e) { rec.loadError = `[${key}] ` + String(e.message || e); }
    }
    if (!Object.keys(rec.ids).length && rec.loadError) throw new Error(rec.loadError);
    records().push(rec);
    saveSoon();
    return rec;
  }

  return { loadUnpacked, restore, setEnabled, reload, remove, records, parseStoreId, installFromWebStoreUrl, installFromCrxOrZip, addSession, displayId, findRec };
}

function sanitize(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'ext'; }

// Unpacked picker tolerance: if the chosen folder lacks manifest.json but
// exactly one child folder holds one (wrapper from a GitHub zip, e.g.
// myext-main/myext/), resolve to it. Returns the dir to use, or the input
// unchanged so readManifest raises the precise error.
function resolveUnpackedDir(dir) {
  if (fs.existsSync(path.join(dir, 'manifest.json'))) return dir;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return dir; }
  const candidates = entries
    .filter(e => { try { return fs.statSync(path.join(dir, e.name)).isDirectory(); } catch { return false; } })
    .map(e => path.join(dir, e.name))
    .filter(d => fs.existsSync(path.join(d, 'manifest.json')));
  return candidates.length === 1 ? candidates[0] : dir;
}

// Files the manifest points at that must exist for the extension to work.
// Used to reject partial copies (skipped cloud placeholders) up front.
function missingManifestFiles(dir, m) {
  const need = [];
  const push = (rel) => {
    if (typeof rel !== 'string' || !rel) return;
    const clean = rel.replace(/^\/+/, '').split('?')[0].split('#')[0];
    if (clean) need.push(clean);
  };
  if (m.background && m.background.service_worker) push(m.background.service_worker);
  if (m.action && m.action.default_popup) push(m.action.default_popup);
  if (m.browser_action && m.browser_action.default_popup) push(m.browser_action.default_popup);
  if (m.page_action && m.page_action.default_popup) push(m.page_action.default_popup);
  const iconObj = (m.action && m.action.default_icon) || m.icons ||
    (m.browser_action && m.browser_action.default_icon);
  if (typeof iconObj === 'string') push(iconObj);
  else if (iconObj && typeof iconObj === 'object') Object.values(iconObj).forEach(push);
  for (const cs of (Array.isArray(m.content_scripts) ? m.content_scripts : [])) {
    if (!cs || typeof cs !== 'object') continue;
    for (const f of (cs.js || [])) push(f);
    for (const f of (cs.css || [])) push(f);
  }
  return [...new Set(need)].filter(rel => {
    try {
      const abs = path.join(dir, rel.replace(/\//g, path.sep));
      return !(fs.existsSync(abs) && fs.statSync(abs).isFile());
    } catch { return true; }
  });
}

// Delete dest entries with no counterpart in src (developer deleted them).
// Locked files on Windows are left in place rather than failing the sync.
function pruneExtraneous(src, dest) {
  let entries = [];
  try { entries = fs.readdirSync(dest); } catch { return; }
  for (const name of entries) {
    const s = path.join(src, name), d = path.join(dest, name);
    if (!fs.existsSync(s)) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
    } else {
      try {
        if (fs.statSync(s).isDirectory() && fs.statSync(d).isDirectory()) pruneExtraneous(s, d);
      } catch {}
    }
  }
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    // OneDrive/cloud folders expose placeholder + reparse-point entries:
    // follow anything that resolves to a directory, never choke the whole
    // copy on one odd entry.
    let isDir = e.isDirectory();
    if (!isDir && (e.isSymbolicLink() || e.isFile())) {
      try { isDir = fs.statSync(s).isDirectory(); } catch { continue; }
    }
    if (isDir) copyDir(s, d);
    else {
      try { fs.copyFileSync(s, d); } catch (err) {
        // Zero-byte cloud placeholders: fetch the real bytes, then retry once.
        try { fs.copyFileSync(s, d, fs.constants.COPYFILE_FICLONE); }
        catch { console.warn('[dexerion] skipped unreadable file', s, err.code || ''); }
      }
    }
  }
}

function tryRequireUnzip() {
  try { return require('adm-zip'); } catch { return null; }
}

module.exports = { createExtensionManager };

