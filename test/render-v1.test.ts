// Card behaviour added after the real-PR stress tests (plan Task 9b). The card never claims what was not checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/spec/parse.ts';
import { render } from '../src/render/card.ts';
import { edgePath } from '../src/render/map.ts';
import type { Captures, Report } from '../src/render/types.ts';

const MAP = 'code api "API"\ncode db "DB"\napi -> db\n';
const HEAD = 'pr "Shop #1" files 3\ntitle "T"\nby "Maya" with "Claude Code"\nask "Do it."\ndid "Did it."\n';
const rep = (o: Partial<Report> = {}): Report => ({ oldPass: 3, newTests: 0, regressed: [], claims: 2, failed: 0, checks: [], ...o });
const verdict = (h: string) => h.slice(h.indexOf('aria-label="Verdict"'), h.indexOf('</section>', h.indexOf('aria-label="Verdict"')));
const card = (spec: string, caps: Captures = { shows: [] }, r: Report = rep()) => render(parse(spec), caps, r);

test('no watch items and no same capture: "Nothing flagged", grey, no tick', () => {
  const h = card(HEAD + MAP + '+ "x"');
  assert.match(verdict(h), /Nothing flagged/);
  assert.doesNotMatch(h, /Nothing to try|Every reply matched/);
});

test('"Nothing to try" needs at least one same capture, all matched', () => {
  const spec = HEAD + 'show same "List" GET /x\n' + MAP + '+ "x"';
  assert.match(verdict(card(spec, { shows: [{ kind: 'same', match: true, diff: null }] })), /✓ Nothing to try/);
  const differs = card(spec, { shows: [{ kind: 'same', match: false, diff: [{ at: '$.body.tags', after: ['a'] }] }] });
  assert.match(verdict(differs), /Nothing flagged/);
  assert.doesNotMatch(differs, /Every reply matched/);
  assert.match(differs, /\$\.body\.tags/);
});

