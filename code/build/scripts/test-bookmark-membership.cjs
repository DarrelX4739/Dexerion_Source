'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {performance}=require('node:perf_hooks');
const test=require('node:test');
const source=process.env.DEX_BOOKMARK_SOURCE||path.resolve(__dirname,'../../code/src/renderer/shell.js');

function load(file, SetImpl=Set) {
  const source=fs.readFileSync(file,'utf8');
  const match=source.match(/^function (bookmarkSet|isBookmarked)\([^\n]*\) \{[\s\S]*?^\}/m);
  assert(match,'bookmark membership helper missing: '+file);
  const stock=match[1]==='bookmarkSet';
  const fn=stock?'url=>bookmarkSet().has(url)':'isBookmarked';
  const lookup=vm.runInNewContext(match[0]+`\n({set: s=>{S=s}, has:${fn}});`,{S:null, Set:SetImpl},{filename:file});
  return {...lookup,stock,source};
}
function reference(s,url){
  const set=new Set();
  const roots=s&&s.bookmarks&&s.bookmarks.roots;
  if(roots)for(const k of Object.keys(roots))for(const b of roots[k]||[])set.add(b.url);
  return set.has(url);
}
function lookupControls(){
  test('matches old all-roots whole-URL membership including duplicate, exact spelling and odd persisted values',()=>{
    const f=load(source);
    assert(!f.stock);
    const tests=[null,{}, {bookmarks:{}}, {bookmarks:{roots:{bar:[{url:NaN},{url:-0},{url:'https://site.test/A/?q=1'}],
      other:[{url:'https://site.test/A/?q=1'},{url:'https://site.test/A/?q=1#x'},{url:undefined}],empty:null,extra:[{url:{}}]}}}];
    for(const s of tests) {
      f.set(s);
      for(const url of ['https://site.test/A/?q=1','https://site.test/a/?q=1','https://site.test/A/?q=1#x',
        'https://site.test/A','https://site.test/A/?q=2',NaN,+0,-0,undefined,null,{},1]) {
        assert.equal(f.has(url),reference(s,url));
      }
    }
  });
  test('visits each row in original order once after a match and preserves malformed-profile failure',()=>{
    const touched=[];
    const f=load(source);
    const read=(url)=>({get url(){touched.push(url);return url;}});
    const state={bookmarks:{roots:{bar:[read('match'),read('second')], other:[read('third')]}}};
    f.set(state);
    assert(f.has('match'));
    assert.deepEqual(touched,['match','second','third']);
    state.bookmarks.roots.other.push(null);
    assert.throws(()=>f.has('match'),/reading 'url'/);
    assert.throws(()=>reference(state,'match'),/reading 'url'/);
  });
  test('observes actual optimistic and refreshed roots immediately, with no per-look-up Set or stale state',()=>{
    let allocations=0;
    class CountingSet extends Set { constructor(...a){ super(...a); allocations++; } }
    const f=load(source,CountingSet);
    const s={bookmarks:{roots:{bar:[],other:[]}}},a='https://fixture.test/a';
    f.set(s);
    assert(!f.has(a));
    s.bookmarks.roots.other.unshift({url:a});
    assert(f.has(a));
    s.bookmarks.roots.other=s.bookmarks.roots.other.filter(b=>b.url!==a);
    assert(!f.has(a));
    s.bookmarks.roots.bar.push({url:a});
    assert(f.has(a));
    f.set({bookmarks:{roots:{bar:[],other:[]}}});
    assert(!f.has(a));
    assert.equal(allocations,0);
    assert.equal((f.source.match(/isBookmarked\(url\)/g)||[]).length,3);
    assert.equal((f.source.match(/bookmarkSet\(/g)||[]).length,0);
  });
}
function measurements(stock,candidate) {
  assert(stock.stock&&!candidate.stock);
  const results=[];
  function run(f,queries,n) {
    let hits=0;
    const cpu=process.cpuUsage(), wall=performance.now();
    for(let i=0;i<n;i++)hits+=f.has(queries[i%queries.length])?1:0;
    const used=process.cpuUsage(cpu);
    return {hits,cpuUs:(used.user+used.system)/n,wallUs:(performance.now()-wall)*1000/n};
  }
  function med(a){return [...a].sort((x,y)=>x-y)[Math.floor(a.length/2)];}
  for(const [count,lookups] of [[30,16000],[180,9000],[1500,4000],[5000,1400]]) {
    const links=Array.from({length:count},(_,i)=>({id:'b'+i,title:'Saved reading '+i,url:'https://site'+(i%19)+'.test/article/'+i+(i%5?'':'?view=full#page')}));
    const state={bookmarks:{roots:{bar:links.slice(0,Math.min(5,count)),other:links.slice(Math.min(5,count)),archive:[]}}};
    const qs=[links[0].url,links[Math.floor(count/2)].url,links[count-1].url,'https://else.test/not-saved'];
    stock.set(state);candidate.set(state);
    run(stock,qs,lookups);run(candidate,qs,lookups);
    const pairs=[];
    for(let i=0;i<11;i++){
      const p={};
      const order=i%2?[['candidate',candidate],['stock',stock]]:[['stock',stock],['candidate',candidate]];
      for(const [name,f] of order)p[name]=run(f,qs,lookups);
      assert.equal(p.stock.hits,p.candidate.hits);
      pairs.push(p);
    }
    results.push({count,lookupsPerArmPerPair:lookups,samples:pairs.length,
      stockCpuUs:med(pairs.map(p=>p.stock.cpuUs)),candidateCpuUs:med(pairs.map(p=>p.candidate.cpuUs)),
      pairedCpuDeltaUs:med(pairs.map(p=>p.candidate.cpuUs-p.stock.cpuUs)),
      fasterCpuPairs:pairs.filter(p=>p.candidate.cpuUs<p.stock.cpuUs).length,
      stockWallUs:med(pairs.map(p=>p.stock.wallUs)),candidateWallUs:med(pairs.map(p=>p.candidate.wallUs))});
  }
  return results;
}
if(process.argv[2]==='--bench'){
  const out={node:process.version,v8:process.versions.v8,electron:process.versions.electron??null,platform:process.platform,
    fixture:'synthetic imported bookmark lists, exact helpers, natural GC, not whole-browser CPU/heap',
    results:measurements(load(process.argv[3]),load(process.argv[4]||source))};
  console.log(JSON.stringify(out,null,2));
}else lookupControls();
