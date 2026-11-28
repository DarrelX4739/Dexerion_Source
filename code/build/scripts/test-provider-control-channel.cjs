'use strict';
const assert=require('node:assert/strict');
const { performance }=require('node:perf_hooks');
const { test }=require('node:test');
const path=require('node:path');

const now=require('../../code/src/main/ai-providers');
const old=process.argv.includes('--compare')||process.argv.includes('--bench')
  ? require(path.resolve(process.argv.at(-1))) : null;
const create=now.createControlFilter;
function trace(module,chunks){
  const f=module.createControlFilter(), observed=[];
  for(const chunk of chunks)observed.push([f.push(chunk),f.getThinking()]);
  observed.push([f.flush(),f.getThinking()],[f.flush(),f.getThinking()]);
  return observed;
}
function proof(chunks){
  const result=trace(now,chunks);
  if(old)assert.deepEqual(result,trace(old,chunks));
  return result;
}
test('hidden in-flight details do not leak even through the thinking getter',()=>{
  const input=['left<|ChAn','NeL|>private',' thought<CH','ANNEL|>right','<|channel>unfinished <channel'];
  assert.deepEqual(proof(input),[
    ['left',''], ['',''], ['',''], ['right','private thought'], ['','private thought'],
    ['','private thoughtunfinished <channel'], ['','private thoughtunfinished <channel'],
  ]);
});
test('partial closers, case, cap and unmatched EOF preserve code units and stage semantics',()=>{
  const thought='a'.repeat(7999)+'😀'+ '📝'.repeat(70_000);
  const inFlight=['<|channel>',thought,'<chAnn','el|>end','<|channel||> old unsupported','<|channel>another'];
  const rows=proof(inFlight);
  assert.equal(rows[1][1],'');
  assert.equal(rows[2][1],'');
  assert.equal(rows[3][0],'end');
  assert.equal(rows[3][1],thought.slice(0,8000));
  assert.equal(rows[3][1].at(-1).charCodeAt(0),0xd83d);
  assert.equal(rows.at(-1)[1],thought.slice(0,8000));
  assert.deepEqual(proof(['<|channel>', '\udfff'.repeat(40_000), '<channel|>']),
    [['',''],['',''],['','\udfff'.repeat(8000)],['','\udfff'.repeat(8000)],['','\udfff'.repeat(8000)]]);
});
test('6,000 seeded marker partitions preserve every visible/hidden output, including live getters',()=>{
  const tokens=['<|channel>','<|channel|>','<|CHANNEL>','<channel|>','<ChANNel|>','<chan',
   '<channel','|>', '<start_of_turn>', '</end_of_turn>','<bos>','<eos>','<|begin_of_text|>',
   ' ordinary < math || ', 'x\n\r', '😀', '\udfff', '\u00a0', '\u2028'];
  let seed=271721;
  const rng=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  for(let j=0;j<6000;j++){
    let raw='';
    for(let i=0,n=5+rng()%24;i<n;i++)raw+=tokens[rng()%tokens.length];
    const input=[];
    for(let i=0;i<raw.length;){const end=i+1+rng()%18;input.push(raw.slice(i,end));i=end;}
    if(j%5===0)input.splice(input.length>>1,0,null,0,'',undefined,9,42);
    const rows=proof(input);
    assert.equal(rows.length,input.length+2);
  }
});
const seq='kept reasoning line — only for the collapsible detail. ';
function build(n,opts={}) {
 const parts=[];
 if(!opts.visible)parts.push('Visible before. <|chan','nel>');
 for(let i=0;i<n;i++)parts.push(opts.visible?'Plain answer text ' + i + ' ':seq + (i%19) + ' ');
 if(!opts.visible)parts.push('<ChAnn','EL|> Visible after.');
 return parts;
}
function publicAdapterInput(provider,count) {
 const input=build(count);
 const event=value=>Buffer.from('data: '+JSON.stringify(value)+'\r\n\r\n','utf8');
 return input.map(v=>event(provider==='gemini'
   ? {candidates:[{content:{parts:[{text:v}]}}]}
   : {choices:[{delta:{content:v}}]}));
}
async function publicAdapter(module,id,body) {
 let at=0;const got=[];
 const result=await module.chat(id,{apiKey:'local-fixture-key',model:id==='gemini'?'gemini-fixture':'nvidia/fixture',
  stream:true,messages:[{role:'user',content:'Fixture only.'}],
  fetch:async()=>({ok:true,body:{getReader:()=>({
   async read(){return at<body.length?{value:body[at++],done:false}:{done:true};},releaseLock(){}})}}),
  onText:(delta,full)=>got.push([delta,full]),
 });
 return {result,got};
}
test('real NIM and Gemini chat adapters still hide fragmented controls and cap the same reasoning',async()=>{
 for(const id of ['nim','gemini']){
  const n=1100, one=publicAdapterInput(id,n), r=await publicAdapter(now,id,one);
  assert.equal(r.result.text,'Visible before.  Visible after.');
  assert.equal(r.result.thinking.length,8000);
  assert.deepEqual(r.got.map(x=>x[0]),['Visible before. ',' Visible after.']);
  if(old)assert.deepEqual(r,await publicAdapter(old,id,one));
 }
});
if(process.argv.includes('--bench')){
 const med=c=>c.toSorted((x,y)=>x-y)[c.length>>1];
 for(const [name, n, reps, visible] of [
  ['normal visible events',80,360,true],['short hidden content',80,240,false],
  ['long hidden content',2500,8,false],['stress hidden content',9000,2,false],
 ]){
  const input=build(n,{visible});
  assert.deepEqual(trace(old,input),trace(now,input));
  function batch(module){
    let checksum=0;const t=performance.now(),c0=process.cpuUsage();
    for(let i=0;i<reps;i++){
      const filter=module.createControlFilter();
      for(const p of input)checksum+=filter.push(p).length;
      checksum+=filter.flush().length+filter.getThinking().length;
    }
    const c=process.cpuUsage(c0);
    assert.ok(checksum>0);
    return {wallMs:(performance.now()-t)/reps,cpuMs:(c.user+c.system)/1000/reps};
  }
  const l=[],r=[];
  batch(old);batch(now);
  for(let i=0;i<7;i++){
   if(i%2){r.push(batch(now));l.push(batch(old));}
   else{l.push(batch(old));r.push(batch(now));}
  }
  const stats={};
  for(const k of ['wallMs','cpuMs']){
   const ds=r.map((q,i)=>q[k]-l[i][k]);
   stats[k]={old:med(l.map(v=>v[k])),candidate:med(r.map(v=>v[k])),pairedDelta:med(ds),range:[Math.min(...ds),Math.max(...ds)]};
  }
  console.log(JSON.stringify({name,n,reps,rounds:7,codeUnits:input.reduce((sum,v)=>sum+v.length,0),stats}));
 }
}
