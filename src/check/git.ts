import { execFileSync } from 'node:child_process';

export const git = (repo: string, ...args: string[]) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 });

const tryGit = (repo: string, ...args: string[]) => { try { return git(repo, ...args).trim(); } catch { return ''; } };

/** Where this branch left the main line: merge-base with origin/HEAD, else main, else master. */
export function defaultBase(repo: string): string {
  for (const ref of ['origin/HEAD', 'origin/main', 'main', 'origin/master', 'master']) {
    const mb = tryGit(repo, 'merge-base', 'HEAD', ref);
    if (mb) return mb;
  }
  throw new Error('could not find a base: no origin/HEAD, main or master. Pass --base <ref>.');
}

export const shortSha = (repo: string, ref: string) => tryGit(repo, 'rev-parse', '--short', ref);

/** Lines added or changed since base, per file, counting uncommitted and untracked files (the agent may not have committed yet). */
export function changedLines(repo: string, base: string): Record<string, number[]> {
  const changed: Record<string, number[]> = {};
  let file: string | null = null;
  for (const ln of git(repo, 'diff', '-U0', '--no-color', '--no-ext-diff', base).split('\n')) {
    const f = ln.match(/^\+\+\+ (?:b\/(.*)|\/dev\/null)$/);
    if (f) { file = f[1] ?? null; if (file) changed[file] ??= []; continue; }
    const h = ln.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (h && file) { const a = Number(h[1]), n = h[2] === undefined ? 1 : Number(h[2]); for (let k = a; k < a + n; k++) changed[file].push(k); }
  }
  for (const f of git(repo, 'ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean)) changed[f] = [-1]; // every line is new
  return changed;
}
