// Dexerion virtual site hosting (dexsite://) — the transport-free core.
//
// The preview serves multi-file sites from this registry instead of flattening
// them into one srcdoc document: a per-artifact virtual host gives real
// relative URLs, so multi-page links, localStorage, module scripts and
// fetch('data.json') all behave like a real site — offline, no server, and
// still one scheme-scoped CSP away from the network. The Electron wiring
// (scheme privileges, protocol.handle, IPC) lives in main.js/browser.js;
// everything here is pure data-in/data-out so it is unit-testable without
// Electron, and so the transport can change without touching the model.
'use strict';

const { LIMITS, safeSitePath, sitePages } = require('./ai-artifacts');
// Debloat V131-V180: bounded preview registry and message rate. The module
// keeps the old values under DEX_DEBLOAT_BASELINE=1 for A/B measurement only.
const { BUDGETS } = require('./debloat-budgets');

const SITE_MIME = {
  html: 'text/html', htm: 'text/html', css: 'text/css',
  js: 'text/javascript', mjs: 'text/javascript',
  json: 'application/json', svg: 'image/svg+xml',
  txt: 'text/plain', xml: 'application/xml',
};

const SITE_REGISTRY_MAX = BUDGETS.siteRegistryHosts;          // secondary cap: number of hosts
const SITE_REGISTRY_MAX_BYTES = BUDGETS.siteRegistryBytes;    // primary cap: file bytes
const PREVIEW_MESSAGE_LIMIT = BUDGETS.previewMessageLimit;    // postMessages per second from a page
const STORAGE_SHIM_MAX_BYTES = 256 * 1024;

