// Memory Saver — pure decision logic for the RAM cap. No Electron, no I/O.
//
// The cap is a soft budget: Dexerion watches its own total working set and,
// when over budget, sleeps least-recently-used background tabs until the
// projected total fits. Guardrails keep the sleep invisible: the active tab,
// audible tabs, loading pages, never-loaded (lazy) tabs and the Focus-blocked
// page are never victims. Everything here is pure so the policy is
// unit-testable without an Electron runtime (see build/scripts/test-memsaver.js).
'use strict';

// A tab the user switched away from moments ago must not be discarded under
// memory pressure: react to pressure, don't race the user.
const IDLE_FLOOR_MS = 60 * 1000;

// The cap bounds the Settings picker offers and the main process enforces.
const CAP_MIN_MB = 1024;
const CAP_MAX_MB = 4096;
const CAP_DEFAULT_MB = 1536;

function clampCapMB(v) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return CAP_DEFAULT_MB;
  return Math.min(CAP_MAX_MB, Math.max(CAP_MIN_MB, n));
}

// One tab snapshot: { active, loading, lazy, sleeping, audible, hasView,
// lastActive, url, pid, memMB }.
function isEligible(s, nowMs, floorMs) {
  if (!s || s.sleeping || !s.hasView || s.lazy) return false;             // nothing to free
  if (s.loading || s.audible) return false;                               // mid-flight / playing
  if (s.active) return false;                                             // background tabs only
  if (String(s.url || '').startsWith('dexerion://blocked')) return false; // waking must not bypass Focus policy
  if (nowMs - (s.lastActive || 0) < floorMs) return false;                // too recently used
  return true;
}

// Decide which tabs to sleep for a given budget. Victims come back
// heaviest-process-first — the power hogs go before anything else; ties by
// least-recently-used — and the projected total credits each renderer process
// once. process-per-site shares one renderer across same-site tabs, so a
// victim always takes its whole process group (sleeping half of a group would
// free nothing). The estimate is optimistic; the next sweep re-measures.
function planSweep(snaps, opts) {
  const o = opts || {};
  const total = Number(o.totalMB) || 0;
  const cap = Number(o.capMB) || 0;
  const now = Number(o.now) || Date.now();
  const floorMs = o.floorMs === undefined ? IDLE_FLOOR_MS : o.floorMs;
  if (!(cap > 0) || total <= cap) return { victims: [], projectedMB: total, overMB: 0 };
  const eligible = (Array.isArray(snaps) ? snaps : []).filter(s => isEligible(s, now, floorMs));
  const groupOf = new Map();
  for (const s of eligible) {
    const key = s.pid || ('t:' + s.winId + ':' + s.tabId);
    if (!groupOf.has(key)) groupOf.set(key, []);
    groupOf.get(key).push(s);
  }
  const groups = [...groupOf.values()];
  for (const group of groups) group.sort((a, b) => (a.lastActive || 0) - (b.lastActive || 0));
  groups.sort((ga, gb) => {
    const ma = Number(ga[0].memMB) || 0, mb = Number(gb[0].memMB) || 0;
    if (mb !== ma) return mb - ma; // heaviest process first
    return (ga[0].lastActive || 0) - (gb[0].lastActive || 0); // then LRU
  });
  const victims = [];
  let projected = total;
  for (const group of groups) {
    if (projected <= cap) break; // don't sleep more than the budget needs
    for (const g of group) victims.push(g);
    projected -= (Number(group[0].memMB) || 0);
  }
  return { victims, projectedMB: Math.max(projected, 0), overMB: Math.max(0, total - cap) };
}

// The current tab gets a notice only when it is a notable consumer: a quarter
// of the budget, never under 300 MB.
function hogFloorMB(capMB) {
  return Math.max(300, Math.round((Number(capMB) || 0) * 0.25));
}
function shouldNoticeHog(activeMB, capMB, overMB) {
  return (Number(overMB) || 0) > 0 && (Number(activeMB) || 0) >= hogFloorMB(capMB);
}

module.exports = { planSweep, isEligible, clampCapMB, hogFloorMB, shouldNoticeHog, IDLE_FLOOR_MS, CAP_MIN_MB, CAP_MAX_MB, CAP_DEFAULT_MB };
