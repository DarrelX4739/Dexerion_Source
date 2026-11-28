'use strict';

// Compute tree usage per common sample before taking means/peaks. Averaging
// each PID over only its own appearances overweights short-lived processes.
function aggregateGpu(samples, treePids, startMs, endMs) {
  if (!(Array.isArray(samples) && treePids.size && endMs >= startMs)) return null;
  const use = samples.filter((s) => {
    const time = Date.parse(s.trialTimestamp);
    return Number.isFinite(time) && time >= startMs && time <= endMs && Array.isArray(s.engines);
  });
  if (!use.length) return null;
  const peaks = [], totals = [];
  const byPid = new Map();
  for (const sample of use) {
    const contributions = new Map();
    const pids = new Map();
    for (const row of sample.engines) {
      if (!treePids.has(row.pid) || typeof row.engine !== 'string' ||
          !Number.isFinite(row.utilPoints) || row.utilPoints < 0) continue;
      contributions.set(row.engine, (contributions.get(row.engine) || 0) + row.utilPoints);
      pids.set(row.pid, (pids.get(row.pid) || 0) + row.utilPoints);
    }
    for (const [pid, n] of pids) {
      const a = byPid.get(pid) || { pid, sum: 0, utilPointsPeak: 0 };
      a.sum += n;
      a.utilPointsPeak = Math.max(a.utilPointsPeak, n);
      byPid.set(pid, a);
    }
    const engines = [...contributions.values()];
    totals.push(engines.reduce((sum, n) => sum + n, 0));
    peaks.push(Math.max(0, ...engines));
  }
  const round = (v) => Math.round(v * 1000) / 1000;
  const mean = (a) => round(a.reduce((sum, n) => sum + n, 0) / a.length);
  return {
    intervalCount: use.length,
    treeUtilPointsMean: mean(totals),
    treeUtilPointsPeak: round(Math.max(...totals)),
    treeBusiestEnginePctMean: mean(peaks),
    perPid: [...byPid.values()].sort((a, b) => a.pid - b.pid)
      .map(({ pid, sum, utilPointsPeak }) => ({
        pid, utilPointsMean: round(sum / use.length), utilPointsPeak: round(utilPointsPeak),
      })),
  };
}

module.exports = { aggregateGpu };
