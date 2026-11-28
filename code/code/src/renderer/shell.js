// Dexerion shell UI: tabstrip, omnibox, nav, bookmarks bar, ext toolbar, menu.
let S = null; // latest dex:state
let pendingStoreUrl = null;
const $ = (s) => document.querySelector(s);

// ---------- chrome themes ----------
// The chosen theme (Settings > Theme) arrives with the shell state and swaps
// src/renderer/skins/<name>.css in live, so picking one never reopens a window.
// 'dexerion' means no skin file at all: the shipped look is shell.css alone.
// `?skin=<name>` (used by the design-preview windows) overrides the state,
// pins the colour mode and adds a badge naming the file.
const SKIN_LABELS = { dexerion: 'Dexerion', machined: 'Machined', vellum: 'Vellum', halo: 'Halo', riso: 'Riso' };
const SKIN_QUERY = new URLSearchParams(location.search);
const SKIN = /^[a-z0-9-]+$/.test(SKIN_QUERY.get('skin') || '') ? SKIN_QUERY.get('skin') : '';
const SKIN_MODE = /^(light|dark)$/.test(SKIN_QUERY.get('mode') || '') ? SKIN_QUERY.get('mode') : '';
let activeSkin = null;
function applySkin(name) {
  const want = /^[a-z0-9-]+$/.test(name || '') && name !== 'dexerion' ? name : '';
  if (want === activeSkin) return;
  activeSkin = want;
  const link = document.getElementById('dex-skin');
  if (!want) {
    if (link) link.remove();
    delete document.documentElement.dataset.skin;
    return;
  }
  document.documentElement.dataset.skin = want;
  if (link) link.href = 'skins/' + want + '.css';
  else {
    const l = document.createElement('link');
    l.id = 'dex-skin'; l.rel = 'stylesheet'; l.href = 'skins/' + want + '.css';
    document.head.appendChild(l);
  }
}
if (SKIN) {
  applySkin(SKIN);
  document.title = 'Dexerion — ' + (SKIN_LABELS[SKIN] || SKIN);
  const tag = document.createElement('span');
  tag.id = 'skin-tag';
  tag.textContent = (SKIN_LABELS[SKIN] || SKIN) + ' · skins/' + SKIN + '.css' + (SKIN_MODE ? ' · ' + SKIN_MODE : '');
  $('#toolbar').appendChild(tag);
}

// Icon set. Real vector glyphs instead of unicode symbols — they stay crisp at
// any DPI, inherit currentColor, and keep the toolbar visually even.
const ICONS = {
  reload: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-1.6 6"/><path d="M20 4v7h-7"/></svg>',
  stop: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  lock: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7"/></svg>',
  dex: '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.6 21.4 12 12 21.4 2.6 12z"/></svg>',
  globe: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="8.2"/><path d="M3.8 12h16.4M12 3.8c2.1 2.3 3.2 5.1 3.2 8.2S14.1 17.9 12 20.2C9.9 17.9 8.8 15.1 8.8 12S9.9 6.1 12 3.8z"/></svg>',
  star: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 9.7l5.4-.8z"/></svg>',
  starOn: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"><path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 9.7l5.4-.8z"/></svg>',
  snip: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6.5" r="2.6"/><circle cx="6" cy="17.5" r="2.6"/><path d="M8.2 8.1 20 18M20 6 8.2 15.9"/></svg>',
  rec: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="6"/></svg>',
  ext: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M10 4.5a2 2 0 1 1 4 0V6h2.5a2 2 0 1 1 0 4H16v3.5a2 2 0 1 1-4 0V13H9.5a2 2 0 1 1 0-4H10z"/></svg>',
  x: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};
function setIcon(el, name) {
  if (!el || el._icon === name) return;
  el._icon = name;
  el.innerHTML = ICONS[name] || '';
}

async function refresh() {
  S = await window.dexerion.invoke('dex:get-state');
  if (S) render(S);
}

window.dexerion.on('dex:state', (s) => { S = s; render(s); });
window.dexerion.on('dex:store-detected', ({ url }) => {
  pendingStoreUrl = url;
  $('#store-banner').hidden = false;
});
window.dexerion.on('dex:menu', (action) => menuAction(action));
window.dexerion.on('dex:history-updated', () => {});
// Video fullscreen: the main process owns the window state; the shell only
// drops/restores its chrome (rail, toolbar/searchbar, bookmark bar, banners,
// AI sidebar) so the tab view covers every pixel while the flag is set.
window.dexerion.on('dex:html-fullscreen', (on) => {
  document.body.classList.toggle('html-fs', Boolean(on));
  if (!on) reportChrome();
});

function render(s) {
  // theme / accent / layout
  document.documentElement.dataset.theme = SKIN_MODE || (s.ui && s.ui.theme) || 'dark';
  // The accent is one signal colour. Without a saved choice it comes from the
  // design token (--dx-accent), never a hardcoded hex copy of it: the token is
  // the single source for the palette.
  const savedAccent = (s.ui && s.ui.accent) || '';
  const accent = savedAccent || getComputedStyle(document.documentElement).getPropertyValue('--dx-accent').trim() || '#35c4ff';
  document.documentElement.style.setProperty('--accent', accent);
  document.body.classList.add('vertical');
  // The design-preview query wins; otherwise follow the saved Theme setting.
  applySkin(SKIN || (s.ui && s.ui.skin) || '');
  updateTabRail(s);
  updateChromeRest(s);
  updateTimer(s);
  updateTasks(s);
  updateInspector(s);
  updateMemBar(s);
}

// Memory notice (Memory Saver): the current tab is over the budget. Allow and
// Close both report back to the main process; the bar hides as soon as the
// state says the notice is gone.
function updateMemBar(s) {
  const bar = document.getElementById('membar');
  if (!bar) return;
  const n = s && s.memNotice;
  if (!n) { if (!bar.hidden) bar.hidden = true; return; }
  const fmt = (mb) => (mb >= 1536 ? (mb / 1024).toFixed(1) + ' GB' : Math.round(mb) + ' MB');
  // Both figures: the tab alone is usually under the cap; the total is why
  // the notice exists. Comparing like-for-like keeps the sentence honest.
  document.getElementById('membar-tx').textContent =
    'This tab is the largest at ' + fmt(n.mb) + ' — Dexerion is using ' + fmt(n.total || n.mb) +
    ', over the ' + fmt(n.capMB) + ' memory budget.';
  bar.hidden = false;
}

// The inspector's header bar. Its rectangle comes from the main process (which
// laid the panel out), so the shell never guesses where the seam is.
function updateInspector(s) {
  const bar = document.getElementById('inspector');
  if (!bar) return;
  const ins = s.ui && s.ui.inspector;
  if (!ins) {
    if (!bar.hidden) bar.hidden = true;
    document.body.classList.remove('ins-right');
    return;
  }
  const h = ins.header || {};
  bar.hidden = false;
  document.body.classList.toggle('ins-right', ins.dock === 'right');
  bar.style.left = (h.x || 0) + 'px';
  bar.style.top = (h.y || 0) + 'px';
  bar.style.width = (h.width || 0) + 'px';
  bar.style.height = (h.height || 30) + 'px';
  const host = document.getElementById('ins-host');
  if (host && host.textContent !== (ins.host || '')) host.textContent = ins.host || '';
  const dock = document.getElementById('ins-dock');
  if (dock) dock.title = ins.dock === 'right' ? 'Dock to the bottom' : 'Dock to the right';
}

let lastTabKey = '', draggingTab = false;
let lastRailSelection = null;

function sameTabRailSelection(previous, next) {
  const priorTabs = previous.tabs, tabs = next.tabs;
  if (previous.active !== next.active || priorTabs.length !== tabs.length) return false;
  for (let i = 0; i < tabs.length; i++) {
    const a = priorTabs[i], b = tabs[i];
    if (a.id !== b.id || (a.title || '') !== (b.title || '') || (a.url || '') !== (b.url || '') ||
        !!a.loading !== !!b.loading || !!a.sleeping !== !!b.sleeping ||
        (a.favicon || '') !== (b.favicon || '') || (a.groupId || '') !== (b.groupId || '')) return false;
  }
  const priorGroups = previous.groups || [], groups = next.groups || [];
  if (priorGroups.length !== groups.length) return false;
  for (let i = 0; i < groups.length; i++) {
    const a = priorGroups[i], b = groups[i];
    if (a.id !== b.id || (a.name || '') !== (b.name || '') || a.color !== b.color) return false;
  }
  return true;
}

