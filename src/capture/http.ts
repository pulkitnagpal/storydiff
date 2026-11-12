// One request to a running version. A reply that is not JSON keeps its text.
import { createServer } from 'node:net';
import type { Req } from './plan.ts';

export type Reply = { status: number; json: unknown; text?: string; ms: number };

export async function send(origin: string, req: Pick<Req, 'method' | 'path' | 'body'>, timeoutMs = 15000): Promise<Reply> {
  const t0 = performance.now();
  const init: RequestInit = { method: req.method, signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' };
  if (req.body !== undefined) { init.body = JSON.stringify(req.body); init.headers = { 'content-type': 'application/json' }; }
  let res: Response;
  try { res = await fetch(origin + req.path, init); }
  catch (e) {
    const why = (e as { cause?: { code?: string } }).cause?.code || (e as Error).name || 'no reply';
    throw new Error(`${req.method} ${req.path} got no reply (${why})`);
  }
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  if (!text) return { status: res.status, json: null, ms };
  try { return { status: res.status, json: JSON.parse(text), ms }; }
  catch { return { status: res.status, json: null, text: text.length > 4000 ? text.slice(0, 4000) + '…' : text, ms }; }
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      s.close(() => (a && typeof a === 'object' ? resolve(a.port) : reject(new Error('no free port'))));
    });
  });
}

// True when anything answers HTTP on the port, whatever the status.
export async function answers(origin: string, timeoutMs = 1000): Promise<boolean> {
  try { await (await fetch(origin + '/', { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' })).arrayBuffer(); return true; }
  catch { return false; }
}
