'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const { performance } = require('node:perf_hooks');

const file = path.resolve(__dirname, '../../code/src/main/ai-providers.js');
const source = fs.readFileSync(file,'utf8');
const appRequire = createRequire(file);
function load(text) {
  const key = 'module.exports = {';
  assert.equal(text.split(key).length,2);
  const m={exports:{}};
  new Function('require','module',text.replace(key,key+' readSse,'))(appRequire,m);
  return m.exports;
}
const candidate = load(source);
const before = process.argv.includes('--compare') || process.argv.includes('--bench')
  ? load(fs.readFileSync(process.argv.at(-1),'utf8')) : null;

function split(text,sizes){
  const bytes=Buffer.isBuffer(text)?text:Buffer.from(text,'utf8'),out=[];
  for(let at=0,i=0;at<bytes.length;i++){
    const next=at+sizes[i%sizes.length];
    out.push(bytes.subarray(at,next));at=next;
  }
  return out;
}
function stream(chunks, obs, stopAt) {
  let i=0;
  return { getReader:()=>({
    async read(){
      if(i===stopAt)throw Error('synthetic stream interruption');
      return i<chunks.length?{value:chunks[i++],done:false}:{done:true};
    },
    releaseLock(){obs.released++;}
  }) };
}
async function observe(impl,chunks,opts={}) {
  const info={first:0,released:0,events:[],error:''};
  try{
    await impl.readSse(opts.fallback?{body:{},text:async()=>opts.fallback}:{body:stream(chunks,info,opts.stopAt)},
      v=>{info.events.push(v);if(opts.throwOn===v)throw Error('callback interrupted');},
      ()=>{info.first++;});
  }catch(e){info.error=e.message;}
  return info;
}
const sample = '﻿data: {"content":"café 😃 文字 and \\n"}\r\n\r\n' +
  ': comment\n data: 0\n  data: false   \n data: null\n data: {bad json}\n\n data: [DONE]\n' +
  'data: {"last":"EOF survives without one more line feed"}';

test('nonempty chunks, multi-byte characters, malformed lines and final event keep order',async()=>{
  const expected=[{content:'café 😃 文字 and \n'},0,false,null,{last:'EOF survives without one more line feed'}];
  for(const chunks of [[Buffer.from(sample)], ...[[1],[2,3,19],[257],[1,8192,4],[3301]].map(s=>split(sample,s))]){
    const payload = [Buffer.alloc(0),...chunks];
    const observed=await observe(candidate,payload);
    assert.deepEqual(observed,{first:1,released:1,events:expected,error:''});
    if(before)assert.deepEqual(observed,await observe(before,payload));
  }
});
test('empty, falsy EOF, malformed UTF-8 tail and text fallback preserve existing read contracts',async()=>{
  const parts=[
    {buf:[], expected:[], first:0},
    {buf:split('data: null\ndata: false',[2,1]),expected:[null],first:1},
    {buf:split('data: false\ndata: 0',[1]),expected:[false],first:1},
    {buf:[Buffer.from('data: {"n":1}'),Buffer.from([0xf0,0x9f])],expected:[{n:1}],first:1},
  ];
  for(const row of parts){
    const res=await observe(candidate,row.buf);
    assert.deepEqual(res,{first:row.first,released:1,events:row.expected,error:''});
    if(before)assert.deepEqual(res,await observe(before,row.buf));
  }
  const options={fallback:sample};
  const res=await observe(candidate,[],options);
  assert.deepEqual(res,{first:1,released:0,events:[{content:'café 😃 文字 and \n'},0,false,null,{last:'EOF survives without one more line feed'}],error:''});
  if(before)assert.deepEqual(res,await observe(before,[],options));
});
test('callback cancellation, failed reads and over-cap bytes release the original reader',async()=>{
  for(const [input, opts, expected] of [
    [[{byteLength:64*1024*1024+1}],{},'too large'],
    [split('data: 1\ndata: 2\n',[50]),{throwOn:1},'callback interrupted'],
    [split('data: 1\ndata: 2\n',[8]),{stopAt:1},'synthetic stream interruption'],
  ]){
    const res=await observe(candidate,input,opts);
    assert.equal(res.released,1);
    assert.match(res.error,new RegExp(expected));
    if(before)assert.deepEqual(res,await observe(before,input,opts));
  }
});
test('1,200 deterministic byte chunkings preserve full streamed event traces',async()=>{
  let seed=0x9ca72b;
  const rand=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  const reference=await observe(before||candidate,[Buffer.from(sample)]);
  for(let i=0;i<1200;i++){
    const sizes=Array.from({length:1+rand()%10},()=>1+rand()%90);
    const actual=await observe(candidate,split(sample,sizes));
    assert.deepEqual(actual,reference);
  }
});

