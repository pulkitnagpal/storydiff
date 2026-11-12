// storydiff check: does every line of the handover hold up against the code, the tests and the human's own words?
// And does the card cover every file the PR changes?
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parse } from '../spec/parse.ts';
import type { Check, Report } from '../render/types.ts';
import { coverage, ignoreMatcher, readIgnore } from './coverage.ts';
import { editedOld } from './edited.ts';
import { atBase, changedFiles, defaultBase, gitRoot, hunks, isDirty, resolveCommit, shortSha } from './git.ts';
import { humanMessages, quoteIn, quoteTime, sessionLength } from './session.ts';
import { detectTestCmd, runTests, testMatches, type TestRun } from './tests.ts';

export { defaultBase, changedFiles } from './git.ts';
export { findSession, humanMessages, sessionLength, normQuote, quoteIn, typedWords } from './session.ts';
export { runTests, parseResults, detectTestCmd, testMatches } from './tests.ts';
export { ignoreMatcher, DEFAULT_IGNORE } from './coverage.ts';

export interface CheckOptions {
  /** The git repo (its root, or any folder inside it). */
  repo: string;
  /** The folder the spec belongs to (a package in a monorepo). Tests run and proofs resolve here. Default: the repo root. */
  cwd?: string;
  /** The handover text. */
  spec: string;
  /** Base ref; defaults to where the branch left main. */
  base?: string;
  /** Session log path; null = none on this machine (quotes cannot be checked). */
  session?: string | null;
  /** Test command; defaults to the spec's run-tests, then the one the manifest implies. */
  testCmd?: string;
  /** Skip running tests. */
  noTests?: boolean;
}

/** Ties a report to the exact spec it checked. */
export const specHash = (spec: string) => createHash('sha256').update(spec.replace(/\r/g, '')).digest('hex').slice(0, 16);

/** Every folder with a node_modules in the head tree (root and workspaces), relative to the root. */
function nodeModules(root: string, depth = 3, rel = ''): string[] {
  const out: string[] = [];
  let names: string[] = [];
  try { names = readdirSync(join(root, rel)); } catch { return out; }
  if (names.includes('node_modules')) out.push(rel);
  if (depth) for (const n of names) {
    if (n === 'node_modules' || n.startsWith('.')) continue;
    const p = join(rel, n);
    try { if (lstatSync(join(root, p)).isDirectory()) out.push(...nodeModules(root, depth - 1, p)); } catch { /* unreadable */ }
  }
  return out;
}

