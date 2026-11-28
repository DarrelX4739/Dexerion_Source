'use strict';
// The existing agent API reads a harmless local fixture. Async hooks observe
// deadline lifetime without wrapping timers, changing policies, or forcing GC.
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const {once}=require('node:events');
const http=require('node:http');
const path=require('node:path');
const {test,expect}=require('@playwright/test');
const {launchDexerion}=require('./app');
const {startAiMock}=require('./ai-mock');

const GOAL='Read only the synthetic cedar and fern labels in this test page.';
const FINISH='Found both fixture labels; the page stayed unchanged.';
const HTML='<!doctype html><title>Deadline fixture page</title><h1>Alpha Cedar</h1><p>Beta Fern</p>';
const plan=Object.freeze([
  {id:'peek',text:'Read the local page',timeoutMs:30000},
  {id:'cedar',text:'Find the Cedar label on this page',timeoutMs:30000,dependsOn:['peek']},
  {id:'fern',text:'Find the Fern label on this page',timeoutMs:30000,dependsOn:['cedar']},
]);
const actions=[
  {name:'update_plan',args:{goal:GOAL,steps:plan}},
  {name:'snapshot',args:{stepId:'peek'}},
  {name:'find_text',args:{query:'Alpha Cedar',stepId:'cedar'}},
  {name:'find_text',args:{query:'Beta Fern',stepId:'fern'}},
  {name:'done',args:{summary:FINISH}},
];

async function observeDeadline(app) {
  const source=fs.readFileSync(path.join(__dirname,'../../code/src/main/ai-agent.js'),'utf8');
  const sourceLines=source.split(/\r?\n/).flatMap((s,i)=>s.includes("setTimeout(() => rej(new Error('step timeout after '")?[i+1]:[]);
  expect(sourceLines).toHaveLength(1);
  await app.evaluate((_,marker)=>{
    const {createHook}=process.getBuiltinModule('async_hooks');
    const live=new Set();let started=0,fired=0;
    const hook=createHook({
      init(id,type){
        if(type==='Timeout'&&String(new Error().stack).replace(/\\/g,'/').includes(marker)){
          started++;live.add(id);
        }
      },
      before(id){if(live.has(id))fired++;},
      destroy(id){live.delete(id);},
    }).enable();
    globalThis.__dexDeadlineFixture={stop:()=>hook.disable(),sample:()=>({started,fired,pending:live.size})};
  },'/src/main/ai-agent.js:'+sourceLines[0]+':');
  return () => app.evaluate(()=>new Promise(resolve=>setImmediate(()=>resolve(globalThis.__dexDeadlineFixture.sample()))));
}

