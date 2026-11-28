'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const os=require('node:os');
const path=require('node:path');
const { EventEmitter,once }=require('node:events');
const {_electron:electron,test,expect}=require('@playwright/test');
const PIXEL=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWNQiyr/DwADmAH3fSbTvAAAAABJRU5ErkJggg==','base64');

test('actual Snip Blink preview releases only discarded images and ignores old decode requests',async()=>{
  const phase=process.env.DEX_SNIP_NATIVE;
  test.skip(!phase,'Opt-in actual same-source Snip diagnostic');
  test.setTimeout(105000);
  assert(['stock','candidate'].includes(phase)&&['linux','win32'].includes(process.platform));
  const output=process.env.DEX_SNIP_OUT;
  assert(output&&path.isAbsolute(output));
  const delayed=new EventEmitter(), waiting=new Map();
  const server=http.createServer((req,res)=>{
    if(/^\/slow-[ab]\.png$/.test(req.url)){
      waiting.set(req.url,res);
      delayed.emit(req.url);
    }else if(req.url==='/fixture') {
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'})
        .end('<!doctype html><title>Offline Snip fixture</title><h1>Synthetic tab content only</h1>');
    } else res.writeHead(404).end();
  });
  const release=rel=>{
    const r=waiting.get(rel);
    assert(r,'no pending synthetic decode input');
    waiting.delete(rel);
    if(!r.destroyed)r.writeHead(200,{'content-type':'image/png','cache-control':'no-store'}).end(PIXEL);
  };
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'dex-snips-e2e-'));
  let app;
  try{
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const origin='http://127.0.0.1:'+server.address().port;
    const build=path.join(__dirname,'..');
    app=await electron.launch({cwd:build,executablePath:require('electron'),chromiumSandbox:true,
      args:['.','--user-data-dir='+profile],
      env:{...process.env,NODE_PATH:path.join(build,'node_modules'),DEX_AI_TEST:'1'},timeout:50000});
    const locked=require('../package-lock.json').packages['node_modules/electron'].version;
    const ident=await app.evaluate(({app},want)=>({
      profile:process.getBuiltinModule('path').relative(app.getPath('userData'),want),
      version:process.versions.electron,
      weakened:process.argv.some(x=>/^--(?:no-sandbox|disable-web-security|disable-site-isolation-trials|disable-gpu)(?:=|$)/.test(x)),
    }),profile);
    assert.deepEqual(ident,{profile:'',version:locked,weakened:false});
    const win=await app.firstWindow({timeout:35000});
    const bridge=()=>win.evaluate(()=>window.dexerion?.invoke('dex:get-state'));
    await expect.poll(async()=>Boolean((await bridge())?.active)).toBe(true);
    const fixture=origin+'/fixture';
    await win.evaluate(({id,fixture})=>window.dexerion.invoke('dex:navigate',id,fixture),{id:(await bridge()).active,fixture});
    await expect.poll(async()=>{
      const s=await bridge(),t=s.tabs.find(t=>t.id===s.active);
      return t?.url===fixture&&t?.title==='Offline Snip fixture'&&!t.loading;
    }).toBe(true);
    await win.locator('#snip-btn').click();
    await expect.poll(()=>app.evaluate(({webContents})=>webContents.getAllWebContents().some(w=>
      !w.isDestroyed()&&!w.isLoadingMainFrame()&&/\/src\/renderer\/snip\.html(?:[?#]|$)/.test(w.getURL())))).toBe(true);
    const inSnip=(js)=>app.evaluate(({webContents},js)=>{
      const found=webContents.getAllWebContents().filter(w=>!w.isDestroyed()&&/\/src\/renderer\/snip\.html(?:[?#]|$)/.test(w.getURL()));
      if(found.length!==1)throw new Error('exact actual Snip overlay required');
      return found[0].executeJavaScript(js,false);
    },js);
    await expect.poll(()=>inSnip("typeof showPreview==='function'&&document.getElementById('pv-img')!==null")).toBe(true);
    const whole=await inSnip(`(() => {
      window.fixtureFrozen=document.querySelector('#frozen').getAttribute('src');
      window.fixtureEvents=[];
      const im=document.querySelector('#pv-img');
      for(const e of ['load','error'])im.addEventListener(e,()=>fixtureEvents.push({event:e,width:im.naturalWidth}));
      window.fixturePng=(w,h,seed)=>{
        const c=document.createElement('canvas');c.width=w;c.height=h;
        const ctx=c.getContext('2d'),p=ctx.createImageData(w,h);let s=seed;
        const random=()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return s&255;};
        for(let i=0;i<p.data.length;i+=4){p.data[i]=random();p.data[i+1]=random();p.data[i+2]=random();p.data[i+3]=255;}
        ctx.putImageData(p,0,0);return c.toDataURL('image/png');
      };
      window.fixtureRead=()=>{
        const im=document.querySelector('#pv-img'),v=document.querySelector('#pv-vid');
        return {srcLength:im.getAttribute('src')?.length??0,currentSrcLength:im.currentSrc.length,
          width:im.naturalWidth,height:im.naturalHeight,showImage:!im.hidden&&!!im.getClientRects().length,
          showPane:!document.querySelector('#preview').hidden,showVideo:!v.hidden&&!!v.getClientRects().length,
          events:fixtureEvents.slice(),noCaptureRef:previewUrl===null,
          frozenUnchanged:document.querySelector('#frozen').getAttribute('src')===fixtureFrozen};
      };
      return document.title;
    })()`);
    assert.equal(whole,'Dexerion Snip');
    const read=()=>inSnip('fixtureRead()');
    const paint=async(code,visibleW,visibleH)=>{
      await inSnip("fixtureEvents.length=0; showPreview("+code+",'snip'); true;");
      await expect.poll(async()=>{
        const p=await read();
        return p.showImage&&p.showPane&&!p.showVideo&&p.width===visibleW&&p.height===visibleH&&p.events?.length===1;
      }).toBe(true);
      const p=await read();
      assert.deepEqual(p.events,[{event:'load',width:visibleW}]);
      return p;
    };
    const dump={phase,dimensions:[],discarded:[],race:{},eventsAfterValid:[]};
    const bytes=(phase,n)=>phase==='candidate'?0:n;
    await paint('fixturePng(1280,720,99)',1280,720);
    const positive=await read();
    assert(positive.srcLength>2*1024*1024);
    dump.dimensions.push([positive.width,positive.height]);
    for(const action of ['pv-retake','pv-close']){
      if(action==='pv-close')await paint('fixturePng(1280,720,100)',1280,720);
      const before=await read();
      await inSnip("fixtureEvents.length=0;document.getElementById("+JSON.stringify(action)+").click();true;");
      await expect.poll(async()=>{
        const p=await read();
        return !p.showPane&&!p.showImage&&p.noCaptureRef&&p.frozenUnchanged&&
          p.srcLength===bytes(phase,before.srcLength)&&p.currentSrcLength===bytes(phase,before.srcLength);
      }).toBe(true);
      const after=await read();
      assert.deepEqual(after.events,[]);
      dump.discarded.push({action,visibleEncodedBytes:before.srcLength,discardedAttributeBytes:after.srcLength});
    }
    const beforeMovie=await paint('fixturePng(1280,720,101)',1280,720);
    // Synthetic Canvas-only video; no screen recording, user media, microphone or real capture.
    const clipBytes=await inSnip(`(async()=>{
      const c=document.createElement('canvas');c.width=96;c.height=64;
      const ctx=c.getContext('2d'),stream=c.captureStream(20),chunks=[];
      const rec=new MediaRecorder(stream);
      const done=new Promise((resolve,reject)=>{
        rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
        rec.onstop=resolve;rec.onerror=reject;
      });
      rec.start();
      for(let i=0;i<8;i++){
        ctx.fillStyle=i%2?'#43bb99':'#021632';ctx.fillRect(0,0,96,64);
        await new Promise(r=>setTimeout(r,52));
      }
      rec.stop();await done;
      stream.getTracks().forEach(t=>t.stop());
      const blob=new Blob(chunks,{type:rec.mimeType});
      fixtureEvents.length=0;showVideoPreview(blob,1);return blob.size;
    })()`);
    assert(clipBytes>0);
    await expect.poll(async()=>{
      const p=await read();
      return p.showPane&&!p.showImage&&p.showVideo&&p.noCaptureRef&&p.frozenUnchanged&&p.srcLength===bytes(phase,beforeMovie.srcLength);
    }).toBe(true);
    dump.discarded.push({action:'video',visibleEncodedBytes:beforeMovie.srcLength,discardedAttributeBytes:(await read()).srcLength});
    await inSnip("document.querySelector('#pv-close').click(); true;");

    async function hold(rel){
      const ready=once(delayed,rel);
      await inSnip("fixtureEvents.length=0;showPreview("+JSON.stringify(origin+rel)+",'snip');true;");
      await Promise.race([ready,new Promise((_,rej)=>setTimeout(()=>rej(new Error('no delayed local image request')),5000).unref())]);
    }
    await hold('/slow-a.png');
    await inSnip("document.querySelector('#pv-retake').click();true;");
    release('/slow-a.png');
    if(phase==='stock')await expect.poll(async()=>(await read()).events).toEqual([{event:'load',width:1}]);
    else{
      await expect.poll(async()=>{
        const p=await read();return p.srcLength===0&&p.currentSrcLength===0&&p.width===0;
      }).toBe(true);
      await new Promise(r=>setTimeout(r,250));
      assert.deepEqual((await read()).events,[]);
    }
    const discardedRace=await read();
    assert(!discardedRace.showPane&&discardedRace.noCaptureRef&&discardedRace.frozenUnchanged);
    dump.race.discarded=discardedRace.events;

    await hold('/slow-b.png');
    await inSnip("document.querySelector('#pv-close').click();showPreview(fixturePng(80,60,101),'snip');true;");
    release('/slow-b.png');
    await expect.poll(async()=>{
      const p=await read();return p.showImage&&p.width===80&&p.height===60&&p.events.length===1;
    }).toBe(true);
    const last=await read();
    assert.deepEqual(last.events,[{event:'load',width:80}]);
    assert(last.frozenUnchanged&&last.srcLength>100&&!last.noCaptureRef);
    dump.race.replacement=last.events;
    dump.dimensions.push([last.width,last.height]);
    dump.eventsAfterValid.push(...positive.events,...last.events);
    fs.writeFileSync(output,JSON.stringify(dump,null,2)+'\n',{flag:'wx'});
  }finally{
    try{if(app)await app.close();}
    finally{
      server.closeAllConnections();
      if(server.listening)await new Promise(r=>server.close(r));
      fs.rmSync(profile,{recursive:true,force:true,maxRetries:8,retryDelay:300});
    }
  }
});
