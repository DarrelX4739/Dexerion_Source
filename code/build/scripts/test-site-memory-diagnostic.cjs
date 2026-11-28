'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {verifiedFramePid,readHeapUsage,verifiedSiteRows,readAllocatorDump,hexBytes}=require('./read-site-memory-diagnostic.cjs');
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
  assert.throws(()=>readAllocatorDump([event(),event()],{success:true,dumpGuid:'0xa9'},[81]),/duplicate allocator/);
});
