'use strict';
// Windows diagnostic, not a benchmark grade: positively identify the shell
// and fixture tabs in a real app. Playwright Electron supplies the supported
// main-process read interface. No production code or window state is changed
// to measure; only ordinary browsing IPC opens the local synthetic workload.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const { matchesInventory, stableCpuByRole, verifiedNativeTree } = require('./measure-sample-guard.cjs');

const BACKGROUNDS = 8;
const SETTLE_MS = 12000;
const SAMPLE_MS = 8000;
const MAX_SNAPSHOT_SPAN_SECONDS = 30;
const ARM_ORDER = ['static', 'animated', 'animated', 'static'];

function fixtureDocument({ index, animated }) {
  const route = index === 0 ? 'foreground' : 'background-' + index;
  // Static and animated backgrounds get the same canvas, required content and
  // initial draw. Titles never change, so this is not a tab-title-update test.
  return `<!doctype html><meta charset="utf-8"><title>Renderer attribution: ${route}</title>
  <style>html,body{margin:0;overflow:hidden}canvas{display:block}</style>
  <canvas id="canvas" width="960" height="640"></canvas><script>
  const canvas = document.querySelector('canvas'), context = canvas.getContext('2d');
  const marker = ${JSON.stringify(route)};
  function draw(frame) {
    context.fillStyle = '#101018'; context.fillRect(0,0,960,640);
    for (let i=0; i<28; i++) {
      const a=(frame/30+i/28)*Math.PI*2;
      context.fillStyle='hsl('+((i*13+frame/4)%360)+' 80% 55%)';
      context.beginPath(); context.arc(480+Math.cos(a)*300,320+Math.sin(a*1.7)*180,8+(i%5)*3,0,Math.PI*2); context.fill();
    }
  }
  draw(0);
  window.__roleAttribution = { marker, frames:0, animated:${animated} };
  if (${animated}) requestAnimationFrame(function raf() {
    draw(++window.__roleAttribution.frames); requestAnimationFrame(raf);
  });
  </script>`;
}

function route(url, arm) {
  const match = /^\/page\/(\d+)$/.exec(url || '');
  if (!match) return null;
  const index = Number(match[1]);
  if (index > BACKGROUNDS) return null;
  return { index, animated: index === 0 || arm === 'animated' };
}

function countWindowsSnapshot(includePrivate) {
  const args = ['-NoProfile', '-NoLogo', '-File', path.join(__dirname, 'measure-tree-snapshot.ps1')];
  if (includePrivate) args.push('-IncludePrivateWorkingSet');
  return JSON.parse(execFileSync('powershell.exe', args, { encoding: 'utf8', windowsHide: true,
    timeout: 25000, maxBuffer: 32 * 1024 * 1024 }).trim());
}

function labelMap(observation, expectedUrls) {
  assert.equal(observation.windowCount, 1, 'exactly one shell window');
  assert(observation.shellVisible && !observation.shellMinimized, 'visible real shell window');
  assert(/^file:\/\//i.test(observation.shellUrl) && /\/src\/renderer\/shell\.html$/i.test(new URL(observation.shellUrl).pathname),
    'not the real shell URL');
  assert(Number.isInteger(observation.shellPid) && observation.shellPid > 0, 'no shell OS PID');
  assert(matchesInventory(observation.content.map((r) => r.url), expectedUrls), 'expected every real content page');
  const labels = new Map([[observation.shellPid, 'shell-renderer']]);
  for (const row of observation.content) {
    assert(Number.isInteger(row.pid) && row.pid > 0, 'no actual page OS PID');
    const label = row.url === expectedUrls[0] ? 'foreground-renderer' : 'background-renderer';
    assert(!labels.has(row.pid) || labels.get(row.pid) === label, 'process shares shell/foreground/background; cannot attribute uniquely');
    labels.set(row.pid, label);
  }
  return labels;
}

function observe(app, urls) {
  return app.evaluate(({ BrowserWindow, webContents }, expected) => {
    const windows = BrowserWindow.getAllWindows();
    const shell = windows[0];
    const content = webContents.getAllWebContents().filter((wc) => !wc.isDestroyed() && expected.includes(wc.getURL()))
      .map((wc) => ({ url: wc.getURL(), pid: wc.getOSProcessId(), loading: wc.isLoadingMainFrame() }));
    return { windowCount: windows.length, shellPid: shell?.webContents.getOSProcessId(),
      shellUrl: shell?.webContents.getURL(), shellVisible: shell?.isVisible(), shellMinimized: shell?.isMinimized(),
      shellFocused: shell?.isFocused(), content };
  }, urls);
}

