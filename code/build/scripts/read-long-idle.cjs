'use strict';
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {setTimeout:idleWait}=require('node:timers/promises');
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
const MAX_DRIFT_MS=60;
const systemClock={wall:()=>Date.now(),mono:()=>performance.now(),wait:idleWait};
function observeQuietClock(start,clock=systemClock) {
  assert(validBytes(start?.wall)&&Number.isFinite(start.mono)&&start.mono>=0,'invalid quiet timer anchor');
  const wallAt=clock.wall(),monotonicAt=clock.mono();
  assert(validBytes(wallAt)&&Number.isFinite(monotonicAt)&&monotonicAt>=start.mono,
    'quiet monotonic clock went backward or is unavailable');
  const wallElapsedMs=wallAt-start.wall,monotonicElapsedMs=monotonicAt-start.mono;
  assert(Math.abs(wallElapsedMs-monotonicElapsedMs)<=MAX_DRIFT_MS,'host wall clock stepped relative to monotonic quiet timer');
  return {wallAt,wallElapsedMs,monotonicElapsedMs};
}
async function waitForQuietCheckpoint(start,checkpoint,clock=systemClock){
  assert(validBytes(checkpoint),'invalid quiet checkpoint');
  for(let tries=0;tries<=16;tries++){
    const c=observeQuietClock(start,clock);
    const remain=Math.max(checkpoint-c.wallElapsedMs,checkpoint-c.monotonicElapsedMs);
    if(remain<=0)return {...c,timerWaits:tries};
    if(tries===16)break;
    // Node timers may resolve before the Date/QPC clock crosses the intended
    // time. Never call the provider based only on the first timer firing.
    await clock.wait(Math.max(1,Math.ceil(remain)));
  }
  throw new Error('quiet timer did not cross both clocks within bounded rechecks');
}
const displayOffset=n=>Number.isFinite(n)&&Math.abs(n)<=60000?Math.round(n*1000)/1000:null;
function quietTimingEvidence(sample,origin,prior){
  const {requestedAt,receivedAt,providerMinUtcMs:lo,providerMaxUtcMs:hi}=sample;
  const issues=[];
  if(!validBytes(requestedAt)||!validBytes(receivedAt)||!Number.isFinite(lo)||!Number.isFinite(hi))
    issues.push('invalid_clock_field');
  if(requestedAt<origin)issues.push('request_before_target');
  if(requestedAt>origin+2500)issues.push('request_after_bound');
  if(receivedAt<requestedAt)issues.push('reply_before_request');
  if(receivedAt-requestedAt>5000)issues.push('reply_over_budget');
  if(lo<requestedAt-2)issues.push('provider_before_request');
  if(hi>receivedAt+2)issues.push('provider_after_reply');
  if(lo>hi)issues.push('provider_interval_reversed');
  if(hi-lo>90)issues.push('provider_interval_too_wide');
  if(lo<origin-2)issues.push('provider_before_target');
  if(hi>origin+2500)issues.push('provider_after_target_bound');
  if(prior&&!(prior.receivedAt<requestedAt))issues.push('overlapping_checkpoints');
  // Bound diagnostic data, and never leak absolute times, raw QPC, identities
  // or memory numbers from a rejected trial.
  return {requestOffsetMs:displayOffset(requestedAt-origin),
    replyOffsetMs:displayOffset(receivedAt-origin),providerOffsetMs:[displayOffset(lo-origin),displayOffset(hi-origin)],
    collectorRoundTripMs:displayOffset(receivedAt-requestedAt),issues};
}
const validQpc=s=>s&&typeof s.rootBirth==='bigint'&&s.rootBirth>0n&&
  typeof s.clockFrequency==='bigint'&&s.clockFrequency>0n&&
  typeof s.minProviderQpc==='bigint'&&typeof s.maxProviderQpc==='bigint'&&
  s.minProviderQpc>0n&&s.maxProviderQpc>=s.minProviderQpc;
