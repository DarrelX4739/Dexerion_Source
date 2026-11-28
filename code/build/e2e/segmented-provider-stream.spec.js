'use strict';

const fs = require('node:fs');
const http = require('node:http');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { expect, test } = require('@playwright/test');
const { launchDexerion } = require('./app');

const SYSTEM_MODEL = 'nvidia/nemotron-3-lightning-30b-a3b';
const ASK = 'Only run the synthetic fragmented SSE fixture.';
const ANSWER = 'Verified segmented stream: café 🚀 and complete.';
const REASONING = 'é🌏!,'.repeat(35_000);
const line = x => Buffer.from('data: ' + JSON.stringify(x) + '\r\n\r\n');

async function fragmentedMock() {
  const counters = { matchingStreams:0, writes:0, bytes:0 };
  const server = http.createServer(async (req,res) => {
    try {
      if (req.headers.host !== '127.0.0.1:' + server.address().port) {
        res.writeHead(404).end(); return;
      }
      const send = value => {
        res.writeHead(200,{'Content-Type':'application/json','Connection':'close'});
        res.end(JSON.stringify(value));
      };
      if (req.method==='GET' && req.url==='/v1/models'){
        send({object:'list',data:[{id:SYSTEM_MODEL,object:'model',owned_by:'fixture'}]});
        return;
      }
      if (req.method!=='POST' || req.url!=='/v1/chat/completions') {
        res.writeHead(404).end(); return;
      }
      const received=[];
      let bytes=0;
      for await(const chunk of req) {
        bytes+=chunk.length;
        if(bytes>1024*1024){res.writeHead(413).end();return;}
        received.push(chunk);
      }
      const body=JSON.parse(Buffer.concat(received).toString('utf8'));
      if (!body.stream) {
        send({model:SYSTEM_MODEL,choices:[{message:{role:'assistant',content:'Local health check'},finish_reason:'stop'}]});
        return;
      }
      if (!body.messages.some(m=>String(m.content||'').includes(ASK))) {
        res.writeHead(400,{'Content-Type':'application/json'});
        res.end('{"error":{"message":"Unexpected non-fixture prompt"}}');
        return;
      }
      counters.matchingStreams++;
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'close'});
      res.flushHeaders();
      // Fragment one JSON event, not merely the spacing between events.
      // This split intentionally bisects UTF-8 characters on the wire.
      const packet=line({choices:[{delta:{reasoning_content:REASONING}}]});
      for(let i=0;i<packet.length;i+=1021) {
        if (res.destroyed) return;
        const chunk=packet.subarray(i,i+1021);
        counters.writes++; counters.bytes+=chunk.length;
        res.write(chunk);
        await delay(2);
      }
      res.write(line({choices:[{delta:{content:ANSWER},finish_reason:'stop'}]}));
      res.write('data: [DONE]\r\n\r\n');
      // Provider usage is deliberately the last unterminated event.
      res.end('data: '+JSON.stringify({choices:[],usage:{prompt_tokens:13,completion_tokens:10}}));
    } catch (err) {
      if (!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});
      if (!res.destroyed)res.end('{"error":{"message":"Failed synthetic fixture"}}');
    }
  });
  const listening=once(server,'listening');
  server.listen(0,'127.0.0.1');
  await listening;
  return {base:'http://127.0.0.1:'+server.address().port+'/v1',counters,
    close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})};
}

test('actual app preserves visible reply and saved reasoning for one large fragmented SSE event',async()=>{
  const mock=await fragmentedMock();
  let launched;
  try {
    launched=await launchDexerion({aiBase:mock.base,attempts:1});
    const {win}=launched;
    await win.evaluate(async()=>{
      await window.dexerion.invoke('dex:ai-key-set','nvapi-e2e-fragmented-synthetic');
      await window.dexerion.invoke('dex:ai-open');
    });
    await expect(win.locator('#ai-sidebar')).toBeVisible();
    await expect(win.locator('#ai-setup')).toBeHidden();
    await win.locator('#ai-input').fill(ASK);
    await win.locator('#ai-input').press('Enter');
    await expect(win.locator('#ai-messages')).toContainText(ANSWER,{timeout:30000});
    await expect(win.locator('#ai-send')).not.toHaveClass(/\bis-stop\b/);
    const storedAnswer = () => win.evaluate(async (text)=>{
      const rows=await window.dexerion.invoke('dex:ai-chats-list');
      if (!rows.length)return null;
      const thread=await window.dexerion.invoke('dex:ai-chat-open',rows[0].id);
      const item=thread.messages.find(m=>m.role==='model'&&m.text===text);
      return item?{text:item.text,thinking:item.thinking}:null;
    },ANSWER);
    await expect.poll(storedAnswer,{timeout:15000}).toEqual({text:ANSWER,thinking:REASONING.slice(0,4000)});
    expect(mock.counters.matchingStreams).toBe(1);
    expect(mock.counters.writes).toBeGreaterThan(100);
    expect(mock.counters.bytes).toBeGreaterThan(200000);
  } finally {
    try{if(launched)await launched.app.close();}
    finally {
      try{ await mock.close(); }
      finally{ if(launched)fs.rmSync(launched.profile,{recursive:true,force:true,maxRetries:8,retryDelay:300}); }
    }
  }
});
