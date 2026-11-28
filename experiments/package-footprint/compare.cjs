'use strict';

// Build both archive layouts from the same current development checkout.
// The production source, package version, persisted profile and releases
// are untouched. Never runs on the user's computer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');

const moved = ['lucide','motion','open-props'];
const duplicates = ['framer-motion','lucide','motion','motion-dom','motion-utils','open-props','tslib'];
const vendors = ['lucide.min.js','motion.js','open-props.min.css'];
const json = f=>JSON.parse(fs.readFileSync(f,'utf8'));
const sha = b=>crypto.createHash('sha256').update(b).digest('hex');
const copy = (from,to)=>fs.cpSync(from,to,{recursive:true,verbatimSymlinks:true});
const writeJson = (f,o)=>fs.writeFileSync(f,JSON.stringify(o,null,2)+'\n','utf8');

function duplicateManifests(manifest,lock) {
  const pkg=structuredClone(manifest), lk=structuredClone(lock);
  for(const o of [pkg,lk.packages['']]) for(const id of moved){
    assert.equal(o.dependencies[id],undefined,'candidate has duplicate production dependency already');
    assert.equal(typeof o.devDependencies[id],'string','candidate removed an expected dev dependency');
    o.dependencies[id]=o.devDependencies[id];delete o.devDependencies[id];
  }
  for(const id of duplicates){
    const row=lk.packages['node_modules/'+id];
    assert.equal(row.dev,true);
    delete row.dev;
  }
  return { pkg,lk };
}

function archiveEntries(asar, filename) {
  const all=new Map();
  const visit=(prefix,tree)=>{
    for(const [key,e] of Object.entries(tree)){
      const rel=prefix+key;
      if(e.files)visit(rel+'/',e.files);
      else{
        assert.ok(!e.link&&!e.unpacked,'unexpected link/unpacked entry: '+rel);
        all.set(rel,e);
      }
    }
  };
  visit('',asar.getRawHeader(filename).header.files);
  return all;
}

function audit(asar, codeDir, repeatedArchive, compactArchive) {
  const a=archiveEntries(asar,repeatedArchive),b=archiveEntries(asar,compactArchive);
  let equal=0;
  const dropped=[];
  const extract=(file,n)=>asar.extractFile(file,n.split('/').join(path.sep));
  for(const rel of a.keys()){
    if(!b.has(rel)){
      const [,first]=rel.split('/');
      assert.ok(rel.startsWith('node_modules/')&&duplicates.includes(first),'unexpected omitted file: '+rel);
      dropped.push(rel);
      continue;
    }
    if(rel==='package.json')continue;
    const oldBytes=extract(repeatedArchive,rel), newBytes=extract(compactArchive,rel);
    assert.equal(sha(newBytes),sha(oldBytes),'retained file changed: '+rel);
    if(!rel.startsWith('node_modules/')){
      const raw=path.join(codeDir,rel);
      assert.ok(fs.statSync(raw).isFile(),'no exact source for '+rel);
      assert.equal(sha(newBytes),sha(fs.readFileSync(raw)),'packed source differs from checkout: '+rel);
    }
    equal++;
  }
  for(const rel of b.keys())assert.ok(a.has(rel),'unexpected newly packed file: '+rel);
  const before=JSON.parse(extract(repeatedArchive,'package.json').toString('utf8'));
  const after=JSON.parse(extract(compactArchive,'package.json').toString('utf8'));
  const oracle=structuredClone(before);
  for(const id of moved){assert.ok(oracle.dependencies[id]);delete oracle.dependencies[id];}
  assert.deepEqual(after,oracle,'only the redundant root dependency declarations may differ');
  for(const n of vendors)assert.ok(b.has('assets/vendor/'+n), 'missing vendored asset: '+n);
  assert.ok(b.has('node_modules/adm-zip/adm-zip.js'), 'runtime ZIP loader removed');
  const removedModules=[...new Set(dropped.map(n=>n.split('/')[1]))].sort();
  assert.deepEqual(removedModules,[...duplicates].sort());
  const bytesBefore=fs.statSync(repeatedArchive).size,bytesAfter=fs.statSync(compactArchive).size;
  assert.ok(bytesBefore>bytesAfter && equal>=100 && dropped.length>1000);
  return {sameRuntimeFiles:equal,removedFiles:dropped.length,removedModules, bytesBefore,bytesAfter,
    bytesSaved:bytesBefore-bytesAfter,percentArchiveSmaller:100*(bytesBefore-bytesAfter)/bytesBefore};
}

