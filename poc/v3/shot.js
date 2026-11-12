// Headless screenshots over the Chrome DevTools protocol (works with any Chromium: Chrome, Brave, Edge).
// shoot(url, out, { width, height, pins: [{ n, sel, tone }] }) -> { pins: [{ n, found, x, y, w, h }] }
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');

const CANDIDATES = [
  process.env.STORYDIFF_CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);

function findBrowser() { const b = CANDIDATES.find(p => fs.existsSync(p)); if (!b) throw new Error('No Chromium browser found. Set STORYDIFF_CHROME.'); return b; }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-chrome-'));
  const proc = spawn(findBrowser(), ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
  if (!fs.existsSync(portFile)) { proc.kill(); throw new Error('browser did not start'); }
  await sleep(150);
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
  return { port, close: () => { try { proc.kill(); } catch {} setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 500); } };
}

async function page(port) {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const wait = {}, events = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && wait[d.id]) { wait[d.id](d); delete wait[d.id]; } else if (d.method) events.push(d.method); };
  const send = (method, params = {}) => new Promise((res, rej) => { const k = ++id; wait[k] = d => d.error ? rej(new Error(method + ': ' + d.error.message)) : res(d.result); ws.send(JSON.stringify({ id: k, method, params })); });
  return { send, events, close: () => ws.close() };
}

// Draws numbered pins on the matching elements, then returns where they landed.
const PIN_SCRIPT = pins => `(() => {
  const out = [];
  for (const p of ${JSON.stringify(pins)}) {
    const el = p.sel === 'page' ? document.body : document.querySelector(p.sel);
    if (!el) { out.push({ n: p.n, found: false }); continue; }
    const r = el.getBoundingClientRect(), col = p.tone === 'watch' ? '#C2410C' : '#0F766E';
    if (p.sel === 'page') {
      const f = document.createElement('div'); f.style.cssText = 'position:fixed;inset:6px;border:3px dashed ' + col + ';border-radius:12px;pointer-events:none;z-index:99998';
      document.body.appendChild(f);
    } else {
      const o = document.createElement('div'); o.style.cssText = 'position:absolute;left:' + (r.left + scrollX - 4) + 'px;top:' + (r.top + scrollY - 4) + 'px;width:' + (r.width + 8) + 'px;height:' + (r.height + 8) + 'px;border:2.5px solid ' + col + ';border-radius:8px;pointer-events:none;z-index:99998';
      document.body.appendChild(o);
    }
    const b = document.createElement('div');
    const bx = p.sel === 'page' ? innerWidth - 40 : Math.min(innerWidth - 32, r.right + scrollX - 6), by = p.sel === 'page' ? 14 : Math.max(4, r.top + scrollY - 16);
    b.textContent = p.n; b.style.cssText = 'position:absolute;left:' + bx + 'px;top:' + by + 'px;width:26px;height:26px;border-radius:999px;background:' + col + ';color:#fff;font:700 14px system-ui,sans-serif;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 3px #fff;z-index:99999';
    document.body.appendChild(b);
    out.push({ n: p.n, found: true, x: r.left, y: r.top, w: r.width, h: r.height });
  }
  return JSON.stringify(out);
})()`;

async function shoot(url, out, opts = {}) {
  const b = await launch();
  try {
    const p = await page(b.port);
    await p.send('Page.enable');
    await p.send('Emulation.setDeviceMetricsOverride', { width: opts.width || 900, height: opts.height || 600, deviceScaleFactor: 2, mobile: false });
    await p.send('Page.navigate', { url });
    for (let i = 0; i < 80 && !p.events.includes('Page.loadEventFired'); i++) await sleep(100);
    await sleep(opts.settle || 500);
    let pins = [];
    if (opts.pins && opts.pins.length) pins = JSON.parse((await p.send('Runtime.evaluate', { expression: PIN_SCRIPT(opts.pins), returnByValue: true })).result.value);
    const shot = await p.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    p.close();
    return { pins };
  } finally { b.close(); }
}
// Only measures where pinned elements are; the card draws the numbers itself.
const MEASURE = sels => `JSON.stringify(${JSON.stringify(sels)}.map(s => { if (s === 'page') return { sel: s, found: true, x: 0, y: 0, w: innerWidth, h: innerHeight }; const e = document.querySelector(s); if (!e) return { sel: s, found: false }; const r = e.getBoundingClientRect(); return { sel: s, found: true, x: r.left, y: r.top, w: r.width, h: r.height }; }))`;
async function capture(url, out, opts = {}) {
  const b = await launch();
  try {
    const p = await page(b.port);
    await p.send('Page.enable');
    await p.send('Emulation.setDeviceMetricsOverride', { width: opts.width, height: opts.height, deviceScaleFactor: 2, mobile: false });
    await p.send('Page.navigate', { url });
    for (let i = 0; i < 80 && !p.events.includes('Page.loadEventFired'); i++) await sleep(100);
    await sleep(opts.settle || 500);
    const rects = JSON.parse((await p.send('Runtime.evaluate', { expression: MEASURE(opts.measure || []), returnByValue: true })).result.value);
    const shot = await p.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    p.close();
    return rects;
  } finally { b.close(); }
}
module.exports = { shoot, capture };

