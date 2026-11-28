'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const {createPackage}=require('@electron/asar');
const {BUDGET,checkPackagedFootprint}=require('./check-packaged-footprint.cjs');

async function fixture(t,extend){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dex-footprint-control-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:4}));
  const source=path.join(root,'source');
  const put=(loc,bytes)=>{
    const file=path.join(source,...loc.split('/'));
    fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,bytes);
    return file;
  };
  put('main.js','require("adm-zip");');
  put('package.json','{"main":"main.js"}');
  put('node_modules/adm-zip/adm-zip.js','/* fixture */');
  if(extend)extend(put);
  const archive=path.join(root,'app.asar');
  await createPackage(source,archive);
  return archive;
}
test('accepts a lean built archive and reports exact npm bytes and headroom',async t=>{
  const archive=await fixture(t);
  const result=checkPackagedFootprint(archive);
  assert.deepEqual(result.issues,[]);
  assert.equal(result.appAsarBytes,fs.statSync(archive).size);
  assert.equal(result.appAsarHeadroomBytes,BUDGET.appAsar-result.appAsarBytes);
  assert.equal(result.bundledNpmBytes,Buffer.byteLength('/* fixture */'));
  assert.equal(result.files,3);
  assert.equal(result.bundledNpmFiles,1);
});
test('detects known nested duplicates even below both budgets',async t=>{
  const a=await fixture(t,put=>{
    put('node_modules/adm-zip/node_modules/lucide/part.js','small but redundant');
    put('node_modules/open-props/open-props.css','small but redundant');
    put('assets/vendor/lucide.min.js','intended vendor file, keep');
  });
  const r=checkPackagedFootprint(a);
  assert.deepEqual(r.issues,['previously pruned duplicate npm packages returned: lucide, open-props']);
});
test('separately flags genuine archive growth and bundled npm growth',async t=>{
  const a=await fixture(t,put=>fs.truncateSync(put('assets/addition.bin',''),BUDGET.appAsar));
  const b=await fixture(t,put=>fs.truncateSync(put('node_modules/feature/addition.bin',''),BUDGET.bundledNpm));
  const big=checkPackagedFootprint(a),deps=checkPackagedFootprint(b);
  assert.equal(big.issues.length,1);
  assert.match(big.issues[0],/^resources\/app\.asar uses/);
  assert.equal(deps.issues.length,1);
  assert.match(deps.issues[0],/^bundled npm payload uses/);
});
test('refuses a secondary unpacked payload that would escape either budget',async t=>{
  const a=await fixture(t);
  fs.mkdirSync(a+'.unpacked');
  assert.throws(()=>checkPackagedFootprint(a),/unexpected unpacked payload/);
});
