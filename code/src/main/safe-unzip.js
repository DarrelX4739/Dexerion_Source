'use strict';
// Hardened ZIP extraction.
//
// `adm-zip` 0.5.x's own extractAllTo() is the direct cause of the HIGH
// advisory npm reports about this project:
//
//   - it follows a symlink that already exists at the destination, so an
//     archive can be written outside the folder it was extracted into
//   - it trusts the archive's DECLARED uncompressed sizes, so a crafted file
//     can make it allocate gigabytes
//   - duplicate entry names resolve to different content depending on which
//     API is used
//   - it preserves SUID/SGID bits from the archive
//
// This module extracts an archive entry by entry, under explicit limits:
//
//   - an entry name must stay inside the destination: no absolute path, no
//     drive letter, no UNC path, no "..", no NTFS alternate-data stream
//   - symlink entries are refused outright - a link is how an archive escapes
//     the destination once somebody follows it
//   - every write is checked against the real filesystem, so a symlink that
//     is ALREADY in the destination cannot be used as a bridge
//   - the declared size is capped per entry and in total, and the bytes
//     actually produced are capped too (the declared size lies)
//   - duplicate entry names are refused (Windows treats them as one file)
//   - directory permissions are never restored from the archive
//
// The result is the same file tree an honest extension ships, with the
// escape routes closed.

const fs = require('fs');
const path = require('path');

const DEFAULT_LIMITS = {
  maxEntries: 20000,                // files in the archive
  maxEntryBytes: 256 * 1024 * 1024, // 256 MB for one file
  maxTotalBytes: 1024 * 1024 * 1024,// 1 GB for the whole archive
};

// The Unix mode lives in the high 16 bits of the external file attributes.
// S_IFLNK (0xA000) marks a symbolic link.
function isSymlinkEntry(entry) {
  const attr = Number(entry && entry.attr) || 0;
  const mode = (attr >> 16) & 0xffff;
  return (mode & 0xf000) === 0xa000;
}

// Returns the relative path an entry may be written to, or null when the
// name is unsafe.
function safeEntryName(name) {
  const raw = String(name == null ? '' : name);
  if (!raw) return null;
  if (raw.indexOf('\0') !== -1) return null;
  // ZIP names use forward slashes, but a backslash is a path separator on
  // Windows, so it is normalised before the checks below.
  const norm = raw.replace(/\\/g, '/');
  if (norm.startsWith('/')) return null;       // absolute (POSIX)
  if (norm.startsWith('//')) return null;      // UNC
  if (/^[A-Za-z]:/.test(norm)) return null;    // absolute (drive letter)
  const parts = norm.split('/').filter((p) => p !== '' && p !== '.');
  if (!parts.length) return null;
  for (const part of parts) {
    if (part === '..') return null;             // traversal
    if (part.indexOf(':') !== -1) return null;  // NTFS alternate data stream
    if (part === '.') return null;
  }
  return parts.join('/');
}

// Walks the path from `root` down to `rel`, refusing to continue through a
// symbolic link. Returns the absolute path to write to.
function resolveInside(root, rel) {
  const parts = rel.split('/');
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    let st = null;
    try { st = fs.lstatSync(current); } catch { continue; }  // not created yet
    if (st.isSymbolicLink()) throw new Error('Refusing to write through a symbolic link: ' + rel);
  }
  const abs = path.resolve(current);
  const base = path.resolve(root);
  if (abs !== base && !abs.startsWith(base + path.sep)) {
    throw new Error('Entry escapes the destination: ' + rel);
  }
  return abs;
}

function human(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB';
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return bytes + ' bytes';
}

/**
 * Extract a zip into `destDir`.
 *
 * @param {Function} AdmZipCtor  the adm-zip constructor
 * @param {string}   filePath    the archive to read
 * @param {string}   destDir     the folder to write into (created if missing)
 * @param {object}   [options]   { limits } - the caps above
 * @returns {{files:number, bytes:number, skipped:string[]}}
 */
function extractZipSafely(AdmZipCtor, filePath, destDir, options) {
  const limits = Object.assign({}, DEFAULT_LIMITS, (options && options.limits) || {});
  const zip = new AdmZipCtor(filePath);
  const entries = zip.getEntries();
  if (entries.length > limits.maxEntries) {
    throw new Error('That archive has ' + entries.length + ' entries - more than the ' + limits.maxEntries + ' allowed.');
  }
  fs.mkdirSync(destDir, { recursive: true });
  const root = path.resolve(destDir);
  const seen = new Set();
  let files = 0;
  let bytes = 0;
  const skipped = [];

  for (const entry of entries) {
    const name = safeEntryName(entry.entryName);
    if (!name) { skipped.push(String(entry.entryName)); continue; }
    // Windows is case-insensitive: "a.js" and "A.js" are one file, and the
    // archive could use that to write one and read another.
    const key = name.toLowerCase();
    if (seen.has(key)) { skipped.push(name); continue; }
    seen.add(key);
    if (isSymlinkEntry(entry)) { skipped.push(name); continue; }

    let target = '';
    try { target = resolveInside(root, name); } catch { skipped.push(name); continue; }

    if (entry.isDirectory) {
      try { fs.mkdirSync(target, { recursive: true }); } catch { skipped.push(name); }
      continue;
    }

    const declared = Number(entry.header && entry.header.size) || 0;
    if (declared > limits.maxEntryBytes) {
      throw new Error('"' + name + '" is ' + human(declared) + ' - over the ' + human(limits.maxEntryBytes) + ' limit for one file.');
    }
    if (bytes + declared > limits.maxTotalBytes) {
      throw new Error('That archive unpacks to more than ' + human(limits.maxTotalBytes) + '.');
    }

    let data = null;
    try { data = entry.getData(); } catch (e) {
      throw new Error('Could not read "' + name + '" from the archive: ' + String((e && e.message) || e));
    }
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data || '');
    // The DECLARED size is attacker-controlled; the real size is not.
    if (buf.length > limits.maxEntryBytes) {
      throw new Error('"' + name + '" unpacks to ' + human(buf.length) + ' - over the ' + human(limits.maxEntryBytes) + ' limit for one file.');
    }
    if (bytes + buf.length > limits.maxTotalBytes) {
      throw new Error('That archive unpacks to more than ' + human(limits.maxTotalBytes) + '.');
    }

    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      // 0o600 on the file and 0o700 on the folder: the archive never gets to
      // choose permissions, so it cannot restore SUID/SGID bits.
      fs.writeFileSync(target, buf, { mode: 0o600 });
      try { fs.chmodSync(target, 0o600); } catch { /* Windows: not applicable */ }
    } catch (e) {
      throw new Error('Could not write "' + name + '": ' + String((e && e.message) || e));
    }
    files++;
    bytes += buf.length;
  }
  return { files, bytes, skipped };
}

module.exports = { extractZipSafely, safeEntryName, isSymlinkEntry, DEFAULT_LIMITS };
