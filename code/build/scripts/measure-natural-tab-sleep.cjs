'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {once}=require('node:events');
const {execFileSync}=require('node:child_process');
const {fileURLToPath}=require('node:url');
const {setTimeout:wait}=require('node:timers/promises');
const {createHash}=require('node:crypto');
const {chromium}=require('@playwright/test');
const {openNative,pagesIn,isShellUrl,waitFor}=require('./measure-native-browser.cjs');
const {snapshot,choosePre,phase,transition}=require('./read-natural-tab-sleep.cjs');

const SHA=process.env.GITHUB_SHA;
const SLOTS=['front','shared','dedicated-a','dedicated-b'];
const BACKGROUND=SLOTS.slice(1);
const NATURAL_FLOOR=180000,DEADLINE=300000;
const PRE=[35,80,145,172,212,236,268].map(x=>x*1000);
const blobSha=buf=>createHash('sha256').update(buf).digest('hex');
const digest=file=>blobSha(fs.readFileSync(file));
const ownProfileFlags=/^DEX_/i;
const marker=slot=>'PB-'+slot;
const title=slot=>'Dexerion sleep control: '+slot;
const favicon='/icon.svg';
const icon='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" fill="#369"/></svg>';
const cookie=(slot)=>'dex-sleep-probe='+marker(slot);
const fixture=(slot,count)=>`<!doctype html><meta charset=utf-8><title>${title(slot)}</title>
<link rel="icon" type="image/svg+xml" href="${favicon}">
<main id="fixture">${marker(slot)}</main><script>
const key='dexerion-natural-sleep-fixture', value=${JSON.stringify(marker(slot))};
const previous=localStorage.getItem(key);
if(${JSON.stringify(slot.startsWith('dedicated'))})localStorage.setItem(key,value);
window.probe={count:${count},previous,value,storage:localStorage.getItem(key)};
</script>`;
function bounded(task,ms,label){
  return Promise.race([task,wait(ms,null,{ref:false}).then(()=>{throw new Error(label+' timed out');})]);
}
function osProbe(app) {
  const before=Date.now();
  const raw=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-File',
    path.join(__dirname,'measure-tree-snapshot.ps1'),'-IncludePrivateWorkingSet'],{
    encoding:'utf8',windowsHide:true,timeout:12000,maxBuffer:20*1024*1024,
  }).trim());
  return snapshot(raw,app,before,Date.now());
}
function getTab(state,id){return state?.tabs?.find(t=>t.id===id);}
const call=(shell,method,...args)=>shell.evaluate(([m,a])=>window.dexerion.invoke(m,...a),[method,args]);
function checkReport(m) {
  assert(m?.saverOn===true&&m.capMB===2048&&Number.isFinite(m.workingSetMB)&&m.workingSetMB>0&&m.workingSetMB<1024,
    'default saver/cap or independently under-cap control not proven');
  return m;
}
async function proofDocument(page,url,slot){
  assert.equal(page.url(),url,'fixture document has wrong URL');
  const info=await bounded(page.evaluate(()=>{
    return {origin:performance.timeOrigin,visible:document.visibilityState==='visible',title:document.title,
      text:document.querySelector('#fixture')?.textContent,probe:window.probe||null,
      width:innerWidth,height:innerHeight,dpr:devicePixelRatio};
  }),3500,'fixture document proof');
  assert(info.title===title(slot)&&info.text===marker(slot)&&info.probe?.value===marker(slot)&&
    Number.isFinite(info.origin)&&info.origin>0,'fixture content or origin missing');
  const cdp=await page.context().newCDPSession(page);
  try{
    const [{id:isolate},{frameTree:{frame,childFrames}}]=await bounded(Promise.all([
      cdp.send('Runtime.getIsolateId'),cdp.send('Page.getFrameTree'),
    ]),3500,'fixture isolate/loader');
    assert(frame.url===url&&frame.id&&frame.loaderId&&isolate&&!(childFrames?.length),'fixture top frame/isolate not proved');
    return {...info,frame:frame.id,loader:frame.loaderId,isolate};
  } finally{await cdp.detach().catch(()=>{});}
}
function attachObserver(shell){
  return shell.evaluate(()=>{
    if(Object.hasOwn(window,'__dexNaturalSleepEvidence'))throw new Error('shell already probed');
    const e={ids:null,events:[],done:null};
    // Trusted shell's existing state event only; no polling, timers, flags or
    // user input. The listener is destroyed with this disposable window.
    Object.defineProperty(window,'__dexNaturalSleepEvidence',{value:e});
    window.dexerion.on('dex:state',s=>{
      if(!e.ids||!Array.isArray(s?.tabs))return;
      const tabs=e.ids.map(id=>s.tabs.find(t=>t.id===id));
      if(!tabs.some(t=>t?.sleeping))return;
      const record={at:Date.now(),active:s.active,visible:document.visibilityState==='visible',
        notice:Boolean(s.memNotice),tabs:tabs.filter(Boolean).map(t=>({id:t.id,sleeping:Boolean(t.sleeping),loading:Boolean(t.loading)}))};
      if(e.events.length<12)e.events.push(record);
      if(record.tabs.length===e.ids.length&&record.tabs.every(t=>t.sleeping)&&e.done)e.done(e.events);
    });
  });
}
function observe(shell,ids){
  return shell.evaluate(ids=>new Promise((resolve,reject)=>{
    const e=window.__dexNaturalSleepEvidence;
    if(!e||e.ids) {reject(new Error('missing/unexpectedly repeated state observer'));return;}
    e.ids=ids;e.done=resolve;
  }),ids);
}

