// Dexerion AI model scout — picks the model behind each difficulty tier from
// trusted benchmark data.
//
// Pure module: the caller supplies the live NIM catalogue (ids with capability
// flags) and a parsed snapshot (Artificial Analysis intelligence/speed/cost
// with LMArena/LiveBench tie-breakers, plus the DiffusionGemma speed anchor).
// No Electron, no network, no filesystem. Missing snapshot numbers fall back to
// capability heuristics and every pick records which source it used.
'use strict';

const LOW_ANCHOR_ID = 'google/diffusiongemma-26b-a4b-it';
const MIN_CONTEXT = 64000;
const MIN_FLOOR_TOKENS = 150;   // never chase a floor below this

// Lineup policy (product decision): every effort tier (Low/Medium/High/Max)
// draws from NVIDIA's Nemotron line, and every pick must be vision-capable so
// images work at any effort level. If the Nemotron pool comes up empty the
// scout degrades gracefully (Nemotron any -> vision any -> open pool) rather
// than picking nothing, and the evidence records which rule applied.
// `policy` rides into the stored scout: bumping it forces one rescan so an
// existing install adopts the new lineup without a manual action.
const LINEUP = {
  family: /nemotron/i,
  familyLabel: 'NVIDIA Nemotron',
  // V51+ forces one rescan so installs that persisted the older all-nano
  // lineup adopt the pinned Low/Medium Nano + High/Max Super mapping. v4 also
  // re-pins profiles that resolved High/Max to Nano against a Super-vl catalogue.
  policy: 'nemotron-vision-pinmax-v4',
};

