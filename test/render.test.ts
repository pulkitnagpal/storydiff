import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../src/spec/parse.ts';
import { render } from '../src/render/card.ts';
import { loadCaptures, loadReport } from '../src/render/captures.ts';
import type { Captures, Report } from '../src/render/types.ts';

const dir = (k: string) => new URL(`./fixtures/${k}/`, import.meta.url).pathname;
const load = (k: string) => ({ doc: parse(readFileSync(dir(k) + 'handover.storydiff', 'utf8')), caps: loadCaptures(dir(k) + '.storydiff'), rep: loadReport(dir(k) + '.storydiff') });

test('render skips a show with no capture, and says so', () => {
  const { doc, caps, rep } = load('tags');
  const warnings: string[] = [];
  const html = render(doc, { shows: [null, caps.shows[1], caps.shows[2]] }, rep, { warn: (m) => warnings.push(m) });
  assert.ok(!html.includes('class="win"'), 'no screen window without a screen capture');
  assert.ok(html.includes('class="json"'));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /show 1 \(screen\) has no capture/);
});

test('a card with no captures at all still renders the map and the list', () => {
  const { doc, rep } = load('tags');
  const html = render(doc, { shows: [] }, rep);
  assert.ok(html.includes('class="strip"') && html.includes('class="li'));
});

test('screen pins only where found', () => {
  const { doc, caps, rep } = load('tags');
  const shot = caps.shows[0]!;
  assert.equal(shot.kind, 'screen');
  const lost: Captures = { shows: [{ ...shot, rects: shot.kind === 'screen' ? shot.rects.map((r) => (r.sel === '#tags' ? { sel: r.sel, found: false } : r)) : [] }, caps.shows[1], caps.shows[2]] };
  const win = (h: string) => h.slice(h.indexOf('AFTER'), h.indexOf('What apps get back'));
  assert.match(win(render(doc, caps, rep)), /class="mk g"[^>]*>2</);
  assert.doesNotMatch(win(render(doc, lost, rep)), /class="mk g"[^>]*>2</);
});

test('verdict shows failures', () => {
  const { doc, caps } = load('tags');
  const rep: Report = { oldPass: 3, newTests: 6, regressed: ['adds and lists links', 'deletes a link'], claims: 29, failed: 3, checks: [] };
  const html = render(doc, caps, rep);
  assert.match(html, /✗ 2 old tests now fail/);
  assert.match(html, /✗ 3 of 29 claims don't hold up/);
  assert.doesNotMatch(html, /still pass/);
});

test('before the checker runs, the verdict says not checked yet', () => {
  const { doc, caps } = load('tags');
  const html = render(doc, caps, loadReport('/nonexistent', doc));
  assert.match(html, /claims cited · not checked yet/);
  assert.match(html, /Tests not run yet/);
  assert.doesNotMatch(html, /claims checked/);
});

test('the list says nothing to try when there are no watch items', () => {
  const { doc, caps, rep } = load('refactor');
  const html = render(doc, caps, rep);
  assert.match(html, /✓ Nothing to try/);
  assert.match(html, /Nothing\. Every reply matched on both versions\./);
});

test('a call returning a list shows rows matched by id, with changed values marked', () => {
  const doc = parse('show call GET /api/links\ncode api "API"\n! "Titles are trimmed now."\n    pin call "title"');
  const caps: Captures = { shows: [{ kind: 'call', before: { status: 200, json: [{ id: 1, title: ' A ' }, { id: 2, title: 'B' }] }, after: { status: 200, json: [{ id: 1, title: 'A' }, { id: 2, title: 'B' }] } }] };
  const html = render(doc, caps, { oldPass: 1, newTests: 0, regressed: [], claims: 0, failed: 0, checks: [] });
  const after = html.slice(html.lastIndexOf('class="json"'));
  assert.match(after, /outline-color: #4338CA[^>]*>"title": &quot;A&quot;<\/span><span class="mki o">1</);
  assert.equal((after.match(/outline-color/g) || []).length, 1, 'only the changed value is marked');
});

test('ships-with shows in the header', () => {
  const doc = parse('ships-with "orchestrator#981"\ncode a "A"\n+ "x"');
  assert.match(render(doc, { shows: [] }, { oldPass: 0, newTests: 0, regressed: [], claims: 0, failed: 0, checks: [] }), /<header[^]*Ships with orchestrator#981[^]*<\/header>/);
});
