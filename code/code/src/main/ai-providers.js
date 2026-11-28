// Dexerion AI provider adapters.
//
// One interface for every provider the assistant can use:
//   chat(id, { apiKey, model, system, messages, tools, maxTokens, temperature,
//              stream, jsonSchema, signal, onText }) ->
//        { ok, text, toolCalls, usage, model, finishReason }
//   listModels(id, { apiKey }) -> { all:[{id,label,context,output,vision,tools,
//                                     reasoning,fast,cost}], recommended, ids }
//   testChat(id, opts) -> true
//
// NVIDIA NIM and OpenAI speak the OpenAI chat-completions wire format. Gemini
// uses its native v1beta generateContent API (verified against
// ai.google.dev/gemini-api/docs), because its tool/streaming shapes differ.
// Every request is made from the main process; keys never cross into a page.
'use strict';

// Production endpoint. The e2e suite points NIM at a local mock via
// DEX_AI_TEST=1 + DEX_AI_BASE; no other launch can change it.
const NIM_BASE = process.env.DEX_AI_TEST === '1' && process.env.DEX_AI_BASE
  ? String(process.env.DEX_AI_BASE).replace(/\/+$/, '')
  : 'https://integrate.api.nvidia.com/v1';
const OPENAI_BASE = 'https://api.openai.com/v1';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Nano reasoning models can stream 8k+ thinking tokens before the answer and
// repeat content in deltas; 8MB killed healthy single-file site replies on the
// low/medium tier. 64MB is a hard safety ceiling, not a target — normal sites
// stream a few hundred KB.
const MAX_STREAM_BYTES = 64 * 1024 * 1024;

// The curated NIM order is intentionally kept: /models returns no capability
// metadata, so this is the only way to keep embedding/guard models out of the
// chat picker. The list is server-verified by the live catalogue filter.
const NIM_RECOMMENDED = [
  'nvidia/nemotron-3-super-120b-a12b',
  'nvidia/nemotron-3-lightning-30b-a3b',
  'nvidia/nemotron-nano-3-30b-a3b',
  'nvidia/mistral-nemo-minitron-8b-8k-instruct',
  'z-ai/glm-5.3-flash',
  'deepseek-ai/deepseek-v4.1-flash',
  'moonshotai/kimi-k2.6',
  'nvidia/llama-3.1-nemotron-51b-instruct',
  'openai/gpt-oss-20b',
  'mistralai/mistral-large-2-instruct',
  '01-ai/yi-large',
  'ibm/granite-3.0-8b-instruct',
  'microsoft/phi-3.5-moe-instruct',
  'ai21labs/jamba-1.5-large-instruct',
  'google/gemma-3-12b-it',
  'nvidia/llama-3.1-nemotron-70b-instruct',
  'moonshotai/kimi-k3',
  'z-ai/glm-5.3',
  'meta/llama-3.2-11b-vision-instruct',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  'writer/palmyra-med-70b',
  'writer/palmyra-creative-122b',
  'nvidia/llama-3.1-nemotron-ultra-253b-v1',
  'nvidia/nemotron-3-ultra-550b-a55b',
  'nvidia/nemotron-4-340b-instruct',
  'databricks/dbrx-instruct',
  'mistralai/mistral-nemotron',
  'meta/llama-3.2-90b-vision-instruct',
];

// Definitely not chat endpoints: embedding, safety/guard, classifiers,
// encoders, image/video generation, code completion, parsers.
const NOT_CHAT = /embed|rerank|retriev|nemoguard|llama-guard|content-safety|reward|safety-guard|nvclip|embedqa|ising-calibration|ai-synthetic-video|nemotron-parse|^nvidia\/neva|^nvidia\/vila|deplot|recurrentgemma|kosmos|starcoder2|codellama|^google\/gemma-2b|codegemma/i;
// Vision capability: NVIDIA NIM models broadly support vision; also match
// explicit vision/omni markers and other providers' vision models.
const VISION_ID = /^nvidia\/|vision|(?:^|[/_-])vl(?:[/_-]|$)|omni|gemini|gpt-4o|gpt-4\.1|gpt-5|claude|llava/i;
const REASONING_ID = /reason|thinking|think|deepseek|ultra|large|max|pro|o[1-9](?:\b|-)|nemotron-3-(?:super|ultra)|70b|120b|253b|550b|405b/i;
const FAST_ID = /flash|lightning|mini|nano|small|8b|12b|20b|30b|haiku|3\.5/i;