function main(args) {
  const root = path.resolve(__dirname,'../..');
  const code = path.join(root,'code','code');
  const build = path.join(root,'code','build');
  const local = createRequire(path.join(build,'package.json'));
  const asar = local('@electron/asar');
  const candidatePkg=json(path.join(build,'package.json'));
  const candidateLock=json(path.join(build,'package-lock.json'));
  const expected=candidateLock.packages['node_modules/electron'].version;
  const proof=content=>({
    os:process.platform, electron:expected, lockPackageRecords:Object.keys(candidateLock.packages).length,
    onlyArchive: true, ...content
  });
  if(args[0]==='--audit-only'){
    assert.equal(args.length,4);
    const content=proof(audit(asar,code,path.resolve(args[1]),path.resolve(args[2])));
    writeJson(path.resolve(args[3]),content);
    console.log(JSON.stringify(content));
    return;
  }
  assert.equal(args.length,1,'Supply one JSON output path, or --audit-only repeated.asar compact.asar output.json');
  const electron=local('electron');
  const actual=execFileSync(electron,['-p','process.versions.electron'],{
    env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8',timeout:15000,
  }).trim();
  assert.equal(actual,expected,'unpacked engine must be the exact lock version');
  const engine=path.dirname(electron);
  const pair=duplicateManifests(candidatePkg,candidateLock);
  const sandbox=fs.mkdtempSync(path.join(os.tmpdir(),'dex-archive-audit-'));
  try{
    const stageCode=path.join(sandbox,'source','code');
    const stageBuild=path.join(sandbox,'source','build');
    copy(code,stageCode);
    fs.mkdirSync(stageBuild,{recursive:true});
    for(const n of ['package.json','package-lock.json','electron-builder.json']){
      fs.copyFileSync(path.join(build,n),path.join(stageBuild,n));
    }
    copy(path.join(build,'node_modules'),path.join(stageBuild,'node_modules'));
    const cli=path.join(stageBuild,'node_modules','electron-builder','cli.js');
    const platform=process.platform==='win32'?'win':'linux';
    assert.ok(['win32','linux'].includes(process.platform));
    function doPack(arm) {
      const output=path.join(sandbox,arm);
      execFileSync(process.execPath,[cli,'--'+platform,'--dir','--x64','--config','electron-builder.json',
        '--config.electronDist='+engine,'--config.directories.output='+output,'--publish','never'],{
        cwd:stageBuild,env:{...process.env,CSC_IDENTITY_AUTO_DISCOVERY:'false'},stdio:'inherit',timeout:180000});
      return path.join(output,platform+'-unpacked','resources','app.asar');
    }
    const compact=doPack('compact');
    writeJson(path.join(stageBuild,'package.json'),pair.pkg);
    writeJson(path.join(stageBuild,'package-lock.json'),pair.lk);
    const repeated=doPack('repeated');
    const result=proof(audit(asar,code,repeated,compact));
    writeJson(path.resolve(args[0]),result);
    console.log(JSON.stringify(result));
  }finally{
    fs.rmSync(sandbox,{recursive:true,force:true,maxRetries:8,retryDelay:300});
  }
}
if(require.main===module)main(process.argv.slice(2));
module.exports={duplicateManifests,archiveEntries,audit};
