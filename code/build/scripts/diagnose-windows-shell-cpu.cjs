'use strict';
// Test-only counter calibration. Does not change browser settings or compare
// product performance. Only known live BrowserWindow/fixture/root PIDs sampled.
const assert=require('node:assert/strict');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs/promises');
const http=require('node:http');
const {setTimeout:sleep}=require('node:timers/promises');
const SAMPLE_MS=3800;
const PAGE=`<!doctype html><meta charset="utf-8"><title>Owned renderer CPU counter control</title>
<main>Owned renderer CPU counter control</main><script>
let timer=0, active=false, frames=0, ms=0;
function burn(){
  if(!active)return;
  const start=performance.now(); while(performance.now()-start<2){}
  frames++;ms+=performance.now()-start;
  timer=requestAnimationFrame(burn);
}
window.calibrateCpuTarget=setting=>{
  if(typeof setting==='boolean' && setting!==active){
    active=setting; if(active)timer=requestAnimationFrame(burn);else cancelAnimationFrame(timer);
  }
  return { active,frames,ms,visible:document.visibilityState==='visible',viewport:[innerWidth,innerHeight,devicePixelRatio],timeOrigin:performance.timeOrigin };
};</script>`;

function snapshot(ids) {
  // Values originate exclusively from the Electron-app diagnostic objects.
  assert(ids.length===3 && new Set(ids).size===3 && ids.every(id=>Number.isSafeInteger(id)&&id>0));
  const rows=ids.join(',');
  const script=`
$ErrorActionPreference='Stop'
$ids=@(${rows})
$rows=@(foreach($id in $ids){
  $direct=Get-Process -Id $id
  $cim=Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId='+$id)
  $cpu=$null
  try { $t=$direct.TotalProcessorTime; if($null -ne $t){$cpu=[Int64]$t.Ticks} } catch {}
  $cimCpu=$null
  if($null -ne $cim.UserModeTime -and $null -ne $cim.KernelModeTime){$cimCpu=[Int64]$cim.UserModeTime+[Int64]$cim.KernelModeTime}
  [pscustomobject]@{pid=$id;directStart=$direct.StartTime.ToUniversalTime().ToString('o');cimStart=$(if($cim.CreationDate){([datetime]$cim.CreationDate).ToUniversalTime().ToString('o')}else{$null});directTicks=$cpu;cimTicks=$cimCpu}
})
[pscustomobject]@{sampled=(Get-Date).ToUniversalTime().ToString('o');processes=$rows}|ConvertTo-Json -Depth 4 -Compress`;
  return JSON.parse(execFileSync('powershell.exe',['-NoLogo','-NoProfile','-Command',script],{encoding:'utf8',timeout:20000,windowsHide:true}).trim());
}
function counters(a,b,pids) {
  const ms=Date.parse(b.sampled)-Date.parse(a.sampled);
  assert(ms>=SAMPLE_MS && ms<=15000,'timing out of calibration bounds');
  for(const x of [a,b])assert.equal(x.processes.length,Object.keys(pids).length);
  const rows={};
  for(const [role,pid] of Object.entries(pids)){
    const from=a.processes.find(p=>p.pid===pid), to=b.processes.find(p=>p.pid===pid);
    assert(from&&to&&from.directStart===to.directStart&&from.cimStart===to.cimStart,'exact process generation missing');
    assert(Number.isFinite(Date.parse(to.directStart)) && Math.abs(Date.parse(to.directStart)-Date.parse(to.cimStart))<5,'direct/CIM process identity mismatch');
    rows[role]={};
    for(const key of ['directTicks','cimTicks']){
      rows[role][key==='directTicks'?'getProcessCpuMs':'cimCpuMs']=Number.isSafeInteger(from[key])&&Number.isSafeInteger(to[key])&&to[key]>=from[key]?(to[key]-from[key])/10000:null;
    }
  }
  return {intervalMs:ms,byRole:rows};
}
async function main(){
  if(process.argv[2]==='--self-test'){
    const pids={main:10,shell:11,foreground:12};
    const start='2026-11-28T12:00:00Z';
    const first={sampled:'2026-11-28T12:00:01Z',processes:Object.values(pids).map(pid=>({pid,directStart:start,cimStart:start,directTicks:0,cimTicks:0}))};
    const last={sampled:'2026-11-28T12:00:06Z',processes:first.processes.map((row,i)=>({...row,directTicks:i===2?5000000:0,cimTicks:i===1?null:0}))};
    const result=counters(first,last,pids);
    assert.equal(result.byRole.foreground.getProcessCpuMs,500);
    assert.equal(result.byRole.foreground.cimCpuMs,0);
    assert.equal(result.byRole.shell.cimCpuMs,null);
    assert.throws(()=>counters(first,last,{...pids,foreground:13}));
    console.log('OS CPU measurement null/identity positive-control parser tests passed');
    return;
  }
  assert(process.platform==='win32'&&process.env.GITHUB_ACTIONS==='true','cloud hosted Windows test only');
  const out=process.argv[2];assert(out&&path.isAbsolute(out));
  const {launchDexerion}=require('../e2e/app');
  let launched;
  const server=http.createServer((_req,res)=>res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}).end(PAGE));
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const url='http://127.0.0.1:'+server.address().port+'/cpu-calibration';
    launched=await launchDexerion({gpu:'adaptive',attempts:2});
    const {app,win,profile}=launched;
    await win.waitForFunction(async()=>{const s=await window.dexerion.invoke('dex:get-state');return s?.active&&s.tabs.some(t=>t.id===s.active&&!t.loading);});
    await win.evaluate(async url=>{const b=window.dexerion,s=await b.invoke('dex:get-state');for(const t of s.tabs)if(t.id!==s.active)await b.invoke('dex:close-tab',t.id);return b.invoke('dex:navigate',s.active,url);},url);
    await win.waitForFunction(async url=>{const s=await window.dexerion.invoke('dex:get-state');return s?.tabs.length===1&&s.tabs[0].id===s.active&&s.tabs[0].url===url&&!s.tabs[0].loading;},url);
    const observe=(setting)=>app.evaluate(async({app,BrowserWindow,webContents},{url,setting})=>{
      const shown=BrowserWindow.getAllWindows().filter(w=>w.isVisible()&&!w.isMinimized()&&w.isFocused());
      if(shown.length!==1)throw new Error('one actual foreground window required');
      const page=webContents.getAllWebContents().find(w=>w.getURL()===url);
      if(!page)throw new Error('actual local renderer not found');
      const action=setting===null?'':String(setting);
      return {pids:{main:process.pid,shell:shown[0].webContents.getOSProcessId(),foreground:page.getOSProcessId()},
        profile:app.getPath('userData'),page:await page.executeJavaScript('window.calibrateCpuTarget('+action+')',false)};
    },{url,setting});
    await sleep(3800);
    const owned=await observe(null);
    assert.equal((await fs.realpath(owned.profile)).toLowerCase(),(await fs.realpath(profile)).toLowerCase());
    const observations=[];
    for(const active of [false,true,true,false]){
      await observe(active);await sleep(240);
      const first=await observe(null);const a=snapshot(Object.values(owned.pids));
      await sleep(SAMPLE_MS);
      const b=snapshot(Object.values(owned.pids));const last=await observe(null);
      assert.deepEqual(first.pids,owned.pids);assert.deepEqual(last.pids,owned.pids);
      assert(first.page.visible&&last.page.visible&&first.page.timeOrigin===last.page.timeOrigin);
      assert.deepEqual(first.page.viewport,last.page.viewport);
      const f=last.page.frames-first.page.frames, work=last.page.ms-first.page.ms;
      assert(active?f>20&&work>40:f===0&&work===0,'known page CPU control did not produce requested condition');
      observations.push({active,frames:f,plannedForegroundJsMs:work,...counters(a,b,owned.pids)});
    }
    await observe(false);
    const active=observations.filter(r=>r.active);
    const gate=Object.fromEntries(['getProcessCpuMs','cimCpuMs'].map(key=>[key,active.every(r=>typeof r.byRole.foreground[key]==='number'&&r.byRole.foreground[key]>20)]));
    await fs.writeFile(out,JSON.stringify({source:process.env.GITHUB_SHA||null,counterUsableForPositiveControl:gate,observations},null,2)+'\n',{flag:'wx'});
    console.log('Owned browser renderer CPU counter calibration:',gate);
  }finally{
    try{if(launched)await launched.app.close();}finally{
      if(launched)await fs.rm(launched.profile,{recursive:true,force:true,maxRetries:5});
      server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    }
  }
}
main().catch(err=>{console.error(err);process.exitCode=1;});