// Effort tier model lineup (product decision): every tier draws from
// NVIDIA's Nemotron line, and every pick must be vision-capable so images
// work at any effort level. Low/Medium run the Nano Omni 30B; High/Max run
// the Super 120B.
const PINNED = {
  low: { model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', label: 'Nemotron 3 Nano Omni 30B' },
  medium: { model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', label: 'Nemotron 3 Nano Omni 30B' },
  high: { model: 'nvidia/nemotron-3-super-120b-a12b', label: 'Nemotron 3 Super 120B' },
  max: { model: 'nvidia/nemotron-3-super-120b-a12b', label: 'Nemotron 3 Super 120B' },
};

// Weights sum to 1 per tier. `floor` is a fraction of the anchor speed.
const TIER_SPECS = [
  { id: 'low', label: 'Low', weights: { intelligence: 0.20, speed: 0.70, cost: 0.10 }, floor: 1.00 },
  { id: 'medium', label: 'Medium', weights: { intelligence: 0.55, speed: 0.30, cost: 0.15 }, floor: 0.60 },
  { id: 'high', label: 'High', weights: { intelligence: 0.80, speed: 0.15, cost: 0.05 }, floor: 0.25 },
  { id: 'max', label: 'Max', weights: { intelligence: 0.95, speed: 0.05, cost: 0.00 }, floor: 0 },
];

const TIER_IDS = TIER_SPECS.map((spec) => spec.id);

function tierSpec(id) {
  return TIER_SPECS.find((spec) => spec.id === String(id || '').toLowerCase()) || null;
}

// Snapshot rows are keyed on the model's last path segment so `creator/model`
// and `model` spellings still meet.
function snapshotKey(modelId) {
  const raw = String(modelId || '').toLowerCase().split('/').pop() || '';
  return raw.replace(/[^a-z0-9.]+/g, '');
}

// The live NIM catalogue renames the pinned Super 120B to the 3.5 Super-vl
// variant. Normalise those known aliases so a pin still wins instead of
// silently degrading High/Max to the Nano lineup.
function pinKey(modelId) {
  return (String(modelId || '').toLowerCase().split('/').pop() || '')
    .replace(/^nemotron-3\.5-/, 'nemotron-3-')
    .replace(/^nemotron-3-super-vl-/, 'nemotron-3-super-');
}

// Accepts whatever JSON was loaded and returns a safe, predictable shape.
function normaliseSnapshot(raw) {
  const input = (raw && typeof raw === 'object') ? raw : {};
  const source = (input.source && typeof input.source === 'object') ? input.source : {};
  const primary = (source.primary && typeof source.primary === 'object') ? source.primary : {};
  const anchorRaw = (input.anchor && typeof input.anchor === 'object') ? input.anchor : {};
  const models = Array.isArray(input.models) ? input.models : [];
  const rows = new Map();
  for (const row of models) {
    if (!row || typeof row !== 'object' || !row.id) continue;
    const key = snapshotKey(row.id);
    if (!key) continue;
    rows.set(key, {
      id: String(row.id),
      intelligence: Number.isFinite(Number(row.intelligence)) ? Number(row.intelligence) : null,
      speed: Number.isFinite(Number(row.speed)) ? Number(row.speed) : null,
      costPerTask: Number.isFinite(Number(row.costPerTask)) ? Number(row.costPerTask) : null,
      lmarena: Number.isFinite(Number(row.lmarena)) ? Number(row.lmarena) : null,
      livebench: Number.isFinite(Number(row.livebench)) ? Number(row.livebench) : null,
      estimated: row.estimated === true,
    });
  }
  return {
    source: {
      name: String(primary.name || 'heuristic'),
      url: String(primary.url || ''),
      capturedAt: String(primary.capturedAt || ''),
      attribution: String(primary.attribution || ''),
    },
    anchor: {
      model: String(anchorRaw.model || LOW_ANCHOR_ID),
      speed: Number.isFinite(Number(anchorRaw.speed)) ? Number(anchorRaw.speed) : null,
      note: String(anchorRaw.note || ''),
    },
    rows,
  };
}

// One snapshot row for a candidate: exact key first, then a long-enough
// containment match ("nemotron-super-49b" style renames).
function rowFor(snapshot, modelId) {
  const key = snapshotKey(modelId);
  if (!key) return null;
  if (snapshot.rows.has(key)) return snapshot.rows.get(key);
  for (const [rowKey, row] of snapshot.rows) {
    if (rowKey.length >= 6 && key.length >= 6 && (rowKey.includes(key) || key.includes(rowKey))) return row;
  }
  return null;
}

// Pseudo-numbers from capability flags, used only where the snapshot has no
// real measurement. The evidence marks these `estimated`.
function heuristicScores(candidate) {
  const reasoning = Boolean(candidate.reasoning);
  const fast = Boolean(candidate.fast);
  const context = Number(candidate.context) || 0;
  return {
    intelligence: reasoning ? 60 : 45,
    speed: fast ? 120 : 50,
    context,
  };
}

// All scored candidates come from this same numeric pool. A sorted run
// counts lower values and ties once rather than filtering it for every
// candidate in each tier. The mid-rank tie formula stays unchanged.
function percentileByValue(values) {
  values.sort((a, b) => a - b);
  const ranks = new Map();
  const denominator = Math.max(1, values.length - 1);
  for (let start = 0; start < values.length;) {
    let end = start + 1;
    while (end < values.length && values[end] === values[start]) end++;
    ranks.set(values[start], (start + (end - start - 1) / 2) / denominator);
    start = end;
  }
  return ranks;
}

// Candidate shape (from ai-providers.listModels): { id, context, tools,
// vision, fast, reasoning }. The snapshot adds measurable numbers where they
// exist.
function eligible(candidates, snapshot) {
  const out = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (!candidate || typeof candidate.id !== 'string' || !candidate.id) continue;
    if (candidate.tools !== true) continue;
    const context = Number(candidate.context);
    if (Number.isFinite(context) && context > 0 && context < MIN_CONTEXT) continue;
    const row = rowFor(snapshot, candidate.id);
    const heuristic = heuristicScores(candidate);
    out.push({
      id: candidate.id,
      context,
      vision: Boolean(candidate.vision),
      fast: Boolean(candidate.fast),
      reasoning: Boolean(candidate.reasoning),
      intelligence: row && row.intelligence != null ? row.intelligence : heuristic.intelligence,
      speed: row && row.speed != null ? row.speed : heuristic.speed,
      costPerTask: row && row.costPerTask != null ? row.costPerTask : null,
      lmarena: row ? row.lmarena : null,
      livebench: row ? row.livebench : null,
      estimated: !row || row.intelligence == null || row.speed == null,
      rowId: row ? row.id : '',
    });
  }
  return out;
}

function median(values) {
  const list = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!list.length) return null;
  return list[Math.floor(list.length / 2)];
}

