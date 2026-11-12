// Stages the film's assets: everything compose.swift draws from, in one folder, named as scripts/video/manifest.json lists.
//
//   node --experimental-strip-types scripts/video/stage.ts [assets dir]      (default dist/film/assets)
//
// Each file is made from the Linkbox fixture and the POC cards, with the real checker run on the real branch.
// A file you drop in yourself (a capture from a real v1 run) is kept: stage only (re)writes files it made before,
// which it lists in <assets>/.stand-ins. Delete a file to have stage make its stand-in again.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { check } from '../../src/check/index.ts';
import { measure } from '../../src/shot/index.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(process.argv[2] ?? join(ROOT, 'dist/film/assets'));
const manifest = JSON.parse(readFileSync(join(ROOT, 'scripts/video/manifest.json'), 'utf8')) as { assets: { file: string }[] };
mkdirSync(OUT, { recursive: true });

const ledger = join(OUT, '.stand-ins');
const mine = new Set(existsSync(ledger) ? readFileSync(ledger, 'utf8').split('\n').filter(Boolean) : []);
const made = new Set<string>();
/** True when stage may write this file: missing, or a stand-in stage wrote before. */
const mayWrite = (f: string) => !existsSync(join(OUT, f)) || mine.has(f);
function put(f: string, data: string | Buffer) { writeFileSync(join(OUT, f), data); made.add(f); }
const kept: string[] = [];
function want(...fs: string[]): boolean {
  if (fs.every(mayWrite)) return true;
  kept.push(...fs.filter((f) => !mayWrite(f)));
  fs.filter((f) => mine.has(f)).forEach((f) => made.add(f));
  return false;
}

const scratch = mkdtempSync(join(tmpdir(), 'sd-film-'));
const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// The Linkbox sample app, on the tags branch, as Maya's PR.
const FIX = join(ROOT, 'test/fixtures/linkbox');
const repo = join(scratch, 'linkbox');
execFileSync('git', ['clone', '-q', join(FIX, 'linkbox.bundle'), repo]);
git(repo, 'checkout', '-q', '-b', 'pr-tags', 'origin/pr-tags');
const spec = readFileSync(join(FIX, 'tags.storydiff'), 'utf8');
const session = join(FIX, 'tags.session.jsonl');

// 1. The handover and what the checker says about it.
if (want('handover.storydiff')) put('handover.storydiff', spec);
if (want('report.json')) {
  const r = await check({ repo, spec, session });
  put('report.json', JSON.stringify(r, null, 2) + '\n');
  console.error(`check: ${r.claims} claims, ${r.failed} failed`);
}
// 2. The same handover with one planted quote Maya never typed.
const FAKE = 'Skip the tests, I will click through it myself.';
const fakeSpec = spec.replace('    said @03:11 "in their own table, not a comma string"\n',
  `    said @03:11 "in their own table, not a comma string"\n    said "${FAKE}"\n`);
if (fakeSpec === spec) throw new Error('could not plant the fake quote: the handover changed');
if (want('handover-fake.storydiff', 'report-fake.json')) {
  put('handover-fake.storydiff', fakeSpec);
  const r = await check({ repo, spec: fakeSpec, session });
  put('report-fake.json', JSON.stringify(r, null, 2) + '\n');
  console.error(`check (planted quote): ${r.claims} claims, ${r.failed} failed`);
}

