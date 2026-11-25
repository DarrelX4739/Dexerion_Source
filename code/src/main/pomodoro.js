// Focus Timer (Pomodoro) engine — no Electron except the injected notify().
// Work/break state machine with a 500ms tick, persisted settings, and a
// per-tab-session blocklist enforced by the browser's request guard while a
// work phase is active (running or paused — pausing the clock doesn't pause
// the commitment).
'use strict';
const { normalizeDomain, normalizeAllowlist, hostAllowed, isHttpUrl, hostOf } = require('./site-policy');

const SOUNDS = ['drizzlo', 'cuphaze', 'nodland', 'glidelo', 'white', 'rain', 'brown', 'pad', 'off'];
const DEFAULTS = { workMin: 25, breakMin: 5, sound: 'white', volume: 45, blocklist: [] };
// An untouched tab sleeps after this long. Exported (with the predicate) so
// the sweep is unit-testable without Electron.
const SLEEP_IDLE_MS = 5 * 60 * 1000;
// Pure sleep decision for one tab snapshot:
// { active, loading, lazy, sleeping, audible, hasView, lastActive }, nowMs.
// Returns 'sleep' (tear down the renderer), 'mark' (nothing worth freeing —
// a never-loaded tab — but show the zzz), or 'no'.
function shouldSleepTab(snap, nowMs, idleMs) {
  const idle = idleMs === undefined ? SLEEP_IDLE_MS : idleMs;
  if (!snap || snap.sleeping || snap.active || snap.loading) return 'no';
  if (snap.audible) return 'no';
  if ((nowMs - (snap.lastActive || 0)) < idle) return 'no';
  if (snap.lazy || !snap.hasView) return 'mark';
  return 'sleep';
}
const MIN_MS = 1000;

function clampInt(v, lo, hi, fb) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fb;
  return Math.min(hi, Math.max(lo, n));
}

