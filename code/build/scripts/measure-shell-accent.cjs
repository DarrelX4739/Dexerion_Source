'use strict';
// Hosted real-renderer experiment, not shipping shell code. Both arms use
// the same shell, settings, page, Chromium build and ordinary title events.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const SHELL = path.resolve(__dirname, '../../code/src/renderer/shell.js');
const BASELINE = 'db1d22bca625c6e98542d7e7e33280f4c51a1d7a';
const TIMES = 24;
const INTERVAL_MS = 130;
const QUIET_MS = TIMES * INTERVAL_MS;
const PAIRS = 4;
const COUNTERS = ['LayoutCount','LayoutDuration','RecalcStyleCount','RecalcStyleDuration','ScriptDuration','TaskDuration'];
const BEFORE = "  const tokenAccent = getComputedStyle(document.documentElement).getPropertyValue('--dx-accent').trim();\n"
  + "  document.documentElement.style.setProperty('--accent', savedAccent || tokenAccent || '#35c4ff');";
const AFTER = "  const accent = savedAccent || getComputedStyle(document.documentElement).getPropertyValue('--dx-accent').trim() || '#35c4ff';\n"
  + "  document.documentElement.style.setProperty('--accent', accent);";
const TITLE = 'Local shell attribution';
const HTML = `<!doctype html><title>${TITLE}</title><meta charset="utf-8"><main>Local shell style fixture</main>
<script>let updates=0; window.runTitleFixture=() => {
  if (updates) return false;
  const timer=setInterval(() => {
    document.title=${JSON.stringify(TITLE)}+' '+(++updates);
    if(updates===${TIMES}) clearInterval(timer);
  },${INTERVAL_MS});
  return true;
};</script>`;

function candidateText(source) {
  assert.equal(source.split(BEFORE).length,2,'unexpected shell accent code');
  return source.replace(BEFORE,AFTER);
}
const gitBlob = b => crypto.createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
async function onlyFixtureTab(win, url) {
  const get = () => win.evaluate(() => window.dexerion.invoke('dex:get-state'));
  let id;
  for (let attempt=0; attempt<60; attempt++) {
    const state = await get().catch(()=>null);
    if (state?.active && state.tabs.some(t=>t.id===state.active && !t.loading)) { id=state.active; break; }
    await sleep(200);
  }
  assert(id,'normal boot tab was not ready');
  await win.evaluate(async ({ id,url }) => {
    const bridge=window.dexerion;
    const state=await bridge.invoke('dex:get-state');
    for (const tab of state.tabs) if(tab.id!==id) await bridge.invoke('dex:close-tab',tab.id);
    await bridge.invoke('dex:navigate',id,url);
  }, {id,url});
  let ready = false;
  for (let attempt=0; attempt<60; attempt++) {
    const state = await get();
    if(state.active===id && state.tabs.length===1 && state.tabs[0].url===url && !state.tabs[0].loading){ready=true;break;}
    await sleep(250);
  }
  assert(ready,'only the expected known fixture should be loaded');
  return id;
}

function metrics(a,b) {
  return Object.fromEntries(COUNTERS.map(key=>{
    assert(Number.isFinite(a[key]) && Number.isFinite(b[key]) && b[key]>=a[key], `missing or nonmonotonic ${key}`);
    return [key,b[key]-a[key]];
  }));
}