function updateTabRail(s) {
  // The bridge delivers fresh snapshots; shell code never mutates their tab
  // or group arrays. Skip the expensive fingerprint strings (including
  // favicon data URLs) only when all fields used in the old key match.
  if (draggingTab) return;
  if (lastTabKey && lastRailSelection && sameTabRailSelection(lastRailSelection, s)) {
    // Follow the live snapshot instead of retaining a second array copy.
    lastRailSelection.tabs = s.tabs;
    lastRailSelection.groups = s.groups;
    return;
  }
  lastRailSelection = { tabs: s.tabs, groups: s.groups, active: s.active };
  const key = s.tabs.map(t => t.id + '|' + (t.title || '') + '|' + (t.url || '') + '|' + (t.loading ? 1 : 0) + '|' + (t.sleeping ? 1 : 0) + '|' + (t.favicon || '') + '|' + (t.groupId || '')).join('~') + '@' + s.active + '#' + ((s.groups || []).map(g => g.id + '|' + (g.name || '') + '|' + g.color).join('~'));
  if (key !== lastTabKey) {
    lastTabKey = key;
    buildTabs(s);
  }
}

document.addEventListener('dragstart', (e) => { if (e.target.closest && e.target.closest('.tab')) draggingTab = true; });
document.addEventListener('dragend', () => { draggingTab = false; lastTabKey = ''; if (S) render(S); });
document.addEventListener('drop', () => { draggingTab = false; lastTabKey = ''; });

// Tab-group colors (names match the main-process GROUP_COLORS).
const G_COLORS = { grey: '#8b91ab', blue: '#35c4ff', red: '#ff6b6d', yellow: '#ffd75e', green: '#3ddc84', pink: '#ff6b9d', purple: '#8b7bff', cyan: '#4de3ff', orange: '#ffb020' };
const collapsedGroups = new Set();

function buildTabs(s) {
  const tabsEl = $('#tabs');
  // The + button lives inside the scroll region, directly under the last tab,
  // so hold it aside across the wipe and re-park it at the end.
  const plus = $('#newtab-btn');
  tabsEl.innerHTML = '';
  // Keep the rename/color editor open across re-renders unless its group died.
  if (geditFor && !(s.groups || []).some(g => g.id === geditFor)) closeGroupEditor();
  const groups = new Map((s.groups || []).map(g => [g.id, g]));
  for (const id of collapsedGroups) if (!groups.has(id)) collapsedGroups.delete(id);
  let lastG = null;
  s.tabs.forEach((t, i) => {
    const g = t.groupId ? groups.get(t.groupId) : null;
    if (g && g.id !== lastG) tabsEl.appendChild(groupChip(g, s));
    lastG = g ? g.id : null;
    if (g && collapsedGroups.has(g.id)) return;
    tabsEl.appendChild(tabEl(t, i, s, g));
  });
  if (plus) tabsEl.appendChild(plus);
}

function groupChip(g, s) {
  const count = s.tabs.filter(t => t.groupId === g.id).length;
  const collapsed = collapsedGroups.has(g.id);
  const d = document.createElement('div');
  d.className = 'gchip' + (collapsed ? ' collapsed' : '');
  d.style.setProperty('--gc', G_COLORS[g.color] || G_COLORS.grey);
  d.title = (g.name || 'Tab group') + ` (${count} tab${count === 1 ? '' : 's'}) — click to ${collapsed ? 'expand' : 'collapse'}, right-click for group options`;
  d.setAttribute('role', 'button');
  d.setAttribute('aria-expanded', String(!collapsed));
  d.tabIndex = 0;
  const state = document.createElement('span'); state.className = 'gstate'; state.textContent = collapsed ? '▸' : '▾';
  const dot = document.createElement('span'); dot.className = 'gdot';
  const nm = document.createElement('span'); nm.className = 'gnm'; nm.textContent = g.name || 'Group';
  const n = document.createElement('span'); n.className = 'gct'; n.textContent = count;
  d.append(state, dot, nm, n);
  const toggle = (e) => {
    e.preventDefault(); e.stopPropagation(); closeGroupEditor();
    if (collapsedGroups.has(g.id)) collapsedGroups.delete(g.id); else collapsedGroups.add(g.id);
    lastTabKey = '';
    if (S) render(S);
  };
  d.onclick = toggle;
  d.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') toggle(e); };
  d.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); openGroupEditor(g, d); };
  d.ondragover = (e) => {
    if (!e.dataTransfer.types.includes('text/tab')) return;
    e.preventDefault(); d.classList.add('drop');
  };
  d.ondragleave = () => d.classList.remove('drop');
  d.ondrop = (e) => {
    e.preventDefault(); d.classList.remove('drop');
    const id = e.dataTransfer.getData('text/tab');
    if (id) window.dexerion.invoke('dex:group-add', id, g.id);
  };
  return d;
}

function tabEl(t, i, s, g) {
    const d = document.createElement('div');
    d.className = 'tab' + (t.id === s.active ? ' active' : '') + (t.loading ? ' loading' : '') + (g ? ' grouped' : '') + (t.sleeping ? ' sleeping' : '');
    if (g) d.style.setProperty('--gc', G_COLORS[g.color] || G_COLORS.grey);
    d.draggable = true;
    const fav = document.createElement('span');
    fav.className = 'fav';
    // Chrome shows the known favicon during loads — the spinner is only a
    // stand-in until we actually have an icon.
    if (t.favicon) {
      const img = document.createElement('img');
      img.className = 'favimg'; img.src = t.favicon; img.draggable = false;
      img.onerror = () => { fav.innerHTML = ''; fav.appendChild(t.loading ? ringEl() : letterAvatar(t.url)); };
      fav.appendChild(img);
    } else if (t.loading) {
      fav.appendChild(ringEl());
    } else {
      fav.appendChild(letterAvatar(t.url));
    }
    const title = document.createElement('span');
    title.className = 't'; title.textContent = t.title || t.url || 'New Tab';
    const x = document.createElement('button');
    x.className = 'x'; x.title = 'Close tab';
    x.innerHTML = ICONS.x;
    const bar = document.createElement('span');
    bar.className = 'loadbar';
    d.append(fav, title, x, bar);
    if (t.sleeping) {
      const zzz = document.createElement('span');
      zzz.className = 'zzz';
      zzz.title = 'Sleeping — click to wake';
      zzz.textContent = 'zzz';
      d.appendChild(zzz);
    }
    d.title = t.url || '';
    d.onclick = (e) => { if (!e.target.classList.contains('x')) window.dexerion.invoke('dex:activate-tab', t.id); };
    d.querySelector('.x').onclick = () => window.dexerion.invoke('dex:close-tab', t.id);
    d.ondblclick = () => window.dexerion.invoke('dex:duplicate-tab', t.id);
    d.ondragstart = (e) => { e.dataTransfer.setData('text/tab', t.id); d.classList.add('dragging'); };
    d.ondragend = () => { d.classList.remove('dragging'); clearDropMarks(); };
    // Drop zones: the centre of a tab joins its group; the leading/trailing edge
    // reorders — left/right horizontally, up/down in the vertical rail. The
    // drop-before / drop-after classes paint the insertion indicator.
    d.ondragover = (e) => {
      if (!e.dataTransfer.types.includes('text/tab')) return;
      e.preventDefault();
      const r = d.getBoundingClientRect();
      const vertical = document.body.classList.contains('vertical');
      const pos = vertical ? e.clientY - r.top : e.clientX - r.left;
      const size = vertical ? r.height : r.width;
      const edge = pos < size * 0.25 ? -1 : (size - pos < size * 0.25 ? 1 : 0);
      d.classList.toggle('drop-group', edge === 0);
      d.classList.toggle('drop-before', edge === -1);
      d.classList.toggle('drop-after', edge === 1);
      d._edge = edge;
    };
    d.ondragleave = () => d.classList.remove('drop-group', 'drop-before', 'drop-after');
    d.ondrop = (e) => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/tab');
      d.classList.remove('drop-group', 'drop-before', 'drop-after');
      if (!id || id === t.id) return;
      const edge = d._edge || 0;
      const where = edge === 0 ? 'center' : (edge === -1 ? 'before' : 'after');
      // The main process owns the move: it keeps each group one contiguous run,
      // reorders inside a group, and ungroups a tab dragged out of its run.
      window.dexerion.invoke('dex:tab-drop', id, t.id, where);
    };
    return d;
}

function clearDropMarks() {
  document.querySelectorAll('#tabs .drop-group,#tabs .drop-before,#tabs .drop-after,#tabs .drop-left,#tabs .drop-right,#tabs .gchip.drop')
    .forEach(el => el.classList.remove('drop-group', 'drop-before', 'drop-after', 'drop-left', 'drop-right', 'drop'));
  tabsEl.classList.remove('drop-end');
}

