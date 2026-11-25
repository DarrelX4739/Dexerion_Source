// Dexerion AI skill approvals — the consent queue behind every skill run.
//
// Pure state (no Electron): the main process creates one instance per app,
// asks `request()` before a tier >= 1 skill runs, resolves it with `decide()`
// when the person taps Allow/Deny in the conversation, and records every run
// in a bounded audit ring. An unanswered request expires as a denial.
'use strict';

const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_LOG = 200;

function createApprovals(opts) {
  const options = opts || {};
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const pending = new Map();   // request id -> entry
  const always = new Map();    // chatId -> Set(skillId)
  const log = [];              // audit ring, newest last
  let seq = 0;

  // Tier 1 skills the person already allowed in this chat skip the card.
  function isAlwaysAllowed(chatId, skillId) {
    const set = always.get(String(chatId || ''));
    return Boolean(set && set.has(String(skillId || '')));
  }

  // Creates a pending request. Returns { auto: true } when the chat already
  // always-allows the skill, otherwise the request id to watch for.
  function request(input) {
    const entry = input || {};
    const chatId = String(entry.chatId || '');
    const skill = String(entry.skill || '');
    if (entry.auto !== false && isAlwaysAllowed(chatId, skill)) {
      return { auto: true, id: '', reason: 'always' };
    }
    seq += 1;
    const id = 'ask' + seq.toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    pending.set(id, {
      id,
      winId: entry.winId,
      chatId,
      skill,
      args: (entry.args && typeof entry.args === 'object') ? entry.args : {},
      why: String(entry.why || '').slice(0, 300),
      tier: Number(entry.tier) || 1,
      at: now(),
    });
    return { auto: false, id };
  }

  // Resolves a request. `scope: 'always'` is only honoured with allow, so a
  // tier 2 skill (which never offers it) can never be silently remembered.
  function decide(id, allow, scope) {
    const entry = pending.get(String(id || ''));
    if (!entry) return null;
    pending.delete(entry.id);
    const remember = Boolean(allow) && scope === 'always' && entry.tier < 2;
    if (remember) {
      if (!always.has(entry.chatId)) always.set(entry.chatId, new Set());
      always.get(entry.chatId).add(entry.skill);
    }
    return {
      id: entry.id,
      winId: entry.winId,
      chatId: entry.chatId,
      skill: entry.skill,
      args: entry.args,
      why: entry.why,
      tier: entry.tier,
      allow: Boolean(allow),
      scope: remember ? 'always' : (allow ? 'once' : (scope === 'timeout' ? 'timeout' : 'deny')),
      decidedAt: now(),
    };
  }

  // Anything left unanswered past the timeout resolves as a denial. Returns
  // the expired entries so the caller can tell the model and repaint.
  function expireStale() {
    const cut = now() - timeoutMs;
    const expired = [];
    for (const [id, entry] of pending) {
      if (entry.at < cut) {
        pending.delete(id);
        expired.push({
          id, winId: entry.winId, chatId: entry.chatId, skill: entry.skill,
          args: entry.args, why: entry.why, tier: entry.tier,
          allow: false, scope: 'timeout', decidedAt: now(),
        });
      }
    }
    return expired;
  }

  // Clearing a chat forgets its "always" grants and drops its pending cards.
  function clearChat(chatId) {
    const key = String(chatId || '');
    always.delete(key);
    for (const [id, entry] of pending) {
      if (entry.chatId === key) pending.delete(id);
    }
  }

  // The audit ring: one row per decided or finished run.
  function record(row) {
    const entry = row || {};
    log.push({
      at: now(),
      skill: String(entry.skill || ''),
      decision: String(entry.decision || ''),
      ok: Boolean(entry.ok),
      ms: Math.max(0, Number(entry.ms) || 0),
      args: String(entry.args || '').slice(0, 200),
    });
    while (log.length > MAX_LOG) log.shift();
    return log.length;
  }

  function list(chatId) {
    const all = Array.from(pending.values());
    if (chatId === undefined) return all;
    const key = String(chatId || '');
    return all.filter((entry) => entry.chatId === key);
  }

  function grants(chatId) {
    return Array.from(always.get(String(chatId || '')) || []);
  }

  return {
    request,
    decide,
    expireStale,
    clearChat,
    record,
    list,
    grants,
    isAlwaysAllowed,
    pendingCount: () => pending.size,
    log: () => log.slice(),
  };
}

module.exports = { createApprovals, DEFAULT_TIMEOUT_MS, MAX_LOG };
