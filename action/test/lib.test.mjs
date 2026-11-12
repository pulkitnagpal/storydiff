import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSpecs, chapterOf, hasShows, START, END } from '../lib/spec-source.mjs';
import { mergeAuthorQuotes, verdict } from '../lib/report.mjs';
import { buildComment, findSticky, MARKER } from '../lib/comment.mjs';
import { cardPath, cardUrl } from '../lib/cards.mjs';

const SPEC = 'title "Tags for links"\nask "Add tags"\nshow screen /\ncode a "A"\n+ "Tags." \n    proof db.js:12\n    said "in their own table"\n';
const REPORT = { oldPass: 3, newTests: 6, regressed: [], claims: 2, failed: 0, head: 'abcdef1234567', checks: [
  { ref: 'db.js:12', kind: 'proof', ok: true, why: 'found' },
  { ref: 'in their own table', kind: 'said', ok: true, why: 'matches', at: '03:11' },
] };

test('extracts the block publish writes, with its report', () => {
  const body = `Some words.\n\n${START}\n\`\`\`storydiff\n${SPEC}\`\`\`\n<!-- storydiff-report ${JSON.stringify(REPORT)} -->\n${END}\n\nMore words.`;
  const [one, ...more] = extractSpecs(body);
  assert.equal(more.length, 0);
  assert.equal(one.spec, SPEC);
  assert.equal(one.report.head, 'abcdef1234567');
});

test('extracts a bare block pasted by hand, with CRLF line ends', () => {
  const body = 'Hi\r\n\r\n```storydiff\r\ntitle "X"\r\n```\r\n';
  assert.deepEqual(extractSpecs(body), [{ spec: 'title "X"\n', report: null }]);
});

test('extracts one block per chapter, each with its own report', () => {
  const block = (t, r) => `\`\`\`storydiff\ntitle "${t}"\nchapter ${r}\n\`\`\`\n<!-- storydiff-report {"n":${r}} -->\n`;
  const specs = extractSpecs(`${START}\n${block('A', 1)}\n${block('B', 2)}${END}`);
  assert.equal(specs.length, 2);
  assert.deepEqual(specs.map(s => s.report.n), [1, 2]);
  assert.deepEqual(specs.map(s => chapterOf(s.spec)), [1, 2]);
});

test('a broken report comment is ignored, not fatal', () => {
  const [one] = extractSpecs('```storydiff\ntitle "X"\n```\n<!-- storydiff-report {nope -->');
  assert.equal(one.report, null);
});

test('no block, no spec', () => {
  assert.deepEqual(extractSpecs('```js\nx\n```'), []);
  assert.deepEqual(extractSpecs(''), []);
  assert.equal(hasShows(SPEC), true);
  assert.equal(hasShows('title "x"'), false);
});

const ciReport = (over = {}) => ({ oldPass: 3, newTests: 6, regressed: [], claims: 2, failed: 1, checks: [
  { ref: 'db.js:12', kind: 'proof', ok: true, why: 'found' },
  { ref: 'in their own table', kind: 'said', ok: null, why: 'no session log on this machine' },
], ...over });

test("quotes take the author's result, proofs keep CI's", () => {
  const r = mergeAuthorQuotes(ciReport(), REPORT);
  assert.equal(r.failed, 0);
  assert.equal(r.checks[1].ok, true);
  assert.equal(r.checks[1].where, 'author');
  assert.equal(r.checks[1].at, '03:11');
  assert.equal(r.checks[0].where, 'ci');
  assert.equal(r.quotesCheckedAt, 'abcdef1234567');
  assert.equal(r.quotesUnchecked, 0);
});

test("a quote that failed on the author's machine fails here too", () => {
  const author = { ...REPORT, checks: [REPORT.checks[0], { ...REPORT.checks[1], ok: false, why: 'no match' }] };
  const r = mergeAuthorQuotes(ciReport(), author);
  assert.equal(r.failed, 1);
  assert.equal(verdict(r).state, 'failure');
});