test('unchecked or uncounted: no chip gets a tick or the green tone', () => {
  for (const r of [rep({ unchecked: true, oldPass: null }), rep({ oldPass: null })]) {
    const v = verdict(card(HEAD + 'show same "List" GET /x\n' + MAP + '+ "x"', { shows: [{ kind: 'same', match: true, diff: null }] }, r));
    assert.doesNotMatch(v, /✓/);
    assert.doesNotMatch(v, /#E3F1EF/);
  }
});

test('a typed capture is stamped illustrative, and the verdict says not captured', () => {
  const h = card(HEAD + 'show call GET /x\n' + MAP + '+ "x"', { shows: [{ kind: 'call', typed: true, before: { status: 200, json: { a: 1 } }, after: { status: 200, json: { a: 2 } } }] });
  assert.match(h, /illustrative · from code/);
  assert.match(verdict(h), /1 picture not captured/);
});

test('no agent session: no "with …" in the header, no "…\'s session" in the footer', () => {
  const h = card(HEAD.replace(' with "Claude Code"', '') + MAP + '+ "x"');
  const header = h.slice(h.indexOf('<header'), h.indexOf('</header>'));
  assert.doesNotMatch(header, /with/);
  assert.doesNotMatch(h.slice(h.indexOf('<footer')), /session/);
  assert.match(h, /<span class="lbl">Maya did<\/span>/);
});

test('ask from someone else, and later asks as "then:"', () => {
  const h = card(HEAD.replace('ask "Do it."', 'ask "Fix the crash." from "davidism" in "#1484"\nask "Keep the old flag."\nask "And the docs."\nask "Fourth."') + MAP + '+ "x"');
  assert.match(h, /<span class="lbl"[^>]*>davidism asked \(#1484\)<\/span>/);
  assert.match(h, /then: Keep the old flag\./);
  assert.match(h, /then: And the docs\./);
  assert.doesNotMatch(h, /Fourth/);
});

test('coverage chip', () => {
  assert.match(verdict(card(HEAD + MAP + '+ "x"', { shows: [] }, rep({ coverage: { files: 5, covered: 5, uncovered: [] } }))), /✓ Covers all 5 changed files/);
  const v = verdict(card(HEAD + MAP + '+ "x"', { shows: [] }, rep({ coverage: { files: 5, covered: 3, uncovered: ['a.ts', 'b.ts'] } })));
  assert.match(v, /background: #B42318[^>]*>✗ 2 files not covered/);
});

test('edited old tests get their own chip', () => {
  assert.match(verdict(card(HEAD + MAP + '+ "x"', { shows: [] }, rep({ editedOld: ['a', 'b'] }))), /✎ 2 old tests edited/);
});

test('watch items in a "+" chapter count in the main card', () => {
  const src = HEAD + 'chapters "Main", "+ 3 smaller changes"\nchapter 1\n' + MAP + '+ "x"\n! "try one"\nchapter 2\n! "Check the logs."\n! "And the cron."';
  assert.match(verdict(render(parse(src), { shows: [] }, rep())), /3 things to try/);
});

test('breaks for callers is its own group, first, in red', () => {
  const h = card(HEAD + MAP + '+ "x"\nx api "connect() is now open()."');
  const list = h.slice(h.indexOf('aria-label="The list"'));
  assert.ok(list.indexOf('Breaks for callers') < list.indexOf('>New<'));
  assert.match(list, /color: #B42318">Breaks for callers/);
  assert.match(list, /class="n r">1</);
});

test('smaller lines fold into one row', () => {
  assert.match(card(HEAD + MAP + '+ "x"\nsmaller "Typos" files a.md\nsmaller "Lint" files b.ts'), /\+ 2 smaller changes/);
});

test('a brand-new route: call with before null draws the after alone, tagged NEW', () => {
  const h = card(HEAD + 'show call POST /api/tags\n' + MAP + '+ "x"', { shows: [{ kind: 'call', before: null, after: { status: 201, json: { id: 1 } } }] });
  assert.equal((h.match(/class="json"/g) || []).length, 1);
  assert.match(h, /NEW · there was no reply before/);
});

test('a removed route and a new screen use their forms', () => {
  const gone = card(HEAD + 'show call GET /old\n' + MAP + '+ "x"', { shows: [{ kind: 'call', before: { status: 200, json: { a: 1 } }, after: null }] });
  assert.match(gone, /REMOVED/);
  assert.match(gone, /text-decoration: line-through/);
  const fresh = card(HEAD + 'show screen /tags\n' + MAP + '+ "x"', { shows: [{ kind: 'screen', before: null, after: 'data:image/png;base64,AA', rects: [] }] });
  assert.equal((fresh.match(/class="win"/g) || []).length, 1);
  assert.match(fresh, /NEW · this page did not exist/);
});

test('terminal: two dark panels with the command, the last lines, the exit code; new lines and pins marked', () => {
  const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  const h = card(HEAD + 'show terminal "shop sync"\n' + MAP + '! "Check the sync count."\n    pin line "0 failed"', { shows: [{ kind: 'terminal', cmd: 'shop sync', before: { exit: 0, lines: [...lines, '3 synced'], total: 21 }, after: { exit: 1, lines: [...lines, '3 synced', '0 failed'], total: 22 } }] });
  assert.equal((h.match(/class="term"/g) || []).length, 2);
  assert.match(h, /\$ shop sync/);
  assert.doesNotMatch(h, /line 0</, 'only the last 12 lines');
  assert.match(h, /exit 0/);
  assert.match(h, /exit 1/);
  assert.match(h, /class="tl new pin">0 failed<span class="mki o">1</);
});

test('screen pins on the before side use the before rects', () => {
  const h = card(HEAD + 'show screen /\n' + MAP + '! "It crashed before."\n    pin before screen ".err"', { shows: [{ kind: 'screen', before: 'data:image/png;base64,AA', after: 'data:image/png;base64,AA', rects: [], rectsBefore: [{ sel: '.err', found: true, x: 10, y: 20, w: 30, h: 10 }] }] });
  const before = h.slice(h.indexOf('BEFORE'), h.indexOf('AFTER'));
  assert.match(before, /class="mk o"[^>]*>1</);
});

test('a box from another repo is dashed and tagged', () => {
  const h = card(HEAD + 'service auth "Auth" in "orchestrator#981"\n' + MAP + 'api -> auth\n+ "x"');
  assert.match(h, /class="sb ext"[^>]*>Auth<span class="rt">orchestrator#981<\/span>/);
});

test('the X on a removed cross-row arrow sits on the curve, not at the corner', () => {
  const a = { x: 10, y: 22, w: 104, h: 40, col: 0, row: 1 as const }, b = { x: 170, y: 92, w: 104, h: 40, col: 1, row: 2 as const };
  const p = edgePath(a, b);
  const nums = p.d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  const [x0, y0, x1, y1, x2, y2, x3, y3] = nums;
  const bx = 0.125 * x0 + 0.375 * x1 + 0.375 * x2 + 0.125 * x3, by = 0.125 * y0 + 0.375 * y1 + 0.375 * y2 + 0.125 * y3;
  assert.ok(Math.abs(p.mx - bx) < 0.5 && Math.abs(p.my - by) < 0.5, `${p.mx},${p.my} vs ${bx},${by}`);
});

test('code-like tokens never break', () => {
  const h = card(HEAD + MAP + '+ "Run with --dry-run first, see config.toml and parse()."');
  assert.match(h, /<span class="nw">--dry-run<\/span>/);
  assert.match(h, /<span class="nw">config\.toml<\/span>/);
  assert.match(h, /<span class="nw">parse\(\)<\/span>/);
});

test('long outcome values shrink to fit', () => {
  const h = card(HEAD + 'show scenario "slow"\n' + MAP + '+ "x"', { shows: [{ kind: 'scenario', before: { steps: [['A', 'b']], outcome: { big: '0.04 s', small: 'ok', tone: 'good' } }, after: { steps: [['A', 'b']], outcome: { big: '12,345,678 rows', small: 'ok', tone: 'watch' } } }] });
  assert.match(h, /<b style="color: #C2410C; font-size: 1[0-9]px">12,345,678 rows<\/b>/);
});

test('a "+" chapter card is the list only', () => {
  const src = HEAD + 'chapters "Main", "+ 3 smaller changes"\nchapter 1\n' + MAP + '+ "x"\nchapter 2\n! "Check the logs."\n+ "Typos."';
  const h = render(parse(src).rest[0], { shows: [] }, rep());
  assert.doesNotMatch(h, /What changed underneath/);
  assert.match(h, /Check the logs\./);
});

test('quote times come from the check when it has them', () => {
  const src = HEAD + 'chapters "Main", "Other"\nchapter 1\n' + MAP + '+ "x"\n    said "keep it"\nchapter 2\n' + MAP + '+ "y"';
  const h = render(parse(src), { shows: [] }, rep({ checks: [{ ref: 'keep it', kind: 'said', ok: true, why: 'the human typed this', at: 'day 7, 14:02' }] }));
  assert.match(h, /“keep it” · Maya, day 7, 14:02/);
});
