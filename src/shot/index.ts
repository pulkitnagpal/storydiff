// Headless screenshots over the Chrome DevTools protocol. Works with any Chromium: Chrome, Brave, Edge, Chromium.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Rect } from '../render/types.ts';

const CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
];

/** The browser to drive: STORYDIFF_CHROME, else the first Chromium found. */
export function findBrowser(): string | null {
  const env = process.env.STORYDIFF_CHROME;
  if (env) return existsSync(env) ? env : null;
  return CANDIDATES.find((p) => existsSync(p)) ?? null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const bin = findBrowser();
  if (!bin) throw new Error('No Chromium browser found (Chrome, Brave, Edge or Chromium). Set STORYDIFF_CHROME to its path.');
  const profile = mkdtempSync(join(tmpdir(), 'sd-chrome-'));
  const proc = spawn(bin, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) { proc.kill(); throw new Error('the browser did not start'); }
  await sleep(150);
  const port = readFileSync(portFile, 'utf8').split('\n')[0].trim();
  const close = () => {
    try { proc.kill(); } catch { /* already gone */ }
    setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500).unref();
  };
  return { port, close };
}

async function open(port: string) {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json() as { webSocketDebuggerUrl: string };
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const wait = new Map<number, (d: { error?: { message: string }; result: unknown }) => void>();
  const events: string[] = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(String(m.data));
    if (d.id && wait.has(d.id)) { wait.get(d.id)!(d); wait.delete(d.id); } else if (d.method) events.push(d.method);
  };
  const send = <T = any>(method: string, params: object = {}) => new Promise<T>((res, rej) => {
    const k = ++id;
    wait.set(k, (d) => (d.error ? rej(new Error(`${method}: ${d.error.message}`)) : res(d.result as T)));
    ws.send(JSON.stringify({ id: k, method, params }));
  });
  return { send, events, close: () => ws.close() };
}

interface Opts { width: number; height?: number; fullPage?: boolean; settleMs?: number }

async function withPage<T>(url: string, o: Opts, fn: (p: Awaited<ReturnType<typeof open>>) => Promise<T>): Promise<T> {
  const b = await launch();
  try {
    const p = await open(b.port);
    await p.send('Page.enable');
    await p.send('Emulation.setDeviceMetricsOverride', { width: o.width, height: o.height ?? 800, deviceScaleFactor: 2, mobile: false });
    await p.send('Page.navigate', { url });
    for (let i = 0; i < 100 && !p.events.includes('Page.loadEventFired'); i++) await sleep(100);
    await p.send('Runtime.evaluate', { expression: 'document.fonts && document.fonts.ready.then(() => 1)', awaitPromise: true, returnByValue: true }).catch(() => null);
    await sleep(o.settleMs ?? 300);
    if (o.fullPage) {
      const r = await p.send<{ result: { value: number } }>('Runtime.evaluate', { expression: 'Math.ceil(document.documentElement.scrollHeight)', returnByValue: true });
      await p.send('Emulation.setDeviceMetricsOverride', { width: o.width, height: r.result.value, deviceScaleFactor: 2, mobile: false });
      await sleep(100);
    }
    const out = await fn(p);
    p.close();
    return out;
  } finally { b.close(); }
}

async function grab(p: Awaited<ReturnType<typeof open>>, out: string) {
  const shot = await p.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
}

/** A PNG of the page at 2x. fullPage grows the viewport to the page's height. */
export async function screenshot(url: string, out: string, opts: Opts): Promise<void> {
  await withPage(url, opts, (p) => grab(p, out));
}

/** A PNG of the page plus where each selector landed, in CSS px. 'page' is the whole viewport. */
export async function measure(url: string, out: string, opts: Opts & { selectors: string[] }): Promise<Rect[]> {
  const expr = `JSON.stringify(${JSON.stringify(opts.selectors)}.map(s => {
    if (s === 'page') return { sel: s, found: true, x: 0, y: 0, w: innerWidth, h: innerHeight };
    let e = null; try { e = document.querySelector(s); } catch {}
    if (!e) return { sel: s, found: false };
    const r = e.getBoundingClientRect();
    return { sel: s, found: true, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  }))`;
  return withPage(url, opts, async (p) => {
    const r = await p.send<{ result: { value: string } }>('Runtime.evaluate', { expression: expr, returnByValue: true });
    await grab(p, out);
    return JSON.parse(r.result.value) as Rect[];
  });
}
