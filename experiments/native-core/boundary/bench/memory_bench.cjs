'use strict';
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const js=require(require('node:path').join(process.env.DEX_REPO_ROOT,'code/code/src/main/memsaver.js')),cpp=require('./memory.node');
const fixture=(count,kind,seed)=>{
 const now=1710000000000,capMB=2048, totalMB=kind==='under'?1800:2600+(seed%10)*112;
 const floorMs=60000, tabs=Array.from({length:kind==='under'?0:count},(_,i)=>{
  const k=i+seed, duplicate=i%5===0&&i>0;
  let pid=duplicate?100+i-1:100+i;if(k%13===0)pid=0;
  return {winId:1+i%3,tabId:'t'+i,pid,memMB:pid?100+(pid%8)*30:0,
   active:i===0,loading:k%13===0,lazy:k%17===0,sleeping:k%23===0,hasView:k%19!==0,
   audible:k%11===0,lastActive:now-(k%10)*20000,url:k%19===0?'dexerion://blocked/focus':'https://example.test/p/'+i};
 });
 return {tabs,opts:{totalMB,capMB,now,floorMs}};
};
const rows=[];
for(const name of ['under','over1','over8','over32','over128','over512']) {
 const n=name==='under'?0:Number(name.slice(4)), corpus=Array.from({length:32},(_,i)=>fixture(n,name==='under'?'under':'over',i));
 for(const f of corpus){
  const ref=js.planSweep(f.tabs,f.opts),actual=cpp.plan(f.tabs,f.opts);assert.deepEqual(actual,ref);
  actual.victims.forEach((v,i)=>assert.strictEqual(v,ref.victims[i])); // same original JS snapshots
 }
 const runs=Math.max(100,Math.floor(24000/Math.max(1,n))), rounds=8, times={js:[],nativeObject:[]};
 const ring=new Array(8);let verified;
 function work(fn){
  let sum=0;
  for(let i=0;i<runs;i++){
   const f=corpus[i%32],p=fn(f.tabs,f.opts);ring[i%8]=p;
   sum=(sum+p.projectedMB+p.overMB+p.victims.length+(p.victims[0]?.pid||0))>>>0;
  }
  if(verified===undefined)verified=sum;assert.equal(verified,sum);
 }
 work(js.planSweep);work(cpp.plan);
 for(let j=0;j<rounds;j++){
  const names=j%2?['nativeObject','js']:['js','nativeObject'];
  for(const k of names){const f=k==='js'?js.planSweep:cpp.plan,t=performance.now();
   work(f);times[k].push((performance.now()-t)*1e3/runs);
  }
 }
 const med=a=>[...a].sort((x,y)=>x-y)[Math.floor(a.length/2)];
 rows.push({scenario:name,rounds,runsPerRound:runs,checksum:verified,
   jsUs:+med(times.js).toFixed(3),nativeObjectUs:+med(times.nativeObject).toFixed(3)});
}
console.log(JSON.stringify({scope:'same already-collected snapshots; result retains original JS victim objects; excludes OS memory/audibility queries',rows},null,2));
