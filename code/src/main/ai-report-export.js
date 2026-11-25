// Report export: PDF via printToPDF, HTML/Markdown/DOCX written straight to
// disk. The renderer builds the standalone HTML; this module only renders the
// PDF and writes the bytes. The artifact is re-validated by the caller.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { BrowserWindow, dialog } = require('electron');
const { reportDocx } = require('./ai-report-docx');

const FORMATS = {
  pdf: { name: 'PDF', ext: 'pdf' },
  html: { name: 'HTML', ext: 'html' },
  md: { name: 'Markdown', ext: 'md' },
  docx: { name: 'Word', ext: 'docx' },
};

function safeName(value) {
  const base = String(value || 'report').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return base || 'report';
}

// The HTML is self-contained and static; scripts stay off in the print window.
async function renderPdf(html) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dex-report-'));
  const page = path.join(dir, 'report.html');
  await fs.promises.writeFile(page, html, { mode: 0o600 });
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    frame: false,
    skipTaskbar: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
  });
  try {
    await win.loadFile(page);
    return await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.5, bottom: 0.5, left: 0.55, right: 0.55 },
    });
  } finally {
    try { win.destroy(); } catch {}
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function save({ win, format, name, html, markdown, artifact, explicitPath }) {
  const chosen = FORMATS[format] ? format : 'html';
  const spec = FORMATS[chosen];
  // DOCX only knows how to lay out a report — every other format is kind-agnostic.
  if (chosen === 'docx' && (!artifact || artifact.kind !== 'report')) {
    return { ok: false, error: 'This artifact can be exported as HTML or PDF.' };
  }
  let target = explicitPath || '';
  if (!target) {
    const result = await dialog.showSaveDialog(win, {
      title: 'Save report',
      defaultPath: safeName(name) + '.' + spec.ext,
      filters: [{ name: spec.name, extensions: [spec.ext] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    target = result.filePath;
  }
  let data;
  if (chosen === 'pdf') data = await renderPdf(html);
  else if (chosen === 'html') data = Buffer.from(html, 'utf8');
  else if (chosen === 'md') data = Buffer.from(markdown, 'utf8');
  else data = reportDocx(artifact);
  // Atomic write: a crash or full disk mid-write must not leave a truncated
  // file that looks like a successful export. Write to a temp file in the same
  // directory, then rename over the target (rename is atomic on the same
  // volume, including Windows).
  const tmp = target + '.tmp.' + process.pid;
  try {
    await fs.promises.writeFile(tmp, data);
    await fs.promises.rename(tmp, target);
  } catch (e) {
    try { await fs.promises.unlink(tmp).catch(() => {}); } catch {}
    return { ok: false, error: String((e && e.message) || e) };
  }
  return { ok: true, path: target, bytes: data.length };
}

module.exports = { save, safeName, FORMATS, renderPdf };
