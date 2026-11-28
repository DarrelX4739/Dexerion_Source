'use strict';
const assert=require('node:assert/strict');
const {verifiedNativeTree}=require('./measure-sample-guard.cjs');
const CHECKPOINTS=Object.freeze([270000,286000]);
const validBytes=n=>Number.isSafeInteger(n)&&n>=0;
const validBirth=v=>typeof v==='string'&&v.endsWith('Z')&&Number.isFinite(Date.parse(v));
const rootUnsafe=/(?:^|\s)--(?:no-sandbox|disable-web-security|disable-site-isolation-trials)(?:[=\s]|$)/i;
const childUnsafe=/(?:^|\s)--(?:disable-web-security|disable-site-isolation-trials)(?:[=\s]|$)/i;
const uniqueValues=xs=>typeof xs==='object'&&Array.isArray(xs)&&xs.length===new Set(xs).size;
function readOwnedSnapshot(raw,root,processName,profileDir,at,end){
  assert(validBytes(at)&&validBytes(end)&&at<=end&&Array.isArray(raw?.processes)&&raw.count===raw.processes.length,
    'invalid Windows process snapshot');
  assert(uniqueValues(raw.processes.map(r=>r.pid))&&raw.processes.every(r=>validBytes(r.pid)),
    'duplicate or invalid PID in Windows process snapshot');
  const sampledAt=Date.parse(raw.capturedAt);
  assert(Number.isFinite(sampledAt)&&sampledAt>=at-100&&sampledAt<=end+100,
    'Windows inventory sample time lies outside capture');
  const probe=verifiedNativeTree(raw.processes,root,p=>typeof p.name==='string'&&
    p.name.toLowerCase()===processName&&p.cmdline?.toLowerCase().includes(profileDir.toLowerCase())&&!rootUnsafe.test(p.cmdline));
  assert(!probe.staleParentReferences&&!probe.unknownParentReferences,'uncertain Windows process ancestry');
  assert(probe.rows.every(r=>validBirth(r.startedUtc))&&probe.rows.slice(1).every(r=>!childUnsafe.test(r.cmdline??'')),
    'missing process birth or unexpected policy-disabling child switch');
  const stableRoot=probe.rows[0];
  const complete=probe.rows.every(r=>validBytes(r.privateWsBytes))&&stableRoot.privateWsBytes>0;
  const privateBytes=complete?probe.rows.reduce((a,r)=>a+r.privateWsBytes,0):null;
  assert(privateBytes===null||validBytes(privateBytes),'unsafe private working set total');
  return {sampledAt,at,end,root:[stableRoot.pid,stableRoot.startedUtc],
    privateBytes,processCount:probe.rows.length,identities:probe.rows.map(r=>[r.pid,r.startedUtc])};
}
function memoryArm(samples,start){
  assert(validBytes(start)&&samples.length===CHECKPOINTS.length,'missing planned quiet checkpoint');
  const base=samples[0];
  const result=samples.map((snap,i)=>{
    assert.deepEqual(snap.root,base.root,'browser root process generation changed while idle');
    const aim=CHECKPOINTS[i];
    assert(snap.at>=start+aim&&snap.at<=start+aim+2500&&snap.end<=start+aim+12500&&
      (!i||samples[i-1].end<snap.at),'quiet checkpoint mismatched, raced or over time bound');
    assert(snap.privateBytes===null||validBytes(snap.privateBytes)&&snap.privateBytes>0,'invalid measured working set total');
    return {plannedElapsedMs:aim,sampledElapsedMs:snap.sampledAt-start,privateResidentBytes:snap.privateBytes,
      captureElapsedMs:snap.end-snap.at,ownedProcesses:snap.processCount};
  });
  return result;
}
function memoryPair(edge,dex){
  assert(Array.isArray(edge)&&Array.isArray(dex)&&edge.length===CHECKPOINTS.length&&dex.length===edge.length,
    'both original checkpoints required; no silent dropping');
  return CHECKPOINTS.map((aim,i)=>{
    const a=edge[i],b=dex[i];
    assert(a.plannedElapsedMs===aim&&b.plannedElapsedMs===aim&&Math.abs(a.sampledElapsedMs-b.sampledElapsedMs)<=4000,
      'idle sample times could not be matched within 4 seconds');
    const okay=validBytes(a.privateResidentBytes)&&a.privateResidentBytes>0&&validBytes(b.privateResidentBytes)&&b.privateResidentBytes>0;
    return {plannedElapsedMs:aim,edgePrivateResidentBytes:a.privateResidentBytes,dexerionPrivateResidentBytes:b.privateResidentBytes,
      dexerionMinusEdgeBytes:okay?b.privateResidentBytes-a.privateResidentBytes:null};
  });
}
function wakeEvidence(previous,read,documents,sentinel,storedCookie){
  assert(previous&&read&&typeof read.token==='string'&&Number.isFinite(read.origin)&&read.visible===true&&
    typeof read.textValue==='string'&&(read.storage===null||typeof read.storage==='string')&&
    Array.isArray(documents)&&documents.length>=1&&typeof storedCookie==='boolean','wake document/visibility/session evidence missing');
  assert(documents[0].token===previous.token&&documents[0].origin===previous.origin,
    'wrong initial pre-existing document');
  const retained=documents.length===1&&read.token===previous.token&&read.origin===previous.origin;
  const reloaded=documents.length===2&&documents[1].token===read.token&&documents[1].origin===read.origin&&
    read.token!==previous.token&&read.origin>previous.origin;
  assert(retained||reloaded,'actual continuation or one bona fide HTTP reload not proved');
  return {document:retained?'same live document':'reloaded replacement document',navigationRequests:documents.length-1,
    persistentCookie:storedCookie,persistentLocalStorage:read.storage===sentinel,
    unsavedFixtureText:read.textValue===sentinel,confirmedVisible:true};
}
function describeParity(edge,dex){
  if(!edge||!dex)return 'not determined: wake proof incomplete';
  return ['document','navigationRequests','persistentCookie','persistentLocalStorage','unsavedFixtureText'].every(k=>edge[k]===dex[k])
    ?'same observed fixture outcomes only; no general feature-parity claim':'wake behavior differs in this fixture; memory measurements do not represent equivalent behavior';
}
module.exports={CHECKPOINTS,readOwnedSnapshot,memoryArm,memoryPair,wakeEvidence,describeParity};
