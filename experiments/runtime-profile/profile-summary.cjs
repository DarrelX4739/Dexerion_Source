'use strict';

function summarize(profile) {
  const { startTime, endTime, samples, timeDeltas, nodes } = profile;
  const durationMs = (endTime - startTime) / 1000;
  if (!Number.isFinite(durationMs) || durationMs <= 0 || !Array.isArray(nodes) ||
      !Array.isArray(samples) || samples.length < 2 || timeDeltas?.length !== samples.length) {
    throw new Error('CPU profile lacks a timed sample sequence');
  }
  const frames = new Map(nodes.map((n) => [n.id, n.callFrame]));
  const self = new Map();
  const buckets = { idle: 0, gc: 0, product: 0, other: 0 };
  let sampledUsec = 0;
  for (const [i, id] of samples.entries()) {
    const frame = frames.get(id);
    const usec = timeDeltas[i];
    if (!frame || !Number.isFinite(usec) || usec < 0) throw new Error('Invalid CPU profile sample');
    sampledUsec += usec;
    const file = String(frame.url || '').replaceAll('\\', '/').split(/[?#]/, 1)[0];
    const fn = frame.functionName || '(anonymous)';
    const src = /(?:^|\/)code\/code\/([^:]+)$/.exec(file);
    const group = fn === '(idle)' ? 'idle' : fn === '(garbage collector)' ? 'gc'
      : src && !file.includes('/node_modules/') ? 'product' : 'other';
    buckets[group] += usec;
    if (group === 'product') {
      const name = src[1] + ':' + (frame.lineNumber + 1) + ' ' + fn;
      self.set(name, (self.get(name) || 0) + usec);
    }
  }
  if (sampledUsec < durationMs * 850 || sampledUsec > durationMs * 1100) {
    throw new Error('V8 sample clock disagrees with its profile duration');
  }
  return {
    durationMs,
    samples: samples.length,
    bucketMs: Object.fromEntries(Object.entries(buckets).map(([k, n]) => [k, n / 1000])),
    productExclusiveTop: [...self].sort((a, b) => b[1] - a[1]).slice(0, 20)
      .map(([location, usec]) => ({ location, sampleMs: usec / 1000 })),
  };
}

module.exports = { summarize };
