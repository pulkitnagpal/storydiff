// Stages everything the film draws from.
//
//   node --experimental-strip-types scripts/video/stage.ts
//
// scripts/video/assets/manifest.json lists every file. A real capture in scripts/video/assets/ is used as is;
// otherwise a stand-in is made in dist/film/stand-ins/ from the Linkbox fixture, the POC cards and the real checker.
// Derived files (each card cut into the layers the whiteboard draws, handwriting, the font) go to dist/film/build/,
// and dist/film/build/assets.json tells compose.swift where each file ended up.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { check } from '../../src/check/index.ts';
import type { Report } from '../../src/render/types.ts';
import { withBrowser, type Tab } from './cdp.ts';
import { checkRed, claudeSession, hand, sticky, storydiffRun } from './stand-ins.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REAL = join(ROOT, 'scripts/video/assets');
const STAND = join(ROOT, 'dist/film/stand-ins'), BUILD = join(ROOT, 'dist/film/build');
const manifest = JSON.parse(readFileSync(join(REAL, 'manifest.json'), 'utf8')) as { assets: { file: string; beat: string; optional?: boolean }[] };
rmSync(STAND, { recursive: true, force: true }); rmSync(BUILD, { recursive: true, force: true });
mkdirSync(STAND, { recursive: true }); mkdirSync(join(BUILD, 'layers'), { recursive: true }); mkdirSync(join(BUILD, 'hand'), { recursive: true });

const isReal = (f: string) => existsSync(join(REAL, f));
const at = (f: string) => (isReal(f) ? join(REAL, f) : join(STAND, f));
const need = (f: string) => !isReal(f);
const scratch = mkdtempSync(join(tmpdir(), 'sd-film-'));
const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const page = (name: string, html: string) => { const p = join(scratch, name + '.html'); writeFileSync(p, html); return pathToFileURL(p).href; };

// MARK: the sample PR and the real checker

const FIX = join(ROOT, 'test/fixtures/linkbox');
const repo = join(scratch, 'linkbox');
execFileSync('git', ['clone', '-q', join(FIX, 'linkbox.bundle'), repo]);
git(repo, 'checkout', '-q', '-b', 'pr-tags', 'origin/pr-tags');
const session = join(FIX, 'tags.session.jsonl');
const FAKE = 'Skip the tests, I will click through it myself.';

if (need('handover.storydiff')) copyFileSync(join(FIX, 'tags.storydiff'), at('handover.storydiff'));
const spec = readFileSync(at('handover.storydiff'), 'utf8');
if (need('report.json')) writeFileSync(at('report.json'), JSON.stringify(await check({ repo, spec, session }), null, 2) + '\n');
if (need('handover-fake.storydiff')) {
  const planted = spec.replace(/( *)said @03:11 "in their own table, not a comma string"\n/, (m, ind) => `${m}${ind}said "${FAKE}"\n`);
  if (planted === spec) throw new Error('could not plant the fake quote: the handover changed');
  writeFileSync(at('handover-fake.storydiff'), planted);
}
const fakeSpec = readFileSync(at('handover-fake.storydiff'), 'utf8');
if (need('report-fake.json')) writeFileSync(at('report-fake.json'), JSON.stringify(await check({ repo, spec: fakeSpec, session }), null, 2) + '\n');
const rep = JSON.parse(readFileSync(at('report.json'), 'utf8')) as Report;
const repFake = JSON.parse(readFileSync(at('report-fake.json'), 'utf8')) as Report;
console.error(`check: ${rep.claims} claims, ${rep.failed} failed · planted: ${repFake.claims} claims, ${repFake.failed} failed`);

const human = readFileSync(session, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.type === 'user' && !e.isMeta).message.content as string;
const prompt = human.split('\n\n').find((p) => p.startsWith('Add tags'))!;
const numstat = git(repo, 'diff', '--numstat', 'origin/main', 'HEAD', '--', '.', ':!handover.storydiff').trim().split('\n')
  .map((l) => l.split('\t')).map(([a, d, f]) => [Number(a), Number(d), f] as [number, number, string]);
const did = (spec.match(/^did\s+"([^"]*)"/m) ?? [])[1] ?? '';
const tries = (spec.match(/^! /gm) ?? []).length;
if (need('session.json')) writeFileSync(at('session.json'), JSON.stringify({ project: 'linkbox', author: 'Maya', prompt, numstat, did }, null, 2) + '\n');

