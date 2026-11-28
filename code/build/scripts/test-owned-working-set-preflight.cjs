'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {verify}=require('./owned-working-set-preflight.cjs');
const now=Date.parse('2026-11-28T16:40:00Z');
const raw=()=>{
  const row=(pid,ppid,birth,privateWorkingSetBytes)=>({pid,ppid,birth,privateWorkingSetBytes,providerQpc:'10600000',providerFreq:'10000000'});
  return {id:1,acquisition:{beforeInventoryUtcMs:now+18,beforeUtcMs:now+24,afterUtcMs:now+124,afterInventoryUtcMs:now+129,
      lowQpc:'10000000',highQpc:'11000000',qpcFreq:'10000000'},
    rows:[row(11,6,'134100000000000000',10000),row(12,11,'134100000000000001',15000),
      row(13,12,'134100000000000002',5000)]};
};
const read=o=>verify(o,11,now,now+181);
test('uses the provider-owned acquisition time, not either inventory snapshot or collector return',()=>{
  const r=read(raw());
  assert.equal(r.providerMinUtcMs,now+82);
  assert.equal(r.providerMaxUtcMs,now+86);
  assert.equal(r.privateResidentBytes,30000);
  assert.equal(r.rootBirth,134100000000000000n);
  assert.deepEqual(r.qualification,{ownedProcesses:3,providerQpcSpanMs:100,providerOffsetLowerBoundMs:82,
    providerOffsetUpperBoundMs:86,collectorRoundTripMs:181});
  assert(!JSON.stringify(r.qualification).includes('privateResidentBytes'));
});
test('rejects stale provider ticks and does not substitute inventory, wrapper or wall times',()=>{
  for(const forced of ['0','9999999','11000001','-42',10600000,undefined]){
    const m=raw();m.rows[1].providerQpc=forced;assert.throws(()=>read(m),/tick|clock/);
  }
  const m=raw();m.rows[1].providerFreq='9999999';
  assert.throws(()=>read(m),/different-clock/);
  const stale=raw();stale.rows[1].providerQpc='10200000';
  assert.throws(()=>read(stale),/one acquisition/);
});
test('refuses wrong generation, unproved ownership, counter gaps and a fake positive',()=>{
  const wrong=raw();wrong.rows[1].ppid=410;
  assert.throws(()=>read(wrong),/ancestry/);
  const stale=raw();stale.rows[2].birth='134099999999999999';
  assert.throws(()=>read(stale),/stale parent/);
  const cycle=raw();cycle.rows[1].ppid=13;
  assert.throws(()=>read(cycle),/ancestry|stale parent/);
  const repeated=raw();repeated.rows.push({...repeated.rows[1]});
  assert.throws(()=>read(repeated),/invalid or repeated/);
  const absent=raw();absent.rows[1].privateWorkingSetBytes=null;
  assert.throws(()=>read(absent),/invalid or repeated/);
  const zeros=raw();zeros.rows[1].privateWorkingSetBytes=zeros.rows[2].privateWorkingSetBytes=0;
  assert.throws(()=>read(zeros),/positive control/);
});
test('rejects wall-clock steps, delayed/mismatched frames and expensive wrappers',()=>{
  const jumped=raw();jumped.acquisition.afterUtcMs=now+440;
  jumped.acquisition.afterInventoryUtcMs=now+445;
  assert.throws(()=>verify(jumped,11,now,now+500),/wall\/QPC alignment/);
  const misplaced=raw();misplaced.acquisition.beforeInventoryUtcMs=now+32;
  assert.throws(()=>read(misplaced),/bracket/);
  assert.throws(()=>verify(raw(),11,now,now+5001),/within five seconds/);
  const slow=raw();slow.acquisition.beforeUtcMs=now+2700;
  slow.acquisition.beforeInventoryUtcMs=now+2500;slow.acquisition.afterUtcMs=now+2800;
  slow.acquisition.afterInventoryUtcMs=now+2810;
  assert.throws(()=>verify(slow,11,now,now+3200),/not narrowly bounded or timely/);
});
