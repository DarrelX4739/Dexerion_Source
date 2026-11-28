'use strict';
const assert=require('node:assert/strict'),test=require('node:test');
const {summarizeInterval}=require('./windows-cycle-interval.cjs');
const ids=[33,61],g=new Map([[33,'134300000000000000'],[61,'134300000012345678']]);
function reads(){
  const row=(i,t)=>({pid:ids[i],started:g.get(ids[i]),user:'1000',kernel:'500',
    cycles:(928884123207410000n+BigInt(t)).toString()});
  return [
    {kind:'sample',start:'19999999999',end:'20000003000',rows:[row(0,0),row(1,0)]},
    {kind:'sample',start:'20004000000',end:'20004003000',rows:[row(0,200),row(1,4501)]},
  ];
}
test('preserves a precise nonzero cycle delta above JS integer precision while FILETIME is unchanged',()=>{
  const r=summarizeInterval(ids,g,'1000000',...reads(),4000);
  assert.equal(r.renderer.counterCpuMs,0);
  assert.equal(r.renderer.cycleDelta,'4501');
  assert.equal(r.browser.cycleDelta,'200');
  assert(Math.abs(r.wallMs-4000)<1);
  assert.equal(r.endpointSkewMs,3.001);
});
test('rejects reused PID, omitted/foreign process, counter reset and unstable endpoints',()=>{
  const bad=(fn,reason)=>{const r=reads();fn(r);assert.throws(()=>summarizeInterval(ids,g,'1000000',...r,4000),reason);};
  bad(r=>r[1].rows[1].started='134300000099999999',/generation changed/);
  bad(r=>r[1].rows[1].pid=62,/wrong\/duplicate/);
  bad(r=>r[1].rows[1].cycles='100',/counter reset/);
  bad(r=>r[1].end='20004300000',/endpoint skew/);
  bad(r=>{r[1].start='20008000000';r[1].end='20008000001';},/sample window/);
});
