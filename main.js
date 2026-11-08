// Dexerion V1 — main entry. Bootstraps profile, browser windows, extensions, IPC.
// Technology choice: Electron (embedded Chromium + Node). See ARCHITECTURE.md for
// the evaluation of alternatives (Tauri/WRY, CEF, NW.js, Qt WebEngine).
const { app, session } = require('electron');
const path = require('path');

const { ProfileStore } = require('./src/main/profile');
const { registerBrowser, findLaunchUrl } = require('./src/main/defaultbrowser');
const { createAi } = require('./src/main/ai');
const { createBrowser } = require('./src/main/browser');
const { createExtensionManager } = require('./src/main/extensions');
const { buildAppMenu } = require('./src/main/menu');
const { DexPermissions } = require('./src/main/permissions');
const { BRAND } = require('./src/main/branding');

app.setName(BRAND.name);
if (process.platform === 'win32') app.setAppUserModelId('com.dexerion.browser');

// Memory + process hygiene: fewer renderer processes, capped V8 heaps,
// and no background services Dexerion doesn't use. All are documented
// Chromium switches; sandboxing and site isolation stay intact.
// NOTE: no --in-process-gpu. It used to merge the GPU thread into the main
// process to save a process slot, but any compositor stall then starved the
// main message loop long enough for Windows to declare the app hung
// (AppHangB1, repeated; SharedImageManager errors in every boot log). A
// separate GPU process costs one slot and keeps GPU stalls off the UI thread.
app.commandLine.appendSwitch('renderer-process-limit', '6');
app.commandLine.appendSwitch('process-per-site');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');
app.commandLine.appendSwitch('disable-features',
  'TranslateUI,MediaRouter,DialMediaRouteProvider,OptimizationHints');

// The self-test creates accounts, writes history/bookmarks and calls
// profile.save(). Running it against the real userData directory meant every
// test run rewrote the user's own accounts.json (losing their accounts), so
// point it at a throwaway profile first — before ProfileStore resolves its dir.
if (process.argv.includes('--run-selftest')) {
  const os = require('os');
  const dir = path.join(os.tmpdir(), 'dexerion-selftest-' + process.pid);
  // PID reuse would otherwise hand this run the leftovers of a killed earlier
  // run (locks, GPU/disk caches, a half-written profile) — stale state that
  // surfaces as phantom selftest failures. Always start clean.
  try { require('fs').rmSync(dir, { recursive: true, force: true }); } catch {}
  app.setPath('userData', dir);
}
// Throwaway profile for visual/manual testing (and the documented
// --preview-skins workflow): isolates both the profile and the
// single-instance lock so a test window can run next to the real app.
{
  const udd = process.argv.find((a) => String(a).startsWith('--user-data-dir='));
  if (udd) app.setPath('userData', udd.slice('--user-data-dir='.length));
}

const profile = new ProfileStore();
// A process that did NOT get the single-instance lock never runs startup(), so
// its ProfileStore still holds pure defaults. Letting it flush on quit wrote
// those defaults — and an empty tabs list — straight over the real profile:
// that is what silently wiped "continue where you left off" (and the user's
// theme/accent/vertical-tabs) whenever Dexerion was launched a second time.
let profileLoaded = false;
let primaryInstance = true;
const permissions = new DexPermissions(profile);
const ai = createAi({ profile });
let browser = null;
let extensions = null;

async function startup(initialUrl) {
  await app.whenReady();
  // Default-browser registration (packaged builds only — in dev the exe
  // path would be the Electron dev binary). Best-effort, HKCU, no admin.
  if (app.isPackaged) {
    try { await registerBrowser(app.getPath('exe')); }
    catch (e) { console.warn('[dexerion] browser registration skipped:', e.message); }
  }
  profile.load();
  profileLoaded = true;
  try {
    const savedModel = profile.data.settings.aiModel;
    if (typeof savedModel === 'string' && savedModel.trim()) ai.setMode(savedModel);
  } catch {}

  // Shared Chromium session = the browser profile (cookies, cache, storage).
  const ses = session.defaultSession;
  ses.setUserAgent(ses.getUserAgent().replace(/Electron\/\S+ /, ''));

  extensions = createExtensionManager({ profile, session: ses });
  browser = createBrowser({ profile, extensions, permissions, sessionModule: require('electron'), ai });

  buildAppMenu({ browser, extensions, profile });
  browser.registerInternalProtocol();
  browser.syncTheme();
  await extensions.restore();
  // Design review: four chrome identities (?skin=…), one window each, tiled over
  // the work area on the same tab set. Launch this with --user-data-dir pointed
  // somewhere throwaway: nothing is restored and preview windows are excluded
  // from the saved session, so the real profile is never touched.
  if (process.argv.includes('--preview-skins') || process.argv.includes('--capture-skins')) {
    browser.openSkinPreview();
    if (process.argv.includes('--capture-skins')) {
      // Design review: write one PNG per skin, then quit. Used to check the
      // directions myself rather than trusting that the CSS did what it says.
      const dir = process.env.DEX_SKIN_DIR || path.join(require('os').tmpdir(), 'dex-skins');
      const shots = await browser.capturePreviewShots(dir);
      console.log('DEX_SKIN_SHOTS ' + JSON.stringify(shots));
      app.exit(shots.some(s => !String(s).startsWith('ERR')) ? 0 : 1);
      return;
    }
    return;
  }
  if (process.argv.includes('--run-selftest')) {
    await runSelfTest();
    return;
  }
  browser.setupDownloadHandling();
  // The daily welcome is handed to the first window's ready hook inside
  // restoreSessionOrNewTab (tabs exist only after the shell loads, so calling
  // it directly here would race the freshly planted newtab). A link/file
  // launch skips it — that destination was explicitly asked for.
  browser.restoreSessionOrNewTab({ noWelcome: Boolean(initialUrl) });
  // Boot memory report: one summed figure across every Dexerion process.
  // (workingSetSize/privateBytes are already KB in Electron's MemoryInfo; the
  // old `…KB` names never existed, which made this line print ~0 forever.)
  try {
    let kb = 0, n = 0;
    for (const m of app.getAppMetrics()) {
      n++;
      const mem = (m && m.memory) || {};
      kb += mem.workingSetSize || mem.privateBytes || 0;
    }
    console.log('[dexerion] memory at boot: ~' + Math.round(kb / 1024) + ' MB across ' + n + ' processes');
  } catch {}
  // Development aid (DEX_MEM_DEBUG=1): per-process memory every 30 s — the
  // total, the process count, and the five heaviest processes. Stdout only.
  if (process.env.DEX_MEM_DEBUG) {
    setInterval(() => {
      try {
        const rows = app.getAppMetrics().map((m) => ({
          type: m.type, name: m.name || m.serviceName || '',
          mb: Math.round(((m.memory && m.memory.workingSetSize) || 0) / 1024),
          cpu: Math.round((m.cpu && m.cpu.percentCPUUsage) || 0),
        }));
        const total = rows.reduce((a, r) => a + r.mb, 0);
        const top = [...rows].sort((a, b) => b.mb - a.mb).slice(0, 5);
        console.log('[dex-mem] total ' + total + 'MB procs=' + rows.length + ' top=' + JSON.stringify(top));
      } catch {}
    }, 30000).unref();
  }
  // Sweep restored tabs now that windows exist: a tab saved on the block page
  // returns to its site if work mode is no longer blocking it.
  try { browser.refreshPomodoro(); } catch {}
  // Opened with a link/file (default-browser invocation).
  if (initialUrl) browser.openExternalUrl(initialUrl);

  app.on('activate', () => {
    if (browser.windowCount() === 0) browser.newWindow();
  });
}

