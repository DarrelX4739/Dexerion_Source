'use strict';

// Isolated Node/V8 component benchmark. Not an Electron working-set reading.
const { execFileSync } = require('node:child_process');
const { TARGET, UPSTREAM } = require('./vendor-lucide-shell.cjs');
const trials = Number(process.argv[2] || 17);
if (!Number.isInteger(trials) || trials < 3 || trials > 101) {
  throw new Error('Supply a trial count between 3 and 101');
}

const worker = `
  const fs = require('node:fs'), vm = require('node:vm'), v8 = require('node:v8');
  const body = fs.readFileSync(process.argv[1], 'utf8');
  const context = vm.createContext({});
  new vm.Script('this.initialized=true').runInContext(context);
  global.gc(); global.gc();
  const before = v8.getHeapStatistics().used_heap_size;
  const start = process.hrtime.bigint();
  const script = new vm.Script(body);
  script.runInContext(context);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  global.gc(); global.gc();
  const bytes = v8.getHeapStatistics().used_heap_size - before;
  console.log(JSON.stringify({ ms, bytes, count: Object.keys(context.lucide.icons).length }));
`;
const measure = (file) => JSON.parse(execFileSync(process.execPath, ['--expose-gc', '-e', worker, file],
  { encoding: 'utf8' }));
const runs = { upstream: [], shell: [] };
const files = { upstream: UPSTREAM, shell: TARGET };
const labels = Object.keys(files);
for (let i = 0; i < trials; i++) {
  for (const label of i % 2 ? [...labels].reverse() : labels) runs[label].push(measure(files[label]));
}
const summarize = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return { median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    min: sorted[0], max: sorted.at(-1) };
};
console.log(JSON.stringify(Object.fromEntries(Object.entries(runs).map(([label, rows]) => [
  label, { trials, icons: rows[0].count, parseAndRunMs: summarize(rows.map((x) => x.ms)),
    retainedHeapBytes: summarize(rows.map((x) => x.bytes)) },
])), null, 2));
