'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const os=require('node:os');
const path=require('node:path');
const {once}=require('node:events');
const {_electron:electron,test,expect}=require('@playwright/test');
const PIXEL='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/9t8AAAAASUVORK5CYII=';
const DATA='data:image/png;base64,'+PIXEL;
const BULK=1500;
test('normal Chrome bookmark star preserves classification, keyboard, disk, tab focus and bar navigation',async()=>{
  test.skip(!process.env.DEX_BOOKMARK_PHASE,'Explicit same-source Windows diagnostic only');
  test.setTimeout(100000);
  const phase=process.env.DEX_BOOKMARK_PHASE;
  assert(['stock','candidate'].includes(phase));
  assert.equal(process.platform,'win32');
  const evidence=process.env.DEX_BOOKMARK_OUT;
  assert(evidence&&path.isAbsolute(evidence));
  const server=http.createServer((req,res)=>{
    if(req.url==='/favicon.ico')return res.writeHead(200,{'content-type':'image/png'}).end(Buffer.from(PIXEL,'base64'));
    const pages={'/match':'Starred fixture','/fresh':'Fresh fixture','/bar':'Bar route'};
    const title=pages[req.url];
    if(!title)return res.writeHead(404).end();
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'})
      .end(`<!doctype html><title>${title}</title><link rel="icon" href="${DATA}"><h1>${title}</h1>`);
  });
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'dex-bookmark-membership-'));
  let app;
  try {
    server.listen(0,'127.0.0.1');
    await once(server,'listening');
    const origin='http://127.0.0.1:'+server.address().port;
    const live=origin+'/match', fresh=origin+'/fresh', bar=origin+'/bar';
    const account=path.join(profile,'Accounts','default'), books=path.join(account,'bookmarks.json');
    fs.mkdirSync(account,{recursive:true});
    fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({welcomeDaily:false,restoreSession:false}));
    const item=(id,url,title)=>({id,url,title,at:100000+Number(id.slice(1)||0),favicon:DATA});
    const seeded={
      bar:[item('b1',bar,'Bar route'),item('b2',live,'Duplicate bookmarked fixture')],
      other:[...Array.from({length:BULK},(_,i)=>item('b'+(i+3),origin+'/library/'+i,'Imported '+i)),
        item('b1503',live,'Saved fixture')],
    };
    fs.writeFileSync(books,JSON.stringify({roots:seeded}));
    const buildDir=path.join(__dirname,'..');
    app=await electron.launch({cwd:buildDir,executablePath:require('electron'),chromiumSandbox:true,
      args:['.','--user-data-dir='+profile],
      env:{...process.env,NODE_PATH:path.join(buildDir,'node_modules'),DEX_AI_TEST:'1'},timeout:45000});
    const lock=require('../package-lock.json').packages['node_modules/electron'].version;
    const appId=await app.evaluate(({app},expected)=>({
      exactProfile:process.getBuiltinModule('path').relative(expected,app.getPath('userData'))==='',
      electron:process.versions.electron,
      launchForbids:process.argv.some(x=>/^--(?:no-sandbox|disable-web-security|disable-gpu|disable-site-isolation-trials)(?:=|$)/.test(x)),
    }),profile);
    assert.deepEqual(appId,{exactProfile:true,electron:lock,launchForbids:false});
    const win=await app.firstWindow({timeout:35000});
    await win.waitForLoadState('load');
    const state=()=>win.evaluate(()=>window.dexerion.invoke('dex:get-state'));
    const active=()=>state().then(x=>x.tabs.find(t=>t.id===x.active));
    const checkNav=async(url,title)=>expect.poll(async()=>{
      const t=await active();
      return {url:t?.url,title:t?.title,loading:t?.loading};
    },{timeout:15000}).toEqual({url,title,loading:false});
    const nav=async url=>win.evaluate(u=>window.dexerion.invoke('dex:navigate',S.active,u),url);
    await expect.poll(async()=>((await state()).bookmarks?.roots.other||[]).length).toBe(BULK+1);
    await nav(live);
    await checkNav(live,'Starred fixture');
    const star=win.locator('#bookmark-btn'), links=win.locator('#bookmarkbar a');
    await expect(star).toBeVisible();
    const snapshots=[];
    const proof=async(label,marked,title)=>{
      await expect(star).toBeVisible();
      await expect(star).toHaveAttribute('title',title);
      if(marked)await expect(star).toHaveClass(/\bbookmarked\b/);
      else await expect(star).not.toHaveClass(/\bbookmarked\b/);
      const actual=await star.evaluate((el,label)=>{
        const svg=el.querySelector('svg');
        if(!svg)throw new Error('Bookmark action lost its actual SVG');
        const r=el.getBoundingClientRect();
        return {label,title:el.title,classes:el.className,accessibleName:el.getAttribute('aria-label'),
          markup:svg.outerHTML,focus:document.activeElement===el,width:r.width,height:r.height};
      },label);
      assert(actual.width>0&&actual.height>0);
      snapshots.push(actual);
    };
    await proof('full URL matches both roots',true,'Remove this bookmark');
    await expect(links).toHaveText(['Bar route','Duplicate bookmarked fixture']);
    const lookup=await win.evaluate(({live,fresh,bar,phase,BULK})=>{
      const actual=phase==='stock'?url=>bookmarkSet().has(url):url=>isBookmarked(url);
      if(S.bookmarks.roots.other.length!==BULK+1)throw new Error('imported profile not loaded');
      const qs=[live,fresh,bar,S.bookmarks.roots.other[750].url];
      const samples=[];
      const n=2400;
      function run(){
        const start=performance.now();let hits=0;
        for(let i=0;i<n;i++)hits+=actual(qs[i%4])?1:0;
        if(hits!==n*0.75)throw new Error('actual shell input produced wrong membership');
        return (performance.now()-start)*1000/n;
      }
      run();
      for(let i=0;i<7;i++)samples.push(run());
      return {lookupsPerBatch:n,usPerLookup:samples};
    },{live,fresh,bar,phase,BULK});

    const disk=()=>Object.values(JSON.parse(fs.readFileSync(books,'utf8')).roots).flat();
    await star.focus();
    await expect(star).toBeFocused();
    await win.keyboard.press('Space');
    await proof('space removes all duplicates',false,'Bookmark this page');
    await expect.poll(()=>disk().filter(x=>x.url===live).length).toBe(0);
    await expect(links).toHaveText(['Bar route']);
    await expect(star).toBeFocused();
    await star.click();
    await proof('normal click adds page',true,'Remove this bookmark');
    await expect.poll(()=>disk().filter(x=>x.url===live).map(x=>x.title)).toEqual(['Starred fixture']);
    const first=(await active()).id;

    const second=await win.evaluate(u=>window.dexerion.invoke('dex:new-tab',u,false),fresh);
    assert(second&&second!==first);
    await checkNav(fresh,'Fresh fixture');
    await proof('new active tab is not bookmarked',false,'Bookmark this page');
    await win.evaluate(id=>window.dexerion.invoke('dex:activate-tab',id),first);
    await checkNav(live,'Starred fixture');
    await proof('previous active tab remains starred',true,'Remove this bookmark');

    await links.first().click();
    await checkNav(bar,'Bar route');
    assert.equal((await active()).id,first);
    await proof('bookmark bar opens in selected tab',true,'Remove this bookmark');
    await nav('dexerion://bookmarks');
    await expect.poll(async()=>String((await active())?.url)).toMatch(/^dexerion:\/\/bookmarks\/?$/);
    await proof('internal page remains visibly disabled',false,'Internal page — not bookmarkable');
    const stored=disk();
    assert.equal(stored.length,BULK+2);
    assert(stored.some(x=>x.url===bar)&&stored.some(x=>x.url===live)&&!stored.some(x=>x.url===fresh));
    fs.writeFileSync(evidence,JSON.stringify({phase,lookup,snapshots,fixtures:{diskCount:stored.length,
      keptBar:'Bar route',tabs:(await state()).tabs.length}},null,2)+'\n',{flag:'wx'});
  }finally{
    try{if(app)await app.close();}
    finally{
      server.closeAllConnections();
      if(server.listening)await new Promise(resolve=>server.close(resolve));
      fs.rmSync(profile,{recursive:true,force:true,maxRetries:8,retryDelay:300});
    }
  }
});
