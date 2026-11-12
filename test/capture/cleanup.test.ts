// Whatever goes wrong, both apps are stopped and the base worktree is gone.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { capture } from '../../src/capture/index.ts';
import { allDead, makeRepo, RUN, worktrees, type Fixture } from './helpers.ts';

let fx: Fixture;
beforeEach(() => { fx = makeRepo(); });
afterEach(() => fx.done());

const CLI = fileURLToPath(new URL('../../src/capture/bin.ts', import.meta.url));

async function assertClean() {
  assert.ok(await allDead(fx.pidList()), 'an app is still running');
  assert.equal(worktrees(fx.repo), 1, 'the base worktree is still registered');
  assert.deepEqual(readdirSync(fx.tmp), [], 'the base worktree folder is still there');
}

test('success: apps stopped (the node under sh too), worktree removed', async () => {
  fx.spec([RUN, 'show call GET /api/version'].join('\n'));
  await capture({ repo: fx.repo, base: 'main', tmpRoot: fx.tmp });
  assert.equal(fx.pidList().length, 2);
  await assertClean();
});

test('the new version crashes on start: the old one is stopped, and a stale captures.json is gone', async () => {
  mkdirSync(join(fx.repo, '.storydiff'));
  writeFileSync(join(fx.repo, '.storydiff', 'captures.json'), '{"shows":[]}');
  writeFileSync(join(fx.repo, '.storydiff', 'after-0.png'), 'old');
  writeFileSync(join(fx.repo, 'server.mjs'), "throw new Error('boom on start')\n");
  fx.spec([RUN, 'show call GET /api/version'].join('\n'));
  await assert.rejects(capture({ repo: fx.repo, base: 'main', tmpRoot: fx.tmp }), /the after app stopped \(exit code \d+\) before it answered[\s\S]*boom on start/);
  assert.equal(existsSync(join(fx.repo, '.storydiff', 'captures.json')), false);
  assert.equal(existsSync(join(fx.repo, '.storydiff', 'after-0.png')), false);
  assert.equal(fx.pidList().length, 1);
  await assertClean();
});

test('an app that never answers is killed after the timeout', async () => {
  fx.spec('run "node hang.mjs" port 3999 env PID_DIR="PIDS"\nshow call GET /x');
  await assert.rejects(capture({ repo: fx.repo, base: 'main', tmpRoot: fx.tmp, readyMs: 1500 }), /did not answer on port \d+ within 2 s/);
  assert.equal(fx.pidList().length, 2);
  await assertClean();
});

test('an app that dies mid-capture fails the run and still cleans up', async () => {
  fx.spec([RUN, 'show call GET /api/version', 'show call GET /die', 'show call GET /api/version'].join('\n'));
  await assert.rejects(capture({ repo: fx.repo, base: 'main', tmpRoot: fx.tmp }), /the before app stopped: GET \/die got no reply/);
  await assertClean();
});

test('a wrong STORYDIFF_CHROME fails the run and still cleans up', async () => {
  fx.spec([RUN, 'show screen /'].join('\n'));
  const was = process.env.STORYDIFF_CHROME;
  process.env.STORYDIFF_CHROME = join(fx.tmp, 'no-such-browser');
  try { await assert.rejects(capture({ repo: fx.repo, base: 'main', tmpRoot: fx.tmp }), /STORYDIFF_CHROME points at/); }
  finally { if (was === undefined) delete process.env.STORYDIFF_CHROME; else process.env.STORYDIFF_CHROME = was; }
  await assertClean();
});

test('a base that does not exist: nothing is started or checked out', async () => {
  fx.spec([RUN, 'show call GET /api/version'].join('\n'));
  await assert.rejects(capture({ repo: fx.repo, base: 'no-such-branch', tmpRoot: fx.tmp }), /--base no-such-branch: no such commit/);
  assert.equal(fx.pidList().length, 0);
  await assertClean();
});

test('show lines that need apps but no run line: a clear error before anything starts', async () => {
  fx.spec('show call GET /api/version');
  await assert.rejects(capture({ repo: fx.repo, base: 'main', tmpRoot: fx.tmp }), /Add a run line/);
  await assertClean();
});

test('Ctrl-C on the CLI mid-capture: exit 130, apps stopped, worktree removed', async () => {
  fx.spec([RUN, 'show call GET /slow'].join('\n'));
  // TMPDIR moves the CLI's worktree (and any browser profile) into the fixture's tmp folder.
  const child = spawn(process.execPath, [CLI, '--base', 'main'], { cwd: fx.repo, env: { ...process.env, TMPDIR: fx.tmp }, stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', b => { err += b; });
  const code = new Promise<number | null>(r => child.on('exit', c => r(c)));
  const until = Date.now() + 15000;
  while (!/show 1: call GET \/slow/.test(err) && Date.now() < until) await new Promise(r => setTimeout(r, 50));
  assert.match(err, /show 1/);
  assert.equal(fx.pidList().length, 2);
  assert.equal(worktrees(fx.repo), 2);
  child.kill('SIGINT');
  assert.equal(await code, 130);
  assert.match(err, /SIGINT: stopping both apps/);
  await assertClean();
});

test('the CLI exits 1 with the reason on failure', async () => {
  fx.spec('show call GET /x');
  const child = spawn(process.execPath, [CLI, '--base', 'main'], { cwd: fx.repo, env: { ...process.env, TMPDIR: fx.tmp }, stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', b => { err += b; });
  assert.equal(await new Promise(r => child.on('exit', r)), 1);
  assert.match(err, /storydiff capture failed: .*Add a run line/);
  await assertClean();
});
