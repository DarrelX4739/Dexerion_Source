// JSON-file profile store. Own data dir via app.getPath('userData').
// Persists: settings, bookmarks, history, downloads, tabs/session, extensions.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const adaptivePower = require('./adaptive-power');

// Read one profile JSON file. A file written by another tool (PowerShell's
// -Encoding UTF8, some editors) can carry a byte-order mark, and JSON.parse
// rejects it — the profile then silently loads as DEFAULTS, which looks exactly
// like "Dexerion reset my settings". Strip the mark before parsing.
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

// The reminder probe only cares whether readJson would return null. Scan
// for non-JSON whitespace without an anchored run that backtracks on a
// long malformed suffix. Strip at most one BOM, and only at the beginning.
function isNullJson(text) {
  const start = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
  if (text.charCodeAt(start) === 0x7B) return false; // ordinary bookmark object
  const nonWhitespace = /[^ \t\r\n]/g;
  nonWhitespace.lastIndex = start;
  const first = nonWhitespace.exec(text);
  if (!first || !text.startsWith('null', first.index)) return false;
  nonWhitespace.lastIndex = first.index + 4;
  return !nonWhitespace.test(text);
}

// Atomic write: a crash or power loss mid-write must never truncate a store —
// a torn file loads as DEFAULTS, which reads as "Dexerion reset my data". The
// temp file is written and flushed first, then renamed over the real one, so
// the loader only ever sees a complete document (the new one or the previous).
// Every profile write (shared files and per-account files) goes through here.
function writeJsonAtomic(file, value) {
  const tmp = file + '.tmp';
  const text = JSON.stringify(value, null, 2);
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, text);
    try { fs.fsyncSync(fd); } catch { /* durable flush is best effort */ }
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);   // Node's rename replaces an existing file on Windows too
}

const DEFAULT_SETTINGS = {
  searchEngine: 'google', // google | bing | duckduckgo | custom
  customSearchUrl: 'https://www.google.com/search?q=%s',
  homepage: 'dexerion://newtab',
  restoreSession: true,
  showBookmarksBar: true,
  // Search With Dexerion AI (fullscreen search): suggestions are off until the
  // user turns them on; the counts stay inside the supported 4-16 / 2-8.
  aiSearchSuggest: false,
  aiSearchSources: 10,
  aiSearchAdaptations: 5,
  downloadDir: '',
  clearOnExit: [],
  theme: 'dark', // dark | light (dark is the default)
  accent: '#35c4ff',
  // V51+ interface density: compact | comfortable | spacious.
  uiDensity: 'comfortable',
  verticalTabs: true, // Dexerion is vertical-tabs only (migrated on launch)
  // Chrome theme (src/renderer/skins/<name>.css). 'dexerion' is the shipped
  // look — the default — and the others are directions the user can pick.
  skin: 'dexerion',
  // Focus Timer (Pomodoro) settings, edited from the rail timer panel.
  pomoWorkMin: 25,
  pomoBreakMin: 5,
  pomoSound: 'white', // drizzlo | cuphaze | nodland | glidelo | white | rain | brown | pad | off
  pomoVolume: 45, // 0..100
  pomoBlocklist: [], // bare hostnames, e.g. ['youtube.com']
  // Memory Saver: sleep background tabs when the app's total working set is
  // over this budget (1-4 GB, user-chosen). On by default.
  memorySaver: true,
  memoryCapMB: 2048,
  // Show the welcome page when Dexerion launches (Settings > Appearance).
  welcomeDaily: true,
  // GPU policy: a single Adaptive mode (src/main/adaptive-power.js). Legacy
  // off/balanced/full preferences are migrated to 'adaptive' on load.
  gpuMode: 'adaptive',
};

const SEARCH_ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
};

// Focus modes defaults. Each mode is a user-named profile: an allowed-or-blocked
// site list plus either a timer or a daily time frame. Focus is OFF until the
// user creates a mode. Kept in focus.json so it survives restarts independently
// of the browsing session.
const DEFAULT_FOCUS = {
  version: 4,
  modes: [],
  config: {
    enabled: false,
  },
};

