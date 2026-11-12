// The hard rule for v1: the rendered cards match the canvas boards in poc/v3/canvas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../src/spec/parse.ts';
import { renderPage } from '../src/render/card.ts';
import { loadCaptures, loadReport } from '../src/render/captures.ts';
import { cardSignature, diffSignatures } from './support/signature.ts';

const BOARDS = { tags: 'Card', infra: 'CardInfra', refactor: 'CardRefactor', big: 'CardBig' };

for (const [key, board] of Object.entries(BOARDS)) {
  test(`${key} card matches canvas/${board}.dc.html`, () => {
    const dir = new URL(`./fixtures/${key}/`, import.meta.url).pathname;
    const doc = parse(readFileSync(dir + 'handover.storydiff', 'utf8'));
    const html = renderPage(doc, loadCaptures(dir + '.storydiff'), loadReport(dir + '.storydiff'));
    const want = readFileSync(new URL(`../poc/v3/canvas/${board}.dc.html`, import.meta.url), 'utf8');
    const diffs = diffSignatures(cardSignature(html), cardSignature(want));
    assert.equal(diffs.length, 0, '\n  ' + diffs.join('\n  '));
  });
}
