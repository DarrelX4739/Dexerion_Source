'use strict';
// V51+ effort-tier model mapping gate. Pure unit checks on the scout module:
// Low/Medium resolve to Nano Omni 30B, High/Max to Super 120B, and the lineup
// policy bump forces exactly one rescan on profiles that persisted the old
// all-Nano lineup. No Electron, no network, no real profile.

const assert = require('node:assert/strict');
const scout = require('../../code/src/main/ai-model-scout');

const NANO = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning';
const SUPER = 'nvidia/nemotron-3-super-120b-a12b';
// Live NIM currently exposes the pinned Super 120B under this 3.5 Super-vl slug.
const LIVE_SUPER = 'nvidia/nemotron-3.5-super-vl-120b-a12b';

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('ok - ' + name);
  } catch (err) {
    console.error('not ok - ' + name + ': ' + (err && err.message || err));
    process.exitCode = 1;
  }
}

check('LINEUP is the pinned Nemotron vision policy', () => {
  assert.equal(scout.LINEUP.family.test('nvidia/nemotron-3-super'), true);
  assert.match(scout.LINEUP.familyLabel, /Nemotron/i);
  assert.match(scout.LINEUP.policy, /pinmax-v4$/);
});

check('PINNED maps Low/Medium to Nano and High/Max to Super', () => {
  assert.equal(scout.PINNED.low.model, NANO);
  assert.equal(scout.PINNED.medium.model, NANO);
  assert.equal(scout.PINNED.high.model, SUPER);
  assert.equal(scout.PINNED.max.model, SUPER);
  assert.match(scout.PINNED.low.label, /Nano/i);
  assert.match(scout.PINNED.high.label, /Super/i);
});

check('pickAll honours pins when the catalogue carries both models', () => {
  const catalogue = [
    { id: NANO, tools: true, vision: true, reasoning: true, fast: true, context: 128000 },
    { id: SUPER, tools: true, vision: true, reasoning: true, fast: false, context: 128000 },
  ];
  const picked = scout.pickAll(catalogue, { models: [] });
  assert.equal(picked.low.model, NANO);
  assert.equal(picked.medium.model, NANO);
  assert.equal(picked.high.model, SUPER);
  assert.equal(picked.max.model, SUPER);
  for (const id of scout.TIER_IDS) assert.equal(picked[id].evidence.pinned, true);

  // The live catalogue currently renames Super to a 3.5 Super-vl slug. The
  // pin must still win instead of degrading High/Max to Nano.
  const live = scout.pickAll([
    { id: NANO, tools: true, vision: true, reasoning: true, fast: true, context: 128000 },
    { id: LIVE_SUPER, tools: true, vision: true, reasoning: true, fast: false, context: 128000 },
  ], { models: [] });
  assert.equal(live.high.model, LIVE_SUPER);
  assert.equal(live.max.model, LIVE_SUPER);
  assert.equal(live.high.evidence.pinned, true);
  assert.equal(live.max.evidence.pinned, true);
});

check('a persisted old policy forces one rescan', () => {
  const decision = scout.shouldRescan({
    reason: 'restart',
    policy: scout.LINEUP.policy,
    storedPolicy: 'nemotron-vision-pinmax-v3',
  });
  assert.equal(decision.rescan, true);
  assert.equal(decision.why, 'policy changed');
});

check('the current policy is stable on restart', () => {
  const decision = scout.shouldRescan({
    reason: 'restart',
    policy: scout.LINEUP.policy,
    storedPolicy: scout.LINEUP.policy,
  });
  assert.equal(decision.rescan, false);
});

check('High and Max are not the Nano model', () => {
  assert.notEqual(scout.PINNED.high.model, scout.PINNED.low.model);
  assert.notEqual(scout.PINNED.max.model, scout.PINNED.medium.model);
});

console.log('scout mapping: ' + passed + ' passed, 0 failed');
if (!process.exitCode) console.log('ALL EFFORT TIER MAPPINGS PASS');
