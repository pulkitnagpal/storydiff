import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findBrowser, screenshot, measure } from '../src/shot/index.ts';

const skip = findBrowser() ? false : 'no Chromium browser on this machine';
const page = 'data:text/html,' + encodeURIComponent('<body style="margin:0"><div id="a" style="margin:10px;width:50px;height:20px;background:red"></div><div class="card" style="height:900px"></div></body>');

test('screenshot writes a PNG', { skip }, async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'sd-shot-')), 'a.png');
  await screenshot(page, out, { width: 200, height: 100 });
  assert.deepEqual([...readFileSync(out).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});

test('fullPage sizes the shot to the card', { skip }, async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'sd-shot-')), 'a.png');
  await screenshot(page, out, { width: 200, fullPage: true });
  const png = readFileSync(out);
  assert.equal(png.readUInt32BE(20), 2 * (40 + 900)); // height in device pixels at 2x
});

test('measure finds what is there and says what is not', { skip }, async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'sd-shot-')), 'a.png');
  const rects = await measure(page, out, { width: 200, height: 100, selectors: ['#a', '#nope'] });
  assert.deepEqual(rects, [{ sel: '#a', found: true, x: 10, y: 10, w: 50, h: 20 }, { sel: '#nope', found: false }]);
});
