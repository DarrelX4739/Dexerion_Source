'use strict';

// Chromium renderer comparison on two synthetic loopback pages only.
// The candidate is a temporary script sent to the owned fixture tab, never the app.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { once } = require('node:events');
const { launchDexerion } = require('../../code/build/e2e/app');
const { snapshotScript } = require('../../code/code/src/main/ai-page');

function candidate(original) {
  const needle = '  var bodyText = readable(pickRoot());';
  const oldSelection = 'text: (articleText.length > 400 && articleText.length > bodyText.length * 0.75) ? articleText : bodyText,';
  assert.equal(original.split(needle).length, 2, 'the tested product snapshot structure changed');
  assert.equal(original.split(oldSelection).length, 2);
  const next = `  function articleBeatsReadable(root, length) {
    if (!root || length <= 400) return false;
    try {
      if (root.ownerDocument !== document || document.contentType !== 'text/html' ||
          root.cloneNode !== Node.prototype.cloneNode ||
          !root.localName || root.localName.includes('-') || root.hasAttribute('is')) return false;
      var rawLength = (root.textContent || '').length;
      if (length <= rawLength * 0.75) return false;
      var elements = root.querySelectorAll('*');
      if (length <= (rawLength + elements.length) * 0.75) return false;
      for (var i = 0; i < elements.length; i++) {
        var el = elements[i];
        if (el.localName.includes('-') || el.hasAttribute('is')) return false;
      }
      return true;
    } catch (e) { return false; }
  }
  var root = pickRoot();
  var useArticle = articleBeatsReadable(root, articleText.length);
  var bodyText = useArticle ? '' : readable(root);`;
  return original.replace(needle, next).replace(oldSelection,
    'text: (useArticle || (articleText.length > 400 && articleText.length > bodyText.length * 0.75)) ? articleText : bodyText,');
}

const title = 'Readability allocation fixture';
const phrase = 'Several independent readings of the measurement and their uncertainties are included to make the experiment easier to verify. Additional observations clarify the background and the two detailed conditions.';
const nrows = 700;
const article = Array.from({length:nrows}, (_,i) =>
  '<section><h2>Technical passage ' + i + '</h2><p>' + phrase + '</p><p>Measurements and independent follow-up are useful here.<br>Second line from this fixture.</p></section>'
).join('');
function fixture(mode) {
  const custom = mode === 'closed-shadow' ? (
    '<div id="fixture-closed-host"></div><script>' +
    'window.__fixtureConstructors=0;customElements.define("local-fixture-card",class extends HTMLElement{' +
    'constructor(){super();window.__fixtureConstructors++}});' +
    'const shadow=document.getElementById("fixture-closed-host").attachShadow({mode:"closed",clonable:true});' +
    'shadow.appendChild(document.createElement("local-fixture-card"));' +
    'window.__fixtureShadowExists=true;</script>'
  ) : '';
  return '<!doctype html><meta charset="utf-8"><title>' + title + '</title><meta name="description" content="Fixed fixture">' +
    '<nav>Navigation and unrelated details</nav><main><article>' + article + custom +
    '</article></main><footer>Only local bytes</footer>';
}

