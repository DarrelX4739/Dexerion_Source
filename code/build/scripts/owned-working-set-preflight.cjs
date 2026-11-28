'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {once}=require('node:events');
const {setTimeout:wait}=require('node:timers/promises');

const MAX_PROVIDER_MS=2500;
const MAX_REPLY_MS=5000;
const time=n=>Number.isSafeInteger(n)&&n>0;
const ticks=s=>{
  assert(typeof s==='string'&&/^[0-9]{1,20}$/.test(s),'missing or invalid native tick/creation field');
  const value=BigInt(s);
  assert(value>0n&&value<=0x7fffffffffffffffn,'native clock/exact FILETIME is out of bounds');
  return value;
};
function verify(raw,root,sentAt,receivedAt){
  assert(time(root)&&time(sentAt)&&time(receivedAt)&&receivedAt>=sentAt&&receivedAt-sentAt<=MAX_REPLY_MS,
    'owned sampler completion required within five seconds');
  const a=raw?.acquisition;
  assert(a&&[a.beforeInventoryUtcMs,a.beforeUtcMs,a.afterUtcMs,a.afterInventoryUtcMs].every(time)&&
    sentAt<=a.beforeInventoryUtcMs&&a.beforeInventoryUtcMs<=a.beforeUtcMs&&
    a.beforeUtcMs<=a.afterUtcMs&&a.afterUtcMs<=a.afterInventoryUtcMs&&a.afterInventoryUtcMs<=receivedAt,
    'ownership or acquisition wall-time bracket invalid');
  const lo=ticks(a.lowQpc),hi=ticks(a.highQpc),f=ticks(a.qpcFreq);
  assert(hi>=lo&&f<=10000000000n,'invalid QPC acquisition bracket/frequency');
  const ms=t=>Number(t)*1000/Number(f);
  const qpcSpan=ms(hi-lo),wallSpan=a.afterUtcMs-a.beforeUtcMs;
  assert(qpcSpan<=MAX_PROVIDER_MS&&wallSpan<=MAX_PROVIDER_MS+60&&Math.abs(wallSpan-qpcSpan)<=60,
    'working-set provider duration or wall/QPC alignment failed budget');
  assert(Array.isArray(raw.rows)&&raw.rows.length>=2&&raw.rows.length<=100,'owned Windows process scope missing');
  const pids=new Map();
  let min=hi,max=lo;
  for(const row of raw.rows){
    assert(time(row.pid)&&Number.isSafeInteger(row.ppid)&&row.ppid>=0&&!pids.has(row.pid)&&
      Number.isSafeInteger(row.privateWorkingSetBytes)&&row.privateWorkingSetBytes>=0,'invalid or repeated owned private-resident row');
    const t=ticks(row.providerQpc);
    assert(t>=lo&&t<=hi&&ticks(row.providerFreq)===f,'stale, future, or different-clock PerfProc timestamp');
    min=t<min?t:min;max=t>max?t:max;
    pids.set(row.pid,{parent:row.ppid,birth:ticks(row.birth),bytes:row.privateWorkingSetBytes});
  }
  assert(ms(max-min)<=25,'PerfProc rows do not represent one acquisition');
  const rootRow=pids.get(root);
  assert(rootRow?.bytes>0&&raw.rows.some(x=>x.pid!==root&&x.privateWorkingSetBytes>0),'root/owned child positive control absent');
  for(const [pid,p] of pids){
    if(pid===root)continue;
    let ptr=p,seen=new Set([pid]);
    while(ptr.parent!==root){
      assert(pids.has(ptr.parent)&&!seen.has(ptr.parent),'child ancestry not proven to the launched browser root');
      seen.add(ptr.parent);
      const prior=ptr;ptr=pids.get(ptr.parent);
      assert(prior.birth>=ptr.birth,'stale parent generation in owned scope');
    }
    assert(ptr.birth>=rootRow.birth,'stale browser root generation');
  }
  // Native QPC, not Win32_Process acquisition or collector completion,
  // determines the relative timestamp. The two UTC anchors bound it;
  // a ±2 ms allowance only covers integer UTC resolution, NOT stale QPC.
  const providerMinUtcMs=a.beforeUtcMs+ms(min-lo)-2;
  const providerMaxUtcMs=a.afterUtcMs-ms(hi-max)+2;
  assert(providerMinUtcMs<=providerMaxUtcMs&&providerMaxUtcMs-providerMinUtcMs<=90&&
    providerMinUtcMs>=sentAt-2&&providerMaxUtcMs<=receivedAt+2&&providerMaxUtcMs-sentAt<=MAX_PROVIDER_MS+2,
    'native acquisition not narrowly bounded or timely from request');
  const sum=[...pids.values()].reduce((v,x)=>v+x.bytes,0);
  assert(Number.isSafeInteger(sum)&&sum>0,'unsafe private resident total');
  return {providerMinUtcMs,providerMaxUtcMs,minProviderQpc:min,maxProviderQpc:max,clockFrequency:f,
    rootBirth:rootRow.birth,privateResidentBytes:sum,scopeOfGenerations:pids,
    qualification:{ownedProcesses:pids.size,providerQpcSpanMs:qpcSpan,providerOffsetLowerBoundMs:providerMinUtcMs-sentAt,
      providerOffsetUpperBoundMs:providerMaxUtcMs-sentAt,collectorRoundTripMs:receivedAt-sentAt}};
}
class Collector {
  constructor(child){
    this.child=child;this.sequence=0;this.pending=null;
    this.lines=createInterface({input:child.stdout});
    this.ready=new Promise((resolve,reject)=>{this.onReady={resolve,reject};});
    this.lines.on('line',line=>{
      try{
        assert(line.length<=120000,'collector message exceeded bound');
        const row=JSON.parse(line);
        if(row.ready===true&&this.onReady){
          this.onReady.resolve();this.onReady=null;return;
        }
        assert(this.pending&&row.id===this.pending.id,'unmatched collector message');
        const p=this.pending;this.pending=null;
        if(row.error)p.reject(new Error(row.error));
        else p.resolve(row);
      }catch(e){
        if(this.onReady){this.onReady.reject(e);this.onReady=null;}
        if(this.pending){this.pending.reject(e);this.pending=null;}
      }
    });
    child.once('error',error=>this.fail(error));
    child.once('exit',()=>this.fail(new Error('owned working-set subprocess exited')));
  }
  fail(error){
    if(this.onReady){this.onReady.reject(error);this.onReady=null;}
    if(this.pending){this.pending.reject(error);this.pending=null;}
  }
  static async launch(kind,launched){
    const names={edge:'msedge.exe',dexerion:'dexerion.exe'};
    assert(Object.hasOwn(names,kind)&&time(launched.processId)&&path.isAbsolute(launched.profileDir)&&
      path.basename(launched.profileDir).startsWith('dex-native-'+kind+'-'),'not a privately launched native fixture');
    const child=spawn('powershell.exe',['-NoProfile','-NoLogo','-File',path.join(__dirname,'probe-owned-working-set.ps1'),
      '-RootProcess',String(launched.processId),'-ProfileDir',launched.profileDir,'-ImageName',names[kind]],
    {windowsHide:true,stdio:['pipe','pipe','ignore']});
    child.stdin.on('error',()=>{}); // early Windows helper exit fails via child events
    const c=new Collector(child);
    try{
      await Promise.race([c.ready,wait(12000,null,{ref:false}).then(()=>{throw new Error('owned sampler initialization timeout');})]);
      return c;
    }catch(e){await c.close();throw e;}
  }
  async sample(root){
    assert(!this.pending&&this.child.exitCode===null,'owned sampler unavailable or has an outstanding query');
    const id=++this.sequence,sentAt=Date.now();
    const promise=new Promise((resolve,reject)=>{
      this.pending={id,resolve,reject};
      this.child.stdin.write(JSON.stringify({op:'sample',id})+'\n');
    });
    const raw=await Promise.race([promise,wait(MAX_REPLY_MS+10,null,{ref:false}).then(()=>{throw new Error('owned native sample deadline exceeded');})]);
    return verify(raw,root,sentAt,Date.now());
  }
  async close(){
    if(this.child.exitCode!==null||this.child.signalCode!==null)return;
    this.child.stdin.end('{"op":"finish"}\n');
    const exit=once(this.child,'exit').catch(()=>{});
    await Promise.race([exit,wait(800)]);
    if(this.child.exitCode===null&&this.child.signalCode===null){
      this.child.kill();await Promise.race([exit,wait(1500)]);
    }
  }
}
async function qualify(kind,executable,appAsar,app,fixtures,tabs){
  const {chromium}=require('@playwright/test');
  const {openNative,pagesIn,isShellUrl,waitFor}=require('./measure-native-browser.cjs');
  const {fileURLToPath}=require('node:url');
  let launched,collector;
  try{
    launched=await openNative(kind,{chromium,executable,cwd:path.dirname(executable),packaged:kind==='dexerion'});
    const urls=app.urls.slice(0,tabs);
    if(kind==='edge'){
      const c=launched.browser.contexts()[0];
      const home=c.pages()[0];
      assert(home);
      await home.goto(urls[0],{waitUntil:'load'});
      for(const url of urls.slice(1)){const tab=await c.newPage();await tab.goto(url,{waitUntil:'load'});}
      await home.bringToFront();
    }else{
      const shell=await waitFor(()=>pagesIn(launched.browser).find(p=>isShellUrl(p.url())),'real packed Dexerion shell',18000);
      assert.equal(path.relative(path.join(appAsar,'src','renderer','shell.html'),fileURLToPath(shell.url())),'');
      const initial=await waitFor(async()=>{
        const s=await shell.evaluate(()=>window.dexerion.invoke('dex:get-state'));
        return s?.active&&s.tabs.length===1?s.active:null;
      },'initial trusted shell tab',15000);
      await shell.evaluate(([id,url])=>window.dexerion.invoke('dex:navigate',id,url),[initial,urls[0]]);
      for(const u of urls.slice(1))await shell.evaluate(url=>window.dexerion.invoke('dex:new-tab',url,true),u);
    }
    await waitFor(()=>urls.every((u,i)=>pagesIn(launched.browser).filter(p=>p.url()===u).length===1&&
      fixtures.loads[i].length===1&&fixtures.loads[i][0].document),'exact ready synthetic tab inventory',18000);
    const front=pagesIn(launched.browser).find(p=>p.url()===urls[0]);
    assert(await front.evaluate(()=>document.visibilityState==='visible'&&Boolean(document.querySelector('#fixture'))));
    collector=await Collector.launch(kind,launched);
    const measurements=[];
    for(let i=0;i<3;i++){
      const s=await collector.sample(launched.processId);
      if(i){
        const prior=measurements.at(-1);
        assert(prior.rootBirth===s.rootBirth&&prior.maxProviderQpc<s.minProviderQpc&&prior.clockFrequency===s.clockFrequency,
          'root changed, clock changed or provider did not advance across one-second-separated collections');
      }
      measurements.push(s);
      if(i<2)await wait(1600);
    }
    return measurements.map(x=>x.qualification);
  }finally{
    if(collector)await collector.close();
    if(launched)await launched.close();
  }
}
const digest=file=>require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function main(){
  const SHA=process.env.GITHUB_SHA;
  assert(process.platform==='win32'&&process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REF==='refs/heads/dev-V'&&
    /^[a-f0-9]{40}$/.test(SHA||'')&&!Object.keys(process.env).some(x=>/^DEX_/i.test(x)),'exact hosted unchanged default dev-V only');
  const [exe,out,...extra]=process.argv.slice(2);
  assert(path.isAbsolute(exe)&&path.isAbsolute(out)&&!extra.length&&path.basename(exe).toLowerCase()==='dexerion.exe');
  const appAsar=path.join(path.dirname(exe),'resources','app.asar');
  const edge=require('./measure-native-browser.cjs').edgeExecutable();
  const report={sourceSha:SHA,edgeExeSha256:digest(edge),dexExeSha256:digest(exe),dexAsarSha256:digest(appAsar),
    scope:'Three short acquisition qualifications per stock browser; no memory amounts, comparison, long idle or user profile. Only provider timing and verified owned process counts.',
    arms:{},complete:false};
  const fixture=await require('./measure-long-idle.cjs').listenFixture();
  try{
    for(const kind of ['edge','dexerion']){
      try{const records=fixture.reset();report.arms[kind]={samples:await qualify(kind,kind==='edge'?edge:exe,appAsar,fixture,records,9)};}
      catch(e){report.arms[kind]={missing:String(e?.message||e).split('\n')[0].slice(0,150)};}
    }
    report.complete=['edge','dexerion'].every(k=>report.arms[k]?.samples?.length===3);
  }finally{
    fixture.server.closeAllConnections();await new Promise(r=>fixture.server.close(r));
    fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  }
  console.log('Native WorkingSetPrivate sampler timing and identity qualified:',report.complete);
  if(!report.complete)process.exitCode=1;
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={verify,Collector};
