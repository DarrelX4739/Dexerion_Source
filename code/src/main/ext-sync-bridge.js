// Storage-area bridge for Dexerion extension contexts.
// Chrome documents: "If syncing is disabled, storage.sync behaves like
// storage.local." Electron ships no sync backend, so without this every
// sync get/set fails with `"sync" is not available in this instance of
// Chrome` and no cross-context sync onChanged ever fires — toggles and
// settings silently dead (verified live on Electron 44). The injected source
// below backs the sync area with the local area (keys namespaced so the two
// areas never collide) and re-labels deliveries so `area === 'sync'`
// filters keep working. It runs ONLY in Dexerion extension contexts
// (injected by the browser, never shipped to Chrome), and bails silently if
// the objects turn out non-writable — leaving native behavior untouched.
const SYNC_KEY_PREFIX = '__dexsync__v1__';

function toLocalKey(key) { return SYNC_KEY_PREFIX + String(key); }
function fromLocalKey(prefixed) {
  const s = String(prefixed);
  return s.startsWith(SYNC_KEY_PREFIX) ? s.slice(SYNC_KEY_PREFIX.length) : null;
}

// The exact source injected first in each extension JS world (popup pages,
// content-script worlds). Built from SYNC_KEY_PREFIX so there is one source
// of truth. Must stay dependency-free (no Node, no Buffer) and ES2019-safe.
const SYNC_BRIDGE_SOURCE = `(function () {
  'use strict';
  var PREFIX = ${JSON.stringify(SYNC_KEY_PREFIX)};
  try {
    if (window.__dexSyncBridgeInstalled) return;
    var c = window.chrome;
    if (!c || !c.storage || !c.storage.local || !c.storage.onChanged) return;
    var local = c.storage.local;
    var runtime = c.runtime;
    function lastErr() { try { return (runtime && runtime.lastError) || null; } catch (e) { return null; } }
    function normKeys(keys) {
      if (keys == null) return { mode: 'all' };
      if (typeof keys === 'string') return { mode: 'list', list: [keys] };
      if (Array.isArray(keys)) return { mode: 'list', list: keys.slice() };
      if (typeof keys === 'object') return { mode: 'map', map: keys };
      return { mode: 'all' };
    }
    function translateBack(items, spec) {
      var out = {}, k, i;
      if (spec.mode === 'all') {
        for (k in items) {
          if (!Object.prototype.hasOwnProperty.call(items, k)) continue;
          if (k.indexOf(PREFIX) === 0) out[k.slice(PREFIX.length)] = items[k];
        }
        return out;
      }
      if (spec.mode === 'list') {
        for (i = 0; i < spec.list.length; i++) {
          var lk = PREFIX + spec.list[i];
          if (Object.prototype.hasOwnProperty.call(items, lk)) out[spec.list[i]] = items[lk];
        }
        return out;
      }
      for (k in spec.map) {
        if (!Object.prototype.hasOwnProperty.call(spec.map, k)) continue;
        var pk = PREFIX + k;
        out[k] = Object.prototype.hasOwnProperty.call(items, pk) ? items[pk] : spec.map[k];
      }
      return out;
    }
    function callAsync(run, cb) {
      var p = new Promise(function (resolve) {
        try { run(resolve); } catch (e) { resolve({ threw: String((e && e.message) || e) }); }
      });
      if (typeof cb === 'function') {
        p.then(function (r) { try { cb(r && r.value); } catch (e) {} });
        return undefined;
      }
      return p.then(function (r) {
        if (r && r.threw) throw new Error(r.threw);
        var le = lastErr();
        if (le) throw new Error(String(le.message || le));
        return r.value;
      });
    }
    function byteLen(s) {
      try { return new TextEncoder().encode(s).length; }
      catch (e) { return String(s).length; }
    }
    var syncListeners = [];
    var realChanged = c.storage.onChanged;
    if (!realChanged.__dexSyncWrapped) {
      var origAdd = realChanged.addListener.bind(realChanged);
      var origRemove = realChanged.removeListener
        ? realChanged.removeListener.bind(realChanged) : function () {};
      var origHas = realChanged.hasListener
        ? realChanged.hasListener.bind(realChanged) : function () { return false; };
      var table = [];
      function findWrapped(fn) {
        for (var i = 0; i < table.length; i++) if (table[i][0] === fn) return table[i][1];
        return null;
      }
      realChanged.addListener = function (fn) {
        if (typeof fn !== 'function') { try { origAdd(fn); } catch (e) {} return; }
        if (findWrapped(fn)) return;
        var wrapped = function (changes, area) {
          try {
            if (area === 'local') {
              var s = {}, l = {}, hs = false, hl = false, k, i;
              for (k in changes) {
                if (!Object.prototype.hasOwnProperty.call(changes, k)) continue;
                if (k.indexOf(PREFIX) === 0) { s[k.slice(PREFIX.length)] = changes[k]; hs = true; }
                else { l[k] = changes[k]; hl = true; }
              }
              if (hs) {
                try { fn(s, 'sync'); } catch (e) {}
                for (i = 0; i < syncListeners.length; i++) {
                  try { syncListeners[i](s, 'sync'); } catch (e2) {}
                }
              }
              if (hl) { try { fn(l, 'local'); } catch (e3) {} }
            } else {
              try { fn(changes, area); } catch (e4) {}
            }
          } catch (e5) {}
        };
        table.push([fn, wrapped]);
        origAdd(wrapped);
      };
      realChanged.removeListener = function (fn) {
        var w = findWrapped(fn);
        for (var i = table.length - 1; i >= 0; i--) if (table[i][0] === fn) table.splice(i, 1);
        try { origRemove(w || fn); } catch (e) {}
      };
      if (realChanged.hasListener) {
        realChanged.hasListener = function (fn) {
          if (findWrapped(fn)) return true;
          try { return !!origHas(fn); } catch (e) { return false; }
        };
      }
      try { Object.defineProperty(realChanged, '__dexSyncWrapped', { value: true, configurable: true }); }
      catch (e) { try { realChanged.__dexSyncWrapped = true; } catch (e2) {} }
    }
    var bridge = {
      QUOTA_BYTES: 102400,
      QUOTA_BYTES_PER_ITEM: 8192,
      MAX_ITEMS: 512,
      MAX_WRITE_OPERATIONS_PER_HOUR: 1800,
      MAX_WRITE_OPERATIONS_PER_MINUTE: 120,
      get: function (keys, cb) {
        var spec = normKeys(keys);
        return callAsync(function (resolve) {
          var query = spec.mode === 'all' ? null : (spec.mode === 'list'
            ? spec.list.map(function (k) { return PREFIX + k; })
            : Object.keys(spec.map).map(function (k) { return PREFIX + k; }));
          local.get(query, function (items) { resolve({ value: translateBack(items || {}, spec) }); });
        }, cb);
      },
      set: function (items, cb) {
        return callAsync(function (resolve) {
          var payload = {};
          for (var k in items) {
            if (Object.prototype.hasOwnProperty.call(items, k)) payload[PREFIX + k] = items[k];
          }
          local.set(payload, function () { resolve({ value: undefined }); });
        }, cb);
      },
      remove: function (keys, cb) {
        var list = typeof keys === 'string' ? [keys] : (Array.isArray(keys) ? keys.slice() : []);
        return callAsync(function (resolve) {
          local.remove(list.map(function (k) { return PREFIX + k; }), function () {
            resolve({ value: undefined });
          });
        }, cb);
      },
      clear: function (cb) {
        return callAsync(function (resolve) {
          local.get(null, function (items) {
            var doomed = [];
            for (var k in (items || {})) {
              if (Object.prototype.hasOwnProperty.call(items, k) && k.indexOf(PREFIX) === 0) doomed.push(k);
            }
            if (!doomed.length) { resolve({ value: undefined }); return; }
            local.remove(doomed, function () { resolve({ value: undefined }); });
          });
        }, cb);
      },
      getBytesInUse: function (keys, cb) {
        if (typeof keys === 'function') { cb = keys; keys = null; }
        var spec = normKeys(keys);
        return callAsync(function (resolve) {
          bridge.get(spec.mode === 'all' ? null : (spec.mode === 'list' ? spec.list : spec.map),
            function (items) { resolve({ value: byteLen(JSON.stringify(items || {})) }); });
        }, cb);
      },
      setAccessLevel: function (opts, cb) {
        if (typeof opts === 'function') { cb = opts; opts = null; }
        void opts;
        if (typeof cb === 'function') { try { cb(); } catch (e) {} return undefined; }
        return Promise.resolve();
      },
      onChanged: {
        addListener: function (fn) {
          if (typeof fn === 'function' && syncListeners.indexOf(fn) === -1) syncListeners.push(fn);
        },
        removeListener: function (fn) {
          var i = syncListeners.indexOf(fn);
          if (i >= 0) syncListeners.splice(i, 1);
        },
        hasListener: function (fn) { return syncListeners.indexOf(fn) >= 0; }
      }
    };
    try { c.storage.sync = bridge; } catch (e) { return; }
    if (c.storage.sync !== bridge) return;
    try { window.__dexSyncBridgeInstalled = true; } catch (e) {}
  } catch (e) {}
})();`;

