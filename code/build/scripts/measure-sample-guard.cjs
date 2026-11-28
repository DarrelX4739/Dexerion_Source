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

function foregroundSample(before, after, seconds, animated) {
  if (!(before?.visible && after?.visible)) throw new Error('Foreground page was not visible across the sample');
  if (!animated) return { visible: true, fps: null };
  if (!(Number.isFinite(before.frames) && Number.isFinite(after.frames) && seconds > 0)) {
    throw new Error('Foreground frame counter missing');
  }
  const fps = (after.frames - before.frames) / seconds;
  if (!(fps >= 15)) throw new Error('Foreground animation below the 15-fps validation floor');
  return { visible: true, fps };
}

module.exports = { optionalSample, requireTree, hasGpuSample, foregroundSample };