class ProfileStore {
  constructor() {
    this.dir = app.getPath('userData');
    this.files = {
      settings: 'settings.json',
      bookmarks: 'bookmarks.json',
      history: 'history.json',
      downloads: 'downloads.json',
      tabs: 'tabs.json',
      closedTabs: 'closed-tabs.json',
      extensions: 'extensions.json',
      topSites: 'topsites.json',
      accounts: 'accounts.json',
      focus: 'focus.json',
    };
    this.data = {
      settings: { ...DEFAULT_SETTINGS },
      // Legacy global stores (pre-accounts). Migrated into Accounts/default
      // on first launch; per-account files below are authoritative afterwards.
      bookmarks: { roots: { bar: [], other: [] } },
      history: [],
      downloads: [],
      tabs: { windows: [] },
      closedTabs: [],
      extensions: [],
      topSites: {},
      accounts: [],
      defaultAccountId: 'default',
      focus: JSON.parse(JSON.stringify(DEFAULT_FOCUS)),
    };
  }

  _path(key) { return path.join(this.dir, this.files[key]); }

  // ---------- accounts ----------
  accountDir(id) { return path.join(this.dir, 'Accounts', String(id).replace(/[^a-zA-Z0-9-_]/g, '')); }

  ensureAccounts() {
    if (!Array.isArray(this.data.accounts)) this.data.accounts = [];
    if (!this.data.accounts.find(a => a.id === 'default')) {
      this.data.accounts.unshift({
        id: 'default', name: 'Personal', email: '',
        color: '#35c4ff', createdAt: Date.now(),
      });
    }
    if (!this.data.defaultAccountId) this.data.defaultAccountId = 'default';
    // First-run migration: seed the default account from legacy globals.
    const d = this.accountDir('default');
    if (!fs.existsSync(path.join(d, 'bookmarks.json'))) {
      this.saveAccountData('default', {
        bookmarks: this.data.bookmarks,
        history: this.data.history,
        topSites: this.data.topSites,
        closedTabs: this.data.closedTabs,
        logins: [],
        chats: [],
      });
    }
  }

  blankAccountData() {
    return {
      bookmarks: { roots: { bar: [], other: [] } },
      history: [], topSites: {}, closedTabs: [], logins: [], chats: [], memory: [], tasks: [],
      // Assistant missions (agent runs: plan, steps, result) and research
      // projects (user-approved goals, sources, findings, decisions,
      // questions). Both are separate from personal memory.
      missions: [], projects: [],
    };
  }

  loadAccountData(id, residentTasks) {
    const d = this.accountDir(id);
    const data = this.blankAccountData();
    for (const k of Object.keys(data)) {
      if (k === 'tasks' && residentTasks !== undefined) { data.tasks = residentTasks; continue; }
      try {
        const p = path.join(d, k === 'topSites' ? 'topsites.json' : k === 'closedTabs' ? 'closed-tabs.json' : k + '.json');
        if (fs.existsSync(p)) data[k] = readJson(p);
      } catch {}
    }
    if (!data.bookmarks.roots) data.bookmarks = this.blankAccountData().bookmarks;
    return data;
  }

  loadAccountReminderData(id) {
    const d = this.accountDir(id);
    let nullBookmarks = false;
    // Only a successfully parsed null makes the full loader reject the
    // account. Match that JSON value without allocating the bookmark tree:
    // one initial BOM, JSON whitespace only, and an exact end of input.
    try {
      const text = fs.readFileSync(path.join(d, 'bookmarks.json'), 'utf8');
      nullBookmarks = isNullJson(text);
    } catch {}
    if (nullBookmarks) throw new TypeError('Invalid account bookmarks');
    let tasks = [];
    try { tasks = readJson(path.join(d, 'tasks.json')); } catch {}
    return { tasks };
  }

  saveAccountReminderData(id, data) {
    try {
      const d = this.accountDir(id);
      fs.mkdirSync(d, { recursive: true });
      writeJsonAtomic(path.join(d, 'tasks.json'), data.tasks ?? []);
      this.lastError = '';
      return true;
    } catch (e) {
      this.lastError = String((e && e.message) || e);
      console.warn('[dexerion] account save failed', id, this.lastError);
      return false;
    }
  }

