// show terminal "cmd": runs a command in one version's checkout (no TTY, a time limit) and keeps the
// last lines of what it printed, ANSI stripped and secrets redacted. A PTY with keys is v1.1.
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';

export type TerminalSide = { exit: number | null; lines: string[]; total: number; timedOut?: true; signal?: string };

export type RunOpts = {
  cwd: string;
  env: Record<string, string | undefined>;
  timeoutMs: number;
  keep?: number;                              // how many trailing lines to keep (40)
  redact: (s: string) => string;
  track?: (pid: number, done: boolean) => void;   // lets the caller kill it on Ctrl-C
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const MAX_BYTES = 4 * 1024 * 1024;

export function runCommand(cmd: string, o: RunOpts): Promise<TerminalSide> {
  return new Promise(resolve => {
    const child = spawn('/bin/sh', ['-c', cmd], {
      cwd: o.cwd,
      env: { ...o.env, NO_COLOR: '1', FORCE_COLOR: '0', TERM: 'dumb', CI: '1' },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const pid = child.pid!;
    o.track?.(pid, false);
    let out = '', bytes = 0, timedOut = false;
    // stdout and stderr in the order they arrive, as a terminal would show them.
    const keep = (b: Buffer) => { bytes += b.length; out += b.toString(); if (out.length > MAX_BYTES) out = out.slice(-MAX_BYTES); };
    child.stdout!.on('data', keep);
    child.stderr!.on('data', keep);
    const kill = (sig: NodeJS.Signals) => { try { process.kill(-pid, sig); } catch { /* gone */ } };
    const timer = setTimeout(async () => {
      timedOut = true;
      kill('SIGTERM');
      await sleep(1000);
      kill('SIGKILL');
    }, o.timeoutMs);
    child.on('error', e => { out += '\n' + e.message; });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      kill('SIGKILL');   // anything it left running in its group
      o.track?.(pid, true);
      const all = toLines(out).map(o.redact);
      const side: TerminalSide = { exit: code, lines: all.slice(-(o.keep ?? 40)), total: all.length };
      if (timedOut) side.timedOut = true;
      if (signal && !timedOut) side.signal = signal;
      resolve(side);
    });
  });
}

// What a terminal would end up showing: colours and cursor moves gone, \r overwrites the line.
export function toLines(s: string): string[] {
  const clean = s
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')            // OSC (titles, links)
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')                    // CSI (colours, cursor)
    .replace(/\x1b[@-Z\\-_]/g, '')                               // other escapes
    .replace(/\r\n/g, '\n');
  const lines = clean.split('\n').map(l => {
    const parts = l.split('\r');
    return parts[parts.length - 1] === '' && parts.length > 1 ? parts[parts.length - 2] : parts[parts.length - 1];
  }).map(l => l.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').replace(/\s+$/, ''));
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

const TOKENS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  /\bsk-(ant-|proj-|live_|test_)?[A-Za-z0-9_-]{16,}\b/g,
  /\b(rk|pk)_(live|test)_[A-Za-z0-9]{16,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\bnpm_[A-Za-z0-9]{30,}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,   // JWT
];
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]{8,}/g;
const NAMED = /\b([A-Za-z0-9_.-]*(?:token|secret|passw(?:or)?d|pwd|api[_-]?key|access[_-]?key|private[_-]?key|auth|credential)[A-Za-z0-9_.-]*)(\s*[=:]\s*|"\s*:\s*")("?)(?!Bearer\b|Basic\b|\[redacted\])([^\s"',;]{4,})/gi;
const SECRET_ENV = /token|secret|passw|pwd|api_?key|access_?key|private_?key|auth|credential|cookie|session/i;

// Builds the redactor: known token shapes, key=value with a secret-sounding name, the values of secret
// env vars, and paths (the checkouts become ".", the home directory "~").
export function redactor(o: { env: Record<string, string | undefined>; paths: [string, string][] }) {
  const home = homedir();
  const secrets = Object.entries(o.env)
    .filter(([k, v]) => v && v.length >= 8 && SECRET_ENV.test(k))
    .map(([, v]) => v!)
    .sort((a, b) => b.length - a.length);
  const paths = [...o.paths].sort((a, b) => b[0].length - a[0].length);
  return (line: string): string => {
    let s = line;
    for (const v of secrets) s = s.split(v).join('[redacted]');
    for (const re of TOKENS) s = s.replace(re, '[redacted]');
    s = s.replace(BEARER, '$1 [redacted]');
    s = s.replace(NAMED, (_m, name, sep, q, _v) => `${name}${sep}${q}[redacted]`);
    for (const [from, to] of paths) if (from) s = s.split(from).join(to);
    if (home && home !== '/') s = s.split(home).join('~');
    s = s.replace(/(^|[\s"'=:(])\/(Users|home)\/[^/\s"']+/g, '$1~');
    return s;
  };
}