module.exports = { SYNC_KEY_PREFIX, toLocalKey, fromLocalKey, SYNC_BRIDGE_SOURCE, attachSyncBridge };

// Fingerprint evaluated in each new JS context: only genuine extension
// worlds expose chrome.runtime.id. Everything else is left untouched.
const WORLD_FINGERPRINT_SOURCE =
  `JSON.stringify({ ext: (window.chrome && window.chrome.runtime && window.chrome.runtime.id) || null })`;

// Attach the sync-area bridge to every extension JS world inside webContents
// (extension pages AND content-script worlds, main frames and subframes).
// Uses the debugger's per-context targeting: contexts are fingerprinted as
// they are created — before extension scripts run in them — so document_idle
// content scripts always see a bridged sync area. document_start scripts that
// touch sync in their first synchronous breath are a best-effort race.
// Returns true when the session is (or already was) attached.
function attachSyncBridge(wc) {
  if (!wc || !wc.debugger) return false;
  const dbg = wc.debugger;
  // Wedge guard: when a renderer dies, the debugger detaches BEFORE
  // isDestroyed() flips true, so an immediate re-attach re-arms on a dying
  // target and detach -> attach spins forever, starving the main loop
  // (Windows Not Responding; every tab close / renderer death could hit it).
  // Re-attaches are therefore deferred (a dying renderer has settled into
  // destroyed by fire time) and capped: a few tries cover transient steals,
  // a dying target stops instead of looping. Any live debugger traffic
  // resets the budget.
  let reattachTimer = null;
  let reattachTries = 0;
  function onMessage(e, method, params) {
    if (method !== 'Runtime.executionContextCreated') return;
    reattachTries = 0;
    const ctx = params && params.context;
    if (!ctx || ctx.id == null) return;
    dbg.sendCommand('Runtime.evaluate', {
      expression: WORLD_FINGERPRINT_SOURCE, contextId: ctx.id, returnByValue: true,
    }).then((res) => {
      let ext = null;
      try { ext = res && res.result && res.result.value && JSON.parse(res.result.value).ext; } catch {}
      if (!ext || (wc.isDestroyed && wc.isDestroyed())) return;
      dbg.sendCommand('Runtime.evaluate', {
        expression: SYNC_BRIDGE_SOURCE, contextId: ctx.id,
      }).catch(() => {});
    }).catch(() => {});
  }
  function onDetach(e, reason) {
    cleanup();
    // The user opening DevTools steals the session — respect that and stay
    // out; anything else gets a best-effort re-attach for future navigations.
    if (String(reason || '').toLowerCase().includes('devtools')) return;
    try { if (wc.isDestroyed && wc.isDestroyed()) return; } catch { return; }
    if (reattachTries >= 3 || reattachTimer) return;
    reattachTries += 1;
    reattachTimer = setTimeout(() => {
      reattachTimer = null;
      let dead = false;
      try { dead = Boolean(wc.isDestroyed && wc.isDestroyed()); } catch { dead = true; }
      if (dead) return;
      tryAttach();
    }, 500);
    try { if (reattachTimer.unref) reattachTimer.unref(); } catch {}
  }
  function cleanup() {
    try { dbg.removeListener('message', onMessage); } catch {}
    try { dbg.removeListener('detach', onDetach); } catch {}
    if (reattachTimer) { clearTimeout(reattachTimer); reattachTimer = null; }
  }
  function tryAttach() {
    try { if (dbg.isAttached()) return true; } catch {}
    dbg.on('message', onMessage);
    dbg.on('detach', onDetach);
    try {
      dbg.attach();
    } catch {
      cleanup();
      return false;
    }
    dbg.sendCommand('Runtime.enable').catch(() => {});
    return true;
  }
  if (wc.once) {
    try {
      wc.once('destroyed', () => { cleanup(); try { dbg.detach(); } catch {} });
    } catch {}
  }
  return tryAttach();
}
