// Dexerion Assistant — provider transport, task routing, memory and artifacts.
//
// The assistant is no longer tied to one endpoint. `ai-providers.js` owns the
// wire formats (NVIDIA NIM, OpenAI, native Google Gemini); this file owns the
// application-facing behaviour: one encrypted key per provider, live model
// catalogues, deterministic task routing, streaming with cancellation and
// bounded retries, per-account memory, and validated structured artifacts.
//
// Keys are encrypted with the OS keychain and every request is made from the
// main process, so a page can never read them.
const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');
const providers = require('./ai-providers');
const router = require('./ai-router');
const artifacts = require('./ai-artifacts');
const siteInteractivity = require('./site-interactivity');
const siteResearchAssets = require('./site-research-assets');
const modelScout = require('./ai-model-scout');

const { PROVIDERS, PROVIDER_IDS, NIM_BASE: BASE, NIM_RECOMMENDED: RECOMMENDED } = providers;
const DEFAULT_MODEL = PROVIDERS.nim.defaultModel;
const KEY_HINT = PROVIDERS.nim.keyHint;
const MAX_IMAGES = 4;
const MAX_IMAGE_DATA_CHARS = 4000000;
const MAX_TOTAL_IMAGE_DATA_CHARS = 16000000;
const IMAGE_DATA_URL = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const matchesImageDataUrl = (_image, url) => IMAGE_DATA_URL.test(url);
function streamImageMatcher() {
  let memo;
  return (image, url) => {
    // Routing, image fan-out and wire assembly inspect the same large URLs.
    // Reuse only an exact check for this object and immutable URL value, only
    // during the current send. Retries revalidate if the URL has changed.
    if (typeof url !== 'string' || url.length < 4096 || !image
        || (typeof image !== 'object' && typeof image !== 'function')) return matchesImageDataUrl(image, url);
    memo ||= new WeakMap();
    const cached = memo.get(image);
    if (cached && cached.url === url) return cached.matches;
    const matches = matchesImageDataUrl(image, url);
    memo.set(image, { url, matches });
    return matches;
  };
}
const omitCountedImageUrl = (key, value) => key === 'url' ? '' : value;
const VISION_MODEL_ID = providers.VISION_ID;
const WARM_TTL_MS = 10 * 60 * 1000;
// Stay-warm cadence while the browser is in use (see keepWarm): refresh the
// pooled connection earlier than the status TTL, but never more often than
// this — and back off for a whole window after one failed refresh.
const KEEP_WARM_MS = 3 * 60 * 1000;
const KEEP_WARM_BACKOFF_MS = 5 * 60 * 1000;
const STREAM_TIMEOUT_MS = 120000;
const NON_STREAM_TIMEOUT_MS = 30000;
// Nemotron reasoning models can spend 8k+ tokens thinking before they write a
// single visible character. A site writes a whole document in one turn, so it
// needs a much larger ceiling than chat; 65k still only bills what is used.
const MAX_OUTPUT_TOKENS = 65536;
const ARTIFACT_OUTPUT_TOKENS = 65536;
// Reasoning models can spend thousands of tokens thinking before the answer.
// Ordinary chat needs a much larger ceiling than a non-reasoning reply.
const REASONING_CHAT_OUTPUT_TOKENS = 32768;
// One-shot corrective notes for the automatic retries: an empty reply from a
// reasoning model, and a reply cut off before its artifact block closed.
const EMPTY_RETRY_SUFFIX = 'Your previous reply came back empty. Answer the last message now: one short sentence of findings, then the deliverable in the agreed dex-artifact format when one was asked for. Do not think out loud.';
const ARTIFACT_RETRY_SUFFIX = 'Your previous reply was cut off before the artifact block closed. Write the complete deliverable again now as ONE valid dex-artifact block - valid JSON inside the fence, closed, with no commentary after it.';
function mergeSuffix(base, add) { return base ? String(base) + '\n\n' + add : add; }
const MAX_CONTEXT_CHARS = 500000;
// Ordinary chat used to be hard-capped at 12k characters, which dropped most
// of a long conversation and made follow-ups lose the thread. Keep it generous
// but bounded so persona + memory + tools still fit a 32k-token model.
const MAX_CONVERSATION_CONTEXT_CHARS = 60000;
const MAX_WIRE_MESSAGES = 80;
const MAX_WIRE_TEXT_CHARS = 16000;
// Per-request timing logs (DEX_AI_TIMING=1): latency marks only — never keys,
// prompts or reply text. Exists to measure transport and prewarm changes.
const AI_TIMING = Boolean(process.env.DEX_AI_TIMING);

// Circuit breaker: after N consecutive failures, stop trying for a window.
// Prevents hammering a dead key and gives clear errors instead of retries.
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes, and any settings change resumes it immediately

// The identity and grounding rules. Every reply carries this; memory facts
// are appended below it. Copy lives in ai-prompts.js so tests can assert it.
const prompts = require('./ai-prompts');
const PERSONA = prompts.SYSTEM_PROMPT;

// ---------- trusted model snapshot (pure data; refresh with vendor:model-data)
let scoutSnapshotCache = null;
function scoutSnapshot() {
  if (scoutSnapshotCache !== null) return scoutSnapshotCache;
  try {
    scoutSnapshotCache = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../../assets/model-scout/snapshot.json'), 'utf8')
    );
  } catch { scoutSnapshotCache = null; }
  return scoutSnapshotCache;
}

function appVersion() {
  try {
    const eapp = require('electron').app;
    return eapp && typeof eapp.getVersion === 'function' ? String(eapp.getVersion()) : '';
  } catch { return ''; }
}

// ---------- persistent memory (pure helpers; storage lives in browser.js) ---
const MAX_FACTS = 50;
const MAX_FACT_CHARS = 500;

function normFact(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, MAX_FACT_CHARS);
}

// "remember ...", "remember that ..." → save. "forget ..."/"forget about ..."
// → delete match. "what do you remember?" → recall. Everything else → null.
function parseMemoryCommand(raw) {
  const text = String(raw || '').trim();
  let m = /^(?:please\s+)?remember\s+(?:that\s+)?(.+)$/i.exec(text);
  if (m) {
    const fact = normFact(m[1]);
    if (!fact || /\?\s*$/.test(fact)) return null; // questions aren't memories
    return { action: 'remember', fact };
  }
  m = /^(?:please\s+)?forget\s+(?:about\s+)?(.+)$/i.exec(text);
  if (m) {
    const query = normFact(m[1]);
    if (!query || /\?\s*$/.test(query)) return null;
    return { action: 'forget', query };
  }
  if (/^(?:what\s+do\s+you\s+remember\??|list\s+(?:your\s+)?memor(?:y|ies)|show\s+(?:your\s+)?memor(?:y|ies))\s*\??$/i.test(text)) {
    return { action: 'recall' };
  }
  return null;
}

