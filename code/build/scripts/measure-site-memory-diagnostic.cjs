'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const http=require('node:http');
const path=require('node:path');
const { createHash }=require('node:crypto');
const { execFileSync }=require('node:child_process');
const { once }=require('node:events');
const { fileURLToPath }=require('node:url');
const { setTimeout:sleep }=require('node:timers/promises');
const { chromium }=require('@playwright/test');
const {openNative,edgeExecutable,pagesIn,isShellUrl,waitFor}=require('./measure-native-browser.cjs');
const {matchesInventory,verifiedNativeTree}=require('./measure-sample-guard.cjs');
const {verifiedFramePid,verifiedSiteRows,readHeapUsage,readAllocatorDump,CATEGORIES}=require('./read-site-memory-diagnostic.cjs');

const PAIRS=3;
const SHA=process.env.GITHUB_SHA;
const origin=(n,port)=>'http://site-memory-'+n+'.localhost:'+port;
const order=Array.from({length:9},(_,i)=>i);
const known=new Set(order);
const frameCategory='disabled-by-default-devtools.timeline';
const memCategory='disabled-by-default-memory-infra';
const mib=n=>Number.isFinite(n)?n/1048576:null;
const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function fixedPage(i){
  const title='Memory PB '+i;
  const h='<!doctype html><meta charset=utf-8><title>'+title+'</title>';
  const body='<body style="margin:0;color:#172033;background:#eceef2">';
  const content='<main><h1>'+title+'</h1>'+Array.from({length:30},(_,k)=>'<p>Fixed local reading paragraph '+k+'</p>').join('')+'</main>';
  if(i!==0)return h+body+content+'</body>';
  return h+body+`<canvas id="probe" width="700" height="450" style="display:block"></canvas>`+content+`
    <script>
    let n=0; const c=document.getElementById('probe').getContext('2d');
    function paint(){
      n++;window.probeFrames=n;
      c.fillStyle='#eceef2';c.fillRect(0,0,700,450);
      for(let j=0;j<17;j++){
        c.fillStyle='hsl('+((j*13+n/6)%360)+' 70% 50%)';
        c.fillRect(320+230*Math.sin(n/50+j),190+125*Math.cos(n/60+j),14,14);
      }
      requestAnimationFrame(paint);
    } requestAnimationFrame(paint);
    </script></body>`;
}
function snapshot(){
  const script=path.join(__dirname,'measure-tree-snapshot.ps1');
  return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-File',script,'-IncludePrivateWorkingSet'],{
    encoding:'utf8',timeout:18000,maxBuffer:20*1024*1024,windowsHide:true,
  }).trim());
}
function pidRows(sample,session,kind){
  const name=kind==='edge'?'msedge.exe':'dexerion.exe';
  const tree=verifiedNativeTree(sample.processes,session.processId,p=>p.name.toLowerCase()===name&&
    p.cmdline?.toLowerCase().includes(session.profileDir.toLowerCase())&&
    !/(?:^|\s)--(?:no-sandbox|disable-web-security|disable-gpu|disable-site-isolation-trials)(?:[=\s]|$)/i.test(p.cmdline));
  assert(!tree.unknownParentReferences&&!tree.staleParentReferences,'uncertain Windows process attribution');
  return tree.rows;
}
function during(p,ms,label){
  return Promise.race([p,sleep(ms,null,{ref:false}).then(()=>{throw new Error(label+' timed out');})]);
}
async function trace(cdp,category,task){
  let resolve, total=0, consumed=0;
  const events=[];
  const stopped=new Promise(r=>resolve=r);
  const onData=({value})=>{
    total+=value.length;
    if(total>80000)return;
    for(const e of value) {
      if(e.name==='TracingStartedInBrowser'||e.ph==='v'&&e.args?.dumps) {
        consumed+=JSON.stringify(e).length;
        if(consumed<=16*1024*1024)events.push(e);
      }
    }
  };
  const onFinish=result=>resolve(result);
  cdp.on('Tracing.dataCollected',onData);
  cdp.on('Tracing.tracingComplete',onFinish);
  try{
    await cdp.send('Tracing.start',{
      transferMode:'ReportEvents',traceConfig:{recordMode:'recordUntilFull',includedCategories:[category],
        excludedCategories:['*'],...(category===memCategory?{memoryDumpConfig:{triggers:[]}}:{})}
    });
    let action;
    try{action=await task();}
    finally{
      await cdp.send('Tracing.end');
      const finish=await during(stopped,13000,'trace drain');
      assert(!finish.dataLossOccurred&&total<=80000&&consumed<=16*1024*1024,'trace incomplete/too large');
    }
    return {action,events};
  }finally{
    cdp.off('Tracing.dataCollected',onData);
    cdp.off('Tracing.tracingComplete',onFinish);
  }
}
async function usingPage(page,fn){
  const cdp=await page.context().newCDPSession(page);
  try{return await fn(cdp);}
  finally{await cdp.detach().catch(()=>{});}
}
async function identify(cdp,url){
  const [{frameTree},{id:isolate}]=await Promise.all([cdp.send('Page.getFrameTree'),cdp.send('Runtime.getIsolateId')]);
  assert(frameTree.frame.url===url&&typeof frameTree.frame.id==='string'&&
    typeof frameTree.frame.loaderId==='string'&&typeof isolate==='string'&&isolate&&
    !(frameTree.childFrames?.length),'wrong page document or isolate');
  return {frame:frameTree.frame,isolate};
}
async function probeArm(kind,exe,urls){
  const dex=kind==='dexerion';
  const session=await openNative(kind,{chromium,executable:exe,packaged:dex,cwd:path.dirname(exe)});
  try{
    const pageAt=url=>pagesIn(session.browser).filter(p=>p.url()===url);
    const archive=path.join(path.dirname(exe),'resources','app.asar');
    let nativeTabs,nativeDexPids;
    if(dex){
      const shell=await waitFor(()=>pagesIn(session.browser).find(p=>isShellUrl(p.url())),'shipped shell');
      assert.equal(path.relative(path.join(archive,'src','renderer','shell.html'),fileURLToPath(shell.url())),'');
      const state=()=>shell.evaluate(()=>window.dexerion?.invoke('dex:get-state'));
      const s=await waitFor(async()=>{const s=await state();return s?.active&&s.tabs?.length===1&&s;},'initial native tab');
      const id=s.active;
      await shell.evaluate(([id,url])=>window.dexerion.invoke('dex:navigate',id,url),[id,urls[0]]);
      for(const u of urls.slice(1))await shell.evaluate(url=>window.dexerion.invoke('dex:new-tab',url,true),u);
      nativeTabs=async()=>{
        const s=await state();
        return s?.active===id&&s.tabs.every(t=>!t.loading)?s.tabs.map(t=>t.url):null;
      };
      nativeDexPids=async()=>{
        const s=await state(), m=await shell.evaluate(()=>window.dexerion.invoke('dex:memory'));
        const pids=new Map(m.tabs.map(t=>[t.tabId,t.pid]));
        return urls.map(url=>pids.get(s.tabs.find(t=>t.url===url)?.id));
      };
    }else{
      const c=session.browser.contexts()[0];
      const first=c.pages()[0]||await c.newPage();
      await first.goto(urls[0],{waitUntil:'load'});
      for(const u of urls.slice(1)){
        const page=await c.newPage();await page.goto(u,{waitUntil:'load'});
      }
      await first.bringToFront();
      nativeTabs=()=>c.pages().map(p=>p.url());
    }
    async function inventory(){
      const {targetInfos:targets}=await session.devtools.send('Target.getTargets');
      return matchesInventory(await nativeTabs(),urls)&&urls.every(u=>pageAt(u).length===1)&&
        matchesInventory(targets.filter(t=>t.type==='page'&&urls.includes(t.url)).map(t=>t.url),urls);
    }
    await waitFor(inventory,'exact native nine-host inventory');
    const pages=urls.map(url=>pageAt(url)[0]);
    const mapped=[];
    for(const [i,page] of pages.entries()){
      mapped.push(await usingPage(page,async cdp=>{
        const {frame,isolate}=await identify(cdp,urls[i]);
        const info=await trace(cdp,frameCategory,async()=>null);
        return {pid:verifiedFramePid(info.events,frame),isolate,frameId:frame.id,loaderId:frame.loaderId};
      }));
    }
    if(dex)assert.deepEqual(mapped.map(p=>p.pid),await nativeDexPids(),'trusted shell and CDP disagree on tab renderer PID');
    await sleep(18000);
    const foreground=async()=>pages[0].evaluate(()=>{
      const c=document.getElementById('probe'),r=c?.getBoundingClientRect();
      return {stamp:performance.now(),origin:performance.timeOrigin,visible:document.visibilityState==='visible',
        title:document.title,width:innerWidth,height:innerHeight,dpr:devicePixelRatio,frames:window.probeFrames,
        fits:r&&r.left===0&&r.top===0&&r.width===700&&r.height===450&&r.right<=innerWidth&&r.bottom<=innerHeight};
    });
    const f1=await foreground();
    await sleep(1500);
    const f2=await foreground();
    assert(f1.visible&&f2.visible&&f1.fits&&f2.fits&&f2.title==='Memory PB 0'&&f1.origin===f2.origin&&
      f1.width===f2.width&&f1.height===f2.height&&f1.dpr===f2.dpr,'foreground fixture was hidden, clipped or replaced');
    const fps=(f2.frames-f1.frames)*1000/(f2.stamp-f1.stamp);
    assert(fps>=30&&Number.isFinite(fps),'foreground did not advance matched work');
    assert(await inventory());
    const a=pidRows(snapshot(),session,kind);
    const heap=[];
    for(const [i,page] of pages.entries()){
      heap.push(await usingPage(page,async cdp=>{
        const {frame,isolate}=await identify(cdp,urls[i]);
        const previous=mapped[i];
        assert(frame.id===previous.frameId&&frame.loaderId===previous.loaderId&&isolate===previous.isolate,
          'fixture document or isolate changed after mapping');
        return readHeapUsage(await cdp.send('Runtime.getHeapUsage'));
      }));
    }
    let allocator=null,allocatorError=null;
    try{
      const dump=await trace(session.devtools,memCategory,()=>during(session.devtools.send(
        'Tracing.requestMemoryDump',{deterministic:false,levelOfDetail:'detailed'}),18000,'native allocator dump'));
      allocator=readAllocatorDump(dump.events,dump.action,mapped.map(x=>x.pid));
    }catch(e){
      allocatorError=String(e?.message||e).split('\n')[0];
    }
    const b=pidRows(snapshot(),session,kind);
    assert(await inventory());
    const f3=await foreground();
    assert(f3.visible&&f3.fits&&f3.origin===f2.origin&&f3.dpr===f2.dpr);
    const renderer=verifiedSiteRows(mapped,a,b);
    const browserVersion=(await session.devtools.send('Browser.getVersion')).product;
    const rows=renderer.map((r,i)=>({tab:i,privateResidentBeforeBytes:r.privateResidentBeforeBytes,
      privateResidentAfterBytes:r.privateResidentAfterBytes,...heap[i],
      allocator:allocator?.rows[i]?.categories??null,allocatorRoots:allocator?.rows[i]?.dumpRootNames??null}));
    return {browserVersion,workloadTabs:9,fps,viewport:[f2.width,f2.height,f2.dpr],rows,
      allocatorFormat:allocator?.format??null,allocatorError};
  }finally{await session.close();}
}
const sum=xs=>xs.every(Number.isFinite)?xs.reduce((s,x)=>s+x,0):null;
const med=xs=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
function summarize(pairs){
  const f=['privateResidentBeforeBytes','privateResidentAfterBytes','jsHeapUsedBytes','jsHeapAllocatedBytes',
    'embedderGcHeapUsedBytes','arrayBufferAndStringBackingBytes'];
  const totals=(phase,filter)=>{
    const pick=(arm,fn)=>sum(arm.rows.filter(filter).map(fn));
    const report=fn=>{
      const valid=pairs.map(p=>[pick(p.edge,fn),pick(p.dexerion,fn)]).filter(x=>x.every(Number.isFinite));
      if(valid.length!==pairs.length||!valid.length)return {pairs:valid.length,edgeMiB:null,dexerionMiB:null,deltaMiB:null};
      const ds=valid.map(([a,b])=>b-a);
      return {pairs:valid.length,edgeMiB:mib(med(valid.map(x=>x[0]))),dexerionMiB:mib(med(valid.map(x=>x[1]))),
        deltaMiB:mib(med(ds)),deltaRangeMiB:[mib(Math.min(...ds)),mib(Math.max(...ds))]};
    };
    const out=Object.fromEntries(f.map(k=>[k,report(r=>r[k])]));
    out.allocatorEffectiveBytes=Object.fromEntries(CATEGORIES.map(k=>[k,report(r=>r.allocator?.[k]?.effectiveBytes)]));
    out.allocatorSizeBytes=Object.fromEntries(CATEGORIES.map(k=>[k,report(r=>r.allocator?.[k]?.sizeBytes)]));
    return [phase,out];
  };
  return Object.fromEntries([totals('allFixtureTabs',()=>true),totals('foreground',r=>r.tab===0),totals('background',r=>r.tab!==0)]);
}
async function main(){
  assert(process.platform==='win32'&&process.env.GITHUB_ACTIONS==='true'&&
    process.env.GITHUB_REF==='refs/heads/dev-V'&&/^[a-f0-9]{40}$/.test(SHA||''),'hosted Windows dev-V only');
  const [dex,out]=process.argv.slice(2);
  assert(dex&&out&&path.isAbsolute(dex)&&path.isAbsolute(out)&&path.basename(dex).toLowerCase()==='dexerion.exe');
  const archive=path.join(path.dirname(dex),'resources','app.asar');
  const executables={edge:edgeExecutable(),dexerion:dex};
  const stash={sourceSha:SHA,exeSha256:digest(dex),appAsarSha256:digest(archive),pairs:[],failed:[]};
  let port;
  const server=http.createServer((req,res)=>{
    const m=String(req.headers.host).match(/^site-memory-(\d+)\.localhost:(\d+)$/);
    const i=Number(m?.[1]);
    if(m&&Number(m[2])===port&&known.has(i)&&req.method==='GET'&&req.url==='/work') {
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}).end(fixedPage(i));
    }else res.writeHead(404).end();
  });
  try{
    const started=once(server,'listening');server.listen(0,'127.0.0.1');await started;
    port=server.address().port;
    const urls=order.map(i=>origin(i,port)+'/work');
    for(let i=0;i<PAIRS;i++){
      const row={};
      try{
        for(const arm of (i%2?['dexerion','edge']:['edge','dexerion'])) {
          row[arm]=await probeArm(arm,executables[arm],urls);
        }
        assert(row.edge.viewport[2]===row.dexerion.viewport[2]&&
          Math.abs(row.edge.fps-row.dexerion.fps)<=Math.max(3,row.edge.fps*0.05),'browser foreground work parity mismatch');
        stash.pairs.push(row);
      }catch(e){
        const err=String(e?.message||e).split('\n')[0];
        stash.failed.push({pair:i+1,error:err});
        console.error('Pair '+(i+1)+': '+err);
      }
    }
  }finally{
    server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));
    const versions=['edge','dexerion'].map(k=>new Set(stash.pairs.map(p=>p[k].browserVersion)).size);
    stash.complete=stash.pairs.length===PAIRS&&versions.every(x=>x===1);
    stash.summary=stash.complete?summarize(stash.pairs):null;
    stash.scope='Owned 9 fixture renderer OS private working sets beside separately measured JS/GC/backing and optional Chromium allocator counters. No subtraction/addition across these counter domains, and no app-, real-site-, power-, causal or universal conclusion.';
    fs.writeFileSync(out,JSON.stringify(stash,null,2)+'\n',{flag:'wx'});
    console.log('Site memory parity pairs:',stash.pairs.length,
      'with full allocator dumps:',stash.pairs.filter(p=>['edge','dexerion'].every(a=>p[a].rows.every(r=>r.allocator))).length);
  }
  if(!stash.complete)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
