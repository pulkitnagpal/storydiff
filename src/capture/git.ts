// The base version lives in a temporary, detached git worktree. Removing it never throws.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

export function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export function repoRoot(dir: string): string {
  try { return git(dir, 'rev-parse', '--show-toplevel').trim(); }
  catch { throw new Error(`${dir} is not inside a git repository`); }
}

export function resolveCommit(repo: string, ref: string): string {
  if (ref.startsWith('-')) throw new Error(`"${ref}" is not a git ref`);
  try { return git(repo, 'rev-parse', '--verify', '--quiet', ref + '^{commit}').trim(); }
  catch { throw new Error(`--base ${ref}: no such commit, branch or tag in this repository`); }
}

// The merge-base with origin/HEAD, else main, else master.
export function defaultBase(repo: string): string {
  for (const ref of ['origin/HEAD', 'main', 'master']) {
    try { git(repo, 'rev-parse', '--verify', '--quiet', ref + '^{commit}'); } catch { continue; }
    try { return git(repo, 'merge-base', 'HEAD', ref).trim(); } catch { return ref; }
  }
  throw new Error('no --base given and no origin/HEAD, main or master to compare with');
}

export type Worktree = { dir: string; remove(): void };

// Checks out `sha` in <real tmp dir>/<repo name>. The real path matters: on macOS the temp dir is a
// symlink (/var -> /private/var), and apps that compare paths (or git itself) get confused by it.
export function addWorktree(repo: string, sha: string, tmpRoot: string = tmpdir()): Worktree {
  const parent = realpathSync(mkdtempSync(join(realpathSync(tmpRoot), 'storydiff-base-')));
  const dir = join(parent, basename(repo));
  let added = false;
  const remove = () => {
    if (added) {
      try { git(repo, 'worktree', 'remove', '--force', '--force', dir); } catch { /* fall through to rm + prune */ }
    }
    rmSync(parent, { recursive: true, force: true });
    if (added) { try { git(repo, 'worktree', 'prune'); } catch { /* the repo itself may be gone */ } }
  };
  try {
    git(repo, 'worktree', 'add', '--detach', '--quiet', dir, sha);
    added = true;
  } catch (e) {
    remove();
    throw new Error(`could not check out the base version: ${((e as { stderr?: string }).stderr || (e as Error).message).trim()}`);
  }
  // Dependencies are not in git. Borrow the head's node_modules so the base can start without an install.
  const nm = join(repo, 'node_modules');
  if (existsSync(nm) && !existsSync(join(dir, 'node_modules'))) {
    try { symlinkSync(nm, join(dir, 'node_modules'), 'dir'); } catch { /* best effort */ }
  }
  return { dir, remove };
}
