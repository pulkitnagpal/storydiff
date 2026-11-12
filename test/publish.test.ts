import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upsertBlock, extractSpec } from '../src/cli/publish.ts';

const rep = { oldPass: 3, newTests: 0, regressed: [], claims: 2, failed: 0, checks: [{ ref: 'a --> b', kind: 'said' as const, ok: true, why: 'the human typed this', at: '01:02' }] };
const spec = 'title "X"\ncode a "A"\n+ "line"';

test('upsert inserts into an empty body', () => {
  const b = upsertBlock('', spec, rep);
  assert.match(b, /^<!-- storydiff:start -->\n```storydiff\ntitle "X"/);
  assert.match(b, /<!-- storydiff:end -->$/);
});

test('upsert keeps the rest of the body and replaces the old block in place', () => {
  const first = upsertBlock('Fixes #3.\n\nMore words.', spec, rep);
  assert.ok(first.startsWith('Fixes #3.\n\nMore words.\n\n<!-- storydiff:start -->'));
  const second = upsertBlock(first.replace('More words.', 'Edited words.'), spec.replace('"X"', '"Y"'), rep);
  assert.equal((second.match(/storydiff:start/g) || []).length, 1);
  assert.match(second, /Edited words\./);
  assert.match(second, /title "Y"/);
  assert.doesNotMatch(second, /title "X"/);
});

test('extract round-trips the spec and the report, even with -- in a quote', () => {
  const got = extractSpec(upsertBlock('Body', spec, rep))!;
  assert.equal(got.spec, spec);
  assert.deepEqual(got.report, rep);
});

test('extract reads a hand-written storydiff fence too, and null when there is none', () => {
  assert.equal(extractSpec('hi\n```storydiff\ncode a "A"\n```\n')!.spec, 'code a "A"');
  assert.equal(extractSpec('hi')!, null);
});

test('a spec holding a fence gets a longer fence', () => {
  const s = 'code a "A"\n+ "uses ``` in text"';
  assert.equal(extractSpec(upsertBlock('', s, rep))!.spec, s);
});
