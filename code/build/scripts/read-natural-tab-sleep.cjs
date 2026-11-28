'use strict';
const assert=require('node:assert/strict');
const {verifiedNativeTree}=require('./measure-sample-guard.cjs');
const safe=n=>Number.isSafeInteger(n)&&n>=0;
const recordedBirth=s=>typeof s==='string'&&s.endsWith('Z')&&Number.isFinite(Date.parse(s));
const renderer=record=>typeof record?.cmdline==='string'&&/(?:^|\s)--type=renderer(?:\s|$)/.test(record.cmdline);
const forbidden=/(?:^|\s)--(?:no-sandbox|disable-web-security|disable-site-isolation-trials)(?:[=\s]|$)/i;
const procKey=p=>[p.pid,p.startedUtc];

function snapshot(raw,{processId,profileDir},from,end){
  assert(safe(from)&&safe(end)&&from<=end&&Array.isArray(raw?.processes)&&raw.count===raw.processes.length,
    'invalid snapshot interval or incomplete inventory');
  const actualAt=Date.parse(raw.capturedAt);
  assert(Number.isFinite(actualAt)&&actualAt>=from-100&&actualAt<=end+100,'OS sample timestamp outside capture');
  const all=new Map();
  for(const row of raw.processes) {
    assert(safe(row.pid)&&!all.has(row.pid),'duplicate/invalid inventory PID');
    all.set(row.pid,row);
  }
  const tree=verifiedNativeTree(raw.processes,processId,root=>root.name.toLowerCase()==='dexerion.exe'&&
    root.cmdline?.toLowerCase().includes(profileDir.toLowerCase())&&!forbidden.test(root.cmdline));
  assert(!tree.staleParentReferences&&!tree.unknownParentReferences,'uncertain native process tree');
  assert(tree.rows.every(r=>recordedBirth(r.startedUtc)&&!forbidden.test(r.cmdline||'')),'unverified process generation or policy-changing command line');
  return {start:from,end,root:procKey(tree.rows[0]),all,tree:new Map(tree.rows.map(r=>[r.pid,r]))};
}
function choosePre(samples,firstSleepAt){
  const ready=samples.filter(s=>s.end<firstSleepAt).sort((a,b)=>b.end-a.end);
  assert(ready.length>=2&&firstSleepAt-ready[0].end<=45000,
    'no two pre-transition OS snapshots, or closest one is older than 45 seconds');
  return ready.slice(0,2);
}
function phase(before,after,groups,event){
  assert(before?.length===2&&after?.length===2,'two observations on each side required');
  assert(safe(event?.firstSleepAt)&&safe(event.lastSleepAt)&&before[0].end>=before[1].end&&
    before[0].end<event.firstSleepAt&&event.firstSleepAt<=event.lastSleepAt&&event.lastSleepAt<after[0].start&&
    after[0].end<after[1].start,'overlapping, stale or unordered measurement phases');
  const owned=new Map();
  for(const phase of [...before,...after])assert.deepEqual(phase.root,before[0].root,'app root generation changed');
  const {foreground,shared,dedicated}=groups;
  assert(foreground===shared&&safe(foreground)&&foreground>0&&dedicated.length===2&&
    new Set([foreground,...dedicated]).size===3&&dedicated.every(x=>safe(x)&&x>0),'fixture renderer role overlap not proven');
  for(const pid of [foreground,...dedicated]){
    const gen=before[0].tree.get(pid);
    assert(renderer(gen)&&recordedBirth(gen.startedUtc),'exact target renderer not owned before transition');
    assert(before.every(r=>{
      const p=r.tree.get(pid);
      return renderer(p)&&p.startedUtc===gen.startedUtc&&safe(p.privateWsBytes)&&p.privateWsBytes>0;
    }),'target renderer generation/private resident unverified before transition');
    owned.set(pid,gen);
  }
  const control=owned.get(foreground);
  assert(after.every(x=>renderer(x.tree.get(foreground))&&x.tree.get(foreground).startedUtc===control.startedUtc&&
    safe(x.tree.get(foreground).privateWsBytes)&&x.tree.get(foreground).privateWsBytes>0),
  'shared foreground renderer did not measurably remain alive');
  const result=dedicated.map((pid,i)=>{
    const gen=owned.get(pid);
    assert(after.every(s=>!s.all.has(pid)||recordedBirth(s.all.get(pid).startedUtc)&&s.all.get(pid).startedUtc===gen.startedUtc),
      'PID reuse or uncertain post-transition identity');
    const remaining=after.map(s=>s.all.get(pid));
    const exited=remaining.every(x=>!x);
    assert(exited||remaining.every(x=>renderer(x)&&safe(x.privateWsBytes)&&x.privateWsBytes>0),
      'mixed/uncertain renderer exit or post-transition counter unavailable');
    assert(exited||after.every(s=>s.tree.has(pid)),'persistent renderer ancestry not verified');
    return {slot:i,exited,privateResidentBeforeBytes:gen.privateWsBytes,
      priorPrivateResidentBytes:before[1].tree.get(pid).privateWsBytes,
      privateResidentAfterBytes:exited?null:remaining.at(-1).privateWsBytes};
  });
  const treeBytes=s=>{
    const values=[...s.tree.values()].map(r=>r.privateWsBytes);
    return values.every(safe)?values.reduce((n,x)=>n+x,0):null;
  };
  return {dedicated:result,retiredPriorPrivateResidentBytes:result.filter(r=>r.exited)
    .reduce((n,r)=>n+r.privateResidentBeforeBytes,0),
    retainedSharedControl:{privateResidentBeforeBytes:control.privateWsBytes,
      privateResidentAfterBytes:after.at(-1).tree.get(foreground).privateWsBytes},
    verifiedTreePrivateResidentBeforeBytes:treeBytes(before[0]),verifiedTreePrivateResidentAfterBytes:treeBytes(after.at(-1))};
}
function transition(events,createdBy,active,watched,windowMin,windowMax){
  assert(watched.length===3&&new Set([active,...watched]).size===4&&Object.keys(createdBy).length===3,
    'exact three distinct disposable background tabs required');
  assert(Array.isArray(events)&&events.length>=1&&events.length<=12&&events.every((e,i)=>
    safe(e.at)&&(!i||e.at>=events[i-1].at)&&Array.isArray(e.tabs)&&e.tabs.length===3&&
    new Set(e.tabs.map(t=>t.id)).size===3&&e.tabs.every(t=>watched.includes(t.id))&&e.visible===true&&
    e.active===active&&e.notice===false),'natural transition events changed foreground, notice, inventory or order');
  const last=events.at(-1);
  assert(last&&last.visible===true&&last.active===active&&last.notice===false&&last.tabs.length===3&&
    watched.every(id=>last.tabs.some(t=>t.id===id&&t.sleeping&&!t.loading)),
    'natural background transition missing, obscured, over-cap notice, or inventory incomplete');
  let earliest=Infinity;
  const bySlot=watched.map(id=>{
    const born=createdBy[id];
    assert(safe(born),'background creation bracket unavailable');
    const firstIndex=events.findIndex(e=>e.tabs.some(t=>t.id===id&&t.sleeping&&!t.loading));
    const first=events[firstIndex];
    assert(firstIndex>=0&&events.slice(firstIndex).every(e=>e.tabs.some(t=>t.id===id&&t.sleeping&&!t.loading))&&
      first.at-born>=windowMin&&first.at-born<=windowMax,
      'natural background transition outside default window');
    earliest=Math.min(earliest,first.at);
    return first.at-born;
  });
  return {firstSleepAt:earliest,lastSleepAt:last.at,afterCreationCallbackMs:bySlot};
}

module.exports={snapshot,choosePre,phase,transition};
