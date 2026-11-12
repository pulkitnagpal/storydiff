import { execFileSync } from 'node:child_process';

// Fixed options so user git config (noprefix, mnemonic prefixes, quoted paths, external diff) cannot change the output.
const FIXED = ['-c', 'core.quotepath=off', '-c', 'diff.noprefix=false', '-c', 'diff.mnemonicPrefix=false'];

export const git = (repo: string, ...args: string[]) =>
  execFileSync('git', ['-C', repo, ...FIXED, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 << 20 });

const tryGit = (repo: string, ...args: string[]) => { try { return git(repo, ...args).trim(); } catch { return ''; } };

/** A ref resolved to a commit sha, so nothing after it is read as a git option. */
export function resolveCommit(repo: string, ref: string): string {
  const sha = tryGit(repo, 'rev-parse', '--verify', '--quiet', '--end-of-options', ref + '^{commit}');
  if (!/^[0-9a-f]{7,64}$/.test(sha)) throw new Error(`${ref} is not a commit in this repo`);
  return sha;
}

/** Where this branch left the main line: merge-base with origin/HEAD, else main, else master. */
export function defaultBase(repo: string): string {
  for (const ref of ['origin/HEAD', 'origin/main', 'main', 'origin/master', 'master']) {
    const mb = tryGit(repo, 'merge-base', 'HEAD', ref);
    if (mb) return mb;
  }
  throw new Error('could not find a base: no origin/HEAD, main or master. Pass --base <ref>.');
}

export const shortSha = (repo: string, ref: string) => tryGit(repo, 'rev-parse', '--short', ref);
export const isDirty = (repo: string) => tryGit(repo, 'status', '--porcelain', '--untracked-files=no') !== '';

export interface Hunks {
  /** Lines added or changed in the new code, per file (-1 = the whole file is new). */
  added: Record<string, number[]>;
  /** Lines removed or changed, by their line number in the base version. */
  removed: Record<string, number[]>;
}

/** Changed lines since base, counting uncommitted and untracked files (the agent may not have committed yet). */
export function hunks(repo: string, base: string): Hunks {
  const added: Record<string, number[]> = {}, removed: Record<string, number[]> = {};
  let file: string | null = null, oldFile: string | null = null;
  const diff = git(repo, 'diff', '-U0', '--no-color', '--no-ext-diff', '--no-renames', '--src-prefix=a/', '--dst-prefix=b/', base);
  for (const ln of diff.split('\n')) {
    const o = ln.match(/^--- (?:a\/(.*?)|\/dev\/null)\t?$/);
    if (o) { oldFile = o[1] ?? null; continue; }
    const f = ln.match(/^\+\+\+ (?:b\/(.*?)|\/dev\/null)\t?$/);
    if (f) { file = f[1] ?? null; if (file) added[file] ??= []; if (oldFile) removed[oldFile] ??= []; continue; }
    const h = ln.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!h) continue;
    const oa = Number(h[1]), on = h[2] === undefined ? 1 : Number(h[2]);
    const na = Number(h[3]), nn = h[4] === undefined ? 1 : Number(h[4]);
    if (file) for (let k = na; k < na + nn; k++) added[file].push(k);
    if (oldFile) for (let k = oa; k < oa + on; k++) removed[oldFile].push(k);
  }
  for (const f of untracked(repo)) added[f] = [-1];
  return { added, removed };
}

const untracked = (repo: string) => git(repo, 'ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean);

/** Every file that differs from base (added, changed, deleted or untracked), relative to the repo root. */
export function changedFiles(repo: string, base: string): string[] {
  const out = new Set(git(repo, 'diff', '--name-only', '--no-renames', '-z', base).split('\0').filter(Boolean));
  for (const f of untracked(repo)) out.add(f);
  return [...out].sort();
}

/** A file's text at base, or null when it did not exist there. */
export function atBase(repo: string, base: string, path: string): string | null {
  try { return git(repo, 'show', `${base}:${path}`); } catch { return null; }
}

export const gitRoot = (dir: string) => tryGit(dir, 'rev-parse', '--show-toplevel');
