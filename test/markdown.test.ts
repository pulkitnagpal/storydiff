import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../src/spec/parse.ts';
import { loadReport } from '../src/render/captures.ts';
import { renderMarkdown, mermaid, MARKER } from '../src/render/markdown.ts';

const dir = (k: string) => new URL(`./fixtures/${k}/`, import.meta.url).pathname;
const doc = (k: string) => parse(readFileSync(dir(k) + 'handover.storydiff', 'utf8'));

test('markdown has the marker, verdict, asked and did, the list and the mermaid map', () => {
  const md = renderMarkdown(doc('tags'), loadReport(dir('tags') + '.storydiff'));
  assert.ok(md.startsWith(MARKER));
  assert.match(md, /\*\*✓ All 3 old tests still pass · 6 new tests · ✓ 29 claims checked · 2 things to try\*\*/);
  assert.match(md, /\*\*Maya asked\*\* “Add tags to links, and let me filter the list by one tag\.”/);
  assert.match(md, /\*\*New\*\*\n1\. Every link shows its tags\. Pick one to see only those\.\n2\. /);
  assert.match(md, /3\. Tags live in their own table\. *\n *> “in their own table, not a comma string” · Maya/);
  assert.match(md, /\*\*Try before you merge\*\*\n5\. Open the page once\. Nobody has yet\./);
  assert.match(md, /```mermaid\nflowchart LR\n/);
  assert.doesNotMatch(md, /!\[/);
});

test('markdown shows the card image when given, and failing claims by name', () => {
  const rep = { oldPass: 3, newTests: 0, regressed: ['deletes a link'], claims: 3, failed: 1, checks: [{ ref: 'db.js:999', kind: 'proof' as const, ok: false, why: 'db.js has only 40 lines', line: 22 }] };
  const md = renderMarkdown(doc('tags'), rep, { imageUrl: 'https://example.com/card.png', viewUrl: 'https://example.com/card.html' });
  assert.match(md, /\[!\[The Storydiff card\]\(https:\/\/example\.com\/card\.png\)\]\(https:\/\/example\.com\/card\.html\)/);
  assert.match(md, /\*\*✗ 1 old test now fails · ✗ 1 of 3 claims don't hold up/);
  assert.match(md, /- ✗ `db\.js:999`: db\.js has only 40 lines \(spec line 22\)/);
  assert.match(md, /- ✗ `deletes a link` passed before and fails now/);
});

test('mermaid draws boxes with their marks and safe ids', () => {
  const m = mermaid(parse('code end "End"\ncode my-api "API"\nend -> my-api\n+ table tags "Tags" "x"\n+ my-api -> tags\n- end -> my-api\n= end "kept"'));
  assert.match(m, /n_end\["~ End"\]:::changed/, 'a box that lost an arrow is changed, as on the card');
  assert.match(mermaid(parse('code a "A"\n= a "kept"')), /n_a\["= A"\]:::kept/);
  assert.match(m, /n_tags\[\("\+ Tags"\)\]:::new/);
  assert.match(m, /n_end -\.-> n_my_api/);
  assert.match(m, /n_my_api ==> n_tags/);
});