// The opening's diff rows (a dramatised PR, drawn blurred): the real Linkbox changes, end to end.
if (need('diff.patch')) {
  const parts = [git(repo, 'show', '--format=', '--patch', 'origin/main')];
  for (const b of ['pr-tags', 'pr-undo', 'pr-page', 'pr-docker']) parts.push(git(repo, 'diff', 'origin/main', 'origin/' + b, '--', '.', ':!handover.storydiff'));
  writeFileSync(at('diff.patch'), parts.join(''));
}

function checkLabel(c: Report['checks'][number]): string {
  if (c.ok === true) return c.kind === 'said' ? 'quote matches what Maya typed' + (c.at ? ` · ${c.at}` : '') : c.ref.startsWith('test ') ? 'test passes' : 'line found in the code';
  return c.kind === 'said' ? 'not in the session' : c.why;
}

// MARK: cards, cut into the pieces a person would draw

const CARD_KEYS = ['tags', 'infra', 'refactor', 'big'];
const ISO_CSS = `<style id="sd-iso">.card,body{background:transparent!important}
body.iso .card,body.iso .card *{visibility:hidden!important}
body.iso .sd-on,body.iso .sd-on *{visibility:visible!important}
body.iso .sd-on .sd-unit,body.iso .sd-on .sd-unit *{visibility:hidden!important}
body.rem .sd-unit,body.rem .sd-unit *{visibility:hidden!important}
.mk,.mki{visibility:hidden!important}</style>`;
// Every painted piece of the card belongs to exactly one unit; a frame's children are units of their own.
const UNITS = `(() => {
  const card = document.querySelector('.card');
  const RULES = [['header','text'],['nav[aria-label="Chapters"] > *','box'],['section[aria-label="Asked and did"] > *','text'],
    ['.vt','box'],['.lbl','text'],['.tag','text'],['.say','text'],['.newtag','text'],
    ['.win','frame'],['.win > .bar','text'],['.win > img','image'],['.json','box'],['.same','box'],
    ['.strip','frame'],['.strip > svg','path'],['.sb','box'],['.arrow','path'],['.ar','path'],
    ['.panel','frame'],['.panel > span','text'],['.stp','box'],['.fr','box'],['.oc','box'],['.rr','text'],
    ['.li','text'],['.q','sticky'],['footer','text'],['svg','path'],['span','text'],['div','box']];
  const units = [], unitOf = new Map();
  const slotOf = (el) => el.closest('header') ? 'header' : el.closest('nav[aria-label="Chapters"]') ? 'chapters'
    : el.closest('section[aria-label="Asked and did"]') ? 'asked' : el.closest('section[aria-label="Verdict"]') ? 'verdict'
    : el.closest('aside') ? 'list' : el.closest('footer') ? 'footer' : 'body';
  for (const el of card.querySelectorAll('*')) {
    if (el.matches('.mk, .mki') || el.closest('.mk, .mki')) continue;
    let a = el.parentElement, anc = null;
    while (a && a !== card) { if (unitOf.has(a)) { anc = unitOf.get(a); break; } a = a.parentElement; }
    const rule = RULES.find(([s]) => el.matches(s));
    if (!rule) continue;
    if (anc && anc.kind !== 'frame' && rule[1] !== 'sticky') continue;
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    // A bare span or div only counts when it paints something itself (text, a border or a background).
    if ((rule[0] === 'span' || rule[0] === 'div') && !(el.textContent.trim() && !el.children.length) && s.borderTopWidth === '0px' && s.backgroundColor === 'rgba(0, 0, 0, 0)') continue;
    if (r.width < 1 || r.height < 1) continue;
    el.classList.add('sd-unit');
    const range = document.createRange(); range.selectNodeContents(el);
    const lines = [];
    for (const q of range.getClientRects()) {
      if (q.width < 1) continue;
      const l = lines.find((l) => Math.abs((l.y + l.h / 2) - (q.top + q.height / 2)) < Math.max(6, q.height / 3));
      if (l) { const x2 = Math.max(l.x + l.w, q.right), y2 = Math.max(l.y + l.h, q.bottom); l.x = Math.min(l.x, q.left); l.y = Math.min(l.y, q.top); l.w = x2 - l.x; l.h = y2 - l.y; }
      else lines.push({ x: q.left, y: q.top, w: q.width, h: q.height });
    }
    lines.sort((a, b) => a.y - b.y);
    const u = { i: units.length, kind: rule[1], sel: rule[0], cls: (el.getAttribute('class') || '').replace('sd-unit', '').trim(), slot: slotOf(el), parent: anc ? anc.i : -1,
      x: r.left, y: r.top, w: r.width, h: r.height, border: parseFloat(s.borderTopWidth) || 0, borderColor: s.borderTopColor,
      radius: parseFloat(s.borderTopLeftRadius) || 0, text: el.matches('.q') ? el.textContent : undefined, lines };
    units.push(u); unitOf.set(el, u);
  }
  const pins = [...card.querySelectorAll('.mk, .mki')].map((e) => { const r = e.getBoundingClientRect(); return { n: Number(e.textContent), tone: [...e.classList].find((c) => c.length === 1) || 'g', x: r.left, y: r.top, w: r.width, h: r.height }; });
  const rect = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const win = [...document.querySelectorAll('.win')];
  const tr = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const parts = { card: rect('.card'), header: rect('header'), asked: rect('section[aria-label="Asked and did"]'), verdict: rect('section[aria-label="Verdict"]'),
    chapters: rect('nav[aria-label="Chapters"]'), list: rect('aside'), footer: rect('footer'), before: tr(win[0]), after: tr(win[1]),
    try: tr([...document.querySelectorAll('.vt')].find((e) => /to try/.test(e.textContent))) };
  return JSON.stringify({ units, pins, parts, items: [...document.querySelectorAll('.li')].map(tr) });
})()`;