  // Returns true when every account file was written, false when any write
  // failed (the reason stays in lastError). A silent empty catch here would
  // hide a full disk or a locked profile — the person quitting Dexerion would
  // never know their bookmarks, chats or history did not make it to disk.
  saveAccountData(id, data) {
    try {
      const d = this.accountDir(id);
      fs.mkdirSync(d, { recursive: true });
      const names = { bookmarks: 'bookmarks.json', history: 'history.json', topSites: 'topsites.json', closedTabs: 'closed-tabs.json', logins: 'logins.json', chats: 'chats.json', memory: 'memory.json', tasks: 'tasks.json', missions: 'missions.json', projects: 'projects.json' };
      for (const k of Object.keys(names)) {
        writeJsonAtomic(path.join(d, names[k]), data[k] ?? this.blankAccountData()[k]);
      }
      this.lastError = '';
      return true;
    } catch (e) {
      this.lastError = String((e && e.message) || e);
      console.warn('[dexerion] account save failed', id, this.lastError);
      return false;
    }
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    // Migrate the legacy schedule.json to focus.json once (data preserved).
    try {
      const legacy = path.join(this.dir, 'schedule.json');
      if (fs.existsSync(legacy) && !fs.existsSync(this._path('focus'))) {
        fs.copyFileSync(legacy, this._path('focus'));
      }
    } catch {}
    for (const key of Object.keys(this.files)) {
      try {
        const p = this._path(key);
        if (fs.existsSync(p)) {
          const raw = readJson(p);
          if (key === 'settings') {
            this.data.settings = { ...DEFAULT_SETTINGS, ...raw };
            // One-time migration of the old off/balanced/full GPU picker:
            // 'off' keeps its meaning (legal choice again), balanced/full map
            // to Adaptive. The write is deferred to the end of load() (after
            // every file has been read) so it can never flush defaults over a
            // file that has not been read yet.
            const migratedGpu = adaptivePower.migrateGpuMode(this.data.settings.gpuMode);
            if (migratedGpu.changed) {
              this.data.settings.gpuMode = migratedGpu.value;
              this._migratedGpuMode = true;
            }
          }
          else if (key === 'accounts') {
            if (Array.isArray(raw.accounts)) this.data.accounts = raw.accounts;
            if (raw.defaultAccountId) this.data.defaultAccountId = raw.defaultAccountId;
          }
          else if (key === 'focus') {
            this.data.focus = {
              ...DEFAULT_FOCUS,
              ...raw,
              modes: Array.isArray(raw.modes) ? raw.modes : undefined,
              config: { ...DEFAULT_FOCUS.config, ...(raw.config || {}) },
            };
            // Legacy modes data is preserved on disk untouched (Focus Timer
            // replaced modes; nothing reads this anymore).
            if (raw.modes === undefined && raw.sessions === undefined) {
              this.data.focus.modes = [];
            }
          }
          else this.data[key] = raw;
        }
      } catch (e) { console.warn('[dexerion] profile load failed for', key, e.message); }
    }
    if (!this.data.settings.downloadDir) {
      this.data.settings.downloadDir = app.getPath('downloads');
    }
    // Persist the one-time Adaptive GPU migration (all files are read by now,
    // so the write reflects the complete on-disk state, not defaults).
    if (this._migratedGpuMode) {
      this._migratedGpuMode = false;
      try { this.saveNow(); } catch {}
    }
    this.ensureAccounts();
  }

  // Write the profile to disk NOW and report whether it worked.
  // The deferred saveSoon() below stays for the high-frequency mutations
  // (history, session, tab churn) where a 400 ms delay is fine. A page
  // that tells the user "Saved" needs the durable write, not a promise
  // of one - otherwise a full disk leaves the UI claiming a change that
  // is not on disk. Returns false and keeps the reason in lastError.
  saveNow() {
    clearTimeout(this._t);
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      for (const key of Object.keys(this.files)) {
        const val = key === 'accounts'
          ? { accounts: this.data.accounts, defaultAccountId: this.data.defaultAccountId }
          : this.data[key];
        writeJsonAtomic(this._path(key), val);
      }
      this.lastError = '';
      return true;
    } catch (e) {
      this.lastError = String((e && e.message) || e);
      console.warn('[dexerion] profile save failed', this.lastError);
      return false;
    }
  }

  save() {
    this.saveNow();
  }

  saveSoon() {
    clearTimeout(this._t);
    this._t = setTimeout(() => this.save(), 400);
  }
}

module.exports = { ProfileStore, DEFAULT_SETTINGS, DEFAULT_FOCUS, SEARCH_ENGINES, writeJsonAtomic, readJson };
