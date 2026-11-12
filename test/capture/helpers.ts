// A tiny two-version app in a throwaway git repo. Base (committed on main) is version 1; the working
// tree is version 2. Every server writes its pid to PID_DIR, so tests can check nothing is left running.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SERVER = `import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
const version = readFileSync(new URL('./version.txt', import.meta.url), 'utf8').trim();
if (process.env.PID_DIR) writeFileSync(process.env.PID_DIR + '/' + process.env.PORT + '.pid', String(process.pid));
const seen = new Set(); let total = 0, count = 0, id = 0;
createServer(async (req, res) => {
  const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const html = (s) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(s); };
  let raw = ''; for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : {};
  if (req.url === '/') return html('<title>Demo</title><h1 id="v">Version ' + version + '</h1>' + (version === '2' ? '<p id="hello">Hello</p>' : ''));
  if (req.url === '/same') return html('<title>Demo</title><p>Always the same</p>');
  if (req.url === '/new') return version === '2' ? html('<h1 id="fresh">A new page</h1>') : json(404, { error: 'not found' });
  if (req.url === '/api/version') return json(200, { version });
  if (req.url === '/api/items' && req.method === 'POST') return json(201, { id: ++id, ...body, created_at: new Date().toISOString(), ...(version === '2' ? { extra: true } : {}) });
  if (req.url === '/api/list') return json(200, [{ id: 7, name: 'a', at: Date.now() }]);
  if (req.url === '/api/charge') {
    if (version === '2' && seen.has(body.event)) return json(200, { charged: false, note: 'skipped' });
    seen.add(body.event); total += body.amount; count++;
    return json(201, { charged: true, note: body.event + ' · $' + body.amount });
  }
  if (req.url === '/api/total') return json(200, { total, count });
  if (req.url === '/die') process.exit(3);
  if (req.url === '/slow') return setTimeout(() => json(200, {}), 60000);
  json(404, { error: 'not found' });
}).listen(Number(process.env.PORT));
`;
const HANG = `import { writeFileSync } from 'node:fs';
if (process.env.PID_DIR) writeFileSync(process.env.PID_DIR + '/' + process.env.PORT + '.pid', String(process.pid));
setInterval(() => {}, 1000);
`;

// A command-line tool: version 1 prints one line; version 2 adds colour, a progress bar, 50 lines,
// a home path, its own folder, secrets, and fails.
const CLI_V1 = `console.log('tool v1');\n`;
const CLI_V2 = `import { homedir } from 'node:os';
const fake = 'ghp_' + 'FAKE'.repeat(9);
console.log('\\x1b[1;32mtool v2\\x1b[0m');
process.stdout.write('progress 10%\\rprogress 100%\\n');
for (let i = 1; i <= 50; i++) console.log('line ' + i);
console.log('config at ' + homedir() + '/projects/demo/config.json');
console.log('running in ' + process.cwd() + '/src');
console.log('token ' + fake + ' and API_TOKEN ' + process.env.API_TOKEN);
console.log('password=hunter22 user=maya');
console.error('error: something broke');
process.exitCode = 2;
`;
const SPIN = `import { writeFileSync } from 'node:fs';
writeFileSync(process.env.PID_DIR + '/' + process.pid + '.pid', String(process.pid));
setInterval(() => {}, 1000);
`;

export type Fixture = { repo: string; pids: string; tmp: string; spec(s: string): void; pidList(): number[]; done(): void };

const git = (repo: string, ...a: string[]) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export function makeRepo(): Fixture {
  const top = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'sd-capture-test-')));
  const repo = join(top, 'demo'), pids = join(top, 'pids'), tmp = join(top, 'tmp');
  for (const d of [repo, pids, tmp]) mkdirSync(d);
  const w = (f: string, s: string) => writeFileSync(join(repo, f), s);
  w('server.mjs', SERVER); w('hang.mjs', HANG); w('cli.mjs', CLI_V1); w('spin.mjs', SPIN); w('version.txt', '1\n'); w('Dockerfile', 'FROM node:22-alpine\n');
  w('.gitignore', '.storydiff/\nhandover.storydiff\n');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'base');
  // The new version: uncommitted changes in the working tree.
  w('version.txt', '2\n'); w('Dockerfile', 'FROM node:25-alpine\n'); w('cli.mjs', CLI_V2);
  mkdirSync(join(repo, '.github'));
  w('.github/ci.yml', 'on: [push]\n');
  return {
    repo, pids, tmp,
    spec: s => w('handover.storydiff', s.replaceAll('PIDS', pids)),
    pidList: () => readdirSync(pids).filter(f => f.endsWith('.pid')).map(f => +readFileSync(join(pids, f), 'utf8')),
    done: () => rmSync(top, { recursive: true, force: true }),
  };
}

export const RUN = 'run "node server.mjs; true" port 3999 env PID_DIR="PIDS"';

export function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

export async function allDead(pids: number[], ms = 3000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (!pids.some(alive)) return true; await new Promise(r => setTimeout(r, 50)); }
  return !pids.some(alive);
}

export function worktrees(repo: string): number {
  return git(repo, 'worktree', 'list', '--porcelain').split('\n').filter(l => l.startsWith('worktree ')).length;
}
