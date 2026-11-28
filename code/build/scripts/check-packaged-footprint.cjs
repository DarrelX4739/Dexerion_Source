'use strict';
// Dev-only structural tripwire; not an install/download or running-memory target.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { getRawHeader } = require('@electron/asar');

// Windows post-prune 29,918,687 B; dev-V 2443d9f0 Linux 29,858,705 B.
// Intentionally leave about 3.5 MiB for growth; review/update when planned
// assets or dependencies justify a larger package instead of removing features.
const BUDGET = Object.freeze({ appAsar:32*1024*1024, bundledNpm:256*1024 });
const DUPLICATE_PACKAGES = Object.freeze([
  'framer-motion','lucide','motion','motion-dom','motion-utils','open-props','tslib',
]);
const REQUIRED = new Set(['main.js','package.json','node_modules/adm-zip/adm-zip.js']);

function checkPackagedFootprint(archive) {
  assert.equal(path.basename(archive),'app.asar','supply the built resources/app.asar');
  const file = fs.lstatSync(archive);
  assert(file.isFile(),'the app archive must be a regular file');
  assert(!fs.existsSync(archive+'.unpacked'),'unexpected unpacked payload; audit and update the footprint budget deliberately');
  const { header, headerSize } = getRawHeader(archive);
  let files=0, npmFiles=0, npmBytes=0;
  const forbidden=new Set(), missing=new Set(REQUIRED);
  function walk(entries, parent=[]) {
    for(const [name,entry] of Object.entries(entries)) {
      assert(name!=='.' && name!=='..' && !/[\\/]/.test(name),'unexpected archive path segment');
      const next=[...parent,name];
      if(entry.files) { walk(entry.files,next); continue; }
      const loc=next.join('/');
      const offset=Number(entry.offset);
      assert(!entry.link && !entry.unpacked && typeof entry.offset==='string' &&
        /^\d+$/.test(entry.offset) && Number.isSafeInteger(offset) &&
        Number.isSafeInteger(entry.size) && entry.size>=0 && 8+headerSize+offset+entry.size<=file.size,
        'unexpected or invalid packaged member: '+loc);
      files++;
      missing.delete(loc);
      if(next[0]!=='node_modules')continue;
      npmFiles++;
      npmBytes+=entry.size;
      for(let i=0;i<next.length-1;i++){
        if(next[i]==='node_modules' && DUPLICATE_PACKAGES.includes(next[i+1]))forbidden.add(next[i+1]);
      }
    }
  }
  walk(header.files);
  const issues=[];
  const budget=(label,actual,max)=> {
    if(actual>max)issues.push(`${label} uses ${actual} B, budget is ${max} B (+${actual-max} B)`);
  };
  budget('resources/app.asar',file.size,BUDGET.appAsar);
  budget('bundled npm payload',npmBytes,BUDGET.bundledNpm);
  if(forbidden.size)issues.push('previously pruned duplicate npm packages returned: '+[...forbidden].sort().join(', '));
  if(missing.size)issues.push('expected packaged runtime members are missing: '+[...missing].sort().join(', '));
  return { appAsarBytes:file.size, appAsarBudgetBytes:BUDGET.appAsar,
    appAsarHeadroomBytes:BUDGET.appAsar-file.size, files, bundledNpmBytes:npmBytes,
    bundledNpmBudgetBytes:BUDGET.bundledNpm,bundledNpmHeadroomBytes:BUDGET.bundledNpm-npmBytes,
    bundledNpmFiles:npmFiles, issues };
}
if(require.main===module){
  try {
    assert.equal(process.argv.length,3,'usage: node check-packaged-footprint.cjs <.../resources/app.asar>');
    const result=checkPackagedFootprint(path.resolve(process.argv[2]));
    console.log(JSON.stringify(result));
    if(result.issues.length) {
      console.error('Packaged footprint guard failed:\n- '+result.issues.join('\n- ')+
        '\nIf intentional, review the bytes/dependencies with the feature and update this dev-only budget.');
      process.exitCode=1;
    }
  } catch(error) {
    console.error('Packaged footprint guard could not verify the artifact: '+error.message);
    process.exitCode=1;
  }
}
module.exports={ BUDGET, checkPackagedFootprint };
