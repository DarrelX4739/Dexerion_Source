'use strict';

// Grade raw measure-protocol evidence, not the older rounded parity verdict.
const fs = require('node:fs');
const { verifiesPackageSample } = require('./power-meter.cjs');
const SCENARIOS = ['active-browsing', 'background-tabs', 'idle', 'multitasking'];
const AXES = {
  cpu: (t) => t.cpu?.cpuCorePct,
  ram: (t) => t.ram?.wsMBB,
  gpu: (t) => t.gpu?.treeUtilPointsMean,
  power: (t) => Number.isFinite(t.power?.medianMW) && t.floorMedianMW > 0
    ? t.power.medianMW - t.floorMedianMW : undefined,
};
const MIN_TRIALS = 3;

function median(values) {
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

function usable(group, axis, powerInstance) {
  return (group?.trials || []).filter((trial) => trial.valid === true).flatMap((trial) => {
    const v = AXES[axis](trial);
    if (!Number.isFinite(v) || v < 0) return [];
    if (axis === 'power') {
      if (!verifiesPackageSample(trial.floor, powerInstance) ||
          !verifiesPackageSample(trial.power, powerInstance) ||
          trial.floorMedianMW !== trial.floor.medianMW) return [];
      const { p10MW, p90MW } = trial.power;
      if (!Number.isFinite(p10MW) || !Number.isFinite(p90MW) || p90MW < p10MW ||
          p90MW - p10MW > Math.max(v, 150)) return [];
    }
    return [v];
  });
}

function grade(evidence) {
  const rows = [];
  for (const scenario of SCENARIOS) {
    const pair = evidence?.scenarios?.[scenario];
    for (const axis of Object.keys(AXES)) {
      const dex = usable(pair?.dexerion, axis, evidence?.config?.powerInstance);
      const edge = usable(pair?.edge, axis, evidence?.config?.powerInstance);
      const row = { scenario, axis, dexSamples: dex.length, edgeSamples: edge.length, ratio: null, verdict: 'UNVERIFIED' };
      if (dex.length < MIN_TRIALS || edge.length < MIN_TRIALS) {
        row.reason = 'Fewer than 3 usable trials per browser';
      } else {
        const baseline = median(edge);
        if (!(baseline > 0)) {
          row.reason = 'Edge baseline is zero; a percentage reduction is undefined';
        } else {
          row.ratio = median(dex) / baseline;
          row.verdict = row.ratio <= 0.6 ? '40% TARGET' : row.ratio <= 0.8 ? '20% TARGET' : 'BELOW TARGET';
        }
      }
      rows.push(row);
    }
  }
  const meets = (ratio) => rows.every((row) => row.ratio !== null && row.ratio <= ratio);
  return { minimumMet: meets(0.8), stretchMet: meets(0.6), rows };
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/grade-edge-target.cjs measure-protocol-main.json');
    process.exitCode = 2;
  } else {
    try {
      const report = grade(JSON.parse(fs.readFileSync(file, 'utf8')));
      console.table(report.rows.map(({ ratio, ...row }) => ({
        ...row, pctOfEdge: ratio === null ? '—' : (ratio * 100).toFixed(2) + '%',
      })));
      console.log('20% minimum: ' + (report.minimumMet ? 'MET' : 'NOT ESTABLISHED') +
        '; 40% stretch: ' + (report.stretchMet ? 'MET' : 'NOT ESTABLISHED'));
      if (!report.minimumMet) process.exitCode = 1;
    } catch (err) {
      console.error('Could not grade evidence: ' + err.message);
      process.exitCode = 2;
    }
  }
}

module.exports = { grade, SCENARIOS };
