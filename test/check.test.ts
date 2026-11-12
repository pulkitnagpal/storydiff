import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, findSession, humanMessages, defaultBase } from '../src/check/index.ts';

const FIX = new URL('./fixtures/linkbox/', import.meta.url).pathname;
const spec = (k: string) => readFileSync(FIX + k + '.storydiff', 'utf8');
const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const repos: Record<string, string> = {};

function clone(branch: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'sd-check-'));
  execFileSync('git', ['clone', '-q', FIX + 'linkbox.bundle', dir]);
  git(dir, 'checkout', '-q', '-b', branch, 'origin/' + branch);
  git(dir, 'config', 'user.email', 'dev@example.com'); git(dir, 'config', 'user.name', 'dev');
  return dir;
}
before(() => { repos.tags = clone('pr-tags'); repos.docker = clone('pr-docker'); });

test('the base defaults to where the branch left main', () => {
  assert.equal(defaultBase(repos.tags), git(repos.tags, 'rev-parse', 'origin/main').trim());
});

test('tags handover checks green', async () => {
  const r = await check({ repo: repos.tags, spec: spec('tags'), session: FIX + 'tags.session.jsonl' });
  assert.deepEqual(r.checks.filter((c) => c.ok !== true), []);
  assert.equal(r.failed, 0);
  assert.deepEqual(r.regressed, []);
  assert.equal(r.oldPass, 3);
  assert.equal(r.newTests, 6);
  assert.equal(r.claims, r.checks.length);
  const q = r.checks.find((c) => c.ref === 'in their own table, not a comma string')!;
  assert.equal(q.at, '03:11');
  assert.equal(r.checks.find((c) => c.ref === 'db.js:12')!.why, 'line changed in this PR');
  assert.equal(r.sessionLength, '5 min');
});

test('docker handover checks green', async () => {
  const r = await check({ repo: repos.docker, spec: spec('docker'), session: FIX + 'docker.session.jsonl' });
  assert.deepEqual(r.checks.filter((c) => c.ok !== true), []);
  assert.equal(r.oldPass, 3);
  assert.equal(r.newTests, 0);
});

test('a fake line fails', async () => {
  const r = await check({ repo: repos.tags, spec: spec('tags').replace('proof db.js:12', 'proof db.js:999'), session: FIX + 'tags.session.jsonl' });
  const c = r.checks.find((x) => x.ref === 'db.js:999')!;
  assert.equal(c.ok, false);
  assert.match(c.why, /db\.js has only \d+ lines/);
  assert.equal(r.failed, 1);
});

test('a file that is not there fails', async () => {
  const r = await check({ repo: repos.tags, spec: spec('tags').replace('proof db.js:12', 'proof src/nope.js:3'), session: FIX + 'tags.session.jsonl' });
  assert.equal(r.checks.find((x) => x.ref === 'src/nope.js:3')!.why, 'src/nope.js does not exist');
});

test('a made-up test fails', async () => {
  const r = await check({ repo: repos.tags, spec: spec('tags').replace('proof test adds and lists links', 'proof test lists links in under 10 ms'), session: FIX + 'tags.session.jsonl' });
  const c = r.checks.find((x) => x.ref === 'test lists links in under 10 ms')!;
  assert.equal(c.ok, false);
  assert.equal(c.why, 'no test with this name ran');
});

test('an invented quote fails', async () => {
  const r = await check({ repo: repos.tags, spec: spec('tags').replace('"the mobile app reads it"', '"ship it without tests"'), session: FIX + 'tags.session.jsonl' });
  const c = r.checks.find((x) => x.ref === 'ship it without tests')!;
  assert.equal(c.ok, false);
  assert.equal(c.why, "not found in the human's messages");
});

test('without a session log, quotes cannot be checked here', async () => {
  const r = await check({ repo: repos.tags, spec: spec('tags'), session: null });
  const said = r.checks.filter((c) => c.kind === 'said');
  assert.ok(said.length > 0 && said.every((c) => c.ok === null && c.why === 'no session log on this machine'));
  assert.equal(r.failed, 0, 'not checked is not the same as wrong');
  assert.equal(r.unverified, said.length);
});

test('a regression is named', async () => {
  const dir = clone('pr-tags');
  const f = join(dir, 'test/api.test.js');
  writeFileSync(f, readFileSync(f, 'utf8').replace("test('deletes a link', async () => {", "test('deletes a link', async () => { throw new Error('broken');"));
  git(dir, 'commit', '-qam', 'break a test');
  const r = await check({ repo: dir, spec: spec('tags').replace('proof test adds and lists links', ''), session: FIX + 'tags.session.jsonl' });
  assert.deepEqual(r.regressed, ['deletes a link']);
  assert.equal(r.oldPass, 3);
});

test('system reminders and tool turns are not the human', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sd-sess-'));
  const f = join(dir, 's.jsonl');
  const line = (o: object) => JSON.stringify(o);
  writeFileSync(f, [
    line({ type: 'user', timestamp: '2026-11-12T10:00:00Z', message: { role: 'user', content: 'Please add tags.' } }),
    line({ type: 'user', timestamp: null, message: { role: 'user', content: '<system-reminder>Git user: Somebody Else</system-reminder>' } }),
    line({ type: 'user', timestamp: '2026-11-12T10:01:00Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok fine' }] } }),
    line({ type: 'user', timestamp: '2026-11-12T10:02:00Z', isMeta: true, message: { role: 'user', content: 'Caveat: messages below were generated by the user running local commands.' } }),
    line({ type: 'user', timestamp: '2026-11-12T10:03:00Z', message: { role: 'user', content: '<command-name>/storydiff</command-name>\n<command-args></command-args>' } }),
    line({ type: 'user', timestamp: '2026-11-12T10:04:00Z', isMeta: true, message: { role: 'user', content: 'The user sent a message while you were working:\nKeep it small.' } }),
  ].join('\n'));
  assert.deepEqual(humanMessages(f).map((m) => m.text), ['Please add tags.', 'Keep it small.']);
  assert.deepEqual(humanMessages(f).map((m) => m.atMs), [0, 240000]);
});

test('the session log is found in Claude Code projects folder', () => {
  const home = mkdtempSync(join(tmpdir(), 'sd-home-'));
  const repo = '/work/my repo.git';
  const proj = join(home, '.claude', 'projects', '-work-my-repo-git');
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, 'old.jsonl'), '{}\n'); utimesSync(join(proj, 'old.jsonl'), 1000, 1000);
  writeFileSync(join(proj, 'new.jsonl'), '{}\n');
  assert.equal(findSession(repo, home), join(proj, 'new.jsonl'));
  assert.equal(findSession('/elsewhere', home), null);
});
