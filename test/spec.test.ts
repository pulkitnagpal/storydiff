import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, SpecError } from '../src/spec/parse.ts';

const fixture = (k: string) => readFileSync(new URL(`./fixtures/${k}/handover.storydiff`, import.meta.url), 'utf8');

test('the four fixtures parse', () => {
  for (const k of ['tags', 'infra', 'refactor', 'big']) assert.ok(parse(fixture(k)).marks.length > 0, k);
});

test('tags: header, shows and a numbered list', () => {
  const d = parse(fixture('tags'));
  assert.equal(d.pr, 'Linkbox #12');
  assert.equal(d.files, 5);
  assert.equal(d.by, 'Maya');
  assert.equal(d.agent, 'Claude Code');
  assert.deepEqual(d.shows.map((s) => s.kind), ['screen', 'call', 'same']);
  const listed = d.marks.filter((m) => m.n).sort((a, b) => a.n! - b.n!);
  assert.deepEqual(listed.map((m) => m.n), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(listed.map((m) => m.mark), ['new', 'new', 'new', 'kept', 'watch', 'watch']);
  assert.deepEqual(listed[2].said, [{ at: '03:11', text: 'in their own table, not a comma string' }]);
});

test('show call carries method, path, json body, label and hint', () => {
  const d = parse(fixture('tags'));
  assert.deepEqual(d.shows[1], {
    kind: 'call', method: 'POST', path: '/api/links',
    body: { url: 'https://figma.com', title: 'Figma tips', tags: ['design'] },
    label: 'What apps get back', hint: 'when they save a link',
  });
});

test('a mark with only a line, and a box declared with a line', () => {
  const d = parse(fixture('tags'));
  assert.equal(d.marks[0].id, null);
  assert.equal(d.marks[0].line, 'Every link shows its tags. Pick one to see only those.');
  assert.deepEqual(d.marks[0].pins, [{ on: 'screen', target: 'li .chip' }, { on: 'screen', target: '#filter' }]);
  assert.equal(d.nodes.tags.label, 'Tags');
  assert.equal(d.nodes.tags.born, true);
  assert.equal(d.marks[2].line, 'Tags live in their own table.');
});

test('a gone arrow is marked gone', () => {
  const d = parse(fixture('big'));
  const e = d.edges.find((x) => x.from === 'receive' && x.to === 'charge')!;
  assert.equal(e.gone, true);
  assert.deepEqual(d.chapters, ['Charge customers once', 'Retry slow charges', '+ 6 smaller changes']);
  assert.equal(d.chapter, 1);
});

test('errors carry line numbers', () => {
  assert.throws(() => parse('code a "A"\n+ a -> b'), (e: unknown) => e instanceof SpecError && e.line === 2 && /"b" is not on the map yet/.test(e.message));
  assert.throws(() => parse('code a "A"\nwat'), /Line 2: unknown line/);
});

test('the list holds at most 7 items', () => {
  const src = 'code a "A"\n' + Array.from({ length: 8 }, (_, i) => `+ "item ${i}"`).join('\n');
  assert.throws(() => parse(src), /at most 7 items/);
});

test('a list line has at most 16 words', () => {
  assert.throws(() => parse('code a "A"\n+ "' + 'word '.repeat(17).trim() + '"'), /16 words or fewer/);
});

test('every mark needs its line, except arrows and new boxes', () => {
  assert.throws(() => parse('code a "A"\n~ a'), /needs its one line/);
  assert.doesNotThrow(() => parse('code a "A"\n+ code b "B"\n+ a -> b'));
});
