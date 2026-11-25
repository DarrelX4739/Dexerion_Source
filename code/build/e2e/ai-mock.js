'use strict';
// OpenAI-compatible NIM mock for the e2e suite.
//
// Serves just enough of the chat-completions wire for the assistant:
//   GET  /v1/models            -> the catalogue the picker reads
//   POST /v1/chat/completions  -> JSON or SSE, with usage and [DONE]
//
// Tests can change `reply` between requests, read every request body, and
// close the server when the test ends. Nothing here is used by the product;
// the app only reaches it when launched with DEX_AI_TEST=1 + DEX_AI_BASE.

const http = require('http');

function sseChunks(text) {
  const parts = [];
  const value = String(text);
  for (let i = 0; i < value.length; i += 24) parts.push(value.slice(i, i + 24));
  return parts.length ? parts : [''];
}

function startAiMock(options = {}) {
  const state = {
    requests: [],
    fetches: [],   // non-chat GET paths, e.g. the search provider fixtures
    reply: options.reply || 'Mock reply from NIM.',
    replyFor: options.replyFor || null,
    // Milliseconds between streamed chunks (0 = as fast as possible).
    streamDelayMs: Number(options.streamDelayMs) || 0,
    url: '',
    // Real NIM model ids so the picker's recommended list resolves; the mock
    // answers for any model name.
    models: options.models || ['nvidia/nemotron-3-lightning-30b-a3b', 'nvidia/nemotron-nano-3-30b-a3b'],
  };

  // The search provider fixtures. The app swaps provider hostnames onto this
  // server when DEX_SEARCH_BASE is set (the paths stay identical), so the
  // pipeline under test is the shipped one.
  function ddgFixture(base) {
    return '<!doctype html><html><body>'
      + '<a rel="nofollow" class="result__a" href="https://www.google.com/search?q=example+domain">Example Domain - Google Search</a>'
      + '<a class="result__snippet" href="#">An engine page that must never be read or cited.</a>'
      + '<a rel="nofollow" class="result__a" href="https://consent.yahoo.com/v2/collectConsent">Consent required</a>'
      + '<a class="result__snippet" href="#">A consent page that must never be read or cited.</a>'
      + '<a rel="nofollow" class="result__a" href="' + base + '/article?p=1">Example Domain</a>'
      + '<a class="result__snippet" href="#">This domain is for use in illustrative examples in documents.</a>'
      + '<a rel="nofollow" class="result__a" href="' + base + '/article?p=2">More example reading</a>'
      + '<a class="result__snippet" href="#">More information about this test article follows.</a>'
      + '</body></html>';
  }

  function json(res, status, body) {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
    res.end(text);
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const url = String(req.url || '');
      if (req.method === 'GET' && !url.startsWith('/v1/')) state.fetches.push(url);
      // A tiny article for the page-reader test.
      if (req.method === 'GET' && url.startsWith('/article')) {
        const html = '<!doctype html><html><head><meta charset="utf-8"><title>Example Domain</title>'
          + '<meta name="description" content="A test article."></head><body>'
          + '<nav>Navigation junk</nav>'
          + '<article><h1>Example Domain</h1>'
          + '<p>This domain is for use in illustrative examples in documents. You may use this domain in literature without prior coordination or asking for permission.</p>'
          + '<p>More information about this test article follows so the extractor has a real body to work with. Readability should prefer the article text over the surrounding chrome.</p>'
          + '<p>Search engine result pages are never sources: this paragraph exists so the search pipeline receives enough real article text to accept the read and cite the page.</p>'
          + '</article><footer>Footer junk</footer></body></html>';
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(html);
      }
      // Search provider fixtures (path-routed; see ddgFixture above).
      if (req.method === 'GET' && url.startsWith('/html/')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(ddgFixture(state.url.replace(/\/v1$/, '')));
      }
      if (req.method === 'GET' && url.startsWith('/search') && url.includes('format=rss')) {
        res.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8' });
        return res.end('<?xml version="1.0"?><rss version="2.0"><channel><title>e2e</title></channel></rss>');
      }
      if (req.method === 'GET' && url.startsWith('/w/rest.php/')) {
        return json(res, 200, { pages: [] });
      }
      if (req.method === 'GET' && url.startsWith('/v1/models')) {
        return json(res, 200, {
          object: 'list',
          data: state.models.map((id) => ({ id, object: 'model', owned_by: 'dexerion-e2e' })),
        });
      }
      if (req.method === 'POST' && url.startsWith('/v1/chat/completions')) {
        let body = {};
        try { body = JSON.parse(raw || '{}'); } catch {}
        state.requests.push({ url, body });
        const model = body.model || '';
        // replyFor lets a test answer the planner and the synthesis differently.
        // An object reply may carry OpenAI tool_calls for the agent loop; plain
        // strings keep the ordinary chat behaviour every older spec relies on.
        let reply = state.reply;
        if (typeof state.replyFor === 'function') {
          try {
            const made = state.replyFor(body);
            // Keep the old string convention: an empty/falsy reply means
            // "use the default". Objects carrying tool calls stay valid even
            // when their visible text is empty.
            if (made !== undefined && made !== null && (typeof made === 'object' || made)) reply = made;
          } catch { reply = state.reply; }
        }
        const content = typeof reply === 'string' ? reply : String((reply && reply.content) || '');
        const toolCalls = (reply && typeof reply === 'object' && Array.isArray(reply.toolCalls))
          ? reply.toolCalls
          : [];
        const wireCalls = toolCalls.map((call, index) => ({
          index,
          id: String((call && call.id) || ('call_e2e_' + state.requests.length + '_' + index)),
          type: 'function',
          function: {
            name: String((call && call.name) || ''),
            arguments: JSON.stringify((call && call.args) || call && call.input || {}),
          },
        }));
        if (body.stream) {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
          const chunks = content ? sseChunks(content) : [];
          const gap = Number(state.streamDelayMs) || 0;
          const finish = () => {
            res.write('data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 9, completion_tokens: 5, total_tokens: 14 } }) + '\n\n');
            res.write('data: [DONE]\n\n');
            return res.end();
          };
          const write = (i) => {
            if (i >= chunks.length) return finish();
            res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: chunks[i] } }] }) + '\n\n');
            // A slow stream lets a test (or the screenshot harness) look at the
            // in-flight UI: the live bubble, the stop button, the progress note.
            if (gap > 0) setTimeout(() => write(i + 1), gap);
            else write(i + 1);
          };
          if (wireCalls.length) {
            res.write('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: wireCalls } }] }) + '\n\n');
          }
          return write(0);
        }
        return json(res, 200, {
          model,
          choices: [{
            message: {
              role: 'assistant',
              content,
              ...(wireCalls.length ? { tool_calls: wireCalls } : {}),
            },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 9, completion_tokens: 5, total_tokens: 14 },
        });
      }
      return json(res, 404, { error: { message: 'not found' } });
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      state.url = 'http://127.0.0.1:' + port + '/v1';
      resolve({
        url: state.url,
        requests: state.requests,
        fetches: state.fetches,
        get reply() { return state.reply; },
        set reply(value) { state.reply = String(value); },
        set replyFor(value) { state.replyFor = typeof value === 'function' ? value : null; },
        set streamDelayMs(value) { state.streamDelayMs = Number(value) || 0; },
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

module.exports = { startAiMock };