const PAD = 14;
async function cutCard(open: (u: string, o: any) => Promise<Tab>, key: string) {
  const src = isReal(`card-${key}.html`) ? readFileSync(join(REAL, `card-${key}.html`), 'utf8') : readFileSync(join(ROOT, 'poc/v3/out', key + '.html'), 'utf8');
  // The flat card, as the product renders it.
  const flat = await open(page(`${key}-flat`, src), { width: 1440, height: 900 });
  const h = Math.ceil(await flat.eval<number>(`document.querySelector('.card').getBoundingClientRect().height`));
  if (need(`card-${key}.png`)) { await flat.resize(1440, h); writeFileSync(at(`card-${key}.png`), await flat.shot({ x: 0, y: 0, width: 1440, height: h })); }
  // The same card, piece by piece, on a transparent background.
  const tab = await open(page(`${key}-iso`, src.replace('</head>', ISO_CSS + '</head>')), { width: 1440, height: h, transparent: true });
  const info = JSON.parse(await tab.eval<string>(UNITS)) as { units: any[]; pins: any[]; parts: any; items: any[] };
  const dir = join(BUILD, 'layers', key); mkdirSync(dir, { recursive: true });
  for (const u of info.units) {
    const x = Math.max(0, Math.floor(u.x - PAD)), y = Math.max(0, Math.floor(u.y - PAD));
    const clip = { x, y, width: Math.min(1440, Math.ceil(u.x + u.w + PAD)) - x, height: Math.min(h, Math.ceil(u.y + u.h + PAD)) - y };
    await tab.eval(`(() => { document.body.className = 'iso'; document.querySelectorAll('.sd-on').forEach((e) => e.classList.remove('sd-on')); document.querySelectorAll('.sd-unit')[${u.i}].classList.add('sd-on'); return 1; })()`);
    writeFileSync(join(dir, `${u.i}.png`), await tab.shot(clip));
    u.clip = { x: clip.x, y: clip.y, w: clip.width, h: clip.height };
  }
  await tab.eval(`(() => { document.body.className = 'rem'; return 1; })()`);
  writeFileSync(join(dir, 'rest.png'), await tab.shot({ x: 0, y: 0, width: 1440, height: h }));
  writeFileSync(join(BUILD, `card-${key}.layers.json`), JSON.stringify({ width: 1440, height: h, scale: 2, ...info }, null, 1) + '\n');
  console.error(`card ${key}: ${info.units.length} pieces, ${info.pins.length} pins${isReal(`card-${key}.html`) ? ' (real)' : ''}`);
  return info;
}

