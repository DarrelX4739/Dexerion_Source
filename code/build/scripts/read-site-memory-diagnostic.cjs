'use strict';
const assert=require('node:assert/strict');
const {isDeepStrictEqual}=require('node:util');

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
const SCRIPT_NODE='v8/main/code_stats';
const SCRIPT_ATTRIBUTE='external_script_source_size';
const CATEGORIES=['v8','blink_gc','partition_alloc','malloc','skia','cc','web_cache'];
function hexBytes(n){
  if(typeof n!=='string'||!/^(?:0x)?[0-9a-f]{1,16}$/i.test(n))return null;
  const value=Number.parseInt(n,16);
  return Number.isSafeInteger(value)&&value>=0?value:null;
}
function normId(id){
  return typeof id==='string'&&/^(?:0x)?[0-9a-f]{1,16}$/i.test(id)?BigInt('0x'+id.replace(/^0x/i,'')).toString(16):null;
}
function allocatorEvents(events){
  return events.filter(e=>e.ph==='v'&&String(e.cat).split(',').includes('disabled-by-default-memory-infra')&&e.args?.dumps);
}
function describeAllocatorRecords(events,dump,pids){
  const rows=allocatorEvents(events);
  // No raw dumps, absolute timestamps, addresses, process IDs or arbitrary
  // strings in artifacts. Keep enough evidence to distinguish export records
  // sharing an ID from distinct timestamps or disjoint root sets.
  return pids.map((pid,tab)=>{
    const records=rows.filter(e=>e.pid===pid);
    const base=records.find(e=>Number.isFinite(e.ts))?.ts;
    return {tab,recordCount:records.length,records:records.slice(0,8).map(e=>{
      const d=e.args.dumps;
      const names=Object.keys(d.allocators??{});
      const presentRoots=new Set(names.map(key=>key.split('/')[0]));
      return {requestIdMatches:normId(dump?.dumpGuid)!==null&&normId(e.id??e.id2?.global)===normId(dump.dumpGuid),
        offsetUs:Number.isFinite(e.ts)&&Number.isFinite(base)?e.ts-base:null,
        detailed:d.level_of_detail==='detailed',nodeCount:names.length,recognizedRoots:CATEGORIES.filter(k=>presentRoots.has(k)),
        hasTotals:Object.hasOwn(d,'process_totals'),hasMaps:Object.hasOwn(d,'process_mmaps')};
    })};
  });
}
function readAllocatorDump(events,dump,pids) {
  assert(dump?.success===true&&normId(dump.dumpGuid)!==null,'no successful explicit MemoryInfra dump');
  const tagged=allocatorEvents(events);
  const dumpIds=new Set(tagged.map(e=>normId(e.id??e.id2?.global)));
  // Perfetto JSON exports its internal snapshot id, not necessarily the CDP
  // request GUID. This trace is explicitly nonperiodic with exactly one
  // successful request and exactly one export id; multiple IDs are ambiguous.
  assert(dumpIds.size===1&&!dumpIds.has(null),'no unique exported MemoryInfra snapshot');
  const idsMatch=dumpIds.has(normId(dump.dumpGuid));
  const rows=[];
  for(const pid of pids){
    // Perfetto can emit a process-totals companion with allocators: {}.
    // It is not a second allocator observation. Never merge populated nodes.
    const a=tagged.filter(e=>e.pid===pid&&Object.keys(e.args.dumps.allocators??{}).length);
    if(!a.length){rows.push({pid,categories:null});continue;}
    const nodes=a[0].args.dumps.allocators;
    if(a.length>1&&(!Number.isFinite(a[0].ts)||a.some(e=>e.ts!==a[0].ts||
      e.args.dumps.level_of_detail!==a[0].args.dumps.level_of_detail||
      !isDeepStrictEqual(e.args.dumps.allocators,nodes)))){
      rows.push({pid,categories:null,ambiguous:true});
      continue;
    }
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
// Attribution only: no worker, utility, root total, inferred zero, or fuzzy
// key matching. The browser can export a different single Perfetto ID than
// the CDP request returns, so use the same one-explicit-dump provenance rule.
// A totals-only companion or an identical export at the same timestamp is OK.
function readExternalScriptSourceDump(events,dump,pids) {
  assert(dump?.success===true&&normId(dump.dumpGuid)!==null,'no successful explicit code-stat dump');
  assert(pids.length===9&&new Set(pids).size===9&&pids.every(p=>Number.isSafeInteger(p)&&p>0),
    'code-stat dump requires exact nine verified renderer PIDs');
  const tagged=allocatorEvents(events);
  assert(tagged.every(e=>e.id==null||e.id2?.global==null||normId(e.id)===normId(e.id2.global)),
    'conflicting code-stat snapshot ids');
  const ids=new Set(tagged.map(e=>normId(e.id??e.id2?.global)));
  assert(ids.size===1&&!ids.has(null),'no unique code-stat snapshot');
  const format=ids.has(normId(dump.dumpGuid))?'GUID exact':'single Perfetto export id';
  const rows=pids.map((pid,tab)=>{
    const records=tagged.filter(e=>e.pid===pid&&Object.keys(e.args.dumps.allocators??{}).length);
    const result=(status,externalScriptSourceBytes=null)=>({tab,status,externalScriptSourceBytes});
    if(!records.length)return result('no populated renderer record');
    const first=records[0],nodes=first.args.dumps.allocators;
    if(!Number.isFinite(first.ts)||records.some(e=>e.ts!==first.ts||e.args.dumps.level_of_detail!=='detailed'||
      !isDeepStrictEqual(e.args.dumps.allocators,nodes)))return result('ambiguous or not detailed');
    const attrs=Object.hasOwn(nodes,SCRIPT_NODE)?nodes[SCRIPT_NODE]?.attrs:null;
    if(!attrs||!Object.hasOwn(attrs,SCRIPT_ATTRIBUTE))return result('exact scalar not exported');
    const attr=attrs[SCRIPT_ATTRIBUTE];
    const bytes=attr?.type==='scalar'&&attr.units==='bytes'?hexBytes(attr.value):null;
    return bytes===null?result('invalid byte scalar'):result('observed',bytes);
  });
  return {format,rows};
}
module.exports={verifiedFramePid,readHeapUsage,verifiedSiteRows,readAllocatorDump,describeAllocatorRecords,hexBytes,readExternalScriptSourceDump,CATEGORIES};