function scoringContext(pool, anchor) {
  const costs = pool.map((c) => c.costPerTask).filter((v) => v != null);
  return {
    anchor,
    intelligence: percentileByValue(pool.map((c) => c.intelligence)),
    speed: anchor ? null : percentileByValue(pool.map((c) => c.speed)),
    minCost: Math.min(...costs),
    maxCost: Math.max(...costs),
    lmarenaMedian: median(pool.map((c) => c.lmarena)),
    livebenchMedian: median(pool.map((c) => c.livebench)),
  };
}

function scoreTier(spec, pool, context) {
  let best = null;
  for (const candidate of pool) {
    const intelP = context.intelligence.get(candidate.intelligence);
    const speedP = context.anchor
      ? Math.min(candidate.speed / context.anchor, 1)
      : context.speed.get(candidate.speed);
    const costP = candidate.costPerTask == null || context.maxCost === context.minCost
      ? 0.5 : 1 - (candidate.costPerTask - context.minCost) / (context.maxCost - context.minCost);
    let score = spec.weights.intelligence * intelP
      + spec.weights.speed * speedP
      + spec.weights.cost * costP;
    if (candidate.lmarena != null && context.lmarenaMedian != null && candidate.lmarena > context.lmarenaMedian) score += 0.02;
    if (candidate.livebench != null && context.livebenchMedian != null && candidate.livebench > context.livebenchMedian) score += 0.02;
    if (candidate.vision) score += 0.01;
    if (!best || score > best.score) best = { candidate, score };
  }
  return best;
}

// Picks one model for every tier. Returns { low, medium, high, max } where
// each value is { tier, model, reason, evidence } or null when nothing is
// eligible.
function pickAll(candidates, rawSnapshot) {
  const snapshot = normaliseSnapshot(rawSnapshot);
  const pool = eligible(candidates, snapshot);
  const result = {};
  if (!pool.length) {
    for (const spec of TIER_SPECS) result[spec.id] = null;
    return result;
  }

  // Pinned tiers don't score the catalogue at all. Build the shared
  // numeric table only when a fallback tier needs it.
  let context;

  for (const spec of TIER_SPECS) {
    // A pinned tier wins whenever the catalogue actually carries the model;
    // otherwise it degrades to the normal lineup rather than picking nothing.
    const pin = PINNED[spec.id];
    const pinnedCandidate = pin
      ? pool.find((c) => pinKey(c.id) === pinKey(pin.model))
      : null;
    if (pinnedCandidate) {
      const pinRow = rowFor(snapshot, pinnedCandidate.id);
      result[spec.id] = {
        tier: spec.id,
        model: pinnedCandidate.id,
        reason: 'pinned to ' + pin.label + ' — the deepest reasoner the catalogue carries',
        evidence: {
          source: pinRow && pinRow.intelligence != null && pinRow.speed != null ? (snapshot.source.name || 'benchmarks') : 'heuristic',
          capturedAt: snapshot.source.capturedAt,
          estimated: pinnedCandidate.estimated,
          intelligence: pinnedCandidate.intelligence,
          speed: pinnedCandidate.speed,
          costPerTask: pinnedCandidate.costPerTask,
          floorTokens: 0,
          relaxations: [],
          anchor: false,
          pinned: true,
          lineup: 'pinned',
        },
      };
      continue;
    }

    // Every other tier: NVIDIA Nemotron + vision first, then the graceful
    // degradations; the evidence records which rule applied.
    let tierPool = pool;
    let lineup = 'open';
    const familyPool = pool.filter((c) => LINEUP.family.test(c.id));
    const familyVisionPool = familyPool.filter((c) => c.vision);
    const visionPool = pool.filter((c) => c.vision);
    if (familyVisionPool.length) {
      tierPool = familyVisionPool;
      lineup = 'vendor';
    } else if (familyPool.length) {
      tierPool = familyPool;
      lineup = 'vendor';
    } else if (visionPool.length) {
      tierPool = visionPool;
      lineup = 'open';
    }

    const anchorCandidate = spec.id === 'low'
      ? tierPool.find((c) => c.id.toLowerCase() === LOW_ANCHOR_ID)
      : null;

    let floorTokens = snapshot.anchor.speed != null && spec.floor > 0
      ? Math.round(snapshot.anchor.speed * spec.floor)
      : 0;
    const relaxations = [];
    let floorPool = floorTokens > 0 ? tierPool.filter((c) => c.speed >= floorTokens) : tierPool.slice();
    while (floorTokens > 0 && !floorPool.length && floorTokens > MIN_FLOOR_TOKENS) {
      floorTokens = Math.round(floorTokens / 2);
      relaxations.push(floorTokens);
      floorPool = tierPool.filter((c) => c.speed >= floorTokens);
    }
    if (floorTokens > 0 && !floorPool.length) {
      relaxations.push('exhausted');
      floorTokens = 0;
      floorPool = tierPool.slice();
    }

    let pick;
    if (anchorCandidate) pick = { candidate: anchorCandidate, score: 1 };
    else {
      context ||= scoringContext(pool, snapshot.anchor.speed);
      pick = scoreTier(spec, floorPool, context) || scoreTier(spec, tierPool, context);
    }
    if (!pick) { result[spec.id] = null; continue; }
    const candidate = pick.candidate;
    const row = rowFor(snapshot, candidate.id);
    result[spec.id] = {
      tier: spec.id,
      model: candidate.id,
      reason: anchorCandidate
        ? 'the speed anchor the person named'
        : lineup === 'vendor'
          ? 'best ' + spec.label.toLowerCase() + ' fit within the ' + LINEUP.familyLabel + ' line, vision included'
          : 'best ' + spec.label.toLowerCase() + ' fit for the available catalogue',
      evidence: {
        source: row && row.intelligence != null && row.speed != null ? (snapshot.source.name || 'benchmarks') : 'heuristic',
        capturedAt: snapshot.source.capturedAt,
        estimated: candidate.estimated,
        intelligence: candidate.intelligence,
        speed: candidate.speed,
        costPerTask: candidate.costPerTask,
        floorTokens,
        relaxations,
        anchor: Boolean(anchorCandidate),
        lineup,
      },
    };
  }
  return result;
}

