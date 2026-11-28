'use strict';
// Identical-workload energy benchmark: Microsoft Edge vs Dexerion.
//
// Real energy, not a CPU percentage proxy: Windows RAPL "Energy Meter" package
// power is sampled once per second while each browser runs the *same* local
// HTML workload in throwaway profiles. A no-browser idle sample is subtracted
// so the reported number is browser-attributable package power. The harness
// never touches either browser's real profile.
//
// Scenarios: idle page, animated browsing/video proxy, eight animated
// background tabs, and multitasking (animated active tab + eight background).
// Results are honest measurements of this machine, not a guarantee that every
// device will show the same delta.

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('@playwright/test');
const { launchDexerion } = require('../e2e/app');

const OUT = process.env.POWER_BENCH_OUT
  || 'C:\\Users\\Darre\\AppData\\Local\\Temp\\opencode\\power-benchmark.json';
const SAMPLE_SEC = Math.max(4, Number(process.env.POWER_SAMPLE_SEC) || 15);
const FLOOR_SEC = Math.max(3, Number(process.env.POWER_FLOOR_SEC) || 5);
const SETTLE_MS = 8000;
const BG_TABS = Math.max(1, Number(process.env.POWER_BG_TABS) || 8);
const PS_SCRIPT = path.join(__dirname, 'power-sample.ps1');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (v, d = 2) => Number(Number(v).toFixed(d));

const STATIC_HTML = `<!doctype html><meta charset="utf-8"><title>Dexerion power probe - idle</title>
<body style="margin:0;background:#f6f6f4;font:16px system-ui;color:#222"><h1>Power probe</h1><p>Idle page</p></body>`;

const ANIMATED_HTML = `<!doctype html><meta charset="utf-8"><title>Dexerion power probe - animated</title>
<body style="margin:0;background:#101018;overflow:hidden">
<canvas id="c" width="960" height="640"></canvas>
<script>
(function () {
  const c = document.getElementById('c'), x = c.getContext('2d');
  let f = 0;
  function frame() {
    f += 1;
    x.fillStyle = '#101018'; x.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < 28; i += 1) {
      const a = (f / 30 + i / 28) * Math.PI * 2;
      x.fillStyle = 'hsl(' + ((i * 13 + f / 4) % 360) + ' 80% 55%)';
      x.beginPath();
      x.arc(480 + Math.cos(a) * 300, 320 + Math.sin(a * 1.7) * 180, 8 + (i % 5) * 3, 0, Math.PI * 2);
      x.fill();
    }
    if (f % 30 === 0) document.title = 'Power probe frame ' + f;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  setInterval(function () { document.body.style.background = (f % 2) ? '#101018' : '#14141f'; }, 250);
})();
</script></body>`;

function startServer() {
  const server = http.createServer((req, res) => {
    const animated = /animated/.test(req.url || '');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(animated ? ANIMATED_HTML : STATIC_HTML);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ server, base: 'http://127.0.0.1:' + server.address().port });
  }));
}

function samplePower(label, seconds) {
  const secs = Number(seconds) || SAMPLE_SEC;
  const out = path.join(os.tmpdir(), 'dex-power-' + process.pid + '-' + label + '.json');
  const stdout = execFileSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS_SCRIPT,
    '-DurationSec', String(secs), '-OutFile', out,
  ], { encoding: 'utf8', timeout: (secs + 30) * 1000 });
  try { return JSON.parse(fs.readFileSync(out, 'utf8')); }
  catch { return JSON.parse(String(stdout).trim()); }
}

async function prepareEdge(base, scenario) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-power-edge-'));
  const context = await chromium.launchPersistentContext(dir, {
    channel: 'msedge', headless: false,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-background-networking'],
  });
  const animated = scenario !== 'idle' && scenario !== 'background';
  const pages = [];
  const first = context.pages()[0] || await context.newPage();
  await first.goto(base + (animated ? '/animated' : '/static'), { waitUntil: 'domcontentloaded' });
  pages.push(first);
  if (scenario === 'background' || scenario === 'multitasking') {
    for (let i = 0; i < BG_TABS; i += 1) {
      const p = await context.newPage();
      await p.goto(base + '/animated', { waitUntil: 'domcontentloaded' });
      pages.push(p);
    }
    if (scenario === 'background') {
      // The active tab is static; the animated tabs stay in the background.
      const quiet = await context.newPage();
      await quiet.goto(base + '/static', { waitUntil: 'domcontentloaded' });
      pages.push(quiet);
      await quiet.bringToFront();
    } else {
      await first.bringToFront();
    }
  }
  return {
    close: async () => { try { await context.close(); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} },
  };
}