const PROVIDERS = {
  nim: {
    id: 'nim',
    label: 'NVIDIA NIM',
    base: NIM_BASE,
    keyHint: 'build.nvidia.com',
    keyPlaceholder: 'Paste nvapi-… key here',
    docsUrl: 'https://build.nvidia.com',
    docsLabel: 'Open build.nvidia.com',
    defaultModel: 'nvidia/nemotron-3-super-120b-a12b',
    visionModel: 'meta/llama-3.2-11b-vision-instruct',
    recommended: NIM_RECOMMENDED,
    supportsJsonSchema: false,
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    base: OPENAI_BASE,
    keyHint: 'platform.openai.com/api-keys',
    keyPlaceholder: 'Paste sk-… key here',
    docsUrl: 'https://platform.openai.com/api-keys',
    docsLabel: 'Open platform.openai.com',
    defaultModel: '',
    visionModel: '',
    recommended: [],
    supportsJsonSchema: true,
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    base: GEMINI_BASE,
    keyHint: 'aistudio.google.com/apikey',
    keyPlaceholder: 'Paste your Gemini API key',
    docsUrl: 'https://aistudio.google.com/apikey',
    docsLabel: 'Open Google AI Studio',
    defaultModel: '',
    visionModel: '',
    recommended: [],
    supportsJsonSchema: true,
    native: true,
  },
};

const PROVIDER_IDS = Object.keys(PROVIDERS);

function providerOf(id) {
  return PROVIDERS[String(id || '')] || null;
}

const CUSTOM_ENDPOINT_HINT = 'That Base URL returned a webpage, not an OpenAI-compatible API. Use the API endpoint (for Groq: https://api.groq.com/openai/v1; for NVIDIA NIM leave Base URL blank), then Save & test.';
const WEBPAGE_BODY = /<!doctype\s+html|<html[\s>]|<body[\s>]|(?:\/\*[\s\S]{0,400}?\*\/[\s\S]{0,800}?(?::host|--[\w-]+\s*:|font-family))/i;
// These are key/console pages, not chat endpoints. Fail before sending the API
// key to them, and say what to use instead.
const KEY_PAGE_HOST = /(?:^|\/\/)(?:console\.(?:groq|grog)\.com|build\.nvidia\.com|platform\.openai\.com|aistudio\.google\.com)(?:\/|$)/i;

function isWebpageBody(body, headers) {
  const raw = String(body || '').slice(0, 8000);
  const ct = headers && typeof headers.get === 'function' ? String(headers.get('content-type') || '') : '';
  if (/text\/html|application\/xhtml/i.test(ct)) return true;
  return WEBPAGE_BODY.test(raw);
}

function endpointError(providerId, detail) {
  const prov = providerOf(providerId) || PROVIDERS.nim;
  const err = new Error(prov.label + ': ' + (detail || CUSTOM_ENDPOINT_HINT));
  err.code = 'bad_base_url';
  err.providerId = providerId;
  err.status = 0;
  err.retryable = false;
  return err;
}

function detailFrom(body, headers) {
  if (!body) return '';
  const raw = String(body);
  if (isWebpageBody(raw, headers)) return CUSTOM_ENDPOINT_HINT;
  let msg = '';
  try {
    const j = JSON.parse(raw);
    msg = (j.error && (j.error.message || j.error.code || j.error)) || j.message || (j.detail || '');
  } catch { msg = ''; }
  if (!msg) msg = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
  return typeof msg === 'string' ? msg.trim() : String(msg || '');
}

function retryAfterMs(headers) {
  if (!headers || typeof headers.get !== 'function') return 0;
  const raw = headers.get('retry-after');
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(120000, Math.round(seconds * 1000));
  const when = Date.parse(raw);
  return Number.isFinite(when) ? Math.max(0, Math.min(120000, when - Date.now())) : 0;
}

// One error shape for every provider. `nimStatus` stays on the object so the
// existing retry logic keeps working after the provider refactor.
function httpError(providerId, status, body, headers) {
  const prov = providerOf(providerId) || PROVIDERS.nim;
  const d = detailFrom(body, headers);
  let message;
  if (status === 401 || status === 403) message = 'That ' + prov.label + ' API key was rejected.';
  else if (status === 404) {
    if (/function\s+'.+?'\s*:\s*not found/i.test(d || '')) {
      const accountLabel = providerId === 'nim' ? 'NVIDIA' : prov.label;
      message = 'That model is not provisioned for this ' + accountLabel + ' account. Save & test again to auto-pick one that is, or choose another model.';
    } else {
      message = d ? prov.label + ': ' + d : 'Model not available — pick another one in Assistant settings.';
    }
  } else if (status === 429) {
    message = prov.label + ' rate limit reached. Wait a moment and try again.';
  } else if (status === 400 && /model/i.test(d)) {
    message = prov.label + ' rejected that model — pick another one in Assistant settings.';
  } else if (status >= 500) {
    message = prov.label + ' is having trouble (error ' + status + '). Try again in a moment.';
  } else {
    message = d ? prov.label + ' error ' + status + ': ' + d : prov.label + ' error ' + status + '.';
  }
  const err = new Error(message);
  err.code = status === 401 || status === 403 ? 'auth'
    : status === 429 ? 'rate_limit'
      : status === 404 ? 'model_missing'
        : status >= 500 ? 'provider'
          : status === 400 ? 'bad_request' : 'provider';
  err.status = status;
  err.providerId = providerId;
  err.nimStatus = status;
  err.retryable = status === 429 || status >= 500;
  const wait = retryAfterMs(headers);
  if (wait) err.retryAfter = wait;
  return err;
}

