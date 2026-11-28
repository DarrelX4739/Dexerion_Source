'use strict';

/* Presentation only. The shell still owns editor creation, group actions,
   dismissal and rail measurement. Never overlap the native page or add IPC. */
(() => {
  const rail = document.getElementById('tabstrip');
  const tabs = document.getElementById('tabs');
  if (!rail || !tabs) return;
  document.body.classList.add('group-rail-ui');
  let editor = null;
  let trigger = null;
  let placeFrame = 0;

  function holdRail() {
    if (!editor) return;
    clearTimeout(railHoverT);
    clearTimeout(railStowT);
  }

  function place() {
    const current = editor;
    if (!current || !current.panel.isConnected) return;
    const { panel, input, swatches, anchor, initialAnchor } = current;
    const railBox = rail.getBoundingClientRect();
    // Use the smaller of CSS's current edge and the edge reported by the
    // existing shell. Leave room for the panel's border/focus styles.
    const right = Math.min(railBox.right, lastRailW, innerWidth);
    const left = railBox.left + 8;
    const width = Math.floor(right - left - 8);
    if (width < 160 || document.body.classList.contains('html-fs')) {
      panel.removeAttribute('data-rail-ready');
      return;
    }
    panel.style.setProperty('--group-rail-left', left + 'px');
    panel.style.setProperty('--group-rail-width', width + 'px');
    const wasHidden = swatches.hidden;
    if (wasHidden) swatches.hidden = false;
    const needed = panel.offsetHeight;
    swatches.hidden = wasHidden;
    const origin = anchor && anchor.isConnected ? anchor.getBoundingClientRect() : initialAnchor;
    // Reserve room for both palette rows so opening them never shifts the
    // hover target under a stationary pointer.
    const below = origin.bottom + 6;
    const above = origin.top - 6 - needed;
    const preferred = below + needed <= innerHeight - 8 ? below : above;
    const top = Math.max(8, Math.min(preferred, innerHeight - 8 - needed));
    panel.style.setProperty('--group-rail-top', top + 'px');
    if (!panel.hasAttribute('data-rail-ready')) {
      panel.setAttribute('data-rail-ready', '');
      requestAnimationFrame(() => {
        if (editor !== current || !panel.hasAttribute('data-rail-ready')) return;
        const focused = document.activeElement;
        if (focused === document.body || focused === anchor || focused === current.previousFocus) {
          input.focus({ preventScroll:true });
          input.select();
        }
      });
    }
  }

  function queuePlace() {
    if (editor && !placeFrame) placeFrame = requestAnimationFrame(() => {
      placeFrame = 0;
      place();
    });
  }

  function disclosure(panel, swatches) {
    const container = document.createElement('div');
    container.className = 'gr-color';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'gr-color-toggle';
    toggle.setAttribute('aria-controls', 'group-rail-palette');
    const current = document.createElement('span');
    current.className = 'gr-current';
    current.setAttribute('aria-hidden', 'true');
    const selected = swatches.querySelector('.on');
    const name = selected?.title || 'grey';
    const caption = document.createElement('span');
    caption.textContent = 'Color: ' + name[0].toUpperCase() + name.slice(1);
    const chevron = document.createElement('span');
    chevron.className = 'gr-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    toggle.append(current, caption, chevron);
    swatches.id = 'group-rail-palette';
    swatches.setAttribute('role', 'group');
    swatches.setAttribute('aria-label', 'Group colors');
    for (const swatch of swatches.querySelectorAll('button')) {
      swatch.style.setProperty('--gr-swatch', swatch.style.backgroundColor);
      swatch.type = 'button';
      swatch.setAttribute('aria-label', swatch.title);
      swatch.setAttribute('aria-pressed', String(swatch === selected));
    }
    swatches.before(container);
    container.append(toggle, swatches);

    let pinned = false;
    let hovered = false;
    let keepFocus = false;
    function update() {
      const shown = pinned || hovered || keepFocus;
      swatches.hidden = !shown;
      toggle.setAttribute('aria-expanded', String(shown));
      queuePlace();
    }
    container.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse') { hovered = true; update(); }
    });
    container.addEventListener('pointerleave', () => { hovered = false; update(); });
    container.addEventListener('focusin', (event) => {
      if (swatches.contains(event.target)) { keepFocus = true; update(); }
    });
    container.addEventListener('focusout', (event) => {
      if (!swatches.contains(event.relatedTarget)) { keepFocus = false; update(); }
    });
    toggle.addEventListener('click', () => {
      pinned = !pinned;
      if (!pinned) { hovered = false; keepFocus = false; }
      update();
    });
    panel.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.target === panel.querySelector('input')) return;
      event.preventDefault();
      event.stopPropagation();
      if (swatches.hidden) { closeGroupEditor(); return; }
      toggle.focus({ preventScroll:true });
      pinned = hovered = keepFocus = false;
      update();
    });
    update();
  }

  function syncEditor() {
    const panel = document.getElementById('gedit');
    if (panel === editor?.panel) return;
    const hadEditor = !!editor;
    editor = null;
    if (!panel) {
      if (hadEditor) {
        rail.classList.remove('group-editor-open');
        scheduleRailStow();
      }
      return;
    }
    const input = panel.querySelector('input');
    const swatches = panel.querySelector('.gsw');
    if (!input || !swatches) return;
    panel.dataset.groupRail = '';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Edit tab group');
    input.setAttribute('aria-label', 'Group name');
    let replayingBlur = false;
    panel.addEventListener('blur', (event) => {
      if (replayingBlur || event.target !== input || panel.contains(event.relatedTarget)) return;
      // A native focus move should still use the existing save handler.
      // Defer it until the node removal (Escape, swatch, etc.) has settled:
      // the removal itself emits blur, and calling remove() again from that
      // blur can both save a cancelled name and throw a reentrant DOM error.
      event.stopImmediatePropagation();
      setTimeout(() => {
        if (!panel.isConnected || (document.hasFocus() && document.activeElement === input)) return;
        replayingBlur = true;
        try {
          input.dispatchEvent(new FocusEvent('blur', { relatedTarget:event.relatedTarget }));
        } finally {
          replayingBlur = false;
        }
      }, 0);
    }, true);
    const anchor = trigger && trigger.isConnected ? trigger : null;
    trigger = null;
    const fallback = Math.max(8, parseFloat(panel.style.top) || 8);
    const initialAnchor = anchor ? anchor.getBoundingClientRect() : { top:fallback, bottom:fallback };
    editor = { panel, input, swatches, anchor, initialAnchor, previousFocus:document.activeElement };
    disclosure(panel, swatches);
    if (document.body.classList.contains('vertical')) {
      rail.classList.add('group-editor-open');
      holdRail();
      expandRail();
      reportChrome();
    }
    queuePlace();
  }

  document.addEventListener('contextmenu', (event) => { trigger = event.target.closest('#tabs .gchip'); }, true);
  // Bubble after the existing rail event listeners and cancel only their
  // automatic stow while the floating editor is present.
  for (const event of ['mousemove', 'mouseenter', 'mouseleave', 'click', 'focusin']) rail.addEventListener(event, holdRail);
  document.addEventListener('keydown', holdRail);
  window.addEventListener('resize', queuePlace);
  tabs.addEventListener('scroll', queuePlace, { passive:true });
  new ResizeObserver(queuePlace).observe(rail);
  new MutationObserver(syncEditor).observe(document.body, { childList:true });
  new MutationObserver(() => {
    if (editor && document.body.classList.contains('html-fs')) closeGroupEditor();
  }).observe(document.body, { attributes:true, attributeFilter:['class'] });

  /* Keep layout & hit targets stationary. Ease just the artwork inside tabs
     and group labels after a reorder; do not animate while Chrome is dragging. */
  const preferReduced = matchMedia('(prefers-reduced-motion: reduce)');
  let dragging = false;
  let pendingFrame = 0;
  let animations = [];
  function cancelMotion() {
    for (const animation of animations) animation.cancel();
    animations = [];
  }
  function measureRows() {
    const area = tabs.getBoundingClientRect();
    const rows = new Map();
    for (const node of tabs.children) {
      const isGroup = node.classList.contains('gchip');
      if (!isGroup && !node.classList.contains('tab')) continue;
      // The shell doesn't expose private tab identifiers. Ambiguous visuals
      // (duplicates, same-named groups) get no artificial travel.
      const key = isGroup
        ? 'group:' + node.querySelector('.gnm')?.textContent + ':' + node.style.getPropertyValue('--gc')
        : 'tab:' + node.title + ':' + node.querySelector('.t')?.textContent;
      if (rows.has(key)) { rows.set(key, null); continue; }
      const bounds = node.getBoundingClientRect();
      rows.set(key, { node, offset:bounds.top - area.top + tabs.scrollTop,
        visible:bounds.bottom > area.top && bounds.top < area.bottom });
    }
    return rows;
  }
  let prior = measureRows();
  function refresh() { prior = measureRows(); }
  function queueMotion() {
    if (!pendingFrame) pendingFrame = requestAnimationFrame(() => {
      pendingFrame = 0;
      const fresh = measureRows();
      const former = prior;
      prior = fresh;
      if (dragging || preferReduced.matches || !document.body.classList.contains('vertical')) return;
      let count = 0;
      for (const [key, next] of fresh) {
        const old = former.get(key);
        if (!next?.visible || !old?.visible || Math.abs(old.offset - next.offset) < 2 || ++count > 20) continue;
        const dy = Math.max(-10, Math.min(10, old.offset - next.offset));
        for (const piece of next.node.querySelectorAll(':scope > :is(.fav,.t,.gdot,.gnm,.gct,.gstate)')) {
          const animation = piece.animate([{ translate:'0 ' + dy + 'px' }, { translate:'0 0px' }],
            { duration:145, easing:'cubic-bezier(.2,.75,.25,1)' });
          animation.id = 'group-rail-motion';
          animations.push(animation);
          animation.finished.catch(() => {}).finally(() => { animations = animations.filter(other => other !== animation); });
        }
      }
    });
  }
  document.addEventListener('dragstart', (event) => {
    if (!event.target.closest('#tabs .tab')) return;
    refreshingDrag(true);
  }, true);
  function refreshingDrag(value) {
    dragging = value;
    if (value) { cancelMotion(); refresh(); }
    else queueMotion();
  }
  for (const event of ['dragend', 'drop']) document.addEventListener(event, () => {
    if (dragging) refreshingDrag(false);
  }, true);
  preferReduced.addEventListener('change', cancelMotion);
  window.addEventListener('resize', refresh);
  new MutationObserver(queueMotion).observe(tabs, { childList:true });
})();
