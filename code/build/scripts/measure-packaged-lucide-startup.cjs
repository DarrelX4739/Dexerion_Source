'use strict';
// Hosted-only product-like A/B: same current unpacked browser and shipped
// settings. Only the Lucide shell import differs in the temporary stock arm.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const { verifiedNativeTree } = require('./measure-sample-guard.cjs');
const SUBSET = '../../assets/vendor/lucide-shell.js';
const FULL = '../../assets/vendor/lucide.min.js';
const SHELL = 'src/renderer/shell.html';
const FILES = ['assets/vendor/lucide-shell.js','assets/vendor/lucide.min.js'];
const PAIRS = 5;
const SETTLE = 14000;
const TITLE = 'Visible fixed shell-memory fixture';
const hash = b => createHash('sha256').update(b).digest('hex');
const median = list => {
  const n = list.slice().sort((a,b)=>a-b);
  return (n[Math.floor((n.length-1)/2)] + n[Math.ceil((n.length-1)/2)]) / 2;
};

function archiveIndex(asar, archive) {
  const result = new Map();
  function rec(prefix, node) {
    for (const [name, entry] of Object.entries(node)) {
      const loc = prefix + name;
      if (entry.files) rec(loc+'/',entry.files);
      else {
        assert(!entry.link && !entry.unpacked, 'unexpected linked/unpacked file at '+loc);
        result.set(loc,entry);
      }
    }
  }
  rec('',asar.getRawHeader(archive).header.files);
  return result;
}
function audit(first, second) {
  const asar = require('@electron/asar');
  const a = archiveIndex(asar, first);
  const b = archiveIndex(asar, second);
  assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort(), 'one package lost a member');
  const read = (archive,file) => asar.extractFile(archive,file.split('/').join(path.sep));
  const diffs = [...a.keys()].filter(file => hash(read(first,file)) !== hash(read(second,file)));
  assert.deepEqual(diffs,[SHELL], 'only shell import file may differ');
  const stock = read(first,SHELL).toString('utf8');
  const optimized = read(second,SHELL).toString('utf8');
  assert.equal(stock.split(FULL).length,2);
  assert.equal(stock.replace(FULL,SUBSET), optimized,'only script-enabled attribute may change');
  const assets = FILES.map(file => {
    const bytes = read(second,file);
    return { file, bytes:bytes.length, sha256:hash(bytes) };
  });
  assert.equal(assets[0].bytes,5448,'unexpected current generated Lucide file');
  return { onlyChangedMember:SHELL, totalMembers:a.size, stockShellSha256:hash(Buffer.from(stock)), subsetShellSha256:hash(Buffer.from(optimized)), assets };
}

function auditRuntime(stock, subset) {
  const visit = root => {
    const result = new Map();
    function crawl(dir) {
      for(const item of fs.readdirSync(dir,{withFileTypes:true})) {
        const source=path.join(dir,item.name);
        const rel=path.relative(root,source).split(path.sep).join('/');
        if(item.isDirectory())crawl(source);
        else {
          assert(item.isFile(),'unexpected link or special executable resource: '+rel);
          if(rel!=='resources/app.asar')result.set(rel,hash(fs.readFileSync(source)));
        }
      }
    }
    crawl(root);
    return result;
  };
  const a=visit(path.dirname(stock)),b=visit(path.dirname(subset));
  assert.deepEqual(a,b,'other installed runtime resources must be exactly equal');
  return a.size;
}

function windowsSnapshot() {
  const args = ['-NoLogo','-NoProfile','-File',path.join(__dirname,'measure-tree-snapshot.ps1'),'-IncludePrivateWorkingSet'];
  return JSON.parse(execFileSync('powershell.exe',args,{encoding:'utf8',windowsHide:true,timeout:22000,maxBuffer:32*1024*1024}).trim());
}
function processResident(sample, id) {
  const owned = verifiedNativeTree(sample.processes,id.main, p => p.pid===id.main && /^dexerion\.exe$/i.test(p.name)
    && typeof p.cmdline==='string' && !/--(?:no-sandbox|disable-web-security|type=)/.test(p.cmdline)
    && Date.parse(p.startedUtc)>=id.earliest && Date.parse(p.startedUtc)<=id.latest);
  const row = pid => owned.rows.find(p=>p.pid===pid);
  for (const key of ['shell','content']) {
    assert(row(id[key]) && /--type=renderer(?:\s|$)/.test(row(id[key]).cmdline||''),key+' not a verified renderer');
  }
  const resident = p => Number.isFinite(p?.privateWsBytes) && p.privateWsBytes>=0 ? p.privateWsBytes : null;
  assert(resident(row(id.shell))>0 && resident(row(id.content))>0, 'require usable private resident measurements');
  const all = owned.rows.map(resident);
  return { shellPrivateMiB:resident(row(id.shell))/1048576, contentPrivateMiB:resident(row(id.content))/1048576,
    mainPrivateMiB:resident(row(id.main))===null?null:resident(row(id.main))/1048576,
    treePrivateMiB:all.includes(null)?null:all.reduce((a,b)=>a+b,0)/1048576,
    processCount:owned.rows.length,
    generation:[id.main,id.shell,id.content].map(i=>row(i).startedUtc) };
}
function collect(inputs) {
  const metrics = ['shellPrivateMiB','contentPrivateMiB','mainPrivateMiB','treePrivateMiB'];
  return Object.fromEntries(metrics.map(key=>[key,inputs.every(x=>Number.isFinite(x[key]))?median(inputs.map(x=>x[key])):null]));
}

