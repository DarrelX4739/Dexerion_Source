// Core browser: windows, WebContentsView tabs, navigation, history,
// bookmarks, downloads, context menus, IPC, internal pages, session restore.
const { app, BrowserWindow, WebContentsView, ipcMain, protocol, net, dialog, shell, Menu, nativeTheme, screen, safeStorage, desktopCapturer, clipboard, nativeImage, ClipboardItem, webFrameMain, Notification } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { SEARCH_ENGINES } = require('./profile');
const { BRAND } = require('./branding');
// ---------- B3: lazy main-process AI/module stack ----------
// Boot only needs the browsing core. The AI/report/agent stack below is
// required on first use instead of at load: every accessor hands back the
// REAL module object (or function) on first touch, so all exports, method
// behaviour and call sites are unchanged — only the boot-time require is
// deferred, and a session that never opens the AI panel never loads it.
// Modules already pulled in by the eager boot set (ai.js loads ai-router,
// ai-artifacts, ai-skills via ai-prompts, site-research-assets and
// ai-search-read; pomodoro.js loads site-policy) stay eager: deferring those
// would save nothing. ai.js itself stays eager in main.js (createAi is needed
// for IPC registration at boot).
// A/B: DEX_EAGER_AI=1 restores the old boot-time loading exactly.
const EAGER_AI = process.env.DEX_EAGER_AI === '1';
const lazyModule = (name) => {
  if (EAGER_AI) return require(name);
  let mod = null;
  return new Proxy({}, {
    get: (_t, prop) => { if (!mod) mod = require(name); return mod[prop]; },
    has: (_t, prop) => { if (!mod) mod = require(name); return prop in mod; },
  });
};
// Same seam for a single function export (the call sites keep the bare name).
const lazyFn = (name, prop) => {
  if (EAGER_AI) return require(name)[prop];
  let fn = null;
  return (...args) => {
    if (!fn) fn = require(name)[prop];
    return fn(...args);
  };
};
const aiRouter = require('./ai-router');            // eager: ai.js loads it anyway
const aiPage = lazyModule('./ai-page');
const aiArtifacts = require('./ai-artifacts');      // eager: ai.js loads it anyway
const aiSiteHost = lazyModule('./ai-site-host');
const artifactHtml = lazyModule('./ai-artifact-html');
const artifactZip = lazyModule('./ai-artifact-zip');
const artifactEdit = lazyModule('./ai-artifact-edit');
const settleAfterAction = lazyFn('./ai-settle', 'settleAfterAction');
const reportPresets = lazyModule('./report-presets');
const reportExport = lazyModule('./ai-report-export');
const aiAgent = lazyModule('./ai-agent');
const skills = require('./ai-skills');              // eager: ai-prompts loads it anyway
const aiSkillLoop = lazyModule('./ai-skill-loop');
// ai-approvals is tiny with no transitive deps and its timeout constant is
// read at handler setup — keep it eager.
const { createApprovals, DEFAULT_TIMEOUT_MS: SKILL_ASK_TIMEOUT_MS } = require('./ai-approvals');
const aiSearch = lazyModule('./ai-search');
const aiSearchRead = require('./ai-search-read');   // eager: site-research-assets loads it anyway
const aiSearchSynth = lazyModule('./ai-search-synth');
const research = lazyModule('./ai-research');
const sitePolicy = require('./site-policy');        // eager: pomodoro.js loads it anyway
const siteVersions = lazyModule('./site-generator-versions');
const siteIntent = lazyModule('./site-intent');
const siteResearchAssets = require('./site-research-assets'); // eager: ai.js loads it anyway
const reportIntent = lazyModule('./report-intent');
const siteSystemPrompt = lazyFn('./site-system-prompt', 'siteSystemPrompt');
const reportVersions = lazyModule('./report-version-spec');
const reportSystemPrompt = lazyFn('./report-system-prompt', 'reportSystemPrompt');
const { createPomodoro, SOUNDS, DEFAULTS, SLEEP_IDLE_MS, shouldSleepTab } = require('./pomodoro');
const { planSweep, clampCapMB, shouldNoticeHog } = require('./memsaver');
const { BUDGETS, activeProfile } = require('./debloat-budgets');
const tasks = require('./tasks');
const { attachSyncBridge } = require('./ext-sync-bridge');
const adaptivePower = require('./adaptive-power');

const CHROME_TOP = 104; // tabstrip(38) + toolbar(46) + bookmarkbar(20 when shown)
const CHROME_TOP_NO_BOOKMARKS = 84;
// Fallback width of the vertical tab rail, used only until the shell reports the
// real measured width. It was hardcoded at 238 while shell.css draws the rail at
// 204 — every vertical-tabs window had a 34px dead column of chrome between the
// rail and the page. The shell now measures it (dex:rail-w, same pattern as
// chrome-h), so this is a starting guess rather than a second source of truth.
const VERTICAL_RAIL = 204;
const AI_SIDEBAR_W = 480;      // default open width
const AI_SIDEBAR_MIN_W = 320;  // resize floor
const AI_SIDEBAR_MAX_W = 720;  // resize ceiling
const TOOLBAR_H = 46, BOOKMARKBAR_H = 20;
const APP_ICON = path.join(__dirname, '../../assets/icon.ico');

const GOOGLE_SERVICES = {
  gmail: 'https://mail.google.com/',
  drive: 'https://drive.google.com/',
  docs: 'https://docs.google.com/',
};

// The linked email is a DEFAULT, not a lock. accounts.google.com/AccountChooser
// re-presents the chooser on every visit, so routing through it forever would
// force that one account on the user even after they deliberately switched.
// Once this profile already has a live Google session, open the service
// directly and honour whichever account they are actually signed into; the
// chooser is only used to establish a first session, or when they explicitly
// ask to pick.
function googleUrl(service, email, signedIn) {
  const cont = service === 'chooser' ? 'https://myaccount.google.com/'
    : (GOOGLE_SERVICES[service] || GOOGLE_SERVICES.gmail);
  if (service !== 'chooser' && signedIn) return cont;
  const hint = email ? `&Email=${encodeURIComponent(email)}` : '';
  return `https://accounts.google.com/AccountChooser?continue=${encodeURIComponent(cont)}${hint}`;
}

// ---------- popup support (pure helpers — no Electron, unit-tested) ----------
// window.open features string is `width=500,height=600,left=100,popup=1,...`.
// Returns numeric/hint fields only; unknown tokens are ignored.
function parsePopupFeatures(features) {
  const out = {};
  if (!features || typeof features !== 'string') return out;
  for (const part of features.split(',')) {
    const [rawK, rawV] = part.split('=');
    if (!rawK) continue;
    const k = rawK.trim().toLowerCase();
    const v = (rawV || '').trim().toLowerCase();
    if (['width', 'height', 'left', 'top', 'x', 'y', 'screenx', 'screeny'].includes(k)) {
      const n = parseInt(v, 10);
      if (Number.isFinite(n)) out[k === 'screenx' ? 'left' : k === 'screeny' ? 'top' : k === 'x' ? 'left' : k === 'y' ? 'top' : k] = n;
    } else if (k === 'popup' && (v === '' || v === '1' || v === 'yes' || v === 'true')) {
      out.popup = true;
    }
  }
  return out;
}

// A window name only an identity library uses — Google Identity Services
// opens its prompt as 'oauth2'. Explicit intent, independent of the URL.
function isOAuthWindowName(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return false;
  return /oauth/i.test(n) || ['gsi', 'signin', 'sign-in', 'login'].includes(n);
}

// Provider family for the same-site check: Google/Microsoft/Apple identity
// and product hosts collapse to one key; anything else compares by its last
// two labels so www./app. subdomains stay together.
function siteKey(host) {
  const h = String(host || '').trim().toLowerCase().replace(/\.$/, '');
  if (!h) return '';
  if (/(^|\.)google\.[a-z]{2,}(\.[a-z]{2,})?$/.test(h) || /(^|\.)(googleusercontent|gstatic|withgoogle)\.com$/.test(h)) return 'google';
  if (/(^|\.)(microsoft|microsoftonline|live|office|officeapps|microsoft365|sharepoint)\.com$/.test(h) || /(^|\.)office\.net$/.test(h)) return 'microsoft';
  if (/(^|\.)apple\.com$/.test(h)) return 'apple';
  if (/(^|\.)auth0\.com$/.test(h)) return 'auth0';
  if (/(^|\.)okta\.com$/.test(h)) return 'okta';
  const parts = h.split('.');
  return parts.length > 2 ? parts.slice(-2).join('.') : h;
}

function hostOf(url) {
  try { return new URL(String(url || '')).hostname.toLowerCase(); } catch { return ''; }
}

// Sign-in prompts are the only kind of window.open that still gets a real
// popup: OAuth/identity flows (Continue with Google, Sign in with Microsoft,
// …) depend on a live window.opener handshake and self-close, and they break
// when forced into a tab. Detected by URL shape (auth hosts / auth paths) or
// by the auth-style window name identity libraries use (GIS: 'oauth2').
// A provider's OWN pages opening its sign-in routes are internal account
// routing, not a third-party sign-in popup — Drive's "Open with Google Docs"
// passes through accounts.google.com and must end up in a tab.
function isSignInOpen(details = {}) {
  if (isOAuthWindowName(details.frameName)) return true;
  const raw = String(details.url || '').trim();
  if (!raw) return false;
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    const path = (u.pathname + u.search).toLowerCase();
    const authPage = /(^|\.)accounts\.google\.[a-z.]+$/.test(host)
      || /^(accounts?|login|signin|sso|auth)\./.test(host)
      || /^(login\.microsoftonline\.com|login\.live\.com|appleid\.apple\.com)$/.test(host)
      || /\.(auth0|okta)\.com$/.test(host)
      || /(^|\/)(oauth2?|openid|sign-?in|login|auth)(\/|$|\?|#)/.test(path);
    if (!authPage) return false;
    const opener = hostOf(details.openerUrl);
    if (opener && siteKey(opener) === siteKey(host)) return false;
    return true;
  } catch { return false; }
}

// Decide what a setWindowOpenHandler event should become.
// Returns 'popup' | 'popup-hidden' | 'tab-foreground' | 'tab-background' | 'ignore'.
// Popups exist for sign-in only (isSignInOpen): every other open — links,
// window.open with size features, named targets, "Open with …" flows — becomes
// a foreground tab in the same window. A blank window.open() (the "pre-open,
// then w.location = realUrl" pattern) becomes 'popup-hidden' unless its name
// is auth-style: it is created invisible so the opener keeps a live handle,
// and its first real navigation moves into a tab (see wireHiddenPreopen) —
// unless that navigation is itself a sign-in, in which case the window is
// shown and stays the popup the flow needs.
function classifyWindowOpen({ url, frameName, features, disposition, openerUrl } = {}) {
  const disp = String(disposition || 'default').toLowerCase();
  if (disp === 'save-to-disk') return 'ignore';
  if (disp === 'background-tab') return 'tab-background';
  const target = String(url || '').trim();
  if (!target || /^about:blank$/i.test(target)) {
    return isOAuthWindowName(frameName) ? 'popup' : 'popup-hidden';
  }
  if (isSignInOpen({ url: target, frameName, openerUrl })) return 'popup';
  return 'tab-foreground';
}

// Size/position for a popup from its window.open features string. Pure (no
// Electron): parentBounds is { x, y, width, height } or null. Keeps the
// opener-linked allow path and the manual openPopup fallback in agreement.
function buildPopupBounds(features, parentBounds) {
  const feat = parsePopupFeatures(features);
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(n)));
  const width = clamp(feat.width || 520, 200, 1400);
  const height = clamp(feat.height || 620, 200, 1000);
  const out = { width, height };
  if (Number.isFinite(feat.left) && Number.isFinite(feat.top)) {
    out.x = Math.round(feat.left);
    out.y = Math.round(feat.top);
  } else if (parentBounds) {
    out.x = Math.round(parentBounds.x + Math.max(0, (parentBounds.width - width) / 2));
    out.y = Math.round(parentBounds.y + Math.max(0, (parentBounds.height - height) / 3));
  }
  return out;
}

// Extension action-popup sizing (pure — no Electron, unit-tested).
// Chrome/Edge sizes an action popup to the popup page's own content,
// clamped to at most 800x600. Non-finite/missing measurements fall back to
// the legacy default so a slow page still gets a usable window.
function clampPopupSize(w, h) {
  const cw = Math.round(Number(w));
  const ch = Math.round(Number(h));
  const fw = Number.isFinite(cw) && cw > 0 ? cw : 380;
  const fh = Number.isFinite(ch) && ch > 0 ? ch : 560;
  return { width: Math.min(800, Math.max(25, fw)), height: Math.min(600, Math.max(25, fh)) };
}

// Final popup bounds from content measurements + current bounds (pure).
// scroll* is the viewport-floored document size; content* is the union of
// the body's children, immune to a body/html inflated by 100% heights
// (which would otherwise pin the window to the initial generic size — e.g.
// a 300px popup stuck at 380 wide). The smaller wins so inflated documents
// shrink to their real content; unmeasurable pages keep the default.
function resolvePopupSize(m, bounds) {
  const num = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };
  const sw = num(m && m.scrollW), sh = num(m && m.scrollH);
  const cw = num(m && m.contentW), ch = num(m && m.contentH);
  const s = clampPopupSize(Math.min(sw || 380, cw || 380), Math.min(sh || 560, ch || 560));
  const b = bounds || { x: 0, y: 0, width: 380, height: 560 };
  return { ...b, width: s.width, height: s.height, x: b.x + b.width - s.width };
}

function createBrowser({ profile, extensions, permissions, sessionModule, ai }) {
  const S = profile.data;
  // Dexerion is vertical-tabs only: migrate any stored horizontal preference
  // once, then never consult the setting again.
  if (!S.settings) S.settings = {};
  if (S.settings.verticalTabs !== true) {
    S.settings.verticalTabs = true;
    try { profile.saveSoon(); } catch {}
  }
  for (const download of S.downloads) {
    if (download.active || download.state === 'progressing' || download.state === 'paused') {
      download.active = false;
      download.state = 'interrupted';
      download.bytesPerSecond = 0;
    }
  }
  const windows = new Map(); // winId -> { win, tabs: Map, order: [], active }
  let winSeq = 0, tabSeq = 0;

  // ---------- adaptive power management ----------
  // Event-driven: window focus/blur/minimize, powerMonitor transitions and tab
  // activity all re-evaluate the plan immediately; the housekeeping sweep is
  // scheduled by timeout (never a busy poll) with a cadence derived from the
  // current power tier. Page work is never throttled — only Dexerion's own
  // sweeps and whether views may composite are governed from here.
  const power = {
    tier: 'balanced',
    tierSince: Date.now(),
    lastInteraction: Date.now(),
    locked: false,
    onBattery: false,
    plan: null,
    timer: null,
    _cpuPrev: undefined,
  };
  // B1 — open overlay views (snip / report viewer / site preview) attached to
  // a window, so they can follow the window's visibility. With
  // CalculateNativeWinOcclusion disabled, Chromium never marks a minimized
  // window occluded, so an attached overlay keeps compositing while the
  // window sits in the taskbar. A closed overlay is removed from its state
  // map, so only still-attached views are listed here.
  function overlayViewsFor(winId) {
    const out = [];
    const sn = snipState.get(winId);
    if (sn && sn.view && !sn.view.webContents.isDestroyed()) out.push(sn.view);
    const rv = reportOverlayState.get(winId);
    if (rv && rv.view && !rv.view.webContents.isDestroyed()) out.push(rv.view);
    const sv = siteOverlayState.get(winId);
    if (sv && sv.view && !sv.view.webContents.isDestroyed()) out.push(sv.view);
    return out;
  }
  // B1 - the measured off-switch for frame production is the SAME state the
  // background-tab fix uses: out of the view tree (detached) AND
  // setVisible(false). setVisible(false) alone on an attached view does not
  // stop rAF (probe-wcv-semantics states 2 vs 4), and this app disables
  // CalculateNativeWinOcclusion, so nothing else marks minimized windows
  // occluded (measured: 60fps rAF keeps running in a minimized window).
  // Detaching is visibility-only: the renderer keeps its page state, timers
  // and audio; activateTab() re-attaches on the next switch, so the system
  // self-heals. Kill switch: DEX_TAB_DETACH=off (or the legacy budget
  // profile, tabDetachOnMinimize=0) restores the legacy setVisible-only
  // behaviour exactly.
  function detachView(winId, view) {
    const st = windows.get(winId);
    try { if (st) st.win.contentView.removeChildView(view); } catch {}
    try { view.setVisible(false); } catch {}
  }
  function attachView(winId, view) {
    const st = windows.get(winId);
    try { if (st) st.win.contentView.addChildView(view); } catch {}
    try { view.setVisible(true); } catch {}
  }
  function setWindowViewsVisible(winId, visible) {
    const st = windows.get(winId); if (!st) return;
    const detachLev = Number(BUDGETS.tabDetachOnMinimize) !== 0 && process.env.DEX_TAB_DETACH !== 'off';
    // Defensive: the HIDE direction must only ever detach in a genuinely
    // minimized/hidden window (the callers guarantee this; double-check so a
    // stray call in a shown window can never blank a visible tab). The SHOW
    // direction runs in the restore handler, where the window is visible
    // again by definition.
    let windowHidden = true;
    try { windowHidden = !st.win.isVisible() || st.win.isMinimized(); } catch {}
    const canDetach = detachLev && (visible || windowHidden);
    for (const [tid, t] of st.tabs) {
      if (!t || !t.view) continue;
      const show = visible && tid === st.active && !st.searchOpen;
      if (canDetach) {
        if (show) {
          try { st.win.contentView.addChildView(t.view); } catch {}
          try { t.view.setVisible(true); } catch {}
        } else {
          detachView(winId, t.view);
        }
      } else {
        // Legacy behaviour (tabDetachOnMinimize=0 / DEX_TAB_DETACH=off):
        // visibility flags only, exactly as before B1.
        try { t.view.setVisible(visible && tid === st.active); } catch {}
      }
    }
    // B1 consistency: overlays ride the same visibility as their window
    // (minimized -> detached+hidden, restored -> still-open overlays
    // re-attached above the tab views; layout() then re-syncs their bounds).
    // Kill switches: DEX_OVERLAY_HIDE=off, or the legacy budget profile
    // (DEX_DEBLOAT_BASELINE=1 pins overlayHideOnMinimize=0).
    if (Number(BUDGETS.overlayHideOnMinimize) !== 0 && process.env.DEX_OVERLAY_HIDE !== 'off') {
      for (const ov of overlayViewsFor(winId)) {
        if (canDetach) {
          if (visible) attachView(winId, ov);
          else detachView(winId, ov);
        } else {
          try { ov.setVisible(Boolean(visible)); } catch {}
        }
      }
    }
    if (canDetach && visible) {
      // Re-sync geometry after the re-attach (bounds, overlay stacking).
      try { layout(winId); } catch {}
    }
  }
  function powerSignals() {
    const now = Date.now();
    let focused = false, minimized = false, activeTabs = 0, visibleTabs = 0, audible = false, loading = false;
    for (const st of windows.values()) {
      try { if (st.win.isMinimized()) minimized = true; } catch {}
      try { if (BrowserWindow.getFocusedWindow() === st.win) focused = true; } catch {}
      for (const t of st.tabs.values()) {
        if (!t) continue;
        if (t.view) { visibleTabs += 1; if (t.id === st.active) activeTabs += 1; }
        if (t.loading) loading = true;
        try { if (t.view && t.view.webContents.isCurrentlyAudible()) audible = true; } catch {}
      }
    }
    return {
      focused, minimized, locked: power.locked, onBattery: power.onBattery,
      idleMs: now - power.lastInteraction,
      freeMemMB: Math.round(os.freemem() / 1048576),
      cpuPct: mainCpuPct(),
      activeTabCount: activeTabs,
      video: audible, audible,
      webgl: power.cpuPct >= 50,
      animation: visibleTabs > activeTabs,
      loading,
      interacting: focused && (now - power.lastInteraction) < 15000,
    };
  }
  // Cheap main-process CPU percent; renderer demand is covered by the tab
  // signals above, and memSnapshot() (per-process metrics) stays inside the
  // sweep where it is already being paid for.
  function mainCpuPct() {
    try {
      const u = process.getCPUUsage(power._cpuPrev);
      power._cpuPrev = u;
      // percentCPUUsage is already a percentage (0-100+), matching
      // app.getAppMetrics()' cpu.percentCPUUsage used elsewhere here.
      return Math.max(0, Number(u && u.percentCPUUsage) || 0);
    } catch { return power.cpuPct || 0; }
  }
  function applyPowerPlan(reason) {
    const signals = powerSignals();
    const plan = adaptivePower.runtimePlan(signals, power.tier, Date.now(), { tierSince: power.tierSince }, BUDGETS);
    if (plan.gpuTier !== power.tier) {
      power.tier = plan.gpuTier;
      power.tierSince = Date.now();
    }
    power.plan = plan;
    power.cpuPct = signals.cpuPct;
    if (plan.hideMinimizedViews) {
      for (const st of windows.values()) {
        try { if (st.win.isMinimized()) setWindowViewsVisible(st.id, false); } catch {}
      }
    }
    scheduleSweep(plan.sweepIntervalMs);
    return plan;
  }
  function scheduleSweep(delay) {
    if (power.timer) clearTimeout(power.timer);
    if (process.env.DEX_TIMER_DEBUG) {
      console.log('[dex-timer] power sweep in ' + delay + 'ms');
    }
    power.timer = setTimeout(() => {
      power.timer = null;
      try { runPowerSweep(); } catch {}
    }, delay);
    if (power.timer.unref) power.timer.unref();
  }
  function runPowerSweep() {
    const plan = power.plan || applyPowerPlan('sweep');
    sleepSweep(plan.idleSleepMs);
    memorySweep();
    // Refresh CPU signal for the next decision, then re-evaluate (the plan
    // itself reschedules the next sweep, so there is exactly one timer alive).
    applyPowerPlan('sweep');
  }
  function markInteraction() {
    power.lastInteraction = Date.now();
    applyPowerPlan('interaction');
  }
  function markWindowEvent() {
    applyPowerPlan('window');
  }
  function powerState() {
    return {
      tier: power.tier, tierSince: power.tierSince, plan: power.plan,
      signals: powerSignals(),
    };
  }
  // Power-source and OS-session transitions re-evaluate immediately.
  // createBrowser() runs after app ready, so powerMonitor is available here.
  try {
    const pm = require('electron').powerMonitor;
    pm.on('on-battery', () => { power.onBattery = true; applyPowerPlan('on-battery'); });
    pm.on('on-ac', () => { power.onBattery = false; applyPowerPlan('on-ac'); });
    pm.on('lock-screen', () => { power.locked = true; applyPowerPlan('lock'); });
    pm.on('unlock-screen', () => { power.locked = false; markInteraction(); });
    pm.on('resume', () => { markInteraction(); try { armTaskHeartbeat(); } catch {} });
  } catch {}
  // ---------- Focus Timer (Pomodoro) ----------
  // Single engine for all windows: one clock, one blocklist, one audible
  // target. Shells render it in the rail; ambient audio plays only for the
  // most recently focused window so two windows never double up.
  let lastAudioWin = null;
  const pomodoro = createPomodoro({
    profile,
    notify: (title, body) => {
      try { new Notification({ title: 'Dexerion Focus Timer', body: String(body || title || '') }).show(); } catch {}
    },
    onChange: (kind, pomoState) => {
      // Ticks are cheap targeted updates; full state + tab sweeps only run
      // on real transitions (start/pause/skip/config/phase end).
      for (const st of windows.values()) {
        if (st.win.isDestroyed()) continue;
        try { st.win.webContents.send('dex:pomodoro', { ...pomoState, audible: st.id === lastAudioWin }); } catch {}
      }
      if (kind === 'tick') return;
      refreshPomodoro();
      broadcastState();
      for (const st of windows.values()) {
        for (const t of st.tabs.values()) {
          try {
            const wc = t.view.webContents;
            if (!wc.isDestroyed() && (wc.getURL() || '').startsWith('dexerion://')) {
              wc.send('dex:pomodoro', pomoState);
            }
          } catch {}
        }
      }
    },
  });
  let popupWindows = new Set();
  // Opening context for allow-path windows (frame name / features / opener
  // URL), keyed by the opener's webContents; read by did-create-window.
  let popOpenCtx = new WeakMap();
  const snipState = new Map(); // winId -> { view } snip overlay as an in-window WebContentsView (declared up here so layout() can realign it)
  // Report viewer: a card in the chat opens its document as an in-window child
  // view layered over the current tab (rail to sidebar), closed with its own ×.
  // Declared up here so layout() can realign it like the snip overlay.
  const reportOverlayState = new Map(); // winId -> { view, chatId, index } — report viewer overlay
  const siteOverlayState = new Map();   // winId -> { view, url, chatId, index } — the Focus preview
  const inspectorWindows = new Map(); // inspector BrowserWindow -> winId (for the fallback's retry)
  const popupFsRestore = new WeakMap(); // popup BrowserWindow -> { maximized, bounds } while its content is element-fullscreen
  const downloadItems = new Map();
  const pendingDownloadDeletes = new Set();

  const ses = sessionModule.session.defaultSession;

  // ---------- accounts ----------
  // Each Dexerion account gets its own Chromium session (persist partition),
  // so web logins (Gmail, Teams, …) and saved credentials stay isolated —
  // a new account really has nothing saved. The 'default' account uses the
  // shared default session.
  const accountCache = new Map(); // id -> { bookmarks, history, topSites, closedTabs, logins }
  const accountSessions = new Map(); // id -> session
  const accountTimers = new Map();
  const AVATAR_COLORS = ['#35c4ff', '#8b7bff', '#3ddc84', '#ffb020', '#ff6b9d', '#ff7a7a'];

  function listAccounts() { return S.accounts || []; }
  function getAccountMeta(id) { return listAccounts().find(a => a.id === id) || null; }
  function accData(id) {
    if (!accountCache.has(id)) accountCache.set(id, profile.loadAccountData(id));
    return accountCache.get(id);
  }
  function saveAcc(id) {
    clearTimeout(accountTimers.get(id));
    accountTimers.set(id, setTimeout(() => {
      const d = accountCache.get(id);
      if (d) profile.saveAccountData(id, d);
    }, 400));
  }
  function flushAccounts() {
    let failed = 0;
    for (const [id, d] of accountCache) {
      if (!profile.saveAccountData(id, d)) failed += 1;
    }
    if (failed) console.warn('[dexerion] account save failed for ' + failed + ' account(s): ' + profile.lastError);
  }
  const cleanUaString = (ua) => String(ua || '').replace(/(?:Electron|Dexerion)\/\S+\s+/g, '').replace(/\s{2,}/g, ' ').trim();
  function sesFor(accountId) {
    const id = accountId || 'default';
    if (id === 'default') return ses;
    if (!accountSessions.has(id)) {
      const s = sessionModule.session.fromPartition('persist:dexacc-' + id);
      try {
        const ua = cleanUaString(s.getUserAgent() || app.userAgentFallback || '');
        if (ua) { s.setUserAgent(ua); try { app.userAgentFallback = ua; } catch {} }
      } catch {}
      accountSessions.set(id, s);
      // A fresh partition has no dexerion:// handler of its own; without this
      // every internal page in this account is an unknown scheme to Chromium,
      // which hands the URL to Windows instead of opening the page.
      installInternalProtocol(s);
      setupDownloadHandling(s);
      installBlockGuard(s);
      extensions.addSession(id, s).catch(() => {});
    }
    return accountSessions.get(id);
  }
  function sessKey(st) { return (st && st.accountId) || 'default'; }

  function defaultChromeH() {
    // Vertical-tabs only: toolbar + bookmark bar, no horizontal strip.
    return TOOLBAR_H + (S.settings.showBookmarksBar ? BOOKMARKBAR_H : 0);
  }
  function chromeH(st) {
    // Shell reports its real measured chrome height (tabstrip + toolbar +
    // bookmark bar + banners); fallback to estimates until it does.
    return (st && st.chromeH) || defaultChromeH();
  }
  // Same idea for the vertical rail's width: measured by the shell, so a skin
  // (or any CSS change) that resizes the rail cannot leave the page misaligned.
  function railW(st) {
    return (st && st.railW) || VERTICAL_RAIL;
  }

  // ---------- internal dexerion:// pages ----------
  // Theme → OS color scheme, so real websites following
  // prefers-color-scheme render in the matching mode too.
  function syncTheme() {
    try { nativeTheme.themeSource = S.settings.theme === 'light' ? 'light' : 'dark'; } catch {}
  }
  // `protocol.handle` is per-session, and every non-default account gets its
  // own partition. Registering only on the default session left dexerion://
  // unhandled in those partitions, so Chromium handed the URL to the OS and
  // Windows showed "Get an app to open this 'dexerion' link" instead of
  // opening the page. Install it into every session we hand out.
  const protoSessions = new Set();
  // One in-memory registry of generated websites, served over dexsite://
  // (content-addressed hosts, byte-bounded LRU — see registerSiteArtifact).
  const siteRegistry = new Map();
  // The host behind each window's live site preview is pinned so an LRU sweep
  // can never pull the files out from under a frame that is showing them.
  const siteActiveHostByWin = new Map();
  // One-way renderer event for overlay chrome (button label/aria-pressed).
  // IPC reply shapes for dex:overlay-fullscreen* stay exactly as they were.
  const OVERLAY_FULLSCREEN_EVENT = 'dex:overlay-fullscreen-changed';
  // Content types for the files the `dexerion://assets` host serves. The
  // font entries are the ones that matter: a stylesheet's `@font-face` source
  // is ALWAYS fetched in CORS mode, and internal pages have an opaque origin,
  // so the browser rejects the response before it looks at the bytes unless
  // the response carries an allow-origin header AND a real font type.
  const ASSET_TYPES = {
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.wasm': 'application/wasm',
    '.pdf': 'application/pdf',
  };
  function assetType(file) {
    return ASSET_TYPES[path.extname(String(file || '')).toLowerCase()] || '';
  }
  // Internal pages are served with a Content-Security-Policy. They live on a
  // privileged origin - the preload bridge is attached to them - so the policy
  // is what stops a future mistake (a model-authored string reaching innerHTML,
  // say) from becoming script execution with the app's privileges.
  //
  // Each page carries its own inline script, so a per-response nonce is
  // generated and added to those <script> tags. A hash would break the next
  // edit to a page and 'unsafe-inline' would make the policy decorative.
  // The scheme is listed as a source rather than 'self' because that is the
  // narrower grant: 'self' would follow the document to whatever host it is
  // on, whereas `dexerion:` states that app assets are the only script source.
  function serveInternalPage(file) {
    let html = '';
    try { html = fs.readFileSync(file, 'utf8'); } catch {
      return new Response('Not found', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    const nonce = crypto.randomBytes(18).toString('base64');
    html = html.replace(/<script\b([^>]*)>/gi, (whole, attrs) => {
      if (/\ssrc\s*=/i.test(attrs)) return whole;   // an external script
      return '<script nonce="' + nonce + '"' + attrs + '>';
    });
    const csp = [
      "default-src 'none'",
      "script-src 'nonce-" + nonce + "' dexerion:",
      "style-src 'unsafe-inline' dexerion:",
      "img-src dexerion: data: blob:",
      "font-src dexerion:",
      "connect-src dexerion:",
      // The artifact viewer embeds a generated website as a dexsite:// frame.
      // Without this the frame falls back to default-src 'none' and the
      // preview is silently blank.
      "frame-src dexsite:",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "object-src 'none'",
    ].join('; ');
    return new Response(html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': csp,
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-cache',
      },
    });
  }
  function installInternalProtocol(sess) {
    if (!sess || protoSessions.has(sess)) return;
    protoSessions.add(sess);
    // dexsite://<host>/<path>: the virtual hosts behind the site preview.
    // The resolver is pure and unit-tested; this is only transport.
    sess.protocol.handle('dexsite', (req) => {
      let host = '';
      let pathname = '';
      try { const u = new URL(req.url); host = u.hostname; pathname = u.pathname; } catch { /* 404 below */ }
      const res = aiSiteHost.resolveSiteRequest(siteRegistry, host, pathname);
      return new Response(res.body, { status: res.status, headers: res.headers });
    });
    sess.protocol.handle('dexerion', (req) => {
      const u = new URL(req.url);
      if (u.hostname === 'assets') {
        // Subpaths are allowed (fonts/, design/, ocr/), but the resolved file
        // must stay inside the assets root — no traversal out of it.
        const root = path.join(__dirname, '../../assets');
        let rel = '';
        try { rel = decodeURIComponent(u.pathname || '').replace(/^\/+/, ''); } catch { rel = ''; }
        const file = path.normalize(path.join(root, rel));
        if (rel === '' || (file !== root && !file.startsWith(root + path.sep))) {
          return new Response('', { status: 404 });
        }
        // The raw file response is not usable by the pages: fonts are fetched
        // in CORS mode and the internal pages have an opaque origin, so every
        // @font-face was rejected ("blocked by CORS policy") and the whole
        // type layer silently fell back to the system stack. Serve the file
        // with an explicit allow-origin, an explicit content-type and
        // nosniff, and turn a missing file into a real 404 instead of an
        // unhandled rejection from net.fetch.
        return net.fetch('file://' + file.replace(/\\/g, '/')).then((res) => {
          const headers = new Headers(res.headers);
          headers.set('access-control-allow-origin', '*');
          headers.set('x-content-type-options', 'nosniff');
          headers.set('cache-control', 'no-cache');
          const type = assetType(file);
          if (type) headers.set('content-type', type);
          return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
        }).catch(() => new Response('Not found', {
          status: 404,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        }));
      }
      // account avatars live in the profile dir, named by account id
      if (u.hostname === 'avatar') {
        const id = String(u.pathname || '').replace(/^\/+/, '').replace(/[^A-Za-z0-9_-]/g, '');
        const file = path.join(profile.dir, 'avatar-' + id + '.png');
        return net.fetch('file://' + file.replace(/\\/g, '/'));
      }
      const page = u.hostname || 'newtab';
      const map = {
        newtab: 'newtab.html', welcome: 'welcome.html', settings: 'settings.html', history: 'history.html',
        bookmarks: 'bookmarks.html', downloads: 'downloads.html', extensions: 'extensions.html',
        accounts: 'accounts.html', blocked: 'blocked.html',
        inspector: 'inspector-fallback.html',
        connecting: 'connecting.html', offline: 'offline.html',
        report: 'report.html', files: 'files.html',
        artifact: 'artifact.html',
      };
      const file = map[page] || 'newtab.html';
      return serveInternalPage(path.join(__dirname, '../renderer/pages', file));
    });
  }
  function registerInternalProtocol() {
    installInternalProtocol(ses);
    installBlockGuard(ses);
  }

  // ---------- site blocking during work phases ----------
  // Enforced at the Chromium session level (one listener per partition), so
  // every navigation path — omnibox, links, redirects, refresh, window.open,
  // JS location changes — is covered, in every tab and account.
  // Main-frame only: a blocked page's own subresources are not filtered.
  const guardedSessions = new Set();
  function blockedUrl(intended, info) {
    const q = new URLSearchParams({
      url: String(intended || '').slice(0, 2048),
      host: (info && info.host) || '',
      tone: 'work',
      until: info && info.endsAt ? String(info.endsAt) : '',
    });
    return 'dexerion://blocked?' + q.toString();
  }
  function pomoBlocked(url) {
    try { return pomodoro.blocks(url); } catch { return false; }
  }
  function installBlockGuard(sess) {
    if (!sess || guardedSessions.has(sess)) return;
    guardedSessions.add(sess);
    try {
      sess.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, cb) => {
        try {
          if (details.resourceType && details.resourceType !== 'mainFrame') return cb({});
          if (!pomoBlocked(details.url)) return cb({});
          return cb({ redirectURL: blockedUrl(details.url, pomodoro.blockInfo(details.url)) });
        } catch (err) { /* fall through to allow, never wedge navigation */ }
        cb({});
      });
    } catch (e) { console.warn('[dexerion] block guard failed to install:', e.message); }
  }
  // Re-check every open tab after a timer transition: block newly disallowed
  // pages and restore tabs parked on the block page once work ends.
  function refreshPomodoro() {
    for (const st of windows.values()) {
      for (const t of st.tabs.values()) {
        let wc; try { wc = t.view.webContents; } catch { continue; }
        if (!wc || wc.isDestroyed()) continue;
        const url = wc.getURL() || t.url || '';
        if (url.startsWith('dexerion://blocked')) {
          let target = '';
          try { target = new URL(url).searchParams.get('url') || ''; } catch {}
          if (target && !pomoBlocked(target)) wc.loadURL(target).catch(() => {});
        } else if (pomoBlocked(url)) {
          wc.loadURL(blockedUrl(url, pomodoro.blockInfo(url))).catch(() => {});
        }
      }
    }
  }

  function resolveInput(input) {
    const t = String(input || '').trim();
    if (!t) return 'dexerion://newtab';
    if (/^dexerion:\/\//i.test(t)) return t;
    // about: URLs are documents, not search terms. Missing this turned every
    // blank navigation (about:blank links/popups) into a search for the text
    // "about:blank" instead of the page the site asked for.
    if (/^about:/i.test(t)) return t;
    if (/^[a-z]+:\/\//i.test(t)) return t;
    if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(t) && !t.includes(' ')) return 'https://' + t;
    const engines = { ...SEARCH_ENGINES };
    const key = S.settings.searchEngine in engines ? S.settings.searchEngine : 'google';
    const tpl = key === 'custom' ? S.settings.customSearchUrl : engines[key].url;
    return tpl.replace('%s', encodeURIComponent(t));
  }

  // ---------- windows (each window belongs to one account) ----------
  function newWindow(urls, accountId, saved, opts = {}) {
    const id = ++winSeq;
    const aid = (accountId && getAccountMeta(accountId)) ? accountId : (S.defaultAccountId || 'default');
    sesFor(aid); // ensure partition + extensions before tabs exist
    const mode = opts.mode || S.settings.theme || 'dark';
    const win = new BrowserWindow({
      width: opts.width || 1280, height: opts.height || 860,
      ...(Number.isFinite(opts.x) ? { x: Math.round(opts.x) } : {}),
      ...(Number.isFinite(opts.y) ? { y: Math.round(opts.y) } : {}),
      title: BRAND.name,
      autoHideMenuBar: true,
      icon: APP_ICON,
      backgroundColor: mode === 'light' ? '#f6f6f4' : '#0a0a0c',
      webPreferences: {
        preload: path.join(__dirname, '../../preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
        // Video fullscreen in a tab must never resize the window behind our
        // back (the built-in behaviour fullscreened the window and failed to
        // restore it, leaving it borderless with no taskbar until force-closed).
        // enterHtmlFullscreen/exitHtmlFullscreen own the window transitions.
        disableHtmlFullscreenWindowResize: true,
      },
    });
    win.loadFile(
      path.join(__dirname, '../renderer/shell.html'),
      (() => {
        const query = {};
        if (opts.skin) { query.skin = opts.skin; query.mode = opts.mode || mode; }
        // Design review for the AI panel layouts: --ai-layout=a|b|c opens
        // every window with that variant (see --preview-skins precedent).
        const flag = String((process.argv.find(a => String(a).startsWith('--ai-layout=')) || '').split('=')[1] || '');
        if (flag === 'a' || flag === 'b' || flag === 'c') query['ai-layout'] = flag;
        return Object.keys(query).length ? { query } : undefined;
      })(),
    );
    const state = { id, win, accountId: aid, tabs: new Map(), order: [], active: null, groups: new Map(), aiOpen: false, searchOpen: false, aiRequestId: null, aiRequestChatId: null, memNotice: null, memNoticeMutedUntil: 0, preview: Boolean(opts.preview), skin: opts.skin || '', inspector: { open: false, dock: 'bottom', tabId: null, win: null }, htmlFullscreen: false, htmlFullscreenTab: null, fsRestore: null, fsHealTimer: null, searchPageHidden: false };
    windows.set(id, state);
    win.on('resize', () => layoutSoon(id));
    // A fullscreen transition resizes the window: re-layout so the tab view
    // tracks the new content area. Also heals the reverse case — the OS window
    // left fullscreen on its own while the html-fullscreen flag was still set.
    win.on('enter-full-screen', () => layoutSoon(id));
    win.on('leave-full-screen', () => layoutSoon(id));
    win.on('focus', () => {
      lastAudioWin = id;
      markInteraction();
    });
    win.on('blur', () => markWindowEvent());
    win.on('minimize', () => { markWindowEvent(); try { setWindowViewsVisible(id, false); } catch {} });
    win.on('restore', () => { markInteraction(); try { setWindowViewsVisible(id, true); } catch {} });
    win.on('show', () => { markInteraction(); try { setWindowViewsVisible(id, true); } catch {} });
    win.on('close', () => { try { persistAll(); } catch {} });
    win.on('closed', () => {
      // Child views die with the window; drop the overlay record so a stale
      // entry can never resolve a sender to a dead window.
      clearTimeout(state.fsHealTimer);
      try {
        const sn = snipState.get(id);
        if (sn) { try { sn.view.webContents.close(); } catch {} snipState.delete(id); }
      } catch {}
      try {
        const rv = reportOverlayState.get(id);
        if (rv) { try { rv.view.webContents.close(); } catch {} reportOverlayState.delete(id); }
        const sv = siteOverlayState.get(id);
        if (sv) { try { sv.view.webContents.close(); } catch {} siteOverlayState.delete(id); }
      } catch {}
      // A closed window's preview no longer needs its host pinned.
      const pinnedId = siteActiveHostByWin.get(id);
      if (pinnedId) {
        try { aiSiteHost.setSiteRegistryPin(siteRegistry, pinnedId, false); } catch {}
        siteActiveHostByWin.delete(id);
      }
      if (agentInstance) { try { agentRef().windowClosed(id); } catch {} } // agent runs bound here halt
      if (searchInstance) { try { searchRef().releaseWindow(id); } catch {} } // AI search runs + work tabs halt
      // Offline waits run on per-tab 250ms/2s timers: stop them with the
      // window so a closed window can never leave probes firing forever.
      try {
        const st = windows.get(id);
        if (st) for (const t of st.tabs.values()) { try { clearNet(t); } catch {} }
      } catch {}
      // A quit closes every window back-to-back (menu Quit, "X" on each
      // window, WM_CLOSE). Keep this window's row in the saved session for a
      // short grace so relaunching restores everything; a window closed while
      // the app keeps running drops out once the grace lapses. Deleting the
      // row here let the debounced persist shrink the session mid-quit to
      // only the last window closed (see pendingRows in the persistence
      // section).
      try {
        const st = windows.get(id);
        if (st && !st.preview) { pendingRows.set(id, snapshotRow(st)); scheduleSessionShrink(); }
      } catch {}
      windows.delete(id);
    });
    win.webContents.on('did-finish-load', () => {
      pushState(id);
      // A shell that (re)loaded while a tab was video-fullscreen has no chrome
      // state yet: replay the flag so the chrome stays out of the video's way.
      const st = windows.get(id);
      if (st && st.htmlFullscreen) sendHtmlFullscreen(st, true);
    });
    // Multi-page previews: an in-frame navigation inside a served site (a
    // link click, or the frame's own back/forward) tells the shell which page
    // is showing, so the preview bar's page switcher and label stay true to
    // what the person sees. Best effort by design: a dropped event costs the
    // chrome a stale marker, never the preview itself.
    win.webContents.on('did-frame-navigate', (event, url, httpCode, httpStatus, isMainFrame) => {
      try {
        if (isMainFrame) return;
        const raw = String(url || '');
        if (!/^dexsite:\/\//.test(raw)) return;
        const u = new URL(raw);
        let path = '';
        try { path = decodeURIComponent(String(u.pathname || '').replace(/^\/+/, '')); } catch { path = ''; }
        win.webContents.send('dex:site-nav', { host: u.hostname, path });
      } catch { /* the chrome just does not follow this navigation */ }
    });
    const savedTabs = saved && Array.isArray(saved.tabs) && saved.tabs.length ? saved.tabs : null;
    const list = savedTabs
      ? savedTabs.map(t => (t && t.url) || 'dexerion://newtab')
      : (urls && urls.length ? urls : ['dexerion://newtab']);
    // Defer tab creation until shell is ready.
    win.webContents.once('did-finish-load', () => {
      const activeIndex = Number.isInteger(saved && saved.activeIndex) ? saved.activeIndex : list.length - 1;
      // Lazy restore: only the active tab loads now; the rest load on first
      // click (see newTab lazy + activateTab). Preview windows load
      // everything — their screenshots must show real pages.
      list.forEach((u, i) => newTab(id, u, true, { lazy: !opts.preview && i !== activeIndex }));
      // Restore tab groups (ids are session-local, so re-register them here
      // and re-attach members by position).
      if (saved && Array.isArray(saved.groups) && saved.groups.length) {
        for (const g of saved.groups) {
          if (g && g.id && !state.groups.has(g.id)) {
            state.groups.set(g.id, {
              id: g.id,
              name: String(g.name || '').slice(0, 40),
              color: GROUP_COLORS.includes(g.color) ? g.color : 'grey',
            });
          }
        }
        state.order.forEach((tid, idx) => {
          const sv = savedTabs[idx];
          const t = state.tabs.get(tid);
          if (t && sv && sv.groupId && state.groups.has(sv.groupId)) t.groupId = sv.groupId;
        });
        sweepGroups(state);
      }
      if (state.order.length) {
        const activeIndex = Number.isInteger(saved && saved.activeIndex) ? saved.activeIndex : state.order.length - 1;
        activateTab(id, state.order[Math.max(0, Math.min(activeIndex, state.order.length - 1))]);
      }
      // Ready for work — callers may add tabs of their own now. The daily
      // welcome rides this hook: tabs only exist after the shell loads, so
      // opening it from startup() would race the freshly planted newtab.
      if (typeof opts.onReady === 'function') { try { opts.onReady(id); } catch {} }
    });
    return id;
  }

  function windowCount() { return windows.size; }
  function focusWindow(winId) {
    const st = windows.get(winId);
    if (!st) return false;
    try { st.win.show(); st.win.focus(); } catch { return false; }
    return true;
  }
  function closeWindow(winId) {
    const st = windows.get(winId);
    if (!st) return false;
    try { st.win.close(); } catch { return false; }
    return true;
  }
  // ---------- chrome skin preview (design review) ----------
  // Four interface identities, one window each, tiled over the work area. Every
  // window carries the SAME tab set, so the only thing that differs on screen is
  // the chrome itself. Each direction opens in the mode it was drawn for.
  const SKIN_DIRECTIONS = [
    { skin: 'machined', mode: 'dark' },
    { skin: 'vellum', mode: 'light' },
    { skin: 'halo', mode: 'dark' },
    { skin: 'riso', mode: 'light' },
  ];
  // What the Theme section in Settings can set. 'dexerion' is the shipped look
  // (no skin file at all), so the default chrome is never a stylesheet rebuild.
  const UI_SKINS = ['dexerion', ...SKIN_DIRECTIONS.map(d => d.skin)];
  function uiSkin() {
    const s = String((S.settings && S.settings.skin) || 'dexerion');
    return UI_SKINS.includes(s) ? s : 'dexerion';
  }
  const PREVIEW_GROUP = { id: 'gprev', name: 'Research', color: 'green' };
  const PREVIEW_TABS = [
    { url: 'dexerion://newtab', title: 'New Tab' },
    { url: 'https://example.com/', title: 'Example Domain' },
    { url: 'https://en.wikipedia.org/wiki/Risograph', title: 'Risograph' },
    { url: 'dexerion://settings', title: 'Settings', groupId: PREVIEW_GROUP.id },
    { url: 'dexerion://bookmarks', title: 'Bookmarks', groupId: PREVIEW_GROUP.id },
  ];
  function openSkinPreview({ solo = false } = {}) {
    const area = screen.getPrimaryDisplay().workArea;
    const cols = 2;
    const w = Math.max(720, Math.round(area.width / cols));
    const h = Math.max(520, Math.round(area.height / 2));
    const saved = solo ? null : { tabs: PREVIEW_TABS, groups: [PREVIEW_GROUP], activeIndex: 1 };
    const ids = SKIN_DIRECTIONS.map((d, i) => newWindow(null, undefined, saved, {
      skin: d.skin, mode: d.mode, preview: true,
      width: w, height: h,
      x: area.x + (i % cols) * w,
      y: area.y + Math.floor(i / cols) * h,
    }));
    // Report what actually opened: the window's OWN title only says "Dexerion —
    // <Skin>" if ?skin= reached the renderer and the skin stylesheet loaded.
    setTimeout(() => {
      for (const id of ids) {
        const st = windows.get(id);
        if (st) console.log('[skins] window ' + st.skin + ' :: ' + st.win.getTitle());
      }
    }, 3000);
    return ids;
  }
  // Design-review screenshots: one PNG per preview window showing the chrome as
  // rendered (the shell's own surface — tab views are separate native layers).
  // Used by `--capture-skins`; never on the normal startup path.
  async function capturePreviewShots(dir) {
    const out = [];
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    for (const st of windows.values()) {
      if (!st.preview) continue;
      const file = path.join(dir, 'skin-' + (st.skin || st.id) + '.png');
      // The demo tabs are created on did-finish-load; shooting the strip before
      // then photographs an empty chrome.
      for (let i = 0; i < 30 && st.order.length < 5; i++) await new Promise((r) => setTimeout(r, 250));
      await new Promise((r) => setTimeout(r, 1200));
      // A window only has a compositor frame while it is on screen and front —
      // capturePage on a buried window fails with UnknownVizError.
      let last = null;
      for (let attempt = 0; attempt < 3 && !fs.existsSync(file); attempt++) {
        try {
          st.win.show();
          st.win.focus();
          await new Promise((r) => setTimeout(r, 900 + attempt * 700));
          const img = await st.win.webContents.capturePage();
          const png = img.toPNG();
          if (!png || !png.length) throw new Error('empty image');
          fs.writeFileSync(file, png);
          // Detail crop of the chrome itself: the full window is 2x2-tiled and
          // scales down badly when reviewed at small sizes.
          const b = st.win.getContentBounds();
          // In vertical-tabs mode the chrome runs down the left edge instead, so
          // the crop has to follow the orientation or it photographs the page.
          const vert = await st.win.webContents.executeJavaScript("document.body.classList.contains('vertical')").catch(() => false);
          const rect = vert
            ? { x: 0, y: 0, width: Math.min(320, b.width), height: b.height }
            : { x: 0, y: 0, width: b.width, height: 150 };
          const crop = await st.win.webContents.capturePage(rect);
          if (crop) fs.writeFileSync(file.replace(/\.png$/, vert ? '-rail.png' : '-strip.png'), crop.toPNG());
          out.push(file);
        } catch (e) { last = e; }
      }
      if (!fs.existsSync(file)) out.push('ERR ' + file + ': ' + (last && last.message));
    }
    // ...and one full window (chrome + page) showing the Theme picker, so the
    // settings page can be reviewed too. A WebContentsView has no capturable
    // surface of its own, so this goes through desktopCapturer and filters to
    // our own window by title.
    const host = [...windows.values()].find((st) => st.preview);
    if (host) {
      const file = path.join(dir, 'settings-theme.png');
      try {
        newTab(host.id, 'dexerion://settings', false);
        await new Promise((r) => setTimeout(r, 2600));
        const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1440, height: 960 } });
        const title = host.win.getTitle();
        const src = sources.find((s) => s.name === title) || sources.find((s) => s.name.indexOf(BRAND.name) >= 0);
        if (src && src.thumbnail && !src.thumbnail.isEmpty()) {
          fs.writeFileSync(file, src.thumbnail.toPNG());
          out.push(file);
        } else out.push('ERR ' + file + ': no window source');
      } catch (e) { out.push('ERR ' + file + ': ' + (e && e.message)); }
    }
    return out;
  }
  function focusedState() {
    const w = BrowserWindow.getFocusedWindow();
    for (const st of windows.values()) if (st.win === w) return st;
    return windows.values().next().value || null;
  }
  // Default-browser / "open with" entry: a link or .html file arriving via
  // CLI or second-instance lands in the focused window (or a new one).
  function openExternalUrl(url) {
    if (!url) return;
    const st = focusedState();
    if (st) {
      newTab(st.id, url, false);
      try { st.win.focus(); } catch {}
    } else newWindow([url]);
  }

  // ---------- tabs (WebContentsView per tab = real Chromium tab) ----------
  // Idle tabs get their renderer torn down; the entry keeps url/title/favicon
  // so waking is one click. The strip shows a zzz mark while they sleep.
  // Debloat V131-V180 lowers this from 5 minutes to 3 minutes; the A/B perf
  // harness can restore the legacy value with DEX_DEBLOAT_BASELINE=1.
  const SLEEP_IDLE_MS = BUDGETS.idleSleepMs;
  function createTabView(winId, tabId) {
    const st = windows.get(winId);
    const view = new WebContentsView({
      // Per-account partition isolates cookies/site data (Gmail, Teams…).
      // Preload gives dexerion:// pages the controlled window.dexerion API.
      // Untrusted https pages get the same object but every privileged
      // channel verifies the sender (see chromeSender/needChrome below).
      webPreferences: {
        partition: st.accountId === 'default' ? undefined : 'persist:dexacc-' + st.accountId,
        preload: path.join(__dirname, '../../preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: false,
        // Video fullscreen in this tab must never resize the window behind our
        // back — the built-in behaviour fullscreened the window and failed to
        // restore it (borderless, no taskbar) until force-closed. The
        // enter/leave-html-full-screen handlers own the window transitions.
        disableHtmlFullscreenWindowResize: true,
      },
    });
    view.webContents.setWindowOpenHandler((details) => handleWindowOpen(winId, details, view.webContents));
    view.webContents.on('did-create-window', (pop, d) => {
      try { trackPopupWindow(windows.get(winId), pop, d && d.url, d, popOpenCtx.get(view.webContents)); } catch {}
    });
    try { view.webContents.setUserAgent(cleanUaString(view.webContents.getUserAgent())); } catch {}
    wireTabEvents(winId, tabId, view.webContents);
    // Extension storage bridge (chrome.storage.sync fallback): attach before
    // any navigation so content-script worlds are bridged as they are created.
    try { attachSyncBridge(view.webContents); } catch {}
    return view;
  }
  // Single choke point for every window.open / target=_blank / popup.
  // Links become tabs in the same window; only sign-in opens (isSignInOpen)
  // keep a separate window — they need a live window.opener and self-close.
  // Tab paths deny the default (the URL is opened as a Dexerion tab instead);
  // the popup path ALLOWS it so Chromium hands the opener a live Window
  // reference — denying while opening our own window leaves window.open() ===
  // null in the page, which is exactly what sites report as "popup blocked".
  function handleWindowOpen(winId, details, opener) {
    const st = windows.get(winId);
    let openerUrl = '';
    try { if (opener && !opener.isDestroyed()) openerUrl = opener.getURL(); } catch {}
    if (!openerUrl) openerUrl = String((details && details.referrer) || '');
    const d = { ...(details || {}), openerUrl };
    const kind = classifyWindowOpen(d);
    if (!st) return { action: 'deny' };
    if (kind === 'ignore') return { action: 'deny' };
    if (kind === 'tab-background') {
      try { newTab(winId, (details && details.url) || 'dexerion://newtab', true); } catch {}
      return { action: 'deny' };
    }
    if (kind === 'tab-foreground') {
      try { newTab(winId, (details && details.url) || 'dexerion://newtab', false); } catch {}
      return { action: 'deny' };
    }
    try {
      const opts = popupOverrideOptions(st, details || {});
      // Blank pre-opens stay invisible: the opener keeps its live handle, and
      // the first real navigation is moved into a tab (wireHiddenPreopen);
      // a script that never navigates gets the window revealed instead.
      if (kind === 'popup-hidden') opts.show = false;
      // Hand the opening context to did-create-window so the pre-open wiring
      // can judge its first navigation like a fresh open would be judged.
      if (opener) { try { popOpenCtx.set(opener, { frameName: d.frameName, features: d.features, openerUrl }); } catch {} }
      return { action: 'allow', outlivesOpener: true, overrideBrowserWindowOptions: opts };
    } catch (e) {
      try { openPopup(st, details || {}); } catch {
        // A popup that fails to open must never wedge the opener: fall back
        // to the legacy behaviour (foreground tab) so the URL is reachable.
        try { newTab(winId, (details && details.url) || 'dexerion://newtab', false); } catch {}
      }
      return { action: 'deny' };
    }
  }
  // Override options for Electron's allow path: same session/account,
  // preload and sizing as the manual fallback so behaviour matches.
  function popupOverrideOptions(st, details) {
    const parent = st && st.win && !st.win.isDestroyed() ? st.win : undefined;
    let parentBounds = null;
    try { if (parent) parentBounds = parent.getContentBounds(); } catch {}
    const bounds = buildPopupBounds(details && details.features, parentBounds);
    const accountId = (st && st.accountId) || 'default';
    const opts = {
      ...bounds,
      resizable: true,
      title: BRAND.name,
      autoHideMenuBar: true,
      icon: APP_ICON,
      backgroundColor: (S.settings.theme || 'dark') === 'light' ? '#f6f6f4' : '#0a0a0c',
      webPreferences: {
        partition: accountId === 'default' ? undefined : 'persist:dexacc-' + accountId,
        preload: path.join(__dirname, '../../preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: false,
        // Same rule as tabs: a video fullscreen in a popup must never resize
        // the window behind our back (see enterHtmlFullscreen).
        disableHtmlFullscreenWindowResize: true,
      },
    };
    if (parent) opts.parent = parent;
    return opts;
  }
  // Electron fires this on the OPENER's webContents for every window created
  // via the allow path (including nested popups from a popup's contents).
  // Central tracking so allow-created windows get the same treatment the
  // manual fallback applied: nested-popup routing + shell notification.
  function trackPopupWindow(st, pop, targetUrl, created, openCtx) {
    if (!st || !pop) return pop;
    popupWindows.add(pop);
    pop.on('closed', () => popupWindows.delete(pop));
    // A video (or any element) going fullscreen in a popup gets the same
    // ownership pattern as tabs, minus the shell chrome (a popup has none to
    // hide): the window transitions below, never Electron's built-in resize.
    try {
      pop.webContents.on('enter-html-full-screen', () => {
        try {
          if (pop.isDestroyed()) return;
          if (!popupFsRestore.has(pop)) {
            let maximized = false, bounds = null;
            try { maximized = pop.isMaximized(); } catch {}
            try { if (!maximized) bounds = pop.getNormalBounds ? pop.getNormalBounds() : pop.getBounds(); } catch {}
            popupFsRestore.set(pop, { maximized, bounds });
          }
          if (!pop.isFullScreen()) pop.setFullScreen(true);
        } catch {}
      });
      pop.webContents.on('leave-html-full-screen', () => {
        try {
          if (pop.isDestroyed()) return;
          const r = popupFsRestore.get(pop) || { maximized: false, bounds: null };
          popupFsRestore.delete(pop);
          if (pop.isFullScreen()) pop.setFullScreen(false);
          if (r.maximized) {
            if (!pop.isMaximized()) pop.maximize();
          } else if (r.bounds) {
            pop.setBounds(r.bounds);
          }
        } catch {}
      });
    } catch {}
    // Extension pages can open here too (and content scripts match by URL in
    // any frame), so bridge storage the same way tabs and popups are bridged.
    try { attachSyncBridge(pop.webContents); } catch {}
    // Nested popups (a popup opening its own popup) behave the same way.
    try {
      pop.webContents.setWindowOpenHandler((nested) => handleWindowOpen(st.id, nested, pop.webContents));
      pop.webContents.on('did-create-window', (child, d) => trackPopupWindow(st, child, d && d.url, d, popOpenCtx.get(pop.webContents)));
    } catch {}
    try { st.win.webContents.send('dex:popup-opened', { url: String(targetUrl || '') }); } catch {}
    try { wireHiddenPreopen(st, pop, created, openCtx); } catch {}
    return pop;
  }
  // Hidden blank pre-opens (handleWindowOpen's 'popup-hidden', created with
  // show:false — see did-create-window's resolved options): the opener keeps
  // its live window.open() handle, and the first real navigation the script
  // performs moves into a foreground tab in the opener's window, so an
  // "Open with …" flow lands as a normal tab instead of a popup that can fail
  // to load. Scripts that fill the window without navigating (document.write /
  // messaging windows) get it revealed after a short grace — the pre-change
  // behaviour, only delayed.
  function wireHiddenPreopen(st, pop, created, openCtx) {
    if (!pop || pop.isDestroyed()) return;
    if (!created || !created.options || created.options.show !== false) return;
    const ctx = openCtx || {};
    // Judge the first navigation with the same policy as a fresh open, using
    // the details captured when the blank window was created (name, features,
    // opener). A Google page navigating to accounts.google.com stays internal
    // routing → tab; a third-party sign-in keeps its popup.
    const isSignInNav = (u) => isSignInOpen({ url: u, frameName: ctx.frameName, features: ctx.features, openerUrl: ctx.openerUrl });
    let converted = false;
    const convert = (url) => {
      const u = String(url || '');
      if (converted || !u || pop.isDestroyed()) return;
      converted = true;
      try {
        if (st && st.win && !st.win.isDestroyed() && windows.has(st.id)) {
          newTab(st.id, u, false);
          try { pop.close(); } catch {}
          return;
        }
      } catch {}
      // No opener window to receive the tab: show the window and load it.
      try { pop.show(); pop.loadURL(u).catch(() => {}); } catch {}
    };
    try {
      pop.webContents.on('will-navigate', (e, url) => {
        const u = String(url || '');
        if (!u || /^about:blank$/i.test(u)) return;
        // A sign-in navigation needs the live opener: show the window and let
        // it load as the popup the flow was built for (no conversion).
        if (isSignInNav(u)) {
          converted = true;
          try { pop.show(); } catch {}
          return;
        }
        try { e.preventDefault(); } catch {}
        convert(u);
      });
      // A navigation that raced the wiring still moves into a tab exactly once
      // (sign-in navigations keep their window instead).
      pop.webContents.on('did-navigate', (e, url) => {
        const u = String(url || '');
        if (!u || /^about:blank$/i.test(u)) return;
        if (isSignInNav(u)) { converted = true; try { pop.show(); } catch {} return; }
        convert(u);
      });
    } catch {}
    const revealT = setTimeout(() => {
      if (converted) return;
      try { if (!pop.isDestroyed()) pop.show(); } catch {}
    }, 2500);
    pop.on('closed', () => { clearTimeout(revealT); });
  }
  // Generic web popup: separate child BrowserWindow in the OPENER's session
  // (cookies/logins follow the account), tracked in popupWindows (never in
  // windows/tabs, so session-restore, layout and pushState are untouched).
  // Manual fallback for when the allow path cannot be used; the primary
  // popup path returns allow + overrideBrowserWindowOptions so the opener
  // keeps a live window.open() reference (see handleWindowOpen).
  function openPopup(st, details) {
    const rawUrl = (details && details.url) || 'about:blank';
    const target = /^about:blank/i.test(String(rawUrl).trim()) ? 'about:blank' : resolveInput(rawUrl);
    const opts = popupOverrideOptions(st, details || {});
    const parent = opts.parent;
    const pop = new BrowserWindow(opts);
    trackPopupWindow(st, pop, target);
    void parent;
    try { pop.loadURL(target).catch(() => {}); } catch {}
    return pop;
  }
  function newTab(winId, url, background, opts = {}) {
    const st = windows.get(winId); if (!st) return null;
    const tabId = 't' + (++tabSeq);
    const view = createTabView(winId, tabId);
    const wc = view.webContents;
    const target = resolveInput(url || 'dexerion://newtab');
    // Lazy restore: the view exists (layout/tabs work) but nothing loads
    // until the tab is activated — cold start costs one page, not N.
    const lazy = Boolean(opts.lazy);
    st.tabs.set(tabId, { id: tabId, view, url: target, title: lazy ? target : 'New Tab', loading: !lazy, groupId: null, lazy, pendingUrl: lazy ? target : null, sleeping: false, lastActive: Date.now() });
    st.order.push(tabId);
    if (background) {
      // A background tab must never composite: keep the view out of the window
      // and mark it hidden so Chromium throttles rAF/timers exactly like a
      // hidden tab. activateTab() re-attaches and shows it on selection.
      try { view.setVisible(false); } catch {}
    } else {
      st.win.contentView.addChildView(view);
    }
    if (!lazy) wc.loadURL(target).catch(() => {});
    if (!background) activateTab(winId, tabId);
    layout(winId);
    pushState(winId);
    return tabId;
  }

  function activateTab(winId, tabId) {
    const st = windows.get(winId); if (!st || !st.tabs.has(tabId)) return;
    // Switching away from the video-fullscreen tab drops fullscreen first (like
    // Chrome): the outgoing tab's element exits and the window/chrome restore
    // before the next tab takes the view slot.
    if (st.htmlFullscreen && st.htmlFullscreenTab && st.htmlFullscreenTab !== tabId) {
      const prev = st.tabs.get(st.htmlFullscreenTab);
      if (prev && prev.view && !prev.view.webContents.isDestroyed()) {
        try { prev.view.webContents.executeJavaScript('document.exitFullscreen()', true).catch(() => {}); } catch {}
      }
      exitHtmlFullscreen(winId);
    }
    const cur = st.tabs.get(tabId);
    let needLoad = false;
    if (cur) {
      cur.lastActive = Date.now();
      // Waking a slept tab recreates its view; it still needs its page loaded.
      if (!cur.view) { wakeTab(winId, tabId); needLoad = true; }
    }
    for (const [id, t] of st.tabs) {
      if (id === tabId) {
        st.win.contentView.addChildView(t.view);
        // WebContentsViews start life visibility-hidden: without an explicit
        // setVisible(true) the active tab's document reports visibilityState
        // "hidden" even in a focused, on-screen window. Cloudflare Turnstile
        // and managed challenges refuse to complete on hidden documents and
        // fail with "Verification failed".
        try { t.view.setVisible(true); } catch {}
      } else {
        try { st.win.contentView.removeChildView(t.view); } catch {}
        try { t.view.setVisible(false); } catch {}
      }
    }
    st.active = tabId;
    // First activation of a lazily restored tab actually loads it.
    if (cur && cur.lazy) {
      cur.lazy = false;
      cur.sleeping = false;
      const u = cur.pendingUrl || cur.url;
      delete cur.pendingUrl;
      cur.loading = true;
      try { cur.view.webContents.loadURL(u).catch(() => {}); } catch {}
    } else if (cur && needLoad && cur.view) {
      cur.loading = true;
      try { cur.view.webContents.loadURL(cur.url).catch(() => {}); } catch {}
    }
    layout(winId);
    pushState(winId);
  }

  // Recreate a slept tab's view (no navigation yet — callers load after).
  function wakeTab(winId, tabId) {
    const st = windows.get(winId);
    const t = st && st.tabs.get(tabId);
    if (!t || t.view) return t;
    const view = createTabView(winId, tabId);
    t.view = view;
    t.sleeping = false;
    try { st.win.contentView.addChildView(view); } catch {}
    layout(winId);
    pushState(winId);
    return t;
  }

  // One-way teardown for a tab's renderer — shared by the idle sweep and the
  // memory budget. The entry keeps url/title/favicon, so waking is one click.
  function sleepTabNow(st, t) {
    // Never tear down the video-fullscreen tab: its page state (element
    // fullscreen) dies with the view and the window would lose its exit path.
    if (st.htmlFullscreen && st.htmlFullscreenTab === t.id) return;
    try { st.win.contentView.removeChildView(t.view); } catch {}
    try { t.view.webContents.close(); } catch {}
    t.view = null;
    t.sleeping = true;
  }

  function sleepSweep(maxIdleMs) {
    const idle = maxIdleMs === undefined ? SLEEP_IDLE_MS : maxIdleMs;
    const now = Date.now();
    for (const st of windows.values()) {
      let changed = false;
      for (const [id, t] of st.tabs) {
        if (!t) continue;
        let audible = false;
        try { audible = Boolean(t.view && t.view.webContents.isCurrentlyAudible()); } catch {}
        const decision = shouldSleepTab({
          active: id === st.active,
          loading: Boolean(t.loading),
          lazy: Boolean(t.lazy),
          sleeping: Boolean(t.sleeping),
          audible,
          hasView: Boolean(t.view),
          lastActive: t.lastActive || 0,
        }, now, idle);
        if (decision === 'mark') {
          t.sleeping = true;
          changed = true;
        } else if (decision === 'sleep' && t.view) {
          sleepTabNow(st, t);
          changed = true;
        }
      }
      if (changed) { layout(st.id); pushState(st.id); }
    }
  }

  // ---------- memory budget ("Memory Saver") ----------
  // One snapshot of every Dexerion process from Electron's own metrics.
  // workingSetSize is what Task Manager shows; the old `…KB` field names never
  // existed in Electron 44, which is why the readout showed ~0 forever.
  function memSnapshot() {
    let workingSetKB = 0, privateKB = 0;
    const procs = [];
    try {
      for (const m of require('electron').app.getAppMetrics()) {
        const mem = (m && m.memory) || {};
        const ws = mem.workingSetSize || 0;
        workingSetKB += ws;
        privateKB += mem.privateBytes || 0;
        procs.push({
          pid: m.pid, type: m.type || 'Unknown', name: m.name || m.serviceName || '',
          mb: Math.round(ws / 1024), cpu: Math.round((m.cpu && m.cpu.percentCPUUsage) || 0),
        });
      }
    } catch {}
    procs.sort((a, b) => b.mb - a.mb);
    const byType = {};
    for (const p of procs) byType[p.type] = (byType[p.type] || 0) + 1;
    return {
      workingSetMB: Math.round(workingSetKB / 1024), privateMB: Math.round(privateKB / 1024),
      processes: procs.length, byType, procs,
      pidMB: new Map(procs.map(p => [p.pid, p.mb])),
    };
  }

  function buildMemoryReport() {
    const snap = memSnapshot();
    const tabs = [];
    let asleep = 0;
    for (const st of windows.values()) {
      for (const [id, t] of st.tabs) {
        if (!t) continue;
        if (t.sleeping) asleep += 1;
        let pid = 0;
        try { pid = t.view && !t.view.webContents.isDestroyed() ? t.view.webContents.getOSProcessId() : 0; } catch {}
        tabs.push({ winId: st.id, tabId: id, pid, mb: pid ? (snap.pidMB.get(pid) || 0) : 0, sleeping: Boolean(t.sleeping) });
      }
    }
    return {
      workingSetMB: snap.workingSetMB, privateMB: snap.privateMB,
      processes: snap.processes, byType: snap.byType, procs: snap.procs,
      tabs, asleep,
      capMB: clampCapMB(S.settings.memoryCapMB),
      saverOn: S.settings.memorySaver !== false,
    };
  }

  function collectTabSnaps(snap) {
    const out = [];
    for (const st of windows.values()) {
      for (const [id, t] of st.tabs) {
        if (!t) continue;
        let pid = 0, audible = false;
        try { pid = t.view && !t.view.webContents.isDestroyed() ? t.view.webContents.getOSProcessId() : 0; } catch {}
        try { audible = Boolean(t.view && t.view.webContents.isCurrentlyAudible()); } catch {}
        out.push({
          winId: st.id, tabId: id, url: t.url, pid,
          memMB: pid ? (snap.pidMB.get(pid) || 0) : 0,
          active: id === st.active, loading: Boolean(t.loading), lazy: Boolean(t.lazy),
          sleeping: Boolean(t.sleeping), hasView: Boolean(t.view), audible,
          lastActive: t.lastActive || 0,
        });
      }
    }
    return out;
  }

  // Over budget → sleep LRU background tabs until the projected total fits.
  // Runs on the same 30s tick as the idle sweep; the next tick re-measures,
  // so a shared-renderer estimate can never snowball. No auto-wake, ever.
  function memorySweep(forcedTotalMB, floorMs) {
    if (S.settings.memorySaver === false) {
      const st0 = focusedState();
      if (st0 && st0.memNotice) { st0.memNotice = null; pushState(st0.id); }
      return { skipped: 'off' };
    }
    const snap = memSnapshot();
    const totalMB = Number.isFinite(Number(forcedTotalMB)) ? Number(forcedTotalMB) : snap.workingSetMB;
    const capMB = clampCapMB(S.settings.memoryCapMB);
    // The planner cannot choose any victims at or below the cap. Skip the
    // native PID/audibility queries and per-tab objects in that common case;
    // still feed the plan to the notice check so a stale warning clears.
    const tabSnaps = totalMB > capMB ? collectTabSnaps(snap) : [];
    const plan = planSweep(tabSnaps, {
      totalMB, capMB, now: Date.now(),
      floorMs: Number.isFinite(floorMs) ? Number(floorMs) : undefined,
    });
    const changed = new Set();
    for (const v of plan.victims) {
      const st = windows.get(v.winId);
      const t = st && st.tabs.get(v.tabId);
      if (!st || !t || !t.view) continue;
      sleepTabNow(st, t);
      changed.add(v.winId);
    }
    for (const wid of changed) { layout(wid); pushState(wid); }
    memoryNoticeCheck(snap, plan, capMB);
    return { totalMB, capMB, slept: plan.victims.length, projectedMB: plan.projectedMB };
  }

  // Still over budget with nothing left to sleep: when the CURRENT tab is a
  // notable consumer, tell the user and let them decide (Allow / Close tab).
  // The notice clears itself once the tab stops being the problem, and
  // Allow/Close mute it for this window so it never nags every sweep.
  function memoryNoticeCheck(snap, plan, capMB) {
    const st = focusedState();
    if (!st) return;
    const clear = () => { if (st.memNotice) { st.memNotice = null; pushState(st.id); } };
    if (plan.projectedMB <= capMB) { clear(); return; }
    if (Date.now() < (st.memNoticeMutedUntil || 0)) return;
    const t = st.tabs.get(st.active);
    if (!t || !t.view) { clear(); return; }
    let mb = 0;
    try { mb = snap.pidMB.get(t.view.webContents.getOSProcessId()) || 0; } catch {}
    if (!shouldNoticeHog(mb, capMB, Math.max(0, plan.projectedMB - capMB))) { clear(); return; }
    const total = Math.round(plan.projectedMB);
    const cur = st.memNotice;
    if (cur && cur.tabId === t.id) {
      // Keep the figures fresh without spamming state writes.
      if (Math.abs((cur.mb || 0) - mb) >= 128 || Math.abs((cur.total || 0) - total) >= 128) {
        st.memNotice = { tabId: t.id, mb, total, capMB, at: Date.now() };
        pushState(st.id);
      }
      return;
    }
    st.memNotice = { tabId: t.id, mb, total, capMB, at: Date.now() };
    pushState(st.id);
  }

  // Adaptive power scheduler (see adaptive-power.js + the power controller):
  // one timeout, re-armed by the current plan, replaces the fixed 30/60s
  // interval. Idle/battery/minimized windows stretch the cadence; interaction
  // and power transitions pull the next sweep forward immediately.
  applyPowerPlan('boot');

  function closeTab(winId, tabId) {
    const st = windows.get(winId); if (!st || !st.tabs.has(tabId)) return;
    // Closing the video-fullscreen tab must restore the window first: the
    // leave event dies with the webContents below, and without this the
    // window would stay borderless with no taskbar.
    if (st.htmlFullscreen && st.htmlFullscreenTab === tabId) exitHtmlFullscreen(winId);
    if (agentInstance) { try { agentRef().tabClosed(tabId); } catch {} } // a run acting on this tab halts: its refs are gone
    // The inspected target is going away, so the panel goes with it.
    if (st.inspector && st.inspector.open && st.inspector.tabId === tabId) closeInspector(winId);
    const t = st.tabs.get(tabId);
    pushClosed(winId, { url: t.url, title: t.title });
    clearNet(t);   // stop any offline wait this tab was running
    try {
      if (t.view) {
        try { st.win.contentView.removeChildView(t.view); } catch {}
        try { t.view.webContents.close(); } catch {}
      }
    } catch {}
    st.tabs.delete(tabId);
    st.order = st.order.filter(x => x !== tabId);
    sweepGroups(st); // drop groups left with no members
    if (st.active === tabId) st.active = st.order[st.order.length - 1] || null;
    if (st.active) activateTab(winId, st.active);
    if (st.order.length === 0) newTab(winId, 'dexerion://newtab', false);
    else pushState(winId);
    persistSoon();
  }

  function duplicateTab(winId, tabId) {
    const st = windows.get(winId); const t = st && st.tabs.get(tabId);
    if (!t) return;
    const nid = newTab(winId, t.url, false);
    const nt = nid && st.tabs.get(nid);
    if (nt && t.groupId && st.groups.has(t.groupId)) nt.groupId = t.groupId;
  }

  function reopenClosed(winId) {
    const st = windows.get(winId) || focusedState();
    if (!st) return null;
    const A = accData(st.accountId);
    const last = A.closedTabs.pop();
    saveAcc(st.accountId);
    if (last) newTab(st.id, last.url, false);
    return last || null;
  }

  function layout(winId) {
    const st = windows.get(winId); if (!st) return;
    try {
      const b = st.win.getContentBounds();
      // Video fullscreen owns every pixel of the window: no chrome height, no
      // rail, no AI sidebar, and the inspector keeps its geometry until the
      // page leaves fullscreen (opening one exits fullscreen first).
      const fs = Boolean(st.htmlFullscreen);
      const top = fs ? 0 : chromeH(st);
      const rail = fs ? 0 : railW(st);
      // An open inspector takes a docked slice of the window; the page keeps the
      // rest, so the panel never covers content.
      const ins = fs ? null : inspectorRect(st);
      // The fullscreen Search With Dexerion AI surface takes the whole window:
      // hide the page view so the shell (and its overlay) owns every pixel.
      const page = st.searchOpen ? { x: 0, y: 0, width: 0, height: 0 } : (ins ? ins.page : {
        x: rail, y: top,
        width: Math.max(0, b.width - rail - (fs ? 0 : (st.aiOpen ? aiSidebarWidth(st, b.width) : 0))),
        height: Math.max(0, b.height - top),
      });
      // A slept tab has no view (and a destroyed one throws): skip it per-tab so
      // one dead entry can never abort positioning for the tabs after it.
      for (const [id, t] of st.tabs) {
        if (!t || !t.view) continue;
        try {
          if (id === st.active) {
            t.view.setBounds(page);
          } else t.view.setBounds({ x: 0, y: top, width: 0, height: 0 });
        } catch {}
      }
      // B1 consistency: while the fullscreen search surface owns the window,
      // the covered page view is parked at 0x0 but still produces frames
      // (setVisible-only does not stop rAF on an attached view). The proven
      // off-switch is detach+hidden - the exact state the background-tab fix
      // uses. Closing the surface re-attaches. The tracked flag is per
      // WINDOW; the attached check re-detaches whatever activateTab re-ran
      // while the surface was open. A minimized window never re-attaches
      // here (setWindowViewsVisible(true) owns the restore attach once the
      // surface is closed, since st.searchOpen is then false).
      try {
        const act = st.tabs.get(st.active);
        if (act && act.view && !act.view.webContents.isDestroyed()) {
          const searchLev = Number(BUDGETS.searchPageDetach) !== 0 && process.env.DEX_SEARCH_DETACH !== 'off';
          if (searchLev && st.searchOpen) {
            let attached = true;
            try { attached = st.win.contentView.getChildViews().includes(act.view); } catch {}
            if (attached) detachView(winId, act.view);
            st.searchPageHidden = true;
          } else if (searchLev && st.searchPageHidden) {
            let minimized = true;
            try { minimized = st.win.isMinimized(); } catch {}
            if (!minimized) attachView(winId, act.view);
            st.searchPageHidden = false;
          }
        }
      } catch {}
      if (ins && st.inspector.win && !st.inspector.win.isDestroyed()) {
        // The DevTools surface is a frameless child window pinned to the panel's
        // body; the header above it is drawn by the shell in the user's theme.
        st.inspector.win.setBounds({
          x: Math.round(b.x + ins.body.x), y: Math.round(b.y + ins.body.y),
          width: ins.body.width, height: ins.body.height,
        });
      }
      // Keep an open snip overlay aligned with the tab content on resize.
      // It is an in-window child view (not a separate OS window), so dialogs
      // parented to the window always paint above it and it can never wedge
      // behind a save picker.
      const sn = snipState.get(winId);
      if (sn && sn.view && !sn.view.webContents.isDestroyed()) {
        try {
          st.win.contentView.addChildView(sn.view); // re-add keeps it above the tab views
          sn.view.setBounds(snipViewBounds(st, sn));
        } catch {}
      }
      // An open report viewer keeps tracking the page area (rail → sidebar),
      // so it stays "on top of the current tab" through resizes and rail
      // drags while the chat remains visible beside it.
      const rv = reportOverlayState.get(winId);
      if (rv && rv.view && !rv.view.webContents.isDestroyed()) {
        try {
          st.win.contentView.addChildView(rv.view); // re-add keeps it above the tab views
          rv.view.setBounds(overlayViewBounds(st, rv));
        } catch {}
      }
      // The Focus preview rides the same page area when it is open.
      const sv = siteOverlayState.get(winId);
      if (sv && sv.view && !sv.view.webContents.isDestroyed()) {
        try {
          st.win.contentView.addChildView(sv.view);
          sv.view.setBounds(overlayViewBounds(st, sv));
        } catch {}
      }
    } catch {}
  }

  // The report viewer covers exactly the page area: everything the current tab
  // owns, with the browser chrome and the AI chat untouched around it.
  function reportOverlayBounds(st) {
    const b = st.win.getContentBounds();
    const top = chromeH(st);
    const rail = railW(st);
    return {
      x: rail, y: top,
      width: Math.max(0, b.width - rail - (st.aiOpen ? aiSidebarWidth(st, b.width) : 0)),
      height: Math.max(0, b.height - top),
    };
  }

  // Fullscreen preview: the overlay takes every pixel of the window's content
  // area — no rail, browser chrome, or chat gutter. Everything that isn't in
  // fullscreen keeps the page-area contract above.
  function overlayViewBounds(st, rec) {
    if (rec && rec.fullscreen) {
      const b = st.win.getContentBounds();
      return { x: 0, y: 0, width: b.width, height: b.height };
    }
    return reportOverlayBounds(st);
  }

  // Tell the overlay page that fullscreen changed. Every exit path funnels
  // through this helper, so the in-page button can never disagree with the
  // main-process record (and a reload can ask for the current state again).
  function broadcastOverlayFullscreen(st, rec) {
    const on = !!(rec && rec.fullscreen);
    const wc = rec && rec.view && !rec.view.webContents.isDestroyed() ? rec.view.webContents : null;
    if (wc) { try { wc.send(OVERLAY_FULLSCREEN_EVENT, on); } catch {} }
  }

  // A failed overlay load still gets a real, styled error page. Classes (not
  // inline styles) keep the dark/light palettes honest, and system colours
  // avoid hard-coding a theme in a data: document with no stylesheet of ours.
  function overlayErrorHtml(title, message, retryUrl) {
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>' + esc(title) + '</title>'
      + '<style>:root{color-scheme:light dark}'
      + 'body{margin:0;padding:40px;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:CanvasText;background:Canvas}'
      + '.dxa-overlay-error h1{font-size:20px;margin:0 0 12px}'
      + '.dxa-overlay-error p{font-size:14px;line-height:1.5;margin:0 0 18px}'
      + '.dxa-overlay-retry{padding:8px 16px;font:inherit;border:0;border-radius:5px;cursor:pointer;background:Highlight;color:HighlightText}'
      + '.dxa-overlay-retry:focus-visible{outline:2px solid Highlight;outline-offset:2px}'
      + '@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}'
      + '</style></head><body><div class="dxa-overlay-error"><h1>' + esc(title) + '</h1><p>' + esc(message) + '</p>'
      + '<button class="dxa-overlay-retry" data-url="' + esc(retryUrl) + '">Try again</button></div>'
      + '<script>document.querySelector(".dxa-overlay-retry").onclick=function(){window.location.href=this.dataset.url;};</script>'
      + '</body></html>';
  }

  // ---------- video fullscreen in a tab (HTML fullscreen) ----------
  // A page's fullscreen request used to fall through to Electron's built-in
  // behaviour, which force-resized the host window into OS fullscreen on
  // enter and failed to restore it on exit — the window stayed borderless with
  // no taskbar until it was force-closed, and the shell chrome (toolbar,
  // rail, AI sidebar) kept covering the video. Every tab/popup now runs with
  // disableHtmlFullscreenWindowResize, so Chromium only fills the tab's view
  // and the transitions below own the window state entirely.
  const FS_HEAL_MS = 400;

  function sendHtmlFullscreen(st, on) {
    try { st.win.webContents.send('dex:html-fullscreen', on); } catch {}
  }

  function enterHtmlFullscreen(winId, tabId) {
    const st = windows.get(winId); if (!st || st.win.isDestroyed()) return;
    if (st.htmlFullscreen && st.htmlFullscreenTab === tabId) return;
    if (!st.htmlFullscreen) {
      // One snapshot per fullscreen run: a window that was maximised comes
      // back maximised, a window with normal bounds comes back to them.
      let maximized = false, bounds = null;
      try { maximized = st.win.isMaximized(); } catch {}
      try { if (!maximized) bounds = st.win.getNormalBounds ? st.win.getNormalBounds() : st.win.getBounds(); } catch {}
      st.fsRestore = { maximized, bounds };
    }
    st.htmlFullscreen = true;
    st.htmlFullscreenTab = tabId;
    try { if (!st.win.isFullScreen()) st.win.setFullScreen(true); } catch {}
    sendHtmlFullscreen(st, true);
    layout(winId);
  }

  function exitHtmlFullscreen(winId) {
    const st = windows.get(winId); if (!st) return;
    if (!st.htmlFullscreen) return;
    st.htmlFullscreen = false;
    st.htmlFullscreenTab = null;
    sendHtmlFullscreen(st, false);
    const restore = st.fsRestore || { maximized: false, bounds: null };
    st.fsRestore = null;
    try { if (st.win.isFullScreen()) st.win.setFullScreen(false); } catch {}
    try {
      if (restore.maximized) {
        if (!st.win.isMaximized()) st.win.maximize();
      } else if (restore.bounds) {
        st.win.setBounds(restore.bounds);
      }
    } catch {}
    layout(winId);
    // Self-heal: Windows can process the fullscreen transition out of order —
    // exactly how this feature used to wedge a window until it was force-
    // closed. Verify shortly after; if the window is somehow still fullscreen,
    // re-assert the exit and the saved geometry, then re-layout.
    clearTimeout(st.fsHealTimer);
    st.fsHealTimer = setTimeout(() => {
      st.fsHealTimer = null;
      if (!windows.has(winId) || st.win.isDestroyed()) return;
      try {
        if (st.win.isFullScreen()) {
          st.win.setFullScreen(false);
          if (restore.maximized) {
            if (!st.win.isMaximized()) st.win.maximize();
          } else if (restore.bounds) {
            st.win.setBounds(restore.bounds);
          }
        }
      } catch {}
      layout(winId);
    }, FS_HEAL_MS);
  }

  // Leave fullscreen and put the window back where the person had it, so the
  // chat/rail are exactly as they were before the preview took over.
  function exitOverlayFullscreen(st, rec) {
    if (!rec || !rec.fullscreen) return;
    rec.fullscreen = false;
    broadcastOverlayFullscreen(st, rec);
    try {
      if (rec.priorMaximized) {
        if (!st.win.isMaximized()) st.win.maximize();
      } else {
        if (st.win.isMaximized()) st.win.restore();
        if (rec.priorBounds) st.win.setBounds(rec.priorBounds);
      }
    } catch {}
    rec.priorBounds = null;
  }

  function openReportOverlay(st, chatId, index, panel) {
    // The overlay needs the chrome back: video fullscreen hands the window
    // over first, so the preview can never open inside a fullscreen window.
    if (st.htmlFullscreen) exitHtmlFullscreen(st.id);
    const query = [];
    if (chatId) query.push('chat=' + encodeURIComponent(chatId));
    if (Number.isInteger(index) && index >= 0) query.push('i=' + String(index));
    if (panel) query.push('panel=' + encodeURIComponent(panel));
    query.push('overlay=1');
    const url = 'dexerion://report?' + query.join('&');
    const cur = reportOverlayState.get(st.id);
    if (cur && cur.view && cur.view.webContents.isDestroyed()) {
      // A dead view cannot be reused: restore any fullscreen window state
      // before replacing the record so the new overlay starts in-page.
      exitOverlayFullscreen(st, cur);
    }
    if (cur && cur.view && !cur.view.webContents.isDestroyed()) {
      // Reuse: re-show (a stale view must never look dead) and navigate.
      try {
        st.win.contentView.addChildView(cur.view);
        cur.view.setBounds(overlayViewBounds(st, cur));
        cur.url = url;
        cur.view.webContents.loadURL(url).catch(() => {});
      } catch {}
      return true;
    }
    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '../../preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
      },
    });
    try { view.setBackgroundColor((S.settings.theme || 'dark') === 'light' ? '#f6f6f4' : '#171614'); } catch {}
    reportOverlayState.set(st.id, { view, url, chatId, index, panel, fullscreen: false });
    // A fresh document has no listeners yet when a state change is broadcast;
    // replay the current state once it finishes loading (also covers reuse).
    view.webContents.on('did-finish-load', () => {
      const cur = reportOverlayState.get(st.id);
      if (cur && cur.view === view) broadcastOverlayFullscreen(st, cur);
    });
    view.webContents.on('did-fail-load', (ev, code, desc, failedUrl) => {
      if (!failedUrl || !String(failedUrl).startsWith('dexerion://report')) return;
      const rec = reportOverlayState.get(st.id);
      if (!rec || rec.view !== view) return;
      // Show an error page inside the overlay instead of silently closing it.
      // The "Try again" button re-attempts the original URL stored in state.
      const retryUrl = String(rec.url || 'dexerion://report?overlay=1');
      const errHtml = overlayErrorHtml('Report failed to load', 'The report preview could not be displayed.', retryUrl);
      view.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(errHtml)).catch(() => {});
    });
    try {
      st.win.contentView.addChildView(view);
      view.setBounds(overlayViewBounds(st, reportOverlayState.get(st.id)));
      view.webContents.loadURL(url).catch(() => {});
    } catch {
      closeReportOverlay(st);
      return false;
    }
    return true;
  }

  function closeReportOverlay(st) {
    const rec = reportOverlayState.get(st.id);
    if (!rec) return false;
    exitOverlayFullscreen(st, rec);
    reportOverlayState.delete(st.id);
    try { st.win.contentView.removeChildView(rec.view); } catch {}
    try { rec.view.webContents.close(); } catch {}
    return true;
  }

  // The Focus preview: a served website over the page area with the chat
  // still beside it — the dedicated interactive surface, without spending a
  // tab. Same overlay machinery as the report viewer, same *page area* (the
  // bounds function is shared), and the same one-per-window rule: opening a
  // second site replaces the first.
  function openSiteOverlay(st, chatId, index) {
    // Same rule as the report viewer: video fullscreen hands the window over
    // first, so the Focus preview always opens with the chrome in place.
    if (st.htmlFullscreen) exitHtmlFullscreen(st.id);
    const query = [];
    if (chatId) query.push('chat=' + encodeURIComponent(chatId));
    if (Number.isInteger(index) && index >= 0) query.push('i=' + String(index));
    query.push('overlay=1');
    const url = 'dexerion://artifact?' + query.join('&');
    const cur = siteOverlayState.get(st.id);
    if (cur && cur.view && cur.view.webContents.isDestroyed()) {
      exitOverlayFullscreen(st, cur); // restore window before a fresh overlay
    }
    if (cur && cur.view && !cur.view.webContents.isDestroyed()) {
      try {
        st.win.contentView.addChildView(cur.view);
        cur.view.setBounds(overlayViewBounds(st, cur));
        cur.url = url;
        cur.view.webContents.loadURL(url).catch(() => {});
      } catch {}
      return true;
    }
    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '../../preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
      },
    });
    try { view.setBackgroundColor((S.settings.theme || 'dark') === 'light' ? '#f6f6f4' : '#171614'); } catch {}
    siteOverlayState.set(st.id, { view, url, chatId, index, fullscreen: false });
    // Replay fullscreen state once the overlay document is ready (covers a
    // fresh load, a reload, and the reuse path above).
    view.webContents.on('did-finish-load', () => {
      const cur = siteOverlayState.get(st.id);
      if (cur && cur.view === view) broadcastOverlayFullscreen(st, cur);
    });
    view.webContents.on('did-fail-load', (ev, code, desc, failedUrl) => {
      if (!failedUrl || !String(failedUrl).startsWith('dexerion://artifact')) return;
      const rec = siteOverlayState.get(st.id);
      if (!rec || rec.view !== view) return;
      // Show an error page inside the overlay instead of silently closing it.
      // The "Try again" button re-attempts the original URL stored in state.
      const retryUrl = String(rec.url || 'dexerion://artifact?overlay=1');
      const errHtml = overlayErrorHtml('Preview failed to load', 'The site preview could not be displayed.', retryUrl);
      view.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(errHtml)).catch(() => {});
    });
    try {
      st.win.contentView.addChildView(view);
      view.setBounds(overlayViewBounds(st, siteOverlayState.get(st.id)));
      view.webContents.loadURL(url).catch(() => {});
    } catch {
      closeSiteOverlay(st);
      return false;
    }
    return true;
  }

  function closeSiteOverlay(st) {
    const rec = siteOverlayState.get(st.id);
    if (!rec) return false;
    exitOverlayFullscreen(st, rec);
    siteOverlayState.delete(st.id);
    try { st.win.contentView.removeChildView(rec.view); } catch {}
    try { rec.view.webContents.close(); } catch {}
    return true;
  }

  // ---------- printing served pages to PDF ----------
  // The researched pipeline: a hidden window loads the page from the
  // artifact's own in-memory host (never file://), waits for load + fonts +
  // lazy images + two frames, then prints with backgrounds and CSS page size.
  // Jobs are serialized (one hidden window at a time) and each page is its
  // own PDF — byte-concatenating PDFs is invalid and a merge library is a new
  // dependency, so per-page files are the honest no-dependency form.
  function pdfNameFor(page) {
    const base = String(page || 'index.html').split('/').pop().replace(/\.html?$/i, '') || 'index';
    return base.toLowerCase().replace(/[^\w-]+/g, '-').slice(0, 40) + '.pdf';
  }
  async function printSitePages(artifact, pages) {
    const info = aiSiteHost.registerSiteArtifact(siteRegistry, artifact);
    if (!info) return [];
    const wanted = (Array.isArray(pages) && pages.length ? pages : info.pages).slice(0, 12);
    const out = [];
    let win = null;
    try {
      win = new BrowserWindow({
        show: false,
        width: 1120, height: 900,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
      });
    } catch { return []; }
    try {
      for (const page of wanted) {
        try {
          await win.loadURL('dexsite://' + info.id + '/' + page + '?print=1');
          await win.webContents.executeJavaScript(`(async () => {
            try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) {}
            const imgs = Array.from(document.images || []);
            for (const img of imgs) {
              img.loading = 'eager';
              try { if (img.decode) await img.decode(); } catch (e) {}
            }
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          })()`).catch(() => {});
          const buffer = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
          if (buffer && buffer.length) out.push({ page, buffer });
        } catch { /* one page failing never kills the export */ }
      }
    } finally {
      try { if (win) win.destroy(); } catch {}
    }
    return out;
  }

  // ---------- offline handling ----------
  // Chromium's own error page cannot tell you whether the *network* is down or
  // that one site is. Dexerion waits instead: a network-level main-frame failure
  // opens the waiting page, which probes the real target once a second for ten
  // seconds — that cadence is what the page's bars and its "Retrying n/10" line
  // read out — and a wait that runs out gives way to the offline page, which
  // keeps checking in the background so a reconnection repairs the tab whether or
  // not anyone touches it. A connection that works is never touched;
  // offlineVerdict is the single place that decision is made.
  const NET_GRACE_MS = 10000;
  const NET_ATTEMPT_MS = 1000;      // one attempt per second while waiting
  const NET_TICK_MS = 250;          // heartbeat: keeps the count on its second
  const NET_PAGE_WAIT_MS = 6000;    // waiting page never painted: count anyway
  const NET_PROBE_MS = 900;         // …so a probe finishes inside its own second
  const NET_ATTEMPTS = 10;          // grace / cadence: the "n/10" the page shows
  const NET_RECOVER_DWELL_MS = 1200; // hold the green "connected" state so it registers
  const NET_OFFLINE_MS = 2000;      // offline page: every 2s…
  const NET_OFFLINE_SLOW_MS = 5000; // …backing off after half a minute
  const NET_OFFLINE_SLOW_AFTER = 30000;
  const NET_MAX_RECOVERIES = 3;     // a page that loads and dies again cannot loop
  // Errors that mean "the wire", not "that site": a refused connection, a reset,
  // a certificate problem or an HTTP error all mean the network is fine.
  // ERR_BLOCKED_BY_CLIENT (-20) is a client/extension decision, never proof of
  // an outage; a network change (-21) is transient and needs a live probe.
  const NET_CODE_OFFLINE = new Set([-106 /* INTERNET_DISCONNECTED */]);
  const NET_CODE_MAYBE = new Set([-21 /* NETWORK_CHANGED */, -109 /* ADDRESS_UNREACHABLE */, -104 /* CONNECTION_FAILED */, -118 /* CONNECTION_TIMED_OUT */, -105 /* NAME_NOT_RESOLVED */]);
  function offlineVerdict(code, { isMainFrame, url, online } = {}) {
    if (!isMainFrame) return null;
    if (!/^https?:/i.test(String(url || ''))) return null;   // our own pages and files are never the network's fault
    if (NET_CODE_OFFLINE.has(code)) return 'offline';        // the OS says there is no link
    if (!NET_CODE_MAYBE.has(code)) return null;              // a broken site is not a broken connection
    // Ambiguous: a name that does not resolve while the network is up is a typo
    // or a dead domain, and a timeout while the network is up is that host's
    // problem. Only a second, independent signal may call this offline.
    if (online) return null;
    return 'maybe';
  }
  function hostOf(u) {
    try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return String(u || ''); }
  }
  // Reachability of a URL, from the tab's own session so partitions and cookies
  // behave. Local schemes are reachable by definition — no network involved.
  function netProbe(sess, url, ms = NET_PROBE_MS) {
    if (/^(file|dexerion):/i.test(String(url || ''))) return Promise.resolve(true);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
      const ctl = new AbortController();
      const timer = setTimeout(() => { try { ctl.abort(); } catch {} finish(false); }, ms);
      try {
        sess.fetch(url, { method: 'GET', redirect: 'follow', signal: ctl.signal })
          .then(() => { clearTimeout(timer); finish(true); })
          .catch(() => { clearTimeout(timer); finish(false); });
      } catch { clearTimeout(timer); finish(false); }
    });
  }
  // Is there a working connection at all? Cached briefly, and only ever consulted
  // for the ambiguous codes — the definite ones cost no round trip.
  let connCache = { at: 0, ok: false };
  async function connectivityOk() {
    if (Date.now() - connCache.at < 8000) return connCache.ok;
    let ok = false;
    try { ok = await netProbe(ses, 'http://connectivitycheck.gstatic.com/generate_204', 3000); } catch {}
    connCache = { at: Date.now(), ok };
    return ok;
  }
  function tabNet(t) { return t && t.net ? t.net : null; }
  function clearNet(t) {
    const net = tabNet(t);
    if (!net) return;
    clearTimeout(net.timer);
    t.net = null;
  }
  // The page shows what the main process is actually doing: it owns the loop, so
  // the count on screen is the real count even in a background tab.
  function sendNetProgress(t, patch) {
    try {
      const wc = t && t.view && t.view.webContents;
      if (!wc || wc.isDestroyed()) return;
      wc.send('dex:net-progress', Object.assign({
        state: 'waiting', attempt: 0, of: NET_ATTEMPTS,
        host: hostOf(tabNet(t) && tabNet(t).target),
      }, patch));
    } catch {}
  }
  function startWaiting(winId, tabId, target, opts = {}) {
    const st = windows.get(winId);
    const t = st && st.tabs.get(tabId);
    // Any real scheme: http(s) in practice, and a local target is "reachable at
    // once" by netProbe, so waiting on one resolves immediately rather than
    // lying. Anything else (javascript:, data:) is refused outright.
    if (!t || !/^(https?|file|dexerion):/i.test(String(target || ''))) return false;
    const prev = tabNet(t);
    if (prev && prev.state === 'waiting' && prev.target === target) return false;
    if (prev && prev.state === 'offline' && !opts.manual) return false;   // already given up: the page offers Try again
    const grace = Math.max(1000, Math.min(60000, Number(opts.graceMs) || NET_GRACE_MS));
    const of = Math.max(1, Math.round(grace / NET_ATTEMPT_MS));
    // A manual Try again always gets a fresh count: the recovery budget exists to
    // stop automatic re-entry from looping, never to refuse the person asking.
    const recoveries = opts.manual ? 0 : ((prev && prev.recoveries) || (t.netRecoveries || 0));
    const now = Date.now();
    t.net = {
      target, state: 'waiting', grace, of, recoveries,
      tries: 0, shown: 0, born: now,
      // The ten seconds are counted from when the waiting page is actually up,
      // not from the redirect: on a loaded machine the document can take longer
      // than the whole wait, and the count would be over before anyone saw it.
      started: 0, deadline: 0, lastProbe: 0, timer: null, probing: false,
    };
    const u = 'dexerion://connecting?t=' + encodeURIComponent(target) + '&host=' + encodeURIComponent(hostOf(target));
    t.view.webContents.loadURL(u).catch(() => {});
    tickNet(st.id, tabId);
    return true;
  }
  // Which attempt is on screen, derived from the clock rather than from how long
  // the last probe took: an offline target answers by timing out, and timing the
  // count off the probe stretched every step to nearly two seconds.
  function netAttempt(net, now) {
    if (!net.started) return 1;
    return Math.max(1, Math.min(net.of, Math.floor((now - net.started) / NET_ATTEMPT_MS) + 1));
  }
  // The waiting page is up: start (or restart) the clock it is counting down.
  function startNetClock(net) {
    net.started = Date.now();
    net.deadline = net.started + net.grace;
    net.shown = 0;
  }
  function scheduleNetPoll(st, tabId) {
    const t = st.tabs.get(tabId);
    const net = tabNet(t);
    if (!net || net.state !== 'waiting') return;
    clearTimeout(net.timer);
    // The poll lives in the main process, not the page: a background tab has its
    // renderer timers throttled, and the wait must finish on time regardless.
    net.timer = setTimeout(() => { tickNet(st.id, tabId); }, NET_TICK_MS);
  }
  function tickNet(winId, tabId) {
    const st = windows.get(winId);
    const t = st && st.tabs.get(tabId);
    const net = tabNet(t);
    if (!net || net.state !== 'waiting') return;
    const now = Date.now();
    // A page that never arrives must not wedge the tab: after a few seconds the
    // clock starts anyway and the wait ends as it should.
    if (!net.started && now - (net.born || now) > NET_PAGE_WAIT_MS) startNetClock(net);
    // The count is pushed the moment its second turns over, and 10/10 stands for
    // its own second before the offline page takes the tab.
    const attempt = netAttempt(net, now);
    if (attempt !== net.shown) {
      net.shown = attempt;
      net.tries = attempt;
      sendNetProgress(t, { state: 'waiting', attempt, of: net.of });
    }
    if (net.deadline && now >= net.deadline) { showOffline(winId, tabId, net.target); return; }
    if (!net.probing && now - net.lastProbe >= NET_ATTEMPT_MS) {
      net.probing = true;
      net.lastProbe = now;
      netProbe(t.view.webContents.session, net.target).then((ok) => {
        net.probing = false;
        if (tabNet(t) !== net || net.state !== 'waiting') return;   // the user moved on
        if (ok) recoverTarget(winId, tabId, net);
      }).catch(() => { net.probing = false; });
    }
    scheduleNetPoll(st, tabId);
  }
  // Reconnection is reported first, then the page opens: long enough to read the
  // green state, short enough not to feel like another wait.
  function recoverTarget(winId, tabId, net) {
    const st = windows.get(winId);
    const t = st && st.tabs.get(tabId);
    if (!t) return;
    clearTimeout(net.timer);
    net.state = 'recovered';
    t.netRecoveries = (net.recoveries || 0) + 1;
    // A durable record of the announced recovery. The page's green state lives
    // under a second and dies with the navigation that follows it, so anything
    // observing that transition from outside can miss it on a stalled machine;
    // this timestamp survives and says the same thing.
    t.netRecoveredAt = Date.now();
    sendNetProgress(t, { state: 'recovered', attempt: net.tries, of: net.of });
    setTimeout(() => {
      if (tabNet(t) !== net) return;
      const target = net.target;
      clearNet(t);
      try { t.view.webContents.loadURL(target); } catch {}
    }, NET_RECOVER_DWELL_MS);
  }
  function showOffline(winId, tabId, target) {
    const st = windows.get(winId);
    const t = st && st.tabs.get(tabId);
    if (!t) return false;
    const prev = tabNet(t);
    const recoveries = (prev && prev.recoveries) || (t.netRecoveries || 0);
    clearNet(t);
    // The offline page keeps checking by itself: a reconnection repairs the tab
    // whether or not anyone clicks Try again.
    t.net = {
      target, state: 'offline', tries: prev ? prev.tries : 0, of: prev ? prev.of : NET_ATTEMPTS,
      recoveries, grace: NET_GRACE_MS, timer: null, probing: false, offSince: Date.now(),
    };
    const u = 'dexerion://offline?t=' + encodeURIComponent(target) + '&host=' + encodeURIComponent(hostOf(target));
    t.view.webContents.loadURL(u).catch(() => {});
    sendNetProgress(t, { state: 'offline', attempt: t.net.tries, of: t.net.of });
    scheduleOfflinePoll(st, tabId);
    return true;
  }
  function scheduleOfflinePoll(st, tabId) {
    const t = st.tabs.get(tabId);
    const net = tabNet(t);
    if (!net || net.state !== 'offline') return;
    clearTimeout(net.timer);
    const waited = Date.now() - (net.offSince || Date.now());
    net.timer = setTimeout(() => { pollOffline(st.id, tabId); }, waited > NET_OFFLINE_SLOW_AFTER ? NET_OFFLINE_SLOW_MS : NET_OFFLINE_MS);
  }
  async function pollOffline(winId, tabId) {
    const st = windows.get(winId);
    const t = st && st.tabs.get(tabId);
    const net = tabNet(t);
    if (!net || net.state !== 'offline' || net.probing) return;
    net.probing = true;
    const ok = await netProbe(t.view.webContents.session, net.target);
    net.probing = false;
    if (tabNet(t) !== net || net.state !== 'offline') return;
    if (ok) {
      if ((net.recoveries || 0) >= NET_MAX_RECOVERIES) {
        // This page has been handed back and died again enough times; keep the
        // offline page up and let the person decide.
        sendNetProgress(t, { state: 'offline', attempt: net.tries, of: net.of, looping: true });
        scheduleOfflinePoll(st, tabId);
        return;
      }
      recoverTarget(winId, tabId, net);
      return;
    }
    scheduleOfflinePoll(st, tabId);
  }

  // ---------- inspector (Chromium DevTools, framed by Dexerion) ----------
  // Chromium's own DevTools is the only sensible inspector, and its UI is not
  // ours to restyle. So Dexerion frames it instead: the panel's header bar is
  // drawn by the shell (in the user's theme, accent and light/dark), and the
  // DevTools surface is Chromium's `devtools://` frontend hosted in a frameless
  // child window pinned to the body below that header. `setDevToolsWebContents`
  // is the only way to decide where the frontend lives; without it Electron
  // would spawn its own detached window and we would have no chrome to show.
  const INSPECT_HEAD = 30;     // header height — must match #inspector in shell.css
  const INSPECT_MIN_PAGE = 220; // the page always keeps this much of the window
  function inspectorRect(st) {
    const ins = st && st.inspector;
    if (!ins || !ins.open) return null;
    const b = st.win.getContentBounds();
    const top = chromeH(st);
    const rail = railW(st);
    if (ins.dock === 'right') {
      const w = Math.max(320, Math.min(Math.round(b.width * 0.46), b.width - rail - INSPECT_MIN_PAGE));
      return {
        dock: 'right',
        header: { x: b.width - w, y: top, width: w, height: INSPECT_HEAD },
        body: { x: b.width - w, y: top + INSPECT_HEAD, width: w, height: Math.max(0, b.height - top - INSPECT_HEAD) },
        page: { x: rail, y: top, width: Math.max(0, b.width - rail - w), height: Math.max(0, b.height - top) },
      };
    }
    const h = Math.max(220, Math.min(Math.round(b.height * 0.42), b.height - top - INSPECT_MIN_PAGE));
    return {
      dock: 'bottom',
      header: { x: rail, y: b.height - h, width: Math.max(0, b.width - rail), height: INSPECT_HEAD },
      body: { x: rail, y: b.height - h + INSPECT_HEAD, width: Math.max(0, b.width - rail), height: Math.max(0, h - INSPECT_HEAD) },
      page: { x: rail, y: top, width: Math.max(0, b.width - rail), height: Math.max(0, b.height - top - h) },
    };
  }
  function inspectorHost(st) {
    const ins = st.inspector;
    const t = ins && ins.tabId ? st.tabs.get(ins.tabId) : null;
    const url = (t && t.url) || '';
    if (/^https?:/i.test(url)) { try { return new URL(url).hostname; } catch {} }
    if (/^file:/i.test(url)) { try { return decodeURIComponent(url.split('/').pop() || 'file'); } catch { return 'file'; } }
    if (/^dexerion:\/\//i.test(url)) return url.replace(/^dexerion:\/\//i, '').split(/[?#]/)[0] || 'newtab';
    return url;
  }
  function openInspector(winId, tabId, x, y, opts = {}) {
    const st = windows.get(winId);
    if (!st) return false;
    const t = st.tabs.get(tabId || st.active);
    if (!t) return false;
    // The inspector is docked geometry around the page: video fullscreen hands
    // the window over first so the panel never docks against a fullscreen view.
    if (st.htmlFullscreen) exitHtmlFullscreen(winId);
    if (!st.inspector) st.inspector = { open: false, dock: 'bottom', tabId: null, win: null };
    const ins = st.inspector;
    // A different tab means a different DevTools target, so start over.
    if (ins.open && ins.tabId !== t.id) closeInspector(winId);
    if (!t.view) wakeTab(winId, t.id);
    if (!t.view) return false;
    const wc = t.view.webContents;
    const pick = Number.isFinite(x) && Number.isFinite(y);
    if (!ins.open) {
      // One side tool at a time: the AI sidebar and the inspector both want the
      // right edge, and the inspector is the one you opened deliberately.
      if (st.aiOpen) st.aiOpen = false;
      const devtools = new BrowserWindow({
        width: 800, height: 400, show: false, frame: false, hasShadow: false,
        skipTaskbar: true, resizable: false, parent: st.win, autoHideMenuBar: true,
        backgroundColor: S.settings.theme === 'light' ? '#f3f3f3' : '#282828',
        webPreferences: { preload: path.join(__dirname, '../../preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
      ins.win = devtools;
      ins.open = true;
      ins.tabId = t.id;
      ins.fallback = false;
      ins.reason = '';
      const watchdog = setTimeout(() => checkInspectorStarted(winId), Number(opts.watchdogMs) || 6000);
      devtools.on('closed', () => {
        clearTimeout(watchdog);
        // A replaced surface (fallback, retry) also fires 'closed' — only the
        // window that is still current may clear the inspected state.
        if (ins.win !== devtools) return;
        ins.win = null;
        if (ins.open) { ins.open = false; ins.tabId = null; try { layout(winId); pushState(winId); } catch {} }
      });
      devtools.webContents.on('did-fail-load', (e, code, desc, url, isMain) => {
        if (isMain) showInspectorFallback(winId, 'load ' + code + ': ' + desc);
      });
      try { devtools.webContents.setBackgroundThrottling(false); } catch {}
      // opts.failForTest leaves the surface unloaded so the fallback path can be
      // exercised without breaking DevTools for real.
      if (!opts.failForTest) {
        wc.setDevToolsWebContents(devtools.webContents);
        wc.openDevTools({ mode: 'detach' });
      }
      // Position before showing, then show unconditionally: relying on a load
      // event (or on focus() implying show()) is how a panel ends up invisible
      // while the state says it is open.
      layout(winId);
      try { devtools.showInactive(); } catch {}
      // Chromium's DevTools frontend draws its panels when its document counts as
      // visible. A freshly shown, unfocused child window can therefore paint the
      // tab strip with EMPTY panels — the "blank inspector" a user sees. Force the
      // repaint, twice: once now and once when the frontend has finished loading.
      const kickSurface = () => {
        try { if (devtools.isDestroyed()) return; devtools.webContents.invalidate(); } catch {}
        try {
          if (devtools.isDestroyed()) return;
          // Restore through layout(), never a stale snapshot: overlapping kicks
          // (DevTools fires did-finish-load per navigation) used to restore
          // each other's +1 and ratchet the surface taller on every open.
          const b = devtools.getBounds();
          devtools.setBounds({ ...b, height: b.height + 1 });
          setTimeout(() => { try { if (devtools.isDestroyed()) return; layout(winId); } catch {} }, 60);
        } catch {}
      };
      kickSurface();
      devtools.webContents.on('did-finish-load', () => setTimeout(kickSurface, 250));
      if (pick) setTimeout(() => { try { if (!devtools.isDestroyed()) devtools.focus(); } catch {} }, 250);
      if (pick) {
        // Selecting the node needs the frontend to be up; a short beat is enough
        // and never blocks the click that asked for it.
        setTimeout(() => { try { wc.inspectElement(Math.round(x), Math.round(y)); } catch {} }, 700);
      }
    } else if (pick) {
      try { wc.inspectElement(Math.round(x), Math.round(y)); } catch {}
      try { ins.win.focus(); } catch {}
    }
    layout(winId);
    pushState(winId);
    return true;
  }
  function closeInspector(winId) {
    const st = windows.get(winId);
    const ins = st && st.inspector;
    if (!ins || !ins.open) return false;
    const t = ins.tabId ? st.tabs.get(ins.tabId) : null;
    const w = ins.win;
    ins.open = false;
    ins.tabId = null;
    ins.win = null;
    ins.fallback = false;
    try { if (t) t.view.webContents.closeDevTools(); } catch {}
    if (w) inspectorWindows.delete(w);
    try { if (w && !w.isDestroyed()) w.destroy(); } catch {}
    layout(st.id);
    pushState(st.id);
    return true;
  }
  // Never leave an empty rectangle where the inspector should be. When Chromium's
  // frontend does not come up (failed load, or nothing loaded at all within the
  // watchdog), the panel is replaced by a Dexerion page that says what happened
  // and offers to try again — the same surface, in the user's theme.
  function showInspectorFallback(winId, reason) {
    const st = windows.get(winId);
    const ins = st && st.inspector;
    if (!ins || !ins.open || ins.fallback) return false;
    const old = ins.win;
    let host = null;
    try {
      host = new BrowserWindow({
        width: 600, height: 400, show: false, frame: false, hasShadow: false,
        skipTaskbar: true, resizable: false, parent: st.win, autoHideMenuBar: true,
        backgroundColor: S.settings.theme === 'light' ? '#f3f3f3' : '#282828',
        webPreferences: { preload: path.join(__dirname, '../../preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
      host.webContents.once('did-finish-load', () => { try { host.showInactive(); } catch {} });
      host.on('closed', () => {
        inspectorWindows.delete(host);
        if (ins.win !== host) return;
        ins.win = null;
        ins.open = false;
        ins.fallback = false;
        try { layout(winId); pushState(winId); } catch {}
      });
      inspectorWindows.set(host, winId);
      host.loadURL('dexerion://inspector?reason=' + encodeURIComponent(String(reason || '')));
    } catch (e) { return false; }
    ins.win = host;
    ins.fallback = true;
    ins.reason = String(reason || '');
    try { if (old && !old.isDestroyed()) { inspectorWindows.delete(old); old.destroy(); } } catch {}
    layout(winId);
    pushState(winId);
    return true;
  }
  // The frontend is up when its own document is a devtools:// page; the watchdog
  // is the only thing that catches "the host window is there but nothing loaded".
  // It must not kill a frontend that is still on its way, though: Chromium's
  // DevTools frontend has been measured taking 6-12+ s to arrive on a busy
  // machine, and the old fixed 6 s deadline declared failure while the load was
  // still progressing — the person then saw "The inspector did not start" and a
  // "Try again" that would fail the same way. While a DevTools session is live
  // (or the surface is loading / has already committed to a devtools: URL), the
  // deadline is extended a bounded number of times; an idle surface with
  // DevTools closed still falls back on the first check.
  const INSPECTOR_GRACE_MS = 6000;
  const INSPECTOR_MAX_GRACE = 4;
  function checkInspectorStarted(winId, grace) {
    const st = windows.get(winId);
    const ins = st && st.inspector;
    if (!ins || !ins.open || ins.fallback) return;
    const w = ins.win;
    let url = '';
    let loading = false;
    let expected = false;
    try {
      if (w && !w.isDestroyed()) {
        url = w.webContents.getURL();
        loading = w.webContents.isLoading();
      }
      const t = ins.tabId ? st.tabs.get(ins.tabId) : null;
      expected = Boolean(t && t.view && t.view.webContents && t.view.webContents.isDevToolsOpened());
    } catch { /* an unreadable surface is treated as idle */ }
    const used = Number(grace) || 0;
    const onItsWay = loading || expected || /^devtools:/.test(url);
    if (!/^devtools:/.test(url) && onItsWay && used < INSPECTOR_MAX_GRACE) {
      setTimeout(() => checkInspectorStarted(winId, used + 1), INSPECTOR_GRACE_MS);
      return;
    }
    if (!/^devtools:/.test(url)) showInspectorFallback(winId, url ? 'unexpected surface' : 'nothing loaded');
  }
  function setInspectorDock(winId, dock) {
    const st = windows.get(winId);
    const ins = st && st.inspector;
    if (!ins || !ins.open) return false;
    const want = dock === 'right' ? 'right' : 'bottom';
    if (want === ins.dock) return true;
    ins.dock = want;
    layout(winId);
    pushState(winId);
    return true;
  }

  // ---------- accent selection highlight ----------
  // Chromium paints the same stock blue selection on every site. Dexerion tints
  // it with the user's accent instead — the treatment dexerion:// pages already
  // get (assets/page-theme.css) — so highlighting text reads as this browser's.
  // Injected as a USER-origin stylesheet, which the page's CSP cannot block. It
  // needs !important: plain user declarations rank BELOW author ones in the
  // cascade, so without it a site that styles ::selection keeps its own colour
  // (a user+!important declaration is the one level nothing on the page beats).
  const SELECTION_ALPHA = 0.45;
  function selectionCss(accent) {
    const hex = /^#([0-9a-f]{6})$/i.exec(String(accent || ''));
    const plain = hex
      ? `rgba(${parseInt(hex[1].slice(0, 2), 16)},${parseInt(hex[1].slice(2, 4), 16)},${parseInt(hex[1].slice(4, 6), 16)},${SELECTION_ALPHA})`
      : accent;
    // color-mix keeps the accent's hue instead of darkening towards transparent
    // black; the rgba() line above is the fallback for older engines.
    return `::selection{background:${plain} !important;background:color-mix(in srgb, ${accent} ${Math.round(SELECTION_ALPHA * 100)}%, transparent) !important}`;
  }
  function accentSelectionCss() { return selectionCss((S.settings && S.settings.accent) || '#35c4ff'); }
  // Replace (don't stack) the previous sheet, so switching the accent never
  // leaves the old colour behind.
  function applySelectionAccent(wc) {
    if (!wc || wc.isDestroyed()) return;
    const css = accentSelectionCss();
    Promise.resolve(wc.insertCSS(css, { cssOrigin: 'user' }))
      .then((key) => {
        const prev = wc.__dexSelectionKey;
        wc.__dexSelectionKey = key;
        if (prev) wc.removeInsertedCSS(prev).catch(() => {});
      })
      .catch(() => {});
  }
  // webContents.insertCSS only reaches the main frame. Subframes get a
  // constructed stylesheet instead — adoptedStyleSheets is also outside CSP's
  // reach, so this works on strict pages too.
  function applySelectionAccentToFrame(frame) {
    try {
      frame.executeJavaScript(`(() => { try {
        const css = ${JSON.stringify(accentSelectionCss())};
        if (document.__dexSelCss === css) return true;
        const ss = new CSSStyleSheet(); ss.replaceSync(css);
        ss.__dexSel = true;
        document.adoptedStyleSheets = [...(document.adoptedStyleSheets || []), ss];
        document.__dexSelCss = css;
        return true;
      } catch (e) { return false; } })()`).catch(() => {});
    } catch {}
  }
  function applySelectionAccentAll() {
    for (const st of windows.values()) {
      for (const t of st.tabs.values()) {
        // Slept tabs have no view until woken — skipping them here keeps an
        // accent change from throwing mid-broadcast and aborting the loop.
        if (!t || !t.view) continue;
        let wc = null;
        try { wc = t.view.webContents; } catch { continue; }
        if (!wc || wc.isDestroyed()) continue;
        applySelectionAccent(wc);
        try {
          for (const f of wc.mainFrame.framesInSubtree) if (!f.isMainFrame) applySelectionAccentToFrame(f);
        } catch {}
      }
    }
  }

  function wireTabEvents(winId, tabId, wc) {
    // The suggestion sheet is a separate always-on-top window, and pressing an
    // item no longer steals focus from the search box (see ctxmenu.html) — so
    // the box never blurs when the user clicks a suggestion. Conversely a
    // click into the page below is a separate native view the renderer cannot
    // observe, so its blur handler never fires either. Dismiss from here: any
    // real input aimed at the page means the user has moved on.
    wc.on('before-input-event', (ev) => {
      if (!ev.input) return;
      closeSuggest(winId);
      // Esc must always leave video fullscreen. Chromium normally exits and
      // fires leave-html-full-screen, but if that event ever fails to arrive
      // (the Electron bug class that used to wedge a window until force-close),
      // verify shortly after and force the exit from here.
      if (ev.input.type === 'keyDown' && ev.input.key === 'Escape') {
        const st = windows.get(winId);
        if (st && st.htmlFullscreen && st.htmlFullscreenTab === tabId) {
          setTimeout(() => {
            const cur = windows.get(winId);
            if (!cur || !cur.htmlFullscreen || cur.htmlFullscreenTab !== tabId) return;
            try { wc.executeJavaScript('document.exitFullscreen()', true).catch(() => {}); } catch {}
            try { exitHtmlFullscreen(winId); } catch {}
          }, 350);
        }
      }
    });
    // Video fullscreen in this tab: the transitions below own the window
    // (tabs run with disableHtmlFullscreenWindowResize, so Electron's built-in
    // window-resize path never runs and nothing is left to auto-restore).
    wc.on('enter-html-full-screen', () => {
      try { enterHtmlFullscreen(winId, tabId); } catch {}
    });
    wc.on('leave-html-full-screen', () => {
      const st = windows.get(winId);
      if (st && st.htmlFullscreen && st.htmlFullscreenTab === tabId) {
        try { exitHtmlFullscreen(winId); } catch {}
      }
    });
    // Safety net: no load may spin the UI indicator forever (failed /
    // stalled loads that never emit did-stop-loading).
    let loadTimer = null;
    const armWatchdog = () => {
      clearTimeout(loadTimer);
      loadTimer = setTimeout(() => tabPatch(winId, tabId, { loading: false }), 30000);
    };
    wc.on('did-start-loading', () => { tabPatch(winId, tabId, { loading: true }); armWatchdog(); });
    wc.on('did-stop-loading', () => { clearTimeout(loadTimer); tabPatch(winId, tabId, { loading: false, url: wc.getURL() }); });
    wc.on('page-title-updated', (e, title) => { tabPatch(winId, tabId, { title }); });
    wc.on('page-favicon-updated', (e, favs) => {
      tabPatch(winId, tabId, { favicon: favs && favs.length ? favs[0] : undefined });
    });
    wc.on('did-fail-load', (e, code, desc, failedUrl, isMainFrame) => {
      clearTimeout(loadTimer);
      tabPatch(winId, tabId, { loading: false });
      // Safety net for the block guard: if a main-frame navigation was blocked
      // (ERR_BLOCKED_BY_CLIENT) rather than redirected, still show the block page.
      try {
        if (isMainFrame && pomoBlocked(failedUrl || wc.getURL())) {
          const target = failedUrl || wc.getURL();
          wc.loadURL(blockedUrl(target, pomodoro.blockInfo(target))).catch(() => {});
          return;   // the block guard owns this failure, not the network
        }
      } catch {}
      // Offline handling: only when the failure really is the connection. The
      // verdict is pure; the ambiguous cases additionally need a second signal.
      try {
        const target = failedUrl || wc.getURL();
        const verdict = offlineVerdict(code, { isMainFrame, url: target, online: net.isOnline() });
        if (verdict === 'offline') startWaiting(winId, tabId, target);
        else if (verdict === 'maybe') {
          connectivityOk().then((ok) => { if (!ok) startWaiting(winId, tabId, target); }).catch(() => {});
        }
      } catch {}
      void code; void desc;
    });
    wc.on('did-navigate', (e, url) => {
      // The user went somewhere themselves: stop waiting on the old target.
      const navSt = windows.get(winId);
      const navTab = navSt && navSt.tabs.get(tabId);
      const net = tabNet(navTab);
      if (net && net.state === 'waiting' && !/^dexerion:\/\/(connecting|offline)/i.test(url)) clearNet(navTab);
      // Drop the previous page's favicon immediately so it never lingers.
      tabPatch(winId, tabId, { url, favicon: undefined });
      if (shouldRecord(url)) addHistory(winId, { url, title: wc.getTitle() });
      trackTopSite(winId, url);
    });
    wc.on('did-finish-load', () => {
      const url = wc.getURL();
      tabPatch(winId, tabId, { url, title: wc.getTitle(), loading: false });
      // A real page loaded, so the connection works: the next failure gets a
      // fresh set of attempts. Internal pages keep the wait alive.
      if (!/^dexerion:\/\//i.test(url)) {
        const finSt = windows.get(winId);
        const finTab = finSt && finSt.tabs.get(tabId);
        if (finTab && tabNet(finTab)) clearNet(finTab);
        if (finTab) finTab.netRecoveries = 0;   // a page loaded: the connection is good again
      } else {
        // A progress push sent while the waiting page was still loading is lost
        // with the document, so the count is handed over again once it is ready.
        const finSt = windows.get(winId);
        const finTab = finSt && finSt.tabs.get(tabId);
        const finNet = finTab && tabNet(finTab);
        if (finNet && finNet.state === 'waiting') { startNetClock(finNet); tickNet(winId, tabId); }
      }
      // Web Store detection: notify shell to offer in-Dexerion install.
      if (/chromewebstore\.google\.com\/detail\//i.test(url)) {
        const st = windows.get(winId);
        if (st) st.win.webContents.send('dex:store-detected', { tabId, url });
      }
      installCredentialHelper(winId, tabId, wc, url);
    });
    wc.on('did-navigate-in-page', (e, url) => {
      installCredentialHelper(winId, tabId, wc, url || wc.getURL());
    });
    // Accent selection: re-apply per document (the sheet lives with the loaded
    // page) and per subframe, which insertCSS cannot reach.
    wc.on('dom-ready', () => applySelectionAccent(wc));
    wc.on('did-frame-finish-load', (e, isMainFrame, pid, rid) => {
      if (isMainFrame) { applySelectionAccent(wc); return; }
      try { applySelectionAccentToFrame(webFrameMain.fromId(pid, rid)); } catch {}
    });
    wc.on('context-menu', (e, params) => showContextMenu(winId, tabId, wc, params));
  }

  function tabPatch(winId, tabId, patch) {
    const st = windows.get(winId); const t = st && st.tabs.get(tabId);
    if (!t) return;
    Object.assign(t, patch);
    pushState(winId);
  }

  // ---------- history (per account) ----------
  function shouldRecord(url) {
    return url && !url.startsWith('dexerion://') && !url.startsWith('chrome-extension://') && !url.startsWith('about:');
  }
  function addHistory(winId, entry) {
    const st = windows.get(winId);
    const A = accData(st ? st.accountId : 'default');
    A.history.unshift({ url: entry.url, title: entry.title || entry.url, at: Date.now() });
    if (A.history.length > 5000) A.history.length = 5000;
    saveAcc(st ? st.accountId : 'default');
    for (const w of windows.values()) w.win.webContents.send('dex:history-updated');
  }
  function trackTopSite(winId, url) {
    try {
      const host = new URL(url).hostname;
      if (!host) return;
      const st = windows.get(winId);
      const A = accData(st ? st.accountId : 'default');
      A.topSites[host] = (A.topSites[host] || 0) + 1;
      saveAcc(st ? st.accountId : 'default');
    } catch {}
  }
  function pushClosed(winId, entry) {
    if (!entry.url || entry.url === 'dexerion://newtab') return;
    if (/^dexerion:\/\/welcome/i.test(String(entry.url))) return; // disposable daily page
    const st = windows.get(winId);
    const A = accData(st ? st.accountId : 'default');
    A.closedTabs.push(entry);
    if (A.closedTabs.length > 25) A.closedTabs.shift();
    saveAcc(st ? st.accountId : 'default');
  }

  // ---------- password manager ----------
  // Credentials are stored per account, encrypted at rest with safeStorage
  // (OS keychain) where available. Pages can only ever receive logins for
  // their own origin — the main process enforces the match.
  function encryptSecret(plain) {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        return { enc: true, data: safeStorage.encryptString(String(plain)).toString('base64') };
      }
    } catch {}
    return { enc: false, data: Buffer.from(String(plain)).toString('base64') };
  }
  function decryptSecret(rec) {
    try {
      if (rec && rec.enc) return safeStorage.decryptString(Buffer.from(rec.data, 'base64'));
      if (rec) return Buffer.from(rec.data, 'base64').toString('utf8');
    } catch {}
    return '';
  }
  function senderOrigin(e) {
    try { return new URL(e.sender.getURL()).origin; } catch { return ''; }
  }
  function loginsFor(accountId, origin) {
    return accData(accountId).logins
      .filter(l => l.origin === origin)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  const pendingLogins = new Map(); // winId -> { origin, username, password }

  const CRED_HELPER = `(function(){
    if (window.__dexCred) return; window.__dexCred = true;
    // Identifier-first sign-ins (Onshape, Google…): step 1 asks for the
    // email with NO password field on the page yet. idField() finds that
    // standalone email/username input (conservative selectors only — never
    // generic text/search boxes) so the saved email fills on step 1, and
    // the password fills when step 2 renders (the observer re-runs fill).
    function idField(scope) {
      const q = (s) => { try { return scope.querySelector(s); } catch { return null; } };
      return q('input[type=email]') ||
        q('input[autocomplete*=email i]') ||
        q('input[autocomplete*=username i]') ||
        q('input[name*=email i]:not([type=password])') ||
        q('input[name*=user i]:not([type=password])') ||
        q('input[name*=login i]:not([type=password])') ||
        q('input[id*=email i]') ||
        q('input[id*=user i]:not([type=password])') ||
        q('input[placeholder*=email i]') ||
        null;
    }
    function fields() {
      const pw = document.querySelector('input[type=password]');
      if (pw && pw.isConnected) {
        const form = pw.form;
        const scope = form || document;
        const user = idField(scope) ||
          scope.querySelector('input[type=tel]') ||
          scope.querySelector('input[type=text]:not([type=password])');
        return { pw, user };
      }
      const u = idField(document);
      if (u && u.isConnected) return { pw: null, user: u };
      return null;
    }
    function setVal(el, v) {
      el.focus();
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
    }
    async function fill() {
      try {
        const f = fields(); if (!f) return;
        if (f.user && f.user.value && f.pw && f.pw.value) return; // nothing to do
        const origin = location.origin;
        const creds = await window.dexerion.invoke('dex:login-query', { origin });
        if (!creds || !creds.length) return;
        const c = creds[0];
        if (f.user && !f.user.value && c.username) setVal(f.user, c.username || '');
        if (f.pw && !f.pw.value && c.password) setVal(f.pw, c.password);
      } catch {}
    }
    function watch() {
      const f = fields(); if (!f) return;
      const form = (f.pw && f.pw.form) || (f.user && f.user.form) || document;
      if (form.__dexWatched) return; form.__dexWatched = true;
      const submit = () => {
        try {
          const ff = fields(); if (!ff || !ff.pw || !ff.pw.value) return;
          window.dexerion.invoke('dex:login-capture', {
            origin: location.origin,
            username: (ff.user && ff.user.value) || '',
            password: ff.pw.value,
          }).catch(() => {});
        } catch {}
      };
      if (f.pw) {
        if (f.pw.form) f.pw.form.addEventListener('submit', submit);
        f.pw.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') submit(); });
        const btn = (f.pw.form && f.pw.form.querySelector('[type=submit],button:not([type])')) || null;
        if (btn) btn.addEventListener('click', () => setTimeout(submit, 300));
        f.pw.addEventListener('focus', () => setTimeout(fill, 50));
      }
      // Refill when the user focuses the fields (covers flows that render
      // or clear the form after load, e.g. Google's two-step sign-in).
      if (f.user) f.user.addEventListener('focus', () => setTimeout(fill, 50));
    }
    fill();
    watch();
    new MutationObserver(() => { fill(); watch(); }).observe(document.documentElement, { childList: true, subtree: true });
  })();`;

  function installCredentialHelper(winId, tabId, wc, url) {
    try {
      if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) return;
      if (wc.isDestroyed()) return;
      wc.executeJavaScript(CRED_HELPER).catch(() => {});
      installGoogleDetect(wc, url);
    } catch {}
  }

  // ---------- downloads ----------
  function isDownloadsTab(tab) {
    try { return Boolean(tab && (tab.view.webContents.getURL() || '').startsWith('dexerion://downloads')); }
    catch { return false; }
  }

  function notifyDownloads() {
    for (const st of windows.values()) {
      if (st.win.isDestroyed()) continue;
      st.win.webContents.send('dex:downloads-updated');
      for (const tabId of st.order) {
        const t = st.tabs.get(tabId);
        if (!isDownloadsTab(t)) continue;
        t.view.webContents.send('dex:downloads-updated');
      }
    }
  }

  function showDownloads(initiatingWebContents) {
    let st = null;
    if (initiatingWebContents) {
      for (const candidate of windows.values()) {
        for (const [tabId, tab] of candidate.tabs) {
          if (!tab.view) continue;   // slept tabs have no renderer to match
          if (tab.view.webContents === initiatingWebContents) {
            st = candidate;
            break;
          }
        }
        if (st) break;
      }
    }
    if (!st) st = focusedState();
    if (!st) return;
    const existing = st.order.find(tabId => isDownloadsTab(st.tabs.get(tabId)));
    if (existing) activateTab(st.id, existing);
    else newTab(st.id, 'dexerion://downloads', false);
    try { st.win.focus(); } catch {}
  }

  async function removeDownload(id, trashFile) {
    const index = S.downloads.findIndex(download => download.id === id);
    if (index < 0) return true;
    const rec = S.downloads[index];
    if (trashFile && rec.path && fs.existsSync(rec.path)) {
      try { await shell.trashItem(rec.path); }
      catch (error) {
        rec.error = error.message || 'Could not delete the file';
        pendingDownloadDeletes.delete(id);
        profile.saveSoon();
        notifyDownloads();
        return { ok: false, error: rec.error };
      }
    }
    S.downloads.splice(index, 1);
    downloadItems.delete(id);
    pendingDownloadDeletes.delete(id);
    profile.saveSoon();
    notifyDownloads();
    return true;
  }

  function resolveDownloadDir() {
    // The settings value is user-editable and can point at a removed drive,
    // a file, or a path with no write access. Try it first, then fall back
    // so a bad folder can never turn every download into 'interrupted'.
    const configured = (S.settings && S.settings.downloadDir && String(S.settings.downloadDir)) || '';
    const candidates = [];
    if (configured) candidates.push(configured);
    try { candidates.push(app.getPath('downloads')); } catch {}
    candidates.push(os.homedir());
    for (const dir of candidates) {
      if (!dir) continue;
      try {
        fs.mkdirSync(dir, { recursive: true });
        if (fs.statSync(dir).isDirectory()) return dir;
      } catch {}
    }
    return configured || os.homedir();
  }

  function uniqueSavePath(dir, fileName) {
    // Chrome-style uniquification: never hand two downloads the same path.
    // Re-saving a common name used to overwrite / interrupt the transfer.
    let base = path.basename(String(fileName || '').trim() || 'download');
    base = base.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 180) || 'download';
    const ext = path.extname(base);
    const stem = path.basename(base, ext) || 'download';
    const taken = new Set(
      S.downloads.filter(d => d && d.active && d.path).map(d => d.path)
    );
    let candidate = path.join(dir, base);
    let n = 0;
    while ((fs.existsSync(candidate) || taken.has(candidate)) && n < 1000) {
      n += 1;
      candidate = path.join(dir, `${stem} (${n})${ext}`);
    }
    return candidate;
  }

  function setupDownloadHandling(targetSes) {
    const s = targetSes || ses;
    s.on('will-download', (e, item, initiatingWebContents) => {
      const dir = resolveDownloadDir();
      const savePath = uniqueSavePath(dir, item.getFilename());
      const fileName = path.basename(savePath);
      item.setSavePath(savePath);
      const rec = {
        id: 'd' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        fileName,
        path: savePath,
        url: item.getURL(),
        state: 'progressing',
        received: 0,
        total: 0,
        percent: 0,
        bytesPerSecond: 0,
        canResume: false,
        active: true,
        error: '',
        at: Date.now(),
      };
      S.downloads.unshift(rec);
      downloadItems.set(rec.id, item);
      showDownloads(initiatingWebContents);
      item.on('updated', (ev, state) => {
        rec.received = item.getReceivedBytes();
        rec.total = item.getTotalBytes();
        const percent = item.getPercentComplete();
        rec.percent = percent < 0 ? 0 : Math.max(0, Math.min(1, percent / 100));
        rec.bytesPerSecond = item.getCurrentBytesPerSecond() || 0;
        rec.canResume = item.canResume();
        if (state === 'interrupted') rec.state = 'interrupted';
        else if (rec.state === 'cancelled') rec.state = 'cancelled';
        else {
          rec.state = item.isPaused() ? 'paused' : 'progressing';
          rec.error = '';
        }
        rec.active = rec.state === 'progressing' || rec.state === 'paused' || (rec.state === 'interrupted' && rec.canResume);
        notifyDownloads();
      });
      item.on('done', (ev, state) => {
        downloadItems.delete(rec.id);
        rec.received = item.getReceivedBytes();
        rec.total = item.getTotalBytes();
        rec.percent = state === 'completed' ? 1 : rec.percent;
        rec.bytesPerSecond = 0;
        rec.canResume = false;
        rec.active = false;
        rec.state = state === 'completed' ? 'completed' : (state === 'cancelled' ? 'cancelled' : 'interrupted');
        if (state !== 'completed' && state !== 'cancelled' && !rec.error) {
          rec.error = 'Download was interrupted before it finished. You can retry it below.';
        }
        if (state === 'cancelled' && !rec.error) rec.error = '';
        if (pendingDownloadDeletes.has(rec.id)) {
          rec.state = 'cancelled';
          removeDownload(rec.id, true).catch(() => notifyDownloads());
          return;
        }
        profile.saveSoon();
        notifyDownloads();
      });
      profile.saveSoon();
      notifyDownloads();
    });
  }

  // ---------- context menus (page + links + text + extensions API surface) ----------
  // Dexerion-styled glass popup (a frameless transparent window): native OS
  // menus cannot be styled to match the UI.
  const ctxResolvers = new Map();
  const ctxWindows = new Set();
  // A context menu is a Dexerion window, not a page. The sheet that reports a
  // result lives in one of the registered context windows, so the sender has
  // to be one of them - otherwise any page on the web could guess an id and
  // resolve somebody else's menu (the id is a timestamp plus a 6-digit
  // random number, which is brute-forceable).
  function ctxSender(e) {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w) return false;
    // ctxWindows holds the context-menu BrowserWindows themselves.
    for (const cw of ctxWindows) if (cw === w) return true;
    // sugPopups is keyed by the Dexerion window id; its record carries the
    // popup window that reports the pick.
    for (const rec of sugPopups.values()) if (rec && rec.win === w) return true;
    return false;
  }
  ipcMain.handle('dex:ctx-result', (e, { id, index }) => {
    if (!ctxSender(e)) return 0;
    const r = ctxResolvers.get(id);
    if (r) { r(index); return 0; }
    // Click inside a suggest sheet.
    for (const [wid, rec] of sugPopups) {
      if (rec.id === id) {
        const st = windows.get(wid);
        const item = rec.items[index];
        closeSuggest(wid);
        if (st && item && index >= 0) navigateSuggestItem(st, item);
        return 0;
      }
    }
    return 0;
  });
  ipcMain.handle('dex:ctx-dismiss', (e) => {
    // Dismissing a menu is Dexerion UI work. The shell and the internal
    // pages ask for it (Escape, a blur, a suggestion closing), and so does
    // the menu window itself. A page on the web must not be able to
    // dismiss the menu the person is using.
    const k = chromeSender(e);
    const fromChrome = Boolean(k.st && (k.shell || k.internal));
    if (!fromChrome && !ctxSender(e)) return false;
    closeAllCtx();
    return true;
  });
  // Styled confirm (window.confirm is unreliable in internal-page
  // renderers — it can silently return false, deadlocking Remove buttons).
  ipcMain.handle('dex:confirm', async (e, { message } = {}) => {
    needChrome(e);
    const items = [
      { label: 'Confirm', danger: true, icon: '✓' },
      { label: 'Cancel', icon: '✕' },
    ];
    const pt = screen.getCursorScreenPoint();
    const idx = await popupMenu(items, { x: pt.x + 2, y: pt.y + 2 }, { width: 220 });
    return idx === 0;
  });
  function closeAllCtx() {
    for (const w of [...ctxWindows]) { try { w.destroy(); } catch {} }
    ctxWindows.clear();
    for (const wid of [...sugPopups.keys()]) closeSuggest(wid);
  }
  function closeSuggest(winId) {
    const rec = sugPopups.get(winId);
    if (!rec) return;
    sugPopups.delete(winId);
    try { rec.win.destroy(); } catch {}
  }
  function popupMenu(items, pt, opts = {}) {
    closeAllCtx();
    return new Promise((resolve) => {
      const id = 'ctx' + Date.now() + Math.floor(Math.random() * 1e6);
      const width = opts.width || 300;
      // Edge-to-edge sheet: the panel fills the window (body gutter 0, no
      // radius), so there is no exposed window surface anywhere. A floating
      // rounded panel needs per-pixel transparency, which this compositor
      // cannot do — the gutter and corners showed as raw white.
      // Chrome: the panel's own 5px padding + 1px borders (box-sizing is
      // border-box). Rows are 36px (see ctxmenu.html).
      let h = 12;
      for (const it of items) h += it.separator ? 9 : SUG_ROW_H;
      h = Math.min(h, (opts.maxHeight || 408) + 12);
      const area = screen.getDisplayNearestPoint({ x: pt.x, y: pt.y }).workArea;
      const x = Math.max(area.x, Math.min(pt.x, area.x + area.width - width - 8));
      const y = Math.max(area.y, Math.min(pt.y, area.y + area.height - h - 8));
      const win = new BrowserWindow({
        width, height: h, x, y: Math.round(y), frame: false, transparent: false,
        // Opaque on purpose (same reason as openSuggestWin): this compositor
        // leaves a transparent window's raw surface visible as white, which
        // showed as ugly borders around the rounded panel. The sheet panel
        // below fills the window edge-to-edge in the theme color.
        backgroundColor: (S.settings.theme || 'dark') === 'light' ? '#f6f6f4' : '#171614',
        alwaysOnTop: true, skipTaskbar: true, resizable: false, show: false,
        hasShadow: false, icon: APP_ICON, autoHideMenuBar: true,
        webPreferences: {
          preload: path.join(__dirname, '../../preload.js'),
          contextIsolation: true, nodeIntegration: false, sandbox: true,
        },
      });
      let settled = false;
      const done = (v) => {
        if (settled) return; settled = true;
        ctxResolvers.delete(id);
        ctxWindows.delete(win);
        try { win.destroy(); } catch {}
        resolve(v);
      };
      ctxResolvers.set(id, done);
      ctxWindows.add(win);
      win.once('blur', () => { if (!opts.stickyFocus) done(null); });
      win.webContents.once('did-finish-load', () => {
        win.webContents.send('dex:ctx-data', {
          id, items, variant: 'sheet',
          theme: S.settings.theme || 'light',
          accent: S.settings.accent || '#35c4ff',
        });
        if (opts.inactive) win.showInactive(); else win.show();
      });
      // A menu whose page never loads must never linger as an invisible
      // window (holding the app alive windowless) or park its promise.
      win.webContents.once('did-fail-load', () => done(null));
      win.loadFile(path.join(__dirname, '../renderer/ctxmenu.html'));
    });
  }
  // Builds the page context menu. Split out from showing it so the menu can be
  // inspected (and its actions driven) without a real right-click.
  function contextMenuFor(winId, tabId, wc, p) {
    const st = windows.get(winId); if (!st) return null;
    const items = [];
    const actions = [];
    const add = (label, fn, o = {}) => { items.push({ label, icon: o.icon, kbd: o.kbd, disabled: o.disabled, danger: o.danger, actionIdx: actions.length }); actions.push(fn); };
    const sep = () => items.push({ separator: true });
    if (p.linkURL) {
      add('Open link in new tab', () => newTab(winId, p.linkURL, true), { icon: '＋' });
      add('Open link in new window', () => newWindow([p.linkURL]), { icon: '❐' });
      add('Copy link address', () => require('electron').clipboard.writeText(p.linkURL), { icon: '⧉' });
      sep();
    }
    if (p.hasImageContents) {
      add('Save image as…', () => wc.downloadURL(p.srcURL), { icon: '⤓' });
      add('Copy image address', () => require('electron').clipboard.writeText(p.srcURL), { icon: '⧉' });
      sep();
    }
    if (p.selectionText) {
      add('Copy', () => wc.copy(), { icon: '⧉', kbd: 'Ctrl C' });
      add(`Search Dexerion for “${p.selectionText.slice(0, 32)}”`, () => newTab(winId, resolveInput(p.selectionText), false), { icon: '⌕' });
      add('Ask Dexerion AI about selection', () => stashAiPrompt(winId, { kind: 'selection', text: String(p.selectionText || '') }), { icon: '✦' });
      sep();
    } else {
      add('Ask Dexerion AI about this page', () => stashAiPrompt(winId, { kind: 'page', text: '' }), { icon: '✦' });
    }
    add('Back', () => wc.goBack(), { icon: '←', disabled: !wc.navigationHistory.canGoBack() });
    add('Forward', () => wc.goForward(), { icon: '→', disabled: !wc.navigationHistory.canGoForward() });
    add('Reload', () => wc.reload(), { icon: '↻', kbd: 'Ctrl R' });
    sep();
    add('Save page as…', () => wc.downloadURL(wc.getURL()), { icon: '⤓' });
    add('Print…', () => wc.print(), { icon: '🖨' });
    sep();
    // Chromium's DevTools, framed by Dexerion (see the inspector section above).
    add('Inspect element', () => openInspector(winId, tabId, p.x, p.y), { icon: '⌗', kbd: 'F12' });
    // Note: extension-contributed chrome.contextMenus entries are not shown
    // in this custom menu (see EXTENSIONS.md limitations).
    return { items, actions };
  }
  function showContextMenu(winId, tabId, wc, p) {
    const built = contextMenuFor(winId, tabId, wc, p);
    if (!built) return;
    const { items, actions } = built;
    const pt = screen.getCursorScreenPoint();
    popupMenu(items, { x: pt.x + 2, y: pt.y + 2 }).then((idx) => {
      if (idx == null || idx < 0) return;
      const item = items[idx];
      if (item && !item.separator && !item.disabled && actions[item.actionIdx]) {
        try { actions[item.actionIdx](); } catch {}
      }
    });
  }

  // ---------- state sync to shell ----------
  function accountPublic(id) {
    const m = getAccountMeta(id) || { id, name: id, color: '#35c4ff' };
    return {
      id: m.id, name: m.name, email: m.email || '', color: m.color || '#35c4ff',
      googleEmail: m.googleEmail || '', activeEmail: m.activeEmail || '',
      avatar: m.avatar ? 'dexerion://avatar/' + m.id : '',
    };
  }
  function serial(winId) {
    const st = windows.get(winId);
    if (!st) return null;
    const A = accData(st.accountId);
    const active = st.active;
    return {
      winId, active,
      memNotice: st.memNotice ? { ...st.memNotice } : null,
      account: accountPublic(st.accountId),
      accounts: listAccounts().map(a => accountPublic(a.id)),
      defaultAccountId: S.defaultAccountId || 'default',
      tabs: st.order.map(id => {
        const t = st.tabs.get(id);
        const wc = t.view && t.view.webContents;
        let canBack = false, canForward = false;
        try { canBack = wc.navigationHistory.canGoBack(); canForward = wc.navigationHistory.canGoForward(); } catch {}
        return { id, title: t.title, url: t.url, loading: t.loading, favicon: t.favicon, canBack, canForward, groupId: t.groupId || null, sleeping: Boolean(t.sleeping) };
      }),
      groups: [...st.groups.values()],
      bookmarks: A.bookmarks,
      bookmarksBar: S.settings.showBookmarksBar,
      ui: {
        theme: S.settings.theme || 'light',
        accent: S.settings.accent || '#35c4ff',
        verticalTabs: true,
        skin: uiSkin(),
        // The inspector's geometry travels with the state so the shell's header
        // bar lands exactly on the panel the main process laid out.
        inspector: (() => {
          const r = inspectorRect(st);
          if (!r) return null;
          const ins = st.inspector;
          return { dock: r.dock, header: r.header, host: inspectorHost(st), fallback: Boolean(ins && ins.fallback), reason: (ins && ins.reason) || '' };
        })(),
      },
      extensions: extensions.records().map(r => ({ id: extensions.displayId(r), name: r.name, version: r.version, description: r.description, enabled: r.enabled, unpacked: r.unpacked, loadError: r.loadError })),
       downloads: S.downloads.slice(0, 20),
       aiOpen: Boolean(st.aiOpen),
       pomodoro: pomodoro.state(),
       pomoAudio: st.id === lastAudioWin,
       tasks: tasksPublic(st.accountId),
     };
  }
  function pushState(winId) {
    const st = windows.get(winId); if (!st) return;
    st.win.webContents.send('dex:state', serial(winId));
  }
  function broadcast(ch, ...args) {
    for (const st of windows.values()) st.win.webContents.send(ch, ...args);
  }
  // The theme and the accent are chrome-wide, so every renderer that paints
  // them has to hear about a change - not just the shell. The shell gets the
  // full state through pushState(), but the internal pages live in tab views
  // and were never told: switching the theme in Settings repainted Settings
  // and left every other open page on the old one. This sends the two values
  // the pages actually use.
  function broadcastUiTheme() {
    const theme = S.settings.theme || 'dark';
    const accent = S.settings.accent || '#35c4ff';
    for (const st of windows.values()) {
      for (const t of st.tabs.values()) {
        if (!t || !t.view) continue;
        try { t.view.webContents.send('dex:ui-theme', { theme, accent }); } catch {}
      }
    }
  }

  // ---------- persistence / session restore ----------
  // A window closed a moment ago is usually part of a quit: menu Quit, "X" on
  // each window, or a WM_CLOSE sweep all close every window back-to-back. Its
  // row stays in the saved session until the burst settles, so relaunching
  // restores every window. A window closed deliberately (the app keeps
  // running) drops out of the session once CLOSE_GRACE_MS passes with no
  // further closes. Without this, a multi-window quit saved only the last
  // window closed — every other window was silently dropped from the session.
  const CLOSE_GRACE_MS = 5000;
  const pendingRows = new Map(); // winId -> row of a window closed within the grace
  let lastRowWids = [];          // winId order of the rows written last (row order = window order)
  let shrinkTimer = null;
  function snapshotRow(st) {
    // The daily welcome is disposable: it never comes back as a restored tab.
    const keep = st.order.filter(id => {
      const t = st.tabs.get(id);
      return t && !/^dexerion:\/\/welcome/i.test(String(t.url || ''));
    });
    return {
      accountId: st.accountId,
      activeIndex: Math.max(0, keep.indexOf(st.active)),
      tabs: keep.map(id => { const t = st.tabs.get(id); return { url: t.url, title: t.title, groupId: t.groupId || null }; }),
      groups: [...st.groups.values()],
    };
  }
  function scheduleSessionShrink() {
    if (shrinkTimer) clearTimeout(shrinkTimer);
    shrinkTimer = setTimeout(() => {
      shrinkTimer = null;
      // Never write an empty session (darwin keeps running windowless): the
      // last saved rows survive until a window exists again.
      if (!windows.size) return;
      pendingRows.clear();
      try { persistAll(); } catch {}
    }, CLOSE_GRACE_MS);
  }
  function persistAll() {
    // Preview windows (?skin=…) are inspection surfaces, not browsing — saving
    // them would push four copies of the demo tabs into the user's session.
    const live = [...windows.values()].filter(st => !st.preview);
    const liveById = new Map(live.map(st => [st.id, st]));
    // Rows keep their previous order; windows closed within the grace keep
    // their old row so a close burst can't shrink the saved session mid-quit.
    const wids = lastRowWids.filter(id => liveById.has(id) || pendingRows.has(id));
    for (const st of live) if (!wids.includes(st.id)) wids.push(st.id);
    for (const id of pendingRows.keys()) if (!wids.includes(id)) wids.push(id);
    S.tabs.windows = wids.map(id => (liveById.has(id) ? snapshotRow(liveById.get(id)) : pendingRows.get(id)));
    lastRowWids = wids;
    flushAccounts();
    profile.save();
  }
  // Hang fix: persistAll() does ~17 synchronous JSON disk writes on the main
  // thread (all accounts + all profile files, history up to 5000 entries). Hot
  // paths (tab close, drag/group ops) called it per gesture, so rapid gestures
  // blocked the event loop long enough for Windows to flag Not Responding.
  // Debounce those paths; quit paths (win 'close', flushOnQuit) keep the
  // synchronous persistAll so the session is never lost on exit.
  let persistTimer = null;
  function persistSoon() {
    if (persistTimer) return;
    persistTimer = setTimeout(() => { persistTimer = null; try { persistAll(); } catch {} }, 800);
  }
  // Hang fix: resize + rail/chrome-measure IPCs fire many times per second and
  // each layout() walks every tab calling native setBounds. Coalesce to one
  // layout per tick; geometry callers that need it now keep calling layout().
  const layoutPending = new Set();
  function layoutSoon(winId) {
    if (layoutPending.has(winId)) return;
    layoutPending.add(winId);
    setImmediate(() => { layoutPending.delete(winId); try { layout(winId); } catch {} });
  }
  function restoreSessionOrNewTab(opts = {}) {
    // The welcome goes to the FIRST window and only once its shell is up —
    // by then the restored tabs exist, so "a lone newtab becomes the welcome"
    // sees the real tab list instead of racing the deferred creation.
    const welcome = () => { if (!opts.noWelcome) maybeOpenWelcome(); };
    const wins = S.settings.restoreSession ? S.tabs.windows : [];
    const valid = (wins || []).filter(w => w.tabs && w.tabs.length);
    if (!valid.length) {
      newWindow(undefined, S.defaultAccountId || 'default', null, { onReady: welcome });
      return;
    }
    let first = true;
    for (const w of valid.slice(0, 10)) {
      // Skip windows whose account was deleted.
      const aid = (w.accountId && getAccountMeta(w.accountId)) ? w.accountId : (S.defaultAccountId || 'default');
      // activeIndex has to be forwarded: newWindow() honours it when deciding
      // which tab to activate, so omitting it made every restored session come
      // back on whichever tab happened to finish activating last.
      newWindow(null, aid, { tabs: w.tabs.slice(0, 50), groups: w.groups, activeIndex: w.activeIndex },
        first ? { onReady: welcome } : {});
      first = false;
    }
  }

  // One quiet hello per launch: after the session is up, the welcome page
  // opens as the active tab — every time Dexerion starts (a window restore
  // from minimized is not a start), and "Welcome to Dexerion" on the first
  // launch ever. Real launches only: previews, the selftest and the e2e
  // harness (DEX_AI_TEST) never see it, and a link/file launch skips it in
  // main.js — the user asked for that destination, not a greeting.
  function maybeOpenWelcome() {
    if (process.env.DEX_AI_TEST === '1') return false;
    if (S.settings.welcomeDaily === false) return false;
    const firstRun = S.settings.welcomeFirstRunDone !== true;
    S.settings.welcomeFirstRunDone = true;
    try { profile.saveSoon(); } catch {}
    const st = focusedState();
    if (!st) return false;
    const url = 'dexerion://welcome' + (firstRun ? '?first=1' : '');
    // A fresh start's lone new tab becomes the welcome; otherwise a new tab.
    if (st.order.length === 1) {
      const only = st.tabs.get(st.order[0]);
      if (only && only.view && /^dexerion:\/\/newtab/i.test(String(only.url || ''))) {
        try {
          only.url = url;
          only.title = 'Welcome — Dexerion';
          only.loading = true;
          only.view.webContents.loadURL(url).catch(() => {});
          pushState(st.id);
          return true;
        } catch {}
      }
    }
    newTab(st.id, url, false);
    return true;
  }

  // ---------- IPC ----------
  // Sender trust: the shell and dexerion:// pages are privileged ("chrome").
  // Ordinary https pages can only navigate their OWN tab; everything else
  // (history, bookmarks, extensions, settings, other tabs) is denied.
  function chromeSender(e) {
    const wc = e.sender;
    for (const st of windows.values()) {
      if (st.win.webContents === wc) return { st, shell: true, internal: true, tab: null };
      for (const [id, t] of st.tabs) {
        if (!t.view) continue;
        if (t.view.webContents === wc) {
          const internal = (wc.getURL() || '').startsWith('dexerion://');
          return { st, shell: false, internal, tab: id };
        }
      }
    }
    // The snip overlay is Dexerion UI hosted as a child view of its window.
    for (const [wid, rec] of snipState) {
      if (rec.view && !rec.view.webContents.isDestroyed() && rec.view.webContents === wc) {
        const st = windows.get(wid);
        if (st) return { st, shell: false, internal: true, tab: null, snip: true };
      }
    }
    // The report viewer is Dexerion UI too: its own × and "open in tab"
    // buttons talk back through the same bridge as every internal page.
    for (const [wid, rec] of reportOverlayState) {
      if (rec.view && !rec.view.webContents.isDestroyed() && rec.view.webContents === wc) {
        const st = windows.get(wid);
        if (st) return { st, shell: false, internal: true, tab: null, reportOverlay: true };
      }
    }
    // The Focus preview (site overlay) is Dexerion UI too. Without this branch
    // every IPC from it is denied, so its artifact lookup fails and the preview
    // shows "No artifact found" even though the site exists.
    for (const [wid, rec] of siteOverlayState) {
      if (rec.view && !rec.view.webContents.isDestroyed() && rec.view.webContents === wc) {
        const st = windows.get(wid);
        if (st) return { st, shell: false, internal: true, tab: null, siteOverlay: true };
      }
    }
    // The inspector's own fallback panel is Dexerion UI (not Chromium's DevTools
    // surface), so it may read state like any internal page. The DevTools host
    // window is deliberately NOT registered: that document is Chromium's.
    for (const [win, winId] of inspectorWindows) {
      if (!win.isDestroyed() && win.webContents === wc) {
        const st = windows.get(winId);
        if (st) return { st, shell: false, internal: true, tab: null, panel: true };
      }
    }
    return { st: null, shell: false, internal: false, tab: null };
  }
  function needChrome(e) {
    const k = chromeSender(e);
    if (!k.st || (!k.shell && !k.internal)) throw new Error('denied');
    return k;
  }
  ipcMain.handle('dex:new-tab', (e, url, background) => {
    const { st } = needChrome(e); return newTab(st.id, url || 'dexerion://newtab', background);
  });
  // Report viewer: the chat card (and the report page itself) open/close the
  // in-window overlay that sits on top of the current tab, beside the chat.
  ipcMain.handle('dex:report-overlay-open', (e, payload) => {
    const { st } = needChrome(e);
    const chatId = String((payload && payload.chatId) || '');
    const raw = Number(payload && payload.index);
    // The card's notes chip (V18) opens the viewer with a feature panel ready;
    // only the three real panel names ride through.
    const panel = ['notes', 'toc', 'search'].includes(String(payload && payload.panel || ''))
      ? String(payload.panel) : '';
    return openReportOverlay(st, chatId, Number.isInteger(raw) ? raw : -1, panel);
  });
  ipcMain.handle('dex:report-overlay-close', (e) => {
    const { st } = needChrome(e);
    return closeReportOverlay(st);
  });
  // Focus preview for served websites (the card's "Preview" action).
  ipcMain.handle('dex:site-overlay-open', (e, payload) => {
    const { st } = needChrome(e);
    const chatId = String((payload && payload.chatId) || '');
    const raw = Number(payload && payload.index);
    return openSiteOverlay(st, chatId, Number.isInteger(raw) ? raw : -1);
  });
  ipcMain.handle('dex:site-overlay-close', (e) => {
    const { st } = needChrome(e);
    return closeSiteOverlay(st);
  });
  // Restore a previously opened site preview overlay from saved state
  // (chatId + index), so a person can reopen the preview they had open.
  ipcMain.handle('dex:site-overlay-restore', (e) => {
    const { st } = needChrome(e);
    const rec = siteOverlayState.get(st.id);
    if (!rec) return { ok: false, error: 'No saved preview to restore.' };
    return openSiteOverlay(st, rec.chatId || '', rec.index || -1);
  });
  // Fullscreen for previews: the overlay covers the whole window (and the
  // window maximizes), then restores the old window bounds on the way out.
  ipcMain.handle('dex:overlay-fullscreen', (e, payload) => {
    const { st } = needChrome(e);
    const kind = String((payload && payload.kind) || '');
    const rec = kind === 'site' ? siteOverlayState.get(st.id)
      : kind === 'report' ? reportOverlayState.get(st.id) : null;
    if (!rec || !rec.view || rec.view.webContents.isDestroyed()) {
      return { ok: false, error: 'No preview is open.' };
    }
    const next = payload && typeof payload.fullscreen === 'boolean'
      ? payload.fullscreen : !rec.fullscreen;
    if (next === rec.fullscreen) {
      // A redundant toggle still replays state (e.g. after a reload).
      broadcastOverlayFullscreen(st, rec);
      return { ok: true, fullscreen: rec.fullscreen };
    }
    if (next) {
      rec.priorBounds = st.win.getBounds();
      rec.priorMaximized = st.win.isMaximized();
      rec.fullscreen = true;
      try { st.win.maximize(); } catch {}
    } else {
      exitOverlayFullscreen(st, rec); // broadcasts false on the way out
    }
    // Maximize can settle asynchronously on Windows; layout()/the resize event
    // correct this, but set it now so the change is immediate.
    try { rec.view.setBounds(overlayViewBounds(st, rec)); } catch {}
    broadcastOverlayFullscreen(st, rec);
    return { ok: true, fullscreen: rec.fullscreen };
  });
  ipcMain.handle('dex:overlay-fullscreen-state', (e, payload) => {
    const { st } = needChrome(e);
    const kind = String((payload && payload.kind) || '');
    const rec = kind === 'site' ? siteOverlayState.get(st.id)
      : kind === 'report' ? reportOverlayState.get(st.id) : null;
    return !!(rec && rec.fullscreen);
  });
  ipcMain.handle('dex:close-tab', (e, tabId) => { const { st } = needChrome(e); closeTab(st.id, tabId || st.active); });
  ipcMain.handle('dex:activate-tab', (e, tabId) => { const { st } = needChrome(e); activateTab(st.id, tabId); });
  ipcMain.handle('dex:reorder-tab', (e, tabId, toIndex) => {
    const { st } = needChrome(e);
    st.order = st.order.filter(x => x !== tabId);
    st.order.splice(Math.max(0, Math.min(toIndex, st.order.length)), 0, tabId);
    pushState(st.id);
  });
  ipcMain.handle('dex:duplicate-tab', (e, tabId) => { const { st } = needChrome(e); duplicateTab(st.id, tabId || st.active); });
  ipcMain.handle('dex:reopen-closed', (e) => { const { st } = needChrome(e); return reopenClosed(st.id); });
  // ---------- tab groups (drag one tab onto another, rename, recolor) ----------
  const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
  function newGroupId(st) {
    let gid;
    do { gid = 'g' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36); }
    while (st.groups.has(gid));
    return gid;
  }
  function sweepGroups(st) {
    const used = new Set();
    for (const id of st.order) { const t = st.tabs.get(id); if (t && t.groupId) used.add(t.groupId); }
    for (const gid of [...st.groups.keys()]) if (!used.has(gid)) st.groups.delete(gid);
  }
  // A group is ONE contiguous run in the strip (one chip, never split). Every
  // move below is normalised against these runs, so dragging a tab around can
  // never leave half a group behind.
  function groupRuns(st, order) {
    const runs = [];
    for (let i = 0; i < order.length; i++) {
      const t = st.tabs.get(order[i]);
      const gid = t && t.groupId ? t.groupId : null;
      if (!gid) continue;
      const last = runs[runs.length - 1];
      if (last && last.gid === gid && last.end === i) last.end = i + 1;
      else runs.push({ gid, start: i, end: i + 1 });
    }
    return runs;
  }
  // Reorder `id` before/after `targetId`. A null target means the tab was
  // dropped on the empty strip: it parks at the end AND leaves its group — that
  // gesture is how you pull a tab out of a group.
  function moveTab(st, id, targetId, side) {
    const order = st.order;
    const from = order.indexOf(id);
    if (from < 0) return false;
    if (targetId === id) return true;
    let idx = order.length;
    if (targetId) {
      const ti = order.indexOf(targetId);
      if (ti < 0) return false;
      idx = ti + (side === 'after' ? 1 : 0);
    }
    order.splice(from, 1);
    if (idx > from) idx -= 1;
    const dragged = st.tabs.get(id);
    if (!targetId) dragged.groupId = null;
    const runs = groupRuns(st, order);
    if (dragged.groupId) {
      const own = runs.find(r => r.gid === dragged.groupId);
      // Inside its own run = a reorder within the group. Anywhere else it leaves
      // the group (Chrome behaviour) rather than splitting it in two.
      if (!own || idx < own.start || idx > own.end) dragged.groupId = null;
    }
    if (!dragged.groupId) {
      // Landing strictly inside another group's run snaps to its nearer edge.
      const hit = runs.find(r => r.start < idx && idx < r.end);
      if (hit) idx = (idx - hit.start <= hit.end - idx) ? hit.start : hit.end;
    }
    idx = Math.max(0, Math.min(order.length, idx));
    order.splice(idx, 0, id);
    sweepGroups(st);
    pushState(st.id);
    persistSoon();
    return true;
  }
  // Park a tab at the end of its group's run so joining never splits the run.
  function settleInGroup(st, id, gid) {
    const order = st.order;
    const from = order.indexOf(id);
    if (from >= 0) order.splice(from, 1);
    const run = groupRuns(st, order).find(r => r.gid === gid);
    const at = run ? run.end : order.length;
    order.splice(Math.max(0, Math.min(order.length, at)), 0, id);
  }
  // Join `tabId` to `targetTabId`'s group (creating one if needed).
  function groupPair(st, tabId, targetTabId) {
    if (!tabId || !targetTabId || tabId === targetTabId) return false;
    const a = st.tabs.get(tabId), b = st.tabs.get(targetTabId);
    if (!a || !b) return false;
    if (a.groupId && a.groupId === b.groupId) return true;
    let gid = b.groupId && st.groups.has(b.groupId) ? b.groupId : null;
    if (!gid) {
      gid = newGroupId(st);
      st.groups.set(gid, { id: gid, name: '', color: GROUP_COLORS[st.groups.size % GROUP_COLORS.length] });
      b.groupId = gid;
    }
    a.groupId = gid;
    settleInGroup(st, tabId, gid);
    sweepGroups(st);
    pushState(st.id);
    persistSoon();
    return true;
  }
  ipcMain.handle('dex:tab-group', (e, tabId, targetTabId) => {
    const { st } = needChrome(e);
    return groupPair(st, tabId, targetTabId);
  });
  // Drop tabId onto a group chip.
  ipcMain.handle('dex:group-add', (e, tabId, groupId) => {
    const { st } = needChrome(e);
    const t = st.tabs.get(tabId);
    if (!t || !groupId || !st.groups.has(groupId)) return false;
    t.groupId = groupId;
    settleInGroup(st, tabId, groupId);
    sweepGroups(st);
    pushState(st.id);
    persistSoon();
    return true;
  });
  ipcMain.handle('dex:tab-ungroup', (e, tabId) => {
    const { st } = needChrome(e);
    const t = st.tabs.get(tabId || st.active);
    if (!t || !t.groupId) return false;
    t.groupId = null;
    sweepGroups(st);
    pushState(st.id);
    persistSoon();
    return true;
  });
  // The single drag-and-drop entry point: 'center' joins the target's group,
  // 'before' / 'after' reorder (leaving a group when dragged out of its run).
  ipcMain.handle('dex:tab-drop', (e, draggedId, targetId, where) => {
    const { st } = needChrome(e);
    if (!draggedId || !st.tabs.has(draggedId)) return false;
    if (where === 'center' && targetId && targetId !== draggedId) return groupPair(st, draggedId, targetId);
    return moveTab(st, draggedId, targetId, where === 'after' ? 'after' : 'before');
  });
  ipcMain.handle('dex:group-set', (e, groupId, patch = {}) => {
    const { st } = needChrome(e);
    const g = st.groups.get(groupId);
    if (!g) return false;
    if (typeof patch.name === 'string') g.name = patch.name.slice(0, 40);
    if (typeof patch.color === 'string' && GROUP_COLORS.includes(patch.color)) g.color = patch.color;
    pushState(st.id);
    persistSoon();
    return true;
  });
  ipcMain.handle('dex:group-close', (e, groupId) => {
    const { st } = needChrome(e);
    if (!st.groups.has(groupId)) return false;
    for (const id of [...st.order]) {
      const t = st.tabs.get(id);
      if (t && t.groupId === groupId) closeTab(st.id, id);
    }
    sweepGroups(st);
    pushState(st.id);
    return true;
  });
  ipcMain.handle('dex:navigate', (e, tabId, input) => {
    const k = chromeSender(e); if (!k.st) return;
    closeAllCtx();
    // Untrusted pages may only navigate their own tab (equivalent to
    // window.location, which they already have). Shell/internal may target any.
    const target = (k.shell || k.internal) ? (tabId || senderTabId(e) || k.st.active) : k.tab;
    const t = k.st.tabs.get(target); if (!t) return;
    if (!t.view) wakeTab(k.st.id, target); // navigating a slept tab wakes it first
    if (!t.view) return;
    // A direct navigation supersedes both lazy and slept state.
    t.lazy = false; t.sleeping = false; delete t.pendingUrl;
    // Navigating a lazily restored tab retires the pending URL first.
    if (t.lazy) { t.lazy = false; delete t.pendingUrl; t.loading = true; }
    t.view.webContents.loadURL(resolveInput(input)).catch(() => {});
  });
  ipcMain.handle('dex:nav', (e, tabId, action) => {
    const { st } = needChrome(e); const t = st.tabs.get(tabId || st.active); if (!t) return;
    const wasSleeping = !t.view;
    if (wasSleeping) wakeTab(st.id, t.id);
    if (!t.view) return;
    const wc = t.view.webContents;
    if (action === 'back' && !wasSleeping && wc.navigationHistory.canGoBack()) wc.goBack();
    if (action === 'forward' && !wasSleeping && wc.navigationHistory.canGoForward()) wc.goForward();
    if (action === 'reload') (wasSleeping ? wc.loadURL(t.url).catch(() => {}) : wc.reload());
    if (action === 'hard-reload') wc.reloadIgnoringCache();
    if (action === 'stop') wc.stop();
  });
  ipcMain.handle('dex:new-window', (e, url) => { needChrome(e); return newWindow(url ? [resolveInput(url)] : undefined); });
  ipcMain.handle('dex:omnibox-suggest', (e, q) => { const { A } = Aof(e); return suggest(A, q); });
  // Suggestions as an Edge-style attached sheet: full-width dropdown under
  // the toolbar — first row searches what you typed, then history/bookmark
  // matches, then live search-engine completions. Arrow keys + Enter work.
  const sugPopups = new Map(); // winId -> { win, id, items }
  // Row/padding metrics must match ctxmenu.html: items are 36px tall and the
  // sheet window adds the panel's 5px padding + 1px borders (12px). The sheet
  // panel is edge-to-edge (no body gutter), so the window is sized for an
  // exact fit — any slack would expose bare window surface as a pale strip.
  // Sizing from a stale 34px clipped the last row.
  const SUG_ROW_H = 36, SUG_SHEET_PAD = 12, SUG_SHEET_MAX = 380;
  function sugWindowHeight(n) { return Math.min(n * SUG_ROW_H + SUG_SHEET_PAD, SUG_SHEET_MAX); }
  function suggestGeometry(st, anchor) {
    const c = st.win.getContentBounds();
    if (anchor && typeof anchor.x === 'number') {
      // Page-anchored (e.g. new-tab search box): position under the input
      // the request came from, clamped to the content area.
      const w = Math.max(280, Math.min(anchor.width || 420, c.width - 32));
      const x = Math.max(c.x + 8, Math.min(anchor.x, c.x + c.width - w - 8));
      return { x: Math.round(x), y: Math.round(anchor.y), width: Math.round(w) };
    }
    const left = railW(st);
    return {
      x: Math.round(c.x + left),
      y: Math.round(c.y + chromeH(st) - 2),
      width: Math.max(320, Math.round(c.width - left)),
    };
  }
  function sugPacket(id, items) {
    return {
      id, items, variant: 'sheet', sel: 0,
      theme: S.settings.theme || 'light',
      accent: S.settings.accent || '#35c4ff',
    };
  }
  // A rail resize slides the page (and the shell's omnibox) sideways while an
  // open suggest popup would stay parked at its old screen rect. Re-anchor it
  // from the stored reference so it tracks its input instead of displacing.
  function repositionSuggest(st) {
    const rec = sugPopups.get(st.id);
    if (!rec || !rec.win || rec.win.isDestroyed()) return;
    try {
      const c = st.win.getContentBounds();
      let a = rec.anchor;
      if (rec.anchorPage && rec.anchorTab) {
        const t = st.tabs.get(rec.anchorTab);
        const b = t && t.view && t.view.getBounds();
        if (!b) return;
        a = {
          x: Math.round(c.x + b.x + rec.anchorPage.x),
          y: Math.round(c.y + b.y + rec.anchorPage.y),
          width: rec.anchorPage.width,
        };
      } else if (rec.anchorShell && a) {
        const d = (st.railW || 0) - (rec.railW || 0);
        if (!d) return;
        a = { x: Math.round(a.x + d), y: a.y, width: a.width };
      } else return;
      rec.anchor = a;
      rec.railW = st.railW;
      const g = suggestGeometry(st, a);
      const h = rec.win.getBounds().height;
      rec.win.setBounds({ ...g, height: h });
    } catch {}
  }
  async function engineCompletions(query, engineOverride) {
    const eng = engineOverride || S.settings.searchEngine;
    const q = encodeURIComponent(query);
    const urls = {
      google: `https://suggestqueries.google.com/complete/search?client=chrome&q=${q}`,
      bing: `https://api.bing.com/osjson.aspx?query=${q}`,
      duckduckgo: `https://duckduckgo.com/ac/?q=${q}`,
    };
    const u = urls[eng];
    if (!u) return [];
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 1500);
      const r = await fetch(u, { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
      clearTimeout(t);
      if (!r.ok) return [];
      const j = await r.json();
      if (Array.isArray(j) && Array.isArray(j[1])) return j[1].filter(x => typeof x === 'string');
      if (Array.isArray(j)) return j.map(x => (x && x.phrase) || x).filter(x => typeof x === 'string');
    } catch {}
    return [];
  }
  function buildSuggestLocal(e, q, maxRows) {
    const { A } = Aof(e);
    const query = String(q || '').trim();
    if (!query) return [];
    const cap = maxRows || 10;
    const out = [{ label: query, sub: 'Search', icon: '⌕', kind: 'search', phrase: query }];
    const seen = new Set([query.toLowerCase()]);
    const lq = query.toLowerCase();
    // Hang fix: this runs on the main thread per keystroke. History caps at
    // 5000 entries and the old loop lowercased every entry on a miss, so fast
    // typing blocked the event loop. Most-recent 500 still covers what users
    // expect from suggestions while bounding the work to a constant.
    const recent = A.history.length > 500 ? A.history.slice(0, 500) : A.history;
    for (const h of recent) {
      if (out.length >= Math.min(5, cap)) break;
      if (((h.title || '') + ' ' + h.url).toLowerCase().includes(lq) && !seen.has(h.url)) {
        seen.add(h.url);
        out.push({ label: h.title || h.url, sub: h.url, icon: '◷', kind: 'goto', url: h.url });
      }
    }
    for (const b of Object.values(A.bookmarks.roots).flat()) {
      if (out.length >= Math.min(6, cap)) break;
      if (((b.title || '') + ' ' + b.url).toLowerCase().includes(lq) && !seen.has(b.url)) {
        seen.add(b.url);
        out.push({ label: b.title || b.url, sub: b.url, icon: '★', kind: 'goto', url: b.url });
      }
    }
    return out.slice(0, cap);
  }
  async function enrichSuggestions(local, q, maxRows) {
    const query = String(q || '').trim();
    if (!query) return local;
    const cap = maxRows || 10;
    const out = [...local];
    const seen = new Set(out.map(x => (x.kind === 'goto' ? x.url : x.label).toLowerCase()));
    const lq = query.toLowerCase();
    try {
      const comps = await engineCompletions(query);
      for (const c of comps) {
        if (out.length >= cap) break;
        if (!seen.has(String(c).toLowerCase())) {
          seen.add(String(c).toLowerCase());
          const boldFrom = String(c).toLowerCase().startsWith(lq) ? query.length : null;
          out.push({ label: String(c), sub: '', icon: '⌕', kind: 'search', phrase: String(c), boldFrom });
        }
      }
    } catch {}
    return out.slice(0, cap);
  }
  function navigateSuggestItem(st, item) {
    const t = st.tabs.get(st.active);
    if (!t || !item) return;
    const url = item.kind === 'goto' ? item.url : resolveInput(item.phrase || item.label);
    t.view.webContents.loadURL(url).catch(() => {});
  }
  function openSuggestWin(st, id, items, anchor) {
    const g = suggestGeometry(st, anchor);
    const h = sugWindowHeight(items.length);
    const win = new BrowserWindow({
      width: g.width, height: h, x: g.x, y: g.y,
      // Opaque (not transparent): on this machine the compositor leaves raw
      // window surface visible as a pale frame, so transparency is a
      // liability here. The sheet panel is edge-to-edge and the window paint
      // is the theme color, leaving nowhere for white to come from.
      frame: false, transparent: false, alwaysOnTop: true, skipTaskbar: true,
      backgroundColor: (S.settings.theme || 'dark') === 'light' ? '#f6f6f4' : '#171614',
      resizable: false, show: false, hasShadow: false, icon: APP_ICON, autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '../../preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
      },
    });
    win.webContents.once('did-finish-load', () => {
      const rec = sugPopups.get(st.id);
      if (!rec || rec.win !== win) { try { win.destroy(); } catch {} return; }
      win.webContents.send('dex:ctx-data', sugPacket(id, rec.items));
      win.showInactive();
    });
    win.on('closed', () => {
      const rec = sugPopups.get(st.id);
      if (rec && rec.win === win) sugPopups.delete(st.id);
    });
    win.loadFile(path.join(__dirname, '../renderer/ctxmenu.html'));
    return win;
  }
  ipcMain.handle('dex:suggest-show', async (e, q, opts = {}) => {
    const k = chromeSender(e);
    if (!k.st || (!k.shell && !k.internal)) throw new Error('denied');
    const st = k.st;
    // Phase 1: local results (typed query + history/bookmarks) render
    // immediately — engine completions must never delay first paint.
    const items = buildSuggestLocal(e, q, opts.max);
    if (!items.length) { closeSuggest(st.id); return []; }
    // Page-anchored requests (new-tab search box): convert the input's
    // page-viewport rect to screen coords via the sending tab's bounds.
    let anchor = null;
    if (opts.anchor && k.tab) {
      try {
        const t = st.tabs.get(k.tab);
        const c = st.win.getContentBounds();
        const b = t.view.getBounds();
        anchor = {
          x: c.x + b.x + opts.anchor.x,
          y: c.y + b.y + opts.anchor.y,
          width: opts.anchor.width,
        };
      } catch {}
    } else if (opts.anchor && k.shell) {
      // Shell omnibox: its rect is already in window-content coords (the
      // shell fills the content view), so only the window origin is added.
      try {
        const c = st.win.getContentBounds();
        anchor = {
          x: c.x + opts.anchor.x,
          y: c.y + opts.anchor.y,
          width: opts.anchor.width,
        };
      } catch {}
    }
    let rec = sugPopups.get(st.id);
    if (rec && !rec.win.isDestroyed()) {
      rec.items = items;
      rec.anchor = anchor;
      rec.anchorTab = (opts.anchor && k.tab) || null;
      rec.anchorPage = (opts.anchor && k.tab)
        ? { x: opts.anchor.x, y: opts.anchor.y, width: opts.anchor.width } : null;
      rec.anchorShell = Boolean(opts.anchor && !k.tab && k.shell);
      rec.railW = st.railW;
      const g = suggestGeometry(st, anchor);
      try { rec.win.setBounds({ ...g, height: sugWindowHeight(items.length) }); } catch {}
      try { rec.win.webContents.send('dex:ctx-data', sugPacket(rec.id, items)); } catch {}
    } else {
      closeSuggest(st.id);
      const id = 'sug' + Date.now() + Math.floor(Math.random() * 1e6);
      const win = openSuggestWin(st, id, items, anchor);
      sugPopups.set(st.id, {
        win, id, items, anchor,
        anchorTab: (opts.anchor && k.tab) || null,
        anchorPage: (opts.anchor && k.tab)
          ? { x: opts.anchor.x, y: opts.anchor.y, width: opts.anchor.width } : null,
        anchorShell: Boolean(opts.anchor && !k.tab && k.shell),
        railW: st.railW,
      });
    }
    // Phase 2 (async): enrich with engine completions when they arrive.
    const winIdAtEnrich = st.id;
    // Reuse phase 1's exact rows: nothing awaits between the two phases, and
    // enrichment copies the array before appending. Avoid scanning local data twice.
    const localForEnrichment = process.env.DEX_SUGGEST_RESCAN === '1'
      ? buildSuggestLocal(e, q, opts.max) : items;
    enrichSuggestions(localForEnrichment, q, opts.max).then(full => {
      const r2 = sugPopups.get(winIdAtEnrich);
      if (!r2 || r2.win.isDestroyed() || !full.length) return;
      r2.items = full;
      try { r2.win.setBounds({ ...suggestGeometry(st, r2.anchor), height: sugWindowHeight(full.length) }); } catch {}
      try { r2.win.webContents.send('dex:ctx-data', sugPacket(r2.id, full)); } catch {}
    }).catch(() => {});
    return items;
  });
  ipcMain.handle('dex:suggest-select', (e, idx) => {
    const { st } = needChrome(e);
    const rec = sugPopups.get(st.id);
    if (rec && !rec.win.isDestroyed()) {
      try { rec.win.webContents.send('dex:ctx-select', idx); } catch {}
    }
    return true;
  });
  ipcMain.handle('dex:suggest-pick', (e, idx) => {
    const { st } = needChrome(e);
    const rec = sugPopups.get(st.id);
    const item = rec && rec.items[idx >= 0 ? idx : 0];
    closeSuggest(st.id);
    return item || null;
  });
  ipcMain.handle('dex:get-state', (e) => { const { st } = needChrome(e); return serial(st.id); });
  // Shell reports its measured chrome height so tab content never slides
  // under the toolbar/bookmark bar (works at any window size or zoom).
  ipcMain.handle('dex:chrome-h', (e, h) => {
    const { st } = needChrome(e);
    h = Math.round(Number(h));
    if (h >= 40 && h <= 600 && st.chromeH !== h) {
      st.chromeH = h;
      layoutSoon(st.id);
    }
    return true;
  });
  // ...and its rail width, for the same reason: the shell is the only thing that
  // knows how wide the vertical rail actually is.
  ipcMain.handle('dex:rail-w', (e, w) => {
    const { st } = needChrome(e);
    w = Math.round(Number(w));
    if (w >= 40 && w <= 640 && st.railW !== w) {
      st.railW = w;
      layoutSoon(st.id);
      repositionSuggest(st);
    }
    return true;
  });

  // bookmarks (per account)
  function Aof(e) {
    const { st } = needChrome(e);
    const A = accData(st.accountId);
    if (!Array.isArray(A.chats)) A.chats = [];
    if (!Array.isArray(A.memory)) A.memory = [];
    if (!Array.isArray(A.recipes)) A.recipes = [];
    if (!Array.isArray(A.tasks)) A.tasks = [];
    if (!Array.isArray(A.missions)) A.missions = [];
    if (!Array.isArray(A.projects)) A.projects = [];
    return { st, A };
  }

  // The difficulty preference is per account (rework 3.11): the chips write
  // it, the search pipeline and any tier-aware stream read it. The scout owns
  // which model a tier maps to; this is only the tier name.
  const AI_DIFFICULTIES = ['low', 'medium', 'high', 'max'];
  function difficultyOf(A) {
    const value = String((A && A.aiDifficulty) || '');
    return AI_DIFFICULTIES.includes(value) ? value : 'medium';
  }

  // Page-reading prefs (Phase 1: read-only scAI extract process). Stored per
  // account alongside chats/memory and persisted via saveAcc on change —
  // never optimistic-UI-only.
  function pagePrefs(A) {
    const p = (A && A.aiPage && typeof A.aiPage === 'object') ? A.aiPage : {};
    return {
      usePage: p.usePage === true,
      fullPage: p.fullPage === true, // scAI default: article text, not the whole document
      contextChars: Math.max(1000, Math.min(60000, parseInt(p.contextChars, 10) || 12000)),
      useSelection: p.useSelection !== false,
    };
  }
  // ---------- per-site AI off ----------
  // Hostnames where the person turned the assistant off. Reading, acting and
  // page context all refuse there; the list is stored per account.
  function siteHost(url) {
    try { return new URL(String(url || '')).hostname.toLowerCase(); } catch { return ''; }
  }
  function aiOffSites(A) {
    if (!Array.isArray(A.aiOffSites)) A.aiOffSites = [];
    return A.aiOffSites;
  }
  function siteAiOff(A, url) {
    const host = siteHost(url);
    return host ? aiOffSites(A).includes(host) : false;
  }
  function setSiteAiOff(A, host, off) {
    const clean = String(host || '').toLowerCase().replace(/[^a-z0-9.-]/g, '').slice(0, 120);
    if (!clean) return aiOffSites(A).slice();
    const list = aiOffSites(A).filter((item) => item !== clean);
    if (off) list.unshift(clean);
    A.aiOffSites = list.slice(0, 200);
    return A.aiOffSites;
  }
  // The active tab's live URL, for the site switch. Falls back to the stored
  // tab URL when the view is gone or the getter throws mid-navigation.
  function activeTabUrl(st) {
    try {
      const tab = st.tabs.get(st.active);
      const wc = tab && tab.view && tab.view.webContents;
      return (wc && !wc.isDestroyed() ? wc.getURL() : '') || (tab && tab.url) || '';
    } catch { return ''; }
  }
  // Context blocks (page) ride on a COPY of the last user message
  // for the model only — never into the stored chat or the memory learner.
  function injectContexts(safeMessages, pageContext) {
    if (typeof pageContext !== 'string' || !pageContext) return safeMessages;
    const joined = pageContext.slice(0, 60000);
    let lastUser = -1;
    for (let i = safeMessages.length - 1; i >= 0; i--) {
      if (safeMessages[i] && safeMessages[i].role === 'user') { lastUser = i; break; }
    }
    if (lastUser < 0) return safeMessages;
    return safeMessages.map((m, i) => i === lastUser
      ? { ...m, text: String(m.text || '') + '\n\n' + joined }
      : m);
  }

  function chatSummary(chat) {
    const messages = Array.isArray(chat.messages) ? chat.messages : [];
    return { id: chat.id, title: chat.title || 'New chat', createdAt: chat.createdAt, updatedAt: chat.updatedAt, messageCount: messages.length };
  }

  function chatFor(A, id) {
    const chat = Array.isArray(A.chats) ? A.chats.find(item => item.id === id) : null;
    if (chat && !Array.isArray(chat.messages)) chat.messages = [];
    return chat || null;
  }
  // Chat storage for one window: the account's saved list normally, or a
  // per-window in-memory list when "Save conversations on this device" is off.
  // Handlers call persist()/notify() so the switch cannot be bypassed by one
  // forgotten saveAcc.
  function chatStore(st, A) {
    if (aiUiPrefs(A).saveChats !== false) {
      if (!Array.isArray(A.chats)) A.chats = [];
      return {
        list: A.chats,
        find: (id) => chatFor(A, String(id || '')),
        persist: () => saveAcc(st.accountId),
        notify: () => broadcastChats(st.accountId),
      };
    }
    if (!Array.isArray(st.aiSessionChats)) st.aiSessionChats = [];
    const list = st.aiSessionChats;
    return {
      list,
      find: (id) => {
        const key = String(id || '');
        let chat = list.find((item) => item.id === key) || null;
        if (!chat) {
          // Continuing a previously saved chat after the switch went off:
          // adopt a copy into the session list so the open conversation keeps
          // working, and nothing new reaches the profile.
          const saved = Array.isArray(A.chats) ? A.chats.find((item) => item.id === key) : null;
          if (saved) {
            chat = JSON.parse(JSON.stringify(saved));
            list.unshift(chat);
          }
        }
        if (chat && !Array.isArray(chat.messages)) chat.messages = [];
        return chat;
      },
      persist: () => {},
      notify: () => broadcastChats(st.accountId),
    };
  }

  function newChat(title) {
    const now = Date.now();
    return { id: 'c' + now.toString(36) + Math.random().toString(36).slice(2, 7), title: String(title || 'New chat').slice(0, 80), createdAt: now, updatedAt: now, messages: [] };
  }

  function cleanChatMessage(message) {
    const role = message && message.role === 'model' ? 'model' : 'user';
    const text = String((message && message.text) || '').slice(0, 20000);
    const images = Array.isArray(message && message.images) ? message.images.slice(0, 4).map(image => ({
      name: String((image && image.name) || 'image').slice(0, 160),
      url: String((image && image.url) || '').slice(0, 5000000),
    })).filter(image => /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.url)) : [];
    // Structured artifacts are validated at the persistence boundary. The
    // renderer never trusts saved chat data; it re-checks the shape too. A
    // rejected artifact is dropped, but the reply text still saves.
    let artifact = null;
    if (message && message.artifact && typeof message.artifact === 'object') {
      const checked = aiArtifacts.normalizeArtifact(message.artifact);
      if (checked.ok) artifact = checked.artifact;
    }
    if (!text && !images.length && !artifact) throw new Error('A chat message cannot be empty.');
    // Page context attached by the read-page toggle (Phase 1). Capped like
    // text so one long page cannot bloat the stored chat; the chip in the
    // sidebar renders label and reveals text on click.
    let context = null;
    if (message && message.context && typeof message.context.text === 'string' && message.context.text) {
      context = {
        kind: message.context.kind === 'selection' ? 'selection' : 'page',
        label: String(message.context.label || 'Page').slice(0, 200),
        text: String(message.context.text).slice(0, 60000),
      };
    }
    const clean = { id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), role, text, images, createdAt: Date.now() };
    if (message && typeof message.model === 'string' && message.model.trim()) {
      clean.model = message.model.trim().slice(0, 160);
    }
    if (artifact) clean.artifact = artifact;
    if (context) clean.context = context;
    // Search runs keep their provenance on the message: the adapted queries and
    // the pages actually read. Validated here so a stored chat can never inject
    // a javascript: URL or an unbounded list into a renderer.
    if (message && message.search && typeof message.search === 'object') {
      const adaptations = Array.isArray(message.search.adaptations)
        ? message.search.adaptations.filter(q => typeof q === 'string' && q.trim()).slice(0, 6).map(q => q.slice(0, 160))
        : [];
      const sources = Array.isArray(message.search.sources)
        ? message.search.sources.filter(s => s && /^https?:\/\//i.test(String(s.url || ''))).slice(0, 16).map(s => ({
            title: String(s.title || '').slice(0, 200),
            url: String(s.url || '').slice(0, 2048),
          }))
        : [];
      const stats = message.search.stats && typeof message.search.stats === 'object'
        ? {
            sources: Number(message.search.stats.sources) || sources.length,
            adaptations: Number(message.search.stats.adaptations) || adaptations.length,
            ms: Number(message.search.stats.ms) || 0,
            blocked: Boolean(message.search.stats.blocked),
          }
        : null;
      if (adaptations.length || sources.length) clean.search = { adaptations, sources, stats };
    }
    // Token usage for the reply meta line (best effort: endpoints that send
    // no usage simply show nothing).
    if (message && message.usage && typeof message.usage === 'object') {
      const inp = parseInt(message.usage.input_tokens, 10), out = parseInt(message.usage.output_tokens, 10);
      if (Number.isFinite(inp) || Number.isFinite(out)) {
        clean.usage = {};
        if (Number.isFinite(inp)) clean.usage.input_tokens = inp;
        if (Number.isFinite(out)) clean.usage.output_tokens = out;
      }
    }
    // Interactive progress kept with the artifact (quiz answers, known cards).
    if (message && message.artifact && message.artifactState) {
      const state = aiArtifacts.normalizeArtifactState(message.artifactState);
      if (state) clean.artifactState = state;
    }
    // Stream metrics for the reply footer ("1.2s to first token, 42 c/s").
    // Numbers only, bounded, and never a prompt or reply body.
    if (message && message.metrics && typeof message.metrics === 'object') {
      const m = message.metrics;
      const num = (v, hi) => {
        const n = Math.round(Number(v));
        return Number.isFinite(n) && n >= 0 ? Math.min(n, hi) : null;
      };
      const metrics = {
        ms: num(m.ms, 3600000),
        firstTokenMs: num(m.firstTokenMs, 3600000),
        deltas: num(m.deltas, 1000000),
        chars: num(m.chars, 10000000),
        thinkingChars: num(m.thinkingChars, 10000000),
        charsPerSec: num(m.charsPerSec, 1000000),
      };
      if (Object.values(metrics).some((v) => v !== null)) {
        clean.metrics = metrics;
      }
    }
    // The model's reasoning channel (collapsible "Thinking" in the thread).
    // Hidden by default; capped so a stored chat can never bloat on it.
    if (message && typeof message.thinking === 'string' && message.thinking.trim()) {
      clean.thinking = message.thinking.trim().slice(0, 4000);
    }
    // A run that stopped short says so, so reopening the chat still offers the
    // way to carry on.
    if (message && message.partial === true) {
      clean.partial = true;
      if (Array.isArray(message.remaining) && message.remaining.length) {
        clean.remaining = message.remaining.slice(0, 5).map(s => String(s || '').slice(0, 200)).filter(Boolean);
      }
    }
    // Agent step trace (Phase 2/3). Deliberately without `args`: typed text
    // can be a password, and the trace is for reading, not replaying.
    if (message && Array.isArray(message.steps) && message.steps.length) {
      clean.steps = message.steps.slice(0, 200).map(s => ({
        n: Math.max(0, parseInt(s && s.n, 10) || 0),
        name: String((s && s.name) || '').slice(0, 40),
        what: String((s && s.what) || '').slice(0, 200),
        status: ['ok', 'bad', 'asked', 'live'].includes(s && s.status) ? s.status : 'ok',
        detail: String((s && s.detail) || '').slice(0, 4000),
      }));
    }
    // Plan checklist recorded with the run (update_plan), kept for reload.
    if (message && message.plan && Array.isArray(message.plan.steps) && message.plan.steps.length) {
      const plan = missionPlan(message.plan);
      if (plan) clean.plan = plan;
    }
    return clean;
  }

  function broadcastChats(accountId) {
    for (const st of windows.values()) {
      if (st.accountId !== accountId || st.win.isDestroyed()) continue;
      try { st.win.webContents.send('dex:ai-chats-updated', accountId); } catch {}
    }
  }

  ipcMain.handle('dex:ai-sidebar', (e, open) => {
    const { st } = needChrome(e);
    st.aiOpen = open === undefined ? !st.aiOpen : Boolean(open);
    layout(st.id);
    return st.aiOpen;
  });
  ipcMain.handle('dex:ai-open', (e) => {
    const { st } = needChrome(e);
    st.aiOpen = true;
    layout(st.id);
    st.win.webContents.send('dex:ai-open');
    return true;
  });
  // One command for the toolbar button, the Ctrl+Shift+A accelerator and the
  // menu: opens or closes and tells the panel which way it went.
  ipcMain.handle('dex:ai-toggle', (e) => {
    const { st } = needChrome(e);
    st.aiOpen = !st.aiOpen;
    layout(st.id);
    try { st.win.webContents.send(st.aiOpen ? 'dex:ai-open' : 'dex:ai-close'); } catch {}
    return st.aiOpen;
  });
  ipcMain.handle('dex:ai-chats-list', (e) => {
    const { st, A } = Aof(e);
    return chatStore(st, A).list.slice().sort((a, b) => b.updatedAt - a.updatedAt).map(chatSummary);
  });
  ipcMain.handle('dex:ai-chat-open', (e, id) => {
    const { st, A } = Aof(e);
    const chat = chatStore(st, A).find(id);
    if (!chat) throw new Error('Chat not found.');
    return chat;
  });
  ipcMain.handle('dex:ai-chat-create', (e, { title } = {}) => {
    const { st, A } = Aof(e);
    const store = chatStore(st, A);
    const chat = newChat(title);
    store.list.unshift(chat);
    store.persist();
    store.notify();
    return chat;
  });
  ipcMain.handle('dex:ai-chat-rename', (e, { id, title } = {}) => {
    const { st, A } = Aof(e);
    const store = chatStore(st, A);
    const chat = store.find(id);
    if (!chat) throw new Error('Chat not found.');
    const name = String(title || '').trim().slice(0, 80);
    if (!name) throw new Error('Give the chat a name.');
    chat.title = name;
    chat.updatedAt = Date.now();
    store.persist();
    store.notify();
    return chatSummary(chat);
  });
  ipcMain.handle('dex:ai-chat-clear', (e, id) => {
    const { st, A } = Aof(e);
    const cid = String(id || '');
    const store = chatStore(st, A);
    const chat = store.find(cid);
    if (!chat) throw new Error('Chat not found.');
    for (const winState of windows.values()) {
      if (winState.aiRequestChatId === cid) {
        ai.cancel(winState.aiRequestId);
        winState.aiRequestId = null;
        winState.aiRequestChatId = null;
      }
    }
    chat.messages = [];
    chat.updatedAt = Date.now();
    store.persist();
    store.notify();
    return chat;
  });
  ipcMain.handle('dex:ai-chat-delete', (e, id) => {
    const { st, A } = Aof(e);
    const cid = String(id || '');
    const store = chatStore(st, A);
    const index = store.list.findIndex(chat => chat.id === cid);
    if (index < 0) return false;
    for (const winState of windows.values()) {
      if (winState.aiRequestChatId === cid) {
        ai.cancel(winState.aiRequestId);
        winState.aiRequestId = null;
        winState.aiRequestChatId = null;
      }
    }
    store.list.splice(index, 1);
    store.persist();
    store.notify();
    return true;
  });
  ipcMain.handle('dex:ai-chats-clear', (e) => {
    const { st, A } = Aof(e);
    for (const winState of windows.values()) {
      if (winState.accountId === st.accountId && winState.aiRequestChatId) {
        ai.cancel(winState.aiRequestId);
        winState.aiRequestId = null;
        winState.aiRequestChatId = null;
      }
    }
    if (st.agentRunId) agentRef().stopRun(st.agentRunId, 'stopped');
    const store = chatStore(st, A);
    store.list.length = 0;
    store.persist();
    store.notify();
    return true;
  });
  ipcMain.handle('dex:ai-chat-append', (e, { id, message } = {}) => {
    const { st, A } = Aof(e);
    const store = chatStore(st, A);
    const chat = store.find(id);
    if (!chat) throw new Error('Chat not found.');
    const next = cleanChatMessage(message);
    if (next.role === 'user' && chat.messages.length === 0 && !chat.titleEdited) {
      chat.title = next.text.replace(/\s+/g, ' ').trim().slice(0, 48) || 'Image chat';
    }
    chat.messages.push(next);
    chat.updatedAt = Date.now();
    // Memory hygiene: image bytes (base64, MBs each) accumulate across long
    // chats. Keep them only on the most recent messages — older ones keep
    // their text, which is all the model needs for context.
    if (chat.messages.length > 6) {
      for (const m of chat.messages.slice(0, -6)) {
        if (m && Array.isArray(m.images) && m.images.length) m.images = [];
      }
    }
    store.persist();
    store.notify();
    return chat;
  });
  // Dedicated report generation for the versioned report programme and the
  // AI-search "turn findings into a report" handoff. Reports are a separate
  // product from websites: a compact report-only system prompt carries the
  // four-per-version quality rules, and the result is stored as a normal chat
  // message so the existing report viewer/preview works unchanged.
  // Reports are self-contained offline documents: the internal-page CSP allows
  // data:/blob: imagery but never http(s). Images therefore have to be embedded
  // at generation time — the renderer must never fetch a runtime URL.
  async function prepareReportImageEvidence(brief, context) {
    try {
      let sources = [];
      let researchText = '';
      try {
        const parsed = JSON.parse(String(context || ''));
        if (parsed && typeof parsed === 'object') {
          sources = Array.isArray(parsed.sources) ? parsed.sources : [];
          researchText = String(parsed.answer || parsed.text || '').slice(0, 6000);
          for (const s of (Array.isArray(parsed.searches) ? parsed.searches : [])) {
            if (s && Array.isArray(s.sources)) sources = sources.concat(s.sources);
          }
        }
      } catch { /* context is usually plain prose, not JSON */ }
      const candidates = siteResearchAssets.collectResearchCandidates({ userText: brief, researchText, sources })
        .slice(0, siteResearchAssets.MAX_ASSETS);
      if (!candidates.length) return { evidence: '', assets: [] };
      const fetched = await siteResearchAssets.fetchSiteAssets(candidates, {
        fetchBinary: fetchSiteAssetBinary,
        timeoutMs: 4000,
      });
      if (!fetched.assets.length) return { evidence: '', assets: [] };
      return {
        evidence: '\n\n' + siteResearchAssets.reportResearchEvidenceBlock(fetched.assets, { text: researchText }),
        assets: fetched.assets,
      };
    } catch (e) {
      return { evidence: '', assets: [] };
    }
  }

  async function inlineReportImages(artifact, assets) {
    const blocks = artifact && Array.isArray(artifact.blocks) ? artifact.blocks : [];
    if (!blocks.length) return { warnings: [] };
    const byId = new Map((Array.isArray(assets) ? assets : []).map((a) => [String(a.id || '').toLowerCase(), a]));
    const warnings = [];
    for (const b of blocks) {
      if (!b || b.type !== 'image') continue;
      const src = String(b.src || '');
      let asset = /^dexref[1-4]$/i.test(src) ? byId.get(src.toLowerCase()) : null;
      if (!asset && /^https?:\/\//i.test(src)) {
        try {
          const fetched = await siteResearchAssets.fetchSiteAssets([{ url: src }], {
            fetchBinary: fetchSiteAssetBinary,
            timeoutMs: 4000,
          });
          asset = fetched.assets[0] || null;
        } catch { /* handled by the neutral placeholder below */ }
      }
      if (asset && asset.dataUrl) {
        b.src = asset.dataUrl;
        const credit = String(asset.credit || '').trim();
        if (credit && !String(b.caption || '').includes(credit)) {
          b.caption = String(b.caption || '').trim() + (b.caption ? ' · ' : '') + credit;
        }
      } else if (!/^data:image\//i.test(src)) {
        b.src = siteResearchAssets.SAFE_SVG_DATA_URL;
        warnings.push('An image could not be embedded offline; showing a neutral placeholder.');
      }
    }
    return { warnings: warnings.slice(0, 4) };
  }

  ipcMain.handle('dex:ai-report-generate', async (e, { reqId, prompt, version, context } = {}) => {
    const { st, A } = Aof(e);
    const id = String(reqId || ('rpt' + Date.now().toString(36)));
    const brief = String(prompt || '').trim().slice(0, 12000);
    if (!brief) return { ok: false, error: 'Give the report a brief first.' };
    if (!ai.status().hasKey) return { ok: false, error: 'Connect Dexerion AI first.' };
    const requested = Number(version);
    const v = Number.isInteger(requested) && requested >= 1
      ? Math.min(reportVersions.REPORT_GENERATOR_VERSION, requested)
      : reportVersions.activeVersion();
    const imagePrep = await prepareReportImageEvidence(brief, context);
    const sys = reportSystemPrompt(v, context) + imagePrep.evidence;
    try {
      const out = await ai.streamReport(id, brief, () => {}, {
        memory: A.memory,
        difficulty: difficultyOf(A),
        systemOverride: sys,
      });
      if (out.cancelled) return { ok: false, reqId: id, error: 'Report generation was stopped.' };
      if (!out.artifact || out.artifact.kind !== 'report') {
        return { ok: false, reqId: id, error: out.artifactError || out.error || 'No usable report was returned. Try again.' };
      }
      const imageInfo = await inlineReportImages(out.artifact, imagePrep.assets);
      // Persist as a fresh chat: the user's brief, then the model's report.
      const store = chatStore(st, A);
      const chat = newChat(brief.replace(/\s+/g, ' ').trim().slice(0, 48) || 'Report');
      store.list.unshift(chat);
      chat.messages.push(cleanChatMessage({ role: 'user', text: brief }));
      chat.messages.push(cleanChatMessage({
        role: 'model', text: out.text || '', artifact: out.artifact, model: out.model,
      }));
      chat.updatedAt = Date.now();
      store.persist();
      store.notify();
      return {
        ok: true, reqId: id, artifact: out.artifact, chatId: chat.id,
        index: chat.messages.length - 1, version: v,
        usage: out.usage || null,
        warnings: (out.artifactWarnings || []).concat(imageInfo.warnings || []),
        repaired: Boolean(out.reportRepaired),
      };
    } catch (err) {
      return { ok: false, reqId: id, error: String(err && err.message || err) };
    }
  });
  // Report generator version for the E2E harness and diagnostics. The harness
  // pins a version via %TEMP%\dex-report-version; normal users get the newest.
  ipcMain.handle('dex:report-version', (e) => {
    needChrome(e);
    return {
      version: reportVersions.activeVersion(),
      latest: reportVersions.REPORT_GENERATOR_VERSION,
    };
  });
  // The report preset gallery (name, one-line description, shape text). The
  // renderer shows these in the composer; the model never sees the whole list.
  ipcMain.handle('dex:ai-presets', (e) => {
    needChrome(e);
    return reportPresets.REPORT_PRESETS;
  });
  // Report look controls: theme/paper/pattern/font are closed sets, re-checked
  // here so a corrupted renderer cannot store arbitrary CSS names. The report
  // body itself is untouched.
  ipcMain.handle('dex:ai-artifact-look', (e, { chatId, index, look } = {}) => {
    const { st, A } = Aof(e);
    const store = chatStore(st, A);
    const chat = store.find(String(chatId || ''));
    if (!chat) throw new Error('Chat not found.');
    const at = Number(index);
    const message = Number.isInteger(at) ? chat.messages[at] : null;
    if (!message || !message.artifact || message.artifact.kind !== 'report') {
      throw new Error('Report not found.');
    }
    const p = (look && typeof look === 'object') ? look : {};
    const pick = (value, list, fallback) => (list.includes(String(value || '')) ? String(value) : fallback);
    const art = JSON.parse(JSON.stringify(message.artifact));
    if (p.theme !== undefined) art.theme = pick(p.theme, aiArtifacts.REPORT_THEMES, art.theme);
    if (p.paper !== undefined) art.paper = pick(p.paper, aiArtifacts.REPORT_PAPERS, art.paper);
    if (p.pattern !== undefined) art.pattern = pick(p.pattern, aiArtifacts.REPORT_PATTERNS, art.pattern);
    if (p.font !== undefined) art.font = pick(p.font, aiArtifacts.REPORT_FONTS, art.font);
    message.artifact = art;
    chat.updatedAt = Date.now();
    store.persist();
    store.notify();
    return { ok: true, artifact: art };
  });
  // Persist report-level meta (annotations, versions, conditions, dependencies,
  // dynamicData, toc, searchable) merged into the stored artifact. Used by the
  // report page so notes, version records and data sources survive reopen.
  ipcMain.handle('dex:ai-artifact-patch', (e, { chatId, index, patch } = {}) => {
    const { st, A } = Aof(e);
    const store = chatStore(st, A);
    const chat = store.find(String(chatId || ''));
    if (!chat) throw new Error('Chat not found.');
    const at = Number(index);
    const message = Number.isInteger(at) ? chat.messages[at] : null;
    if (!message || !message.artifact || message.artifact.kind !== 'report') {
      throw new Error('Report not found.');
    }
    const allowed = ['annotations', 'versions', 'conditions', 'dependencies', 'dynamicData', 'toc', 'searchable'];
    // Meta from the viewer is user data: run it through the same normalizers
    // as a fresh artifact, or an oversized/hand-edited patch persists past
    // every bound the model paths honour (V20 polish pass).
    const normalizers = {
      annotations: (v) => (Array.isArray(v) ? v : []).slice(0, aiArtifacts.LIMITS.annotations).map(aiArtifacts.normalizeAnnotation).filter(Boolean),
      versions: (v) => (Array.isArray(v) ? v : []).slice(0, aiArtifacts.LIMITS.versions).map(aiArtifacts.normalizeVersion).filter(Boolean),
      conditions: (v) => (Array.isArray(v) ? v : []).slice(0, aiArtifacts.LIMITS.conditions).map(aiArtifacts.normalizeCondition).filter(Boolean),
      dependencies: (v) => (Array.isArray(v) ? v : []).slice(0, aiArtifacts.LIMITS.dependencies).map(aiArtifacts.normalizeDependency).filter(Boolean),
      dynamicData: (v) => (Array.isArray(v) ? v : []).slice(0, aiArtifacts.LIMITS.dynamicData).map(aiArtifacts.normalizeDynamicData).filter(Boolean),
    };
    const art = message.artifact;
    for (const key of allowed) {
      if (patch && typeof patch === 'object' && key in patch) art[key] = normalizers[key] ? normalizers[key](patch[key]) : patch[key];
    }
    art.updatedAt = Date.now();
    chat.updatedAt = Date.now();
    store.persist();
    store.notify();
    return { ok: true, artifact: art };
  });
  // Live source edit: rewrite a site artifact's files (or its single html) from
  // the Code panel and keep the previous version so the edit can be undone.
  // The new source goes through the same validator as a fresh artifact, so bad
  // paths and oversized files are rejected here rather than in the preview.
  ipcMain.handle('dex:ai-artifact-source-save', (e, payload) => {
    const { st, A } = Aof(e);
    const store = chatStore(st, A);
    const p = (payload && typeof payload === 'object') ? payload : {};
    const chat = store.find(String(p.chatId || ''));
    if (!chat) throw new Error('Chat not found.');
    const at = Number(p.index);
    const message = Number.isInteger(at) ? chat.messages[at] : null;
    if (!message || !message.artifact) throw new Error('Artifact not found.');
    const edit = artifactEdit.applySourceEdit(message.artifact, p);
    if (!edit.ok) return edit;
    message.artifact = edit.artifact;
    message.editedAt = Date.now();
    chat.updatedAt = Date.now();
    store.persist();
    store.notify();
    return { ok: true, artifact: edit.artifact, version: edit.artifact.version, warnings: edit.warnings };
  });

  // Direct report editing: one block text field, edited in place in the
  // reader. Same store, same history stack, same persistence as every other
  // artifact save — never optimistic (the response carries the new artifact).
  ipcMain.handle('dex:ai-report-edit', (e, payload) => {
    const { st, A } = Aof(e);
    const store = chatStore(st, A);
    const p = (payload && typeof payload === 'object') ? payload : {};
    const chat = store.find(String(p.chatId || ''));
    if (!chat) throw new Error('Chat not found.');
    const at = Number(p.index);
    const message = Number.isInteger(at) ? chat.messages[at] : null;
    if (!message || !message.artifact) throw new Error('Artifact not found.');
    const edit = artifactEdit.applyReportEdit(message.artifact, p);
    if (!edit.ok) return edit;
    message.artifact = edit.artifact;
    message.editedAt = Date.now();
    chat.updatedAt = Date.now();
    store.persist();
    store.notify();
    return { ok: true, artifact: edit.artifact, version: edit.artifact.version, warnings: edit.warnings };
  });

  // Undo: swap the artifact back to a snapshot from its history.
  ipcMain.handle('dex:ai-artifact-restore', (e, payload) => {
    const { st, A } = Aof(e);
    const store = chatStore(st, A);
    const p = (payload && typeof payload === 'object') ? payload : {};
    const chat = store.find(String(p.chatId || ''));
    if (!chat) throw new Error('Chat not found.');
    const at = Number(p.index);
    const message = Number.isInteger(at) ? chat.messages[at] : null;
    if (!message || !message.artifact) throw new Error('Artifact not found.');
    const undo = artifactEdit.restoreVersion(message.artifact, p.at);
    if (!undo.ok) return undo;
    message.artifact = undo.artifact;
    chat.updatedAt = Date.now();
    store.persist();
    store.notify();
    return { ok: true, artifact: undo.artifact, versions: undo.artifact.history.length };
  });

  // Quiz/flashcard progress: the person's answers, stored beside the artifact
  // so reopening a chat lands where they left off. Bounded by the validator.
  ipcMain.handle('dex:ai-artifact-state-set', (e, payload) => {
    const { st, A } = Aof(e);
    const store = chatStore(st, A);
    const p = (payload && typeof payload === 'object') ? payload : {};
    const chat = store.find(String(p.chatId || ''));
    if (!chat) return { ok: false, error: 'Chat not found.' };
    const at = Number(p.index);
    const message = Number.isInteger(at) ? chat.messages[at] : null;
    if (!message || !message.artifact) return { ok: false, error: 'Artifact not found.' };
    const state = aiArtifacts.normalizeArtifactState(p.state);
    if (!state) {
      delete message.artifactState;
    } else {
      message.artifactState = state;
    }
    store.persist();
    return { ok: true };
  });

  // Standalone HTML for any artifact kind. The renderer uses this for the
  // Download action and for "open this outside Dexerion": the bytes are a
  // complete document (report, site, quiz, deck, chart or timeline) that runs
  // offline with no app runtime.
  ipcMain.handle('dex:ai-artifact-html', (e, payload) => {
    Aof(e);
    const p = (payload && typeof payload === 'object') ? payload : {};
    const checked = aiArtifacts.normalizeArtifact(p.artifact);
    if (!checked.ok) return { ok: false, error: checked.error || 'The artifact could not be read.' };
    try {
      let artifact = checked.artifact;
      const warnings = [];
      if (artifact.kind === 'site' && p.page && Array.isArray(artifact.files) && artifact.files.length) {
        // "Download HTML" on a served site exports the page on screen: build
        // that page's single-file form from the file set (styles/scripts
        // inlined, exactly like the entry export).
        const built = aiArtifacts.assembleSiteDocument(artifact.files, warnings, String(p.page));
        if (built.error) return { ok: false, error: built.error };
        artifact = Object.assign({}, artifact, { html: built.html });
      }
      return {
        ok: true,
        kind: artifact.kind,
        title: artifact.title,
        page: artifact.kind === 'site' ? String(p.page || '') : '',
        html: artifactHtml.artifactHtml(artifact),
        warnings,
      };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  // "Save PDF" for one served page: the artifact viewer's Print button and
  // the card's Download PDF both land here.
  ipcMain.handle('dex:ai-site-pdf', async (e, payload) => {
    const { st } = Aof(e);
    const p = (payload && typeof payload === 'object') ? payload : {};
    const checked = aiArtifacts.normalizeArtifact(p.artifact);
    if (!checked.ok || checked.artifact.kind !== 'site') {
      return { ok: false, error: 'Only websites can be printed this way.' };
    }
    const page = String(p.page || '')
      || (Array.isArray(checked.artifact.pages) && checked.artifact.pages[0])
      || 'index.html';
    const printed = await printSitePages(checked.artifact, [page]);
    if (!printed.length) return { ok: false, error: 'The page could not be printed.' };
    let target = (process.env.DEX_AI_TEST === '1' && typeof p.path === 'string') ? p.path : '';
    if (!target) {
      const result = await dialog.showSaveDialog(st.win, {
        title: 'Save PDF',
        defaultPath: pdfNameFor(page),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      target = result.filePath;
    }
    try {
      await fs.promises.writeFile(target, printed[0].buffer);
      return { ok: true, path: target, bytes: printed[0].buffer.length, page };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  // Serves a website preview from the in-memory dexsite:// registry. The
  // renderer gets back a real origin to point the frame at (multi-page
  // navigation, storage, modules, fetch of the site's own files) instead of a
  // flattened srcdoc document. Registration is content-addressed, so the same
  // files keep the same host (and its localStorage) across re-renders.
  ipcMain.handle('dex:ai-site-serve', (e, payload) => {
    const { st } = Aof(e);
    const p = (payload && typeof payload === 'object') ? payload : {};
    const checked = aiArtifacts.normalizeArtifact(p.artifact);
    if (!checked.ok) return { ok: false, error: checked.error || 'The artifact could not be read.' };
    if (checked.artifact.kind !== 'site') return { ok: false, error: 'Only websites are served from the virtual host.' };
    const info = aiSiteHost.registerSiteArtifact(siteRegistry, checked.artifact);
    if (!info) return { ok: false, error: 'This website has no files to serve — it renders as a single page instead.' };
    // The newest host is the one a frame is about to load: pin it and release
    // this window's previous pin so the byte-budget LRU never evicts a live
    // preview while still bounding total memory.
    const prevId = siteActiveHostByWin.get(st.id);
    if (prevId && prevId !== info.id) aiSiteHost.setSiteRegistryPin(siteRegistry, prevId, false);
    aiSiteHost.setSiteRegistryPin(siteRegistry, info.id, true);
    siteActiveHostByWin.set(st.id, info.id);
    return { ok: true, ...info, warnings: checked.warnings || [] };
  });

  // Preview diagnostics: the honest checklist behind the preview panel. Read
  // only — nothing is persisted, so the renderer can ask on every render.
  // Site diagnoses are expensive (full normalize + ~20 validator passes over
  // every file) and run on every card build and every edit save: cache by the
  // site's content hash (V20 polish pass). Debloat V131-V180 halves this bound
  // from 8 to 4; a changed site is still a new key by construction.
  const diagnoseCache = new Map();
  ipcMain.handle('dex:ai-artifact-diagnose', (e, payload) => {
    Aof(e);
    const p = (payload && typeof payload === 'object') ? payload : {};
    const rawFiles = p.artifact && p.artifact.kind === 'site' && Array.isArray(p.artifact.files)
      ? p.artifact.files.filter((f) => f && typeof f.path === 'string' && typeof f.content === 'string')
      : null;
    const cacheKey = (rawFiles && rawFiles.length)
      ? aiSiteHost.siteIdFor(rawFiles, '') : null;
    if (cacheKey) {
      const hit = diagnoseCache.get(cacheKey);
      if (hit) return hit;
    }
    const checked = aiArtifacts.normalizeArtifact(p.artifact);
    if (!checked.ok) {
      return {
        ok: false,
        level: 'error',
        issues: [{ level: 'error', code: 'invalid', message: checked.error || 'The artifact could not be read.' }],
        stats: {},
        warnings: checked.warnings || [],
      };
    }
    const result = { ...aiArtifacts.diagnoseArtifact(checked.artifact), warnings: checked.warnings || [] };
    if (cacheKey) {
      if (diagnoseCache.size >= BUDGETS.diagnoseCacheEntries) diagnoseCache.delete(diagnoseCache.keys().next().value);
      diagnoseCache.set(cacheKey, result);
    }
    return result;
  });

  // Project export: the artifact as files in a .zip (multi-file sites keep
  // their real structure; everything else gets HTML + Markdown + data).
  ipcMain.handle('dex:ai-artifact-zip', async (e, payload) => {
    const { st } = Aof(e);
    const p = (payload && typeof payload === 'object') ? payload : {};
    const checked = aiArtifacts.normalizeArtifact(p.artifact);
    if (!checked.ok) return { ok: false, error: checked.error || 'The artifact could not be read.' };
    let built;
    try {
      // Sites carry per-page PDFs (best effort: a print failure never blocks
      // the zip — the sources are the part that must always arrive).
      let pdfs = [];
      if (checked.artifact.kind === 'site') {
        try {
          const printed = await printSitePages(checked.artifact);
          pdfs = printed.map((x) => ({ name: pdfNameFor(x.page), buffer: x.buffer }));
        } catch { pdfs = []; }
        // The whole site as one PDF (V20): pages concatenated into one print
        // document — native pagination, no merge dependency, no byte splicing.
        try {
          const wholeHtml = artifactZip.wholeSitePrintHtml(checked.artifact);
          if (wholeHtml) {
            const whole = await reportExport.renderPdf(wholeHtml);
            if (whole && whole.length) pdfs.push({ name: 'site.pdf', buffer: whole });
          }
        } catch { /* per-page PDFs still ship */ }
      }
      built = artifactZip.artifactZip(checked.artifact, { name: p.name, pdfs });
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
    if (!built.ok) return built;
    let target = (process.env.DEX_AI_TEST === '1' && typeof p.path === 'string') ? p.path : '';
    if (!target) {
      const result = await dialog.showSaveDialog(st.win, {
        title: 'Save project',
        defaultPath: built.name + '.zip',
        filters: [{ name: 'Zip archive', extensions: ['zip'] }],
      });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      target = result.filePath;
    }
    try {
      await fs.promises.writeFile(target, built.buffer);
      return { ok: true, path: target, bytes: built.bytes, files: built.files };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  // Search every artifact in every chat (title + body + source files).
  ipcMain.handle('dex:ai-artifacts-search', (e, payload) => {
    const { st, A } = Aof(e);
    const p = (payload && typeof payload === 'object') ? payload : {};
    const chats = chatStore(st, A).list;
    return aiArtifacts.searchArtifacts(chats, p.q, { limit: p.limit });
  });

  // Report export. The artifact is re-validated here; the renderer supplies
  // the standalone HTML and the Markdown body. DEX_AI_TEST can name a target
  // path so the e2e suite never opens a native save dialog.
  ipcMain.handle('dex:ai-report-export', async (e, payload) => {
    const { st } = Aof(e);
    const p = (payload && typeof payload === 'object') ? payload : {};
    const format = ['pdf', 'html', 'md', 'docx'].includes(p.format) ? p.format : 'html';
    const checked = aiArtifacts.normalizeArtifact(p.artifact);
    if (!checked.ok) {
      return { ok: false, error: 'The report could not be read.' };
    }
    const kind = checked.artifact.kind;
    // Charts, decks, quizzes, timelines and sites export as standalone HTML —
    // DOCX only knows how to lay out a report.
    if (kind !== 'report' && !['html', 'pdf'].includes(format)) {
      return { ok: false, error: 'This artifact can be exported as HTML or PDF.' };
    }
    const html = String(p.html || '').slice(0, 2000000)
      || artifactHtml.artifactHtml(checked.artifact);
    const markdown = String(p.markdown || '').slice(0, 1000000);
    const explicit = (process.env.DEX_AI_TEST === '1' && typeof p.path === 'string') ? p.path : '';
    try {
      return await reportExport.save({
        win: st.win,
        format,
        name: p.name || checked.artifact.title,
        html,
        markdown,
        artifact: checked.artifact,
        explicitPath: explicit,
      });
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  // ---------- bookmark favicons ----------
  // The starred grid on the start page shows each site's real icon, so a
  // bookmark record can carry the favicon its page reported, stored as an
  // inline data URL. Internal pages are served a CSP whose img-src allows
  // only dexerion:/data:/blob: — a remote https icon URL would never paint
  // there, so the icon is fetched here and inlined. Resolution is strictly
  // best-effort: offline, hotlink-blocked or oversized icons just leave the
  // record without a favicon and the grid keeps its letter avatar.
  const FAVICON_MAX_BYTES = 256 * 1024;
  const faviconFetching = new Set(); // accountId|url currently in flight
  const faviconNoIcon = new Set();   // resolved empty this session; don't refetch

  function faviconDataUrl(u) {
    const src = String(u || '');
    if (/^data:image\//i.test(src)) return Promise.resolve(src);
    if (!/^https?:\/\//i.test(src)) return Promise.resolve('');
    return net.fetch(src, { signal: AbortSignal.timeout(8000) }).then((res) => {
      if (!res.ok) return '';
      const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!/^image\//i.test(type)) return '';
      return res.arrayBuffer().then((ab) => {
        const buf = Buffer.from(ab);
        if (!buf.length || buf.length > FAVICON_MAX_BYTES) return '';
        return 'data:' + type + ';base64,' + buf.toString('base64');
      });
    }).catch(() => '');
  }

  function patchBookmarkFavicon(A, pageUrl, dataUrl) {
    if (!dataUrl) return false;
    let patched = false;
    for (const k of Object.keys(A.bookmarks.roots)) {
      for (const b of (A.bookmarks.roots[k] || [])) {
        if (b && b.url === pageUrl && !b.favicon) { b.favicon = dataUrl; patched = true; }
      }
    }
    return patched;
  }

  // Resolve a bookmark's icon out of band: the star click stays instant and
  // the icon lands on the record (and re-broadcasts) once fetched. A bookmark
  // whose page reported no icon falls back to the origin's /favicon.ico.
  async function resolveBookmarkFavicon(accountId, pageUrl, hint, force) {
    const key = accountId + '|' + pageUrl;
    if (faviconFetching.has(key) || (!force && faviconNoIcon.has(key))) return;
    faviconFetching.add(key);
    try {
      let dataUrl = await faviconDataUrl(hint);
      if (!dataUrl) {
        try { dataUrl = await faviconDataUrl(new URL(pageUrl).origin + '/favicon.ico'); } catch {}
      }
      if (!dataUrl) { faviconNoIcon.add(key); return; }
      if (patchBookmarkFavicon(accData(accountId), pageUrl, dataUrl)) {
        saveAcc(accountId); pushStateForAccount(accountId);
      }
    } catch {
      faviconNoIcon.add(key);
    } finally {
      faviconFetching.delete(key);
    }
  }

  ipcMain.handle('dex:bookmark-add', (e, bm) => {
    const { st, A } = Aof(e);
    const hint = bm && typeof bm.favicon === 'string' ? bm.favicon : '';
    // A data-URL hint stores as-is; a remote URL is resolved out of band and
    // patched onto the record when it lands.
    A.bookmarks.roots.other.unshift(Object.assign(
      { id: 'b' + Date.now(), title: bm.title, url: bm.url, at: Date.now() },
      /^data:image\//i.test(hint) ? { favicon: hint } : {}
    ));
    saveAcc(st.accountId); pushStateForAccount(st.accountId);
    if (!/^data:image\//i.test(hint)) resolveBookmarkFavicon(st.accountId, bm.url, hint, true);
    return true;
  });
  // Favicon map for the start page's starred grid, keyed by bookmark URL.
  // Records without an icon get a one-shot background fetch (origin
  // /favicon.ico) so bookmarks that predate the grid's icons upgrade on
  // their own; the result is saved onto the record exactly as above.
  ipcMain.handle('dex:bookmark-favicons', (e) => {
    const { st, A } = Aof(e);
    const out = {};
    for (const b of Object.values(A.bookmarks.roots).flat()) {
      if (!b || !b.url) continue;
      if (b.favicon) out[b.url] = String(b.favicon);
      else if (/^https?:\/\//i.test(b.url)) resolveBookmarkFavicon(st.accountId, b.url, '');
    }
    return out;
  });
  ipcMain.handle('dex:bookmark-remove', (e, url) => {
    const { st, A } = Aof(e);
    for (const k of Object.keys(A.bookmarks.roots)) A.bookmarks.roots[k] = A.bookmarks.roots[k].filter(b => b.url !== url);
    saveAcc(st.accountId); pushStateForAccount(st.accountId); return true;
  });
  ipcMain.handle('dex:bookmark-move', (e, id, folder) => {
    const { st, A } = Aof(e);
    for (const k of Object.keys(A.bookmarks.roots)) {
      const i = A.bookmarks.roots[k].findIndex(b => b.id === id);
      if (i >= 0) { const [b] = A.bookmarks.roots[k].splice(i, 1); A.bookmarks.roots[folder === 'bar' ? 'bar' : 'other'].push(b); }
    }
    saveAcc(st.accountId); pushStateForAccount(st.accountId); return true;
  });
  ipcMain.handle('dex:is-bookmarked', (e, url) => {
    const { A } = Aof(e);
    return Object.values(A.bookmarks.roots).flat().some(b => b.url === url);
  });

  // history (per account)
  ipcMain.handle('dex:history', (e, q, limit) => {
    const { A } = Aof(e);
    const query = String(q || '').toLowerCase();
    const list = query ? A.history.filter(h => (h.title + ' ' + h.url).toLowerCase().includes(query)) : A.history;
    return list.slice(0, limit || 200);
  });
  ipcMain.handle('dex:history-delete', (e, url) => {
    const { st, A } = Aof(e);
    A.history = A.history.filter(h => h.url !== url); saveAcc(st.accountId); return true;
  });
  ipcMain.handle('dex:history-clear', (e) => { const { st, A } = Aof(e); A.history = []; A.topSites = {}; saveAcc(st.accountId); return true; });

  // downloads
  ipcMain.handle('dex:downloads', (e) => { needChrome(e); return S.downloads; });
  ipcMain.handle('dex:download-open', (e, id) => {
    needChrome(e);
    const d = S.downloads.find(x => x.id === id);
    if (d) shell.openPath(d.path);
  });
  ipcMain.handle('dex:download-folder', (e) => { needChrome(e); shell.openPath(S.settings.downloadDir); });
  ipcMain.handle('dex:download-cancel', (e, id) => {
    needChrome(e);
    const rec = S.downloads.find(download => download.id === id);
    const item = downloadItems.get(id);
    if (!rec || !item || !rec.active) return false;
    rec.state = 'cancelled';
    rec.active = false;
    rec.bytesPerSecond = 0;
    item.cancel();
    profile.saveSoon();
    notifyDownloads();
    return true;
  });
  ipcMain.handle('dex:download-pause', (e, id) => {
    needChrome(e);
    const rec = S.downloads.find(download => download.id === id);
    const item = downloadItems.get(id);
    if (!rec || !item || !rec.active || !item.canResume() || item.isPaused()) return false;
    item.pause();
    rec.state = 'paused';
    rec.bytesPerSecond = 0;
    profile.saveSoon();
    notifyDownloads();
    return true;
  });
  ipcMain.handle('dex:download-resume', (e, id) => {
    needChrome(e);
    const rec = S.downloads.find(download => download.id === id);
    const item = downloadItems.get(id);
    if (!rec || !item || !rec.active || !item.canResume() || (rec.state !== 'paused' && rec.state !== 'interrupted')) return false;
    item.resume();
    rec.state = 'progressing';
    rec.bytesPerSecond = 0;
    profile.saveSoon();
    notifyDownloads();
    return true;
  });
  ipcMain.handle('dex:download-retry', (e, id) => {
    // Terminal 'interrupted'/'cancelled' rows hold no live DownloadItem, so
    // resume is impossible — start a fresh transfer for the same URL in this
    // window's account session. The old row stays as history.
    const { st } = needChrome(e);
    const rec = S.downloads.find(download => download.id === id);
    if (!rec || !rec.url) return false;
    if (rec.active) return false;
    if (rec.state !== 'interrupted' && rec.state !== 'cancelled') return false;
    const t = st.tabs.get(st.active);
    const wc = (t && t.view && t.view.webContents) || e.sender;
    if (!wc || wc.isDestroyed()) return false;
    try { wc.downloadURL(rec.url); } catch { return false; }
    return true;
  });
  ipcMain.handle('dex:download-delete', (e, id) => {
    needChrome(e);
    const rec = S.downloads.find(download => download.id === id);
    if (!rec) return true;
    const item = downloadItems.get(id);
    if (item) {
      pendingDownloadDeletes.add(id);
      rec.state = 'cancelled';
      rec.active = false;
      rec.bytesPerSecond = 0;
      item.cancel();
      profile.saveSoon();
      notifyDownloads();
      return true;
    }
    return removeDownload(id, true);
  });
  ipcMain.handle('dex:start-download', (e, url) => {
    const { st } = needChrome(e); const t = st.tabs.get(st.active);
    if (t) t.view.webContents.downloadURL(url);
  });

  // settings
  ipcMain.handle('dex:settings', (e) => { needChrome(e); return { ...S.settings, engines: SEARCH_ENGINES }; });
  // inspector (Chromium DevTools in Dexerion's own frame)
  ipcMain.handle('dex:inspector-toggle', (e, tabId) => {
    const { st } = needChrome(e);
    if (st.inspector && st.inspector.open) return closeInspector(st.id);
    return openInspector(st.id, tabId || st.active);
  });
  ipcMain.handle('dex:inspector-dock', (e, dock) => {
    const { st } = needChrome(e);
    return setInspectorDock(st.id, dock);
  });
  ipcMain.handle('dex:inspector-close', (e) => {
    const { st } = needChrome(e);
    return closeInspector(st.id);
  });
  // network state pages (dexerion://connecting, dexerion://offline)
  function netTargetOf(tab, wc) {
    const net = tabNet(tab);
    if (net && net.target) return net.target;
    // After a restart the tab's memory is gone; the page's own query still knows.
    try {
      const u = new URL(wc.getURL());
      const t = u.searchParams.get('t');
      if (t) return t;
    } catch {}
    return '';
  }
  ipcMain.handle('dex:net-give-up', (e) => {
    const { st, tab } = needChrome(e);
    const t = st.tabs.get(tab);
    if (!t) return false;
    return showOffline(st.id, tab, netTargetOf(t, t.view.webContents));
  });
  ipcMain.handle('dex:net-retry', (e) => {
    const { st, tab } = needChrome(e);
    const t = st.tabs.get(tab);
    if (!t) return false;
    const target = netTargetOf(t, t.view.webContents);
    if (!target) return false;
    return startWaiting(st.id, tab, target, { manual: true });
  });
  // The fallback panel's "Try again". It is not a chrome sender (it is a plain
  // inspector window we opened), so it is recognised by registration instead.
  ipcMain.handle('dex:inspector-retry', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    const winId = w ? inspectorWindows.get(w) : null;
    const st = winId ? windows.get(winId) : null;
    const ins = st && st.inspector;
    if (!st || !ins || !ins.open) throw new Error('denied');
    const tabId = ins.tabId;
    closeInspector(winId);
    setTimeout(() => { try { openInspector(winId, tabId); } catch {} }, 60);
    return true;
  });
  ipcMain.handle('dex:settings-save', (e, patch) => {
    needChrome(e);
    const allowed = ['searchEngine', 'customSearchUrl', 'homepage', 'restoreSession', 'showBookmarksBar', 'downloadDir', 'theme', 'accent', 'aiModel', 'uiDensity'];
    for (const k of allowed) if (patch[k] !== undefined) S.settings[k] = patch[k];
    // Search With Dexerion AI: bounds live in ai-search.js so every read path
    // (settings page, search run) agrees on 4-12 sources and 2-6 adaptations.
    if (patch.aiSearchSuggest !== undefined) S.settings.aiSearchSuggest = Boolean(patch.aiSearchSuggest);
    if (patch.aiSearchSources !== undefined) S.settings.aiSearchSources = aiSearch.clampSources(patch.aiSearchSources);
    if (patch.aiSearchAdaptations !== undefined) S.settings.aiSearchAdaptations = aiSearch.clampAdaptations(patch.aiSearchAdaptations);
    // Memory Saver (Performance): cap clamped to the 1-4 GB the UI offers.
    if (patch.memorySaver !== undefined) S.settings.memorySaver = Boolean(patch.memorySaver);
    if (patch.memoryCapMB !== undefined) S.settings.memoryCapMB = clampCapMB(patch.memoryCapMB);
    // GPU policy: a single Adaptive mode. Legacy values are accepted from older
    // profiles and normalized, never resurrected as a user-facing choice.
    if (patch.gpuMode !== undefined) S.settings.gpuMode = adaptivePower.normalizeGpuMode(patch.gpuMode);
    // Daily welcome toggle (Settings > Appearance).
    if (patch.welcomeDaily !== undefined) S.settings.welcomeDaily = Boolean(patch.welcomeDaily);
    // Theme: whitelisted, because the value becomes a stylesheet path.
    if (patch.skin !== undefined && UI_SKINS.includes(String(patch.skin))) S.settings.skin = String(patch.skin);
    // The Settings page tells the user "Saved" the moment this returns, so
    // the write has to have happened. saveSoon() is deferred and swallows a
    // disk failure, which would leave the page claiming a change that is not
    // on disk. saveNow() writes it synchronously and reports the failure.
    if (!profile.saveNow()) {
      throw new Error('Could not save your settings: ' + (profile.lastError || 'the profile could not be written'));
    }
    syncTheme();
    applySelectionAccentAll();
    for (const id of windows.keys()) { layout(id); pushState(id); }
    broadcastUiTheme();
    return S.settings;
  });
  // ---------- Focus Timer (Pomodoro) ----------
  ipcMain.handle('dex:pomo-state', (e) => {
    needChrome(e);
    return pomodoro.state();
  });
  ipcMain.handle('dex:pomo-start', (e, phase, opts) => {
    needChrome(e);
    return pomodoro.start(phase === 'break' ? 'break' : 'work', opts || {});
  });
  ipcMain.handle('dex:pomo-toggle', (e) => { needChrome(e); return pomodoro.toggle(); });
  ipcMain.handle('dex:pomo-pause', (e) => { needChrome(e); return pomodoro.pause(); });
  ipcMain.handle('dex:pomo-skip', (e) => { needChrome(e); return pomodoro.skip(); });
  ipcMain.handle('dex:pomo-reset', (e) => { needChrome(e); return pomodoro.reset(); });
  ipcMain.handle('dex:pomo-configure', (e, patch) => { needChrome(e); return pomodoro.configure(patch || {}); });
  ipcMain.handle('dex:pomo-block-add', (e, input) => { needChrome(e); return pomodoro.addBlock(String(input || '')); });
  ipcMain.handle('dex:pomo-block-remove', (e, input) => { needChrome(e); return pomodoro.removeBlock(String(input || '')); });
  ipcMain.handle('dex:top-sites', (e) => {
    const { A } = Aof(e);
    return Object.entries(A.topSites).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([host]) => ({ host, url: 'https://' + host }));
  });
  ipcMain.handle('dex:recent', (e, n) => { const { A } = Aof(e); return A.history.slice(0, n || 8); });

  // ---------- process memory (Task Manager-style figures) ----------
  // Whole-app total, per-process breakdown and the Memory Saver state.
  ipcMain.handle('dex:memory', (e) => {
    needChrome(e);
    return buildMemoryReport();
  });

  // Adaptive GPU / power diagnostics (internal; used by the power benchmark
  // harness and tests, not surfaced in the UI).
  ipcMain.handle('dex:power-state', (e) => {
    needChrome(e);
    return powerState();
  });

  // B1 probe seam (read-only, trusted chrome only, no renderer calls it): the
  // background-visibility probes read what each open overlay page — and the
  // covered page tab while the fullscreen search surface is open — actually
  // does: whether requestAnimationFrame still fires (frame production is the
  // power lever B1 targets; document.visibilityState is reported too, but a
  // runtime detach+hide suspends rAF while the visibility state can stay
  // stale-visible — see probe-wcv-semantics).
  ipcMain.handle('dex:overlay-state', async (e) => {
    needChrome(e);
    const readView = async (view) => {
      if (!view || view.webContents.isDestroyed()) return null;
      let doc = '';
      try { doc = String(await view.webContents.executeJavaScript('String(document.visibilityState)', true)); } catch {}
      let raf = null;
      try {
        raf = Boolean(await view.webContents.executeJavaScript(
          'new Promise((res) => { requestAnimationFrame(() => res(true)); setTimeout(() => res(false), 900); })', true));
      } catch {}
      return { doc, rafProducing: raf };
    };
    const out = {};
    // A frozen renderer delays its own timers, so every read is raced against
    // a main-side deadline; a late page simply reports nulls.
    const bounded = async (p) => Promise.race([
      p,
      new Promise((res) => { const t = setTimeout(() => res(null), 5000); if (t.unref) t.unref(); }),
    ]);
    for (const st of windows.values()) {
      if (!st || st.win.isDestroyed()) continue;
      let minimized = null;
      try { minimized = st.win.isMinimized(); } catch {}
      const [snip, report, site, page] = await Promise.all([
        bounded(readView((snipState.get(st.id) || {}).view)),
        bounded(readView((reportOverlayState.get(st.id) || {}).view)),
        bounded(readView((siteOverlayState.get(st.id) || {}).view)),
        bounded(readView((st.tabs.get(st.active) || {}).view)),
      ]);
      out[st.id] = {
        minimized,
        searchOpen: Boolean(st.searchOpen),
        snip, report, site, page,
      };
    }
    return out;
  });

  // Read-only GPU diagnostics: what Chromium actually decided at boot. The
  // GPU child's command line is NOT a reliable oracle — the browser process
  // consumes GPU switches and forwards them encoded (--gpu-preferences) — so
  // the tests read the truth from here instead.
  ipcMain.handle('dex:gpu-info', (e) => {
    needChrome(e);
    let features = {};
    try { features = app.getGPUFeatureStatus() || {}; } catch {}
    return {
      features,
      switches: {
        disableGpu: app.commandLine.hasSwitch('disable-gpu'),
        forceLowPowerGpu: app.commandLine.hasSwitch('force-low-power-gpu'),
        gpuRasterization: app.commandLine.hasSwitch('enable-gpu-rasterization'),
        zeroCopy: app.commandLine.hasSwitch('enable-zero-copy'),
        gpuMemBudgetMB: app.commandLine.getSwitchValue('force-gpu-mem-available-mb') || null,
      },
    };
  });

  // extensions
  ipcMain.handle('dex:ext-list', (e) => {
    needChrome(e);
    // Normalize: expose a top-level `id` (display id) — raw records use an
    // ids map per session, which left the manager UI sending undefined.
    return extensions.records().map(r => ({ ...r, id: extensions.displayId(r) }));
  });
  ipcMain.handle('dex:ext-load-unpacked', async (e) => {
    needChrome(e);
    // Accept a folder, .zip, or .crx — like Chrome's Load unpacked plus
    // packaged-extension install in one picker.
    const r = await dialog.showOpenDialog({
      filters: [{ name: 'Extension (folder, .zip or .crx)', extensions: ['zip', 'crx'] }],
      properties: ['openDirectory', 'openFile'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const p = r.filePaths[0];
    const rec = /\.(zip|crx)$/i.test(p) ? await extensions.installFromCrxOrZip(p) : await extensions.loadUnpacked(p);
    broadcastState(); return rec;
  });
  ipcMain.handle('dex:ext-toggle', async (e, id, on) => { needChrome(e); const r = await extensions.setEnabled(id, on); broadcastState(); return r; });
  ipcMain.handle('dex:ext-reload', async (e, id) => { needChrome(e); const r = await extensions.reload(id); broadcastState(); return r; });
  ipcMain.handle('dex:ext-remove', async (e, id) => { needChrome(e); await extensions.remove(id); broadcastState(); return true; });
  ipcMain.handle('dex:ext-install-file', async (e) => {
    needChrome(e);
    const r = await dialog.showOpenDialog({ filters: [{ name: 'Extension', extensions: ['crx', 'zip'] }], properties: ['openFile'] });
    if (r.canceled) return null;
    const rec = await extensions.installFromCrxOrZip(r.filePaths[0]);
    broadcastState(); return rec;
  });
  ipcMain.handle('dex:ext-install-store', async (e, url) => {
    needChrome(e);
    const rec = await extensions.installFromWebStoreUrl(url);
    broadcastState(); return rec;
  });
  ipcMain.handle('dex:ext-popup', (e, id) => { const { st } = needChrome(e); openExtensionPopup(st, id); });
  // Real extension icons (Chrome shows action/default icons, not placeholders).
  // Manifest + PNG bytes are cached per extension+size: the manager grid fires
  // N icon IPCs in a burst and each one used to do 2 sync disk reads on the
  // main thread.
  const extIconCache = new Map();
  ipcMain.handle('dex:ext-icon', (e, id, size) => {
    needChrome(e);
    try {
      const key = String(id) + '@' + String(size || 48);
      if (extIconCache.has(key)) return extIconCache.get(key);
      const rec = extensions.findRec(id);
      if (!rec || !rec.path) return null;
      const m = JSON.parse(fs.readFileSync(path.join(rec.path, 'manifest.json'), 'utf8'));
      const pick = (obj) => {
        if (!obj) return null;
        if (typeof obj === 'string') return obj;
        const want = size || 48;
        const keys = Object.keys(obj).map(Number).filter(Boolean).sort((a, b) => a - b);
        if (!keys.length) return null;
        const fit = keys.filter(k => k >= want);
        return obj[String(fit.length ? fit[0] : keys[keys.length - 1])];
      };
      const rel = pick(m.action && m.action.default_icon) || pick(m.icons) || pick(m.browser_action && m.browser_action.default_icon);
      if (!rel) return null;
      const fp = path.join(rec.path, rel.replace(/\//g, path.sep));
      if (!fs.existsSync(fp)) return null;
      const ext = path.extname(fp).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.svg' ? 'image/svg+xml' : 'application/octet-stream';
      const out = `data:${mime};base64,` + fs.readFileSync(fp).toString('base64');
      // Cap the cache so a profile with many extensions cannot grow it forever.
      if (extIconCache.size > 120) extIconCache.clear();
      extIconCache.set(key, out);
      return out;
    } catch { return null; }
  });
  // ---------- accounts ----------
  async function createAccount(name, email, googleEmail) {
    const id = 'a' + Date.now().toString(36);
    const used = listAccounts().map(a => a.color);
    const color = AVATAR_COLORS.find(c => !used.includes(c)) || AVATAR_COLORS[listAccounts().length % AVATAR_COLORS.length];
    const g = String(googleEmail || '').trim().slice(0, 120);
    if (g && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g)) throw new Error('Enter a valid Google email.');
    const meta = {
      id, name: String(name || 'Account').slice(0, 40) || 'Account',
      email: String(email || '').slice(0, 80), googleEmail: g, color, createdAt: Date.now(),
    };
    S.accounts.push(meta);
    profile.saveSoon();
    accData(id);
    saveAcc(id);
    sesFor(id);
    return accountPublic(id);
  }
  ipcMain.handle('dex:account-list', (e) => {
    needChrome(e);
    return { accounts: listAccounts().map(a => accountPublic(a.id)), defaultAccountId: S.defaultAccountId || 'default' };
  });
  ipcMain.handle('dex:account-create', async (e, { name, email, googleEmail } = {}) => {
    needChrome(e);
    return createAccount(name, email, googleEmail);
  });
  ipcMain.handle('dex:account-rename', (e, { id, name } = {}) => {
    needChrome(e);
    const m = getAccountMeta(id);
    if (!m) throw new Error('unknown account');
    const nm = String(name || '').trim().slice(0, 40);
    if (!nm) throw new Error('Give the account a name.');
    m.name = nm;
    profile.saveSoon();
    broadcastState();
    return accountPublic(id);
  });
  // Avatar arrives already downscaled to 256px PNG by the renderer, so the
  // profile stays small; we only validate the header and write bytes.
  ipcMain.handle('dex:account-avatar', (e, { id, dataUrl } = {}) => {
    needChrome(e);
    const m = getAccountMeta(id);
    if (!m) throw new Error('unknown account');
    const s = String(dataUrl || '');
    const mt = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(s);
    if (!mt) throw new Error('Use a PNG image.');
    const buf = Buffer.from(mt[1], 'base64');
    if (!buf.length) throw new Error('That image could not be read.');
    if (buf.length > 3 * 1024 * 1024) throw new Error('Image is too large.');
    fs.mkdirSync(profile.dir, { recursive: true });
    fs.writeFileSync(path.join(profile.dir, 'avatar-' + id + '.png'), buf);
    m.avatar = true;
    profile.saveSoon();
    broadcastState();
    return accountPublic(id);
  });
  ipcMain.handle('dex:account-avatar-clear', (e, { id } = {}) => {
    needChrome(e);
    const m = getAccountMeta(id);
    if (!m) throw new Error('unknown account');
    try { fs.unlinkSync(path.join(profile.dir, 'avatar-' + id + '.png')); } catch {}
    delete m.avatar;
    profile.saveSoon();
    broadcastState();
    return accountPublic(id);
  });
  ipcMain.handle('dex:account-switch', (e, id) => {
    needChrome(e);
    if (!getAccountMeta(id)) throw new Error('unknown account');
    const wid = newWindow(undefined, id);
    const st = windows.get(wid);
    if (st) st.win.focus();
    return wid;
  });
  ipcMain.handle('dex:account-default', (e, id) => {
    needChrome(e);
    if (!getAccountMeta(id)) throw new Error('unknown account');
    S.defaultAccountId = id;
    profile.saveSoon();
    broadcastState();
    return true;
  });
  ipcMain.handle('dex:account-delete', async (e, id) => {
    needChrome(e);
    if (id === 'default') throw new Error('The built-in account cannot be deleted.');
    const i = listAccounts().findIndex(a => a.id === id);
    if (i < 0) throw new Error('unknown account');
    for (const st of [...windows.values()]) {
      if (st.accountId === id) { try { st.win.close(); } catch {} }
    }
    listAccounts().splice(i, 1);
    if (S.defaultAccountId === id) S.defaultAccountId = 'default';
    accountCache.delete(id);
    try { fs.rmSync(profile.accountDir(id), { recursive: true, force: true }); } catch {}
    try { fs.unlinkSync(path.join(profile.dir, 'avatar-' + id + '.png')); } catch {}
    try { await sesFor(id).clearStorageData(); } catch {}
    accountSessions.delete(id);
    profile.saveSoon();
    broadcastState();
    return true;
  });

  // ---------- password manager IPC ----------
  ipcMain.handle('dex:login-query', (e, { origin } = {}) => {
    const k = chromeSender(e);
    if (!k.st) throw new Error('denied');
    const so = senderOrigin(e);
    if (!so || so !== origin) throw new Error('denied'); // own origin only
    return loginsFor(k.st.accountId, origin).map(l => ({ username: l.username, password: decryptSecret(l.secret) }));
  });
  ipcMain.handle('dex:login-capture', (e, { origin, username, password } = {}) => {
    const k = chromeSender(e);
    if (!k.st || k.shell || k.internal) return false; // real web tab pages only
    const so = senderOrigin(e);
    if (!so || so !== origin || !password) return false;
    pendingLogins.set(k.st.id, { origin, username: String(username || '').slice(0, 200), password: String(password).slice(0, 2000) });
    try {
      const u = new URL(origin);
      k.st.win.webContents.send('dex:login-prompt', { host: u.host, username: String(username || '') });
    } catch {}
    return true;
  });
  ipcMain.handle('dex:login-save', (e, save) => {
    const { st } = needChrome(e);
    const p = pendingLogins.get(st.id);
    pendingLogins.delete(st.id);
    if (!save || !p) return false;
    const A = accData(st.accountId);
    const i = A.logins.findIndex(l => l.origin === p.origin && l.username === p.username);
    const rec = { origin: p.origin, username: p.username, secret: encryptSecret(p.password), updatedAt: Date.now() };
    if (i >= 0) A.logins[i] = rec; else A.logins.push(rec);
    saveAcc(st.accountId);
    return true;
  });
  ipcMain.handle('dex:logins', (e) => {
    const { A } = Aof(e);
    return A.logins.map(l => ({ origin: l.origin, username: l.username, updatedAt: l.updatedAt }));
  });
  ipcMain.handle('dex:login-delete', (e, { origin, username } = {}) => {
    const { st, A } = Aof(e);
    A.logins = A.logins.filter(l => !(l.origin === origin && l.username === username));
    saveAcc(st.accountId);
    return true;
  });

  // ---------- Google integration ----------
  // Honest model: Dexerion cannot mint Google sessions (that would defeat
  // Google's own auth). Instead each Dexerion account links a Google email,
  // used to pre-select on a first sign-in; per-session cookies decide whether
  // to show the chooser or go straight to the service. See googleUrl above.
  // Detector: runs on real Google pages, reads the signed-in account email
  // from Google's own profile chip and reports it — "Continue with Google"
  // opens the genuine chooser, Dexerion links whatever you sign in with.
  const GOOGLE_DETECT = `(function(){
    if (window.__dexG) return; window.__dexG = true;
    let last = '';
    function findEmail(){
      try {
        const a = document.querySelector('a[aria-label^="Google Account:"]');
        if (a) {
          const m = (a.getAttribute('aria-label') || '').match(/[\\w.%+-]+@[\\w.-]+\\.[a-z]{2,}/i);
          if (m) return m[0];
        }
        const banner = document.querySelector('header') || document.body;
        const t = ((banner && banner.innerText) || '').slice(0, 4000);
        const m2 = t.match(/[\\w.%+-]+@[\\w.-]+\\.[a-z]{2,}/i);
        if (m2) return m2[0];
      } catch {}
      return '';
    }
    function report(){
      const em = findEmail();
      if (em && em !== last) {
        last = em;
        try { window.dexerion.invoke('dex:google-detected', { email: em }).catch(() => {}); } catch {}
      }
    }
    report();
    new MutationObserver(() => report()).observe(document.documentElement, { childList: true, subtree: true });
  })();`;
  function installGoogleDetect(wc, url) {
    try {
      const host = new URL(url).hostname;
      if (!host.endsWith('.google.com')) return;
      if (wc.isDestroyed()) return;
      wc.executeJavaScript(GOOGLE_DETECT).catch(() => {});
    } catch {}
  }
  ipcMain.handle('dex:google-detected', (e, { email } = {}) => {
    const k = chromeSender(e);
    if (!k.st || k.shell || k.internal) return false;
    let host = '';
    try { host = new URL(e.sender.getURL()).hostname; } catch {}
    if (!host.endsWith('.google.com')) return false;
    const em = String(email || '').trim().slice(0, 120);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return false;
    const m = getAccountMeta(k.st.accountId);
    if (!m) return false;
    // Two separate facts: googleEmail is the DEFAULT used to pre-select on a
    // first sign-in, activeEmail is whoever Google actually has us signed in
    // as right now. Keeping them apart is what lets the user switch accounts
    // without Dexerion dragging them back.
    const autoFilled = !m.googleEmail;
    if (autoFilled) m.googleEmail = em;
    const changed = autoFilled || m.activeEmail !== em;
    m.activeEmail = em;
    if (!changed) return false;
    profile.saveSoon();
    broadcastState();
    return true;
  });
  async function googleStatus(accountId) {
    const id = (accountId && getAccountMeta(accountId)) ? accountId : 'default';
    const m = getAccountMeta(id) || {};
    try {
      const s = sesFor(id);
      const cookies = await s.cookies.get({ domain: '.google.com' });
      const names = new Set(cookies.map(c => c.name));
      const signedIn = ['SID', 'SSID'].every(n => names.has(n));
      return { signedIn, email: m.googleEmail || '', activeEmail: m.activeEmail || '' };
    } catch {
      return { signedIn: false, email: m.googleEmail || '', activeEmail: m.activeEmail || '' };
    }
  }
  ipcMain.handle('dex:account-google', (e, { id, email } = {}) => {
    needChrome(e);
    const m = getAccountMeta(id);
    if (!m) throw new Error('unknown account');
    const em = String(email || '').trim().slice(0, 120);
    if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) throw new Error('Enter a valid Google email.');
    m.googleEmail = em;
    profile.saveSoon();
    broadcastState();
    return accountPublic(id);
  });
  ipcMain.handle('dex:account-google-unlink', (e, { id } = {}) => {
    needChrome(e);
    const m = getAccountMeta(id);
    if (!m) throw new Error('unknown account');
    m.googleEmail = '';
    m.activeEmail = '';
    profile.saveSoon();
    broadcastState();
    return true;
  });
  ipcMain.handle('dex:google-status', async (e, { accountId } = {}) => {
    needChrome(e);
    return googleStatus(accountId);
  });
  ipcMain.handle('dex:google-open', async (e, { accountId, service } = {}) => {
    const { st } = needChrome(e);
    const id = (accountId && getAccountMeta(accountId)) ? accountId : st.accountId;
    const m = getAccountMeta(id) || {};
    // Only pre-select the linked email when there is no session yet. If one
    // exists, go straight to the service so a deliberate account switch sticks.
    const g = await googleStatus(id);
    const target_url = googleUrl(service, m.googleEmail, g.signedIn);
    // Open inside the linked account's own window so the right session is used.
    let target = [...windows.values()].find(w => w.accountId === id);
    if (!target) {
      const wid = newWindow(undefined, id);
      target = windows.get(wid);
    }
    if (target) {
      try { target.win.focus(); } catch {}
      newTab(target.id, target_url, false);
    }
    return true;
  });
  // Future-AI capability requests (deny-by-default; see permissions.js).
  ipcMain.handle('dex:ai-request', (e, perm) => permissions.request('assist', perm));
  // Overlay ⋮ menu: the tab content view is a native child that paints over
  // any HTML, so it is hidden while the menu is open (works windowed and
  // fullscreen alike) and restored on close.
  function menuWindowState(e) {
    try { return needChrome(e).st; } catch { /* fall through to sender window */ }
    try {
      const w = BrowserWindow.fromWebContents(e.sender);
      return (w && windows.get(w.id)) || null;
    } catch { return null; }
  }
  ipcMain.handle('dex:menu-open', (e) => {
    // Hiding the native tab view is best effort: the HTML overlay is painted
    // by the shell and must never be left invisible by a strict sender check.
    const st = menuWindowState(e);
    const t = st && st.tabs.get(st.active);
    if (t) { try { t.view.setVisible(false); } catch {} }
    return true;
  });
  ipcMain.handle('dex:menu-close', (e) => {
    // Closing a menu is Dexerion UI work: the shell or an internal page may
    // ask for it, but a page on the web must not be able to dismiss the
    // menu the person is using.
    const k = chromeSender(e);
    if (!k.st || (!k.shell && !k.internal)) return false;
    const st = menuWindowState(e) || k.st;
    const t = st.tabs.get(st.active);
    if (t) { try { t.view.setVisible(true); } catch {} layout(st.id); pushState(st.id); }
    return true;
  });
  // ---------- default browser (Settings UI) ----------
  // Windows blocks apps from flipping UserChoice themselves, so "make
  // default" ensures registration then opens Default apps for the user.
  ipcMain.handle('dex:default-status', async (e) => {
    needChrome(e);
    return require('./defaultbrowser').defaultStatus();
  });
  ipcMain.handle('dex:default-make', async (e) => {
    needChrome(e);
    try {
      const eapp = app;
      if (eapp.isPackaged) {
        await require('./defaultbrowser').registerBrowser(eapp.getPath('exe'));
      }
      await shell.openExternal('ms-settings:defaultapps');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  // ---------- Dexerion Assistant (NVIDIA NIM + persistent memory) ----------
  // Chrome/internal pages only: an untrusted https page must never be able
  // to spend the user's API quota, read the conversation, or their key.
  // Context-menu handoff (scAI pendingPrompt): the menu stashes what was
  // asked about; the sidebar picks it up when it opens.
  function stashAiPrompt(winId, pending) {
    const st = windows.get(winId);
    if (!st) return;
    st.aiPending = { kind: pending.kind === 'page' ? 'page' : 'selection', text: String(pending.text || '').slice(0, 4000), at: Date.now() };
    st.aiOpen = true;
    layout(st.id);
    try { st.win.webContents.send('dex:ai-open'); } catch {}
  }
  ipcMain.handle('dex:ai-take-pending', (e) => {
    const { st } = needChrome(e);
    const p = st.aiPending || null;
    st.aiPending = null;
    return p && (Date.now() - (p.at || 0)) < 5 * 60 * 1000 ? p : null;
  });
  // "Open this chat in the panel", used by the Files page: stash the chat id
  // as a pending item and open the panel; the sidebar opens it on arrival.
  ipcMain.handle('dex:ai-open-chat', (e, id) => {
    const { st, A } = Aof(e);
    const chat = chatStore(st, A).find(String(id || ''));
    if (!chat) throw new Error('Chat not found.');
    st.aiPending = { kind: 'chat', chatId: chat.id, at: Date.now() };
    st.aiOpen = true;
    layout(st.id);
    try { st.win.webContents.send('dex:ai-open'); } catch {}
    return true;
  });
  // The app menu's "New AI chat" and Ctrl+Shift+O: open the panel on a fresh
  // conversation in one step (the sidebar creates it when the pending lands).
  ipcMain.handle('dex:ai-new-chat', (e) => {
    const { st } = Aof(e);
    st.aiPending = { kind: 'new-chat', at: Date.now() };
    st.aiOpen = true;
    layout(st.id);
    try { st.win.webContents.send('dex:ai-open'); } catch {}
    return true;
  });
  ipcMain.handle('dex:ai-history', (e) => {
    const { st } = Aof(e);
    st.aiOpen = true;
    layout(st.id);
    try { st.win.webContents.send('dex:ai-history-open'); } catch {}
    return true;
  });
  // The Files home: every report in this account's visible chats, newest
  // first, with just enough metadata to list and open one.
  // Every artifact in the account, newest first. The channel name predates the
  // other kinds; the rows carry `kind` so a caller can label and route them.
  ipcMain.handle('dex:ai-reports-list', (e) => {
    const { st, A } = Aof(e);
    const out = [];
    for (const chat of chatStore(st, A).list) {
      (chat.messages || []).forEach((message, index) => {
        const art = message && message.artifact;
        if (!art || !art.kind) return;
        out.push({
          chatId: chat.id,
          index,
          kind: String(art.kind),
          title: art.title || (art.kind === 'report' ? 'Report' : 'Artifact'),
          theme: art.theme || 'clean',
          version: art.version || 1,
          files: Array.isArray(art.files) ? art.files.length : 0,
          updatedAt: Number(art.updatedAt || chat.updatedAt || chat.createdAt) || 0,
        });
      });
    }
    out.sort((a, b) => b.updatedAt - a.updatedAt);
    return out.slice(0, 200);
  });
  ipcMain.handle('dex:ai-status', (e) => {
    const { A } = Aof(e);
    // The effort tier is the default chooser: status reports the model that
    // effort will actually use (a manual pin still wins over it).
    return ai.status(difficultyOf(A));
  });
  // The manual skill list for /help, the "/" picker and settings — the same
  // registry the model sees, minus the planned ones.
  ipcMain.handle('dex:ai-skills', (e) => {
    needChrome(e);
    return {
      skills: skills.readySkills().map((s) => ({ id: s.id, name: s.name, tier: s.tier, description: s.description })),
    };
  });
  // Open tabs for the "@" mention picker.
  ipcMain.handle('dex:ai-tabs-list', (e) => {
    const { st } = Aof(e);
    return st.order.map((id) => {
      const t = st.tabs.get(id);
      const group = t && t.groupId ? st.groups.get(t.groupId) : null;
      return { id, title: String((t && t.title) || 'Tab'), url: String((t && t.url) || ''), active: id === st.active, group: group ? group.name : null };
    }).filter((t) => /^https?:/i.test(t.url) || t.active);
  });
  // Store the NIM key, encrypted in the main process. Blank keeps the stored
  // one; an explicit empty string clears it.
  ipcMain.handle('dex:ai-key-set', (e, key) => {
    needChrome(e);
    const result = ai.save({ key: key === undefined ? undefined : String(key) });
    // Broadcast so open sidebars re-read their status (F-07: a key set from
    // outside the panel — via Settings or another path — must update the
    // sidebar instead of leaving it stuck on the setup card).
    try { broadcast('dex:ai-key-changed', { hasKey: Boolean(key) }); } catch {}
    return result;
  });
  ipcMain.handle('dex:ai-key-clear', (e) => {
    needChrome(e);
    const result = ai.save({ key: '' });
    try { broadcast('dex:ai-key-changed', { hasKey: false }); } catch {}
    return result;
  });
  // The live catalogue of models this key can reach, so the picker never
  // offers a model that has been retired.
  ipcMain.handle('dex:ai-models-refresh', async (e) => {
    needChrome(e);
    try { await ai.refreshModels(); return { ok: true, ...ai.status() }; }
    catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });
  // The model picker commits a choice only after it has answered once with
  // this key: the NIM catalogue lists models an account may not be
  // provisioned for, and a silently substituted model is worse than a clear
  // "not available on your account" plus a revert to the previous choice.
  ipcMain.handle('dex:ai-model-set', async (e, model) => {
    const { A } = Aof(e);
    try {
      const before = ai.status(difficultyOf(A)).model || '';
      const picked = String(model || '').trim();
      const m = ai.setModel(picked);
      S.settings.aiModel = m;
      profile.saveSoon();
      if (!picked) return { ok: true, model: m };
      const verdict = await ai.verifyModel(picked)
        .catch((err) => ({ ok: false, modelMissing: false, error: String(err && err.message || err) }));
      if (verdict.ok) {
        // verifyModel already paid the cold start with a real one-token
        // exchange and marked the connection warm. A second forced prewarm
        // here only queues another NIM completion before the first message.
        return { ok: true, model: picked };
      }
      if (verdict.modelMissing) {
        // Not provisioned: drop the pin so the effort tier (the default
        // chooser) takes over again, and say what happened.
        let reverted = before || m;
        try {
          ai.save({ pinned: '' });
          reverted = ai.status(difficultyOf(A)).model || reverted;
        } catch {}
        S.settings.aiModel = reverted;
        profile.saveSoon();
        return { ok: false, model: reverted, error: verdict.error || 'That model is not available on your account.' };
      }
      // Transient failure (network, rate limit): keep the pick. The send path
      // retries, and blocking a choice on a blip helps nobody.
      ai.prewarm(true).catch(() => {});
      return { ok: true, model: picked, warning: verdict.error || '' };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  // Custom base URL for the active provider (e.g. a self-hosted OpenAI-compatible
  // endpoint). Blank means the provider default.
  ipcMain.handle('dex:ai-baseurl-set', (e, baseUrl) => {
    needChrome(e);
    try {
      ai.save({ baseUrl: String(baseUrl || '') });
      return ai.status();
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  // Provider switch: every provider keeps its own encrypted key and model.
  // No key is copied between providers and nothing is sent anywhere by this
  // call — only the next explicit test/send uses the selected provider.
  ipcMain.handle('dex:ai-provider-set', (e, id) => {
    needChrome(e);
    try {
      const st = ai.setProvider(String(id || ''));
      if (st.hasKey) ai.prewarm(false).catch(() => {});
      return st;
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  ipcMain.handle('dex:ai-routing-set', (e, patch) => {
    needChrome(e);
    try { return ai.setRouting(patch && typeof patch === 'object' ? patch : {}); }
    catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });
  // Background warm-up: opens the TLS connection and gets the model resident
  // before the user's first real message. Safe to call repeatedly; it is a
  // single 1-token request and is skipped while already warm.
  ipcMain.handle('dex:ai-prewarm', async (e) => {
    needChrome(e);
    return await ai.prewarm(false).catch((err) => ({ ok: false, error: String(err && err.message || err) }));
  });
  // Stay-warm while the browser is in use: regaining window focus (after an
  // idle stretch) and a slow tick both ask the assistant to refresh its
  // connection — one 1-token request, skipped when freshly warmed, offline,
  // unkeyed, or after a failure. Test harnesses never fire it.
  function keepWarmNow() {
    if (process.env.DEX_AI_TEST === '1') return;
    try { ai.keepWarm().catch(() => {}); } catch {}
  }
  try { app.on('browser-window-focus', keepWarmNow); } catch {}
  // Adaptive keep-warm: one self-rearming timeout instead of a fixed 60 s
  // poll. keepWarm() itself still enforces its 3 min TTL + backoff, so the
  // AI stays warm exactly as before; on battery or a suspended window the
  // poll simply slows down and stops burning wakeups.
  let keepWarmTimer = null;
  function scheduleKeepWarm() {
    if (keepWarmTimer) clearTimeout(keepWarmTimer);
    const stretch = (power.plan && power.plan.gpuTier === 'suspended') || power.onBattery ? 3 : 1;
    keepWarmTimer = setTimeout(() => {
      keepWarmTimer = null;
      try { if (BrowserWindow.getFocusedWindow()) keepWarmNow(); } catch {}
      scheduleKeepWarm();
    }, 60000 * stretch);
    if (keepWarmTimer.unref) keepWarmTimer.unref();
  }
  scheduleKeepWarm();
  // ---------- Page reading (Phase 1: scAI exact extract process) ----------
  // The snapshot runs in the active tab via executeJavaScript — the
  // WebContentsView equivalent of scAI's scripting.executeScript injection.
  // Read-only: no DOM mutation, no navigation, key never leaves main.
  ipcMain.handle('dex:ai-page-get', (e) => {
    const { A } = Aof(e);
    return pagePrefs(A);
  });
  ipcMain.handle('dex:ai-page-set', (e, patch) => {
    const { st, A } = Aof(e);
    const cur = pagePrefs(A);
    const p = (patch && typeof patch === 'object') ? patch : {};
    A.aiPage = {
      usePage: p.usePage === undefined ? cur.usePage : Boolean(p.usePage),
      fullPage: p.fullPage === undefined ? cur.fullPage : Boolean(p.fullPage),
      contextChars: p.contextChars === undefined ? cur.contextChars
        : Math.max(1000, Math.min(60000, parseInt(p.contextChars, 10) || 12000)),
      useSelection: p.useSelection === undefined ? cur.useSelection : Boolean(p.useSelection),
    };
    // Page reading and the eye button are one capability. Keep both homes in
    // step whether the change came from Settings or the visible toggle.
    if (p.usePage !== undefined) setAiCap(A, 'vision', Boolean(p.usePage));
    saveAcc(st.accountId);
    if (p.usePage !== undefined) broadcastCaps(st.accountId);
    return A.aiPage;
  });
  // User-owned capability switches behind the lightning/eye buttons and the
  // website/document settings. Main is the only writer; a model can only ask.
  ipcMain.handle('dex:ai-caps-get', (e) => {
    const { A } = Aof(e);
    return aiCaps(A);
  });
  ipcMain.handle('dex:ai-caps-set', (e, patch) => {
    const { st, A } = Aof(e);
    const p = (patch && typeof patch === 'object') ? patch : {};
    for (const cap of AI_CAP_KEYS) {
      if (p[cap] !== undefined) setAiCap(A, cap, Boolean(p[cap]));
    }
    saveAcc(st.accountId);
    broadcastCaps(st.accountId);
    return aiCaps(A);
  });
  ipcMain.handle('dex:ai-cap-decide', (e, { id, allow } = {}) => {
    needChrome(e);
    const waiter = capWaiters.get(String(id || ''));
    if (!waiter) return { ok: false, error: 'That request already ended.' };
    if (allow === true) {
      const A = accData(waiter.accountId);
      setAiCap(A, waiter.cap, true);
      saveAcc(waiter.accountId);
      broadcastCaps(waiter.accountId);
    }
    settleCapAsk(id, allow === true);
    return { ok: true, capability: waiter.cap, enabled: allow === true };
  });
  // Per-site switch for the active tab: off means the assistant refuses to
  // read or act there until the person turns it back on.
  ipcMain.handle('dex:ai-site-get', (e) => {
    const { st, A } = Aof(e);
    const host = siteHost(activeTabUrl(st));
    return { host, off: host ? aiOffSites(A).includes(host) : false };
  });
  ipcMain.handle('dex:ai-site-set', (e, patch) => {
    const { st, A } = Aof(e);
    const p = (patch && typeof patch === 'object') ? patch : {};
    const host = siteHost(activeTabUrl(st));
    if (!host) return { host: '', off: false };
    setSiteAiOff(A, host, p.off === true);
    saveAcc(st.accountId);
    return { host, off: p.off === true };
  });
  // Reads the active tab with the full scAI process (sweep, snapshot, video
  // transcripts). Shared by the Read-page IPC and the page skill executors.
  async function readActivePage(st, A) {
    const winId = st.id;
    const tabId = st.active;
    // Re-resolve the tab on every step: closeTab() destroys the WebContents
    // while the sweep/extract awaits below are still in flight. Holding the
    // original `wc` across those awaits is a use-after-free — the second
    // executeJavaScript / getTitle then runs on a destroyed WebContents and
    // crashes the main process. A fresh lookup aborts cleanly instead.
    const live = () => {
      const curSt = windows.get(winId);
      const curT = curSt && curSt.tabs.get(tabId);
      const curWc = curT && curT.view && curT.view.webContents;
      if (!curSt || curSt.win.isDestroyed() || !curT || !curWc || curWc.isDestroyed()) return null;
      return { curT, curWc };
    };
    let first = live();
    if (!first) return { ok: false, error: 'No active tab.' };
    let url = '';
    try { url = first.curWc.getURL() || first.curT.url || ''; } catch { url = first.curT.url || ''; }
    if (siteAiOff(A, url)) {
      let title = '';
      try { title = first.curWc.getTitle() || first.curT.title || ''; } catch { title = first.curT.title || ''; }
      return {
        ok: false,
        error: 'Dexerion AI is off for ' + siteHost(url) + '. Turn it back on in Assistant settings.',
        url, title,
      };
    }
    if (aiPage.isUnreadable(url)) {
      let title = '';
      try { title = first.curWc.getTitle() || first.curT.title || ''; } catch { title = first.curT.title || ''; }
      return {
        ok: false,
        error: 'Dexerion Assistant can\'t read this page (' + (url || 'unknown') + '). Browser-internal and local-file pages are off limits.',
        url, title,
      };
    }
    const safeExec = (js, ms, what) => {
      const got = live();
      if (!got) return Promise.reject(new Error('The tab was closed.'));
      let timer = null;
      const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(what || 'timed out')), ms); });
      return Promise.race([
        got.curWc.executeJavaScript(js).catch((err) => {
          // The tab died mid-execution: report closure, not a read failure.
          if (!live()) throw new Error('The tab was closed.');
          throw err;
        }),
        timeout,
      ]).finally(() => { if (timer) clearTimeout(timer); });
    };
    try {
      // YouTube: the caption list is the real page text and needs one click to
      // open. Try it first; a video without captions falls through to the
      // normal read (title, description and any structured data still help).
      if (aiPage.isYouTubeWatch(url)) {
        let transcript = null;
        try { transcript = await safeExec(aiPage.youtubeTranscriptScript(), 15000, 'transcript timed out'); } catch { transcript = null; }
        if (transcript && transcript.ok && Array.isArray(transcript.segments) && transcript.segments.length) {
          const text = transcript.segments.join('\n').slice(0, 200000);
          const data = {
            ok: true,
            url,
            title: transcript.title || '',
            description: '',
            outline: '',
            selection: '',
            text: '[Video transcript]\n' + text,
            fullText: text,
          };
          const context = aiPage.buildPageContext(data, pagePrefs(A));
          return { ok: true, url, title: data.title, context, selection: '' };
        }
      }
      // Whole page, not just the viewport: sweep top-to-bottom first so
      // lazy/below-fold content renders into the DOM, then extract with the
      // exact scAI process. The sweep restores the user's scroll position
      // and is best effort — it never blocks the read.
      try {
        await safeExec('(' + aiPage.pageSweep.toString() + ')()', 8000, 'sweep timed out');
      } catch {}
      if (!live()) return { ok: false, error: 'The tab was closed.', url };
      const data = await safeExec(aiPage.snapshotScript(), 20000, 'timed out');
      if (!live()) return { ok: false, error: 'The tab was closed.', url };
      if (!data || !data.ok) throw new Error('The page returned no readable content.');
      const context = aiPage.buildPageContext(data, pagePrefs(A));
      let title = data.title || '';
      if (!title) {
        const got = live();
        if (got) { try { title = got.curWc.getTitle() || got.curT.title || ''; } catch { title = got.curT.title || ''; } }
      }
      return { ok: true, url: data.url || url, title, context, selection: data.selection || '' };
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      if (/tab was closed/i.test(msg)) return { ok: false, error: 'The tab was closed.', url };
      return { ok: false, error: 'Could not read the page: ' + msg, url };
    }
  }
  ipcMain.handle('dex:ai-read-page', async (e) => {
    const { st, A } = Aof(e);
    return readActivePage(st, A);
  });
  // All-tabs inspection for the Read button: the same workflow as the agent's
  // inspect_tabs tool, with per-tab progress pushed to this window. Reads
  // every discovered tab individually (in tab order, never substituted) and
  // returns the consolidated report; tabs it cannot read are recorded as
  // failures and the sweep continues.
  ipcMain.handle('dex:ai-inspect-tabs', async (e, { reqId } = {}) => {
    const { st, A } = Aof(e);
    const id = String(reqId || Date.now());
    if (st.agentRunId) {
      return { ok: false, reqId: id, error: 'Dexerion AI is running a task in this window — try again when it finishes.' };
    }
    const report = await inspectAllTabs({
      key: 'win:' + st.id,
      account: A,
      includeText: false,
      onProgress: (p) => {
        try { st.win.webContents.send('dex:ai-inspect-progress', { reqId: id, ...p }); } catch {}
      },
    });
    if (!report.ok) return { ok: false, reqId: id, error: report.error };
    const text = research.inspectionReportText(report, { perTabText: 240 });
    return { ok: true, reqId: id, report, text, counts: report.counts };
  });
  // Confirms the key with a real 1-token completion, so a dead key or a retired
  // model is caught at connect time rather than mid-chat.
  ipcMain.handle('dex:ai-test', async (e) => {
    needChrome(e);
    try {
      const r = await ai.test();
      // A successful 1-token completion already left the model resident.
      ai.prewarm(false).catch(() => {});
      return { ok: true, ...r };
    } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });
  // Streamed deltas arrive per token; coalescing them into ~30ms IPC batches
  // keeps the payload shape ({ reqId, delta, full }) identical for every
  // consumer while cutting message count — and the repeated serialisation of
  // the cumulative `full` string — by an order of magnitude on long replies.
  function makeChunkBatcher(send, reqId) {
    let delta = '', full = '', timer = null;
    const flush = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (!delta) return;
      const payload = { reqId, delta, full };
      delta = '';
      try { send(payload); } catch {}
    };
    return {
      push(d, f) {
        delta += String(d || '');
        if (f != null) full = String(f);
        if (!timer) timer = setTimeout(flush, 30);
      },
      flush,
    };
  }
  // ---------- skill loop wiring (Phase 1 rework) ----------------------------
  // One consent queue per app; the loop asks through it and the conversation
  // answers via dex:ai-skill-decide. Every outcome lands in the audit ring,
  // and the executors below turn a decided skill into a real browser action.
  // Capabilities are the user-owned switches behind the lightning and eye
  // buttons. A model may ask for one; it can never switch one on by itself.
  const AI_CAP_KEYS = ['agent', 'vision', 'websites', 'documents'];
  const SKILL_CAPABILITIES = {
    // `agent` stays a normal tier-2 action so its per-run consent and audit
    // record are unchanged. `enable_agent` is the one-card request for the
    // persistent lightning switch.
    enable_agent: 'agent',
    use_vision: 'vision',
    open_website: 'websites',
    edit_document: 'documents',
  };
  const AI_CAP_LABELS = {
    agent: 'Agent mode',
    vision: 'Vision',
    websites: 'Website access',
    documents: 'Document editing',
  };
  function aiCaps(A) {
    const p = (A && A.aiCaps && typeof A.aiCaps === 'object') ? A.aiCaps : {};
    return {
      // Existing profiles enabled these through the older aiAgent/aiPage
      // switches. Treat those as already granted so an upgrade never silently
      // turns a working feature off.
      agent: p.agent === undefined
        ? Boolean(A && A.aiAgent && A.aiAgent.agent === true)
        : p.agent === true,
      vision: p.vision === undefined
        ? Boolean(A && A.aiPage && A.aiPage.usePage === true)
        : p.vision === true,
      websites: p.websites === true,
      documents: p.documents === true,
    };
  }
  function setAiCap(A, cap, on) {
    if (!AI_CAP_KEYS.includes(cap) || !A) return false;
    if (!A.aiCaps || typeof A.aiCaps !== 'object') A.aiCaps = {};
    A.aiCaps[cap] = Boolean(on);
    // The older homes stay in step: settings, page reading and agent runs all
    // still read them, so the lightning/eye buttons must never disagree.
    if (cap === 'agent') {
      if (!A.aiAgent || typeof A.aiAgent !== 'object') A.aiAgent = {};
      A.aiAgent.agent = Boolean(on);
    }
    if (cap === 'vision') {
      if (!A.aiPage || typeof A.aiPage !== 'object') A.aiPage = {};
      A.aiPage.usePage = Boolean(on);
    }
    return true;
  }
  const approvals = createApprovals({ timeoutMs: SKILL_ASK_TIMEOUT_MS });
  const capWaiters = new Map(); // ask id -> { accountId, winId, cap, resolve, timer }

  function settleCapAsk(id, ok) {
    const waiter = capWaiters.get(String(id || ''));
    if (!waiter) return false;
    capWaiters.delete(String(id || ''));
    if (waiter.timer) clearTimeout(waiter.timer);
    waiter.resolve(Boolean(ok));
    return true;
  }
  function clearCapAsks(winId) {
    for (const [id, waiter] of [...capWaiters]) {
      if (waiter.winId !== winId) continue;
      capWaiters.delete(id);
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve(false);
    }
  }
  function broadcastCaps(accountId) {
    const caps = aiCaps(accData(accountId));
    for (const st of windows.values()) {
      if (!st || st.accountId !== accountId || st.win.isDestroyed()) continue;
      try { st.win.webContents.send('dex:ai-caps-updated', caps); } catch {}
    }
  }
  // A capability request is always a question, never a silent grant. The card
  // uses the same consent box as skills; "Turn on" persists the switch for this
  // account until the person turns it off again. No "always" tier exists here.
  function askCapability(st, A, cap, reqId, what, why) {
    if (!AI_CAP_KEYS.includes(cap) || !st || st.win.isDestroyed()) return Promise.resolve(false);
    if (aiCaps(A)[cap]) return Promise.resolve(true);
    const id = 'cap-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    const label = AI_CAP_LABELS[cap] || cap;
    try {
      st.win.webContents.send('dex:ai-skill', {
        reqId: String(reqId || st.aiRequestId || ''),
        type: 'capability-ask',
        id,
        capability: cap,
        label,
        what: what || ('Turn on ' + label + '?'),
        why: why || ('Dexerion AI asked to use ' + label + '. It stays on until you turn it off.'),
      });
    } catch { return Promise.resolve(false); }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        capWaiters.delete(id);
        resolve(false);
        try {
          st.win.webContents.send('dex:ai-skill', {
            reqId: String(reqId || st.aiRequestId || ''), type: 'capability-expired', id,
          });
        } catch {}
      }, SKILL_ASK_TIMEOUT_MS);
      capWaiters.set(id, { winId: st.id, accountId: st.accountId, cap, resolve, timer });
    });
  }
  const skillWaiters = new Map(); // request id -> { resolve, timer }

  function settleSkillAsk(id, decision) {
    const waiter = skillWaiters.get(id);
    if (!waiter) return;
    skillWaiters.delete(id);
    if (waiter.timer) clearTimeout(waiter.timer);
    waiter.resolve(decision || { allow: false, scope: 'deny' });
  }

  // Denies and settles the pending cards for one window (stop or a new send),
  // so no loop ever waits on a card the person can no longer see.
  function clearSkillAsks(winId) {
    clearCapAsks(winId);
    for (const entry of approvals.list()) {
      if (entry.winId !== winId) continue;
      const decided = approvals.decide(entry.id, false, 'deny');
      if (decided) settleSkillAsk(entry.id, decided);
    }
  }

  async function askSkill(st, entry) {
    const A = accData(st.accountId);
    const cap = SKILL_CAPABILITIES[entry.skill];
    if (cap && !aiCaps(A)[cap]) {
      // Turning the switch on IS the consent for this one call. The person
      // gets one card, not "turn it on" followed by "run it again".
      const ok = await askCapability(
        st, A, cap, st.aiRequestId,
        'Turn on ' + AI_CAP_LABELS[cap] + '?',
        'Dexerion AI asked to use ' + AI_CAP_LABELS[cap] + ' for this task. It stays on until you turn it off.'
      );
      return ok
        ? { allow: true, scope: 'once', capabilityGranted: cap }
        : { allow: false, scope: 'deny' };
    }
    const req = approvals.request({
      winId: st.id,
      chatId: st.aiRequestChatId || '',
      skill: entry.skill,
      args: entry.args,
      why: entry.why,
      tier: entry.tier,
    });
    if (req.auto) return { allow: true, scope: 'always' };
    const skill = skills.skillOf(entry.skill);
    try {
      st.win.webContents.send('dex:ai-skill', {
        reqId: st.aiRequestId,
        type: 'skill-ask',
        id: req.id,
        skill: entry.skill,
        label: skill ? skill.name : entry.skill,
        desc: skill ? skill.description : '',
        args: entry.args,
        why: entry.why,
        tier: entry.tier,
      });
    } catch {}
    return await new Promise((resolve) => {
      const timer = setTimeout(() => {
        const decided = approvals.decide(req.id, false, 'timeout');
        if (!decided) return;
        settleSkillAsk(req.id, decided);
        try { st.win.webContents.send('dex:ai-skill', { reqId: st.aiRequestId, type: 'skill-ask-expired', id: req.id }); } catch {}
      }, SKILL_ASK_TIMEOUT_MS);
      skillWaiters.set(req.id, { resolve, timer });
    });
  }

  // Executors: what a skill actually does. Implemented skills return
  // { ok, result, summary }; the rest answer honestly so the model can
  // continue without them instead of a silent failure.
  function pageTextOf(context) {
    if (!context || typeof context.text !== 'string' || !context.text) return '';
    return 'Source: ' + (context.label || 'the current page') + '\n\n' + context.text;
  }

  // A minimal standalone document for main-side exports (the report view's
  // own export keeps the rich renderer HTML; this covers the skill path).
  function reportHtmlFor(artifact, markdown) {
    const esc = (value) => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(artifact.title)
      + '</title></head><body><pre style="white-space:pre-wrap;font:14px/1.6 system-ui,sans-serif">'
      + esc(markdown) + '</pre></body></html>';
  }



  // WebContentsView has no capture surface of its own: the debugger protocol is
  // the same path the self-test pageShot helper uses. Shared by the vision
  // skill and the agent's screenshot tool so both honour the same eye switch.
  async function captureTabImage(wc) {
    if (!wc || wc.isDestroyed()) return '';
    try {
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
      try {
        const res = await wc.debugger.sendCommand('Page.captureScreenshot', { format: 'png' });
        return res && res.data ? 'data:image/png;base64,' + res.data : '';
      } finally {
        try { wc.debugger.detach(); } catch {}
      }
    } catch { return ''; }
  }

  async function runSkill(st, A, skill, args) {
    const params = args || {};
    switch (skill) {
      case 'read_page':
      case 'summarise_page': {
        const page = await readActivePage(st, A);
        if (!page.ok) return { ok: false, error: page.error };
        const text = pageTextOf(page.context);
        if (!text) return { ok: false, error: 'The page had no readable text.' };
        const focus = skill === 'summarise_page' && params.focus ? 'Focus: ' + params.focus + '\n\n' : '';
        return { ok: true, result: focus + text, summary: 'Read "' + (page.title || page.url || 'the page') + '"' };
      }
      case 'read_selection': {
        const page = await readActivePage(st, A);
        if (!page.ok) return { ok: false, error: page.error };
        const selection = String(page.selection || '').trim();
        if (!selection) return { ok: false, error: 'Nothing is selected on the page.' };
        return { ok: true, result: selection, summary: 'Read the selection' };
      }
      case 'search_web': {
        const query = String(params.query || '').trim();
        if (!query) return { ok: false, error: 'A search query is required.' };
        // The one search pipeline: plan -> structured retrieval -> denylist ->
        // reads. The skill gets the numbered material; the model writes the
        // answer with citations to pages that were actually read.
        const gathered = await searchRef().gather({
          reqId: 'skill:' + String(st.aiRequestId || Date.now()),
          winId: st.id,
          query,
          mode: params.mode === 'quick' ? 'quick' : 'deep',
          history: [],
        });
        if (!gathered.ok) return { ok: false, error: gathered.error || 'The search could not run.' };
        if (gathered.cancelled) return { ok: false, error: 'The search was stopped.' };
        if (!gathered.sources || !gathered.sources.length) return { ok: false, error: 'No pages could be read for that search — the evidence is thin.' };
        const unread = Array.isArray(gathered.unread) ? gathered.unread.length : 0;
        return {
          ok: true,
          result: aiSearchSynth.sourcesText(gathered.sources)
            + (unread ? '\n\n(' + unread + ' more page' + (unread === 1 ? '' : 's') + ' could not be read.)' : ''),
          summary: 'Read ' + gathered.sources.length + ' source' + (gathered.sources.length === 1 ? '' : 's'),
        };
      }
      case 'remember': {
        if (!Array.isArray(A.memory)) A.memory = [];
        const { list, added, reason } = ai.addMemory(A.memory, params.fact);
        A.memory = list;
        saveAcc(st.accountId);
        memBump(st.accountId);
        broadcastMemory(st.accountId, A.memory);
        if (!added) {
          return { ok: false, error: reason === 'duplicate' ? 'That fact is already remembered.' : 'Memory is full — forget something first.' };
        }
        return { ok: true, result: 'Saved to memory: ' + params.fact, summary: 'Remembered a fact' };
      }
      case 'forget': {
        if (!Array.isArray(A.memory)) A.memory = [];
        const { list, removed } = ai.removeMemory(A.memory, params.query);
        A.memory = list;
        saveAcc(st.accountId);
        memBump(st.accountId);
        broadcastMemory(st.accountId, A.memory);
        if (!removed.length) return { ok: false, error: 'Nothing in memory matches "' + params.query + '".' };
        return { ok: true, result: 'Forgot ' + removed.length + (removed.length === 1 ? ' memory' : ' memories') + '.', summary: 'Forgot a memory' };
      }
      case 'read_tabs': {
        // Default is the current tab; a query matches titles/URLs and can read
        // up to three tabs. Off-site and unreadable tabs are skipped with a
        // reason instead of failing the whole read.
        const wanted = String(params.tabs || '').trim().toLowerCase();
        const order = [st.active].concat(st.order.filter((id) => id !== st.active));
        const picks = [];
        for (const id of order) {
          const t = st.tabs.get(id);
          if (!t) continue;
          const url = String(t.url || '');
          if (!/^https?:/i.test(url)) continue;
          if (wanted && !((String(t.title || '') + ' ' + url).toLowerCase().includes(wanted))) continue;
          picks.push({ id, url, title: String(t.title || url) });
          if (picks.length >= (wanted ? 3 : 1)) break;
        }
        if (!picks.length) {
          return { ok: false, error: wanted ? 'No open tab matches "' + params.tabs + '".' : 'No readable tab is active.' };
        }
        const parts = [];
        const skipped = [];
        let budget = 18000;
        for (const pick of picks) {
          if (budget <= 0) break;
          if (pick.id !== st.active && siteAiOff(A, pick.url)) {
            skipped.push(pick.title + ' (AI is off for that site)');
            continue;
          }
          try {
            let text = '';
            let title = pick.title;
            if (pick.id === st.active) {
              const page = await readActivePage(st, A);
              if (!page.ok) { skipped.push(pick.title + ' (' + page.error + ')'); continue; }
              text = String((page.context && page.context.text) || '');
              title = page.title || pick.title;
            } else {
              // The shared tab reader: wakes sleeping tabs and re-resolves the
              // id at call time; the gate re-checks per-site AI off.
              const read = await readTabById(pick.id, { gate: (target) => !siteAiOff(A, target) });
              if (!read || !read.ok) {
                skipped.push(pick.title + ' (' + ((read && (read.error || read.reason)) || 'could not be read') + ')');
                continue;
              }
              text = String(read.text || '');
              title = read.title || pick.title;
            }
            text = text.trim();
            if (!text) { skipped.push(title + ' (nothing readable)'); continue; }
            const take = Math.min(text.length, 6000, budget);
            budget -= take;
            parts.push('## ' + title + '\n' + pick.url + '\n' + text.slice(0, take));
          } catch (err) {
            skipped.push(pick.title + ' (' + String((err && err.message) || err) + ')');
          }
        }
        if (!parts.length) return { ok: false, error: 'Could not read a tab: ' + (skipped.join('; ') || 'no readable text') };
        return {
          ok: true,
          result: parts.join('\n\n---\n\n') + (skipped.length ? '\n\n(Skipped: ' + skipped.join('; ') + ')' : ''),
          summary: 'Read ' + parts.length + ' tab' + (parts.length === 1 ? '' : 's'),
        };
      }
      case 'read_video': {
        const target = String(params.url || '').trim() || activeTabUrl(st);
        if (!aiPage.isYouTubeWatch(target)) return { ok: false, error: 'That is not a YouTube video page.' };
        // The active tab goes through the shared reader, which already prefers
        // the transcript; anything else opens a quiet background tab.
        if (target === activeTabUrl(st)) {
          const page = await readActivePage(st, A);
          if (!page.ok) return { ok: false, error: page.error };
          const text = pageTextOf(page.context);
          if (!/\[Video transcript\]/.test(text)) return { ok: false, error: 'No transcript is available for this video.' };
          return { ok: true, result: text.slice(0, 24000), summary: 'Read the video transcript' };
        }
        if (siteAiOff(A, target)) return { ok: false, error: 'Dexerion AI is off for ' + siteHost(target) + '.' };
        let tabId = null;
        try {
          tabId = newTab(st.id, target, true);
          const wc = workTabContents(st.id, tabId);
          if (!wc) return { ok: false, error: 'The video tab closed.' };
          await waitForTabLoad(wc, 15000);
          const transcript = await execInTab(wc, aiPage.youtubeTranscriptScript(), 15000);
          if (!transcript || !transcript.ok || !Array.isArray(transcript.segments) || !transcript.segments.length) {
            return { ok: false, error: 'No transcript is available for this video.' };
          }
          return { ok: true, result: '[Video transcript]\n' + transcript.segments.join('\n').slice(0, 24000), summary: 'Read the video transcript' };
        } finally {
          if (tabId) { try { closeTab(st.id, tabId); } catch {} }
        }
      }
      case 'read_history': {
        const query = String(params.query || '').trim().toLowerCase();
        if (!query) return { ok: false, error: 'A search query is required.' };
        const afterMs = params.after ? (Date.parse(String(params.after)) || 0) : 0;
        const beforeMs = params.before ? (Date.parse(String(params.before)) || Infinity) : Infinity;
        const list = Array.isArray(A.history) ? A.history : [];
        const hits = [];
        for (const h of list) {
          if (!h || !h.url) continue;
          const at = Number(h.at) || 0;
          if (at && (at < afterMs || at > beforeMs)) continue;
          if (!((String(h.title || '') + ' ' + h.url).toLowerCase().includes(query))) continue;
          hits.push(h);
          if (hits.length >= 10) break;
        }
        if (!hits.length) return { ok: false, error: 'Nothing in the history matches "' + params.query + '".' };
        const lines = hits.map((h) => '- ' + (h.title || h.url) + ' — ' + h.url + (h.at ? ' (' + new Date(h.at).toISOString().slice(0, 10) + ')' : ''));
        return { ok: true, result: 'History matches:\n' + lines.join('\n'), summary: 'Found ' + hits.length + ' history match' + (hits.length === 1 ? '' : 'es') };
      }
      case 'read_pdf': {
        // PDF reading: the active tab or an attached file. PDF.js is vendored
        // (assets/pdf/pdf.min.mjs + worker). Text extraction runs in the tab
        // renderer so the main process never touches the file bytes directly.
        const target = String(params.url || '').trim() || activeTabUrl(st);
        if (!target) return { ok: false, error: 'No PDF URL or file is available.' };
        if (!/^https?:\/\//i.test(target) && !/^file:\/\//i.test(target)) return { ok: false, error: 'Only http(s) and file:// PDFs can be read.' };
        if (siteAiOff(A, target)) return { ok: false, error: 'Dexerion AI is off for ' + siteHost(target) + '.' };
        const tabId = newTab(st.id, target, true);
        const wc = workTabContents(st.id, tabId);
        if (!wc) return { ok: false, error: 'The PDF tab closed.' };
        try {
          await waitForTabLoad(wc, 20000);
          const pagesParam = params.pages && String(params.pages).trim() ? String(params.pages) : '';
          const text = await execInTab(wc, aiPage.pdfExtractScript(pagesParam), 30000);
          if (!text || !text.ok) return { ok: false, error: text && text.error ? text.error : 'The PDF had no readable text.' };
          return { ok: true, result: '[PDF]\n' + String(text.text || '').slice(0, 24000), summary: 'Read the PDF' };
        } finally {
          try { closeTab(st.id, tabId); } catch {}
        }
      }
      case 'read_chats': {
        const query = String(params.query || '').trim().toLowerCase();
        if (!query) return { ok: false, error: 'A search query is required.' };
        const afterMs = params.after ? (Date.parse(String(params.after)) || 0) : 0;
        const hits = [];
        for (const chat of chatStore(st, A).list) {
          const updated = Number(chat.updatedAt || chat.createdAt) || 0;
          if (updated && updated < afterMs) continue;
          let snippet = '';
          if (String(chat.title || '').toLowerCase().includes(query)) snippet = 'title match';
          if (!snippet) {
            for (const m of chat.messages || []) {
              if (m && String(m.text || '').toLowerCase().includes(query)) { snippet = String(m.text).slice(0, 300); break; }
            }
          }
          if (!snippet) continue;
          hits.push('- "' + String(chat.title || 'Untitled') + '"' + (updated ? ' (' + new Date(updated).toISOString().slice(0, 10) + ')' : '') + (snippet !== 'title match' ? ': ' + snippet : ''));
          if (hits.length >= 5) break;
        }
        if (!hits.length) return { ok: false, error: 'No past chat matches "' + params.query + '".' };
        return { ok: true, result: 'Past chats:\n' + hits.join('\n'), summary: 'Found ' + hits.length + ' chat' + (hits.length === 1 ? '' : 's') };
      }
      case 'read_files': {
        const query = String(params.query || '').trim().toLowerCase();
        const out = [];
        for (const chat of chatStore(st, A).list) {
          for (const message of chat.messages || []) {
            const art = message && message.artifact;
            if (!art || art.kind !== 'report') continue;
            const title = String(art.title || 'Report');
            if (query && !title.toLowerCase().includes(query)) continue;
            out.push({ title, updatedAt: Number(chat.updatedAt || chat.createdAt) || 0 });
          }
        }
        out.sort((a, b) => b.updatedAt - a.updatedAt);
        const top = out.slice(0, 10);
        if (!top.length) {
          return { ok: false, error: query ? 'No report matches "' + params.query + '".' : 'No reports have been made yet.' };
        }
        const lines = top.map((r) => '- ' + r.title + (r.updatedAt ? ' (' + new Date(r.updatedAt).toISOString().slice(0, 10) + ')' : ''));
        return { ok: true, result: 'Reports (open one from the Files page):\n' + lines.join('\n'), summary: 'Found ' + top.length + ' report' + (top.length === 1 ? '' : 's') };
      }
      case 'open_settings': {
        newTab(st.id, 'dexerion://settings', false);
        return { ok: true, result: 'Opened Assistant settings in a new tab.', summary: 'Opened settings' };
      }
      case 'open_files': {
        newTab(st.id, 'dexerion://files', false);
        return { ok: true, result: 'Opened the Files page in a new tab.', summary: 'Opened Files' };
      }
      case 'set_site_off': {
        const host = siteHost(activeTabUrl(st));
        if (!host) return { ok: false, error: 'No active site to switch.' };
        setSiteAiOff(A, host, params.off === true);
        saveAcc(st.accountId);
        const state = params.off === true ? 'off' : 'back on';
        return { ok: true, result: 'Dexerion AI is now ' + state + ' for ' + host + '.', summary: 'Turned AI ' + state + ' for ' + host };
      }
      case 'show_usage': {
        const prefs = aiUiPrefs(A);
        const next = typeof params.on === 'boolean' ? params.on : !prefs.showUsage;
        A.aiUi = Object.assign({}, A.aiUi || {}, { showUsage: next, aiLayout: prefs.aiLayout, width: prefs.width, saveChats: prefs.saveChats });
        saveAcc(st.accountId);
        return { ok: true, result: 'Token usage under replies is now ' + (next ? 'on' : 'off') + '.', summary: (next ? 'Turned usage on' : 'Turned usage off') };
      }
      case 'set_conversation_saving': {
        const prefs = aiUiPrefs(A);
        const next = Boolean(params.save);
        A.aiUi = Object.assign({}, A.aiUi || {}, { showUsage: prefs.showUsage, aiLayout: prefs.aiLayout, width: prefs.width, saveChats: next });
        saveAcc(st.accountId);
        return { ok: true, result: 'Saving conversations on this device is now ' + (next ? 'on' : 'off') + '.', summary: (next ? 'Turned saving on' : 'Turned saving off') };
      }
      case 'show_skill_log': {
        const rows = approvals.log().slice(-20);
        if (!rows.length) return { ok: true, result: 'No skills have run yet.', summary: 'The skill log is empty' };
        const lines = rows.map((r) => '- ' + new Date(r.at).toISOString().slice(0, 16).replace('T', ' ')
          + ' · ' + (r.skill || 'invalid request') + ' · ' + r.decision + ' · ' + (r.ok ? 'ok' : 'failed')
          + (r.ms ? ' · ' + r.ms + 'ms' : ''));
        return { ok: true, result: 'Recent skill runs (newest last):\n' + lines.join('\n'), summary: 'Showed ' + rows.length + ' recent skill runs' };
      }
      case 'new_chat': {
        const store = chatStore(st, A);
        const chat = newChat('New chat');
        store.list.unshift(chat);
        store.persist();
        store.notify();
        st.aiPending = { kind: 'chat', chatId: chat.id, at: Date.now() };
        st.aiOpen = true;
        layout(st.id);
        try { st.win.webContents.send('dex:ai-open'); } catch {}
        return { ok: true, result: 'Started a new conversation.', summary: 'Started a new chat' };
      }
      case 'rename_chat': {
        const title = String(params.title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        if (!title) return { ok: false, error: 'A title is required.' };
        const store = chatStore(st, A);
        const chat = store.find(st.aiRequestChatId);
        if (!chat) return { ok: false, error: 'No conversation is open.' };
        chat.title = title;
        chat.titleEdited = true;
        chat.updatedAt = Date.now();
        store.persist();
        store.notify();
        return { ok: true, result: 'Renamed this chat to "' + title + '".', summary: 'Renamed the chat' };
      }
      case 'delete_chat': {
        const store = chatStore(st, A);
        const chat = store.find(st.aiRequestChatId);
        if (!chat) return { ok: false, error: 'No conversation is open.' };
        const index = store.list.indexOf(chat);
        if (index >= 0) store.list.splice(index, 1);
        store.persist();
        store.notify();
        return { ok: true, result: 'Deleted the conversation.', summary: 'Deleted the chat' };
      }
      case 'group_tabs': {
        // Group by site: two or more open tabs from one host become one named
        // group (colour cycles through the strip palette). The instructions
        // argument names the groups when given, otherwise each group takes the
        // site's own name.
        const named = String(params.instructions || '').replace(/\s+/g, ' ').trim().slice(0, 60);
        const byHost = new Map();
        for (const id of st.order) {
          const t = st.tabs.get(id);
          if (!t) continue;
          const url = String(t.url || '');
          if (!/^https?:/i.test(url)) continue;
          const host = hostOf(url);
          if (!host) continue;
          if (!byHost.has(host)) byHost.set(host, []);
          byHost.get(host).push(id);
        }
        const hosts = [...byHost.entries()].filter(([, ids]) => ids.length >= 2);
        if (!hosts.length) return { ok: false, error: 'No two open tabs share a site, so there is nothing to group.' };
        let made = 0;
        for (const [host, ids] of hosts.slice(0, 5)) {
          const gid = newGroupId(st);
          st.groups.set(gid, { id: gid, name: named || host, color: GROUP_COLORS[st.groups.size % GROUP_COLORS.length] });
          for (const id of ids) {
            const t = st.tabs.get(id);
            if (t) { t.groupId = gid; settleInGroup(st, id, gid); }
          }
          made += 1;
        }
        sweepGroups(st);
        pushState(st.id);
        persistSoon();
        return { ok: true, result: 'Grouped ' + made + ' site' + (made === 1 ? '' : 's') + ' into tab groups.', summary: 'Grouped tabs by site' };
      }
      case 'close_tabs': {
        const scope = ['finished', 'duplicates', 'all-unpinned'].includes(params.scope) ? params.scope : 'finished';
        const victims = [];
        const seenUrls = new Set();
        for (const id of st.order) {
          if (id === st.active) continue;
          const t = st.tabs.get(id);
          if (!t) continue;
          if (scope === 'all-unpinned') { victims.push(id); continue; }
          if (scope === 'duplicates') {
            const key = String(t.url || '').split('#')[0];
            if (!/^https?:/i.test(key)) continue;
            if (seenUrls.has(key)) victims.push(id);
            else seenUrls.add(key);
            continue;
          }
          // "Finished" = the memory saver already slept it (idle long enough to
          // be put away) — a conservative, explainable definition.
          if (t.sleeping) victims.push(id);
        }
        const list = victims.slice(0, 10);
        if (!list.length) return { ok: true, result: 'No ' + scope.replace('-', ' ') + ' tabs to close.', summary: 'Nothing to close' };
        let closedCount = 0;
        for (const id of list) {
          if (!st.tabs.has(id)) continue;
          try { closeTab(st.id, id); } catch {}
          closedCount += 1;
        }
        return { ok: true, result: 'Closed ' + closedCount + ' tab' + (closedCount === 1 ? '' : 's') + '.', summary: 'Closed ' + closedCount + ' tab' + (closedCount === 1 ? '' : 's') };
      }
      case 'rewrite': {
        // Style is fixed by the request; the material is the passed text or
        // the person's live selection. The model rewrites it in its reply.
        const style = String(params.style || '').trim().toLowerCase();
        if (!['proofread', 'shorter', 'friendlier', 'formal'].includes(style)) {
          return { ok: false, error: 'A style is required (proofread, shorter, friendlier or formal).' };
        }
        let text = String(params.text || '').trim();
        if (!text) {
          const page = await readActivePage(st, A);
          if (page.ok) {
            text = String(page.selection || '').trim();
            if (!text && page.context && page.context.kind === 'selection') text = String(page.context.text || '').trim();
          }
        }
        if (!text) return { ok: false, error: 'Nothing to rewrite — select some text on the page or pass it along.' };
        return {
          ok: true,
          result: 'Rewrite the following text (' + style + '). Output only the rewritten text, ready to paste:\n\n' + text.slice(0, 8000),
          summary: 'Prepared a ' + style + ' rewrite',
        };
      }
      case 'make_report': {
        // The executor does not fabricate content: it arms the request. The
        // model then writes the report in its next reply as one dex-artifact
        // block (the block format rides in its instructions every turn), and
        // the existing artifact pipeline validates, renders and stores it.
        // Unknown or missing preset resolves to the standard preset — the
        // request must never fail over a loosely named style.
        const preset = reportPresets.findPreset(params.preset);
        const shape = String(params.shape || '').trim() || (preset ? preset.shape : '');
        const theme = String(params.theme || '').trim().toLowerCase() || (preset ? preset.theme : 'clean');
        const lines = [
          'Write the report now as a single dex-artifact block (the block JSON format is in your instructions).',
          'Do not ask the person to choose a kind, format or style and do not ask for confirmation — produce the report immediately from this conversation and the skill results above. They can restyle or revise it afterwards in the report view.',
          'Do not propose make_report again for this request. Writing the dex-artifact block now is the single report build; finish it in this one run.',
          'Theme: ' + theme + '.',
          'Content comes from this conversation and any skill results only; references must be pages that were actually read.',
          'Quality rules: open with a one-paragraph summary or callout that states the key answer; then use at least two numbered sections with one idea each; include a table, stat or timeline where data supports it; finish with references only from pages you actually read. Use a mix of block types (headings, paragraphs, stats, callouts, tables, charts, quotes) so the report is visually rich — never just paragraphs of text.',
        ];
        if (shape) lines.push('Document shape: ' + shape);
        // The dedicated dex:ai-report-generate path already carries the
        // versioned rules in its system prompt. The normal chat skill path
        // used to arm a report without them, so its reports silently missed
        // the current quality tiers. Mirror make_site's pattern here; the
        // cap only guards the prompt budget (the current spec is ~11k chars).
        const reportVersion = reportVersions.activeVersion();
        const versionRules = reportVersions.promptRulesThrough(reportVersion).join('\n').slice(0, 16000);
        if (versionRules) {
          lines.push('VERSIONED REPORT QUALITY RULES (V' + reportVersion + ', including all earlier tiers):');
          lines.push(versionRules);
        }
        return { ok: true, result: lines.join('\n'), summary: 'Armed the report request' + (preset ? ' (' + preset.name + ')' : '') };
      }
      case 'make_site': {
        // Build a website from this conversation. The model writes the site as
        // a single dex-artifact block with kind 'site': ONE self-contained
        // index.html (all CSS/JS inline, no external requests) in the files
        // array, and the existing artifact pipeline validates, registers and
        // serves it over dexsite:// so it opens in a preview panel.
        const lines = [
          'Build the website now as a single dex-artifact block (the block JSON format is in your instructions).',
          'kind must be "site".',
          'The artifact needs a "files" array with exactly ONE entry: { path: "index.html", content: "..." } - the whole website lives in that one file.',
          'index.html must be a complete document: a real <!DOCTYPE html>, <html lang="en">, <head> with <meta charset="utf-8">, <meta name="viewport" content="width=device-width, initial-scale=1">, <title> and <meta name="description">, then <body>.',
          'SELF-CONTAINED means: every style rule lives in one <style> block in the head; every behaviour is inline JavaScript in <script> tags (no src, no imports, no modules); icons and images are inline SVG or CSS shapes/gradients; NO external requests of any kind - no CDN links, no linked fonts (use a system font stack), no remote images, no network fetch. The file must work offline, opened straight from disk.',
          'Only add a second file to the files array when the person explicitly asks for separate pages; index.html always stays the entry, internal links use relative hrefs, and every extra page follows the same self-contained rule.',
          'Do not ask the person to pick a kind, format or style - produce the site immediately from this conversation and any skill results above. They can restyle, edit the source, or change device width afterwards in the preview panel.',
          'DESIGN QUALITY - aim as high as a top-tier agency one-pager; the result is judged at first paint:',
          '- Design a real system, not defaults: CSS custom properties for colour, a type scale, a consistent 4/8px spacing rhythm, radius and shadows; one restrained accent colour over a deliberate neutral palette.',
          '- Use modern CSS confidently: flexbox and grid for layout, clamp() for fluid type, media queries so it genuinely works from a 390px phone to a wide desktop, prefers-color-scheme support when it suits the brief, purposeful transitions and subtle animation (hover, focus, entrance), layered shadows and gradients with restraint.',
          '- Typography carries the design: strong hierarchy, generous line-height, tuned letter-spacing on headings, real pull-quotes or stat treatments where they help.',
          '- Write real, complete content drawn from this conversation - never lorem ipsum, never TODO stubs, never empty sections; a real hero, real headings, real examples, a working nav and a considered footer.',
          '- Wire the JavaScript to real behaviour: working navigation, forms with validation and inline feedback, tabs/accordions/counters/toggles that actually change state on screen - interactive, not decorative.',
          '- Accessibility is part of quality: semantic landmarks, alt text, labelled controls, visible focus states and contrast of at least 4.5:1.',
          'FULL INTERACTIVITY IS MANDATORY: the result must behave like a real small app, not a mockup. Wire at least three genuine behaviours (working navigation, form validation with inline feedback, tabs/accordion/modal, filter/sort, counter, theme toggle, copy-to-clipboard, etc.). Every visible control must do something real and visibly change state or content: no dead buttons, no placeholder href="#" links, no clickable-looking decoration.',
          'Verify your own JavaScript before emitting the block: every id/class used by a listener exists in the markup, handlers are attached after the elements exist, and no script depends on a network request or an external file.',
          // Versioned improvement layers V3..V20: 4 concrete requirements each.
          ...siteVersions.rulesThrough(siteVersions.activeVersion()),
        ];
        if (params.title) lines.push('Site title: ' + String(params.title));
        if (params.description) lines.push('Site description: ' + String(params.description));
        if (params.pages) lines.push('Pages to build: ' + String(params.pages));
        return { ok: true, result: lines.join('\n'), summary: 'Armed the website request' };
      }
      case 'enable_agent': {
        if (!aiCaps(A).agent) {
          return { ok: false, error: 'Agent mode is still off. Use the lightning button if you want it on.' };
        }
        return {
          ok: true,
          result: 'Agent mode is on. The next request will run as an agent task and act on the current page; say "stop acting" to switch it off.',
          summary: 'Agent mode turned on',
        };
      }
      case 'use_vision': {
        const t = st.tabs.get(st.active);
        const wc = t && t.view && t.view.webContents;
        let pageUrl = '';
        try { pageUrl = (wc && !wc.isDestroyed() && wc.getURL()) || (t && t.url) || ''; } catch {}
        if (aiPage.isUnreadable(pageUrl)) {
          return { ok: false, error: 'Vision can look at normal http(s) pages only (' + (pageUrl || 'this page') + ').' };
        }
        const image = await captureTabImage(wc);
        if (!image) return { ok: false, error: 'Vision could not capture this page.' };
        return {
          ok: true,
          result: 'Vision is on. Use the attached screenshot of the current page as evidence; describe only what it actually shows.',
          summary: 'Looked at the current page',
          images: [{ name: 'screenshot', url: image }],
        };
      }
      case 'open_website': {
        const target = String(params.url || '').trim();
        if (!/^https?:\/\//i.test(target) || aiPage.isUnreadable(target)) {
          return { ok: false, error: 'Only normal http(s) websites can be opened. Got: ' + (target || 'nothing') };
        }
        const nid = newTab(st.id, target, true);
        if (!nid) return { ok: false, error: 'Could not open a new tab.' };
        let host = target;
        try { host = new URL(target).hostname || target; } catch {}
        return { ok: true, result: 'Opened ' + target + ' in a new background tab.', summary: 'Opened ' + host };
      }
      case 'edit_document':
      case 'revise_artifact': {
        // Revise an existing artifact (report, site, quiz, deck, chart, timeline)
        // with change instructions. The model writes the revised artifact as a
        // new dex-artifact block; version tracking lives on the stored artifact.
        const store = chatStore(st, A);
        const scan = (chat) => {
          const messages = (chat && Array.isArray(chat.messages)) ? chat.messages : [];
          for (let i = messages.length - 1; i >= 0; i--) {
            const art = messages[i] && messages[i].artifact;
            if (art) return { artifact: art, index: i };
          }
          return null;
        };
        let found = scan(store.find(st.aiRequestChatId));
        if (!found) {
          for (const chat of store.list) {
            found = scan(chat);
            if (found) break;
          }
        }
        if (!found) return { ok: false, error: 'No artifact has been made yet — ask for one first.' };
        const kind = String(found.artifact.kind || 'report');
        const title = found.artifact.title || 'the artifact';
        const instructions = String(params.instructions || '').trim();
        if (!instructions) return { ok: false, error: 'Revision instructions are required.' };
        // The current source rides along: a revision without it is a rewrite.
        const lines = [
          aiArtifacts.artifactRevisionPrompt(found.artifact, instructions),
          'Quality rules: open with a one-paragraph summary or callout that states the key answer; then use at least two numbered sections; include a table, stat or timeline where data supports it; finish with references only from pages you actually read.',
          'References must still cite pages that were actually read in this conversation.',
        ];
        const blockIndex = Number(params.blockIndex);
        const blockContent = String(params.blockContent || '').trim();
        if (Number.isFinite(blockIndex) && blockContent) {
          lines.push('Block-level edit: replace block #' + blockIndex + ' with: ' + blockContent);
        } else if (blockIndex !== undefined || blockContent) {
          lines.push('Note: block-level edit requires both blockIndex (number) and blockContent (text).');
        }
        return {
          ok: true,
          result: lines.join('\n'),
          summary: 'Armed artifact revision for "' + title + '"',
          artifact: { kind, title },
        };
      }
      case 'export_report': {
        const format = ['pdf', 'html', 'md', 'docx'].includes(params.format) ? params.format : '';
        if (!format) return { ok: false, error: 'A format is required (pdf, html, md or docx).' };
        const store = chatStore(st, A);
        const scan = (chat) => {
          const messages = (chat && Array.isArray(chat.messages)) ? chat.messages : [];
          for (let i = messages.length - 1; i >= 0; i--) {
            const art = messages[i] && messages[i].artifact;
            if (art && art.kind === 'report') return art;
          }
          return null;
        };
        let artifact = scan(store.find(st.aiRequestChatId));
        if (!artifact) {
          // Fall back to the newest report anywhere in the account.
          for (const chat of store.list) {
            artifact = scan(chat);
            if (artifact) break;
          }
        }
        if (!artifact) return { ok: false, error: 'No report has been made yet — ask for one first.' };
        const checked = aiArtifacts.normalizeArtifact(artifact);
        if (!checked.ok) return { ok: false, error: 'The report could not be read.' };
        const markdown = aiArtifacts.artifactToMarkdown(checked.artifact);
        const explicit = process.env.DEX_AI_TEST === '1'
          ? path.join(os.tmpdir(), 'dex-skill-export.' + (format === 'docx' ? 'docx' : format))
          : '';
        try {
          const saved = await reportExport.save({
            win: st.win,
            format,
            name: checked.artifact.title,
            html: reportHtmlFor(checked.artifact, markdown),
            markdown,
            artifact: checked.artifact,
            explicitPath: explicit,
          });
          if (!saved || !saved.ok) {
            return { ok: false, error: (saved && saved.canceled) ? 'The export was cancelled.' : 'The export failed.' };
          }
          return { ok: true, result: 'Exported "' + checked.artifact.title + '" as ' + format.toUpperCase() + ' to ' + saved.path + '.', summary: 'Exported the report' };
        } catch (err) {
          return { ok: false, error: String((err && err.message) || err) };
        }
      }
      default:
        return { ok: false, error: 'The ' + skill + ' skill is not available in this build yet.' };
    }
  }

  // Streams the reply as 'dex:ai-chunk' events to the requesting renderer.
  // Memory commands ("remember …", "forget …", "what do you remember?")
  // are answered locally from per-account memory — no model call is spent —
  // and every other send carries the account's memory into the system prompt.
  ipcMain.handle('dex:ai-send', async (e, { reqId, messages, chatId, pageContext } = {}) => {
    const { st, A } = Aof(e);
    const id = String(reqId || Date.now());
    const sender = e.sender;
    if (sender.isDestroyed()) return { ok: false, reqId: id };
    // A new send supersedes any in-flight stream in this window.
    if (st.aiRequestId && st.aiRequestId !== id) {
      ai.cancel(st.aiRequestId);
      clearSkillAsks(st.id);
    }
    const safeMessages = Array.isArray(messages) ? messages.slice(-80) : [];
    if (!Array.isArray(A.memory)) A.memory = [];
    // A previous stop leaves window.__dexHalt set in this document, and every
    // page action would instantly refuse with a user-stopped error. scAI's
    // guard re-injection resets its flag on every start — do the same here
    // (a navigation wipes page state anyway; this covers the same-document
    // case). Best effort: never blocks the run.
    const sendTab = st.tabs.get(st.active);
    const sendWc = sendTab && sendTab.view && sendTab.view.webContents;
    if (sendWc && !sendWc.isDestroyed()) {
      try { await execTimeout(sendWc.executeJavaScript('window.__dexHalt = false;0'), 5000, 'halt reset timed out'); } catch {}
    }
    // Only the just-sent message can be a memory command — scanning older
    // history re-triggers stale commands on image-only follow-ups.
    const tail = safeMessages[safeMessages.length - 1];
    const lastUser = (tail && tail.role === 'user' && String(tail.text || '').trim()) ? tail : null;
    if (lastUser) {
      const cmd = ai.parseMemoryCommand(lastUser.text);
      if (cmd && cmd.action === 'remember') {
        const { list, added, reason } = ai.addMemory(A.memory, cmd.fact);
        A.memory = list;
        saveAcc(st.accountId);
        memBump(st.accountId);
        broadcastMemory(st.accountId, A.memory);
        const text = added
          ? 'Got it — I\'ll remember that:\n- ' + cmd.fact
          : reason === 'duplicate' ? 'That\'s already in my memory.' : 'My memory is full — forget something first.';
        return { ok: true, reqId: id, text, model: 'memory', memoryAction: 'remembered', memory: A.memory };
      }
      if (cmd && cmd.action === 'forget') {
        const { list, removed } = ai.removeMemory(A.memory, cmd.query);
        A.memory = list;
        saveAcc(st.accountId);
        memBump(st.accountId);
        broadcastMemory(st.accountId, A.memory);
        const text = removed.length
          ? 'Forgot ' + removed.length + ' memor' + (removed.length === 1 ? 'y' : 'ies') + ' matching "' + cmd.query + '".'
          : 'Nothing in my memory matches "' + cmd.query + '".';
        return { ok: true, reqId: id, text, model: 'memory', memoryAction: 'forgotten', memory: A.memory };
      }
      if (cmd && cmd.action === 'recall') {
        return { ok: true, reqId: id, text: ai.memoryRecap(A.memory), model: 'memory', memoryAction: 'recalled', memory: A.memory };
      }
    }
    st.aiRequestId = id;
    st.aiRequestChatId = String(chatId || '');
    // Old turns roll off the wire budget in long chats. Keep the person's
    // original goal in the system prompt so later replies stay on that thread.
    let focusSuffix = '';
    try {
      const store = chatStore(st, A);
      const chat = store.find(st.aiRequestChatId);
      const msgs = (chat && Array.isArray(chat.messages)) ? chat.messages : [];
      const users = msgs.filter((m) => m && m.role === 'user' && String(m.text || '').trim());
      const anchor = users.find((m) => String(m.text).replace(/\s+/g, ' ').trim().length >= 20) || users[0];
      if (anchor) {
        focusSuffix = 'Conversation focus — the goal of this chat, still active unless the person changes it:\n'
          + String(anchor.text).replace(/\s+/g, ' ').trim().slice(0, 1200);
      }
    } catch {}
    // Page + search context ride on a COPY of the last user message for the
    // stream only — the stored chat keeps the user's own words (plus the
    // context chips), and memory parsing above already ran on the original.
    const streamMessages = injectContexts(safeMessages, pageContext);
    const chunks = makeChunkBatcher((payload) => {
      if (!sender.isDestroyed()) sender.send('dex:ai-chunk', payload);
    }, id);

    // Deterministic website generation. An explicit website request (or an AI
    // edit of an existing site) goes straight to a single-turn site writer:
    // the site rules sit in the system prompt and the person's words are the
    // only user message. This avoids the propose/arm/write loop, whose write
    // turn reliably came back empty on this reasoning model, and needs no
    // consent card because the person already asked for the action.
    let siteRoute = null;
    let currentArtifact = null;
    try {
      const store = chatStore(st, A);
      const chat = store.find(st.aiRequestChatId);
      const msgs = (chat && Array.isArray(chat.messages)) ? chat.messages : [];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i] && msgs[i].artifact) { currentArtifact = msgs[i].artifact; break; }
      }
      siteRoute = siteIntent.detectSiteIntent(safeMessages, currentArtifact);
    } catch {}
    if (siteRoute && (siteRoute.skill === 'make_site' || siteRoute.skill === 'revise_artifact')) {
      try {
        const own = siteIntent.ownText(safeMessages);
        const context = String(pageContext || '').slice(0, 12000);
        const revising = siteRoute.skill === 'revise_artifact'
          && currentArtifact && String(currentArtifact.kind || '') === 'site';
        const streamOpts = {
          difficulty: difficultyOf(A),
          systemOverride: siteSystemPrompt(siteVersions.activeVersion()),
          strictSingleFile: true,
        };
        let userMessage;
        if (revising) {
          // Fix-with-AI used to fall through as a plain "make a website" brief.
          // The model then invented a fresh product ("Dexerion Studio") instead
          // of editing the clicked site. Send the real source and revision
          // contract on this route, and say it in the system rules as well.
          const instructions = String((siteRoute.args && siteRoute.args.instructions) || own).trim();
          userMessage = aiArtifacts.artifactRevisionPrompt(currentArtifact, instructions);
          streamOpts.systemOverride += '\n\nSITE REVISION MODE: you are editing the existing site supplied in the user message. Keep its subject, title, file set, ids, classes and working behaviour. Do not introduce a new product name or a different topic. Return the whole site again as one dex-artifact block.';
          if (context) userMessage += '\n\n' + context;
        } else {
          userMessage = own + (context ? '\n\n' + context : '');
        }
        let researchMeta = null;
        // Explicit research/image/source requests only: a plain site request
        // never opens the network. Retrieval is best effort and bounded; a
        // failure here must never block generation. Research rides on the
        // per-request copy only — nothing is written to the stored chat.
        if (siteIntent.wantsSiteResearch(own)) {
          try {
            const gathered = await searchRef().gather({
              reqId: 'site-research:' + id,
              winId: st.id,
              query: own.slice(0, 400),
              mode: 'quick',
              sources: 6,
            });
            const researchText = aiSearchSynth.sourcesText(gathered && gathered.sources || []).slice(0, 6000);
            const candidates = siteResearchAssets.collectResearchCandidates({
              userText: own,
              researchText,
              sources: gathered && gathered.sources,
            });
            const fetched = await siteResearchAssets.fetchSiteAssets(candidates, {
              fetchBinary: fetchSiteAssetBinary,
            });
            streamOpts.siteResearchText = siteResearchAssets.researchEvidenceBlock(fetched.assets, { text: researchText });
            streamOpts.researchAssets = fetched.assets;
            if (researchText) userMessage += '\n\n' + researchText;
            researchMeta = {
              queried: true,
              sources: (gathered && gathered.sources || []).length,
              candidates: candidates.length,
              assets: fetched.assets.length,
              warnings: fetched.errors,
            };
          } catch (e) {
            researchMeta = { queried: true, error: String((e && e.message) || e) };
          }
        }
        const out = await ai.streamSite(id, userMessage,
          (delta, full) => chunks.push(delta, full), streamOpts);
        try { if (!sender.isDestroyed()) sender.send('dex:ai-skill', { reqId: id, type: 'skill-run', skill: siteRoute.skill, label: 'Make a website', args: siteRoute.args || {}, why: 'Website generation requested' }); } catch {}
        try { if (!sender.isDestroyed()) sender.send('dex:ai-skill', { reqId: id, type: 'skill-result', skill: siteRoute.skill, label: 'Make a website', ok: Boolean(out.artifact), ms: 0, summary: out.artifact ? 'Website built' : 'No usable website returned', error: out.artifact ? '' : (out.artifactError || '') }); } catch {}
        return {
          ok: true, reqId: id, text: out.text || '', model: out.model,
          skills: [{ skill: siteRoute.skill, ok: true, decision: 'auto', via: 'intent', ms: 0 }],
          artifact: out.artifact || null,
          artifactError: out.artifactError || '', artifactWarnings: out.artifactWarnings || [],
          interactivity: out.interactivity || null, interactivityRepaired: Boolean(out.interactivityRepaired),
          siteResearch: researchMeta || out.siteResearch || null, siteAssets: out.siteAssets || [],
          usage: out.usage || null, routing: out.routing || null,
        };
      } catch (err) {
        return { ok: false, reqId: id, error: String(err && err.message || err) };
      } finally {
        chunks.flush();
        if (st.aiRequestId === id) { st.aiRequestId = null; st.aiRequestChatId = null; }
      }
    }

    try {
      // The skill loop wraps the stream: proposals become consent cards,
      // executors run, results ride back, and the final reply streams on.
      const shownCreationRuns = new Set();
      const loop = aiSkillLoop.createSkillLoop({
        turn: (chatMsgs, paint, hints) => ai.stream(id, chatMsgs, paint || (() => {}), {
          memory: A.memory,
          systemSuffix: focusSuffix,
          tools: hints && hints.final ? undefined : skills.toolDefinitions(),
          difficulty: difficultyOf(A),
          // A report skill ran in this message: the turns that follow are
          // writing the deliverable, so they carry the artifact treatment.
          artifact: Boolean(hints && hints.artifact),
        }),
        ask: (entry) => askSkill(st, entry),
        dispatch: (entry) => runSkill(st, A, entry.skill, entry.args),
        // A raw tool call can carry a complete artifact payload; validate it
        // with the same normalizer the fence path uses.
        normalizeArtifact: (artifact) => aiArtifacts.normalizeArtifact(artifact),
        // Deterministic deliverable routing: if the model fails to propose
        // the skill, an explicit website or report request still builds it.
        // Website intent wins, and a report follow-up stays a revision.
        forceSkill: (chatMsgs) => {
          let currentArtifact = null;
          try {
            const store = chatStore(st, A);
            const chat = store.find(st.aiRequestChatId);
            const messages = (chat && Array.isArray(chat.messages)) ? chat.messages : [];
            for (let i = messages.length - 1; i >= 0; i--) {
              if (messages[i] && messages[i].artifact) { currentArtifact = messages[i].artifact; break; }
            }
          } catch {}
          return siteIntent.detectSiteIntent(chatMsgs, currentArtifact)
            || reportIntent.detectReportIntent(chatMsgs, currentArtifact);
        },
        // A model can repeat a deliverable call while the same answer is
        // still running. Retries are allowed, but the conversation shows one
        // step row for the build and updates it in place.
        emit: (ev) => {
          if (!ev) return;
          if (ev.type === 'skill-run' && (ev.skill === 'make_report' || ev.skill === 'make_site')) {
            if (shownCreationRuns.has(ev.skill)) return;
            shownCreationRuns.add(ev.skill);
          }
          try { if (!sender.isDestroyed()) sender.send('dex:ai-skill', { reqId: id, ...ev }); } catch {}
        },
        record: (row) => approvals.record(row),
      });
      const r = await loop.run(streamMessages, { onDelta: (delta, full) => { chunks.push(delta, full); } });
      // The skill-loop report path (make_report after web research) produces
      // the same offline document. Embed any remote image the model referenced
      // before the preview card is stored — the report CSP cannot load http(s).
      if (r && r.last && r.last.artifact && r.last.artifact.kind === 'report') {
        try {
          const imageInfo = await inlineReportImages(r.last.artifact, []);
          if (imageInfo.warnings.length) {
            r.last.artifactWarnings = (r.last.artifactWarnings || []).concat(imageInfo.warnings);
          }
        } catch { /* never fail a report because an optional image fetch failed */ }
      }
      if (r.ok && !r.cancelled && r.text) {
        // Automatic memory: learn from this exchange in the background —
        // the reply is already on its way, this never blocks it.
        const accountId = st.accountId;
        const rev = memRevs.get(accountId) || 0;
        setImmediate(() => learnFromExchange(accountId, safeMessages, r.text, rev).catch(() => {}));
      }
      const last = r.last || {};
      return {
        ok: true, reqId: id, text: r.text, model: last.model, cancelled: r.cancelled,
        skills: r.skills || [], thinking: last.thinking || '',
        usage: last.usage || null, artifact: last.artifact || null,
        artifactError: last.artifactError || '', artifactWarnings: last.artifactWarnings || [],
        routing: last.routing || null,
      };
    } catch (err) {
      return { ok: false, reqId: id, error: String(err && err.message || err) };
    } finally {
      chunks.flush();
      if (st.aiRequestId === id) {
        st.aiRequestId = null;
        st.aiRequestChatId = null;
      }
    }
  });
  ipcMain.handle('dex:ai-stop', (e, reqId) => {
    const { st } = Aof(e);
    const id = String(reqId || '');
    ai.cancel(id);
    // A stop also ends any consent card this window is waiting on — and any
    // skill-run search riding under this request id.
    clearSkillAsks(st.id);
    searchRef().stop('skill:' + id);
    return true;
  });
  // Memory notice actions: Allow keeps the tab and mutes the notice for this
  // window for a while; Close tab closes the tab the notice names.
  ipcMain.handle('dex:mem-notice', (e, action) => {
    const { st } = needChrome(e);
    const n = st.memNotice;
    st.memNotice = null;
    st.memNoticeMutedUntil = Date.now() + (action === 'close' ? 3 * 60 * 1000 : 10 * 60 * 1000);
    if (action === 'close' && n) closeTab(st.id, n.tabId);
    pushState(st.id);
    return true;
  });
  ipcMain.handle('dex:ai-skill-decide', (e, { id, allow, scope } = {}) => {
    needChrome(e);
    const entry = approvals.decide(String(id || ''), allow === true, scope === 'always' ? 'always' : 'once');
    if (!entry) return { ok: false, error: 'That request already ended.' };
    settleSkillAsk(entry.id, entry);
    return { ok: true, decision: entry };
  });
  ipcMain.handle('dex:ai-skill-state', (e, { chatId } = {}) => {
    needChrome(e);
    const key = String(chatId || '');
    return { pending: approvals.list(key), grants: approvals.grants(key) };
  });
  ipcMain.handle('dex:ai-skill-log', (e) => {
    needChrome(e);
    return approvals.log();
  });
  // Explicit, user-initiated marking of one short quiz answer. It is a single
  // non-streaming request, never automatic, and the UI labels it as AI marking.
  ipcMain.handle('dex:ai-grade-short', async (e, input) => {
    needChrome(e);
    try {
      return await ai.gradeShort(input && typeof input === 'object' ? input : {});
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  // ---------- Dexerion Assistant agent (scAI agentic actions, single tab) --
  // The loop lives in main (key + tabs live here); the sidebar renders the
  // trace and answers confirmations. Prefs persist per account via saveAcc.
  function agentPrefs(A) {
    const p = (A && A.aiAgent && typeof A.aiAgent === 'object') ? A.aiAgent : {};
    return {
      // The lightning button writes aiCaps.agent; the legacy switch writes
      // aiAgent.agent. aiCaps() reconciles both.
      agent: aiCaps(A).agent,
      agentMaxSteps: Math.max(1, Math.min(200, parseInt(p.agentMaxSteps, 10) || 25)),
      agentAllowlistOn: p.agentAllowlistOn === true,
      agentSites: Array.isArray(p.agentSites) ? p.agentSites.slice(0, 200) : [],
      agentMacros: p.agentMacros !== false,
      // Browser-wide reading (search/read other tabs). On by default: it is
      // the point of research tasks; the allowlist still gates where acting
      // and reading happen, and off keeps the run inside its own tab.
      agentCrossTab: p.agentCrossTab !== false,
    };
  }
  // Display prefs for the panel (usage line, layout variant). Same rules.
  function aiUiPrefs(A) {
    const p = (A && A.aiUi && typeof A.aiUi === 'object') ? A.aiUi : {};
    const layout = String(p.aiLayout || 'a');
    const rawW = Number(p.width);
    return {
      showUsage: p.showUsage !== false,
      aiLayout: layout === 'b' || layout === 'c' ? layout : 'a',
      // Resized assistant width, clamped so a bad value can never hide the
      // panel or cover the whole window.
      width: Number.isFinite(rawW)
        ? Math.max(AI_SIDEBAR_MIN_W, Math.min(AI_SIDEBAR_MAX_W, Math.round(rawW)))
        : AI_SIDEBAR_W,
      // When off, conversations live only in this window's memory: the
      // sidebar behaves the same, but nothing reaches the profile.
      saveChats: p.saveChats !== false,
      // Plan review: agent runs show their plan and wait for approval first.
      agentPlanFirst: p.agentPlanFirst === true,
    };
  }
  // The page view is inset by the assistant only while it is open. The
  // viewport caps mirror the CSS breakpoints in shell.css exactly, so the page
  // edge and the panel edge never separate on a narrow window.
  function aiSidebarWidth(st, totalWidth) {
    let saved = AI_SIDEBAR_W;
    try { saved = aiUiPrefs(accData(st.accountId)).width; } catch {}
    const total = Number(totalWidth) > 0 ? Number(totalWidth) : 0;
    if (total > 0) {
      const cap = total <= 650 ? total : (total <= 1100 ? Math.round(total * 0.52) : saved);
      saved = Math.min(saved, cap);
    }
    const min = total > 0 ? Math.min(AI_SIDEBAR_MIN_W, total) : AI_SIDEBAR_MIN_W;
    return Math.max(min, Math.min(AI_SIDEBAR_MAX_W, Math.round(saved)));
  }
  // One rule for "may a run act here?" — allowlist off means allowed.
  function agentSiteAllowed(A, url) {
    // The new tab is our own trusted start page. The web allowlist governs
    // websites, not the page the person starts on — treating it as a blocked
    // host made "search this" and "open my starred link" fail on new tab.
    if (aiPage.isAgentNewTab(url)) return true;
    const prefs = agentPrefs(A);
    if (!prefs.agentAllowlistOn) return true;
    try {
      const host = sitePolicy.hostOf(url);
      if (!host) return false;
      return sitePolicy.hostAllowed(host, prefs.agentSites);
    } catch { return false; }
  }
  function execTimeout(promise, ms, what) {
    let timer = null;
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(what || 'timed out')), ms); });
    return Promise.race([promise, timeout]).finally(() => { if (timer) clearTimeout(timer); });
  }
  function settleTab(wc, ms) {
    const end = Date.now() + (ms || 8000);
    return new Promise((resolve) => {
      const tick = () => {
        let loading = false;
        try { loading = wc.isLoading(); } catch { return resolve(false); }
        if (!loading || Date.now() >= end) return resolve(!loading);
        setTimeout(tick, 150);
      };
      tick();
    });
  }
  function agentTabWc(run) {
    const st = windows.get(run.actWinId || run.winId);
    const t = st && st.tabs.get(run.tabId);
    const wc = t && t.view && t.view.webContents;
    if (!wc || wc.isDestroyed()) return null;
    return wc;
  }
  // The account driving this run (origin window); null when the window is gone.
  function accountForRun(run) {
    const st = windows.get(run.winId);
    if (!st || st.win.isDestroyed()) return null;
    try { return accData(st.accountId); } catch { return null; }
  }
  // Every open tab, every window — ids are unique across windows (one
  // sequence), so a tab id from list_tabs/search_tabs resolves anywhere.
  function allTabsSnapshot() {
    const out = [];
    for (const st of windows.values()) {
      if (!st || st.win.isDestroyed()) continue;
      for (const id of st.order) {
        const t = st.tabs.get(id);
        if (!t) continue;
        let url = '', title = '', hasView = false, loading = false;
        try {
          const wc = t.view && t.view.webContents;
          hasView = Boolean(wc && !wc.isDestroyed());
          if (hasView) {
            url = wc.getURL() || '';
            title = wc.getTitle() || '';
            loading = Boolean(wc.isLoading());
          }
        } catch {}
        out.push({
          tabId: id, windowId: st.id,
          title: title || t.title || '', url: url || t.url || '',
          active: id === st.active,
          asleep: Boolean(t.sleeping) || !hasView,
          lazy: Boolean(t.lazy),
          loading: loading || Boolean(t.loading),
        });
      }
    }
    return out;
  }
  function findTabEverywhere(tabId) {
    const tid = String(tabId || '');
    for (const st of windows.values()) {
      const t = st.tabs.get(tid);
      if (t) return { st, t };
    }
    return null;
  }
  // Actions whose meaning comes from snapshot ref numbers.
  function refBasedAction(action, args) {
    const a = args || {};
    if (a.ref != null) return true;
    if (action === 'fill_form' && Array.isArray(a.fields)) {
      return a.fields.some(f => f && f.ref != null);
    }
    return false;
  }
  function emitAgentEvent(run, ev) {
    // Flush any batched stream tail first: the renderer must paint the final
    // tokens before the end event that finalizes the run.
    if (ev && ev.type === 'end') {
      const batcher = agentChunkBatchers.get(run.clientReqId);
      if (batcher) { batcher.flush(); agentChunkBatchers.delete(run.clientReqId); }
    }
    const st = windows.get(run.winId);
    if (!st || st.win.isDestroyed()) return;
    try { st.win.webContents.send('dex:agent-event', { runId: run.id, ...ev }); } catch {}
    // Mirror the event into the persisted mission record (best effort; the
    // live UI never depends on it).
    const live = liveMissions.get(run.id);
    if (!live) return;
    const A = accData(live.accountId);
    const m = (Array.isArray(A.missions) ? A.missions : []).find(x => x && x.id === run.id);
    if (!m) return;
    if (ev.type === 'step' && ev.step) {
      const clean = missionStep(ev.step);
      const at = m.steps.findIndex(s => s && s.n === clean.n);
      if (at >= 0) m.steps[at] = clean;
      else m.steps.push(clean);
      if (m.steps.length > 200) m.steps = m.steps.slice(-200);
    } else if (ev.type === 'plan' && ev.plan) {
      m.plan = missionPlan(ev.plan);
    } else if (ev.type === 'ask') {
      if (!Array.isArray(m.approvals)) m.approvals = [];
      m.approvals.push({ what: String(ev.what || '').slice(0, 200), at: Date.now() });
      if (m.approvals.length > 50) m.approvals = m.approvals.slice(-50);
    }
    saveAcc(live.accountId);
  }
  // ---------- Assistant missions (agent runs: plan, steps, results) ---------
  // One record per model-driven run; live events mirror into it, so the
  // sidebar can inspect and delete past work. Separate from personal memory.
  const liveMissions = new Map(); // runId -> { accountId }

  function missionStep(s) {
    return {
      n: Math.max(0, parseInt(s && s.n, 10) || 0),
      name: String((s && s.name) || '').slice(0, 40),
      what: String((s && s.what) || '').slice(0, 200),
      status: ['ok', 'bad', 'asked', 'live'].includes(s && s.status) ? s.status : 'ok',
      detail: String((s && s.detail) || '').slice(0, 4000),
    };
  }
  function missionPlan(plan) {
    if (!plan || !Array.isArray(plan.steps)) return null;
    return {
      goal: String(plan.goal || '').slice(0, research.MAX_GOAL_CHARS),
      steps: plan.steps.slice(0, research.MAX_PLAN_STEPS).map(s => {
        const out = {
          id: String((s && s.id) || '').slice(0, 24),
          text: String((s && s.text) || '').slice(0, research.MAX_STEP_CHARS),
          status: research.PLAN_STATUSES.includes(s && s.status) ? s.status : 'pending',
          note: String((s && s.note) || '').slice(0, research.MAX_STEP_CHARS),
        };
        if (Array.isArray(s && s.dependsOn) && s.dependsOn.length) {
          out.dependsOn = s.dependsOn.slice(0, 6).map(d => String(d).slice(0, 24));
        }
        return out;
      }),
      updatedAt: Date.now(),
    };
  }
  function missionSummary(m) {
    const plan = m && m.plan ? missionPlan(m.plan) : null;
    return {
      id: String(m.id),
      goal: String(m.goal || '').slice(0, 200),
      url: String(m.url || '').slice(0, 2048),
      host: String(m.host || '').slice(0, 200),
      status: String(m.status || 'done'),
      startedAt: Number(m.startedAt) || 0,
      endedAt: Number(m.endedAt) || 0,
      stepCount: Array.isArray(m.steps) ? m.steps.length : 0,
      approvals: Array.isArray(m.approvals) ? m.approvals.length : 0,
      plan: plan ? {
        goal: plan.goal,
        done: plan.steps.filter(s => s.status === 'done').length,
        total: plan.steps.length,
      } : null,
    };
  }
  // Stale runs (browser closed mid-mission) read as interrupted, once.
  function missionsPublic(accountId) {
    const A = accData(accountId);
    if (!Array.isArray(A.missions)) A.missions = [];
    let changed = false;
    for (const m of A.missions) {
      if (!m) continue;
      if ((m.status === 'running' || m.status === 'paused') && !liveMissions.has(String(m.id))) {
        m.status = 'interrupted';
        m.endedAt = m.endedAt || Date.now();
        m.result = m.result || 'Dexerion AI stopped before this mission finished (the browser or run ended unexpectedly).';
        changed = true;
      }
    }
    if (changed) saveAcc(accountId);
    return A.missions
      .slice()
      .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
      .map(missionSummary);
  }
  function missionDetail(accountId, id) {
    const A = accData(accountId);
    const m = (Array.isArray(A.missions) ? A.missions : []).find(x => x && String(x.id) === String(id || ''));
    if (!m) return null;
    return {
      ...missionSummary(m),
      result: String(m.result || '').slice(0, 8000),
      steps: (Array.isArray(m.steps) ? m.steps : []).slice(-200).map(missionStep),
      plan: m.plan ? missionPlan(m.plan) : null,
      approvals: (Array.isArray(m.approvals) ? m.approvals : []).slice(-50).map(a => ({
        what: String((a && a.what) || '').slice(0, 200),
        at: Number(a && a.at) || 0,
      })),
    };
  }
  function broadcastMissions(accountId) {
    for (const st of windows.values()) {
      if (st.accountId !== accountId || st.win.isDestroyed()) continue;
      try { st.win.webContents.send('dex:ai-missions-updated', accountId); } catch {}
    }
  }
  // ---------- Research projects (user-approved, separate from memory) -------
  function projectsPublic(accountId) {
    const A = accData(accountId);
    const list = (Array.isArray(A.projects) ? A.projects : [])
      .map(research.normalizeProject)
      .filter(Boolean);
    return list
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .map(p => ({
        id: p.id, title: p.title, goal: p.goal, status: p.status,
        createdAt: p.createdAt, updatedAt: p.updatedAt,
        counts: {
          sources: p.sources.length, findings: p.findings.length,
          decisions: p.decisions.length, questions: p.questions.length,
        },
      }));
  }
  function projectDetail(accountId, id) {
    const A = accData(accountId);
    const list = (Array.isArray(A.projects) ? A.projects : []).map(research.normalizeProject).filter(Boolean);
    return list.find(p => p.id === String(id || '')) || null;
  }
  function broadcastProjects(accountId) {
    for (const st of windows.values()) {
      if (st.accountId !== accountId || st.win.isDestroyed()) continue;
      try { st.win.webContents.send('dex:ai-projects-updated', accountId); } catch {}
    }
  }
  function askAgentUser(run, what, why, opts) {
    const o = opts || {};
    return new Promise((resolve) => {
      const id = 'ask' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      if (run.pendingAsk) { try { run.pendingAsk.resolve(false); } catch {} }
      run.pendingAsk = { id, resolve, wantsText: Boolean(o.input) };
      // `input` turns the card into a small text box: the answer comes back as
      // a string, not yes/no (used by the ask_user tool).
      emitAgentEvent(run, {
        type: 'ask', askId: id, what, why,
        ...(o.input ? { input: true, placeholder: String(o.placeholder || '').slice(0, 120) } : {}),
      });
    });
  }
  async function runAgentInPage(wc, job) {
    await wc.executeJavaScript('window.__dexJob = ' + JSON.stringify(job) + ';0');
    const data = await execTimeout(
      wc.executeJavaScript('(' + aiPage.actPage.toString() + ')()'),
      20000, 'the page did not answer'
    );
    if (!data) throw new Error('The page returned nothing for ' + job.action + '.');
    return data;
  }
  const AGENT_PAGE_ACTIONS = {
    snapshot: 1, click: 1, type: 1, select: 1, hover: 1, press_key: 1,
    scroll: 1, find_text: 1, wait_for: 1, fill_form: 1, get_page_data: 1,
  };
  // Actions that can commit a navigation: their result is only true once the
  // page has settled (see ai-settle.js).
  const AGENT_SETTLE_ACTIONS = { click: 1, press_key: 1, type: 1, fill_form: 1 };
  // One tab, read the same way everywhere — the read_tab tool and the
  // all-tabs inspection both go through this. The tab is re-resolved by its
  // stable id at call time and never substituted; every result names the id
  // it came from. `opts.gate(url)` may refuse the read after the page settles
  // and before a single byte is extracted (allowlist revalidation).
  // Returns {ok:true, tabId, windowId, url, finalUrl, title, description,
  // outline, text, woke} or {ok:false, tabId, windowId, url, title, reason,
  // error}.
  async function readTabById(tidRaw, opts = {}) {
    const tid = String(tidRaw || '');
    if (!research.TAB_ID_RE.test(tid)) {
      return { ok: false, tabId: tid, reason: 'invalid tab id', error: 'Tab ids look like "t7" — got "' + String(tidRaw || '(missing)') + '".' };
    }
    const got = findTabEverywhere(tid);
    if (!got) {
      return { ok: false, tabId: tid, reason: 'closed', error: 'No tab with id ' + tid + ' — it may have been closed or navigated away.' };
    }
    const { st: tst, t } = got;
    let twc = t.view && t.view.webContents;
    let woke = false;
    if ((!twc || twc.isDestroyed()) && t.sleeping) {
      // Wake a slept tab in the background: recreate its view, detach it
      // from display immediately (it must not cover the active tab), reload,
      // then read. The tab stays awake for the user afterwards.
      const woken = wakeTab(tst.id, tid);
      twc = woken && woken.view && woken.view.webContents;
      try { if (woken && woken.view) tst.win.contentView.removeChildView(woken.view); } catch {}
      if (twc) {
        woke = true;
        t.loading = true;
        try { twc.loadURL(t.url).catch(() => {}); } catch {}
      }
    } else if (twc && !twc.isDestroyed() && t.lazy) {
      // A lazily restored tab has a view but has never loaded its page; a
      // read would see about:blank. Load it in place (no activation).
      const u = t.pendingUrl || t.url;
      delete t.pendingUrl;
      t.lazy = false;
      t.loading = true;
      woke = true;
      try { twc.loadURL(u).catch(() => {}); } catch {}
    }
    if (!twc || twc.isDestroyed()) {
      return {
        ok: false, tabId: tid, windowId: tst.id, url: t.url || '', title: t.title || '',
        reason: 'asleep',
        error: 'That tab is not loaded yet (restoring lazily). Open it once, or use open_tab with its URL.',
      };
    }
    let busyLoad = Boolean(t.loading);
    try { busyLoad = busyLoad || twc.isLoading(); } catch {}
    if (busyLoad) await settleTab(twc, opts.settleMs || 6000);
    let cur = t.url || '', title = t.title || '';
    try { cur = twc.getURL() || cur; } catch {}
    try { title = twc.getTitle() || title; } catch {}
    if (aiPage.isUnreadable(cur)) {
      return {
        ok: false, tabId: tid, windowId: tst.id, url: cur, title,
        reason: 'not readable',
        error: 'That tab can\'t be read (' + (cur || 'unknown') + ') — browser-internal and local pages are off limits; the Dexerion new tab is the one exception.',
      };
    }
    if (typeof opts.gate === 'function') {
      let g = null;
      try { g = opts.gate(cur, { tabId: tid, windowId: tst.id, title }); }
      catch (err) { g = { reason: 'not permitted', error: String((err && err.message) || err) }; }
      if (g) {
        return {
          ok: false, tabId: tid, windowId: tst.id, url: cur, title,
          reason: g.reason || 'not permitted',
          error: g.error || 'Reading this tab is not allowed.',
        };
      }
    }
    let data;
    try {
      data = await execTimeout(
        twc.executeJavaScript(aiPage.snapshotScript()),
        opts.extractMs || 15000, 'the tab did not answer'
      );
    } catch (err) {
      return {
        ok: false, tabId: tid, windowId: tst.id, url: cur, title,
        reason: 'read failed',
        error: 'Could not read that tab: ' + (err && err.message || err),
      };
    }
    if (!data || !data.ok) {
      return {
        ok: false, tabId: tid, windowId: tst.id, url: cur, title,
        reason: 'no readable content',
        error: 'That tab returned no readable content.',
      };
    }
    return {
      ok: true, tabId: tid, windowId: tst.id,
      url: data.url || cur, finalUrl: cur, title: data.title || title,
      description: String(data.description || ''),
      outline: String(data.outline || ''),
      text: String(data.text || '').slice(0, 12000),
      woke: woke || undefined,
    };
  }
  // ---------- All-tabs inspection (shared by the Read button + agent) --------
  // Single flight per window: a sweep walks every tab sequentially, so a
  // second concurrent sweep would only duplicate work and tab reads.
  const inspectFleet = new Set();
  async function inspectAllTabs(opts = {}) {
    const key = String(opts.key || 'default');
    if (inspectFleet.has(key)) {
      return { ok: false, error: 'An all-tabs inspection is already running in this window.' };
    }
    inspectFleet.add(key);
    const A = opts.account || null;
    const prefs = A ? agentPrefs(A) : null;
    const allowlistOn = Boolean(prefs && prefs.agentAllowlistOn);
    const crossTabOff = Boolean(prefs && prefs.agentCrossTab === false) && opts.enforceCrossTab === true;
    const notAllowed = (url) => ({
      reason: 'not on your allowed sites',
      error: (url || 'That tab') + ' is not on your allowed sites list.',
    });
    try {
      return await research.inspectTabs({
        listTabs: () => allTabsSnapshot(),
        // The same per-tab reader the read_tab tool uses; the allowlist is
        // re-checked after the page settles, before any content is extracted.
        readTab: (tid) => readTabById(tid, {
          settleMs: research.INSPECT_SETTLE_MS,
          extractMs: research.INSPECT_EXTRACT_MS,
          gate: allowlistOn ? (curUrl) => (agentSiteAllowed(A, curUrl) ? null : notAllowed(curUrl)) : undefined,
        }),
      }, {
        includeText: opts.includeText === true,
        maxTabs: research.INSPECT_MAX_TABS,
        deadlineMs: research.INSPECT_TOTAL_MS,
        onProgress: opts.onProgress,
        skipTab: (tb) => {
          if (crossTabOff && String(tb.tabId) !== String(opts.runTabId || '')) {
            return { reason: 'other-tab reading is turned off', error: 'Reading other tabs is turned off in Settings.' };
          }
          if (allowlistOn && !agentSiteAllowed(A, tb.url)) return notAllowed(tb.url);
          return null;
        },
      });
    } finally {
      inspectFleet.delete(key);
    }
  }
  async function requireAgentCap(run, cap, why) {
    const A = accountForRun(run);
    if (!A) return false;
    if (aiCaps(A)[cap]) return true;
    const st = windows.get(run.winId);
    if (!st || st.win.isDestroyed()) return false;
    return askCapability(
      st, A, cap, run.clientReqId,
      'Turn on ' + AI_CAP_LABELS[cap] + '?',
      why || ('Dexerion AI asked to use ' + AI_CAP_LABELS[cap] + ' for this task. It stays on until you turn it off.')
    );
  }
  async function dispatchAgentAction(run, action, args, refs) {
    const wc = agentTabWc(run);
    if (!wc) return { ok: false, halted: true, error: 'The tab is gone.' };
    let url = '';
    try { url = wc.getURL() || ''; } catch {}
    if (AGENT_PAGE_ACTIONS[action]) {
      // Revalidate everything right before executing: the tab may have been
      // navigated, closed, or the allowlist changed since the model decided.
      if (aiPage.isUnreadable(url)) {
        return { ok: false, error: 'Acting is limited to normal http(s) pages and the Dexerion new tab (' + (url || 'this page') + ').' };
      }
      const A = accountForRun(run);
      if (A && !aiCaps(A).agent) {
        return { ok: false, error: 'Agent mode is off. Turn on the lightning button to act on this page.' };
      }
      if (A && !agentSiteAllowed(A, url)) {
        return { ok: false, error: 'This page is not on your allowed sites list, so acting here is blocked. Add it in Dexerion AI → Settings → Acting on pages.' };
      }
      if (refBasedAction(action, args)) {
        if (!run.snapUrl) {
          return { ok: false, error: 'Take a snapshot first — ref numbers come from it.' };
        }
        if (research.normUrl(url) !== research.normUrl(run.snapUrl)) {
          return { ok: false, error: 'The page changed since your last snapshot (now ' + url + '). Take a fresh snapshot before acting on ref numbers.' };
        }
      }
      const res = await runAgentInPage(wc, { action, args, refs, runId: run.id });
      // A click can commit a navigation after it returns. Wait for that commit
      // and for the load, so the model never reads the page it just left.
      if (res && res.ok !== false && AGENT_SETTLE_ACTIONS[action]) {
        const settled = await settleAfterAction(wc, url, { ms: 6000 });
        if (settled.changed) {
          res.url = settled.url || res.url;
          res.note = (settled.stillLoading
            ? 'The page started loading but had not finished after 6s. '
            : 'The page navigated. ') + 'Take a snapshot to see where you are before acting again.';
          res.navigated = true;
          run.snapUrl = '';
          run.refs = null;
          run.nodes = {};
        }
      }
      return res;
    }
    if (action === 'navigate') {
      const target = String((args && args.url) || '');
      if (!/^https?:\/\//i.test(target)) {
        return { ok: false, error: 'Only http(s) URLs can be opened. Got: ' + target };
      }
      const navAccount = accountForRun(run);
      if (navAccount && !await requireAgentCap(run, 'websites', 'Dexerion AI asked to open ' + target + ' in this tab. Website access stays on until you turn it off.')) {
        return { ok: false, error: 'Website access is off, so the page was not opened.' };
      }
      if (navAccount && !agentSiteAllowed(navAccount, target)) {
        return { ok: false, error: 'That site is not on your allowed sites list, so navigating there is blocked.' };
      }
      try { await wc.loadURL(target); }
      catch (err) { return { ok: false, error: 'Could not open ' + target + ': ' + (err && err.message || err) }; }
      await settleTab(wc);
      let cur = target, title = '';
      try { cur = wc.getURL() || target; } catch {}
      try { title = wc.getTitle() || ''; } catch {}
      return { ok: true, action: 'navigate', url: cur, title, note: 'Take a snapshot to see the new page.' };
    }
    if (action === 'back') {
      let can = false;
      try { can = wc.canGoBack(); } catch {}
      if (!can) return { ok: false, error: 'Nothing to go back to.' };
      try { wc.goBack(); }
      catch (err) { return { ok: false, error: 'Could not go back: ' + (err && err.message || err) }; }
      await settleTab(wc);
      let cur = '', title = '';
      try { cur = wc.getURL() || ''; } catch {}
      try { title = wc.getTitle() || ''; } catch {}
      return { ok: true, action: 'back', url: cur, title, note: 'Take a snapshot to see the new page.' };
    }
    const st = windows.get(run.winId);
    if (!st || st.win.isDestroyed()) return { ok: false, halted: true, error: 'The window is gone.' };
    const A = accountForRun(run);
    if (action === 'list_tabs') {
      return {
        ok: true, action: 'list_tabs',
        tabs: allTabsSnapshot().map(tb => ({ ...tb, readable: !aiPage.isUnreadable(tb.url) })),
      };
    }
    if (action === 'search_tabs') {
      const query = String((args && args.query) || '').slice(0, 300);
      if (!query.trim()) return { ok: false, error: 'search_tabs needs a query.' };
      // Cross-tab off: titles and URLs still work (they are visible in the
      // tab strip); only content scans and reads of other tabs are gated.
      const crossTabOn = !A || agentPrefs(A).agentCrossTab !== false;
      const scan = crossTabOn && (args && args.scanContent) === true;
      const all = allTabsSnapshot();
      const ranked = research.rankTabs(all, query, research.MAX_MATCHES);
      const matched = new Set(ranked.map(r => r.tab.tabId));
      const matches = ranked.map(r => ({
        tabId: r.tab.tabId, windowId: r.tab.windowId,
        title: r.tab.title, url: r.tab.url,
        active: r.tab.active,
        readable: !aiPage.isUnreadable(r.tab.url),
        asleep: r.tab.asleep, loading: r.tab.loading,
        why: r.why,
      }));
      const scanned = [];
      const skipped = [];
      if (scan) {
        const terms = research.termsOf(query);
        let left = research.MAX_SCAN_TABS;
        for (const tb of all) {
          if (!terms.length || matched.has(tb.tabId)) continue;
          if (aiPage.isUnreadable(tb.url)) { skipped.push({ tabId: tb.tabId, title: tb.title, url: tb.url, reason: 'not readable' }); continue; }
          if (tb.asleep) { skipped.push({ tabId: tb.tabId, title: tb.title, url: tb.url, reason: 'asleep' }); continue; }
          if (tb.loading) { skipped.push({ tabId: tb.tabId, title: tb.title, url: tb.url, reason: 'loading' }); continue; }
          if (A && agentPrefs(A).agentAllowlistOn && !agentSiteAllowed(A, tb.url)) {
            skipped.push({ tabId: tb.tabId, title: tb.title, url: tb.url, reason: 'not on your allowed sites' });
            continue;
          }
          if (left <= 0) { skipped.push({ tabId: tb.tabId, title: tb.title, url: tb.url, reason: 'scan limit reached' }); continue; }
          left--;
          const got = findTabEverywhere(tb.tabId);
          const twc = got && got.t && got.t.view && got.t.view.webContents;
          if (!twc || twc.isDestroyed()) { skipped.push({ tabId: tb.tabId, title: tb.title, url: tb.url, reason: 'unavailable' }); continue; }
          try {
            const data = await execTimeout(
              twc.executeJavaScript(aiPage.snapshotScript()),
              4000, 'the tab did not answer'
            );
            const text = String((data && data.text) || '');
            const hits = research.matchInText(text, terms, { maxHits: 2 });
            if (data && data.ok && hits.length && matches.length < 12) {
              matches.push({
                tabId: tb.tabId, windowId: tb.windowId,
                title: data.title || tb.title, url: data.url || tb.url,
                active: tb.active, readable: true, why: 'page text',
                snippet: hits.map(h => h.text).join(' … ').slice(0, 400),
              });
              // Text is kept for exact-quote citation checks (capped).
              scanned.push({ tabId: tb.tabId, url: data.url || tb.url, title: data.title || tb.title, text: text.slice(0, 12000) });
            }
          } catch {
            skipped.push({ tabId: tb.tabId, title: tb.title, url: tb.url, reason: 'read failed' });
          }
        }
      }
      return {
        ok: true, action: 'search_tabs', query,
        matches: matches.slice(0, 12),
        scanned,
        skipped: skipped.slice(0, 8),
        note: scan
          ? 'Content search scanned ' + scanned.length + ' matching tab(s).'
          : crossTabOn
            ? 'Titles and URLs only — set scanContent to search inside page text.'
            : 'Titles and URLs only — reading other tabs is turned off in Settings.',
      };
    }
    if (action === 'inspect_tabs') {
      if (!A) return { ok: false, error: 'The window is gone; nothing was inspected.' };
      // The shared all-tabs workflow (same one the Read button runs), with
      // per-tab progress shown on the runbar.
      const report = await inspectAllTabs({
        key: 'win:' + (run.actWinId || run.winId),
        account: A,
        includeText: true,
        enforceCrossTab: true,
        runTabId: run.tabId,
        onProgress: (p) => {
          try { emitAgentEvent(run, { type: 'runbar', label: 'Reading "' + (p.title || p.tabId) + '" (' + p.i + '/' + p.total + ')…' }); } catch {}
        },
      });
      if (!report.ok) return report;
      return { ok: true, action: 'inspect_tabs', report };
    }
    if (action === 'synthesize_tabs') {
      if (!A) return { ok: false, error: 'The window is gone; nothing was synthesized.' };
      const tabIds = Array.isArray(args && args.tabIds) ? args.tabIds : [];
      if (!tabIds.length || tabIds.length > 8) return { ok: false, error: 'Provide 2-8 tab ids from list_tabs/search_tabs.' };
      const focus = String(args.focus || '').trim();
      const pages = [];
      for (const tid of tabIds) {
        const got = findTabEverywhere(String(tid));
        if (!got) continue;
        const { st: tst, t } = got;
        const r = await readTabById(tid, {
          settleMs: 4000,
          gate: (A && agentPrefs(A).agentAllowlistOn)
            ? (curUrl) => (agentSiteAllowed(A, curUrl) ? null : { reason: 'not on your allowed sites' })
            : undefined,
        });
        if (r.ok) {
          pages.push({ id: String(tid), title: r.title || '(untitled)', url: r.finalUrl || r.url, text: r.text || '' });
        }
      }
      if (pages.length < 2) return { ok: false, error: 'Could not read at least two of the requested tabs.' };
      // Build a structured comparison for the model to answer from.
      const lines = ['Synthesize these pages into a comparison.'];
      if (focus) lines.push('Focus: ' + focus);
      lines.push('');
      for (const p of pages) {
        lines.push('--- ' + p.title + ' (' + p.url + ') ---');
        lines.push(String(p.text || '').slice(0, 3000));
        lines.push('');
      }
      lines.push('Produce: (1) What the pages agree on, (2) Where they disagree, (3) Key takeaways. Cite each page by title/URL.');
      return {
        ok: true,
        action: 'synthesize_tabs',
        result: lines.join('\n'),
        pages: pages.map(p => ({ id: p.id, title: p.title, url: p.url })),
        summary: 'Synthesized ' + pages.length + ' tab' + (pages.length === 1 ? '' : 's') + (focus ? ' on "' + focus + '"' : ''),
      };
    }
    if (action === 'open_tab') {
      const target = String((args && args.url) || '');
      if (!/^https?:\/\//i.test(target) || aiPage.isUnreadable(target)) {
        return { ok: false, error: 'Only normal http(s) websites can be opened. Got: ' + target };
      }
      if (!await requireAgentCap(run, 'websites', 'Dexerion AI asked to open ' + target + ' in a new tab. Website access stays on until you turn it off.')) {
        return { ok: false, error: 'Website access is off, so no new tab was opened.' };
      }
      const openSt = windows.get(run.actWinId || run.winId) || st;
      // Tab hygiene: the same URL is already open (the run may have opened it
      // itself a moment ago, or the person had it open) — reuse that tab
      // instead of stacking duplicates.
      const wanted = research.normUrl(target);
      const existing = openSt.order
        .map((id) => ({ id, tab: openSt.tabs.get(id) }))
        .find(({ tab: other }) => other && String(other.url || '') && research.normUrl(other.url) === wanted);
      if (existing) {
        return {
          ok: true, action: 'open_tab', tabId: existing.id,
          url: String(existing.tab.url || target), title: String(existing.tab.title || ''),
          note: 'That page was already open in tab ' + existing.id + ' — reusing it instead of opening a duplicate.',
          reused: true,
        };
      }
      const nid = newTab(openSt.id, target, true);
      if (!nid) return { ok: false, error: 'Could not open a new tab.' };
      const nt = openSt.tabs.get(nid);
      const nwc = nt && nt.view && nt.view.webContents;
      if (nwc) await settleTab(nwc);
      let nurl = target, ntitle = '';
      try { nurl = (nwc && !nwc.isDestroyed() && nwc.getURL()) || target; } catch {}
      try { ntitle = (nwc && !nwc.isDestroyed() && nwc.getTitle()) || ''; } catch {}
      return { ok: true, action: 'open_tab', tabId: nid, url: nurl, title: ntitle };
    }
    if (action === 'read_tab' || action === 'switch_tab' || action === 'close_tab') {
      const tid = String((args && args.tabId) || '');
      const got = findTabEverywhere(tid);
      if (!got) {
        // Ids go stale fast (closing/navigating tabs): hand back the current
        // list so the retry can pick a correct id. Never substitute a tab.
        return { ok: false, error: research.withTabRefs(
          'No tab with id ' + (tid || '(missing)') + ' — it may have been closed or navigated away.',
          allTabsSnapshot()
        ) };
      }
      const { st: tst, t } = got;
      const isRunTab = tid === run.tabId;
      const crossTab = !A || agentPrefs(A).agentCrossTab !== false;
      if (action === 'read_tab') {
        if (!isRunTab && !crossTab) {
          return { ok: false, error: 'Reading other tabs is turned off (Dexerion AI → Settings → Acting on pages).' };
        }
        // Same reader the all-tabs inspection uses; the allowlist is
        // revalidated after settle, before any content is extracted.
        const r = await readTabById(tid, {
          settleMs: 6000,
          gate: (A && agentPrefs(A).agentAllowlistOn)
            ? (curUrl) => (agentSiteAllowed(A, curUrl) ? null : {
              reason: 'not on your allowed sites',
              error: 'That tab (' + curUrl + ') is not on your allowed sites list. Add it in Dexerion AI → Settings → Acting on pages, or use another source.',
            })
            : undefined,
        });
        if (r.ok) {
          return {
            ok: true, action: 'read_tab', tabId: r.tabId, windowId: r.windowId,
            url: r.url, finalUrl: r.finalUrl, title: r.title,
            text: r.text, woke: r.woke,
          };
        }
        return { ok: false, error: r.error, reason: r.reason };
      }
      if (action === 'switch_tab') {
        if (!isRunTab && !crossTab) {
          return { ok: false, error: 'Switching other tabs is turned off (Dexerion AI → Settings → Acting on pages).' };
        }
        activateTab(tst.id, tid);
        try { focusWindow(tst.id); } catch {}
        // Actions follow the run's tab, so move it rather than leaving the
        // next click to land wherever it was.
        run.tabId = tid;
        run.actWinId = tst.id;
        run.refs = null;
        run.nodes = {};
        run.snapUrl = '';
        // The newly active document may carry a stale halt flag from an
        // earlier stopped run — reset it like run start does.
        const nwc = agentTabWc(run);
        if (nwc) {
          try { await execTimeout(nwc.executeJavaScript('window.__dexHalt = false;0'), 5000, 'halt reset timed out'); } catch {}
        }
        return { ok: true, action: 'switch_tab', tabId: tid, windowId: tst.id, url: t.url, title: t.title, note: 'Take a snapshot to see the new page.' };
      }
      // close_tab
      if (isRunTab) {
        return { ok: false, error: 'That is the tab this run is acting on; it can\'t be closed.' };
      }
      closeTab(tst.id, tid);
      return { ok: true, action: 'close_tab', tabId: tid };
    }
    if (action === 'open_project') {
      if (!A) return { ok: false, error: 'The window is gone; the project was not saved.' };
      const draft = research.sanitizeProjectDraft(args);
      if (!draft.ok) return { ok: false, error: draft.error };
      const project = research.makeProject(draft);
      if (!Array.isArray(A.projects)) A.projects = [];
      A.projects.unshift(project);
      A.projects = A.projects.slice(0, 50);
      saveAcc(st.accountId);
      broadcastProjects(st.accountId);
      run.projectId = project.id;
      return {
        ok: true, action: 'open_project',
        project: { id: project.id, title: project.title, goal: project.goal },
      };
    }
    if (action === 'note_finding') {
      if (!A) return { ok: false, error: 'The window is gone; the entry was not saved.' };
      const kind = (args && args.kind === 'decision') ? 'decisions'
        : (args && args.kind === 'question') ? 'questions' : 'findings';
      const text = research.clean(args && args.text,
        kind === 'findings' ? research.MAX_FINDING_CHARS : research.MAX_ENTRY_CHARS);
      if (!text) return { ok: false, error: 'Nothing to save — give the entry some text.' };
      const projects = Array.isArray(A.projects) ? A.projects : [];
      const idx = projects.findIndex(p => p && p.id === run.projectId);
      if (idx < 0) {
        return { ok: false, error: 'No research project is open in this run. Call open_project first (the user approves the exact title and goal), or answer without saving.' };
      }
      let project = research.normalizeProject(projects[idx]);
      if (!project) return { ok: false, error: 'The open project could not be read back; open a new one.' };
      let sourceUrl = String((args && args.url) || '');
      if (kind === 'findings') {
        // Anti-fabrication: the cited page must be one this run read, and a
        // quote must occur in the text it captured.
        const check = research.findingCheck(run.readPages, args || {});
        if (!check.ok) return { ok: false, error: check.error };
        sourceUrl = check.url;
        project = research.addSource(project, { url: check.url, title: (check.page && check.page.title) || '' });
      } else if (sourceUrl) {
        project = research.addSource(project, { url: sourceUrl, title: '' });
      }
      const added = research.addEntry(project, kind, {
        text, url: sourceUrl || undefined, quote: args && args.quote,
      });
      if (!added.added) return { ok: false, error: added.error };
      projects[idx] = added.project;
      A.projects = projects;
      saveAcc(st.accountId);
      broadcastProjects(st.accountId);
      const noun = kind === 'findings' ? 'finding' : kind === 'decisions' ? 'decision' : 'open question';
      return {
        ok: true, action: 'note_finding', kind,
        note: 'Saved the ' + noun + ' to "' + added.project.title + '".',
        project: { id: added.project.id, title: added.project.title },
      };
    }
    if (action === 'screenshot') {
      if (!await requireAgentCap(run, 'vision', 'Dexerion AI asked to look at this page as an image. Vision stays on until you turn it off.')) {
        return { ok: false, error: 'Vision is off, so no screenshot was taken.' };
      }
      const image = await captureTabImage(wc);
      if (!image) return { ok: false, error: 'Vision could not capture this page.' };
      let title = '';
      try { title = wc.getTitle() || ''; } catch {}
      return { ok: true, action: 'screenshot', image, url: url || '', title };
    }
    if (action === 'edit_document') {
      if (!await requireAgentCap(run, 'documents', 'Dexerion AI asked to edit the latest document in this chat. Document editing stays on until you turn it off.')) {
        return { ok: false, error: 'Document editing is off, so the document was not changed.' };
      }
      const instructions = String((args && args.instructions) || '').trim();
      if (!instructions) return { ok: false, error: 'Give the document edit some instructions.' };
      const docAccount = accountForRun(run);
      if (!docAccount) return { ok: false, error: 'The window is gone; the document was not changed.' };
      const store = chatStore(st, docAccount);
      const scan = (chat) => {
        const msgs = (chat && Array.isArray(chat.messages)) ? chat.messages : [];
        for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i] && msgs[i].artifact) return msgs[i].artifact;
        return null;
      };
      let artifact = scan(store.find(run.chatId || ''));
      if (!artifact) {
        for (const chat of store.list) { artifact = scan(chat); if (artifact) break; }
      }
      if (!artifact) return { ok: false, error: 'No document has been made yet — ask for one first.' };
      run.wantsArtifact = true;
      return {
        ok: true,
        action: 'edit_document',
        result: aiArtifacts.artifactRevisionPrompt(artifact, instructions),
        summary: 'Armed document editing for "' + (artifact.title || 'the document') + '"',
      };
    }
    return { ok: false, error: 'Unknown action: ' + action };
  }
  // Batchers keyed by run: agent text streams through the same ~30ms coalescer
  // as chat sends (payload shape unchanged) and is flushed for good on the
  // run's end event.
  const agentChunkBatchers = new Map();
  // B3: the agent runner (and the ai-agent -> ai-tools -> ai-page/ai-research
  // stack under it) is created on first use, not at boot. Teardown hooks guard
  // on agentInstance so closing a window or tab never instantiates the stack;
  // a fresh runner owns no runs, so skipping those calls is equivalent.
  let agentInstance = null;
  const agentRef = () => (agentInstance || (agentInstance = aiAgent.createAgentRunner({
    streamTurn: (reqId, wireMessages, opts, onText) => ai.stream(reqId, wireMessages, onText, opts),
    dispatch: dispatchAgentAction,
    askUser: askAgentUser,
    emit: emitAgentEvent,
    onText: (run, delta, full) => {
      const st = windows.get(run.winId);
      if (!st || st.win.isDestroyed()) return;
      let batcher = agentChunkBatchers.get(run.clientReqId);
      if (!batcher) {
        batcher = makeChunkBatcher((payload) => {
          const w = windows.get(run.winId);
          if (w && !w.win.isDestroyed()) w.win.webContents.send('dex:ai-chunk', payload);
        }, run.clientReqId);
        agentChunkBatchers.set(run.clientReqId, batcher);
      }
      batcher.push(delta, full);
    },
    // Honest progress after every action: how many steps ran, how much of the
    // plan is done, and how long the run has been going.
    onProgress: (run) => {
      try {
        const steps = Array.isArray(run.plan && run.plan.steps) ? run.plan.steps : [];
        const total = steps.length;
        const done = total ? research.planProgress(run.plan) : 0;
        const elapsedMs = Math.max(0, Date.now() - (run.startedAt || Date.now()));
        const label = total
          ? 'Working… ' + done + '/' + total + ' plan steps'
          : 'Working… ' + run.steps.length + (run.steps.length === 1 ? ' step' : ' steps');
        emitAgentEvent(run, {
          type: 'progress',
          label,
          steps: run.steps.length,
          planDone: done,
          planTotal: total,
          elapsedMs,
        });
      } catch { /* progress is best effort */ }
    },
    onStop: (run) => {
      ai.cancel(run.loopReqId);
      const wc = agentTabWc(run);
      if (wc) wc.executeJavaScript('window.__dexHalt = true;0').catch(() => {});
      emitAgentEvent(run, { type: 'end', halted: run.halted });
    },
  })));

  // ---------- Search With Dexerion AI (fullscreen search) ----------
  // ai-search.js owns the pipeline; these adapters give it background tabs, the
  // shared page reader and the NIM stream, and surface progress to the shell.
  // B3: same deferred construction as the agent runner above; the window-close
  // hook guards on searchInstance so closing a window never loads the stack.
  let searchInstance = null;
  const searchRef = () => (searchInstance || (searchInstance = aiSearch.createAiSearchRunner({
    stream: (reqId, messages, onText, opts) => ai.stream(reqId, messages, onText, opts),
    cancel: (reqId) => ai.cancel(reqId),
    fetchText: (url, opts) => fetchSearchText(url, opts),
    openTab: (winId, url) => newTab(winId, url, true),
    closeTab: (winId, tabId) => closeTab(winId, tabId),
    readPage: (winId, tabId) => readSourceTab(winId, tabId),
    emit: (winId, event) => {
      const st = windows.get(winId);
      if (!st || st.win.isDestroyed()) return;
      try { st.win.webContents.send('dex:ai-search-progress', event); } catch {}
    },
  })));

  // Text fetch for the search pipeline's provider endpoints: Chromium's
  // network stack, a hard timeout, a text-only content-type gate and a 2MB
  // body cap. The pipeline's own guards (private hosts, the denylist) run
  // before this is ever called; redirects are re-checked by the caller.
  //
  // DEX_SEARCH_BASE is the e2e seam (same idea as DEX_AI_BASE): it rewrites
  // provider hostnames onto the local mock while keeping every path, so the
  // pipeline code under test is the shipped one. Production never sets it.
  const SEARCH_TEST_BASE = (() => {
    const base = String(process.env.DEX_SEARCH_BASE || '').trim().replace(/\/+$/, '');
    return /^https?:\/\//i.test(base) ? base : '';
  })();
  function mapSearchUrl(url) {
    if (!SEARCH_TEST_BASE) return String(url);
    try {
      const u = new URL(String(url));
      return SEARCH_TEST_BASE + u.pathname + u.search;
    } catch { return String(url); }
  }
  async function fetchSearchText(url, opts) {
    const o = opts || {};
    const ctl = new AbortController();
    const timeoutMs = Math.max(1000, Number(o.timeoutMs) || aiSearchRead.FETCH_TIMEOUT_MS);
    const timer = setTimeout(() => { try { ctl.abort(); } catch {} }, timeoutMs);
    const forward = () => { try { ctl.abort(); } catch {} };
    try { if (o.signal) o.signal.addEventListener('abort', forward, { once: true }); } catch {}
    try {
      const res = await net.fetch(mapSearchUrl(url), {
        method: 'GET',
        redirect: 'follow',
        cache: 'no-store',
        signal: ctl.signal,
        headers: {
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/rss+xml;q=0.9,application/atom+xml;q=0.9,application/json;q=0.8,*/*;q=0.5',
        },
      });
      const contentType = String(res.headers.get('content-type') || '');
      const finalUrl = res.url || String(url);
      if (!res.ok) return { ok: false, status: res.status, url: finalUrl, contentType, error: 'HTTP ' + res.status };
      if (!aiSearchRead.isTextType(contentType)) {
        return { ok: false, status: res.status, url: finalUrl, contentType, error: 'Not a text page.' };
      }
      let text = '';
      try {
        const reader = res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;
        if (reader) {
          const chunks = [];
          let total = 0;
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value && value.byteLength) { chunks.push(value); total += value.byteLength; }
            if (total >= aiSearchRead.MAX_BODY_BYTES) { try { await reader.cancel(); } catch {} break; }
          }
          const merged = new Uint8Array(Math.min(total, aiSearchRead.MAX_BODY_BYTES));
          let offset = 0;
          for (const chunk of chunks) {
            if (offset >= merged.length) break;
            const slice = chunk.subarray(0, merged.length - offset);
            merged.set(slice, offset);
            offset += slice.byteLength;
          }
          text = new TextDecoder('utf-8').decode(merged);
        } else {
          text = await res.text();
        }
      } catch { text = ''; }
      return { ok: true, status: res.status, url: finalUrl, contentType, text: text.slice(0, aiSearchRead.MAX_BODY_BYTES) };
    } catch (err) {
      const aborted = err && (err.name === 'AbortError' || /abort/i.test(String(err.message || '')));
      return { ok: false, url: String(url), contentType: '', error: aborted ? 'Timed out.' : String((err && err.message) || err) };
    } finally {
      clearTimeout(timer);
      try { if (o.signal) o.signal.removeEventListener('abort', forward); } catch {}
    }
  }

  // Binary image fetch for generation-time site research. Same Chromium
  // network stack and test-base remap as fetchSearchText, but the shared URL
  // guard runs here too (before AND after redirects), only four raster types
  // are accepted, and the body is cut off hard at the per-image byte cap.
  // The pure site-research-assets module applies the same budget again.
  async function fetchSiteAssetBinary(url, opts) {
    const o = opts || {};
    const check = aiSearchRead.checkFetchUrl(url);
    if (!check.ok) return { ok: false, url: String(url || ''), contentType: '', error: check.error };
    const ctl = new AbortController();
    const timeoutMs = Math.max(1000, Number(o.timeoutMs) || siteResearchAssets.ASSET_FETCH_TIMEOUT_MS);
    const maxBytes = Math.max(1024, Number(o.maxBytes) || siteResearchAssets.MAX_ASSET_RAW_BYTES);
    const timer = setTimeout(() => { try { ctl.abort(); } catch {} }, timeoutMs);
    const forward = () => { try { ctl.abort(); } catch {} };
    try { if (o.signal) o.signal.addEventListener('abort', forward, { once: true }); } catch {}
    try {
      const res = await net.fetch(mapSearchUrl(check.url), {
        method: 'GET',
        redirect: 'follow',
        cache: 'no-store',
        signal: ctl.signal,
        headers: { accept: 'image/png,image/jpeg,image/webp,image/gif;q=0.9,*/*;q=0.1' },
      });
      const contentType = String(res.headers.get('content-type') || '');
      const finalUrl = res.url || check.url;
      const finalCheck = aiSearchRead.checkFetchUrl(finalUrl);
      if (!finalCheck.ok) return { ok: false, url: finalUrl, contentType, error: finalCheck.error };
      if (!res.ok) return { ok: false, status: res.status, url: finalUrl, contentType, error: 'HTTP ' + res.status };
      const type = contentType.split(';')[0].trim().toLowerCase();
      if (!siteResearchAssets.isAllowedImageType(type)) {
        return { ok: false, status: res.status, url: finalUrl, contentType, error: 'Only PNG, JPEG, WebP and GIF images are allowed.' };
      }
      const reader = res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;
      if (!reader) return { ok: false, url: finalUrl, contentType, error: 'No image body was returned.' };
      const chunks = [];
      let total = 0;
      let tooBig = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && value.byteLength) {
          chunks.push(value);
          total += value.byteLength;
          if (total > maxBytes) { tooBig = true; try { await reader.cancel(); } catch {} break; }
        }
      }
      if (tooBig) return { ok: false, url: finalUrl, contentType, error: 'Image exceeds the per-image byte cap.' };
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        if (offset >= bytes.length) break;
        const slice = chunk.subarray(0, bytes.length - offset);
        bytes.set(slice, offset);
        offset += slice.byteLength;
      }
      return { ok: true, status: res.status, url: finalUrl, contentType, bytes };
    } catch (err) {
      const aborted = err && (err.name === 'AbortError' || /abort/i.test(String(err.message || '')));
      return { ok: false, url: String(url), contentType: '', error: aborted ? 'Timed out.' : String((err && err.message) || err) };
    } finally {
      clearTimeout(timer);
      try { if (o.signal) o.signal.removeEventListener('abort', forward); } catch {}
    }
  }

  function workTabContents(winId, tabId) {
    const st = windows.get(winId);
    const t = st && st.tabs.get(tabId);
    const wc = t && t.view && t.view.webContents;
    return wc && !wc.isDestroyed() ? wc : null;
  }

  function execInTab(wc, code, ms) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => { if (settled) return; settled = true; resolve(value); };
      try { wc.executeJavaScript(code).then(finish).catch(() => finish(null)); } catch { finish(null); }
      setTimeout(() => finish(null), Math.max(1000, Number(ms) || 8000)).unref?.();
    });
  }

  function waitForTabLoad(wc, ms) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        try { wc.removeListener('did-finish-load', finish); } catch {}
        try { wc.removeListener('did-fail-load', onFail); } catch {}
        resolve();
      };
      const onFail = (event, code, desc, url, isMainFrame) => { if (isMainFrame !== false) finish(); };
      try {
        if (!wc.isLoading()) { finish(); return; }
        wc.once('did-finish-load', finish);
        wc.on('did-fail-load', onFail);
        setTimeout(finish, Math.max(2000, Number(ms) || 12000)).unref?.();
      } catch { finish(); }
    });
  }

  async function readSourceTab(winId, tabId) {
    const wc = workTabContents(winId, tabId);
    if (!wc) throw new Error('The source tab closed.');
    await waitForTabLoad(wc, 12000);
    await new Promise(r => setTimeout(r, 450));
    if (wc.isDestroyed()) throw new Error('The source tab closed.');
    const snap = await execInTab(wc, aiPage.snapshotScript(), 8000);
    if (!snap || snap.ok === false) throw new Error('The page could not be read.');
    return { title: snap.title, url: snap.url, text: String(snap.text || snap.fullText || '') };
  }

  function aiSearchConfig(A) {
    return {
      suggestions: Boolean(S.settings.aiSearchSuggest),
      sources: aiSearch.clampSources(S.settings.aiSearchSources),
      adaptations: aiSearch.clampAdaptations(S.settings.aiSearchAdaptations),
      difficulty: difficultyOf(A),
      theme: S.settings.theme || 'dark',
      accent: S.settings.accent || '#35c4ff',
    };
  }

  // The surface takes the whole window: hide the page view so the shell (and
  // its overlay) owns every pixel, and restore it when the surface closes.
  function openAiSearch(st, A) {
    if (!st || st.win.isDestroyed()) return false;
    // The search surface is shell chrome (toolbar etc.): video fullscreen
    // hands the window over first so the surface has its chrome to draw in.
    if (st.htmlFullscreen) exitHtmlFullscreen(st.id);
    if (!st.searchOpen) { st.searchOpen = true; layout(st.id); }
    try { st.win.webContents.send('dex:aisearch-show', aiSearchConfig(A)); } catch {}
    try { st.win.webContents.focus(); } catch {}
    return true;
  }

  function closeAiSearch(st) {
    if (!st || st.win.isDestroyed()) return false;
    if (st.searchOpen) { st.searchOpen = false; layout(st.id); }
    try {
      const t = st.tabs.get(st.active);
      const wc = t && t.view && t.view.webContents;
      if (wc && !wc.isDestroyed()) wc.focus();
    } catch {}
    return true;
  }

  ipcMain.handle('dex:aisearch-open', (e) => { const { st, A } = Aof(e); return openAiSearch(st, A); });
  ipcMain.handle('dex:aisearch-close', (e) => { const { st } = needChrome(e); return closeAiSearch(st); });
  ipcMain.handle('dex:aisearch-suggest', async (e, q) => {
    needChrome(e);
    if (!S.settings.aiSearchSuggest) return [];
    const query = String(q || '').trim().slice(0, 200);
    if (!query) return [];
    const list = await engineCompletions(query, 'google');
    return list.slice(0, 8);
  });
  ipcMain.handle('dex:ai-search-run', async (e, { reqId, query, history } = {}) => {
    const { st, A } = Aof(e);
    const q = String(query || '').trim().slice(0, 400);
    if (!q) return { ok: false, error: 'Type a question first.' };
    if (!ai.status().hasKey) return { ok: false, error: 'Connect Dexerion AI first.' };
    const hist = (Array.isArray(history) ? history : []).slice(-12).map(message => ({
      role: message && message.role === 'model' ? 'model' : 'user',
      text: String((message && message.text) || '').slice(0, 2000),
    }));
    return await searchRef().run({
      reqId: String(reqId || ('ais' + Date.now())).slice(0, 80),
      winId: st.id,
      query: q,
      history: hist,
      sources: S.settings.aiSearchSources,
      adaptations: S.settings.aiSearchAdaptations,
      difficulty: difficultyOf(A),
    });
  });
  ipcMain.handle('dex:ai-search-stop', (e, reqId) => { needChrome(e); return searchRef().stop(String(reqId || '')); });
  // The difficulty chip (search surface now; the sidebar task bar in Phase 2).
  // The tier is a preference, never a model name — the scout owns the model.
  ipcMain.handle('dex:ai-difficulty-get', (e) => {
    const { A } = Aof(e);
    return { difficulty: difficultyOf(A) };
  });
  ipcMain.handle('dex:ai-difficulty-set', (e, value) => {
    const { st, A } = Aof(e);
    const next = AI_DIFFICULTIES.includes(String(value || '')) ? String(value) : 'medium';
    A.aiDifficulty = next;
    saveAcc(st.accountId);
    // Effort is the default chooser: changing it drops any manual model pin
    // so the scout's Nemotron pick for this tier takes over immediately.
    try { ai.save({ pinned: '' }); } catch {}
    return { difficulty: next, model: ai.status(next).model };
  });
  ipcMain.handle('dex:ai-agent-get', (e) => {
    const { A } = Aof(e);
    return agentPrefs(A);
  });
  ipcMain.handle('dex:ai-agent-set', (e, patch) => {
    const { st, A } = Aof(e);
    const cur = agentPrefs(A);
    const p = (patch && typeof patch === 'object') ? patch : {};
    const nextAgent = p.agent === undefined ? cur.agent : Boolean(p.agent);
    A.aiAgent = {
      agent: nextAgent,
      agentMaxSteps: p.agentMaxSteps === undefined ? cur.agentMaxSteps
        : Math.max(1, Math.min(200, parseInt(p.agentMaxSteps, 10) || 25)),
      agentAllowlistOn: p.agentAllowlistOn === undefined ? cur.agentAllowlistOn : Boolean(p.agentAllowlistOn),
      agentSites: p.agentSites === undefined ? cur.agentSites
        : (Array.isArray(p.agentSites) ? p.agentSites.map(s => String(s).slice(0, 200)).slice(0, 200) : []),
      agentMacros: p.agentMacros === undefined ? cur.agentMacros : Boolean(p.agentMacros),
      agentCrossTab: p.agentCrossTab === undefined ? cur.agentCrossTab : Boolean(p.agentCrossTab),
    };
    setAiCap(A, 'agent', nextAgent);
    saveAcc(st.accountId);
    broadcastCaps(st.accountId);
    return A.aiAgent;
  });
  ipcMain.handle('dex:ai-ui-get', (e) => {
    const { A } = Aof(e);
    return aiUiPrefs(A);
  });
  ipcMain.handle('dex:ai-ui-set', (e, patch) => {
    const { st, A } = Aof(e);
    const cur = aiUiPrefs(A);
    const p = (patch && typeof patch === 'object') ? patch : {};
    const nextLayout = String(p.aiLayout || '');
    const rawW = Number(p.width);
    const width = (p.width === undefined || !Number.isFinite(rawW))
      ? cur.width
      : Math.max(AI_SIDEBAR_MIN_W, Math.min(AI_SIDEBAR_MAX_W, Math.round(rawW)));
    A.aiUi = {
      showUsage: p.showUsage === undefined ? cur.showUsage : Boolean(p.showUsage),
      aiLayout: p.aiLayout === undefined ? cur.aiLayout : (nextLayout === 'b' || nextLayout === 'c' ? nextLayout : 'a'),
      width,
      saveChats: p.saveChats === undefined ? cur.saveChats : Boolean(p.saveChats),
      // Plan review for agent runs: off by default, one toggle to switch on.
      agentPlanFirst: p.agentPlanFirst === undefined ? cur.agentPlanFirst : Boolean(p.agentPlanFirst),
    };
    // Live page-view resize while the handle is dragged; the value is clamped
    // above so a stray pointer position cannot break the layout.
    if (width !== cur.width) layout(st.id);
    saveAcc(st.accountId);
    return A.aiUi;
  });
  ipcMain.handle('dex:ai-agent-run', async (e, { reqId, chatId, messages, pageContext, planFirst } = {}) => {
    const { st, A } = Aof(e);
    const sender = e.sender;
    const clientReqId = String(reqId || Date.now());
    if (sender.isDestroyed()) return { ok: false, reqId: clientReqId };
    if (!aiCaps(A).agent) {
      return { ok: false, reqId: clientReqId, error: 'Agent mode is off. Turn on the lightning button first.' };
    }
    if (st.agentRunId) agentRef().stopRun(st.agentRunId, 'a newer run replaced this one');
    const t = st.tabs.get(st.active);
    const wc = t && t.view && t.view.webContents;
    let url = '';
    try { url = (wc && !wc.isDestroyed() && wc.getURL()) || (t && t.url) || ''; }
    catch { url = (t && t.url) || ''; }
    if (!wc || wc.isDestroyed() || !t) return { ok: false, reqId: clientReqId, error: 'No active tab to act on.' };
    if (aiPage.isUnreadable(url)) {
      return { ok: false, reqId: clientReqId, error: 'Acting needs a normal http(s) page or the Dexerion new tab — this one (' + (url || 'unknown') + ') is off limits.' };
    }
    if (siteAiOff(A, url)) {
      return { ok: false, reqId: clientReqId, error: 'Dexerion AI is off for ' + siteHost(url) + '. Turn it back on in Assistant settings.' };
    }
    if (!agentSiteAllowed(A, url)) {
      return { ok: false, reqId: clientReqId, error: 'Acting is limited to your allowed sites, and this page is not on the list. Add it in Dexerion AI → Settings → Acting on pages.' };
    }
    const safeMessages = Array.isArray(messages) ? messages.slice(-80) : [];
    if (!Array.isArray(A.memory)) A.memory = [];
    // A previous stop leaves window.__dexHalt set in this document, and every
    // page action would instantly refuse with a user-stopped error. scAI's
    // guard re-injection resets its flag on every start — do the same here
    // (a navigation wipes page state anyway; this covers the same-document
    // case). Best effort: never blocks the run.
    try { await execTimeout(wc.executeJavaScript('window.__dexHalt = false;0'), 5000, 'halt reset timed out'); } catch {}
    // Page + search context ride on a copy of the last user message for the
    // model only — the stored chat and the memory learner see the original.
    const history = injectContexts(safeMessages, pageContext);
    const lastUser = [...safeMessages].reverse().find(x => x && x.role === 'user' && String(x.text || '').trim());
    const run = agentRef().startRun({ tabId: t.id, winId: st.id, url, settings: agentPrefs(A), memory: A.memory, history });
    run.clientReqId = clientReqId;
    run.chatId = String(chatId || '');
    run.actWinId = st.id;
    // Plan review is the person's choice: the sidebar passes it per run. A
    // deliverable request also makes the run's final text eligible to become an
    // artifact card, exactly like a chat reply.
    run.planFirst = Boolean(planFirst);
    run.wantsArtifact = aiRouter.wantsArtifactText(String((lastUser && lastUser.text) || ''));
    st.agentRunId = run.id;
    // Mission record: the goal is the user's own last message. Live events
    // mirror steps/plan/approvals into it; it survives the session so the
    // sidebar can inspect and delete past runs.
    if (!Array.isArray(A.missions)) A.missions = [];
    const mission = {
      id: run.id,
      chatId: String(chatId || ''),
      goal: String((lastUser && lastUser.text) || 'Task').replace(/\s+/g, ' ').trim().slice(0, 200),
      url: String(url || '').slice(0, 2048),
      host: recipeHost(url),
      status: 'running',
      startedAt: Date.now(),
      endedAt: 0,
      steps: [],
      plan: null,
      approvals: [],
      result: '',
    };
    A.missions.unshift(mission);
    A.missions = A.missions.slice(0, 50);
    saveAcc(st.accountId);
    broadcastMissions(st.accountId);
    liveMissions.set(run.id, { accountId: st.accountId });
    try {
      emitAgentEvent(run, { type: 'start', tabId: t.id, url });
      const out = await agentRef().runLoop(run);
      mission.status = out.halted ? 'cancelled' : 'done';
      mission.result = String(out.text || '').slice(0, 8000);
      mission.endedAt = Date.now();
      if (out.plan) mission.plan = missionPlan(out.plan);
      saveAcc(st.accountId);
      broadcastMissions(st.accountId);
      if (out.ok && !out.halted && out.text) {
        const accountId = st.accountId;
        const rev = memRevs.get(accountId) || 0;
        setImmediate(() => learnFromExchange(accountId, safeMessages, out.text, rev).catch(() => {}));
      }
      // The reply carries everything the renderer reads (artifact card,
      // warnings, continuation). Mapping it inline here dropped those fields,
      // so agent cards and the Continue chip never appeared even though the
      // loop returned them — hence the shared, tested mapper.
      return aiAgent.agentReplyFrom(clientReqId, out);
    } catch (err) {
      mission.status = 'failed';
      mission.result = String(err && err.message || err).slice(0, 4000);
      mission.endedAt = Date.now();
      saveAcc(st.accountId);
      broadcastMissions(st.accountId);
      return { ok: false, reqId: clientReqId, error: String(err && err.message || err) };
    } finally {
      liveMissions.delete(run.id);
      agentRef().endRun(run.id);
      if (st.agentRunId === run.id) st.agentRunId = null;
    }
  });
  ipcMain.handle('dex:ai-agent-stop', (e, runId) => {
    needChrome(e);
    const run = runId ? agentRef().getRun(runId) : null;
    if (run) { agentRef().stopRun(run.id, 'stopped'); return true; }
    return false;
  });
  ipcMain.handle('dex:ai-agent-pause', (e, runId) => {
    const { st } = needChrome(e);
    const ok = agentRef().setPaused(runId, true);
    if (ok) markMissionStatus(st.accountId, runId, 'paused');
    return ok;
  });
  ipcMain.handle('dex:ai-agent-resume', (e, runId) => {
    const { st } = needChrome(e);
    const ok = agentRef().setPaused(runId, false);
    if (ok) markMissionStatus(st.accountId, runId, 'running');
    return ok;
  });
  ipcMain.handle('dex:ai-agent-ping', (e, runId) => {
    needChrome(e);
    return agentRef().ping(runId);
  });
  ipcMain.handle('dex:ai-agent-answer', (e, { runId, askId, ok, text } = {}) => {
    needChrome(e);
    // A free-text answer (the ask_user tool) rides the same channel as a
    // yes/no decision; an empty string counts as "no answer".
    if (typeof text === 'string') return agentRef().answerAsk(runId, askId, text.trim().slice(0, 2000));
    return agentRef().answerAsk(runId, askId, ok);
  });
  // ---------- Assistant missions (inspect + delete past agent runs) ---------
  // The status flip on pause/resume lives here (not in emitAgentEvent), so a
  // paused mission reads as paused even if the panel is closed mid-run.
  function markMissionStatus(accountId, runId, status) {
    const A = accData(accountId);
    const m = (Array.isArray(A.missions) ? A.missions : []).find(x => x && x.id === String(runId || ''));
    if (!m) return false;
    m.status = status;
    saveAcc(accountId);
    broadcastMissions(accountId);
    return true;
  }
  ipcMain.handle('dex:ai-missions-list', (e) => {
    const { st } = needChrome(e);
    return missionsPublic(st.accountId);
  });
  ipcMain.handle('dex:ai-mission-get', (e, id) => {
    const { st } = needChrome(e);
    return missionDetail(st.accountId, id);
  });
  ipcMain.handle('dex:ai-mission-delete', (e, id) => {
    const { st, A } = Aof(e);
    const cid = String(id || '');
    A.missions = A.missions.filter(m => !m || String(m.id) !== cid);
    saveAcc(st.accountId);
    broadcastMissions(st.accountId);
    return missionsPublic(st.accountId);
  });
  ipcMain.handle('dex:ai-missions-clear', (e) => {
    const { st, A } = Aof(e);
    // Clear finished work only; live runs (running/paused) stay.
    A.missions = A.missions.filter(m => m && (m.status === 'running' || m.status === 'paused'));
    saveAcc(st.accountId);
    broadcastMissions(st.accountId);
    return missionsPublic(st.accountId);
  });
  // ---------- Research projects (inspect + delete; creation via the tool) ---
  ipcMain.handle('dex:ai-projects-list', (e) => {
    const { st } = needChrome(e);
    return projectsPublic(st.accountId);
  });
  ipcMain.handle('dex:ai-project-get', (e, id) => {
    const { st } = needChrome(e);
    return projectDetail(st.accountId, id);
  });
  ipcMain.handle('dex:ai-project-delete', (e, id) => {
    const { st, A } = Aof(e);
    const cid = String(id || '');
    A.projects = A.projects.filter(p => !p || String(p.id) !== cid);
    saveAcc(st.accountId);
    broadcastProjects(st.accountId);
    return true;
  });
  // ---------- Agent recipes (scAI macros): saved runs, replayed model-free.
  // Origin-scoped: a click path recorded on one site is meaningless on
  // another. Tier-3 confirmation still applies on replay.
  function recipeHost(url) {
    try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
  }
  ipcMain.handle('dex:ai-recipe-list', (e) => {
    const { A } = Aof(e);
    return A.recipes;
  });
  ipcMain.handle('dex:ai-recipe-save', (e, recipe) => {
    const { st, A } = Aof(e);
    const r = (recipe && typeof recipe === 'object') ? recipe : {};
    const srcSteps = Array.isArray(r.steps) ? r.steps : [];
    const rec = {
      id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: String(r.name || 'Untitled recipe').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled recipe',
      origin: String(r.origin || '').slice(0, 200),
      startUrl: String(r.startUrl || '').slice(0, 2048),
      // Re-attach args through a JSON round trip (drops anything odd).
      steps: srcSteps.filter(s => s && typeof s.name === 'string').slice(0, 100).map(s => ({
        name: String(s.name).slice(0, 40),
        args: safeRecipeArgs(s.args),
      })),
      savedAt: Date.now(),
    };
    A.recipes.unshift(rec);
    A.recipes = A.recipes.slice(0, 60);
    saveAcc(st.accountId);
    return rec;
  });
  function safeRecipeArgs(args) {
    if (!args || typeof args !== 'object') return {};
    try {
      const clean = JSON.parse(JSON.stringify(args));
      return (clean && typeof clean === 'object' && !Array.isArray(clean)) ? clean : {};
    } catch { return {}; }
  }
  ipcMain.handle('dex:ai-recipe-delete', (e, id) => {
    const { st, A } = Aof(e);
    A.recipes = A.recipes.filter(r => r && r.id !== String(id || ''));
    saveAcc(st.accountId);
    return A.recipes;
  });
  ipcMain.handle('dex:ai-agent-replay', async (e, { reqId, messages, recipeId } = {}) => {
    const { st, A } = Aof(e);
    const sender = e.sender;
    const clientReqId = String(reqId || Date.now());
    if (sender.isDestroyed()) return { ok: false, reqId: clientReqId };
    const recipe = A.recipes.find(r => r && r.id === String(recipeId || ''));
    if (!recipe) return { ok: false, reqId: clientReqId, error: 'Recipe not found.' };
    if (st.agentRunId) agentRef().stopRun(st.agentRunId, 'a newer run replaced this one');
    const t = st.tabs.get(st.active);
    const wc = t && t.view && t.view.webContents;
    let url = '';
    try { url = (wc && !wc.isDestroyed() && wc.getURL()) || (t && t.url) || ''; }
    catch { url = (t && t.url) || ''; }
    if (!wc || wc.isDestroyed() || !t) return { ok: false, reqId: clientReqId, error: 'No active tab to act on.' };
    if (aiPage.isUnreadable(url)) {
      return { ok: false, reqId: clientReqId, error: 'Replaying needs a normal http(s) page or the Dexerion new tab — this one (' + (url || 'unknown') + ') is off limits.' };
    }
    if (!agentSiteAllowed(A, url)) {
      return { ok: false, reqId: clientReqId, error: 'Acting is limited to your allowed sites, and this page is not on the list.' };
    }
    if (recipe.origin && recipeHost(url) !== recipe.origin) {
      return { ok: false, reqId: clientReqId, error: 'This recipe was recorded on ' + recipe.origin + ' — open that site first.' };
    }
    const run = agentRef().startRun({ tabId: t.id, winId: st.id, url, settings: agentPrefs(A), memory: [], history: [] });
    run.actWinId = st.id;
    run.clientReqId = clientReqId;
    st.agentRunId = run.id;
    void messages;
    try {
      emitAgentEvent(run, { type: 'start', tabId: t.id, url });
      const out = await agentRef().replayRun(run, recipe.steps);
      return { ok: true, reqId: clientReqId, text: 'Replayed "' + recipe.name + '" — ' + out.text, steps: out.steps, halted: out.halted };
    } catch (err) {
      return { ok: false, reqId: clientReqId, error: String(err && err.message || err) };
    } finally {
      agentRef().endRun(run.id);
      if (st.agentRunId === run.id) st.agentRunId = null;
    }
  });
  // Every explicit memory write bumps the per-account revision so a
  // background learn racing it can stand down instead of clobbering.
  const memRevs = new Map();
  function memBump(accountId) {
    memRevs.set(accountId, (memRevs.get(accountId) || 0) + 1);
  }
  // ---------- Dexerion Assistant memory (per account, persisted) ----------
  function broadcastMemory(accountId, memory) {
    for (const st of windows.values()) {
      if (st.accountId === accountId && !st.win.isDestroyed()) {
        try { st.win.webContents.send('dex:ai-memory-updated', memory); } catch {}
      }
    }
  }
  // Distill + apply what the assistant learned on its own. Best effort:
  // failures never surface — the user just sees no new memories.
  async function learnFromExchange(accountId, safeMessages, replyText, rev) {
    const A = accData(accountId);
    if (!Array.isArray(A.memory)) A.memory = [];
    const { add, forget } = await ai.extractMemory(safeMessages, replyText, A.memory);
    if ((memRevs.get(accountId) || 0) !== rev) return; // an explicit write won the race: stand down
    let changed = false;
    for (const q of forget) {
      const before = A.memory.length;
      A.memory = ai.removeMemory(A.memory, q).list;
      if (A.memory.length !== before) changed = true;
    }
    for (const fact of add) {
      const res = ai.addMemory(A.memory, fact);
      A.memory = res.list;
      if (res.added) changed = true;
    }
    if (changed) {
      saveAcc(accountId);
      broadcastMemory(accountId, A.memory);
    }
  }
  ipcMain.handle('dex:ai-memory-list', (e) => {
    const { A } = Aof(e);
    if (!Array.isArray(A.memory)) A.memory = [];
    return A.memory;
  });
  ipcMain.handle('dex:ai-memory-add', (e, text) => {
    const { st, A } = Aof(e);
    if (!Array.isArray(A.memory)) A.memory = [];
    const { list, added, reason } = ai.addMemory(A.memory, String(text || ''));
    A.memory = list;
    saveAcc(st.accountId);
    memBump(st.accountId);
    broadcastMemory(st.accountId, A.memory);
    return { added, reason, memory: A.memory };
  });
  ipcMain.handle('dex:ai-memory-delete', (e, id) => {
    const { st, A } = Aof(e);
    if (!Array.isArray(A.memory)) A.memory = [];
    const cid = String(id || '');
    A.memory = A.memory.filter(f => f && f.id !== cid);
    saveAcc(st.accountId);
    memBump(st.accountId);
    broadcastMemory(st.accountId, A.memory);
    return A.memory;
  });
  ipcMain.handle('dex:ai-memory-clear', (e) => {
    const { st, A } = Aof(e);
    A.memory = [];
    saveAcc(st.accountId);
    memBump(st.accountId);
    broadcastMemory(st.accountId, A.memory);
    return true;
  });

  // Process a file for AI analysis (PDF, text, code files, images)
  ipcMain.handle('dex:ai-process-file', async (e, { fileData, fileName, fileType } = {}) => {
    const { st, A } = Aof(e);
    try {
      let result;
      if (fileType === 'application/pdf') {
        // Use pdf.js in main process for server-side extraction
        const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
        const pdf = await pdfjsLib.getDocument({ data: Buffer.from(fileData, 'base64') }).promise;
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          fullText += textContent.items.map(item => item.str).join(' ') + '\n\n';
        }
        result = { type: 'pdf', text: fullText, pages: pdf.numPages };
      } else if (fileType.startsWith('text/') || isCodeFile(fileName)) {
        const text = Buffer.from(fileData, 'base64').toString('utf8');
        result = { type: 'text', text };
      } else if (fileType.startsWith('image/')) {
        // For images, return the base64 data for the model
        result = { type: 'image', data: fileData };
      } else {
        result = { type: 'unknown', error: 'Unsupported file type' };
      }
      return { ok: true, ...result, name: fileName };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ---------- Tasks (per account, persisted) ----------
  // Additive feature with its own IPC + reminder scheduler. The pomodoro
  // engine, rail-collapse logic and timer rendering are untouched.
  function ensureTasks(A) {
    if (!A) return [];
    if (!Array.isArray(A.tasks)) A.tasks = [];
    A.tasks = tasks.sanitizeList(A.tasks);
    return A.tasks;
  }
  function tasksPublic(accountId) {
    try { return tasks.sortTasks(ensureTasks(accData(accountId))); }
    catch { return []; }
  }
  function broadcastTasks(accountId) {
    const list = tasksPublic(accountId);
    for (const st of windows.values()) {
      if (st.accountId !== accountId || st.win.isDestroyed()) continue;
      try { st.win.webContents.send('dex:tasks-updated', list); } catch {}
    }
  }
  ipcMain.handle('dex:tasks-list', (e) => {
    const { st } = needChrome(e);
    return tasksPublic(st.accountId);
  });
  ipcMain.handle('dex:tasks-add', (e, input) => {
    const { st, A } = Aof(e);
    const list = ensureTasks(A);
    list.push(tasks.makeTask(input || {}));
    saveAcc(st.accountId);
    broadcastTasks(st.accountId);
    armTaskHeartbeat(); // task changed: the near-due answer may have changed
    return tasks.sortTasks(list);
  });
  ipcMain.handle('dex:tasks-toggle', (e, id, done) => {
    const { st, A } = Aof(e);
    const list = ensureTasks(A);
    const t = list.find((x) => x && x.id === String(id || ''));
    if (!t) throw new Error('Task not found.');
    t.done = done === undefined ? !t.done : Boolean(done);
    t.doneAt = t.done ? Date.now() : 0;
    saveAcc(st.accountId);
    broadcastTasks(st.accountId);
    armTaskHeartbeat(); // task changed: the near-due answer may have changed
    return tasks.sortTasks(list);
  });
  ipcMain.handle('dex:tasks-delete', (e, id) => {
    const { st, A } = Aof(e);
    const list = ensureTasks(A);
    const n = list.length;
    A.tasks = list.filter((x) => x && x.id !== String(id || ''));
    if (A.tasks.length === n) throw new Error('Task not found.');
    saveAcc(st.accountId);
    broadcastTasks(st.accountId);
    armTaskHeartbeat(); // task changed: the near-due answer may have changed
    return tasks.sortTasks(A.tasks);
  });
  ipcMain.handle('dex:tasks-clear-done', (e) => {
    const { st, A } = Aof(e);
    A.tasks = ensureTasks(A).filter((x) => !x.done);
    saveAcc(st.accountId);
    broadcastTasks(st.accountId);
    armTaskHeartbeat(); // task changed: the near-due answer may have changed
    return tasks.sortTasks(A.tasks);
  });
  // Reminder sweep: 30 minutes before due + at due, once each per task.
  // Flags persist on the task, so a restart can never double-fire.
  function notifyTask(t, atDue) {
    try {
      new Notification({
        title: atDue ? 'Dexerion Tasks — due now' : 'Dexerion Tasks — due in 30 minutes',
        body: String((t && t.title) || 'Task').slice(0, 200),
      }).show();
    } catch {}
  }
  function checkTaskReminders() {
    const now = Date.now();
    for (const m of listAccounts()) {
      let A;
      try { A = accData(m && m.id); } catch { continue; }
      const list = ensureTasks(A);
      let changed = false;
      for (const t of list) {
        if (!t || t.done) continue;
        const kind = tasks.reminderKind(t, now);
        if (kind === 'pre' && !t.remindedPre) {
          t.remindedPre = true; changed = true; notifyTask(t, false);
        } else if (kind === 'due' && !t.remindedDue) {
          t.remindedDue = true; changed = true; notifyTask(t, true);
        }
      }
      if (changed && m && m.id) saveAcc(m.id);
    }
  }
  // B2 — adaptive task-reminder heartbeat. The sweep used to wake the main
  // process every 30s all session. tasks.reminderHeartbeatMs picks 30s only
  // while some open task's next reminder (due mark or the 30-minute
  // pre-notice) is owed or lands within the near window, else 5 minutes, so
  // punctuality is kept for near-due tasks while an idle session wakes 10x
  // less. The cadence is re-armed whenever a task changes, after every sweep
  // (fired flags change the answer), and after a system resume (the clock may
  // have jumped). Kill switches: DEX_TASK_HEARTBEAT=legacy restores the fixed
  // 30s setInterval exactly; the legacy budget profile (DEX_DEBLOAT_BASELINE=1)
  // pins the same cadence through the taskHeartbeat* budgets.
  let taskHeartbeatTimer = null;
  let taskHeartbeatLegacy = process.env.DEX_TASK_HEARTBEAT === 'legacy';
  function armTaskHeartbeat() {
    if (taskHeartbeatLegacy) return;
    if (taskHeartbeatTimer) clearTimeout(taskHeartbeatTimer);
    const tick = () => {
      taskHeartbeatTimer = null;
      try { checkTaskReminders(); } catch {}
      armTaskHeartbeat();
    };
    let delay = 30000;
    try {
      const lists = [];
      for (const m of listAccounts()) {
        try { lists.push(ensureTasks(accData(m && m.id))); } catch {}
      }
      delay = tasks.reminderHeartbeatMs(lists, Date.now(), BUDGETS);
    } catch {}
    if (process.env.DEX_TIMER_DEBUG) {
      console.log('[dex-timer] task-reminder heartbeat ' + delay + 'ms');
    }
    taskHeartbeatTimer = setTimeout(tick, delay);
    if (taskHeartbeatTimer.unref) taskHeartbeatTimer.unref();
  }
  if (taskHeartbeatLegacy) {
    setInterval(checkTaskReminders, 30000);
    setTimeout(() => { try { checkTaskReminders(); } catch {} }, 5000);
  } else {
    // Same first-sweep timing as the legacy interval (5s in); the adaptive
    // cadence starts from there, so boot does no extra synchronous work.
    setTimeout(() => {
      try { checkTaskReminders(); } catch {}
      try { armTaskHeartbeat(); } catch {}
    }, 5000);
  }

  // ---------- snip tool (screenshot: area / full page + window video) ----------
  // The overlay is an in-window WebContentsView parked exactly over the active
  // tab's content view — never a separate OS window. That keeps it inside the
  // browser: save dialogs parented to the window paint above it, resizes are
  // handled by layout(), and it can never strand itself behind a modal.
  // It shows a frozen capturePage() shot of the tab full-bleed (transparency
  // is unusable on this compositor), the cursor is a crosshair, and the user
  // drags to select. Area snips crop the frozen frame (WYSIWYG).
  function snipCtx(e) {
    const wc = e.sender;
    for (const [wid, rec] of snipState) {
      if (rec.view && !rec.view.webContents.isDestroyed() && rec.view.webContents === wc) {
        const st = windows.get(wid);
        if (st) return { st, rec };
      }
    }
    return {};
  }
  function destroySnipView(st, rec) {
    if (!rec || !rec.view) return;
    try { st.win.contentView.removeChildView(rec.view); } catch {}
    try {
      if (!rec.view.webContents.isDestroyed()) rec.view.webContents.close();
    } catch {}
  }
  function closeSnip(st) {
    const rec = snipState.get(st.id);
    if (!rec) return;
    snipState.delete(st.id);
    destroySnipView(st, rec);
    try { st.win.webContents.send('dex:snip-active', { open: false, recording: false }); } catch {}
  }
  // Content-view coordinates (relative to the window's contentView) for the
  // overlay. Normally the active tab's bounds; while recording a compact
  // top-centered strip so the page stays visible and Stop stays one click away.
  function snipViewBounds(st, rec) {
    let page = null;
    try {
      const t = st.tabs.get(st.active);
      if (t && t.view) {
        const b = t.view.getBounds();
        if (b && b.width > 0 && b.height > 0) {
          page = { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
        }
      }
    } catch {}
    if (!page) {
      const top = chromeH(st), rail = railW(st);
      let w = 800, h = 600;
      try {
        const c = st.win.getContentBounds();
        w = Math.max(200, c.width - rail);
        h = Math.max(200, c.height - top);
      } catch {}
      page = { x: rail, y: top, width: Math.round(w), height: Math.round(h) };
    }
    if (rec && rec.recording) {
      const w = Math.max(280, Math.min(460, page.width - 16));
      return {
        x: Math.round(page.x + Math.max(0, (page.width - w) / 2)),
        y: Math.round(page.y + 8),
        width: Math.round(w), height: 52,
      };
    }
    return {
      x: page.x, y: page.y,
      width: Math.max(200, page.width), height: Math.max(200, page.height),
    };
  }
  function snipStamp() {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }
  function snipTrackDownload(filePath, fileName, url) {
    const rec = {
      id: String(Date.now()), fileName, path: filePath, url: url || '',
      state: 'completed', received: 0, total: 0, at: Date.now(),
    };
    try {
      const st2 = fs.statSync(filePath);
      rec.received = st2.size; rec.total = st2.size;
    } catch {}
    S.downloads.unshift(rec);
    profile.saveSoon();
    notifyDownloads();
  }
  // Freeze-frame overlay as an in-window child view: this machine's compositor
  // does not composite transparent windows (see openSuggestWin: raw surface
  // shows as a pale frame), so a see-through overlay can never show the live
  // page here. Instead the tab is captured up front and the overlay displays
  // that shot full-bleed: area snips crop the frozen frame (WYSIWYG), no
  // transparency needed anywhere in the chain.
  async function openSnipOverlay(st, opts) {
    const cur = snipState.get(st.id);
    if (cur && cur.view && !cur.view.webContents.isDestroyed()) {
      // Re-show on a repeat press: a hidden/stale overlay must never make the
      // toolbar button look dead. During a recording this brings back the
      // compact Stop strip.
      try {
        st.win.contentView.addChildView(cur.view);
        cur.view.setBounds(snipViewBounds(st, cur));
      } catch {}
      return;
    }
    if (cur) { try { snipState.delete(st.id); } catch {} }
    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '../../preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
      },
    });
    try { view.setBackgroundColor((S.settings.theme || 'dark') === 'light' ? '#f6f6f4' : '#171614'); } catch {}
    // Exact capture id for THIS window: the overlay pins recording to it by
    // id instead of guessing from window titles (guessing could land on a
    // window underneath and record the wrong thing).
    let mediaSourceId = '';
    try { mediaSourceId = st.win.getMediaSourceId() || ''; } catch {}
    const rec = { view, attach: Boolean(opts && opts.attach), recording: false, mediaSourceId };
    snipState.set(st.id, rec);
    try { st.win.webContents.send('dex:snip-active', { open: true, recording: false }); } catch {}
    let shown = false;
    let guard = null;
    console.log('[snip] open bounds=' + JSON.stringify(snipViewBounds(st, rec)));
    // If the overlay never finishes loading, tear it down rather than leaving a
    // phantom view the button can no longer reach.
    const drop = () => {
      clearTimeout(guard);
      if (snipState.get(st.id) === rec) closeSnip(st);
    };
    guard = setTimeout(() => { if (!shown) drop(); }, 12000);
    view.webContents.on('console-message', (e, level, message, line, sourceId) => {
      console.log('[snip-console] ' + message + ' (' + sourceId + ':' + line + ')');
    });
    view.webContents.on('did-fail-load', (e, code, desc, url) => {
      console.log('[snip-fail] ' + code + ' ' + desc + ' ' + url);
      drop();
    });
    view.webContents.once('did-finish-load', async () => {
      if (snipState.get(st.id) !== rec) return;
      shown = true;
      clearTimeout(guard);
      console.log('[snip] loaded ' + view.webContents.getURL());
      // Freeze the tab right before showing, so the frame matches the page
      // the user was just looking at. Failures fall back to a live capture
      // at snip time (shot:null tells the overlay which path to use).
      let shot = null;
      try {
        const t = st.tabs.get(st.active);
        const wc = t && t.view && t.view.webContents;
        if (wc && !wc.isDestroyed()) {
          const img = await wc.capturePage();
          const size = img.getSize();
          if (!img.isEmpty() && size.width > 1 && size.height > 1) {
            shot = { dataUrl: img.toDataURL() };
          }
        }
      } catch {}
      if (!shot) console.log('[snip] no frozen frame; overlay falls back to live capture');
      try {
        view.webContents.send('dex:snip-init', {
          theme: S.settings.theme || 'light', accent: S.settings.accent || '#35c4ff',
          attach: Boolean(opts && opts.attach),
          shot,
          mediaSourceId: rec.mediaSourceId || '',
        });
        // In-window: add on top of the tab views. layout() keeps it aligned
        // from here on (resize, inspector, AI sidebar).
        st.win.contentView.addChildView(view);
        view.setBounds(snipViewBounds(st, rec));
        console.log('[snip] shown in-window');
      } catch {}
    });
    view.webContents.loadFile(path.join(__dirname, '../renderer/snip.html'));
  }
  ipcMain.handle('dex:snip-open', async (e, opts) => {
    const { st } = needChrome(e);
    await openSnipOverlay(st, opts || {});
    return true;
  });
  // Snip-to-chat: the overlay forwards the captured PNG, main hands it to
  // the shell as a chat attachment and closes the overlay.
  ipcMain.handle('dex:snip-attach', (e, { dataUrl } = {}) => {
    const { rec, st } = snipCtx(e);
    if (!st || !rec || !dataUrl) throw new Error('denied');
    try {
      st.win.webContents.send('dex:ai-attach-image', {
        dataUrl: String(dataUrl),
        name: 'Snip ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      });
    } catch {}
    try { closeSnip(st); } catch {}
    return true;
  });
  ipcMain.handle('dex:snip-dismiss', (e) => {
    const { rec, st } = snipCtx(e);
    // Never strand a recording: stopping first keeps the captured chunks.
    if (rec && rec.recording) return true;
    if (st) closeSnip(st);
    return true;
  });
  ipcMain.handle('dex:snip-hide', (e) => {
    // Compat: older overlays hid the whole panel while recording. The panel
    // now shrinks to a Stop strip instead, so hiding only detaches the view.
    const { rec, st } = snipCtx(e);
    if (rec && st && rec.view && !rec.view.webContents.isDestroyed()) {
      try { st.win.contentView.removeChildView(rec.view); } catch {}
    }
    return true;
  });
  ipcMain.handle('dex:snip-show', (e) => {
    // Compat: re-attach a detached overlay and pin it above the tab views.
    const { rec, st } = snipCtx(e);
    if (rec && st && rec.view && !rec.view.webContents.isDestroyed()) {
      try {
        st.win.contentView.addChildView(rec.view);
        rec.view.setBounds(snipViewBounds(st, rec));
      } catch {}
    }
    return true;
  });
  ipcMain.handle('dex:snip-recstate', (e, { recording } = {}) => {
    const { rec, st } = snipCtx(e);
    if (rec && st) {
      rec.recording = Boolean(recording);
      // Recording shrinks the overlay to a Stop strip (layout keeps it
      // aligned); stopping restores the full overlay for the preview.
      try {
        st.win.contentView.addChildView(rec.view);
        rec.view.setBounds(snipViewBounds(st, rec));
      } catch {}
      try { st.win.webContents.send('dex:snip-active', { open: true, recording: rec.recording }); } catch {}
    }
    return true;
  });
  // Area snip: capture the tab view, crop to the overlay-relative rect
  // (scaled from CSS px to device px), return a PNG data URL.
  ipcMain.handle('dex:snip-area', async (e, { x, y, w, h } = {}) => {
    const { st } = snipCtx(e);
    if (!st) throw new Error('no window');
    const t = st.tabs.get(st.active);
    if (!t || !t.view) throw new Error('no tab');
    const img = await t.view.webContents.capturePage();
    const size = img.getSize();
    const vb = t.view.getBounds();
    const sx = size.width / Math.max(1, vb.width), sy = size.height / Math.max(1, vb.height);
    const rx = Math.max(0, Math.round(Number(x) * sx)), ry = Math.max(0, Math.round(Number(y) * sy));
    const rw = Math.min(size.width - rx, Math.round(Number(w) * sx));
    const rh = Math.min(size.height - ry, Math.round(Number(h) * sy));
    if (rw < 2 || rh < 2) throw new Error('selection too small');
    return { dataUrl: img.crop({ x: rx, y: ry, width: rw, height: rh }).toDataURL() };
  });
  // Full page: scroll through the document capturing viewports, return the
  // parts + scale so the overlay stitches them on a canvas. Short pages
  // return a single data URL directly.
  ipcMain.handle('dex:snip-full', async (e) => {
    const { st } = snipCtx(e);
    if (!st) throw new Error('no window');
    const t = st.tabs.get(st.active);
    if (!t || !t.view) throw new Error('no tab');
    const wc = t.view.webContents;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const m = await wc.executeJavaScript(
      "({ y: window.scrollY || 0, vh: window.innerHeight || 0, " +
      "sh: Math.max(document.documentElement ? document.documentElement.scrollHeight : 0, " +
      "document.body ? document.body.scrollHeight : 0) })").catch(() => null);
    if (!m || !m.vh) {
      const img = await wc.capturePage();
      return { dataUrl: img.toDataURL() };
    }
    const totalH = Math.min(m.sh || m.vh, 12000); // cap: protects giant feeds
    if (totalH <= m.vh + 1) {
      const img = await wc.capturePage();
      return { dataUrl: img.toDataURL() };
    }
    const parts = [];
    let scale = 1;
    try {
      for (let y = 0; y < totalH; y += m.vh) {
        const target = Math.round(Math.min(y, totalH - m.vh));
        await wc.executeJavaScript(`window.scrollTo(0, ${target})`).catch(() => {});
        await sleep(220);
        const sy = await wc.executeJavaScript('window.scrollY || 0').catch(() => target);
        const img = await wc.capturePage();
        if (!parts.length) {
          const s = img.getSize();
          scale = s.height / Math.max(1, m.vh);
        }
        parts.push({ dataUrl: img.toDataURL(), y: sy });
        if (sy + m.vh >= totalH - 1) break;
      }
    } finally {
      await wc.executeJavaScript(`window.scrollTo(0, ${Math.round(m.y || 0)})`).catch(() => {});
    }
    if (!parts.length) throw new Error('nothing captured');
    return { parts, scale, totalH };
  });
  ipcMain.handle('dex:snip-copy', async (e, { dataUrl } = {}) => {
    if (!snipCtx(e).st) throw new Error('denied');
    if (!dataUrl) throw new Error('empty image');
    const image = nativeImage.createFromDataURL(String(dataUrl));
    if (image.isEmpty()) throw new Error('invalid image');
    // Electron 44 main-process clipboard: ClipboardItem array (writeImage
    // does not exist here). Verified by clipboard round-trip probe.
    const blob = new Blob([image.toPNG()], { type: 'image/png' });
    await clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  });
  ipcMain.handle('dex:snip-save', async (e, { dataUrl, kind } = {}) => {
    const { st } = snipCtx(e);
    if (!st) throw new Error('denied');
    if (!dataUrl) throw new Error('empty image');
    const t = st.tabs.get(st.active);
    const dir = (S.settings.downloadDir && String(S.settings.downloadDir)) || os.homedir();
    const defName = kind === 'full'
      ? `Dexerion-FullPage-${snipStamp()}.png`
      : `Dexerion-Snip-${snipStamp()}.png`;
    const r = await dialog.showSaveDialog(st.win, {
      title: 'Save screenshot',
      defaultPath: path.join(dir, defName),
      filters: [{ name: 'PNG image', extensions: ['png'] }],
    });
    if (r.canceled || !r.filePath) return { canceled: true };
    fs.writeFileSync(r.filePath, nativeImage.createFromDataURL(String(dataUrl)).toPNG());
    snipTrackDownload(r.filePath, path.basename(r.filePath), t ? t.url : '');
    return { path: r.filePath, name: path.basename(r.filePath) };
  });
  // Video: list desktop/window sources so the overlay can record one with
  // getUserMedia + MediaRecorder. Never exposed to web pages (overlay only).
  // This window is flagged by its exact media id (isSelf) so the overlay can
  // pin recording to it — never a look-alike window underneath.
  ipcMain.handle('dex:snip-sources', async (e) => {
    const { rec, st } = snipCtx(e);
    if (!st) throw new Error('denied');
    const srcs = await desktopCapturer.getSources({
      types: ['window', 'screen'], thumbnailSize: { width: 320, height: 200 },
    });
    let selfId = (rec && rec.mediaSourceId) || '';
    try { selfId = st.win.getMediaSourceId() || selfId; } catch {}
    let selfTitle = '';
    try { selfTitle = st.win.getTitle() || ''; } catch {}
    const rank = (s) => {
      if (selfId && s.id === selfId) return 0;
      const name = String(s.name || '');
      if (selfTitle && name && (name === selfTitle || name.indexOf(BRAND.name) === 0)) return 1;
      if (/dexerion/i.test(name)) return 2;
      if (/screen|display|entire/i.test(name)) return 3;
      return 4;
    };
    return srcs
      .map((s) => ({ id: s.id, name: s.name || s.id, isSelf: Boolean(selfId && s.id === selfId) }))
      .sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name)))
      .slice(0, 12);
  });
  // IPC can deliver the recording as a Buffer, an ArrayBuffer, a typed-array
  // view, or Electron's Buffer-JSON shape — accept all four so a finished
  // recording can never fail at the save step.
  function snipVideoBuffer(buf) {
    if (!buf) return null;
    try {
      if (Buffer.isBuffer(buf)) return buf;
      if (buf instanceof ArrayBuffer) return Buffer.from(buf);
      if (ArrayBuffer.isView(buf)) return Buffer.from(buf.buffer, buf.byteOffset || 0, buf.byteLength);
      if (buf && buf.type === 'Buffer' && Array.isArray(buf.data)) return Buffer.from(buf.data);
    } catch {}
    return null;
  }
  ipcMain.handle('dex:snip-save-video', async (e, { buf, mime } = {}) => {
    const { st } = snipCtx(e);
    if (!st) throw new Error('denied');
    const data = snipVideoBuffer(buf);
    if (!data || !data.byteLength) throw new Error('empty recording');
    if (data.byteLength > 500 * 1024 * 1024) throw new Error('recording too large (500 MB cap)');
    const dir = (S.settings.downloadDir && String(S.settings.downloadDir)) || os.homedir();
    const r = await dialog.showSaveDialog(st.win, {
      title: 'Save recording',
      defaultPath: path.join(dir, `Dexerion-Recording-${snipStamp()}.webm`),
      filters: [{ name: 'WebM video', extensions: ['webm'] }],
    });
    if (r.canceled || !r.filePath) return { canceled: true };
    fs.writeFileSync(r.filePath, data);
    void mime;
    snipTrackDownload(r.filePath, path.basename(r.filePath), '');
    return { path: r.filePath, name: path.basename(r.filePath) };
  });

  // Quick-action menu for extensions whose popup can't be shown (no
  // default_popup, or a popup that failed to load — the normal case in
  // developer mode): Reload / Enable-Disable / Manage / Remove, plus any
  // error. The current tab is never hijacked.
  function openExtensionActions(st, rec, failReason) {
    const id = extensions.displayId(rec);
    const items = [];
    const actions = [];
    const add = (label, fn, o = {}) => { items.push({ label, icon: o.icon, disabled: o.disabled, danger: o.danger, actionIdx: actions.length }); actions.push(fn); };
    const sep = () => items.push({ separator: true });
    add(`${rec.name || 'Extension'} ${rec.version || ''}`.trim(), () => {}, { icon: '🧩', disabled: true });
    if (failReason) add('⚠ ' + String(failReason).slice(0, 90), () => {}, { disabled: true });
    if (rec.loadError) add('⚠ ' + String(rec.loadError).slice(0, 90), () => {}, { disabled: true });
    sep();
    add('Reload', async () => {
      try { await extensions.reload(id); }
      catch (e) { dialog.showErrorBox((rec.name || 'Extension') + ' — reload failed', String(e && e.message || e)); }
      broadcastState();
    }, { icon: '↻' });
    add(rec.enabled === false ? 'Enable' : 'Disable', async () => {
      try { await extensions.setEnabled(id, rec.enabled === false); }
      catch (e) { dialog.showErrorBox((rec.name || 'Extension') + ' — failed', String(e && e.message || e)); }
      broadcastState();
    }, { icon: '⏻' });
    sep();
    add('Manage…', () => {
      const t = st && st.tabs.get(st.active);
      if (t) t.view.webContents.loadURL('dexerion://extensions').catch(() => {});
    }, { icon: '⚙' });
    add('Remove…', async () => {
      try {
        const { response } = await dialog.showMessageBox({
          type: 'question', buttons: ['Remove', 'Cancel'], defaultId: 1,
          message: `Remove "${rec.name || 'extension'}" from Dexerion?`,
        });
        if (response === 0) { await extensions.remove(id); broadcastState(); }
      } catch {}
    }, { icon: '🗑', danger: true });
    const pt = screen.getCursorScreenPoint();
    popupMenu(items, { x: pt.x + 2, y: pt.y + 2 }, { width: 320 }).then((idx) => {
      if (idx == null || idx < 0) return;
      const item = items[idx];
      if (item && !item.separator && !item.disabled && actions[item.actionIdx]) {
        try { const r = actions[item.actionIdx](); if (r && r.catch) r.catch(() => {}); } catch {}
      }
    });
  }

  function openExtensionPopup(st, extensionId) {
    const rec = extensions.findRec(extensionId);
    if (!rec) {
      // Never a silent no-op: an unknown/empty id means the record lost its
      // Chromium id, so say so and point at the fix instead of doing nothing.
      dialog.showErrorBox('Dexerion — extension not loaded',
        'This extension has no active browser id, so its popup cannot open.\n\n' +
        'Open dexerion://extensions and use Reload (or Remove and load it again).');
      return null;
    }
    if (!rec.path || !fs.existsSync(rec.path)) {
      // Broken record (files deleted/moved): never silently route to
      // settings — say exactly what happened, like Chrome's error state.
      dialog.showErrorBox(
        rec.name + ' — cannot open',
        'The extension files are missing from:\n' + (rec.path || '(none)') +
        '\n\nRemove it from dexerion://extensions and reinstall (Load unpacked or from the Chrome Web Store).');
      return null;
    }
    let popupRel = null;
    let manifest = null;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(rec.path, 'manifest.json'), 'utf8'));
      // MV3 action, MV2 browser_action / page_action — like Chrome.
      popupRel = (manifest.action && manifest.action.default_popup)
        || (manifest.browser_action && manifest.browser_action.default_popup)
        || (manifest.page_action && manifest.page_action.default_popup)
        || null;
    } catch (e) {
      dialog.showErrorBox(rec.name + ' — cannot open',
        'manifest.json could not be read:\n' + String(e && e.message || e));
      return null;
    }
    if (!popupRel) {
      // No default_popup (background/content-script-only extension — the
      // normal case in developer mode): offer quick actions in place.
      // Never hijack the current tab to the extensions page; "Manage…"
      // navigates there only when explicitly chosen.
      openExtensionActions(st, rec);
      return null;
    }
    // Nothing loaded in any session = the icon can never work. Offer the
    // fix (Reload) in place rather than opening a popup that can't resolve.
    if (!Object.keys(rec.ids || {}).length) {
      openExtensionActions(st, rec, rec.loadError || 'Not loaded in the browser — use Reload to load it.');
      return null;
    }
    // A dev extension can declare a popup file that was never shipped —
    // catch that here so the user gets a readable reason, not ERR_FILE_NOT_FOUND.
    {
      const rel = String(popupRel).replace(/^\/+/, '').split('?')[0].split('#')[0];
      const abs = path.join(rec.path, rel.replace(/\//g, path.sep));
      const ok = fs.existsSync(abs) && fs.statSync(abs).isFile();
      if (!ok) {
        openExtensionActions(st, rec, 'Popup file not found: ' + rel);
        return null;
      }
    }
    const target = 'chrome-extension://' + (rec.ids[sessKey(st)] || extensions.displayId(rec)) + '/' + popupRel;
    // Anchored dropdown under the toolbar, like Chrome — not a centered window.
    const parent = BrowserWindow.getFocusedWindow();
    const opts = { width: 380, height: 560, resizable: false };
    if (parent) {
      try {
        const pst = [...windows.values()].find(s => s.win === parent);
        const c = parent.getContentBounds();
        opts.x = Math.round(c.x + c.width - opts.width - 12);
        opts.y = Math.round(c.y + chromeH(pst) + 4);
      } catch {}
    }
    // The popup must live in the same session/partition as the window it
    // was opened from — otherwise chrome-extension://<id> resolves against
    // the wrong session and the popup loads blank (multi-account setups).
    // st is null when called outside a window (self-test); default then.
    const accountId = (st && st.accountId) || 'default';
    const pop = new BrowserWindow({
      ...opts, title: rec.name, autoHideMenuBar: true, icon: APP_ICON, parent,
      resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
      webPreferences: {
        partition: accountId === 'default' ? undefined : 'persist:dexacc-' + accountId,
      },
    });
    popupWindows.add(pop);
    pop.on('closed', () => popupWindows.delete(pop));
    // Extension storage bridge (chrome.storage.sync fallback): attach before
    // loadURL so the popup's world is bridged ahead of its scripts.
    try { attachSyncBridge(pop.webContents); } catch {}
    // Like Chrome/Edge, the popup dismisses when it loses focus (clicking
    // anywhere outside closes it) — it is a dropdown, not a persist window.
    pop.on('blur', () => { try { if (!pop.isDestroyed()) pop.close(); } catch {} });
    // Chrome/Edge sizes the popup to the popup page's own content (max
    // 800x600), so each extension renders at its own size instead of one
    // fixed generic window. Measured after load plus once more after late
    // layout (fonts/async content); the top-right anchor is preserved.
    const fitPopupToContent = (delay) => {
      setTimeout(() => {
        if (pop.isDestroyed()) return;
        pop.webContents.executeJavaScript(
          '(() => { const d = document.documentElement, b = document.body;' +
          ' const sw = Math.max(d ? d.scrollWidth : 0, b ? b.scrollWidth : 0);' +
          ' const sh = Math.max(d ? d.scrollHeight : 0, b ? b.scrollHeight : 0);' +
          ' let cw = 0, ch = 0;' +
          ' try { const br = b ? b.getBoundingClientRect() : null;' +
          ' if (b && br) { for (const el of b.children) { if (!(el instanceof Element)) continue;' +
          ' const r = el.getBoundingClientRect(); if (r.width <= 0 && r.height <= 0) continue;' +
          ' cw = Math.max(cw, r.right - br.left); ch = Math.max(ch, r.bottom - br.top); }' +
          ' const cs = getComputedStyle(b); cw += parseFloat(cs.paddingRight) || 0; ch += parseFloat(cs.paddingBottom) || 0; }' +
          ' } catch (e) {}' +
          ' return { scrollW: sw, scrollH: sh, contentW: cw, contentH: ch }; })()'
        ).then((m) => {
          if (pop.isDestroyed()) return;
          try { pop.setBounds(resolvePopupSize(m, pop.getBounds())); } catch {}
        }).catch(() => {});
      }, delay);
    };
    pop.webContents.once('did-finish-load', () => { fitPopupToContent(30); fitPopupToContent(200); });
    // A failed popup must never dead-end into the management page: show the
    // real error plus quick actions (Reload / Manage / Remove) in place.
    pop.webContents.once('did-fail-load', (ev, code, desc) => {
      console.warn('[dexerion] extension popup failed to load:', rec.name, code, desc);
      try { pop.destroy(); } catch {}
      openExtensionActions(st, rec, 'Popup failed to load (' + code + ' ' + (desc || '') + ')');
    });
    pop.loadURL(target);
    return pop;
  }

  function suggest(A, q) {
    const query = String(q || '').toLowerCase().trim();
    if (!query) return [];
    const seen = new Set(); const out = [];
    for (const h of A.history) {
      if (((h.title || '') + ' ' + h.url).toLowerCase().includes(query) && !seen.has(h.url)) {
        seen.add(h.url); out.push({ type: 'history', title: h.title, url: h.url });
        if (out.length >= 6) break;
      }
    }
    for (const b of Object.values(A.bookmarks.roots).flat()) {
      if (((b.title || '') + ' ' + b.url).toLowerCase().includes(query) && !seen.has(b.url)) {
        seen.add(b.url); out.push({ type: 'bookmark', title: b.title, url: b.url });
      }
    }
    return out.slice(0, 8);
  }

  function senderTabId(e) {
    const wc = e.sender;
    for (const st of windows.values()) {
      for (const [id, t] of st.tabs) {
        if (!t.view) continue;
        if (t.view.webContents === wc) return id;
      }
    }
    return null;
  }
  function broadcastState() { for (const id of windows.keys()) pushState(id); }
  // B5 — targeted state push for per-account changes. serial(winId) reads
  // accData(st.accountId), so a bookmark/folder change in one account leaves
  // every other account's window state bit-for-bit identical; only that
  // account's windows need the new dex:state. Every window still gets the
  // full state (same channel, same shape) — other accounts just stop
  // receiving an unchanged copy. Kill switch: DEX_BROADCAST_LEGACY=1 restores
  // the full broadcast for every call site.
  function pushStateForAccount(accountId) {
    if (process.env.DEX_BROADCAST_LEGACY === '1') { broadcastState(); return; }
    for (const st of windows.values()) {
      if (st.accountId === accountId) pushState(st.id);
    }
  }

  // Debloat V131-V180 measurement surface. Read-only: the A/B harness samples
  // the same Electron process metrics the Memory Saver already uses, plus the
  // active budget profile, so CPU/RAM/process deltas are attributable to the
  // named budgets rather than guessed from screenshots.
  ipcMain.handle('dex:debloat-metrics', (e) => {
    needChrome(e);
    const snap = memSnapshot();
    return {
      ok: true,
      activeProfile,
      budgets: { ...BUDGETS },
      sampledAt: Date.now(),
      workingSetMB: snap.workingSetMB,
      privateMB: snap.privateMB,
      processes: snap.processes,
      byType: { ...snap.byType },
      procs: snap.procs.map((p) => ({ pid: p.pid, type: p.type, mb: p.mb, cpu: p.cpu })),
    };
  });
  // Test-only workload controls. They never alter saved state and are only
  // reachable from the trusted chrome bridge, so the A/B harness can make an
  // idle/sleep workload deterministic without weakening the shipped defaults.
  ipcMain.handle('dex:debloat-set-idle', (e, payload) => {
    const { st } = Aof(e);
    const ageMs = Math.max(0, Math.min(24 * 60 * 60 * 1000, Number(payload && payload.ageMs) || 0));
    let count = 0;
    for (const t of st.tabs.values()) { t.lastActive = Date.now() - ageMs; count += 1; }
    return { ok: true, count, at: Date.now() };
  });
  ipcMain.handle('dex:debloat-sweep', (e) => {
    needChrome(e);
    sleepSweep();
    memorySweep();
    return { ok: true, at: Date.now() };
  });
  // Fills the real preview registry with bounded synthetic sites so the A/B
  // harness can measure the 64MB -> 24MB reduction in the main process without
  // pushing tens of megabytes through the IPC bridge. Trusted chrome only.
  ipcMain.handle('dex:debloat-fill-registry', (e, payload) => {
    needChrome(e);
    const p = payload || {};
    const count = Math.max(1, Math.min(24, Number(p.count) || 18));
    const bytesEach = Math.max(256 * 1024, Math.min(3 * 1024 * 1024, Number(p.bytesEach) || 3 * 1024 * 1024));
    const chunk = 'x'.repeat(Math.floor(bytesEach / 2));
    for (let i = 0; i < count; i += 1) {
      const content = '<!doctype html><html><body><main id="m">' + chunk + i + '</main></body></html>';
      aiSiteHost.registerSiteArtifact(siteRegistry, {
        kind: 'site',
        title: 'Perf site ' + i,
        files: [{ path: 'index.html', content }],
      });
    }
    return { ok: true, hosts: siteRegistry.size, bytes: aiSiteHost.siteRegistryBytes(siteRegistry) };
  });
  ipcMain.handle('dex:debloat-registry', (e) => {
    needChrome(e);
    return { ok: true, hosts: siteRegistry.size, bytes: aiSiteHost.siteRegistryBytes(siteRegistry) };
  });
  // V131-V180 deterministic A/B exercise. One call runs the same
  // budget-governed workload in both profiles and returns *measured* counters.
  // Whole-process averages are useless here: Chromium's fixed overhead dwarfs
  // the debloatable envelope and GPU is disabled by default. Chrome-only.
  ipcMain.handle('dex:debloat-exercise', (e, payload) => {
    needChrome(e);
    const p = payload || {};
    const windowMs = Math.max(1000, Math.min(30 * 60 * 1000, Number(p.windowMs) || 10 * 60 * 1000));
    const siteCount = Math.max(1, Math.min(24, Number(p.siteCount) || 24));
    const bytesEach = Math.max(256 * 1024, Math.min(3 * 1024 * 1024, Number(p.bytesEach) || 3 * 1024 * 1024));
    const cacheFills = Math.max(1, Math.min(64, Number(p.cacheFills) || 32));
    const previewBurst = Math.max(1, Math.min(10000, Number(p.previewBurst) || 1000));
    const idleAgeMs = Math.max(0, Math.min(24 * 60 * 60 * 1000, Number(p.idleAgeMs) || 4 * 60 * 1000));

    // 1) Preview registry: fill to the profile's byte/host budget.
    siteRegistry.clear();
    const chunk = 'x'.repeat(Math.floor(bytesEach / 2));
    for (let i = 0; i < siteCount; i += 1) {
      aiSiteHost.registerSiteArtifact(siteRegistry, {
        kind: 'site', title: 'Perf site ' + i,
        files: [{ path: 'index.html', content: '<!doctype html><html><body><main id="m">' + chunk + i + '</main></body></html>' }],
      });
    }
    const registryBytes = aiSiteHost.siteRegistryBytes(siteRegistry);
    const registryHosts = siteRegistry.size;

    // 2) Artifact diagnostics cache: overfill so both profiles reach their cap.
    diagnoseCache.clear();
    for (let i = 0; i < cacheFills; i += 1) {
      if (diagnoseCache.size >= BUDGETS.diagnoseCacheEntries) diagnoseCache.delete(diagnoseCache.keys().next().value);
      diagnoseCache.set('perf-' + i, { level: 'info', stats: { nodes: i } });
    }
    const cacheEntries = diagnoseCache.size;

    // 3) Periodic sweeps: the count derives from the *actual* interval budget,
    //    and CPU is measured with microsecond resolution (not Task Manager ticks).
    const sweepCount = Math.max(1, Math.round(windowMs / BUDGETS.sweepIntervalMs));
    const before = process.cpuUsage();
    for (let i = 0; i < sweepCount; i += 1) { sleepSweep(); memorySweep(); }
    const cpuDelta = process.cpuUsage(before);
    const sweepCpuUs = Math.max(1, cpuDelta.user + cpuDelta.system);

    // 4) Idle renderer teardown: age tabs between the two idle thresholds.
    const now = Date.now();
    for (const st of windows.values()) for (const t of st.tabs.values()) t.lastActive = now - idleAgeMs;
    sleepSweep();
    let renderersLive = 0, renderersSleeping = 0;
    for (const st of windows.values()) for (const t of st.tabs.values()) {
      if (t.sleeping) renderersSleeping += 1;
      else if (t.view) renderersLive += 1;
    }

    // 5) Preview message volume admitted from one burst (the shipped limiter).
    const previewPass = Math.min(previewBurst, BUDGETS.previewMessageLimit);

    // Composite proxies from measured counters. 60MB is the same documented
    // estimate for one live renderer in both profiles, so the ratio is driven
    // entirely by the measured live-renderer count.
    const ramBytes = registryBytes + cacheEntries * 4096 + renderersLive * 60 * 1024 * 1024;
    const gpuWork = renderersLive * previewPass;

    return {
      ok: true, activeProfile, budgets: { ...BUDGETS },
      windowMs, sweepCount, sweepCpuUs,
      registryBytes, registryHosts, cacheEntries,
      renderersLive, renderersSleeping, previewBurst, previewPass,
      ramBytes, gpuWork,
    };
  });

  return {
    newWindow, newTab, openExternalUrl, windowCount, closeWindow, focusWindow, registerInternalProtocol, openSkinPreview, capturePreviewShots, skinDirections: () => SKIN_DIRECTIONS.map(d => ({ ...d })),
    setupDownloadHandling, restoreSessionOrNewTab, persistAll, syncTheme, openExtensionPopup,
    openPopup, handleWindowOpen, popupCount() { return popupWindows.size; },
    closePopups() { for (const w of [...popupWindows]) { try { if (!w.isDestroyed()) w.close(); } catch {} } },
    applySelectionAccentAll,
    // Inspector: used by the shell's own controls, the app menu and the tests.
    openInspector, closeInspector, setInspectorDock,
    // Offline flow: the verdict is pure, and these drive it without a real outage.
    offlineVerdict, startWaiting, showOffline, netProbe,
    netState(winId, tabId) {
      const st = windows.get(winId);
      const t = st && st.tabs.get(tabId || st.active);
      const net = tabNet(t);
      let url = '';
      try { url = (t && t.view && !t.view.webContents.isDestroyed()) ? t.view.webContents.getURL() : ((t && t.url) || ''); } catch { url = (t && t.url) || ''; }
      return {
        state: net ? net.state : 'none',
        target: net ? net.target : '',
        grace: net ? net.grace : 0,
        attempts: net ? net.attempts : 0,
        tries: net ? net.tries : 0,
        of: net ? net.of : 0,
        recoveries: net ? net.recoveries : 0,
        startedAt: net ? net.started : 0,   // when the waiting page was up and the count began
        recoveredAt: (t && t.netRecoveredAt) || 0,   // survives the navigation the green state cannot
        url,
      };
    },
    inspectorState(winId) {
      const st = windows.get(winId);
      const ins = st && st.inspector;
      const rect = st ? inspectorRect(st) : null;
      return {
        open: Boolean(ins && ins.open),
        dock: ins ? ins.dock : 'bottom',
        host: st ? inspectorHost(st) : '',
        rect,
        winBounds: st ? st.win.getContentBounds() : null,
        fallback: Boolean(ins && ins.fallback),
        reason: (ins && ins.reason) || '',
        surfaceUrl: (ins && ins.win && !ins.win.isDestroyed()) ? ins.win.webContents.getURL() : '',
        // Pixels are the only honest proof of what the frontend is showing: a
        // loaded frontend and a connected one look identical to the DOM probe.
        devToolsUrl: (ins && ins.win && !ins.win.isDestroyed()) ? ins.win.webContents.getURL() : '',
        devToolsBounds: (ins && ins.win && !ins.win.isDestroyed()) ? ins.win.getBounds() : null,
        devToolsAlive: Boolean(ins && ins.win && !ins.win.isDestroyed()),
      };
    },
    activeTabContents(winId) {
      const st = windows.get(winId);
      const t = st && st.tabs.get(st.active);
      try { return (t && t.view && !t.view.webContents.isDestroyed()) ? t.view.webContents : null; } catch { return null; }
    },
    shellContents(winId) {
      const st = windows.get(winId);
      return st ? st.win.webContents : null;
    },
    ctxCount() { return ctxWindows.size + sugPopups.size; },
    snipCount() { return snipState.size; },
    closeSnips() { for (const [wid, rec] of [...snipState]) { const st = windows.get(wid); try { if (st) destroySnipView(st, rec); else rec.view.webContents.close(); } catch {} snipState.delete(wid); } },
    snipContents(winId) { const rec = snipState.get(winId); return rec && !rec.view.webContents.isDestroyed() ? rec.view.webContents : null; },
    // Lets the self-test read what the suggest sheet actually painted. The
    // window existing proves nothing: a popup whose document failed to parse
    // (or a renderer that never received dex:ctx-data) is a fully transparent
    // window that swallows clicks while every "did it open" check passes.
    suggestContents(winId) {
      const rec = sugPopups.get(winId);
      return rec && !rec.win.isDestroyed() ? rec.win.webContents : null;
    },
    chromeH(winId) { const st = windows.get(winId); return (st && st.chromeH) || null; },
    railW(winId) { const st = windows.get(winId); return st ? railW(st) : null; },
    // The inspector's fallback panel (a Dexerion page we host), for tests.
    panelContents(winId) {
      const st = windows.get(winId);
      const ins = st && st.inspector;
      const w = ins && ins.win;
      return Boolean(ins && ins.fallback && w && !w.isDestroyed()) ? w.webContents : null;
    },
    // Where the page actually sits — lets a test prove the view starts exactly
    // where the rail ends instead of trusting two hardcoded numbers to agree.
    tabBounds(winId) {
      const st = windows.get(winId);
      const t = st && st.tabs.get(st.active);
      if (!t) return null;
      try { return t.view.getBounds(); } catch { return null; }
    },
    refreshPomodoro, maybeOpenWelcome, pomoState() { return pomodoro.state(); },
    _pomodoro: pomodoro,
    _test: {
      resolveInput,
      // The page context menu, so a test can read its labels and drive an item
      // without a real right-click.
      contextMenu(winId, tabId, params) {
        const st = windows.get(winId);
        const t = st && st.tabs.get(tabId || (st && st.active));
        if (!t || !t.view) return null;
        return contextMenuFor(winId, t.id, t.view.webContents, params || {});
      },
      // Forcing a sleep sweep from a test (0 = only idle rules apply).
      sleepSweep(maxIdleMs) { sleepSweep(maxIdleMs); return true; },
      // Memory Saver: forced sweeps for tests (fake total, optional floor).
      memorySweep(forcedTotalMB, floorMs) { return memorySweep(forcedTotalMB, floorMs); },
      memReport() { return buildMemoryReport(); },
      // Reads Chromium's DevTools document in our host window: if its tab bar is
      // there, the frontend really rendered inside Dexerion's frame.
      devToolsProbe(winId) {
        const st = windows.get(winId);
        const ins = st && st.inspector;
        if (!ins || !ins.win || ins.win.isDestroyed()) return Promise.resolve({ tabs: false, nodes: 0 });
        // Every leg of the probe is individually bounded: a wedged renderer (or
        // a CDP command that never settles) must make the probe report "no
        // evidence", never hang the caller — an unbounded await here froze the
        // whole self-test for as long as the surface stayed stuck.
        const bounded = (p, ms, fallback) => Promise.race([
          Promise.resolve(p).catch(() => fallback),
          new Promise((r) => setTimeout(() => r(fallback), ms)),
        ]);
        // The frontend renders inside shadow roots, so a plain querySelector sees
        // nothing: walk every root. `selected` is the node the inspector picked -
        // the same thing the Elements panel highlights.
        const dom = bounded(ins.win.webContents.executeJavaScript(`(() => {
          const all = [];
          const walk = (root) => { for (const el of root.querySelectorAll('*')) { all.push(el); if (el.shadowRoot) walk(el.shadowRoot); } };
          try { walk(document); } catch (e) {}
          const has = (c) => all.some(e => e.classList && e.classList.contains(c));
          const sel = all.find(e => e.classList && e.classList.contains('selected') && /h1|head|Alpha|Bravo/i.test(e.textContent || ''));
          return {
            tabs: has('tabbed-pane') || has('main-tabbed-pane'),
            nodes: all.filter(e => e.classList && e.classList.contains('tree-outline')).length,
            selected: sel ? String(sel.textContent || '').trim().slice(0, 80) : '',
            title: document.title,
          };
        })()`), 6000, { tabs: false, nodes: 0, selected: '' });
        // The page-JS walk comes up empty on a fully working inspector: the
        // DevTools frontend uses **closed** shadow roots, which page JavaScript
        // cannot traverse — while a screenshot of this same window shows
        // Elements/Styles for h1#head. CDP's DOM domain can pierce shadow trees
        // regardless of closedness, so the probe reads the document a second
        // time over the debugger and uses that when it finds the chrome.
        let attachedHere = false;
        const pierced = (async () => {
          const wc = ins.win.webContents;
          try {
            if (!wc.debugger.isAttached()) { wc.debugger.attach('1.3'); attachedHere = true; }
            const res = await bounded(wc.debugger.sendCommand('DOM.getDocument', { depth: 60, pierce: true }), 8000, null);
            if (!res) return null;
            const root = res && res.root;
            if (!root) return null;
            let tabs = false;
            let nodes = 0;
            let selected = '';
            const textOf = (n, depth) => {
              if (depth > 8 || !n) return '';
              let out = '';
              for (const c of n.childNodes || []) out += c.nodeValue || '';
              for (const c of n.children || []) out += textOf(c, depth + 1);
              for (const s of n.shadowRoots || []) out += textOf(s, depth + 1);
              return out;
            };
            const walk = (n) => {
              if (!n) return;
              const attrs = n.attributes || [];
              let cls = ' ';
              for (let i = 0; i + 1 < attrs.length; i += 2) if (attrs[i] === 'class') cls += attrs[i + 1] + ' ';
              if (/(^| )tabbed-pane( |$)/.test(cls) || /main-tabbed-pane/.test(cls)) tabs = true;
              if (/tree-outline/.test(cls)) nodes += 1;
              if (!selected && /\bselected\b/.test(cls)) {
                const t = textOf(n, 0).replace(/\s+/g, ' ').trim();
                if (/h1|head|Alpha|Bravo/i.test(t)) selected = t.slice(0, 80);
              }
              for (const c of n.children || []) walk(c);
              for (const s of n.shadowRoots || []) walk(s);
              if (n.contentDocument) walk(n.contentDocument);
            };
            walk(root);
            return { tabs, nodes, selected };
          } catch {
            return null;
          } finally {
            if (attachedHere) { try { wc.debugger.detach(); } catch { /* best effort */ } }
          }
        })();
        // What the person actually sees, independent of any probe: distinct
        // colours in a capture of the panel (a blank frontend is one or two
        // colours, a rendered one is dozens). This stays the last-resort
        // evidence so a closed-root frontend can never read as "blank".
        const painted = bounded(ins.win.webContents.capturePage()
          .then((img) => {
            const bmp = typeof img.toBitmap === 'function' ? img.toBitmap() : img.getBitmap();
            const seen = new Set();
            for (let i = 0; i + 3 < bmp.length; i += 4 * 97) seen.add(bmp[i] + ',' + bmp[i + 1] + ',' + bmp[i + 2]);
            return seen.size > 8;
          }), 6000, false);
        return Promise.all([dom, painted, pierced]).then(([d, ok, cdp]) => {
          const base = cdp && (cdp.tabs || cdp.nodes || cdp.selected) ? cdp : d;
          return {
            ...base,
            painted: ok,
            pierced: Boolean(cdp),
            evidence: cdp && cdp.tabs ? 'pierced' : (d.tabs ? 'shadow-walk' : (ok ? 'painted' : 'none')),
          };
        });
      },
      devToolsShot(winId, file) {
        const st = windows.get(winId);
        const ins = st && st.inspector;
        if (!ins || !ins.win || ins.win.isDestroyed()) return Promise.resolve({ file: '', colours: 0 });
        return ins.win.webContents.capturePage()
          .then((img) => {
            fs.writeFileSync(file, img.toPNG());
            // A loaded-but-blank frontend and a working one look the same to the
            // DOM; sampling distinct colours tells them apart.
            const bmp = typeof img.toBitmap === 'function' ? img.toBitmap() : img.getBitmap();
            const seen = new Set();
            for (let i = 0; i + 3 < bmp.length; i += 4 * 97) seen.add(bmp[i] + ',' + bmp[i + 1] + ',' + bmp[i + 2]);
            return { file, colours: seen.size };
          })
          .catch((e) => ({ file: 'ERR ' + e.message, colours: 0 }));
      },
      // Screenshot an ordinary tab page. WebContentsView has no capture surface
      // of its own, so this goes through the debugger protocol, which renders the
      // page regardless of how the view is composited.
      pageShot(winId, file) {
        const st = windows.get(winId);
        const t = st && st.tabs.get(st.active);
        if (!t) return Promise.resolve('ERR no tab');
        const wc = t.view.webContents;
        return (async () => {
          try {
            if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
            const res = await wc.debugger.sendCommand('Page.captureScreenshot', { format: 'png' });
            fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
            return file;
          } catch (e) { return 'ERR ' + (e && e.message); }
          finally { try { wc.debugger.detach(); } catch {} }
        })();
      },
    },
    _accounts: { listAccounts, accData, saveAcc, sesFor, getAccountMeta, createAccount, googleStatus },
    _logins: { encryptSecret, decryptSecret, loginsFor },
    _power: { state: powerState, apply: applyPowerPlan, markInteraction, markWindowEvent, setWindowViewsVisible },
  };
}

module.exports = { createBrowser, googleUrl, GOOGLE_SERVICES, parsePopupFeatures, classifyWindowOpen, buildPopupBounds, clampPopupSize, resolvePopupSize };
