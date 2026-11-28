'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {gradeCurrent,SCENARIOS,POLICY}=require('./grade-current-browser-pairs.cjs');
const sha='a'.repeat(40);
function evidence(){
  const env={edgeVersion:'158.0.0.0',powerPlanGuid:'host-plan',osBuild:'26100',onAc:true};
  const scenarios={};
  for(const s of SCENARIOS){
    const many=['background-tabs','multitasking'].includes(s),active=['active-browsing','multitasking'].includes(s);
    const n=many?9:1, arms=['edge','dexerion'];
    const first='workload-0.localhost/'+(active?'animated':'static')+'?role=foreground';
    const hostAndPath=[first,...Array.from({length:n-1},(_,i)=>'workload-'+(i+1)+'.localhost/animated?role=background&tab='+(i+1))];
    const proof={foreground:first,hostAndPath,fixture:active?'fixed-canvas':'static-body',workloadTargets:n};
    const tree={mode:'native creation-scoped',unknownParentReferences:0,staleParentReferences:0};
    const trial=(arm,i)=>({
      valid:true,browser:arm,scenario:s,trial:i,wallSec:15.5, env:{...env},
      browserVersion:arm==='edge'?'Edg/158.0.0.0':'Chrome/152.0.0.0',
      foreground:{visible:true,fps:active?64: null,viewport:{width:arm==='edge'?980:960,height:608,scale:1}},
      nativeWorkload:{A:structuredClone(proof),B:structuredClone(proof)},
      processTreeAttribution:{A:{...tree},B:{...tree}},
      cpu:{cpuCorePct:arm==='edge'?1:0.8,processCountA:n+4,processCountB:n+4,
        newPidsMidWindow:0,exitedPidsMidWindow:[],stableRoleAttribution:{matchedProcesses:n+4,unmatchedAtStart:0,unmatchedAtEnd:0}},
      ram:{privateWsMiBB:arm==='edge'?100+i:105+i, wsMBB:arm==='edge'?100:5},
    });
    scenarios[s]=Object.fromEntries(arms.map(a=>[a,{trials:Array.from({length:4},(_,i)=>trial(a,i+1))}]));
    scenarios[s].trialOrder=Array.from({length:4},(_,i)=>({trial:i+1,order:i%2?[...arms].reverse():[...arms]}));
  }
  return {
    provenance:{ checkoutSha:sha, ref:'refs/heads/dev-V', nativePlatform:'win32',
      appAsarSha256:'4'.repeat(64),dexerionExeSha256:'6'.repeat(64) },
    env,scenarios,
    config:{currentCpuRam:true,nativeLaunch:true,packagedApp:true,exploratoryLauncherControl:false,skipPower:true,skipGpu:true,
      titleControl:null,profileMode:'per-browser primed disposable seed, cloned per trial',bgTabs:8,
      workloadOrigins:'one .localhost host per tab',backgroundFixture:'animated',
      trialsPerScenarioPerBrowser:POLICY.trials,sampleSec:POLICY.sampleSec,settleMs:POLICY.settleMs,
      scenarioOrder:[...SCENARIOS],browsers:['edge','dexerion']},
  };
}
test('uses all four paired workload cases and private resident, not total WS',()=>{
  const r=gradeCurrent(evidence(),sha);
  assert(r.complete);
  assert.equal(r.scenarios['active-browsing'].privateResidentMiB.pairedDeltaMedian,5);
  assert.equal(r.scenarios.idle.privateResidentMiB.pairs,4);
  assert.equal(r.scenarios.multitasking.wholeTreeCpuPctOfCore.edgeMedian,1);
  assert(Math.abs(r.scenarios.multitasking.wholeTreeCpuPctOfCore.pairedPercentMedian+20)<1e-9);
});
test('does not credit CPU when process churn hides full-tree CPU, but retains RAM',()=>{
  const e=evidence();
  const t=e.scenarios['background-tabs'].edge.trials;
  t[0].cpu.exitedPidsMidWindow.push(40);
  t[1].cpu.stableRoleAttribution.unmatchedAtEnd=1;
  const r=gradeCurrent(e,sha), row=r.scenarios['background-tabs'];
  assert(!r.complete);
  assert.equal(row.privateResidentMiB.pairs,4);
  assert.deepEqual(row.wholeTreeCpuPctOfCore,{pairs:2,missingPairs:[1,2],verified:false,reason:'Fewer than three complete matched pairs'});
});
test('mismatched frame rates, hidden targets, and unknown process ownership reject exact pairs',()=>{
  const e=evidence();
  e.scenarios.multitasking.dexerion.trials[0].foreground.fps=44;
  e.scenarios.multitasking.dexerion.trials[1].nativeWorkload.B.hostAndPath.pop();
  e.scenarios.multitasking.edge.trials[2].processTreeAttribution.A.unknownParentReferences=1;
  const r=gradeCurrent(e,sha),row=r.scenarios.multitasking;
  assert(!r.complete);
  assert.equal(row.parityPairs,1);
  assert.deepEqual(row.invalidPairs.map(p=>p.i),[1,2,3]);
  assert(row.invalidPairs.every(p=>typeof p.reason==='string'));
});
test('zero Edge baseline retains absolute deltas but no fabricated percentage',()=>{
  const e=evidence();
  for(const t of e.scenarios.idle.edge.trials)t.cpu.cpuCorePct=0;
  const r=gradeCurrent(e,sha), row=r.scenarios.idle.wholeTreeCpuPctOfCore;
  assert(r.complete && row.verified);
  assert.equal(row.pairedDeltaMedian,0.8);
  assert.equal(row.pairedPercentMedian,null);
});
test('rejects incorrect checkout, arm order, and mixed Edge versions',()=>{
  const e=evidence();
  assert.throws(()=>gradeCurrent(e,'b'.repeat(40)),/exact dev-V checkout/);
  e.scenarios.idle.trialOrder[1].order=['edge','dexerion'];
  assert.throws(()=>gradeCurrent(e,sha),/unbalanced/);
  const mixed=evidence();
  mixed.scenarios.idle.edge.trials[0].browserVersion='Edg/159.0.0.0';
  assert.throws(()=>gradeCurrent(mixed,sha),/browser version changed/);
});