// Automated V1 verification: loads the MV3 fixture, checks background
// storage + content-script injection + tab navigation. Used by `npm test`
// style runs; writes dex-selftest.json into userData and stdout.
async function runSelfTest() {
  const fs = require('fs');
  const out = { t: {}, ok: false };
  try {
    const rec = await extensions.loadUnpacked(
      process.env.DEX_TEST_EXT || path.join(__dirname, '..', 'build', 'test-extensions', 'hello-mv3'));
    out.t.loadUnpacked = { ok: true, id: extensions.displayId(rec), name: rec.name };
    const extId = extensions.displayId(rec);
    // Developer-mode installs must match the web-install structure: the
    // browser owns a persistent copy under the profile Extensions dir (so it
    // survives restarts and gets a real Chromium id) while the developer's
    // folder is kept as the reload source.
    out.t.devInstallShape = {
      ok: Boolean(rec.path
        && rec.path.startsWith(path.join(profile.dir, 'Extensions'))
        && require('fs').existsSync(path.join(rec.path, 'manifest.json'))
        && typeof extId === 'string' && extId.length > 0
        && rec.sourceDir),
      path: rec.path, sourceDir: rec.sourceDir, id: extId,
    };
    const { BrowserWindow: BW } = require('electron');
    const w = new BW({ show: true, width: 900, height: 700 });
    await w.loadURL('https://example.com/');
    await new Promise((r) => {
      const iv = setInterval(async () => {
        try {
          const v = await w.webContents.executeJavaScript(
            "document.documentElement.getAttribute('data-dexerion-content')");
          if (v === 'injected') { clearInterval(iv); r(); }
        } catch {}
      }, 500);
      setTimeout(() => { clearInterval(iv); r(); }, 25000);
    });
    const injected = await w.webContents.executeJavaScript(
      "document.documentElement.getAttribute('data-dexerion-content')");
    const title = w.webContents.getTitle();
    out.t.navigation = { ok: /Example/.test(title), title };
    out.t.contentScript = { ok: injected === 'injected', injected };
    // background service worker storage check via extension page fetch
    out.t.extensionRecord = { ok: true, manifestVersion: rec.manifestVersion };
    await extensions.setEnabled(extId, false);
    out.t.disable = { ok: true };
    await extensions.setEnabled(extId, true);
    out.t.reenable = { ok: true, id: extId };
    const reloaded = await extensions.reload(extId);
    out.t.reload = { ok: true, id: reloaded.id };
    // NOTE: removal happens after the shell icon check below (needs it loaded).
    // Browser-level checks: real Dexerion window+tab. Drive navigation the
    // same way the new-tab search box does (invoke from inside the tab's
    // own renderer through the preload bridge).
    const wid = browser.newWindow(['dexerion://newtab']);
    const waitFor = (fn, ms) => new Promise((r) => {
      const iv = setInterval(() => { Promise.resolve().then(fn).then(v => { if (v) { clearInterval(iv); r(true); } }).catch(() => {}); }, 500);
      setTimeout(() => { clearInterval(iv); r(false); }, ms);
    });
    const gotBridge = await waitFor(async () => {
      const wc = browser.activeTabContents(wid);
      if (!wc) return false;
      try { return await wc.executeJavaScript("typeof window.dexerion === 'object'"); }
      catch { return false; }
    }, 20000);
    out.t.tabBridge = { ok: gotBridge };
    // Accounts: create, isolated sessions, per-account encrypted logins.
    try {
      const n0 = browser._accounts.listAccounts().length;
      const created = await browser._accounts.createAccount('Selftest', 'test@example.com');
      const aid = created.id;
      const okCreate = browser._accounts.listAccounts().length === n0 + 1 && aid !== 'default';
      const sDef = browser._accounts.sesFor('default');
      const sNew = browser._accounts.sesFor(aid);
      const okIsolated = sDef !== sNew;
      const L = browser._logins;
      const secret = L.encryptSecret('s3cr3t-pw');
      const okCrypto = L.decryptSecret(secret) === 's3cr3t-pw' && browser._accounts.accData('default').logins !== browser._accounts.accData(aid).logins;
      browser._accounts.accData(aid).logins.push({ origin: 'https://example.com', username: 'tester', secret, updatedAt: Date.now() });
      const mine = L.loginsFor(aid, 'https://example.com');
      const leaked = L.loginsFor('default', 'https://example.com').some(l => l.username === 'tester');
      const okStore = mine.length === 1 && mine[0].username === 'tester' && !leaked;
      // Google link: email stored, fresh partition reports signed-out.
      const meta = profile.data.accounts.find(a => a.id === aid);
      if (meta) meta.googleEmail = 'tester@gmail.com';
      const g = await browser._accounts.googleStatus(aid);
      const okGoogle = g && g.signedIn === false && g.email === 'tester@gmail.com';
      out.t.accounts = { ok: Boolean(okCreate && okIsolated && okCrypto && okStore && okGoogle), aid };
      // Cleanup test account (direct; exercises the same deletion path data).
      browser._accounts.accData('default'); // touch
      const { session: eses } = require('electron');
      try { await sNew.clearStorageData(); } catch {}
      const idx = profile.data.accounts.findIndex(a => a.id === aid);
      if (idx >= 0) profile.data.accounts.splice(idx, 1);
      try { require('fs').rmSync(profile.accountDir(aid), { recursive: true, force: true }); } catch {}
      void eses;
    } catch (err) { out.t.accounts = { ok: false, error: String(err && err.message || err) }; }
    // Extension popup renders real content (not a blank/refresh loop).
    try {
      const pop = browser.openExtensionPopup(null, extId);
      const popOk = pop ? await waitFor(async () => {
        try {
          const txt = await pop.webContents.executeJavaScript('document.body ? document.body.innerText : \'\'');
          return /Hello Dexerion/.test(txt || '');
        } catch { return false; }
      }, 15000) : false;
      out.t.extPopup = { ok: Boolean(popOk) };
      try { pop && pop.close(); } catch {}
    } catch { out.t.extPopup = { ok: false }; }
    // Shell reports its measured chrome height so content never slides
    // under the toolbar (regression: bookmark bar was overlapped).
    const gotChromeH = await waitFor(() => {
      const h = browser.chromeH(wid);
      return typeof h === 'number' && h >= 40 && h <= 600 ? h : false;
    }, 15000);
    out.t.chromeHeight = { ok: Boolean(gotChromeH), px: browser.chromeH(wid) };
    // Shell interaction regression: toolbar handlers must be bound and real DOM
    // clicks must actually work (star bookmarks the page, snip opens/dismisses).
    try {
      const sh = browser.shellContents(wid);
      const probe = await sh.executeJavaScript(`(() => {
        const q = (s) => document.querySelector(s);
        const on = (el) => !!el && typeof el.onclick === 'function';
        return {
          bookmark: on(q('#bookmark-btn')), snip: on(q('#snip-btn')),
          // Focus Timer is the pomodoro rail control now (the old #focus-btn/
          // #focus-banner were removed): expanded rail or collapsed mini rail.
          focus: on(q('#rt-toggle')) || on(q('#rm-start')),
          menu: on(q('#menu-btn')), newtab: on(q('#newtab-btn')),
          scrimHidden: q('#scrim') ? q('#scrim').hidden : true,
          dmenuHidden: q('#dmenu') ? q('#dmenu').hidden : true,
          focusRailHidden: q('#rail-timer') ? q('#rail-timer').hidden : true,
        };
      })()`);
      out.t.shellHandlers = {
        ok: Boolean(probe.bookmark && probe.snip && probe.focus && probe.menu
          && probe.newtab && probe.scrimHidden && probe.dmenuHidden),
        ...probe,
      };
      const urlOf = () => { try { return browser.activeTabContents(wid).getURL(); } catch { return ''; } };
      const bookmarkedCount = () => {
        try {
          const A = browser._accounts.accData('default');
          const r = (A.bookmarks && A.bookmarks.roots) || {};
          return ((r.bar || []).length) + ((r.other || []).length);
        } catch { return -1; }
      };
      await sh.executeJavaScript("window.dexerion.invoke('dex:navigate', null, 'https://example.com/')");
      await waitFor(() => /example\.com/.test(urlOf()), 30000);
      await sh.executeJavaScript("document.querySelector('#bookmark-btn').click()");
      const starred = await waitFor(() => bookmarkedCount() > 0, 8000);
      // The star flips before the write, so in-memory state cannot tell a saved
      // bookmark from one whose IPC threw (a saveA-style typo is invisible here).
      const onDisk = () => {
        try { return fs.readFileSync(path.join(profile.accountDir('default'), 'bookmarks.json'), 'utf8'); }
        catch { return ''; }
      };
      const persisted = await waitFor(() => onDisk().includes('example.com'), 4000);
      await sh.executeJavaScript("document.querySelector('#bookmark-btn').click()");
      const unstarred = await waitFor(() => bookmarkedCount() === 0, 8000);
      const removedOnDisk = await waitFor(() => !onDisk().includes('"https://example.com/"'), 4000);
      out.t.starButton = {
        ok: Boolean(starred && persisted && unstarred && removedOnDisk),
        starred, persisted, unstarred, removedOnDisk, bookmarks: bookmarkedCount(),
      };
      // New tab: bookmarks are listed with a remove control that unbookmarks them.
      await sh.executeJavaScript("window.dexerion.invoke('dex:navigate', null, 'https://example.com/nt-test')");
      await waitFor(() => /example\.com\/nt-test/.test(urlOf()), 30000);
      await sh.executeJavaScript("document.querySelector('#bookmark-btn').click()");
      const ntBookmarked = await waitFor(() => bookmarkedCount() > 0, 8000);
      await sh.executeJavaScript("window.dexerion.invoke('dex:navigate', null, 'dexerion://newtab')");
      await waitFor(() => /^dexerion:\/\/newtab/.test(urlOf()), 15000);
      const ntw = browser.activeTabContents(wid);
      const tileShown = await waitFor(async () => {
        try { const n = await ntw.executeJavaScript("document.querySelectorAll('#starred .tile').length"); return n > 0 ? n : false; } catch { return false; }
      }, 12000);
      const hasRemove = await ntw.executeJavaScript("!!document.querySelector('#starred .tile .x')").catch(() => false);
      await ntw.executeJavaScript("document.querySelector('#starred .tile .x').click()").catch(() => {});
      const tileGone = await waitFor(async () => {
        try { return (await ntw.executeJavaScript("document.querySelectorAll('#starred .tile').length")) === 0; } catch { return false; }
      }, 8000);
      const ntUnbookmarked = await waitFor(() => bookmarkedCount() === 0, 8000);
      out.t.newTabBookmarks = {
        ok: Boolean(ntBookmarked && tileShown && hasRemove && tileGone && ntUnbookmarked),
        ntBookmarked, tileShown, hasRemove, tileGone, ntUnbookmarked,
      };
      // Tab groups: the streak and rail take the GROUP's colour, and dragging
      // reorders (inside a group, between groups, or out of one) while keeping
      // every group a single contiguous run — never two chips for one group.
      try {
        const stateOf = () => sh.executeJavaScript("window.dexerion.invoke('dex:get-state')");
        const runCount = (st, gid) => {
          let runs = 0, prev = false;
          for (const t of st.tabs) { const inG = t.groupId === gid; if (inG && !prev) runs++; prev = inG; }
          return runs;
        };
        const drag = (id, target, where) => sh.executeJavaScript(
          "window.dexerion.invoke('dex:tab-drop', '" + id + "', " + (target ? "'" + target + "'" : 'null') + ", '" + where + "')");
        const gid1 = browser.newTab(wid, 'dexerion://newtab', true);
        const gid2 = browser.newTab(wid, 'dexerion://newtab', true);
        const gid3 = browser.newTab(wid, 'dexerion://newtab', true);

        await sh.executeJavaScript("window.dexerion.invoke('dex:reorder-tab', '" + gid2 + "', 0)");
        const stR = await stateOf();
        const reordered = Boolean(stR && stR.tabs[0] && stR.tabs[0].id === gid2);

        // Joining a group parks the tab with it (one contiguous run).
        await sh.executeJavaScript("window.dexerion.invoke('dex:tab-group', '" + gid2 + "', '" + gid1 + "')");
        const stG = await stateOf();
        const group = stG && stG.groups && stG.groups[0];
        const gid = group && group.id;
        const members = stG.tabs.filter(t => t.groupId === gid).map(t => t.id);
        const contiguousOnJoin = Boolean(gid) && members.length === 2 && runCount(stG, gid) === 1;

        // Reorder INSIDE the group: the two members swap and stay contiguous.
        await drag(members[1], members[0], 'before');
        const stW = await stateOf();
        const within = stW.tabs.filter(t => t.groupId === gid).map(t => t.id);
        const withinOk = runCount(stW, gid) === 1 && within[0] === members[1] && within[1] === members[0];

        // An ungrouped tab dropped inside the run snaps to an edge (no split).
        await drag(gid3, members[0], 'before');
        const stS = await stateOf();
        const snapOk = runCount(stS, gid) === 1 && !stS.tabs.find(t => t.id === gid3).groupId;

        // Centre-drop joins the group, parked adjacent to it.
        await drag(gid3, members[1], 'center');
        const stJ = await stateOf();
        const joinedOk = stJ.tabs.find(t => t.id === gid3).groupId === gid
          && runCount(stJ, gid) === 1
          && stJ.tabs.filter(t => t.groupId === gid).length === 3;

        // Empty-strip drop: the tab leaves the group and parks at the very end,
        // even when its group is already the last run on the strip.
        await drag(gid3, null, 'end');
        const stE = await stateOf();
        const stripOk = !stE.tabs.find(t => t.id === gid3).groupId
          && runCount(stE, gid) === 1
          && stE.tabs.filter(t => t.groupId === gid).length === 2
          && stE.tabs[stE.tabs.length - 1].id === gid3;

        // Re-join, then drag it out onto a tab outside the group: it leaves the
        // group there too, and the run stays contiguous.
        await drag(gid3, members[0], 'center');
        const stRJ = await stateOf();
        const regOk = stRJ.tabs.find(t => t.id === gid3).groupId === gid && runCount(stRJ, gid) === 1;
        const outsideTab = stRJ.tabs.find(t => t.groupId !== gid);
        await drag(gid3, outsideTab ? outsideTab.id : null, 'before');
        const stF = await stateOf();
        const outOk = !stF.tabs.find(t => t.id === gid3).groupId
          && runCount(stF, gid) === 1
          && stF.tabs.filter(t => t.groupId === gid).length === 2
          && (outsideTab ? stF.tabs[0].id === gid3 : true);

        // The streak and rail use the group colour, never the accent.
        await sh.executeJavaScript("window.dexerion.invoke('dex:activate-tab', '" + members[1] + "')");
        const cols = await sh.executeJavaScript(`(() => {
          const t = document.querySelector('.tab.grouped.active');
          if (!t) return null;
          return { streak: getComputedStyle(t, '::before').backgroundColor,
                   rail: getComputedStyle(t, '::after').backgroundColor };
        })()`);
        const accent = await sh.executeJavaScript("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()");
        const expected = 'rgb(139, 145, 171)';   // 'grey' — the first group colour
        const accentRgb = 'rgb(53, 196, 255)';
        const identityOk = Boolean(cols && group && group.color === 'grey'
          && cols.streak === expected && cols.rail === expected && cols.streak !== accentRgb);

        out.t.tabGroups = {
          ok: Boolean(reordered && contiguousOnJoin && withinOk && snapOk && joinedOk && stripOk && regOk && outOk && identityOk),
          reordered, contiguousOnJoin, withinOk, snapOk, joinedOk, stripOk, regOk, outOk, identityOk,
          groupColor: group && group.color, streak: cols && cols.streak, rail: cols && cols.rail, accent,
        };
        for (const id of [gid1, gid2, gid3]) await sh.executeJavaScript("window.dexerion.invoke('dex:close-tab', '" + id + "')");
      } catch (e) { out.t.tabGroups = { ok: false, error: String(e && e.message || e) }; }
      // Accent selection highlight: every page — a real site, a site with its own
      // ::selection, a subframe, and a dexerion:// page — selects in the user's
      // accent. `getComputedStyle(el, '::selection')` resolves the injected
      // user-origin sheet, so this reads the colour that would actually paint
      // instead of trusting that insertCSS was called.
      try {
        const os = require('os');
        const readSel = (c) => c.executeJavaScript(
          "(() => { try { return getComputedStyle(document.body, '::selection').backgroundColor } catch (e) { return 'ERR' } })()");
        const parseColor = (s) => {
          const nums = (String(s).match(/-?\d*\.?\d+/g) || []).map(Number);
          if (nums.length < 3) return null;
          const k = /^color\(/i.test(String(s)) ? 255 : 1; // color(srgb …) is 0..1
          return { r: Math.round(nums[0] * k), g: Math.round(nums[1] * k), b: Math.round(nums[2] * k), a: nums.length > 3 ? nums[3] : 1 };
        };
        const ACCENT_ALPHA = 0.45;
        const near = (s, hex) => {
          const c = parseColor(s);
          if (!c) return false;
          const n = parseInt(hex.slice(1), 16);
          return Math.abs(c.r - ((n >> 16) & 255)) <= 2 && Math.abs(c.g - ((n >> 8) & 255)) <= 2
            && Math.abs(c.b - (n & 255)) <= 2 && Math.abs(c.a - ACCENT_ALPHA) <= 0.02;
        };
        const accent0 = profile.data.settings.accent || '#35c4ff';
        const testAccent = '#ff2d78';
        profile.data.settings.accent = testAccent;
        browser.applySelectionAccentAll(); // the accent change re-applies to open tabs

        // A page with its own ::selection must still select in the accent.
        const tmp = path.join(os.tmpdir(), 'dex-sel-' + process.pid + '.html');
        fs.writeFileSync(tmp, '<!doctype html><body style="background:#fff">'
          + '<style>::selection{background:rgb(0,255,0)}</style><p id="p">select me</p>'
          + '<iframe id="f" srcdoc="<p id=\'q\'>frame text</p>"></iframe></body>');
        const webTab = browser.newTab(wid, 'file:///' + tmp.replace(/\\/g, '/'), false);
        const twc = browser.activeTabContents(wid);
        await waitFor(() => twc && /dex-sel-/.test(twc.getURL()), 8000);
        const pageRaw = await readSel(twc);
        const pageOk = near(pageRaw, testAccent);

        // Subframes, which webContents.insertCSS cannot reach.
        let frameRaw = '';
        let frameOk = false;
        try {
          const fr = twc.mainFrame.frames[0];
          frameRaw = await fr.executeJavaScript(
            "(() => { try { return getComputedStyle(document.body, '::selection').backgroundColor } catch (e) { return 'ERR' } })()");
          frameOk = near(frameRaw, testAccent);
        } catch (e) { frameRaw = 'ERR ' + (e && e.message); }

        // dexerion:// pages: the same colour, from either stylesheet.
        const intTab = browser.newTab(wid, 'dexerion://newtab', false);
        const iwc = browser.activeTabContents(wid);
        await waitFor(() => iwc && /newtab/.test(iwc.getURL()), 8000);
        const internalOk = near(await readSel(iwc), testAccent);

        // Restoring the accent must actually replace the sheet (not stack them).
        profile.data.settings.accent = accent0;
        browser.applySelectionAccentAll();
        await new Promise((r) => setTimeout(r, 500));
        const backRaw = await readSel(iwc);
        const backOk = near(backRaw, accent0);

        out.t.selectionAccent = {
          ok: Boolean(pageOk && frameOk && internalOk && backOk),
          pageOk, frameOk, internalOk, backOk, accent: testAccent, pageRaw, frameRaw, backRaw,
        };
        for (const id of [webTab, intTab]) await sh.executeJavaScript("window.dexerion.invoke('dex:close-tab', '" + id + "')");
        try { fs.unlinkSync(tmp); } catch {}
      } catch (e) { out.t.selectionAccent = { ok: false, error: String(e && e.message || e) }; }
      // Chrome skins (design review): each direction must load and actually give
      // its own chrome — not just a file that exists. Reads real computed style
      // out of each preview window's shell: strip metrics, tab geometry, the
      // resolved title font, and the badge proving ?skin= reached the renderer.
      try {
        const dirs = browser.skinDirections();
        const ids = browser.openSkinPreview();
        const probe = async (winId) => {
          const sh = browser.shellContents(winId);
          if (!sh) return null;
          return sh.executeJavaScript(`(() => {
            const cs = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el) : null; };
            const strip = cs('#tabstrip'), tool = cs('#toolbar'), tab = cs('.tab'), act = cs('.tab.active'), chip = cs('.gchip'), box = cs('#omnibox');
            return {
              loaded: Boolean(document.getElementById('dex-skin')),
              skin: document.documentElement.dataset.skin || '',
              theme: document.documentElement.dataset.theme || '',
              tabs: document.querySelectorAll('#tabs .tab').length,
              stripH: strip && strip.height, tabH: tab && tab.height, toolH: tool && tool.height,
              tabRadius: tab && tab.borderRadius, actBg: act && act.backgroundColor,
              font: (tab && tab.fontFamily || '').split(',')[0].replace(/["']/g, ''),
              chipRadius: chip && chip.borderRadius, omniRadius: box && box.borderRadius,
              tag: (document.getElementById('skin-tag') || {}).textContent || '',
            };
          })()`);
        };
        const rows = [];
        for (const id of ids) {
          let row = null;
          await waitFor(async () => { row = await probe(id); return Boolean(row && row.loaded && row.tabs >= 5); }, 20000);
          rows.push(row || { skin: 'timeout', loaded: false, tabs: 0 });
        }
        const got = Object.fromEntries(rows.map(r => [r.skin, r]));
        // Vertical-tabs-only product: #tabstrip is the full-height rail (stripH
        // tracks the window, ~486px), so landmarks assert the per-skin vertical
        // tab metrics from src/renderer/skins/*.css instead of horizontal heights.
        const landmark = {
          machined: (r) => r.tabH === '26px' && r.tabRadius === '3px' && r.font === 'Bahnschrift' && r.theme === 'dark',
          vellum: (r) => r.tabH === '30px' && r.tabRadius === '3px' && r.font === 'Constantia' && r.theme === 'light',
          halo: (r) => r.tabH === '32px' && r.tabRadius === '999px' && r.omniRadius === '999px' && r.font === 'Century Gothic' && r.theme === 'dark',
          riso: (r) => r.tabH === '30px' && r.tabRadius === '0px' && r.omniRadius === '0px' && r.chipRadius === '0px' && r.theme === 'light',
        };
        const fails = [];
        for (const d of dirs) {
          const r = got[d.skin];
          if (!r || !r.loaded) { fails.push(d.skin + ':not-loaded'); continue; }
          if (!landmark[d.skin](r)) fails.push(d.skin + ':' + JSON.stringify(r));
        }
        const shapes = new Set(rows.map(r => [r.stripH, r.tabRadius, r.omniRadius, r.font].join('|')));
        // Vertical tabs: the rail is the mode the user actually runs, and a skin
        // that out-specifies shell.css's body.vertical rules collapses it (a
        // 36px-tall "rail" with the tab list squeezed out of sight). Measure the
        // rail geometry for every direction with vertical tabs switched on.
        await sh.executeJavaScript("window.dexerion.invoke('dex:settings-save', { verticalTabs: true })");
        await new Promise(r => setTimeout(r, 800));
        const railRows = [];
        for (let ri = 0; ri < ids.length; ri++) {
          const id = ids[ri];
          const shc = browser.shellContents(id);
          // Rails start collapsed (48px), re-stow after 1s idle, and background
          // windows don't tick CSS transitions or rAF — so expandRail() never
          // lands and a bare measurement flips with cursor/focus timing in a
          // live session. Force the designed expanded state synchronously
          // (same stylesheets, animation off, forced reflow) and report it
          // through the shell's own reportChrome(), which re-lays-out the
          // main side. Resetting lastRailW guarantees the report is sent.
          const forcedW = await shc.executeJavaScript(`(() => {
            try {
              const el = document.querySelector('#tabstrip');
              if (!el || typeof reportChrome !== 'function') return -1;
              lastRailW = 0;
              el.style.transition = 'none';
              el.classList.remove('rail-collapsed');
              el.classList.add('rail-open');
              void el.offsetWidth;
              reportChrome();
              return Math.round(el.getBoundingClientRect().width);
            } catch { return -1; }
          })()`).catch(() => -1);
          if (forcedW !== 204) { railRows.push({ skin: '', vertical: false, forcedW }); continue; }
          const railSettled = await waitFor(async () => {
            try {
              const v = browser.tabBounds(id);
              return v && v.x === 204 ? true : false;
            } catch { return false; }
          }, 8000);
          if (!railSettled) { railRows.push({ skin: '', vertical: false, viewStuck: true }); continue; }
          const m = await shc.executeJavaScript(`(() => {
            const box = (sel) => { const el = document.querySelector(sel); const b = el && el.getBoundingClientRect(); return b ? { x: Math.round(b.x), w: Math.round(b.width), h: Math.round(b.height) } : null; };
            return {
              vertical: document.body.classList.contains('vertical'),
              strip: box('#tabstrip'), mid: box('#mid'),
              tab: box('#tabs .tab'), tabs: document.querySelectorAll('#tabs .tab').length,
            };
          })()`);
          railRows.push({ skin: '', ...m });
        }
        // Name them in the SKIN_DIRECTIONS order the windows were opened in.
        railRows.forEach((r, i) => { r.skin = (dirs[i] && dirs[i].skin) || r.skin; });
        const railFails = [];
        railRows.forEach((r, i) => {
          const view = browser.tabBounds(ids[i]);
          const shellRail = browser.railW(ids[i]);
          r.viewX = view ? view.x : null;
          r.reportedRail = shellRail;
          r.pageStartsAtRail = Boolean(view && r.strip && view.x === r.strip.w);
        });
        for (const r of railRows) {
          const bad = [];
          if (!r.vertical) bad.push('not-vertical');
          if (!r.strip || r.strip.w !== 204) bad.push('rail-width=' + (r.strip && r.strip.w));
          if (!r.strip || r.strip.h < 300) bad.push('rail-height=' + (r.strip && r.strip.h));
          if (!r.tab || r.tab.h < 22) bad.push('tab-height=' + (r.tab && r.tab.h));
          if (!r.tab || r.tab.w < 150) bad.push('tab-width=' + (r.tab && r.tab.w));
          if (r.tabs < 5) bad.push('tabs=' + r.tabs);
          // A hardcoded offset used to put the page 34px right of the rail.
          if (!r.pageStartsAtRail) bad.push('page-x=' + r.viewX + ' rail=' + (r.strip && r.strip.w));
          if (bad.length) railFails.push(r.skin + ' ' + bad.join(','));
        }
        await sh.executeJavaScript("window.dexerion.invoke('dex:settings-save', { verticalTabs: false })");
        // The Theme picker itself: clicking a tile in Settings must switch the
        // live chrome in place (the shell swaps its stylesheet, no reopen).
        let pickerOk = false;
        let picker = {};
        try {
          const settingsTab = browser.newTab(wid, 'dexerion://settings', false);
          const setWc = browser.activeTabContents(wid);
          await waitFor(() => setWc && /settings/.test(setWc.getURL()), 8000);
          const readSkin = () => sh.executeJavaScript("document.documentElement.dataset.skin || ''");
          const tiles = await setWc.executeJavaScript("Array.from(document.querySelectorAll('[data-skin-opt]')).map(o => o.dataset.skinOpt)");
          if (!tiles.length) {
            // Theme picker removed from Settings: nothing to click, and the
            // shipped look (no skin link) must be active.
            const before = await readSkin();
            const linkGone = await sh.executeJavaScript("!document.getElementById('dex-skin')");
            pickerOk = before === '' && linkGone;
            picker = { tiles: 0, removed: true, before, linkGone };
          } else {
            await waitFor(() => setWc.executeJavaScript("document.querySelectorAll('[data-skin-opt]').length >= 5").catch(() => false), 8000);
            const tiles2 = await setWc.executeJavaScript("Array.from(document.querySelectorAll('[data-skin-opt]')).map(o => o.dataset.skinOpt)");
            const before = await readSkin();
            await setWc.executeJavaScript("document.querySelector('[data-skin-opt=\"riso\"]').click()");
            const applied = await waitFor(async () => (await readSkin()) === 'riso', 6000);
            const href = await sh.executeJavaScript("(document.getElementById('dex-skin') || {}).href || ''");
            const strip = await sh.executeJavaScript("getComputedStyle(document.querySelector('#tabstrip')).height");
            await setWc.executeJavaScript("document.querySelector('[data-skin-opt=\"dexerion\"]').click()");
            const reverted = await waitFor(async () => (await readSkin()) === '', 6000);
            const linkGone = await sh.executeJavaScript("!document.getElementById('dex-skin')");
            pickerOk = tiles2.length === 5 && tiles2[0] === 'dexerion' && before === '' && applied
              && /riso\.css$/.test(href) && strip === '40px' && reverted && linkGone;
            picker = { tiles: tiles2.length, before, href, strip, applied, reverted, linkGone };
          }
          await sh.executeJavaScript("window.dexerion.invoke('dex:close-tab', '" + settingsTab + "')");
        } catch (e) { picker = { error: String(e && e.message || e) }; }
        out.t.skins = {
          ok: fails.length === 0 && shapes.size === dirs.length && railFails.length === 0 && pickerOk,
          distinct: shapes.size, fails,
          pickerOk, picker,
          railOk: railFails.length === 0, railFails,
          rail: railRows.map(r => ({ skin: r.skin, railW: r.strip && r.strip.w, railH: r.strip && r.strip.h, tabH: r.tab && r.tab.h, tabW: r.tab && r.tab.w, viewX: r.viewX, reportedRail: r.reportedRail })),
          rows: rows.map(r => ({ skin: r.skin, theme: r.theme, stripH: r.stripH, tabH: r.tabH, radius: r.tabRadius, font: r.font, chip: r.chipRadius, tag: r.tag })),
        };
        for (const id of ids) browser.closeWindow(id);
      } catch (e) { out.t.skins = { ok: false, error: String(e && e.message || e) }; }
      // Inspector: right-click → Inspect element must open Chromium's DevTools
      // inside Dexerion's own frame, dock where we ask, and close cleanly. The
      // menu is driven through the same builder the right-click uses, so this
      // covers the real wiring rather than a parallel code path.
      try {
        const os = require('os');
        const page = path.join(os.tmpdir(), 'dex-inspect-' + process.pid + '.html');
        fs.writeFileSync(page, '<!doctype html><body style="margin:0">'
          + '<h1 id="head">Alpha</h1><button id="btn" style="margin:40px;padding:24px">Bravo</button></body>');
        const tab = browser.newTab(wid, 'file:///' + page.replace(/\\/g, '/'), false);
        const pwc = browser.activeTabContents(wid);
        await waitFor(() => pwc && /dex-inspect-/.test(pwc.getURL()), 8000);
        await waitFor(() => pwc.executeJavaScript("!!document.getElementById('btn')").catch(() => false), 6000);
        // Live-compositor checks need a visible window: a minimized window
        // (off-screen placement, zero geometry) yields blank captures and
        // nonsense rects. Restore first; if it won't stay up, fail loudly as
        // external interference instead of cascading geometry mismatches.
        browser.focusWindow(wid);
        const unminimized = await waitFor(() => {
          try { const b = browser.tabBounds(wid); return b && b.width > 0 && b.height > 0 ? true : false; }
          catch { return false; }
        }, 8000);
        if (!unminimized) throw new Error('window minimized mid-test (external interference?) — rerun without touching the windows');
        const baseline = browser.tabBounds(wid);   // page geometry with no panel

        const menu = browser._test.contextMenu(wid, tab, { x: 60, y: 55, editFlags: {} });
        const labels = menu.items.filter(i => i.label).map(i => i.label);
        const idx = menu.items.findIndex(i => i.label === 'Inspect element');
        const item = idx >= 0 ? menu.items[idx] : null;
        menu.actions[item.actionIdx]();       // exactly what the click runs
        await waitFor(() => browser.inspectorState(wid).open, 8000);
        await waitFor(() => /^devtools:/.test(browser.inspectorState(wid).devToolsUrl), 10000);
        // The frontend painting the inspected page's DOM is the proof that it is
        // connected, not merely loaded.
        // Chromium's frontend is heavy and this suite runs it under load, so give
        // the Elements tree a generous window before calling it a failure.
        await waitFor(async () => (await browser._test.devToolsProbe(wid)).nodes > 0, 25000);
        await new Promise((r) => setTimeout(r, 700));   // let the state settle
        // The repaint kick bumps the surface +1px for 60ms and overlapping
        // kicks stack briefly: sample only once the bounds stop moving, so
        // the geometry check can't catch a bump mid-flight.
        let settledBounds = false;
        {
          let lastBounds = '';
          for (let i = 0; i < 15 && !settledBounds; i++) {
            let cur = '';
            try {
              const st8 = browser.inspectorState(wid);
              const b8 = st8 && st8.devToolsBounds;
              cur = b8 ? [b8.x, b8.y, b8.width, b8.height].join(',') : '';
            } catch { cur = ''; }
            if (cur && cur === lastBounds) settledBounds = true;
            else { lastBounds = cur; await new Promise((r) => setTimeout(r, 400)); }
          }
        }
        const opened = browser.inspectorState(wid);
        const shellIns = await sh.executeJavaScript(`(() => {
          const b = document.getElementById('inspector');
          const r = b.getBoundingClientRect();
          return { hidden: b.hidden, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
                   dock: document.body.classList.contains('ins-right') ? 'right' : 'bottom',
                   host: (document.getElementById('ins-host') || {}).textContent || '' };
        })()`);
        const pageBounds = browser.tabBounds(wid);
        const dtDom = await browser._test.devToolsProbe(wid);
        const shot = await browser._test.devToolsShot(wid, path.join(os.tmpdir(), 'dex-inspector-shot.png'));
        const shellInline = await sh.executeJavaScript(
          "(() => { const b = document.getElementById('inspector'); const cs = getComputedStyle(b);"
          + " return { left: b.style.left, top: b.style.top, width: b.style.width, position: cs.position, transform: cs.transform }; })()");
        const barShot = path.join(os.tmpdir(), 'dex-inspector-bar.png');
        // Whole shell surface: a 30px crop is too thin to review, and the capture
        // API refuses partial rects here. Best effort: a window that is not front
        // has no compositor surface to shoot, and stealing focus mid-test would
        // disturb the checks that follow.
        await sh.capturePage().then((img) => fs.writeFileSync(barShot, img.toPNG())).catch(() => {});

        // Pixel-exactness fails under display scaling (DIP rounding) and the
        // DevTools surface's own repaint nudge: heights get the same ±1px the
        // x/width checks already allow — except the surface height, where the
        // frontend's clustered navigations stack up to ~3 overlapping +1px
        // kicks (each did-finish-load re-kicks). Anything structural (empty
        // rectangle, wrong dock) is off by hundreds of px, so ±3 still guards
        // the framing contract.
        const bottomOk = opened.dock === 'bottom'
          && shellIns.dock === 'bottom'
          && Math.abs(shellIns.y - opened.rect.header.y) <= 1
          && Math.abs(shellIns.w - opened.rect.header.width) <= 1
          && Math.abs(shellIns.h - opened.rect.header.height) <= 1
          && Math.abs(opened.devToolsBounds.height - opened.rect.body.height) <= 3
          && Math.abs(pageBounds.height - opened.rect.page.height) <= 1
          && shellIns.host === 'dex-inspect-' + process.pid + '.html';

        browser.setInspectorDock(wid, 'right');
        await new Promise((r) => setTimeout(r, 400));
        const right = browser.inspectorState(wid);
        const shellRight = await sh.executeJavaScript(`(() => {
          const r = document.getElementById('inspector').getBoundingClientRect();
          return { x: Math.round(r.x), w: Math.round(r.width), dock: document.body.classList.contains('ins-right') ? 'right' : 'bottom' };
        })()`);
        const viewRight = browser.tabBounds(wid);
        const rightOk = right.dock === 'right' && shellRight.dock === 'right'
          && Math.abs(shellRight.x - right.rect.header.x) <= 1
          && Math.abs(shellRight.w - right.rect.header.width) <= 1
          && viewRight.width === right.rect.page.width;

        const closed = browser.closeInspector(wid);
        // A panel must never be an empty rectangle: when the frontend cannot come
        // up, Dexerion's own page takes the same surface, explains why, and can
        // retry into a working DevTools.
        let fallbackOk = false;
        let recoveryOk = false;
        let fallbackInfo = null;
        try {
          browser.openInspector(wid, tab, 60, 55, { failForTest: true, watchdogMs: 700 });
          const showed = await waitFor(() => browser.inspectorState(wid).fallback, 6000);
          // The panel page has to load before it can be read or photographed.
          await waitFor(() => /^dexerion:\/\/inspector/.test(browser.inspectorState(wid).surfaceUrl), 6000);
          await new Promise((r) => setTimeout(r, 400));
          const fs2 = browser.inspectorState(wid);
          const panel = browser.panelContents(wid);
          const dom = panel ? await panel.executeJavaScript(`(() => ({
            heading: (document.querySelector('h1') || {}).textContent || '',
            why: (document.getElementById('why') || {}).textContent || '',
            action: (document.getElementById('again') || {}).textContent || '',
            theme: document.documentElement.dataset.theme || '',
            painted: document.body ? document.body.getBoundingClientRect().height > 0 : false,
          }))()`).catch(() => null) : null;
          const shot2 = panel ? await panel.capturePage().then((i) => i.toPNG().length).catch(() => 0) : 0;
          fallbackOk = Boolean(showed && /^dexerion:\/\/inspector/.test(fs2.surfaceUrl) && dom
            && /did not start/i.test(dom.heading) && dom.action === 'Try again' && /nothing loaded|unexpected/.test(dom.why)
            && (dom.theme === 'light' || dom.theme === 'dark') && dom.painted && shot2 > 1000);
          fallbackInfo = { showed, surface: fs2.surfaceUrl.split('?')[0], reason: fs2.reason, dom, pngBytes: shot2 };
          // ...and the retry gets a real DevTools back.
          if (panel) await panel.executeJavaScript("document.getElementById('again').click()");
          recoveryOk = await waitFor(() => {
            const st = browser.inspectorState(wid);
            return st.open && !st.fallback && /^devtools:/.test(st.surfaceUrl);
          }, 12000);
          browser.closeInspector(wid);
          await new Promise((r) => setTimeout(r, 300));
        } catch (e) { fallbackInfo = { error: String(e && e.message || e) }; }
        // Their configuration: the inspector must work with vertical tabs too.
        let railInspectorOk = false;
        let railInspector = null;
        try {
          await sh.executeJavaScript("window.dexerion.invoke('dex:settings-save', { verticalTabs: true })");
          await new Promise((r) => setTimeout(r, 900));
          browser.openInspector(wid, tab, 60, 55);
          const live = await waitFor(() => browser.inspectorState(wid).open, 8000);
          // Content, not just the tab strip: a panel that paints its chrome with
          // empty panes is exactly the "blank inspector" that was reported.
          const t0 = Date.now();
          const painted = await waitFor(async () => {
            const p = await browser._test.devToolsProbe(wid);
            return p.tabs && p.nodes > 0;
          }, 12000);
          const contentMs = Date.now() - t0;
          const shot = await browser._test.devToolsShot(wid, path.join(os.tmpdir(), 'dex-inspector-rail.png'));
          const st = browser.inspectorState(wid);
          const shellRail = await sh.executeJavaScript(`(() => {
            const b = document.getElementById('inspector');
            const r = b.getBoundingClientRect();
            return { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height), hidden: b.hidden,
                     rail: parseInt(getComputedStyle(document.getElementById('tabstrip')).width, 10) };
          })()`);
          const view = browser.tabBounds(wid);
          // The dock is remembered per window, so assert against whichever edge
          // the panel is actually on rather than assuming the default.
          const dock = st.dock;
          const expBarX = dock === 'right' ? st.winBounds.width - st.rect.header.width : shellRail.rail;
          const expPageW = dock === 'right'
            ? st.winBounds.width - shellRail.rail - st.rect.header.width
            : st.winBounds.width - shellRail.rail;
          railInspectorOk = Boolean(live && !shellRail.hidden && shot.colours > 8 && st.rect.header
            && painted
            && shellRail.x === expBarX && st.rect.header.x === expBarX
            && view.x === shellRail.rail && view.width === st.rect.page.width
            && st.rect.page.width === expPageW);
          railInspector = { dock, painted, contentMs, rail: shellRail.rail, bar: { x: shellRail.x, w: shellRail.w, h: shellRail.h }, header: st.rect.header, view, colours: shot.colours, shot: shot.file };
          browser.closeInspector(wid);
          await sh.executeJavaScript("window.dexerion.invoke('dex:settings-save', { verticalTabs: false })");
          await new Promise((r) => setTimeout(r, 500));
        } catch (e) { railInspector = { error: String(e && e.message || e) }; }
        await new Promise((r) => setTimeout(r, 700));
        const after = browser.inspectorState(wid);
        const barGone = await sh.executeJavaScript("document.getElementById('inspector').hidden");
        const pageBack = browser.tabBounds(wid);
        const closeOk = closed && !after.open && !after.devToolsAlive && barGone
          && pageBack.width === baseline.width && pageBack.height === baseline.height;

        out.t.inspector = {
          ok: Boolean(labels.includes('Inspect element') && item && item.kbd === 'F12'
            && /^devtools:/.test(opened.devToolsUrl) && dtDom.tabs && /head|h1/i.test(dtDom.selected)
            && shot.colours > 8 && bottomOk && rightOk && closeOk
            && fallbackOk && recoveryOk && railInspectorOk && settledBounds),
          menuItem: item ? { label: item.label, kbd: item.kbd, icon: item.icon } : null,
          devToolsUrl: opened.devToolsUrl.split('?')[0], frontendTabs: dtDom.tabs, frontendTrees: dtDom.nodes,
          frontendSelected: dtDom.selected, paintedColours: shot.colours,
          bottomOk, rightOk, closeOk, settledBounds,
          closeDiag: { closed, open: after.open, alive: after.devToolsAlive, barGone, pageBack, baseline },
          fallbackOk, recoveryOk, railInspectorOk, fallbackInfo, railInspector,
          baseline, bottom: { dock: shellIns.dock, bar: { x: shellIns.x, y: shellIns.y, w: shellIns.w, h: shellIns.h }, header: opened.rect.header, body: opened.devToolsBounds, page: opened.rect.page, pageBounds, host: shellIns.host },
          right: { dock: shellRight.dock, barX: shellRight.x, headerX: right.rect.header.x, pageW: right.rect.page.width, viewW: viewRight.width },
          diag: { winBounds: opened.winBounds, shellInline, rightWinBounds: right.winBounds, shot: shot.file, bar: barShot },
        };
        await sh.executeJavaScript("window.dexerion.invoke('dex:close-tab', '" + tab + "')");
        try { fs.unlinkSync(page); } catch {}
      } catch (e) { out.t.inspector = { ok: false, error: String(e && e.message || e) }; }
      // New tab daylight: the clock and date must be real, the quote must be one
      // of the hundred and must not change during the day, the field must have a
      // light and a dark treatment, and the corner block must not collide with
      // the wordmark, the search field or the starred grid.
      try {
        const os = require('os');
        await sh.executeJavaScript("window.dexerion.invoke('dex:navigate', null, 'dexerion://newtab')");
        await waitFor(() => /^dexerion:\/\/newtab/.test(urlOf()), 15000);
        const nt = browser.activeTabContents(wid);
        await waitFor(async () => {
          try { return await nt.executeJavaScript("!!document.getElementById('daylight') && !!document.getElementById('quote').textContent"); }
          catch { return false; }
        }, 10000);
        const read = () => nt.executeJavaScript(`(() => {
          const day = document.getElementById('daylight');
          const box = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect();
            return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom) }; };
          const pool = getComputedStyle(document.querySelector('.sky .high'));
          return {
            clock: document.getElementById('clock').textContent,
            date: document.getElementById('date').textContent,
            quote: document.getElementById('quote').textContent,
            author: document.getElementById('author').textContent,
            phase: document.getElementById('sky').dataset.phase || '',
            pools: document.querySelectorAll('.sky .pool').length,
            poolAnim: pool.animationName,
            poolBg: pool.backgroundImage,
            daylight: box('.daylight'), mark: box('.mark'), cmd: box('#q'), starred: box('#starred'),
            quoteFits: (() => { const q = document.getElementById('quote'); return q.scrollHeight <= q.clientHeight + 1; })(),
            theme: document.documentElement.dataset.theme || '',
            quoteCount: (window.DEX_QUOTES || []).length,
            expectIndex: (() => {
              const d = new Date();
              const n = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
              const qs = window.DEX_QUOTES || [];
              return qs.length ? ((n % qs.length) + qs.length) % qs.length : -1;
            })(),
            expectQuote: (() => {
              const d = new Date();
              const n = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
              const qs = window.DEX_QUOTES || [];
              return qs.length ? '“' + qs[(((n % qs.length) + qs.length) % qs.length)].t + '”' : '';
            })(),
            expectTime: new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
            expectDate: new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }),
            hourPhase: (() => { const h = new Date().getHours(); return h < 5 ? 'night' : h < 8 ? 'dawn' : h < 17 ? 'day' : h < 21 ? 'dusk' : 'night'; })(),
          };
        })()`);
        // The profile default theme is dark, so the page may already be dark
        // here: pin each treatment explicitly instead of assuming light first.
        const setPageTheme = (t) => nt.executeJavaScript(
          "document.documentElement.dataset.theme = " + JSON.stringify(t)
          + "; new Promise((r) => setTimeout(r, 300)).then(() => document.documentElement.dataset.theme);");
        const initialTheme = await nt.executeJavaScript("document.documentElement.dataset.theme || ''").catch(() => '');
        await setPageTheme('light');
        const light = await read();
        const lightShot = await browser._test.pageShot(wid, path.join(os.tmpdir(), 'dex-daylight-light.png'));
        // Dark is the same page with the theme attribute flipped.
        await setPageTheme('dark');
        const dark = await nt.executeJavaScript(`(() => {
          const pool = getComputedStyle(document.querySelector('.sky .high'));
          return { poolBg: pool.backgroundImage, theme: document.documentElement.dataset.theme };
        })()`);
        const darkShot = await browser._test.pageShot(wid, path.join(os.tmpdir(), 'dex-daylight-dark.png'));
        await setPageTheme(initialTheme);
        const noOverlap = (a, b) => !a || !b || a.y >= b.b || b.y >= a.b || a.x >= b.x + b.w || b.x >= a.x + a.w;
        const clearOfMark = noOverlap(light.daylight, light.mark);
        const clearOfSearch = noOverlap(light.daylight, light.cmd);
        const clearOfStarred = noOverlap(light.daylight, light.starred);
        const quoteIsChosen = light.quote === light.expectQuote && light.quoteCount === 100;
        // Reading the clock: it ticks every fifteen seconds, and a background tab
        // has those ticks throttled by Chromium, so the check focuses the window
        // and then accepts a clock that is at most one minute behind (a tick
        // boundary can land between the last render and this assertion). The
        // format, the hour and the minute must all be right — a wrong timezone or
        // a 24/12-hour mix-up still fails.
        browser.focusWindow(wid);
        const clockProbe = await nt.executeJavaScript(`(() => {
          const mins = (s) => {
            const m = /^(\\d{1,2}):(\\d{2})\\s*([AaPp][Mm])?/.exec(String(s || '').trim());
            if (!m) return null;
            let h = +m[1]; const mm = +m[2]; const ap = (m[3] || '').toLowerCase();
            if (ap === 'pm' && h < 12) h += 12;
            if (ap === 'am' && h === 12) h = 0;
            return h * 60 + mm;
          };
          const shown = document.getElementById('clock').textContent;
          const want = new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
          const a = mins(shown), b = mins(want);
          const d = (a == null || b == null) ? null : Math.abs(a - b);
          return { shown, want, lag: d == null ? null : Math.min(d, 1440 - d) };
        })()`);
        const clockFmt = Boolean(/^\d{1,2}:\d{2}(\s?[APap][Mm])?$/.test(light.clock));
        const clockCaughtUp = clockProbe && clockProbe.lag !== null && clockProbe.lag <= 1;
        const clockIsReal = clockFmt && clockCaughtUp;
        const dateIsReal = light.date === light.expectDate && /[A-Za-z]/.test(light.date);
        const phaseMatches = light.phase === light.hourPhase;
        const motionOn = light.pools === 3 && /poolHigh/.test(light.poolAnim);
        const twoBackgrounds = Boolean(light.poolBg && dark.poolBg && light.poolBg !== dark.poolBg
          && /radial-gradient/.test(light.poolBg) && /radial-gradient/.test(dark.poolBg));
        out.t.newtabDaylight = {
          ok: Boolean(quoteIsChosen && clockIsReal && dateIsReal && phaseMatches && motionOn
            && twoBackgrounds && clearOfMark && clearOfSearch && clearOfStarred && light.quoteFits),
          quoteIsChosen, clockIsReal, dateIsReal, phaseMatches, motionOn, twoBackgrounds,
          clockFmt, clockCaughtUp, clockProbe,
          clearOfMark, clearOfSearch, clearOfStarred, quoteFits: light.quoteFits,
          clock: light.clock, date: light.date, phase: light.phase, author: light.author,
          quote: light.quote.slice(0, 72), lightShot, darkShot,
          rects: { daylight: light.daylight, mark: light.mark, cmd: light.cmd, starred: light.starred },
        };
      } catch (e) { out.t.newtabDaylight = { ok: false, error: String(e && e.message || e) }; }
      // Offline handling. Three things have to hold: a working connection is
      // NEVER redirected, a network failure waits (and recovers if the network
      // comes back), and a wait that runs out lands on the offline page. The
      // decision is a pure function so it can be checked exhaustively; the two
      // flows are driven with a target that cannot fail (a local file) and one
      // that cannot succeed (a closed port), so no real outage is needed.
      try {
        const os = require('os');
        const V = browser.offlineVerdict;
        const checks = {
          disconnectedIsOffline: V(-106, { isMainFrame: true, url: 'https://a.test/', online: false }) === 'offline',
          networkChangedIsOffline: V(-21, { isMainFrame: true, url: 'https://a.test/', online: false }) === 'offline',
          timeoutOfflineIsMaybe: V(-118, { isMainFrame: true, url: 'https://a.test/', online: false }) === 'maybe',
          // the negative cases matter more than the positive ones
          refusedWhileOnline: V(-102, { isMainFrame: true, url: 'https://a.test/', online: true }) === null,
          resetWhileOnline: V(-101, { isMainFrame: true, url: 'https://a.test/', online: true }) === null,
          certError: V(-200, { isMainFrame: true, url: 'https://a.test/', online: true }) === null,
          blockedByFocusGuard: V(-20 - 0, { isMainFrame: true, url: 'dexerion://blocked', online: false }) === null,
          internalPageNeverWaits: V(-106, { isMainFrame: true, url: 'dexerion://newtab', online: false }) === null,
          fileNeverWaits: V(-106, { isMainFrame: true, url: 'file:///tmp/x.html', online: false }) === null,
          subresourceNeverWaits: V(-106, { isMainFrame: false, url: 'https://a.test/x.js', online: false }) === null,
          noResolveWhileOnline: V(-105, { isMainFrame: true, url: 'https://nope.test/', online: true }) === null,
          noResolveWhileOffline: V(-105, { isMainFrame: true, url: 'https://nope.test/', online: false }) === 'maybe',
          http500NotOffline: V(-2, { isMainFrame: true, url: 'https://a.test/', online: true }) === null,
        };
        const verdictOk = Object.values(checks).every(Boolean);

        // A working load is left completely alone (local file: always reachable).
        const good = path.join(os.tmpdir(), 'dex-net-good-' + process.pid + '.html');
        fs.writeFileSync(good, '<!doctype html><title>good</title><h1>Reachable</h1>');
        const goodUrl = 'file:///' + good.replace(/\\/g, '/');
        const goodTab = browser.newTab(wid, goodUrl, false);
        const goodWc = browser.activeTabContents(wid);
        await waitFor(() => goodWc && goodWc.getURL() === goodUrl, 8000);
        await new Promise((r) => setTimeout(r, 600));
        const goodState = browser.netState(wid, goodTab);
        const untouchedOk = goodState.state === 'none' && goodWc.getURL() === goodUrl;

        // Recovery: the target is reachable, so the wait should end by itself
        // and open it, without ever reaching the offline page.
        const recTab = browser.newTab(wid, 'dexerion://newtab', false);
        const recWc = browser.activeTabContents(wid);
        await waitFor(() => recWc && /newtab/.test(recWc.getURL()), 8000);
        browser.startWaiting(wid, recTab, goodUrl, { graceMs: 9000 });
        const sawWaiting = await waitFor(() => /^dexerion:\/\/connecting/.test(browser.netState(wid, recTab).url), 6000);
        const recovered = await waitFor(() => browser.netState(wid, recTab).url === goodUrl, 9000);
        const recState = browser.netState(wid, recTab);
        const recoveryOk = Boolean(sawWaiting && recovered && recState.state === 'none');

        // Failure, then a real reconnection. The target is a local port that is
        // closed at first and opened mid-test, so auto-recovery is exercised for
        // real rather than simulated.
        const http = require('http');
        const port = 41400 + (process.pid % 400);
        const target = 'http://127.0.0.1:' + port + '/';
        const failTab = browser.newTab(wid, 'dexerion://newtab', false);
        const failWc = browser.activeTabContents(wid);
        await waitFor(() => failWc && /newtab/.test(failWc.getURL()), 8000);
        // The shipped defaults (ten seconds, the "n/10" the page counts) so the
        // count and the hand-off to the offline page are exercised as released.
        browser.startWaiting(wid, failTab, target);
        const sawWait2 = await waitFor(() => /^dexerion:\/\/connecting/.test(browser.netState(wid, failTab).url), 6000);
        // The count is only measurable once the page that shows it is up: on a
        // loaded machine an internal page can take seconds to arrive, and reading
        // before that finds nothing and blames the feature.
        for (let i = 0; i < 60; i++) {
          const u = await failWc.executeJavaScript('String(location.href)').catch(() => '');
          if (/^dexerion:\/\/connecting/.test(u)) break;
          await new Promise((r) => setTimeout(r, 200));
        }
        // Read the waiting page, and photograph it, while the wait is still
        // running: the loop below spends the whole wait watching it count.
        const waitDom = await failWc.executeJavaScript(`(() => ({
          bars: document.querySelectorAll('.bars i').length,
          barAnim: (() => { const b = document.querySelector('.bars i'); return b ? getComputedStyle(b).animationName : ''; })(),
          title: (document.getElementById('title') || {}).textContent || '',
          status: ((document.getElementById('status') || {}).textContent || '').trim(),
        }))()`).catch(() => null);
        const waitShot = await browser._test.pageShot(wid, path.join(os.tmpdir(), 'dex-waiting.png'));
        // Watch the count for the whole wait. Every step must land about a second
        // after the last, whatever a probe to a dead port costs: timing the loop
        // off the probe instead stretched each step to nearly two seconds.
        // Alongside it, an in-process watch of the wait's own clock: on a machine
        // this busy a page read costs seconds, and timing the hand-off from those
        // reads would measure the harness, not the feature.
        let ipReady = 0, ipOffline = 0;
        const ipWatch = setInterval(() => {
          const s = browser.netState(wid, failTab);
          if (!ipReady && s.startedAt) ipReady = s.startedAt;
          if (ipReady && !ipOffline && s.state === 'offline') ipOffline = Date.now();
        }, 120);
        const seq = [];
        const pollMs = [];
        const waitStart = Date.now();
        let handoutAt = 0;
        while (Date.now() - waitStart < 20000) {
          const p0 = Date.now();
          const seen = await failWc.executeJavaScript(`(() => ({
            url: String(location.href || ''),
            text: ((document.getElementById('status') || {}).textContent || '').trim(),
          }))()`).catch(() => null);
          pollMs.push(Date.now() - p0);
          if (!seen) break;
          if (/^dexerion:\/\/offline/.test(seen.url)) { handoutAt = Date.now(); break; }
          const m = /^Retrying (\d+)\/(\d+)$/.exec(seen.text);
          if (m) {
            const step = Number(m[1]);
            if (!seq.length || seq[seq.length - 1].n !== step) seq.push({ n: step, of: Number(m[2]), at: Date.now() });
          }
          await new Promise((r) => setTimeout(r, 150));
        }
        clearInterval(ipWatch);
        const ofCount = seq.length ? seq[0].of : 0;
        // The watch may join the count a second or two in (the screenshot above
        // costs time), so what is asserted is the rule: one a second, in order,
        // ending on the last number, with the hand-off one second after it.
        const stepsInOrder = seq.length > 1 && seq[seq.length - 1].n === ofCount
          && seq.every((s, i) => i === 0 || s.n === seq[i - 1].n + 1) && seq.every((s) => s.of === ofCount);
        const gaps = seq.slice(1).map((s, i) => (s.at - seq[i].at) / 1000);
        const perSecond = gaps.length > 0 && gaps.every((g) => g >= 0.45 && g <= 1.5);
        const handoffSecs = (handoutAt && seq.length) ? (handoutAt - seq[0].at) / 1000 : 0;
        const handoffInProc = (ipReady && ipOffline) ? (ipOffline - ipReady) / 1000 : 0;
        const handoffOk = Boolean(handoffInProc >= 8.5 && handoffInProc <= 14);
        // Cadence is only judged when the channel that watches it is fast enough
        // to see a one-second step; on a starved machine the reads themselves take
        // seconds, and a failure there would be the harness's, not the product's.
        const sortedPoll = pollMs.slice().sort((a, b) => a - b);
        const medianPollMs = sortedPoll.length ? sortedPoll[Math.floor(sortedPoll.length / 2)] : 9999;
        const cadenceTrusted = medianPollMs <= 400;
        const countingOk = Boolean(stepsInOrder && ofCount === 10 && seq.length >= 5 && handoffOk
          && (!cadenceTrusted || perSecond));
        const landed = await waitFor(() => /^dexerion:\/\/offline/.test(browser.netState(wid, failTab).url), 15000);
        const failDom = await failWc.executeJavaScript(`(() => ({
          heading: (document.querySelector('h1') || {}).textContent || '',
          host: (document.getElementById('host') || {}).textContent || '',
          action: (document.getElementById('retry') || {}).textContent || '',
          status: (document.getElementById('status') || {}).textContent || '',
          mark: !!document.querySelector('.mark'),
          globe: document.querySelectorAll('.mark .globe').length,
          slash: !!document.querySelector('.mark .slash'),
          // A sign, not a show: nothing inside it may be animating at all.
          markAnimated: Array.from(document.querySelectorAll('.mark, .mark *'))
            .filter((el) => getComputedStyle(el).animationName !== 'none').length,
          canvas: !!document.querySelector('.play canvas'),
          canvasPx: (() => { const c = document.querySelector('.play canvas'); return c ? c.width + 'x' + c.height : ''; })(),
          hint: (document.getElementById('hint') || {}).textContent || '',
          score: (document.getElementById('score') || {}).textContent || '',
          best: (document.getElementById('best') || {}).textContent || '',
        }))()`).catch(() => null);
        const offlineShot = await browser._test.pageShot(wid, path.join(os.tmpdir(), 'dex-offline.png'));

        // The game is played for real: keys through the browser, then the board
        // must have been redrawn and the hint must have answered.
        const board = () => failWc.executeJavaScript(
          `(() => { const c = document.querySelector('.play canvas'); return c ? c.toDataURL().slice(-48) : ''; })()`
        ).catch(() => '');
        const hintA = await failWc.executeJavaScript("document.getElementById('hint').textContent").catch(() => '');
        const boardA = await board();
        failWc.sendInputEvent({ type: 'keyDown', keyCode: 'Down' });
        failWc.sendInputEvent({ type: 'keyUp', keyCode: 'Down' });
        await new Promise((r) => setTimeout(r, 500));
        const boardB = await board();
        const hintB = await failWc.executeJavaScript("document.getElementById('hint').textContent").catch(() => '');
        try { failWc.focus(); } catch {}
        const pageFocused = await failWc.executeJavaScript('document.hasFocus()').catch(() => false);
        // Frames only arrive when the window is actually rendering, so ask the page
        // whether one does before judging whether the snake stepped.
        const rafAlive = await failWc.executeJavaScript(
          `new Promise((res) => { let hit = false; requestAnimationFrame(() => { hit = true; res(true); }); setTimeout(() => res(hit), 1500); })`
        ).catch(() => false);
        // Stepping needs the page to have the window's attention (deliberately:
        // a game left running while you read elsewhere would die on its own).
        // When the harness window cannot hold focus, or is not being rendered at
        // all, report that rather than pretending the steps were seen.
        let moved = null;
        if (pageFocused && rafAlive) {
          const before = await board();
          await new Promise((r) => setTimeout(r, 700));
          moved = before !== (await board());
        }
        const playOk = Boolean(failDom && failDom.mark && failDom.globe === 3 && failDom.slash
          && failDom.markAnimated === 0 && failDom.canvas
          && /press an arrow key/i.test(failDom.hint) && failDom.score === '0'
          && boardA && boardA !== boardB && /press an arrow key/i.test(hintA) && /arrow keys to move/i.test(hintB)
          && (moved === null ? true : moved));

        // The network comes back, and nobody clicks anything.
        let hits = 0;
        const server = http.createServer((req, res) => {
          hits += 1;
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end('<!doctype html><title>back</title><h1>Back online</h1>');
        });
        await new Promise((r) => server.listen(port, '127.0.0.1', r));
        // The green "connected" state is shown for under a second, so poll fast.
        const greenState = await (async () => {
          const t0 = Date.now();
          while (Date.now() - t0 < 15000) {
            try {
              const s = await failWc.executeJavaScript(`(() => ({
                title: (document.getElementById('title') || {}).textContent || '',
                status: (document.getElementById('status') || {}).textContent || '',
                done: !!(document.querySelector('.mark') && document.querySelector('.mark').classList.contains('done')),
                globeGreen: (() => { const g = document.querySelector('.mark .globe'); return g ? getComputedStyle(g).stroke : ''; })(),
              }))()`);
              if (s && s.done) {
                // Grab the success state now: it only lives for ~900ms before the
                // page it was waiting for opens.
                const shotNow = await browser._test.pageShot(wid, path.join(os.tmpdir(), 'dex-offline-green.png'));
                return Object.assign(s, { shot: shotNow });
              }
            } catch {}
            await new Promise((r) => setTimeout(r, 120));
          }
          return null;
        })();
        const autoRecovered = await waitFor(() => browser.netState(wid, failTab).url === target, 15000);
        const greenShot = await browser._test.pageShot(wid, path.join(os.tmpdir(), 'dex-offline-green.png'));
        // The tab holds a keep-alive connection, so close() alone would never
        // finish: drop the sockets, then stop listening without waiting.
        try { server.closeAllConnections?.(); } catch {}
        try { server.close(); } catch {}
        const recoveryAutoOk = Boolean(autoRecovered && greenState && /connected/i.test(greenState.title)
          && greenState.done && /Opening/.test(greenState.status) && hits > 0);

        // Try again after a failed wait must return to the WAITING page, not bounce
        // straight back here (that was a real bug: the retry spent the same budget).
        browser.startWaiting(wid, failTab, target, { graceMs: 1200 });
        await waitFor(() => /^dexerion:\/\/connecting/.test(browser.netState(wid, failTab).url), 6000);
        await waitFor(() => /^dexerion:\/\/offline/.test(browser.netState(wid, failTab).url), 15000);
        await failWc.executeJavaScript("document.getElementById('retry').click()").catch(() => {});
        const retried = await waitFor(() => /^dexerion:\/\/connecting/.test(browser.netState(wid, failTab).url), 8000);
        const retryStuck = retried ? await new Promise((r) => setTimeout(() => r(browser.netState(wid, failTab).url), 700)) : '';
        const retryOk = Boolean(retried && /^dexerion:\/\/connecting/.test(retryStuck));

        // The recovered state only lives for a beat, and capturePage samples after
        // the tab has already navigated, so the live moment cannot be photographed.
        // Render it deliberately instead: same page, same classes the recovered push
        // applies, then check it is literally the same green the live state showed.
        await new Promise((r) => { failWc.once('did-finish-load', r); failWc.loadURL('dexerion://offline?t=' + encodeURIComponent(target) + '&host=127.0.0.1').catch(() => r()); });
        await failWc.executeJavaScript(`(() => {
          const b = document.querySelector('.mark'); if (b) b.classList.add('done');
          const t = document.getElementById('title'); if (t) t.textContent = 'Connected';
          const s = document.getElementById('status'); if (s) { s.textContent = 'Opening the page you asked for'; s.classList.add('done'); }
        })()`).catch(() => {});
        await new Promise((r) => setTimeout(r, 400));
        // The strike and the status colour are transitioned, and a transition does
        // not advance in a window that is not being rendered (which is how the
        // suite runs), so their computed values would sit on their start values
        // forever. Read the cascade instead, with transitions off for the read.
        const readGreen = () => failWc.executeJavaScript(`(() => {
          const quiet = (el, prop) => {
            if (!el) return '';
            const prev = el.style.transition;
            el.style.transition = 'none';
            const v = getComputedStyle(el)[prop];
            el.style.transition = prev;
            return v;
          };
          const mark = document.querySelector('.mark');
          return {
            globe: quiet(document.querySelector('.mark .globe'), 'stroke'),
            slash: quiet(document.querySelector('.mark .slash'), 'opacity'),
            statusColor: quiet(document.getElementById('status'), 'color'),
            done: !!(mark && mark.classList.contains('done')),
            globeCount: document.querySelectorAll('.mark .globe').length,
          };
        })()`).catch(() => null);
        let greenRender = await readGreen();
        for (let i = 0; i < 15; i++) {
          if (greenRender && greenRender.done && greenRender.slash === '0' && greenRender.globe === greenRender.statusColor) break;
          await new Promise((r) => setTimeout(r, 200));
          greenRender = await readGreen();
        }
        const greenRenderShot = await browser._test.pageShot(wid, path.join(os.tmpdir(), 'dex-offline-connected.png'));
        const greenRenderOk = Boolean(greenRender && greenState && greenRender.done
          && greenRender.globeCount === 3 && greenRender.globe === greenState.globeGreen
          && greenRender.slash === '0' && greenRender.statusColor === greenRender.globe
          && greenRenderShot && !String(greenRenderShot).startsWith('ERR'));

        const offlineOk = Boolean(sawWait2 && countingOk && landed && failDom && playOk
          && waitDom && waitDom.bars === 4 && /barJump/.test(waitDom.barAnim)
          && /^Retrying 1\/10$/.test(waitDom.status || '')
          && /offline/i.test(failDom.heading) && failDom.host === '127.0.0.1'
          && failDom.action === 'Try again'
          && offlineShot && !String(offlineShot).startsWith('ERR')
          && recoveryAutoOk && retryOk && greenRenderOk);

        out.t.offlineFlow = {
          ok: Boolean(verdictOk && untouchedOk && recoveryOk && offlineOk),
          verdictOk, untouchedOk, recoveryOk, offlineOk, checks,
          untouched: { state: goodState.state, url: goodWc.getURL() === goodUrl ? 'target' : goodWc.getURL() },
          recovery: { sawWaiting, recovered, state: recState.state },
          offline: {
            sawWaiting: sawWait2, landed, dom: failDom, shot: offlineShot,
            countingOk, of: ofCount, counted: seq.map((s) => s.n), gaps, perSecond,
            cadenceTrusted, medianPollMs, handoffSecs, handoffInProc, handoffOk,
            playOk, pageFocused, rafAlive, boardChanged: boardA !== boardB, boardMoved: moved,
            waitDom, waitShot,
            recoveryAutoOk, greenState, hits, retryOk, retried, retryStuck, greenShot,
            greenRenderOk, greenRender, greenRenderShot,
          },
        };
        for (const id of [goodTab, recTab, failTab]) await sh.executeJavaScript("window.dexerion.invoke('dex:close-tab', '" + id + "')").catch(() => {});
        try { fs.unlinkSync(good); } catch {}
      } catch (e) { out.t.offlineFlow = { ok: false, error: String(e && e.message || e) }; }
      // AI sidebar: an image attaches by paste (or the upload button), shows as a
      // removable thumbnail above the composer, and renders in the message bubble.
      try {
        const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        const pollValue = async (fn, ms) => {
          const end = Date.now() + ms;
          for (;;) {
            const v = await Promise.resolve().then(fn).catch(() => null);
            if (v) return v;
            if (Date.now() > end) return null;
            await new Promise(r => setTimeout(r, 250));
          }
        };
        await sh.executeJavaScript("window.dexerion.invoke('dex:ai-sidebar', true)");
        await sh.executeJavaScript("document.querySelector('#ai-new').click()");
        // The old thread wrapper (#ai-conversation) was dropped in the scAI
        // sidebar rebuild; the active chat id now lives on its list row.
        const chatId = await pollValue(
          () => sh.executeJavaScript("(() => { const r = document.querySelector('#ai-chat-list .ai-chat-row.active') || document.querySelector('#ai-chat-list .ai-chat-row'); return (r && r.dataset && r.dataset.id) || ''; })()"),
          10000);
        const pasted = await sh.executeJavaScript(`(async () => {
          const blob = await (await fetch('${PNG}')).blob();
          const file = new File([blob], 'dot.png', { type: 'image/png' });
          const dt = new DataTransfer();
          dt.items.add(file);
          const ev = new Event('paste', { bubbles: true, cancelable: true });
          Object.defineProperty(ev, 'clipboardData', { value: dt });
          document.querySelector('#ai-input').dispatchEvent(ev);
          await new Promise(r => setTimeout(r, 700));
          const tray = document.querySelector('#ai-pending');
          return { hidden: tray.hidden, thumbs: tray.querySelectorAll('.ai-att img').length };
        })()`);
        const removed = await sh.executeJavaScript(`(async () => {
          const btn = document.querySelector('#ai-pending .ai-att > button');
          if (btn) btn.click();
          await new Promise(r => setTimeout(r, 150));
          const tray = document.querySelector('#ai-pending');
          return { hidden: tray.hidden, thumbs: tray.querySelectorAll('.ai-att img').length };
        })()`);
        let bubbled = 0;
        if (chatId) {
          await sh.executeJavaScript("window.dexerion.invoke('dex:ai-chat-append', { id: '" + chatId + "', message: { role: 'user', text: 'look', images: [{ name: 'dot.png', url: '" + PNG + "' }] } })");
          // The append only persists (ai-sidebar.js is IIFE-scoped, so its
          // reload is unreachable from here): re-open the chat through its
          // real list-row click handler — the same openChat + renderMessages
          // submit() performs — so the check sees what a user would see.
          await sh.executeJavaScript(
            "(() => { const rows = Array.from(document.querySelectorAll('#ai-chat-list .ai-chat-row')); const row = rows.find((r) => r.dataset.id === '" + chatId + "') || rows[0]; if (row) row.click(); return Boolean(row); })()").catch(() => false);
          bubbled = (await pollValue(
            () => sh.executeJavaScript("document.querySelectorAll('#ai-messages .ai-message-images img').length"),
            8000)) || 0;
        }
        out.t.aiImages = {
          ok: Boolean(chatId && pasted && pasted.thumbs === 1 && !pasted.hidden
            && removed && removed.thumbs === 0 && bubbled > 0),
          chatId: Boolean(chatId), pastedThumbs: pasted && pasted.thumbs,
          removedThumbs: removed && removed.thumbs, bubbled,
        };
        await sh.executeJavaScript("window.dexerion.invoke('dex:ai-sidebar', false)");
      } catch (e) { out.t.aiImages = { ok: false, error: String(e && e.message || e) }; }
      const beforeSnips = browser.snipCount();
      await sh.executeJavaScript("document.querySelector('#snip-btn').click()");
      const snipOpened = await waitFor(() => browser.snipCount() > beforeSnips, 15000);
      // The window existing proves nothing: an overlay whose document
      // never painted is invisible while still swallowing clicks. Require
      // paint — plus the frozen page frame (the opaque-window design shows
      // a capturePage() shot, never the live page, so a missing/empty
      // frame is the "beige veil" regression).
      let snipPainted = false, snipHref = '', snipErr = '';
      let snipProbe = null;
      const sw = browser.snipContents(wid);
      if (sw && !sw.isDestroyed()) {
        await waitFor(async () => {
          try {
            const r = await sw.executeJavaScript(
              "(() => { const f = document.querySelector('#frozen'); return { ready: document.readyState, stage: !!document.querySelector('#stage'), bar: !!document.querySelector('#bar'), href: location.href, title: document.title, body: (document.body ? document.body.innerText.slice(0,60) : null), frozen: !!(f && f.src && f.src.startsWith('data:image/')), frozenPx: (f && f.naturalWidth) || 0 }; })()");
            snipHref = r.href;
            snipProbe = r;
            if (r.ready === 'complete' && r.stage && r.bar && r.frozen && r.frozenPx > 100) { snipPainted = true; return true; }
          } catch (e) { snipErr = String(e && e.message || e); }
          return false;
        }, 15000);
      }
      browser.closeSnips();
      out.t.snipButton = {
        ok: Boolean(snipOpened && snipPainted && browser.snipCount() === 0),
        snipOpened, snipPainted, snipHref, snipProbe, snipErr: snipErr || undefined, closed: browser.snipCount() === 0,
      };
      // Put the tab back on the internal new-tab so the checks below that read
      // the internal page's design tokens still pass.
      await sh.executeJavaScript("window.dexerion.invoke('dex:navigate', null, 'dexerion://newtab')");
      await waitFor(() => /^dexerion:\/\/newtab/.test(urlOf()), 15000);
    } catch (e) { out.t.shellHandlers = { ok: false, error: String(e && e.message || e) }; }
    // Styled popup menus: open the suggest popup from the shell, verify a
    // glass popup window appears, then dismiss it.
    let suggestOk = false;
    let suggestDbg = {};
    try {
      // Seed so suggestions exist even on a fresh profile.
      profile.data.history.unshift({ url: 'https://example.com/', title: 'Example Domain', at: Date.now() });
      // The shell can still be booting here; without it every check in this
      // block is silently skipped and the suite reports a false failure.
      await waitFor(() => Boolean(browser.shellContents(wid)), 20000);
      const shell = browser.shellContents(wid);
      if (shell) {
        // Extension icon pipeline returns a real data URL, not a placeholder.
        try {
          const icon = await shell.executeJavaScript(
            `window.dexerion.invoke('dex:ext-icon','${extId}',48)`);
          out.t.extIcon = { ok: typeof icon === 'string' && icon.startsWith('data:image/png;base64,') };
        } catch { out.t.extIcon = { ok: false }; }
        // Edge-style sheet: first row searches the typed text, then matches.
        // Seed a per-account history entry so the "goto" row is deterministic —
        // suggestions read the sender account's own store, and the isolated test
        // profile has no browsing history. A different host keeps the
        // example.com navigation assertion below independent of this seed.
        try {
          const dA = browser._accounts.accData('default');
          dA.history.unshift({
            id: 'selftest-suggest', title: 'Example Org', url: 'https://example.org/', at: Date.now(),
          });
        } catch {}
        const rows = await shell.executeJavaScript("window.dexerion.invoke('dex:suggest-show','example')");
        const firstIsSearch = rows && rows[0] && rows[0].kind === 'search' && rows[0].label === 'example';
        const hasGoto = rows && rows.some(r => r.kind === 'goto');
        const capped = rows && rows.length <= 10;
        const appeared = await waitFor(() => browser.ctxCount() > 0, 8000);
        // The window opening is not enough — it must have PAINTED the rows. A
        // popup window whose document never parsed shows up as a transparent
        // always-on-top rectangle that eats clicks, and every count-based
        // assertion above still passes. Regression: ctxmenu.html lost its
        // </style>, so the whole body (panel + script) was parsed as CSS and
        // the sheet silently never appeared.
        let painted = [];
        try {
          const sw = browser.suggestContents(wid);
          if (sw) {
            // waitFor resolves to a boolean, so stash the labels as we probe.
            await waitFor(async () => {
              const n = await sw.executeJavaScript(
                "Array.from(document.querySelectorAll('#panel .item .tx')).map(e=>e.firstChild?e.firstChild.textContent:e.textContent)");
              if (!Array.isArray(n) || !n.length) return false;
              painted = n;
              return true;
            }, 8000);
          }
        } catch (err) { painted = []; void err; }
        const labels = (rows || []).map(r => r.label);
        const paintedAll = labels.length > 0 && labels.every(l => painted.includes(l));
        await shell.executeJavaScript("window.dexerion.invoke('dex:ctx-dismiss')");
        await waitFor(() => browser.ctxCount() === 0, 5000);
        const dismissed = browser.ctxCount() === 0;
        suggestOk = Boolean(firstIsSearch && hasGoto && capped && appeared && paintedAll) && dismissed;
        suggestDbg = { firstIsSearch, hasGoto, capped, appeared, paintedAll, dismissed, rows: (rows || []).length, painted };
      }
    } catch (err) { suggestDbg = { error: String(err && err.message || err) }; }
    out.t.suggestPopup = { ok: suggestOk, ...suggestDbg };
    // Renderer-path remove: invoke through the shell bridge exactly like the
    // extensions page's Remove button does (regression: button did nothing).
    let removeOk = false;
    try {
      await extensions.reload(extId); // ensure present + loaded first
      const shell2 = browser.shellContents(wid);
      await shell2.executeJavaScript(`window.dexerion.invoke('dex:ext-remove','${extId}')`);
      removeOk = !extensions.records().some(r => extensions.displayId(r) === extId);
    } catch (err) {
      out.t.removeError = String(err && err.message || err);
    }
    out.t.remove = { ok: removeOk };
    if (gotBridge) {
      const wc = browser.activeTabContents(wid);
      const themeApplied = await wc.executeJavaScript(
        "({ theme: document.documentElement.dataset.theme, pbg: getComputedStyle(document.documentElement).getPropertyValue('--pbg').trim() })");
      // Design tokens live in assets/tokens.css; the self-test pins them so an
      // accidental palette change cannot ship unnoticed. `--pbg` aliases the
      // ground colour (#f9f9f9 light / #171717 dark).
      out.t.pageTheme = {
        ok: themeApplied && ((themeApplied.theme === 'dark' && themeApplied.pbg === '#171717') ||
          (themeApplied.theme === 'light' && themeApplied.pbg === '#f9f9f9')),
        ...themeApplied,
      };
      await wc.executeJavaScript("window.dexerion.invoke('dex:navigate', null, 'https://example.com/')");
    }
    await waitFor(() => profile.data.history.some(h => h.url.includes('example.com')), 30000);
    const h = profile.data.history.find(x => x.url.includes('example.com'));
    out.t.tabNavigationHistory = { ok: Boolean(h), sample: h && h.url };
    profile.data.bookmarks.roots.bar.unshift(
      { id: 'selftest', title: 'Example', url: 'https://example.com/', at: Date.now() });
    out.t.bookmark = {
      ok: profile.data.bookmarks.roots.bar.some(b => b.url === 'https://example.com/'),
    };
    profile.data.bookmarks.roots.bar =
      profile.data.bookmarks.roots.bar.filter(b => b.id !== 'selftest');
    browser.persistAll();
    const sess = profile.data.tabs.windows;
    out.t.sessionPersist = { ok: Array.isArray(sess) && sess.length > 0 };
    // Dexerion AI: with no key configured, chat must fail cleanly and a junk
    // key must be rejected before any network call.
    try {
      const aist = ai.status();
      out.t.aiChat = {
        ok: aist.provider === 'NVIDIA NIM' && Array.isArray(aist.models),
        provider: aist.provider, hasKey: aist.hasKey, model: aist.model,
      };
      out.t.aiChatPersistence = { ok: Array.isArray(browser._accounts.accData('default').chats) };
    } catch (e) { out.t.aiChat = { ok: false, error: String(e && e.message || e) }; }
    // Focus Timer: start work with test-scale durations, verify session-level
    // blocking with the "get back to work" page, then expiry lifts it.
    try {
      const P = browser._pomodoro;
      // NOTE: `sh` from the shell-handlers block is out of scope this far
      // down — re-acquire the same window's shell contents (still alive).
      const sh = browser.shellContents(wid);
      await sh.executeJavaScript("window.dexerion.invoke('dex:pomo-configure', { blocklist: ['never-visit.test'] })");
      await sh.executeJavaScript("window.dexerion.invoke('dex:pomo-start', 'work', { workMs: 4000, breakMs: 3000 })");
      const shellWc = browser.shellContents(wid);
      const tabWc = () => browser.activeTabContents(wid);
      const nav = (u) => shellWc.executeJavaScript(
        'window.dexerion.invoke("dex:navigate", null, ' + JSON.stringify(u) + ')');
      const urlNow = () => { try { return tabWc().getURL(); } catch { return ''; } };
      const pomoNow = () => sh.executeJavaScript("window.dexerion.invoke('dex:pomo-state')").catch(() => ({}));
      const st0 = await pomoNow();
      await nav('https://never-visit.test/');
      const blockedOk = await waitFor(() => /^dexerion:\/\/blocked/.test(urlNow()), 30000);
      let blockText = '';
      try { blockText = await tabWc().executeJavaScript('document.body ? document.body.innerText : ""'); } catch {}
      const expired = await waitFor(async () => (await pomoNow()).phase === 'break', 15000);
      const unblockedOk = await waitFor(() => !/^dexerion:\/\/blocked/.test(urlNow()), 30000);
      await sh.executeJavaScript("window.dexerion.invoke('dex:pomo-reset')");
      await sh.executeJavaScript("window.dexerion.invoke('dex:pomo-configure', { blocklist: [] })");
      out.t.pomoTimer = {
        ok: Boolean(st0.phase === 'work' && st0.running && blockedOk && expired && unblockedOk
          && /get back to work/i.test(blockText || '')),
        started: st0.phase, running: st0.running, blockedOk, expired, unblockedOk,
        blockPagePainted: /get back to work/i.test(blockText || ''),
      };
      void P;
    } catch (e) { out.t.pomoTimer = { ok: false, error: String(e && e.message || e) }; }
    // Memory Saver: the meter is alive, and a forced over-cap sweep sleeps a
    // background tab (its whole renderer) while the active tab survives, then
    // waking it rebuilds the tab. Runs last: the sweep may also sleep idle
    // background tabs in other test windows, which nothing after this needs.
    try {
      const report = browser._test.memReport();
      const meterOk = Boolean(report && report.workingSetMB > 50);
      const mwid = browser.newWindow(['dexerion://newtab']);
      browser.newTab(mwid, 'dexerion://newtab', true);
      browser.newTab(mwid, 'dexerion://newtab', true);
      await waitFor(async () => {
        const s = await browser.shellContents(mwid).executeJavaScript("window.dexerion.invoke('dex:get-state')");
        return (s.tabs || []).length === 3;
      }, 15000);
      // Retry while the local newtab loads settle — loading tabs are immune.
      let swept = null;
      for (let i = 0; i < 4 && !(swept && swept.slept >= 1); i++) {
        if (i) await new Promise((r) => setTimeout(r, 1500));
        swept = browser._test.memorySweep(999999999, 0);
      }
      const st = await browser.shellContents(mwid).executeJavaScript("window.dexerion.invoke('dex:get-state')");
      const asleep = (st.tabs || []).filter(t => t.sleeping).length;
      const activeAwake = Boolean((st.tabs || []).find(t => t.id === st.active && !t.sleeping));
      const sleptTab = (st.tabs || []).find(t => t.sleeping);
      let wokeOk = false;
      if (sleptTab) {
        await browser.shellContents(mwid).executeJavaScript(
          "window.dexerion.invoke('dex:activate-tab', " + JSON.stringify(sleptTab.id) + ")");
        wokeOk = await waitFor(async () => {
          const s2 = await browser.shellContents(mwid).executeJavaScript("window.dexerion.invoke('dex:get-state')");
          return Boolean((s2.tabs || []).find(t => t.id === sleptTab.id && !t.sleeping));
        }, 15000);
      }
      out.t.memorySaver = {
        ok: Boolean(meterOk && swept && swept.slept >= 1 && asleep >= 1 && activeAwake && wokeOk),
        meterMB: report && report.workingSetMB, slept: swept && swept.slept,
        asleep, activeAwake, wokeOk,
      };
      browser.closeWindow(mwid);
    } catch (e) { out.t.memorySaver = { ok: false, error: String(e && e.message || e) }; }
    out.ok = Object.values(out.t).every(v => v.ok);
  } catch (e) {
    out.error = String(e && e.message || e);
  }
  console.log('DEX_SELFTEST ' + JSON.stringify(out));
  try {
    require('fs').writeFileSync(
      path.join(profile.dir, 'dex-selftest.json'), JSON.stringify(out, null, 2));
  } catch {}
  try { profile.save(); } catch {}
  // Allow pending extension-state writes to flush before exit.
  setTimeout(() => app.exit(out.ok ? 0 : 1), 800);
}

// Each window's own 'close' handler already persisted the full session while
// it was still registered. By the time these fire, the last window has been
// dropped from the browser's map, so persisting again would overwrite the
// saved session with an empty one — which is exactly what silently broke
// "continue where you left off" on every quit. Flush only while windows
// remain (a real quit with windows still open), and always save the rest.
function flushOnQuit() {
  // Never write from a process that never owned this profile: a lock loser has
  // only defaults in memory, and saving them is data loss.
  if (!primaryInstance || !profileLoaded) return;
  try { if (browser && browser.windowCount()) browser.persistAll(); } catch {}
  try { profile.save(); } catch {}
}

app.on('window-all-closed', () => {
  // Persist before quit; on macOS keep alive like Chrome, elsewhere quit.
  flushOnQuit();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', flushOnQuit);

// Single instance (a proper default browser routes second launches —
// e.g. clicked links — into the running window instead of a new process).
const launchUrl = findLaunchUrl(process.argv);
if (!app.requestSingleInstanceLock()) {
  primaryInstance = false;
  app.quit();
} else {
  app.on('second-instance', (e, argv) => {
    try {
      const u = findLaunchUrl(argv);
      if (u && browser) browser.openExternalUrl(u);
      else {
        const w = require('electron').BrowserWindow.getFocusedWindow();
        if (w) w.focus();
      }
    } catch {}
  });
  startup(launchUrl);
}

