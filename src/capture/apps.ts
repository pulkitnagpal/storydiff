// Starts one version of the app from the spec's run line and stops it again, children included.
// Each app runs in its own process group, so `npm start` -> node, or `sh -c "a; b"`, all go down together.
import { spawn } from 'node:child_process';
import { answers } from './http.ts';
import type { Run } from './plan.ts';

export type App = {
  name: string;
  port: number;
  origin: string;
  pid: number;
  ready(timeoutMs: number): Promise<void>;
  alive(): boolean;
  settle(ms: number): Promise<void>;   // waits up to ms for the app to exit (after a dropped connection)
  stop(): Promise<void>;
  stopSync(): void;
  output(): string;
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function groupAlive(pid: number): boolean {
  try { process.kill(-pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}
function killGroup(pid: number, sig: NodeJS.Signals) {
  try { process.kill(-pid, sig); } catch { /* already gone */ }
}

// Values from the run line's env may be secrets. They never reach the console.
function masker(env: Record<string, string>) {
  const vals = Object.values(env).filter(v => v.length >= 4).sort((a, b) => b.length - a.length);
  return (s: string) => vals.reduce((acc, v) => acc.split(v).join('***'), s);
}

export function spawnApp(name: string, run: Run, cwd: string, port: number): App {
  const child = spawn('/bin/sh', ['-c', run.cmd], {
    cwd,
    env: { ...process.env, ...run.env, PORT: String(port) },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!child.pid) throw new Error(`could not start the ${name} app: ${run.cmd}`);
  const pid = child.pid, mask = masker(run.env);
  let out = '', exitCode: number | null | undefined, exitSignal: string | null = null;
  const keep = (b: Buffer) => { out = (out + b.toString()).slice(-16000); };
  child.stdout!.on('data', keep);
  child.stderr!.on('data', keep);
  child.on('error', e => { out += '\n' + e.message; exitCode = exitCode ?? -1; });
  const exited = new Promise<void>(r => child.on('exit', (code, sig) => { exitCode = code; exitSignal = sig; r(); }));
  const origin = `http://localhost:${port}`;
  const tail = () => { const t = mask(out).trim().split('\n').slice(-15).join('\n'); return t ? `\nLast output of the ${name} app:\n${t}` : ''; };

  const app: App = {
    name, port, origin, pid,
    output: () => mask(out),
    alive: () => exitCode === undefined,
    settle: ms => Promise.race([exited, sleep(ms)]).then(() => {}),
    async ready(timeoutMs) {
      const until = Date.now() + timeoutMs;
      while (Date.now() < until) {
        if (exitCode !== undefined) {
          throw new Error(`the ${name} app stopped (${exitSignal ? 'signal ' + exitSignal : 'exit code ' + exitCode}) before it answered on port ${port}: run "${run.cmd}" (spec line ${run.line})${tail()}`);
        }
        if (await answers(origin, 800)) return;
        await sleep(150);
      }
      let hint = '';
      if (run.port !== port && await answers(`http://localhost:${run.port}`, 500))
        hint = `\nSomething answers on port ${run.port}. Does the app read the PORT environment variable?`;
      throw new Error(`the ${name} app did not answer on port ${port} within ${Math.round(timeoutMs / 1000)} s: run "${run.cmd}" (spec line ${run.line})${hint}${tail()}`);
    },
    async stop() {
      if (!groupAlive(pid) && exitCode !== undefined) return;
      killGroup(pid, 'SIGTERM');
      for (let i = 0; i < 30 && groupAlive(pid); i++) await sleep(100);
      if (groupAlive(pid)) killGroup(pid, 'SIGKILL');
      for (let i = 0; i < 20 && groupAlive(pid); i++) await sleep(50);
      await Promise.race([exited, sleep(1000)]);
    },
    stopSync() { killGroup(pid, 'SIGKILL'); },
  };
  return app;
}