function memoryArm(samples,start,warmed){
  assert(validBytes(start)&&samples.length===CHECKPOINTS.length&&validQpc(warmed)&&
    warmed.providerMaxUtcMs<=start,'named warmup or planned quiet checkpoint missing');
  const retained=new Map();
  const remember=sample=>{
    assert(sample.scopeOfGenerations instanceof Map&&sample.scopeOfGenerations.size>=2,
      'owned PID generation set missing');
    for(const [pid,row] of sample.scopeOfGenerations){
      assert(Number.isSafeInteger(pid)&&pid>0&&typeof row.birth==='bigint'&&row.birth>0n&&
        (!retained.has(pid)||retained.get(pid)===row.birth),'owned PID reused between phases');
      retained.set(pid,row.birth);
    }
  };
  remember(warmed);
  return samples.map((s,i)=>{
    const prev=i?samples[i-1]:warmed;
    assert(validQpc(s)&&s.rootBirth===warmed.rootBirth&&s.clockFrequency===warmed.clockFrequency&&
      prev.maxProviderQpc<s.minProviderQpc,'stale provider tick, clock mismatch or browser root process generation changed');
    remember(s);
    const aim=CHECKPOINTS[i],origin=start+aim;
    const {requestedAt,receivedAt,providerMinUtcMs:lo,providerMaxUtcMs:hi,privateResidentBytes}=s;
    const diagnosis=quietTimingEvidence(s,origin,i?samples[i-1]:null);
    assert(diagnosis.issues.length===0,'quiet provider checkpoint '+aim+' rejected: '+diagnosis.issues.join(','));
    assert(validBytes(privateResidentBytes)&&privateResidentBytes>0,'invalid measured working set total');
    return {plannedElapsedMs:aim,providerWindowElapsedMs:[lo-start,hi-start],privateResidentBytes,
      collectorRoundTripMs:receivedAt-requestedAt,ownedProcesses:s.scopeOfGenerations.size};
  });
}
function memoryPair(edge,dex){
  assert(Array.isArray(edge)&&Array.isArray(dex)&&edge.length===CHECKPOINTS.length&&dex.length===edge.length,
    'both original checkpoints required; no silent dropping');
  return CHECKPOINTS.map((aim,i)=>{
    const a=edge[i],b=dex[i],e=a.providerWindowElapsedMs,d=b.providerWindowElapsedMs;
    assert(a.plannedElapsedMs===aim&&b.plannedElapsedMs===aim&&[e,d].every(w=>
      Array.isArray(w)&&w.length===2&&w.every(Number.isFinite)&&w[0]<=w[1]&&
      w[0]>=aim-2&&w[1]<=aim+2500&&w[1]-w[0]<=90),'matched quiet provider windows unavailable');
    const largestPossibleLag=Math.max(Math.abs(e[0]-d[1]),Math.abs(e[1]-d[0]));
    assert(largestPossibleLag<=4000,'native acquisition intervals could not be matched within 4 seconds');
    const okay=validBytes(a.privateResidentBytes)&&a.privateResidentBytes>0&&validBytes(b.privateResidentBytes)&&b.privateResidentBytes>0;
    return {plannedElapsedMs:aim,edgePrivateResidentBytes:a.privateResidentBytes,dexerionPrivateResidentBytes:b.privateResidentBytes,
      edgeProviderWindowElapsedMs:e,dexerionProviderWindowElapsedMs:d,
      dexerionMinusEdgeBytes:okay?b.privateResidentBytes-a.privateResidentBytes:null};
  });
}
// Cleanup only. CIM's timestamp may round slightly differently from native
// FILETIME (qualified collector checks within 2 ms independently), and a
// missing CIM creation on a known PID blocks cleanup rather than ignoring it.
function possibleNativeGeneration(row,observed){
  const before=observed.get(row.pid);
  if(!before)return false;
  const ms=typeof row.startedUtc==='string'?Date.parse(row.startedUtc):NaN;
  if(!Number.isFinite(ms))return true;
  const lowResolution=BigInt(ms)*10000n+116444736000000000n;
  return before.some(tick=>tick>=lowResolution-20000n&&tick<=lowResolution+20000n);
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
function wakeComparison(edge,dex){
  const full=r=>r&&r.confirmedVisible===true&&
    ((r.document==='same live document'&&r.navigationRequests===0)||
      (r.document==='reloaded replacement document'&&r.navigationRequests===1))&&
    ['persistentCookie','persistentLocalStorage','unsavedFixtureText'].every(k=>typeof r[k]==='boolean');
  if(!full(edge)||!full(dex))return {classification:'unresolved',differences:[],
    summary:'not determined: wake proof incomplete'};
  const fields=['document','navigationRequests','persistentCookie','persistentLocalStorage','unsavedFixtureText'];
  const diff=fields.filter(k=>edge[k]!==dex[k]);
  if(diff.length)return {classification:'divergent-observed',differences:diff,
    summary:'wake behavior differs in this fixture; memory measurements do not represent equivalent behavior'};
  if(edge.document==='same live document'&&edge.persistentCookie&&edge.persistentLocalStorage&&edge.unsavedFixtureText){
    return {classification:'same-live-fixture-contract',differences:[],
      summary:'both kept the live fixture and all tested state; no general behavior or feature parity claim'};
  }
  return {classification:'same-limited-fixture-outcome',differences:[],
    summary:'both showed the same limited wake outcome, not proof of intact live state or general behavior parity'};
}
const describeParity=(edge,dex)=>wakeComparison(edge,dex).summary;
module.exports={CHECKPOINTS,readOwnedSnapshot,memoryArm,memoryPair,possibleNativeGeneration,wakeEvidence,wakeComparison,
  describeParity,waitForQuietCheckpoint,observeQuietClock,quietTimingEvidence};
