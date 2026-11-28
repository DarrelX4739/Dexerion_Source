'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { once } = require('node:events');
const { spawn, spawnSync } = require('node:child_process');
const readline = require('node:readline');
const { performance } = require('node:perf_hooks');
const {setTimeout: delay} = require('node:timers/promises');
const path = require('node:path');
const js = require(require('node:path').join(process.env.DEX_REPO_ROOT,'code/code/src/main/adaptive-power.js'));
const raw = require('./bridge.node');
const executable = path.join(__dirname,process.argv[2]==='binary'?'binary_pipe':'pipe');
const T = js.TIERS;
const opts=process.argv.slice(2);
const mean=xs=>xs.reduce((n,x)=>n+x,0)/xs.length;
function pctl(xs,p) {const t=[...xs].sort((a,b)=>a-b);const idx=(t.length-1)*p,lo=Math.floor(idx),hi=Math.ceil(idx);return t[lo]+(t[hi]-t[lo])*(idx-lo);}
function stats(xs) { return {n:xs.length,median:+pctl(xs,.5).toFixed(3),p10:+pctl(xs,.1).toFixed(3),p90:+pctl(xs,.9).toFixed(3),min:+Math.min(...xs).toFixed(3),max:+Math.max(...xs).toFixed(3)}; }
const budgets={sweepIntervalMs:60000,idleSleepMs:180000,sweepDeepIdleMs:600000};
function row(i,kind) {
 const now=1710000000000+i*1123;
 const idle=kind==='idle', quiet=idle || i%9===0, video=!idle&&i%7===0;
 const cpu=idle?0.1:((i*19)%103)+.125, tabs=i%11===0?2:1;
 const s={focused:!quiet,minimized:quiet,locked:quiet && i%2===1,onBattery:i%4===0,
   idleMs:quiet?605000+i:((i*7181)%130000),freeMemMB:i%9===0?768:5500+(i%7)*128,cpuPct:cpu,activeTabCount:tabs,
   video,webgl:!idle&&i%17===0,animation:!idle&&i%5===0,loading:!idle&&i%10===0,
   audible:video,interacting:!quiet&&(i*7181)%130000<15000};
 const previous=idle?'suspended':T[(i*3+1)%4],state={tierSince:now-(i%4?15877:499)};
 return {s,previous,now,state,b:budgets};
}
const corpora={idle:Array.from({length:128},(_,i)=>row(i,'idle')),mixed:Array.from({length:128},(_,i)=>row(i,'mixed'))};
function jsCall(r){return js.runtimePlan(r.s,r.previous,r.now,r.state,r.b);}
function objCall(r){return raw.object(r.s,r.previous,r.now,r.state,r.b);}
const buf=new Float64Array(19);
function pack(r,a) {
 const s=r.s,b=r.b; a[0]=s.focused|s.minimized<<1|s.locked<<2|s.onBattery<<3|s.video<<4|
 s.webgl<<5|s.animation<<6|s.loading<<7|s.audible<<8|s.interacting<<9;
 a[1]=s.idleMs;a[2]=s.freeMemMB;a[3]=s.cpuPct;a[4]=s.activeTabCount;a[5]=T.indexOf(r.previous);
 a[6]=r.now;a[7]=r.state.tierSince;a[8]=b.sweepIntervalMs;a[9]=b.idleSleepMs;a[10]=b.sweepDeepIdleMs;
 return a;
}
function unpack(a,i=0){return {gpuTier:T[a[i]],sweepIntervalMs:a[i+1],deepIdleSweep:Boolean(a[i+2]),
 idleSleepMs:a[i+3],hideInactiveViews:Boolean(a[i+4]),hideMinimizedViews:Boolean(a[i+5]),
 backgroundThrottling:Boolean(a[i+6]),sampleMetrics:Boolean(a[i+7])};}
function packedCall(r){raw.packed(pack(r,buf));return unpack(buf,11);}
const opt=require('./local_js_normalized.cjs');
function jsDirect(r){return opt.runtimePlan(r.s,r.previous,r.now,r.state,r.b);}
const meth={js:jsCall,normalizedJS:jsDirect,napiObject:objCall,napiPacked:packedCall};
function sum(p){return T.indexOf(p.gpuTier)+p.sweepIntervalMs+p.idleSleepMs+ +p.deepIdleSweep+
 +p.hideInactiveViews+ +p.hideMinimizedViews+ +p.backgroundThrottling+ +p.sampleMetrics;}
