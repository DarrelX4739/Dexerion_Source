'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {once}=require('node:events');
const {randomBytes,createHash}=require('node:crypto');
const {fileURLToPath}=require('node:url');
const {spawn,execFileSync}=require('node:child_process');
const {setTimeout:wait}=require('node:timers/promises');
const {performance}=require('node:perf_hooks');
const {browserArgs,debugPort,edgeExecutable,isShellUrl,waitFor}=require('./measure-native-browser.cjs');
const {CHECKPOINTS,readOwnedSnapshot,memoryArm,memoryPair,possibleNativeGeneration,wakeEvidence,wakeComparison,waitForQuietCheckpoint,observeQuietClock,quietTimingEvidence}=require('./read-long-idle.cjs');

const ORDER=['edge','dexerion'],SLOTS=Array.from({length:9},(_,i)=>i),WAKE_SLOT=4;
const SHA=process.env.GITHUB_SHA;
const browserNames={edge:'msedge.exe',dexerion:'dexerion.exe'};
const title=i=>'Matched local reading '+i;
const sentinel=i=>'SYNTHETIC_UNSAVED_'+i;
const storageKey=i=>'dex-long-idle-fixture-'+i;
const cookieKey=i=>'dexlong'+i;
const host=i=>i===1?'long-idle-0.localhost':'long-idle-'+i+'.localhost';
const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const reason=e=>String(e?.message||e).split('\n')[0].slice(0,180);
const bounded=(task,ms,label)=>Promise.race([task,wait(ms,null,{ref:false}).then(()=>{throw new Error(label+' timed out');})]);

