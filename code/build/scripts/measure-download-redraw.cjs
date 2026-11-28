'use strict';

// Real Electron UI measurement. A local fixture sends one chunk per observed
// progress event; no throughput/latency claim is made from that pacing.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { setTimeout: pause } = require('node:timers/promises');
const { launchDexerion } = require('../e2e/app');

const historyCount = 150;
const stepSize = 16384;
const chunkCount = 10; // Each byte chunk is one exact 10% Electron progress increment.

function seedProfile(profile) {
  const dir = path.join(profile, 'fixture-downloads');
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ downloadDir: dir }));
  fs.writeFileSync(path.join(profile, 'downloads.json'), JSON.stringify(Array.from({ length: historyCount }, (_, i) => ({
    id: 'item-' + i, fileName: 'finished-' + i + '.txt', path: path.join(dir, 'finished-' + i + '.txt'),
    received: 8192, total: 8192, percent: 1, state: 'completed', active: false, at: Date.now() - i,
  }))));
}
async function wait(check, label) {
  const deadline = Date.now() + 15000;
  do {
    if (await check()) return;
    await pause(75);
  } while (Date.now() < deadline);
  throw new Error(label + ' did not appear');
}

async function measure(buildDir) {
  let response, launch;
  const server = http.createServer((req, res) => {
    if (req.url !== '/transfer') { res.writeHead(404).end(); return; }
    response = res;
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="benchmark-progress.bin"',
      'Content-Length': chunkCount * stepSize,
    });
    res.write(Buffer.alloc(stepSize));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    launch = await launchDexerion({ seedProfile, buildDir, attempts: 2 });
    const { app, win } = launch;
    const url = 'http://127.0.0.1:' + server.address().port + '/transfer';
    await win.evaluate((u) => window.dexerion.invoke('dex:new-tab', u, false), url);
    await wait(() => Boolean(response), 'benchmark response');
    const onDownloads = (expression) => app.evaluate(async ({ webContents }, value) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL() === 'dexerion://downloads');
      return wc ? wc.executeJavaScript(value).catch(() => null) : null;
    }, expression);
    const rows = () => onDownloads("document.querySelectorAll('.dl-row').length");
    await wait(async () => await rows() === historyCount + 1, 'settled and live download rows');
    assert.equal(await onDownloads("document.querySelector('.dl-title')?.textContent"), 'benchmark-progress.bin');
    assert.equal(await onDownloads("document.querySelector('.dl-row .st')?.textContent"), 'Downloading');
    await onDownloads(`(() => {
      const root = document.getElementById('list');
      let rowsAdded = 0;
      const count = (records) => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node.classList?.contains('dl-row')) rowsAdded++;
        }
      };
      const observer = new MutationObserver(count);
      observer.observe(root, { childList: true });
      window.__dexDownloadMeasuredRows = () => { count(observer.takeRecords()); return rowsAdded; };
      return true;
    })()`);
    for (let i = 2; i < chunkCount; i++) {
      response.write(Buffer.alloc(stepSize));
      const percent = Math.round(i * 100 / chunkCount) + '%';
      await wait(async () => await onDownloads("document.querySelector('.dl-percent')?.textContent") === percent, 'transfer at ' + percent);
    }
    const rowAdds = await onDownloads('window.__dexDownloadMeasuredRows()');
    assert(Number.isInteger(rowAdds) && rowAdds > 0, 'Expected real progress mutations');
    assert.equal(await rows(), historyCount + 1);
    response.end(Buffer.alloc(stepSize));
    await wait(async () => await onDownloads("document.querySelector('.dl-row .st')?.textContent") === 'Complete', 'transfer completion');
    return { rowAdds };
  } finally {
    if (response && !response.writableEnded) response.destroy();
    if (launch) {
      await launch.app.close().catch(() => {});
      fs.rmSync(launch.profile, { force: true, recursive: true, maxRetries: 5, retryDelay: 300 });
    }
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

(async () => {
  const ref = process.env.DEX_DOWNLOAD_REFERENCE_BUILD;
  if (!ref) throw new Error('Missing beta reference build');
  const n = 3, arms = { reference: [], candidate: [] };
  for (let trial = 0; trial < n; trial++) {
    for (const arm of trial % 2 ? ['candidate', 'reference'] : ['reference', 'candidate']) {
      arms[arm].push(await measure(arm === 'reference' ? path.resolve(ref) : undefined));
    }
  }
  const medians = Object.fromEntries(Object.entries(arms).map(([arm, data]) => [
    arm, data.map((d) => d.rowAdds).sort((a, b) => a - b)[Math.floor(data.length / 2)],
  ]));
  const output = { historyCount, measuredProgressUpdates: chunkCount - 2, n, medians, arms };
  console.log('PAIRED NATIVE DOWNLOAD ROWS ' + JSON.stringify(output));
  fs.writeFileSync('cloud-download-redraw.json', JSON.stringify(output, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