function networkError(providerId, err) {
  const prov = providerOf(providerId) || PROVIDERS.nim;
  if (isAbort(err)) return abortError();
  const e = new Error(prov.label + ' could not be reached. Check your connection and try again.');
  e.code = 'network';
  e.providerId = providerId;
  e.retryable = true;
  e.cause = err;
  return e;
}

// Cancellation arrives in different shapes per transport: undici throws a
// DOMException named AbortError; Chromium (net.fetch) surfaces net::ERR_ABORTED
// instead, including when a stream read is interrupted mid-body. Both are
// cancellations — recognize each.
function isAbort(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return true;
  const code = String(err.code || '');
  if (code === 'ERR_ABORTED' || code === 'UND_ERR_ABORTED') return true;
  return /net::ERR_ABORTED|operation was aborted/i.test(String(err.message || ''));
}

// Normalize whatever shape the transport used into the AbortError the rest of
// the app (streamOnce, search, agent) already understands.
function abortError() {
  const e = new Error('The request was aborted.');
  e.name = 'AbortError';
  return e;
}

// ---------- chat-template control tokens ------------------------------------
// Some NIM models (the Gemma family in particular) emit their template
// markers inside the content: `<|channel>thought … <channel|>` wraps a
// reasoning channel, plus stray <bos>/<eos>/turn sentinels. They must never
// reach the visible reply. Stripping happens here, in the transport, so every
// surface (chat, search, agent, skill loop) is covered at once.
const CHANNEL_BLOCK = /<\|channel\|?>([\s\S]*?)<channel\|>/gi;
const CONTROL_MARK = /<\|channel\|?>|<channel\|>|<\/?(?:start|end)_of_turn>|<bos>|<eos>|<\|begin_of_text\|>|<\|end_of_text\|>/gi;
const MAX_THINKING = 8000;

// Splits a complete value into the visible text and the reasoning-channel
// content (kept for the collapsible "Thinking" view, never shown inline).
function splitControlTokens(value) {
  const source = String(value == null ? '' : value);
  let thinking = '';
  const text = source
    .replace(CHANNEL_BLOCK, (_, body) => {
      thinking += String(body || '');
      return '';
    })
    .replace(CONTROL_MARK, '');
  return { text, thinking: thinking.trim().slice(0, MAX_THINKING) };
}

function stripControlTokens(value) {
  return splitControlTokens(value).text;
}

// A tail we hold back mid-stream is only ever withheld because it might be the
// start of a control marker. If the stream ends before that marker completes,
// the tail is a dead fragment: it must be dropped, not printed. A genuine
// '<' that never became a marker (e.g. "a < b") is still real text and goes out.
const MARKER_HEADS = [
  '<|channel>', '<|channel|>', '<channel|>',
  '</start_of_turn>', '<start_of_turn>', '</end_of_turn>', '<end_of_turn>',
  '<bos>', '<eos>', '<|begin_of_text|>', '<|end_of_text|>',
];
function isPartialMarker(tail) {
  const t = String(tail || '').toLowerCase();
  if (!t || t.includes('>')) return false;
  return MARKER_HEADS.some((m) => m.startsWith(t));
}

// Streaming-safe variant: holds a possible partial opener at the tail of each
// chunk, suppresses everything between `<|channel>` and `<channel|>` even when
// the markers arrive split across chunks, and collects the channel content.
function createControlFilter() {
  let held = '';
  let inChannel = false;
  let channelBuf = '';
  let thinking = '';
  const push = (chunk) => {
    const raw = held + String(chunk == null ? '' : chunk);
    held = '';
    let out = '';
    let input = raw;
    while (input) {
      if (inChannel) {
        channelBuf += input;
        const close = channelBuf.search(/<channel\|>/i);
        if (close < 0) return out; // wait for the closer; nothing leaks
        thinking = (thinking + channelBuf.slice(0, close)).slice(0, MAX_THINKING);
        input = channelBuf.slice(close + 10);
        channelBuf = '';
        inChannel = false;
        continue;
      }
      const open = input.search(/<\|channel\|?>/i);
      if (open >= 0) {
        out += stripControlTokens(input.slice(0, open));
        const after = input.slice(open);
        const marker = /^<\|channel\|?>/i.exec(after);
        input = after.slice(marker[0].length);
        inChannel = true;
        continue;
      }
      // No marker in what is left. A trailing fragment that could still grow
      // into one is withheld at the tail (never emitted half-formed).
      const lt = input.lastIndexOf('<');
      if (lt >= 0) {
        const tail = input.slice(lt);
        if (!tail.includes('>') && tail.length <= 12) {
          held = tail;
          out += stripControlTokens(input.slice(0, lt));
          return out;
        }
      }
      out += stripControlTokens(input);
      input = '';
    }
    return out;
  };
  const flush = () => {
    const tail = held;
    held = '';
    if (inChannel) {
      // A stream that ends mid-channel still owns its content: keep it as
      // thinking so a truncated reply never loses its reasoning or leaks it.
      thinking = (thinking + channelBuf).slice(0, MAX_THINKING);
      channelBuf = '';
      inChannel = false;
      return '';
    }
    channelBuf = '';
    if (!tail) return '';
    const lt = tail.lastIndexOf('<');
    if (lt >= 0 && isPartialMarker(tail.slice(lt))) {
      return stripControlTokens(tail.slice(0, lt));
    }
    return stripControlTokens(tail);
  };
  return { push, flush, getThinking: () => thinking.trim() };
}