// Group rename / recolor editor (floating panel anchored to the chip).
let geditFor = null;
function openGroupEditor(g, anchor) {
  closeGroupEditor();
  geditFor = g.id;
  const p = document.createElement('div');
  p.id = 'gedit';
  p.style.setProperty('--gc', G_COLORS[g.color] || G_COLORS.grey);
  p.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  const nm = document.createElement('input');
  nm.value = g.name || ''; nm.placeholder = 'Group name'; nm.maxLength = 40;
  const namePatch = () => {
    const v = nm.value.trim();
    return v !== (g.name || '') ? { name: v } : {};
  };
  const saveName = () => {
    const patch = namePatch();
    return Object.keys(patch).length ? window.dexerion.invoke('dex:group-set', g.id, patch) : Promise.resolve(true);
  };
  const commit = () => { saveName(); closeGroupEditor(); };
  nm.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') closeGroupEditor();
  });
  nm.addEventListener('blur', (e) => { if (!p.contains(e.relatedTarget)) commit(); });
  const sw = document.createElement('div'); sw.className = 'gsw';
  for (const name of Object.keys(G_COLORS)) {
    const b = document.createElement('button');
    b.className = 'gswb' + (name === g.color ? ' on' : '');
    b.style.background = G_COLORS[name]; b.title = name;
    b.onclick = async () => {
      const patch = namePatch(); patch.color = name;
      await window.dexerion.invoke('dex:group-set', g.id, patch);
      closeGroupEditor();
    };
    sw.appendChild(b);
  }
  const row = document.createElement('div'); row.className = 'grow';
  const un = document.createElement('button'); un.textContent = 'Ungroup';
  un.onclick = async () => {
    await saveName();
    const members = ((S && S.tabs) || []).filter(t => t.groupId === g.id);
    for (const m of members) await window.dexerion.invoke('dex:tab-ungroup', m.id).catch(() => {});
    closeGroupEditor();
  };
  const cl = document.createElement('button'); cl.textContent = 'Close group'; cl.classList.add('danger');
  cl.onclick = async () => {
    await saveName();
    await window.dexerion.invoke('dex:group-close', g.id).catch(() => {});
    closeGroupEditor();
  };
  row.append(un, cl);
  p.append(nm, sw, row);
  document.body.appendChild(p);
  const r = anchor.getBoundingClientRect();
  const pw = 248, ph = p.offsetHeight || 180;
  p.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pw - 8)) + 'px';
  p.style.top = ((r.bottom + 8 + ph < window.innerHeight) ? r.bottom + 8 : Math.max(8, r.top - ph - 8)) + 'px';
  setTimeout(() => { nm.focus(); nm.select(); }, 0);
  setTimeout(() => document.addEventListener('pointerdown', geditOutside, true), 0);
}
function geditOutside(e) {
  if (!document.getElementById('gedit')) return;
  if (e.target.closest && (e.target.closest('#gedit') || e.target.closest('.gchip'))) return;
  closeGroupEditor();
}
function closeGroupEditor() {
  geditFor = null;
  document.removeEventListener('pointerdown', geditOutside, true);
  const p = document.getElementById('gedit');
  if (p) p.remove();
}

function updateChromeRest(s) {
  const act = s.tabs.find(t => t.id === s.active);
  // Preview windows name their direction in the title bar, so four of them are
  // tellable apart in the taskbar (the active tab still follows the dot).
  document.title = SKIN
    ? 'Dexerion — ' + (SKIN_LABELS[SKIN] || SKIN) + (act ? ' · ' + act.title : '')
    : (act ? act.title + ' — ' : '') + 'Dexerion';
  // omnibox
  const omni = $('#omnibox');
  if (document.activeElement !== omni) omni.value = displayUrl(act ? act.url : '');
  // nav buttons
  document.querySelector('[data-nav=back]').disabled = !(act && act.canBack);
  document.querySelector('[data-nav=forward]').disabled = !(act && act.canForward);
  const rl = document.querySelector('[data-nav=reload]');
  const loading = Boolean(act && act.loading);
  if (rl.dataset.mode !== (loading ? 'stop' : 'reload')) {
    setIcon(rl, loading ? 'stop' : 'reload');
    rl.dataset.mode = loading ? 'stop' : 'reload';
    rl.title = loading ? 'Stop (Esc)' : 'Reload (Ctrl+R)';
  }
  // connection state: a closed lock only when the transport really is secure
  const lock = $('#lock');
  const secure = Boolean(act && act.url && act.url.startsWith('https'));
  const isDex = Boolean(act && act.url && act.url.startsWith('dexerion'));
  setIcon(lock, secure ? 'lock' : isDex ? 'dex' : 'globe');
  lock.classList.toggle('secure', secure);
  lock.title = secure ? 'Connection is secure' : isDex ? 'Dexerion internal page' : 'Not a secure connection';
  // account avatar
  const av = $('#account-av');
  const an = (s.account && s.account.name) || 'D';
  const initial = (an.trim()[0] || 'D').toUpperCase();
  if (s.account && s.account.avatar) {
    // show the picture, fall back to the initial if the file is missing
    if (av.dataset.src !== s.account.avatar) {
      av.dataset.src = s.account.avatar;
      av.innerHTML = '';
      const im = document.createElement('img');
      im.src = s.account.avatar; im.alt = ''; im.draggable = false;
      im.onerror = () => {
        av.dataset.src = ''; av.textContent = initial;
        av.style.background = `linear-gradient(150deg, ${(s.account && s.account.color) || '#35c4ff'}, var(--paper-ink))`;
      };
      av.appendChild(im);
    }
  } else if (av.dataset.src) {
    av.dataset.src = ''; av.textContent = initial;
    av.style.background = `linear-gradient(150deg, ${(s.account && s.account.color) || '#35c4ff'}, var(--paper-ink))`;
  } else {
    av.textContent = initial;
  }
  if (!s.account || !s.account.avatar) {
    av.style.background = `linear-gradient(150deg, ${(s.account && s.account.color) || '#35c4ff'}, var(--paper-ink))`;
  }
  $('#account-btn').title = `Signed in as ${an}${s.account && s.account.googleEmail ? ' (' + s.account.googleEmail + ')' : ''} — manage accounts`;
  const dacc = $('#dmenu-acc');
  if (dacc) dacc.textContent = `${an}${s.defaultAccountId === (s.account && s.account.id) ? ' (default)' : ''}`;
  updateBookmarkStar(act);
  updateBookmarksBar(s);
  updateExtensionsToolbar(s.extensions);
  reportChrome();
}

// Reconcile the toolbar by extension ID and occurrence. Unrelated state
// pushes need neither new controls nor repeat pending icon requests.
const toolbarExtensions = new Map();
function updateExtensionsToolbar(extensions) {
  if (!extensions.length && !toolbarExtensions.size) return;
  const bar = $('#extbar');
  if (!bar) return;
  const installed = new Map();
  for (const { id, enabled } of extensions) {
    installed.set(id, (installed.get(id) || 0) + (enabled ? 1 : 0));
  }

  // Remove old buttons before reordering survivors. Keep icons when an
  // extension is disabled. Broken records can share an empty display ID;
  // preserve their separate buttons and original ordering.
  for (const [id, entry] of toolbarExtensions) {
    const visible = installed.get(id);
    while (entry.buttons.length > (visible || 0)) entry.buttons.pop().remove();
    if (visible === undefined) toolbarExtensions.delete(id);
    else entry.nextSlot = 0;
  }

  let next = bar.firstElementChild;
  for (const { id, name, version, loadError, enabled } of extensions) {
    if (!enabled) continue;
    let entry = toolbarExtensions.get(id);
    if (!entry) {
      entry = { buttons: [], nextSlot: 0, icon: null, pending: false };
      toolbarExtensions.set(id, entry);
    }
    const slot = entry.nextSlot++;
    let btn = entry.buttons[slot];
    if (!btn) {
      btn = entry.buttons[slot] = document.createElement('button');
      btn.onclick = () => window.dexerion.invoke('dex:ext-popup', id);
      setExtBtnIcon(btn, entry.icon);
    }
    const title = `${name} ${version || ''}${loadError ? ' — error: ' + loadError : ''}`;
    if (btn.title !== title) btn.title = title;
    const hasError = Boolean(loadError);
    if (Boolean(btn._extError) !== hasError) {
      btn._extError = hasError;
      btn.classList.toggle('exterr', hasError);
    }
    if (btn !== next) {
      const focused = document.activeElement === btn;
      bar.insertBefore(btn, next);
      if (focused && document.activeElement !== btn) btn.focus({ preventScroll: true });
    }
    next = btn.nextElementSibling;

    if (entry.icon || entry.pending) continue;
    entry.pending = true;
    window.dexerion.invoke('dex:ext-icon', id).then(src => {
      // A late reply for a removed extension must not affect a reinstall of
      // the same ID. A merely disabled extension can keep the cached icon.
      if (toolbarExtensions.get(id) !== entry) return;
      entry.pending = false;
      entry.icon = src || 'fallback';
      for (const button of entry.buttons) setExtBtnIcon(button, entry.icon);
    }).catch(() => { entry.pending = false; }); // retry on the next update
  }
}

