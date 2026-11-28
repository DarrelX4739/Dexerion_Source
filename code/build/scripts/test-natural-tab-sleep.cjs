'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {snapshot,choosePre,phase,transition}=require('./read-natural-tab-sleep.cjs');
const birth=(millis)=>new Date(millis).toISOString(), base=Date.parse('2026-11-28T09:00:00Z');
const launch={processId:90,profileDir:'C:\\safe\\dex-native-dexerion-test-fixture'};
const renderer=(pid,privateWsBytes,born=39,ancestor=90)=>({pid,ppid:ancestor,name:'Dexerion.exe',
  startedUtc:birth(base+born),cmdline:'Dexerion.exe --type=renderer',privateWsBytes});
const root={pid:launch.processId,ppid:1,name:'Dexerion.exe',startedUtc:birth(base+1),
  cmdline:'Dexerion.exe --user-data-dir='+launch.profileDir,privateWsBytes:10000};
const scope=(privateResident=13400)=>[root,renderer(111,privateResident),renderer(112,20200),renderer(113,32900)];
const observe=(rows,start,end)=>snapshot({capturedAt:birth(base+start+1),count:rows.length,
  processes:rows},launch,base+start,base+end);
const pre1=observe(scope(),120000,121000),pre2=observe(scope(13425),160000,161000);
const cleanLater=observe([root,renderer(111,13900)],180010,181000);
const cleanLast=observe([root,renderer(111,15200)],183000,184000);
const event={firstSleepAt:base+180001,lastSleepAt:base+180002};
const roles={foreground:111,shared:111,dedicated:[112,113]};
test('admits two exact observations, scoped PID exits and a still-resident shared process',()=>{
  const observed=phase(choosePre([pre1,pre2],event.firstSleepAt),[cleanLater,cleanLast],roles,event);
  assert.deepEqual(observed,{dedicated:[
    {slot:0,exited:true,privateResidentBeforeBytes:20200,priorPrivateResidentBytes:20200,privateResidentAfterBytes:null},
    {slot:1,exited:true,privateResidentBeforeBytes:32900,priorPrivateResidentBytes:32900,privateResidentAfterBytes:null},
  ],retiredPriorPrivateResidentBytes:53100,retainedSharedControl:{privateResidentBeforeBytes:13425,privateResidentAfterBytes:15200},
  verifiedTreePrivateResidentBeforeBytes:76525,verifiedTreePrivateResidentAfterBytes:25200});
  assert(!JSON.stringify(observed).includes(launch.profileDir));
});
test('a still-present exact renderer is not credited to retired memory',()=>{
  const later=observe([root,renderer(111,13900),renderer(112,1200)],180010,181000);
  const last=observe([root,renderer(111,15200),renderer(112,900)],183000,184000);
  const result=phase([pre2,pre1],[later,last],roles,event);
  assert.equal(result.dedicated[0].exited,false);
  assert.equal(result.dedicated[0].privateResidentAfterBytes,900);
  assert.equal(result.retiredPriorPrivateResidentBytes,32900);
  assert.throws(()=>phase([pre2,pre1],[later,cleanLast],roles,event),/mixed\/uncertain/);
  const outside=observe([root,renderer(111,13900),renderer(112,1200,39,22)],180010,181000);
  const outsideAgain=observe([root,renderer(111,15200),renderer(112,900,39,22)],183000,184000);
  assert.throws(()=>phase([pre2,pre1],[outside,outsideAgain],roles,event),/ancestry not verified/);
});
test('rejects partial/raced sampling, renderer reuse, role overlap, stale ownership and counter gaps',()=>{
  const reused=observe([root,renderer(111,13900),renderer(112,1200,179999,770)],180010,181000);
  const missing=observe(scope().map(p=>p.pid===113?{...p,privateWsBytes:null}:p),156000,157000);
  const stale=observe(scope().map(p=>p.pid===113?{...p,startedUtc:birth(base+175)}:p),158000,159000);
  const badCtrl=observe([root,renderer(111,0)],183000,184000);
  assert.throws(()=>phase([pre2,pre1],[reused,cleanLast],roles,event),/PID reuse/);
  assert.throws(()=>phase([pre2,missing],[cleanLater,cleanLast],roles,event),/generation\/private resident/);
  assert.throws(()=>phase([pre2,stale],[cleanLater,cleanLast],roles,event),/generation\/private resident/);
  assert.throws(()=>phase([pre2,pre1],[cleanLater,badCtrl],roles,event),/did not measurably remain/);
  assert.throws(()=>phase([pre2,pre1],[cleanLater,cleanLast],{...roles,shared:112},event),/role overlap/);
  assert.throws(()=>phase([pre2,pre1],[cleanLater,cleanLast],roles,{...event,lastSleepAt:cleanLater.start}),/overlapping/);
  assert.throws(()=>phase([pre2,pre1],[cleanLater,cleanLast],roles,{...event,firstSleepAt:pre2.end}),/overlapping/);
  assert.throws(()=>choosePre([pre1,pre2],base+230000),/closest one/);
  assert.throws(()=>choosePre([pre1,pre2],base+161000),/no two/);
  assert.throws(()=>observe([...scope(),renderer(111,50)],140000,141000),/duplicate/);
  assert.throws(()=>observe([...scope(),renderer(19,100,0)],140000,141000),/uncertain native process tree/);
  assert.throws(()=>observe(scope().map(p=>p.pid===112?{...p,cmdline:p.cmdline+' --no-sandbox'}:p),140000,141000),/policy-changing/);
  const missingTreeScalar=observe([...scope(),renderer(15,null)],162000,163000);
  assert.equal(phase([missingTreeScalar,pre2],[cleanLater,cleanLast],roles,event).verifiedTreePrivateResidentBeforeBytes,null);
});
test('uses existing sleep timing and refuses early, synthetic agings or changing foreground/notice/inventory',()=>{
  const tabs=['tb','tc','td'],created=Object.fromEntries(tabs.map((x,i)=>[x,base+900+i]));
  const record=(t,sleeping,active='ta',notice=false)=>({at:base+t,visible:true,active,notice,
    tabs:tabs.map(id=>({id,sleeping:sleeping.includes(id),loading:false}))});
  const events=[record(240000,['tb']),record(240200,tabs)];
  const measure=es=>transition(es,created,'ta',tabs,180000,300000);
  assert.deepEqual(measure(events),{firstSleepAt:base+240000,lastSleepAt:base+240200,afterCreationCallbackMs:[239100,239299,239298]});
  assert.throws(()=>measure([record(180500,tabs)]),/outside default/);
  assert.throws(()=>measure([record(301000+1000,tabs)]),/outside default/);
  assert.throws(()=>measure([record(230000,tabs,'early'),record(240100,tabs)]),/changed foreground/);
  assert.throws(()=>measure([record(230000,tabs,'ta',true)]),/notice/);
  assert.throws(()=>measure([{...record(220000,tabs),visible:false}]),/foreground/);
  assert.throws(()=>measure([{...record(220000,tabs),tabs:record(220000,tabs).tabs.slice(1)}]),/inventory/);
  assert.throws(()=>measure([record(238000,['tb']),record(237000,tabs)]),/order/);
  assert.throws(()=>measure([record(238000,['tb']),record(239000,['tc']),record(240000,tabs)]),/outside default/);
});
