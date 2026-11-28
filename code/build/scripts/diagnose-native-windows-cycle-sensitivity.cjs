'use strict';
const assert=require('node:assert/strict');
const path=require('node:path'),fs=require('node:fs'),http=require('node:http');
const {spawn}=require('node:child_process'),{createInterface}=require('node:readline');
const {once}=require('node:events'),{setTimeout:sleep}=require('node:timers/promises');
const {fileURLToPath}=require('node:url'),{createHash}=require('node:crypto');
const {chromium}=require('@playwright/test');
const {openNative,edgeExecutable,pagesIn,isShellUrl,waitFor}=require('./measure-native-browser.cjs');
const {verifiedFramePid}=require('./read-site-memory-diagnostic.cjs');
const {summarizeInterval}=require('./windows-cycle-interval.cjs');
const TIME=7500,SETTLE=6500,CATEGORY='disabled-by-default-devtools.timeline';
const MODES=['quiet','light','positive'];
const ARMS=['edge','dexerion'];
const digest=b=>createHash('sha256').update(b).digest('hex');
function timed(p,ms,name){return Promise.race([p,sleep(ms,null,{ref:false}).then(()=>{throw new Error(name+' timed out');})]);}
function fixture(mode){
  // Light workload matches the existing canvas shape and 28 arc/frame paint,
  // dynamic title and simple 250 ms style toggle. The separate positive
  // control adds small bounded JS work to the local synthetic page only.
  return `<!doctype html><meta charset=utf-8><title>CPU sensitivity ${mode}</title>
    <body style="margin:0;background:#101018;overflow:hidden">
    <canvas id="c" width="960" height="640" style="display:block;width:928px;height:592px"></canvas>`+
    (mode==='quiet'?'':`<script>
    const c=document.getElementById('c'),x=c.getContext('2d');
    let f=0,work=0;
    function frame(){
      f++;x.fillStyle='#101018';x.fillRect(0,0,c.width,c.height);
      for(let i=0;i<28;i++){
        const a=(f/30+i/28)*Math.PI*2;
        x.fillStyle='hsl('+((i*13+f/4)%360)+' 80% 55%)';
        x.beginPath();x.arc(480+Math.cos(a)*300,320+Math.sin(a*1.7)*180,8+(i%5)*3,0,Math.PI*2);x.fill();
      }
      if(f%30===0)document.title='Measure probe frame '+f;
      if(${mode==='positive'}){
        const now=performance.now();
        while(performance.now()-now<2){}
        work+=performance.now()-now;
      }
      window.probeFrames=f;window.probeBusyWork=work;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    setInterval(()=>document.body.style.background=f%2?'#101018':'#14141f',250);
    </script>`)+ '</body>';
}
async function framePid(page,url){
  const cdp=await page.context().newCDPSession(page);
  let stop;const ended=new Promise(r=>stop=r);
  const trace=[];
  cdp.on('Tracing.dataCollected',({value})=>{
    for(const e of value)if(e.name==='TracingStartedInBrowser')trace.push(e);
  });
  cdp.once('Tracing.tracingComplete',stop);
  try{
    const {frameTree:t}=await cdp.send('Page.getFrameTree');
    assert.equal(t.frame.url,url);
    assert(!t.childFrames?.length,'unexpected child frame');
    await cdp.send('Tracing.start',{transferMode:'ReportEvents',traceConfig:{
      recordMode:'recordUntilFull',includedCategories:[CATEGORY],excludedCategories:['*'],
    }});
    await cdp.send('Tracing.end');
    const finished=await timed(ended,12000,'frame metadata trace');
    assert(!finished.dataLossOccurred,'trace lost frame records');
    return {pid:verifiedFramePid(trace,t.frame),loaderId:t.frame.loaderId,frameId:t.frame.id};
  }finally{await cdp.detach().catch(()=>{});}
}
async function verifyFrame(page,url,expected){
  const cdp=await page.context().newCDPSession(page);
  try{
    const {frameTree:t}=await cdp.send('Page.getFrameTree');
    assert.equal(t.frame.url,url);assert.equal(t.frame.loaderId,expected.loaderId);
    assert.equal(t.frame.id,expected.frameId);
  }finally{await cdp.detach().catch(()=>{});}
}
async function openMeter(ids,exe,launched){
  const meter=spawn('pwsh.exe',['-NoLogo','-NoProfile','-File',path.join(__dirname,'query-owned-windows-cpu.ps1'),
    '-KnownPids',ids.join(',')],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  const events=createInterface({input:meter.stdout});
  const iterator=events[Symbol.asyncIterator]();
  let error='',spawnError;
  meter.on('error',e=>{spawnError=e;});
  meter.stdin.on('error',()=>{});
  meter.stderr.on('data',data=>{error=(error+String(data)).slice(-750);});
  const next=async()=>{
    if(spawnError)throw spawnError;
    const r=await timed(iterator.next(),20000,'Windows read-only CPU meter');
    if(r.done)throw new Error('Windows meter exited: '+error.replace(/\s+/g,' ').trim());
    return JSON.parse(r.value);
  };
  const stop=async()=>{
    try{if(meter.exitCode===null){meter.stdin.end('stop\n');await Promise.race([once(meter,'exit').catch(()=>{}),sleep(1800)]);}}
    finally{events.close();if(meter.exitCode===null&&!meter.signalCode)try{meter.kill();}catch{}}
  };
  try{
    const ready=await next();
    assert(ready.kind==='ready'&&ready.rows.length===2);
    const generations=new Map(ready.rows.map(x=>[x.pid,x.started]));
    const time=ms=>BigInt(ms)*10000n+116444736000000000n;
    assert.equal(generations.size,2);
    for(const p of ready.rows){
      assert(ids.includes(p.pid)&&path.relative(p.image,exe)==='','owned PID image differs from exact executable');
      assert(BigInt(p.started)>=time(launched-3000)&&BigInt(p.started)<=time(Date.now()+2000),'stale PID generation');
    }
    return {ready,stop,generations,
      sample:async()=>{meter.stdin.write('sample\n');return next();}};
  }catch(e){await stop();throw e;}
}
async function openBrowser(kind,exe,base){
  const launched=Date.now(),dex=kind==='dexerion';
  const session=await openNative(kind,{chromium,executable:exe,cwd:path.dirname(exe),packaged:dex});
  try{
    let open,verify,nativeRenderer;
    if(dex){
      const shell=await waitFor(()=>pagesIn(session.browser).find(p=>isShellUrl(p.url())),'app shell');
      const archive=path.join(path.dirname(exe),'resources','app.asar','src','renderer','shell.html');
      assert.equal(path.relative(archive,fileURLToPath(shell.url())),'');
      const state=()=>shell.evaluate(()=>window.dexerion.invoke('dex:get-state'));
      const boot=await waitFor(async()=>{const s=await state();return s.active&&s.tabs.length===1&&s.active;},'normal single tab');
      open=async url=>shell.evaluate(([id,u])=>window.dexerion.invoke('dex:navigate',id,u),[boot,url]);
      verify=async url=>{const s=await state();return s.active===boot&&s.tabs.length===1&&s.tabs[0].url===url&&!s.tabs[0].loading;};
      nativeRenderer=async()=>shell.evaluate(id=>window.dexerion.invoke('dex:memory').then(m=>m.tabs.find(t=>t.tabId===id)?.pid),boot);
    }else{
      const c=session.browser.contexts()[0];
      const first=c.pages()[0]||await c.newPage();
      open=async url=>{await first.goto(url,{waitUntil:'load'});await first.bringToFront();};
      verify=url=>c.pages().length===1&&c.pages()[0].url()===url;
    }
    const version=(await session.devtools.send('Browser.getVersion')).product;
    const results={};
    for(const mode of MODES){
      const url=base+'/'+mode;
      await open(url);
      const page=await waitFor(async()=>await verify(url)&&pagesIn(session.browser).find(p=>p.url()===url),'loaded exact visible fixture');
      await page.waitForLoadState('load');
      const gen=await framePid(page,url);
      if(dex)assert.equal(await nativeRenderer(),gen.pid,'CDP and actual shell renderer PID disagree');
      const ids=[session.processId,gen.pid];
      const meter=await openMeter(ids,exe,launched);
      try{
        // All frame trace sessions ended before this settle and measurement.
        await sleep(SETTLE);
        const state=()=>page.evaluate(()=>{
          const c=document.querySelector('#c'),r=c.getBoundingClientRect();
          return {visible:document.visibilityState==='visible',clock:performance.now(),origin:performance.timeOrigin,
            frames:window.probeFrames||0,work:window.probeBusyWork||0,
            area:[innerWidth,innerHeight,devicePixelRatio],fits:c.width===960&&c.height===640&&r.width===928&&r.height===592&&r.right<=innerWidth&&r.bottom<=innerHeight};
        });
        const before=await state();
        const a=await meter.sample();
        await sleep(TIME);
        const b=await meter.sample();
        const after=await state();
        await verifyFrame(page,url,gen);
        if(dex)assert.equal(await nativeRenderer(),gen.pid);
        assert(await verify(url));
        assert(before.visible&&after.visible&&before.fits&&after.fits&&before.origin===after.origin);
        assert.deepEqual(before.area,after.area);
        const frameWall=after.clock-before.clock;
        const frames=after.frames-before.frames,calibrationBusyMilliseconds=after.work-before.work;
        const interval=summarizeInterval(ids,meter.generations,meter.ready.frequency,a,b,TIME);
        assert(Math.abs(frameWall-interval.wallMs)<250,'visible page and exact counter windows diverged');
        const fps=frames*1000/frameWall;
        if(mode==='quiet')assert(frames===0&&calibrationBusyMilliseconds===0,'quiet fixture was not static');
        if(mode==='light')assert(fps>=30&&calibrationBusyMilliseconds===0,'light fixture was invalid');
        if(mode==='positive')assert(fps>=30&&calibrationBusyMilliseconds>=frames*1.85,'positive fixture did not actually do work');
        results[mode]={...interval,frames,fps,calibrationBusyMilliseconds,viewport:before.area};
      }finally{await meter.stop();}
    }
    const rate=r=>Number(BigInt(r.renderer.cycleDelta))*1000/r.wallMs;
    const recognized=rate(results.positive)>rate(results.quiet)*1.75+1e6;
    return {version,results,calibrationCycleMeterDetectsWork:recognized,
      lightCyclesAboveQuiet:rate(results.light)>rate(results.quiet)*1.25+1e6,
      lightNonZeroWhileGetProcessTimesZero:BigInt(results.light.renderer.cycleDelta)>0n&&results.light.renderer.counterCpuMs===0};
  }finally{await session.close();}
}
async function main(){
  assert(process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REF==='refs/heads/dev-V'&&process.platform==='win32');
  assert(/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA||''));
  const [exe,out]=process.argv.slice(2);
  assert(path.isAbsolute(exe)&&path.isAbsolute(out));
  const bin={dexerion:exe,edge:edgeExecutable()}, pairs=[],failures=[];
  const server=http.createServer((req,res)=>{
    const mode=req.url?.slice(1);
    if(!MODES.includes(mode)||req.method!=='GET')return res.writeHead(404).end();
    res.writeHead(200,{'content-type':'text/html;charset=utf-8','cache-control':'no-store'}).end(fixture(mode));
  });
  const started=once(server,'listening');server.listen(0,'127.0.0.1');await started;
  const base='http://127.0.0.1:'+server.address().port;
  try{
    for(let i=0;i<2;i++){
      const p={};
      try{
        for(const arm of (i?[...ARMS].reverse():ARMS))p[arm]=await openBrowser(arm,bin[arm],base);
        for(const k of MODES){
          const a=p.edge.results[k],b=p.dexerion.results[k];
          assert(a.viewport[2]===b.viewport[2]&&Math.abs(a.fps-b.fps)<=Math.max(3,a.fps*.05),'content cadence/surface scale mismatch at '+k);
        }
        pairs.push(p);
      }catch(e){failures.push({pair:i+1,error:String(e.message).split('\n')[0]});}
    }
  }finally{
    server.closeAllConnections();await new Promise(r=>server.close(r));
    const supportsMeasurement=pairs.length===2&&
      ARMS.every(arm=>new Set(pairs.map(p=>p[arm].version)).size===1&&pairs.every(p=>p[arm].calibrationCycleMeterDetectsWork));
    const counts=Object.fromEntries(ARMS.map(arm=>[arm,{
      lightCyclesVisibleWhenTimeZero:pairs.filter(p=>p[arm].lightNonZeroWhileGetProcessTimesZero).length,
      lightCyclesAboveQuiet:pairs.filter(p=>p[arm].lightCyclesAboveQuiet).length,
    }]));
    const result={source:process.env.GITHUB_SHA,
      appAsarSha256:digest(fs.readFileSync(path.join(path.dirname(exe),'resources','app.asar'))),
      perWindowMs:TIME,settleMs:SETTLE,pairs,failures,supportsMeasurement,counts,
      scope:'Two exact owned Windows handles per phase, no system process/cSwitch collection. Raw counter-cycle sensitivity only, not time conversion, whole-tree CPU, percent-of-Edge, GPU or power. Positive pages are separate synthetic controls.'};
    fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
    console.log('Cycle sensitivity paired results:',JSON.stringify({supportsMeasurement,counts,failures}));
    if(!supportsMeasurement)process.exitCode=1;
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
