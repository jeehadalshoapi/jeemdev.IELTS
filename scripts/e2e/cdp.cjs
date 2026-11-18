// Browser check: drives headless Microsoft Edge through the Chrome DevTools Protocol (no npm dependencies).
//   node scripts/e2e/cdp.cjs <url> <steps file>
// Each step: { name, eval?: "JS run in the page (may await, may return a value)", wait?: ms, shot?: "file name",
//              viewport?: [w, h], offline?: true|false, saveTo?: path }
// Every run uses a NEW browser profile (= a separate device: no shared cookies or storage).
// Screenshots go to E2E_OUT (default .data/e2e-shots). Prints console errors at the end.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = path.resolve(process.env.E2E_OUT || '.data/e2e-shots');
const PAGE = process.argv[2];
const STEPS = require(path.resolve(process.argv[3]));
const PORT = 9333;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  if (!PAGE || !STEPS) { console.error('Usage: node scripts/e2e/cdp.cjs <url> <steps file>'); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ielts-e2e-'));
  const proc = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--window-size=1400,900', '--no-first-run', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
  let targets = [];
  for (let i = 0; i < 40; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.find(t => t.type === 'page')) break; } catch { }
    await sleep(250);
  }
  const target = targets.find(t => t.type === 'page');
  if (!target) { console.error('Could not start Edge with remote debugging'); proc.kill(); process.exit(1); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pending = {}; const errors = [];
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending[msg.id]) { pending[msg.id](msg); delete pending[msg.id]; }
    if (msg.method === 'Runtime.exceptionThrown') errors.push('EXCEPTION: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
    if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) errors.push('CONSOLE ' + msg.params.type + ': ' + msg.params.args.map(a => a.value ?? a.description).join(' '));
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push('LOG: ' + msg.params.entry.text);
  });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true, userGesture: true });
    if (!r.result) return 'EVAL INTERRUPTED (page navigated — split the step in two)';
    if (r.result.exceptionDetails) return 'EVAL ERROR: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result.result.value;
  };
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  const vp = (STEPS[0] && STEPS[0].viewport) || [1400, 900];
  await send('Emulation.setDeviceMetricsOverride', { width: vp[0], height: vp[1], deviceScaleFactor: 1, mobile: vp[0] < 600 });
  await send('Page.navigate', { url: PAGE });
  await sleep(1500);

  for (const step of STEPS) {
    if (step.offline !== undefined) { await send('Network.enable'); await send('Network.emulateNetworkConditions', { offline: step.offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); }
    if (step.viewport) await send('Emulation.setDeviceMetricsOverride', { width: step.viewport[0], height: step.viewport[1], deviceScaleFactor: 1, mobile: step.viewport[0] < 600 });
    if (step.eval) {
      const v = await evaluate(step.eval);
      if (step.saveTo && typeof v === 'string' && !v.startsWith('EVAL ERROR')) { fs.writeFileSync(step.saveTo, v); console.log(`[${step.name}] saved ${v.length} chars to ${step.saveTo}`); }
      else if (v !== undefined) console.log(`[${step.name}]`, typeof v === 'string' ? v : JSON.stringify(v));
    }
    await sleep(step.wait ?? 600);
    if (step.shot) {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, step.shot + '.png'), Buffer.from(r.result.data, 'base64'));
    }
  }
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors.');
  ws.close(); proc.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { }
  process.exit(0);
})();