// Keep existing links when their visible labels and URLs have not changed.
// Navigation still follows the active tab from the latest chrome state.
let bookmarkBarRows = [];
let bookmarkBarActive;
function updateBookmarksBar(s) {
  const bar = $('#bookmarkbar');
  const items = (s.bookmarks && s.bookmarks.roots && s.bookmarks.roots.bar) || [];
  bookmarkBarActive = s.active;
  const display = (s.bookmarksBar && items.length) ? 'flex' : 'none';
  if (bar.style.display !== display) bar.style.display = display;
  if (items.length === bookmarkBarRows.length && items.every((b, i) =>
    b.url === bookmarkBarRows[i].url && (b.title || b.url) === bookmarkBarRows[i].label)) return;

  // No cap: the whole bar remains scrollable, including when it is re-shown.
  bookmarkBarRows = items.map(b => ({ url: b.url, label: b.title || b.url }));
  const links = document.createDocumentFragment();
  for (const { url, label } of bookmarkBarRows) {
    const a = document.createElement('a');
    a.textContent = label;
    a.title = url;
    a.onclick = () => window.dexerion.invoke('dex:navigate', bookmarkBarActive, url);
    links.appendChild(a);
  }
  bar.replaceChildren(links);
}

// Memoised chrome measurements. The calls earlier in the module run from state
// handlers, i.e. after module evaluation, so these are initialised by then.
let lastChromeH = 0;
let lastRailW = 0;
let pomoAC = null, pomoMaster = null, pomoNodes = [], pomoPlaying = '', lofiPlayer = null;
function pomoFmt(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
// Rail Focus Timer, rendered from dex:state.pomodoro (full) or the cheap
// dex:pomodoro tick. Ambient audio plays only when this window is the
// audible one, so two windows never double up.
function updateTimer(s) {
  const p = s && s.pomodoro;
  const running = Boolean(p && p.running);
  const phase = $('#rt-phase'), time = $('#rt-time'), fill = $('#rt-fill'), toggle = $('#rt-toggle');
  if (!phase || !p) return;
  phase.textContent = (p.phase === 'work' ? 'Work' : p.phase === 'break' ? 'Break' : 'Ready')
    + (!running && p.phase !== 'idle' ? ' · paused' : '');
  phase.classList.toggle('work', p.phase === 'work');
  time.textContent = pomoFmt(p.remainMs);
  const total = (p.phase === 'break' ? p.breakMin : p.workMin) * 60000;
  fill.style.width = total ? Math.min(100, Math.max(0, (1 - p.remainMs / total) * 100)) + '%' : '0%';
  if (toggle) toggle.textContent = running ? '⏸' : '▶';
  // Reflect server state without fighting the user's typing.
  const w = $('#rt-work'), b = $('#rt-break');
  if (w && document.activeElement !== w) w.value = p.workMin;
  if (b && document.activeElement !== b) b.value = p.breakMin;
  const snd = $('#rt-sound');
  if (snd && snd.value !== p.sound) snd.value = p.sound;
  const vol = $('#rt-vol');
  if (vol && document.activeElement !== vol) vol.value = p.volume;
  renderPomoSites(p);
  syncPomoAudio(p, Boolean(s && s.pomoAudio));
  updateRailMini(p, running);
}
// Collapsed-rail timer: idle shows only the start button; running shows the
// time remaining plus pause / skip / reset / sound stacked vertically. The
// full #rail-timer UI is untouched and shows when the rail is expanded.
function updateRailMini(p, running) {
  const start = $('#rm-start'), run = $('#rm-run');
  if (!start || !run || !p) return;
  const active = p.phase !== 'idle';
  start.hidden = active;
  run.hidden = !active;
  const t = $('#rm-time');
  if (t) t.textContent = pomoFmt(p.remainMs);
  const tg = $('#rm-toggle');
  if (tg) {
    tg.textContent = running ? '⏸' : '▶';
    tg.title = running ? 'Pause' : 'Start / resume';
  }
  const snd = $('#rm-sound');
  if (snd) {
    const off = p.sound === 'off';
    snd.textContent = off ? '🔇' : '♪';
    snd.title = off ? 'Unmute (restore White noise)' : 'Mute sound';
  }
}
let lastPomoSites = null;
function renderPomoSites(p) {
  const box = $('#rt-sites');
  if (!box) return;
  const list = (p && p.blocklist) || [];
  // The timer sends fresh state twice a second, but elapsed time does not
  // change which sites are listed. Keep the same controls (including focus)
  // until the ordered host set actually changes.
  if (lastPomoSites && lastPomoSites.length === list.length &&
      list.every((host, i) => host === lastPomoSites[i])) return;
  lastPomoSites = list.slice();
  box.replaceChildren();
  if (!list.length) {
    const d = document.createElement('div');
    d.className = 'rt-empty';
    d.textContent = 'Nothing blocked.';
    box.appendChild(d);
    return;
  }
  for (const h of list) {
    const row = document.createElement('div');
    row.className = 'rt-site';
    const tx = document.createElement('span');
    tx.textContent = h;
    tx.title = h;
    const x = document.createElement('button');
    x.type = 'button';
    x.title = 'Unblock';
    x.setAttribute('aria-label', 'Unblock ' + h);
    x.textContent = '×';
    x.onclick = () => window.dexerion.invoke('dex:pomo-block-remove', h).catch(() => {});
    row.append(tx, x);
    box.appendChild(row);
  }
}
function pomoEnsureAudio() {
  if (!pomoAC) {
    pomoAC = new (window.AudioContext || window.webkitAudioContext)();
    pomoMaster = pomoAC.createGain();
    pomoMaster.connect(pomoAC.destination);
  }
  if (pomoAC.state === 'suspended') pomoAC.resume().catch(() => {});
  return pomoAC;
}
function pomoStopSound() {
  for (const n of pomoNodes) { try { n.stop ? n.stop() : n.disconnect(); } catch {} }
  pomoNodes = [];
  if (lofiPlayer) { try { lofiPlayer.stop(); } catch {} lofiPlayer = null; }
  pomoPlaying = '';
}
// Fixed-loop lo-fi pieces (LOFI_SONGS + LofiPlayer from lofi-player.js /
// lofi-songs.js). Same start/stop/volume rules as the noise beds.
function pomoPlayLofi(kind, volume) {
  pomoStopSound();
  lofiPlayer = new LofiPlayer(LOFI_SONGS[kind]);
  lofiPlayer.play();
  if (lofiPlayer.master) lofiPlayer.master.gain.value = Math.pow(volume / 100, 2);
  pomoPlaying = kind + '@' + volume;
}
function pomoNoiseBuffer(brown) {
  const len = 2 * pomoAC.sampleRate;
  const buf = pomoAC.createBuffer(1, len, pomoAC.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    else d[i] = w * 0.5;
  }
  return buf;
}
function pomoPlaySound(kind, volume) {
  if (typeof LOFI_SONGS !== 'undefined' && LOFI_SONGS && LOFI_SONGS[kind]) {
    pomoPlayLofi(kind, volume);
    return;
  }
  const c = pomoEnsureAudio();
  pomoStopSound();
  pomoMaster.gain.value = Math.pow(volume / 100, 2);
  if (kind === 'pad') {
    [[110, 0], [164.81, 0.4], [220, 0.9]].forEach(([f, dt]) => {
      const o = c.createOscillator(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.value = 0.05;
      lfo.frequency.value = 0.07 + dt * 0.05; lg.gain.value = 0.03;
      lfo.connect(lg); lg.connect(g.gain);
      o.connect(g); g.connect(pomoMaster);
      o.start(c.currentTime + dt); lfo.start(c.currentTime + dt);
      pomoNodes.push(o, lfo);
    });
  } else {
    const src = c.createBufferSource();
    src.buffer = pomoNoiseBuffer(kind === 'brown');
    src.loop = true;
    const f = c.createBiquadFilter();
    if (kind === 'white') { f.type = 'highpass'; f.frequency.value = 400; }
    else if (kind === 'rain') { f.type = 'bandpass'; f.frequency.value = 2500; f.Q.value = 0.4; }
    else { f.type = 'lowpass'; f.frequency.value = 220; }
    const g = c.createGain();
    g.gain.value = kind === 'white' ? 0.5 : 0.9;
    src.connect(f); f.connect(g); g.connect(pomoMaster);
    src.start();
    pomoNodes.push(src);
  }
  pomoPlaying = kind + '@' + volume;
}
function syncPomoAudio(p, audible) {
  if (!p || !p.running || !audible || p.sound === 'off') {
    if (pomoNodes.length || lofiPlayer) pomoStopSound();
    return;
  }
  try {
    const key = p.sound + '@' + p.volume;
    if (key !== pomoPlaying) pomoPlaySound(p.sound, p.volume);
    else if (lofiPlayer && lofiPlayer.master) lofiPlayer.master.gain.value = Math.pow(p.volume / 100, 2);
    else if (pomoMaster) pomoMaster.gain.value = Math.pow(p.volume / 100, 2);
  } catch {}
}

function reportChrome() {
  // Measure the real chrome so tab content never slides underneath it.
  const vertical = document.body.classList.contains('vertical');
  const tb = document.querySelector('#toolbar');
  const bb = document.getElementById('bookmarkbar');
  const sb = document.getElementById('store-banner');
  const lb = document.getElementById('loginbar');
  const mbar = document.getElementById('membar');
  const ts = document.getElementById('tabstrip');
  const extra = (!sb.hidden ? sb.offsetHeight + 12 : 0) + (!lb.hidden ? lb.offsetHeight + 12 : 0)
    + (!mbar || mbar.hidden ? 0 : mbar.offsetHeight + 12);
  const h = tb.offsetHeight + (bb.style.display === 'none' ? 0 : bb.offsetHeight) + extra;
  if (h >= 40 && h <= 600 && h !== lastChromeH) {
    lastChromeH = h;
    document.documentElement.style.setProperty('--chrome-h', h + 'px');
    window.dexerion.invoke('dex:chrome-h', h).catch(() => {});
  }
  // The rail's width too: the page must start exactly where the rail ends, and
  // only the shell knows how wide its own rail came out (a skin may change it).
  const rw = vertical ? Math.round(ts.getBoundingClientRect().width) : 0;
  if (rw >= 40 && rw <= 640 && rw !== lastRailW) {
    lastRailW = rw;
    document.documentElement.style.setProperty('--rail-w', rw + 'px');
    window.dexerion.invoke('dex:rail-w', rw).catch(() => {});
  }
}

function setExtBtnIcon(btn, src) {
  btn._icon = null;
  btn.innerHTML = '';
  if (src && src !== 'fallback') {
    const img = document.createElement('img');
    img.src = src; img.draggable = false;
    img.onerror = () => { btn._icon = null; setIcon(btn, 'ext'); };
    btn.appendChild(img);
  } else {
    setIcon(btn, 'ext');
  }
}

function ringEl() {
  const r = document.createElement('span');
  r.className = 'ring';
  return r;
}

function letterAvatar(url) {
  const s = document.createElement('span');
  s.className = 'lat';
  let host = '', h = 0;
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
  if (!url || url.startsWith('dexerion://')) { s.textContent = '◆'; s.style.setProperty('--h', 200); return s; }
  for (const c of host) h = (h * 31 + c.charCodeAt(0)) % 360;
  s.textContent = (host[0] || '○').toUpperCase();
  s.style.setProperty('--h', h);
  return s;
}

function displayUrl(u) {
  if (!u) return '';
  if (u === 'dexerion://newtab') return '';
  return u;
}

// Local mirror of the bookmarked URLs, so the star can be painted synchronously
// (no IPC on the render path) and flips the instant it is clicked.
function isBookmarked(url) {
  const roots = S && S.bookmarks && S.bookmarks.roots;
  if (roots) for (const k of Object.keys(roots)) {
    for (const b of (roots[k] || [])) if (b.url === url) return true;
  }
  return false;
}
function updateBookmarkStar(act) {
  const btn = $('#bookmark-btn');
  const url = act && act.url && /^https?:\/\//i.test(act.url) ? act.url : '';
  if (!url) {
    setIcon(btn, 'star'); btn.classList.remove('bookmarked'); btn.classList.add('disabled');
    btn.title = 'Internal page — not bookmarkable';
    return;
  }
  btn.classList.remove('disabled');
  const marked = isBookmarked(url);
  setIcon(btn, marked ? 'starOn' : 'star');
  btn.classList.toggle('bookmarked', marked);
  btn.title = marked ? 'Remove this bookmark' : 'Bookmark this page';
}

// omnibox
const omni = $('#omnibox');
// omnibox + Edge-style suggest sheet (arrow keys + Enter)
let sugItems = [], sugIdx = 0;
function sugNavigate(item) {
  if (!item) return window.dexerion.invoke('dex:navigate', S && S.active, omni.value);
  if (item.kind === 'goto' && item.url) return window.dexerion.invoke('dex:navigate', S && S.active, item.url);
  return window.dexerion.invoke('dex:navigate', S && S.active, item.phrase || item.label);
}
omni.addEventListener('keydown', async (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!sugItems.length) return;
    e.preventDefault();
    sugIdx = (sugIdx + (e.key === 'ArrowDown' ? 1 : -1) + sugItems.length) % sugItems.length;
    window.dexerion.invoke('dex:suggest-select', sugIdx).catch(() => {});
  } else if (e.key === 'Enter') {
    // Kill the debounce first: without this the sheet can pop open AFTER
    // navigation from a stale keystroke and sit there forever.
    clearTimeout(suggestT);
    const item = sugItems.length ? await window.dexerion.invoke('dex:suggest-pick', sugIdx).catch(() => null) : null;
    sugItems = []; sugIdx = 0;
    window.dexerion.invoke('dex:ctx-dismiss').catch(() => {});
    await sugNavigate(item);
  } else if (e.key === 'Escape') { sugItems = []; omni.blur(); window.dexerion.invoke('dex:ctx-dismiss').catch(() => {}); }
});
let suggestT = null;
// Debounced suggestion cache: avoids redundant API calls for repeated queries.
const suggestCache = new Map();
const SUGGEST_CACHE_MAX = 50;
// Dismiss on blur: when OS focus moves to the web content (a separate native
// view) document.activeElement can still report the omnibox, so guarding on it
// left the sheet stuck on screen.
//
// The delay is load-bearing, not cosmetic. Pressing a suggestion moves focus
// to the popup, so blur fires on mousedown — dismissing synchronously would
// destroy the popup before mouseup, and the click (and its navigation) would
// never be delivered. Wait out a normal click's mousedown->mouseup span; the
// popup's own click handler closes it, and a click into the page just leaves a
// ~200ms lag before the sheet clears.
const SUGGEST_DISMISS_MS = 200;
let suggestDismissT = null;
omni.addEventListener('blur', () => {
  sugItems = [];
  clearTimeout(suggestDismissT);
  suggestDismissT = setTimeout(() => {
    window.dexerion.invoke('dex:ctx-dismiss').catch(() => {});
  }, SUGGEST_DISMISS_MS);
});
omni.addEventListener('input', () => {
  clearTimeout(suggestT);
  suggestT = setTimeout(async () => {
    const q = omni.value;
    if (!q.trim()) { sugItems = []; return; }
    try {
      // Anchor the sheet under the omnibox: the main process parks the popup
      // window on this rect (shell coords already match window-content coords).
      const r = omni.getBoundingClientRect();
      const anchor = { x: Math.round(r.left), y: Math.round(r.bottom + 6), width: Math.round(r.width) };
      sugItems = await window.dexerion.invoke('dex:suggest-show', q, { anchor }) || [];
      sugIdx = 0;
    } catch { sugItems = []; }
  }, 120);
});

