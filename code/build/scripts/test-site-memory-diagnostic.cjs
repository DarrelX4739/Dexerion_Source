'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {verifiedFramePid,readHeapUsage,verifiedSiteRows,readAllocatorDump,describeAllocatorRecords,hexBytes,readExternalScriptSourceDump}=require('./read-site-memory-diagnostic.cjs');
test('frame metadata needs the exact verified top frame/URL, not trace emitter PID',()=>{
  const frame={id:'aaaa',url:'http://fixture-1.localhost:123/work'};
  const event={name:'TracingStartedInBrowser',pid:123,args:{data:{frames:[
    {frame:'AAAA',url:frame.url,processId:456},
    {frame:'AAAA',url:frame.url,processId:789,parent:'outer'},
    {frame:'XXXX',url:frame.url,processId:111},
  ]}}};
  assert.equal(verifiedFramePid([event],frame),456);
  assert.throws(()=>verifiedFramePid([event],{...frame,url:frame.url+'x'}),/no unique exact/);
  assert.throws(()=>verifiedFramePid([event,event],frame),/no unique exact/);
});
test('keeps measured heap/backing fields separate; missing optional data is null',()=>{
  assert.deepEqual(readHeapUsage({usedSize:100,totalSize:200,backingStorageSize:0}),
    {jsHeapUsedBytes:100,jsHeapAllocatedBytes:200,embedderGcHeapUsedBytes:null,arrayBufferAndStringBackingBytes:0});
  assert.throws(()=>readHeapUsage({usedSize:100,totalSize:10}),/invalid CDP/);
});
test('requires nine distinct isolates/process generations and non-missing private resident data',()=>{
  const maps=Array.from({length:9},(_,i)=>({pid:i+50,isolate:'iso-'+i}));
  const rows=maps.map(m=>({pid:m.pid,startedUtc:'2026-09-01T12:41:12Z',cmdline:'browser.exe --type=renderer --local',privateWsBytes:10}));
  assert.equal(verifiedSiteRows(maps,rows,rows).length,9);
  assert.throws(()=>verifiedSiteRows([...maps.slice(1),maps[1]],rows,rows),/nine distinct/);
  assert.throws(()=>verifiedSiteRows(maps,rows,rows.map((r,i)=>i? r:{...r,startedUtc:'2026-09-01T12:42:12Z'})),
    /renderer\/working set lost/);
});
test('uses only safe scalar byte values and reports missing, nonadditive allocator nodes',()=>{
  const event=(id='0x0')=>({id,pid:81,cat:'disabled-by-default-memory-infra',ph:'v',
    args:{dumps:{allocators:{v8:{attrs:{size:{type:'scalar',units:'bytes',value:'100'}}},
      partition_alloc:{attrs:{effective_size:{type:'scalar',units:'bytes',value:'10'}}},
      'v8/heap/space':{attrs:{size:{type:'scalar',units:'bytes',value:'ffff'}}},
    }}}});
  const result=readAllocatorDump([event()],{success:true,dumpGuid:'0xa9'},[81,82]);
  assert.equal(result.format,'single Perfetto export id');
  assert.equal(result.rows[0].categories.v8.sizeBytes,256);
  assert.equal(result.rows[0].categories.partition_alloc.effectiveBytes,16);
  assert.equal(result.rows[0].categories.malloc,null);
  assert.equal(result.rows[1].categories,null);
  assert.equal(hexBytes('0'),0);
  assert.equal(hexBytes('ffffffffffffffff'),null);
  assert.throws(()=>readAllocatorDump([event(),event('0x1')],{success:true,dumpGuid:'0xa9'},[81]),/no unique/);
  const dump={success:true,dumpGuid:'0xa9'};
  const valid={...event(),ts:142};
  const totals={...valid,args:{dumps:{allocators:{},process_totals:{}}}};
  const differentTs={...valid,ts:143};
  const differentData=structuredClone(valid);
  differentData.args.dumps.allocators.v8.attrs.size.value='200';
  assert.deepEqual(readAllocatorDump([valid,totals,structuredClone(valid)],dump,[81]).rows[0],result.rows[0]);
  for(const duplicate of [differentData,differentTs]){
    // A conflict in one exact PID masks only that PID, never its neighbors.
    assert.deepEqual(readAllocatorDump([valid,duplicate,{...valid,pid:82}],dump,[81,82]).rows,[
      {pid:81,categories:null,ambiguous:true},{...result.rows[0],pid:82},
    ]);
  }
  assert.equal(readAllocatorDump([event(),event()],dump,[81]).rows[0].ambiguous,true);
});

test('reports bounded structural metadata without admitting ambiguous dump records',()=>{
  const mk=(ts,nodes,matched)=>({ts,id:matched?'0xab':'0x0',pid:1027,
    cat:'disabled-by-default-memory-infra',ph:'v',args:{dumps:{
      level_of_detail:'detailed',allocators:nodes,process_mmaps:{unloggedAddress:'0x1234'}
    }}});
  const e1=mk(10000,{'v8/foo':{},'internal_secret_name':{}},true);
  const e2=mk(10300,{'skia/bar':{}},false);
  const request={success:true,dumpGuid:'0xab'};
  const summary=describeAllocatorRecords([e1,e2],request,[1027,1028]);
  assert.deepEqual(summary,[{tab:0,recordCount:2,records:[
    {requestIdMatches:true,offsetUs:0,detailed:true,nodeCount:2,recognizedRoots:['v8'],hasTotals:false,hasMaps:true},
    {requestIdMatches:false,offsetUs:300,detailed:true,nodeCount:1,recognizedRoots:['skia'],hasTotals:false,hasMaps:true}
  ]},{tab:1,recordCount:0,records:[]}]);
  assert.throws(()=>readAllocatorDump([e1,e2],request,[1027]),/no unique/);
  assert.equal(describeAllocatorRecords(Array(10).fill(e1),request,[1027])[0].records.length,8);
});


