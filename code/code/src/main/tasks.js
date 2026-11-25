// Tasks engine — pure helpers, no Electron. Sort + validate + reminders.
// Date is compulsory, time is optional (defaults to 09:00 local so a
// "30 minutes before" reminder lands at 08:30, not 23:30 the night before).
// Priority is high | medium | low only. One engine serves all accounts; each
// account's list lives in its own tasks.json (see profile.js).
'use strict';

const PRIORITIES = ['high', 'medium', 'low'];
const PRI_RANK = { high: 0, medium: 1, low: 2 };
const PRE_NOTIFY_MS = 30 * 60 * 1000;
const ALLDAY_HOUR = 9;
const TITLE_MAX = 200;
const NOTES_MAX = 2000;

function cleanStr(v, max) {
  return String(v === undefined || v === null ? '' : v).slice(0, max);
}

function newId() {
  return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Parse compulsory YYYY-MM-DD date + optional HH:MM time into a local-epoch
// due. Throws on anything invalid (main turns it into an IPC error).
function dueMsFromParts(dateStr, timeStr) {
  const d = String(dateStr || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) throw new Error('A due date (YYYY-MM-DD) is required.');
  const y = Number(m[1]), mo = Number(m[2]), day = Number(m[3]);
  let hh = ALLDAY_HOUR, mm = 0, hasTime = false;
  const t = String(timeStr || '').trim();
  if (t) {
    const tm = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t);
    if (!tm) throw new Error('Time must be HH:MM (24h), or left blank.');
    hh = Number(tm[1]); mm = Number(tm[2]); hasTime = true;
  }
  const dt = new Date(y, mo - 1, day, hh, mm, 0, 0);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== day) {
    throw new Error('That due date does not exist.');
  }
  return { dueMs: dt.getTime(), hasTime };
}

// Clean one stored task; returns null for unrecoverable entries (blank title
// or no usable due) so one corrupt row can never break the whole list.
function normalizeTask(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = cleanStr(raw.title, TITLE_MAX).trim();
  const dueMs = Math.floor(Number(raw.dueMs));
  if (!title || !Number.isFinite(dueMs) || dueMs <= 0) return null;
  const pri = String(raw.priority || 'medium').toLowerCase();
  const createdAt = Math.floor(Number(raw.createdAt));
  return {
    id: String(raw.id || newId()),
    title,
    notes: cleanStr(raw.notes, NOTES_MAX),
    dueMs,
    hasTime: raw.hasTime === true,
    priority: PRIORITIES.includes(pri) ? pri : 'medium',
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
    done: raw.done === true,
    doneAt: raw.done === true ? Math.floor(Number(raw.doneAt)) || Date.now() : 0,
    remindedPre: raw.remindedPre === true,
    remindedDue: raw.remindedDue === true,
  };
}

function sanitizeList(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of arr) {
    const t = normalizeTask(raw);
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

function priRank(p) {
  return p in PRI_RANK ? PRI_RANK[p] : PRI_RANK.medium;
}

// Open tasks first, then done — each run sorted by due date, then priority
// (high first), then oldest created first.
function sortTasks(list) {
  return sanitizeList(list).sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.dueMs !== b.dueMs) return a.dueMs - b.dueMs;
    const pr = priRank(a.priority) - priRank(b.priority);
    if (pr !== 0) return pr;
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return String(a.id) < String(b.id) ? -1 : 1;
  });
}

// Top 3 open tasks for the rail peek strip.
function nextThree(list) {
  return sortTasks(list).filter((t) => !t.done).slice(0, 3);
}

function makeTask(input) {
  const src = input || {};
  const title = cleanStr(src.title, TITLE_MAX).trim();
  if (!title) throw new Error('A title is required.');
  const pri = String(src.priority || 'medium').toLowerCase();
  if (!PRIORITIES.includes(pri)) throw new Error('Priority must be high, medium or low.');
  const { dueMs, hasTime } = dueMsFromParts(src.date, src.time);
  const now = Date.now();
  return {
    id: newId(),
    title,
    notes: cleanStr(src.notes, NOTES_MAX).trim(),
    dueMs,
    hasTime,
    priority: pri,
    createdAt: now,
    done: false,
    doneAt: 0,
    remindedPre: false,
    remindedDue: false,
  };
}

// Which reminder (if any) is owed for one open task right now. Flags are set
// by the caller when the notification fires, so each reminder fires once —
// including across restarts, since flags persist on the task.
function reminderKind(task, nowMs) {
  if (!task || task.done) return null;
  const now = Number(nowMs);
  if (!Number.isFinite(now)) return null;
  if (!task.remindedDue && now >= task.dueMs) return 'due';
  if (!task.remindedPre && now >= task.dueMs - PRE_NOTIFY_MS && now < task.dueMs) return 'pre';
  return null;
}

module.exports = {
  PRIORITIES,
  PRE_NOTIFY_MS,
  ALLDAY_HOUR,
  dueMsFromParts,
  normalizeTask,
  sanitizeList,
  sortTasks,
  nextThree,
  makeTask,
  reminderKind,
};
