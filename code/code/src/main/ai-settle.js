// Page settling after an action that can navigate.
//
// A click is not finished when the click returns: it may commit a navigation
// that lands a few hundred milliseconds later. Reading the page immediately
// gave the model the old document, so a run had to guess with wait_for. This
// waits for the commit and for the load to finish, and reports honestly whether
// the page really changed.
//
// The tab is any object with isLoading() and getURL(): a real webContents, or a
// stub in the tests. No Electron here on purpose.
'use strict';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Poll for a navigation commit, then (when one happened) wait for the load to
// finish. Returns { changed, url, stillLoading } - never throws.
async function settleAfterAction(tab, beforeUrl, opts) {
  const o = opts || {};
  const budgetMs = Math.max(500, Math.min(15000, Number(o.ms) || 6000));
  const pollMs = Math.max(20, Math.min(500, Number(o.pollMs) || 120));
  const settle = o.settle || (async (t, ms) => {
    const end = Date.now() + ms;
    for (;;) {
      let loading = false;
      try { loading = t.isLoading(); } catch { return false; }
      if (!loading) return true;
      if (Date.now() >= end) return false;
      await sleep(50);
    }
  });
  const start = String(beforeUrl || '');
  const deadline = Date.now() + budgetMs;
  let lastUrl = start;
  try { lastUrl = String(tab.getURL() || start); } catch { lastUrl = start; }
  if (lastUrl !== start) {
    const settled = await settle(tab, Math.max(500, deadline - Date.now()));
    try { lastUrl = String(tab.getURL() || lastUrl); } catch { /* keep the last reading */ }
    return { changed: true, url: lastUrl, stillLoading: !settled };
  }
  // A same-document action (a menu opening, a tab switching): nothing to wait
  // for, so stop early — but only after a short observation window, because a
  // real navigation can commit a few hundred milliseconds after the click.
  const observeMs = Math.max(pollMs * 2, Math.min(budgetMs, Number(o.minObserveMs) || 400));
  const observeUntil = Date.now() + observeMs;
  let quiet = 0;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    let loading = false;
    let url = lastUrl;
    try { loading = tab.isLoading(); }
    catch {
      // The tab stopped answering (destroyed, or its process is going away).
      // Nothing was observed to change and nothing settled, so say neither —
      // `unknown` is the honest answer, and the caller only acts on `changed`.
      return { changed: false, url: lastUrl, stillLoading: false, unknown: true };
    }
    try { url = String(tab.getURL() || lastUrl); } catch { /* keep the last reading */ }
    if (url !== start) {
      const settled = await settle(tab, Math.max(500, deadline - Date.now()));
      try { url = String(tab.getURL() || url); } catch { /* keep the last reading */ }
      return { changed: true, url, stillLoading: !settled };
    }
    if (loading) { quiet = 0; continue; }
    // Two quiet polls inside the observation window: a click that stayed put
    // (dialogs, in-page state) - do not burn the whole budget on it.
    quiet += 1;
    if (quiet >= 2 && Date.now() >= observeUntil) break;
  }
  return { changed: false, url: lastUrl, stillLoading: false };
}

module.exports = { settleAfterAction };
