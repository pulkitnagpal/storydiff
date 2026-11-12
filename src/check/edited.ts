// Old tests whose assertions changed in this PR: a reviewer must know when a test was bent to pass.
const TEST_FILE = /(^|\/)(tests?|__tests__|spec)\/|[._-](test|spec)\.[cm]?[jt]sx?$|_test\.(go|py)$|(^|\/)test_[^/]*\.py$|\.rs$/;
const ASSERT = /\b(assert\w*|expect|should|t\.(Error|Fatal|Fail)\w*|require\.\w+|verify)\b|assert(_eq|_ne)?!/;
const DECL: RegExp[] = [
  /\b(?:test|it)(?:\.\w+)?\s*\(\s*(['"`])((?:(?!\1).)+)\1/, // JS: test('name'
  /^\s*(?:async\s+)?def\s+(test_\w+)/, // pytest
  /^\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*\(/, // Rust (inside #[test])
  /^func\s+(Test\w+)\s*\(/, // Go
];

/** The name of the test declared nearest above `line` (1-based) in `text`. */
function testAt(text: string, line: number): string | null {
  const lines = text.split('\n');
  for (let k = Math.min(line, lines.length) - 1; k >= 0; k--) {
    for (const re of DECL) { const m = lines[k].match(re); if (m) return m[2] ?? m[1]; }
  }
  return null;
}

export interface EditedInput {
  added: Record<string, number[]>;
  removed: Record<string, number[]>;
  head: (path: string) => string | null;
  base: (path: string) => string | null;
  /** Names of tests that existed (passed) before. */
  old: Set<string>;
}

export function editedOld(o: EditedInput): string[] {
  const out = new Set<string>();
  const scan = (changes: Record<string, number[]>, read: (p: string) => string | null) => {
    for (const [file, lines] of Object.entries(changes)) {
      if (!TEST_FILE.test(file) || lines.includes(-1)) continue;
      const text = read(file);
      if (!text) continue;
      const src = text.split('\n');
      for (const n of lines) {
        if (!ASSERT.test(src[n - 1] ?? '')) continue;
        const name = testAt(text, n);
        if (!name) continue;
        const hit = [...o.old].find((t) => t === name || t.endsWith('::' + name) || t.endsWith('/' + name) || t.endsWith(' > ' + name));
        if (hit) out.add(hit);
      }
    }
  };
  scan(o.added, o.head);
  scan(o.removed, o.base);
  return [...out].sort();
}
