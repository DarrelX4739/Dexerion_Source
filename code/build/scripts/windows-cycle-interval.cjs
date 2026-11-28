'use strict';
const assert=require('node:assert/strict');
const asInt=(x)=>{
  assert(typeof x==='string'&&/^[0-9]{1,20}$/.test(x),'invalid exact integer counter');
  return BigInt(x);
};
function summarizeInterval(ids,generations,frequency,a,b,wantedMs) {
  assert(ids.length===2&&new Set(ids).size===2&&ids.every(x=>Number.isInteger(x)&&x>0));
  const freq=asInt(frequency);
  assert(freq>0n);
  const a0=asInt(a.start),a1=asInt(a.end),b0=asInt(b.start),b1=asInt(b.end);
  assert(a0<=a1&&a1<b0&&b0<=b1,'invalid QPC ordering');
  const ms=n=>Number(n)*1000/Number(freq);
  const wallMs=ms((b0+b1-a0-a1)/2n);
  const drift=Math.max(ms(a1-a0),ms(b1-b0));
  assert(drift<=12,'counter endpoint skew exceeded 12ms');
  assert(wallMs>=wantedMs-50&&wallMs<=wantedMs+800,'unstable QPC sample window');
  const byPid=(s)=>{
    assert(s.kind==='sample'&&s.rows.length===ids.length);
    const result=new Map(s.rows.map(x=>[x.pid,x]));
    assert(result.size===ids.length&&ids.every(x=>result.has(x)),'wrong/duplicate process IDs');
    return result;
  };
  const p=byPid(a),q=byPid(b);
  const difference=(x,y)=>{
    const d=asInt(y)-asInt(x);
    assert(d>=0n,'counter reset');
    return d;
  };
  const rows=ids.map(pid=>{
    const x=p.get(pid),y=q.get(pid);
    assert(asInt(x.started)===asInt(generations.get(pid))&&x.started===y.started,
      'process generation changed');
    const cycles=difference(x.cycles,y.cycles);
    const times=difference(x.user,y.user)+difference(x.kernel,y.kernel);
    assert(times<BigInt(Number.MAX_SAFE_INTEGER),'unrepresentable interval CPU time');
    // Expose exact CPU cycles as decimal, never convert cycles to seconds.
    return {counterCpuMs:Number(times)/1e4,cycleDelta:cycles.toString()};
  });
  return {wallMs,endpointSkewMs:drift,browser:rows[0],renderer:rows[1]};
}
module.exports={summarizeInterval};