async function measure(arm, exe, local, statics, registryCount) {
  const { _electron: electron, expect } = require('@playwright/test');
  const locked = require('../package-lock.json').packages['node_modules/electron'].version;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(),'dex-shell-memory-'));
  const earliest = Date.now()-2000;
  let app;
  let session;
  try {
    app = await electron.launch({ executablePath:exe, cwd:path.dirname(exe), args:['--user-data-dir='+profile],
      env:{...process.env,DEX_AI_TEST:'1'},chromiumSandbox:true,timeout:45000 });
    const win = await app.firstWindow({timeout:30000});
    await win.waitForLoadState('load');
    await expect(win.getByRole('textbox',{name:'Search Dexerion or type a URL'})).toBeVisible();
    await expect(win.locator('svg[data-lucide]')).toHaveCount(statics);
    const nav = await win.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0];
      return { icons:Object.keys(window.lucide?.icons||{}).length,
        resources:Array.from(document.scripts).map(s=>s.getAttribute('src')).filter(s=>s?.includes('/vendor/lucide')),
        shellDomContentLoadedMs:n?.domContentLoadedEventEnd??null,
        shellLoadEventMs:n?.loadEventEnd??null, shellViewport:[innerWidth,innerHeight,devicePixelRatio] };
    });
    assert.equal(nav.icons,registryCount);
    assert.deepEqual(nav.resources,[arm==='stock'?FULL:SUBSET]);
    assert(nav.shellDomContentLoadedMs>0 && nav.shellLoadEventMs>0,'valid shell navigation times required');
    const identify = (want) => app.evaluate(async ({ app,BrowserWindow,webContents }, expected) => {
      const win = BrowserWindow.getAllWindows().filter(w=>w.isVisible()&&!w.isMinimized()&&w.isFocused());
      if(win.length!==1) throw new Error('exactly one visible focused real shell');
      const browserPath = process.getBuiltinModule('path');
      const matches = target => expected === 'dexerion://newtab'
        ? /^dexerion:\/\/newtab\/?$/.test(target) : target===expected;
      const view = webContents.getAllWebContents().find(wc=>!wc.isDestroyed()&&!wc.isLoadingMainFrame()&&matches(wc.getURL()));
      if(!view) return null;
      const page = await view.executeJavaScript(`({visible:document.visibilityState==='visible',title:document.title,viewport:[innerWidth,innerHeight,devicePixelRatio],fixture:document.querySelector('#proof')?.textContent||null})`,false);
      return {main:process.pid,shell:win[0].webContents.getOSProcessId(),content:view.getOSProcessId(),
        profile:app.getPath('userData'),archive:app.getAppPath(),packaged:app.isPackaged,
        electron:process.versions.electron,exec:browserPath.basename(process.execPath),page};
    }, want);
    const getState = () => win.evaluate(()=>window.dexerion.invoke('dex:get-state'));
    const readyUrl = async target => {
      let ready;
      await expect.poll(async()=>{
        const s = await getState();
        const matches = target === 'dexerion://newtab'
          ? /^dexerion:\/\/newtab\/?$/.test(s.tabs[0]?.url) : s.tabs[0]?.url===target;
        if(s.tabs.length!==1||!matches||s.tabs[0].loading||s.tabs[0].id!==s.active) return false;
        ready = await identify(target);
        return Boolean(ready?.page?.visible);
      },{timeout:18000}).toBe(true);
      return ready;
    };
    const first=await readyUrl('dexerion://newtab');
    const latest=Date.now()+2000;
    assert.equal(first.packaged,true);
    assert.equal(first.exec.toLowerCase(),'dexerion.exe');
    assert.equal(first.electron,locked);
    assert.equal(path.relative(profile,first.profile),'');
    assert.equal(path.relative(path.join(path.dirname(exe),'resources','app.asar'),first.archive),'');
    const phase = async (current, known, samples) => {
      assert(new Set([known.main,known.shell,known.content]).size===3,'shell and site must be separate to compare role memory');
      const series = [];
      for(let i=0;i<samples;i++){
        if(i) await sleep(650);
        series.push(processResident(windowsSnapshot(),{...known, earliest, latest}));
      }
      const remap=await readyUrl(current);
      for(const id of ['main','shell','content'])assert.equal(remap[id],known[id]);
      assert.deepEqual(known.page,remap.page);
      for(const row of series) assert.deepEqual(row.generation,series[0].generation,'process generation changed');
      session=await app.context().newCDPSession(win);
      const heap=await session.send('Runtime.getHeapUsage');
      await session.detach();
      session=null;
      assert(Number.isFinite(heap.usedSize)&&heap.usedSize>0);
      return { ...collect(series), shellHeapUsedMiB:heap.usedSize/1048576, shellHeapTotalMiB:heap.totalSize/1048576,
        snapshotCounts:series.map(r=>r.processCount), pageViewport:remap.page.viewport };
    };
    const boot = await phase('dexerion://newtab',first,2);
    const bootTab=(await getState()).active;
    await win.evaluate(({id,url})=>window.dexerion.invoke('dex:navigate',id,url),{id:bootTab,url:local});
    await readyUrl(local);
    await sleep(SETTLE);
    const current=await readyUrl(local);
    assert.equal(current.page.fixture,TITLE);
    assert.equal(current.main,first.main);
    assert.equal(current.shell,first.shell);
    const steady=await phase(local,current,3);
    return {shellViewport:nav.shellViewport,startupDomMs:nav.shellDomContentLoadedMs,startupLoadMs:nav.shellLoadEventMs,boot,steady};
  } finally {
    if(session)await session.detach().catch(()=>{});
    try { if(app) await app.close(); } finally {
      await fsp.rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:200});
    }
  }
}