async function arm(executable,archive,listen,armIndex) {
  let app,event;
  const reports=listen.sequence;
  const count=slot=>reports.filter(e=>e.slot===slot).length;
  const url=listen.urls;
  try{
    app=await openNative('dexerion',{chromium,executable,packaged:true,cwd:path.dirname(executable)});
    const shell=await waitFor(()=>pagesIn(app.browser).find(p=>isShellUrl(p.url())),'packaged real shell',22000);
    assert.equal(path.relative(path.join(archive,'src','renderer','shell.html'),fileURLToPath(shell.url())),'',
      'not the exact built ASAR shell');
    const state=()=>call(shell,'dex:get-state');
    const initial=await waitFor(async()=>{const s=await state();return s?.active&&s.tabs?.length===1&&s;},
      'initial default tab inventory',16000);
    const focus=initial.active;
    const appDefault=await call(shell,'dex:debloat-metrics');
    assert(appDefault.activeProfile==='optimized'&&appDefault.budgets.idleSleepMs===NATURAL_FLOOR&&
      appDefault.budgets.sweepIntervalMs===60000,'shipped default budget differs from pinned diagnostic');
    await attachObserver(shell);
    await call(shell,'dex:navigate',focus,url.front);
    const start=Date.now(),createdBy={};
    const opened=await shell.evaluate(async urls=>Promise.all(urls.map(async u=>({
      id:await window.dexerion.invoke('dex:new-tab',u,true),doneAt:Date.now(),
    }))),BACKGROUND.map(slot=>url[slot]));
    opened.forEach(r=>{assert(typeof r.id==='string'&&r.id&&Number.isSafeInteger(r.doneAt)&&r.doneAt>=start,
      'background tab creation not proved');createdBy[r.id]=r.doneAt;});
    const ids=Object.fromEntries([['front',focus],...BACKGROUND.map((slot,i)=>[slot,opened[i].id])]);
    const page=(slot)=>pagesIn(app.browser).filter(p=>p.url()===url[slot]);
    const live=()=>waitFor(async()=>{
      const s=await state();
      return s?.active===focus&&s.tabs.length===4&&SLOTS.every(slot=>{
        const t=getTab(s,ids[slot]);
        return t?.url===url[slot]&&!t.loading&&!t.sleeping&&t.title===title(slot)&&
          t.favicon===new URL(favicon,url[slot]).href&&page(slot).length===1;
      })&&s;
    },'exact loaded window and favicon metadata',22000);
    const intact=await live();
    assert(!intact.memNotice);
    const nativeBefore=checkReport(await call(shell,'dex:memory'));
    const nativePid=(report,slot)=>report.tabs.find(r=>r.tabId===ids[slot])?.pid;
    assert(nativeBefore.tabs.length===4&&nativeBefore.asleep===0);
    const pids=Object.fromEntries(SLOTS.map(slot=>[slot,nativePid(nativeBefore,slot)]));
    assert(Object.values(pids).every(p=>Number.isSafeInteger(p)&&p>0));
    assert(pids.front===pids.shared&&new Set([pids.front,pids['dedicated-a'],pids['dedicated-b']]).size===3,
      'fixture failed to obtain positively shared + two exclusive renderer processes');
    const startDoc={};
    for(const slot of SLOTS){
      startDoc[slot]=await proofDocument(page(slot)[0],url[slot],slot);
      assert.equal(count(slot),1,'unexpected pre-sleep navigation/reload');
    }
    assert(startDoc.front.visible&&startDoc.front.width>0&&startDoc.front.height>0,'retained active fixture not visible');
    assert(new Set([startDoc.front.isolate,startDoc['dedicated-a'].isolate,startDoc['dedicated-b'].isolate]).size===3,
      'exclusive renderer isolates not distinct');

    // Attach a single promise before eligible age; after this no shell IPC
    // polling or virtual-clock tricks until the natural event arrives.
    const sleepRace=observe(shell,BACKGROUND.map(s=>ids[s])).then(events=>({events}),error=>({error}));
    const expires=start+DEADLINE;
    event=null;
    const before=[];
    for(const target of PRE.map(x=>start+x)){
      const choice=await Promise.race([sleepRace,wait(Math.max(0,target-Date.now())).then(()=>null)]);
      if(choice){event=choice;break;}
      try{before.push(osProbe(app));}
      catch(error){
        // Only coherent complete snapshots are admitted; early OS collection
        // can race a process exit. Never turn a failed read into zero bytes.
        if(!/uncertain native process tree/.test(String(error?.message)))throw error;
      }
    }
    if(!event)event=await bounded(sleepRace,Math.max(1,expires-Date.now()),'natural default tab sleep');
    if(event.error)throw event.error;
    const transitionProof=transition(event.events,createdBy,focus,BACKGROUND.map(s=>ids[s]),NATURAL_FLOOR,DEADLINE);
    const pre=choosePre(before,transitionProof.firstSleepAt);
    const after=[];
    for(const ms of [3500,10000]){
      await wait(Math.max(0,transitionProof.lastSleepAt+ms-Date.now()));
      after.push(osProbe(app));
    }
    const os=phase(pre,after,{foreground:pids.front,shared:pids.shared,dedicated:BACKGROUND.slice(1).map(s=>pids[s])},transitionProof);
    const slept=await state(),mem=checkReport(await call(shell,'dex:memory'));
    assert(slept?.active===focus&&slept.tabs.length===4&&!slept.memNotice&&mem.tabs.length===4&&mem.asleep===3&&
      nativePid(mem,'front')===pids.front,'post-transition inventory/active PID incorrect');
    for(const slot of BACKGROUND) {
      const bef=getTab(intact,ids[slot]),aft=getTab(slept,ids[slot]);
      assert(aft?.sleeping&&!aft.loading&&aft.url===bef.url&&aft.title===bef.title&&aft.favicon===bef.favicon&&
        nativePid(mem,slot)===0&&page(slot).length===0&&count(slot)===1,'slept view/metadata/reload proof missing');
    }
    const retained=await proofDocument(page('front')[0],url.front,'front');
    assert(retained.visible&&retained.origin===startDoc.front.origin&&retained.frame===startDoc.front.frame&&
      retained.isolate===startDoc.front.isolate&&retained.loader===startDoc.front.loader&&count('front')===1,
      'active document changed or reloaded during sleep');

    const chosen=BACKGROUND[armIndex%2+1];
    const beginWake=Date.now();
    await call(shell,'dex:activate-tab',ids[chosen]);
    const liveState=await waitFor(async()=>{
      const s=await state(),t=getTab(s,ids[chosen]);
      return s?.active===ids[chosen]&&t&&!t.sleeping&&!t.loading&&t.url===url[chosen]&&t.title===title(chosen)&&
        t.favicon===getTab(intact,ids[chosen]).favicon&&page(chosen).length===1&&s;
    },'actual loaded wake with preserved tab, URL, title and favicon',18000);
    assert(liveState.tabs.length===4);
    const doc=await proofDocument(page(chosen)[0],url[chosen],chosen);
    const earlier=startDoc[chosen];
    const wakeReports=reports.filter(r=>r.slot===chosen);
    const afterWake=checkReport(await call(shell,'dex:memory'));
    const newPid=nativePid(afterWake,chosen);
    assert(doc.visible&&doc.origin>earlier.origin&&doc.loader!==earlier.loader&&
      doc.probe.count===2&&wakeReports.length===2&&wakeReports[0].cookie===false&&wakeReports[1].cookie===true&&
      doc.probe.previous===marker(chosen)&&doc.probe.storage===marker(chosen)&&
      Number.isSafeInteger(newPid)&&newPid>0&&newPid!==pids.front,
      'wake reload, isolated visible document or persistent session not proved');
    if(os.dedicated[BACKGROUND.slice(1).indexOf(chosen)].exited){
      const afterWakeOS=osProbe(app);
      const newProc=afterWakeOS.tree.get(newPid);
      const priorProc=pre[0].tree.get(pids[chosen]);
      // A pre-existing spare process may host the new view. Require a realm
      // other than the retired exact generation, not a new app process birth.
      assert(newProc&&doc.isolate!==earlier.isolate&&
        (newPid!==priorProc.pid||newProc.startedUtc!==priorProc.startedUtc)&&
        /(?:^|\s)--type=renderer(?:\s|$)/.test(newProc.cmdline||''),
      'different renderer generation not positively proved on wake');
    }
    assert(BACKGROUND.filter(x=>x!==chosen).every(x=>getTab(liveState,ids[x])?.sleeping&&count(x)===1),
      'wake affected another dormant page');
    const browserVersion=(await app.devtools.send('Browser.getVersion')).product;
    return {browserVersion,windowFloorMs:NATURAL_FLOOR,roundedAppWorkingSetMBBefore:nativeBefore.workingSetMB,
      offsetsFromCreateMs:transitionProof.afterCreationCallbackMs,nearestBeforeSleepMs:transitionProof.firstSleepAt-pre[0].end,
      afterSnapshotsMs:after.map(s=>s.end-transitionProof.lastSleepAt),...os,
      wake:{fixtureSlot:chosen,visible:true,sameTabUrlTitleFavicon:true,serverReloads:1,cookiePersisted:true,
        localStoragePersisted:true,untouchedOthers:true,verificationElapsedMs:Date.now()-beginWake}};
  }finally{if(app)await app.close();}
}
async function localFixture(){
  const first='dex-sleep-share.localhost',second='dex-sleep-a.localhost',third='dex-sleep-b.localhost';
  const hosts={front:first,shared:first,'dedicated-a':second,'dedicated-b':third};
  const sequence=[];
  let port;
  const server=http.createServer((r,res)=>{
    const host=String(r.headers.host||'').split(':')[0];
    if(r.method==='GET'&&r.url===favicon&&Object.values(hosts).includes(host)) {
      res.writeHead(200,{'content-type':'image/svg+xml','cache-control':'no-store'}).end(icon);
      return;
    }
    const slot=String(r.url||'').slice(1);
    if(r.method!=='GET'||port===undefined||!Object.hasOwn(hosts,slot)||hosts[slot]!==host||r.headers.host!==host+':'+port){
      res.writeHead(404).end();return;
    }
    const observed=String(r.headers.cookie||'').split(/;\s*/).includes(cookie(slot));
    const ordinal=sequence.filter(x=>x.slot===slot).length+1;
    sequence.push({slot,cookie:observed});
    const headers={'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'};
    if(slot.startsWith('dedicated'))headers['Set-Cookie']=cookie(slot)+'; Path=/; HttpOnly; SameSite=Lax';
    res.writeHead(200,headers).end(fixture(slot,ordinal));
  });
  const start=once(server,'listening');server.listen(0,'127.0.0.1');await start;port=server.address().port;
  return {server,sequence,urls:Object.fromEntries(SLOTS.map(s=>[s,'http://'+hosts[s]+':'+port+'/'+s]))};
}
async function main(){
  assert(process.platform==='win32'&&process.env.GITHUB_ACTIONS==='true'&&
    process.env.GITHUB_REF==='refs/heads/dev-V'&&/^[a-f0-9]{40}$/.test(SHA||''),'hosted Windows dev-V only');
  assert(!Object.keys(process.env).some(x=>ownProfileFlags.test(x)),'non-default diagnostic overrides present');
  const [exe,out,...extra]=process.argv.slice(2);
  assert(exe&&out&&!extra.length&&path.isAbsolute(exe)&&path.isAbsolute(out)&&path.basename(exe).toLowerCase()==='dexerion.exe');
  const archive=path.join(path.dirname(exe),'resources','app.asar');
  const result={sourceSha:SHA,exeSha256:digest(exe),appAsarSha256:digest(archive),trials:[],missing:[],
    scope:'Before/after natural shipped default transition on two independent identical local fixture profiles; no forced GC, profile settings or app changes. Retired prior private resident is not whole-tree savings, Edge comparison or a product performance target.'};
  try{
    for(let i=0;i<2;i++){
      let f;
      try{f=await localFixture();result.trials.push(await arm(exe,archive,f,i));}
      catch(e){const reason=String(e?.message||e).split('\n')[0].slice(0,180);
        result.missing.push({trial:i+1,reason});console.error('Trial '+(i+1)+': '+reason);}
      finally{if(f){f.server.closeAllConnections();await new Promise(r=>f.server.close(r));}}
    }
  }finally{
    result.complete=result.trials.length===2&&new Set(result.trials.map(r=>r.browserVersion)).size===1;
    fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  }
  if(!result.complete)process.exitCode=1;
  console.log('Verified natural transition trials:',result.trials.length,'of 2; whole-tree/Edge claims disabled.');
}
main().catch(err=>{console.error(err);process.exitCode=1;});