async function sample(url) {
  const { launchDexerion } = require('../e2e/app');
  const {app,win,profile}=await launchDexerion({gpu:'adaptive',attempts:1});
  let cdp;
  try {
    const id=await onlyFixtureTab(win,url);
    await sleep(4200);
    const state=()=>win.evaluate(async()=>{
      const s=await window.dexerion.invoke('dex:get-state');
      return {active:s.active, tabCount:s.tabs.length, saved:s.ui?.accent, applied:getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),theme:s.ui?.theme, viewport:[innerWidth,innerHeight,devicePixelRatio]};
    });
    const normal=await state();
    assert(normal.saved && normal.saved===normal.applied && normal.tabCount===1 && normal.active===id,'expected normal saved accent');
    const pageRead=(js)=>app.evaluate(async ({BrowserWindow,webContents},args)=>{
      const visible=BrowserWindow.getAllWindows().filter(w=>w.isVisible()&&!w.isMinimized());
      if(visible.length!==1||!visible[0].isFocused()) throw new Error('exactly one visible, focused shell required');
      const page=webContents.getAllWebContents().find(w=>w.getURL()===args.url);
      if(!page||!page.getOSProcessId()) throw new Error('real fixture page not found');
      return page.executeJavaScript(args.js,false);
    }, {url,js});
    const pre=await pageRead("({visible:document.visibilityState==='visible',text:document.querySelector('main')?.textContent,viewport:[innerWidth,innerHeight,devicePixelRatio],timeOrigin:performance.timeOrigin})");
    assert(pre.visible && pre.text==='Local shell style fixture');
    cdp=await app.context().newCDPSession(win);
    await cdp.send('Performance.enable');
    const read=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
    const q0=await read();
    await sleep(QUIET_MS);
    const q1=await read();
    // Read-only observation of existing state broadcasts for exact delivery.
    // No interception of events, window policy, renderer methods or APIs.
    await win.evaluate(({id,prefix})=>{
      const captured=[];
      window.__dexShellTitleEvidence=captured;
      window.dexerion.on('dex:state',s=>{
        const title=s?.tabs?.find(t=>t.id===id)?.title;
        if(typeof title==='string'&&title.startsWith(prefix)){
          if(captured.at(-1)!==title) captured.push(title);
        }
      });
    }, { id,prefix:TITLE+' ' });
    const a=await read();
    assert.equal(await pageRead('window.runTitleFixture()'),true);
    await sleep(QUIET_MS+450);
    const b=await read();
    const doc=await win.evaluate(()=>({titles:window.__dexShellTitleEvidence, final:document.title}));
    const labels=Array.from({length:TIMES},(_,i)=>TITLE+' '+(i+1));
    assert.deepEqual(doc.titles,labels,'every ordinary title update must reach shell state');
    assert(doc.final.startsWith(labels.at(-1)+' — '),'shell painted final title');
    const post=await pageRead("({visible:document.visibilityState==='visible',text:document.querySelector('main')?.textContent,viewport:[innerWidth,innerHeight,devicePixelRatio],timeOrigin:performance.timeOrigin})");
    assert.deepEqual(post,pre,'foreground changed or was not visible');
    assert.deepEqual(await state(),normal,'saved accent and rendered CSS custom property must stay equal');
    const { active:_id, ...visual } = normal;
    return {quiet:metrics(q0,q1), titles:metrics(a,b), titleCount:doc.titles.length, visual, viewport:pre.viewport};
  } finally {
    if(cdp) await cdp.detach().catch(()=>{});
    try{await app.close();}finally{await fs.rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:150});}
  }
}

function pairMedian(samples) {
  const median=values=>{const x=values.slice().sort((a,b)=>a-b);return (x[Math.floor((x.length-1)/2)]+x[Math.ceil((x.length-1)/2)])/2;};
  return Object.fromEntries(['quiet','titles'].map(phase=>[phase,Object.fromEntries(COUNTERS.map(key=>{
    const stock=samples.map(pair=>pair.stock[phase][key]);
    const candidate=samples.map(pair=>pair.candidate[phase][key]);
    const delta=stock.map((old,i)=>candidate[i]-old);
    return [key,{stock:median(stock),candidate:median(candidate),pairedDelta:median(delta),range:[Math.min(...delta),Math.max(...delta)]}];
  }))]));
}

async function main(){
  const original=await fs.readFile(SHELL);
  const normal=original.toString('utf8').replace(/\r\n/g,'\n');
  assert.equal(gitBlob(Buffer.from(normal)),BASELINE,'audit newer shell source before comparing');
  const candidate=Buffer.from(original.includes('\r\n')?candidateText(normal).replace(/\n/g,'\r\n'):candidateText(normal));
  if(process.argv[2]==='--self-test'){
    assert.equal(candidateText(normal).replace(AFTER,BEFORE),normal);
    assert.throws(()=>candidateText(normal+'\n'+BEFORE));
    console.log('exact single expression and original restoration verified; candidate',gitBlob(Buffer.from(candidateText(normal))));
    return;
  }
  assert.equal(process.env.GITHUB_ACTIONS,'true','run only in isolated disposable hosted workspace');
  const out=process.argv[2]; assert(out&&path.isAbsolute(out),'need absolute JSON output');
  const server=http.createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(HTML);});
  const samples=[];
  try{
    await processListen(server);
    const url='http://127.0.0.1:'+server.address().port+'/fixture';
    for(let i=0;i<PAIRS;i++){
      const row={};
      for(const side of i%2?['candidate','stock']:['stock','candidate']){
        await fs.writeFile(SHELL,side==='candidate'?candidate:original);
        row[side]=await sample(url);
      }
      assert.deepEqual(row.stock.visual,row.candidate.visual);
      assert.deepEqual(row.stock.viewport,row.candidate.viewport);
      samples.push(row);
      console.log('Paired real Chromium shell metrics:',JSON.stringify(row));
    }
  }finally{
    await fs.writeFile(SHELL,original);
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    const result={baseline:BASELINE, candidate:gitBlob(Buffer.from(candidateText(normal))), source:process.env.GITHUB_SHA||null,
      engine:'native Chromium shell target via standard Playwright Electron launcher', count:TIMES, pairOrder:'AB BA AB BA', secondsUnit:'*Duration is in seconds; *Count is a count',
      samples, medians:samples.length?pairMedian(samples):null};
    await fs.writeFile(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  }
}
const processListen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
main().catch(err=>{console.error(err);process.exitCode=1;});