// A dexsite:// request can carry `?v=<cache buster>` (the renderer stamps every
// navigation with one) and, in theory, a fragment. Strip BOTH before decoding
// or handing the path to safeSitePath, so a query can never smuggle a traversal
// past the path validator. A full URL is accepted as well for direct unit calls.
function stripSiteRequestPath(rawPath) {
  let s = String(rawPath == null ? '' : rawPath).trim();
  const cut = s.search(/[?#]/);
  if (cut >= 0) s = s.slice(0, cut);
  const absolute = /^[a-z][a-z0-9+.-]*:\/\/[^/]*(\/.*)?$/i.exec(s);
  if (absolute) s = absolute[1] || '/';
  return s;
}

// UTF-8 byte length for content-length headers and for the registry budget.
// Buffer is present in Electron; the fallback keeps this module unit-testable
// in a plain browser-like harness.
function byteLengthOf(value) {
  const s = String(value == null ? '' : value);
  if (typeof Buffer !== 'undefined' && Buffer && typeof Buffer.byteLength === 'function') return Buffer.byteLength(s, 'utf8');
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
  return unescape(encodeURIComponent(s)).length;
}

function withContentLength(body, headers) {
  return Object.assign({}, headers, { 'content-length': String(byteLengthOf(body)) });
}

// A safe, stable namespace for the storage shim's window.name payload. Two
// artifacts (or two versions of the same artifact) must never share keys.
function shimSiteId(siteId) {
  return String(siteId == null ? '' : siteId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48) || 'default';
}

function storageShimFor(siteId) {
  return DEX_STORAGE_SHIM.replace(/__DEX_SITE_ID__/g, shimSiteId(siteId));
}

// Per-response CSP for served pages: 'self' is the artifact's own host, which
// is exactly the file set and nothing else. Inline script/style stay allowed
// because generated sites use them; connect-src 'self' is what makes
// fetch('data.json') work without opening the network.
const SITE_CSP_DEX = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
  + "img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'; "
  + "form-action 'self'; base-uri 'none'; frame-src 'none'; object-src 'none'";

// Preview rendering guard. The AI is told to author a viewport-filling page,
// but the renderer must win even when it ignores that brief: force the host page
// and every top-level block to use the full iframe width and at least one
// viewport of height without altering colours, content or JS behaviour. The
// renderer's srcdoc fallback keeps a mirrored copy (same data-dex-viewport
// marker) so both preview transports agree.
const DEX_VIEWPORT_FILL_CSS = '<style data-dex-viewport="1">'
  + 'html,html>body{margin:0!important;padding:0!important;width:100%!important;max-width:none!important;min-width:0!important;box-sizing:border-box!important;}'
  + 'html>body{min-height:100vh!important;min-height:100dvh!important;display:block!important;place-items:initial!important;align-items:initial!important;justify-content:initial!important;}'
  + 'html>body>*:not(script):not(style):not(template):not(dialog){width:100%!important;max-width:none!important;min-width:0!important;margin-left:0!important;margin-right:0!important;box-sizing:border-box!important;}'
  + '</style>';

// Injected first into every served HTML page (before any page script). The
// renderer keeps its own copy for the srcdoc fallback path — both carry the
// `dexPreview` marker so a drift between them is caught by tests.
const DEX_PREVIEW_REPORTER = '<script>(function(){'
  + 'var rawPost=function(o){try{parent.postMessage(Object.assign({dexPreview:1},o),"*");}catch(e){}};'
  // Rate limit: 100 messages/second. Over-budget messages are counted, never
  // streamed; one debounced notice reports the count, and the LAST error of a
  // burst is replayed so a real failure is never swallowed by the noise.
  + 'var RL_MAX=' + PREVIEW_MESSAGE_LIMIT + ',rlStart=Date.now(),rlUsed=0,rlDropped=0,rlLastError=null,rlTimer=null,rlNotice=false;'
  + 'var isErr=function(k,l){return k==="error"||(k==="console"&&l==="error");};'
  + 'var rlFlush=function(){rlTimer=null;var last=rlLastError;rlLastError=null;'
  + 'if(rlDropped>0&&!rlNotice){rawPost({kind:"console",level:"warn",text:"Preview messages dropped: "+rlDropped+" (rate limit '+PREVIEW_MESSAGE_LIMIT+'/s).",stack:""});rlNotice=true;}'
  + 'if(last)rawPost(last);};'
  + 'var post=function(o){var now=Date.now();if(now-rlStart>=1000){rlStart=now;rlUsed=0;rlDropped=0;rlNotice=false;}'
  + 'if(rlUsed<RL_MAX){rlUsed++;rawPost(o);return;}'
  + 'rlDropped++;if(isErr(o.kind,o.level))rlLastError=o;'
  + 'if(!rlTimer)rlTimer=setTimeout(rlFlush,200);};'
  + 'var send=function(kind,message,line){post({kind:kind,message:String(message==null?"":message).slice(0,300),line:Number(line)||0});};'
  + 'window.addEventListener("error",function(e){'
  + 'var t=e&&e.target;'
  + 'if(t&&t!==window&&t.tagName)send("error","Could not load "+t.tagName.toLowerCase()+(t.src||t.href?": "+(t.src||t.href):""),0);'
  + 'else send("error",(e&&(e.message||e.reason))||"Script error",e&&e.lineno);'
  + '},true);'
  + 'window.addEventListener("unhandledrejection",function(e){'
  + 'var r=e&&e.reason;send("error","Unhandled promise rejection: "+(r&&r.message?r.message:r),0);'
  + '});'
  // An Escape the generated page did not handle belongs to the overlay. The
  // check runs after the event has finished propagating, so a dialog/menu that
  // calls preventDefault() keeps its own Escape. /*dexEscape*/
  + 'window.addEventListener("keydown",function(e){if(!e||e.key!=="Escape"||e.defaultPrevented)return;'
  + 'setTimeout(function(){try{if(!e.defaultPrevented)post({kind:"escape"});}catch(err){}},0);},false);/*dexEscape*/'
  // The fit probe (/*dexFit*/): a page wider than its slot explains itself
  // once per width change. Deliberately soft — a scrollable table is often
  // intentional — and it never spams on every resize tick. (Renderer keeps a
  // mirror of this whole reporter for the srcdoc fallback path.)
  + 'var lastW=0,fit=function(){try{var de=document.documentElement,w=window.innerWidth||0;if(!de||!w)return;if(Math.abs(w-lastW)>40){lastW=w;if(de.scrollWidth>w+1)send("overflow","This page is wider than the preview ("+w+"px) — horizontal scrolling appeared. If that is intentional (a scrollable table), ignore this.",0);}}catch(e){}};'
  + 'window.addEventListener("load",function(){setTimeout(fit,300);});'
  + 'window.addEventListener("resize",fit);/*dexFit*//*dexConsole*/'
  // Console capture: the page's own console output reaches
  // the card's Console panel. Arguments are serialised defensively (depth,
  // cycles, Errors, DOM nodes, getters never invoked) and capped; the
  // ORIGINAL console method still runs, so engine output is untouched, and
  // window.onerror is never cancelled (that would hide the error). The
  // ancestor set is popped on the way out, so two siblings referencing the same
  // object are NOT misreported as circular.
  + 'var fmt=function(v,d,seen){try{if(v===null)return"null";if(v===undefined)return"undefined";'
  + 'var t=typeof v;if(t==="string")return v.length>300?v.slice(0,300)+"…":v;'
  + 'if(t==="number"||t==="boolean")return String(v);'
  + 'if(t==="function")return "[function "+(v.name||"anonymous")+"]";'
  + 'if(v instanceof Error)return v.name+": "+String(v.message||"").slice(0,300);'
  + 'if(t==="object"){if(seen.has(v))return"[circular]";seen.add(v);'
  + 'try{'
  + 'if(v.nodeType===1)return"<"+v.tagName.toLowerCase()+(v.id?"#"+v.id:"")+">";'
  + 'if(d<=0)return"[…]";var out="";'
  + 'if(Array.isArray(v)){for(var i=0;i<v.length&&i<5;i++)out+=(out?",":"")+fmt(v[i],d-1,seen);return"["+out+(v.length>5?",…":"")+"]";}'
  + 'var ks=Object.keys(v).slice(0,6);for(var j=0;j<ks.length;j++){var k=ks[j];try{var dv=Object.getOwnPropertyDescriptor(v,k);if(dv&&dv.get){out+=(out?",":"")+k+":[getter]";continue;}}catch(e){}out+=(out?",":"")+k+":"+fmt(v[k],d-1,seen);}return"{"+out+"}";}'
  + 'finally{seen.delete(v);}'
  + '}'
  + 'return String(v);}catch(e){return"[unserialisable]"}};'
  + 'var fmtSeen=new WeakSet();'
  + '["log","info","warn","error","debug","trace","assert"].forEach(function(level){'
  + 'var orig=console[level];if(typeof orig!=="function")return;'
  + 'console[level]=function(){var raw=arguments;try{var args=Array.prototype.slice.call(raw);'
  + 'if(level==="assert"){if(args[0]){return orig.apply(console,raw);}args=args.slice(1);}'
  + 'var text="";for(var i=0;i<args.length&&i<8;i++){fmtSeen=new WeakSet();text+=(text?" ":"")+fmt(args[i],3,fmtSeen);}'
  + 'if(text.length>1500)text=text.slice(0,1500)+"…";'
  + 'var stack="";if(level==="error"||level==="warn"){try{var e2={};Error.captureStackTrace(e2);stack=String(e2.stack||"").split("\\n").slice(2,5).join(" | ").slice(0,500);}catch(e3){}}'
  + 'post({kind:"console",level:level==="trace"?"debug":level,text:text,stack:stack});'
  + '}catch(err){}return orig.apply(console,raw);};});'
  // Preview editing: with edit mode on (toggled from the card via
  // postMessage), clicks are captured, navigation is prevented and the picked
  // element is reported with a CSS path and its text — the card then resolves
  // the text to ONE source occurrence and saves through the same validated
  // path the Code panel uses.
  + 'var editOn=false;/*dexPick*/'
  + 'var cssPath=function(el){var parts=[];var n=el;for(var d=0;n&&n!==document.body&&d<8;d++){if(n.id){parts.unshift("#"+n.id);break;}'
  + 'var tag=n.tagName?n.tagName.toLowerCase():"";if(!tag)break;var i=1,sib=n;while((sib=sib.previousElementSibling)){if(sib.tagName&&sib.tagName.toLowerCase()===tag)i++;}'
  + 'parts.unshift(tag+":nth-of-type("+i+")");n=n.parentElement;}try{return parts.join(">")||"body";}catch(e){return"?"}};'
  + 'document.addEventListener("mouseover",function(e){if(!editOn)return;var el=e.target;if(el&&el!==document.body&&el.classList)try{el.classList.add("__dexEditHover");}catch(err){}},true);'
  + 'document.addEventListener("mouseout",function(e){if(e&&e.target&&e.target.classList)try{e.target.classList.remove("__dexEditHover");}catch(err){}},true);'
  + 'document.addEventListener("click",function(e){if(!editOn)return;e.preventDefault();e.stopPropagation();'
  + 'var el=e.target;if(!el||el===document.documentElement)return;'
  + 'var txt=String(el.textContent||"").replace(/\\s+/g," ").trim().slice(0,200);'
  + 'post({kind:"pick",tag:(el.tagName||"").toLowerCase(),path:cssPath(el),text:txt});},true);'
  + 'window.addEventListener("message",function(e){if(e&&e.data&&e.data.dexEdit!==undefined)editOn=!!e.data.dexEdit;});'
  + 'try{var st=document.createElement("style");st.textContent=".__dexEditHover{outline:2px solid #3da9fc !important;outline-offset:1px !important;cursor:text !important}";document.head.appendChild(st);}catch(e){}'
  + '})();</scr' + 'ipt>';

// The preview's one promise that needs enforcement: "scripts run, network is
// blocked". Internal page links are real navigations inside the virtual host
// and are left alone; anything with a scheme (https:, mailto:, …) is stopped
// and reported to the card instead of silently replacing the preview.
const DEX_NAV_GUARD = '<script>/*dexGuard*/(function(){'
  + 'var send=function(what,link){try{parent.postMessage({dexPreview:1,kind:"blocked",'
  + 'message:(link?"External link blocked in preview: ":"Blocked in preview: ")+String(what).slice(0,160),line:0},"*");}catch(err){}};'
  + 'var external=function(h){return /^[a-z][a-z0-9+.-]*:/i.test(String(h||""));};'
  + 'document.addEventListener("click",function(e){'
  + 'var el=e.target;'
  + 'while(el&&el!==document&&!(el.tagName&&/^(A|FORM)$/i.test(el.tagName)))el=el.parentNode;'
  + 'if(!el||el===document)return;'
  + 'var tag=String(el.tagName||"").toLowerCase();'
  + 'if(tag==="a"){'
  + 'var h=el.getAttribute("href")||"";'
  + 'if(!h||/^#/.test(h))return;'
  + 'var t=String(el.getAttribute("target")||"").toLowerCase();'
  + 'if(t==="_blank"||t==="_new"||external(h)){e.preventDefault();e.stopPropagation();send(h,true);}'
  + 'return;'
  + '}'
  + 'if(tag==="form"){'
  + 'var t=String(el.getAttribute("target")||"").toLowerCase();'
  + 'if(t==="_blank"||t==="_new"){e.preventDefault();e.stopPropagation();send("Form target "+t,false);}'
  + '}'
  + '},true);'
  + 'document.addEventListener("submit",function(e){'
  + 'var f=e.target;if(!f||String(f.tagName||"").toLowerCase()!=="form")return;'
  + 'var a=f.getAttribute("action")||"";var t=String(f.getAttribute("target")||"").toLowerCase();'
  + 'if((a&&external(a)&&!/^dexsite:/i.test(a))||t==="_blank"||t==="_new"){'
  + 'e.preventDefault();send("Form submission "+(a||t),false);}'
  + '},true);'
  // Scripted navigation: window.open and location.assign/replace never leave
  // the preview, and a programmatic form.submit() obeys the same action rule.
  + 'try{window.open=function(u){send("window.open "+(u==null?"":String(u)),false);return null;};}catch(err){}'
  + 'try{var loc=window.location;'
  + 'var origAssign=loc.assign,origReplace=loc.replace;'
  + 'var guarded=function(u,orig,name){var s=String(u==null?"":u);'
  + 'if(!external(s)||/^dexsite:/i.test(s)){'
  + 'try{return orig.call(loc,s);}catch(err){try{return orig(s);}catch(err2){}}return;}'
  + 'send(name+" "+s,false);};'
  + 'var assign=function(u){guarded(u,origAssign,"location.assign");};'
  + 'var replace=function(u){guarded(u,origReplace,"location.replace");};'
  + 'try{Object.defineProperty(loc,"assign",{value:assign,configurable:false,writable:false});}catch(err){}'
  + 'try{Object.defineProperty(loc,"replace",{value:replace,configurable:false,writable:false});}catch(err){}'
  + 'try{if(typeof Location!=="undefined"){'
  + 'Object.defineProperty(Location.prototype,"assign",{value:assign,configurable:true,writable:true});'
  + 'Object.defineProperty(Location.prototype,"replace",{value:replace,configurable:true,writable:true});}}catch(err){}'
  + '}catch(err){}'
  + 'try{var fs=HTMLFormElement.prototype.submit;'
  + 'HTMLFormElement.prototype.submit=function(){'
  + 'var a=this.getAttribute?this.getAttribute("action")||"":"";'
  + 'var t=this.getAttribute?String(this.getAttribute("target")||"").toLowerCase():"";'
  + 'if((a&&external(a)&&!/^dexsite:/i.test(a))||t==="_blank"||t==="_new"){'
  + 'send("Form submission "+(a||t),false);return;}return fs.apply(this,arguments);};}catch(err){}'
  + '})();</scr' + 'ipt>';

// Chromium denies DOM storage to the custom `dexsite://` scheme inside the
// sandboxed preview frame, so a generated site's own `localStorage.getItem`
// throws at load and aborts the rest of its script (theme toggles, saved state).
// Keep the native Storage where it works (a downloaded file opened directly,
// or the top-level full-page tab), and otherwise install a compatible shim
// BEFORE any page script. It is backed by window.name, which survives the
// frame's navigation when an AI edit produces a new host, so state persists
// across reloads just as it would on a real origin.
const DEX_STORAGE_SHIM = '<script>/*dexStorage*/(function(){'
  + 'var NS="__DEX_SITE_ID__",LIMIT=' + STORAGE_SHIM_MAX_BYTES + ';'
  + 'var bytes=function(s){try{if(typeof TextEncoder!=="undefined")return new TextEncoder().encode(s).length;}catch(err){}'
  + 'try{return unescape(encodeURIComponent(s)).length;}catch(err){return String(s).length;}};'
  + 'var warn=function(n){try{console.warn("[preview] Storage payload exceeds 256 KB ("+n+" bytes); the value was not stored.");}catch(err){}};'
  + 'function make(prefix){'
  + 'var mem={},full=prefix+"_"+NS;'
  + 'try{var raw=String(window.name||""),i=raw.indexOf("|"+full+"=");'
  + 'if(i>=0){var s=raw.slice(i+full.length+2),e=s.indexOf("|"),p=JSON.parse(s.slice(0,e<0?s.length:e));'
  + 'if(p&&typeof p==="object")mem=p;}}catch(err){}'
  + 'var flush=function(){var payload=JSON.stringify(mem),n=bytes(payload);'
  + 'if(n>LIMIT){warn(n);return false;}'
  + 'try{var raw=String(window.name||""),mark="|"+full+"=";'
  + 'var i=raw.indexOf(mark),end=i>=0?raw.indexOf("|",i+mark.length):-1;'
  + 'window.name=i>=0?(raw.slice(0,i)+mark+payload+(end>=0?raw.slice(end):"")):(raw+mark+payload+"|");return true;'
  + '}catch(err){return false;}};'
  + 'var api={getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(mem,k)?mem[k]:null;},'
  + 'setItem:function(k,v){k=String(k);var had=Object.prototype.hasOwnProperty.call(mem,k),old=mem[k];'
  + 'mem[k]=String(v);if(!flush()){if(had)mem[k]=old;else delete mem[k];}},'
  + 'removeItem:function(k){delete mem[String(k)];flush();},'
  + 'clear:function(){mem={};flush();},'
  + 'key:function(i){var ks=Object.keys(mem);return i>=0&&i<ks.length?ks[i]:null;}};'
  + 'Object.defineProperty(api,"length",{get:function(){return Object.keys(mem).length;}});'
  + 'return api;}'
  + 'function install(name,prefix){var native=null;try{native=window[name];}catch(err){}'
  + 'if(native&&typeof native.getItem==="function")return;'
  + 'try{Object.defineProperty(window,name,{value:make(prefix),configurable:true,writable:false});}catch(err){}}'
  + 'install("localStorage","dls");install("sessionStorage","dss");'
  + '})();</scr' + 'ipt>';

// The sandboxed dexsite:// frame is not a secure context, so Chromium leaves
// navigator.clipboard undefined. Generated sites (V2 copy buttons and later)
// call navigator.clipboard.writeText() on click and throw a TypeError that
// aborts the handler and fails E2E. Install a promise-returning, compatible
// clipboard BEFORE any page script, keeping the native one where it exists.
const DEX_CLIPBOARD_SHIM = '<script>/*dexClip*/(function(){'
  + 'var api=null;try{api=navigator.clipboard;}catch(err){}'
  + 'if(api&&typeof api.writeText==="function")return;'
  + 'var buf="";'
  + 'var textOf=function(b){try{return typeof b.text==="function"?b.text():Promise.resolve(String(b));}catch(err){return Promise.resolve("");}};'
  + 'var shim={'
  + 'writeText:function(t){var value=String(t==null?"":t),ok=false;'
  + 'try{var el=document.createElement("textarea");el.value=value;el.setAttribute("readonly","");'
  + 'el.style.cssText="position:fixed;top:-1000px;left:-1000px;opacity:0";'
  + 'var host=document.body||document.documentElement;'
  + 'if(host){host.appendChild(el);try{el.select();el.setSelectionRange(0,el.value.length);}catch(err){}'
  + 'try{ok=!!document.execCommand("copy");}catch(err){ok=false;}try{host.removeChild(el);}catch(err){}}}'
  + 'catch(err){ok=false;}'
  + 'if(!ok)return Promise.reject(new Error("Copy failed"));'
  + 'buf=value;return Promise.resolve();},'
  + 'readText:function(){return Promise.resolve(buf);},'
  + 'write:function(item){try{if(item&&typeof item.getType==="function"){'
  + 'var p=item.getType("text/plain");if(p&&typeof p.then==="function")'
  + 'return p.then(textOf).then(function(t){buf=String(t);}).catch(function(){});}}catch(err){}'
  + 'return Promise.resolve();},'
  + 'read:function(){return Promise.resolve([]);}};'
  + 'try{Object.defineProperty(navigator,"clipboard",{value:shim,configurable:true,writable:true});}'
  + 'catch(err){try{navigator.clipboard=shim;}catch(err2){}}'
  + '})();</scr' + 'ipt>';

function siteMime(filePath) {
  const ext = String(filePath || '').toLowerCase().split('.').pop();
  return SITE_MIME[ext] || 'text/plain';
}

// Content-addressed host id: identical files serve from the same host (the
// browser keeps its localStorage), an edit produces a new host.
function siteIdFor(files, entry) {
  let h = 2166136261;
  const mix = (s) => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } };
  mix(String(entry || ''));
  for (const f of files) { mix('\u0000' + f.path + '\u0000'); mix(f.content); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function titleOf(html) {
  const m = /<title[^>]*>([\s\S]{0,200}?)<\/title>/i.exec(String(html || ''));
  return m ? m[1].replace(/\s+/g, ' ').trim().slice(0, 120) : '';
}

// The chrome shows page titles when the files carry them: one pass at
// registration, so the renderer never parses HTML to draw a button.
function pageInfoFor(files) {
  return files
    .filter((f) => /\.html?$/i.test(f.path))
    .map((f) => ({ path: f.path, title: titleOf(f.content) }));
}

// Size of one site in the registry. UTF-8 bytes, plus a small per-file/per-host
// overhead for the maps and strings the runtime keeps alongside the content.
function siteByteSize(id, entry, files) {
  let bytes = byteLengthOf(id) + byteLengthOf(entry) + 256;
  for (const f of files) bytes += byteLengthOf(f.path) + byteLengthOf(f.content) + 96;
  return bytes;
}

function siteRegistryBytes(registry) {
  let total = 0;
  for (const site of registry.values()) total += Number(site && site.bytes) || 0;
  return total;
}

// Hosts currently shown in a preview are pinned: an LRU sweep may never evict
// them, even when a large artifact pushes the registry over its byte budget.
function setSiteRegistryPin(registry, id, on) {
  const site = registry.get(String(id || ''));
  if (!site) return false;
  site.pinned = on !== false;
  site.at = Date.now();
  return true;
}

// Registers an already-normalized site artifact. Bounded LRU: the byte budget
// (64 MB by default) is the primary limit; the old count cap stays as a
// secondary guard against many tiny hosts. Pinned (active) hosts are skipped.
function registerSiteArtifact(registry, artifact, opts) {
  const files = artifact && Array.isArray(artifact.files) ? artifact.files : [];
  if (!files.length) return null;
  const entry = sitePages(files)[0] || '';
  if (!entry) return null;
  const id = siteIdFor(files, entry);
  const map = new Map();
  for (const f of files) map.set(f.path.toLowerCase(), f);
  registry.delete(id); // re-registration refreshes both size and recency
  registry.set(id, { id, entry, files: map, bytes: siteByteSize(id, entry, files), at: Date.now(), pinned: false });
  const o = opts || {};
  if (o.activeHostId) setSiteRegistryPin(registry, o.activeHostId, true);
  const maxBytes = Number.isFinite(Number(o.maxBytes)) ? Number(o.maxBytes)
    : (Number.isFinite(Number(registry.maxBytes)) ? Number(registry.maxBytes) : SITE_REGISTRY_MAX_BYTES);
  const maxCount = Number.isFinite(Number(o.maxCount)) ? Number(o.maxCount) : SITE_REGISTRY_MAX;
  const sweep = () => {
    while (registry.size > maxCount || siteRegistryBytes(registry) > maxBytes) {
      let oldestId = '';
      let oldestAt = Infinity;
      for (const [key, site] of registry) {
        if (key === id || site.pinned) continue;
        if (site.at < oldestAt) { oldestAt = site.at; oldestId = key; }
      }
      if (!oldestId) return; // everything left is the new host or pinned
      registry.delete(oldestId);
    }
  };
  sweep();
  const titles = new Map(pageInfoFor(files).map((p) => [p.path, p.title]));
  return {
    id, entry, url: 'dexsite://' + id + '/' + entry,
    pages: sitePages(files),
    pageInfo: sitePages(files).map((path) => ({ path, title: titles.get(path) || '' })),
  };
}

// Served pages get the same baseline head the srcdoc form gets: charset, the
// viewport meta (the phone-width preview toggle must work for served sites
// too), a no-referrer policy, then the preview scripts.
function injectSiteHead(html, snippet) {
  const head = '<meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<meta name="referrer" content="no-referrer">'
    + DEX_VIEWPORT_FILL_CSS
    + snippet;
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b([^>]*)>/i, '<head$1>' + head);
  if (/<html\b[^>]*>/i.test(html)) return html.replace(/<html\b([^>]*)>/i, '<html$1><head>' + head + '</head>');
  return '<!doctype html><html><head>' + head + '</head><body>' + html + '</body></html>';
}

// Pure request resolver so every transport decision is unit-testable without
// Electron: path safety, loose basename resolution, MIME, CSP, 404s, and the
// preview scripts injected into served HTML.
function resolveSiteRequest(registry, hostId, rawPath) {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notFound = (why, asHtml) => {
    const plain = 'Not found' + (why ? ': ' + why : '');
    if (!asHtml) {
      return {
        status: 404, mime: 'text/plain', body: plain,
        headers: withContentLength(plain, {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        }),
      };
    }
    // A page-shaped 404 for page requests: the reporter makes the strip
    // explain what happened, and the link offers a way back without needing
    // the chrome. The message carries no user path (nothing to escape into
    // script); the path itself is shown in the body text, escaped.
    const tell = '<script>try{parent.postMessage({dexPreview:1,kind:"error",message:"That page is not part of this website.",line:0},"*");}catch(e){}</scr' + 'ipt>';
    const body = injectSiteHead(
      '<html><head><title>Not found</title></head><body style="font-family:system-ui;padding:24px">'
      + '<h1>Not found</h1><p>That page is not part of this website'
      + (why ? ' (<code>' + esc(why) + '</code>)' : '') + '.</p>'
      + '<p><a href="./">Back to the site</a></p></body></html>',
      DEX_PREVIEW_REPORTER + tell,
    );
    return {
      status: 404, mime: 'text/html', body,
      headers: withContentLength(body, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'content-security-policy': SITE_CSP_DEX,
      }),
    };
  };
  // Strip ?query and #fragment BEFORE decoding/validating. A cache buster must
  // never be able to change which file safeSitePath accepts.
  const requested = stripSiteRequestPath(rawPath);
  const wantsHtml = !requested || requested === '/' || /\.html?$/i.test(requested);
  const site = registry.get(String(hostId || ''));
  if (!site) return notFound('', wantsHtml);
  let decoded = '';
  try { decoded = decodeURIComponent(requested.replace(/^\/+/, '')); } catch { decoded = ''; }
  if (!decoded) decoded = site.entry;
  const clean = safeSitePath(decoded);
  let file = clean ? site.files.get(clean.toLowerCase()) : null;
  if (!file) {
    // Directory-style links: "/docs" or "/docs/" → docs/index.html. The index
    // probe runs before the loose match, and before the path is rejected for
    // its trailing slash (safeSitePath refuses empty segments).
    const asIndex = safeSitePath(decoded.replace(/\/+$/, '') + '/index.html');
    if (asIndex) {
      const hit = site.files.get(asIndex.toLowerCase());
      if (hit) file = hit;
    }
  }
  if (!file && clean) {
    // Bare basenames (only when unambiguous), mirroring the model's loose
    // resolution for links written against a flat layout.
    const base = clean.toLowerCase().split('/').pop();
    const loose = base ? [...site.files.values()].filter((f) => f.path.toLowerCase().split('/').pop() === base) : [];
    file = loose.length === 1 ? loose[0] : null;
  }
  if (!file) return notFound(clean || decoded, wantsHtml);
  site.at = Date.now();
  const mime = siteMime(file.path);
  let body = String(file.content);
  if (mime === 'text/html') {
    // A base tag would retarget every relative URL, and a meta refresh would
    // navigate the preview on a timer: both are stripped here (the sandbox's
    // own defensive passes stay in the model's safeSiteDocument for srcdoc).
    body = body
      .replace(/<base\b[^>]*>/gi, '')
      .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '');
    body = injectSiteHead(body, storageShimFor(site.id) + DEX_CLIPBOARD_SHIM + DEX_PREVIEW_REPORTER + DEX_NAV_GUARD);
  }
  return {
    status: 200, mime, body, path: file.path, entry: site.entry,
    headers: withContentLength(body, {
      'content-type': mime + '; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': SITE_CSP_DEX,
    }),
  };
}

module.exports = {
  SITE_MIME,
  SITE_REGISTRY_MAX,
  SITE_REGISTRY_MAX_BYTES,
  PREVIEW_MESSAGE_LIMIT,
  STORAGE_SHIM_MAX_BYTES,
  SITE_CSP_DEX,
  DEX_VIEWPORT_FILL_CSS,
  DEX_PREVIEW_REPORTER,
  DEX_NAV_GUARD,
  DEX_STORAGE_SHIM,
  DEX_CLIPBOARD_SHIM,
  stripSiteRequestPath,
  byteLengthOf,
  withContentLength,
  shimSiteId,
  storageShimFor,
  siteByteSize,
  siteRegistryBytes,
  setSiteRegistryPin,
  siteMime,
  siteIdFor,
  titleOf,
  pageInfoFor,
  registerSiteArtifact,
  injectSiteHead,
  resolveSiteRequest,
};
