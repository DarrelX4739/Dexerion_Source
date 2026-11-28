'use strict';
// PE/ASAR controls parse real x64 vendor PE bytes but never execute that file.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const asar = require('@electron/asar');
const { addWinAsarIntegrity } = require('app-builder-lib/out/electron/electronWin');
const { computeData } = require('app-builder-lib/out/asar/integrity');
const { editWindowsResources } = require('app-builder-lib/out/util/resEdit');
const { NtExecutable } = require('resedit');
const { calculateCheckSumForPE } = require('pe-library');
const { auditWindowsAsarIntegrity }=require('./audit-windows-asar-integrity.cjs');

function checksum(bytes) {
  const bound=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
  calculateCheckSumForPE(bound,true);
  return Buffer.from(bound);
}
async function fixture(t, withChecksum) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dex-pe-audit-fixture-'));
  t.after(()=>fs.rmSync(root,{force:true,recursive:true}));
  const vendor=path.join(path.dirname(require.resolve('electron-winstaller/package.json')),'vendor','7z-x64.exe');
  const arms=[];
  for(const arm of ['stock','subset']) {
    const dir=path.join(root,arm),source=path.join(dir,'source'),resources=path.join(dir,'resources');
    fs.mkdirSync(source,{recursive:true});
    fs.mkdirSync(resources);
    fs.writeFileSync(path.join(source,'shell.html'),`<script src="lucide-${arm}.js"></script>`);
    const archive=path.join(resources,'app.asar'),exe=path.join(dir,'Dexerion.exe');
    await asar.createPackage(source,archive);
    fs.copyFileSync(vendor,exe);
    if(withChecksum) fs.writeFileSync(exe,checksum(fs.readFileSync(exe)));
    // Drive the exact locked packaging helper for both resource-edit passes;
    // win path normalization inside addWinAsarIntegrity is host-independent.
    await addWinAsarIntegrity(exe,await computeData({resourcesPath:resources,resourcesRelativePath:'resources',
      resourcesDestinationPath:resources}));
    await editWindowsResources({file:exe,versionStrings:{FileDescription:'Digest audit local control'},
      fileVersion:'1.2.3',productVersion:'1.2.3'});
    arms.push({exe,archive});
  }
  const [stock,subset]=arms;
  return {stock,subset, root,
    compare:(right=subset.exe,archive=subset.archive)=>auditWindowsAsarIntegrity(stock.exe,right,stock.archive,archive),
    mutate:(name,mutator,recompute=true)=>{
      const p=path.join(root,name+'.exe');
      const bytes=fs.readFileSync(subset.exe);
      mutator(bytes);
      fs.writeFileSync(p,recompute&&withChecksum?checksum(bytes):bytes);
      return p;
    }};
}
test('accepts exact builder-linked PE digest and zero checksum, rejects opposite archive',async t=>{
  const f=await fixture(t,false);
  const r=f.compare();
  assert.equal(r.stockVerifiedPeChecksum,0);
  assert.equal(r.subsetVerifiedPeChecksum,0);
  assert(r.differingIntegrityBytes>0 && r.differingIntegrityBytes<=64);
  assert.notEqual(r.stockAsarHeaderSha256,r.subsetAsarHeaderSha256);
  assert.notEqual(r.stockExecutableSha256,r.subsetExecutableSha256);
  assert.match(r.identicalTextSha256,/^[a-f0-9]{64}$/);
  assert.throws(()=>f.compare(f.subset.exe,f.stock.archive),/must authenticate its own exact ASAR header/);
});
test('accepts genuine recalculated PE checksums and rejects every unrelated byte change',async t=>{
  const f=await fixture(t,true);
  const r=f.compare();
  assert(r.stockVerifiedPeChecksum>0 && r.subsetVerifiedPeChecksum>0);
  assert.throws(()=>f.compare(f.mutate('false-hash',b=>b[r.integrityDigestFileOffset]^=1)),/must authenticate/);
  assert.throws(()=>f.compare(f.mutate('false-pe-checksum',b=>b[r.checksumFileOffset]^=1,false)),/invalid populated PE checksum/);
  assert.throws(()=>f.compare(f.mutate('dropped-checksum',b=>b.writeUInt32LE(0,r.checksumFileOffset),false)),/checksum population differs/);
  assert.throws(()=>f.compare(f.mutate('coff-timestamp',b=>b[b.readUInt32LE(0x3c)+8]^=1)),/unexplained executable byte change/);
  assert.throws(()=>f.compare(f.mutate('text',b=>{
    const pe=NtExecutable.from(b);
    b[pe.getAllSections().find(s=>s.info.name==='.text').info.pointerToRawData]^=1;
  })),/executable .text differs/);
  assert.throws(()=>f.compare(f.mutate('version-resource',b=>{
    const offset=b.indexOf(Buffer.from('Digest audit local control','utf16le'));
    assert(offset>0);
    b[offset]^=1;
  })),/unexplained executable byte change/);
  assert.throws(()=>f.compare(f.mutate('last-byte',b=>b[b.length-1]^=1)),/unexplained executable byte change/);
});