const types={
  nim:{ data(part){return {choices:[{delta:{content:part}}]};},
        finish:{choices:[{finish_reason:'stop'}],usage:{prompt_tokens:5,completion_tokens:9}} },
  gemini:{ data(part){return {candidates:[{content:{parts:[{text:part}]}}]};},
           finish:{candidates:[{finishReason:'STOP'}],usageMetadata:{promptTokenCount:5,candidatesTokenCount:9}} },
};
function events(type,n,size){
  const row = types[type];
  const make=(value)=>'data: '+JSON.stringify(value)+'\r\n\r\n';
  const part='Synthetic delivered text with unicode é😀. '.repeat(Math.ceil(size/43)).slice(0,size);
  let all='';
  for(let i=0;i<n;i++)all+=make(row.data(part+(i===0?'':' '+i)));
  return all+make('[DONE]').replace('"[DONE]"','[DONE]')+'data: '+JSON.stringify(row.finish);
}
async function chatWith(impl,id,chunks,retain) {
  const got={released:0,visible:0,chunks:0,progress:[]};
  const cfg={apiKey:'synthetic-loopback-token', model:id==='nim'?'nvidia/local-test':'gemini-test-model',
    stream:true, messages:[{role:'user',content:'Only local bytes.'}],
    fetch:async()=>({ok:true,body:stream(chunks,got)}),
    onText(delta,all){got.visible+=delta.length;got.chunks++;if(retain)got.progress.push([delta,all]);}};
  const result=await impl.chat(id,cfg);
  assert.equal(got.released,1);
  assert.equal(got.visible,result.text.length);
  return {got,result};
}
test('real NIM and Gemini adapters receive identical split UTF and final usage/status',async()=>{
  for(const id of Object.keys(types)){
    const payload=split(events(id,22,79),[13,509,1,5,33,8192]);
    const a=await chatWith(candidate,id,payload,true);
    assert.equal(a.got.chunks,22);
    assert.deepEqual(a.result.usage,{input_tokens:5,output_tokens:9});
    if(before)assert.deepEqual(a,await chatWith(before,id,payload,true));
  }
});

if(process.argv.includes('--bench')){
 (async()=>{
   for(const [label,id,items,size,pieces,reps] of [
     ['ordinary short SSE','nim',80,25,[1024,479,23,3000],70],
     ['streamed paragraphs','nim',3000,42,[8192,32768],16],
     ['large unbroken provider line','nim',1,163840,[1024],10],
     ['large fragmented provider line','nim',1,1572864,[4096],4],
     ['same fragmented Gemini path','gemini',1,1572864,[4096],4],
   ]){
     const payload=split(events(id,items,size),pieces);
     assert.deepEqual(await chatWith(candidate,id,payload,true),await chatWith(before,id,payload,true));
     const now=async impl=>{
       const t=performance.now(), ox=process.cpuUsage();
       for(let i=0;i<reps;i++)await chatWith(impl,id,payload,false);
       const cpu=process.cpuUsage(ox);
       return {wallMs:(performance.now()-t)/reps,cpuMs:(cpu.user+cpu.system)/1000/reps};
     };
     for(let i=0;i<3;i++){await chatWith(before,id,payload,false);await chatWith(candidate,id,payload,false);}
     const old=[],fresh=[];
     for(let i=0;i<7;i++){
       if(i%2){fresh.push(await now(candidate));old.push(await now(before));}
       else{old.push(await now(before));fresh.push(await now(candidate));}
     }
     const med=x=>x.toSorted((a,b)=>a-b)[x.length>>1];
     const medians={};
     for(const k of ['wallMs','cpuMs']){
       const paired=fresh.map((q,i)=>q[k]-old[i][k]);
       medians[k]={before:med(old.map(x=>x[k])),after:med(fresh.map(x=>x[k])),pairedMedian:med(paired),range:[Math.min(...paired),Math.max(...paired)]};
     }
     console.log(JSON.stringify({label,id,items,wireBytes:payload.reduce((n,c)=>n+c.length,0),pieces:payload.length,rounds:7,reps,medians}));
   }
 })().catch(e=>{console.error(e.stack);process.exitCode=1;});
}