function classify(id, meta) {
  const m = meta || {};
  return {
    vision: m.vision !== undefined ? Boolean(m.vision) : VISION_ID.test(id),
    reasoning: m.reasoning !== undefined ? Boolean(m.reasoning) : REASONING_ID.test(id),
    fast: m.fast !== undefined ? Boolean(m.fast) : FAST_ID.test(id),
    tools: m.tools !== undefined ? Boolean(m.tools) : !NOT_CHAT.test(id),
    cost: m.cost || (FAST_ID.test(id) ? 'low' : REASONING_ID.test(id) ? 'high' : 'medium'),
  };
}

function modelShape(id, meta) {
  if (typeof id !== 'string' || !id) return null;
  const m = meta || {};
  return {
    id,
    label: String(m.label || id),
    context: Number(m.context) > 0 ? Number(m.context) : null,
    output: Number(m.output) > 0 ? Number(m.output) : null,
    ...classify(id, m),
  };
}

// OpenAI-family ranking: newest family first, non-mini before mini, then
// everything else alphabetically. This is a name-based heuristic, never a
// benchmark claim; the picker still shows the live catalogue.
function openAiRank(id) {
  const s = String(id || '');
  let version = 0;
  const m = /(?:^|[/-])(?:gpt|o)(\d+(?:\.\d+)?)/i.exec(s);
  if (m) version = parseFloat(m[1]) || 0;
  const mini = /mini|nano|small/i.test(s) ? 1 : 0;
  const chat = NOT_CHAT.test(s) ? 1 : 0;
  return [chat, -version, mini, s];
}

function geminiRank(id) {
  const s = String(id || '');
  const flash = /flash/i.test(s) ? 0 : /pro/i.test(s) ? 1 : 2;
  let version = 0;
  const m = /(\d+(?:\.\d+)?)/.exec(s);
  if (m) version = parseFloat(m[1]) || 0;
  return [flash, -version, s];
}

function cmpRank(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i], y = b[i];
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x).localeCompare(String(y));
  }
  return 0;
}

function baseHeaders(providerId, apiKey) {
  if (providerId === 'gemini') {
    return { 'content-type': 'application/json', 'x-goog-api-key': apiKey };
  }
  return { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey };
}

// Every OpenAI-compatible call goes through here. A custom Base URL is a
// convenience, not a free-form URL: a console/key page would silently receive
// the API key and its HTML/CSS would then be shown as the "error".
function requestBase(providerId, cfg) {
  const prov = providerOf(providerId);
  if (!prov) throw new Error('Unknown AI provider.');
  const base = String((cfg && cfg.baseUrl) || prov.base).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) {
    throw endpointError(providerId, 'Base URL must start with http:// or https://');
  }
  if (KEY_PAGE_HOST.test(base)) {
    throw endpointError(providerId, 'That Base URL opens a key/console page, not an API endpoint. ' + CUSTOM_ENDPOINT_HINT);
  }
  return base;
}

// Which fetch implementation provider calls ride on. Electron's net.fetch uses
// Chromium's network stack: pooled connections survive idle gaps (undici's
// default pool closes them after ~4s, so every post-idle send paid a fresh
// TCP+TLS handshake), DNS/proxy follow the browser, and HTTP/2 is available.
// Node's global fetch remains the fallback — and the explicit escape hatch
// (DEX_AI_TRANSPORT=node) if a network ever misbehaves under Chromium.
let transportFetch = null; // cached once a Chromium transport is known to exist
function defaultFetch() {
  if (transportFetch) return transportFetch;
  if (String(process.env.DEX_AI_TRANSPORT || '').toLowerCase() !== 'node') {
    try {
      const { net } = require('electron');
      if (net && typeof net.fetch === 'function') {
        transportFetch = net.fetch.bind(net);
        return transportFetch;
      }
    } catch {}
  }
  // No Chromium transport here (tests / plain Node): read the global fetch
  // dynamically so a swapped global (the test stubs) is always chosen.
  return fetch;
}