const holder={latest:null}; // As in the Electron host, every newly returned plan escapes.
for(const rows of Object.values(corpora))for(const r of rows) {
 assert.deepEqual(jsDirect(r),jsCall(r));assert.deepEqual(objCall(r),jsCall(r));assert.deepEqual(packedCall(r),jsCall(r));
}
function run(f,rows,n){
 let checksum=0;
 for(let i=0;i<n;i++){const p=f(rows[i%rows.length]);holder.latest=p;checksum=(checksum+sum(p))>>>0;}
 return checksum;
}
function hot(){
 const out={};
 for(const [kind,rows] of Object.entries(corpora)){
  const size=32768,expected=run(jsCall,rows,size), times=Object.fromEntries(Object.keys(meth).map(k=>[k,[]]));
  const cpuTimes=Object.fromEntries(Object.keys(meth).map(k=>[k,[]]));
  for(const f of Object.values(meth))run(f,rows,8192);
  // Balanced cyclic starts and alternating direction (all six permutations).
  const names=Object.keys(meth);
  for(let round=0;round<16;round++){
   const ids=Array.from({length:names.length},(_,i)=>names[(i+Math.floor(round/2))%names.length]);
   if(round%2) ids.reverse();
   for(const k of ids){
    const c0=opts[0]==='cpu'?process.cpuUsage():null,begin=performance.now(),s=run(meth[k],rows,size),end=performance.now(),c=c0?process.cpuUsage(c0):null;
    if(c)cpuTimes[k].push((c.user+c.system)/size);
    assert.equal(s,expected);times[k].push((end-begin)*1000/size);
   }
  }
  out[kind]={decisionsPerRound:size,rounds:16,checksum:expected,
   usPerDecision:Object.fromEntries(Object.keys(times).map(k=>[k,stats(times[k])])),
   processCpuUsPerDecision:Object.fromEntries(Object.keys(cpuTimes).filter(k=>cpuTimes[k].length).map(k=>[k,stats(cpuTimes[k])]))};
 }
 return out;
}
function line(r) {return Array.from(pack(r,new Float64Array(19)).subarray(0,11)).join(' ');}
function fromPipe(text){return text.trim().split(';').map(s=>unpack(s.split(',').map(Number)));}
async function ipcStart(){
 const ch=spawn(executable,[],{stdio:['pipe','pipe','inherit']});ch.on('error',()=>{});
 const ri=readline.createInterface({input:ch.stdout});
 let pending=null,error=null;
 ch.on('error',e=>{error=e;if(pending){pending.reject(e);pending=null;}});
 ch.on('exit',(code)=>{if(pending){pending.reject(new Error('helper exited '+code));pending=null;}});
 ri.on('line',line=>{if(!pending)throw new Error('unsolicited child output');const p=pending;pending=null;p.resolve(line);});
 async function call(rows){
  if(error)throw error;if(pending)throw new Error('concurrent not supported in paced test');
  const promise=new Promise((resolve,reject)=>{pending={resolve,reject};});
  const payload='batch '+rows.length+'\n'+rows.map(line).join('\n')+'\n';
  ch.stdin.write(payload);return fromPipe(await promise);
 }
 async function close(){const ended=once(ch,'exit');ch.stdin.end('quit\n');await ended;ri.close();}
 return {call,close,pid:ch.pid};
}
async function binaryStart(){
 const ch=spawn(executable,[],{stdio:['pipe','pipe','inherit']});
 const bufin=Buffer.alloc(8+128*11*8), recv=Buffer.alloc(128*8*8), vec=new Float64Array(bufin.buffer,bufin.byteOffset+8,128*11);
 const inputRows=Array.from({length:128},(_,i)=>vec.subarray(i*11,i*11+11));
 let pending=null,error=null,size=0;
 ch.on('error',e=>{error=e;if(pending){pending.reject(e);pending=null;}});
 ch.on('exit',code=>{if(pending){pending.reject(new Error('helper exited '+code));pending=null;}});
 ch.stdout.on('data',part=>{
  if(!pending||size+part.length>pending.target)throw Error('unexpected binary data');
  part.copy(recv,size);size+=part.length;
  if(size===pending.target){const p=pending;pending=null;p.resolve();}
 });
 async function call(rows){
  if(error)throw error;if(pending)throw new Error('concurrent not supported');
  const count=rows.length;
  bufin.writeBigUInt64LE(BigInt(count),0);
  for(let i=0;i<count;i++)pack(rows[i],inputRows[i]);
  size=0;const f=new Promise((resolve,reject)=>{pending={resolve,reject,target:count*64};});
  ch.stdin.write(bufin.subarray(0,8+count*88));await f;
  const data=new Float64Array(recv.buffer,recv.byteOffset,count*8);
  const plans=new Array(count);for(let i=0;i<count;i++)plans[i]=unpack(data,i*8);
  return plans;
 }
 async function close(){const done=once(ch,'exit');ch.stdin.end(Buffer.alloc(8));await done;}
 return {call,close,pid:ch.pid};
}

