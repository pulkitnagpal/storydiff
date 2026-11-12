// storydiff check: does every line of the handover hold up against the code, the tests and the human's own words?
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { parse } from '../spec/parse.ts';
import type { Check, Report } from '../render/types.ts';
import { changedLines, defaultBase, shortSha } from './git.ts';
import { humanMessages, mmss, normQuote, sessionLength } from './session.ts';
import { runTests, type TestRun } from './tests.ts';

export { defaultBase, changedLines } from './git.ts';
export { findSession, humanMessages, sessionLength } from './session.ts';
export { runTests, parseTap, DEFAULT_TEST_CMD } from './tests.ts';

export interface CheckOptions {
  repo: string;
  /** The handover text. */
  spec: string;
  /** Base ref; defaults to where the branch left main. */
  base?: string;
  /** Session log path; null = none on this machine (quotes cannot be checked). */
  session?: string | null;
  /** Test command printing TAP; defaults to node's test runner. */
  testCmd?: string;
  /** Skip running tests (CI may run them separately). */
  noTests?: boolean;
}

/** The same tests on the base commit, in a scratch copy of it. */
function baseTests(repo: string, base: string, cmd?: string): TestRun {
  const tmp = mkdtempSync(join(tmpdir(), 'sd-base-'));
  try {
    execFileSync('sh', ['-c', 'git -C "$1" archive "$2" | tar -x -C "$3"', 'sh', repo, base, tmp]);
    if (existsSync(join(repo, 'node_modules')) && !existsSync(join(tmp, 'node_modules'))) symlinkSync(join(repo, 'node_modules'), join(tmp, 'node_modules'));
    return runTests(tmp, cmd);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

function proofCheck(repo: string, p: string, changed: Record<string, number[]>, head: TestRun, before: TestRun): Pick<Check, 'ok' | 'why'> {
  const fl = p.match(/^([\w./@+-]+):(\d+)(?:-(\d+))?$/);
  const tn = p.match(/^test\s+(.+?)(:.*)?$/);
  if (fl) {
    const f = fl[1], n = Number(fl[3] ?? fl[2]);
    const hit = Object.keys(changed).find((k) => k === f || k.endsWith('/' + f));
    const path = join(repo, hit ?? f);
    if (!existsSync(path)) return { ok: false, why: `${f} does not exist` };
    const lines = readFileSync(path, 'utf8').replace(/\n$/, '').split('\n').length;
    if (n > lines) return { ok: false, why: `${f} has only ${lines} lines` };
    const near = hit ? changed[hit].some((k) => k === -1 || Math.abs(k - n) <= 3) : false;
    return { ok: true, why: near ? 'line changed in this PR' : 'line exists, not changed in this PR' };
  }
  if (tn) {
    const name = tn[1].trim();
    if (!head.ran) return { ok: null, why: 'tests were not run' };
    if (head.pass.has(name)) return { ok: true, why: before.pass.has(name) ? 'passes (old test)' : 'passes (new test)' };
    if (head.fail.has(name)) return { ok: false, why: 'test fails' };
    return { ok: false, why: 'no test with this name ran' };
  }
  return { ok: null, why: 'not a kind of proof the checker knows: use file:line or test <name>' };
}

export async function check(o: CheckOptions): Promise<Report> {
  const doc = parse(o.spec);
  const base = o.base ?? defaultBase(o.repo);
  const changed = changedLines(o.repo, base);
  const skip: TestRun = { pass: new Set(), fail: new Set(), ran: false };
  const head = o.noTests ? skip : runTests(o.repo, o.testCmd);
  const before = o.noTests ? skip : baseTests(o.repo, base, o.testCmd);
  const human = o.session ? humanMessages(o.session) : null;

  const checks: Check[] = [];
  for (const m of doc.marks) {
    for (const p of m.proofs) checks.push({ ref: p, kind: 'proof', line: m.src, ...proofCheck(o.repo, p, changed, head, before) });
    for (const q of m.said) {
      if (!human) { checks.push({ ref: q.text, kind: 'said', line: m.src, ok: null, why: 'no session log on this machine' }); continue; }
      const hit = human.find((h) => normQuote(h.text).includes(normQuote(q.text)));
      checks.push({ ref: q.text, kind: 'said', line: m.src, ok: !!hit, why: hit ? 'the human typed this' : "not found in the human's messages", ...(hit ? { at: mmss(hit.atMs) } : {}) });
    }
  }
  const regressed = [...before.pass].filter((n) => !head.pass.has(n));
  return {
    oldPass: head.ran ? before.pass.size : null,
    newTests: [...head.pass].filter((n) => !before.pass.has(n)).length,
    regressed,
    claims: checks.length,
    failed: checks.filter((c) => c.ok !== true).length,
    checks,
    base: shortSha(o.repo, base),
    head: shortSha(o.repo, 'HEAD'),
    session: o.session ? basename(o.session) : null,
    ...(o.session ? { sessionLength: sessionLength(o.session) } : {}),
  };
}
