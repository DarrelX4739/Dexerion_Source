// Live artifact editing — the pure half.
//
// An edit replaces a website artifact's files (or its single html) and pushes
// the outgoing version onto a bounded history stack, so every edit can be
// undone and every restore is symmetric. The IPC handlers only deal with the
// chat store and persistence; all the rules live here and are unit-testable.
'use strict';

const aiArtifacts = require('./ai-artifacts');

const MAX_HISTORY = 5;
const MAX_SNAPSHOT_CHARS = 240000;
const MAX_HISTORY_CHARS = 900000;

// Returns { list, kept } so the caller can tell the person when a version was
// too large to keep: silently dropping it lost their undo without a word.
function pushHistory(history, artifact, note) {
  const list = Array.isArray(history) ? history.slice() : [];
  let snapshot = '';
  try { snapshot = JSON.stringify(artifact); } catch { return { list, kept: false }; }
  if (snapshot.length > MAX_SNAPSHOT_CHARS) return { list, kept: false };
  list.unshift({ at: Date.now(), note: String(note || '').slice(0, 160), artifact });
  while (list.length > MAX_HISTORY) list.pop();
  while (list.length) {
    let size = 0;
    try { size = JSON.stringify(list).length; } catch { size = MAX_HISTORY_CHARS + 1; }
    if (size <= MAX_HISTORY_CHARS) break;
    list.pop();
  }
  return { list, kept: true };
}

// Applies an edit to a site artifact. Returns { ok, artifact, warnings } or
// { ok: false, error }.
function applySourceEdit(current, payload) {
  const p = payload || {};
  if (!current || typeof current !== 'object') return { ok: false, error: 'There is no artifact to edit.' };
  if (current.kind !== 'site') return { ok: false, error: 'Only website artifacts can be edited here yet.' };
  let files = Array.isArray(p.files) ? p.files : null;
  const html = typeof p.html === 'string' ? p.html : null;
  if (!files && html === null) return { ok: false, error: 'Nothing to save.' };
  if (files && !files.length) return { ok: false, error: 'A website needs at least one file.' };
  // A single-file site stores its source in `files[0]`. An html-only save is a
  // perfectly valid way to edit it (the Code panel and quick text edits often
  // send exactly that), so write it back into the one file instead of refusing.
  // With several files, html alone would be ignored by the rebuild - reject.
  if (html !== null && !files && Array.isArray(current.files) && current.files.length) {
    if (current.files.length > 1) {
      return { ok: false, error: 'This website has multiple files - save its files instead.' };
    }
    files = [{ path: current.files[0].path, content: html }];
  }

  // Hand-edited files replace the old set entirely: never merge stale files the
  // person has deleted. `html: ''` makes the validator rebuild from `files`.
  const source = files
    ? { ...current, files, html: '' }
    : { ...current, html };
  delete source.history;
  const checked = aiArtifacts.normalizeArtifact(source);
  if (!checked.ok) {
    // The validator speaks in terms of the rebuilt document; when the cause is
    // that every supplied path was refused, say that instead.
    if (files && !(checked.artifact && checked.artifact.files)) {
      return { ok: false, error: 'None of those files could be used — paths must be relative and end in html, css, js, json, svg, txt or xml.' };
    }
    return { ok: false, error: checked.error || 'The edit was rejected.' };
  }

  const snapshot = pushHistory(current.history, current, p.note || 'edited in Code');
  const next = checked.artifact;
  next.history = snapshot.list;
  next.version = (Number(current.version) || 1) + 1;
  next.updatedAt = Date.now();
  const warnings = (checked.warnings || []).slice();
  if (!snapshot.kept) {
    // Say it out loud: without a snapshot this save cannot be undone.
    warnings.push('This version was too large to keep a copy of, so this save cannot be undone.');
  }
  return { ok: true, artifact: next, warnings, undoable: snapshot.kept };
}

// Direct report editing (V14): one text field of one block, edited in place in
// the reader. The research is explicit that this must be a model-first edit —
// the artifact JSON is the document, the DOM is a projection — so this
// function is the only writer, and it rides the same history/undo stack as
// every other artifact save.
const REPORT_EDIT_FIELDS = new Set(['text', 'body', 'label', 'attribution']);

