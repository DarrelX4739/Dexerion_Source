'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');

const SCENARIOS=Object.freeze(['active-browsing','idle','background-tabs','multitasking']);
const POLICY=Object.freeze({trials:4,minPairs:3,settleMs:39000,sampleSec:15,minimumFps:30});
const ARMS=Object.freeze(['edge','dexerion']);
const profile='per-browser primed disposable seed, cloned per trial';
const animated=s=>s==='active-browsing'||s==='multitasking';
const distinct=s=>s==='background-tabs'||s==='multitasking';
const median=a=>{
  const x=[...a].sort((p,q)=>p-q);
  return (x[Math.floor((x.length-1)/2)]+x[Math.ceil((x.length-1)/2)])/2;
};
const range=a=>[Math.min(...a),Math.max(...a)];
const isMetric=n=>Number.isFinite(n)&&n>=0;
function expected(s) {
  const n=distinct(s)?9:1;
  const first='/'+(animated(s)?'animated':'static')+'?role=foreground';
  return {
    workload:Array.from({length:n},(_,i)=>'workload-'+i+'.localhost'+
      (i===0?first:'/animated?role=background&tab='+i)).sort(),
    foreground:'workload-0.localhost'+first,
    foregroundMode:animated(s)?'fixed-canvas':'static-body',
  };
}
function validatePair(evidence,s,a,b) {
  const next=expected(s);
  for(const [arm,t] of [[ARMS[0],a],[ARMS[1],b]]) {
    if(t?.valid!==true || t.browser!==arm || t.scenario!==s)return arm+': invalid or missing trial';
    if(!Number.isFinite(t.wallSec)||t.wallSec<POLICY.sampleSec-0.1||t.wallSec>POLICY.sampleSec+4)return arm+': measurement duration';
    for(const stage of ['A','B']){
      const proof=t.nativeWorkload?.[stage];
      if(!proof||proof.foreground!==next.foreground||proof.fixture!==next.foregroundMode||
        JSON.stringify(proof.hostAndPath)!==JSON.stringify(next.workload)||
        proof.workloadTargets!==next.workload.length)return arm+': loaded fixture or tab inventory '+stage;
      const attribution=t.processTreeAttribution?.[stage];
      if(attribution?.mode!=='native creation-scoped'||attribution.unknownParentReferences!==0||
        attribution.staleParentReferences!==0)return arm+': uncertain process ownership '+stage;
    }
    const v=t.foreground?.viewport;
    if(t.foreground?.visible!==true||!Number.isInteger(v?.width)||v.width<928||
      !Number.isInteger(v.height)||v.height<592||!(v.scale>0))return arm+': foreground missing or fixture clipped';
    if(animated(s)?!(Number.isFinite(t.foreground.fps)&&t.foreground.fps>=POLICY.minimumFps):t.foreground.fps!==null)
      return arm+': foreground rendered the wrong workload';
    if(!t.browserVersion||t.env?.edgeVersion!==evidence.env?.edgeVersion||
      t.env?.osBuild!==evidence.env?.osBuild||t.env?.powerPlanGuid!==evidence.env?.powerPlanGuid||
      typeof t.env?.onAc!=='boolean'||t.env.onAc!==evidence.env?.onAc)return arm+': browser/host fingerprint changed';
  }
  if(a.foreground.viewport.scale!==b.foreground.viewport.scale)return 'device pixel ratio differs';
  if(Math.abs(a.wallSec-b.wallSec)>1.2)return 'sample duration mismatch';
  if(animated(s)&&Math.abs(a.foreground.fps-b.foreground.fps)>Math.max(3,a.foreground.fps*0.05))return 'foreground FPS mismatch';
  return null;
}
function wholeCpu(t) {
  const c=t.cpu, g=c?.stableRoleAttribution;
  if(!c||c.newPidsMidWindow!==0||c.exitedPidsMidWindow?.length!==0||
    c.processCountA!==c.processCountB||c.processCountA<2||g?.matchedProcesses!==c.processCountA||
    g.unmatchedAtEnd!==0||g.unmatchedAtStart!==0||!isMetric(c.cpuCorePct))return null;
  return c.cpuCorePct;
}
function summarize(samples, metric) {
  const rows=samples.map(({i,edge,dex})=>({i,edge:metric(edge),dexerion:metric(dex)}));
  const pairs=rows.filter(row=>isMetric(row.edge)&&isMetric(row.dexerion));
  const output={pairs:pairs.length, missingPairs:rows.filter(p=>!pairs.includes(p)).map(p=>p.i)};
  if(pairs.length<POLICY.minPairs)return {...output,verified:false,reason:'Fewer than three complete matched pairs'};
  const deltas=pairs.map(p=>p.dexerion-p.edge);
  const ratios=pairs.filter(p=>p.edge>0).map(p=>p.dexerion/p.edge-1);
  return {...output,verified:true,edgeMedian:median(pairs.map(p=>p.edge)),dexerionMedian:median(pairs.map(p=>p.dexerion)),
    pairedDeltaMedian:median(deltas),pairedDeltaRange:range(deltas),
    relativePercentPairs:ratios.length,pairedPercentMedian:ratios.length>=POLICY.minPairs?100*median(ratios):null,
    pairedPercentRange:ratios.length>=POLICY.minPairs?range(ratios).map(v=>v*100):null};
}
function gradeCurrent(evidence,sha) {
  const c=evidence?.config, p=evidence?.provenance;
  assert(/^[a-f0-9]{40}$/.test(sha||'')&&p?.checkoutSha===sha,'exact dev-V checkout SHA required');
  assert(p.ref==='refs/heads/dev-V'&&p.nativePlatform==='win32'&&
    /^[a-f0-9]{64}$/.test(p.appAsarSha256)&&/^[a-f0-9]{64}$/.test(p.dexerionExeSha256),'locked packaged Windows provenance required');
  assert(c?.currentCpuRam===true&&c.nativeLaunch===true&&c.packagedApp===true&&c.exploratoryLauncherControl===false&&
    c.skipPower===true&&c.skipGpu===true&&c.titleControl===null&&c.profileMode===profile&&c.bgTabs===8&&
    c.workloadOrigins==='one .localhost host per tab'&&c.backgroundFixture==='animated'&&
    c.trialsPerScenarioPerBrowser===POLICY.trials&&c.settleMs===POLICY.settleMs&&c.sampleSec===POLICY.sampleSec,
  'wrong current native CPU/RAM profile');
  assert.deepEqual(c.scenarioOrder,SCENARIOS);
  assert.deepEqual(c.browsers,ARMS);
  assert(evidence.env?.edgeVersion&&evidence.env?.powerPlanGuid&&evidence.env.osBuild&&typeof evidence.env.onAc==='boolean',
    'required Windows host fingerprint missing');
  const versions=Object.fromEntries(ARMS.map(arm=>[arm,new Set()]));
  const scenarios={};
  for(const s of SCENARIOS) {
    const g=evidence.scenarios?.[s];
    if(!g) { scenarios[s]={error:'missing scenario',parityPairs:0}; continue; }
    const order=g.trialOrder ?? [];
    assert(order.length===POLICY.trials&&order.every((r,i)=>r.trial===i+1&&
      r.order?.length===2&&ARMS.every(arm=>r.order.includes(arm)))&&
      new Set(order.map(r=>r.order[0])).size===2&&order.every((r,i)=>i===0||r.order[0]!==order[i-1].order[0]),
    'unbalanced or missing pair collection order: '+s);
    const pairs=[], invalidPairs=[];
    for(let i=1;i<=POLICY.trials;i++) {
      const get=arm=>{
        const ts=(g[arm]?.trials||[]).filter(t=>t.trial===i);
        assert(ts.length<=1,arm+': duplicate sample for '+s+'/'+i);
        if(ts[0]?.browserVersion)versions[arm].add(ts[0].browserVersion);
        return ts[0];
      };
      const edge=get('edge'), dex=get('dexerion');
      const reason=validatePair(evidence,s,edge,dex);
      if(reason){invalidPairs.push({i,reason});continue;}
      pairs.push({i,edge,dex});
    }
    scenarios[s]={
      parityPairs:pairs.length, invalidPairs,
      viewportWidthsHeights:Object.fromEntries(ARMS.map(arm=>[arm,[...new Set(pairs.map(p=>{
        const x=(arm==='edge'?p.edge:p.dex).foreground.viewport;
        return x.width+'×'+x.height+' @ '+x.scale;
      }))]])),
      fpsMedian:animated(s)&&pairs.length
        ?{edge:median(pairs.map(p=>p.edge.foreground.fps)),dexerion:median(pairs.map(p=>p.dex.foreground.fps))}:null,
      privateResidentMiB:summarize(pairs,t=>isMetric(t.ram?.privateWsMiBB)&&t.ram.privateWsMiBB>0?t.ram.privateWsMiBB:null),
      wholeTreeCpuPctOfCore:summarize(pairs,wholeCpu),
    };
  }
  assert(ARMS.every(arm=>versions[arm].size<=1),'CDP browser version changed during the run');
  const complete=Object.values(scenarios).every(row=>row.privateResidentMiB?.verified&&row.wholeTreeCpuPctOfCore?.verified);
  return {provenance:p,host:evidence.env,browserVersions:Object.fromEntries(ARMS.map(arm=>[arm,[...versions[arm]][0]??null])),
    complete,scenarios,limitations:[
      'One hosted Windows VM, loopback fixture, normal visible product windows, separate initial profile per browser. Not a universal goal result.',
      'RAM is summed private resident working set at snapshot B, not total working set, allocated/private commit, or ASAR bytes.',
      'CPU is percent of one logical core; only pairs with stable process generations and no endpoint churn. Unobserved processes born and gone between snapshots cannot be counted.',
      'Foreground content is the same, canvas must fit, DPR and frame rates must match. Different product browser chrome sizes are recorded, not forced.',
      'GPU and physical power not measured. Absolute CPU deltas are more useful when idle baseline is near zero.',
    ]};
}
if(require.main===module){
  try{
    assert.equal(process.argv.length,5,'usage: node grade-current-browser-pairs.cjs <raw.json> <checkout sha> <summary.json>');
    const r=gradeCurrent(JSON.parse(fs.readFileSync(process.argv[2],'utf8')),process.argv[3]);
    fs.writeFileSync(process.argv[4],JSON.stringify(r,null,2)+'\n',{flag:'wx'});
    for(const [n,v] of Object.entries(r.scenarios))console.log(n+': '+JSON.stringify(v));
    if(!r.complete){console.error('One or more CPU/RAM workload comparisons unverified. See excluded pairs and raw evidence.');process.exitCode=1;}
  }catch(e){console.error('Current CPU/RAM evidence rejected: '+e.message);process.exitCode=2;}
}
module.exports={gradeCurrent,SCENARIOS,POLICY};