// nav + chrome buttons
document.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => {
  const mode = b.dataset.mode;
  if (b.dataset.nav === 'reload' && mode === 'stop') return window.dexerion.invoke('dex:nav', S.active, 'stop');
  window.dexerion.invoke('dex:nav', S.active, b.dataset.nav);
});
$('#newtab-btn').onclick = () => window.dexerion.invoke('dex:new-tab', 'dexerion://newtab', false);
// inspector header: the dock glyph toggles the panel between the bottom edge and
// the right edge; both states are laid out by the main process.
$('#ins-dock').onclick = () => {
  const right = document.body.classList.contains('ins-right');
  window.dexerion.invoke('dex:inspector-dock', right ? 'bottom' : 'right').catch(() => {});
};
$('#ins-close').onclick = () => window.dexerion.invoke('dex:inspector-close').catch(() => {});
$('#tabstrip').ondblclick = (e) => { if (e.target.closest('#tabs') && !e.target.closest('.tab') && !e.target.closest('.gchip') && !e.target.closest('#newtab-btn')) window.dexerion.invoke('dex:new-tab', 'dexerion://newtab', false); };
// Dropping on the empty strip (past the last tab, or below the rail in vertical
// mode) parks the tab at the end and takes it out of its group — that is how a
// tab is dragged out of a group. Tabs and chips handle their own drops.
$('#tabstrip').ondragover = (e) => {
  if (e.target.closest('.tab') || e.target.closest('.gchip')) return;
  if (!e.dataTransfer.types.includes('text/tab')) return;
  e.preventDefault();
  tabsEl.classList.add('drop-end');
};
$('#tabstrip').ondragleave = (e) => { if (!e.relatedTarget || !e.relatedTarget.closest('#tabstrip')) tabsEl.classList.remove('drop-end'); };
$('#tabstrip').ondrop = (e) => {
  if (e.target.closest('.tab') || e.target.closest('.gchip')) return;
  e.preventDefault();
  tabsEl.classList.remove('drop-end');
  const id = e.dataTransfer.getData('text/tab');
  if (id) window.dexerion.invoke('dex:tab-drop', id, null, 'end');
};
$('#bookmark-btn').onclick = toggleBookmark;
function toggleBookmark() {
  if (!S) return;
  const act = S.tabs.find(t => t.id === S.active);
  if (!act || !act.url) return;
  // Internal / non-web pages aren't bookmarkable — never silently store them.
  if (!/^https?:\/\//i.test(act.url)) return;
  const url = act.url;
  const btn = $('#bookmark-btn');
  const nowMarked = !(isBookmarked(url) || btn.classList.contains('bookmarked'));
  // Flip the star immediately; persist in the background. Nothing on the click
  // path awaits, so there is no perceptible delay.
  setIcon(btn, nowMarked ? 'starOn' : 'star');
  btn.classList.toggle('bookmarked', nowMarked);
  btn.title = nowMarked ? 'Remove this bookmark' : 'Bookmark this page';
  if (S.bookmarks && S.bookmarks.roots) {
    if (nowMarked) {
      S.bookmarks.roots.other.unshift({ id: 'tmp' + Date.now(), title: act.title, url, at: Date.now() });
    } else {
      for (const k of Object.keys(S.bookmarks.roots)) {
        S.bookmarks.roots[k] = (S.bookmarks.roots[k] || []).filter(b => b.url !== url);
      }
    }
  }
  (nowMarked
    // The tab's favicon (page-favicon-updated) travels along so main can
    // inline the site icon onto the bookmark record for the start page grid.
    ? window.dexerion.invoke('dex:bookmark-add', { title: act.title, url, favicon: act.favicon })
    : window.dexerion.invoke('dex:bookmark-remove', url)
  ).catch(() => {});
}
let menuOpen = false;
async function openMenu() {
  if (menuOpen) return closeMenu();
  // Set the state and paint the overlay FIRST. The native tab view is a child
  // window that can cover HTML, so main must hide it — but a rejected or slow
  // IPC must never leave the user staring at an invisible menu.
  menuOpen = true;
  document.querySelectorAll('#dmenu .mitem').forEach((b, i) => { b.style.animationDelay = (i * 18) + 'ms'; });
  const scrim = $('#scrim');
  const m = $('#dmenu');
  scrim.hidden = false;
  m.hidden = false;
  m.classList.remove('show'); void m.offsetWidth; m.classList.add('show');
  $('#menu-btn').classList.add('open');
  try {
    await window.dexerion.invoke('dex:menu-open');
  } catch (err) {
    // Best effort: the HTML overlay is fully usable without the native hide.
    console.warn('dex:menu-open was unavailable:', err && (err.message || err));
  }
  // A second click while the IPC was in flight closes the menu; do not let the
  // resolved promise resurrect the "open" button state.
  if (!menuOpen) $('#menu-btn').classList.remove('open');
}
function closeMenu() {
  if (!menuOpen) return;
  menuOpen = false;
  $('#scrim').hidden = true;
  const m = $('#dmenu');
  m.hidden = true;
  m.classList.remove('show');
  document.querySelectorAll('#dmenu .mitem').forEach((b) => { b.style.animationDelay = ''; });
  $('#menu-btn').classList.remove('open');
  window.dexerion.invoke('dex:menu-close').catch(() => {});
}
$('#menu-btn').onclick = openMenu;
// Snip tool (screenshot: area / full page + window video). The overlay is an
// in-window view over the tab content; the button just opens/focuses it
// (during a recording it brings back the Stop strip).
$('#snip-btn').onclick = () => window.dexerion.invoke('dex:snip-open').catch(() => {});
window.dexerion.on('dex:snip-active', ({ open, recording } = {}) => {
  const b = $('#snip-btn');
  if (!b) return;
  b.classList.toggle('live', Boolean(open));
  b.classList.toggle('rec', Boolean(recording));
  setIcon(b, recording ? 'rec' : 'snip');
  b.title = recording ? 'Recording — click to show Snip controls' : 'Screenshot / record (Ctrl+Shift+S)';
});
$('#ai-btn').onclick = () => window.dexerion.invoke('dex:ai-toggle').catch(() => {});
$('#account-btn').onclick = () => window.dexerion.invoke('dex:navigate', S && S.active, 'dexerion://accounts');
// Rail timer controls → pomodoro IPC. Number/select inputs commit on change
// (and Enter), so half-typed values never reconfigure mid-keystroke.
window.dexerion.on('dex:pomodoro', (p) => {
  if (!S) S = {};
  S.pomodoro = p;
  if (typeof p.audible === 'boolean') S.pomoAudio = p.audible;
  updateTimer(S);
});
$('#rt-toggle').onclick = () => window.dexerion.invoke('dex:pomo-toggle').catch(() => {});
$('#rt-skip').onclick = () => window.dexerion.invoke('dex:pomo-skip').catch(() => {});
$('#rt-reset').onclick = () => window.dexerion.invoke('dex:pomo-reset').catch(() => {});
function pomoCommitTimes() {
  const w = Math.floor(Number($('#rt-work').value));
  const b = Math.floor(Number($('#rt-break').value));
  const patch = {};
  if (Number.isFinite(w)) patch.workMin = w;
  if (Number.isFinite(b)) patch.breakMin = b;
  window.dexerion.invoke('dex:pomo-configure', patch).catch(() => {});
}
$('#rt-work').addEventListener('change', pomoCommitTimes);
$('#rt-break').addEventListener('change', pomoCommitTimes);
$('#rt-sound').addEventListener('change', (e) => window.dexerion.invoke('dex:pomo-configure', { sound: e.target.value }).catch(() => {}));
$('#rt-vol').addEventListener('change', (e) => window.dexerion.invoke('dex:pomo-configure', { volume: Math.floor(Number(e.target.value)) }).catch(() => {}));
function pomoAddSite() {
  const el = $('#rt-site');
  const v = el.value.trim();
  if (!v) return;
  el.value = '';
  window.dexerion.invoke('dex:pomo-block-add', v).catch(() => {});
}
$('#rt-site-add').onclick = pomoAddSite;
$('#rt-site').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); pomoAddSite(); } });
// Collapsed-rail timer controls reuse the same pomodoro IPC as the full UI.
$('#rm-start').onclick = () => window.dexerion.invoke('dex:pomo-toggle').catch(() => {});
$('#rm-toggle').onclick = () => window.dexerion.invoke('dex:pomo-toggle').catch(() => {});
$('#rm-skip').onclick = () => window.dexerion.invoke('dex:pomo-skip').catch(() => {});
$('#rm-reset').onclick = () => window.dexerion.invoke('dex:pomo-reset').catch(() => {});
$('#rm-sound').onclick = () => {
  const cur = S && S.pomodoro && S.pomodoro.sound;
  window.dexerion.invoke('dex:pomo-configure', { sound: cur === 'off' ? 'white' : 'off' }).catch(() => {});
};
// Rail auto-collapse: the left tab + timer rail rests at ~1/4 width and
// springs to full on hover (>200ms) or click; it stows after 2s idle.
const RAIL_HOVER_MS = 200, RAIL_STOW_MS = 1000, RAIL_ANIM_MS = 280;
let railHoverT = null, railStowT = null, railOpenT = null, railTrackRAF = 0;
function railEl() { return $('#tabstrip'); }
function railCollapsed() { const el = railEl(); return el ? el.classList.contains('rail-collapsed') : false; }
// Track the animated width so the main-process webview slides with the rail
// edge instead of jumping. Reports are throttled (~64ms) with a guaranteed
// exact final report: every report forces a native view resize + repaint, so
// per-frame reporting visibly stutters the animation it is meant to smooth.
const RAIL_TRACK_STEP_MS = 64;
function railTrackWidth() {
  cancelAnimationFrame(railTrackRAF);
  const el = railEl();
  if (!el) return;
  const t0 = performance.now();
  let lastSent = 0;
  const send = (w) => {
    lastRailW = w;
    document.documentElement.style.setProperty('--rail-w', w + 'px');
    window.dexerion.invoke('dex:rail-w', w).catch(() => {});
  };
  const tick = () => {
    const now = performance.now();
    const done = now - t0 >= RAIL_ANIM_MS + 120;
    const w = Math.round(el.getBoundingClientRect().width);
    if (w >= 40 && w <= 640 && w !== lastRailW && (done || now - lastSent >= RAIL_TRACK_STEP_MS)) {
      lastSent = now;
      send(w);
    }
    if (!done) railTrackRAF = requestAnimationFrame(tick);
  };
  railTrackRAF = requestAnimationFrame(tick);
}
function expandRail() {
  const el = railEl();
  if (!el || !railCollapsed()) return;
  el.classList.remove('rail-collapsed');
  clearTimeout(railOpenT);
  railTrackWidth();
  // Full timer UI + tab text only join once the width has landed.
  railOpenT = setTimeout(() => { el.classList.add('rail-open'); reportChrome(); }, RAIL_ANIM_MS);
}
function scheduleRailStow() {
  clearTimeout(railStowT);
  railStowT = setTimeout(() => {
    if (draggingTab) { scheduleRailStow(); return; }
    const ae = document.activeElement;
    const el = railEl();
    if (el && ae && el.contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) { scheduleRailStow(); return; }
    if (el) {
      clearTimeout(railOpenT);
      el.classList.remove('rail-open');
      el.classList.add('rail-collapsed');
      railTrackWidth();
    }
    reportChrome();
  }, RAIL_STOW_MS);
}
(function initRailCollapse() {
  const el = railEl();
  if (!el || el._railCollapse) return;
  el._railCollapse = true;
  el.classList.add('rail-collapsed');
  el.addEventListener('mouseenter', () => {
    clearTimeout(railHoverT);
    clearTimeout(railStowT);
    railHoverT = setTimeout(expandRail, RAIL_HOVER_MS);
  });
  el.addEventListener('mousemove', () => { if (!railCollapsed()) scheduleRailStow(); });
  el.addEventListener('mouseleave', () => { clearTimeout(railHoverT); scheduleRailStow(); });
  el.addEventListener('click', () => { clearTimeout(railHoverT); expandRail(); scheduleRailStow(); });
  el.addEventListener('focusin', () => { clearTimeout(railHoverT); expandRail(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !railCollapsed()) scheduleRailStow(); });
})();
// save-password prompt from the password manager
window.dexerion.on('dex:login-prompt', ({ host, username }) => {
  const bar = $('#loginbar');
  $('#loginbar-tx').textContent = `Save password for ${username || 'this login'} on ${host}?`;
  bar.hidden = false;
  reportChrome();
});
$('#loginbar-save').onclick = async () => {
  $('#loginbar').hidden = true;
  reportChrome();
  await window.dexerion.invoke('dex:login-save', true).catch(() => {});
};
$('#loginbar-x').onclick = () => {
  $('#loginbar').hidden = true;
  window.dexerion.invoke('dex:login-save', false).catch(() => {});
  reportChrome();
};
$('#scrim').onclick = closeMenu;
document.querySelectorAll('#dmenu [data-m]').forEach(b => b.onclick = () => { const m = b.dataset.m; closeMenu(); setTimeout(() => menuAction(m), 30); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menuOpen) closeMenu(); });

