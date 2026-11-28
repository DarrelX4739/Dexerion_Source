// Lab-only direct JS kernel. Inputs here are normalized host snapshots only.
// Not a drop-in for arbitrary legacy coercions; no product module is changed.
const original=require(require('node:path').join(process.env.DEX_REPO_ROOT,'code/code/src/main/adaptive-power.js'));
const T=original.TIERS;
function runtimePlan(s,previous,now,state,b) {
 const score=+s.video*5 + +s.webgl*5 + +s.animation*2 + +s.interacting*2 +
   +s.loading + +(s.activeTabCount>1) + +s.audible;
 let tier='suspended';
 if(!s.minimized&&!s.locked&&!(s.idleMs>=600000&&!s.video&&!s.audible&&!s.webgl)){
  tier=score>=5?'accelerated':score>=2?'balanced':'minimal';
  if(tier==='accelerated'&&score<7&&(s.onBattery||(s.freeMemMB>0&&s.freeMemMB<1024)||s.cpuPct>=75))
    tier='balanced';
  const prior=T.indexOf(previous), since=Number(state?.tierSince);
  if(prior>=0&&T.indexOf(tier)<prior&&Number.isFinite(since)&&Math.max(0,now-since)<15000)tier=previous;
 }
 const suspended=tier==='suspended', multiplier=suspended?3:s.onBattery||s.idleMs>=120000?2:1;
 const deep=suspended&&!s.focused&&!s.video&&!s.audible&&!s.webgl&&!s.loading&&!s.interacting;
 const rate=(Number(b.sweepIntervalMs)||60000)*multiplier;
 let sweep=Number.isFinite(rate)?Math.max(15000,Math.min(300000,rate)):15000;
 const ceiling=Math.round(Number(b.sweepDeepIdleMs)||0);if(deep&&ceiling>300000)sweep=Math.max(sweep,ceiling);
 let idle=Number(b.idleSleepMs)||180000;
 if(suspended||s.onBattery)idle=Math.min(idle,90000);
 if(s.freeMemMB>0&&s.freeMemMB<1024)idle=Math.min(idle,60000);
 return {gpuTier:tier,sweepIntervalMs:Math.round(sweep),deepIdleSweep:deep,idleSleepMs:Math.round(idle),
  hideInactiveViews:true,hideMinimizedViews:true,backgroundThrottling:true,sampleMetrics:!suspended};
}
module.exports={...original,runtimePlan};
