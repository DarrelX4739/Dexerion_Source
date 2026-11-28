'use strict';
// Read-only, fail-closed audit for two UNSIGNED local benchmark builds. Nothing
// here edits a PE, changes an Electron fuse, or supplies an executable to run.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getRawHeader } = require('@electron/asar');
const { NtExecutable, NtExecutableResource, Format } = require('resedit');
const { calculateCheckSumForPE } = require('pe-library');

const directory = Format.ImageDirectoryEntry;
const hash = input => createHash('sha256').update(input).digest('hex');
function resourceForArchive(archive) {
  // electron-builder's locked asar/integrity.js hashes the exact decoded
  // pickle string, not a reserialization or the entire package. Our custom
  // unpacked Electron distribution retains default_app.asar, unlike a clean
  // default builder download. Exact-build resource order is app then default.
  const dir = path.dirname(archive);
  assert.equal(path.basename(archive),'app.asar');
  const entries = fs.readdirSync(dir,{withFileTypes:true}).filter(e=>/\.asar$/i.test(e.name));
  assert(entries.every(e=>e.isFile() && ['app.asar','default_app.asar'].includes(e.name)),
    'unrecognized ASAR in benchmark resources');
  const names = entries.map(e=>e.name).sort();
  assert(names[0]==='app.asar');
  const hashes = names.map(name=>hash(getRawHeader(path.join(dir,name)).headerString));
  const [archiveHeaderSha256,defaultArchiveHeaderSha256=null] = hashes;
  assert.notEqual(archiveHeaderSha256,defaultArchiveHeaderSha256,'ASAR digest payload must be unambiguous');
  const payload = Buffer.from(JSON.stringify(names.map((name,i)=>({
    file:'resources\\'+name, alg:'SHA256', value:hashes[i],
  }))));
  return { archiveHeaderSha256,defaultArchiveHeaderSha256,payload };
}
function inspect(bytes, archive, arm) {
  const pe = NtExecutable.from(bytes);
  const { newHeader:nt, dosHeader:dos } = pe;
  assert.equal(nt.fileHeader.machine,0x8664,arm+': expected an x64 benchmark executable');
  assert.equal(nt.optionalHeader.magic,0x20b,arm+': expected PE32+');
  assert.deepEqual(nt.optionalHeaderDataDirectory.get(directory.Certificate),
    { virtualAddress:0, size:0 },arm+': no certificate or signature may be ignored');
  const sections = pe.getAllSections();
  const rawSpan = ({info}) => [info.pointerToRawData,info.pointerToRawData+info.sizeOfRawData];
  const spans = sections.filter(s=>s.info.sizeOfRawData).map(rawSpan).sort((a,b)=>a[0]-b[0]);
  let end = nt.optionalHeader.sizeOfHeaders;
  for(const [start,next] of spans) {
    assert(start>=end && start<next && next<=bytes.length,arm+': overlapping or invalid raw PE spans');
    end=next;
  }
  const text = sections.filter(s=>s.info.name==='.text');
  assert(text.length===1 && (text[0].info.characteristics&0x20000000)!==0,arm+': expected .text');
  const [textStart,textEnd] = rawSpan(text[0]);
  assert(textEnd>textStart,arm+': .text must contain raw bytes');
  const rsrc = pe.getSectionByEntry(directory.Resource);
  assert(rsrc?.info.name==='.rsrc' && (rsrc.info.characteristics&0x20000000)===0,
    arm+': expected non-executable .rsrc');
  const [rsrcStart,rsrcEnd] = rawSpan(rsrc);
  const { archiveHeaderSha256,defaultArchiveHeaderSha256,payload } = resourceForArchive(archive);
  const entries = NtExecutableResource.from(pe).entries.filter(e=>e.type==='INTEGRITY');
  assert(entries.length===1 && entries[0].id==='ELECTRONASAR',arm+': expected unique named ASAR integrity resource');
  assert(Buffer.from(entries[0].bin).equals(payload),arm+': embedded resource must authenticate its own exact ASAR header');
  const offset = bytes.indexOf(payload);
  assert(offset>=rsrcStart && offset+payload.length<=rsrcEnd &&
    bytes.indexOf(payload,offset+1)===-1,arm+': unique raw integrity payload required inside .rsrc');
  const digestOffset = offset+payload.indexOf(archiveHeaderSha256);
  assert.equal(bytes.toString('ascii',digestOffset,digestOffset+64),archiveHeaderSha256);
  const checksumOffset = dos.newHeaderAddress+88;
  assert(checksumOffset>=88 && checksumOffset+4<=textStart,arm+': invalid optional-header checksum offset');
  const checksum = bytes.readUInt32LE(checksumOffset);
  if(checksum!==0) {
    const raw = bytes.byteOffset===0 && bytes.byteLength===bytes.buffer.byteLength
      ? bytes.buffer : bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
    assert.equal(checksum,calculateCheckSumForPE(raw,false),arm+': invalid populated PE checksum');
  }
  return { archiveHeaderSha256,defaultArchiveHeaderSha256,digestOffset,checksumOffset,checksum,textStart,textEnd,
    lang:entries[0].lang,codepage:entries[0].codepage };
}
function auditWindowsAsarIntegrity(stockExe, subsetExe, stockArchive, subsetArchive) {
  const stock = fs.readFileSync(stockExe), subset = fs.readFileSync(subsetExe);
  assert.equal(stock.length,subset.length,'PE byte length change is not attributable to the ASAR hash');
  const a = inspect(stock,stockArchive,'stock'), b = inspect(subset,subsetArchive,'subset');
  for(const field of ['digestOffset','checksumOffset','textStart','textEnd','lang','codepage']) {
    assert.equal(a[field],b[field],'ASAR integrity PE layout differs at '+field);
  }
  assert.notEqual(a.archiveHeaderSha256,b.archiveHeaderSha256,'must audit two different ASAR headers');
  assert.equal(a.defaultArchiveHeaderSha256,b.defaultArchiveHeaderSha256,'bundled Electron default archive must be identical');
  assert.equal(a.checksum===0,b.checksum===0,'PE checksum population differs');
  assert(stock.subarray(a.textStart,a.textEnd).equals(subset.subarray(b.textStart,b.textEnd)),
    'executable .text differs');
  let cursor=0;
  let differingIntegrityBytes=0;
  for(let i=a.digestOffset;i<a.digestOffset+64;i++) if(stock[i]!==subset[i]) differingIntegrityBytes++;
  // Keep identical offsets, and compare *all* remaining bytes from DOS header
  // through overlay, including manifest, fuses, resource structure and gaps.
  const spans=[[a.digestOffset,a.digestOffset+64]];
  if(a.checksum!==0) spans.unshift([a.checksumOffset,a.checksumOffset+4]);
  for(const [start,stop] of [...spans,[stock.length,stock.length]]) {
    assert(start>=cursor && stock.subarray(cursor,start).equals(subset.subarray(cursor,start)),
      'unexplained executable byte change outside the verified integrity digest and PE checksum');
    cursor=stop;
  }
  return { identicalOutsideVerifiedIntegrityAndChecksum:true, executableBytes:stock.length,
    stockExecutableSha256:hash(stock),subsetExecutableSha256:hash(subset),
    stockAsarHeaderSha256:a.archiveHeaderSha256,subsetAsarHeaderSha256:b.archiveHeaderSha256,
    identicalDefaultAsarHeaderSha256:a.defaultArchiveHeaderSha256,
    integrityDigestFileOffset:a.digestOffset,differingIntegrityBytes,checksumFileOffset:a.checksumOffset,
    stockVerifiedPeChecksum:a.checksum,subsetVerifiedPeChecksum:b.checksum,
    identicalTextSha256:hash(stock.subarray(a.textStart,a.textEnd)) };
}
module.exports={ auditWindowsAsarIntegrity };