async function listModels(providerId, cfg) {
  const prov = providerOf(providerId);
  if (!prov) throw new Error('Unknown AI provider.');
  const opts = cfg || {};
  if (!opts.apiKey) throw new Error('Add your ' + prov.label + ' API key first.');
  const fetchImpl = opts.fetch || defaultFetch();
  const base = requestBase(providerId, opts);
  const url = providerId === 'gemini'
    ? base + '/models?pageSize=1000'
    : base + '/models';
  const ctl = new AbortController();
  const timer = setTimeout(() => {
    try {
      const e = new Error(prov.label + ' took too long to list models.');
      e.code = 'timeout';
      e.retryable = true;
      ctl.abort(e);
    } catch {}
  }, 15000);
  let res;
  try {
    // cache:no-store — the catalogue must stay fresh (Chromium would otherwise
    // be free to serve it from the HTTP cache).
    res = await fetchImpl(url, { method: 'GET', headers: baseHeaders(providerId, opts.apiKey), signal: ctl.signal, cache: 'no-store' });
  } catch (err) {
    if (isAbort(err)) throw new Error(prov.label + ' took too long to list models.');
    if (err && err.code === 'bad_base_url') throw err;
    throw networkError(providerId, err);
  } finally {
    clearTimeout(timer);
  }
  const resText = await res.text().catch(() => '');
  if (!res.ok) throw httpError(providerId, res.status, resText, res.headers);
  if (isWebpageBody(resText, res.headers)) throw endpointError(providerId);
  let json;
  try { json = JSON.parse(resText); } catch (err) {
    throw endpointError(providerId, 'The models endpoint did not return JSON. ' + CUSTOM_ENDPOINT_HINT);
  }

  let models = [];
  if (providerId === 'gemini') {
    const rows = Array.isArray(json && json.models) ? json.models : [];
    for (const row of rows) {
      if (!row || typeof row.name !== 'string') continue;
      const methods = Array.isArray(row.supportedGenerationMethods) ? row.supportedGenerationMethods : [];
      if (methods.length && !methods.includes('generateContent')) continue;
      const id = row.name.replace(/^models\//, '');
      if (!id) continue;
      models.push(modelShape(id, {
        label: row.displayName || id,
        context: row.inputTokenLimit,
        output: row.outputTokenLimit,
        vision: true,
        tools: true,
        reasoning: /pro|thinking|reason/i.test(id),
        fast: /flash|flash-lite|nano/i.test(id),
        cost: /flash-lite|nano/i.test(id) ? 'low' : /pro/i.test(id) ? 'high' : 'medium',
      }));
    }
  } else {
    const rows = Array.isArray(json && json.data) ? json.data : [];
    for (const row of rows) {
      const id = typeof row === 'string' ? row : row && row.id;
      const model = modelShape(id);
      if (model) models.push(model);
    }
  }
  models = models.filter(Boolean);
  if (!models.length) throw new Error(prov.label + ' returned no chat models for this key.');

  if (providerId === 'nim') {
    const chatModels = models.filter((m) => !NOT_CHAT.test(m.id)).sort((a, b) => a.id.localeCompare(b.id));
    const tail = models.filter((m) => NOT_CHAT.test(m.id)).sort((a, b) => a.id.localeCompare(b.id));
    models = chatModels.concat(tail);
    const recommendedModels = NIM_RECOMMENDED
      .filter((id) => models.some((m) => m.id === id))
      .map((id) => models.find((m) => m.id === id));
    return {
      models,
      all: models.map((m) => m.id),
      ids: models.map((m) => m.id),
      recommended: recommendedModels.map((m) => m.id),
      recommendedModels,
      at: Date.now(),
    };
  }

  const sortRank = providerId === 'gemini' ? geminiRank : openAiRank;
  models.sort((a, b) => cmpRank(sortRank(a.id), sortRank(b.id)));
  const recommendedModels = models.filter((m) => m.tools).slice(0, 12);
  return {
    models,
    all: models.map((m) => m.id),
    ids: models.map((m) => m.id),
    recommended: recommendedModels.map((m) => m.id),
    recommendedModels,
    at: Date.now(),
  };
}

function openAiBody(cfg, stream) {
  const body = {
    model: cfg.model,
    stream: Boolean(stream),
    temperature: cfg.temperature === undefined ? 0.7 : cfg.temperature,
    max_tokens: cfg.maxTokens,
    messages: [{ role: 'system', content: cfg.system || '' }].concat(cfg.messages || []),
  };
  if (stream) body.stream_options = { include_usage: true };
  if (Array.isArray(cfg.tools) && cfg.tools.length) body.tools = cfg.tools;
  if (cfg.jsonSchema && !stream) {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: 'dexerion_result', strict: false, schema: cfg.jsonSchema },
    };
  }
  return body;
}

function dataUrlToInline(url) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(url || ''));
  return m ? { mimeType: m[1], data: m[2] } : null;
}

