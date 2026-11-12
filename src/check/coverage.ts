// Coverage: a card must account for every file the PR changes, so no part of it can be left out.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_IGNORE = ['*.lock', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', '**/dist/**', '*.snap', 'handover.storydiff', '**/.storydiff/**', '.storydiffignore'];

function globRe(glob: string): RegExp {
  let g = glob.trim().replace(/\/$/, '/**');
  const anchored = g.includes('/') && !g.startsWith('**/');
  g = g.replace(/^\//, '');
  const body = g.split(/(\*\*\/?|\*|\?)/).map((p) => (p === '**/' || p === '**' ? '(?:.*/)?' + (p === '**' ? '.*' : '') : p === '*' ? '[^/]*' : p === '?' ? '[^/]' : p.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).join('');
  return new RegExp((anchored ? '^' : '(?:^|/)') + body + '$');
}

/** A matcher for the default ignore list plus the lines of .storydiffignore (gitignore-style globs, # comments). */
export function ignoreMatcher(extra: string): (path: string) => boolean {
  const res = [...DEFAULT_IGNORE, ...extra.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))].map(globRe);
  return (p) => res.some((r) => r.test(p));
}

export function readIgnore(root: string): string {
  const f = join(root, '.storydiffignore');
  return existsSync(f) ? readFileSync(f, 'utf8') : '';
}

export interface CoverageInput {
  files: string[];
  /** Files a file:line proof resolved to (repo-relative). */
  proven: Set<string>;
  /** Test names cited by proofs. */
  tests: string[];
  /** Globs from smaller lines (repo-relative or relative to the spec's folder). */
  smaller: string[];
  read: (path: string) => string | null;
  ignore: (path: string) => boolean;
}

export function coverage(o: CoverageInput): { files: number; covered: number; uncovered: string[] } {
  const counted = o.files.filter((f) => !o.ignore(f));
  const small = o.smaller.map(globRe);
  const uncovered = counted.filter((f) => {
    if (o.proven.has(f) || small.some((r) => r.test(f))) return false;
    if (o.tests.length) { const text = o.read(f); if (text && o.tests.some((t) => text.includes(t))) return false; }
    return true;
  });
  return { files: counted.length, covered: counted.length - uncovered.length, uncovered };
}