let lastAct = '', lastActT = 0;
function menuAction(m) {
  // Shortcuts can arrive twice (shell key handler + app-menu accelerator);
  // collapse duplicates so one press never opens two tabs etc.
  const now = Date.now();
  if (m === lastAct && now - lastActT < 350) return;
  lastAct = m; lastActT = now;
  closeMenu();
  if (!S) return;
  const act = S && S.tabs.find(t => t.id === S.active);
  const url = act && act.url;
  if (m === 'new-tab') window.dexerion.invoke('dex:new-tab', 'dexerion://newtab', false);
  if (m === 'new-window') window.dexerion.invoke('dex:new-window');
  if (m === 'close-tab') window.dexerion.invoke('dex:close-tab', S.active);
  if (m === 'reopen-tab') window.dexerion.invoke('dex:reopen-closed');
  if (m === 'reload') window.dexerion.invoke('dex:nav', S.active, 'reload');
  if (m === 'hard-reload') window.dexerion.invoke('dex:nav', S.active, 'hard-reload');
  if (m === 'focus-url') { omni.focus(); omni.select(); }
  if (m === 'bookmarks') window.dexerion.invoke('dex:navigate', S.active, 'dexerion://bookmarks');
  if (m === 'history') window.dexerion.invoke('dex:navigate', S.active, 'dexerion://history');
  if (m === 'downloads') window.dexerion.invoke('dex:navigate', S.active, 'dexerion://downloads');
  if (m === 'extensions') window.dexerion.invoke('dex:navigate', S.active, 'dexerion://extensions');
  if (m === 'settings') window.dexerion.invoke('dex:navigate', S.active, 'dexerion://settings');
  if (m === 'about') window.dexerion.invoke('dex:navigate', S.active, 'dexerion://settings#about');
  if (m === 'accounts') window.dexerion.invoke('dex:navigate', S.active, 'dexerion://accounts');
  if (m === 'ai-panel') window.dexerion.invoke('dex:ai-toggle').catch(() => {});
  if (m === 'ai-new-chat') window.dexerion.invoke('dex:ai-new-chat').catch(() => {});
  if (m === 'ai-history') window.dexerion.invoke('dex:ai-history').catch(() => {});
  if (m === 'ai-settings') window.dexerion.invoke('dex:new-tab', 'dexerion://settings#assistant', false);
  if (m === 'files') window.dexerion.invoke('dex:new-tab', 'dexerion://files', false);
  if (m === 'snip') window.dexerion.invoke('dex:snip-open').catch(() => {});
  if (m === 'inspector') window.dexerion.invoke('dex:inspector-toggle', S.active).catch(() => {});
  if (m === 'inspect-element') window.dexerion.invoke('dex:inspector-toggle', S.active).catch(() => {});
  if (m === 'bookmark') toggleBookmark();
  if (m === 'next-tab' || m === 'prev-tab') cycleTab(m === 'next-tab' ? 1 : -1);
  if (typeof m === 'string' && m.startsWith('tab-')) {
    const idx = m === 'tab-last' ? S.tabs.length - 1 : parseInt(m.slice(4), 10);
    if (S.tabs[idx]) window.dexerion.invoke('dex:activate-tab', S.tabs[idx].id);
  }
}
function cycleTab(d) {
  const i = S.tabs.findIndex(t => t.id === S.active);
  const n = S.tabs[(i + d + S.tabs.length) % S.tabs.length];
  if (n) window.dexerion.invoke('dex:activate-tab', n.id);
}

