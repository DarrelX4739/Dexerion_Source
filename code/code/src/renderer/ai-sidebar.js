(() => {
  const $ = selector => document.querySelector(selector);
  const panel = $('#ai-sidebar');
  const list = $('#ai-chat-list');
  const empty = $('#ai-empty');
  const messages = $('#ai-messages');
  const search = $('#ai-search');
  const input = $('#ai-input');
  const send = $('#ai-send');
  const files = $('#ai-files');
  const pending = $('#ai-pending');
  const setup = $('#ai-setup');
  const taskbarTitle = $('#ai-taskbar-title');
  const taskbarStatus = $('#ai-taskbar-status');
  const effortBtn = $('#ai-effort-btn');
  const effortMenu = $('#ai-effort-menu');
  const popMenu = $('#ai-pop-menu');
  const modelSelect = $('#ai-model-select');
  const modelWrap = $('#ai-model-wrap');
  const effortSelect = $('#ai-effort-select');
  const effortWrap = $('#ai-effort-wrap');
  let state = null;
  let accountId = '';
  let chats = [];
  let activeChat = null;
  let attachments = [];
  const queue = []; // messages typed while a run is in flight (max 3)
  let busy = false;
  let requestId = null;
  let liveBubble = null;
  let liveStepsEl = null; // live step trace while skills run (sibling of the bubble)
  let liveText = '';
  let livePaintTimer = null; // trailing markdown paint (coalesces stream chunks)
  // Navigation epoch: openChat/createChat responses that resolve out of
  // order (or lose a race with a chats-updated broadcast) must not paint
  // a stale conversation over the current one.
  let navEpoch = 0;
  // ---------- Modern composer / message-interaction state ----------
  let targetedMessage = null; // { id, role, text, kind: 'reply'|'forward'|'edit' }
  let editingMessageId = null; // id of message currently being inline-edited
  let replyToMessageId = null; // id of message being replied to (threading)
  let emojiPickerTarget = null; // message id the emoji picker is open for
  let msgSearchActive = false; // conversation search sheet open?
  const EMOJIS = ['👍','👎','❤️','🔥','😂','🎉','🚀','💡','✅','⚠️','🙏','👀','🎯','💯','🤔','❤️‍🔥'];

  async function loadMemory() {
    const facts = await window.dexerion.invoke('dex:ai-memory-list').catch(() => []);
    renderMemory(facts || []);
  }

  function renderMemory(facts) {
    const box = $('#ai-memory-list');
    if (!box) return;
    box.replaceChildren();
    if (!facts.length) {
      const p = document.createElement('span');
      p.className = 'ai-hint';
      p.textContent = 'Nothing remembered yet.';
      box.appendChild(p);
      return;
    }
    for (const f of facts) {
      const row = document.createElement('div');
      row.className = 'ai-meta-row';
      const tx = document.createElement('span');
      tx.className = 'ai-main';
      tx.textContent = f.text;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'ai-icon-btn';
      del.title = 'Forget this';
      del.textContent = '×';
      del.onclick = async () => {
        try {
          renderMemory(await window.dexerion.invoke('dex:ai-memory-delete', f.id));
        } catch {
          hintNote('Could not forget that just now — try again.');
        }
      };
      row.append(tx, del);
      box.appendChild(row);
    }
  }

  function setPanel(open) {
    panel.hidden = !open;
    if (open) {
      input.focus();
      loadStatusDebounced();
      loadChats();
      loadMemory();
      loadPagePrefs();
      loadAgentPrefs();
      loadCaps();
      loadUiPrefs();
      loadDifficulty();
      consumePending();
    }
  }

  function accountChanged(next) {
    if (accountId === next) return;
    accountId = next;
    activeChat = null;
    chats = [];
    renderList();
    renderMessages();
    if (!panel.hidden) { loadChats(); loadMemory(); }
  }

  function dateLabel(value) {
    const date = new Date(value || Date.now());
    const now = new Date();
    if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  // ---------- Message data model (modern chat features) ----------
  // Each stored message may carry: reactions { emoji: count }, pinned, edited,
  // editedAt, replyTo (message id), mentions [string], forwardedFrom (id).
  // Missing fields are normalised on read so the rest of the code can assume
  // they exist.
  function normaliseMessage(m) {
    if (!m) return m;
    m.reactions = m.reactions || {};
    m.pinned = Boolean(m.pinned);
    m.edited = Boolean(m.edited);
    m.editedAt = m.editedAt || null;
    m.replyTo = m.replyTo || null;
    m.mentions = Array.isArray(m.mentions) ? m.mentions : [];
    m.forwardedFrom = m.forwardedFrom || null;
    m.reactionCount = () => Object.values(m.reactions || {}).reduce((a, b) => a + b, 0);
    m.myReaction = () => Object.keys(m.reactions || {}).find(e => (m.myReactions || []).includes(e)) || null;
    m.myReactions = m.myReactions || [];
    return m;
  }

  function messageById(id) {
    if (!activeChat || !activeChat.messages) return null;
    return activeChat.messages.find(m => m.id === id) || null;
  }

  function findMessageIndex(id) {
    if (!activeChat || !activeChat.messages) return -1;
    return activeChat.messages.findIndex(m => m.id === id);
  }

  // Trim quoted text for reply preview (first line, max ~60 chars).
  function replyPreview(text) {
    const t = String(text || '').split('\n')[0].trim();
    return t.length > 60 ? t.slice(0, 57) + '…' : t;
  }

  // Extract @mentions from plain text.
  function extractMentions(text) {
    const matches = String(text || '').match(/@[\w.-]+/g);
    return matches ? matches.map(m => m.slice(1)) : [];
  }

  // Highlight @mentions in rendered HTML.
  function highlightMentions(text) {
    return String(text || '').replace(/@([\w.-]+)/g, '<span class="ai-mention">@$1</span>');
  }

  // Persist a message mutation to the store (main process) and refresh.
  async function persistMessage(chatId, message) {
    if (!chatId) return;
    try {
      activeChat = await window.dexerion.invoke('dex:ai-chat-append', { id: chatId, message });
      renderList();
      renderMessages();
    } catch (err) {
      hintNote(err.message || 'Could not save — try again.');
    }
  }

  // Toggle a reaction on a message.
  async function toggleReaction(messageId, emoji) {
    if (!activeChat) return;
    const idx = findMessageIndex(messageId);
    if (idx < 0) return;
    const m = normaliseMessage(activeChat.messages[idx]);
    const has = (m.myReactions || []).includes(emoji);
    if (has) {
      m.myReactions = m.myReactions.filter(e => e !== emoji);
      delete m.reactions[emoji];
      if (m.reactionCount() === 0) delete m.reactions;
    } else {
      m.myReactions = [...(m.myReactions || []), emoji];
      m.reactions[emoji] = (m.reactions[emoji] || 0) + 1;
    }
    await persistMessage(activeChat.id, m);
    messages.scrollTop = messages.scrollHeight;
  }

  // Pin / unpin a message.
  async function togglePin(messageId) {
    if (!activeChat) return;
    const idx = findMessageIndex(messageId);
    if (idx < 0) return;
    const m = normaliseMessage(activeChat.messages[idx]);
    m.pinned = !m.pinned;
    await persistMessage(activeChat.id, m);
  }

  // Start inline editing of a message.
  function startEdit(messageId) {
    if (busy) return;
    const m = messageById(messageId);
    if (!m || m.role !== 'user') return; // only the person's own messages for now
    editingMessageId = messageId;
    targetedMessage = null;
    closeReplyTarget();
    closeEmojiPicker();
    renderMessages();
    const el = document.getElementById('ai-edit-input-' + messageId);
    if (el) { el.focus(); el.select(); }
  }

  // Commit an inline edit.
  async function commitEdit(messageId) {
    if (!activeChat) return;
    const idx = findMessageIndex(messageId);
    if (idx < 0) return;
    const el = document.getElementById('ai-edit-input-' + messageId);
    const text = el ? el.value.trim() : '';
    if (!text) { editingMessageId = null; renderMessages(); return; }
    const m = normaliseMessage(activeChat.messages[idx]);
    m.text = text;
    m.edited = true;
    m.editedAt = Date.now();
    await persistMessage(activeChat.id, m);
    editingMessageId = null;
    renderMessages();
  }

  // Cancel inline edit.
  function cancelEdit() {
    editingMessageId = null;
    renderMessages();
  }

  // Set the composer to target a message (reply / forward / edit).
  function setTarget(kind, messageId) {
    if (busy) return;
    const m = messageById(messageId);
    if (!m) return;
    targetedMessage = { id: messageId, role: m.role, text: m.text || '', kind };
    replyToMessageId = kind === 'reply' ? messageId : null;
    editingMessageId = null;
    closeEmojiPicker();
    paintReplyTarget();
    renderMessages();
    input.focus();
  }

  function clearTarget() {
    targetedMessage = null;
    replyToMessageId = null;
    paintReplyTarget();
    renderMessages();
  }

  function closeReplyTarget() {
    targetedMessage = null;
    replyToMessageId = null;
    paintReplyTarget();
  }

  function paintReplyTarget() {
    const banner = $('#ai-reply-target');
    const kindEl = $('#ai-reply-target-kind');
    const textEl = $('#ai-reply-target-text');
    if (!banner || !kindEl || !textEl) return;
    if (!targetedMessage) { banner.hidden = true; return; }
    const labels = { reply: 'Replying to', forward: 'Forwarding', edit: 'Editing' };
    kindEl.textContent = labels[targetedMessage.kind] || 'Targeting';
    textEl.textContent = replyPreview(targetedMessage.text);
    banner.hidden = false;
  }

  // Emoji picker
  function openEmojiPicker(messageId) {
    if (busy) return;
    const m = messageById(messageId);
    if (!m) return;
    emojiPickerTarget = messageId;
    const picker = $('#ai-emoji-picker');
    const listEl = $('#ai-emoji-list');
    const searchEl = $('#ai-emoji-search');
    if (!picker || !listEl || !searchEl) return;
    listEl.replaceChildren();
    for (const emoji of EMOJIS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ai-emoji-item';
      btn.textContent = emoji;
      btn.title = 'Add ' + emoji + ' reaction';
      btn.onclick = (ev) => { ev.stopPropagation(); toggleReaction(messageId, emoji); closeEmojiPicker(); };
      listEl.appendChild(btn);
    }
    searchEl.value = '';
    searchEl.oninput = () => {
      const term = searchEl.value.toLowerCase();
      for (const btn of listEl.querySelectorAll('.ai-emoji-item')) {
        btn.hidden = !btn.textContent.toLowerCase().includes(term);
      }
    };
    picker.hidden = false;
    // Position near the message bubble (best effort: below the target row)
    const row = document.querySelector('[data-msg-id="' + messageId + '"]');
    if (row) {
      const rect = row.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      picker.style.top = Math.max(0, rect.top - panelRect.top - 6) + 'px';
      picker.style.left = Math.max(8, Math.min(rect.left - panelRect.left, panelRect.width - 276)) + 'px';
    }
    searchEl.focus();
  }

  function closeEmojiPicker() {
    emojiPickerTarget = null;
    const picker = $('#ai-emoji-picker');
    if (picker) picker.hidden = true;
  }

  // Conversation search (within current chat)
  function openMsgSearch() {
    if (!activeChat) return;
    msgSearchActive = true;
    const inputEl = $('#ai-msg-search-input');
    const results = $('#ai-msg-search-results');
    showSheet('#ai-msg-search-sheet');
    if (inputEl) { inputEl.value = ''; inputEl.focus(); }
    if (results) results.replaceChildren();
    renderMessages(); // highlights matches
  }

  function closeMsgSearch() {
    msgSearchActive = false;
    hideAllSheets(true);
    renderMessages();
  }

  function renderMsgSearchResults() {
    if (!activeChat) return;
    const results = $('#ai-msg-search-results');
    const inputEl = $('#ai-msg-search-input');
    const term = inputEl ? inputEl.value.trim().toLowerCase() : '';
    results.replaceChildren();
    if (!term) return;
    const matches = activeChat.messages.filter(m => String(m.text || '').toLowerCase().includes(term));
    for (const m of matches.slice(0, 50)) {
      // A real button: the row is reachable by keyboard and announced as a
      // control (the click-only div it replaced was unreachable for anyone
      // not using a mouse).
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'ai-msg-search-result';
      row.setAttribute('data-msg-id', m.id);
      const role = document.createElement('div');
      role.className = 'ai-msg-search-role';
      role.textContent = m.role === 'user' ? 'You' : 'Dexerion AI';
      const text = document.createElement('div');
      text.className = 'ai-msg-search-text';
      // Message text is untrusted (a model reply or pasted text can carry
      // markup) and this renderer holds the privileged window.dexerion bridge,
      // so the highlight is built from text nodes - never from innerHTML.
      renderHighlighted(text, String(m.text || ''), term);
      const time = document.createElement('div');
      time.className = 'ai-msg-search-time';
      time.textContent = dateLabel(m.ts || Date.now());
      row.append(role, text, time);
      row.onclick = () => { closeMsgSearch(); jumpToMessage(m.id); };
      results.appendChild(row);
    }
  }

  // Wrap every match of `term` in a span, using text nodes for the rest.
  // The text never becomes markup, so a message containing HTML is shown as
  // the characters it is instead of being executed.
  function renderHighlighted(el, text, term) {
    el.replaceChildren();
    const src = String(text || '');
    if (!term) { el.textContent = src; return; }
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(' + esc + ')', 'gi');
    let last = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      if (m.index > last) el.appendChild(document.createTextNode(src.slice(last, m.index)));
      const span = document.createElement('span');
      span.className = 'ai-msg-search-match';
      span.textContent = m[0];
      el.appendChild(span);
      last = m.index + m[0].length;
    }
    if (last < src.length) el.appendChild(document.createTextNode(src.slice(last)));
  }

  function jumpToMessage(messageId) {
    if (!activeChat) return;
    const el = document.querySelector('[data-msg-id="' + messageId + '"]');
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ai-msg-highlight');
    setTimeout(() => el.classList.remove('ai-msg-highlight'), 1400);
  }

  // Smooth scroll helpers
  function scrollToBottom() {
    messages.scrollTop = messages.scrollHeight;
  }
  function scrollToTop() {
    messages.scrollTop = 0;
  }

  // Float scroll buttons visibility
  function updateScrollFloats() {
    const bottom = $('#ai-scroll-bottom');
    const top = $('#ai-scroll-top');
    if (!bottom || !top) return;
    // A settings/history sheet covers the thread: the floats belong to the
    // message list, and over a form they sit on top of the controls.
    const sheetOpen = !!document.querySelector('.ai-panel:not([hidden])');
    if (sheetOpen) {
      bottom.hidden = true;
      top.hidden = true;
      return;
    }
    // Nothing to scroll (an empty or short thread): neither affordance helps.
    if (messages.scrollHeight <= messages.clientHeight + 4) {
      bottom.hidden = true;
      top.hidden = true;
      return;
    }
    const nearBottom = messages.scrollTop >= messages.scrollHeight - messages.clientHeight - 40;
    bottom.hidden = nearBottom;
    top.hidden = messages.scrollTop <= 40;
  }

  function visibleChats() {
    const term = search.value.trim().toLowerCase();
    return term ? chats.filter(chat => chat.title.toLowerCase().includes(term)) : chats;
  }

  function renderList() {
    list.replaceChildren();
    const shown = visibleChats();
    if (!shown.length) {
      const p = document.createElement('p');
      p.className = 'ai-hist-empty';
      p.textContent = activeChat ? 'No other chats yet.' : 'No saved chats yet.';
      list.appendChild(p);
    }    for (const chat of shown) {
      const row = document.createElement('div');
      row.className = 'ai-chat-row' + (activeChat && activeChat.id === chat.id ? ' active' : '');
      row.tabIndex = 0;
      row.dataset.id = chat.id;
      const main = document.createElement('div');
      main.className = 'chat-main';
      const name = document.createElement('b');
      name.textContent = chat.title;
      const sub = document.createElement('small');
      sub.textContent = `${dateLabel(chat.updatedAt)} · ${chat.messageCount || 0} message${chat.messageCount === 1 ? '' : 's'}`;
      main.append(name, sub);
      const actions = document.createElement('div');
      actions.className = 'ai-row-actions';
      const rename = document.createElement('button');
      rename.type = 'button';
      rename.className = 'ai-row-btn';
      rename.title = 'Rename chat';
      rename.setAttribute('aria-label', 'Rename chat');
      rename.textContent = '✎';
      rename.onclick = event => {
        event.stopPropagation();
        renameChat(chat);
      };
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'ai-row-btn danger';
      del.title = 'Delete chat';
      del.setAttribute('aria-label', 'Delete chat');
      del.textContent = '⌫';
      del.onclick = event => {
        event.stopPropagation();
        deleteChatById(chat.id);
      };
      actions.append(rename, del);
      row.append(main, actions);
      row.onclick = () => openChat(chat.id);
      row.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openChat(chat.id); } };
      list.appendChild(row);
    }
  }

  function renderMessages() {
    messages.replaceChildren();
    // The empty card lives inside the thread; replaceChildren detaches it —
    // put it back before deciding whether it shows, or "How can I help?"
    // would be gone for the rest of the session.
    if (empty && empty.parentNode !== messages) messages.appendChild(empty);
    if (!activeChat) {
      empty.hidden = false;
      paintTaskbarTitle();
      // No conversation yet is exactly when the starters matter most.
      renderSuggestions();
      return;
    }
    empty.hidden = activeChat.messages.length > 0;
    paintTaskbarTitle();
    if (!activeChat.messages.length) {
      renderSuggestions();
      return;
    }
    renderSuggestions();
    // Cap the painted DOM: very long chats appended unboundedly and each
    // keystroke re-rendered the whole history, freezing the sidebar.
    const offset = Math.max(0, activeChat.messages.length - 200);
    const items = offset ? activeChat.messages.slice(offset) : activeChat.messages;
    items.forEach((message, i) => addMessage(
      message.role, message.text, true, message.images, message.context, message.steps,
      {
        usage: message.usage, isLast: i === items.length - 1, plan: message.plan, search: message.search,
        artifact: message.artifact, model: message.model, thinking: message.thinking, index: offset + i,
        metrics: message.metrics, partial: message.partial, remaining: message.remaining,
        // Interactive progress (quiz answers, deck marks) lives beside the
        // artifact; without it here the card restarted at question one on every
        // reopen while the stored state sat unused in the profile.
        artifactState: message.artifactState,
        id: message.id, ts: message.ts, reactions: message.reactions, pinned: message.pinned,
        edited: message.edited, editedAt: message.editedAt, replyTo: message.replyTo,
        mentions: message.mentions, forwardedFrom: message.forwardedFrom, myReactions: message.myReactions,
      }, false));
    // One measurement at the end of the synchronous redraw. Reading
    // scrollHeight after every append forces layout for each message.
    scrollToBottom();
    // A revision can add a new version while the report view is open.
    const sheet = $('#ai-report-sheet');
    if (sheet && !sheet.hidden) refreshReportItems();
    if (msgSearchActive) renderMsgSearchResults();
    updateScrollFloats();
    // Cards and previews land after this paint and make the thread taller, so
    // the scroll affordances are re-checked once the layout settles. Without
    // this the "jump to bottom" button could sit over the next message.
    const settle = () => updateScrollFloats();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(settle);
    clearTimeout(renderMessages._settle);
    renderMessages._settle = setTimeout(settle, 260);
  }

  function openAiLink(url) {
    window.dexerion.invoke('dex:navigate', null, url).catch(() => {});
  }

  // Model replies go through the shared DexMarkdown filter (bold, italic,
  // headings, lists, links, code) so formatting renders instead of leaking
  // raw symbols. Falls back to the legacy code-only renderer if the shared
  // module failed to load.
  function renderMarkdown(element, value) {
    if (window.DexMarkdown) {
      window.DexMarkdown.render(element, value, { onLink: openAiLink });
      return;
    }
    element.replaceChildren();
    const parts = String(value || '').split('```');
    parts.forEach((part, index) => {
      if (index % 2) {
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.textContent = part.replace(/^[a-zA-Z0-9+#-]*\n/, '');
        pre.appendChild(code);
        element.appendChild(pre);
        return;
      }
      part.split(/`([^`\n]+)`/).forEach((segment, segmentIndex) => {
        if (segmentIndex % 2) {
          const code = document.createElement('code');
          code.textContent = segment;
          element.appendChild(code);
        } else if (segment) element.appendChild(document.createTextNode(segment));
      });
    });
  }

  function addMessage(role, value, includeLabel, images, context, steps, extra, autoScroll = true) {
    const message = document.createElement('div');
    message.className = 'ai-message ' + (role === 'user' ? 'user' : 'model');
    const id = extra && extra.id ? String(extra.id) : ('msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));
    message.setAttribute('data-msg-id', id);
    message.style.position = 'relative';
    const pinned = Boolean(extra && extra.pinned);
    const edited = Boolean(extra && extra.edited);
    const editedAt = extra && extra.editedAt ? new Date(extra.editedAt) : null;
    const reactions = extra && extra.reactions ? extra.reactions : {};
    const myReactions = extra && extra.myReactions ? extra.myReactions : [];
    const replyTo = extra && extra.replyTo ? extra.replyTo : null;
    const mentions = extra && extra.mentions ? extra.mentions : [];
    const forwardedFrom = extra && extra.forwardedFrom ? extra.forwardedFrom : null;
    const isTargeted = targetedMessage && targetedMessage.id === id;
    const isEditing = editingMessageId === id;

    // Pinned indicator.
    if (pinned) {
      const pin = document.createElement('div');
      pin.className = 'ai-msg-pin';
      pin.title = 'Pinned message';
      pin.setAttribute('aria-label', 'Pinned message');
      pin.textContent = '📌';
      message.appendChild(pin);
    }

    // Avatar.
    const avatar = document.createElement('div');
    avatar.className = 'ai-message-avatar';
    if (role === 'user') {
      const letter = (activeChat && activeChat.title ? activeChat.title.charAt(0) : 'U').toUpperCase();
      avatar.textContent = letter;
    } else {
      avatar.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M3 12h3M18 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/><circle cx="12" cy="12" r="4"/></svg>';
    }
    message.appendChild(avatar);

    // Message column (bubble, cards, gallery, meta — one shared width).
    const wrap = document.createElement('div');
    wrap.className = 'ai-message-wrap';
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.flex = '1';
    wrap.style.minWidth = '0';
    wrap.style.gap = '6px';
    if (role === 'user') wrap.style.alignItems = 'flex-end';

    // Reply context preview (threading).
    if (replyTo) {
      const replied = messageById(replyTo);
      const preview = document.createElement('div');
      preview.className = 'ai-msg-reply';
      const kind = document.createElement('div');
      kind.className = 'ai-msg-reply-kind';
      kind.textContent = 'Replying to ' + (replied && replied.role === 'user' ? 'you' : 'Dexerion AI');
      const text = document.createElement('div');
      text.className = 'ai-msg-reply-text';
      text.textContent = replyPreview(replied && replied.text ? replied.text : '');
      const ra = document.createElement('div');
      ra.className = 'ai-msg-reply-avatar';
      ra.textContent = (replied && replied.role === 'user' ? 'U' : 'D');
      preview.append(ra, kind, text);
      wrap.appendChild(preview);
    }

    // Forwarded-from indicator.
    if (forwardedFrom) {
      const fwd = document.createElement('div');
      fwd.className = 'ai-ctx';
      fwd.textContent = '↪ Forwarded';
      fwd.title = 'Forwarded message';
      wrap.appendChild(fwd);
    }

    // Bubble.
    const bubble = document.createElement('div');
    bubble.className = 'text';
    bubble.style.position = 'relative';

    if (isEditing) {
      // Inline editor.
      const editor = document.createElement('div');
      editor.className = 'ai-msg-editor';
      editor.id = 'ai-msg-editor-' + id;
      const ta = document.createElement('textarea');
      ta.id = 'ai-edit-input-' + id;
      ta.rows = 3;
      ta.value = value || '';
      ta.placeholder = 'Edit your message…';
      ta.onkeydown = (ev) => {
        if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); commitEdit(id); }
        else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); cancelEdit(); }
      };
      const actions = document.createElement('div');
      actions.className = 'ai-msg-editor-actions';
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'ai-msg-save';
      save.textContent = 'Save';
      save.onclick = () => commitEdit(id);
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'ai-msg-cancel';
      cancel.textContent = 'Cancel';
      cancel.onclick = cancelEdit;
      actions.append(save, cancel);
      editor.append(ta, actions);
      bubble.appendChild(editor);
    } else {
      if (role === 'model' && value) renderMarkdown(bubble, value);
      else bubble.textContent = value || '';
    }
    // A saved reply whose whole body became an artifact card carries no
    // bubble text; hide the empty pill so the message reads as the preview
    // itself instead of an empty box. The live streaming bubble (no extra,
    // no label) always stays visible for the typing indicator.
    if (role === 'model' && !value && includeLabel && extra && extra.artifact && !isEditing) bubble.hidden = true;

    // The bubble joins the column first: context chips, plans and step
    // traces are inserted before it below, which requires it to be attached.
    wrap.appendChild(bubble);

    // Mention highlight: wrap @mentions in model text with a chip.
    if (role === 'model' && mentions.length && !isEditing) {
      // Mentions are already highlighted via renderMarkdown if present; here we
      // also add a subtle underline. The actual highlight happens in the text.
    }

    // Page context chip (Phase 1 read-page): shows exactly what page text
    // was sent with this turn. Click reveals the full block.
    if (context && context.label && !isEditing) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'ai-ctx';
      chip.textContent = '◉ ' + context.label;
      chip.title = 'Show the exact page text sent';
      chip.onclick = () => {
        const open = chip.nextElementSibling;
        if (open && open.classList.contains('ai-ctx-body')) { open.remove(); return; }
        const body = document.createElement('div');
        body.className = 'ai-ctx-body';
        body.textContent = context.text || '';
        chip.after(body);
      };
      wrap.insertBefore(chip, bubble);
    }

    // Plan checklist recorded with the run (update_plan), read-only on reload.
    if (extra && extra.plan && !isEditing) {
      const planEl = makePlanEl(extra.plan);
      if (planEl) wrap.insertBefore(planEl, bubble);
    }

    // Agent step trace: the run's actions, read-only on reload.
    if (Array.isArray(steps) && steps.length && !isEditing) {
      const wrapSteps = document.createElement('div');
      wrapSteps.className = 'ai-steps';
      for (const s of steps) wrapSteps.appendChild(makeStepRow(s));
      wrap.insertBefore(wrapSteps, bubble);
    }

    // Edited indicator.
    if (edited) {
      const ed = document.createElement('div');
      ed.className = 'ai-msg-edited';
      ed.textContent = 'edited' + (editedAt ? ' · ' + dateLabel(editedAt) : '');
      wrap.appendChild(ed);
    }

    // Attachments gallery.
    if (images && images.length) {
      const gallery = document.createElement('div');
      gallery.className = 'ai-message-images';
      for (const image of images) {
        const thumbnail = document.createElement('img');
        thumbnail.src = image.url;
        thumbnail.alt = image.name || 'Attached image';
        gallery.appendChild(thumbnail);
      }
      wrap.appendChild(gallery);
    }

    // Structured artifact preview — application-owned rendering, never raw
    // model HTML in this renderer. The site kind is sandboxed by the renderer.
    if (role === 'model' && extra && extra.artifact && window.DexArtifacts && !isEditing) {
      // A freshly generated artifact (no saved state yet) gets a small "new"
      // indicator so the person can tell a skill just made it vs. a restored
      // one from an earlier chat.
      if (!extra.artifactState) {
        const badge = document.createElement('span');
        badge.className = 'ai-badge';
        badge.textContent = 'New';
        wrap.appendChild(badge);
      }
      window.DexArtifacts.render(wrap, extra.artifact, {
        onLink: openAiLink,
        onToast: hintNote,
        // The Code panel edits this exact message: it needs where the artifact
        // lives so a save can write back to the stored chat.
        chatId: activeChat && activeChat.id,
        index: extra.index,
        // Quiz answers / known flashcards: restored from the stored message and
        // written back (debounced) so a reload keeps the person's place.
        state: extra.artifactState,
        onState: (state) => {
          const chatId = activeChat && activeChat.id;
          if (!chatId || !Number.isInteger(extra.index)) return;
          if (extra) extra.artifactState = state;
          // One timer per message: a shared timer let a second artifact's
          // progress cancel the first one's pending write, so the quiz answer
          // was lost on reload.
          clearTimeout(extra.stateTimer);
          extra.stateTimer = setTimeout(() => {
            window.dexerion.invoke('dex:ai-artifact-state-set', { chatId, index: extra.index, state }).catch(() => {});
          }, 600);
        },
        // Full-page view for every kind; the report overlay stays available
        // through Design for reports.
        onOpenTab: () => {
          const chatId = activeChat && activeChat.id;
          if (!chatId || !Number.isInteger(extra.index)) return;
          const url = 'dexerion://artifact?chat=' + encodeURIComponent(chatId) + '&i=' + extra.index;
          window.dexerion.invoke('dex:new-tab', url, false).catch(() => hintNote('Could not open the artifact.'));
        },

        onRegenerate: () => regenerateArtifact(extra.index),
        // Focus preview: the dedicated interactive surface beside the chat.
        onFocusOverlay: () => {
          const chatId = activeChat && activeChat.id;
          if (!chatId || !Number.isInteger(extra.index)) return;
          window.dexerion.invoke('dex:site-overlay-open', { chatId, index: extra.index })
            .catch(() => hintNote('Could not open the preview.'));
        },
        // The preview's health strip hands the validator's concrete issues
        // back here; the model gets the list, not a vague complaint.
        onFixIssues: (issues) => fixSiteIssues(extra.index, issues),
        onOpen: (artifact) => openReportTab(artifact, extra.index),
        onDesign: (artifact) => openReport(artifact, extra.index),
        // The card's notes chip (V18): the same overlay, notes panel ready.
        onOpenNotes: () => {
          const chatId = activeChat && activeChat.id;
          if (!chatId || !Number.isInteger(extra.index)) return;
          window.dexerion.invoke('dex:report-overlay-open', { chatId, index: extra.index, panel: 'notes' })
            .catch(() => hintNote('Could not open the notes.'));
        },
        onArtifactSaved: (artifact) => {
          // Keep the in-memory transcript in step with the saved artifact so a
          // repaint does not show the pre-edit version.
          if (extra) extra.artifact = artifact;
        },
        onGradeShort: (payload) => window.dexerion.invoke('dex:ai-grade-short', payload),
      });
    }

    // Search provenance (Search With Dexerion AI).
    if (extra && extra.search && !isEditing) {
      const sources = Array.isArray(extra.search.sources) ? extra.search.sources : [];
      const adaptations = Array.isArray(extra.search.adaptations) ? extra.search.adaptations : [];
      const stats = extra.search.stats || {};
      const meta = document.createElement('div');
      meta.className = 'ai-search-meta';
      const head = document.createElement('div');
      head.className = 'ai-search-head';
      const seconds = stats.ms ? Math.max(1, Math.round(Number(stats.ms) / 1000)) : 0;
      head.textContent = 'Searched ' + sources.length + ' source' + (sources.length === 1 ? '' : 's')
        + (seconds ? ' · ' + seconds + 's' : '');
      meta.appendChild(head);
      sources.forEach((source, index) => {
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'ai-search-src';
        link.textContent = '[' + (index + 1) + '] ' + (source.title || source.url || '');
        link.title = source.url || '';
        link.onclick = (event) => { event.stopPropagation(); if (source.url) openAiLink(source.url); };
        meta.appendChild(link);
      });
      if (adaptations.length) {
        const details = document.createElement('details');
        details.className = 'ai-search-adapt';
        const summary = document.createElement('summary');
        summary.textContent = 'Adapted searches (' + adaptations.length + ')';
        details.appendChild(summary);
        for (const query of adaptations) {
          const row = document.createElement('p');
          row.textContent = query;
          details.appendChild(row);
        }
        meta.appendChild(details);
      }
      wrap.appendChild(meta);
    }

    // The model's reasoning channel: collapsible, closed by default.
    if (role === 'model' && extra && extra.thinking && !isEditing) {
      const box = document.createElement('details');
      box.className = 'ai-think';
      const sum = document.createElement('summary');
      sum.textContent = 'Thinking';
      const body = document.createElement('div');
      body.className = 'ai-think-body';
      body.textContent = String(extra.thinking).slice(0, 4000);
      box.append(sum, body);
      wrap.appendChild(box);
    }

    message.appendChild(wrap);

    // Hover actions menu (reactions / pin / edit / forward / reply).
    const actionsMenu = document.createElement('div');
    actionsMenu.className = 'ai-msg-actions';
    const mkAction = (icon, title, label, fn, active) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ai-msg-action' + (active ? ' is-active' : '');
      b.title = title;
      b.setAttribute('aria-label', label);
      b.innerHTML = icon;
      b.onclick = (ev) => { ev.stopPropagation(); ev.preventDefault(); fn(); };
      return b;
    };
    // Reply (thread)
    actionsMenu.appendChild(mkAction(
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12h12M12 12l-3-3-3 3"/><path d="M16 18v-4M16 10l-3-3-3 3"/></svg>',
      'Reply', 'Reply to this message', () => { setTarget('reply', id); }, Boolean(replyTo)
    ));
    // Forward
    actionsMenu.appendChild(mkAction(
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 5l4 4-4 4M20 12h-14M6 16h14"/></svg>',
      'Forward', 'Forward this message', () => { setTarget('forward', id); }
    ));
    // Edit (own messages only)
    if (role === 'user') {
      actionsMenu.appendChild(mkAction(
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
        'Edit', 'Edit this message', () => { startEdit(id); }
      ));
    }
    // Pin
    actionsMenu.appendChild(mkAction(
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10l-7-7M21 10l-7 7M21 10l7 7"/></svg>',
      pinned ? 'Unpin' : 'Pin', pinned ? 'Unpin message' : 'Pin message', () => { togglePin(id); closeEmojiPicker(); }, pinned
    ));
    // Reactions
    actionsMenu.appendChild(mkAction(
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/></svg>',
      'Add reaction', 'Add emoji reaction', () => { openEmojiPicker(id); closeEmojiPicker(); openEmojiPicker(id); }
    ));
    message.appendChild(actionsMenu);

    // Reactions bar (below bubble).
    const reactionCount = Object.values(reactions).reduce((a, b) => a + b, 0);
    if (reactionCount || myReactions.length) {
      const reactionsBox = document.createElement('div');
      reactionsBox.className = 'ai-reactions';
      for (const [emoji, count] of Object.entries(reactions)) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'ai-reaction' + (myReactions.includes(emoji) ? ' is-self' : '');
        chip.title = emoji + ' · ' + count;
        const emojiSpan = document.createElement('span');
        emojiSpan.textContent = emoji;
        const countSpan = document.createElement('span');
        countSpan.className = 'ai-reaction-count';
        countSpan.textContent = count;
        chip.append(emojiSpan, countSpan);
        chip.onclick = (ev) => { ev.stopPropagation(); toggleReaction(id, emoji); };
        reactionsBox.appendChild(chip);
      }
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'ai-reaction-btn';
      addBtn.textContent = '+';
      addBtn.title = 'Add reaction';
      addBtn.onclick = (ev) => { ev.stopPropagation(); openEmojiPicker(id); };
      reactionsBox.appendChild(addBtn);
      wrap.appendChild(reactionsBox);
    }

    // Meta row: usage + time + copy/retry.
    if (role === 'model' && includeLabel) {
      const meta = document.createElement('div');
      meta.className = 'ai-msg-meta';
      const use = extra && extra.usage;
      const bits = [];
      if (uiPrefs.showUsage && use && use.input_tokens != null) bits.push(Number(use.input_tokens).toLocaleString() + ' in');
      if (uiPrefs.showUsage && use && use.output_tokens != null) bits.push(Number(use.output_tokens).toLocaleString() + ' out');
      if (bits.length) {
        const u = document.createElement('span');
        u.className = 'ai-usage';
        u.textContent = bits.join(' · ');
        meta.appendChild(u);
      }
      // Reply speed, when the transport measured it. Kept terse and only
      // shown with the usage readout so the row stays quiet.
      const speed = extra && extra.metrics;
      if (uiPrefs.showUsage && speed && Number(speed.ms) > 0) {
        const s = document.createElement('span');
        s.className = 'ai-usage';
        const first = Number(speed.firstTokenMs) > 0 ? (speed.firstTokenMs / 1000).toFixed(1) + 's to first token' : '';
        const rate = Number(speed.charsPerSec) > 0 ? speed.charsPerSec + ' c/s' : '';
        s.textContent = [first, rate].filter(Boolean).join(' · ');
        s.title = Math.round(speed.ms / 100) / 10 + 's total · ' + (speed.chars || 0) + ' characters'
          + (speed.thinkingChars ? ' · ' + speed.thinkingChars + ' thinking' : '');
        if (s.textContent) meta.appendChild(s);
      }
      const time = document.createElement('span');
      time.className = 'ai-usage';
      time.textContent = dateLabel(extra && extra.ts);
      meta.appendChild(time);
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'ai-meta-btn';
      copy.textContent = 'Copy';
      copy.onclick = () => {
        const done = () => hintNote('Copied.');
        try {
          const p = navigator.clipboard.writeText(value || '');
          if (p && p.then) p.then(done, () => hintNote('Copy failed.'));
          else done();
        } catch { hintNote('Copy failed.'); }
      };
      meta.appendChild(copy);
      // A task that stopped short: say so, and make carrying on one click.
      if (extra && extra.partial) {
        const partial = document.createElement('span');
        partial.className = 'ai-partial-chip';
        partial.textContent = 'stopped early';
        const detail = Array.isArray(extra.remaining) && extra.remaining.length
          ? 'Still open: ' + extra.remaining.join('; ')
          : 'The task stopped before the assistant said it was finished.';
        partial.title = detail;
        // Reachable by keyboard, and the reason is announced rather than hidden
        // in a tooltip only a mouse can read.
        partial.tabIndex = 0;
        partial.setAttribute('role', 'note');
        partial.setAttribute('aria-label', 'Stopped early. ' + detail);
        meta.appendChild(partial);
        const carry = document.createElement('button');
        carry.type = 'button';
        carry.className = 'ai-meta-btn';
        carry.textContent = 'Continue';
        carry.onclick = () => continueTask(extra.remaining);
        meta.appendChild(carry);
      }
      if (extra && extra.isLast) {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'ai-meta-btn';
        retry.textContent = 'Retry';
        retry.onclick = () => retryLast();
        meta.appendChild(retry);
      }
      wrap.appendChild(meta);
    }

    messages.appendChild(message);
    if (autoScroll) scrollToBottom();
    return bubble;
  }

  let hasKey = false;
  let lastStatus = null;

  // ---------- Page reading (Phase 1: scAI exact extract process) ----------
  // The toggle persists per account in main (dex:ai-page-get/set). When on,
  // submit() captures the active tab via dex:ai-read-page and the model gets
  // the whole page as a <page_context> block.
  let pagePrefs = { usePage: false, fullPage: false, contextChars: 12000, useSelection: true };
  // Per-site switch for the active tab (hostname + off), read from main.
  let sitePrefs = { host: '', off: false };

  function paintPageToggle() {
    const strip = document.getElementById('ai-page-strip');
    const active = pagePrefs.usePage && !sitePrefs.off;
    if (strip) strip.hidden = !active;
  }

  async function refreshPageStrip() {
    const label = document.getElementById('ai-page-label');
    if (!pagePrefs.usePage || !label) return;
    try {
      const info = await window.dexerion.invoke('dex:ai-read-page').catch(() => null);
      if (info && info.ok && info.context) label.textContent = 'Reading: ' + (info.title || info.url || 'this page');
      else label.textContent = 'This page can\'t be read';
    } catch {
      label.textContent = 'Reading this page';
    }
  }

  async function loadPagePrefs() {
    const [prefs, site] = await Promise.all([
      window.dexerion.invoke('dex:ai-page-get').catch(() => null),
      window.dexerion.invoke('dex:ai-site-get').catch(() => null),
    ]);
    if (prefs && typeof prefs === 'object') pagePrefs = prefs;
    if (site && typeof site === 'object') sitePrefs = site;
    paintPageToggle();
  }

  // Context-menu handoff: a prompt stashed by the page menu, picked up when
  // the panel opens. Fills the composer (never auto-sends).
  async function consumePending() {
    const pending = await window.dexerion.invoke('dex:ai-take-pending').catch(() => null);
    if (!pending) return;
    // The Files page asks for a chat to be opened, not a page to be read.
    if (pending.kind === 'chat') {
      if (pending.chatId) await openChat(pending.chatId);
      return;
    }
    // The app menu's New AI chat: start fresh in one step.
    if (pending.kind === 'new-chat') {
      await createChat();
      return;
    }
    if (!pagePrefs.usePage) await togglePage(true);
    if (pending.kind === 'page') {
      input.value = 'Summarise this page in five bullet points.';
    } else {
      input.value = pending.text
        ? 'About this passage:\n\n"' + String(pending.text).slice(0, 600) + '"\n\n'
        : '';
    }
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
    input.focus();
  }

  async function togglePage(force) {
    const next = typeof force === 'boolean' ? force : !pagePrefs.usePage;
    // Turning reading on while the site is switched off is the person asking
    // for it back: clear the per-site flag first, then continue.
    if (next && sitePrefs && sitePrefs.off) {
      const res = await window.dexerion.invoke('dex:ai-site-set', { off: false }).catch(() => null);
      if (res && typeof res === 'object') sitePrefs = res;
      if (sitePrefs.off) { hintNote('Dexerion AI is off for this site.'); return; }
    }
    const prefs = await window.dexerion.invoke('dex:ai-page-set', { usePage: next }).catch(() => null);
    if (prefs && typeof prefs === 'object') pagePrefs = prefs;
    else pagePrefs.usePage = next;
    paintPageToggle();
    if (next) {
      await refreshPageStrip();
      if ((document.getElementById('ai-page-label') || {}).textContent === 'This page can\'t be read') {
        hintNote('This kind of page can\'t be read.');
      }
    }
  }

  // ---------- All-tabs inspection (the Read button's full workflow) ---------
  // Identical process to the agent's inspect_tabs tool: main lists every open
  // tab, reads each one individually (stable ids, no substitution), streams
  // per-tab progress, and returns a consolidated report. Kept in the chat so
  // it persists, with one step row per tab.
  let inspecting = false;
  let inspectCard = null;

  async function runTabInspection() {
    if (inspecting) { hintNote('Already reading your tabs…'); return; }
    if (busy) { hintNote('Wait for the current action to finish.'); return; }
    if (!activeChat) {
      hintNote('Starting a new chat…');
      await createChat();
      if (!activeChat) return;
    }
    inspecting = true;
    const reqId = 'inspect-' + Date.now() + Math.random().toString(36).slice(2, 7);
    const chatId = activeChat.id;
    // Live card: a status line plus one step row per tab, painted from the
    // main process's per-tab progress events.
    const msgWrap = document.createElement('div');
    msgWrap.className = 'ai-message model';
    const status = document.createElement('div');
    status.className = 'text';
    status.textContent = 'Reading every open tab…';
    const stepsEl = document.createElement('div');
    stepsEl.className = 'ai-steps';
    msgWrap.append(status, stepsEl);
    messages.appendChild(msgWrap);
    messages.scrollTop = messages.scrollHeight;
    inspectCard = { reqId, status, stepsEl, rows: new Map(), steps: [] };
    try {
      const result = await window.dexerion.invoke('dex:ai-inspect-tabs', { reqId });
      if (!result || !result.ok) {
        status.textContent = '⚠ ' + ((result && result.error) || 'The inspection did not finish.');
        hintNote((result && result.error) || 'The inspection did not finish.');
        return;
      }
      const message = { role: 'model', text: result.text, steps: inspectCard.steps.slice() };
      const saved = await window.dexerion.invoke('dex:ai-chat-append', { id: chatId, message });
      if (activeChat && activeChat.id === chatId) {
        activeChat = saved;
        renderList();
        renderMessages(); // replaces the transient card with the saved report
      } else {
        await refreshChatList();
      }
    } catch (error) {
      status.textContent = '⚠ ' + (error.message || 'The inspection did not finish.');
    } finally {
      inspectCard = null;
      inspecting = false;
      input.focus();
    }
  }

  // ---------- Agentic actions (Phase 2/3: scAI agent loop, main-owned) -----
  // The loop runs in main; here lives the toggle, runbar, live step trace,
  // tier-3 confirmation UI, and the 1s lease ping (dead-man layer 3).
  let agentPrefs = { agent: false };
  let agentRun = null; // { id, stepsEl, label, seenSteps, leaseTimer }

  // ---------- Capability switches (lightning / eye / AI requests) ----------
  // Main owns the persisted values. The renderer only paints them and sends
  // explicit user decisions; a model never writes these directly.
  const CAP_LABELS = {
    agent: 'Agent mode',
    vision: 'Vision',
    websites: 'Website access',
    documents: 'Document editing',
  };
  let aiCaps = { agent: false, vision: false, websites: false, documents: false };

  function paintCapToggles() {
    const set = (id, cap) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      const on = Boolean(aiCaps[cap]);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.title = CAP_LABELS[cap] + ': ' + (on ? 'on' : 'off');
      btn.setAttribute('aria-label', (on ? 'Turn off ' : 'Turn on ') + CAP_LABELS[cap]);
    };
    set('ai-agent-toggle', 'agent');
    set('ai-vision-toggle', 'vision');
  }

  async function loadCaps() {
    const caps = await window.dexerion.invoke('dex:ai-caps-get').catch(() => null);
    if (caps && typeof caps === 'object') aiCaps = caps;
    paintCapToggles();
  }

  async function toggleCap(cap, force) {
    if (!CAP_LABELS[cap]) return;
    const next = typeof force === 'boolean' ? force : !aiCaps[cap];
    const caps = await window.dexerion.invoke('dex:ai-caps-set', { [cap]: next }).catch(() => null);
    if (caps && typeof caps === 'object') aiCaps = caps;
    else aiCaps[cap] = next;
    paintCapToggles();
    await Promise.all([loadAgentPrefs(), loadPagePrefs()]);
    hintNote(CAP_LABELS[cap] + (next ? ' on.' : ' off.'));
    if (cap === 'agent' && !next && agentRun) stopAgentRun();
  }

  window.dexerion.on('dex:ai-caps-updated', (caps) => {
    if (!caps || typeof caps !== 'object') return;
    aiCaps = caps;
    paintCapToggles();
    loadAgentPrefs();
    loadPagePrefs();
    const sites = document.getElementById('ai-set-websites');
    if (sites) sites.checked = Boolean(caps.websites);
    const docs = document.getElementById('ai-set-documents');
    if (docs) docs.checked = Boolean(caps.documents);
  });

  function makeStepRow(step) {
    const d = document.createElement('details');
    d.className = 'ai-step is-' + ((step && step.status) || 'live');
    d.dataset.n = (step && step.n) || 0;
    const sum = document.createElement('summary');
    const dot = document.createElement('span');
    dot.className = 'ai-step-dot';
    const n = document.createElement('span');
    n.className = 'ai-step-n';
    n.textContent = (step && step.n) || '';
    const what = document.createElement('span');
    what.className = 'ai-step-what';
    what.textContent = (step && step.what) || '';
    sum.append(dot, n, what);
    // Duration, once the action has finished (a running step has none yet).
    if (step && Number(step.ms) > 0) {
      const ms = document.createElement('span');
      ms.className = 'ai-step-ms';
      ms.textContent = step.ms >= 1000 ? (step.ms / 1000).toFixed(1) + 's' : Math.round(step.ms) + 'ms';
      sum.appendChild(ms);
    }
    d.appendChild(sum);
    const body = document.createElement('div');
    body.className = 'ai-step-body';
    body.textContent = (step && step.detail) || '…';
    d.appendChild(body);
    return d;
  }

  function paintStepRow(row, step) {
    const prevStatus = row.dataset.prevStatus;
    const nextStatus = step.status || 'live';
    row.className = 'ai-step is-' + nextStatus;
    row.dataset.prevStatus = nextStatus;
    // Flash when a step reaches a terminal state (ok/bad/asked)
    if (prevStatus && prevStatus !== nextStatus && (nextStatus === 'ok' || nextStatus === 'bad' || nextStatus === 'asked')) {
      row.classList.add('ai-step-dot-anim');
      setTimeout(() => row.classList.remove('ai-step-dot-anim'), 600);
    }
    const what = row.querySelector('.ai-step-what');
    if (what) what.textContent = step.what || '';
    const body = row.querySelector('.ai-step-body');
    if (body) body.textContent = step.detail || '';
    let ms = row.querySelector('.ai-step-ms');
    if (Number(step.ms) > 0) {
      if (!ms) {
        ms = document.createElement('span');
        ms.className = 'ai-step-ms';
        const summary = row.querySelector('summary');
        if (summary) summary.appendChild(ms);
      }
      ms.textContent = step.ms >= 1000 ? (step.ms / 1000).toFixed(1) + 's' : Math.round(step.ms) + 'ms';
    }
  }

  // Live mirror of the step trace while the send is still running; the saved
  // copy repaints from the chat store once the reply lands.
  function addLiveStep(step) {
    if (!liveStepsEl || !liveStepsEl.isConnected) return;
    const row = makeStepRow(step);
    row.dataset.skill = String(step.name || '');
    liveStepsEl.appendChild(row);
    messages.scrollTop = messages.scrollHeight;
  }
  // Research skills get a row per call (three web searches = three rows).
  // A deliverable is one job even when the model retries it, so keep a single
  // row and put each attempt's result back into that row.
  function oneRowPerSkill(name) {
    return name === 'make_report' || name === 'make_site' || name === 'revise_artifact';
  }
  function upsertLiveStep(step) {
    if (oneRowPerSkill(step.name)) {
      const existing = skillSteps.find((s) => s.name === step.name);
      if (existing) {
        existing.status = 'live';
        existing.detail = '';
        existing.ms = 0;
        updateLiveStep(step.name, 'live', '');
        return;
      }
    }
    skillSteps.push(step);
    addLiveStep(step);
  }
  function updateLiveStep(skillId, status, detail) {
    if (!liveStepsEl || !liveStepsEl.isConnected) return;
    const row = liveStepsEl.querySelector('.ai-step[data-skill="' + String(skillId || '') + '"]');
    if (!row) return;
    row.className = 'ai-step is-' + status;
    const body = row.querySelector('.ai-step-body');
    if (body) body.textContent = detail || '';
  }

  // Plan checklist (update_plan): goal + steps with per-step state. Rendered
  // in the live run bubble, in saved messages, and in the missions sheet.
  function makePlanEl(plan, nextSteps) {
    if (!plan || !Array.isArray(plan.steps) || !plan.steps.length) return null;
    const box = document.createElement('div');
    box.className = 'ai-plan';
    const goal = document.createElement('div');
    goal.className = 'ai-plan-goal';
    goal.textContent = plan.goal || 'Plan';
    const done = plan.steps.filter((s) => s.status === 'done').length;
    const count = document.createElement('span');
    count.className = 'ai-plan-count';
    count.textContent = done + '/' + plan.steps.length;
    count.title = done + ' of ' + plan.steps.length + ' steps done';
    goal.appendChild(count);
    box.appendChild(goal);
    const ready = Array.isArray(nextSteps) ? new Set(nextSteps.map((s) => s && s.id)) : null;
    for (const s of plan.steps) {
      const row = document.createElement('div');
      row.className = 'ai-plan-step is-' + (s.status || 'pending');
      // Dependency-aware: a step that is ready to run right now says so, and
      // one that is waiting on others is marked rather than looking idle.
      if (s.status === 'pending' && ready && ready.has(s.id)) row.classList.add('is-ready');
      if (s.status === 'pending' && Array.isArray(s.dependsOn) && s.dependsOn.length) row.classList.add('is-waiting');
      const dot = document.createElement('span');
      dot.className = 'ai-step-dot';
      const tx = document.createElement('span');
      tx.textContent = s.text || '';
      if (s.status === 'pending' && ready && ready.has(s.id)) {
        const tag = document.createElement('span');
        tag.className = 'ai-plan-tag';
        tag.textContent = 'next';
        tx.appendChild(tag);
      }
      // (a step waiting on others keeps its plain pending look)
      if (s.note) {
        const note = document.createElement('span');
        note.className = 'ai-plan-note';
        note.textContent = ' — ' + s.note;
        tx.appendChild(note);
      }
      row.append(dot, tx);
      box.appendChild(row);
    }
    return box;
  }

  function paintAgentToggle() {
    const strip = document.getElementById('ai-agent-strip');
    if (strip) strip.hidden = !agentPrefs.agent;
  }

  // The scroll floats are pinned to the viewport, and the composer grows with
  // the draft, attachments and the run bar. Measuring it keeps the buttons above
  // the composer instead of on top of it (geometry from measurement, never a
  // guessed offset).
  function measureComposer() {
    const sidebar = document.getElementById('ai-sidebar');
    const composer = sidebar && sidebar.querySelector('.ai-composer-wrap');
    if (!sidebar || !composer) return;
    const height = Math.round(composer.getBoundingClientRect().height) || 96;
    sidebar.style.setProperty('--ai-float-bottom', (height + 10) + 'px');
  }

  if (typeof ResizeObserver === 'function') {
    const wrap = document.querySelector('.ai-composer-wrap');
    if (wrap) new ResizeObserver(measureComposer).observe(wrap);
  }
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('resize', measureComposer);
  }

  function paintRunbar(label, count, clock) {
    const bar = document.getElementById('ai-runbar');
    if (!bar) return;
    if (!agentRun) { bar.hidden = true; paintPause(); return; }
    bar.hidden = false;
    const lab = document.getElementById('ai-runbar-label');
    if (lab) lab.textContent = label || 'Working…';
    const steps = document.getElementById('ai-runbar-steps');
    if (steps) {
      steps.textContent = typeof count === 'number' ? count + '/' + (agentPrefs.agentMaxSteps || 25) : '';
      // Elapsed time rides along with the step count: a long run should never
      // look stuck.
      if (clock) steps.textContent = (steps.textContent ? steps.textContent + ' · ' : '') + clock;
    }
    paintPause();
  }

  function paintPause() {
    const btn = document.getElementById('ai-runbar-pause');
    if (!btn) return;
    if (!agentRun) { btn.hidden = true; return; }
    btn.hidden = false;
    const paused = Boolean(agentRun.paused);
    btn.textContent = paused ? 'Resume' : 'Pause';
    btn.setAttribute('aria-pressed', paused ? 'true' : 'false');
  }

  function togglePauseRun() {
    if (!agentRun) return;
    const next = !agentRun.paused;
    // Optimistic paint; the runbar event from main is authoritative.
    agentRun.paused = next;
    paintPause();
    window.dexerion.invoke(next ? 'dex:ai-agent-pause' : 'dex:ai-agent-resume', agentRun.id).catch(() => {});
  }

  async function loadAgentPrefs() {
    const prefs = await window.dexerion.invoke('dex:ai-agent-get').catch(() => null);
    if (prefs && typeof prefs === 'object') agentPrefs = prefs;
    paintAgentToggle();
    paintPause();
  }

  async function toggleAgent(force) {
    const next = typeof force === 'boolean' ? force : !agentPrefs.agent;
    const prefs = await window.dexerion.invoke('dex:ai-agent-set', { agent: next }).catch(() => null);
    if (prefs && typeof prefs === 'object') agentPrefs = prefs;
    else agentPrefs.agent = next;
    paintAgentToggle();
    // Acting implies reading: a run that cannot see the page can only guess.
    if (next && !pagePrefs.usePage) await togglePage(true);
    if (!next && agentRun) stopAgentRun();
  }

  function stopAgentRun() {
    if (!agentRun) return;
    window.dexerion.invoke('dex:ai-agent-stop', agentRun.id).catch(() => {});
  }

  function closePanel() {
    setPanel(false);
    window.dexerion.invoke('dex:ai-sidebar', false).catch(() => {});
  }

  // Esc / the composer's stop glyph: end whatever is running right now.
  function stopRun() {
    if (requestId) window.dexerion.invoke('dex:ai-stop', requestId).catch(() => {});
    if (agentRun) stopAgentRun();
    hintNote('Stopped.');
  }

  // The one composer glyph: send when idle, stop while streaming.
  function paintSendState() {
    if (!send) return;
    send.classList.toggle('is-stop', busy);
    send.textContent = busy ? '\u25A0' : '\u2191';
    send.title = busy ? 'Stop (Esc)' : 'Send';
    send.setAttribute('aria-label', busy ? 'Stop' : 'Send');
    send.disabled = false;
  }

  function endAgentRun() {
    if (agentRun && agentRun.leaseTimer) clearInterval(agentRun.leaseTimer);
    agentRun = null;
    agentAsk = null;
    capAsk = null;
    closeAsk();
    paintPause();
    paintRunbar();
    // Every ending path funnels through here: finished, stopped, halted,
    // refused before start, or an IPC error. The taskbar line must never keep
    // saying "Working…" after the runbar has gone away.
    paintStatus('');
  }

  // Tier-3 confirmation in the static ask box (scAI pattern): the loop is
  // parked until Allow once / Don't, or Esc stops the run (which resolves
  // the parked confirmation as declined on the main side).
  let agentAsk = null; // { runId, askId }
  let skillAsk = null; // { id, tier } — a skill consent card is up
  let capAsk = null; // { id, cap } — one-click capability request is up
  let skillSteps = null; // step rows collected during the current send
  let uiAsk = null; // { run } — a local confirmation (clear/delete) in the card
  function closeAsk() {
    const box = document.getElementById('ai-ask');
    if (box) box.hidden = true;
  }
  function setAskButtons(yesText, noText) {
    const yes = document.getElementById('ai-ask-yes');
    const no = document.getElementById('ai-ask-no');
    if (yes) yes.textContent = yesText;
    if (no) no.textContent = noText;
  }
  // Local confirmations reuse the consent card: the sidebar's one allowed
  // button moment. No model call is involved.
  function askUiConfirm(what, why, run) {
    uiAsk = { run };
    const box = document.getElementById('ai-ask');
    if (!box) { uiAsk = null; run(); return; }
    const whatEl = document.getElementById('ai-ask-what');
    const whyEl = document.getElementById('ai-ask-why');
    if (whatEl) whatEl.textContent = what;
    if (whyEl) whyEl.textContent = why;
    const always = document.getElementById('ai-ask-always');
    if (always) always.hidden = true;
    const desc = document.getElementById('ai-ask-desc');
    if (desc) desc.textContent = '';
    const field = document.getElementById('ai-ask-text');
    if (field) { field.hidden = true; field.value = ''; }
    setAskButtons('OK', 'Cancel');
    box.hidden = false;
    const yes = document.getElementById('ai-ask-yes');
    if (yes) yes.focus();
  }
  function answerAskStatic(ok, scope) {
    // A local confirmation (clear/delete chat) rides the same card.
    if (uiAsk) {
      const task = uiAsk;
      uiAsk = null;
      closeAsk();
      if (ok && task.run) task.run();
      return;
    }
    // An AI capability request is the one-card flow: "Turn on" enables the
    // switch for this account, "No" denies the action. Nothing else is queued.
    if (capAsk) {
      const ask = capAsk;
      capAsk = null;
      closeAsk();
      window.dexerion.invoke('dex:ai-cap-decide', { id: ask.id, allow: ok }).catch(() => {});
      return;
    }
    // A skill consent card rides in the same box as the agent confirmation.
    if (skillAsk) {
      const ask = skillAsk;
      skillAsk = null;
      closeAsk();
      window.dexerion.invoke('dex:ai-skill-decide', { id: ask.id, allow: ok, scope: scope || (ok ? 'once' : 'deny') }).catch(() => {});
      return;
    }
    if (!agentAsk || !agentRun || agentAsk.runId !== agentRun.id) { closeAsk(); return; }
    // A question card sends its typed text; a confirmation sends yes/no. Send
    // with an empty box is the same as skipping.
    if (agentAsk.input) {
      const field = document.getElementById('ai-ask-text');
      const text = field ? field.value.trim() : '';
      window.dexerion.invoke('dex:ai-agent-answer', {
        runId: agentAsk.runId, askId: agentAsk.askId, ok: Boolean(text), text,
      }).catch(() => {});
      closeAsk();
      return;
    }
    window.dexerion.invoke('dex:ai-agent-answer', { runId: agentAsk.runId, askId: agentAsk.askId, ok }).catch(() => {});
    closeAsk();
  }

  function onAgentEvent(ev) {
    if (!ev || !agentRun || ev.runId !== agentRun.id) return;
    if (ev.type === 'step' && ev.step) {
      agentRun.seenSteps = Math.max(agentRun.seenSteps || 0, ev.step.n || 0);
      let row = agentRun.stepsEl.querySelector('[data-n="' + (ev.step.n || 0) + '"]');
      if (!row) {
        row = makeStepRow(ev.step);
        agentRun.stepsEl.appendChild(row);
      } else {
        paintStepRow(row, ev.step);
      }
      paintRunbar(agentRun.label, agentRun.seenSteps);
      messages.scrollTop = messages.scrollHeight;
    } else if (ev.type === 'plan' && ev.plan) {
      // Live plan checklist: replaces the previous one in place.
      agentRun.plan = ev.plan;
      const el = makePlanEl(ev.plan, ev.nextSteps);
      if (el && agentRun.planSlot) agentRun.planSlot.replaceChildren(el);
      messages.scrollTop = messages.scrollHeight;
    } else if (ev.type === 'progress') {
      // Honest progress: plan steps done, actions run, elapsed time.
      agentRun.label = ev.label || agentRun.label;
      agentRun.startedAt = agentRun.startedAt || Date.now();
      const mins = Math.floor((Number(ev.elapsedMs) || 0) / 60000);
      const secs = Math.floor(((Number(ev.elapsedMs) || 0) % 60000) / 1000);
      const clock = mins ? mins + 'm ' + String(secs).padStart(2, '0') + 's' : secs + 's';
      paintRunbar(agentRun.label, typeof ev.steps === 'number' ? ev.steps : agentRun.seenSteps, clock);
      return;
    } else if (ev.type === 'runbar') {
      if (typeof ev.paused === 'boolean') { agentRun.paused = ev.paused; paintPause(); }
      if (ev.halted) { endAgentRun(); return; }
      agentRun.label = ev.label || agentRun.label;
      paintRunbar(agentRun.label, agentRun.seenSteps);
    } else if (ev.type === 'ask') {
      agentRun.label = 'Waiting for you';
      paintRunbar(agentRun.label, agentRun.seenSteps);
      agentAsk = { runId: ev.runId, askId: ev.askId, input: Boolean(ev.input) };
      const always = document.getElementById('ai-ask-always');
      if (always) always.hidden = true;
      const box = document.getElementById('ai-ask');
      if (box) {
        document.getElementById('ai-ask-what').textContent = ev.what || 'Confirm this action';
        // A question takes a text answer; a confirmation takes yes/no.
        const yes = document.getElementById('ai-ask-yes');
        const no = document.getElementById('ai-ask-no');
        const field = document.getElementById('ai-ask-text');
        if (field) {
          field.hidden = !ev.input;
          field.value = '';
          field.placeholder = ev.placeholder || 'Type your answer…';
          field.setAttribute('aria-label', ev.what || 'Your answer');
        }
        setAskButtons(ev.input ? 'Send' : 'Allow once', ev.input ? 'Skip' : 'No');
        document.getElementById('ai-ask-why').textContent = ev.input
          ? (ev.why ? ev.why + ' The task is paused until you answer.' : 'The task is paused until you answer.')
          : (ev.why
            ? 'This ' + ev.why + '. Dexerion AI always asks before anything like this.'
            : 'Dexerion AI always asks before anything consequential.');
        box.hidden = false;
        if (ev.input && field) field.focus();
        else if (yes) yes.focus();
      }
      messages.scrollTop = messages.scrollHeight;
    } else if (ev.type === 'end') {
      endAgentRun();
    }
  }

  // Shared live runner for model-driven runs and model-free replays: the
  // thinking bubble sits in the normal message column and the step trace grows
  // below it. Returns the raw result (steps carry args for recipe saving;
  // persisted ones don't).
  async function liveAgentRun(channel, buildArgs, offerRecipeUrl) {
    // Live assistant turn: the bubble joins the normal message column (avatar
    // plus column, like every other reply), with the plan checklist and step
    // trace listed below it. Agent prose is intermediate reasoning, so the
    // bubble keeps its thinking dots until the finished answer lands as a
    // saved message.
    liveBubble = addMessage('model', '', false);
    liveBubble.dataset.agent = '1';
    const planSlot = document.createElement('div');
    planSlot.className = 'ai-plan-slot';
    const stepsEl = document.createElement('div');
    stepsEl.className = 'ai-steps';
    liveBubble.parentElement.append(planSlot, stepsEl);
    const thinking = document.createElement('span');
    thinking.className = 'ai-thinking';
    thinking.setAttribute('aria-label', 'Dexerion Assistant is thinking');
    thinking.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
    liveBubble.appendChild(thinking);
    messages.scrollTop = messages.scrollHeight;
    liveText = '';
    requestId = 'sidebar-' + Date.now() + Math.random().toString(36).slice(2, 7);
    // The run id arrives with the start event, ahead of the invoke's own
    // reply (which only settles when the run ends). An immediate refusal
    // sends no start event, so the gate also releases on settle.
    let gateResolve = null;
    const gate = new Promise((r) => { gateResolve = r; });
    pendingRunStart = (ev) => {
      if (ev && ev.type === 'start' && !agentRun) {
        agentRun = { id: ev.runId, stepsEl, planSlot, label: 'Working…', seenSteps: 0, paused: false, leaseTimer: null };
        agentRun.leaseTimer = setInterval(() => {
          if (agentRun) window.dexerion.invoke('dex:ai-agent-ping', agentRun.id).catch(() => {});
        }, 1000);
        paintRunbar(agentRun.label, 0);
        paintPause();
        gateResolve();
      }
    };
    try {
      const result = await window.dexerion.invoke(channel, buildArgs(requestId)).finally(() => { pendingRunStart = null; if (gateResolve) gateResolve(); });
      await gate;
      if (result && result.ok) {
        const message = { role: 'model', text: result.text, steps: result.steps };
        if (result.plan) message.plan = result.plan;
        // An agent run that ends with a finished deliverable lands as a card,
        // the same as a chat reply.
        if (result.artifact) message.artifact = result.artifact;
        if (result.artifactWarnings && result.artifactWarnings.length) message.artifactWarnings = result.artifactWarnings;
        // Stopped short: remember it, so the bubble can offer to carry on.
        if (result.partial) {
          message.partial = true;
          if (Array.isArray(result.remaining) && result.remaining.length) message.remaining = result.remaining.slice(0, 5);
        }
        activeChat = await window.dexerion.invoke('dex:ai-chat-append', { id: activeChat.id, message });
        renderList();
        renderMessages();
        if (offerRecipeUrl && !result.halted) showRecipeOffer(result.steps, offerRecipeUrl);
        return;
      }
      if (liveBubble) { liveBubble.style.display = ''; liveBubble.textContent = '⚠ ' + ((result && result.error) || 'The run did not finish.'); }
    } catch (error) {
      if (liveBubble) { liveBubble.style.display = ''; liveBubble.textContent = '⚠ ' + (error.message || 'The run did not finish.'); }
    } finally {
      cancelLivePaint();
      pendingRunStart = null;
      endAgentRun();
      liveBubble = null;
      liveText = '';
      requestId = null;
      busy = false;
      send.disabled = false;
      input.focus();
    }
  }

  async function agentSubmit(pageContextText, runUrl) {
    return liveAgentRun('dex:ai-agent-run',
      (reqId) => ({
        reqId,
        chatId: activeChat.id,
        messages: activeChat.messages,
        pageContext: pageContextText,
        // Plan review: the person decides whether the agent shows its plan
        // before acting (Assistant settings → Acting on pages).
        planFirst: uiPrefs.agentPlanFirst === true,
      }),
      runUrl || '');
  }

  // ---------- Recipes (scAI macros): save + replay finished runs ----------
  const REPLAYABLE = {
    snapshot: 1, click: 1, type: 1, select: 1, hover: 1, press_key: 1,
    scroll: 1, wait_for: 1, fill_form: 1, navigate: 1, back: 1, find_text: 1,
  };

  function recipeHost(url) {
    try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
  }

  // Offered after a run that actually did something repeatable. The live
  // steps (with args) are used — persisted ones drop args deliberately.
  // Respects the recipes toggle from Settings.
  function showRecipeOffer(steps, url) {
    if (agentPrefs.agentMacros === false) return;
    const actions = (steps || []).filter(s => s.status === 'ok' && REPLAYABLE[s.name]);
    const didSomething = actions.some(s => s.name !== 'snapshot' && s.name !== 'find_text');
    if (!didSomething) return;
    const asked = [...activeChat.messages].reverse().find(m => m.role === 'user' && m.text);
    const label = asked
      ? String(asked.text).replace(/\s+/g, ' ').trim().slice(0, 44)
      : 'Run on ' + (recipeHost(url) || 'this site');
    const box = document.createElement('div');
    box.className = 'ai-recipe-offer';
    const tx = document.createElement('span');
    tx.textContent = 'Replay this run later?';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Save as recipe';
    btn.onclick = async () => {
      try {
        await window.dexerion.invoke('dex:ai-recipe-save', {
          name: label,
          origin: recipeHost(url),
          startUrl: url,
          steps: actions.map(s => ({ name: s.name, args: s.args || {} })),
        });
        box.remove();
        hintNote('Saved "' + label + '" as a recipe.');
        renderRecipes();
      } catch (err) {
        hintNote(err.message || 'Could not save the recipe.');
      }
    };
    box.append(tx, btn);
    messages.appendChild(box);
    messages.scrollTop = messages.scrollHeight;
  }

  async function renderRecipes() {
    const box = $('#ai-recipe-list');
    if (!box) return;
    box.replaceChildren();
    const recipes = await window.dexerion.invoke('dex:ai-recipe-list').catch(() => []);
    if (!recipes.length) {
      const p = document.createElement('span');
      p.className = 'ai-hint';
      p.textContent = 'No recipes yet. Finish an agent run and save it from the chat.';
      box.appendChild(p);
      return;
    }
    for (const r of recipes) {
      const row = document.createElement('div');
      row.className = 'ai-meta-row';
      const main = document.createElement('span');
      main.className = 'ai-main';
      const nm = document.createElement('b');
      nm.className = 'ai-nowrap';
      nm.textContent = r.name;
      const sub = document.createElement('small');
      sub.className = 'ai-muted';
      sub.textContent = (r.origin || 'any site') + ' · ' + (r.steps || []).length + ' steps';
      main.append(nm, sub);
      const run = document.createElement('button');
      run.type = 'button';
      run.className = 'ai-icon-btn';
      run.title = 'Run this recipe';
      run.textContent = '▶';
      run.onclick = () => replayRecipe(r.id);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'ai-row-btn danger';
      del.title = 'Delete recipe';
      del.textContent = '⌫';
      del.onclick = async () => {
        try {
          await window.dexerion.invoke('dex:ai-recipe-delete', r.id);
          renderRecipes();
        } catch {
          hintNote('Could not delete just now — try again.');
        }
      };
      row.append(main, run, del);
      box.appendChild(row);
    }
  }

  async function replayRecipe(id) {
    if (busy) return;
    hideAllSheets(true);
    if (!agentPrefs.agent) { hintNote('Turn on agent mode with the lightning button first.'); return; }
    if (!activeChat) {
      hintNote('Starting a new chat…');
      await createChat();
      if (!activeChat) return;
    }
    const recipes = await window.dexerion.invoke('dex:ai-recipe-list').catch(() => []);
    const recipe = recipes.find(r => r.id === id);
    if (!recipe) { hintNote('Recipe not found.'); return; }
    busy = true;
    send.disabled = true;
    try {
      activeChat = await window.dexerion.invoke('dex:ai-chat-append', {
        id: activeChat.id, message: { role: 'user', text: 'Replay recipe: ' + recipe.name },
      });
    } catch (error) {
      hintNote(error.message || 'Could not save your message — try again.');
      busy = false;
      send.disabled = false;
      input.focus();
      return;
    }
    input.value = '';
    input.style.height = 'auto';
    clearAttachments();
    renderList();
    renderMessages();
    await liveAgentRun('dex:ai-agent-replay',
      (reqId) => ({ reqId, chatId: activeChat.id, messages: activeChat.messages, recipeId: id }),
      null);
  }

  // ---------- Missions (inspect + delete past agent runs) ----------
  function missionTime(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
      d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function missionMetaText(m) {
    const bits = [missionTime(m.startedAt)];
    if (m.host) bits.push(m.host);
    bits.push(m.stepCount + ' step' + (m.stepCount === 1 ? '' : 's'));
    if (m.plan) bits.push('plan ' + m.plan.done + '/' + m.plan.total);
    if (m.approvals) bits.push(m.approvals + ' approval' + (m.approvals === 1 ? '' : 's'));
    return bits.filter(Boolean).join(' · ');
  }

  async function renderMissions() {
    const box = $('#ai-mission-list');
    if (!box) return;
    box.replaceChildren();
    const list = await window.dexerion.invoke('dex:ai-missions-list').catch(() => []);
    if (!list.length) {
      const p = document.createElement('span');
      p.className = 'ai-panel-empty';
      p.textContent = 'No missions yet. Turn acting on (the ⚡ in the composer) and ask for something that takes a few steps — plans, steps, approvals and results land here.';
      box.appendChild(p);
      return;
    }
    for (const m of list) {
      const row = document.createElement('details');
      row.className = 'ai-mission-row';
      const sum = document.createElement('summary');
      const chip = document.createElement('span');
      chip.className = 'ai-mission-chip is-' + m.status;
      chip.textContent = m.status;
      const main = document.createElement('span');
      main.className = 'ai-main';
      const goal = document.createElement('span');
      goal.className = 'ai-mission-goal';
      goal.textContent = m.goal || '(untitled)';
      const meta = document.createElement('span');
      meta.className = 'ai-mission-meta';
      meta.textContent = missionMetaText(m);
      main.append(goal, meta);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'ai-row-btn danger';
      del.title = 'Delete mission';
      del.setAttribute('aria-label', 'Delete mission');
      del.textContent = '⌫';
      del.onclick = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
          await window.dexerion.invoke('dex:ai-mission-delete', m.id);
          renderMissions();
        } catch { hintNote('Could not delete just now — try again.'); }
      };
      sum.append(chip, main, del);
      row.appendChild(sum);
      // Detail loads on first expand.
      row.addEventListener('toggle', async () => {
        if (!row.open || row.dataset.loaded) return;
        row.dataset.loaded = '1';
        const detail = await window.dexerion.invoke('dex:ai-mission-get', m.id).catch(() => null);
        const body = document.createElement('div');
        body.className = 'ai-mission-body';
        if (detail && detail.plan) {
          const planEl = makePlanEl(detail.plan);
          if (planEl) body.appendChild(planEl);
        }
        if (detail && detail.steps && detail.steps.length) {
          const wrap = document.createElement('div');
          wrap.className = 'ai-steps';
          for (const s of detail.steps) wrap.appendChild(makeStepRow(s));
          body.appendChild(wrap);
        }
        if (detail && detail.approvals && detail.approvals.length) {
          const ap = document.createElement('div');
          ap.textContent = 'Approvals: ' + detail.approvals.map(a => a.what).filter(Boolean).join('; ');
          body.appendChild(ap);
        }
        if (detail && detail.result) {
          const res = document.createElement('div');
          res.textContent = detail.result;
          body.appendChild(res);
        }
        if (!body.childElementCount) body.textContent = 'No detail recorded.';
        row.appendChild(body);
      });
      box.appendChild(row);
    }
  }

  // ---------- Skill log (recent skill runs, newest first) ---
  async function renderSkillLog() {
    const box = $('#ai-skill-log-list');
    if (!box) return;
    box.replaceChildren();
    const list = await window.dexerion.invoke('dex:ai-skill-log').catch(() => []);
    if (!list.length) {
      const p = document.createElement('span');
      p.className = 'ai-panel-empty';
      p.textContent = 'No skill runs yet. Ask the assistant to do something (read a page, search the web, make a report…) and it will land here.';
      box.appendChild(p);
      return;
    }
    for (const entry of list) {
      const row = document.createElement('div');
      row.className = 'ai-skill-row';
      const when = document.createElement('span');
      when.className = 'ai-skill-when';
      when.textContent = entry.at ? new Date(entry.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
      const main = document.createElement('span');
      main.className = 'ai-main';
      const skill = document.createElement('span');
      skill.className = 'ai-skill-name';
      skill.textContent = entry.skill || '(unknown)';
      const decision = document.createElement('span');
      decision.className = 'ai-skill-decision is-' + (entry.ok ? 'ok' : entry.decision || 'deny');
      decision.textContent = entry.ok ? 'ok' : (entry.decision || 'deny');
      const args = document.createElement('span');
      args.className = 'ai-skill-args';
      args.textContent = entry.args ? entry.args : '';
      main.append(skill, decision, args);
      row.append(when, main);
      box.appendChild(row);
    }
  }

  async function showSkillLogSheet() { return openSheet('#ai-skill-log-sheet', renderSkillLog); }

  // ---------- Research projects (inspect + delete; created via the agent) ---
  function sourceLink(url, label) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ai-src-link';
    b.title = url;
    b.textContent = label || url;
    b.onclick = (event) => { event.preventDefault(); openAiLink(url); };
    return b;
  }

  async function renderProjects() {
    const box = $('#ai-project-list');
    if (!box) return;
    box.replaceChildren();
    const list = await window.dexerion.invoke('dex:ai-projects-list').catch(() => []);
    if (!list.length) {
      const p = document.createElement('span');
      p.className = 'ai-panel-empty';
      p.textContent = 'No saved research projects. Ask for research worth keeping — the assistant proposes a title and goal, you approve them, and sources, findings, decisions and open questions are filed here.';
      box.appendChild(p);
      return;
    }
    for (const p of list) {
      const row = document.createElement('details');
      row.className = 'ai-project-row';
      const sum = document.createElement('summary');
      const main = document.createElement('span');
      main.className = 'ai-main';
      const name = document.createElement('span');
      name.className = 'ai-project-title';
      name.textContent = p.title;
      const meta = document.createElement('span');
      meta.className = 'ai-project-meta';
      meta.textContent = [
        'updated ' + missionTime(p.updatedAt),
        p.counts.sources + ' source' + (p.counts.sources === 1 ? '' : 's'),
        p.counts.findings + ' finding' + (p.counts.findings === 1 ? '' : 's'),
        p.counts.decisions + ' decision' + (p.counts.decisions === 1 ? '' : 's'),
        p.counts.questions + ' question' + (p.counts.questions === 1 ? '' : 's'),
      ].join(' · ');
      main.append(name, meta);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'ai-row-btn danger';
      del.title = 'Delete project';
      del.setAttribute('aria-label', 'Delete project');
      del.textContent = '⌫';
      del.onclick = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!await window.dexerion.invoke('dex:confirm', { message: 'Delete research project "' + p.title + '" and everything saved in it?' }).catch(() => false)) return;
        try {
          await window.dexerion.invoke('dex:ai-project-delete', p.id);
          renderProjects();
        } catch { hintNote('Could not delete just now — try again.'); }
      };
      sum.append(main, del);
      row.appendChild(sum);
      // Detail (goal, sources, findings, decisions, questions) on expand.
      row.addEventListener('toggle', async () => {
        if (!row.open || row.dataset.loaded) return;
        row.dataset.loaded = '1';
        const detail = await window.dexerion.invoke('dex:ai-project-get', p.id).catch(() => null);
        const body = document.createElement('div');
        body.className = 'ai-project-body';
        if (detail) {
          const goal = document.createElement('div');
          goal.textContent = 'Goal: ' + (detail.goal || '(none)');
          body.appendChild(goal);
          if (detail.sources && detail.sources.length) {
            const h = document.createElement('div');
            h.textContent = 'Sources (' + detail.sources.length + ')';
            body.appendChild(h);
            for (const s of detail.sources.slice(0, 40)) body.appendChild(sourceLink(s.url, s.title || s.url));
          }
          const section = (label, entries) => {
            if (!entries || !entries.length) return;
            const h = document.createElement('div');
            h.textContent = label + ' (' + entries.length + ')';
            body.appendChild(h);
            for (const e of entries.slice(0, 100)) {
              const line = document.createElement('div');
              line.textContent = '• ' + e.text + (e.quote ? ' — “' + e.quote + '”' : '');
              body.appendChild(line);
              if (e.url) body.appendChild(sourceLink(e.url, 'Source: ' + e.url));
            }
          };
          section('Findings', detail.findings);
          section('Decisions', detail.decisions);
          section('Open questions', detail.questions);
        }
        if (!body.childElementCount) body.textContent = 'No detail recorded.';
        row.appendChild(body);
      });
      box.appendChild(row);
    }
  }

  let pendingRunStart = null;

  // ---------- task bar (title · New chat · History · live status) -----------
  // The effort pill is the only model-shaped control: the scout owns the model
  // per tier and no name ever appears. The menu opens on hover or click.
  const DIFFICULTY_VALUES = ['low', 'medium', 'high', 'max'];
  const DIFFICULTY_LABELS = { low: 'Low', medium: 'Medium', high: 'High', max: 'Max' };
  const MODEL_LABELS = {
    'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning': 'Nemotron 3 Nano Omni 30B',
    'nvidia/nemotron-3-super-120b-a12b': 'Nemotron 3 Super 120B',
  };
  let difficulty = 'medium';
  // One generation counter owns status freshness. Every status request bumps
  // it; any reply from an older generation is ignored even if IPC resolves
  // late, so a stale key/catalogue result can never repaint newer state.
  let loadStatusTimer = null;
  let loadStatusPending = false;
  let loadStatusSeq = 0;
  let loadStatusWaiters = [];

  function paintTaskbarTitle() {
    if (!taskbarTitle) return;
    taskbarTitle.textContent = (activeChat && activeChat.title) || 'New chat';
  }

  function paintDifficulty() {
    if (effortBtn) effortBtn.textContent = DIFFICULTY_LABELS[difficulty] || 'Medium';
    if (effortMenu) {
      for (const item of effortMenu.querySelectorAll('.ai-effort-item')) {
        item.setAttribute('aria-checked', item.dataset.tier === difficulty ? 'true' : 'false');
      }
    }
    if (effortSelect && effortSelect.value !== difficulty) effortSelect.value = difficulty;
  }

  function openEffortMenu(open) {
    if (!effortMenu || !effortBtn) return;
    effortMenu.hidden = !open;
    effortBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  async function loadDifficulty(seq) {
    const res = await window.dexerion.invoke('dex:ai-difficulty-get').catch(() => null);
    if (seq != null && seq !== loadStatusSeq) return;
    if (res && DIFFICULTY_VALUES.includes(res.difficulty)) difficulty = res.difficulty;
    paintDifficulty();
  }

  async function setDifficulty(tier) {
    const value = DIFFICULTY_VALUES.includes(tier) ? tier : 'medium';
    difficulty = value;
    paintDifficulty();
    // Effort is the default chooser: the tier swaps the model to the scout's
    // Nemotron pick for it (a manual model pin is dropped by the main side).
    const res = await window.dexerion.invoke('dex:ai-difficulty-set', value).catch(() => null);
    if (res && res.model) hintNote('Effort ' + (DIFFICULTY_LABELS[value] || value) + ' — ' + (MODEL_LABELS[res.model] || res.model));
    else hintNote('Effort ' + (DIFFICULTY_LABELS[value] || value));
    invalidateStatusLoads();
    const seq = loadStatusSeq;
    const status = await window.dexerion.invoke('dex:ai-status').catch(() => null);
    if (status) applyStatus(status, seq);
  }

  if (effortSelect) effortSelect.onchange = () => { setDifficulty(effortSelect.value); };

  // The task-bar status composes the live activity with the queue depth.
  // shell.js also uses this single live region for its own short announcements;
  // those take priority while visible, and the activity line is restored as
  // soon as the announcement clears.
  let activity = '';
  let externalStatusUntil = 0;
  let lastPaintStatusText = '';
  let lastPaintStatusHidden = true;
  function paintStatus(text) {
    activity = String(text == null ? '' : text);
    if (!taskbarStatus || Date.now() < externalStatusUntil) return;
    const queued = queue.length ? 'queued · ' + queue.length : '';
    const line = [activity.trim(), queued].filter(Boolean).join(' · ');
    if (taskbarStatus.textContent === line && taskbarStatus.hidden === !line) return;
    lastPaintStatusText = line;
    lastPaintStatusHidden = !line;
    taskbarStatus.hidden = !line;
    taskbarStatus.textContent = line;
  }
  if (taskbarStatus && window.MutationObserver) {
    new MutationObserver(() => {
      const text = taskbarStatus.textContent || '';
      if (text === lastPaintStatusText && taskbarStatus.hidden === lastPaintStatusHidden) return;
      if (!taskbarStatus.hidden && text) {
        externalStatusUntil = Date.now() + 3500;
        return;
      }
      externalStatusUntil = 0;
      paintStatus(activity);
    }).observe(taskbarStatus, { attributes: true, childList: true, characterData: true, subtree: true });
  }

  // Every key/model surface — the overflow badge, the key warning, the setup
  // wizard and the model pickers — is painted from this one status object.
  function paintProvider(status) {
    const picker = $('#ai-provider');
    if (picker && status.providerId) picker.value = status.providerId;
    const help = $('#ai-key-help');
    const key = $('#ai-key');
    const open = $('#ai-key-open');
    if (help) {
      if (status.providerId === 'nim') {
        help.textContent = 'Get one from NVIDIA (free, ~1 minute): open build.nvidia.com, sign in, generate an API key, and paste it below.';
      } else {
        help.textContent = 'Create an API key at ' + (status.keyHint || 'your provider') + ', then paste it below.';
      }
    }
    if (key && status.keyPlaceholder) key.placeholder = status.keyPlaceholder;
    if (open) open.textContent = status.docsLabel || 'Open provider page';

    const configured = Boolean(status.hasKey);
    const catalogue = Array.isArray(status.allModels) && status.allModels.length > 0;
    const ready = configured && catalogue;
    const providerName = status.providerLabel || status.provider || 'AI provider';

    const badge = $('#ai-status-badge');
    if (badge) {
      let text, tone;
      if (!configured) { text = 'Key not set'; tone = 'error'; }
      else if (!catalogue) { text = 'Key set · models loading'; tone = 'warn'; }
      else if (!status.warm) { text = 'Key set · catalogue ready'; tone = 'ready'; }
      else { text = 'Key set · AI ready'; tone = 'ready'; }
      badge.textContent = text;
      badge.dataset.tone = tone;
      badge.hidden = false;
    }
    const keywarn = $('#ai-keywarn');
    if (keywarn) {
      keywarn.hidden = configured;
      const kwt = $('#ai-keywarn-text');
      if (kwt && !configured) kwt.textContent = 'No ' + providerName + ' API key — Dexerion AI is idle until you add one.';
    }
    if (setup) setup.hidden = ready;
    const stepKey = $('#ai-step-key'), stepModel = $('#ai-step-model');
    if (stepKey) stepKey.hidden = ready;
    if (stepModel) stepModel.hidden = !ready;
    if (!ready && configured) {
      const msg = $('#ai-key-message');
      if (msg && !msg.textContent) msg.textContent = 'Could not load the model list. Press Connect to retry.';
    }
  }

  // The composer's model picker: the live catalogue (recommended first), the
  // current pick selected. Hidden until the catalogue loads so onboarding
  // never shows an empty picker. The list is only rebuilt when it changed,
  // so an open dropdown is never clobbered mid-choice.
  // "nvidia/nemotron-3-lightning-30b-a3b" -> "Nemotron 3 Lightning 30B A3B".
  // The vendor prefix and the hyphens are catalogue noise in a 460px panel; the
  // full id stays in the option's tooltip.
  function shortModelLabel(id) {
    const raw = String(id || '');
    if (!raw) return '';
    let name = raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw;
    name = name.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    // Size and mixture tags read better uppercased: "a3b" -> "A3B".
    const words = name.split(' ').map((w) => {
      if (/^[a-z]?\d+b$/i.test(w)) return w.toUpperCase();
      if (/^\d+b$/i.test(w)) return w.toUpperCase();
      return /^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w;
    });
    let label = words.join(' ');
    if (label.length > 30) label = label.slice(0, 29).trimEnd() + '…';
    return label || raw;
  }

  function paintModelSelect(status) {
    if (!modelSelect || !modelWrap) return;
    const all = Array.isArray(status && status.allModels) ? status.allModels : [];
    const rec = Array.isArray(status && status.models) ? status.models : [];
    if (!all.length) { modelWrap.hidden = true; if (effortWrap) effortWrap.hidden = true; return; }
    const current = status && typeof status.model === 'string' ? status.model : '';
    const seen = Array.from(modelSelect.options).map(option => option.value);
    const same = seen.length === all.length && all.every((id, i) => seen[i] === id);
    if (!same) {
      modelSelect.replaceChildren();
      const add = (label, ids) => {
        if (!ids.length) return;
        const group = document.createElement('optgroup');
        group.label = label;
        for (const id of ids) {
          const option = document.createElement('option');
          option.value = id;
          // The composer is narrow: show the model's own name, keep the full
          // catalogue id in the tooltip.
          option.textContent = shortModelLabel(id);
          option.title = id;
          group.appendChild(option);
        }
        modelSelect.appendChild(group);
      };
      add('Recommended', rec);
      add('All models', all.filter(id => !rec.includes(id)));
    }
    if (current && all.includes(current)) modelSelect.value = current;
    // Chromium does not surface <option title>, so the full catalogue id lives on
    // the select itself where a hover or a screen reader can reach it.
    modelSelect.title = current || '';
    modelWrap.hidden = false;
    if (effortWrap) effortWrap.hidden = false;
  }

  let modelChangeSeq = 0;
  if (modelSelect) modelSelect.onchange = async () => {
    const id = modelSelect.value;
    if (!id) return;
    const seq = ++modelChangeSeq;
    const label = shortModelLabel(id);
    // The pick is verified with a one-token probe before it sticks: the NIM
    // catalogue lists models an account may not be provisioned for. Short
    // labels + one status line keep the narrow composer from overlapping.
    modelSelect.disabled = true;
    modelSelect.setAttribute('aria-busy', 'true');
    hintNote('Checking ' + label + '…', 8000);
    try {
      const applied = await window.dexerion.invoke('dex:ai-model-set', id);
      if (seq !== modelChangeSeq) return;
      if (applied && applied.ok === false) {
        hintNote((applied.error || 'That model is not available.') + (applied.model ? ' Kept ' + shortModelLabel(applied.model) + '.' : ''), 6000);
      } else if (applied && applied.warning) {
        hintNote('Model set to ' + label + ' — ' + applied.warning, 6000);
      } else {
        hintNote('Model set to ' + label, 3600);
      }
      invalidateStatusLoads();
      const statusSeq = loadStatusSeq;
      const status = await window.dexerion.invoke('dex:ai-status').catch(() => null);
      if (seq !== modelChangeSeq) return;
      if (status) applyStatus(status, statusSeq);
      else loadStatusDebounced();
    } catch {
      if (seq === modelChangeSeq) {
        hintNote('Could not switch model — try again.', 6000);
        loadStatusDebounced();
      }
    } finally {
      if (seq === modelChangeSeq) {
        modelSelect.disabled = false;
        modelSelect.removeAttribute('aria-busy');
      }
    }
  };

  // Guided setup: step 1 (key) until a key validates, then step 2 (model).
  // The catalogue resets on restart, so reload it when a stored key exists.
  // A stored key with an unloadable catalogue keeps the wizard visible —
  // never strand the user with a disabled picker and no way forward.
  // Debounced: multiple triggers within 500 ms coalesce into one status
  // fetch (e.g. key-set broadcast + subsequent re-open). Every new request
  // invalidates the previous generation; trailing fetches are the only ones
  // allowed to paint once a fetch is already in flight.
  async function runLoadStatus(seq) {
    loadStatusPending = true;
    try { await loadStatus(seq); }
    finally { if (seq === loadStatusSeq) loadStatusPending = false; }
  }
  function settleStatusWaiters() {
    const waiters = loadStatusWaiters;
    loadStatusWaiters = [];
    for (const resolve of waiters) resolve();
  }
  function invalidateStatusLoads() {
    clearTimeout(loadStatusTimer);
    loadStatusTimer = null;
    loadStatusSeq++;
    loadStatusPending = false;
    settleStatusWaiters();
  }
  async function loadStatusDebounced() {
    const seq = ++loadStatusSeq;
    clearTimeout(loadStatusTimer);
    settleStatusWaiters();
    if (!loadStatusPending) return runLoadStatus(seq);
    return new Promise((resolve) => {
      loadStatusWaiters.push(resolve);
      loadStatusTimer = setTimeout(async () => {
        if (seq !== loadStatusSeq) return; // invalidation already settled it
        try { await runLoadStatus(seq); }
        finally { settleStatusWaiters(); }
      }, 500);
    });
  }
  // Retry an IPC invoke with a short backoff, for transient network/NIM
  // failures that clear on a second attempt.
  async function retryInvoke(ch, attempts, delayMs) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try { return await window.dexerion.invoke(ch); } catch (err) { lastErr = err; }
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
    throw lastErr;
  }
  function applyStatus(status, seq) {
    if (seq != null && seq !== loadStatusSeq) return;
    lastStatus = status;
    paintProvider(status);
    paintModelSelect(status);
    loadDifficulty(seq);
    hasKey = Boolean(status.hasKey);
    if (hasKey && !status.warm) window.dexerion.invoke('dex:ai-prewarm').catch(() => {});
  }
  async function loadStatus(seq) {
    let status = await window.dexerion.invoke('dex:ai-status').catch(() => null);
    if (!status || seq !== loadStatusSeq) return;
    if (status.hasKey && !status.modelsLoaded) {
      const r = await window.dexerion.invoke('dex:ai-models-refresh').catch(() => null);
      if (seq !== loadStatusSeq) return;
      if (r && r.ok) status = r;
    }
    applyStatus(status, seq);
  }

  async function connectKey() {
    const keyEl = $('#ai-key'), msg = $('#ai-key-message');
    if (!keyEl || !msg) return;
    const label = (lastStatus && (lastStatus.providerLabel || lastStatus.provider)) || 'provider';
    const key = keyEl.value.trim();
    if (!key && !hasKey) { msg.textContent = 'Paste your ' + label + ' API key first.'; return; }
    if (!key && hasKey) {
      // Retry with the stored key (catalogue failed to load earlier).
      msg.textContent = 'Retrying with your saved key…';
      try {
        await retryInvoke('dex:ai-models-refresh', 3, 800);
        const result = await retryInvoke('dex:ai-test', 3, 800);
        if (!result.ok) throw new Error(result.error || 'Connection failed.');
        msg.textContent = 'Connected.';
        await loadStatusDebounced();
      } catch (error) { msg.textContent = error.message || 'Could not connect.'; }
      return;
    }
    msg.textContent = 'Step 1 of 2 — checking your key and loading models…';
    try {
      await window.dexerion.invoke('dex:ai-key-set', key);
      await retryInvoke('dex:ai-models-refresh', 3, 800);
      const result = await retryInvoke('dex:ai-test', 3, 800);
      if (!result.ok) throw new Error(result.error || 'Connection failed.');
      keyEl.value = '';
      msg.textContent = 'Key works. Pick a difficulty on the task bar (Medium is fine) and start chatting.';
      await loadStatusDebounced();
    } catch (error) { msg.textContent = error.message || 'Could not connect.'; }
  }

  async function loadChats(selectId) {
    if (!accountId) return;
    const next = await window.dexerion.invoke('dex:ai-chats-list').catch(() => []);
    chats = next || [];
    const wanted = selectId || (activeChat && activeChat.id);
    const match = chats.find(chat => chat.id === wanted) || chats[0];
    if (match) await openChat(match.id);
    else {
      activeChat = null;
      renderList();
      renderMessages();
    }
  }

  // Refresh the chat list in place without touching the open conversation
  // (titles/counts stay current; a deleted active chat closes the view).
  async function refreshChatList() {
    if (!accountId) return;
    const next = await window.dexerion.invoke('dex:ai-chats-list').catch(() => null);
    if (!next) return;
    chats = next;
    if (activeChat) {
      const still = chats.find(chat => chat.id === activeChat.id);
      if (!still) {
        activeChat = null;
        renderList();
        renderMessages();
        return;
      }
      if (still.title !== activeChat.title) {
        activeChat.title = still.title;
        paintTaskbarTitle();
      }
    }
    renderList();
  }

  async function openChat(id) {
    if (busy) return;
    const my = ++navEpoch;
    const chat = await window.dexerion.invoke('dex:ai-chat-open', id).catch(() => null);
    if (!chat || my !== navEpoch) return;
    activeChat = chat;
    renderList();
    renderMessages();
    input.focus();
  }

  async function createChat() {
    if (busy) return;
    const my = ++navEpoch;
    const chat = await window.dexerion.invoke('dex:ai-chat-create').catch(() => null);
    if (!chat || my !== navEpoch) return;
    activeChat = chat;
    search.value = '';
    input.value = '';
    input.style.height = 'auto';
    clearAttachments();
    cancelLivePaint();
    liveBubble = null;
    liveText = '';
    requestId = null;
    await refreshChatList();
    renderMessages();
    input.focus();
  }

  // Inline rename: the row title becomes an editable field (Enter commits,
  // Esc cancels). No native prompt — it is unreliable in the sandbox and
  // steals focus from the panel.
  async function renameChat(chat) {
    // Make sure the row is on screen first (menu-initiated renames).
    const sheet = $('#ai-chat-sheet');
    if (sheet && sheet.hidden) {
      showSheet('#ai-chat-sheet');
      const s = $('#ai-search');
      if (s && s.value) { s.value = ''; }
      renderList();
    }
    const titleEl = list.querySelector('[data-id="' + chat.id + '"] .chat-main b');
    if (!titleEl) {
      hintNote('Open All chats to rename.');
      return;
    }
    if (titleEl.querySelector('input')) return; // already editing
    const editor = document.createElement('input');
    editor.type = 'text';
    editor.className = 'ai-rename-input';
    editor.value = chat.title;
    editor.setAttribute('aria-label', 'Chat name');
    editor.maxLength = 80;
    titleEl.replaceChildren(editor);
    editor.focus();
    editor.select();
    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      const name = editor.value.trim();
      if (!commit || !name || name === chat.title) { renderList(); return; }
      try {
        await window.dexerion.invoke('dex:ai-chat-rename', { id: chat.id, title: name });
      } catch (err) {
        hintNote(err.message || 'Could not rename — try again.');
      }
      await loadChats(chat.id);
    };
    editor.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    editor.addEventListener('click', (e) => e.stopPropagation());
    editor.addEventListener('blur', () => finish(true));
  }

  async function clearChat() {
    if (!activeChat || busy) return;
    if (!await window.dexerion.invoke('dex:confirm', { message: 'Clear all messages from this chat?' })) return;
    activeChat = await window.dexerion.invoke('dex:ai-chat-clear', activeChat.id).catch(() => null);
    renderList();
    renderMessages();
    input.focus();
  }

  async function deleteChatById(id) {
    if (busy) return;
    const chat = chats.find(c => c.id === id);
    const label = chat ? 'Delete "' + chat.title + '"?' : 'Delete this chat?';
    if (!await window.dexerion.invoke('dex:confirm', { message: label }).catch(() => false)) return;
    await window.dexerion.invoke('dex:ai-chat-delete', id).catch(() => {});
    if (activeChat && activeChat.id === id) {
      activeChat = null;
      await loadChats();
    } else {
      await refreshChatList();
    }
  }

  async function deleteChat() {
    if (!activeChat || busy) return;
    deleteChatById(activeChat.id);
  }

  // Retry the last turn: drop the trailing model reply and resend. An agent
  // summary re-runs as a fresh agent run (refs rebuild from a snapshot).
  // Carry on a task that stopped short: the remaining plan steps (when known)
  // are named so the next run picks up rather than starting over.
  function continueTask(remaining) {
    if (busy) { hintNote('Finish the current answer first.'); return; }
    const open = Array.isArray(remaining) ? remaining.filter(Boolean).slice(0, 5) : [];
    const ask = 'Continue the task from where you stopped.'
      + (open.length ? ' Still open: ' + open.join('; ') + '.' : '')
      + ' Do not repeat work that is already done; finish it and tell me what you did.';
    // Through the composer, so agent mode and chat mode both take the same path.
    input.value = ask;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
    submit();
  }

  // "Fix with AI" from the preview's health strip: a concrete repair request
  // naming every flagged issue, so the model edits the existing site instead
  // of regenerating it (and the ask is visible in the composer before it
  // sends — no behaviour without the person seeing the words).
  function fixSiteIssues(index, issues) {
    if (busy) { hintNote('Finish the current answer first.'); return; }
    if (!activeChat || !Number.isInteger(index)) {
      hintNote('Open the chat with this website before fixing it.');
      return;
    }
    const list = (Array.isArray(issues) ? issues : [])
      .filter(Boolean)
      .map((s) => String(s).trim().slice(0, 300))   // long enough to keep the trailing hint
      .slice(0, 8);
    if (!list.length) { hintNote('Nothing to fix.'); return; }
    const ask = 'Fix the quality issues the website checker found. Keep the same subject, files and working behaviour, and change only what the issues require:\n'
      + list.map((s) => '- ' + s).join('\n')
      + '\nReturn the whole site again as one dex-artifact block with the same "files" array.';
    input.value = ask;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
    submit();
  }

  // Regenerate: ask for another version of the artifact at `index` without
  // retyping anything. The request states the kind and title so the model makes
  // a different attempt at the same deliverable rather than a new subject.
  function regenerateArtifact(index) {
    if (busy) { hintNote('Finish the current answer first.'); return; }
    if (!activeChat || !Number.isInteger(index)) return;
    const message = activeChat.messages[index];
    const artifact = message && message.artifact;
    if (!artifact) { hintNote('That artifact is no longer here.'); return; }
    const title = artifact.title ? ' "' + artifact.title + '"' : '';
    const ask = 'Make another version of the ' + (artifact.kind || 'artifact') + title
      + '. Same subject and the same format, but a different approach where it helps — '
      + 'do not repeat the previous version word for word. Return it as one dex-artifact block.';
    input.value = ask;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
    submit();
  }

  async function retryLast() {
    if (busy || !activeChat) return;
    const keep = activeChat.messages.slice();
    while (keep.length && keep[keep.length - 1].role === 'model') keep.pop();
    if (!keep.some(m => m.role === 'user')) return;
    busy = true;
    send.disabled = true;
    try {
      await window.dexerion.invoke('dex:ai-chat-clear', activeChat.id);
      for (const m of keep) {
        const clean = { role: m.role, text: m.text || '', images: m.images || [] };
        if (m.context) clean.context = m.context;
        if (m.steps) clean.steps = m.steps;
        if (m.usage) clean.usage = m.usage;
        if (m.metrics) clean.metrics = m.metrics;
        if (m.model) clean.model = m.model;
        if (m.artifact) clean.artifact = m.artifact;
        await window.dexerion.invoke('dex:ai-chat-append', { id: activeChat.id, message: clean });
      }
      activeChat = await window.dexerion.invoke('dex:ai-chat-open', activeChat.id);
    } catch (error) {
      hintNote(error.message || 'Could not retry — try again.');
      busy = false;
      send.disabled = false;
      input.focus();
      return;
    }
    renderList();
    renderMessages();
    await deliver('');
  }

  // One-click starters on a fresh chat (scAI suggestions, Dexerion styling).
  // Screenshot fills the prompt and opens the snip tool; the user sends
  // once the capture lands (it arrives asynchronously).
  function renderSuggestions() {
    const box = document.getElementById('ai-suggest');
    if (!box) return;
    box.replaceChildren();
    const hasUser = activeChat ? activeChat.messages.some(m => m.role === 'user') : false;
    if (hasUser) return;
    const mk = (label, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.onclick = fn;
      box.appendChild(b);
      return b;
    };
    mk('Summarise this page', async () => {
      if (busy) return;
      if (!pagePrefs.usePage) await togglePage(true);
      input.value = 'Summarise this page in five bullet points.';
      submit();
    });
    mk('Explain the key idea', async () => {
      if (busy) return;
      if (!pagePrefs.usePage) await togglePage(true);
      input.value = 'Explain the main idea of this page in plain language.';
      submit();
    });
    mk('Compare my open tabs', async () => {
      if (busy) return;
      // Research across tabs needs acting on (which implies page reading).
      if (!agentPrefs.agent) await toggleAgent(true);
      input.value = 'Find the tabs I have open that are relevant to each other, read them, and compare what they say. Summarise where they agree and disagree, with each point linked to its source.';
      submit();
    });
    mk('Read what I see', () => {
      if (busy) return;
      input.value = 'What is shown in this screenshot?';
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 100) + 'px';
      input.focus();
      window.dexerion.invoke('dex:snip-open', { attach: true }).catch(() => hintNote('Could not open the snip tool.'));
    });
    // The deliverables are the reason to use this browser, and a new chat never
    // showed them. These two fill a template instead of sending, so the topic
    // is the person's own words rather than a vague request.
    mk('Write a report', () => {
      if (busy) return;
      prefillTemplate('Write me a report on ');
    });
    mk('Build a small app', () => {
      if (busy) return;
      prefillTemplate('Build a small interactive web app that ');
    });
  }

  // Template starters: the text lands in the composer with the cursor at the
  // end, and nothing is sent until the person finishes the sentence.
  function prefillTemplate(text) {
    input.value = text;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
    input.focus();
    try {
      input.setSelectionRange(text.length, text.length);
    } catch { /* selection is best effort */ }
    hintNote('Finish the sentence, then press Enter.');
  }

  function clearAttachments() {
    attachments = [];
    pending.replaceChildren();
    pending.hidden = true;
  }

  // No permanent captions in the composer (rework 2.3): the hint element
  // carries only transient notes ("Copied.", "Stopped.") and clears itself.
  const hintDefault = '';
// A throwaway copy of the composer text used for local pattern matching:
// javascript: URLs, executable data: URIs, event-handler attributes and
// script/iframe markup are stripped so a typed intent can never be spoofed by
// pasted markup. It is NOT applied to the outgoing message (see submit()).
function sanitizeInput(text) {
  if (!text || typeof text !== 'string') return text;
  let result = text;
  // Remove javascript: URLs
  result = result.replace(/javascript:[^'"\s<>&)]*/gi, '');
  // Remove data: URIs with executable content
  result = result.replace(/data:(?:text\/html|application\/javascript)[^'"\s<>&)]*/gi, '');
  // Remove event handler attributes
  result = result.replace(/\b(?:on\w+)\s*=\s*['"][^'"]*['"]/gi, '');
  result = result.replace(/\b(?:on\w+)\s*=\s*[^\s>]*/gi, '');
  // Remove <script> tags and content
  result = result.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  // Remove <iframe> tags
  result = result.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  return result;
}

  function hintNote(text, ms, tone) {
    const hint = $('#ai-hint');
    if (!hint) return;
    hint.textContent = text;
    if (tone) hint.dataset.tone = tone; else delete hint.dataset.tone;
    clearTimeout(hint._x);
    hint._x = setTimeout(() => {
      hint.textContent = hintDefault;
      delete hint.dataset.tone;
    }, ms || 3200);
  }

  async function prepareImageUrl(source, name) {
    const image = await new Promise((resolve, reject) => {
      const probe = new Image();
      probe.onload = () => resolve(probe);
      probe.onerror = () => reject(new Error('That image could not be opened.'));
      probe.src = source;
    });
    const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { name: name || 'Image', type: 'image', url: canvas.toDataURL('image/jpeg', .86) };
  }

  async function prepareImage(file) {
    const source = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Could not read that image.'));
      reader.readAsDataURL(file);
    });
    return prepareImageUrl(source, file.name || 'Pasted image');
  }

  async function addImageUrl(url, name) {
    if (attachments.length >= 4) { hintNote('Up to 4 images per message.'); return; }
    try {
      const image = await prepareImageUrl(String(url || ''), name || 'Snip');
      attachments.push(image);
      pending.appendChild(pendingThumb(image));
      pending.hidden = false;
      input.focus();
    } catch (err) { hintNote(err.message || 'That image could not be attached.'); }
  }

  async function addAttachments(selected) {
    for (const file of selected) {
      if (attachments.length >= 10) { hintNote('Max 10 files per message.'); break; }
      try {
        if (file.type === 'application/pdf' && file.size > 50 * 1024 * 1024) { hintNote('PDFs must be smaller than 50 MB.'); continue; }
        if (file.type.startsWith('text/') || isCodeFile(file.name)) {
          if (file.size > 10 * 1024 * 1024) { hintNote('Text/code files must be smaller than 10 MB.'); continue; }
        }
        if (file.type.startsWith('image/') && file.size > 20 * 1024 * 1024) { hintNote('Images must be smaller than 20 MB.'); continue; }
        const attachment = await prepareFileForUpload(file);
        attachments.push(attachment);
        pending.appendChild(pendingThumb(attachment));
        pending.hidden = false;
      } catch (err) { hintNote(err.message || 'That file could not be attached.'); }
    }
  }

  // Check if a file is a code/text file
  function isCodeFile(name) {
    return /\.(js|ts|jsx|tsx|py|rs|go|java|cpp|c|h|hpp|cs|json|md|mdx|txt|yaml|yml|toml|ini|cfg|conf|sh|bash|zsh|fish|ps1|bat|cmd|dockerfile|sql|graphql|proto|protobuf|vue|svelte|astro|css|scss|sass|less|html|htm|xml|svg)$/i.test(name);
  }

  // Process a PDF file using the main process (via IPC)
  async function processPDF(file) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const base64 = btoa(new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));
      const result = await window.dexerion.invoke('dex:ai-process-file', {
        fileData: base64,
        fileName: file.name,
        fileType: 'application/pdf'
      });
      if (!result.ok) throw new Error(result.error || 'Failed to process PDF');
      return { name: file.name, type: 'pdf', text: result.text, pages: result.pages };
    } catch (err) {
      throw new Error('Failed to process PDF: ' + err.message);
    }
  }

  // Process a text/code file
  async function processTextFile(file) {
    try {
      const text = await file.text();
      return { name: file.name, type: 'text', text, size: file.size };
    } catch (err) {
      throw new Error('Failed to read text file: ' + err.message);
    }
  }

  // Process a file for upload - routes to appropriate handler
  async function prepareFileForUpload(file) {
    const type = file.type;
    if (type === 'application/pdf') return processPDF(file);
    if (type.startsWith('text/') || isCodeFile(file.name)) return processTextFile(file);
    if (type.startsWith('image/')) return prepareImage(file);
    throw new Error('Unsupported file type: ' + type);
  }

  function isCodeFile(name) {
    return /\.(js|ts|jsx|tsx|py|rs|go|java|cpp|c|h|hpp|cs|json|md|mdx|txt|yaml|yml|toml|ini|cfg|conf|sh|bash|zsh|fish|ps1|bat|cmd|dockerfile|sql|graphql|proto|protobuf|vue|svelte|astro|css|scss|sass|less|html|htm|xml|svg)$/i.test(name);
  }

  // A pending attachment: the thumbnail plus a remove control. Removal is by object
  // identity so duplicate picks never drop the wrong one.
  function pendingThumb(attachment) {
    const wrap = document.createElement('span');
    wrap.className = 'ai-att';
    wrap.title = `${attachment.name} (${attachment.type})`;
    
    let thumb;
    if (attachment.type === 'image') {
      thumb = document.createElement('img');
      thumb.src = attachment.url;
      thumb.alt = attachment.name;
    } else if (attachment.type === 'pdf') {
      thumb = document.createElement('span');
      thumb.className = 'ai-att-pdf';
      thumb.textContent = '📄 ' + attachment.name;
    } else {
      thumb = document.createElement('span');
      thumb.className = 'ai-att-text';
      thumb.textContent = '📄 ' + attachment.name;
    }
    
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.title = 'Remove file';
    remove.setAttribute('aria-label', 'Remove file');
    remove.textContent = '×';
    remove.onclick = event => {
      event.stopPropagation();
      const at = attachments.indexOf(attachment);
      if (at >= 0) attachments.splice(at, 1);
      wrap.remove();
      if (!attachments.length) pending.hidden = true;
    };
    wrap.append(thumb, remove);
    return wrap;
  }

  // Pasting an image works anywhere in the panel; pasted text is untouched.
  function imagesFromClipboard(event) {
    const dt = event.clipboardData;
    if (!dt) return [];
    const out = [];
    for (const item of Array.from(dt.items || [])) {
      if (item.kind !== 'file' || !/^image\//i.test(item.type || '')) continue;
      const file = item.getAsFile();
      if (file) out.push(file);
    }
    if (!out.length && dt.files) {
      for (const file of Array.from(dt.files)) if (/^image\//i.test(file.type || '')) out.push(file);
    }
    return out;
  }
  function handlePaste(event) {
    const pasted = imagesFromClipboard(event);
    if (!pasted.length) return;
    event.preventDefault();
    addAttachments(pasted);
  }

  // ---------- / and @ popup menu (skills · open tabs) -----------------------
  // Typing "/" lists the skill registry (the same one the model sees); "@"
  // lists open tabs. Picking inserts text — nothing is sent until Enter.
  let skillList = null;
  let tabList = null;
  let popMode = '';
  let popItems = [];
  let popIndex = 0;

  function hostLabel(url) {
    try { return new URL(String(url || '')).hostname.replace(/^www\./, ''); } catch { return ''; }
  }

  async function loadSkillList(force) {
    if (skillList && !force) return skillList;
    const res = await window.dexerion.invoke('dex:ai-skills').catch(() => null);
    skillList = (res && Array.isArray(res.skills)) ? res.skills : [];
    return skillList;
  }

  function closePop() {
    popMode = '';
    popItems = [];
    popIndex = 0;
    if (popMenu) { popMenu.hidden = true; popMenu.replaceChildren(); }
  }

  function renderPop() {
    if (!popMenu || !popMode) return;
    popMenu.replaceChildren();
    const title = document.createElement('div');
    title.className = 'ai-pop-title';
    title.textContent = popMode === '@'
      ? (popItems.length ? 'Open tabs' : 'No matching tabs')
      : (popItems.length ? 'Skills · /help for the full list' : 'No matching skills');
    popMenu.appendChild(title);
    popItems.forEach((item, index) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'ai-pop-row' + (index === popIndex ? ' sel' : '');
      row.setAttribute('role', 'option');
      if (item.tier != null) {
        const tier = document.createElement('span');
        tier.className = 'tier';
        tier.textContent = 'T' + item.tier;
        row.appendChild(tier);
      }
      const tx = document.createElement('span');
      tx.className = 'tx';
      tx.textContent = item.label;
      row.appendChild(tx);
      if (item.sub) {
        const sub = document.createElement('span');
        sub.className = 'sub';
        sub.textContent = item.sub;
        row.appendChild(sub);
      }
      // mousedown so the pick lands before the textarea blurs
      row.addEventListener('mousedown', (event) => { event.preventDefault(); pickPop(index); });
      row.addEventListener('mousemove', () => {
        if (popIndex === index) return;
        popIndex = index;
        renderPop();
      });
      popMenu.appendChild(row);
    });
    popMenu.hidden = false;
  }

  async function openPop(mode, query) {
    const q = String(query || '').toLowerCase();
    if (mode === '@') {
      tabList = await window.dexerion.invoke('dex:ai-tabs-list').catch(() => []) || [];
      popItems = tabList
        .filter((t) => !q || (String(t.title || '') + ' ' + String(t.url || '')).toLowerCase().includes(q))
        .slice(0, 8)
        .map((t) => {
          const host = hostLabel(t.url);
          // If the query matches a URL host, insert @host instead of @title
          const isHostMatch = q && host && host.toLowerCase().includes(q.toLowerCase());
          return {
            label: t.title || t.url || 'Tab',
            sub: (t.group ? t.group + ' · ' : '') + host,
            insert: isHostMatch ? '@' + host : '@' + (t.title || host || 'tab')
          };
        });
    } else {
      const list = await loadSkillList();
      popItems = list
        .filter((s) => !q || (s.name + ' ' + s.id + ' ' + s.description).toLowerCase().includes(q))
        .slice(0, 9)
        .map((s) => ({ label: s.name, tier: s.tier, sub: s.id.replace(/_/g, ' '), insert: s.name }));
    }
    popMode = mode;
    popIndex = 0;
    renderPop();
  }

  function pickPop(index) {
    const item = popItems[index];
    if (!item) { closePop(); return; }
    const value = input.value;
    const caret = input.selectionStart == null ? value.length : input.selectionStart;
    const before = value.slice(0, caret);
    const match = /(^|\s)([\/@])([^\s\/@]*)$/.exec(before);
    const start = match ? (match.index + match[1].length) : caret;
    input.value = value.slice(0, start) + item.insert + ' ' + value.slice(caret);
    const pos = start + item.insert.length + 1;
    try { input.setSelectionRange(pos, pos); } catch {}
    closePop();
    input.focus();
    // The composer's own resize. The previous call named `autosize()`, which
    // only exists inside ai-search.js's closure (and resizes the *search*
    // field): picking from the / or @ menu threw a ReferenceError right after
    // inserting, so the textarea never grew and the console logged an error.
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
  }

  async function maybePop() {
    const value = input.value;
    const caret = input.selectionStart == null ? value.length : input.selectionStart;
    const match = /(^|\s)([\/@])([^\s\/@]*)$/.exec(value.slice(0, caret));
    if (!match) { closePop(); return; }
    await openPop(match[2], match[3]);
  }

  // "/help" answers locally from the same registry the model sees.
  async function showSkillHelp() {
    const list = await loadSkillList(true);
    if (!activeChat) {
      hintNote('Start a chat first, then /help lists every skill.');
      return;
    }
    const lines = ['**Skills** — ask in your own words, and these are the abilities behind the answers:', ''];
    for (const s of list) {
      lines.push('- **' + s.name + '** (T' + s.tier + ') — ' + s.description);
    }
    lines.push('', 'Tier 0 runs right away; Tier 1 asks once per chat; Tier 2 asks every time.');
    const message = { role: 'model', text: lines.join('\n'), model: 'skills' };
    activeChat = await window.dexerion.invoke('dex:ai-chat-append', { id: activeChat.id, message }).catch(() => activeChat);
    renderMessages();
  }

  // ---------- typed intents (the rail's replacement) ------------------------
  // A small deterministic phrase map: panels, context switches and confirmed
  // destructive actions — handled locally, never sent to the model.
  async function handleIntent(text) {
    const t = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.?!]+$/, '');
    const rules = [
      [/^(?:show|open|see)(?: my)?(?: chat| conversation)?(?: history| list| chats?)$/, showChatsSheet],
      [/^(?:show|open|see)(?: my)? recipes?$/, showRecipesSheet],
      [/^(?:show|open|see)(?: my)? memor(?:y|ies)$/, showMemorySheet],
      [/^what do you remember$/, showMemorySheet],
      [/^(?:show|open|see)(?: my)? missions?$/, showMissionsSheet],
      [/^(?:show|open|see)(?: my)? skill ?log$/, showSkillLogSheet],
      [/^(?:show|open|see)(?: my)? (?:projects?|research)$/, showProjectsSheet],
      [/^(?:open|show)(?: assistant)? settings$/, showSettingsSheet],
      [/^(?:open|show)(?: my)? files$/, () => { window.dexerion.invoke('dex:new-tab', 'dexerion://files', false).catch(() => {}); }],
      [/^(?:new chat|start a new chat)$/, createChat],
      [/^(?:stop using|forget|don't use|dont use) (?:this|the|my) page$/, () => togglePage(false)],
      // "read my page" arms page reading and, when the composer is empty,
      // pre-fills the ask so the page is summarised on the next Enter —
      // matching the "ask about this page" handoff from the page menu.
      [/^(?:use|read) (?:this|the current|my) page$/, async () => {
        await togglePage(true);
        input.value = 'Summarise this page in five bullet points.';
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 100) + 'px';
        input.focus();
      }],
      [/^stop acting(?: now)?$/, () => { if (agentRun) stopAgentRun(); toggleAgent(false); }],
      [/^(?:read|inspect|summarise)(?: all)?(?: my)?(?: open)? tabs$/, () => runTabInspection()],
      [/^snip (?:this|the page)$/, () => window.dexerion.invoke('dex:snip-open', { attach: true }).catch(() => hintNote('Could not open the snip tool.'))],
    ];
    for (const [re, fn] of rules) {
      if (!re.test(t)) continue;
      await fn();
      return true;
    }
    // Report presets by name ("use the research brief preset").
    if (/\bpreset\b/.test(t)) {
      if (await usePresetByName(t)) {
        hintNote('Report preset: ' + (activePreset ? activePreset.name : ''));
        return true;
      }
    }
    if (/^(?:clear|reset) (?:this|the) (?:chat|conversation|messages)$/.test(t)) {
      askUiConfirm('Clear this chat?', 'This removes every message in this conversation.', () => { clearChat(); });
      return true;
    }
    if (/^delete (?:this|the) (?:chat|conversation)$/.test(t)) {
      askUiConfirm('Delete this chat?', 'This deletes the conversation permanently.', () => { deleteChat(); });
      return true;
    }
    return false;
  }

  // While an answer streams, Enter queues the message (max 3); the task bar
  // shows "queued · N" and the queue drains itself as answers finish.
  function queueDraft(text) {
    const value = String(text || '').trim();
    if (!value || attachments.length) { hintNote('Finish the current answer first.'); return; }
    if (queue.length >= 3) { hintNote('The queue is full — three queued messages is the limit.'); return; }
    queue.push(value);
    input.value = '';
    input.style.height = 'auto';
    paintStatus(activity || 'Working…');
    hintNote('Queued — it sends when this answer finishes.');
  }

  async function submit() {
    if (inspecting) { hintNote('Reading your tabs — one moment.'); return; }
    // Capture the draft before createChat() clears the composer; otherwise the
    // very first message in a fresh profile was silently dropped.
    const text = input.value.trim();
    if (!text && !attachments.length) return;
    if (busy) { queueDraft(text); return; }
    // The sanitised copy is for LOCAL matching only (typed intents, /help).
    // The message the model receives is the person's own text: mangling a prompt
    // containing `onclick=` or `one=1` would be worse than useless, and nothing
    // here renders that text as markup — replies go through textContent/markdown
    // escaping, and every privileged action is re-validated in the main process.
    // (The old code told the person "content removed" while sending it anyway.)
    const sanitized = sanitizeInput(text);
    // If a message is being inline-edited, commit that instead.
    if (editingMessageId) { await commitEdit(editingMessageId); return; }
    // Typed intents first: deterministic, local, and they work even before a
    // key exists ("open settings", "show my files", …). No model call.
    if (sanitized && !attachments.length && await handleIntent(sanitized)) {
      // Intents consume the message; an intent that pre-filled the composer
      // ("read my page" → a summarise prompt) keeps its text.
      if (input.value.trim() === text.trim()) {
        input.value = '';
        input.style.height = 'auto';
      }
      input.focus();
      return;
    }
    // "/help" lists every skill, straight from the registry the model sees.
    if (/^\/help$/i.test(sanitized) && !attachments.length) {
      input.value = '';
      input.style.height = 'auto';
      await showSkillHelp();
      input.focus();
      return;
    }
    // The setup card starts hidden, and a key seeded from Settings arrives via
    // a debounced status load. A send can therefore beat that load and see a
    // stale `hasKey=false`. Re-read the authoritative status once before
    // rejecting: a real message must never be dropped just because the badge
    // had not caught up with the key yet.
    if (!hasKey) {
      const fresh = await window.dexerion.invoke('dex:ai-status').catch(() => null);
      if (fresh && fresh.hasKey) applyStatus(fresh, loadStatusSeq);
    }
    if (!hasKey) {
      setup.hidden = false;
      const msg = $('#ai-key-message');
      if (msg) msg.textContent = 'Connect your ' + ((lastStatus && (lastStatus.providerLabel || lastStatus.provider)) || 'provider') + ' key first (step 1 above).';
      return;
    }
    if (!activeChat) {
      hintNote('Starting a new chat…');
      await createChat();
      if (!activeChat) return;
    }
    const images = [];
    const pdfParts = [];
    for (const att of attachments) {
      if (att.type === 'pdf' && att.text) {
        pdfParts.push('\n\n[PDF: ' + (att.name || 'document') + ']\n' + att.text);
      } else {
        images.push(att);
      }
    }
    const pdfSuffix = pdfParts.length ? pdfParts.join('\n') : '';
    // @mentions extracted from the typed text (stored on the message for
    // later highlighting / lookup).
    const mentions = extractMentions(text);
    // A chosen report preset rides in front of the message; the sent bubble
    // shows the composed text, so nothing is hidden from the person.
    const composed = activePreset
      ? ('Write a ' + activePreset.name + ' as a report. ' + activePreset.shape + '\n\nSubject and notes from the person:\n' + text)
      : text;
    // Build the user message. PDF text is appended so the assistant can read
    // attached PDFs; images pass through separately for vision-capable models.
    const userMessage = { role: 'user', text: composed + pdfSuffix, images, mentions };
    if (targetedMessage) {
      if (targetedMessage.kind === 'reply') {
        userMessage.replyTo = targetedMessage.id;
      } else if (targetedMessage.kind === 'forward') {
        userMessage.text = '↪ Forwarded: ' + targetedMessage.text + '\n\n' + text;
        userMessage.forwardedFrom = targetedMessage.id;
      }
    }
    busy = true;
    paintSendState();
    paintStatus('Working…');
    // Page context (Phase 1): capture the active tab exactly once per send.
    // A failure never blocks the message — it goes out without context.
    let pageContextText = '';
    let pageChip = null;
    let pageUrl = '';
    if (pagePrefs.usePage) {
      const page = await window.dexerion.invoke('dex:ai-read-page').catch(() => null);
      if (page && page.ok && page.context) {
        pageContextText = page.context.text || '';
        pageChip = { kind: page.context.kind, label: page.context.label, text: page.context.text };
        pageUrl = page.url || '';
      } else {
        hintNote(((page && page.error) || 'Could not read the page').split('\n')[0]);
      }
    }
    if (pageChip) userMessage.context = pageChip;
    try {
      activeChat = await window.dexerion.invoke('dex:ai-chat-append', { id: activeChat.id, message: userMessage });
    } catch (error) {
      hintNote(error.message || 'Could not save your message — try again.');
      busy = false;
      paintSendState();
      paintStatus('');
      input.focus();
      return;
    }
    input.value = '';
    input.style.height = 'auto';
    clearAttachments();
    activePreset = null;
    paintPreset();
    clearTarget();
    renderList();
    renderMessages();
    hintNote('Sent');
    await deliver(pageUrl);
  }

  // Sends the current tail of activeChat (plain completion or agent loop).
  // Context comes from the last user message's stored chip, so Retry sends
  // exactly what the original turn sent — no re-read.
  async function deliver(runUrl) {
    const lastUser = [...activeChat.messages].reverse().find(m => m.role === 'user');
    const pageContextText = (lastUser && lastUser.context && lastUser.context.text) || '';
    // Agent mode runs the main-owned loop instead of a single chat send.
    // A retry starts a fresh run (refs are rebuilt from a new snapshot).
    if (agentPrefs.agent) {
      await agentSubmit(pageContextText, runUrl || '');
      return;
    }
    liveBubble = addMessage('model', '', false);
    liveText = '';
    skillSteps = [];
    skillAsk = null;
    closeAsk();
    // Live step rows sit beside the bubble (markdown repaints own the bubble,
    // so the trace lives in its own container until the reply is saved).
    liveStepsEl = document.createElement('div');
    liveStepsEl.className = 'ai-steps';
    liveBubble.after(liveStepsEl);
    const thinking = document.createElement('span');
    thinking.className = 'ai-thinking';
    thinking.setAttribute('aria-label', 'Dexerion Assistant is thinking');
    thinking.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
    liveBubble.appendChild(thinking);
    messages.scrollTop = messages.scrollHeight;
    try {
      requestId = 'sidebar-' + Date.now() + Math.random().toString(36).slice(2, 7);
      const result = await window.dexerion.invoke('dex:ai-send', { reqId: requestId, chatId: activeChat.id, messages: activeChat.messages, pageContext: pageContextText });
      if (result && result.ok && !result.cancelled) {
        const modelMessage = { role: 'model', text: window.DexArtifacts ? window.DexArtifacts.visibleText(result.text) : result.text };
        if (skillSteps && skillSteps.length) modelMessage.steps = skillSteps.slice();
        if (result.thinking) modelMessage.thinking = String(result.thinking);
        if (result.usage) modelMessage.usage = result.usage;
        if (result.metrics) modelMessage.metrics = result.metrics;
        if (result.model) modelMessage.model = result.model;
        if (result.artifact) modelMessage.artifact = result.artifact;
        activeChat = await window.dexerion.invoke('dex:ai-chat-append', { id: activeChat.id, message: modelMessage });
        await loadChats(activeChat.id);
        // loadChats can't reopen while busy, so repaint explicitly: the
        // reply must appear as a labeled message, not linger as a live bubble.
        renderList();
        renderMessages();
        return;
      }
      if (result && result.cancelled) {
        // Stopped: keep whatever streamed so far instead of wiping it.
        if (liveBubble && liveText) {
          liveBubble.style.display = '';
          paintLiveNow();
        } else if (liveBubble) liveBubble.remove();
        return;
      }
      if (liveBubble) { liveBubble.style.display = ''; liveBubble.textContent = '⚠ ' + ((result && result.error) || 'Could not reach the provider.'); }
    } catch (error) {
      if (liveBubble) { liveBubble.style.display = ''; liveBubble.textContent = '⚠ ' + (error.message || 'Could not send the message.'); }
    } finally {
      cancelLivePaint();
      if (liveStepsEl && liveStepsEl.isConnected) liveStepsEl.remove();
      liveStepsEl = null;
      liveBubble = null;
      liveText = '';
      skillAsk = null;
      skillSteps = null;
      closeAsk();
      requestId = null;
      busy = false;
      paintSendState();
      paintStatus('');
      input.focus();
      // A queued message sends itself as soon as this answer has landed.
      if (queue.length) {
        const next = queue.shift();
        setTimeout(() => { if (!busy && next) { input.value = next; submit(); } }, 60);
      }
    }
  }

  window.dexerion.on('dex:state', next => {
    state = next;
    if (state && state.account) {
      accountChanged(state.account.id);
      if (state.aiOpen && panel.hidden) setPanel(true);
    }
    // Ctrl+Shift+A, the toolbar button and the menu all toggle through main;
    // this keeps the panel in step even when the close came from outside it.
    if (state && state.aiOpen === false && !panel.hidden) setPanel(false);
  });
  // Multi-page previews: main reports every in-frame navigation on a served
  // site (link click, frame back/forward); hand it to the matching preview so
  // its page switcher and label stay true to what is on screen.
  window.dexerion.on('dex:site-nav', (payload) => {
    try {
      if (!payload || !payload.host) return;
      for (const frame of document.querySelectorAll('.dxa-frame')) {
        const src = String(frame.getAttribute('src') || '');
        if (src.indexOf('dexsite://' + payload.host + '/') !== 0) continue;
        const site = frame.closest('.dxa-site');
        if (site && typeof site.__dxaSetPage === 'function') site.__dxaSetPage(payload.path);
      }
    } catch { /* the chrome just does not follow this navigation */ }
  });
  window.dexerion.on('dex:ai-open', () => {
    setPanel(true);
    // The panel was hidden while the thread was built, so its real height only
    // exists now: re-check the scroll affordances.
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(updateScrollFloats);
  });
  window.dexerion.on('dex:ai-history-open', showChatsSheet);
  window.dexerion.on('dex:ai-close', () => setPanel(false));
  window.dexerion.on('dex:ai-chats-updated', nextAccount => {
    if (nextAccount === accountId && !busy) refreshChatList();
  });
  // Memory changed (learned automatically, or edited elsewhere): paint what
  // was pushed so new facts appear without reopening the panel.
  window.dexerion.on('dex:ai-memory-updated', facts => {
    if (!Array.isArray(facts)) return;
    renderMemory(facts);
  });
  // The API key was set or cleared from outside this panel (Settings,
  // another window): re-read status so the setup card doesn't stay stuck
  // showing "connect your key" when a key already exists (F-07).
  window.dexerion.on('dex:ai-key-changed', () => {
    loadStatusDebounced().catch(() => {});
  });
  // Missions / projects changed (live mirror or another window): refresh the
  // sheet when it is the visible one.
  window.dexerion.on('dex:ai-missions-updated', nextAccount => {
    if (nextAccount !== accountId) return;
    const sheet = $('#ai-mission-sheet');
    if (sheet && !sheet.hidden) renderMissions();
  });
  window.dexerion.on('dex:ai-projects-updated', nextAccount => {
    if (nextAccount !== accountId) return;
    const sheet = $('#ai-project-sheet');
    if (sheet && !sheet.hidden) renderProjects();
  });
  // Streamed deltas arrive per token; repainting markdown per token re-parses
  // the whole growing reply (O(n^2) on long answers). Coalesce paints to a
  // ~50ms trailing cadence — the content is identical, only the moment it
  // reaches the DOM changes; the final renders in deliver()/liveAgentRun()
  // flush the last state.
  function paintLiveNow() {
    if (livePaintTimer) { clearTimeout(livePaintTimer); livePaintTimer = null; }
    if (!liveBubble || !liveBubble.isConnected) return;
    // Agent mode keeps the thinking dots: streamed prose is the run's
    // intermediate reasoning, not the final answer. The saved reply lands in
    // the thread when the run ends.
    if (liveBubble.dataset.agent === '1') {
      messages.scrollTop = messages.scrollHeight;
      return;
    }
    // Keep a half-written artifact block out of the bubble; the validator
    // turns the finished block into a card after the stream settles.
    const shown = window.DexArtifacts ? window.DexArtifacts.visibleText(liveText) : liveText;
    if (!shown && liveText) {
      // The whole reply is becoming an artifact: keep the bubble honest with
      // a quiet note instead of going blank while the block streams.
      renderMarkdown(liveBubble, '');
      // Live progress beats a spinner: count the blocks/files that have
      // arrived so far and name the deliverable as soon as the model does.
      const seen = window.DexArtifacts && window.DexArtifacts.progress
        ? window.DexArtifacts.progress(liveText) : null;
      let note = liveBubble.querySelector('.ai-live-build');
      if (!note) {
        note = document.createElement('span');
        note.className = 'ai-live-build';
        liveBubble.appendChild(note);
      }
      const label = seen && seen.label ? seen.label : 'Building the artifact';
      const next = seen && seen.title ? label + ' — “' + seen.title + '”' : label;
      if (note.textContent !== next) note.textContent = next;
    } else {
      const old = liveBubble.querySelector('.ai-live-build');
      if (old) old.remove();
      renderMarkdown(liveBubble, shown);
    }
    messages.scrollTop = messages.scrollHeight;
  }
  function scheduleLivePaint() {
    if (livePaintTimer) return;
    livePaintTimer = setTimeout(paintLiveNow, 50);
  }
  function cancelLivePaint() {
    if (livePaintTimer) { clearTimeout(livePaintTimer); livePaintTimer = null; }
  }
  window.dexerion.on('dex:ai-chunk', payload => {
    if (!payload || payload.reqId !== requestId || !liveBubble) return;
    if (liveBubble.style.display === 'none') liveBubble.style.display = '';
    liveText = payload.full || liveText + (payload.delta || '');
    scheduleLivePaint();
  });
  // Skill loop events: consent cards, step rows, and honest endings.
  window.dexerion.on('dex:ai-skill', payload => {
    if (!payload || payload.reqId !== requestId) return;
    if (payload.type === 'capability-ask') {
      capAsk = { id: payload.id, cap: payload.capability };
      paintStatus('Waiting for you\u2026');
      const box = document.getElementById('ai-ask');
      if (box) {
        document.getElementById('ai-ask-what').textContent = payload.what
          || ('Turn on ' + (payload.label || CAP_LABELS[payload.capability] || 'this capability') + '?');
        document.getElementById('ai-ask-why').textContent = payload.why
          || 'Dexerion AI asked to use this. It stays on until you turn it off.';
        const desc = document.getElementById('ai-ask-desc');
        if (desc) desc.textContent = '';
        const field = document.getElementById('ai-ask-text');
        if (field) field.hidden = true;
        const always = document.getElementById('ai-ask-always');
        if (always) always.hidden = true;
        setAskButtons('Turn on', 'No');
        box.hidden = false;
        const yes = document.getElementById('ai-ask-yes');
        if (yes) yes.focus();
      }
      hintNote('Dexerion AI asked for a capability…');
      return;
    }
    if (payload.type === 'capability-expired') {
      capAsk = null;
      closeAsk();
      paintStatus('Working\u2026');
      hintNote('The capability request expired — continuing without it.');
      return;
    }
    if (payload.type === 'skill-ask') {
      skillAsk = { id: payload.id, tier: payload.tier };
      paintStatus('Waiting for you\u2026');
      const box = document.getElementById('ai-ask');
      if (box) {
        document.getElementById('ai-ask-what').textContent = 'Run \u201c' + (payload.label || payload.skill) + '\u201d?';
        const query = payload.args && payload.args.query ? ' ("' + payload.args.query + '")' : '';
        document.getElementById('ai-ask-why').textContent = (payload.why ? payload.why + query + ' ' : '') + 'Dexerion AI asks before skills like this.';
        const desc = document.getElementById('ai-ask-desc');
        if (desc) desc.textContent = payload.desc ? payload.desc : '';
        const field = document.getElementById('ai-ask-text');
        if (field) field.hidden = true;
        const always = document.getElementById('ai-ask-always');
        if (always) always.hidden = payload.tier !== 1;
        setAskButtons('Allow once', 'Don\u2019t');
        box.hidden = false;
        const yes = document.getElementById('ai-ask-yes');
        if (yes) yes.focus();
      }
      hintNote('Waiting for your OK\u2026');
    } else if (payload.type === 'skill-ask-expired') {
      skillAsk = null;
      closeAsk();
      paintStatus('Working\u2026');
      hintNote('The skill request expired \u2014 continuing without it.');
    } else if (payload.type === 'skill-run') {
      if (!skillSteps) return;
      const step = { n: skillSteps.length + 1, name: payload.skill, what: 'Run ' + (payload.label || payload.skill), status: 'live', detail: '' };
      upsertLiveStep(step);
      paintStatus('Running ' + (payload.label || payload.skill) + '\u2026');
      hintNote('Running ' + (payload.label || payload.skill) + '\u2026');
    } else if (payload.type === 'skill-result' && skillSteps) {
      paintStatus('Working\u2026');
      for (let i = skillSteps.length - 1; i >= 0; i--) {
        if (skillSteps[i].name !== payload.skill) continue;
        skillSteps[i].status = payload.ok ? 'ok' : 'bad';
        skillSteps[i].detail = payload.ok ? (payload.summary || 'Done.') : (payload.error || 'Failed.');
        updateLiveStep(payload.skill, skillSteps[i].status, skillSteps[i].detail);
        break;
      }
    } else if (payload.type === 'skill-denied' && skillSteps) {
      const step = {
        n: skillSteps.length + 1,
        name: payload.skill,
        what: (payload.decision === 'timeout' ? 'Timed out ' : 'Skipped ') + (payload.label || payload.skill),
        status: 'asked',
        detail: payload.decision === 'timeout' ? 'No answer in time.' : 'You declined.',
      };
      skillSteps.push(step);
      addLiveStep(step);
    }
  });
  // Agent run events from the main-owned loop: start/step/runbar/ask/end.
  window.dexerion.on('dex:agent-event', payload => {
    if (!payload) return;
    if (pendingRunStart && payload.type === 'start') {
      try { pendingRunStart(payload); } catch {}
      return;
    }
    onAgentEvent(payload);
  });
  window.dexerion.on('dex:ai-inspect-progress', p => {
    if (!inspectCard || !p || p.reqId !== inspectCard.reqId) return;
    const label = p.title || p.url || p.tabId || 'tab';
    const key = p.tabId || ('i' + p.i);
    const stepStatus = p.status === 'ok' ? 'ok' : p.status === 'reading' ? 'live' : 'bad';
    const detail = p.status === 'failed' ? (p.reason || 'failed') : '';
    const what = 'Read "' + label + '"';
    let slot = inspectCard.rows.get(key);
    if (!slot) {
      const row = makeStepRow({ n: p.i, what, status: stepStatus, detail });
      inspectCard.stepsEl.appendChild(row);
      const payload = { n: p.i, name: 'read_tab', what, status: stepStatus, detail };
      slot = { row, payload };
      inspectCard.rows.set(key, slot);
      inspectCard.steps.push(payload);
    } else {
      paintStepRow(slot.row, { what, status: stepStatus, detail });
      slot.payload.status = stepStatus;
      slot.payload.detail = detail;
    }
    inspectCard.status.textContent = p.status === 'reading'
      ? 'Reading tab ' + p.i + ' of ' + p.total + '…'
      : 'Read ' + p.i + ' of ' + p.total + ' tabs…';
    messages.scrollTop = messages.scrollHeight;
  });
  // Snip-to-chat: the overlay forwards its capture through the main process.
  window.dexerion.on('dex:ai-attach-image', payload => {
    if (panel.hidden) setPanel(true);
    addImageUrl(payload && payload.dataUrl, payload && payload.name);
  });

  // Widget wiring. Each lookup is guarded: a missing element must never
  // throw here, or everything below it (including send) would go unwired.
  const on = (id, ev, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(ev, fn);
    return el;
  };
  on('ai-new', 'click', createChat);
  on('ai-history', 'click', showChatsSheet);
  on('ai-agent-toggle', 'click', () => toggleCap('agent'));
  on('ai-vision-toggle', 'click', () => toggleCap('vision'));

  // Overflow menu: secondary sheets live behind one labelled control so the
  // taskbar keeps its two primary actions without hiding the rest.
  const moreBtn = $('#ai-more');
  const moreMenu = $('#ai-more-menu');
  function setMoreMenu(open, restoreFocus) {
    if (!moreBtn || !moreMenu) return;
    moreMenu.hidden = !open;
    moreMenu.inert = !open;
    if (open) moreMenu.setAttribute('aria-hidden', 'false');
    else moreMenu.setAttribute('aria-hidden', 'true');
    moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!open && restoreFocus) { try { moreBtn.focus(); } catch { /* best effort */ } }
  }
  setMoreMenu(false);
  if (moreBtn && moreMenu) {
    moreBtn.addEventListener('click', () => setMoreMenu(moreMenu.hidden));
    moreBtn.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowDown' && ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      setMoreMenu(true);
      const first = moreMenu.querySelector('.ai-overflow-item');
      if (first) first.focus();
    });
    moreMenu.addEventListener('keydown', (ev) => {
      const items = Array.from(moreMenu.querySelectorAll('.ai-overflow-item'));
      if (!items.length) return;
      const i = items.indexOf(document.activeElement);
      if (ev.key === 'ArrowDown') { ev.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); setMoreMenu(false, true); }
    });
    moreMenu.addEventListener('click', (ev) => {
      const item = ev.target && ev.target.closest ? ev.target.closest('.ai-overflow-item[data-sheet]') : null;
      if (!item) return;
      const actions = {
        'msg-search': openMsgSearch,
        recipes: showRecipesSheet,
        memory: showMemorySheet,
        missions: showMissionsSheet,
        projects: showProjectsSheet,
        'skill-log': showSkillLogSheet,
        settings: showSettingsSheet,
      };
      const action = actions[item.dataset.sheet];
      setMoreMenu(false, true);
      if (action) action();
    });
    document.addEventListener('click', (ev) => {
      if (!moreMenu.hidden && !moreBtn.parentElement.contains(ev.target)) setMoreMenu(false);
    });
  }
  search.oninput = renderList;
  if (effortBtn && effortMenu) {
    const box = effortBtn.closest('.ai-effort') || effortBtn.parentElement;
    box.addEventListener('mouseenter', () => openEffortMenu(true));
    box.addEventListener('mouseleave', () => { if (!box.contains(document.activeElement)) openEffortMenu(false); });
    effortBtn.addEventListener('click', () => openEffortMenu(effortMenu.hidden));
    effortBtn.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openEffortMenu(true);
        const first = effortMenu.querySelector('.ai-effort-item[aria-checked="true"]') || effortMenu.querySelector('.ai-effort-item');
        if (first) first.focus();
      }
    });
    effortMenu.addEventListener('click', (event) => {
      const item = event.target && event.target.closest ? event.target.closest('.ai-effort-item') : null;
      if (!item || !item.dataset.tier) return;
      setDifficulty(item.dataset.tier).then(() => { openEffortMenu(false); effortBtn.focus(); });
    });
    document.addEventListener('click', (event) => {
      if (!box.contains(event.target)) openEffortMenu(false);
    });
  }
  on('ai-runbar-stop', 'click', () => stopAgentRun());
  on('ai-runbar-pause', 'click', () => togglePauseRun());
  // Enter in the question box sends the answer.
  {
    const askField = document.getElementById('ai-ask-text');
    if (askField) {
      askField.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); answerAskStatic(true); }
      });
    }
  }
  on('ai-ask-yes', 'click', () => answerAskStatic(true));
  on('ai-ask-no', 'click', () => answerAskStatic(false));
  on('ai-ask-always', 'click', () => answerAskStatic(true, 'always'));
  on('ai-settings-close', 'click', () => hideAllSheets(true));
  on('ai-setup-open', 'click', () => {
    hideAllSheets(true);
    setup.hidden = false;
    loadStatusDebounced();
  });
  on('ai-keywarn-action', 'click', () => {
    setup.hidden = false;
    loadStatusDebounced();
    input.focus();
  });
  files.onchange = () => { addAttachments(Array.from(files.files || [])); files.value = ''; };
  const attachBtn = $('#ai-attach-btn');
  if (attachBtn) attachBtn.onclick = () => files.click();
  // One listener on the panel — a paste that lands in the textarea bubbles up to
  // it, so binding the input too would attach every image twice.
  panel.addEventListener('paste', handlePaste);
  input.oninput = () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
    maybePop().catch(() => {});
  };
  input.onkeydown = event => {
    // The / and @ menu owns the keys while it is open.
    if (popMenu && !popMenu.hidden) {
      if (event.key === 'ArrowDown') { event.preventDefault(); popIndex = Math.min(popItems.length - 1, popIndex + 1); renderPop(); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); popIndex = Math.max(0, popIndex - 1); renderPop(); return; }
      if ((event.key === 'Enter' || event.key === 'Tab') && popItems.length) { event.preventDefault(); pickPop(popIndex); return; }
      if (event.key === 'Escape') { event.preventDefault(); closePop(); return; }
    }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
    else if (event.key === 'Escape') {
      event.preventDefault();
      if (busy) stopRun();
      else if (agentRun) stopAgentRun();
      else closePanel();
    }
    // Ctrl+Enter as alternative send shortcut
    else if (event.key === 'Enter' && event.shiftKey && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submit(); }
  };
  send.onclick = () => { if (busy) stopRun(); else submit(); };
  on('ai-key-save', 'click', connectKey);
  on('ai-key-open', 'click', () => {
    const url = (lastStatus && lastStatus.docsUrl) || 'https://build.nvidia.com';
    window.dexerion.invoke('dex:new-tab', url, false).catch(() => {});
  });
  on('ai-provider', 'change', async () => {
    const picker = $('#ai-provider');
    if (!picker) return;
    const msg = $('#ai-key-message');
    if (msg) msg.textContent = '';
    const keyEl = $('#ai-key');
    if (keyEl) keyEl.value = '';
    const st = await window.dexerion.invoke('dex:ai-provider-set', picker.value).catch(() => null);
    if (!st || st.ok === false) {
      if (msg) msg.textContent = (st && st.error) || 'Could not switch provider.';
      return;
    }
    lastStatus = st;
    hasKey = Boolean(st.hasKey);
    await loadStatusDebounced();
  });
  on('ai-key', 'keydown', e => { if (e.key === 'Enter') { e.preventDefault(); connectKey(); } });
  on('ai-setup-done', 'click', () => { setup.hidden = true; input.focus(); });
  // Sheets are modal surfaces inside the sidebar. Hidden ones are inert (so
  // their controls never sit in the Tab order), the open one traps Tab, and
  // Escape returns focus to whatever opened it.
  const SHEET_IDS = [
    'ai-chat-sheet', 'ai-msg-search-sheet', 'ai-recipe-sheet', 'ai-memory-sheet',
    'ai-mission-sheet', 'ai-skill-log-sheet', 'ai-project-sheet',
    'ai-settings-sheet', 'ai-report-sheet',
  ];
  const SHEET_FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  let sheetReturnFocus = null;
  function setSheetVisibility(sheet, hidden) {
    if (!sheet) return;
    sheet.hidden = hidden;
    sheet.inert = hidden;
    if (hidden) sheet.setAttribute('aria-hidden', 'true');
    else sheet.removeAttribute('aria-hidden');
  }
  function hideAllSheets(restoreFocus = false, keepReturn = false) {
    for (const id of SHEET_IDS) setSheetVisibility(document.getElementById(id), true);
    if (restoreFocus && sheetReturnFocus && document.contains(sheetReturnFocus) &&
        !sheetReturnFocus.closest('[hidden], [inert]')) {
      try { sheetReturnFocus.focus(); } catch { /* best effort */ }
    }
    if (!keepReturn) sheetReturnFocus = null;
  }
  function activeSheet() {
    for (const id of SHEET_IDS) {
      const sheet = document.getElementById(id);
      if (sheet && !sheet.hidden) return sheet;
    }
    return null;
  }
  function focusableInSheet(root) {
    if (!root) return [];
    return Array.from(root.querySelectorAll(SHEET_FOCUSABLE)).filter((el) =>
      !el.hidden && (el.offsetWidth > 0 || el.offsetHeight > 0) && !el.closest('[inert]'));
  }
  function showSheet(id, onOpen, returnFocus) {
    const sheet = $(id);
    if (!sheet) return false;
    const wasHidden = sheet.hidden;
    const restore = returnFocus || (wasHidden ? document.activeElement : sheetReturnFocus);
    hideAllSheets(false, true);
    setSheetVisibility(sheet, false);
    sheetReturnFocus = restore;
    if (wasHidden && onOpen) onOpen();
    return wasHidden;
  }
  document.addEventListener('keydown', (ev) => {
    const sheet = activeSheet();
    if (!sheet || !ev) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      hideAllSheets(true);
      return;
    }
    if (ev.key !== 'Tab') return;
    const items = focusableInSheet(sheet);
    if (!items.length) { ev.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1];
    if (!sheet.contains(document.activeElement)) { ev.preventDefault(); first.focus(); return; }
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  });
  hideAllSheets();

  // ---------- report view ----------
  // A full-panel view over the chat: the document, the closed look dials, the
  // version stepper across same-titled reports, and a revision box. The look
  // is persisted per message through dex:ai-artifact-look.
  const REPORT_THEMES = ['clean', 'editorial', 'brief', 'modern', 'magazine', 'academic', 'notebook'];
  const REPORT_PAPERS = ['paper', 'white', 'pink', 'blue', 'green', 'lavender', 'peach', 'grey'];
  const REPORT_PATTERNS = ['solid', 'hatch', 'diagonal'];
  const REPORT_FONTS = ['editorial', 'neutral', 'typewriter'];
  let reportView = { items: [], index: 0 };

  function closeReport() {
    hideAllSheets(true);
    hideReportComment();
  }

  function hideReportComment() {
    const btn = $('#ai-report-comment');
    if (btn) btn.hidden = true;
  }

  function reportItems(title) {
    const wanted = String(title || '').toLowerCase();
    const items = [];
    if (!activeChat) return items;
    activeChat.messages.forEach((message, i) => {
      const art = message && message.artifact;
      if (art && art.kind === 'report' && String(art.title || '').toLowerCase() === wanted) items.push({ index: i, artifact: art });
    });
    return items;
  }

  // Claude/Dia-style: the card opens the report as a viewer layered over the
  // current tab — the chat stays readable beside it, and the viewer carries
  // its own × (plus an "Open in tab" escape hatch). If the overlay cannot
  // open, fall back to the full page in a tab so a report is never stuck.
  function openReportTab(artifact, index) {
    if (!artifact || artifact.kind !== 'report') return;
    const chatId = activeChat ? activeChat.id : '';
    const idx = Number.isInteger(index) ? index : -1;
    window.dexerion.invoke('dex:report-overlay-open', { chatId, index: idx })
      .then((ok) => { if (ok === false) throw new Error('overlay unavailable'); })
      .catch(() => {
        const query = [];
        if (chatId) query.push('chat=' + encodeURIComponent(chatId));
        if (idx >= 0) query.push('i=' + idx);
        const url = 'dexerion://report' + (query.length ? '?' + query.join('&') : '');
        window.dexerion.invoke('dex:new-tab', url, false).catch(() => {});
      });
  }

  function openReport(artifact, index) {
    if (!artifact || artifact.kind !== 'report') return;
    const items = reportItems(artifact.title);
    if (!items.length) return;
    const wanted = items.findIndex((item) => item.index === index);
    reportView = { items, index: wanted >= 0 ? wanted : items.length - 1 };
    renderReportView();
    showSheet('#ai-report-sheet');
  }

  function currentReport() {
    return reportView.items[reportView.index] || null;
  }

  function refreshReportItems() {
    const entry = currentReport();
    if (!entry) { closeReport(); return; }
    const items = reportItems(entry.artifact.title);
    if (items.length) {
      const wanted = items.findIndex((item) => item.index === entry.index);
      reportView = { items, index: wanted >= 0 ? wanted : items.length - 1 };
    }
    renderReportView();
  }

  function paintPaperSwatches() {
    const box = $('#ai-report-papers');
    if (!box || box.dataset.built) return;
    box.dataset.built = '1';
    for (const paper of REPORT_PAPERS) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'ai-paper-dot';
      dot.dataset.paper = paper;
      dot.title = paper;
      dot.setAttribute('aria-label', 'Paper colour: ' + paper);
      box.appendChild(dot);
    }
  }

  function renderReportView() {
    paintPaperSwatches();
    hideReportComment();
    const entry = currentReport();
    if (!entry) { closeReport(); return; }
    const art = entry.artifact;
    const titleEl = $('#ai-report-title');
    if (titleEl) titleEl.textContent = art.title || 'Report';
    const versionEl = $('#ai-report-version');
    if (versionEl) versionEl.textContent = 'v' + (art.version || 1);
    const prev = $('#ai-report-prev');
    const next = $('#ai-report-next');
    if (prev) prev.disabled = reportView.index <= 0;
    if (next) next.disabled = reportView.index >= reportView.items.length - 1;
    const setVal = (sel, value) => { const el = $(sel); if (el) el.value = value; };
    setVal('#ai-report-theme', REPORT_THEMES.includes(art.theme) ? art.theme : 'clean');
    setVal('#ai-report-pattern', REPORT_PATTERNS.includes(art.pattern) ? art.pattern : 'solid');
    setVal('#ai-report-font', REPORT_FONTS.includes(art.font) ? art.font : 'neutral');
    const swatches = $('#ai-report-papers');
    if (swatches) {
      for (const dot of swatches.querySelectorAll('.ai-paper-dot')) {
        dot.classList.toggle('sel', dot.dataset.paper === (art.paper || 'paper'));
      }
    }
    const body = $('#ai-report-body');
    if (body) {
      body.replaceChildren();
      if (window.DexArtifacts) {
        window.DexArtifacts.renderBody(body, art, { onLink: openAiLink, onToast: hintNote });
      }
    }
    // Integrated preview for website artifacts (site kind)
    const preview = $('#ai-report-preview');
    if (preview) {
      if (art.kind === 'site' && art.html) {
        preview.hidden = false;
        preview.replaceChildren();
        const iframe = document.createElement('iframe');
        iframe.sandbox = 'allow-same-origin allow-scripts';
        iframe.srcdoc = art.html;
        preview.appendChild(iframe);
      } else {
        preview.hidden = true;
      }
    }
  }

  function applyReportLook(patch) {
    const entry = currentReport();
    if (!entry) return;
    entry.artifact = Object.assign({}, entry.artifact, patch);
    if (activeChat && activeChat.messages[entry.index]) activeChat.messages[entry.index].artifact = entry.artifact;
    renderReportView();
    window.dexerion.invoke('dex:ai-artifact-look', {
      chatId: activeChat && activeChat.id,
      index: entry.index,
      look: patch,
    }).catch(() => {});
  }

  // ---------- report presets ----------
  // A preset is a mode for the next message: the shape text rides in front of
  // whatever the person typed, so the sent message is exactly what the model
  // saw (no hidden prompt injection).
  let presetList = null;
  let activePreset = null;

  function paintPreset() {
    const chip = $('#ai-preset-chip');
    const name = $('#ai-preset-name');
    if (chip) chip.hidden = !activePreset;
    if (name) name.textContent = activePreset ? activePreset.name : '';
  }

  // The preset is chosen by asking ("use the research brief preset") — the
  // menu chrome is gone; the chip stays as the read-only reminder.
  async function usePresetByName(text) {
    if (!presetList) {
      const list = await window.dexerion.invoke('dex:ai-presets').catch(() => null);
      presetList = Array.isArray(list) ? list : [];
    }
    const t = String(text || '').toLowerCase();
    const preset = presetList.find((p) => t.includes(String(p.name || '').toLowerCase()) || t.includes(String(p.id || '').toLowerCase()));
    if (!preset) return false;
    activePreset = preset;
    paintPreset();
    return true;
  }

  function node(tag, text) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = String(text);
    return el;
  }

  // ---------- report export, full page and inline comments ----------
  const EXPORT_FORMATS = [['pdf', 'PDF'], ['html', 'HTML'], ['md', 'Markdown'], ['docx', 'Word (.docx)']];

  function openReportMenu() {
    const menu = $('#ai-report-menu');
    if (!menu) return;
    if (!menu.hidden) { menu.hidden = true; return; }
    menu.replaceChildren();
    for (const pair of EXPORT_FORMATS) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'ai-preset-item';
      item.setAttribute('role', 'menuitem');
      item.appendChild(node('b', pair[1]));
      item.onclick = () => { menu.hidden = true; exportReport(pair[0]); };
      menu.appendChild(item);
    }
    menu.hidden = false;
  }

  async function exportReport(format) {
    const entry = currentReport();
    if (!entry || !window.DexReportExport || !window.DexArtifacts) return;
    hintNote('Preparing ' + format.toUpperCase() + '…');
    const result = await window.dexerion.invoke('dex:ai-report-export', {
      format,
      name: window.DexReportExport.name(entry.artifact),
      html: window.DexReportExport.html(entry.artifact),
      markdown: window.DexArtifacts.toMarkdown(entry.artifact),
      artifact: entry.artifact,
    }).catch((error) => ({ ok: false, error: error.message }));
    if (result && result.ok) hintNote('Saved: ' + result.path);
    else if (result && result.canceled) hintNote('');
    else hintNote('Export failed: ' + ((result && result.error) || 'unknown error'));
  }

  // Selecting text in the document offers a Comment chip; it prefills the
  // revision box with the passage, which is the whole inline-comment loop for
  // now (the model answers with a new version).
  function placeReportComment() {
    const btn = $('#ai-report-comment');
    const body = $('#ai-report-body');
    const sheet = $('#ai-report-sheet');
    if (!btn || !body || !sheet || sheet.hidden) return;
    const selection = window.getSelection();
    const text = selection ? String(selection).trim() : '';
    if (!text || text.length < 4 || !selection.rangeCount || !body.contains(selection.anchorNode)) {
      btn.hidden = true;
      return;
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    const host = sheet.getBoundingClientRect();
    btn.style.top = Math.max(46, rect.top - host.top - 30) + 'px';
    btn.style.left = Math.max(8, Math.min(rect.left - host.left, host.width - 92)) + 'px';
    btn.hidden = false;
  }

  // In-panel settings (scAI settings panel, Dexerion prefs only — the
  // identity prompt stays fixed, keys stay in the setup wizard).
  async function syncSettingsSheet() {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.checked = Boolean(val); };
    const sel = (id, val) => { const el = document.getElementById(id); if (el) el.value = String(val); };
    invalidateStatusLoads();
    const statusSeq = loadStatusSeq;
    try {
      const [page, agent, ui, status, site, caps] = await Promise.all([
        window.dexerion.invoke('dex:ai-page-get').catch(() => null),
        window.dexerion.invoke('dex:ai-agent-get').catch(() => null),
        window.dexerion.invoke('dex:ai-ui-get').catch(() => null),
        window.dexerion.invoke('dex:ai-status').catch(() => null),
        window.dexerion.invoke('dex:ai-site-get').catch(() => null),
        window.dexerion.invoke('dex:ai-caps-get').catch(() => null),
      ]);
      if (status) {
        applyStatus(status, statusSeq);
        if (status.routing) {
          const policy = document.getElementById('ai-route-policy');
          if (policy) policy.value = status.routing.mode === 'off' ? 'off' : (status.routing.policy || 'balanced');
        }
      }
      if (page) {
        pagePrefs = page;
        set('ai-set-use-page', page.usePage);
        set('ai-set-use-selection', page.useSelection);
        set('ai-set-full-page', page.fullPage);
        sel('ai-set-context-chars', page.contextChars);
        paintPageToggle();
      }
      if (agent) {
        agentPrefs = agent;
        set('ai-set-agent', agent.agent);
        set('ai-set-allowlist', agent.agentAllowlistOn);
        const sites = document.getElementById('ai-set-sites');
        if (sites && document.activeElement !== sites) sites.value = (agent.agentSites || []).join('\n');
        sel('ai-set-steps', agentPrefs.agentMaxSteps);
        set('ai-set-macros', agent.agentMacros);
        set('ai-set-crosstab', agent.agentCrossTab !== false);
        paintAgentToggle();
      }
      if (ui) {
        uiPrefs = ui;
        set('ai-set-usage', ui.showUsage);
        set('ai-set-save-chats', ui.saveChats !== false);
        set('ai-set-planfirst', ui.agentPlanFirst === true);
        applyAiWidth(ui.width);
      }
      if (site && typeof site === 'object') {
        sitePrefs = site;
        const siteToggle = document.getElementById('ai-set-site');
        if (siteToggle) {
          siteToggle.disabled = !site.host;
          siteToggle.checked = Boolean(site.host) && !site.off;
        }
        const hostEl = document.getElementById('ai-set-site-host');
        if (hostEl) hostEl.textContent = site.host || 'this site';
      }
      if (caps && typeof caps === 'object') {
        aiCaps = caps;
        paintCapToggles();
        set('ai-set-websites', caps.websites);
        set('ai-set-documents', caps.documents);
      }
    } catch { /* prefs stay as they were */ }
  }

  function bindSettingsSheet() {
    const patchPage = (p) => window.dexerion.invoke('dex:ai-page-set', p).then(prefs => {
      if (prefs && typeof prefs === 'object') { pagePrefs = prefs; paintPageToggle(); }
    }).catch(() => {});
    const patchAgent = (p) => window.dexerion.invoke('dex:ai-agent-set', p).then(prefs => {
      if (prefs && typeof prefs === 'object') { agentPrefs = prefs; paintAgentToggle(); paintRunbar(agentRun && agentRun.label, agentRun && agentRun.seenSteps); }
    }).catch(() => {});
    const patchCaps = (p) => window.dexerion.invoke('dex:ai-caps-set', p).then(caps => {
      if (caps && typeof caps === 'object') { aiCaps = caps; paintCapToggles(); }
    }).catch(() => {});
    const onToggle = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => fn(el.checked));
    };
    onToggle('ai-set-use-page', v => patchPage({ usePage: v }));
    onToggle('ai-set-use-selection', v => patchPage({ useSelection: v }));
    onToggle('ai-set-full-page', v => patchPage({ fullPage: v }));
    onToggle('ai-set-agent', v => patchAgent({ agent: v }));
    onToggle('ai-set-websites', v => patchCaps({ websites: v }));
    onToggle('ai-set-documents', v => patchCaps({ documents: v }));
    onToggle('ai-set-allowlist', v => patchAgent({ agentAllowlistOn: v }));
    onToggle('ai-set-macros', v => patchAgent({ agentMacros: v }));
    onToggle('ai-set-crosstab', v => patchAgent({ agentCrossTab: v }));
    onToggle('ai-set-usage', v => {
      window.dexerion.invoke('dex:ai-ui-set', { showUsage: v }).then(prefs => {
        if (prefs && typeof prefs === 'object') { uiPrefs = prefs; renderMessages(); }
      }).catch(() => {});
    });
    onToggle('ai-set-planfirst', v => {
      window.dexerion.invoke('dex:ai-ui-set', { agentPlanFirst: v }).then(prefs => {
        if (prefs && typeof prefs === 'object') uiPrefs = prefs;
      }).catch(() => {});
    });
    onToggle('ai-set-save-chats', v => {
      window.dexerion.invoke('dex:ai-ui-set', { saveChats: v }).then(prefs => {
        if (prefs && typeof prefs === 'object') uiPrefs = prefs;
        hintNote(v ? 'Conversations are saved on this device.' : 'Conversations now last for this window only.');
      }).catch(() => {});
    });
    onToggle('ai-set-site', v => {
      window.dexerion.invoke('dex:ai-site-set', { off: !v }).then(res => {
        if (res && typeof res === 'object') sitePrefs = res;
        paintPageToggle();
        if (!v) hintNote('Dexerion AI is off for this site. Reading and acting are paused here.');
      }).catch(() => {});
    });
    const selChars = document.getElementById('ai-set-context-chars');
    if (selChars) selChars.addEventListener('change', () => patchPage({ contextChars: parseInt(selChars.value, 10) || 12000 }));
    const selSteps = document.getElementById('ai-set-steps');
    if (selSteps) selSteps.addEventListener('change', () => patchAgent({ agentMaxSteps: parseInt(selSteps.value, 10) || 25 }));
    const route = document.getElementById('ai-route-policy');
    if (route) {
      route.addEventListener('change', () => {
        const value = route.value;
        const patch = value === 'off' ? { mode: 'off' } : { mode: 'auto', policy: value };
        window.dexerion.invoke('dex:ai-routing-set', patch).catch(() => {});
      });
    }
    const sites = document.getElementById('ai-set-sites');
    if (sites) {
      let t = null;
      sites.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          patchAgent({ agentSites: sites.value.split('\n').map(s => s.trim()).filter(Boolean) });
        }, 400);
      });
    }
  }

  let uiPrefs = { showUsage: true, aiLayout: 'a', width: 480 };
  async function loadUiPrefs() {
    const prefs = await window.dexerion.invoke('dex:ai-ui-get').catch(() => null);
    if (prefs && typeof prefs === 'object') uiPrefs = prefs;
    applyLayoutPref();
    applyAiWidth(uiPrefs.width);
  }

  // ---------- resizable assistant width ----------
  // The panel is anchored right, so dragging the left edge left widens it.
  // The width is mirrored to the account prefs so main can inset the page
  // view, and it is restored on the next boot.
  const AI_W_MIN = 320;
  const AI_W_MAX = 720;
  const AI_W_DEFAULT = 480;
  function clampAiWidth(value) {
    const n = Number(value);
    return Math.max(AI_W_MIN, Math.min(AI_W_MAX, Number.isFinite(n) ? Math.round(n) : AI_W_DEFAULT));
  }
  function applyAiWidth(value) {
    const px = clampAiWidth(value);
    panel.style.setProperty('--ai-w', px + 'px');
    const handle = $('#ai-resize');
    if (handle) handle.setAttribute('aria-valuenow', String(px));
    return px;
  }
  function currentAiWidth() {
    const raw = parseFloat(panel.style.getPropertyValue('--ai-w'));
    return clampAiWidth(Number.isFinite(raw) ? raw : AI_W_DEFAULT);
  }
  function wireAiResize() {
    const handle = $('#ai-resize');
    if (!handle || handle.dataset.wired) return;
    handle.dataset.wired = '1';
    let dragging = false;
    let timer = 0;
    const send = (px) => window.dexerion.invoke('dex:ai-ui-set', { width: px }).catch(() => {});
    const commit = (px, immediate) => {
      const next = applyAiWidth(px);
      clearTimeout(timer);
      if (immediate) send(next);
      else timer = setTimeout(() => send(next), 120);
      return next;
    };
    const fromPointer = (clientX) => clampAiWidth(window.innerWidth - clientX);
    handle.addEventListener('pointerdown', (event) => {
      dragging = true;
      handle.classList.add('dragging');
      try { handle.setPointerCapture(event.pointerId); } catch {}
      event.preventDefault();
    });
    handle.addEventListener('pointermove', (event) => { if (dragging) commit(fromPointer(event.clientX), false); });
    const stop = (event) => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      try { handle.releasePointerCapture(event.pointerId); } catch {}
      commit(currentAiWidth(), true);
    };
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
    handle.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 40 : 16;
      if (event.key === 'ArrowLeft') { event.preventDefault(); commit(currentAiWidth() + step, true); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); commit(currentAiWidth() - step, true); }
      else if (event.key === 'Home') { event.preventDefault(); commit(AI_W_MIN, true); }
      else if (event.key === 'End') { event.preventDefault(); commit(AI_W_MAX, true); }
    });
  }

  // Preview flag (?ai-layout=) wins immediately at boot AND whenever prefs
  // load; otherwise the stored layout applies. (A missing else-branch here
  // once left every preview stuck on "a".)
  function applyLayoutPref() {
    try {
      const q = new URLSearchParams(window.location.search).get('ai-layout');
      if (q === 'a' || q === 'b' || q === 'c') { panel.dataset.aiLayout = q; return; }
    } catch {}
    try {
      const stored = uiPrefs && uiPrefs.aiLayout;
      panel.dataset.aiLayout = stored === 'b' || stored === 'c' ? stored : 'a';
    } catch {}
  }
  try {
    const qb = new URLSearchParams(window.location.search).get('ai-layout');
    if (qb === 'a' || qb === 'b' || qb === 'c') panel.dataset.aiLayout = qb;
  } catch {}

  // The rail's old buttons live on as intents ("show my files", "open
  // settings", …) and the app menu. The sheets themselves are unchanged.
  function openSheet(id, onOpen) {
    const sheet = $(id);
    if (!sheet) return false;
    if (!sheet.hidden) { hideAllSheets(true); return false; }
    return showSheet(id, onOpen);
  }
  function showChatsSheet() { return openSheet('#ai-chat-sheet'); }
  function showRecipesSheet() { return openSheet('#ai-recipe-sheet', renderRecipes); }
  function showMemorySheet() { return openSheet('#ai-memory-sheet', loadMemory); }
  function showMissionsSheet() { return openSheet('#ai-mission-sheet', renderMissions); }
  function showSkillLogSheet() { return openSheet('#ai-skill-log-sheet', renderSkillLog); }
  function showProjectsSheet() { return openSheet('#ai-project-sheet', renderProjects); }
  function showSettingsSheet() { return openSheet('#ai-settings-sheet', syncSettingsSheet); }
  on('ai-recipes-close', 'click', () => hideAllSheets(true));
  // Dedicated exits: closing a sheet never needs a round trip through ⋯.
  on('ai-chats-close', 'click', () => hideAllSheets(true));
  on('ai-chats-clear-all', 'click', async () => {
    if (busy) return;
    if (!await window.dexerion.invoke('dex:confirm', { message: 'Delete every chat in this account? This cannot be undone.' }).catch(() => false)) return;
    try {
      await window.dexerion.invoke('dex:ai-chats-clear');
    } catch {
      hintNote('Could not delete just now — try again.');
      return;
    }
    activeChat = null;
    await loadChats();
    input.focus();
  });
  on('ai-missions-close', 'click', () => hideAllSheets(true));
  on('ai-skill-log-close', 'click', () => hideAllSheets(true));
  on('ai-projects-close', 'click', () => hideAllSheets(true));
  on('ai-missions-clear', 'click', async () => {
    if (!await window.dexerion.invoke('dex:confirm', { message: 'Delete all finished missions? Running ones stay.' }).catch(() => false)) return;
    try {
      await window.dexerion.invoke('dex:ai-missions-clear');
      renderMissions();
    } catch {
      hintNote('Could not clear just now — try again.');
    }
  });
  on('ai-memory-close', 'click', () => hideAllSheets(true));
  // ---------- report view bindings ----------
  on('ai-preset-clear', 'click', () => { activePreset = null; paintPreset(); });
  on('ai-report-download', 'click', openReportMenu);
  on('ai-report-tab', 'click', () => {
    const entry = currentReport();
    if (!entry || !activeChat) return;
    const url = 'dexerion://report?chat=' + encodeURIComponent(activeChat.id) + '&i=' + entry.index;
    window.dexerion.invoke('dex:new-tab', url, false).catch(() => {});
  });
  on('ai-report-comment', 'click', () => {
    const selection = window.getSelection();
    const text = selection ? String(selection).trim().slice(0, 400) : '';
    hideReportComment();
    if (!text) return;
    const entry = currentReport();
    const title = entry ? (entry.artifact.title || 'the report') : 'the report';
    const field = $('#ai-report-revise');
    if (field) {
      field.value = 'In the report "' + title + '", revise the passage: "' + text + '" — ';
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    }
  });
  const reportBodyEl = $('#ai-report-body');
  if (reportBodyEl) {
    reportBodyEl.addEventListener('mouseup', () => setTimeout(placeReportComment, 0));
    reportBodyEl.addEventListener('keyup', (event) => {
      if (event.key === 'Shift' || event.key.indexOf('Arrow') === 0) setTimeout(placeReportComment, 0);
    });
  }
  on('ai-report-back', 'click', closeReport);
  on('ai-report-close', 'click', closeReport);
  on('ai-report-prev', 'click', () => { if (reportView.index > 0) { reportView.index -= 1; renderReportView(); } });
  on('ai-report-next', 'click', () => { if (reportView.index < reportView.items.length - 1) { reportView.index += 1; renderReportView(); } });
  on('ai-report-theme', 'change', () => { const el = $('#ai-report-theme'); if (el) applyReportLook({ theme: el.value }); });
  on('ai-report-pattern', 'change', () => { const el = $('#ai-report-pattern'); if (el) applyReportLook({ pattern: el.value }); });
  on('ai-report-font', 'change', () => { const el = $('#ai-report-font'); if (el) applyReportLook({ font: el.value }); });
  const reportPapers = $('#ai-report-papers');
  if (reportPapers) {
    reportPapers.addEventListener('click', (event) => {
      const dot = event.target && event.target.closest ? event.target.closest('.ai-paper-dot') : null;
      if (dot) applyReportLook({ paper: dot.dataset.paper });
    });
  }
  const reviseForm = $('#ai-report-revise-form');
  if (reviseForm) {
    reviseForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const field = $('#ai-report-revise');
      const note = field ? field.value.trim() : '';
      if (!note) return;
      const entry = currentReport();
      const title = entry ? (entry.artifact.title || 'the report') : 'the report';
      input.value = 'Revise the report "' + title + '". ' + note;
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 100) + 'px';
      closeReport();
      submit();
    });
  }

  bindSettingsSheet();
  wireAiResize();

  // ---------- Modern composer chip wiring ----------
  const chipReply = $('#ai-chip-reply');
  const chipForward = $('#ai-chip-forward');
  const chipEdit = $('#ai-chip-edit');
  const chipPin = $('#ai-chip-pin');
  const chipReact = $('#ai-chip-react');
  const replyTargetClear = $('#ai-reply-target-clear');
  if (chipReply) chipReply.onclick = () => {
    if (targetedMessage && targetedMessage.kind === 'reply') { clearTarget(); return; }
    const m = (targetedMessage && targetedMessage.id) ? messageById(targetedMessage.id) :
      (activeChat && activeChat.messages.length ? activeChat.messages[activeChat.messages.length - 1] : null);
    if (m) setTarget('reply', m.id);
  };
  if (chipForward) chipForward.onclick = () => {
    if (targetedMessage && targetedMessage.kind === 'forward') { clearTarget(); return; }
    const m = (targetedMessage && targetedMessage.id) ? messageById(targetedMessage.id) :
      (activeChat && activeChat.messages.length ? activeChat.messages[activeChat.messages.length - 1] : null);
    if (m) setTarget('forward', m.id);
  };
  if (chipEdit) chipEdit.onclick = () => {
    const m = (targetedMessage && targetedMessage.id) ? messageById(targetedMessage.id) :
      (activeChat && activeChat.messages.length ? activeChat.messages[activeChat.messages.length - 1] : null);
    if (m && m.role === 'user') { clearTarget(); startEdit(m.id); }
    else hintNote('Only your own messages can be edited.');
  };
  if (chipPin) chipPin.onclick = () => {
    const m = (targetedMessage && targetedMessage.id) ? messageById(targetedMessage.id) :
      (activeChat && activeChat.messages.length ? activeChat.messages[activeChat.messages.length - 1] : null);
    if (m) { togglePin(m.id); clearTarget(); }
  };
  if (chipReact) chipReact.onclick = () => {
    const m = (targetedMessage && targetedMessage.id) ? messageById(targetedMessage.id) :
      (activeChat && activeChat.messages.length ? activeChat.messages[activeChat.messages.length - 1] : null);
    if (m) openEmojiPicker(m.id);
  };
  if (replyTargetClear) replyTargetClear.onclick = () => { clearTarget(); input.focus(); };

  // ---------- Emoji picker wiring ----------
  const emojiPicker = $('#ai-emoji-picker');
  const emojiPickerClose = $('#ai-emoji-picker-close');
  if (emojiPickerClose) emojiPickerClose.onclick = closeEmojiPicker;
  // Click outside closes the picker.
  panel.addEventListener('click', (ev) => {
    if (!emojiPicker || emojiPicker.hidden) return;
    if (!emojiPicker.contains(ev.target)) closeEmojiPicker();
  });

  // ---------- Conversation search sheet wiring ----------
  const msgSearchBack = $('#ai-msg-search-back');
  const msgSearchClose = $('#ai-msg-search-close');
  const msgSearchInput = $('#ai-msg-search-input');
  const msgSearchJumpBottom = $('#ai-msg-search-jump-bottom');
  const msgSearchJumpTop = $('#ai-msg-search-jump-top');
  if (msgSearchBack) msgSearchBack.onclick = closeMsgSearch;
  if (msgSearchClose) msgSearchClose.onclick = closeMsgSearch;
  if (msgSearchInput) msgSearchInput.oninput = () => { renderMsgSearchResults(); updateScrollFloats(); };
  if (msgSearchJumpBottom) msgSearchJumpBottom.onclick = scrollToBottom;
  if (msgSearchJumpTop) msgSearchJumpTop.onclick = scrollToTop;

  // ---------- Scroll floats ----------
  const scrollBottom = $('#ai-scroll-bottom');
  const scrollTop = $('#ai-scroll-top');
  if (scrollBottom) scrollBottom.onclick = scrollToBottom;
  if (scrollTop) scrollTop.onclick = scrollToTop;
  messages.addEventListener('scroll', () => { updateScrollFloats(); });

  // Close emoji picker / target on Escape anywhere in panel.
  panel.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      closeEmojiPicker();
      if (msgSearchActive) closeMsgSearch();
      if (targetedMessage) clearTarget();
      if (editingMessageId) cancelEdit();
    }
  });

  on('ai-memory-clear', 'click', async () => {
    if (!await window.dexerion.invoke('dex:confirm', { message: 'Forget everything the assistant remembers about this account?' }).catch(() => false)) return;
    try {
      await window.dexerion.invoke('dex:ai-memory-clear');
      loadMemory();
    } catch {
      hintNote('Could not forget just now — try again.');
    }
  });

  window.dexerion.invoke('dex:get-state').then(next => {
    state = next;
    if (state && state.account) {
      accountChanged(state.account.id);
      if (state.aiOpen && panel.hidden) setPanel(true);
    }
    if (window.lucide && window.lucide.createIcons) {
      try { window.lucide.createIcons(); } catch {}
    }
    // Logo fallback: if the brand art fails to load, the letter stays.
    try {
      document.querySelectorAll('img.ai-logo-img').forEach(img => {
        const dead = () => { try { img.remove(); } catch {} };
        if (img.complete && img.naturalWidth === 0) dead();
        else img.addEventListener('error', dead, { once: true });
      });
    } catch {}
  }).catch(() => {});
})();
