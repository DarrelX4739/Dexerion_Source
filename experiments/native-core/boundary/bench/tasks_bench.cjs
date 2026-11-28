'use strict';
const assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const js=require(require('node:path').join(process.env.DEX_REPO_ROOT,'code/code/src/main/tasks.js')),n=require('./tasks.node');
const PRI={high:0,medium:1,low:2},priorities=Object.keys(PRI),now=1710000000000;
const make=(count,seed)=>{
 const raw=Array.from({length:count},(_,j)=>{
  const mix=(j*13099+seed*1091)%997;
  return {id:((j%17===0?'😀':j%19===0?'\ue000':'t')+j),title:'Disposable task '+j,notes:mix%7?'':'synthetic notes',
   done:mix%7===0,doneAt:now-9999,dueMs:now+(mix%18)*1e5,createdAt:now-(mix%5)*1000,
   remindedPre:!!(mix&1),remindedDue:!!(mix&2),hasTime:!!(mix&4),priority:priorities[mix%3]};
 });
 return js.sanitizeList(raw); // actual ensureTasks() boundary, outside timing
};
function compare(a,b){return a.done!==b.done?(a.done?1:-1):a.dueMs!==b.dueMs?a.dueMs-b.dueMs:
 a.priority!==b.priority?PRI[a.priority]-PRI[b.priority]:a.createdAt!==b.createdAt?a.createdAt-b.createdAt:a.id<b.id?-1:1;}
function direct(rows){return rows.map(t=>({...t})).sort(compare);}
function original(rows){return js.sortTasks(rows);}
function native(rows){return n.sort(js.sanitizeList(rows));} // detach fresh rows, preserve cache freezing semantics
const methods={original,direct,native};
const out=[];
for(const size of [0,3,20,100,500,2000]){
 const corp=Array.from({length:8},(_,s)=>make(size,s)), runs=Math.max(12,Math.floor(12000/(1+size))),
 latency=Object.fromEntries(Object.keys(methods).map(k=>[k,[]]));
 for(const rows of corp){
  const expected=original(rows);
  for(const f of Object.values(methods)){
   const actual=f(rows);assert.deepEqual(actual,expected);
   if(actual.length)assert.notStrictEqual(actual[0],rows.find(x=>x.id===actual[0].id));
  }
 }
 const last={snapshot:null};let expected;
 function run(fn){let checksum=0;
  for(let i=0;i<runs;++i){const q=fn(corp[i%8]);last.snapshot=q;
   checksum=(checksum+q.length+(q[0]?.dueMs||0)+(q.at(-1)?.id.length||0))>>>0;}
  if(expected===undefined)expected=checksum;assert.equal(checksum,expected);}
 for(const f of Object.values(methods))run(f);
 for(let r=0;r<12;r++){
  const ids=Object.keys(methods), order=ids.map((_,i)=>ids[(i+Math.floor(r/2))%3]);if(r%2)order.reverse();
  for(const k of order){const t=performance.now();run(methods[k]);latency[k].push((performance.now()-t)*1000/runs);}
 }
 const med=a=>[...a].sort((x,y)=>x-y)[Math.floor(a.length/2)];
 out.push({records:size,runsPerRound:runs,medianUs:Object.fromEntries(Object.keys(latency).map(k=>[k,+med(latency[k]).toFixed(3)]))});
}
console.log(JSON.stringify({scope:'tasksPublic cache-miss sort after first ensureTasks; retained detached rows; excludes common freeze, IPC, persistence and store normalization already done by caller',out},null,2));