// Browser-level socket only, no Playwright auto-attachment to background pages.
// Every explicit page session is detached, and the browser socket is CLOSED
// during the idle measurement, so the observer cannot pin an idle tab.
class BrowserCdp {
  constructor(ws) {
    this.ws=ws;this.id=0;this.pending=new Map();this.sessions=new Set();
    ws.addEventListener('message',e=>{
      const m=JSON.parse(e.data),pending=this.pending.get(m.id);
      if(m.method==='Target.detachedFromTarget'&&typeof m.params?.sessionId==='string')this.sessions.delete(m.params.sessionId);
      if(!pending)return;
      this.pending.delete(m.id);clearTimeout(pending.timer);
      if(m.error)pending.reject(new Error(pending.method+': '+m.error.message));
      else pending.resolve(m.result||{});
    });
    ws.addEventListener('close',()=>{
      for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(new Error('browser socket closed'));}
      this.pending.clear();
    });
  }
  send(method,params={},sessionId) {
    assert(this.ws.readyState===WebSocket.OPEN,'CDP session not open');
    const id=++this.id;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        this.pending.delete(id);reject(new Error(method+' timed out'));
      },5000);
      this.pending.set(id,{method,timer,resolve,reject});
      this.ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
    });
  }
  async page(id,work) {
    const {sessionId}=await this.send('Target.attachToTarget',{targetId:id,flatten:true});
    assert(typeof sessionId==='string'&&sessionId);
    this.sessions.add(sessionId);
    try{return await work((m,p)=>this.send(m,p,sessionId));}
    finally{
      if(this.sessions.has(sessionId)){
        await this.send('Target.detachFromTarget',{sessionId});
        this.sessions.delete(sessionId);
      }
    }
  }
  async eval(id,script) {
    return this.page(id,async call=>{
      const {result,exceptionDetails}=await call('Runtime.evaluate',{expression:script,returnByValue:true,
        awaitPromise:true,userGesture:false});
      assert(!exceptionDetails&&result&&Object.hasOwn(result,'value'),'isolated fixture evaluation did not return a value');
      return result.value;
    });
  }
  async close() {
    assert.equal(this.sessions.size,0,'explicit page CDP session remained attached');
    if(this.ws.readyState===WebSocket.CLOSED)return;
    const done=new Promise(resolve=>this.ws.addEventListener('close',resolve,{once:true}));
    if(this.ws.readyState===WebSocket.OPEN)this.ws.close(1000);
    await bounded(done,5000,'disconnect browser CDP entirely');
  }
}
async function endpoint(profile){
  const port=debugPort(profile);
  assert(port>0,'missing isolated browser endpoint');
  const r=await fetch('http://127.0.0.1:'+port+'/json/version',{signal:AbortSignal.timeout(5500)});
  assert(r.ok);
  const info=await r.json(),url=new URL(info.webSocketDebuggerUrl);
  assert(url.protocol==='ws:'&&url.hostname==='127.0.0.1'&&Number(url.port)===port&&
    /^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(url.pathname)&&!url.search&&!url.hash&&!url.username&&!url.password,
  'browser endpoint was not the local disposable listener');
  const ws=new WebSocket(url.href);
  await bounded(new Promise((resolve,reject)=>{
    ws.addEventListener('open',resolve,{once:true});
    ws.addEventListener('error',()=>reject(new Error('loopback CDP socket failed')),{once:true});
  }),5500,'browser CDP open');
  return new BrowserCdp(ws);
}
function cleanupInventory(){
  const at=Date.now(),raw=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-File',
    path.join(__dirname,'measure-tree-snapshot.ps1')],
  {timeout:11500,encoding:'utf8',windowsHide:true,maxBuffer:20*1024*1024}).trim());
  return {raw,at,end:Date.now()};
}
async function nativeLaunch(kind,executable) {
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'dex-native-'+kind+'-'));
  const child=spawn(executable,browserArgs(kind,profile,{packaged:kind==='dexerion'}),
    {cwd:path.dirname(executable),env:process.env,stdio:['ignore','ignore','ignore']});
  let error=null;
  child.once('error',e=>{error=e;});
  const running=()=>Boolean(child.pid&&child.exitCode===null&&child.signalCode===null);
  const close=async(cdp)=>{
    if(running()){
      let control=cdp;
      try{
        if(!control||control.ws.readyState!==WebSocket.OPEN)control=await endpoint(profile);
        await bounded(control.send('Browser.close'),1600,'graceful browser exit request');
      }catch{}finally{if(control)await control.close().catch(()=>{});}
      if(running())await Promise.race([once(child,'exit').catch(()=>{}),wait(4000)]);
      if(running()){
        // Kill only the disposable process created by this test, never an
        // independent browser launched by a Windows runner/user.
        child.kill();
        if(running())await Promise.race([once(child,'exit').catch(()=>{}),wait(4000)]);
      }
    }else if(cdp)await cdp.close().catch(()=>{});
    assert(!running(),'disposable browser process did not exit');
    fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:250});
  };
  try{
    await waitFor(()=>{
      if(error)throw error;
      if(!running())throw new Error(kind+' exited before isolated endpoint');
      return debugPort(profile);
    },kind+' isolated DevTools listener',38000);
    return {kind,root:child.pid,profile,processId:child.pid,profileDir:profile,running,close};
  }catch(e){await close(null);throw e;}
}
async function ownedCleanup(identities,nativeGenerations,profile){
  const old=new Set(identities.map(([pid,birth])=>pid+';'+birth));
  await waitFor(()=>{
    const {raw}=cleanupInventory();
    const p=profile.toLowerCase();
    return !raw.processes.some(r=>old.has(r.pid+';'+r.startedUtc)||possibleNativeGeneration(r,nativeGenerations)||
      typeof r.cmdline==='string'&&r.cmdline.toLowerCase().includes(p));
  },'first disposable browser and its measured children fully exited',12500);
}
function html(i,token){
  return `<!doctype html><meta charset="utf-8"><title>${title(i)}</title>
<style>body{margin:24px;color:#20242b;background:#fff;font:16px system-ui}main{max-width:640px} textarea{width:400px;height:48px}</style>
<main><h1 id="fixture">${title(i)}</h1>
<label>Unsaved local fixture text <textarea id="unsaved"></textarea></label>
${Array.from({length:18},(_,j)=>'<p>Deterministic offline reading paragraph '+j+'.</p>').join('')}</main>
<script>
const token=${JSON.stringify(token)},slot=${i},sentinel=${JSON.stringify(sentinel(i))},
  key=${JSON.stringify(storageKey(i))},v=[];
const first=localStorage.getItem(key);
if(first===null&&${token.startsWith('1-')}){
  localStorage.setItem(key,sentinel);
  document.querySelector('#unsaved').value=sentinel;
}
window.measurement={token,slot,origin:performance.timeOrigin,v};
document.addEventListener('visibilitychange',()=>{
  if(v.length<32)v.push([Date.now(),document.visibilityState]);
});
fetch('/ready/'+slot,{method:'POST',body:JSON.stringify({...window.measurement,visible:document.visibilityState,
  text:document.querySelector('#unsaved').value,storage:localStorage.getItem(key)})}).catch(()=>{});
</script>`;
}
async function listenFixture(){
  let port,phase=null;
  const reset=()=>{
    phase={loads:SLOTS.map(()=>[]),checks:SLOTS.map(()=>0)};
    return phase;
  };
  const server=http.createServer(async(req,res)=>{
    const match=/^\/(tab|ready|cookie)\/(\d)$/.exec(String(req.url||''));
    const i=Number(match?.[2]),kind=match?.[1];
    if(!phase||!match||!SLOTS.includes(i)||req.headers.host!==host(i)+':'+port){
      res.writeHead(404).end();return;
    }
    const owner=phase;
    const sentCookie=String(req.headers.cookie||'').split(/;\s*/).includes(cookieKey(i)+'=stock-fixture');
    if(kind==='tab'&&req.method==='GET'){
      const slot=owner.loads[i],first=slot.length===0;
      const token=(slot.length+1)+'-'+randomBytes(12).toString('hex');
      slot.push({token,initialCookie:sentCookie,document:null});
      const headers={'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store'};
      if(first)headers['Set-Cookie']=cookieKey(i)+'=stock-fixture; Path=/; SameSite=Lax; HttpOnly';
      res.writeHead(200,headers).end(html(i,token));return;
    }
    if(kind==='cookie'&&req.method==='GET'){
      owner.checks[i]++;
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(sentCookie));return;
    }
    if(kind==='ready'&&req.method==='POST'){
      try{
        const parts=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>4096)throw Error('ready payload too big');parts.push(chunk);}
        const d=JSON.parse(Buffer.concat(parts).toString('utf8')),r=owner.loads[i].find(x=>x.token===d.token);
        assert(owner===phase&&r&&!r.document&&Number.isFinite(d.origin)&&d.origin>0&&d.slot===i&&
          (d.visible==='visible'||d.visible==='hidden')&&typeof d.text==='string'&&(d.storage===null||typeof d.storage==='string'));
        r.document={slot:d.slot,token:d.token,origin:d.origin,visible:d.visible,text:d.text,storage:d.storage};
        res.writeHead(204,{'Cache-Control':'no-store'}).end();return;
      }catch{res.writeHead(422).end();return;}
    }
    res.writeHead(405).end();
  });
  const started=once(server,'listening');server.listen(0,'127.0.0.1');await started;
  port=server.address().port;
  return {server,reset,urls:SLOTS.map(i=>'http://'+host(i)+':'+port+'/tab/'+i)};
}
const targets=cdp=>cdp.send('Target.getTargets').then(r=>r.targetInfos.filter(t=>t.type==='page'&&!t.subtype));
const profileEval=(cdp,id,channel,...args)=>cdp.eval(id,
  'window.dexerion.invoke(...'+JSON.stringify([channel,...args])+').then(v=>v===undefined?null:v)');