async function run() {
  const output = path.resolve(process.argv[2]);
  const profiles = new Set();
  const server = http.createServer((req,res) => {
    const mode = req.url === '/closed-shadow' ? 'closed-shadow' : req.url === '/article' ? 'article' : '';
    if (!mode || req.method !== 'GET' || req.headers.host !== '127.0.0.1:' + server.address().port) {
      res.writeHead(404, {Connection:'close'}).end();return;
    }
    res.writeHead(200, {'content-type':'text/html; charset=utf-8','cache-control':'no-store',Connection:'close'}).end(fixture(mode));
  });
  const listening=once(server,'listening');
  server.listen(0,'127.0.0.1');
  await listening;
  const base = 'http://127.0.0.1:' + server.address().port;
  const original=snapshotScript(), proposed=candidate(original);
  const order=['original','proposed'];
  const all={ article:[], 'closed-shadow':[] };
  try {
    for (const mode of Object.keys(all)) {
      const { app,win,profile } = await launchDexerion({ attempts:1 });
      profiles.add(profile);
      try {
        assert.ok(path.basename(profile).startsWith('dexerion-e2e-'));
        assert.equal(await app.evaluate(() => process.versions.electron),'44.4.5');
        const target=base + '/' + mode;
        const id=await win.evaluate(u => window.dexerion.invoke('dex:new-tab',u,false), target);
        let ready = false;
        for(let tries=0;tries<80 && !ready;tries++){
          ready=await win.evaluate(({id,url})=>window.dexerion.invoke('dex:get-state').then(s=>s.active===id &&
            s.tabs.some(t=>t.id===id&&t.url===url&&t.title==='Readability allocation fixture'&&!t.loading)),{id,url:target});
          if(!ready)await new Promise(r=>setTimeout(r,100));
        }
        assert.ok(ready,'exact active fixture was not loaded');
        const result=await app.evaluate(async ({ webContents }, { target, mode, original, proposed, order, nrows }) => {
          const all=webContents.getAllWebContents().filter(w=>w.getURL()===target);
          if(all.length!==1)throw Error('expected one exact workload renderer');
          const wc=all[0], pid=wc.getOSProcessId();
          const body=`(async()=>{
            if(document.visibilityState!=="visible"||document.querySelectorAll("article section").length!==${nrows})throw Error("workload proof failed");
            if(${JSON.stringify(mode)}==="closed-shadow"&&(!window.__fixtureShadowExists||window.__fixtureConstructors!==1))
              throw Error("closed clonable shadow root not initialized");
            const orig=Node.prototype.cloneNode, counts={elements:0,documents:0};
            Node.prototype.cloneNode=function(deep){
              if(this.nodeType===Node.ELEMENT_NODE)counts.elements++;
              if(this.nodeType===Node.DOCUMENT_NODE)counts.documents++;
              return orig.call(this,deep);
            };
            const f0=()=>${original}, f1=()=>${proposed};
            const rows=[];
            let canonical;
            for(let i=0;i<${mode==='article'?13:2};i++){
              const sequence = i % 2 ? [f1,f0] : [f0,f1];
              const sample={};
              for(const f of sequence){
                counts.elements=0;counts.documents=0;
                const before=window.__fixtureConstructors||0, start=performance.now(), out=f(), end=performance.now();
                const after=window.__fixtureConstructors||0;
                const payload=JSON.stringify(out);
                if(canonical===undefined)canonical=payload;
                if(payload!==canonical)throw Error("exact exposed snapshot output differs");
                sample[f===f0?"original":"proposed"]={wallMs:end-start,elementClones:counts.elements,
                  documentClones:counts.documents,constructors:after-before,textLength:out.text.length};
              }
              if(i>0||${JSON.stringify(mode)}!=="article")rows.push(sample);
              if(i>0&&${JSON.stringify(mode)}==="article")await new Promise(r=>requestAnimationFrame(r));
            }
            return rows;
          })()`;
          const rows=await wc.executeJavaScript(body);
          return {rows,stableRenderer:pid>0&&wc.getOSProcessId()===pid,version:process.versions.chrome};
        },{target,mode,original,proposed,order,nrows});
        assert.ok(result.stableRenderer);
        all[mode]=result;
      } finally {
        await app.close();
        fs.rmSync(profile,{recursive:true,force:true,maxRetries:8,retryDelay:300});
        profiles.delete(profile);
      }
    }
  } finally {
    await new Promise(r=>server.close(r));
    for(const p of profiles)if(path.dirname(p)===os.tmpdir()&&path.basename(p).startsWith('dexerion-e2e-'))
      fs.rmSync(p,{recursive:true,force:true,maxRetries:8,retryDelay:300});
  }
  const fields=['constructors','documentClones'];
  const checks={
    exposedOutputParity:true,
    removesOnePlainArticleClone:all.article.rows.every(r=>r.original.elementClones===1&&r.proposed.elementClones===0),
    shadowExternalSideEffectsAgree:all['closed-shadow'].rows.every(r=>fields.every(k=>r.original[k]===r.proposed[k])),
  };
  const doc={scope:'Actual locked Chromium in an unchanged app and disposable synthetic tabs; not an Edge or CPU/RAM comparison.',checks,all};
  fs.writeFileSync(output,JSON.stringify(doc,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(checks));
  assert.ok(checks.removesOnePlainArticleClone && checks.shadowExternalSideEffectsAgree,
    'Implementation remains an experiment: execution or shadow-DOM effect parity failed');
}

if(require.main===module)run().catch(err=>{console.error(err);process.exitCode=1;});
module.exports={candidate,fixture};