async function counters(app, urls) {
  return app.evaluate(async ({ webContents }, expected) => {
    const pages = webContents.getAllWebContents().filter((wc) => !wc.isDestroyed());
    const read = (wc) => new Promise((resolve) => {
      // Detached views may suspend even basic evaluation. No answer means
      // unknown, not no animation. false explicitly supplies no user gesture.
      const timer = setTimeout(() => resolve(null), 2200);
      wc.executeJavaScript(`(() => {
        const f=window.__roleAttribution;
        if(!f || !document.querySelector('canvas')) return null;
        return {marker:f.marker, animated:f.animated, frames:f.frames,
          visibility:document.visibilityState, clockMs:performance.now(),
          timeOrigin:performance.timeOrigin, width:innerWidth, height:innerHeight, dpr:devicePixelRatio};
      })()`, false).then((result) => { clearTimeout(timer); resolve(result); }, () => { clearTimeout(timer); resolve(null); });
    });
    return Promise.all(expected.map((url) => {
      const wc = pages.find((page) => page.getURL() === url);
      return wc ? read(wc) : null;
    }));
  }, urls);
}

function summarizeFrames(before, after, arm) {
  assert.equal(before.length, BACKGROUNDS + 1);
  assert.equal(after.length, BACKGROUNDS + 1);
  const mapped = after.map((b, index) => {
    const a = before[index];
    const marker = index ? 'background-' + index : 'foreground';
    const animated = index === 0 || arm === 'animated';
    if (!a || !b) return { marker, animated, observed: false,
      visibility: [a?.visibility ?? null, b?.visibility ?? null], framesAdvanced: null };
    assert.equal(a.marker, marker);
    assert.equal(b.marker, marker);
    assert.equal(a.animated, animated);
    assert.equal(b.animated, animated);
    assert(Number.isFinite(a.timeOrigin) && a.timeOrigin === b.timeOrigin);
    assert(Number.isFinite(a.clockMs) && Number.isFinite(b.clockMs) && b.clockMs > a.clockMs);
    assert(Number.isInteger(a.frames) && Number.isInteger(b.frames) && b.frames >= a.frames);
    if (!animated) assert.equal(b.frames, 0);
    if (index === 0) assert.deepEqual([a.width, a.height, a.dpr], [b.width, b.height, b.dpr], 'foreground viewport changed');
    return { marker, animated, observed: true, visibility: [a.visibility, b.visibility],
      framesAdvanced: b.frames - a.frames, observedSeconds: (b.clockMs - a.clockMs) / 1000,
      viewport: { width: b.width, height: b.height, dpr: b.dpr } };
  });
  const foreground = mapped[0];
  assert(foreground.observed && foreground.visibility.every((v) => v === 'visible') && foreground.framesAdvanced >= 20
    && foreground.viewport.width > 0 && foreground.viewport.height > 0 && foreground.viewport.dpr > 0,
  'no visible, advancing foreground positive control');
  return mapped;
}