const pageProof=(cdp,id,i)=>cdp.eval(id,`(()=>{
 const m=window.measurement;if(!m||m.slot!==${i})return null;
 const node=document.querySelector('#fixture'),text=document.querySelector('#unsaved');
 if(!node||!text)return null;
 return {token:m.token,origin:m.origin,title:document.title,text:node.textContent,
  visible:document.visibilityState==='visible',textValue:text.value,width:innerWidth,height:innerHeight,
  dpr:devicePixelRatio,seen:m.v,storage:localStorage.getItem(${JSON.stringify(storageKey(i))})};
})()`);
function stockInCap(m) {
  assert(m?.saverOn===true&&m.capMB===2048&&Number.isFinite(m.workingSetMB)&&m.workingSetMB>0&&m.workingSetMB<1536,
    'stock Dexerion control no longer positively below memory pressure threshold');
}
function stockEdgeSelect(root){
  assert(Number.isSafeInteger(root)&&root>0&&WAKE_SLOT===4,'only fixed isolated five-tab hotkey intended');
  const script=`
    $ErrorActionPreference = 'Stop'
    Add-Type -TypeDefinition @"
    using System;
    using System.Text;
    using System.Runtime.InteropServices;
    public static class DexFixtureWindow {
      [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
      [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint id);
      [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr handle,StringBuilder name,int length);
    }
"@
    Add-Type -AssemblyName System.Windows.Forms
    $h = [DexFixtureWindow]::GetForegroundWindow()
    [uint32]$windowOwner = 0
    [void][DexFixtureWindow]::GetWindowThreadProcessId($h, [ref]$windowOwner)
    $title = [System.Text.StringBuilder]::new(512)
    [void][DexFixtureWindow]::GetWindowText($h,$title,512)
    if ($h -eq [IntPtr]::Zero -or $windowOwner -ne ${root} -or -not $title.ToString().StartsWith('Matched local reading 0')) {
      throw 'exact owned Edge foreground window not verified; no input sent'
    }
    if ([DexFixtureWindow]::GetForegroundWindow() -ne $h) { throw 'foreground changed; no input sent' }
    [System.Windows.Forms.SendKeys]::SendWait('^5')
    # Verify the selected tab by its native window title before a CDP session
    # can inspect or wake that document. Never try a different key or focus.
    for ($i=0; $i -lt 40; $i++) {
      if ([DexFixtureWindow]::GetForegroundWindow() -ne $h) { throw 'fixture no longer owns the foreground after selection' }
      [void]$title.Clear()
      [void][DexFixtureWindow]::GetWindowText($h,$title,512)
      if ($title.ToString().StartsWith('Matched local reading 4')) { [Console]::Write('selected'); exit 0 }
      Start-Sleep -Milliseconds 125
    }
    throw 'fifth native Edge tab title not verified; no page inspection attempted'
  `;
  const literal=Buffer.from(script,'utf16le').toString('base64');
  const output=execFileSync('powershell.exe',['-NoProfile','-STA','-EncodedCommand',literal],{
    windowsHide:true,encoding:'utf8',timeout:10000,maxBuffer:16384,
  });
  assert.equal(output.trim(),'selected','could not dispatch native stock Edge Ctrl+5');
}
async function runArm(kind,executable,asar,fixture) {
  let launched,cdp,collector,observedIds=[],stamp;
  const nativeGenerations=new Map();
  const remember=s=>{
    for(const [pid,p] of s.scopeOfGenerations){
      if(!nativeGenerations.has(pid))nativeGenerations.set(pid,[]);
      const rows=nativeGenerations.get(pid);
      if(!rows.includes(p.birth))rows.push(p.birth);
    }
  };
  const result={kind,memory:null,wake:null,missing:null};
  const {urls}=fixture,records=fixture.reset();
  const covered=()=>records.loads.every((list,i)=>list.length===1&&list[0].document&&
    list[0].document.storage===sentinel(i)&&list[0].document.text===sentinel(i));
  const isDex=kind==='dexerion';
  try {
    launched=await nativeLaunch(kind,executable);
    cdp=await endpoint(launched.profile);
    result.product=(await cdp.send('Browser.getVersion')).product;
    let shell,front,ids=[],edgeTab;
    if(isDex){
      shell=await waitFor(async()=> (await targets(cdp)).find(t=>isShellUrl(t.url)),'real packed Dexerion shell',22000);
      assert.equal(path.relative(path.join(asar,'src','renderer','shell.html'),fileURLToPath(shell.url)),'');
      const start=await waitFor(async()=>{
        const s=await profileEval(cdp,shell.targetId,'dex:get-state');return s?.active&&s.tabs.length===1?s:null;
      },'shipping default one-tab startup',18000);
      ids.push(start.active);
      await profileEval(cdp,shell.targetId,'dex:navigate',ids[0],urls[0]);
      for(const u of urls.slice(1))ids.push(await profileEval(cdp,shell.targetId,'dex:new-tab',u,true));
      assert(ids.length===9&&new Set(ids).size===9&&ids.every(x=>typeof x==='string'&&x));
      const defaults=await profileEval(cdp,shell.targetId,'dex:debloat-metrics');
      assert(defaults.activeProfile==='optimized'&&defaults.budgets.idleSleepMs===180000);
      stockInCap(await profileEval(cdp,shell.targetId,'dex:memory'));
      await cdp.eval(shell.targetId,`(()=>{
        const ids=${JSON.stringify(ids)},log=[];
        Object.defineProperty(window,'__longIdleSleepEvents',{value:log});
        window.dexerion.on('dex:state',s=>{
          if(log.length>=20||s.active!==ids[0])return;
          const asleep=(s.tabs||[]).filter(t=>ids.slice(1).includes(t.id)&&t.sleeping&&!t.loading).length;
          if(asleep&&(log.length===0||log.at(-1).asleep!==asleep))log.push({at:Date.now(),asleep});
        });
        return true;
      })()`);
    }else{
      const blank=await waitFor(async()=> (await targets(cdp)).find(t=>t.url==='about:blank'),'stock Edge about:blank',18000);
      front=blank.targetId;
      await cdp.send('Target.activateTarget',{targetId:front});
      const load=await cdp.page(front,call=>call('Page.navigate',{url:urls[0]}));
      assert(!load.errorText,'Edge native initial navigation failed');
      for(const [i,url] of urls.entries())if(i){
        // Native visible tab strip, no headless/hidden target or new context.
        const {targetId}=await cdp.send('Target.createTarget',{url,background:true,forTab:true});
        const {targetInfo}=await cdp.send('Target.getTargetInfo',{targetId});
        assert(targetInfo.type==='tab','Edge target was not a native stock tab');
        if(i===WAKE_SLOT)edgeTab=targetId;
        ids.push(targetId);
      }
      assert(ids.length===8&&new Set(ids).size===8&&edgeTab);
    }
    await waitFor(covered,'all nine initial renderer scripts/URLs ready',16000);
    // Some native browser implementations foreground a newly opened tab
    // despite supporting the background parameter. Re-select the existing
    // already committed first page BEFORE ending setup for both samplings.
    if(!isDex)await cdp.send('Target.activateTarget',{targetId:front});
    const startupTargets=await targets(cdp);
    const loaded=startupTargets.filter(t=>urls.includes(t.url));
    assert(loaded.length===9&&new Set(loaded.map(x=>x.url)).size===9&&startupTargets.length===(isDex?10:9),
      'shipping foreground/background target inventory did not match');
    const frontTarget=loaded.find(t=>t.url===urls[0]).targetId;
    if(isDex)front=frontTarget;
    else assert.equal(front,frontTarget,'stock Edge foreground target changed unexpectedly');
    const initialFront=await pageProof(cdp,front,0),initialDocument=records.loads[0][0].document;
    assert(initialFront?.visible===true&&initialFront.token===initialDocument.token&&initialFront.origin===initialDocument.origin&&
      initialFront.title===title(0)&&initialFront.text===title(0)&&initialFront.width>=450&&initialFront.height>=400&&
      initialFront.dpr>0,'actual foreground fixture or viewport not proven');
    if(!isDex){
      const windows=await Promise.all(loaded.map(t=>cdp.send('Browser.getWindowForTarget',{targetId:t.targetId})));
      assert(windows.every(w=>Number.isSafeInteger(w.windowId)&&w.windowId===windows[0].windowId&&
        w.bounds?.windowState!=='minimized'),'Edge fixture pages not present as tabs in the same live native window');
    }
    const firstWake=records.loads[WAKE_SLOT][0].document;
    await cdp.close();cdp=null;
    collector=await require('./owned-working-set-preflight.cjs').Collector.launch(kind,launched);
    // Prewarm once, with DevTools already disconnected and before either
    // arm's quiet clock. The untimed sample supplies positive generation
    // and clock identity only. No warmup resident value is recorded.
    const warm=await collector.sample(launched.root);
    remember(warm);
    result.warmupTimingOnly=warm.qualification;
    // The collector's validated UTC projection allows up to 2 ms rounding.
    // Start strictly after even the upper endpoint of the warm acquisition.
    await wait(Math.max(0,Math.ceil(warm.providerMaxUtcMs-Date.now())));
    const quietAt=Date.now(),anchor={wall:quietAt,mono:performance.now()};
    const snapshots=[],timingDiagnostics=[];
    result.timingDiagnostics=timingDiagnostics;
    const stopCollector=async()=>{
      if(!collector)return;
      await collector.close();
      assert(collector.child.exitCode!==null||collector.child.signalCode!==null,'owned sampler did not stop cleanly');
      collector=null;
    };
    for(const checkpoint of CHECKPOINTS){
      const reached=await waitForQuietCheckpoint(anchor,checkpoint);
      assert(launched.running(),'stock process exited during quiet window');
      const current={plannedElapsedMs:checkpoint,timerWaits:reached.timerWaits};
      timingDiagnostics.push(current);
      if(!collector){
        current.unavailable='prior_provider_failure_no_retry';
        continue;
      }
      if(reached.wallElapsedMs>checkpoint+2500){
        current.timing=quietTimingEvidence({requestedAt:reached.wallAt},quietAt+checkpoint,null);
        current.unavailable='late_checkpoint_provider_not_called';
        continue;
      }
      const requestedAt=reached.wallAt;
      let sample;
      try{sample=await collector.sample(launched.root);}
      catch(e){
        current.failure='provider_collection_failed';
        const reply=observeQuietClock(anchor);
        current.timing=quietTimingEvidence({requestedAt,receivedAt:reply.wallAt},quietAt+checkpoint,snapshots.at(-1));
        result.memoryMissing=reason(e);
        await stopCollector();
        continue;
      }
      const {wallAt:receivedAt}=observeQuietClock(anchor);
      const observation={...sample,requestedAt,receivedAt};
      current.timing=quietTimingEvidence(observation,quietAt+checkpoint,snapshots.at(-1));
      snapshots.push(observation);
      remember(sample);
    }
    if(snapshots.length===CHECKPOINTS.length){
      try{stamp=memoryArm(snapshots,quietAt,warm);}
      catch(e){result.memoryMissing=reason(e);}
    }else result.memoryMissing??='at least one planned native provider observation missing';
    await stopCollector();
    // Wake can stand alone after a measurement-only hold. Both clocks must
    // have crossed both planned slots, the collector is gone, and the
    // existing unchanged foreground/inventory checks still precede input.
    // No browser inspection/navigation before both qualified snapshots.
    // The slower broad Windows inventory is now used only for cleanup.
    cdp=await endpoint(launched.profile);
    const settledFront=await pageProof(cdp,front,0);
    assert(settledFront?.visible===true&&settledFront.origin===initialFront.origin&&settledFront.token===initialFront.token&&
      settledFront.title===title(0)&&settledFront.text===title(0)&&settledFront.dpr===initialFront.dpr&&
      settledFront.width===initialFront.width&&settledFront.height===initialFront.height&&Array.isArray(settledFront.seen)&&
      settledFront.seen.length<32&&!settledFront.seen.some(([at,state])=>at>=quietAt&&state!=='visible')&&covered(),
    'real foreground changed/reloaded, became hidden or another fixture navigated before wake');
    result.viewport=[settledFront.width,settledFront.height,settledFront.dpr];
    result.memory=stamp??null;
    try{
      if(isDex){
        const s=await profileEval(cdp,shell.targetId,'dex:get-state');
        const m=await profileEval(cdp,shell.targetId,'dex:memory');
        stockInCap(m);
        assert(s.active===ids[0]&&s.tabs.length===9&&!s.memNotice&&s.tabs.every(t=>urls[ids.indexOf(t.id)]===t.url));
        const events=await cdp.eval(shell.targetId,'window.__longIdleSleepEvents');
        result.stockLifecycle={passiveSleptAfterMs:events.map(e=>({offsetMs:e.at-quietAt,asleep:e.asleep})),
          markedSleepingAfterBothOsSamples:s.tabs.filter(t=>ids.slice(1).includes(t.id)&&t.sleeping).length};
        await profileEval(cdp,shell.targetId,'dex:activate-tab',ids[WAKE_SLOT]);
        await waitFor(async()=>{
          const selected=await profileEval(cdp,shell.targetId,'dex:get-state');
          const tab=selected?.tabs?.find(t=>t.id===ids[WAKE_SLOT]);
          return selected?.active===ids[WAKE_SLOT]&&tab?.url===urls[WAKE_SLOT]&&
            tab?.title===title(WAKE_SLOT)&&!tab.loading&&!tab.sleeping;
        },'same real Dexerion tab selection before page inspection',16000);
      }else{
        // Inspect metadata only: CDP Target.activateTarget explicitly
        // falls back to loading missing documents, which would confound this
        // check. Use ordinary Windows Ctrl+5 on the exact launched window.
        const {targetInfo}=await cdp.send('Target.getTargetInfo',{targetId:edgeTab});
        assert(targetInfo.type==='tab'&&targetInfo.url===urls[WAKE_SLOT]);
        result.stockLifecycle={nativeTabWasUnloadedIfReported:typeof targetInfo.subtype==='string'?targetInfo.subtype==='unloaded':null};
        stockEdgeSelect(launched.root);
      }
      let woke;
      const chosen=await waitFor(async()=>{
        const list=(await targets(cdp)).filter(t=>t.url===urls[WAKE_SLOT]);
        if(list.length!==1)return null;
        const doc=await pageProof(cdp,list[0].targetId,WAKE_SLOT);
        const observed=records.loads[WAKE_SLOT];
        if(!doc?.visible||doc.title!==title(WAKE_SLOT)||doc.text!==title(WAKE_SLOT)||
          !observed.some(r=>r.document?.token===doc.token))return null;
        woke=doc;return list[0].targetId;
      },'normal stock tab activation produces visible fixture',16000);
      const observedCookie=await cdp.eval(chosen,`fetch('/cookie/${WAKE_SLOT}',{credentials:'same-origin'}).then(r=>r.json())`);
      assert.equal(records.checks[WAKE_SLOT],1);
      const sequence=records.loads[WAKE_SLOT].map(r=>r.document);
      assert(records.loads.every((r,i)=>i===WAKE_SLOT||r.length===1),'activation affected a different fixture');
      if(isDex){
        const s=await profileEval(cdp,shell.targetId,'dex:get-state');
        assert(s.active===ids[WAKE_SLOT]&&s.tabs.length===9&&s.tabs.some(t=>t.id===ids[WAKE_SLOT]&&
          t.url===urls[WAKE_SLOT]&&t.title===title(WAKE_SLOT)&&!t.loading&&!t.sleeping),'same Dexerion tab identity unverified on wake');
      }
      result.wake=wakeEvidence(firstWake,woke,sequence,sentinel(WAKE_SLOT),observedCookie);
    }catch(e){result.wakeMissing=reason(e);}
    const g=cleanupInventory();
    observedIds.push(...readOwnedSnapshot(g.raw,launched.root,browserNames[kind],launched.profile,g.at,g.end).identities);
  }catch(e){result.missing=reason(e);}
  finally{
    if(collector){
      try{await collector.close();}
      catch(e){result.cleanupMissing=reason(e);}
    }
    if(launched){
      try{await launched.close(cdp);await ownedCleanup(observedIds,nativeGenerations,launched.profile);}
      catch(e){result.cleanupMissing=reason(e);}
    }
  }
  return result;
}
async function main(){
  assert(process.platform==='win32'&&process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REF==='refs/heads/dev-V'&&
    /^[a-f0-9]{40}$/.test(SHA||''),'hosted Windows dev-V only');
  assert(!Object.keys(process.env).some(x=>/^DEX_/i.test(x)),'non-default environment override present');
  const [dex,out,...extra]=process.argv.slice(2);
  assert(dex&&out&&!extra.length&&path.isAbsolute(dex)&&path.isAbsolute(out)&&path.basename(dex).toLowerCase()==='dexerion.exe');
  const asar=path.join(path.dirname(dex),'resources','app.asar');
  const files={dexerion:dex,edge:edgeExecutable()};
  const report={sourceSha:SHA,order:ORDER,workload:{visibleTabs:1,backgroundTabs:8,distinctFixtureOrigins:8,selectedTabPosition:5,staticReadingOnly:true},
    dexExeSha256:digest(dex),dexAsarSha256:digest(asar),edgeExeSha256:digest(files.edge),arms:{},
    scope:'ONE serial same-host exploratory pair. Whole owned Windows tree private resident only during quiet, timestamped by Windows PerfProc QPC after one prewarm outside the window; browser observer disconnected. Wake fidelity is independent after both elapsed checkpoints and unchanged workload provenance; no paired delta for an invalid memory arm. Desk host/browser order, site and engine dependence remain. No CPU/GPU/power, performance target or feature parity conclusion.'};
  const f=await listenFixture();
  try{
    for(const kind of ORDER){
      if(report.arms.edge?.cleanupMissing)break;
      report.arms[kind]=await runArm(kind,files[kind],asar,f);
      if(report.arms[kind].missing)console.error(kind+': '+report.arms[kind].missing);
      else if(report.arms[kind].memoryMissing)console.error(kind+' memory: '+report.arms[kind].memoryMissing);
      await wait(2500);
    }
    const {edge,dexerion}=report.arms;
    report.idleMemory=null;
    report.wakeComparison=wakeComparison(edge?.wake,dexerion?.wake);
    report.fidelityContrast=report.wakeComparison.summary;
    if(edge?.memory&&dexerion?.memory&&edge.viewport[2]===dexerion.viewport[2]&&
      !edge.missing&&!dexerion.missing&&!edge.cleanupMissing&&!dexerion.cleanupMissing){
      if(report.wakeComparison.classification==='unresolved'){
        report.pairedMemoryMissing='wake evidence unresolved; raw per-arm samples only, no paired inference';
      }else{
        try{report.idleMemory=memoryPair(edge.memory,dexerion.memory);}
        catch(e){report.pairedMemoryMissing=reason(e);}
      }
    }
    report.complete=Boolean(report.idleMemory?.every(s=>s.dexerionMinusEdgeBytes!==null)&&
      report.wakeComparison.classification!=='unresolved');
  }finally{
    f.server.closeAllConnections();await new Promise(r=>f.server.close(r));
    fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  }
  if(!report.complete)process.exitCode=1;
  console.log('Matched quiet memory evidence:',Boolean(report.idleMemory),';',report.fidelityContrast);
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={BrowserCdp,endpoint,listenFixture};
