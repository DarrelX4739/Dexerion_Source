'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {deflateSync}=require('node:zlib');
const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const page=process.env.DEX_SNIP_SOURCE||path.resolve(__dirname,'../../code/src/renderer/snip.html');
const phase=process.env.DEX_SNIP_PHASE||'candidate';
assert(['stock','candidate'].includes(phase));

// A valid screenshot-shaped PNG with reproducible bytes, never user content.
// RGB noise is deliberate to put several MiB through the actual state machine.
const crcTable=Array.from({length:256},(_,i)=>{
  let n=i;for(let b=0;b<8;b++)n=(n>>>1)^((n&1)?0xedb88320:0);
  return n>>>0;
});
function png(width,height,seed=0x12abad99) {
  const rb=width*3+1, rows=Buffer.alloc(rb*height);
  let n=seed;
  for(let y=0;y<height;y++)for(let x=1;x<rb;x++){
    n^=n<<13;n^=n>>>17;n^=n<<5;rows[y*rb+x]=n&255;
  }
  const u32=x=>{const b=Buffer.alloc(4);b.writeUInt32BE(x>>>0);return b;};
  const chunk=(type,data)=>{
    const all=Buffer.concat([Buffer.from(type),data]);
    let crc=0xffffffff;
    for(const b of all)crc=(crc>>>8)^crcTable[(crc^b)&255];
    return Buffer.concat([u32(data.length),all,u32(~crc)]);
  };
  const ih=Buffer.concat([u32(width),u32(height),Buffer.from([8,2,0,0,0])]);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR',ih),chunk('IDAT',deflateSync(rows,{level:1})),chunk('IEND',Buffer.alloc(0))]);
}
const primary='data:image/png;base64,'+png(1280,720).toString('base64');
const second='data:image/png;base64,'+png(80,60,31).toString('base64');
function fixture(t){
  const calls=[],events=[],revoked=[];
  let state={cancel:true,fail:false};
  let count=0;
  const dom=new JSDOM(fs.readFileSync(page,'utf8'),{
    runScripts:'dangerously',url:'file:///isolated-dexerion-test/snip.html',
    beforeParse(w){
      w.dexerion={on(){},invoke:async (key,body)=>{
        calls.push(key);
        if(key==='dex:snip-save'||key==='dex:snip-attach'||key==='dex:snip-copy') {
          assert.equal(body.dataUrl,primary);
          if(key==='dex:snip-save') {
            assert.equal(body.kind,'full');
            if(state.fail)throw new Error('fixture save error');
            return {canceled:state.cancel};
          }
          return true;
        }
        return true;
      }};
      w.HTMLMediaElement.prototype.load=function(){};
      w.URL.createObjectURL=()=> 'blob:fixture/clip-'+ ++count;
      w.URL.revokeObjectURL=u=>revoked.push(u);
    },
  });
  t.after(()=>dom.window.close());
  const w=dom.window;
  const item=id=>w.document.getElementById(id);
  const image=item('pv-img'),video=item('pv-vid'),pane=item('preview');
  for(const ev of ['load','error'])image.addEventListener(ev,()=>events.push(ev));
  return {w,item,image,video,pane,calls,events,revoked,state,
    imageBytes:()=>Buffer.byteLength(image.getAttribute('src')||''),
    lexical:expr=>w.eval(expr),
  };
}
function released(f) {
  const want=phase==='stock'?Buffer.byteLength(primary):0;
  assert.equal(f.imageBytes(),want);
  assert.equal(f.lexical('previewUrl'),null);
  return want;
}
test('retake drops only the discarded source while keeping all later image operations',async t=>{
  const f=fixture(t);
  f.w.showPreview(primary,'full');
  assert.equal(f.imageBytes(),Buffer.byteLength(primary));
  assert(!f.pane.hidden);
  f.item('pv-retake').click();
  assert(f.pane.hidden);
  const bytes=released(f);
  // If a previous decoder had a completed/failed queued event, no existing
  // preview handler can reinsert its data. Real Blink ordering checked separately.
  f.image.dispatchEvent(new f.w.Event('load'));
  f.image.dispatchEvent(new f.w.Event('error'));
  assert.deepEqual(f.events,['load','error']);
  assert.equal(released(f),bytes);
  f.w.showPreview(second,'snip');
  assert.equal(f.image.getAttribute('src'),second);
  assert.equal(f.lexical('previewUrl'),second);
  assert(!f.pane.hidden&&!f.image.hidden&&f.video.hidden);
  t.diagnostic(JSON.stringify({phase,path:'retake',visibleSourceBytes:Buffer.byteLength(primary),discardedDomSourceBytes:bytes}));
});
test('preview Close discards the prior source, and does not touch the frozen backdrop',t=>{
  const f=fixture(t);
  f.item('frozen').src=second;
  f.w.showPreview(primary,'snip');
  f.item('pv-close').click();
  assert(f.pane.hidden);
  t.diagnostic(JSON.stringify({phase,path:'close',discardedDomSourceBytes:released(f)}));
  assert.equal(f.item('frozen').getAttribute('src'),second);
  assert(!f.calls.includes('dex:snip-dismiss'));
});
test('video takes over the preview without keeping the discarded image or changing Blob ownership',t=>{
  const f=fixture(t);
  const video=new f.w.Blob(['synthetic video payload'],{type:'video/webm'});
  f.w.showPreview(primary,'snip');
  f.w.showVideoPreview(video,17);
  assert(f.image.hidden&&!f.video.hidden&&!f.pane.hidden);
  assert.equal(f.video.getAttribute('src'),'blob:fixture/clip-1');
  assert.equal(f.lexical('recVideoBlob'),video);
  assert.match(f.item('pv-meta').textContent,/Recording/);
  t.diagnostic(JSON.stringify({phase,path:'video replacement',discardedDomSourceBytes:released(f)}));
  f.w.showPreview(second,'full');
  assert.equal(f.image.getAttribute('src'),second);
  assert.deepEqual(f.revoked,['blob:fixture/clip-1']);
  assert.equal(f.lexical('recVideoBlob'),null);
});
test('save cancel/failure keep the valid current image; save/copy/attach still use the exact image',async t=>{
  const f=fixture(t);
  f.w.showPreview(primary,'full');
  await f.item('pv-save').onclick();
  assert(!f.pane.hidden);
  assert.equal(f.image.getAttribute('src'),primary);
  assert.equal(f.lexical('previewUrl'),primary);
  f.state.fail=true;
  await f.item('pv-save').onclick();
  assert.equal(f.lexical('previewUrl'),primary);
  assert(!f.pane.hidden);
  f.state.fail=false;
  f.state.cancel=false;
  await f.item('pv-save').onclick();
  await f.item('pv-copy').onclick();
  await f.item('pv-attach').onclick();
  assert.deepEqual(f.calls,['dex:snip-save','dex:snip-save','dex:snip-save','dex:snip-dismiss','dex:snip-copy','dex:snip-dismiss','dex:snip-attach','dex:snip-dismiss']);
});
