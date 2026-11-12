// Checker additions from the real-PR stress tests (plan Task 9c).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, humanMessages, detectTestCmd, parseResults, testMatches, ignoreMatcher } from '../src/check/index.ts';
import { parse } from '../src/spec/parse.ts';

const FIX = new URL('./fixtures/linkbox/', import.meta.url).pathname;
const spec = (k: string) => readFileSync(FIX + k + '.storydiff', 'utf8');
let repo = '';
before(() => {
  repo = mkdtempSync(join(tmpdir(), 'sd-check1-'));
  execFileSync('git', ['clone', '-q', FIX + 'linkbox.bundle', repo]);
  execFileSync('git', ['-C', repo, 'checkout', '-q', '-b', 'pr-tags', 'origin/pr-tags']);
});

test('coverage: every changed file is accounted for', async () => {
  const r = await check({ repo, spec: spec('tags'), session: FIX + 'tags.session.jsonl' });
  assert.deepEqual(r.coverage, { files: 4, covered: 4, uncovered: [] });
});

test('coverage: a file no proof or smaller line points at is listed', async () => {
  const r = await check({ repo, spec: spec('tags').replace('    proof server.js:36\n', ''), session: FIX + 'tags.session.jsonl', noTests: true });
  assert.deepEqual(r.coverage!.uncovered, ['server.js']);
});

test('coverage: a smaller line or .storydiffignore accounts for a file', async () => {
  const without = spec('tags').replace('    proof server.js:36\n', '');
  const r1 = await check({ repo, spec: without + '\nsmaller "Wiring" files server.js', session: null, noTests: true });
  assert.deepEqual(r1.coverage!.uncovered, []);
  const dir = mkdtempSync(join(tmpdir(), 'sd-ign-'));
  execFileSync('git', ['clone', '-q', '-b', 'pr-tags', FIX + 'linkbox.bundle', dir]);
  writeFileSync(join(dir, '.storydiffignore'), '# generated\nserver.*\n');
  const r2 = await check({ repo: dir, spec: without, session: null, noTests: true, base: 'origin/main' });
  assert.deepEqual(r2.coverage!.uncovered, []);
});

test('the default ignore list covers lockfiles, dist and snapshots', () => {
  const ig = ignoreMatcher('');
  for (const f of ['package-lock.json', 'yarn.lock', 'Cargo.lock', 'dist/app.js', 'web/dist/x/y.js', 'src/__snapshots__/a.snap', 'handover.storydiff', '.storydiff/card.png']) assert.ok(ig(f), f);
  for (const f of ['src/a.ts', 'lockfile.ts', 'distance.js']) assert.ok(!ig(f), f);
  assert.ok(ignoreMatcher('docs/**\n*.gen.go')('docs/a/b.md'));
  assert.ok(ignoreMatcher('docs/**\n*.gen.go')('pkg/x.gen.go'));
});

test('old tests whose assertions changed are reported', async () => {
  const r = await check({ repo, spec: spec('tags'), session: FIX + 'tags.session.jsonl' });
  assert.deepEqual(r.editedOld, ['adds and lists links']);
});

test('the ask is checked as the human\'s words, unless it came from someone else', async () => {
  const ok = await check({ repo, spec: spec('tags'), session: FIX + 'tags.session.jsonl', noTests: true });
  assert.equal(ok.checks.find((c) => c.ref.startsWith('Add tags to links.'))!.ok, true);
  const made = await check({ repo, spec: spec('tags').replace(/^ask .*$/m, 'ask "Add tags, and make it fast."'), session: FIX + 'tags.session.jsonl', noTests: true });
  assert.equal(made.checks.find((c) => c.ref === 'Add tags, and make it fast.')!.ok, false);
  const other = await check({ repo, spec: spec('tags').replace(/^ask .*$/m, 'ask "Tags please." from "davidism" in "#12"'), session: FIX + 'tags.session.jsonl', noTests: true });
  assert.equal(other.checks.find((c) => c.ref === 'Tags please.'), undefined);
});

