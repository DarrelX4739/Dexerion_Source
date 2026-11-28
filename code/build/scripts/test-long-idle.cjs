'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {CHECKPOINTS,readOwnedSnapshot,memoryArm,memoryPair,wakeEvidence,describeParity}=require('./read-long-idle.cjs');
const base=Date.parse('2026-11-28T15:00:00Z');
const profile='C:\\temp\\dex-long-idle-stock';
const birth=i=>new Date(base+i).toISOString();
function makeArm(name,privateWsBytes=300000000) {
  const root={pid:101,ppid:1,name,privateWsBytes,startedUtc:birth(17),cmdline:name+' --user-data-dir='+profile};
  const child={pid:102,ppid:101,name,privateWsBytes:100000000,startedUtc:birth(21),
    cmdline:name+' --type=renderer --no-sandbox'};
  return [root,child];
}
function read(rows,aim,delay=400){
  return readOwnedSnapshot({capturedAt:birth(aim+delay),count:rows.length,processes:rows},
    101,rows[0].name,profile,base+aim,base+aim+5000);
}
test('accepts two complete time-matched quiet private-resident observations; never reports CPU/counters not asked for',()=>{
  const edge=memoryArm(CHECKPOINTS.map(a=>read(makeArm('msedge.exe'),a)),base);
  const dex=memoryArm(CHECKPOINTS.map(a=>read(makeArm('dexerion.exe',250000000),a)),base);
  const results=memoryPair(edge,dex);
  assert.deepEqual(results[1],{plannedElapsedMs:286000,edgePrivateResidentBytes:400000000,
    dexerionPrivateResidentBytes:350000000,dexerionMinusEdgeBytes:-50000000});
  assert(!JSON.stringify(results).includes('cpu'));
  assert(!JSON.stringify(results).includes(profile));
});
test('rejects polluted/unknown ancestry, duplicate PID, policy overrides and changed browser generations',()=>{
  const rows=makeArm('msedge.exe');
  assert.throws(()=>read([...rows,rows[1]],CHECKPOINTS[0]),/duplicate/);
  assert.throws(()=>read([rows[0],{...rows[1],startedUtc:birth(10)}],CHECKPOINTS[0]),/ancestry/);
  assert.throws(()=>read([rows[0],{...rows[1],startedUtc:null}],CHECKPOINTS[0]),/ancestry/);
  assert.throws(()=>read([{...rows[0],cmdline:rows[0].cmdline+' --no-sandbox'},rows[1]],CHECKPOINTS[0]),/Verified browser launch/);
  assert.throws(()=>read([rows[0],{...rows[1],cmdline:rows[1].cmdline+' --disable-web-security'}],CHECKPOINTS[0]),/unexpected policy/);
  assert.throws(()=>memoryArm([read(rows,CHECKPOINTS[0]),
    read([{...rows[0],startedUtc:birth(18)},rows[1]],CHECKPOINTS[1])],base),/generation changed/);
});
test('does not interpret missing private counters, racing endpoints or unmatched checkpoints as a favorable delta',()=>{
  const rows=makeArm('msedge.exe');
  const incomplete=[rows[0],{...rows[1],privateWsBytes:null}];
  const missingSnapshot=read(incomplete,CHECKPOINTS[0]);
  assert.equal(missingSnapshot.privateBytes,null);
  const arm=memoryArm(CHECKPOINTS.map(a=>read(rows,a)),base);
  const missing=memoryArm([missingSnapshot,read(rows,CHECKPOINTS[1])],base);
  assert.equal(memoryPair(arm,missing)[0].dexerionMinusEdgeBytes,null);
  assert.equal(memoryPair(arm,missing)[1].dexerionMinusEdgeBytes,0);
  assert.throws(()=>memoryPair(arm.slice(0,1),missing),/no silent dropping/);
  assert.throws(()=>memoryPair(arm,[{...arm[0],sampledElapsedMs:arm[0].sampledElapsedMs+4100},arm[1]]),/matched within/);
  assert.throws(()=>memoryArm([read(rows,CHECKPOINTS[0]-1),read(rows,CHECKPOINTS[1])],base),/raced/);
  assert.throws(()=>memoryArm([read(rows,CHECKPOINTS[0]+3000),read(rows,CHECKPOINTS[1])],base),/raced/);
  assert.throws(()=>memoryArm([read(rows,CHECKPOINTS[0]),{...read(rows,CHECKPOINTS[1]),end:base+300001}],base),/over time/);
});
test('reports live document, actual reload, and persistent/unsaved state separately',()=>{
  const original={token:'first-token',origin:base+120},again={token:'second-token',origin:base+385000};
  const visible={visible:true,storage:'marker',textValue:'marker'};
  const keep=wakeEvidence(original,{...original,...visible},[original],'marker',true);
  const reload=wakeEvidence(original,{...again,...visible,textValue:''},[original,again],'marker',true);
  assert.deepEqual(keep,{document:'same live document',navigationRequests:0,persistentCookie:true,
    persistentLocalStorage:true,unsavedFixtureText:true,confirmedVisible:true});
  assert.deepEqual(reload,{document:'reloaded replacement document',navigationRequests:1,persistentCookie:true,
    persistentLocalStorage:true,unsavedFixtureText:false,confirmedVisible:true});
  assert.match(describeParity(keep,reload),/do not represent equivalent behavior/);
  assert.match(describeParity(keep,keep),/no general/);
  assert.match(describeParity(keep,null),/not determined/);
  assert.throws(()=>wakeEvidence(original,{...again,...visible},[original],'marker',true),/bona fide/);
  assert.throws(()=>wakeEvidence(original,{...original,...visible,visible:false},[original],'marker',true),/visibility/);
  assert.throws(()=>wakeEvidence(original,{...again,...visible},[original,again,again],'marker',true),/one bona fide/);
  const negative=wakeEvidence(original,{...again,...visible,textValue:'',storage:null},[original,again],'marker',false);
  assert.equal(negative.persistentLocalStorage,false);
  assert.equal(negative.persistentCookie,false);
});