// OpenAI wire messages -> Gemini contents. Tool call ids are mapped back to
// their function names because Gemini's functionResponse requires the name,
// not the id. Consecutive same-role turns are merged (Gemini accepts them, but
// merging keeps the prompt compact and avoids odd empty turns).
function geminiContents(messages) {
  const names = new Map();
  for (const m of messages || []) {
    if (!m || m.role !== 'assistant' || !Array.isArray(m.tool_calls)) continue;
    for (const call of m.tool_calls) {
      if (call && call.id && call.function && call.function.name) names.set(String(call.id), String(call.function.name));
    }
  }
  const out = [];
  const push = (role, parts) => {
    if (!parts.length) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else out.push({ role, parts });
  };
  for (const m of messages || []) {
    if (!m || m.role === 'system') continue;
    if (m.role === 'tool') {
      push('user', [{
        functionResponse: {
          name: names.get(String(m.tool_call_id || '')) || 'tool',
          response: { result: String(m.content || '') },
        },
      }]);
      continue;
    }
    const role = m.role === 'assistant' ? 'model' : 'user';
    const parts = [];
    const content = m.content;
    if (typeof content === 'string' && content) parts.push({ text: content });
    else if (Array.isArray(content)) {
      for (const part of content) {
        if (!part || typeof part !== 'object') continue;
        if (part.type === 'text' && part.text) parts.push({ text: String(part.text) });
        else if (part.type === 'image_url') {
          const inline = dataUrlToInline(part.image_url && part.image_url.url);
          if (inline) parts.push({ inlineData: inline });
        }
      }
    }
    if (Array.isArray(m.tool_calls)) {
      for (const call of m.tool_calls) {
        if (!call || !call.function || !call.function.name) continue;
        let args = {};
        try { args = call.function.arguments ? JSON.parse(call.function.arguments) : {}; } catch { args = {}; }
        parts.push({ functionCall: { name: String(call.function.name), args } });
      }
    }
    push(role, parts);
  }
  return out;
}

function geminiBody(cfg, stream) {
  const body = {
    contents: geminiContents(cfg.messages),
    generationConfig: {
      temperature: cfg.temperature === undefined ? 0.7 : cfg.temperature,
      maxOutputTokens: cfg.maxTokens,
    },
  };
  if (cfg.system) body.systemInstruction = { parts: [{ text: cfg.system }] };
  if (Array.isArray(cfg.tools) && cfg.tools.length) {
    body.tools = [{
      functionDeclarations: cfg.tools.map((tool) => {
        const fn = (tool && tool.function) || tool || {};
        return {
          name: String(fn.name || ''),
          description: String(fn.description || ''),
          parameters: fn.parameters || { type: 'object', properties: {} },
        };
      }).filter((fn) => fn.name),
    }];
  }
  if (cfg.jsonSchema) {
    body.generationConfig.responseMimeType = 'application/json';
    body.generationConfig.responseSchema = cfg.jsonSchema;
  }
  return body;
}

function usageFromOpenAi(u) {
  if (!u || typeof u !== 'object') return null;
  if (u.prompt_tokens == null && u.completion_tokens == null) return null;
  const usage = {};
  if (u.prompt_tokens != null) usage.input_tokens = Number(u.prompt_tokens) || 0;
  if (u.completion_tokens != null) usage.output_tokens = Number(u.completion_tokens) || 0;
  if (u.total_tokens != null) usage.total_tokens = Number(u.total_tokens) || 0;
  return usage;
}

function usageFromGemini(u) {
  if (!u || typeof u !== 'object') return null;
  const usage = {};
  if (u.promptTokenCount != null) usage.input_tokens = Number(u.promptTokenCount) || 0;
  if (u.candidatesTokenCount != null) usage.output_tokens = Number(u.candidatesTokenCount) || 0;
  if (u.totalTokenCount != null) usage.total_tokens = Number(u.totalTokenCount) || 0;
  return usage;
}

function readSse(res, onJson, onFirstByte) {
  const body = res && res.body;
  if (!body) throw new Error('The provider returned no response stream.');
  if (typeof body.getReader !== 'function') {
    return res.text().then((text) => {
      if (onFirstByte) { try { onFirstByte(); } catch {} }
      for (const raw of String(text).split('\n')) {
        const line = raw.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try { onJson(JSON.parse(payload)); } catch {}
      }
    });
  }
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let bytes = 0;
  return (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value && value.byteLength ? value.byteLength : 0;
        if (bytes > MAX_STREAM_BYTES) throw new Error('The provider response was too large to process.');
        if (value && value.byteLength && onFirstByte) { try { onFirstByte(); } catch {} onFirstByte = null; }
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let json;
          try { json = JSON.parse(payload); } catch { continue; }
          onJson(json);
        }
      }
      // A stream can end on a final line without a trailing newline; dropping
      // it loses the last content delta or the finish_reason/usage chunk.
      const lastLine = buf.trim();
      if (lastLine.startsWith('data:')) {
        const payload = lastLine.slice(5).trim();
        if (payload && payload !== '[DONE]') {
          let json = null;
          try { json = JSON.parse(payload); } catch { json = null; }
          if (json) onJson(json);
        }
      }
    } finally {
      try { if (typeof reader.releaseLock === 'function') reader.releaseLock(); } catch {}
    }
  })();
}

function noteToolCall(slots, index, id, name, args) {
  const i = index != null ? index : 0;
  const slot = slots[i] || (slots[i] = { id: '', name: '', args: '' });
  if (id) slot.id = String(id);
  if (name) slot.name = String(name);
  if (args) slot.args += typeof args === 'string' ? args : JSON.stringify(args);
}

function finishToolCalls(slots, prefix) {
  return Object.keys(slots)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => slots[k])
    .filter((s) => s.name)
    .map((s) => {
      let input = {}, parseError = '';
      const raw = String(s.args || '').trim();
      if (raw) {
        try { input = JSON.parse(raw); }
        catch { parseError = 'Arguments were not valid JSON: ' + raw.slice(0, 200); }
      }
      return {
        id: s.id || (prefix + Math.random().toString(36).slice(2, 10)),
        name: s.name,
        input,
        parseError,
      };
    });
}