// keyboard shortcuts — routed through menuAction so the 350ms dedupe guard
// collapses double delivery (shell handler + app-menu accelerator).
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod || !S) return;
  const k = e.key.toLowerCase();
  if (k === 't' && !e.shiftKey) { e.preventDefault(); menuAction('new-tab'); }
  else if (k === 'w') { e.preventDefault(); menuAction('close-tab'); }
  else if (e.shiftKey && k === 't') { e.preventDefault(); menuAction('reopen-tab'); }
  else if (e.key === 'Tab') { e.preventDefault(); menuAction(e.shiftKey ? 'prev-tab' : 'next-tab'); }
  else if (k === 'l') { e.preventDefault(); menuAction('focus-url'); }
  else if (k === 'r' && !e.shiftKey) { e.preventDefault(); menuAction('reload'); }
  else if (e.shiftKey && k === 'r') { e.preventDefault(); menuAction('hard-reload'); }
  else if (k === 'n' && !e.shiftKey) { e.preventDefault(); menuAction('new-window'); }
  else if (k === 'd' && !e.shiftKey) { e.preventDefault(); menuAction('bookmark'); }
  else if (k === 's' && e.shiftKey) { e.preventDefault(); menuAction('snip'); }
  else if (k === 'a' && e.shiftKey) { e.preventDefault(); menuAction('ai-panel'); }
  else if (k === 'o' && e.shiftKey) { e.preventDefault(); menuAction('ai-new-chat'); }
  // AI sidebar task bar shortcuts: Ctrl+Shift+N for new chat, Ctrl+Shift+H for history
  else if (e.shiftKey && k === 'n') { e.preventDefault(); menuAction('ai-new-chat'); }
  else if (e.shiftKey && k === 'h') { e.preventDefault(); menuAction('ai-history'); }
  else if (/^[1-9]$/.test(e.key)) {
    e.preventDefault();
    menuAction(e.key === '9' ? 'tab-last' : `tab-${parseInt(e.key, 10) - 1}`);
  }
});

// store banner
$('#store-install').onclick = async () => {
  try {
    await window.dexerion.invoke('dex:ext-install-store', pendingStoreUrl);
    $('#store-banner').hidden = true;
    announceToSR('Extension installed successfully');
    window.dexerion.invoke('dex:navigate', S.active, 'dexerion://extensions');
  } catch (err) {
    announceToSR('Web Store install failed: ' + err.message);
    alert('Web Store install failed: ' + err.message + '\nSee dexerion://extensions for manual options.');
  }
};
$('#store-dismiss').onclick = () => { $('#store-banner').hidden = true; };

// memory notice
$('#membar-allow').onclick = () => { $('#membar').hidden = true; window.dexerion.invoke('dex:mem-notice', 'allow').catch(() => {}); };
$('#membar-close').onclick = () => { $('#membar').hidden = true; window.dexerion.invoke('dex:mem-notice', 'close').catch(() => {}); };

// Accessibility: announce important state changes to screen readers
function announceToSR(text) {
  const live = $('#ai-taskbar-status');
  if (live) {
    live.hidden = false;
    live.textContent = text;
    setTimeout(() => { live.hidden = true; live.textContent = ''; }, 3000);
  }
}

// Focus management: trap focus within modal dialogs
function trapFocus(dialog) {
  const focusable = dialog.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  dialog.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  first.focus();
}

refresh();

