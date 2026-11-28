'use strict';
const assert=require('node:assert/strict');
const {createHook}=require('node:async_hooks');
const fs=require('node:fs');
const path=require('node:path');
const {setImmediate: turn}=require('node:timers/promises');
const {test}=require('node:test');
const app=path.resolve(__dirname,'../../code/src/main/ai-agent.js');
const {createAgentRunner}=require(app);
const here=fs.readFileSync(app,'utf8').split(/\r?\n/).flatMap((s,i)=>s.includes("setTimeout(() => rej(new Error('step timeout after '")?[i+1]:[]);
assert.equal(here.length,1);
const stamp='/src/main/ai-agent.js:'+here[0]+':';

function observe(t) {
  const active=new Set();
  let started=0,fired=0;
  const hook=createHook({
    init(id,kind){
      if(kind==='Timeout' && String(new Error().stack).replace(/\\/g,'/').includes(stamp)){
        active.add(id);started++;
      }
    },
    before(id){if(active.has(id))fired++;},
    destroy(id){active.delete(id);},
  }).enable();
  t.after(()=>hook.disable());
  return ()=>({started,fired,pending:active.size});
}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function fixture(ms,dispatch){
  const fixtures=[
    { id:'plan',name:'update_plan',input:{goal:'Read a synthetic page',steps:[{id:'s1',text:'Read only the local fixture',timeoutMs:ms}]} },
    { id:'read',name:'snapshot',input:{stepId:'s1'} },
    { id:'stop',name:'done',input:{summary:'Read-only fixture finished.'} },
  ];
  const agent=createAgentRunner({
    streamTurn:async()=>{assert(fixtures.length,'unexpected extra model call');return {text:'',toolCalls:[fixtures.shift()]};},
    dispatch,
    askUser:async()=>assert.fail('no approval needed or expected for a local snapshot'),
    emit:()=>{},onStop:()=>{},
  });
  const run=agent.startRun({tabId:'fixture',winId:7,url:'http://127.0.0.1:1/',settings:{},memory:[],history:[]});
  return {agent,run,execute:()=>agent.runLoop(run)};
}
const cleanRead={ok:true,url:'http://127.0.0.1:1/',title:'Fixture',text:'Local content',nodes:[]};
const eventsUntilIdle=async()=>{await turn();await turn();};

test('completed dispatch releases its real observed timeout and preserves output',async t=>{
  const sample=observe(t);
  const {execute,run}=fixture(400,async()=>cleanRead);
  const answer=await execute();await eventsUntilIdle();
  assert.equal(run.plan.steps[0].status,'done');
  assert.match(run.plan.steps[0].note,/Local content/);
  assert.match(answer.text,/Read-only fixture finished/);
  assert.equal(answer.halted,false);
  assert.deepEqual(sample(),{started:1,fired:0,pending:0});
});

test('rejected dispatch preserves its error and releases the unused deadline',async t=>{
  const sample=observe(t);
  const {execute,run}=fixture(400,async()=>{throw new Error('Synthetic read error');});
  const answer=await execute();await eventsUntilIdle();
  assert.equal(run.plan.steps[0].status,'failed');
  assert.match(run.plan.steps[0].note,/FAILED: Synthetic read error/);
  assert.match(answer.text,/Read-only fixture finished/);
  assert.deepEqual(sample(),{started:1,fired:0,pending:0});
});

test('deadline still rejects the action and handles dispatch rejection that arrives later',async t=>{
  const sample=observe(t);
  const work=deferred();
  const {execute,run}=fixture(65,()=>work.promise);
  const answer=await execute();
  assert.equal(run.plan.steps[0].status,'failed');
  assert.match(run.plan.steps[0].note,/FAILED: step timeout after 65ms/);
  assert.match(answer.text,/Read-only fixture finished/);
  // node:test would also fail for a late unhandled rejection.
  const late=[];const reject=error=>late.push(error);
  process.on('unhandledRejection',reject);t.after(()=>process.off('unhandledRejection',reject));
  work.reject(new Error('Synthetic rejection after timeout already won'));
  await eventsUntilIdle();
  assert.deepEqual(late,[]);
  assert.deepEqual(sample(),{started:1,fired:1,pending:0});
});

test('window closure still halts; discard a later completion and release its timer',async t=>{
  const sample=observe(t);
  const work=deferred(), entered=deferred();
  const {execute,run,agent}=fixture(400,()=>{entered.resolve();return work.promise;});
  const pending=execute();await entered.promise;
  assert.deepEqual(sample(),{started:1,fired:0,pending:1});
  agent.windowClosed(run.winId);
  assert.equal(run.halted,true);
  work.resolve(cleanRead);
  const output=await pending;await eventsUntilIdle();
  assert.equal(output.halted,true);
  assert.equal(run.haltReason,'the window closed');
  assert(run.steps.some(step=>step.name==='snapshot'&&/Stopped while this was running/.test(step.detail)));
  assert.deepEqual(sample(),{started:1,fired:0,pending:0});
});

test('a step without a plan deadline schedules no extra timer',async t=>{
  const sample=observe(t);
  const {execute,run}=fixture(0,async()=>cleanRead);
  assert.match((await execute()).text,/Read-only fixture finished/);
  assert.equal(run.plan.steps[0].status,'done');
  assert.deepEqual(sample(),{started:0,fired:0,pending:0});
});