async function chatOpenAi(providerId, cfg) {
  const prov = providerOf(providerId);
  const fetchImpl = cfg.fetch || defaultFetch();
  const timing = cfg.timing && typeof cfg.timing === 'object' ? cfg.timing : null;
  const mark = (key) => { if (timing && timing[key] === undefined) { try { timing[key] = performance.now(); } catch {} } };
  let res;
  try {
    mark('fetch');
    res = await fetchImpl(requestBase(providerId, cfg) + '/chat/completions', {
      method: 'POST',
      headers: baseHeaders(providerId, cfg.apiKey),
      signal: cfg.signal,
      body: JSON.stringify(openAiBody(cfg, cfg.stream)),
    });
  } catch (err) {
    if (isAbort(err)) throw abortError();
    if (err && err.code === 'bad_base_url') throw err;
    throw networkError(providerId, err);
  }
  mark('headers');
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (isWebpageBody(body, res.headers)) throw endpointError(providerId);
    throw httpError(providerId, res.status, body, res.headers);
  }

  if (!cfg.stream) {
    let json;
    try { json = await res.json(); } catch (err) { throw endpointError(providerId, 'The chat endpoint did not return JSON. ' + CUSTOM_ENDPOINT_HINT); }
    const choice = json && json.choices && json.choices[0];
    const msg = choice && choice.message;
    const toolCalls = Array.isArray(msg && msg.tool_calls)
      ? msg.tool_calls.map((call) => {
        let input = {};
        try { input = call.function && call.function.arguments ? JSON.parse(call.function.arguments) : {}; } catch {}
        return {
          id: String(call.id || ('call_' + Math.random().toString(36).slice(2, 10))),
          name: String((call.function && call.function.name) || ''),
          input,
        };
      }).filter((call) => call.name) : [];
    const split = splitControlTokens(typeof (msg && msg.content) === 'string' ? msg.content : '');
    const msgReasoning = msg && (typeof msg.reasoning_content === 'string' ? msg.reasoning_content
      : (typeof msg.reasoning === 'string' ? msg.reasoning : ''));
    return {
      ok: true,
      text: split.text,
      thinking: [msgReasoning, split.thinking].filter(Boolean).join('\n').trim().slice(0, MAX_THINKING),
      toolCalls,
      usage: usageFromOpenAi(json && json.usage),
      model: (json && json.model) || cfg.model,
      finishReason: (choice && choice.finish_reason) || '',
    };
  }

  let text = '';
  let reasoning = '';
  let usage = null;
  let finishReason = '';
  const slots = {};
  const tokenFilter = createControlFilter();
  try {
    await readSse(res, (json) => {
      const choice = json && json.choices && json.choices[0];
      const delta = choice && (choice.delta || choice.message);
      // Reasoning models (NIM nemotron reasoning, DeepSeek-R1 family) stream
      // their chain-of-thought in reasoning_content and the answer in
      // content. Without this branch the thinking was dropped entirely AND a
      // reply that spent its whole budget reasoning looked "empty".
      if (delta) {
        const think = typeof delta.reasoning_content === 'string' ? delta.reasoning_content
          : (typeof delta.reasoning === 'string' ? delta.reasoning : '');
        if (think) {
          const remaining = MAX_THINKING - reasoning.length;
          if (remaining > 0) reasoning += think.slice(0, remaining);
          // Every delta still counts as progress, even after the detail cap.
          try { if (cfg.onReasoning) cfg.onReasoning(think); } catch {}
        }
      }
      if (delta && typeof delta.content === 'string' && delta.content) {
        const clean = tokenFilter.push(delta.content);
        if (clean) {
          text += clean;
          mark('firstDelta');
          if (cfg.onText) { try { cfg.onText(clean, text); } catch {} }
        }
      }
      if (delta && Array.isArray(delta.tool_calls)) {
        for (const call of delta.tool_calls) {
          if (!call || typeof call !== 'object') continue;
          const fn = call.function || {};
          noteToolCall(slots, call.index, call.id, fn.name, fn.arguments);
        }
      }
      if (choice && typeof choice.finish_reason === 'string' && choice.finish_reason) finishReason = choice.finish_reason;
      usage = usageFromOpenAi(json && json.usage) || usage;
    }, timing ? () => mark('firstByte') : undefined);
  } catch (err) {
    if (isAbort(err)) throw abortError();
    // A transport drop mid-body arrives as a raw Chromium/undici error
    // (net::ERR_* codes, 'terminated', …). Normalise it to the provider's
    // network shape: plain language for the user, and retry-eligible — so a
    // drop before the first token still gets the one bounded retry, while a
    // drop after output started is thrown (never replayed: that would
    // duplicate the visible reply and the spend).
    if (err && err.code) throw err;
    if (err && /too large/i.test(String(err.message || ''))) throw err;
    throw networkError(providerId, err);
  }
  const tail = tokenFilter.flush();
  if (tail) {
    text += tail;
    if (cfg.onText) { try { cfg.onText(tail, text); } catch {} }
  }
  return {
    ok: true,
    text,
    // Both thinking channels: reasoning_content deltas (NIM reasoning models)
    // and <|channel> blocks inside content (Gemma-style).
    thinking: [reasoning, tokenFilter.getThinking()].filter(Boolean).join('\n').trim().slice(0, MAX_THINKING),
    toolCalls: finishToolCalls(slots, 'call_'),
    usage,
    model: cfg.model,
    finishReason,
  };
}