function createPomodoro({ profile, notify, onChange }) {
  const state = {
    phase: 'idle', // idle | work | break
    running: false,
    remainMs: DEFAULTS.workMin * 60000,
    endsAt: 0,
    timer: null,
  };

  function cfg() {
    const s = (profile && profile.data && profile.data.settings) || {};
    return {
      workMin: clampInt(s.pomoWorkMin, 1, 180, DEFAULTS.workMin),
      breakMin: clampInt(s.pomoBreakMin, 1, 60, DEFAULTS.breakMin),
      sound: SOUNDS.includes(s.pomoSound) ? s.pomoSound : DEFAULTS.sound,
      volume: clampInt(s.pomoVolume, 0, 100, DEFAULTS.volume),
      blocklist: normalizeAllowlist(s.pomoBlocklist),
    };
  }
  function workMs(over) { return over && over > 0 ? Math.max(MIN_MS, Math.floor(over)) : cfg().workMin * 60000; }
  function breakMs(over) { return over && over > 0 ? Math.max(MIN_MS, Math.floor(over)) : cfg().breakMin * 60000; }

  function emit(kind) { try { onChange && onChange(kind || 'event', publicState()); } catch {} }
  function persist() { try { profile.saveSoon && profile.saveSoon(); } catch {} }

  function publicState() {
    const c = cfg();
    return {
      phase: state.phase,
      running: state.running,
      remainMs: Math.max(0, Math.ceil(state.remainMs / 1000) * 1000),
      endsAt: state.running ? state.endsAt : 0,
      workMin: c.workMin, breakMin: c.breakMin,
      sound: c.sound, volume: c.volume,
      blocklist: c.blocklist,
      blocking: state.phase === 'work',
    };
  }

  function stopTick() { if (state.timer) { clearInterval(state.timer); state.timer = null; } }
  function startTick() {
    stopTick();
    state.timer = setInterval(tick, 500);
    if (state.timer.unref) state.timer.unref();
  }

  function tick() {
    if (!state.running) return;
    state.remainMs = state.endsAt - Date.now();
    if (state.remainMs > 0) { emit('tick'); return; }
    stopTick();
    state.running = false;
    if (state.phase === 'work') {
      state.phase = 'break';
      state.remainMs = breakMs();
      state.endsAt = 0;
      try { notify && notify('Work done', 'Take a break — press start when ready.'); } catch {}
    } else if (state.phase === 'break') {
      state.phase = 'work';
      state.remainMs = workMs();
      state.endsAt = 0;
      try { notify && notify('Break over', 'Back to work — press start.'); } catch {}
    }
    emit();
  }

  function begin(phase, ms) {
    state.phase = phase;
    state.remainMs = ms;
    state.endsAt = Date.now() + ms;
    state.running = true;
    startTick();
    emit();
  }

  const api = {
    state: publicState,
    configure(patch) {
      const s = profile.data.settings || (profile.data.settings = {});
      const p = patch || {};
      if (p.workMin !== undefined) s.pomoWorkMin = clampInt(p.workMin, 1, 180, cfg().workMin);
      if (p.breakMin !== undefined) s.pomoBreakMin = clampInt(p.breakMin, 1, 60, cfg().breakMin);
      if (p.sound !== undefined && SOUNDS.includes(String(p.sound))) s.pomoSound = String(p.sound);
      if (p.volume !== undefined) s.pomoVolume = clampInt(p.volume, 0, 100, cfg().volume);
      if (p.blocklist !== undefined) s.pomoBlocklist = normalizeAllowlist(p.blocklist);
      if (state.phase === 'idle') state.remainMs = cfg().workMin * 60000;
      persist();
      emit();
      return publicState();
    },
    // opts.workMs/breakMs are ms overrides (used by the self-test; the UI
    // always passes minutes converted to ms).
    start(phase, opts) {
      const o = opts || {};
      const ph = phase === 'break' ? 'break' : 'work';
      begin(ph, ph === 'work' ? workMs(o.workMs) : breakMs(o.breakMs));
      return publicState();
    },
    toggle() {
      if (state.running) return api.pause();
      if (state.phase === 'idle') return api.start('work');
      state.running = true;
      state.endsAt = Date.now() + Math.max(MIN_MS, state.remainMs);
      startTick();
      emit();
      return publicState();
    },
    pause() {
      if (!state.running) return publicState();
      state.remainMs = Math.max(0, state.endsAt - Date.now());
      state.running = false;
      state.endsAt = 0;
      stopTick();
      emit();
      return publicState();
    },
    skip() {
      stopTick();
      state.running = false;
      state.endsAt = 0;
      if (state.phase === 'work') { state.phase = 'break'; state.remainMs = breakMs(); }
      else if (state.phase === 'break') { state.phase = 'work'; state.remainMs = workMs(); }
      emit();
      return publicState();
    },
    reset() {
      stopTick();
      state.phase = 'idle';
      state.running = false;
      state.endsAt = 0;
      state.remainMs = cfg().workMin * 60000;
      emit();
      return publicState();
    },
    addBlock(input) {
      const s = profile.data.settings || (profile.data.settings = {});
      const list = normalizeAllowlist(cfg().blocklist.concat([input]));
      s.pomoBlocklist = list;
      persist();
      emit();
      return list;
    },
    removeBlock(input) {
      const s = profile.data.settings || (profile.data.settings = {});
      const d = normalizeDomain(input);
      s.pomoBlocklist = normalizeAllowlist(cfg().blocklist).filter((x) => x !== d);
      persist();
      emit();
      return s.pomoBlocklist;
    },
    blocks(url) {
      if (state.phase !== 'work') return false;
      if (!isHttpUrl(url)) return false;
      return hostAllowed(hostOf(url), cfg().blocklist);
    },
    blockInfo(url) {
      const info = { host: hostOf(url) || String(url || '') };
      if (state.running && state.endsAt) info.endsAt = state.endsAt;
      return info;
    },
  };
  return api;
}

module.exports = { createPomodoro, SOUNDS, DEFAULTS, SLEEP_IDLE_MS, shouldSleepTab };
