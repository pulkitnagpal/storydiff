// CI re-checks code and test proofs. It cannot re-check `said` quotes: the session log never leaves
// the author's machine. So quotes come from the check result `storydiff publish` stored with the
// spec, marked as checked there.
//
// Report contract (docs/v1-build.md):
//   { oldPass, newTests, regressed: [], claims, failed, checks: [{ ref, kind: "proof"|"said", ok, why, at? }], head? }

const NOT_CHECKED = "not checked: the session log stays on the author's machine, and the PR has no check result from it";

/**
 * @param {object} ci      report written by `storydiff check` in CI
 * @param {object|null} author  report published with the spec (from the author's machine)
 * @param {{ strictQuotes?: boolean }} opts
 */
export function mergeAuthorQuotes(ci, author, opts = {}) {
  const strict = !!opts.strictQuotes;
  const checks = Array.isArray(ci && ci.checks) ? ci.checks : [];
  const theirs = (author && Array.isArray(author.checks) ? author.checks : []).filter(c => c && c.kind === 'said');
  const ours = checks.filter(c => c.kind === 'said');
  const used = new Set();
  // Match by ref first. Fall back to position only when both sides list the same number of quotes.
  const byPosition = theirs.length === ours.length;
  let k = -1;

  const merged = checks.map(c => {
    if (c.kind !== 'said') return { ...c, where: 'ci' };
    k++;
    let j = theirs.findIndex((a, idx) => !used.has(idx) && a.ref === c.ref);
    if (j < 0 && byPosition && !used.has(k)) j = k;
    if (j < 0) return { ...c, ok: null, why: NOT_CHECKED, where: 'none' };
    used.add(j);
    const a = theirs[j];
    return { ...c, ok: a.ok, why: a.why || c.why, at: a.at || c.at, where: 'author' };
  });

  const counts = (c) => c.ok === false || (c.ok !== true && (c.kind !== 'said' || c.where !== 'none' || strict));
  return {
    ...ci,
    regressed: Array.isArray(ci && ci.regressed) ? ci.regressed : [],
    claims: typeof (ci && ci.claims) === 'number' ? ci.claims : merged.length,
    checks: merged,
    failed: merged.filter(counts).length,
    unverified: merged.filter((c) => c.ok == null && !counts(c)).length,
    quotesCheckedAt: author && author.head ? author.head : null,
    quotesUnchecked: merged.filter(c => c.where === 'none').length,
  };
}

/** The commit status for one or more chapter reports. */
export function verdict(reports) {
  const list = [].concat(reports).filter(Boolean);
  const regressed = new Set(list.flatMap(r => r.regressed || []));
  const failed = list.reduce((n, r) => n + (r.failed || 0), 0);
  const claims = list.reduce((n, r) => n + (r.claims || 0), 0);
  const unchecked = list.reduce((n, r) => n + (r.quotesUnchecked || 0), 0);
  const oldPass = list.reduce((n, r) => n + (r.oldPass || 0), 0);
  // Every changed file must be on the card (core's check exits 1 on this too).
  const uncovered = new Set(list.flatMap(r => (r.coverage && r.coverage.uncovered) || []));
  const parts = [];
  let state = 'success';
  if (regressed.size) { state = 'failure'; parts.push(`✗ ${regressed.size} old test${regressed.size === 1 ? '' : 's'} now fail${regressed.size === 1 ? 's' : ''}`); }
  if (failed) { state = 'failure'; parts.push(`✗ ${failed} of ${claims} claims don't hold up`); }
  if (uncovered.size) { state = 'failure'; parts.push(`✗ ${uncovered.size} file${uncovered.size === 1 ? '' : 's'} not covered`); }
  if (state === 'success') parts.push(`✓ ${claims} claims checked`, `${oldPass} old tests pass`);
  if (unchecked) parts.push(`${unchecked} quote${unchecked === 1 ? '' : 's'} not checked`);
  return { state, description: truncate(parts.join(' · '), 140) };
}

function truncate(s, n) { return s.length <= n ? s : s.slice(0, n - 1) + '…'; }