function factKey(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// list: [{id, text, createdAt}]. Returns {list, added:boolean, reason?}.
function addMemory(list, fact) {
  const facts = Array.isArray(list) ? list.slice() : [];
  const text = normFact(fact);
  if (!text) return { list: facts, added: false, reason: 'empty' };
  if (facts.some(f => factKey(f && f.text) === factKey(text))) {
    return { list: facts, added: false, reason: 'duplicate' };
  }
  if (facts.length >= MAX_FACTS) {
    return { list: facts, added: false, reason: 'full' };
  }
  facts.push({ id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, createdAt: Date.now() });
  return { list: facts, added: true };
}

// Removes every fact containing the query (case-insensitive).
function removeMemory(list, query) {
  const facts = Array.isArray(list) ? list.slice() : [];
  const q = factKey(query);
  if (!q) return { list: facts, removed: [] };
  const removed = facts.filter(f => factKey(f && f.text).includes(q));
  return { list: facts.filter(f => !factKey(f && f.text).includes(q)), removed };
}

function memoryPrompt(list) {
  const facts = (Array.isArray(list) ? list : [])
    .map(f => normFact(f && f.text))
    .filter(Boolean);
  if (!facts.length) return '';
  return 'Things to remember about the user (persistent memory — refer to these when relevant):\n'
    + facts.map(f => '- ' + f).join('\n');
}

function memoryRecap(list) {
  const facts = (Array.isArray(list) ? list : [])
    .map(f => normFact(f && f.text))
    .filter(Boolean);
  if (!facts.length) return 'I don\'t have anything remembered yet. Tell me something with "remember …".';
  return 'Here\'s what I remember:\n' + facts.map(f => '- ' + f).join('\n');
}

// ---------- configuration ---------------------------------------------------
function blankProviders() {
  const out = {};
  for (const id of PROVIDER_IDS) out[id] = { key: '', model: '', baseUrl: '' };
  return out;
}

function sanitizeRouting(raw) {
  const r = (raw && typeof raw === 'object') ? raw : {};
  const pins = {};
  if (r.pins && typeof r.pins === 'object' && !Array.isArray(r.pins)) {
    for (const task of Object.keys(r.pins).slice(0, 20)) {
      const pin = r.pins[task];
      if (!pin || typeof pin !== 'object') continue;
      const model = String(pin.model || '').trim().slice(0, 200);
      if (!model) continue;
      pins[String(task).slice(0, 40)] = { model, strict: pin.strict === true };
    }
  }
  return {
    mode: r.mode === 'off' ? 'off' : 'auto',
    policy: ['balanced', 'quality', 'cost'].includes(r.policy) ? r.policy : 'balanced',
    // NIM is the only backend: a failed request never moves private context to
    // another company, opt-in or not.
    crossProvider: false,
    pins,
  };
}

// The persisted scout result: four tier picks plus the fingerprint/version the
// scan ran against. Anything malformed is dropped rather than trusted.
function sanitizeScout(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const source = (raw.tiers && typeof raw.tiers === 'object') ? raw.tiers : {};
  const tiers = {};
  for (const id of modelScout.TIER_IDS) {
    const pick = source[id];
    if (!pick || typeof pick !== 'object' || typeof pick.model !== 'string' || !pick.model) {
      tiers[id] = null;
      continue;
    }
    tiers[id] = {
      tier: id,
      model: pick.model.slice(0, 200),
      reason: String(pick.reason || '').slice(0, 300),
      evidence: (pick.evidence && typeof pick.evidence === 'object') ? pick.evidence : {},
    };
  }
  return {
    tiers,
    fingerprint: String(raw.fingerprint || '').slice(0, 80),
    appVersion: String(raw.appVersion || '').slice(0, 40),
    policy: String(raw.policy || '').slice(0, 40),
    capturedAt: String(raw.capturedAt || '').slice(0, 40),
    reason: String(raw.reason || '').slice(0, 40),
  };
}

function normalizeStored(raw) {
  const rec = (raw && typeof raw === 'object') ? raw : {};
  const out = {
    // NIM is the only backend. A stored choice from an older build migrates to
    // NIM on load; the other key rows are kept on disk but never used.
    provider: 'nim',
    providers: blankProviders(),
    routing: sanitizeRouting(rec.routing),
    scout: sanitizeScout(rec.scout),
  };
  let migrated = false;
  if (rec.providers && typeof rec.providers === 'object' && !Array.isArray(rec.providers)) {
    for (const id of PROVIDER_IDS) {
      const row = rec.providers[id];
      if (!row || typeof row !== 'object') continue;
      if (typeof row.key === 'string') out.providers[id].key = row.key;
      if (typeof row.model === 'string') out.providers[id].model = row.model;
      if (typeof row.baseUrl === 'string') out.providers[id].baseUrl = row.baseUrl.trim().replace(/\/+$/, '');
      if (typeof row.pinned === 'string') out.providers[id].pinned = row.pinned;
    }
  }
  // V1 config: { key, model } belonged to NIM. Keep it working untouched.
  if (!rec.providers && (typeof rec.key === 'string' || typeof rec.model === 'string')) {
    if (typeof rec.key === 'string') out.providers.nim.key = rec.key;
    if (typeof rec.model === 'string') out.providers.nim.model = rec.model;
    migrated = true;
  }
  // Self-healing: a corrupt field from any older build must never poison
  // status() — drop it, keep the rest.
  for (const id of PROVIDER_IDS) {
    if (typeof out.providers[id].key !== 'string') out.providers[id].key = '';
    if (typeof out.providers[id].model !== 'string') out.providers[id].model = '';
    if (typeof out.providers[id].baseUrl !== 'string') out.providers[id].baseUrl = '';
    if (typeof out.providers[id].pinned !== 'string') out.providers[id].pinned = '';
  }
  return { config: out, migrated };
}

function createAi({ profile }) {
  const cfgFile = path.join(profile.dir, 'ai-config.json');
  let cached = null;
  let warmedAt = 0;       // last successful exchange (prewarm, connect test or chat)
  let keepWarmFailedAt = 0; // last failed stay-warm refresh (bounded backoff)
  let circuitFailures = 0;   // consecutive failures (trips circuit breaker)
  let circuitTrippedAt = 0;  // when the circuit was tripped (0 = not tripped)
  let lastRun = null;     // diagnostics for Settings/About, never secrets
  let scouting = false;   // a scan in flight (suppresses nested catalogue scans)
  const catalogues = new Map(); // providerId -> {all, recommended, models, at}
  // A key save, model test and prewarm can all ask for the same catalogue at
  // once. Share the in-flight request so a cold start does not pay the NIM
  // /models round trip two or three times. Keyed by provider + key + baseUrl so
  // a config change can never reuse a stale fetch.
  const catalogFetches = new Map(); // provider+config -> in-flight Promise
  // Models this account is not provisioned for (404 "function not found").
  // Remembered for the session so resolution and the fallback stop picking
  // them - the catalogue lists models the key cannot actually chat with.
  const provisionBlocks = new Map(); // providerId -> Set(modelId)
  const blockedModels = (providerId) => provisionBlocks.get(providerId) || null;
  function noteProvisionMiss(providerId, model) {
    const pid = String(providerId || '');
    const mid = String(model || '');
    if (!pid || !mid) return;
    const set = provisionBlocks.get(pid) || new Set();
    set.add(mid);
    provisionBlocks.set(pid, set);
  }
  const live = new Map();

  // Any successful exchange refreshes the warmth clock and clears the
  // keep-warm backoff — status() and keepWarm() then tell the truth.
  function markWarm() { warmedAt = Date.now(); keepWarmFailedAt = 0; circuitFailures = 0; circuitTrippedAt = 0; }

  function circuitCheck() {
    const now = Date.now();
    if (circuitTrippedAt && now - circuitTrippedAt < CIRCUIT_BACKOFF_MS) {
      return { tripped: true, msLeft: Math.round(CIRCUIT_BACKOFF_MS - (now - circuitTrippedAt)) };
    }
    if (circuitTrippedAt && now - circuitTrippedAt >= CIRCUIT_BACKOFF_MS) {
      // Backoff window expired: allow one attempt (half-open state)
      circuitTrippedAt = 0;
      return { tripped: false };
    }
    return { tripped: false };
  }

  function circuitTrip() {
    circuitFailures += 1;
    if (circuitFailures >= CIRCUIT_FAILURE_THRESHOLD) {
      circuitTrippedAt = Date.now();
    }
  }

  function persist(rec) {
    try {
      fs.mkdirSync(profile.dir, { recursive: true });
      if (safeStorage.isEncryptionAvailable()) {
        const data = safeStorage.encryptString(JSON.stringify(rec)).toString('base64');
        fs.writeFileSync(cfgFile, JSON.stringify({ enc: true, data }, null, 2));
      } else {
        fs.writeFileSync(cfgFile, JSON.stringify({ plain: JSON.stringify(rec) }, null, 2));
      }
    } catch (err) {
      throw new Error('Could not save the AI settings on disk: ' + (err.message || err));
    }
  }

  function load() {
    if (cached) return cached;
    let rec = null;
    try {
      if (fs.existsSync(cfgFile)) {
        const raw = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
        if (raw.enc && safeStorage.isEncryptionAvailable()) {
          rec = JSON.parse(safeStorage.decryptString(Buffer.from(raw.data, 'base64')));
        } else if (raw.plain) rec = JSON.parse(raw.plain);
        else rec = raw;
      }
    } catch {}
    const normalized = normalizeStored(rec);
    cached = normalized.config;
    if (normalized.migrated) {
      try { persist(cached); } catch {}
    }
    return cached;
  }

  function save(patch) {
    const cur = load();
    const next = JSON.parse(JSON.stringify(cur));
    if (patch.provider !== undefined && patch.provider !== null) {
      const id = String(patch.provider);
      if (!PROVIDER_IDS.includes(id)) throw new Error('Unknown AI provider.');
      next.provider = id;
    }
    const active = next.provider;
    // `!== undefined` (and non-null) so an empty string clears the key rather
    // than being mistaken for "not supplied" — and a null never becomes the
    // literal string "null".
    if (patch.key !== undefined && patch.key !== null) next.providers[active].key = String(patch.key).trim();
    if (patch.model !== undefined) next.providers[active].model = String(patch.model).trim();
    if (patch.pinned !== undefined) next.providers[active].pinned = String(patch.pinned).trim();
    if (patch.baseUrl !== undefined) next.providers[active].baseUrl = String(patch.baseUrl).trim().replace(/\/+$/, '');
    if (patch.routing !== undefined) next.routing = sanitizeRouting({ ...next.routing, ...(patch.routing || {}) });
    persist(next);
    cached = next;
    // A key/provider/baseUrl change invalidates the catalogue — it is per-key
    // and per-endpoint. Leaving a stale catalogue after a Base URL edit made a
    // custom provider "connect" against the old host and then fail on send.
    if (patch.key !== undefined || patch.provider !== undefined || patch.baseUrl !== undefined) {
      catalogues.delete(active);
      warmedAt = 0;
      keepWarmFailedAt = 0;
    }
    if (patch.provider !== undefined) warmedAt = 0;
    // Any config change that could fix a failing send resumes the breaker:
    // the pause message tells the person to switch models, and a switch must
    // actually reset it (it used to keep them locked out for the full window).
    if (patch.key !== undefined || patch.provider !== undefined || patch.model !== undefined || patch.baseUrl !== undefined) {
      circuitFailures = 0;
      circuitTrippedAt = 0;
    }
    // A fresh key is the one guaranteed re-scan point for the model scout.
    if (patch.key !== undefined && patch.key !== null && String(patch.key).trim()) {
      runScout('key-connect').catch(() => {});
    }
    return status();
  }

  function activeConfig(c) {
    const config = c || load();
    return {
      c: config,
      p: config.providers[config.provider],
      prov: PROVIDERS[config.provider],
    };
  }

  function providerBaseUrl(c) {
    const { p } = activeConfig(c);
    return p && p.baseUrl ? p.baseUrl : null;
  }

  function requireKey() {
    const { p, prov } = activeConfig();
    if (!p.key) throw new Error('Add your ' + prov.label + ' API key to use Dexerion AI.');
  }

  function catalogueFor(id) {
    return catalogues.get(id) || null;
  }

  function modelInfo(c, task) {
    const cat = catalogueFor(c.provider);
    if (!cat) return null;
    if (task && c.routing.mode === 'auto') {
      const pick = router.chooseModel({
        models: cat.models, task, selected: c.providers[c.provider].model,
        policy: c.routing.policy, pins: c.routing.pins,
      });
      if (pick && pick.modelInfo) return pick.modelInfo;
    }
    return cat.models.find((m) => m.id === c.providers[c.provider].model) || null;
  }

  // Which model should actually be used. If the saved one has been retired we
  // fall back rather than failing every message with "model not found".
  function resolveModel(c, requireVision, opts) {
    const { p, prov } = activeConfig(c);
    const cat = catalogueFor(c.provider);
    const models = cat ? cat.models : [];
    const saved = (p && typeof p.model === 'string') ? p.model : '';
    const needVision = (m) => Boolean(m && (m.vision || VISION_MODEL_ID.test(m.id)));
    if (requireVision) {
      if (saved && (models.length ? needVision(models.find((m) => m.id === saved)) : VISION_MODEL_ID.test(saved))) {
        return { model: saved, substituted: false, providerId: c.provider };
      }
      if (models.length) {
        const vision = models.find(needVision);
        if (vision) return { model: vision.id, substituted: Boolean(saved), providerId: c.provider, modelInfo: vision };
      } else if (prov.visionModel) {
        return { model: prov.visionModel, substituted: Boolean(saved), providerId: c.provider };
      }
      throw new Error('No vision-capable model is available for ' + prov.label + '. Choose a different model or remove the image.');
    }
    // Models this account is not provisioned for are skipped for ROUTING and
    // fallback picks, so what the rescue discovered sticks.
    const blocked = blockedModels(c.provider);
    const usable = (blocked && blocked.size) ? models.filter((m) => !blocked.has(m.id)) : models;
    // A manual model pick pins the choice: it wins over the effort tiers until
    // the effort changes (which clears the pin) or the model retires.
    const pinned = (p && typeof p.pinned === 'string') ? p.pinned : '';
    if (pinned && (!cat || cat.ids.includes(pinned))) {
      return { model: pinned, substituted: false, providerId: c.provider };
    }
    // Effort is the default chooser: the scout's pick for the tier, drawn
    // from the Nemotron line (vision-capable). Callers that show the effort
    // control pass opts.difficulty; a stale tier pick falls through to the
    // normal resolution so a retired model never fails the message.
    const tier = (opts && modelScout.TIER_IDS.includes(opts.difficulty)) ? opts.difficulty : '';
    if (tier && usable.length && c.scout && c.scout.tiers) {
      const pick = c.scout.tiers[tier];
      const found = (pick && pick.model) ? usable.find((m) => m.id === pick.model) : null;
      if (found) {
        return {
          model: found.id,
          substituted: false,
          providerId: c.provider,
          modelInfo: found,
          task: 'difficulty:' + tier,
          reason: (pick && pick.reason) || '',
          tier,
        };
      }
    }
    // A saved choice that survived (legacy configs, rescue winners): it beats
    // auto-routing but not the effort tiers above.
    if (saved && (!cat || cat.ids.includes(saved))) {
      return { model: saved, substituted: false, providerId: c.provider };
    }
    const task = opts && opts.task;
    if (task && c.routing.mode === 'auto' && usable.length) {
      const pick = router.chooseModel({
        models: usable, task, selected: saved, policy: c.routing.policy, pins: c.routing.pins,
      });
      if (pick && pick.model) {
        return {
          model: pick.model,
          substituted: pick.model !== saved,
          providerId: c.provider,
          task,
          reason: pick.reason,
          routed: true,
          modelInfo: pick.modelInfo,
        };
      }
    }
    if (cat) {
      if (prov.defaultModel && usable.some((m) => m.id === prov.defaultModel)) {
        return { model: prov.defaultModel, substituted: Boolean(saved), providerId: c.provider };
      }
      const rec = usable[0];
      if (rec) return { model: rec.id, substituted: Boolean(saved), providerId: c.provider };
    }
    // No catalogue yet, or the saved choice is gone from it: fall back to the
    // configured default.
    return { model: saved || prov.defaultModel, substituted: false, providerId: c.provider };
  }

  function systemContent(memory) {
    const mem = memoryPrompt(memory);
    // Every request carries today's date + the search-for-time-sensitive rule.
    const base = PERSONA + '\n\n' + prompts.currentDateLine(new Date());
    return mem ? base + '\n\n' + mem : base;
  }

  function providerSummary(c) {
    return PROVIDER_IDS.map((id) => ({
      id,
      label: PROVIDERS[id].label,
      active: c.provider === id,
      hasKey: Boolean(c.providers[id].key),
      model: c.providers[id].model,
      baseUrl: c.providers[id].baseUrl,
      encrypted: safeStorage.isEncryptionAvailable(),
    }));
  }

  function status(difficulty) {
    const c = load();
    const { p, prov } = activeConfig(c);
    const cat = catalogueFor(c.provider);
    const { model: resolved, substituted } = resolveModel(c, false);
    // What the controls say the assistant will use: a manual pin, else the
    // effort tier's Nemotron pick, else the saved choice. The picker shows
    // exactly this - routing must never make a selection look like it "did
    // not take". A retired model (gone from the catalogue) is the one case
    // that still substitutes, because it can never answer again.
    const saved = (p && typeof p.model === 'string') ? p.model : '';
    const pinned = (p && typeof p.pinned === 'string') ? p.pinned : '';
    const validPinned = pinned && (!cat || cat.ids.includes(pinned)) ? pinned : '';
    const tierPick = tierPickFor(difficulty);
    const retired = Boolean(saved && cat && !cat.ids.includes(saved));
    const chosen = validPinned || tierPick || (retired ? '' : saved);
    const blocked = blockedModels(c.provider);
    const model = validPinned || tierPick || (retired ? resolved : (saved || resolved));
    return {
      provider: prov.label,
      providerId: c.provider,
      providerLabel: prov.label,
      hasKey: Boolean(p.key),
      keyMasked: p.key ? '••••••••' + p.key.slice(-4) : '',
      keyHint: prov.keyHint,
      keyPlaceholder: prov.keyPlaceholder,
      docsUrl: prov.docsUrl,
      docsLabel: prov.docsLabel,
      encrypted: safeStorage.isEncryptionAvailable(),
      model,
      modelAvailable: chosen
        ? Boolean(!cat || (cat.ids.includes(chosen) && !(blocked && blocked.has(chosen))))
        : !substituted,
      warm: Boolean(warmedAt) && (Date.now() - warmedAt) < WARM_TTL_MS,
      // the picker is populated from the live catalogue, never a hard-coded list
      models: cat ? cat.recommended : [],
      allModels: cat ? cat.all : [],
      modelsLoaded: Boolean(cat),
      providers: providerSummary(c),
      routing: { ...c.routing },
      scout: scoutSummary(c),
      last: lastRun,
    };
  }

  function setProvider(id) {
    return save({ provider: id });
  }

  function setRouting(patch) {
    return save({ routing: patch }).routing;
  }

  function cancel(reqId) {
    const id = String(reqId || '');
    // Tombstones stop a mid-retry stream from resurrecting, but they must not
    // accumulate forever: cap the map so cancelled runs cannot leak memory.
    if (live.size > 200) {
      for (const [k, v] of live) {
        if (v && v.cancelled) live.delete(k);
        if (live.size <= 150) break;
      }
    }
    const s = live.get(id);
    if (!s) { live.set(id, { cancelled: true, abort: null, at: Date.now() }); return; } // tombstone: a retry in flight stays dead
    s.cancelled = true;
    try { s.abort && s.abort(); } catch {}
  }

  function chainStopped(reqId) {
    const tomb = live.get(reqId);
    return Boolean(tomb && tomb.cancelled);
  }

  // Fetch what this key can actually reach. Catalogue shape is provider
  // specific only at the adapter boundary; callers see IDs plus model info.
  async function refreshModels(providerId) {
    const c = load();
    const id = PROVIDER_IDS.includes(providerId) ? providerId : c.provider;
    const p = c.providers[id];
    if (!p.key) throw new Error('Add your ' + PROVIDERS[id].label + ' API key first.');
    const fetchKey = id + '\u0000' + p.key + '\u0000' + (p.baseUrl || '');
    const running = catalogFetches.get(fetchKey);
    if (running) return running;
    const task = (async () => {
      const t0 = performance.now();
      const cat = await providers.listModels(id, { apiKey: p.key, baseUrl: p.baseUrl });
      if (AI_TIMING) console.log('[dex-ai] models fetched ms=' + Math.round(performance.now() - t0) + ' count=' + ((cat && cat.all && cat.all.length) || 0));
      const current = load().providers[id];
      // The key/baseUrl may have changed while this was in flight. Never let
      // an old answer overwrite the new configuration's catalogue.
      if (current && current.key === p.key && (current.baseUrl || '') === (p.baseUrl || '')) {
        catalogues.set(id, cat);
        // A changed catalogue is a re-scan trigger (the fingerprint is compared
        // inside runScout; a scan already in flight suppresses the nested call).
        if (!scouting) runScout('catalogue', { refresh: false }).catch(() => {});
      }
      return cat;
    })();
    catalogFetches.set(fetchKey, task);
    try {
      return await task;
    } finally {
      if (catalogFetches.get(fetchKey) === task) catalogFetches.delete(fetchKey);
    }
  }

  // ---------- model scout (trusted-source model choice per difficulty) ------
  // Runs once when a key is connected, when the catalogue changes, on an app
  // update, on a retired-model failure, or by hand. The result is four tier
  // picks with their evidence; a plain restart never rescans.
  async function runScout(reason, opts) {
    if (scouting) return null;
    scouting = true;
    try {
      const c = load();
      const p = c.providers[c.provider];
      if (!p.key) return null;
      const canRefresh = !opts || opts.refresh !== false;
      if (!catalogueFor(c.provider) && canRefresh) {
        try { await refreshModels(); } catch { /* heuristics still work */ }
      }
      const cat = catalogueFor(c.provider);
      if (!cat) return c.scout || null;
      const fingerprint = modelScout.fingerprintCatalogue(cat.all || []);
      const check = modelScout.shouldRescan({
        reason,
        fingerprint,
        storedFingerprint: c.scout && c.scout.fingerprint,
        appVersion: appVersion(),
        storedAppVersion: c.scout && c.scout.appVersion,
        policy: modelScout.LINEUP.policy,
        storedPolicy: c.scout && c.scout.policy,
      });
      if (!check.rescan) return c.scout || null;
      const current = load();
      const tiers = modelScout.pickAll(cat.models, scoutSnapshot());
      const next = JSON.parse(JSON.stringify(current));
      next.scout = {
        tiers,
        fingerprint,
        appVersion: appVersion(),
        policy: modelScout.LINEUP.policy,
        capturedAt: new Date().toISOString(),
        reason: String(reason || 'manual').slice(0, 40),
      };
      persist(next);
      cached = next;
      return next.scout;
    } finally {
      scouting = false;
    }
  }

  function scoutSummary(c) {
    const s = c && c.scout;
    if (!s) return null;
    return {
      capturedAt: s.capturedAt,
      appVersion: s.appVersion,
      tiers: modelScout.TIER_IDS.map((id) => {
        const pick = s.tiers ? s.tiers[id] : null;
        if (!pick) return null;
        const evidence = pick.evidence || {};
        return {
          id,
          model: pick.model,
          estimated: Boolean(evidence.estimated),
          source: String(evidence.source || ''),
          anchor: Boolean(evidence.anchor),
        };
      }).filter(Boolean),
    };
  }

  // Ordered candidates for connect-time probing: resolved first, then the
  // recommended list, then everything else. Capped so a sweep stays quick.
  function candidateModels(c, requireVision) {
    const cat = catalogueFor(c.provider);
    const seen = new Set();
    const out = [];
    const push = (m) => {
      if (!m || !m.id || seen.has(m.id)) return;
      if (requireVision && !(m.vision || VISION_MODEL_ID.test(m.id))) return;
      seen.add(m.id);
      out.push(m);
    };
    try {
      const resolved = resolveModel(c, requireVision);
      push(resolved.modelInfo || { id: resolved.model });
    } catch {}
    if (cat) {
      for (const m of cat.models) push(m);
    }
    return out.slice(0, 8);
  }

  // A real 1-token completion. GET /models happily succeeds for a bad key on
  // some deployments, so only an actual completion proves the key works.
  async function test() {
    requireKey();
    const c = load();
    const { p, prov } = activeConfig(c);
    if (!catalogueFor(c.provider)) { try { await refreshModels(); } catch {} }
    const candidates = candidateModels(c, false);
    if (!candidates.length) throw new Error('No models to try — reload the model list first.');
    let lastErr = null;
    for (const model of candidates) {
      try {
        try {
          await providers.testChat(c.provider, { apiKey: p.key, model: model.id, baseUrl: p.baseUrl });
        } catch (e) {
          // Same one bounded retry a send gets, so a rate-limit blip during
          // "Save & test" doesn't flake the connect.
          if (!transient(e)) throw e;
          await new Promise((r) => setTimeout(r, Math.min(5000, Math.max(300, Number(e.retryAfter) || 700))));
          await providers.testChat(c.provider, { apiKey: p.key, model: model.id, baseUrl: p.baseUrl });
        }
        if (p.model !== model.id) save({ model: model.id });
        markWarm();
        return { ok: true, provider: prov.label, providerId: c.provider, model: model.id };
      } catch (e) {
        lastErr = e;
        if (e && e.code !== 'model_missing' && e.nimStatus !== 404) throw e;
      }
    }
    throw lastErr;
  }

  // Pay the connection and cold-start cost before the user asks anything.
  async function prewarm(force) {
    const c = load();
    const { p, prov } = activeConfig(c);
    if (!p.key) return { ok: false, warmed: false };
    const now = Date.now();
    if (!force && warmedAt && (now - warmedAt) < WARM_TTL_MS) return { ok: true, warmed: true, cached: true };
    try {
      const catalogueKnown = Boolean(catalogueFor(c.provider));
      if (!catalogueKnown) await refreshModels();
      const { model } = resolveModel(c, false);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 15000);
      const t0 = performance.now();
      try {
        await providers.chat(c.provider, {
          apiKey: p.key,
          baseUrl: p.baseUrl,
          model,
          system: '',
          messages: [{ role: 'user', content: 'hi' }],
          maxTokens: 1,
          temperature: 0,
          stream: false,
          signal: ctl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      markWarm();
      if (AI_TIMING) console.log('[dex-ai] prewarm ms=' + Math.round(performance.now() - t0) + ' model=' + model + ' catalogue=' + (catalogueKnown ? 'memory' : 'network'));
      return { ok: true, warmed: true, model, providerId: c.provider };
    } catch (e) {
      warmedAt = 0;
      if (AI_TIMING) console.log('[dex-ai] prewarm failed: ' + String(e && e.message || e));
      return { ok: false, warmed: false, error: String(e && e.message || e), providerId: c.provider };
    }
  }

  // Stay-warm: called when a window regains focus and on a slow tick while the
  // browser is in use (see browser.js). One 1-token refresh keeps both the
  // pooled TLS connection and the model's server-side residency alive, so a
  // message typed minutes after the last one still starts hot. Skipped while
  // already warm, without a key, when the OS reports offline, and after a
  // failed refresh (bounded backoff — never hammers a dead key).
  async function keepWarm() {
    const now = Date.now();
    if (warmedAt && (now - warmedAt) < KEEP_WARM_MS) return { ok: true, warmed: true, cached: true };
    if (keepWarmFailedAt && (now - keepWarmFailedAt) < KEEP_WARM_BACKOFF_MS) return { ok: false, warmed: false, backoff: true };
    const c = load();
    const { p } = activeConfig(c);
    if (!p.key) return { ok: false, warmed: false };
    try {
      const enet = require('electron').net;
      if (enet && typeof enet.isOnline === 'function' && !enet.isOnline()) return { ok: false, warmed: false, offline: true };
    } catch {}
    const res = await prewarm(true);
    if (!res.ok) keepWarmFailedAt = Date.now();
    return res;
  }

  // ---------- wire messages ------------------------------------------------
  function contextCharBudget(c, plan) {
    const info = (plan && plan.modelInfo) || modelInfo(c, plan && plan.task);
    const contextTokens = info && info.context ? Math.min(info.context, 200000) : 32768;
    const output = (plan && plan.task === 'research') ? 4096 : 2048;
    // Chat must remember the thread, not just the last turn. Scale with the
    // model window instead of forcing every conversation down to 12k chars.
    const isSimpleChat = plan && plan.task === 'conversation';
    const maxChars = isSimpleChat ? MAX_CONVERSATION_CONTEXT_CHARS : MAX_CONTEXT_CHARS;
    return Math.max(12000, Math.min(maxChars, Math.floor((contextTokens - output - 512) * 3.2)));
  }

  function buildWireMessages(messages, budgetChars, textLimit, matchesImage = matchesImageDataUrl) {
    const out = [];
    // The latest thing the person asked decides whether an artifact in history
    // is replayed as a summary or as its full source.
    const followUpText = router.lastUserText(messages);
    let used = 0;
    for (let i = messages.length - 1; i >= 0 && i >= messages.length - MAX_WIRE_MESSAGES; i--) {
      const m = messages[i];
      if (!m || typeof m !== 'object') continue;
      let built = null;
      let imageChars = 0;
      // Agent turns (neutral wire form): assistant turns carrying tool calls,
      // 'tool' turns carrying the results fed back. Cap tool results too: a
      // single large result used to eat the whole budget and evict the thread.
      if (m.role === 'tool' && Array.isArray(m.results)) {
        for (const r of m.results) {
          const content = String((r && r.content) || '').slice(0, textLimit || MAX_WIRE_TEXT_CHARS);
          if (!content) continue;
          built = built || [];
          built.push({ role: 'tool', tool_call_id: String((r && r.id) || ''), content });
        }
      } else if (m.role === 'assistant' && Array.isArray(m.toolCalls) && m.toolCalls.length) {
        built = [{
          role: 'assistant',
          content: m.text ? String(m.text).slice(0, textLimit || MAX_WIRE_TEXT_CHARS) : null,
          tool_calls: m.toolCalls.map(tc => ({
            id: String(tc.id || ''),
            type: 'function',
            function: { name: String(tc.name || ''), arguments: JSON.stringify((tc && tc.input) || {}) },
          })),
        }];
      } else {
        let text = String(m.text || '').slice(0, textLimit || MAX_WIRE_TEXT_CHARS);
        if (m.artifact && typeof m.artifact === 'object') {
          // "Make it shorter", "change the heading": a follow-up that asks for a
          // change needs the artifact's real source, not a one-line summary of
          // it. Everything else keeps the cheap summary.
          const note = artifacts.artifactFollowUpNote(m.artifact, followUpText)
            || artifacts.artifactSummary(m.artifact);
          if (note) text = (text ? text + '\n\n' : '') + note;
        }
        const role = m.role === 'model' || m.role === 'assistant' ? 'assistant' : 'user';
        const images = [];
        if (role === 'user' && Array.isArray(m.images)) {
          for (const image of m.images.slice(0, MAX_IMAGES)) {
            const url = image && typeof image.url === 'string' ? image.url : '';
            if (!matchesImage(image, url) || url.length > MAX_IMAGE_DATA_CHARS) continue;
            if (images.length && imageChars + url.length > MAX_TOTAL_IMAGE_DATA_CHARS) continue;
            images.push({ type: 'image_url', image_url: { url } });
            imageChars += url.length;
          }
        }
        if (!text && !images.length) continue;
        const content = [];
        if (text) content.push({ type: 'text', text });
        content.push(...images);
        built = [{ role, content: images.length ? content : text }];
      }
      if (!built) continue;
      // An accepted data URL contains no JSON escapes. Count the rest of the
      // wire shape normally, without allocating a throwaway copy of the
      // base64 payload; the actual messages retain the original image data.
      const cost = imageChars
        ? JSON.stringify(built, omitCountedImageUrl).length + imageChars
        : JSON.stringify(built).length;
      if (out.length && used + cost > budgetChars) break;
      for (let j = built.length - 1; j >= 0; j--) out.unshift(built[j]);
      used += cost;
    }
    while (out.length && out[0].role !== 'user') out.shift();
    return out;
  }

  // One streaming attempt. plan bypasses resolution (used for the retry after
  // an unprovisioned-model failure and for explicit cross-provider fallbacks).
  // opts.systemSuffix appends to the system prompt and opts.maxTokens
  // overrides the token budget — used for the intermediate note-taking legs
  // of a fan-out send.
  // Per-reply stream metrics: the honest numbers behind the reply footer
  // ("1.2s to first token, 42 c/s") and the lastRun record. No prompt text.
  function metricsOf(timing, meter, full, thinking) {
    const totalMs = Math.round(performance.now() - timing.t0);
    const chars = String(full || '').length;
    return {
      ms: totalMs,
      firstTokenMs: meter.firstDelta ? Math.round(meter.firstDelta - timing.t0) : null,
      deltas: timing.deltas,
      chars,
      thinkingChars: String(thinking || '').length,
      charsPerSec: totalMs > 0 ? Math.round((chars / totalMs) * 1000) : 0,
    };
  }

  async function streamOnce(reqId, messages, onText, opts, plan, matchesImage) {
    // The meter is always on: it costs two numbers per chunk and gives the
    // reply its honest "first token / total" line plus the lastRun record.
    // DEX_AI_TIMING only decides whether it is also logged.
    const timing = { t0: performance.now(), deltas: 0 };
    const meter = { firstDelta: 0, chars: 0, thinkingChars: 0 };
    const c = load();
    const providerId = (plan && plan.providerId) || c.provider;
    const p = c.providers[providerId];
    const prov = PROVIDERS[providerId];
    if (!p || !p.key) throw new Error('Add your ' + (prov ? prov.label : 'AI') + ' API key to use Dexerion AI.');
    const cb = circuitCheck();
    if (cb.tripped) {
      throw new Error('The AI provider is temporarily paused after repeated failures. ' +
        'Switch model, provider or key in Assistant settings to resume now, or wait about ' +
        Math.max(1, Math.round(cb.msLeft / 1000 / 60)) + ' minute(s) before retrying.');
    }
    const memory = (opts && opts.memory) || [];
    const sysSuffix = (opts && typeof opts.systemSuffix === 'string') ? opts.systemSuffix : '';
    const artifactHint = opts && opts.artifact === true;
    const tools = (opts && Array.isArray(opts.tools) && opts.tools.length) ? opts.tools : null;
    const resolved = plan || resolveModel(c, false, opts);
    const model = resolved.model;
    const reasoningModel = Boolean(resolved.modelInfo && resolved.modelInfo.reasoning)
      || /(?:reason|thinking)/i.test(String(model || ''));
    const maxTokens = (opts && Number.isFinite(opts.maxTokens))
      ? Math.max(1, Math.min(MAX_OUTPUT_TOKENS, Math.round(opts.maxTokens)))
      : (artifactHint ? ARTIFACT_OUTPUT_TOKENS : (reasoningModel ? REASONING_CHAT_OUTPUT_TOKENS : 2048));
    const budget = contextCharBudget(c, resolved);
    // The dedicated site writer may be handed a complete previous index.html
    // to revise. That single-file source is larger than a normal chat turn, so
    // allow the long form only on the override path (site/report writers).
    const msgs = buildWireMessages(messages, budget, (opts && opts.systemOverride) ? 160000 : MAX_WIRE_TEXT_CHARS, matchesImage);
    if (!msgs.length) throw new Error('Nothing to send.');

    const state = { cancelled: false, abort: null };
    live.set(reqId, state);
    const ctl = new AbortController();
    state.abort = () => { try { ctl.abort(); } catch {} };
    let timer = setTimeout(() => ctl.abort(), STREAM_TIMEOUT_MS);
    // Progress-based deadline: every chunk - answer OR reasoning - buys a
    // fresh window, so a long report on a reasoning model is never killed
    // mid-generation while a genuinely stalled connection still times out.
    const armTimer = () => { clearTimeout(timer); timer = setTimeout(() => ctl.abort(), STREAM_TIMEOUT_MS); };
    let full = '';
    let usage = null;
    let thinking = '';
    try {
      const system = (opts && opts.systemOverride)
        ? String(opts.systemOverride)
        : systemContent(memory)
          + (sysSuffix ? '\n\n' + sysSuffix : '')
          + (artifactHint ? '\n\n' + artifacts.artifactPrompt() : '');
      const r = await providers.chat(providerId, {
        apiKey: p.key,
        baseUrl: p.baseUrl,
        model,
        system,
        messages: msgs,
        tools,
        maxTokens,
        temperature: 0.7,
        stream: true,
        signal: ctl.signal,
        timing,
        onText: (delta, all) => {
          armTimer();
          if (state.cancelled) return;
          timing.deltas++;
          if (!meter.firstDelta) meter.firstDelta = performance.now();
          full = String(all == null ? (full + delta) : all);
          meter.chars = full.length;
          try { onText(delta, full); } catch {}
        },
        onReasoning: () => armTimer(),
      });
      usage = r.usage || null;
      thinking = r.thinking || thinking;
      if (r.text) full = r.text;
      if (state.cancelled) return { ok: true, text: full, cancelled: true, model, providerId, toolCalls: [], usage, thinking, metrics: metricsOf(timing, meter, full, thinking) };
      const toolCalls = r.toolCalls || [];
      if (!full && !toolCalls.length) {
        // Distinguish "the model said nothing" from "the budget ran out while
        // it was still reasoning" - stream() retries the former once.
        const emptyErr = new Error((prov ? prov.label : 'The provider') + ' returned an empty reply.');
        emptyErr.code = 'empty';
        emptyErr.finishReason = r.finishReason || '';
        emptyErr.reasoningOnly = Boolean(thinking);
        throw emptyErr;
      }
      return { ok: true, text: full, cancelled: false, model, providerId, toolCalls, usage, thinking, metrics: metricsOf(timing, meter, full, thinking) };
    } catch (e) {
      // Only genuine provider flakiness counts toward the pause: the person
      // stopping a run, a retired model, or a bad key are not provider
      // failures and must never lock the assistant out.
      const cancelledByUser = Boolean(e && e.name === 'AbortError' && state.cancelled);
      if (!cancelledByUser && (transient(e) || (e && e.name === 'AbortError'))) circuitTrip();
      if (cancelledByUser) return { ok: true, text: full, cancelled: true, model, providerId, toolCalls: [], usage, metrics: metricsOf(timing, meter, full, thinking) };
      if (e && e.name === 'AbortError') throw new Error((prov ? prov.label : 'The provider') + ' took too long to respond. Try again, or cancel and resend.');
      throw e;
    } finally {
      clearTimeout(timer);
      if (AI_TIMING) {
        const rel = (key) => (timing[key] !== undefined ? Math.round(timing[key] - timing.t0) : -1);
        console.log('[dex-ai] send model=' + model + ' provider=' + providerId
          + ' build=' + rel('fetch') + 'ms'
          + ' headers=' + (timing.headers !== undefined && timing.fetch !== undefined ? Math.round(timing.headers - timing.fetch) : -1) + 'ms'
          + ' firstByte=' + rel('firstByte') + 'ms'
          + ' firstToken=' + rel('firstDelta') + 'ms'
          + ' total=' + Math.round(performance.now() - timing.t0) + 'ms'
          + ' deltas=' + timing.deltas
          + ' cancelled=' + Boolean(state.cancelled));
      }
      // A cancelled id keeps a tombstone so a mid-retry stop still lands.
      if (state.cancelled) live.set(reqId, { cancelled: true, abort: null, at: Date.now() });
      else if (live.get(reqId) === state) live.delete(reqId);
    }
  }

  // An unprovisioned model is the one failure worth retrying on a different
  // model: the chat survives a retired default instead of dying.
  function modelMissing(err) {
    if (!err) return false;
    if (err.code === 'model_missing' || err.nimStatus === 404) return true;
    return err.nimStatus === 400 && /model/i.test(String(err.message || ''));
  }

  function transient(err) {
    return Boolean(err && (err.code === 'rate_limit' || err.code === 'provider' || err.code === 'network' || err.retryable));
  }

  function sendHasImages(messages, matchesImage) {
    if (!Array.isArray(messages)) return false;
    for (const m of messages) {
      if (!m || !Array.isArray(m.images)) continue;
      for (const image of m.images.slice(0, 4)) {
        const url = image && typeof image.url === 'string' ? image.url : '';
        if (matchesImage(image, url)) return true;
      }
    }
    return false;
  }

  // NIM chat completions accept at most 1 image per prompt (a 400
  // otherwise). Intermediate legs bank a short visual note instead of an
  // answer; the notes ride along so the model remembers across prompts.
  const NOTE_TAKER_SUFFIX = 'You are being shown images one at a time before the user\'s real question. '
    + 'Reply with a 2-3 sentence visual note describing what you see, for later reference. '
    + 'Do not answer any question yet.';
  const NOTE_TAKER_TOKENS = 300;
  const MAX_LEGS = 6;

  function normalizedLegImages(messages, matchesImage) {
    const out = [];
    for (const m of (Array.isArray(messages) ? messages : []).slice(-40)) {
      if (!m || m.role === 'model' || !Array.isArray(m.images)) continue;
      for (const image of m.images) {
        const url = image && typeof image.url === 'string' ? image.url : '';
        if (!matchesImage(image, url) || url.length > MAX_IMAGE_DATA_CHARS) continue;
        out.push({ message: m, image });
      }
    }
    return out.slice(-MAX_LEGS);
  }

  function legPayload(messages, legs, k, notes) {
    const win = (Array.isArray(messages) ? messages : []).slice(-40);
    const target = legs[k];
    const out = [];
    for (const m of win) {
      if (!m) continue;
      if (m === target.message) out.push({ role: m.role, text: m.text, images: [target.image] });
      else out.push({ role: m.role, text: m.text });
      for (const n of notes) {
        if (n.after === m) out.push({ role: 'model', text: n.text });
      }
    }
    return out;
  }

  function finalizeArtifact(result, opts) {
    if (!result || result.cancelled || !result.text) return result;
    const parsed = artifacts.parseArtifactBlock(result.text, opts);
    if (!parsed.found) return result;
    if (parsed.artifact) {
      return { ...result, text: parsed.text, artifact: parsed.artifact, artifactWarnings: parsed.warnings || [] };
    }
    if (parsed.pending) {
      // The automatic rebuild gets its chance first; if the person still sees
      // this, the note explains what happened instead of one silent sentence.
      const note = String(parsed.text || result.text || '').trim();
      return {
        ...result,
        text: (note ? note + '\n\n' : '') + '(The report was cut off before it finished — ask again and it will be rebuilt.)',
        artifactError: 'The reply ended before the artifact was complete. Try again.',
      };
    }
    return {
      ...result,
      text: (parsed.text ? parsed.text + '\n\n' : '') + 'The generated artifact could not be used: ' + parsed.error,
      artifactError: parsed.error,
    };
  }

  function fallbackCandidates(c, requireVision, failedModel, excludeProvider) {
    const out = [];
    const activeId = c.provider;
    const cat = catalogueFor(activeId);
    const blocked = blockedModels(activeId);
    if (cat) {
      // Recommended models first (they are the ones most reliably available
      // with a fresh key), then the rest of the catalogue.
      const ranked = [];
      const seen = new Set();
      for (const id of cat.recommended || []) {
        const m = cat.models.find((x) => x.id === id);
        if (m && !seen.has(m.id)) { seen.add(m.id); ranked.push(m); }
      }
      for (const m of cat.models) {
        if (!seen.has(m.id)) { seen.add(m.id); ranked.push(m); }
      }
      for (const m of ranked) {
        if (m.id === failedModel) continue;
        if (blocked && blocked.has(m.id)) continue;
        if (requireVision && !(m.vision || VISION_MODEL_ID.test(m.id))) continue;
        out.push({ providerId: activeId, model: m.id, modelInfo: m, reason: 'fallback model after a retired one' });
        if (out.length >= 8) break;
      }
    }
    if (c.routing.crossProvider) {
      for (const id of PROVIDER_IDS) {
        if (id === activeId || id === excludeProvider) continue;
        const p = c.providers[id];
        if (!p.key) continue;
        const other = catalogueFor(id);
        if (!other || !other.models.length) continue;
        const pick = router.chooseModel({
          models: other.models, task: 'conversation', selected: p.model,
          policy: c.routing.policy, pins: c.routing.pins,
        });
        if (pick && pick.model) out.push({ providerId: id, model: pick.model, modelInfo: pick.modelInfo, reason: 'fallback provider (explicitly allowed)' });
      }
    }
    return out;
  }

  async function stream(reqId, messages, onText, opts) {
    const matchesImage = streamImageMatcher();
    const hasImages = sendHasImages(messages, matchesImage);
    const task = router.classifyTask(messages, { hasImages });
    const agentTools = Boolean(opts && Array.isArray(opts.tools) && opts.tools.length);
    const artifactTask = router.isArtifactTask(task) && !agentTools;
    // The explicit artifact flag is never suppressed by tool presence: the
    // skill loop sets it on the report-writing turn, and tools are still
    // attached there. Dropping it silently cost the artifact prompt AND the
    // bigger output budget exactly when a report was being written.
    const baseOpts = { ...(opts || {}), task, artifact: artifactTask || Boolean(opts && opts.artifact) };
    const c = load();
    const started = Date.now();
    let produced = false;
    const track = (delta, full) => { produced = true; try { onText(delta, full); } catch {} };

    // The plan carries the difficulty tier through: resolveModel prefers the
    // scout's pick for that tier over the saved model when one is passed.
    const plan = resolveModel(c, hasImages, { ...(opts || {}), task });
    plan.task = task;
    plan.reason = plan.reason || 'selected model';
    plan.routed = Boolean(plan.routed);
    if (!plan.providerId) plan.providerId = c.provider;
    if (hasImages && c.providers[c.provider].model !== plan.model) save({ model: plan.model });

    // One chain attempt. 0-1 images: exactly today's single send.
    // optsOverride rides corrective retries: tools off + a nudge suffix.
    const run = async (planOverride, optsOverride) => {
      const useOpts = optsOverride || baseOpts;
      const legs = normalizedLegImages(messages, matchesImage);
      if (legs.length <= 1) {
        const r = await streamOnce(reqId, messages, track, useOpts, planOverride, matchesImage);
        if (r.text) produced = true;
        return r;
      }
      // Note-taking legs are plain chat: tools ride on the final leg only.
      const { tools: _omitTools, artifact: _omitArtifact, ...legBase } = useOpts;
      const notes = [];
      for (let k = 0; k < legs.length - 1; k++) {
        const r = await streamOnce(reqId, legPayload(messages, legs, k, notes), () => {},
          { ...legBase, systemSuffix: NOTE_TAKER_SUFFIX, maxTokens: NOTE_TAKER_TOKENS }, planOverride, matchesImage);
        if (r.cancelled || chainStopped(reqId)) return { ok: true, text: '', cancelled: true, model: r.model, providerId: r.providerId, toolCalls: [] };
        if (r.text) {
          notes.push({ after: legs[k].message, text: r.text });
          produced = true;
        }
      }
      const r = await streamOnce(reqId, legPayload(messages, legs, legs.length - 1, notes), track, useOpts, planOverride, matchesImage);
      if (r.text) produced = true;
      return r;
    };

    try {
      let result;
      let emptyRetried = false;    // one nudge for a reasoning-only empty reply
      let artifactRetried = false; // one rebuild for an artifact cut off mid-block
      try {
        result = await run(plan);
      } catch (e) {
        if (chainStopped(reqId)) throw e;
        if (modelMissing(e)) {
          // Not provisioned for this account: remember it, then walk the
          // candidate list until one actually answers. One candidate was not
          // enough - catalogues list models the key cannot chat with, and a
          // single unlucky pick used to kill every message.
          noteProvisionMiss(plan.providerId, plan.model);
          try { await refreshModels(); } catch {}
          runScout('failure', { refresh: false }).catch(() => {});
          const failed = plan.model;
          const tried = new Set([String(failed)]);
          let lastMissing = e;
          let rescued = null;
          let winner = null;
          for (const next of fallbackCandidates(load(), hasImages, failed)) {
            const nextId = String(next.model || '');
            if (!nextId || tried.has(nextId)) continue;
            tried.add(nextId);
            if (chainStopped(reqId)) throw e;
            try {
              rescued = await run({ ...plan, ...next, substituted: true });
              winner = next;
              break;
            } catch (e2) {
              if (chainStopped(reqId)) throw e2;
              if (!modelMissing(e2)) throw e2;
              noteProvisionMiss(next.providerId || plan.providerId, next.model);
              lastMissing = e2;
            }
          }
          if (!rescued) throw lastMissing;
          if (winner && winner.providerId === c.provider) save({ model: winner.model });
          result = rescued;
        } else if (e && e.code === 'empty' && !produced && !emptyRetried) {
          // A reasoning model can spend the whole budget thinking and send no
          // answer at all. One bounded nudge - tools off, artifact format on
          // when a deliverable was wanted - then the honest error.
          emptyRetried = true;
          if (chainStopped(reqId)) throw e;
          result = await run(plan, {
            ...baseOpts,
            tools: undefined,
            // A reasoning-only empty reply means the thinking budget won; give
            // the retry the full output ceiling instead of repeating the same
            // truncation.
            maxTokens: e.reasoningOnly ? MAX_OUTPUT_TOKENS : baseOpts.maxTokens,
            systemSuffix: mergeSuffix(baseOpts.systemSuffix, EMPTY_RETRY_SUFFIX),
          });
        } else if (transient(e) && !produced) {
          // One bounded retry for a rate limit / provider blip, with the
          // provider's Retry-After when it sent one. Never after output has
          // started: retrying would duplicate the visible reply and the spend.
          const wait = Math.min(5000, Math.max(400, Number(e.retryAfter) || 800));
          await new Promise((r) => setTimeout(r, wait));
          if (chainStopped(reqId)) throw e;
          result = await run(plan);
        } else {
          throw e;
        }
      }
      // Whether this turn should become a deliverable: the task router says
      // so, or the person's own words ask for one ("make me a report").
      const wantsArtifact = Boolean(baseOpts.artifact) || router.wantsArtifactText(router.lastUserText(messages));
      let out = finalizeArtifact(result, { wantsArtifact });
      // A reply that stopped before its artifact block closed (budget or a
      // stream hiccup) gets one bounded rebuild with the format enforced.
      if (!out.cancelled && !out.artifact && out.artifactError && !artifactRetried) {
        artifactRetried = true;
        if (!chainStopped(reqId)) {
          try {
            const retry = await run(plan, {
              ...baseOpts,
              tools: undefined,
              // The specific reason the first attempt failed rides along, so
              // the rebuild fixes it instead of repeating it.
              systemSuffix: mergeSuffix(baseOpts.systemSuffix,
                ARTIFACT_RETRY_SUFFIX + (out.artifactError ? ' The validator said: ' + String(out.artifactError).slice(0, 400) : '')),
            });
            const rebuilt = finalizeArtifact(retry, { wantsArtifact });
            if (rebuilt.artifact) out = rebuilt;
          } catch { /* keep the first outcome */ }
        }
      }
      if (!out.cancelled) markWarm();
      out.routing = {
        task: plan.task,
        providerId: out.providerId || plan.providerId,
        model: out.model || plan.model,
        reason: plan.reason,
        policy: c.routing.policy,
        auto: c.routing.mode === 'auto',
        substituted: Boolean(plan.substituted),
      };
      lastRun = {
        ok: true, at: Date.now(), ms: Date.now() - started,
        model: out.model || plan.model, providerId: out.providerId || plan.providerId,
        task: plan.task, artifact: Boolean(out.artifact), error: '',
        metrics: out.metrics || null,
      };
      return out;
    } catch (e) {
      const msg = String(e && e.message || e);
      lastRun = {
        ok: false, at: Date.now(), ms: Date.now() - started,
        model: plan.model, providerId: plan.providerId, task: plan.task,
        artifact: false, error: msg, code: (e && e.code) || '',
      };
      if (!/API key/i.test(msg)) console.warn('[ai] send failed (' + plan.providerId + '/' + plan.model + '): ' + msg);
      throw e;
    }
  }

  function setModel(m) {
    const active = load().provider;
    const next = String(m || '').trim();
    // An explicit pick gets a fresh chance: forget an earlier provisioning
    // miss for it (the picker re-verifies right after this). It is also a
    // PIN - it wins over the effort tiers until the effort is changed.
    if (next) {
      const set = provisionBlocks.get(active);
      if (set) set.delete(next);
    }
    return save({ model: next, pinned: next }).model;
  }

  // The scout's model for one effort tier, when it is in the catalogue and
  // has not been flagged as unprovisioned this session.
  function tierPickFor(difficulty) {
    const c = load();
    const cat = catalogueFor(c.provider);
    if (!cat) return '';
    const tier = modelScout.TIER_IDS.includes(difficulty) ? difficulty : '';
    if (!tier || !c.scout || !c.scout.tiers) return '';
    const pick = c.scout.tiers[tier];
    if (!pick || !pick.model) return '';
    const found = cat.models.find((m) => m.id === pick.model);
    if (!found) return '';
    const blocked = blockedModels(c.provider);
    if (blocked && blocked.has(found.id)) return '';
    return found.id;
  }

  // Verify ONE model can actually answer with this key. The NIM catalogue
  // lists models an account may not be provisioned for, so the picker probes
  // the choice at selection time instead of failing the first message.
  async function verifyModel(model) {
    try {
      requireKey();
      const c = load();
      const { p, prov } = activeConfig(c);
      const m = String(model || '').trim();
      if (!m) return { ok: false, modelMissing: false, error: 'Pick a model first.' };
      if (!p.key) return { ok: false, modelMissing: false, error: 'Add your ' + prov.label + ' API key to use Dexerion AI.' };
      try {
        await providers.testChat(c.provider, { apiKey: p.key, model: m, baseUrl: p.baseUrl });
      } catch (e) {
        if (!transient(e)) throw e;
        // The same one bounded retry a send gets, so a rate-limit blip does
        // not fail an otherwise good pick.
        await new Promise((r) => setTimeout(r, Math.min(5000, Math.max(300, Number(e.retryAfter) || 700))));
        await providers.testChat(c.provider, { apiKey: p.key, model: m, baseUrl: p.baseUrl });
      }
      markWarm();
      return { ok: true, modelMissing: false, error: '' };
    } catch (e) {
      const missing = modelMissing(e);
      if (missing) noteProvisionMiss(load().provider, model);
      return { ok: false, modelMissing: missing, error: String(e && e.message || e) };
    }
  }

  // Automatic memory: distill durable user facts from a fresh exchange.
  // Runs AFTER the reply is delivered (never blocks it). Returns
  // { add: [fact], forget: [query] }; the caller persists them.
  async function extractMemory(historyMessages, replyText, memory) {
    requireKey();
    const c = load();
    const { p } = activeConfig(c);
    const existing = (Array.isArray(memory) ? memory : [])
      .map(f => normFact(f && f.text))
      .filter(Boolean)
      .slice(-20);
    const lines = [];
    for (const m of (Array.isArray(historyMessages) ? historyMessages : []).slice(-6)) {
      const text = String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, 1500);
      if (!text) continue;
      lines.push((m.role === 'model' ? 'Assistant: ' : 'User: ') + text);
    }
    const reply = String(replyText || '').replace(/\s+/g, ' ').trim().slice(0, 1500);
    if (reply) lines.push('Assistant: ' + reply);
    if (!lines.length) return { add: [], forget: [] };
    const sys = 'You maintain persistent memory for a browser assistant. '
      + 'From the conversation below, list durable facts about the USER '
      + '(name, preferences, work, projects, goals, constraints). Ignore '
      + 'one-off questions, chit-chat, and anything already listed under '
      + 'CURRENT MEMORY. Reply with ONLY these line shapes, nothing else:\n'
      + '- <new fact, one short sentence>\n'
      + 'FORGET: <an existing fact the user just contradicted or retracted>\n'
      + 'If there is nothing worth keeping, reply with exactly: NONE';
    const user = 'CURRENT MEMORY:\n'
      + (existing.length ? existing.map(f => '- ' + f).join('\n') : '(empty)')
      + '\n\nCONVERSATION:\n' + lines.join('\n');
    const { model } = resolveModel(c, false);
    // Same self-healing as chat: a retired default falls through to whatever
    // the key can reach. Bounded: two attempts max, 30s each.
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const useModel = attempt === 0 ? model : null;
      try {
        const m = useModel || await fallbackModel(c, model);
        if (!m) throw lastErr || new Error('No reachable model for memory extraction.');
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), NON_STREAM_TIMEOUT_MS);
        try {
          const r = await providers.chat(c.provider, {
            apiKey: p.key,
            baseUrl: p.baseUrl,
            model: m,
            system: sys,
            messages: [{ role: 'user', content: user }],
            maxTokens: 256,
            temperature: 0,
            stream: false,
            signal: ctl.signal,
          });
          return parseExtraction({ choices: [{ message: { content: r.text } }] });
        } finally {
          clearTimeout(timer);
        }
      } catch (e) {
        if (e && e.name === 'AbortError') throw new Error('Memory extraction timed out.');
        lastErr = e;
        if (!modelMissing(e)) throw e;
      }
    }
    throw lastErr;
  }

  async function fallbackModel(c, failed) {
    try { await refreshModels(); } catch {}
    runScout('failure', { refresh: false }).catch(() => {});
    const next = fallbackCandidates(c, false, failed)[0];
    return next ? next.model : null;
  }

  function parseExtraction(j) {
    const content = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    const add = [], forget = [];
    for (const raw of String(content).split('\n')) {
      const line = raw.trim();
      if (!line || /^none\.?$/i.test(line)) continue;
      let m = /^forgett?\s*:\s*(.+)$/i.exec(line);
      if (m && normFact(m[1])) { forget.push(normFact(m[1])); continue; }
      m = /^[-*•]\s+(.+)$/.exec(line);
      if (m && normFact(m[1])) add.push(normFact(m[1]));
    }
    return { add: add.slice(0, 5), forget: forget.slice(0, 5) };
  }

  // One short-answer grade, explicitly requested by the user from a quiz card.
  // Returns a small structured verdict; the renderer labels it as AI marking.
  async function gradeShort(input) {
    requireKey();
    const c = load();
    const { p, prov } = activeConfig(c);
    const question = String((input && input.question) || '').slice(0, 4000);
    const answer = String((input && input.answer) || '').slice(0, 4000);
    const expected = String((input && input.expected) || '').slice(0, 4000);
    const rubric = String((input && input.rubric) || '').slice(0, 2000);
    if (!question || !answer) throw new Error('There is no answer to mark yet.');
    const plan = resolveModel(c, false, { task: 'study' });
    const sys = 'You mark one short-answer quiz response. Judge meaning, not exact wording. '
      + 'Reply with ONLY a JSON object of this shape: '
      + '{"verdict":"correct"|"partial"|"incorrect","score":0.0-1.0,"feedback":"2-3 sentences addressed to the learner"}. '
      + 'No markdown, no code fences, no extra text.';
    const user = 'Question: ' + question
      + '\n\nModel answer: ' + (expected || '(not supplied)')
      + (rubric ? '\n\nRubric: ' + rubric : '')
      + '\n\nLearner answer: ' + answer;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), NON_STREAM_TIMEOUT_MS);
    try {
      const r = await providers.chat(c.provider, {
        apiKey: p.key,
        baseUrl: p.baseUrl,
        model: plan.model,
        system: sys,
        messages: [{ role: 'user', content: user }],
        maxTokens: 320,
        temperature: 0,
        stream: false,
        signal: ctl.signal,
      });
      const loose = artifacts.parseJsonLoose(r.text);
      let verdict = loose && ['correct', 'partial', 'incorrect'].includes(String(loose.verdict || '').toLowerCase())
        ? String(loose.verdict).toLowerCase() : 'partial';
      let score = Number(loose && loose.score);
      if (!Number.isFinite(score)) score = verdict === 'correct' ? 1 : verdict === 'incorrect' ? 0 : 0.5;
      score = Math.max(0, Math.min(1, score));
      const feedback = String((loose && loose.feedback) || r.text || '').trim().slice(0, 2000)
        || 'No written feedback was returned.';
      return {
        ok: true,
        verdict,
        score,
        feedback,
        model: plan.model,
        provider: prov.label,
        disclaimer: 'AI marking is a guide, not a verdict. Check the model answer yourself.',
      };
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('Marking took too long. Try again.');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  // Dedicated single-turn website generation. The skill loop's two-turn
  // "propose, then arm, then write" dance is fragile with reasoning models:
  // the write turn can come back completely empty. A site is a self-contained
  // deliverable, so generate it in one clean turn with the site rules in the
  // system prompt and the person's own words as the only user message.
  async function streamSite(reqId, userText, onText, opts) {
    const o = opts || {};
    const emit = onText || (() => {});
    const researchAssets = Array.isArray(o.researchAssets)
      ? o.researchAssets.filter((a) => a && a.id && a.dataUrl) : [];
    const researchText = String(o.siteResearchText || '');
    const strictSingleFile = Boolean(o.strictSingleFile);
    const baseOpts = {
      memory: o.memory,
      difficulty: o.difficulty,
      artifact: true,
      tools: undefined,
      maxTokens: 65536,
      systemOverride: o.systemOverride,
    };
    let assetWarnings = [];
    const assetMeta = researchAssets.map((a) => ({
      id: a.id, source: a.source, title: a.title, credit: a.credit,
      mimeType: a.mimeType, rawBytes: a.rawBytes,
    }));

    const htmlOf = (obj) => {
      const f = obj && obj.artifact && Array.isArray(obj.artifact.files)
        ? obj.artifact.files.find((x) => x && String(x.path || '').toLowerCase() === 'index.html')
        : null;
      return f ? String(f.content || '') : '';
    };
    const singleFileViolation = (obj) => {
      if (!strictSingleFile || !obj || !obj.artifact) return '';
      const files = Array.isArray(obj.artifact.files) ? obj.artifact.files : [];
      if (files.length !== 1) return 'The artifact has ' + files.length + ' files, but the contract allows exactly one (index.html).';
      const name = String((files[0] && files[0].path) || '').toLowerCase();
      if (name !== 'index.html') return 'The only file must be named "index.html", but it is "' + name + '".';
      return '';
    };
    const inlineInto = (value) => {
      if (!researchAssets.length || !value || !value.artifact || !Array.isArray(value.artifact.files)) return value;
      const inlined = siteResearchAssets.inlineSiteAssets(value.artifact.files, researchAssets);
      assetWarnings = assetWarnings.concat(inlined.warnings || []).slice(0, 8);
      return { ...value, artifact: { ...value.artifact, files: inlined.files } };
    };

    const r = await stream(reqId, [{ role: 'user', text: String(userText || '') }], emit, baseOpts);
    let result = inlineInto(finalizeArtifact(r, { wantsArtifact: true }));

    // Deterministic interactivity + single-file guards. A finished site is only
    // accepted when its own HTML has real event wiring and no dead controls,
    // and the deliverable is exactly one index.html. If either fails, spend ONE
    // focused repair turn: it lists the exact issues, the violation and the
    // research/asset contract so placeholders and credits are not dropped.
    let check = null;
    let repaired = false;
    const html = htmlOf(result);
    if (html) check = siteInteractivity.analyze(html);
    const violation = singleFileViolation(result);
    if ((check && !check.interactive) || violation) {
      try {
        const analysis = check || { issues: [] };
        const issues = Array.isArray(analysis.issues) ? analysis.issues.slice() : [];
        if (violation) issues.unshift(violation);
        const base = siteInteractivity.repairInstruction({ ...analysis, issues }, userText);
        const extras = [];
        if (violation) {
          extras.push('SINGLE-FILE VIOLATION: ' + violation
            + ' Return exactly ONE artifact file: {"path":"index.html","content":"<!DOCTYPE html>..."}. '
            + 'Put all CSS and JavaScript inside that document; no second file.');
        }
        if (researchText || researchAssets.length) {
          extras.push(
            'RESEARCH / ASSET CONTRACT — DO NOT DROP IT:',
            researchText || '<site-research-assets>Use the issued asset ids for any images you keep.</site-research-assets>',
            'Keep every src="dexrefN" data-dex-asset="dexrefN" placeholder you used and the visible plain-text credit lines. '
            + 'The app replaces placeholders with inlined data URLs after you reply; never paste base64 or a remote http(s) src/href/url() yourself.'
          );
        }
        const repairText = [base, ...extras].filter(Boolean).join('\n\n');
        const rr = await stream(reqId, [{ role: 'user', text: repairText }], () => {}, baseOpts);
        const fixed = inlineInto(finalizeArtifact(rr, { wantsArtifact: true }));
        const fixedHtml = htmlOf(fixed);
        const fixedCheck = fixedHtml ? siteInteractivity.analyze(fixedHtml) : null;
        const fixedViolation = singleFileViolation(fixed);
        if (fixed.artifact && fixedHtml && fixedCheck && fixedCheck.interactive && (!violation || !fixedViolation)) {
          result = fixed;
          check = fixedCheck;
          repaired = true;
        }
      } catch (e) {
        // A failed repair must never throw away a usable first result.
      }
    }
    const warnings = (result.artifactWarnings || []).concat(assetWarnings);
    if (violation && !repaired) warnings.push('Single-file contract not met: ' + violation);
    return {
      ...result,
      artifactWarnings: warnings.slice(0, 12),
      interactivity: check,
      interactivityRepaired: repaired,
      siteResearch: researchText ? {
        used: true, chars: researchText.length, assets: researchAssets.length, warnings: assetWarnings,
      } : null,
      siteAssets: assetMeta,
    };
  }

  // Dedicated single-turn report generation. Reports are a separate product
  // from websites; a compact report-only system prompt (with the versioned
  // quality rules) avoids the multi-file artifact protocol that truncates
  // reasoning models. Kept as its own path so make_site is never affected.
  async function streamReport(reqId, userText, onText, opts) {
    const o = opts || {};
    const emit = onText || (() => {});
    const baseOpts = {
      memory: o.memory,
      difficulty: o.difficulty,
      artifact: true,
      tools: undefined,
      maxTokens: 65536,
      systemOverride: o.systemOverride,
    };
    const r = await stream(reqId, [{ role: 'user', text: String(userText || '') }], emit, baseOpts);
    const result = finalizeArtifact(r, { wantsArtifact: true });

    // Deterministic quality guard: if a report is structurally usable but a
    // required piece is missing (opening answer, sections, references), spend
    // ONE focused repair turn naming the exact problem rather than shipping a
    // thin document. A failed or still-thin repair never discards the first
    // usable artifact.
    let repaired = false;
    if (result.artifact && result.artifact.kind === 'report') {
      const warnings = artifacts.validateReportQuality(result.artifact);
      if (warnings.length) {
        try {
          const repairText = [
            'Improve the report you just wrote. Fix ALL of these problems while keeping every real fact and every real reference:',
            ...warnings.map((w, i) => (i + 1) + '. ' + w),
            'Return the complete improved report as one ```dex-artifact fenced block, valid JSON, no commentary.',
            'Brief: ' + String(userText || '').slice(0, 2000),
          ].join('\n');
          const rr = await stream(reqId, [{ role: 'user', text: repairText }], () => {}, baseOpts);
          const fixed = finalizeArtifact(rr, { wantsArtifact: true });
          if (fixed.artifact && fixed.artifact.kind === 'report'
            && artifacts.validateReportQuality(fixed.artifact).length < warnings.length) {
            return { ...fixed, reportRepaired: true, originalWarnings: warnings };
          }
        } catch (e) {
          // A failed repair must never throw away a usable first result.
        }
      }
    }
    return { ...result, reportRepaired: repaired };
  }

  return {
    status, save, test, verifyModel, stream, streamSite, streamReport, cancel, refreshModels, prewarm, keepWarm,
    runScout, scoutState: () => (load().scout || null),
    setModel, setMode: setModel, setProvider, setRouting, extractMemory, gradeShort,
    parseMemoryCommand, addMemory, removeMemory, memoryPrompt, memoryRecap,
  };
}

module.exports = {
  createAi, DEFAULT_MODEL, RECOMMENDED, BASE,
  PERSONA, MAX_FACTS, MAX_FACT_CHARS,
  PROVIDERS, PROVIDER_IDS,
  classifyTask: router.classifyTask,
  chooseModel: router.chooseModel,
  parseArtifactBlock: artifacts.parseArtifactBlock,
  normalizeArtifact: artifacts.normalizeArtifact,
  parseMemoryCommand, addMemory, removeMemory, memoryPrompt, memoryRecap,
};
