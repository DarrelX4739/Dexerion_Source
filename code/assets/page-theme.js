// Shared bootstrap for dexerion:// pages: apply the browser theme + accent,
// keep it live, and give the pages a shared failure surface.
(function () {
  const state = { theme: 'dark', accent: '' };

  // Logo follows the theme: black-background mark in dark mode, white in
  // light mode. Attribute writes don't retrigger the childList observer.
  function paintLogos() {
    const light = state.theme === 'light';
    document.querySelectorAll('img').forEach((im) => {
      const src = im.getAttribute('src') || '';
      if (light && /logo\.png$/.test(src) && !/logo-light\.png$/.test(src)) {
        im.setAttribute('src', src.replace(/logo\.png$/, 'logo-light.png'));
      } else if (!light && /logo-light\.png$/.test(src)) {
        im.setAttribute('src', src.replace(/logo-light\.png$/, 'logo.png'));
      }
    });
  }

  function applyTheme(theme, accent) {
    if (theme) state.theme = theme;
    if (accent) state.accent = accent;
    document.documentElement.dataset.theme = state.theme;
    if (state.accent) document.documentElement.style.setProperty('--accent', state.accent);
    paintLogos();
  }

  (async () => {
    try {
      const s = await window.dexerion.invoke('dex:get-state');
      applyTheme((s && s.ui && s.ui.theme) || 'dark', s && s.ui && s.ui.accent);
    } catch (e) { applyTheme('dark', ''); }
    paintLogos();
    try {
      new MutationObserver(() => paintLogos()).observe(document.documentElement, { childList: true, subtree: true });
    } catch {}
  })();

  // The theme and the accent are chrome-wide. The shell is told through the
  // full state, but an internal page lives in a tab view and was never told:
  // switching the theme in Settings repainted Settings and left every other
  // open page on the old colours until it was reloaded. The main process
  // sends this to every open page when either value changes.
  try {
    window.dexerion.on('dex:ui-theme', (p) => {
      if (!p) return;
      applyTheme(p.theme, p.accent);
    });
  } catch {}

  // ---------- shared failure surface ----------
  // "You have no bookmarks" and "the bookmarks could not be loaded" are
  // different statements and only one of them is true. A load that fails
  // used to leave the page blank - an unhandled rejection and a list that
  // looked empty. DexPage.fail shows what went wrong and offers a retry;
  // DexPage.guard puts a load behind that surface.
  function failBox(message, retry) {
    const box = document.createElement('div');
    box.className = 'dx-error';
    const b = document.createElement('b');
    b.textContent = 'This page could not load';
    const p = document.createElement('span');
    p.textContent = message || 'Something went wrong.';
    box.append(b, p);
    if (retry) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn';
      btn.textContent = 'Try again';
      btn.onclick = () => { box.remove(); retry(); };
      box.appendChild(btn);
    }
    return box;
  }
  function failHost() {
    return document.getElementById('list')
      || document.querySelector('.dx-list')
      || document.querySelector('.dx-page')
      || document.body;
  }
  window.DexPage = {
    fail(err, retry, host) {
      const msg = String((err && (err.message || err)) || 'Something went wrong.');
      const target = host || failHost();
      try {
        target.replaceChildren(failBox(msg, retry));
      } catch {
        document.body.appendChild(failBox(msg, retry));
      }
    },
    async guard(fn, retry, host) {
      try {
        return await fn();
      } catch (e) {
        window.DexPage.fail(e, retry, host);
        return null;
      }
    },
    // ---------- back affordance ----------
    // The internal pages are tabs of their own. A dexerion:// tab has no
    // navigation history, so the browser's Back button does nothing on it
    // and the only way out was to close the tab by hand. A page with a
    // header gets a Back control that returns it to the New Tab page.
    back() {
      if (document.querySelector('.dx-back')) return;
      const head = document.querySelector('.dx-head');
      if (!head) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ghost dx-back';
      b.textContent = 'Back';
      b.title = 'Back to the New Tab page';
      b.onclick = () => {
        window.dexerion.invoke('dex:navigate', null, 'dexerion://newtab').catch(() => {});
      };
      head.insertBefore(b, head.firstChild);
    },
  };
  window.DexPage.back();
})();
