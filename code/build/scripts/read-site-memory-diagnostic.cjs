'use strict';
const assert=require('node:assert/strict');

// A browser-level trace has no owning WebContents. Read each page's own trace
// metadata and match its exact main-frame token + URL; never use the browser
// event's PID or guess by process ordering.
function verifiedFramePid(events,frame) {
  const hits=events.filter(e=>e.name==='TracingStartedInBrowser')
    .flatMap(e=>e.args?.data?.frames||[])
    .filter(f=>!f.parent&&typeof f.frame==='string'&&typeof frame?.id==='string'&&
      f.frame.toLowerCase()===frame.id.toLowerCase()&&f.url===frame.url&&
      Number.isSafeInteger(f.processId)&&f.processId>0);
  assert(hits.length===1,'no unique exact main-frame PID in page trace');
  return hits[0].processId;
}
function readHeapUsage(raw){
  const fields=['usedSize','totalSize','embedderHeapUsedSize','backingStorageSize'];
  const [used,total,embedder,backing]=fields.map(k=>Number.isSafeInteger(raw?.[k])&&raw[k]>=0?raw[k]:null);
  assert(used>0&&total>=used,'unsupported or invalid CDP JS heap counters');
  return {jsHeapUsedBytes:used,jsHeapAllocatedBytes:total,embedderGcHeapUsedBytes:embedder,
    arrayBufferAndStringBackingBytes:backing};
}
function verifiedSiteRows(mappings,snapshotA,snapshotB){
  assert(mappings.length===9&&new Set(mappings.map(x=>x.pid)).size===9&&
    new Set(mappings.map(x=>x.isolate)).size===9,'nine distinct fixture renderer processes and isolates required');
  const index=xs=>new Map(xs.map(x=>[x.pid,x])),a=index(snapshotA),b=index(snapshotB);
  return mappings.map((mapping,i)=>{
    const p=a.get(mapping.pid),q=b.get(mapping.pid);
    if(!p||!q||typeof p.startedUtc!=='string'||!p.startedUtc||p.startedUtc!==q.startedUtc||
      ![p,q].every(x=>/(?:^|\s)--type=renderer(?:\s|$)/.test(x.cmdline||'')&&
        Number.isSafeInteger(x.privateWsBytes)&&x.privateWsBytes>0)) {
      throw new Error('fixture renderer/working set lost at '+i);
    }
    return {...mapping,privateResidentBeforeBytes:p.privateWsBytes,privateResidentAfterBytes:q.privateWsBytes};
  });
}
const CATEGORIES=['v8','blink_gc','partition_alloc','malloc','skia','cc','web_cache'];
function hexBytes(n){
  if(typeof n!=='string'||!/^(?:0x)?[0-9a-f]{1,16}$/i.test(n))return null;
  const value=Number.parseInt(n,16);
  return Number.isSafeInteger(value)&&value>=0?value:null;
}
function normId(id){
  return typeof id==='string'&&/^(?:0x)?[0-9a-f]{1,16}$/i.test(id)?BigInt('0x'+id.replace(/^0x/i,'')).toString(16):null;
}
function readAllocatorDump(events,dump,pids) {
  assert(dump?.success===true&&normId(dump.dumpGuid)!==null,'no successful explicit MemoryInfra dump');
  const tagged=events.filter(e=>e.ph==='v'&&String(e.cat).split(',').includes('disabled-by-default-memory-infra')&&e.args?.dumps);
  const dumpIds=new Set(tagged.map(e=>normId(e.id??e.id2?.global)));
  // Perfetto JSON exports its internal snapshot id, not necessarily the CDP
  // request GUID. This trace is explicitly nonperiodic with exactly one
  // successful request and exactly one export id; multiple IDs are ambiguous.
  assert(dumpIds.size===1&&!dumpIds.has(null),'no unique exported MemoryInfra snapshot');
  const idsMatch=dumpIds.has(normId(dump.dumpGuid));
  const rows=[];
  for(const pid of pids){
    const a=tagged.filter(e=>e.pid===pid&&e.args.dumps.allocators);
    assert(a.length<=1,'duplicate allocator records for a fixture renderer');
    if(!a.length){rows.push({pid,categories:null});continue;}
    const nodes=a[0].args.dumps.allocators;
    const bytes=(node,key)=>node?.attrs?.[key]?.type==='scalar'&&node.attrs[key].units==='bytes'
      ? hexBytes(node.attrs[key].value):null;
    const categories=Object.fromEntries(CATEGORIES.map(name=>{
      const node=Object.hasOwn(nodes,name)?nodes[name]:null;
      return [name,node?{sizeBytes:bytes(node,'size'),effectiveBytes:bytes(node,'effective_size')}:null];
    }));
    rows.push({pid,categories,dumpRootNames:[...new Set(Object.keys(nodes).map(s=>s.split('/')[0]))].sort()});
  }
  return {format:idsMatch?'GUID exact':'single Perfetto export id',rows};
}
module.exports={verifiedFramePid,readHeapUsage,verifiedSiteRows,readAllocatorDump,hexBytes,CATEGORIES};
