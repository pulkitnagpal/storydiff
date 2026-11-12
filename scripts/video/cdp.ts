// A small Chrome DevTools client for staging film assets: transparent backgrounds, clipped shots, scripts in the page.
// (src/shot keeps the product's own capture simple; the film needs a little more.)
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findBrowser } from '../../src/shot/index.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Tab {
  eval<T = unknown>(expr: string): Promise<T>;
  /** PNG of the page (or of a CSS-px clip of it) at the tab's scale. */
  shot(clip?: { x: number; y: number; width: number; height: number }): Promise<Buffer>;
  resize(width: number, height: number): Promise<void>;
}

export async function withBrowser<T>(fn: (open: (url: string, o: { width: number; height: number; scale?: number; transparent?: boolean }) => Promise<Tab>) => Promise<T>): Promise<T> {
  const bin = findBrowser();
  if (!bin) throw new Error('No Chromium browser found. Set STORYDIFF_CHROME.');
  const profile = mkdtempSync(join(tmpdir(), 'sd-film-chrome-'));
  const proc = spawn(bin, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  try {
    const portFile = join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 150 && !existsSync(portFile); i++) await sleep(100);
    if (!existsSync(portFile)) throw new Error('the browser did not start');
    await sleep(150);
    const port = readFileSync(portFile, 'utf8').split('\n')[0].trim();
    const sockets: WebSocket[] = [];
    const open = async (url: string, o: { width: number; height: number; scale?: number; transparent?: boolean }): Promise<Tab> => {
      const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json() as { webSocketDebuggerUrl: string };
      const ws = new WebSocket(target.webSocketDebuggerUrl);
      sockets.push(ws);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      let id = 0;
      const wait = new Map<number, (d: { error?: { message: string }; result: any }) => void>();
      const events: string[] = [];
      ws.onmessage = (m) => {
        const d = JSON.parse(String(m.data));
        if (d.id && wait.has(d.id)) { wait.get(d.id)!(d); wait.delete(d.id); } else if (d.method) events.push(d.method);
      };
      const send = (method: string, params: object = {}) => new Promise<any>((res, rej) => {
        const k = ++id;
        wait.set(k, (d) => (d.error ? rej(new Error(`${method}: ${d.error.message}`)) : res(d.result)));
        ws.send(JSON.stringify({ id: k, method, params }));
      });
      const scale = o.scale ?? 2;
      const resize = (width: number, height: number) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
      await send('Page.enable');
      await resize(o.width, o.height);
      if (o.transparent) await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
      await send('Page.navigate', { url });
      for (let i = 0; i < 100 && !events.includes('Page.loadEventFired'); i++) await sleep(100);
      await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => 1)', awaitPromise: true, returnByValue: true });
      await sleep(400);
      return {
        resize,
        async eval<T>(expr: string) {
          const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
          if (r.exceptionDetails) throw new Error('page script: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
          return r.result.value as T;
        },
        async shot(clip) {
          const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
          return Buffer.from(r.data, 'base64');
        },
      };
    };
    return await fn(open);
  } finally {
    try { proc.kill(); } catch { /* gone */ }
    setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500).unref();
  }
}
