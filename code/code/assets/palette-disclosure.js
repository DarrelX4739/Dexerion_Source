/* A colour disclosure is deliberately not a custom combobox: the underlying
   swatches and native custom picker stay real, keyboard-operable controls. */
(() => {
  'use strict';
  const palettes = new WeakMap();
  const SC_TEAL = "#1f6f6b";

  function bind(root) {
    if (!root) return null;
    if (palettes.has(root)) return palettes.get(root);
    const trigger = root.querySelector('.dx-palette-trigger');
    const panel = root.querySelector('.dx-palette-panel');
    const value = trigger.querySelector('.dx-palette-value');
    const clearance = root.closest('[data-palette-clearance]');
    const settingsAccent = root.id === 'settings-accent-palette';
    let mode = '';
    let leaveTimer = 0;
    let frame = 0;
    let pointerInside = false;
    let corridor = null;

    const owns = (node) => node instanceof Node && root.contains(node);
    const focusInPanel = () => panel.contains(document.activeElement);

    function position() {
      frame = 0;
      if (!mode) return;
      if (!trigger.getClientRects().length) { close(); return; }
      const anchor = trigger.getBoundingClientRect();
      const w = document.documentElement.clientWidth;
      const h = document.documentElement.clientHeight;
      const edge = 8;
      if (anchor.bottom <= edge || anchor.top >= h - edge) { close(); return; }
      // Open flush with the trigger (no dead zone crossing into the tray).
      // Clamp to this WebContentsView, not the entire Electron window.
      panel.style.maxWidth = Math.max(0, w - 2 * edge) + 'px';
      panel.style.maxHeight = Math.max(0, h - 2 * edge) + 'px';
      const bounds = panel.getBoundingClientRect();
      const reserved = clearance ? clearance.getBoundingClientRect() : anchor;
      // In a wrapped toolbar, do not cover the next row of real buttons.
      const anchorBottom = Math.max(anchor.bottom, reserved.bottom);
      const anchorTop = Math.min(anchor.top, reserved.top);
      const below = h - edge - anchorBottom;
      const above = anchorTop - edge;
      const openAbove = below < bounds.height && above > below;
      const available = openAbove ? above : below;
      panel.style.maxHeight = Math.max(0, available) + 'px';
      const height = Math.min(bounds.height, Math.max(0, available));
      const preferred = getComputedStyle(trigger).direction === 'rtl' ? anchor.right - bounds.width : anchor.left;
      const left = Math.max(edge, Math.min(preferred, w - edge - bounds.width));
      const top = openAbove ? anchorTop - height : Math.min(anchorBottom, h - edge);
      panel.style.left = left + 'px';
      panel.style.top = top + 'px';
      // Allow a slow, uninterrupted move down or up through the wrap gap.
      // This virtual corridor never intercepts clicks on a toolbar control.
      corridor = {
        left: Math.min(anchor.left, left),
        right: Math.max(anchor.right, left + bounds.width),
        top: openAbove ? top + height : anchor.bottom,
        bottom: openAbove ? anchor.top : top,
      };
    }

    function reflow(event) {
      if (event && owns(event.target) && event.type === 'scroll') return;
      if (mode && !frame) frame = requestAnimationFrame(position);
    }

    function onOutside(event) {
      if (!owns(event.target)) close();
    }

    function scheduleHoverLeave() {
      if (mode !== 'hover' || leaveTimer) return;
      leaveTimer = setTimeout(() => {
        leaveTimer = 0;
        if (!pointerInside && !focusInPanel() && mode === 'hover') close();
      }, 180);
    }

    function onPointerMove(event) {
      if (mode !== 'hover' || event.pointerType !== 'mouse') return;
      const { clientX: x, clientY: y } = event;
      pointerInside = owns(event.target) || (corridor && x >= corridor.left &&
        x <= corridor.right && y >= corridor.top && y <= corridor.bottom);
      if (pointerInside) {
        clearTimeout(leaveTimer);
        leaveTimer = 0;
      } else scheduleHoverLeave();
    }

    function onEscape(event) {
      if (event.key !== 'Escape' || !mode) return;
      event.preventDefault();
      event.stopImmediatePropagation(); // a second Esc can close the outer preview
      close(focusInPanel());
    }

    function open(nextMode, focusOption = false) {
      clearTimeout(leaveTimer);
      leaveTimer = 0;
      if (!mode) {
        panel.showPopover({ source: trigger });
        trigger.setAttribute('aria-expanded', 'true');
        document.addEventListener('pointerdown', onOutside, true);
        document.addEventListener('pointermove', onPointerMove, true);
        document.addEventListener('keydown', onEscape, true);
        window.addEventListener('scroll', reflow, true);
        window.addEventListener('resize', reflow);
      }
      mode = nextMode;
      position();
      if (focusOption && mode) {
        const option = panel.querySelector('[aria-pressed="true"]') ||
          panel.querySelector('button:not([disabled]),input:not([disabled])');
        if (option) option.focus({ preventScroll: true });
      }
    }

    function close(restoreFocus = false) {
      clearTimeout(leaveTimer);
      leaveTimer = 0;
      cancelAnimationFrame(frame);
      frame = 0;
      if (!mode) return;
      mode = '';
      trigger.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('keydown', onEscape, true);
      window.removeEventListener('scroll', reflow, true);
      window.removeEventListener('resize', reflow);
      if (restoreFocus) trigger.focus({ preventScroll: true });
      if (panel.matches(':popover-open')) panel.hidePopover();
    }

    trigger.addEventListener('click', (event) => {
      if (mode === 'pinned') close();
      else open('pinned', event.detail === 0);
    });
    trigger.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown') return;
      event.preventDefault();
      open('pinned', true);
    });
    trigger.addEventListener('pointerenter', (event) => {
      if (event.pointerType !== 'mouse') return;
      pointerInside = true;
      if (!mode) open('hover');
      else { clearTimeout(leaveTimer); leaveTimer = 0; }
    });
    for (const node of [trigger, panel]) {
      node.addEventListener('pointerleave', (event) => {
        if (event.pointerType !== 'mouse') return;
        pointerInside = false;
        scheduleHoverLeave();
      });
    }
    panel.addEventListener('pointerenter', (event) => {
      if (event.pointerType !== 'mouse') return;
      pointerInside = true;
      clearTimeout(leaveTimer);
      leaveTimer = 0;
    });
    root.addEventListener('focusout', (event) => {
      // A native colour chooser can temporarily move focus outside Chromium
      // with no relatedTarget; let its existing input/change handling finish.
      if (event.relatedTarget && !owns(event.relatedTarget)) close();
    });

    const instance = {
      close,
      select(label, colour) {
        value.textContent = settingsAccent && typeof colour === 'string' && colour.toLowerCase() === SC_TEAL ? 'SC Teal' : label;
        trigger.style.setProperty('--dx-palette-swatch', colour || 'transparent');
        reflow();
      },
    };
    palettes.set(root, instance);
    return instance;
  }

  // The assistant owns report rendering and actions. Read its rendered
  // selection rather than intercepting or duplicating its report handlers.
  function bindReportSheet() {
    const swatches = document.getElementById('ai-report-papers');
    const root = swatches?.closest('.dx-palette');
    const sheet = root?.closest('#ai-report-sheet');
    if (!sheet) return;
    const palette = bind(root);
    const body = sheet.querySelector('#ai-report-body');

    function syncSelection() {
      if (sheet.hidden) { palette.close(); return; }
      const dots = swatches.querySelectorAll('.ai-paper-dot');
      let selected = null;
      for (const dot of dots) {
        const active = dot.classList.contains('sel');
        dot.setAttribute('aria-pressed', String(active));
        if (active) selected = dot;
      }
      const page = body?.querySelector('.dxa-report[data-paper]');
      const name = selected?.dataset.paper || page?.dataset.paper || 'paper';
      const sample = selected || page;
      palette.select(name[0].toUpperCase() + name.slice(1),
        sample ? getComputedStyle(sample).backgroundColor : 'transparent');
    }

    const observer = new MutationObserver(syncSelection);
    observer.observe(swatches, { childList: true, subtree: true,
      attributes: true, attributeFilter: ['class', 'style', 'data-paper'] });
    observer.observe(sheet, { attributes: true, attributeFilter: ['hidden'] });
    if (body) observer.observe(body, { childList: true });
    root.addEventListener('click', (event) => {
      if (event.target.closest?.('#ai-report-papers .ai-paper-dot')) palette.close(true);
    });
    syncSelection();
  }

  // Dia's curated choices informed the tiled Appearance palette. Keep the
  // native custom control and existing Settings save path unchanged.
  // https://www.diabrowser.com/release-notes/1-56-make-yourself-at-home
  function addSettingsTeal() {
    const root = document.getElementById('settings-accent-palette');
    if (!root) return;
    const swatches = root.querySelector('#swatches');
    const observer = new MutationObserver(add);
    function add() {
      const native = root.querySelector('#customAccent');
      if (!native) return;
      observer.disconnect();
      const teal = document.createElement('button');
      teal.type = 'button';
      teal.className = 'dx-swatch';
      teal.dataset.c = SC_TEAL;
      teal.style.background = teal.dataset.c;
      teal.title = 'SC Teal (#1F6F6B)';
      teal.setAttribute('aria-label', 'SC Teal accent');
      const selected = native.value.toLowerCase() === teal.dataset.c;
      teal.classList.toggle('sel', selected);
      teal.setAttribute('aria-pressed', String(selected));
      teal.addEventListener('click', () => {
        bind(root).close(true);
        if (native.value.toLowerCase() === teal.dataset.c) return;
        native.value = teal.dataset.c;
        native.dispatchEvent(new Event('input', { bubbles:true }));
        native.dispatchEvent(new Event('change', { bubbles:true }));
      });
      swatches.prepend(teal);
    }
    observer.observe(root, { childList:true, subtree:true });
    add();
  }

  window.DexPalette = { bind };
  bindReportSheet();
  addSettingsTeal();
})();
