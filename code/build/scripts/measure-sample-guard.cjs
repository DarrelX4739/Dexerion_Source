'use strict';

async function optionalSample(sample, durationMs, { skip = false, now = Date.now, wait } = {}) {
  const start = now();
  let error = 'not collected on this runner';
  if (!skip) {
    try { return { sample: await sample(), error: null }; }
    catch (err) { error = String(err && err.message || err).split('\n')[0]; }
  }
  const remaining = durationMs - (now() - start);
  if (remaining > 0) await wait(remaining);
  return { sample: null, error };
}

function requireTree(tree, label) {
  if (!Array.isArray(tree) || !tree.length) throw new Error('Browser process tree missing at snapshot ' + label);
  return tree;
}

function hasGpuSample(gpu) {
  return Boolean(gpu && !gpu.error && gpu.intervalCount > 0 && Array.isArray(gpu.perPid));
}

module.exports = { optionalSample, requireTree, hasGpuSample };