/** The same tests on the base commit, in a detached worktree, with the head's installed dependencies linked in. */
function baseTests(repo: string, base: string, pkg: string, cmd: string | null): TestRun {
  const tmp = join(mkdtempSync(join(tmpdir(), 'sd-base-')), 'base');
  try {
    execFileSync('git', ['-C', repo, 'worktree', 'add', '--detach', '--quiet', tmp, base], { stdio: 'ignore' });
    for (const rel of nodeModules(repo)) {
      const to = join(tmp, rel, 'node_modules');
      if (!existsSync(to) && existsSync(join(tmp, rel))) symlinkSync(join(repo, rel, 'node_modules'), to);
    }
    const dir = join(tmp, relative(repo, pkg));
    return existsSync(dir) ? runTests(dir, cmd) : { pass: new Set(), fail: new Set(), ran: false, note: 'the package did not exist at base' };
  } finally {
    try { execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', tmp], { stdio: 'ignore' }); } catch { rmSync(tmp, { recursive: true, force: true }); }
  }
}

interface Ctx { root: string; pkg: string; added: Record<string, number[]>; head: TestRun; before: TestRun; proven: Set<string> }

function proofCheck(c: Ctx, p: string): Pick<Check, 'ok' | 'why'> {
  const fl = p.match(/^([^\s:]+):(\d+)(?:-(\d+))?$/);
  const tn = p.match(/^test\s+(.+)$/);
  if (fl) {
    const f = fl[1].replace(/\\/g, '/'), n = Number(fl[3] ?? fl[2]);
    // Relative to the spec's folder first, then the repo root, then a unique changed file ending in it.
    const candidates = [relative(c.root, resolve(c.pkg, f)), relative(c.root, resolve(c.root, f))].map((x) => x.split(sep).join('/'));
    if (candidates.some((x) => x.startsWith('..') || isAbsolute(x))) return { ok: false, why: `${f} is outside the repo` };
    let hit = candidates.find((x) => existsSync(join(c.root, x)));
    if (!hit) {
      const ends = Object.keys(c.added).filter((k) => k.endsWith('/' + f) && existsSync(join(c.root, k)));
      if (ends.length > 1) return { ok: false, why: `${f} is ambiguous: ${ends.join(', ')}` };
      hit = ends[0];
    }
    if (!hit) return { ok: false, why: `${f} does not exist` };
    c.proven.add(hit);
    const lines = readFileSync(join(c.root, hit), 'utf8').replace(/\n$/, '').split('\n').length;
    if (n > lines) return { ok: false, why: `${f} has only ${lines} lines` };
    const near = (c.added[hit] ?? []).some((k) => k === -1 || Math.abs(k - n) <= 3);
    return { ok: true, why: near ? 'line changed in this PR' : 'line exists, not changed in this PR' };
  }
  if (tn) {
    const name = tn[1].trim();
    if (!c.head.ran) return { ok: null, why: c.head.note || 'tests were not run' };
    const pass = testMatches(c.head.pass, name);
    if (pass) return { ok: true, why: testMatches(c.before.pass, name) ? 'passes (old test)' : 'passes (new test)' };
    if (testMatches(c.head.fail, name)) return { ok: false, why: 'test fails' };
    return { ok: false, why: 'no test with this name ran' };
  }
  return { ok: null, why: 'not a kind of proof the checker knows: use file:line or test <name>' };
}

export async function check(o: CheckOptions): Promise<Report> {
  const doc = parse(o.spec);
  const chapters = [doc, ...doc.rest];
  const root = realpathSync(gitRoot(o.repo) || resolve(o.repo));
  const pkg = realpathSync(resolve(o.cwd ?? root));
  const base = resolveCommit(root, o.base ?? defaultBase(root));
  const { added, removed } = hunks(root, base);
  const cmd = o.testCmd ?? doc.runTests ?? detectTestCmd(pkg);
  const skip: TestRun = { pass: new Set(), fail: new Set(), ran: false, note: 'tests were not run (--no-tests)' };
  const head = o.noTests ? skip : runTests(pkg, cmd);
  const before = o.noTests || !head.ran ? skip : baseTests(root, base, pkg, cmd);
  const human = o.session ? humanMessages(o.session) : null;
  const c: Ctx = { root, pkg, added, head, before, proven: new Set() };

  const checks: Check[] = [];
  const quote = (text: string, line: number) => {
    if (!human) { checks.push({ ref: text, kind: 'said', line, ok: null, why: 'no session log on this machine' }); return; }
    const hit = human.find((h) => quoteIn(text, h.text));
    checks.push({ ref: text, kind: 'said', line, ok: !!hit, why: hit ? 'the human typed this' : "not found in the human's messages", ...(hit ? { at: quoteTime(hit, o.session!) } : {}) });
  };
  const askLines = o.spec.replace(/\r/g, '').split('\n').map((l, k) => (/^\s*ask\s/.test(l) ? k + 1 : 0)).filter(Boolean);
  let ai = 0;
  for (const d of chapters) {
    for (const a of d.asks) { const line = askLines[ai++] ?? 0; if (!a.from) quote(a.text, line); }
    for (const m of d.marks) {
      for (const p of m.proofs) checks.push({ ref: p, kind: 'proof', line: m.src, ...proofCheck(c, p) });
      for (const q of m.said) quote(q.text, m.src);
    }
  }

  // Old tests: regressed = passed before and fail now; missing = passed before and did not run (renamed or deleted).
  const both = head.ran && before.ran;
  const regressed = both ? [...before.pass].filter((n) => head.fail.has(n)) : [];
  const missing = both ? [...before.pass].filter((n) => !head.pass.has(n) && !head.fail.has(n)) : [];
  let testsLine: string | undefined;
  if (!head.ran) testsLine = head.note;
  else if (!before.ran || (before.pass.size === 0 && head.pass.size > 0)) testsLine = before.note ? `Old tests could not be run on the base (${before.note})` : 'No old tests ran on the base';

  const ignore = ignoreMatcher(readIgnore(root) + '\n' + readIgnore(pkg));
  const relPkg = relative(root, pkg).split(sep).join('/');
  const cov = coverage({
    files: changedFiles(root, base),
    proven: c.proven,
    tests: chapters.flatMap((d) => d.marks.flatMap((m) => m.proofs.filter((p) => /^test\s/.test(p)).map((p) => p.replace(/^test\s+/, '').trim()))),
    smaller: chapters.flatMap((d) => d.smaller.flatMap((s) => s.files.map((f) => (relPkg && !f.startsWith('/') ? `${relPkg}/${f}` : f.replace(/^\//, ''))).concat(s.files))),
    read: (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch { return null; } },
    ignore,
  });
  const edited = both ? editedOld({ added, removed, head: (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch { return null; } }, base: (p) => atBase(root, base, p), old: before.pass }) : [];

  return {
    oldPass: both && !testsLine ? before.pass.size : null,
    newTests: head.ran ? [...head.pass].filter((n) => !before.pass.has(n)).length : 0,
    regressed,
    ...(missing.length ? { missing } : {}),
    ...(edited.length ? { editedOld: edited } : {}),
    claims: checks.length,
    failed: checks.filter((x) => x.ok === false).length,
    unverified: checks.filter((x) => x.ok === null).length,
    checks,
    coverage: cov,
    ...(testsLine ? { testsLine } : {}),
    specHash: specHash(o.spec),
    base: shortSha(root, base),
    head: shortSha(root, 'HEAD'),
    dirty: isDirty(root),
    session: o.session ? basename(o.session) : null,
    ...(o.session ? { sessionLength: sessionLength(o.session) } : {}),
  };
}