// Stable catalogue fingerprint so a changed /models list triggers one rescan.
function fingerprintCatalogue(ids) {
  const list = (Array.isArray(ids) ? ids : []).map(String).sort();
  const source = list.join('|');
  let hash = 5381;
  for (let i = 0; i < source.length; i++) hash = ((hash << 5) + hash + source.charCodeAt(i)) >>> 0;
  return 'c' + hash.toString(36) + '-' + list.length;
}

// The re-check matrix from the plan: scouts run on key connect, on a changed
// catalogue fingerprint, on an app update, on a model failure and by hand.
// A plain restart never rescans.
function shouldRescan(input) {
  const state = input || {};
  const reason = String(state.reason || 'restart');
  if (reason === 'key-connect' || reason === 'manual' || reason === 'failure') return { rescan: true, why: reason };
  // A lineup-policy change (e.g. every tier now draws from the Nemotron,
  // vision-capable line) forces exactly one rescan so existing installs adopt
  // it without the person doing anything.
  if (state.policy && state.policy !== state.storedPolicy) return { rescan: true, why: 'policy changed' };
  if (reason === 'update') {
    const changed = Boolean(state.appVersion) && state.appVersion !== state.storedAppVersion;
    return { rescan: changed, why: changed ? 'update' : 'same version' };
  }
  if (reason === 'catalogue') {
    const changed = Boolean(state.fingerprint) && state.fingerprint !== state.storedFingerprint;
    return { rescan: changed, why: changed ? 'catalogue changed' : 'same catalogue' };
  }
  return { rescan: false, why: 'stable' };
}

module.exports = {
  LOW_ANCHOR_ID,
  MIN_CONTEXT,
  MIN_FLOOR_TOKENS,
  LINEUP,
  PINNED,
  TIER_SPECS,
  TIER_IDS,
  tierSpec,
  snapshotKey,
  normaliseSnapshot,
  rowFor,
  pickAll,
  fingerprintCatalogue,
  shouldRescan,
};