test('owned tab closure leaves no completed planned-step deadline behind', async ({}, testInfo)=>{
  const mode = process.env.DEX_AGENT_DEADLINE_FIXTURE || 'candidate';
  expect(['stock','candidate']).toContain(mode);
  const seen=[];
  const mock=await startAiMock({replyFor:body=>{
    const messages=Array.isArray(body.messages)?body.messages:[];
    if(!body.stream||body.max_tokens===1||!Array.isArray(body.tools)||
        !messages.some(m=>m?.role==='user'&&String(m.content||'').includes(GOAL)))return 'NONE';
    const toolTurns=messages.filter(m=>m?.role==='tool');
    const next=actions[toolTurns.length];
    if(!next)return 'Unexpected extra fixture turn.';
    seen.push({name:next.name,tools:toolTurns.map(m=>String(m.content||'').slice(0,4000))});
    return {content:'',toolCalls:[next]};
  }});
  const server=http.createServer((req,res)=>{
    if(req.url!=='/deadline-fixture')return res.writeHead(404,{Connection:'close'}).end();
    return res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',Connection:'close'}).end(HTML);
  });
  let launched;
  try {
    const listening=once(server,'listening');server.listen(0,'127.0.0.1');await listening;
    const url='http://127.0.0.1:'+server.address().port+'/deadline-fixture';
    launched=await launchDexerion({aiBase:mock.url});
    const {app,win}=launched;
    const fixtureId=await win.evaluate(async url=>{
      const api=window.dexerion;
      await api.invoke('dex:ai-key-set','nvapi-local-deadline-fixture');
      await api.invoke('dex:ai-agent-set',{agent:true,agentAllowlistOn:true,agentSites:['example.invalid'],agentCrossTab:false});
      const tab=await api.invoke('dex:new-tab',url,false);
      await api.invoke('dex:ai-open');
      return tab;
    },url);
    const state=()=>win.evaluate(()=>window.dexerion.invoke('dex:get-state'));
    await expect.poll(async()=>{
      const s=await state();return s.active===fixtureId&&s.tabs.find(t=>t.id===fixtureId)?.url===url&&s.tabs.find(t=>t.id===fixtureId)?.loading===false;
    }).toBe(true);
    await expect.poll(()=>app.evaluate(({webContents},url)=>{
      const page=webContents.getAllWebContents().find(w=>w.getURL()===url);
      return page?.executeJavaScript(`document.visibilityState==='visible'&&document.querySelector('h1')?.textContent==='Alpha Cedar'`,false);
    },url)).toBe(true);

    // Use the app's own refusal path as a negative policy control. Only the
    // authorized throwaway profile is then configured for this loopback host.
    const read=await observeDeadline(app);
    const denied=await win.evaluate(text=>window.dexerion.invoke('dex:ai-agent-run',{messages:[{role:'user',text}]}),GOAL);
    expect(denied.ok).toBe(false);
    expect(denied.error).toContain('Acting is limited to your allowed sites');
    expect(await read()).toEqual({started:0,fired:0,pending:0});
    await win.evaluate(()=>window.dexerion.invoke('dex:ai-agent-set',{
      agent:true,agentAllowlistOn:true,agentSites:['127.0.0.1'],agentCrossTab:false,
    }));
    await expect(win.locator('#ai-sidebar:not([hidden])')).toBeVisible();
    await expect(win.locator('#ai-agent-toggle')).toHaveAttribute('aria-pressed','true');
    await win.getByRole('button',{name:'New chat',exact:true}).click();
    await expect.poll(()=>win.evaluate(()=>window.dexerion.invoke('dex:ai-chats-list').then(rows=>rows.length))).toBe(1);
    const startedAt=Date.now();
    await win.fill('#ai-input',GOAL);
    await win.press('#ai-input','Enter');
    await expect(win.locator('#ai-messages')).toContainText(FINISH,{timeout:22000});
    await expect(win.locator('#ai-runbar')).toBeHidden();
    expect(seen.map(x=>x.name)).toEqual(actions.map(x=>x.name));
    expect(seen[2].tools.at(-1)).toContain('Alpha Cedar');
    expect(seen[3].tools.at(-1)).toContain('Alpha Cedar');
    expect(seen[4].tools.at(-1)).toContain('Beta Fern');
    const pending=mode==='stock'?3:0;
    const afterRun=await read();
    const closed=await win.evaluate(id=>window.dexerion.invoke('dex:close-tab',id),fixtureId);
    expect(closed).not.toBe(false);
    await expect.poll(async()=>!(await state()).tabs.some(t=>t.id===fixtureId)).toBe(true);
    const afterTabClose=await read();
    const elapsedMs=Date.now()-startedAt;
    expect(elapsedMs).toBeLessThan(26000); // the original 30s deadline has not expired
    const result={mode,elapsedMs,afterRun,afterTabClose,tools:seen.map(x=>x.name)};
    await testInfo.attach('planned-agent-deadline-lifecycle',{body:Buffer.from(JSON.stringify(result,null,2)),contentType:'application/json'});
    console.log('planned-agent-deadline-lifecycle:',JSON.stringify(result));
    expect(afterRun).toEqual({started:3,fired:0,pending});
    expect(afterTabClose).toEqual({started:3,fired:0,pending});
  }finally{
    try{
      if(launched){await launched.app.evaluate(()=>globalThis.__dexDeadlineFixture?.stop()).catch(()=>{});await launched.app.close();}
    }finally{
      await mock.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
      if(launched)await fsp.rm(launched.profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
    }
  }
});