const http=require('node:http');
const {BrowserCdp,listenFixture}=require('./measure-long-idle.cjs');
class FakeBrowserSocket extends EventTarget {
  constructor(){super();this.readyState=1;this.messages=[];}
  send(raw) {
    const value=JSON.parse(raw);this.messages.push(value);
    const result=value.method==='Target.attachToTarget'?{sessionId:'temp-id'}:
      value.method==='Runtime.evaluate'?{result:{value:true}}:{};
    queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({id:value.id,result})})));
  }
  close(){queueMicrotask(()=>{this.readyState=3;this.dispatchEvent(new Event('close'));});}
}
test('browser CDP attaches only on demand, detaches the explicit session, and closes entirely before measurements',async()=>{
  const fake=new FakeBrowserSocket(),client=new BrowserCdp(fake);
  const proof=await client.eval('active-fixture','true');
  assert.equal(proof,true);
  assert.deepEqual(fake.messages.map(m=>[m.method,m.sessionId??null]),[
    ['Target.attachToTarget',null],['Runtime.evaluate','temp-id'],['Target.detachFromTarget',null],
  ]);
  assert.equal(fake.messages[2].params.sessionId,'temp-id');
  await client.close();
  assert.equal(fake.readyState,3);
  assert.throws(()=>client.send('Browser.getVersion'),/not open/);
});
test('the real loopback fixture isolates both serial arms and observes document/cookie events without browser CDP',async()=>{
  const f=await listenFixture();
  const u=new URL(f.urls[4]);
  const request=(method,pathname,headers={},body='')=>new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port:u.port,path:pathname,method,
      headers:{Host:u.host,...headers}},res=>{
      const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve({
        status:res.statusCode,cookie:res.headers['set-cookie']?.[0],body:Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error',reject);req.end(body);
  });
  try{
    const edge=f.reset();
    const doc=await request('GET','/tab/4');
    assert.equal(doc.status,200);
    assert.match(doc.cookie,/dexlong4=stock-fixture; .*HttpOnly/);
    const token=edge.loads[4][0].token;
    assert(doc.body.includes(token));
    assert.equal((await request('POST','/ready/4',{},JSON.stringify({slot:4,token:'unowned',origin:100,visible:'hidden',text:'',storage:null}))).status,422);
    const proof={slot:4,token,origin:100,visible:'hidden',text:'SYNTHETIC_UNSAVED_4',storage:'SYNTHETIC_UNSAVED_4'};
    assert.equal((await request('POST','/ready/4',{},JSON.stringify(proof))).status,204);
    assert.deepEqual(edge.loads[4][0].document,proof);
    assert.equal((await request('POST','/ready/4',{},JSON.stringify(proof))).status,422);
    assert.equal((await request('GET','/cookie/4',{Cookie:'dexlong4=stock-fixture'})).body,'true');
    const replaced=await request('GET','/tab/4',{Cookie:'dexlong4=stock-fixture'});
    assert.equal(replaced.cookie,undefined);
    assert.notEqual(edge.loads[4][1].token,token);
    const dex=f.reset();
    assert.equal(dex.loads[4].length,0);
    assert.equal((await request('GET','/tab/4',{Host:'wrong.localhost:'+u.port})).status,404);
    assert.equal((await request('GET','/tab/4')).status,200);
    assert.equal(dex.loads[4].length,1);
    assert.equal(edge.loads[4].length,2);
  }finally{f.server.closeAllConnections();await new Promise(r=>f.server.close(r));}
});