function geminiPartText(parts) {
  let out = '';
  for (const part of parts || []) {
    if (!part || part.thought) continue;
    if (typeof part.text === 'string') out += part.text;
  }
  return out;
}

function geminiToolCalls(parts, counter) {
  const calls = [];
  for (const part of parts || []) {
    if (!part || !part.functionCall || !part.functionCall.name) continue;
    counter.n += 1;
    calls.push({
      id: 'gcall_' + counter.n,
      name: String(part.functionCall.name),
      input: (part.functionCall.args && typeof part.functionCall.args === 'object') ? part.functionCall.args : {},
    });
  }
  return calls;
}

async function chatGemini(cfg) {
  const prov = PROVIDERS.gemini;
  const fetchImpl = cfg.fetch || defaultFetch();
  const method = cfg.stream ? ':streamGenerateContent?alt=sse' : ':generateContent';
  const url = requestBase('gemini', cfg) + '/models/' + encodeURIComponent(cfg.model).replace(/%2F/g, '/') + method;
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: baseHeaders('gemini', cfg.apiKey),
      signal: cfg.signal,
      body: JSON.stringify(geminiBody(cfg, cfg.stream)),
    });
  } catch (err) {
    if (isAbort(err)) throw abortError();
    throw networkError('gemini', err);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (isWebpageBody(body, res.headers)) throw endpointError('gemini');
    throw httpError('gemini', res.status, body, res.headers);
  }

  if (!cfg.stream) {
    let json;
    try { json = await res.json(); } catch (err) { throw networkError('gemini', err); }
    const candidate = json && json.candidates && json.candidates[0];
    const parts = (candidate && candidate.content && candidate.content.parts) || [];
    const counter = { n: 0 };
    const split = splitControlTokens(geminiPartText(parts));
    return {
      ok: true,
      text: split.text,
      thinking: split.thinking,
      toolCalls: geminiToolCalls(parts, counter),
      usage: usageFromGemini(json && json.usageMetadata),
      model: cfg.model,
      finishReason: (candidate && candidate.finishReason) || '',
    };
  }

  let text = '';
  let usage = null;
  let finishReason = '';
  const calls = [];
  const counter = { n: 0 };
  const tokenFilter = createControlFilter();
  try {
    await readSse(res, (json) => {
      const candidate = json && json.candidates && json.candidates[0];
      const parts = (candidate && candidate.content && candidate.content.parts) || [];
      const delta = tokenFilter.push(geminiPartText(parts));
      if (delta) {
        text += delta;
        if (cfg.onText) { try { cfg.onText(delta, text); } catch {} }
      }
      calls.push(...geminiToolCalls(parts, counter));
      if (candidate && candidate.finishReason) finishReason = candidate.finishReason;
      usage = usageFromGemini(json && json.usageMetadata) || usage;
    });
  } catch (err) {
    if (isAbort(err)) throw abortError();
    throw err;
  }
  const geminiTail = tokenFilter.flush();
  if (geminiTail) {
    text += geminiTail;
    if (cfg.onText) { try { cfg.onText(geminiTail, text); } catch {} }
  }
  return {
    ok: true,
    text,
    thinking: tokenFilter.getThinking(),
    toolCalls: calls,
    usage,
    model: cfg.model,
    finishReason,
  };
}

function chat(providerId, cfg) {
  if (!providerOf(providerId)) return Promise.reject(new Error('Unknown AI provider.'));
  if (!cfg || !cfg.apiKey) return Promise.reject(new Error('Add your ' + providerOf(providerId).label + ' API key first.'));
  if (!cfg.model) return Promise.reject(new Error('Choose a model first.'));
  if (providerId === 'gemini') return chatGemini(cfg);
  return chatOpenAi(providerId, cfg);
}

// A real 1-token completion. GET /models can succeed for a bad key on some
// deployments, so only a generation proves the key works.
async function testChat(providerId, cfg) {
  const out = await chat(providerId, {
    ...cfg,
    stream: false,
    maxTokens: 1,
    temperature: 0,
    system: '',
    messages: [{ role: 'user', content: 'ping' }],
  });
  return Boolean(out && out.ok);
}

module.exports = {
  PROVIDERS,
  PROVIDER_IDS,
  NIM_BASE,
  OPENAI_BASE,
  GEMINI_BASE,
  NIM_RECOMMENDED,
  stripControlTokens,
  splitControlTokens,
  createControlFilter,
  NOT_CHAT,
  providerOf,
  listModels,
  chat,
  testChat,
  httpError,
  detailFrom,
  classify,
  modelShape,
  VISION_ID,
};