// 3. The session the terminal beat replays: what Maya typed (from the log) and how the agent closed the work.
if (want('session.json')) {
  const human = readFileSync(session, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .find((e) => e.type === 'user' && !e.isMeta).message.content as string;
  const ask = human.split('\n\n').find((p) => p.startsWith('Add tags'))!;
  const files = git(repo, 'diff', '--stat', 'origin/main', 'HEAD', '--', '.', ':!handover.storydiff').trim().split('\n');
  put('session.json', JSON.stringify({
    project: 'linkbox', branch: 'pr-tags', author: 'Maya',
    prompt: ask,
    // How the agent closed the work: the files it touched (real, from the branch) and the test run (real, from the report).
    work: files.slice(0, -1).map((l) => l.trim().replace(/\s+\|\s+/, '  ').replace(/\s+[+-]+$/, '')),
    summary: files.at(-1)!.trim(),
  }, null, 2) + '\n');
}

// 4. The diff a reviewer would otherwise read: every Linkbox change, end to end.
if (want('diff.patch', 'diff.json')) {
  const parts = [git(repo, 'show', '--format=', '--patch', 'origin/main')];
  for (const b of ['pr-tags', 'pr-undo', 'pr-page', 'pr-docker']) parts.push(git(repo, 'diff', 'origin/main', 'origin/' + b, '--', '.', ':!handover.storydiff'));
  const patch = parts.join('');
  const lines = patch.split('\n');
  const add = lines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length;
  const del = lines.filter((l) => l.startsWith('-') && !l.startsWith('---')).length;
  const files = lines.filter((l) => l.startsWith('diff --git')).length;
  put('diff.patch', patch);
  put('diff.json', JSON.stringify({ files, add, del, lines: lines.length }, null, 2) + '\n');
  console.error(`diff: ${files} files, +${add} -${del}`);
}

// 5. The cards, with where each part sits so the camera can find it.
const TAG_IDS = `<script>(() => {
  const q = (s) => [...document.querySelectorAll(s)];
  const id = (el, n) => { if (el) el.id = n; };
  id(document.querySelector('header'), 'sd-header');
  id(document.querySelector('section[aria-label="Asked and did"]'), 'sd-asked');
  id(document.querySelector('section[aria-label="Verdict"]'), 'sd-verdict');
  id(document.querySelector('[aria-label="Chapters"]'), 'sd-chapters');
  id(q('.vt').find((e) => /to try/.test(e.textContent)), 'sd-try');
  const win = q('.win');
  id(win[0], 'sd-before'); id(win[1], 'sd-after');
  if (win[0]) id(win[0].parentElement.parentElement, 'sd-screens');
  id(document.querySelector('aside[aria-label="The list"]'), 'sd-list');
  q('.li').forEach((e, i) => id(e, 'sd-li-' + i));
  q('.mk, .mki').forEach((e, i) => id(e, 'sd-pin-' + i));
  id(document.querySelector('.card'), 'sd-card');
})();</script>`;
const PARTS = ['sd-card', 'sd-header', 'sd-asked', 'sd-verdict', 'sd-chapters', 'sd-try', 'sd-before', 'sd-after', 'sd-screens', 'sd-list'];

async function card(key: string, bare: boolean) {
  const src = readFileSync(join(ROOT, 'poc/v3/out', key + '.html'), 'utf8');
  const pins = [...src.matchAll(/<span class="mki? (\w)"[^>]*>(\d+)<\/span>/g)].map((m) => ({ n: Number(m[2]), tone: m[1] }));
  const items = (src.match(/class="li[ "]/g) ?? []).length;
  const hide = bare ? '<style>.mk,.mki{visibility:hidden}</style>' : '';
  const html = join(scratch, `${key}${bare ? '-bare' : ''}.html`);
  writeFileSync(html, src.replace('</body>', hide + TAG_IDS + '</body>'));
  const sels = [...PARTS, ...Array.from({ length: items }, (_, i) => '#sd-li-' + i), ...pins.map((_, i) => '#sd-pin-' + i)].map((s) => s.startsWith('#') ? s : '#' + s);
  const png = join(OUT, `card-${key}${bare ? '-bare' : ''}.png`);
  const rects = await measure(pathToFileURL(html).href, png, { width: 1440, height: 900, fullPage: true, settleMs: 700, selectors: sels });
  made.add(`card-${key}${bare ? '-bare' : ''}.png`);
  const at = (s: string) => rects.find((r) => r.sel === s);
  return {
    width: 1440, scale: 2,
    parts: Object.fromEntries(PARTS.map((p) => [p.slice(3), at('#' + p)]).filter(([, r]) => r && (r as { found: boolean }).found)),
    items: Array.from({ length: items }, (_, i) => at('#sd-li-' + i)),
    pins: pins.map((p, i) => ({ ...p, ...at('#sd-pin-' + i) })),
  };
}
for (const key of ['tags', 'infra', 'refactor', 'big']) {
  if (!want(`card-${key}.png`, `card-${key}.json`)) continue;
  const info = await card(key, false);
  put(`card-${key}.json`, JSON.stringify(info, null, 2) + '\n');
  console.error(`card ${key}: ${info.items.length} items, ${info.pins.length} pins`);
}
if (want('card-tags-bare.png')) await card('tags', true);

// 6. The PR the reviewer opens, with the card as the first comment (a stand-in page until the real PR is captured).
if (want('pr.png', 'pr.json')) {
  const html = join(scratch, 'pr.html');
  const cardPng = pathToFileURL(join(OUT, 'card-tags-bare.png')).href;
  writeFileSync(html, readFileSync(join(ROOT, 'scripts/video/pr-page.html'), 'utf8').replace('CARD_SRC', cardPng));
  const rects = await measure(pathToFileURL(html).href, join(OUT, 'pr.png'), { width: 1280, height: 900, fullPage: true, settleMs: 700, selectors: ['#card', '#comment', 'body'] });
  made.add('pr.png');
  put('pr.json', JSON.stringify({ width: 1280, scale: 2, card: rects[0], comment: rects[1] }, null, 2) + '\n');
}

writeFileSync(ledger, [...made].sort().join('\n') + '\n');
rmSync(scratch, { recursive: true, force: true });
const listed = new Set(manifest.assets.map((a) => a.file));
const missing = [...listed].filter((f) => !existsSync(join(OUT, f)));
if (kept.length) console.error(`kept your files: ${kept.join(', ')}`);
if (missing.length) { console.error(`missing: ${missing.join(', ')}`); process.exit(1); }
console.error(`assets in ${OUT}`);