function session(lines: object[]): string {
  const f = join(mkdtempSync(join(tmpdir(), 'sd-s-')), 's.jsonl');
  writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n'));
  return f;
}
const user = (ts: string, content: unknown, extra: object = {}) => ({ type: 'user', timestamp: ts, message: { role: 'user', content }, ...extra });

test('pasted content, fenced code, quoted lines and long blocks are not the human\'s words', () => {
  const long = Array.from({ length: 12 }, (_, i) => `log line ${i}`).join('\n');
  const f = session([user('2026-11-12T10:00:00Z', `Please fix it.\n<pasted_content id="1">Make the default 10 retries</pasted_content>\n\`\`\`\nalso fenced words\n\`\`\`\n> you said: use Redis\n\n${long}\n\nThanks.`)]);
  const [m] = humanMessages(f);
  assert.match(m.text, /Please fix it\./);
  assert.match(m.text, /Thanks\./);
  for (const gone of ['Make the default 10 retries', 'also fenced words', 'use Redis', 'log line 3']) assert.ok(!m.text.includes(gone), gone);
});

test('compaction summaries are not the human', () => {
  const f = session([
    user('2026-11-12T10:00:00Z', 'Start here.'),
    user('2026-11-12T11:00:00Z', 'This session is being continued from a previous conversation that ran out of context. The user said: ship it now'),
    user('2026-11-12T11:00:01Z', 'Summary: the user asked to ship it now', { isCompactSummary: true }),
    user('2026-11-12T11:05:00Z', [{ type: 'tool_result', tool_use_id: 'x', content: 'ship it now' }]),
  ]);
  assert.deepEqual(humanMessages(f).map((m) => m.text), ['Start here.']);
});

