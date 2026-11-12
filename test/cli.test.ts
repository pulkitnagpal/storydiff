import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = new URL('../src/cli/index.ts', import.meta.url).pathname;
const run = (cwd: string, ...args: string[]) => {
  const env: NodeJS.ProcessEnv = { ...process.env, STORYDIFF_NO_OPEN: '1' };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', CLI, ...args], { cwd, encoding: 'utf8', env });
};
const fixture = (k: string) => { const d = mkdtempSync(join(tmpdir(), 'sd-cli-')); cpSync(new URL(`./fixtures/${k}/`, import.meta.url).pathname, d, { recursive: true }); return d; };

test('cli render writes the card html by default', () => {
  const d = fixture('tags');
  const r = run(d, 'render');
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(d, '.storydiff/card.html'), 'utf8'), /class="card"/);
});

test('cli render --md writes the comment body', () => {
  const d = fixture('infra');
  const r = run(d, 'render', '--md', 'out.md');
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(d, 'out.md'), 'utf8'), /```mermaid/);
});

test('cli reports a spec error with its line and exits 2', () => {
  const d = fixture('tags');
  const r = run(d, 'render', '--spec', join(d, '.storydiff/captures.json'));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /captures\.json: Line 1: /);
});

test('cli view writes the card and prints where', () => {
  const d = fixture('big');
  const r = run(d, 'view');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(d, '.storydiff/card.html')));
  assert.match(r.stdout, /card\.html/);
});

test('cli with no command prints help', () => {
  const r = run(tmpdir());
  assert.equal(r.status, 0);
  assert.match(r.stdout, /storydiff check/);
});

test('cli render writes one card per chapter', () => {
  const d = mkdtempSync(join(tmpdir(), 'sd-cli-'));
  writeFileSync(join(d, 'handover.storydiff'), 'pr "P" files 2\nby "Maya"\nchapters "Main", "+ 2 smaller changes"\nchapter 1\nask "Do it."\ncode a "A"\n+ "x"\nchapter 2\n! "Check the logs."');
  const r = run(d, 'render');
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(d, '.storydiff/card-2.html'), 'utf8'), /Check the logs\./);
});

test('e2e: the CLI keeps its own folder out of git', () => {
  const d = fixture('tags');
  rmSync(join(d, '.storydiff/.gitignore'), { force: true });
  assert.equal(run(d, 'render').status, 0);
  assert.equal(readFileSync(join(d, '.storydiff/.gitignore'), 'utf8'), '*\n');
});
