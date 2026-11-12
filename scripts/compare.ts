// Eye check: screenshot each fixture card and its canvas board into test/out/ (not a test: fonts vary by machine).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from '../src/spec/parse.ts';
import { renderPage } from '../src/render/card.ts';
import { loadCaptures, loadReport } from '../src/render/captures.ts';
import { screenshot } from '../src/shot/index.ts';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'test/out');
const BOARDS: Record<string, [string, number]> = { tags: ['Card', 1040], infra: ['CardInfra', 830], refactor: ['CardRefactor', 810], big: ['CardBig', 870] };
mkdirSync(OUT, { recursive: true });
for (const [k, [board, h]] of Object.entries(BOARDS)) {
  if (process.argv[2] && process.argv[2] !== k) continue;
  const dir = join(ROOT, 'test/fixtures', k);
  const doc = parse(readFileSync(join(dir, 'handover.storydiff'), 'utf8'));
  const html = join(OUT, `${k}.html`);
  writeFileSync(html, renderPage(doc, loadCaptures(join(dir, '.storydiff')), loadReport(join(dir, '.storydiff'))));
  await screenshot('file://' + html, join(OUT, `${k}-card.png`), { width: 1440, height: h, settleMs: 800 });
  await screenshot('file://' + join(ROOT, 'poc/v3/canvas', `${board}.dc.html`), join(OUT, `${k}-canvas.png`), { width: 1440, height: h, settleMs: 800 });
  console.log(k, '->', `test/out/${k}-card.png`, `test/out/${k}-canvas.png`);
}