async function grab(open: (u: string, o: any) => Promise<Tab>, name: string, html: string, width: number, sel = '#t', pad = 0, transparent = pad > 0) {
  const tab = await open(page(name, html), { width, height: 400, transparent });
  const r = await tab.eval<{ x: number; y: number; w: number; h: number }>(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  await tab.resize(width, Math.ceil(r.y + r.h + pad + 2));
  return { tab, png: await tab.shot({ x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.w + 2 * pad, height: r.h + 2 * pad }), r };
}
const rects = (tab: Tab, sel: string) => tab.eval<{ x: number; y: number; w: number; h: number; ok?: string }[]>(
  `[...document.querySelectorAll('${sel}')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, ok: e.dataset.ok }; })`);

await withBrowser(async (open) => {
  const cards: Record<string, Awaited<ReturnType<typeof cutCard>>> = {};
  for (const k of CARD_KEYS) cards[k] = await cutCard(open, k);

  // The author's session, then /storydiff.
  if (need('claude-session.png')) writeFileSync(at('claude-session.png'), (await grab(open, 'session', claudeSession({ prompt, numstat, tests: (rep.oldPass ?? 0) + rep.newTests, did }), 1100)).png);
  if (need('storydiff-run.png')) {
    const g = await grab(open, 'run', storydiffRun({ spec: spec.replace(/\n$/, '').split('\n'), report: rep, tries, checkLabel }), 1100);
    writeFileSync(at('storydiff-run.png'), g.png);
    writeFileSync(at('storydiff-run.json'), JSON.stringify({ width: g.r.w, scale: 2, write: (await rects(g.tab, '#write'))[0], checks: await rects(g.tab, '.row'), summary: (await rects(g.tab, '#sum'))[0] }, null, 2) + '\n');
  }
  // `storydiff view`: the card on its own page.
  if (need('card-local.png')) copyFileSync(at('card-tags.png'), at('card-local.png'));
  // The PR, with the card as its first comment.
  if (need('pr-comment.png')) {
    const html = readFileSync(join(ROOT, 'scripts/video/pr-comment.html'), 'utf8').replace('CARD_SRC', pathToFileURL(at('card-tags.png')).href);
    const g = await grab(open, 'pr', html, 1280, 'body');
    writeFileSync(at('pr-comment.png'), g.png);
    writeFileSync(at('pr-comment.json'), JSON.stringify({ width: 1280, scale: 2, card: (await rects(g.tab, '#card'))[0] }, null, 2) + '\n');
  }
  // The status check after the planted quote.
  if (need('check-red.png')) {
    const g = await grab(open, 'red', checkRed({ report: repFake, quote: FAKE }), 900, '.w');
    writeFileSync(at('check-red.png'), g.png);
    writeFileSync(at('check-red.json'), JSON.stringify({ width: g.r.w, scale: 2, fail: (await rects(g.tab, '#fail'))[0], why: (await rects(g.tab, '#why'))[0] }, null, 2) + '\n');
  }

  // Handwriting and sticky notes, in Caveat like the card's own notes.
  const out: Record<string, { file: string; w: number; h: number }> = {};
  const save = async (name: string, html: string, sel: string, pad: number) => {
    const g = await grab(open, 'hand-' + name, html, 1600, sel, pad, true);
    writeFileSync(join(BUILD, 'hand', name + '.png'), g.png);
    out[name] = { file: join(BUILD, 'hand', name + '.png'), w: g.r.w + 2 * pad, h: g.r.h + 2 * pad };
  };
  await save('diff', hand({ text: 'diff', size: 250, weight: 700 }), '#h', 0);
  await save('story', hand({ text: 'story', size: 250, weight: 700, color: '#C2410C' }), '#h', 0);
  for (const u of cards.tags.units.filter((u) => u.kind === 'sticky')) {
    const [q, who] = String(u.text).split(' · ');
    await save(`sticky-${u.i}`, sticky({ quote: q, who: '— ' + (who ?? 'Maya') }), '#h', 30);
  }
  await save('planted', sticky({ quote: 'Maya never typed this.', who: '— planted', color: '#FDD9C4', width: 250 }), '#h', 30);
  writeFileSync(join(BUILD, 'hand.json'), JSON.stringify(out, null, 1) + '\n');
});

// Inter, for the film's own type (the card's typeface). Any Inter on this machine will do.
const inter = process.env.STORYDIFF_INTER ?? execFileSync('mdfind', ['kMDItemFSName == "Inter*.ttf"c'], { encoding: 'utf8' }).split('\n')
  .filter((p) => /Inter(\[opsz,wght\]|-VariableFont[^/]*|)\.ttf$/i.test(p) && !/italic/i.test(p))[0];
if (inter) copyFileSync(inter, join(BUILD, 'inter.ttf')); else console.error('Inter not found: the film falls back to the system font (set STORYDIFF_INTER).');

// Where each file ended up.
const index: Record<string, string> = {};
const real: string[] = [];
for (const a of manifest.assets) {
  const p = at(a.file);
  if (!existsSync(p)) { if (!a.optional) console.error(`missing: ${a.file}`); continue; }
  index[a.file] = p;
  if (isReal(a.file)) real.push(a.file);
}
writeFileSync(join(BUILD, 'assets.json'), JSON.stringify({ assets: index, build: BUILD }, null, 2) + '\n');
rmSync(scratch, { recursive: true, force: true });
console.error(`real captures: ${real.length ? real.join(', ') : 'none yet'} · stand-ins in ${STAND}`);