async function prepareDexerion(base, scenario) {
  const launched = await launchDexerion({ attempts: 2, gpu: 'adaptive' });
  const { win } = launched;
  const open = async (url, background) => {
    await win.evaluate(({ u, b }) => window.dexerion.invoke('dex:new-tab', u, b), { u: url, b: background });
  };
  const animated = scenario !== 'idle' && scenario !== 'background';
  if (scenario === 'background' || scenario === 'multitasking') {
    // First tab is the quiet active page; all probes after it are background.
    await open(base + (scenario === 'background' ? '/static' : '/animated'), false);
    for (let i = 0; i < BG_TABS; i += 1) await open(base + '/animated', true);
  } else {
    await open(base + (animated ? '/animated' : '/static'), false);
  }
  // Wait until the newly opened tabs have stopped loading.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const st = await win.evaluate(() => window.dexerion.invoke('dex:get-state'));
    const tabs = (st && st.tabs) || [];
    if (tabs.length >= (scenario === 'background' || scenario === 'multitasking' ? BG_TABS + 1 : 1)
        && !tabs.some((t) => t.loading)) break;
    await win.waitForTimeout(150);
  }
  return {
    close: async () => { try { await launched.app.close(); } catch {} },
  };
}

const SCENARIOS = ['idle', 'browsing', 'video', 'background', 'multitasking'];
// Subset support for tight A/B sessions: POWER_SCENARIOS="background" runs a
// single scenario so a baseline-vs-optimised pair fits inside one quiet
// machine window (floor drift over 3 minutes is far smaller than over 10).
const SELECTED = (process.env.POWER_SCENARIOS || '')
  .split(',').map((s) => s.trim()).filter((s) => SCENARIOS.includes(s));
const RUN_SCENARIOS = SELECTED.length ? SELECTED : SCENARIOS;
const medianOf = (arr) => {
  const s = [...arr].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

(async () => {
  const { server, base } = await startServer();
  const results = {
    generatedAt: new Date().toISOString(), sampleSec: SAMPLE_SEC, floorSec: FLOOR_SEC,
    backgroundTabs: BG_TABS, scenarios: {}, errors: [],
  };
  // Paired-floor protocol: the machine's power floor drifts by thousands of
  // milliwatts between minutes on a busy desktop, so one global idle sample
  // cannot serve as the baseline for a 10-minute matrix. Instead each
  // workload sample gets its own floor sample taken seconds earlier, with no
  // browser running — attribution is then local in time and immune to drift.
  try {
    for (const scenario of RUN_SCENARIOS) {
      results.scenarios[scenario] = {};
      for (const browser of ['edge', 'dexerion']) {
        console.log('=== ' + browser + ' / ' + scenario + ' ===');
        let session = null;
        try {
          await sleep(2000); // let the previous browser's processes exit
          const floor = samplePower(browser + '-' + scenario + '-floor', FLOOR_SEC);
          session = browser === 'edge'
            ? await prepareEdge(base, scenario)
            : await prepareDexerion(base, scenario);
          await sleep(SETTLE_MS);
          const power = samplePower(browser + '-' + scenario, SAMPLE_SEC);
          const floorMedian = medianOf(floor.samplesMW);
          const spread = round(power.p90MW - power.p10MW, 0);
          const attributable = round(power.medianMW - floorMedian, 1);
          results.scenarios[scenario][browser] = {
            floorMedianMW: floorMedian, floorP90: floor.p90MW,
            meanMW: power.meanMW, medianMW: power.medianMW,
            p10MW: power.p10MW, p90MW: power.p90MW,
            attributableMW: attributable, spreadMW: spread,
            noiseLimited: spread > Math.max(attributable, 150),
            sampleCount: power.sampleCount,
          };
          console.log(browser + ': median ' + power.medianMW + ' mW vs floor ' + floorMedian
            + ' mW -> attributable ' + attributable + ' mW (spread ' + spread + ')');
        } catch (err) {
          const msg = String(err && err.message || err);
          results.errors.push(browser + '/' + scenario + ': ' + msg);
          console.error(browser + '/' + scenario + ' ERROR: ' + msg);
        } finally {
          if (session) await session.close();
        }
      }
      const pair = results.scenarios[scenario];
      if (pair.edge && pair.dexerion && pair.edge.attributableMW > 0) {
        pair.reductionVsEdgePct = round((pair.edge.attributableMW - pair.dexerion.attributableMW) / pair.edge.attributableMW * 100, 1);
        console.log(scenario + ' reduction vs Edge: ' + pair.reductionVsEdgePct + '%');
      }
    }
    const pairs = RUN_SCENARIOS.map((s) => results.scenarios[s]).filter((p) => Number.isFinite(p.reductionVsEdgePct));
    results.meanReductionVsEdgePct = pairs.length
      ? round(pairs.reduce((a, p) => a + p.reductionVsEdgePct, 0) / pairs.length, 1) : null;
    results.method = 'Windows RAPL Energy Meter package power (mW), 1 Hz, first sample discarded. Paired floors: each workload median minus the median of a no-browser floor sample taken immediately before it. Identical local HTML workloads in throwaway profiles. noiseLimited=true when within-sample spread exceeds the attributable value.';
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(results, null, 2), 'utf8');
    console.log('POWER BENCHMARK EVIDENCE: ' + OUT);
    console.log('POWER BENCHMARK MEAN REDUCTION: ' + results.meanReductionVsEdgePct + '%');
  } finally {
    server.close();
  }
})().catch((err) => {
  console.error('POWER BENCHMARK ERROR: ' + (err && err.stack || err));
  process.exitCode = 1;
});