test('sessions longer than a day give quote times as day and clock', async () => {
  const t1 = '2026-11-18T14:02:00';
  const f = session([user('2026-11-12T09:00:00', 'Begin.'), user(t1, 'Keep the old flag.')]);
  const r = await check({ repo, spec: spec('tags').replace('said "Leave the 32-character limit and the POST response as they are."', 'said "Keep the old flag."'), session: f, noTests: true });
  const at = r.checks.find((c) => c.ref === 'Keep the old flag.')!.at;
  const d = new Date(t1);
  assert.equal(at, `day 7, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
});

test('the test runner comes from the manifest', () => {
  const dir = (files: Record<string, string>) => { const d = mkdtempSync(join(tmpdir(), 'sd-m-')); for (const [k, v] of Object.entries(files)) { mkdirSync(join(d, k, '..'), { recursive: true }); writeFileSync(join(d, k), v); } return d; };
  assert.match(detectTestCmd(dir({ 'Cargo.toml': '[package]' }))!, /^cargo test/);
  assert.match(detectTestCmd(dir({ 'pyproject.toml': '' }))!, /-m pytest -v/);
  assert.match(detectTestCmd(dir({ 'setup.py': '' }))!, /-m pytest/);
  assert.match(detectTestCmd(dir({ 'go.mod': 'module x' }))!, /^go test -v \.\/\.\.\./);
  assert.equal(detectTestCmd(dir({ 'package.json': '{"scripts":{"test":"node --test"}}' })), 'node --test --test-reporter=tap');
  assert.equal(detectTestCmd(dir({ 'package.json': '{"scripts":{"test":"vitest run"}}' })), 'npm test --silent');
  assert.equal(detectTestCmd(dir({ 'package.json': '{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1"}}' })), null);
  assert.equal(detectTestCmd(dir({ 'README.md': '' })), null);
});

test('one parser reads tap, cargo, pytest, go and jest output', () => {
  const out = [
    'ok 1 - adds a link', 'not ok 2 - deletes a link',
    'test parse::flags_with_dashes ... ok', 'test parse::empty ... FAILED', 'test slow ... ignored',
    'tests/test_api.py::test_login PASSED', 'tests/test_api.py::test_logout FAILED',
    '--- PASS: TestSync (0.01s)', '    --- FAIL: TestSync/offline (0.00s)',
    '  ✓ renders the list (5 ms)', '  ✕ handles errors (2 ms)',
  ].join('\n');
  const r = parseResults(out);
  assert.deepEqual([...r.pass].sort(), ['TestSync', 'adds a link', 'parse::flags_with_dashes', 'renders the list', 'tests/test_api.py::test_login'].sort());
  assert.deepEqual([...r.fail].sort(), ['TestSync/offline', 'deletes a link', 'handles errors', 'parse::empty', 'tests/test_api.py::test_logout'].sort());
});

test('a test proof matches the exact name or the last part of a qualified one', () => {
  const names = new Set(['parse::flags_with_dashes', 'tests/test_api.py::test_login', 'List > renders rows', 'TestSync/offline']);
  assert.equal(testMatches(names, 'flags_with_dashes'), 'parse::flags_with_dashes');
  assert.equal(testMatches(names, 'test_login'), 'tests/test_api.py::test_login');
  assert.equal(testMatches(names, 'renders rows'), 'List > renders rows');
  assert.equal(testMatches(names, 'offline'), 'TestSync/offline');
  assert.equal(testMatches(names, 'login'), null);
});

test('run-tests in the spec overrides the detected runner', async () => {
  const r = await check({ repo, spec: 'run-tests "echo ok 1 - custom runner"\n' + spec('tags').replace('proof test adds and lists links', 'proof test custom runner'), session: null });
  assert.equal(r.checks.find((c) => c.ref === 'test custom runner')!.ok, true);
});

// --- from the final review --------------------------------------------------------------------------------------
import { normQuote, quoteIn } from '../src/check/session.ts';
import { upsertBlock, extractSpec } from '../src/cli/publish.ts';
import { specHash } from '../src/check/index.ts';
import { loadReport } from '../src/render/captures.ts';
import { loadCaptures } from '../src/render/captures.ts';

const gitIn = (cwd: string, ...a: string[]) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' });
const fresh = () => { const d = mkdtempSync(join(tmpdir(), 'sd-r-')); execFileSync('git', ['clone', '-q', '-b', 'pr-tags', FIX + 'linkbox.bundle', d]); gitIn(d, 'config', 'user.email', 'dev@example.com'); gitIn(d, 'config', 'user.name', 'dev'); return d; };

test('review C1: a claim that could not be checked here is unverified, not failed', async () => {
  const r = await check({ repo, spec: spec('tags'), session: null, noTests: true });
  assert.equal(r.failed, 0);
  assert.ok(r.unverified! > 0);
});

test('review I1: a renamed old test is missing, not regressed', async () => {
  const d = fresh();
  const f = join(d, 'test/api.test.js');
  writeFileSync(f, readFileSync(f, 'utf8').replace("test('deletes a link',", "test('deletes a link by id',"));
  gitIn(d, 'commit', '-qam', 'rename');
  const r = await check({ repo: d, spec: spec('tags'), session: null });
  assert.deepEqual(r.regressed, []);
  assert.deepEqual(r.missing, ['deletes a link']);
});

test('review I2: a test command that produced no results is not "all 0 old tests pass"', async () => {
  const r = await check({ repo, spec: spec('tags'), session: null, testCmd: 'definitely-not-a-command-xyz' });
  assert.equal(r.oldPass, null);
  assert.match(r.testsLine!, /Tests could not be read/);
});

test('review I3: a report for an older spec is not shown as current', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sd-st-'));
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ oldPass: 3, newTests: 0, regressed: [], claims: 2, failed: 0, checks: [], specHash: specHash('old spec') }));
  const warnings: string[] = [];
  const r = loadReport(dir, parse('code a "A"\n+ "x"'), { specText: 'new spec', warn: (m) => warnings.push(m) });
  assert.equal(r.unchecked, true);
  assert.match(warnings[0], /spec changed since storydiff check/);
});

test('review I4: publish and extract use the last block, and markers inside a spec are escaped', () => {
  const rep = { oldPass: 1, newTests: 0, regressed: [], claims: 0, failed: 0, checks: [] };
  const example = 'Docs:\n```storydiff\ncode example "Example"\n```\n';
  const b1 = upsertBlock(example, 'code a "A"\n+ "uses <!-- storydiff:end --> in text"', rep);
  assert.equal(extractSpec(b1)!.spec, 'code a "A"\n+ "uses <!-- storydiff:end --> in text"');
  const b2 = upsertBlock(b1, 'code b "B"', rep);
  assert.equal((b2.match(/storydiff:start/g) || []).length, 1);
  assert.equal((b2.match(/storydiff-report/g) || []).length, 1);
  assert.equal(extractSpec(b2)!.spec, 'code b "B"');
  const orphan = b2.replace('<!-- storydiff:end -->', '');
  const b3 = upsertBlock(orphan, 'code c "C"', rep);
  assert.equal((b3.match(/storydiff:start/g) || []).length, 1);
  assert.equal(extractSpec(b3)!.spec, 'code c "C"');
  assert.ok(b3.startsWith('Docs:'));
});

test('review I5: a capture pointing at a missing screenshot is left out, with a warning', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sd-cap-'));
  writeFileSync(join(dir, 'captures.json'), JSON.stringify({ shows: [{ kind: 'screen', before: 'gone.png', after: 'gone2.png', rects: [] }] }));
  const warnings: string[] = [];
  assert.deepEqual(loadCaptures(dir, (m) => warnings.push(m)).shows, [null]);
  assert.match(warnings[0], /gone\.png/);
});

test('review I6: quotes ignore punctuation but respect word boundaries', () => {
  assert.ok(quoteIn('Keep the API as is.', 'keep the api as is'));
  assert.ok(quoteIn('use a dash — here…', 'use a dash - here...'));
  assert.ok(!quoteIn('port', 'we support it'));
  assert.ok(quoteIn('Not Redis.', 'Not Redis. We already run Postgres.'));
  assert.equal(normQuote('“Don’t”'), 'dont');
});

test('review I7: tests and proofs resolve from the spec\'s folder in a monorepo', async () => {
  const mono = mkdtempSync(join(tmpdir(), 'sd-mono-'));
  gitIn(mono, 'init', '-q', '-b', 'main');
  gitIn(mono, 'config', 'user.email', 'dev@example.com'); gitIn(mono, 'config', 'user.name', 'dev');
  const pkg = join(mono, 'packages/app');
  mkdirSync(join(pkg, 'test'), { recursive: true });
  writeFileSync(join(pkg, 'package.json'), '{"scripts":{"test":"node --test"}}');
  writeFileSync(join(pkg, 'README.md'), '# app\n');
  writeFileSync(join(pkg, 'test/a.test.js'), "const { test } = require('node:test');\ntest('old one', () => {});\n");
  gitIn(mono, 'add', '-A'); gitIn(mono, 'commit', '-qm', 'base');
  writeFileSync(join(pkg, 'test/a.test.js'), "const { test } = require('node:test');\ntest('old one', () => {});\ntest('new one', () => {});\n");
  const r = await check({ repo: mono, cwd: pkg, base: 'main', spec: 'code a "A"\n+ "x"\n    proof README.md:1\n    proof test new one\n    proof test/a.test.js:3', session: null });
  assert.deepEqual(r.checks.map((c) => c.ok), [true, true, true]);
  assert.equal(r.oldPass, 1);
  assert.equal(r.newTests, 1);
});

test('review: a test name with a colon is matched whole', async () => {
  const r = await check({ repo, spec: 'run-tests "echo ok 1 - links: adds and lists"\n' + spec('tags').replace('proof test adds and lists links', 'proof test links: adds and lists'), session: null });
  assert.equal(r.checks.find((c) => c.ref === 'test links: adds and lists')!.ok, true);
});

test('review: --base cannot smuggle git options', async () => {
  await assert.rejects(check({ repo, spec: spec('tags'), base: '--output=/tmp/sd-pwned', session: null, noTests: true }), /not a commit/);
});