function mem(pid){
 const s=fs.readFileSync('/proc/'+pid+'/smaps_rollup','utf8');
 const kib=k=>Number(s.match(new RegExp('^'+k+':\\s+(\\d+)','m'))[1]);
 return {rssKiB:kib('Rss'),pssKiB:kib('Pss'),privateResidentKiB:kib('Private_Clean')+kib('Private_Dirty')};
}
async function ipc(){
 const binary=opts[0]==='binary',child=binary?await binaryStart():await ipcStart();const out={};
 try{
  const rows=corpora.mixed;
  for(const n of [1,8,32,128]){
   const trials=n===1?128:32, times=[], groups=Array.from({length:trials},(_,j)=>
    Array.from({length:n},(_,i)=>rows[(i+j)%rows.length]));
   for(let j=0;j<4;j++)await child.call(groups[j]);
   for(const group of groups){
    const t=performance.now(), result=await child.call(group), end=performance.now();
    for(let i=0;i<group.length;i++)assert.deepEqual(result[i],jsCall(group[i]));
    times.push((end-t)*1000/n);
   }
   out['batch'+n]={usPerDecision:stats(times),medianRoundtripUs:+(pctl(times,.5)*n).toFixed(3)};
  }
  if(binary)return {persistentBinaryPipe:out,idlePersistentHelper:mem(child.pid)};
  const cold=[];
  for(let i=0;i<24;++i){
   const r=rows[i],t=performance.now();const p=spawnSync(executable,[],{input:'batch 1\n'+line(r)+'\nquit\n',encoding:'utf8'});
   const dt=(performance.now()-t)*1000;assert.equal(p.status,0);assert.deepEqual(fromPipe(p.stdout)[0],jsCall(r));cold.push(dt);
  }
  return {persistentPipe:out,freshHelperOneDecisionUs:stats(cold),idlePersistentHelper:mem(child.pid)};
 } finally{await child.close();}
}
async function paced(){
 const ms=Number(opts[1]||1000),n=Number(opts[2]||12), log=opts[3];
 assert.ok(ms>=10&&ms<=600000&&n>=4&&n<=60);
 const child=await ipcStart(), rows=corpora.mixed;
 const single=opts[0]==='paced-single',start=Number(opts[3]||0);
 if(single)assert.ok(Number.isInteger(start)&&start>=0&&start<4);
 const records=[];try{
  // Integration can be idle between occasional calls. Warm both native/JS paths,
  // then clock each single call after the requested quiet interval.
  for(const f of Object.values(meth))run(f,rows,2048);await child.call([rows[0]]);
  for(let i=0;i<n;i++){
   const r=i%2?rows[(i*19)%rows.length]:corpora.idle[(i*19)%rows.length];
   const expected=jsCall(r), allNames=['js','napiObject','napiPacked','pipe'];
   const names=single?[allNames[(i+start)%4]]:allNames.map((_,j)=>allNames[(Math.floor(i/2)+j)%4]);if(!single&&i%2)names.reverse();
   await delay(ms);
   const us={}, outputs={};
   for(const k of names){
    const t=process.hrtime.bigint();
    const p=k==='pipe'?(await child.call([r]))[0]:meth[k](r);
    us[k]=Number(process.hrtime.bigint()-t)/1000;
    holder.latest=p;outputs[k]=p;
   }
   for(const p of Object.values(outputs))assert.deepEqual(p,expected);
   records.push({order:names,us});
   if(log&&!single)fs.appendFileSync(log,JSON.stringify({tick:i+1,elapsedSec:(i+1)*ms/1000,us})+'\n');
  }
  if(single)return {intervalMs:ms,start,records};
  return {intervalMs:ms,callsPerMethod:n,usPerDecision:Object.fromEntries(
   ['js','napiObject','napiPacked','pipe'].map(k=>[k,stats(records.map(x=>x.us[k]))])),idleHelper:mem(child.pid)};
 } finally{await child.close();}
}
(async()=>{
 const mode=opts[0]||'hot';
 const results=['hot','cpu'].includes(mode)?hot():['ipc','binary'].includes(mode)?await ipc():await paced();
 console.log(JSON.stringify({mode,versions:{electron:process.versions.electron,node:process.versions.node,
 v8:process.versions.v8},cpu:require('os').cpus()[0].model,results},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