function summarizeSnapshots(a, b, browserPid, profile, labels) {
  const root = (p) => /^electron\.exe$/i.test(p.name) && typeof p.cmdline === 'string'
    && p.cmdline.toLowerCase().includes(profile.toLowerCase());
  const ta = verifiedNativeTree(a.processes, browserPid, root);
  const tb = verifiedNativeTree(b.processes, browserPid, root);
  const byPid = (ps, id) => ps.find((p) => p.pid === id);
  const chromiumRole = (p) => String(p.cmdline || '').match(/--type=([\w-]+)/)?.[1] || 'browser';
  for (const [pid, label] of labels) {
    const start = byPid(ta.rows, pid), finish = byPid(tb.rows, pid);
    assert(start && finish && start.startedUtc === finish.startedUtc && chromiumRole(finish) === 'renderer', `identity did not reconcile for ${label}`);
    assert(Number.isFinite(finish.privateWsBytes) && finish.privateWsBytes >= 0, `missing private resident counter for ${label}`);
  }
  const role = p => labels.get(p.pid) || (chromiumRole(p) === 'renderer' ? 'unmapped-renderer' : chromiumRole(p));
  const stable = stableCpuByRole(ta.rows, tb.rows, role);
  const windowSec = (Date.parse(b.capturedAt) - Date.parse(a.capturedAt)) / 1000;
  assert(windowSec >= SAMPLE_MS / 1000 && windowSec <= MAX_SNAPSHOT_SPAN_SECONDS, 'snapshot sample outside intended interval');
  const result = {};
  for (const proc of tb.rows) {
    const label = role(proc);
    const row = result[label] ||= { processes: 0, privateResidentMiB: 0 };
    row.processes++;
    if (!Number.isFinite(proc.privateWsBytes) || proc.privateWsBytes < 0) row.privateResidentMiB = null;
    if (row.privateResidentMiB !== null) row.privateResidentMiB += proc.privateWsBytes / 1048576;
  }
  for (const [label, row] of Object.entries(result)) {
    row.stableProcesses = stable.roles[label]?.processes || 0;
    // Do not turn a changed process population into a lower CPU number.
    row.cpuPctOfOneCore = row.processes === row.stableProcesses
      ? stable.roles[label].cpu100ns / 1e7 / windowSec * 100 : null;
  }
  const newAtEnd = stable.skippedAtEnd;
  const exitedOrChanged = stable.missingAtEnd;
  return { sampleSeconds: windowSec, newAtEnd, exitedOrChanged, attribution: result };
}

async function runTrial(origin, arm) {
  const { launchDexerion } = require('../e2e/app');
  const urls = Array.from({length: BACKGROUNDS + 1}, (_, i) => `http://role-attribution-${i}.localhost:${origin}/page/${i}`);
  const { app, win, profile } = await launchDexerion({ attempts: 1, gpu: 'adaptive' });
  try {
    const getState = () => win.evaluate(() => window.dexerion.invoke('dex:get-state'));
    let initial;
    for (let i=0; i<60; i++) {
      try { initial = await getState(); } catch {}
      if (initial?.active && initial.tabs?.some(t => t.id === initial.active && !t.loading)) break;
      await sleep(200);
    }
    assert(initial?.active && initial.tabs.some(t => t.id === initial.active && !t.loading), 'ready boot tab required');
    const boot = initial.active;
    await win.evaluate(async ({ boot, urls }) => {
      const bridge = window.dexerion;
      const settings = await bridge.invoke('dex:get-state');
      for (const tab of settings.tabs) if (tab.id !== boot) await bridge.invoke('dex:close-tab', tab.id);
      await bridge.invoke('dex:navigate', boot, urls[0]);
      for (const url of urls.slice(1)) await bridge.invoke('dex:new-tab', url, true);
    }, { boot, urls });
    let ready = false;
    for (let i=0; i<100; i++) {
      const state = await getState();
      if (state.active === boot && matchesInventory(state.tabs.map(t => t.url), urls)
          && !state.tabs.some(t => t.loading)) { ready = true; break; }
      await sleep(250);
    }
    assert(ready, 'not all real URLs ready with original foreground');
    await sleep(SETTLE_MS);
    const first = await observe(app, urls);
    const labels = labelMap(first, urls);
    assert(!first.content.some(r => r.loading), 'page still loading at sample start');
    const frameA = await counters(app, urls);
    const a = countWindowsSnapshot(false);
    await sleep(SAMPLE_MS);
    const b = countWindowsSnapshot(true);
    const frameB = await counters(app, urls);
    const last = await observe(app, urls);
    assert.deepEqual(labelMap(last, urls), labels, 'PID role mapping changed during measurement');
    assert.deepEqual(last.content.slice().sort((x,y)=>x.url.localeCompare(y.url)),
      first.content.slice().sort((x,y)=>x.url.localeCompare(y.url)), 'URL/PID mapping changed');
    const latest = await getState();
    assert(latest.active === boot && matchesInventory(latest.tabs.map(t=>t.url), urls), 'active tab or inventory changed');
    return { arm, focusedAtBounds: [first.shellFocused, last.shellFocused],
      ...summarizeSnapshots(a, b, app.process().pid, profile, labels), frames: summarizeFrames(frameA, frameB, arm) };
  } finally {
    try { await app.close(); } finally {
      await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
    }
  }
}

