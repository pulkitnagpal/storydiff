// Run the project's tests and read which names passed, for any common stack.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface TestRun { pass: Set<string>; fail: Set<string>; ran: boolean; note?: string }

/** The test command for a folder, from its manifest. null = nothing to run. */
export function detectTestCmd(dir: string): string | null {
  const has = (f: string) => existsSync(join(dir, f));
  if (has('package.json')) {
    let script = '';
    try { script = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts?.test ?? ''; } catch { /* broken package.json */ }
    if (/no test specified/.test(script) || !script) return null;
    return /^\s*node\s+(--[\w-]+\s+)*--test\b/.test(script) ? 'node --test --test-reporter=tap' : 'npm test --silent';
  }
  if (has('Cargo.toml')) return 'cargo test --no-fail-fast 2>&1';
  if (has('go.mod')) return 'go test -v ./... 2>&1';
  if (['pyproject.toml', 'setup.py', 'setup.cfg', 'pytest.ini', 'tox.ini'].some(has)) return 'python3 -m pytest -v -rA -p no:cacheprovider 2>&1';
  return null;
}

/** Pass and fail per test name, from TAP, cargo, pytest, go test -v, and jest/vitest/node spec output. */
export function parseResults(out: string): { pass: Set<string>; fail: Set<string> } {
  const pass = new Set<string>(), fail = new Set<string>();
  const add = (ok: boolean, name: string) => { name = name.trim().replace(/\\#/g, '#'); if (name) (ok ? pass : fail).add(name); };
  for (const raw of out.split('\n')) {
    const ln = raw.replace(/\x1b\[[0-9;]*m/g, '');
    let m: RegExpMatchArray | null;
    if ((m = ln.match(/^\s*(not ok|ok) \d+ - (.*?)(\s+#\s*(SKIP|TODO)\b.*)?$/i))) { if (!m[3]) add(m[1] === 'ok', m[2].replace(/\s+#.*$/, '')); continue; }
    if ((m = ln.match(/^test (\S+) \.\.\. (ok|FAILED)\s*$/))) { add(m[2] === 'ok', m[1]); continue; }
    if ((m = ln.match(/^(\S+::\S+)\s+(PASSED|FAILED|ERROR)\b/)) || (m = ln.match(/^(PASSED|FAILED|ERROR) (\S+::\S+)/))) {
      const [name, st] = m[1].includes('::') ? [m[1], m[2]] : [m[2], m[1]];
      add(st === 'PASSED', name);
      continue;
    }
    if ((m = ln.match(/^\s*--- (PASS|FAIL): (\S+)/))) { add(m[1] === 'PASS', m[2]); continue; }
    if ((m = ln.match(/^\s*(✓|√|✔)\s+(.+?)(\s+\(\d+(\.\d+)?\s*m?s\))?\s*$/))) { add(true, m[2]); continue; }
    if ((m = ln.match(/^\s*(✕|×|✗|✖)\s+(.+?)(\s+\(\d+(\.\d+)?\s*m?s\))?\s*$/))) { add(false, m[2]); continue; }
  }
  for (const n of fail) pass.delete(n);
  return { pass, fail };
}

/** The test a proof names: the exact name, or the last part of a qualified one (::, " > ", /, .). */
export function testMatches(names: Set<string>, want: string): string | null {
  if (names.has(want)) return want;
  for (const n of names) for (const sep of ['::', ' > ', '/', '.']) if (n.endsWith(sep + want)) return n;
  return null;
}

/** Runs `cmd` in cwd. A command that prints no test results counts as not run, never as "0 tests passed". */
export function runTests(cwd: string, cmd: string | null): TestRun {
  if (!cmd) return { pass: new Set(), fail: new Set(), ran: false, note: 'no test command found' };
  const env = { ...process.env };
  for (const k of ['NODE_TEST_CONTEXT', 'STORYDIFF_BIN']) delete env[k]; // we may be running under node --test ourselves
  const r = spawnSync(cmd, { cwd, env, shell: true, encoding: 'utf8', timeout: 15 * 60_000, maxBuffer: 256 << 20 });
  const res = parseResults((r.stdout || '') + '\n' + (r.stderr || ''));
  if (!res.pass.size && !res.fail.size) {
    const why = r.error ? r.error.message : r.signal ? `stopped by ${r.signal}` : `exited ${r.status} with no test results`;
    return { ...res, ran: false, note: `Tests could not be read (${cmd.replace(/\s*2>&1$/, '')}: ${why})` };
  }
  return { ...res, ran: true };
}