const PIDS=Array.from({length:9},(_,i)=>1123+i);
const SCRIPT_PATH='v8/main/code_stats',SCRIPT_ATTR='external_script_source_size';
const REQUEST={success:true,dumpGuid:'0xab'};
const BYTES={type:'scalar',units:'bytes',value:'0x426000'};
function codeDump({pid=PIDS[0],id='0x19',ts=14200,detail='detailed',
  allocators={[SCRIPT_PATH]:{attrs:{[SCRIPT_ATTR]:BYTES}}},...overrides}={}) {
  return {pid,id,ts,ph:'v',cat:'disabled-by-default-memory-infra',
    args:{dumps:{level_of_detail:detail,allocators}},...overrides};
}
test('script attribution accepts one explicit detailed export, including real scalar zero and exact Perfetto companions',()=>{
  const e=codeDump(),zero=codeDump({pid:PIDS[1],allocators:{[SCRIPT_PATH]:{attrs:{
    [SCRIPT_ATTR]:{...BYTES,value:'0'}}}}});
  const totals=codeDump({allocators:{}});
  const r=readExternalScriptSourceDump([e,totals,zero,structuredClone(e)],REQUEST,PIDS);
  assert.equal(r.format,'single Perfetto export id');
  assert.deepEqual(r.rows.slice(0,3),[
    {tab:0,status:'observed',externalScriptSourceBytes:0x426000},
    {tab:1,status:'observed',externalScriptSourceBytes:0},
    {tab:2,status:'no populated renderer record',externalScriptSourceBytes:null},
  ]);
  assert(!JSON.stringify(r).includes(String(PIDS[0])));
  assert.equal(readExternalScriptSourceDump([codeDump({id:'ab'})],REQUEST,PIDS).format,'GUID exact');
  assert.equal(readExternalScriptSourceDump([codeDump({id:null,id2:{global:'AB'}})],REQUEST,PIDS).format,'GUID exact');
});
test('script attribution never substitutes worker labels, near matches, heaps or untyped values',()=>{
  for(const key of ['v8/workers/code_stats/isolate_0x1234','v8/main/code_stats/other','v8','V8/main/code_stats']){
    const a=codeDump({allocators:{[key]:{attrs:{[SCRIPT_ATTR]:BYTES}}}});
    assert.deepEqual(readExternalScriptSourceDump([a],REQUEST,PIDS).rows[0],
      {tab:0,status:'exact scalar not exported',externalScriptSourceBytes:null});
  }
  for(const attrs of [
    {[SCRIPT_ATTR]:{...BYTES,units:'objects'}},{[SCRIPT_ATTR]:{...BYTES,type:'string'}},
    {[SCRIPT_ATTR]:{...BYTES,value:1}}, {[SCRIPT_ATTR]:{...BYTES,value:'ffffffffffffffff'}},
    {[SCRIPT_ATTR]:{...BYTES,value:'-1'}}, {[SCRIPT_ATTR]:null},
  ]){
    const a=codeDump({allocators:{[SCRIPT_PATH]:{attrs}}});
    assert.deepEqual(readExternalScriptSourceDump([a],REQUEST,PIDS).rows[0],
      {tab:0,status:'invalid byte scalar',externalScriptSourceBytes:null});
  }
  const wrong=codeDump({allocators:{[SCRIPT_PATH]:{attrs:{code_and_metadata_size:BYTES}}}});
  assert.equal(readExternalScriptSourceDump([wrong],REQUEST,PIDS).rows[0].status,'exact scalar not exported');
});
test('script attribution rejects incomplete identity, duplicate IDs, conflicts, and non-detailed provenance',()=>{
  const e=codeDump(),different=codeDump({allocators:{[SCRIPT_PATH]:{attrs:{
    [SCRIPT_ATTR]:{...BYTES,value:'2'}}}}});
  for(const other of [different,codeDump({ts:e.ts+1}),codeDump({detail:'light'})]){
    const result=readExternalScriptSourceDump([e,other,codeDump({pid:PIDS[1]})],REQUEST,PIDS);
    assert.deepEqual(result.rows[0],{tab:0,status:'ambiguous or not detailed',externalScriptSourceBytes:null});
    assert.equal(result.rows[1].status,'observed');
  }
  assert.equal(readExternalScriptSourceDump([codeDump({detail:'light'})],REQUEST,PIDS).rows[0].status,'ambiguous or not detailed');
  assert.equal(readExternalScriptSourceDump([codeDump({ts:null})],REQUEST,PIDS).rows[0].status,'ambiguous or not detailed');
  assert.equal(readExternalScriptSourceDump([codeDump({pid:32132})],REQUEST,PIDS).rows[0].status,'no populated renderer record');
  assert.throws(()=>readExternalScriptSourceDump([e,codeDump({pid:3223,id:'0x20'})],REQUEST,PIDS),/unique/);
  assert.throws(()=>readExternalScriptSourceDump([codeDump({id2:{global:'0xeb'}})],REQUEST,PIDS),/conflicting/);
  assert.throws(()=>readExternalScriptSourceDump([codeDump({cat:'v8'})],REQUEST,PIDS),/unique/);
  assert.throws(()=>readExternalScriptSourceDump([e],{...REQUEST,success:false},PIDS),/successful/);
  assert.throws(()=>readExternalScriptSourceDump([e],REQUEST,[...PIDS.slice(1),PIDS[1]]),/verified renderer PIDs/);
});
