// Headless Chromium over the DevTools protocol (Chrome, Brave, Edge or Chromium), no dependencies.
// Ported from poc/v3/shot.js. One browser per capture run; one tab per screenshot.
// core plans src/shot with the same measure() shape; when it lands, capture can import it instead.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type Rect = { sel: string; found: boolean; x?: number; y?: number; w?: number; h?: number };

const CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge', '/usr/bin/brave-browser', '/snap/bin/chromium',
];

// STORYDIFF_CHROME wins; when it is set but wrong that is an error, not a silent fallback.
export function findBrowser(): string | null {
  const own = process.env.STORYDIFF_CHROME;
  if (own) { if (!existsSync(own)) throw new Error(`STORYDIFF_CHROME points at ${own}, which does not exist`); return own; }
  return CANDIDATES.find(p => existsSync(p)) ?? null;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type Tab = {
  send(method: string, params?: object): Promise<any>;
  waitFor(pred: (m: { method: string; params: any }) => boolean, ms: number): Promise<boolean>;
  close(): void;
};

export type Browser = {
  capture(url: string, o: { width: number; height: number; selectors?: string[]; out?: string; snapshot?: boolean; settleMs?: number }): Promise<{ rects: Rect[]; snapshot?: string[] }>;
  close(): Promise<void>;
  closeSync(): void;
};

export async function launchBrowser(bin: string): Promise<Browser> {
  const profile = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'storydiff-chrome-')));
  const proc: ChildProcess = spawn(bin, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    '--disable-extensions', '--disable-background-networking', '--disable-sync', '--mute-audio', '--force-color-profile=srgb',
    '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore', detached: true });
  let exited = false;
  const gone = new Promise<void>(r => proc.on('exit', () => { exited = true; r(); }));
  proc.on('error', () => { exited = true; });
  const kill = (sig: NodeJS.Signals) => { try { process.kill(-proc.pid!, sig); } catch { try { proc.kill(sig); } catch { /* gone */ } } };
  const closeSync = () => { kill('SIGKILL'); try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ } };
  const close = async () => {
    if (!exited) { kill('SIGTERM'); await Promise.race([gone, sleep(3000)]); if (!exited) { kill('SIGKILL'); await Promise.race([gone, sleep(1000)]); } }
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
  };

  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !existsSync(portFile) && !exited; i++) await sleep(100);
  if (!existsSync(portFile)) { closeSync(); throw new Error(`the browser did not start (${bin})`); }
  await sleep(100);
  const port = readFileSync(portFile, 'utf8').split('\n')[0].trim();

  async function tab(): Promise<Tab> {
    const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json() as { id: string; webSocketDebuggerUrl: string };
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('could not talk to the browser')); });
    let id = 0;
    const wait = new Map<number, (d: any) => void>(), events: { method: string; params: any }[] = [];
    ws.onmessage = m => {
      const d = JSON.parse(String(m.data));
      if (d.id && wait.has(d.id)) { wait.get(d.id)!(d); wait.delete(d.id); } else if (d.method) events.push(d);
    };
    return {
      send: (method, params = {}) => new Promise((res, rej) => {
        const k = ++id;
        const timer = setTimeout(() => { wait.delete(k); rej(new Error(`browser: ${method} timed out`)); }, 20000);
        wait.set(k, d => { clearTimeout(timer); d.error ? rej(new Error(`browser: ${method}: ${d.error.message}`)) : res(d.result); });
        ws.send(JSON.stringify({ id: k, method, params }));
      }),
      async waitFor(pred, ms) {
        const until = Date.now() + ms;
        while (Date.now() < until) { if (events.some(pred)) return true; await sleep(50); }
        return false;
      },
      close: () => { try { ws.close(); } catch { /* closed */ } fetch(`http://127.0.0.1:${port}/json/close/${t.id}`).catch(() => {}); },
    };
  }

  return {
    closeSync, close,
    async capture(url, o) {
      const p = await tab();
      try {
        await p.send('Page.enable');
        await p.send('Page.setLifecycleEventsEnabled', { enabled: true });
        await p.send('Emulation.setDeviceMetricsOverride', { width: o.width, height: o.height, deviceScaleFactor: 2, mobile: false });
        const nav = await p.send('Page.navigate', { url });
        if (nav.errorText) throw new Error(`the browser could not open ${url}: ${nav.errorText}`);
        await p.waitFor(e => e.method === 'Page.loadEventFired', 10000);
        // Pages often fetch their data after load; wait until the network is quiet.
        await p.waitFor(e => e.method === 'Page.lifecycleEvent' && e.params.name === 'networkIdle', 5000);
        await sleep(o.settleMs ?? 300);
        const sels = o.selectors ?? [];
        const rects = sels.length ? JSON.parse((await p.send('Runtime.evaluate', { expression: MEASURE(sels), returnByValue: true })).result.value) as Rect[] : [];
        const snapshot = o.snapshot ? JSON.parse((await p.send('Runtime.evaluate', { expression: SNAPSHOT, returnByValue: true })).result.value) as string[] : undefined;
        if (o.out) {
          const shot = await p.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: o.width, height: o.height, scale: 1 } });
          writeFileSync(o.out, Buffer.from(shot.data, 'base64'));
        }
        return { rects, snapshot };
      } finally { p.close(); }
    },
  };
}

// Where each pinned element is, in CSS px of the viewport. `page` is the whole screen.
const MEASURE = (sels: string[]) => `JSON.stringify(${JSON.stringify(sels)}.map(s => {
  if (s === 'page') return { sel: s, found: true, x: 0, y: 0, w: innerWidth, h: innerHeight };
  let e = null; try { e = document.querySelector(s); } catch {}
  if (!e) return { sel: s, found: false };
  const r = e.getBoundingClientRect();
  if (!r.width && !r.height) return { sel: s, found: false };
  const k = v => Math.round(v * 10) / 10;
  return { sel: s, found: true, x: k(r.left), y: k(r.top), w: k(r.width), h: k(r.height) };
}))`;

// What a person sees, one line per visible element: tag, rounded box, own text (and form values).
const SNAPSHOT = `JSON.stringify((() => {
  const out = [];
  const walk = (el, depth) => {
    if (out.length > 3000) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return;
    const r = el.getBoundingClientRect();
    let own = '';
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent;
    own = own.replace(/\\s+/g, ' ').trim();
    if (el.placeholder) own += ' [placeholder ' + el.placeholder + ']';
    if ('value' in el && typeof el.value === 'string' && el.tagName !== 'BUTTON' && el.tagName !== 'LI' && el.value) own += ' [value ' + el.value + ']';
    if (el.tagName === 'IMG') own += ' [img ' + (el.alt || '') + ']';
    if (r.width || r.height) out.push('  '.repeat(depth) + el.tagName.toLowerCase() + ' ' + [r.left, r.top, r.width, r.height].map(Math.round).join(',') + (own ? ' ' + own : ''));
    for (const c of el.children) walk(c, depth + 1);
  };
  walk(document.body, 0);
  return out;
})())`;