// ---------- Tasks (additive; timer/rail logic above untouched) ----------
// Lists arrive sorted from the main process (due date, then priority, then
// oldest first). The shell only renders + forwards CRUD over dex:tasks-*.
let TASKS = [];
function updateTasks(s) {
  if (s && Array.isArray(s.tasks)) { TASKS = s.tasks; renderTasks(); }
}
window.dexerion.on('dex:tasks-updated', (list) => {
  TASKS = Array.isArray(list) ? list : [];
  renderTasks();
});
async function tasksRefresh() {
  try {
    const list = await window.dexerion.invoke('dex:tasks-list');
    if (Array.isArray(list)) { TASKS = list; renderTasks(); }
  } catch {}
}
const TASK_DATE_OPTIONS = { month: 'short', day: 'numeric' };
const TASK_TIME_OPTIONS = { hour: '2-digit', minute: '2-digit' };
function tkDueText(t, formatters) {
  if (!t || !t.dueMs) return '';
  const d = new Date(t.dueMs);
  const valid = Number.isFinite(d.getTime());
  const day = valid
    ? (formatters.date ||= new Intl.DateTimeFormat(undefined, TASK_DATE_OPTIONS)).format(d)
    : d.toLocaleDateString(undefined, TASK_DATE_OPTIONS);
  if (!t.hasTime) return day;
  return day + ' ' + (valid
    ? (formatters.time ||= new Intl.DateTimeFormat(undefined, TASK_TIME_OPTIONS)).format(d)
    : d.toLocaleTimeString(undefined, TASK_TIME_OPTIONS));
}
function tkRow(t, formatters) {
  const row = document.createElement('div');
  row.className = 'tk-row' + (t.done ? ' done' : '');
  const box = document.createElement('button');
  box.type = 'button';
  box.className = 'tk-box';
  box.textContent = '✓';
  box.title = t.done ? 'Mark open' : 'Mark done';
  box.setAttribute('aria-label', (t.done ? 'Mark open: ' : 'Mark done: ') + t.title);
  box.onclick = () => window.dexerion.invoke('dex:tasks-toggle', t.id, !t.done).catch(() => {});
  const main = document.createElement('div');
  main.className = 'tk-main';
  const b = document.createElement('b');
  b.textContent = t.title;
  b.title = t.notes || t.title;
  main.appendChild(b);
  const meta = (t.notes ? t.notes + ' · ' : '') + tkDueText(t, formatters);
  if (meta) {
    const sm = document.createElement('small');
    sm.textContent = meta;
    if (!t.done && t.dueMs < Date.now()) sm.classList.add('overdue');
    main.appendChild(sm);
  }
  const dot = document.createElement('span');
  dot.className = 'tk-dot ' + (t.priority === 'high' ? 'high' : t.priority === 'low' ? 'low' : 'medium');
  dot.title = t.priority + ' priority';
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'tk-x';
  x.textContent = '×';
  x.title = 'Delete task';
  x.setAttribute('aria-label', 'Delete task: ' + t.title);
  x.onclick = () => window.dexerion.invoke('dex:tasks-delete', t.id).catch(() => {});
  row.append(box, main, dot, x);
  return row;
}
// Tasks panel views: 'peek' (top three + "+N more"), 'list' (the full list,
// no composer) and 'compose' (composer + top three, scrollable — see
// #tk-list's compose cap). "+N more" and ⋯ open the list only; only ✚ opens
// the composer, and closing it restores whatever was shown before.
let tkView = 'peek', tkPrevView = 'peek';
function tkSyncListCap() {
  const list = $('#tk-list');
  if (!list) return;
  list.style.maxHeight = '';
  if (tkView !== 'compose') return;
  const rows = [...list.querySelectorAll('.tk-row')];
  if (rows.length <= 3) return;
  list.scrollTop = 0;
  const top = list.getBoundingClientRect().top;
  const cap = Math.ceil(rows[2].getBoundingClientRect().bottom - top);
  if (cap > 0) list.style.maxHeight = cap + 'px';
}
function tkSetView(view) {
  const full = $('#tasks-full');
  const body = $('#tasks-body');
  if (!full || !body) return;
  tkView = view;
  full.hidden = view === 'peek';
  body.classList.toggle('composing', view === 'compose');
  tkSyncListCap();
  if (view === 'compose') { const t = $('#tk-title'); if (t) t.focus(); }
}
function renderTasks() {
  const badge = $('#tm-count');
  const count = $('#tk-count');
  const peek = $('#tk-peek');
  const list = $('#tk-list');
  if (!badge || !peek || !list) return;
  // Share Intl setup within this render only. A later render picks up the
  // current locale/time zone and still recomputes the overdue labels.
  const formatters = {};
  const open = TASKS.filter((t) => t && !t.done);
  if (open.length) {
    badge.hidden = false;
    badge.textContent = open.length > 9 ? '9+' : String(open.length);
  } else {
    badge.hidden = true;
    badge.textContent = '';
  }
  if (count) count.textContent = open.length ? open.length + ' open' : '';
  peek.replaceChildren();
  const top = open.slice(0, 3);
  if (!top.length) {
    const d = document.createElement('div');
    d.className = 'tk-empty';
    d.textContent = 'No open tasks.';
    peek.appendChild(d);
  } else {
    for (const t of top) peek.appendChild(tkRow(t, formatters));
  }
  if (open.length > 3) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'tk-more';
    more.textContent = '+' + (open.length - 3) + ' more';
    more.onclick = () => tkSetView('list');
    peek.appendChild(more);
  }
  list.replaceChildren();
  if (!TASKS.length) {
    const d = document.createElement('div');
    d.className = 'tk-empty';
    d.textContent = 'No tasks yet — add one above.';
    list.appendChild(d);
  } else {
    for (const t of TASKS) list.appendChild(tkRow(t, formatters));
  }
  tkSyncListCap();
}
function tkShowErr(msg) {
  const el = $('#tk-err');
  if (!el) return;
  if (!msg) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.textContent = String(msg);
}
const _tkForm = $('#tk-form');
if (_tkForm) _tkForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  tkShowErr('');
  const title = $('#tk-title').value.trim();
  const input = {
    title,
    notes: $('#tk-notes').value,
    date: $('#tk-date').value,
    time: $('#tk-time').value,
    priority: $('#tk-pri').value,
  };
  try {
    const res = await window.dexerion.invoke('dex:tasks-add', input);
    if (Array.isArray(res)) { TASKS = res; renderTasks(); }
    $('#tk-title').value = '';
    $('#tk-notes').value = '';
    $('#tk-notes').style.height = '';
    $('#tk-date').value = '';
    $('#tk-time').value = '';
  } catch (err) {
    tkShowErr(err && err.message ? err.message.replace(/^Error:\s*/, '') : 'Could not add task.');
  }
});
// Description box grows to fit its lines (wraps at the box width, never
// scrolls sideways); capped so the rail panel stays scrollable.
const _tkNotes = $('#tk-notes');
if (_tkNotes) {
  const tkGrowNotes = () => {
    _tkNotes.style.height = 'auto';
    const h = _tkNotes.scrollHeight;
    // Guard the hidden-at-load case (scrollHeight 0): clear the inline height so
    // the CSS min-height shows, instead of pinning the box to 0px. border-box
    // means scrollHeight excludes the border, so add it or a 1px scrollbar
    // lingers even when everything fits.
    const cs = getComputedStyle(_tkNotes);
    const border = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    _tkNotes.style.height = h ? Math.min(h + border, 120) + 'px' : '';
  };
  _tkNotes.addEventListener('input', tkGrowNotes);
  // Enter still adds the task (the old single-line input submitted on Enter);
  // Shift+Enter inserts a newline, matching the AI composer's convention.
  _tkNotes.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    if (_tkForm && typeof _tkForm.requestSubmit === 'function') _tkForm.requestSubmit();
  });
  tkGrowNotes();
}
const _tkAddToggle = $('#tk-add-toggle');
if (_tkAddToggle) _tkAddToggle.onclick = () => {
  if (tkView === 'compose') tkSetView(tkPrevView);
  else { tkPrevView = tkView; tkSetView('compose'); }
};
const _tkExpand = $('#tk-expand');
if (_tkExpand) _tkExpand.onclick = () => tkSetView(tkView === 'list' ? 'peek' : 'list');
const _tkClear = $('#tk-clear-done');
if (_tkClear) _tkClear.onclick = () => window.dexerion.invoke('dex:tasks-clear-done').catch(() => {});
// Independent expand: hovering one mini shows only that panel when the rail
// opens; hovering the tabs shows both. New listeners only — the rail's own
// hover/stow timers and widths are untouched.
function tkRailMode(mode) {
  const el = $('#tabstrip');
  if (!el) return;
  el.classList.toggle('show-tasks', mode === 'tasks');
  el.classList.toggle('show-pomo', mode === 'pomo');
}
(function tkBindMini() {
  const tm = $('#tm-open');
  if (tm && !tm._tkMode) {
    tm._tkMode = true;
    tm.addEventListener('mouseenter', () => tkRailMode('tasks'));
    tm.addEventListener('focus', () => tkRailMode('tasks'));
  }
  const rm = $('#rail-mini');
  if (rm && !rm._tkMode) {
    rm._tkMode = true;
    rm.addEventListener('mouseenter', () => tkRailMode('pomo'));
    const rs = $('#rm-start');
    if (rs) rs.addEventListener('focus', () => tkRailMode('pomo'));
  }
  const tabs = $('#tabs');
  if (tabs && !tabs._tkMode) {
    tabs._tkMode = true;
    tabs.addEventListener('mouseenter', () => tkRailMode(''));
  }
})();
tasksRefresh();
