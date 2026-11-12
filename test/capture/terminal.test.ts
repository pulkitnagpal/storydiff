// show terminal: a command run in each version's checkout, its last lines kept, secrets redacted.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { afterEach, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { capture } from '../../src/capture/index.ts';
import { readPlan } from '../../src/capture/plan.ts';
import { redactor, toLines } from '../../src/capture/terminal.ts';
import { allDead, makeRepo, worktrees, type Fixture } from './helpers.ts';

let fx: Fixture;
beforeEach(() => { fx = makeRepo(); });
afterEach(() => fx.done());

const CLI = fileURLToPath(new URL('../../src/capture/cli.ts', import.meta.url));
const RUN_ENV = 'run "node server.mjs" port 3999 env PID_DIR="PIDS" API_TOKEN=supersecretvalue1';

test('show terminal is read, and needs no running app', () => {
  const p = readPlan('show terminal "node cli.js --help" "What --help prints"');
  assert.deepEqual(p.shows[0], { kind: 'terminal', cmd: 'node cli.js --help', label: 'What --help prints', line: 1 });
  assert.throws(() => readPlan('show terminal node'), /show terminal needs a "command"/);
});

test('both versions: exit code, last 40 lines, ANSI and \\r handled, secrets and paths redacted', async () => {
  fx.spec([RUN_ENV, 'show terminal "node cli.mjs"'].join('\n'));
  const caps = await capture({ repo: fx.repo, base: 'main', tmpRoot: fx.tmp });
  const t = caps.shows[0];
  assert.ok(t?.kind === 'terminal');
  assert.equal(t.cmd, 'node cli.mjs');
  assert.deepEqual(t.before, { exit: 0, lines: ['tool v1'], total: 1 });
  assert.equal(t.after.exit, 2);
  assert.equal(t.after.total, 57);
  assert.equal(t.after.lines.length, 40);
  const all = t.after.lines.join('\n');
  assert.equal(t.after.lines[0], 'line 16');
  assert.ok(t.after.lines.includes('config at ~/projects/demo/config.json'));
  assert.ok(t.after.lines.includes('running in ./src'));
  assert.ok(t.after.lines.includes('token [redacted] and API_TOKEN [redacted]'));
  assert.ok(t.after.lines.includes('password=[redacted] user=maya'));
  assert.ok(t.after.lines.includes('error: something broke'));
  assert.ok(!all.includes(homedir()) && !all.includes(fx.tmp) && !all.includes('\x1b') && !all.includes('ghp_') && !all.includes('supersecret'));
  // Only commands ran: no app was started for this spec.
  assert.equal(fx.pidList().length, 0);
  assert.equal(worktrees(fx.repo), 1);
});

test('stdout and stderr both count; a pipeline is run by sh', async () => {
  fx.spec([RUN_ENV, 'show terminal "node cli.mjs | head -3"'].join('\n'));
  const caps = await capture({ repo: fx.repo, base: 'main', tmpRoot: fx.tmp });
  const t = caps.shows[0];
  assert.ok(t?.kind === 'terminal');
  assert.deepEqual(t.after.lines.filter(l => l !== 'error: something broke'), ['tool v2', 'progress 100%', 'line 1']);
  assert.ok(t.after.lines.includes('error: something broke'));
  assert.equal(t.after.total, 4);
});

test('a command that runs too long is stopped, children included', async () => {
  fx.spec([RUN_ENV, 'show terminal "node spin.mjs; echo after"'].join('\n'));
  const caps = await capture({ repo: fx.repo, base: 'main', tmpRoot: fx.tmp, terminalMs: 800 });
  const t = caps.shows[0];
  assert.ok(t?.kind === 'terminal');
  assert.equal(t.before.exit, null);
  assert.equal(t.before.timedOut, true);
  assert.equal(fx.pidList().length, 2);
  assert.ok(await allDead(fx.pidList()));
  assert.match(caps.warnings!.join('\n'), /ran over 1 s on the old version/);
});

test('Ctrl-C during a terminal command: exit 130, command killed, worktree removed', async () => {
  fx.spec([RUN_ENV, 'show terminal "node spin.mjs"'].join('\n'));
  const child = spawn(process.execPath, [CLI, '--base', 'main'], { cwd: fx.repo, env: { ...process.env, TMPDIR: fx.tmp }, stdio: ['ignore', 'pipe', 'pipe'] });
  const code = new Promise<number | null>(r => child.on('exit', c => r(c)));
  const until = Date.now() + 15000;
  while (fx.pidList().length < 1 && Date.now() < until) await new Promise(r => setTimeout(r, 50));
  assert.equal(fx.pidList().length, 1);
  child.kill('SIGINT');
  assert.equal(await code, 130);
  assert.ok(await allDead(fx.pidList()));
  assert.equal(worktrees(fx.repo), 1);
});

test('toLines and the redactor on their own', () => {
  assert.deepEqual(toLines('\x1b]0;title\x07\x1b[31mred\x1b[0m\r\nA\rB\n\n\n'), ['red', 'B']);
  const r = redactor({ env: { MY_SECRET: 'abcdefgh123', HOME_DIR: 'notsecretvalue' }, paths: [['/tmp/x/repo', '.']] });
  assert.equal(r('abcdefgh123 notsecretvalue /tmp/x/repo/a.js'), '[redacted] notsecretvalue ./a.js');
  assert.equal(r('Authorization: Bearer abc.def.ghi-123'), 'Authorization: Bearer [redacted]');
  assert.equal(r('key AKIAABCDEFGHIJKLMNOP and sk-ant-' + 'x'.repeat(20)), 'key [redacted] and [redacted]');
  assert.equal(r('"api_key": "zzzz-1234"'), '"api_key": "[redacted]"');
  assert.equal(r('see /Users/someone/code and /home/other/x'), 'see ~/code and ~/x');
});