function summarize(trials) {
  const fields = ['startupDomMs','startupLoadMs',...[ 'boot','steady' ].flatMap(phase=>[
    'shellPrivateMiB','contentPrivateMiB','mainPrivateMiB','treePrivateMiB','shellHeapUsedMiB','shellHeapTotalMiB',
  ].map(k=>phase+'.'+k))];
  const get = (r,k)=>k.split('.').reduce((x,y)=>x?.[y],r);
  return Object.fromEntries(fields.map(key=>{
    const a=trials.map(r=>get(r.stock,key)),b=trials.map(r=>get(r.subset,key));
    if(!a.every(Number.isFinite)||!b.every(Number.isFinite))return [key,null];
    const d=b.map((x,i)=>x-a[i]);
    return [key,{ stock:median(a),subset:median(b),pairedDelta:median(d),range:[Math.min(...d),Math.max(...d)] }];
  }));
}
async function main() {
  const [stock,subset,out] = process.argv.slice(2);
  if (stock==='--audit') {
    const result=audit(subset,out);
    const rootMarker=arc=>path.resolve(arc,'..','..','runtime-name-not-used');
    result.otherIdenticalInstalledFiles=auditRuntime(rootMarker(subset),rootMarker(out));
    return console.log(JSON.stringify(result));
  }
  assert(process.platform==='win32'&&process.env.GITHUB_ACTIONS==='true','only isolated hosted Windows');
  assert(stock&&subset&&out&&[stock,subset,out].every(p=>path.isAbsolute(p)));
  const archive=exe=>path.join(path.dirname(exe),'resources','app.asar');
  const auditResult=audit(archive(stock),archive(subset));
  auditResult.otherIdenticalInstalledFiles=auditRuntime(stock,subset);
  const { upstreamFixture }=require('./lucide-shell-oracle.cjs');
  const reference=upstreamFixture();
  const subsetCount=Object.keys(require('../../code/assets/vendor/lucide-shell.js').icons).length;
  const server=http.createServer((_req,res)=>res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}).end(`<!doctype html><title>${TITLE}</title><h1 id="proof">${TITLE}</h1>`));
  const trials=[];
  try {
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const local='http://127.0.0.1:'+server.address().port+'/visible';
    for(let n=0;n<PAIRS;n++){
      const pair={};
      const order=n%2?['subset','stock']:['stock','subset'];
      for(const arm of order) pair[arm]=await measure(arm,arm==='stock'?stock:subset,local,reference.static.length,arm==='stock'?reference.registryCount:subsetCount);
      assert.deepEqual(pair.stock.shellViewport,pair.subset.shellViewport);
      assert.deepEqual(pair.stock.boot.pageViewport,pair.subset.boot.pageViewport);
      assert.deepEqual(pair.stock.steady.pageViewport,pair.subset.steady.pageViewport);
      trials.push(pair);
      console.log('Completed native same-build pair',n+1,order.join('/'));
    }
  } finally {
    server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
    await fsp.writeFile(out,JSON.stringify({source:process.env.GITHUB_SHA,audit:auditResult,n:trials.length,steadySettleMs:SETTLE,
      notes:'packaged Playwright Electron attach, fresh profile but audited/warmed OS files each launch, ordinary local one-tab browsing, natural GC only, two/three private WS snapshots per phase',
      trials,summary:trials.length?summarize(trials):null},null,2)+'\n',{flag:'wx'});
  }
}
main().catch(err=>{console.error(err);process.exitCode=1;});