async function main() {
  if (process.argv[2] === '--self-test') {
    const urls = ['http://local/a', 'http://local/b'];
    const demo = { windowCount:1, shellVisible:true, shellMinimized:false,
      shellPid:20, shellUrl:'file:///C:/repo/code/code/src/renderer/shell.html',
      content: [{url:urls[0],pid:21},{url:urls[1],pid:22}] };
    assert.deepEqual([...labelMap(demo, urls)], [[20,'shell-renderer'],[21,'foreground-renderer'],[22,'background-renderer']]);
    assert.throws(() => labelMap({...demo,shellVisible:false}, urls));
    assert.throws(() => labelMap({...demo,content:[{url:urls[0],pid:20},{url:urls[1],pid:22}]}, urls));
    assert.throws(() => labelMap({...demo,content:[{url:urls[0],pid:21},{url:urls[1],pid:21}]}, urls));
    assert.throws(() => labelMap({...demo,content:[{url:urls[0],pid:21}]}, urls));
    assert.equal(route('/page/1','static').animated,false);
    assert.equal(route('/page/1','animated').animated,true);
    assert.equal(route('/page/0','static').animated,true);
    assert.equal(route('/page/9','static'),null);
    const f = {marker:'foreground',animated:true,frames:10,visibility:'visible',clockMs:1,
      timeOrigin:0,width:900,height:600,dpr:1};
    const a = [f,...Array(BACKGROUNDS).fill(null)];
    const b = [{...f,clockMs:1000,frames:100},...Array(BACKGROUNDS).fill(null)];
    const measured = summarizeFrames(a,b,'static');
    assert.equal(measured[0].framesAdvanced,90);
    assert.equal(measured[1].framesAdvanced,null);
    assert.throws(() => summarizeFrames(a, [{...b[0],visibility:'hidden'},...b.slice(1)], 'static'));
    assert.throws(() => summarizeFrames(a, [{...b[0],width:600},...b.slice(1)], 'static'));
    const profile = 'C:\\temp\\dexerion-e2e-dummy';
    const pid = 10;
    const labels = labelMap(demo, urls);
    const startedUtc = '2026-11-28T00:00:00.000Z';
    const ps = [
      { pid, ppid:1, name:'electron.exe', cmdline:`electron.exe --user-data-dir=${profile}` },
      ...[20, 21, 22, 23].map((pid) => ({pid, ppid:10, name:'electron.exe', cmdline:'electron.exe --type=renderer'})),
    ].map(p => ({...p, startedUtc, cpu100ns:0, privateWsBytes: 1048576}));
    const cpuA = {capturedAt:'2026-11-28T00:01:00.000Z',processes:ps};
    const cpuB = {capturedAt:'2026-11-28T00:01:10.000Z',processes:ps.map(p=>({...p,cpu100ns:1000000}))};
    const summary = summarizeSnapshots(cpuA,cpuB,pid,profile,labels).attribution;
    assert.deepEqual(summary['shell-renderer'], {processes:1,privateResidentMiB:1,stableProcesses:1,cpuPctOfOneCore:1});
    assert.deepEqual(summary['unmapped-renderer'], summary['shell-renderer']);
    assert.throws(() => summarizeSnapshots(cpuA,{...cpuB,processes:cpuB.processes.map(p => p.pid === 20 ? {...p,privateWsBytes:null} : p)},pid,profile,labels));
    console.log('shell/tab attribution diagnostics self-test passed');
    return;
  }
  assert.equal(process.platform,'win32','Windows private resident sampling only');
  const out = process.argv[2];
  assert(out && path.isAbsolute(out),'absolute JSON output path required');
  const trials = [];
  let arm = ARM_ORDER[0];
  const server = http.createServer((req,res) => {
    const view = route(req.url, arm);
    if (!view) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
    res.end(fixtureDocument(view));
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    for (arm of ARM_ORDER) {
      const row = await runTrial(server.address().port, arm);
      trials.push(row);
      console.log(`${arm}: ${JSON.stringify(row.attribution)}`);
    }
    for (const row of trials) assert.deepEqual(row.frames[0].viewport, trials[0].frames[0].viewport, 'foreground viewport not matched');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, JSON.stringify({ mode: 'Windows source app via Playwright Electron (not a native Edge comparison)',
      privateMemory: 'Win32_PerfRawData_PerfProc_Process.WorkingSetPrivate', armOrder: ARM_ORDER, settleMs: SETTLE_MS,
      minSampleMs: SAMPLE_MS, backgrounds: BACKGROUNDS, trials }, null, 2) + '\n', { flag: 'wx' });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
