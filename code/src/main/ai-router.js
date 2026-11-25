// Dexerion AI task routing.
//
// Deterministic, readable rules — no trained router and no invented benchmark
// numbers. The classifier looks only at the user's latest request (plus
// whether images were attached); the chooser ranks live provider models by
// capabilities we can actually observe: image support, tool support, context
// window (when the provider reports one), and name-family hints for reasoning
// and speed.
//
// The user's saved model stays the default for ordinary conversation. Routing
// only proposes a different model for a task that needs a capability the
// default may not have, and only while routing is enabled.
'use strict';

const TASKS = [
  'conversation',
  'explain',
  'research',
  'code',
  'reasoning',
  'website',
  'quiz',
  'study',
  'data',
  'browser',
  'vision',
];

// Tasks that should produce a structured artifact rather than only prose.
const ARTIFACT_TASKS = new Set(['research', 'website', 'quiz', 'study', 'data']);

const RULES = [
  { task: 'website', re: /\b(web ?site|web ?app|mini[- ]?app|interactive (?:page|site|tool|app|dashboard|lesson)|landing page|build (?:me )?(?:a|an) (?:app|site|page|tool)|html app|single[- ]page app)\b/i },
  { task: 'quiz', re: /\b(quiz|multiple[- ]choice|practice (?:questions|test|exam)|test me|question bank|flashcards?|flash cards?)\b/i },
  { task: 'study', re: /\b(study guide|revision (?:notes|guide)|study notes|learn(?:ing)? plan|lesson plan|worksheet|cheat ?sheet|summari[sz]e .* (?:into|as) (?:notes|cards))\b/i },
  { task: 'data', re: /\b(chart|graph|plot|visuali[sz](?:e|ation)|timeline|comparison matrix|heat ?map|dashboard|infographic)\b/i },
  { task: 'research', re: /\b(research|report|white ?paper|brief(?:ing)?|literature review|market analysis|compare (?:several|multiple|these|the) sources|cite|citations?|sources?)\b/i },
  { task: 'code', re: /\b(code|coding|program|function|class|debug|bug|stack trace|exception|regex|sql|api|refactor|typescript|javascript|python|html|css|react|electron)\b/i },
  { task: 'reasoning', re: /\b(prove|deriv(?:e|ation)|step[- ]by[- ]step|calculate|solve|equation|theorem|logic|optimi[sz]e|algorithm|complexity)\b/i },
  { task: 'explain', re: /\b(explain|summari[sz]e|summary|what is|what are|how does|how do|why (?:is|does|do)|compare|difference between|overview)\b/i },
];

function lastUserText(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (m && (m.role === 'user' || m.role === 'me')) return String(m.text || '');
  }
  return '';
}

function classifyTask(messages, opts) {
  const options = opts || {};
  if (options.hasImages) return 'vision';
  const text = typeof messages === 'string' ? messages : lastUserText(messages);
  const body = String(text || '').replace(/\s+/g, ' ').trim();
  if (!body) return 'conversation';
  if (options.agent) return 'browser';
  for (const rule of RULES) {
    if (rule.re.test(body)) return rule.task;
  }
  if (body.length > 1200) return 'explain';
  return 'conversation';
}

function isArtifactTask(task) {
  return ARTIFACT_TASKS.has(task);
}

function wantsArtifactText(text) {
  return /\b(artifact|deliverable|document|report|brief|briefing|memo|write-?up|web ?site|web ?app|mini[- ]?app|quiz|flashcards?|study guide|revision notes|chart|diagram|timeline|worksheet|presentation|project plan|calculator|checklist)\b/i
    .test(String(text || '')) && /\b(make|create|build|generate|produce|write|design|turn|give me|prepare|draft)\b/i
    .test(String(text || ''));
}

function scoreModel(model, task, policy) {
  const m = model || {};
  let score = 0;
  if (task === 'vision') {
    if (!m.vision) return -1000;
    score += 40;
  }
  if (task === 'research') {
    score += (m.context || 0) / 8000;
    if (m.reasoning) score += 8;
  }
  if (task === 'code' || task === 'reasoning') {
    if (m.reasoning) score += 18;
    if (m.fast) score -= 4;
  }
  if (task === 'website' || task === 'quiz' || task === 'study' || task === 'data') {
    if (m.reasoning) score += 10;
    if (m.tools) score += 2;
  }
  if (task === 'explain' || task === 'conversation') {
    if (m.fast) score += 6;
    if (m.reasoning) score -= 2;
  }
  if (policy === 'quality') {
    if (m.reasoning) score += 8;
    score += Math.min(10, (m.context || 0) / 32000);
  } else if (policy === 'cost') {
    if (m.cost === 'low') score += 10;
    else if (m.cost === 'high') score -= 10;
    if (m.fast) score += 6;
  } else {
    if (m.cost === 'low') score += 3;
    if (m.cost === 'high') score -= 1;
  }
  if (!m.tools && task === 'browser') return -1000;
  return score;
}

function chooseModel(input) {
  const opts = input || {};
  const models = Array.isArray(opts.models) ? opts.models.filter((m) => m && m.id) : [];
  if (!models.length) return null;
  const task = TASKS.includes(opts.task) ? opts.task : 'conversation';
  const policy = ['balanced', 'quality', 'cost'].includes(opts.policy) ? opts.policy : 'balanced';
  const pins = (opts.pins && typeof opts.pins === 'object') ? opts.pins : {};
  const pin = pins[task] || pins[task === 'vision' ? 'vision' : 'default'];
  if (pin && typeof pin === 'object' && pin.model) {
    const match = models.find((m) => m.id === pin.model);
    if (match) return { model: match.id, task, reason: 'pinned for ' + task, pinned: true, modelInfo: match };
    if (pin.strict) return { model: match ? match.id : '', task, reason: 'pinned model is unavailable', pinned: true, modelInfo: null };
  }
  const selected = typeof opts.selected === 'string' ? opts.selected : '';
  const selectedInfo = selected ? models.find((m) => m.id === selected) : null;
  const needsCapability = task === 'vision' || task === 'research' || task === 'code' || task === 'reasoning'
    || task === 'website' || task === 'quiz' || task === 'study' || task === 'data' || task === 'browser';
  if (!needsCapability && selectedInfo) {
    return { model: selectedInfo.id, task, reason: 'your selected model', selected: true, modelInfo: selectedInfo };
  }
  let best = null;
  let bestScore = -Infinity;
  for (const model of models) {
    const score = scoreModel(model, task, policy);
    if (score > bestScore) { best = model; bestScore = score; }
  }
  if (!best) return null;
  // A user's chosen model stays in place when it already scores as well as
  // the best candidate. Routing only overrides a mismatch (no vision, no
  // tools, too little context) or a policy that asks for quality.
  if (selectedInfo && policy !== 'quality') {
    const selectedScore = scoreModel(selectedInfo, task, policy);
    if (selectedScore >= bestScore - 0.5) {
      return { model: selectedInfo.id, task, reason: 'your selected model', selected: true, modelInfo: selectedInfo };
    }
  }
  if (selectedInfo && best.id === selectedInfo.id) {
    return { model: best.id, task, reason: 'your selected model', selected: true, modelInfo: best };
  }
  return {
    model: best.id,
    task,
    reason: 'best ' + task + ' fit on this provider (' + policy + ' policy)',
    modelInfo: best,
  };
}

module.exports = {
  TASKS,
  ARTIFACT_TASKS,
  classifyTask,
  isArtifactTask,
  wantsArtifactText,
  chooseModel,
  scoreModel,
  lastUserText,
};
