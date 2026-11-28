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

const store=new Float64Array(8+7*10000);
function packed(tabs,o){
 const count=o.totalMB>o.capMB&&o.capMB>0?tabs.length:0,a=store;
 a[0]=o.totalMB;a[1]=o.capMB;a[2]=o.now;a[3]=o.floorMs;a[4]=count;
 let fallback;
 for(let i=0;i<count;i++){
  const t=tabs[i],j=5+6*i;
  a[j]=+t.active|(+t.loading<<1)|(+t.lazy<<2)|(+t.sleeping<<3)|(+t.hasView<<4)|(+t.audible<<5)|
    (+t.url.startsWith('dexerion://blocked')<<6);
  let tag=0;
  if(!t.pid){
   fallback ||= new Map();const key='t:'+t.winId+':'+t.tabId;
   tag=fallback.get(key);
   if(tag===undefined){tag=fallback.size+1;fallback.set(key,tag);}
  }
  a[j+1]=tag;a[j+2]=t.pid;a[j+3]=t.memMB;a[j+4]=t.lastActive;a[j+5]=0;
 }
 cpp.packed(a);const out=5+6*count,victims=new Array(a[out+2]);
 for(let i=0;i<victims.length;i++)victims[i]=tabs[a[out+3+i]];
 return {victims,projectedMB:a[out],overMB:a[out+1]};
}
const rows=[];
for(const name of ['under','over1','over8','over32','over128','over512']) {
 const n=name==='under'?0:Number(name.slice(4)), corpus=Array.from({length:32},(_,i)=>fixture(n,name==='under'?'under':'over',i));
 for(const f of corpus){
  const ref=js.planSweep(f.tabs,f.opts),actual=cpp.plan(f.tabs,f.opts);assert.deepEqual(actual,ref);
  const q=packed(f.tabs,f.opts);assert.deepEqual(q,ref);q.victims.forEach((v,i)=>assert.strictEqual(v,ref.victims[i]));
  actual.victims.forEach((v,i)=>assert.strictEqual(v,ref.victims[i])); // same original JS snapshots
 }
 const runs=Math.max(100,Math.floor(24000/Math.max(1,n))), rounds=12, times={js:[],nativeObject:[],nativePacked:[]};
 const ring=new Array(8);let verified;
 function work(fn){
  let sum=0;
  for(let i=0;i<runs;i++){
   const f=corpus[i%32],p=fn(f.tabs,f.opts);ring[i%8]=p;
   sum=(sum+p.projectedMB+p.overMB+p.victims.length+(p.victims[0]?.pid||0))>>>0;
  }
  if(verified===undefined)verified=sum;assert.equal(verified,sum);
 }
 work(js.planSweep);work(cpp.plan);work(packed);
 for(let j=0;j<rounds;j++){
  const ids=Object.keys(times),names=ids.map((_,ix)=>ids[(Math.floor(j/2)+ix)%3]);if(j%2)names.reverse();
  for(const k of names){const f=k==='js'?js.planSweep:k==='nativeObject'?cpp.plan:packed,t=performance.now();
   work(f);times[k].push((performance.now()-t)*1e3/runs);
  }
 }
 const med=a=>{const t=[...a].sort((x,y)=>x-y);return (t[Math.floor((t.length-1)/2)]+t[Math.floor(t.length/2)])/2;};
 rows.push({scenario:name,rounds,runsPerRound:runs,checksum:verified,
   jsUs:+med(times.js).toFixed(3),nativeObjectUs:+med(times.nativeObject).toFixed(3),nativePackedUs:+med(times.nativePacked).toFixed(3)});
}
console.log(JSON.stringify({scope:'same already-collected snapshots; result retains original JS victim objects; excludes OS memory/audibility queries',rows},null,2));
