// Differential oracle for the normalized-record boundary. No locale conversion,
// time zone, account I/O or alarm scheduling is performed in native code.
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const [binary, source] = process.argv.slice(2);
if (!binary) throw new Error('Usage: node task_reminders_parity.cjs <native replay> [js module]');
const js = require(path.resolve(source || path.resolve(__dirname, '../../../code/code/src/main/tasks.js')));
const now = 1710000000000;
const PRE = js.PRE_NOTIFY_MS;
const pri = js.PRIORITIES;
const task = (id, overrides) => ({ id, title: 'Fixture', notes: '', dueMs: now + PRE,
  createdAt: now - 10000, hasTime: true, priority: 'medium', done: false, doneAt: 0,
  remindedPre: false, remindedDue: false, ...overrides });
function hex(s) {
  let result = '';
  for (let i = 0; i < s.length; ++i) result += s.charCodeAt(i).toString(16).padStart(4, '0');
  return result;
}
const cases = [];
function add(label, rows, opts = {}, expectedTop) {
  const b = { taskHeartbeatNearMs: 30000, taskHeartbeatIdleMs: 300000,
    taskHeartbeatNearWindowMs: 600000, ...opts };
  const first = new Map();
  rows.forEach((t, i) => { if (!first.has(t.id)) first.set(t.id, i); });
  const sort = js.sortTasks(rows).map(t => first.get(t.id));
  const top = js.nextThree(rows).map(t => first.get(t.id));
  if (expectedTop) assert.deepEqual(top, expectedTop, label);
  const summary = rows.map(t => {
    const kind = js.reminderKind(t, now), at = js.nextReminderAt(t, now);
    return (kind === 'due' ? 2 : kind === 'pre' ? 1 : 0) + ':' + (Number.isFinite(at) ? at : '-');
  });
  const expected = [String(js.reminderHeartbeatMs(rows, now, b)), sort.join(' '), top.join(' '), summary.join(' ')];
  const near = b.taskHeartbeatNearWindowMs;
  const lines = [[ 'tasks', rows.length, now, b.taskHeartbeatNearMs, b.taskHeartbeatIdleMs,
    +(near !== undefined), near ?? 0].join(' ')];
  for (const t of rows) lines.push([hex(t.id), t.dueMs, t.createdAt, pri.indexOf(t.priority),
    +t.done | (+t.remindedPre << 1) | (+t.remindedDue << 2)].join(' '));
  cases.push({ label, expected, lines });
}
add('no tasks', [], {}, []);
for (const delta of [-PRE-1,-PRE,-1,0,1,PRE-1,PRE,PRE+1,PRE+600000,PRE+600001]) {
  for (let f=0; f<8; ++f) {
    add('reminder boundary ' + delta + '/' + f, [task('boundary', { dueMs: now+delta,
      done: Boolean(f&1), remindedPre: Boolean(f&2), remindedDue: Boolean(f&4) })]);
  }
}
add('UTF-16 ties, not UTF-8 byte order', ['\ue000', '😀','z','\ud800','\u0000','a'].map(x => task(x)), {}, [4,5,2]);
add('first duplicate wins even when completed', [task('dup',{done:true,doneAt:now}),task('dup'),
  task('keep')], {}, [2]);
add('open, due, priority, created, ID', [task('a',{done:true,doneAt:now}),task('b',{priority:'low'}),
  task('z',{priority:'high'}),task('d',{priority:'high',createdAt:now-123456}),task('e',{dueMs:now})],
  {}, [4,3,2]);
const near = [task('near')];
for (const n of [undefined,-7,0,0.49,0.49999999999999994,0.5,1000,600000]) {
  add('legacy/omitted/explicit near window', near,
    { taskHeartbeatNearMs: 999.5, taskHeartbeatIdleMs: 10, taskHeartbeatNearWindowMs:n });
  add('empty legacy/omitted/explicit near window', [], { taskHeartbeatNearWindowMs:n });
}
let seed = 0x7a54cc01;
function pick(xs) {return xs[random(xs.length)];}
function random(n) { seed ^= seed<<13; seed ^= seed>>>17; seed ^= seed<<5; return (seed>>>0)%n; }
const ids = ['a','b','𐀀','\ud8ff','\ue000','1','01','\u0000','same','zzz','a😀'];
for (let i=0; i<1536; ++i) {
  const rows=Array.from({length:random(49)},(_,j)=>task(random(3) ? pick(ids) : 't'+j, {
    dueMs: now+pick([-PRE,0,1,PRE,PRE+600000,PRE+600001,random(20000000)-4000000]),
    createdAt:now-pick([1000,2000,random(1000000)]), priority:pick(pri), done:random(5)===0, doneAt:now,
    remindedPre:random(2)===0,remindedDue:random(2)===0,
  }));
  add('seed case ' + i, rows, {taskHeartbeatNearMs:pick([0,500,999.5,30000,30000.5]),
    taskHeartbeatIdleMs:pick([0,1000,300000,300000.5]),taskHeartbeatNearWindowMs:pick([undefined,0,1,600000,1800000])});
}
const result=spawnSync(path.resolve(binary),[],{encoding:'utf8',timeout:30000,
  input:cases.flatMap(c=>c.lines).join('\n')+'\n',maxBuffer:8*1024*1024});
if (result.error) throw result.error;
assert.equal(result.status,0,result.stderr);
const output=result.stdout.trimEnd().split(/\r?\n/);
assert.equal(output.length,cases.length);
cases.forEach((c,i)=>assert.deepEqual(output[i].split('|').map(x=>x.trim()), c.expected, c.label));
const rows=cases.reduce((sum,c)=>sum+c.lines.length-1,0);
console.log(`PASS Tasks: ${cases.length} native/JS lists, ${rows} normalized records (seed 0x7a54cc01)`);
