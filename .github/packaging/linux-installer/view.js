'use strict';

(() => {
  const $ = selector => document.querySelector(selector);
  const page = $('#page'), primary = $('#primary'), back = $('#back'), cancel = $('#cancel'), close = $('#close');
  const icon = {
    arrow: 'M1 6h10m-4-4 4 4-4 4',
    back: 'M11 6H1m4-4L1 6l4 4',
    up: 'M6 11V1M2 5l4-4 4 4',
    check: 'm1 6 3.5 3.5L11 3',
    folder: 'M1 3h4l2 2h6v7H1zm0 3h12',
    open: 'M1 11V4h4l2 2h6v5z'
  };
  const svg = name => `<svg aria-hidden="true" viewBox="0 0 ${name === 'folder' || name === 'open' ? '14 14' : '12 12'}"><path d="${icon[name]}"/></svg>`;
  let info, current, destination, folder, queued = false, errorMessage = '', readyWarning = '';

  function element(tag, text) {
    const item = document.createElement(tag);
    if (text != null) item.textContent = text;
    return item;
  }

  function lead(title, description, into = page) {
    const heading = element('h1', title);
    heading.id = 'heading';
    heading.tabIndex = -1;
    const note = element('p', description);
    note.className = 'description';
    into.append(heading, note);
  }

  function choose(label, type, checked, disabled = false) {
    const choice = element('label');
    choice.className = 'choice';
    const control = element('input');
    control.type = type;
    control.checked = checked;
    control.disabled = disabled;
    control.name = type === 'radio' ? 'scope' : 'launch';
    const indicator = element('span');
    indicator.className = 'indicator';
    indicator.setAttribute('aria-hidden', 'true');
    if (type === 'checkbox') indicator.innerHTML = svg('check');
    choice.append(control, indicator, element('span', label));
    return choice;
  }

  function action(label, glyph, handler) {
    const button = element('button');
    if (glyph) button.innerHTML = svg(glyph);
    button.append(document.createTextNode(label));
    button.addEventListener('click', handler);
    return button;
  }

  function status(text, parent = page) {
    const note = element('p', text);
    note.className = 'status';
    note.setAttribute('role', 'status');
    parent.append(note);
    return note;
  }

  function show(stage) {
    current = stage;
    document.body.dataset.stage = stage;
    page.replaceChildren();
    page.scrollTop = 0;
    back.hidden = !['options', 'browse', 'error'].includes(stage);
    cancel.hidden = ['installing', 'ready'].includes(stage);
    primary.hidden = stage === 'installing';
    primary.disabled = false;
    close.disabled = stage === 'installing';
    $('#action-icon').setAttribute('d', icon[stage === 'ready' ? 'check' : stage === 'error' ? 'back' : 'arrow']);
    $('#action-label').textContent = { welcome: 'Continue', options: 'Install', browse: 'Use this folder',
      ready: 'Finish', error: 'Back to options', installing: '' }[stage];
    switch (stage) {
      case 'welcome': {
        const lockup = element('div');
        lockup.className = 'lockup';
        const mark = element('img');
        mark.className = 'hero-logo';
        mark.alt = 'Dexerion logo';
        mark.src = 'logo.png';
        const intro = element('div');
        lead('Install Dexerion', info.preview
          ? 'Walk through Setup without installing Dexerion or changing this computer.'
          : 'Set up the Dexerion desktop browser. Your existing browser profile stays in place.', intro);
        lockup.append(mark, intro);
        page.append(lockup);
        primary.focus();
        break;
      }
      case 'options': {
        lead('Install options', 'Choose who can use Dexerion and where Setup puts it.');
        const scope = element('div');
        scope.className = 'scope';
        scope.setAttribute('role', 'group');
        scope.setAttribute('aria-label', 'Installation scope');
        scope.append(choose('Just me', 'radio', true), choose('Everyone on this computer', 'radio', false, true));
        const label = element('label', 'Installation folder');
        label.htmlFor = 'install-path';
        label.className = 'path-label';
        const slot = element('div');
        slot.className = 'path-slot';
        const input = element('input');
        input.id = 'install-path';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.value = destination;
        const browse = action('Browse', 'folder', async () => {
          if (queued) return;
          destination = input.value;
          const hadFolder = folder;
          folder = await runBrowse(destination);
          if (!folder.error) show('browse');
          else {
            $('#path-status').textContent = folder.error;
            folder = hadFolder;
          }
        });
        browse.id = 'browse-button';
        slot.append(input, browse);
        page.append(scope, label, slot);
        status('No administrator approval is needed. Linux Setup installs for your account only.').id = 'path-status';
        primary.focus();
        break;
      }
      case 'browse': {
        lead('Choose a folder', 'Open a folder, go up a level, or enter a path in Install options.');
        const bar = element('div');
        bar.className = 'browse-bar';
        const label = element('span', folder.current);
        label.className = 'current-folder';
        const up = action('Up one level', 'up', () => enter(folder.parent));
        up.disabled = !folder.parent;
        bar.append(label, up);
        const list = element('div');
        list.className = 'folders';
        list.setAttribute('aria-label', 'Folders');
        list.setAttribute('role', 'group');
        if (!folder.folders.length) {
          const note = status('No folders to show.', list);
          note.classList.add('empty');
        }
        folder.folders.forEach(child => {
          const button = action('', 'open', () => enter(child.path));
          button.append(element('span', child.name));
          list.append(button);
        });
        page.append(bar, list);
        status('').id = 'folder-status';
        (up.disabled ? primary : up).focus();
        break;
      }
      case 'installing': {
        lead('Installing Dexerion', 'Keep this window open until Setup finishes.');
        const indicator = element('div');
        indicator.className = 'dots';
        indicator.setAttribute('role', 'progressbar');
        indicator.setAttribute('aria-label', 'Installing Dexerion');
        indicator.append(element('span'), element('span'), element('span'));
        page.append(indicator);
        $('#heading').focus();
        break;
      }
      case 'ready':
        lead(info.preview ? 'Preview complete' : 'Dexerion is installed', info.preview
          ? 'Nothing was installed or changed on this computer.' : 'Open it now or finish Setup.');
        page.append(choose('Launch Dexerion', 'checkbox', true));
        status(readyWarning).id = 'ready-status';
        primary.focus();
        break;
      case 'error':
        lead('Installation could not be verified', errorMessage);
        primary.focus();
        break;
    }
  }

  async function runBrowse(path) {
    queued = true;
    document.body.setAttribute('aria-busy', 'true');
    try { return await window.setup.browse(path); }
    catch { return { error: 'Setup could not list this folder.' }; }
    finally { queued = false; document.body.removeAttribute('aria-busy'); }
  }

  async function enter(path) {
    if (!path || queued) return;
    const next = await runBrowse(path);
    if (next.error) $('#folder-status').textContent = next.error;
    else { folder = next; show('browse'); }
  }

  async function proceed() {
    if (queued) return;
    switch (current) {
      case 'welcome':
        show('options'); return;
      case 'browse':
        destination = folder.current;
        show('options'); return;
      case 'error':
        show('options'); return;
      case 'options': {
        const entered = $('#install-path').value;
        queued = true;
        document.body.setAttribute('aria-busy', 'true');
        try {
          const target = await window.setup.target(entered);
          if (target.error) { $('#path-status').textContent = target.error; return; }
          destination = target.target;
          if (destination !== entered) {
            $('#install-path').value = destination;
            $('#path-status').textContent = 'Dexerion will use the app folder shown above. Select Install again to confirm.';
            return;
          }
          show('installing');
          const result = await window.setup.install(destination);
          if (result.error) { errorMessage = result.error; show('error'); }
          else { readyWarning = result.warning; show('ready'); }
        } catch {
          errorMessage = 'Setup could not complete the installation. Return to Install options and try again.';
          show('error');
        } finally {
          queued = false;
          document.body.removeAttribute('aria-busy');
        }
        return;
      }
      case 'ready': {
        queued = true;
        const launch = $('input[name="launch"]');
        try {
          const result = await window.setup.finish(launch.checked);
          if (result.error) {
            $('#ready-status').textContent = result.error;
            launch.checked = false;
          }
        } finally { queued = false; }
        return;
      }
    }
  }

  primary.addEventListener('click', proceed);
  back.addEventListener('click', () => {
    if (queued) return;
    if (current === 'options') { destination = $('#install-path').value; show('welcome'); }
    else show('options');
  });
  [cancel, close].forEach(button => button.addEventListener('click', () => window.setup.close()));
  $('#minimize').addEventListener('click', () => window.setup.minimize());
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && current !== 'installing' && !queued) window.setup.close();
    if (event.key === 'Enter' && !primary.hidden && event.target?.id === 'install-path') {
      event.preventDefault();
      proceed();
    }
  });

  window.setup.info().then(result => {
    info = result;
    destination = info.defaultPath;
    $('#preview').hidden = !info.preview;
    show('welcome');
  }).catch(() => {
    errorMessage = 'Setup could not start. Close this window and try again.';
    show('error');
    primary.hidden = true;
    back.hidden = true;
  });
})();