function applyReportEdit(current, payload) {
  const p = payload || {};
  if (!current || typeof current !== 'object') return { ok: false, error: 'There is no artifact to edit.' };
  if (current.kind !== 'report') return { ok: false, error: 'Only reports can be edited here yet.' };
  const blocks = Array.isArray(current.blocks) ? current.blocks : [];
  if (!blocks.length) return { ok: false, error: 'This report has no editable blocks.' };
  const index = Number(p.blockIndex);
  const block = Number.isInteger(index) && index >= 0 && index < blocks.length ? blocks[index] : null;
  if (!block) return { ok: false, error: 'That block is no longer part of the report.' };
  const field = String(p.field || 'text');
  if (!REPORT_EDIT_FIELDS.has(field)) return { ok: false, error: 'That field cannot be edited.' };
  const before = String(block[field] == null ? '' : block[field]);
  const value = String(p.value == null ? '' : p.value).replace(/\r\n/g, '\n').trim();
  if (!value) return { ok: false, error: 'The text cannot be empty.' };
  if (value === before) return { ok: false, error: 'Nothing changed.' };
  if (value.length > 4000) return { ok: false, error: 'That text is too long for one block.' };
  // Reports are structured data, not HTML — never let script, iframe, style or
  // javascript: URLs into an edited block. The renderer paints blocks as text;
  // any markup would either be painted literally (broken) or, worse, parsed as
  // HTML/CSS somewhere down the line.
  if (/<script\b|<iframe\b|<style\b|javascript:\s*/i.test(value)) return { ok: false, error: 'Report text cannot contain script, iframe, style or javascript: URLs.' };
  const snapshot = pushHistory(current.history, current, p.note || 'edited in the reader');
  const next = Object.assign({}, current, {
    history: snapshot.list,
    version: (Number(current.version) || 1) + 1,
    updatedAt: Date.now(),
  });
  next.blocks = blocks.map((b, i) => (i === index ? Object.assign({}, b, { [field]: value }) : b));
  const warnings = snapshot.kept ? [] : ['This version was too large to keep a copy of, so this edit cannot be undone.'];
  return { ok: true, artifact: next, warnings, undoable: snapshot.kept };
}

// Swaps the artifact back to a snapshot. The version being left becomes the new
// head of the stack, so restore is undoable too.
function restoreVersion(current, at) {
  if (!current || typeof current !== 'object') return { ok: false, error: 'There is no artifact to restore.' };
  const history = Array.isArray(current.history) ? current.history.slice() : [];
  if (!history.length) return { ok: false, error: 'There are no earlier versions.' };
  const which = at == null ? 0 : history.findIndex((h) => Number(h.at) === Number(at));
  if (which < 0 || !history[which] || !history[which].artifact) {
    return { ok: false, error: 'That version is no longer available.' };
  }
  const restored = history[which].artifact;
  const snapshot = pushHistory(history.filter((_, i) => i !== which), current, 'before restore');
  // Reading notes are USER data, not document content (V20 polish): an undo of
  // a text edit must never delete notes added after the snapshot was taken.
  // Union by id — the restored snapshot's notes first, then any newer ones it
  // predates. Sites carry no notes, so this is a no-op there.
  const restoredNotes = Array.isArray(restored.annotations) ? restored.annotations : [];
  const currentNotes = Array.isArray(current.annotations) ? current.annotations : [];
  const seenNoteIds = new Set(restoredNotes.map((a) => String((a && a.id) || '')));
  const mergedNotes = restoredNotes.concat(
    currentNotes.filter((a) => a && !seenNoteIds.has(String(a.id || ''))),
  );
  // A restore is a new head, so the version number moves forward with it —
  // otherwise the version list shows the same number twice.
  const next = {
    ...restored,
    history: snapshot.list,
    version: (Number(current.version) || 1) + 1,
    updatedAt: Date.now(),
  };
  if (mergedNotes.length) next.annotations = mergedNotes;
  return {
    ok: true,
    artifact: next,
    restoredAt: Number(history[which].at) || 0,
    warnings: snapshot.kept ? [] : ['This version was too large to keep a copy of, so the restore cannot be undone.'],
  };
}

module.exports = { applySourceEdit, applyReportEdit, restoreVersion, pushHistory, MAX_HISTORY };