test('a proof that fails in CI fails, whatever the author saw', () => {
  const ci = ciReport({ checks: [{ ref: 'db.js:999', kind: 'proof', ok: false, why: 'no line 999' }, ciReport().checks[1]] });
  const r = mergeAuthorQuotes(ci, REPORT);
  assert.equal(r.failed, 1);
  assert.match(verdict(r).description, /1 of 2 claims don't hold up/);
});

test('quotes nobody checked do not fail, unless strict', () => {
  const r = mergeAuthorQuotes(ciReport(), null);
  assert.equal(r.failed, 0);
  assert.equal(r.quotesUnchecked, 1);
  assert.equal(r.checks[1].where, 'none');
  assert.match(verdict(r).description, /1 quote not checked/);
  assert.equal(mergeAuthorQuotes(ciReport(), null, { strictQuotes: true }).failed, 1);
});

test('an unknown kind of proof (ok: null) fails', () => {
  const ci = ciReport({ checks: [{ ref: 'trust me', kind: 'proof', ok: null, why: 'not a kind of proof the checker knows' }] });
  assert.equal(mergeAuthorQuotes(ci, null).failed, 1);
});

test('a regression fails the status and names the count', () => {
  const v = verdict(mergeAuthorQuotes(ciReport({ regressed: ['adds and lists links', 'deletes'] }), REPORT));
  assert.equal(v.state, 'failure');
  assert.match(v.description, /✗ 2 old tests now fail/);
});

test('the status sums all chapters', () => {
  const a = mergeAuthorQuotes(ciReport(), REPORT), b = mergeAuthorQuotes(ciReport(), REPORT);
  const v = verdict([a, b]);
  assert.equal(v.state, 'success');
  assert.match(v.description, /✓ 4 claims checked/);
  assert.ok(v.description.length <= 140);
});

test('the comment has one marker, every card, and says where quotes were checked', () => {
  const c = buildComment({ cards: [{ md: `${MARKER}\n## A` }, { md: `${MARKER}\n## B` }], head: '1234567890', quotesCheckedAt: 'abcdef1234', runUrl: 'https://x/run' });
  assert.equal(c.split(MARKER).length, 2);
  assert.ok(c.startsWith(MARKER));
  assert.match(c, /## A[\s\S]*---[\s\S]*## B/);
  assert.match(c, /re-checked at 1234567/);
  assert.match(c, /checked on the author's machine at abcdef1/);
});

test('the comment fits in a GitHub comment', () => {
  const c = buildComment({ cards: [{ md: 'x'.repeat(100000) }], head: 'a' });
  assert.ok(c.length <= 65536);
  assert.match(c, /cut to fit/);
});

test("the sticky comment prefers the bot's own", () => {
  const comments = [
    { id: 1, body: 'hello', user: { type: 'User' } },
    { id: 2, body: `${MARKER} from publish`, user: { type: 'User' } },
    { id: 3, body: `${MARKER} from the action`, user: { type: 'Bot' } },
  ];
  assert.equal(findSticky(comments).id, 3);
  assert.equal(findSticky(comments.slice(0, 2)).id, 2);
  assert.equal(findSticky([comments[0]]), null);
});

test('card paths are per PR, commit and chapter; links go through github.com', () => {
  assert.equal(cardPath(12, 'abcdef1234567890', null), 'pr-12/abcdef123456.png');
  assert.equal(cardPath(12, 'abcdef1234567890', 2), 'pr-12/abcdef123456-2.png');
  assert.equal(cardUrl({ repo: 'o/r', branch: 'storydiff-cards', file: 'pr-12/a.png' }), 'https://github.com/o/r/blob/storydiff-cards/pr-12/a.png?raw=true');
});

test('a changed file the card does not cover fails the status', () => {
  const r = { oldPass: 3, regressed: [], claims: 2, failed: 0, checks: [], coverage: { files: 3, covered: 2, uncovered: ['src/a.ts'] } };
  const v = verdict(r);
  assert.equal(v.state, 'failure');
  assert.match(v.description, /✗ 1 file not covered/);
  assert.equal(verdict({ ...r, coverage: { files: 3, covered: 3, uncovered: [] } }).state, 'success');
});

test('merging author quotes keeps unverified in step with failed', () => {
  const ci = { oldPass: 1, regressed: [], claims: 2, failed: 0, unverified: 1, checks: [{ ref: 'keep it', kind: 'said', ok: null, why: 'no session log on this machine' }, { ref: 'a.js:1', kind: 'proof', ok: true, why: 'ok' }] };
  const author = { head: 'abc1234', checks: [{ ref: 'keep it', kind: 'said', ok: true, why: 'the human typed this', at: '01:02' }] };
  const m = mergeAuthorQuotes(ci, author);
  assert.equal(m.failed, 0);
  assert.equal(m.unverified, 0);
});
