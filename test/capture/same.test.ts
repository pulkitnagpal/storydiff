import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diff, mask, maskText, sameReply, sameSnapshot } from '../../src/capture/same.ts';
import { fill } from '../../src/capture/template.ts';

test('ids and times are ignored, by key and by value', () => {
  const a = { id: 3, link_id: 9, userId: 1, url: 'x', created_at: '2026-11-12 15:20:01', updatedAt: 1731400000000, when: '2026-11-12T15:20:01Z', ref: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' };
  const b = { id: 4, link_id: 2, userId: 8, url: 'x', created_at: '2026-11-12 15:22:47', updatedAt: 1731400999999, when: '2026-11-13T01:00:00Z', ref: '9b2e7d6a-58cc-4372-a567-0e02b2c3d479' };
  assert.deepEqual(sameReply({ status: 200, json: [a] }, { status: 200, json: [b] }), { match: true, diff: null });
});

test('a word ending in "id" is not an id', () => {
  assert.deepEqual(mask({ paid: 3, valid: 'yes', grid: 2 }), { paid: 3, valid: 'yes', grid: 2 });
});

test('a new field, a changed value and the status are differences', () => {
  const r = sameReply({ status: 200, json: [{ id: 1, url: 'a' }] }, { status: 201, json: [{ id: 2, url: 'b', tags: [] }] });
  assert.equal(r.match, false);
  assert.deepEqual(r.diff, [
    { at: '$.status', before: 200, after: 201 },
    { at: '$.body[0].url', before: 'a', after: 'b' },
    { at: '$.body[0].tags', after: [] },
  ]);
});

test('lists of different length', () => {
  assert.deepEqual(diff([1], [1, 2]), [{ at: '$[1]', after: 2 }]);
  assert.deepEqual(diff([1, 2], [1]), [{ at: '$[1]', before: 2 }]);
});

test('text replies are compared as text, times masked', () => {
  assert.equal(sameReply({ status: 200, json: null, text: 'ok at 10:41:03' }, { status: 200, json: null, text: 'ok at 10:42:11' }).match, true);
  assert.equal(maskText('on 2026-11-12, id f47ac10b-58cc-4372-a567-0e02b2c3d479'), 'on (time), id (id)');
});

test('page snapshots: a moved element is a difference', () => {
  assert.equal(sameSnapshot(['body 0,0,466,252', '  h1 8,8,450,37 Links'], ['body 0,0,466,252', '  h1 8,8,450,37 Links']).match, true);
  const r = sameSnapshot(['  h1 8,8,450,37 Links'], ['  h1 8,40,450,37 Links']);
  assert.deepEqual(r, { match: false, diff: [{ at: 'line 1', before: '  h1 8,8,450,37 Links', after: '  h1 8,40,450,37 Links' }] });
});

test('templates fill from the reply', () => {
  const r = { status: 201, json: { total: 98, items: [{ name: 'a' }] }, ms: 1234 };
  assert.deepEqual(fill('${total} · {items.0.name} · {@status} · {@s} s', r), { text: '$98 · a · 201 · 1.23 s', missing: [] });
  assert.deepEqual(fill('{nope}', r), { text: '?', missing: ['nope'] });
  assert.deepEqual(fill('{@count}', { status: 200, json: [1, 2, 3], ms: 1 }), { text: '3', missing: [] });
});
