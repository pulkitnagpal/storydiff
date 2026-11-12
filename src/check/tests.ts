// Run the project's tests and read which names passed, from TAP output.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface TestRun { pass: Set<string>; fail: Set<string>; ran: boolean }

export const DEFAULT_TEST_CMD = 'node --test --test-reporter=tap';

export function parseTap(out: string): { pass: Set<string>; fail: Set<string> } {
  const pass = new Set<string>(), fail = new Set<string>();
  for (const ln of out.split('\n')) {
    const m = ln.match(/^\s*(not ok|ok) \d+ - (.*?)(\s+#\s*(SKIP|TODO).*)?$/i);
    if (!m || m[3]) continue;
    const name = m[2].replace(/\s+#.*$/, '').trim();
    (m[1] === 'ok' ? pass : fail).add(name);
  }
  for (const n of fail) pass.delete(n);
  return { pass, fail };
}

/** Runs `cmd` (default: node's test runner in TAP) in cwd. A folder with no package.json runs nothing. */
export function runTests(cwd: string, cmd?: string): TestRun {
  if (!cmd && !existsSync(join(cwd, 'package.json'))) return { pass: new Set(), fail: new Set(), ran: false };
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // we may be running under node --test ourselves
  const r = spawnSync(cmd || DEFAULT_TEST_CMD, { cwd, env, shell: true, encoding: 'utf8', timeout: 10 * 60_000, maxBuffer: 64 << 20 });
  return { ...parseTap((r.stdout || '') + '\n' + (r.stderr || '')), ran: true };
}
