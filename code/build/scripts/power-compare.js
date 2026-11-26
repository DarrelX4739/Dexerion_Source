'use strict';
// Compare two power-benchmark JSONs (baseline vs optimised) and print a table.
// Handles both harness schemas:
//  - paired-floor (current): each measurement carries its own floorMedianMW
//    and attributableMW; noiseLimited flags rows where within-sample spread
//    exceeds the attributable value.
//  - global-idle (legacy): one idleBaseline for the whole run; attributable
//    is recomputed median-vs-median.
const fs = require('node:fs');
const a = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); // baseline tree
const b = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')); // optimised tree
const scenarios = ['idle', 'browsing', 'video', 'background', 'multitasking'];
const pct = (before, after) => before > 0 ? ((before - after) / before) * 100 : 0;
const r1 = (v) => Number(Number(v).toFixed(1));
const att = (doc, scenario, browser) => {
  const p = doc.scenarios[scenario] && doc.scenarios[scenario][browser];
  if (!p) return null;
  if (doc.idleBaseline) return { value: Math.max(0, r1(p.medianMW - doc.idleBaseline.medianMW)), noise: false };
  return { value: p.attributableMW, noise: Boolean(p.noiseLimited) };
};
const rows = scenarios.map((s) => {
  const eA = att(a, s, 'edge'), dA = att(a, s, 'dexerion');
  const eB = att(b, s, 'edge'), dB = att(b, s, 'dexerion');
  return {
    scenario: s,
    baselineEdge: eA && eA.value, baselineDex: dA && dA.value,
    optimisedEdge: eB && eB.value, optimisedDex: dB && dB.value,
    noise: (eB && eB.noise) || (dB && dB.noise) || false,
    dexChangeVsOwnBaselinePct: (dA && dB) ? r1(pct(dA.value, dB.value)) : null,
    optimisedVsEdgePct: (eB && dB && eB.value > 0) ? r1(pct(eB.value, dB.value)) : null,
  };
});
for (const row of rows) {
  console.log(
    row.scenario.padEnd(13)
    + ' baseline Edge=' + String(row.baselineEdge).padStart(7) + ' Dex=' + String(row.baselineDex).padStart(7)
    + ' | optimised Edge=' + String(row.optimisedEdge).padStart(7) + ' Dex=' + String(row.optimisedDex).padStart(7)
    + ' | Dex vs own baseline: ' + (row.dexChangeVsOwnBaselinePct == null ? 'n/a' : row.dexChangeVsOwnBaselinePct + '%')
    + ' | Dex vs Edge: ' + (row.optimisedVsEdgePct == null ? 'n/a' : row.optimisedVsEdgePct + '%')
    + (row.noise ? '  [noise-limited]' : '')
  );
}
const meanVsEdge = rows.filter((r) => r.optimisedVsEdgePct != null);
if (meanVsEdge.length) {
  console.log('mean optimised-vs-Edge reduction: '
    + r1(meanVsEdge.reduce((s, r) => s + r.optimisedVsEdgePct, 0) / meanVsEdge.length) + '%');
}
