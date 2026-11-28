'use strict';
const fs = require('node:fs');

function parseStat(line) {
  // comm is parenthesised and may itself contain spaces or parentheses.
  const end = line.lastIndexOf(')');
  const start = line.indexOf('(');
  if (start < 0 || end <= start) return null;
  const cols = line.slice(end + 1).trim().split(/\s+/);
  const pid = Number(line.slice(0, start).trim());
  const ppid = Number(cols[1]);
  const ticks = Number(cols[11]) + Number(cols[12]);
  const started = Number(cols[19]);
  if (!(pid > 0) || !Number.isInteger(ppid) || !Number.isFinite(ticks) || !Number.isFinite(started)) return null;
  return { pid, ppid, ticks, started };
}

function selectTree(entries, rootPid) {
  const root = entries.find((p) => p.pid === rootPid);
  if (!root) throw new Error('Browser root missing from process snapshot');
  const byParent = new Map();
  for (const p of entries) {
    if (!byParent.has(p.ppid)) byParent.set(p.ppid, []);
    byParent.get(p.ppid).push(p);
  }
  const tree = new Map([[rootPid, root]]);
  for (const pid of tree.keys()) {
    for (const p of byParent.get(pid) || []) if (!tree.has(p.pid)) tree.set(p.pid, p);
  }
  return tree;
}

function readTree(rootPid, proc = '/proc') {
  const entries = [];
  for (const pid of fs.readdirSync(proc).filter((x) => /^\d+$/.test(x))) {
    try {
      const stat = parseStat(fs.readFileSync(proc + '/' + pid + '/stat', 'utf8'));
      if (stat) entries.push(stat);
    } catch { /* other processes can exit mid-read */ }
  }
  return selectTree(entries, rootPid);
}

function cpuDelta(a, b, hz, seconds) {
  if (!(hz > 0 && seconds > 0)) throw new Error('Invalid CPU sampling interval');
  let ticks = 0, started = 0, exited = 0;
  for (const [pid, p] of b) {
    const prior = a.get(pid);
    if (prior && prior.started === p.started) {
      if (p.ticks < prior.ticks) throw new Error('Monotonic CPU counter moved backwards');
      ticks += p.ticks - prior.ticks;
    } else {
      started++;
    }
  }
  for (const [pid, p] of a) if (b.get(pid)?.started !== p.started) exited++;
  // Do not report a low CPU result when an unobserved lifecycle has work we
  // cannot place inside the interval. RAM can still be measured at the end.
  return { started, exited, pctOfOneCore: started || exited ? null : ticks * 100 / hz / seconds };
}

function readPss(tree, proc = '/proc') {
  const values = new Map();
  for (const pid of tree.keys()) {
    try {
      const pss = /^Pss:\s+(\d+)\s+kB\b/m.exec(fs.readFileSync(proc + '/' + pid + '/smaps_rollup', 'utf8'));
      if (!pss) return null;
      values.set(pid, Number(pss[1]) / 1024);
    } catch { return null; }
  }
  return values;
}

function sumPss(tree, proc = '/proc') {
  const values = readPss(tree, proc);
  const total = values ? [...values.values()].reduce((a, b) => a + b, 0) : 0;
  return total > 0 ? total : null;
}

function classifyProcess(pid, rootPid, raw, labels = {}) {
  if (pid === rootPid) return 'browser';
  if (['shell-renderer', 'page-renderer', 'other-renderer'].includes(labels[pid])) return labels[pid];
  const argv = raw.split('\0');
  if (argv[0].includes('crashpad')) return 'crash-handler';
  const type = argv.find((arg) => arg.startsWith('--type='))?.slice(7);
  return ['renderer', 'gpu-process', 'utility', 'zygote'].includes(type) ? type : 'other';
}

function processRoles(tree, rootPid, labels, proc = '/proc') {
  return new Map([...tree.keys()].map((pid) => {
    let raw = '';
    try { raw = fs.readFileSync(proc + '/' + pid + '/cmdline', 'utf8'); } catch {}
    return [pid, classifyProcess(pid, rootPid, raw, labels)];
  }));
}

function breakDown(a, b, roles, pss, hz, seconds) {
  const cpu = cpuDelta(a, b, hz, seconds);
  const result = {};
  for (const [pid, current] of b) {
    const name = roles.get(pid) || 'other';
    const row = result[name] ||= { processes: 0, cpu: cpu.pctOfOneCore === null ? null : 0, ram: pss ? 0 : null };
    row.processes++;
    if (row.cpu !== null) row.cpu += (current.ticks - a.get(pid).ticks) * 100 / hz / seconds;
    if (row.ram !== null) row.ram += pss.get(pid);
  }
  return result;
}

module.exports = { parseStat, selectTree, readTree, cpuDelta, sumPss, readPss, classifyProcess, processRoles, breakDown };
