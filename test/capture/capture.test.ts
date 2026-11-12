// What capture records, on a tiny app whose base is version 1 and whose working tree is version 2.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { capture } from '../../src/capture/index.ts';
import { findBrowser } from '../../src/capture/shot.ts';
import { allDead, makeRepo, RUN, worktrees, type Fixture } from './helpers.ts';

let fx: Fixture;
before(() => { fx = makeRepo(); });
after(() => fx.done());

const browser = (() => { try { return findBrowser(); } catch { return null; } })();

test('call, same, pipeline, recipe and scenario', async () => {
  fx.spec([
    RUN,
    'setup POST /api/items {"name":"seed"}',
    'show call GET /api/version "Version"',
    'show call POST /api/items {"name":"pen"}',
    'show same "The list" GET /api/list',
    'show same "The version" GET /api/version',
    'show pipeline .github/ci.yml',
    'show recipe Dockerfile',
    'show recipe nothing-here.txt',
    'show scenario "the same event twice"',
    '    do POST /api/charge {"event":"e1","amount":49} "Sends" "{note}"',
    '    do POST /api/charge {"event":"e1","amount":49} "…and again" "{note}"',
    '    then GET /api/total "${total}" "charged {count} times" want "$49"',
  ].join('\n'));
  const caps = await capture({ repo: fx.repo, base: 'main', tmpRoot: fx.tmp });
  const s = caps.shows;
  assert.deepEqual(s[0], { kind: 'call', before: { status: 200, json: { version: '1' } }, after: { status: 200, json: { version: '2' } } });
  // setup ran on both, so the item ids line up; the new version adds a field.
  assert.ok(s[1]?.kind === 'call');
  assert.equal((s[1].before.json as { id: number }).id, 2);
  assert.equal((s[1].after.json as { extra: boolean }).extra, true);
  assert.deepEqual(s[2], { kind: 'same', match: true, diff: null });
  assert.deepEqual(s[3], { kind: 'same', match: false, diff: [{ at: '$.body.version', before: '1', after: '2' }] });
  assert.deepEqual(s[4], { kind: 'pipeline', file: '.github/ci.yml', before: null, after: 'on: [push]\n' });
  assert.deepEqual(s[5], { kind: 'recipe', file: 'Dockerfile', before: 'FROM node:22-alpine\n', after: 'FROM node:25-alpine\n' });
  assert.deepEqual(s[6], { kind: 'recipe', file: 'nothing-here.txt', before: null, after: null });
  assert.deepEqual(s[7], {
    kind: 'scenario',
    before: { steps: [['Sends', 'e1 · $49'], ['…and again', 'e1 · $49']], outcome: { big: '$98', small: 'charged 2 times', tone: 'bad' } },
    after: { steps: [['Sends', 'e1 · $49'], ['…and again', 'skipped']], outcome: { big: '$49', small: 'charged 1 times', tone: 'good' } },
  });
  // The file on disk is the same thing, one entry per show, in order.
  const disk = JSON.parse(readFileSync(join(fx.repo, '.storydiff', 'captures.json'), 'utf8'));
  assert.deepEqual(disk, JSON.parse(JSON.stringify(caps)));
  assert.equal(disk.shows.length, 8);
  assert.ok(await allDead(fx.pidList()));
  assert.equal(worktrees(fx.repo), 1);
  assert.deepEqual(readdirSync(fx.tmp), []);
});

test('a scenario without do lines is skipped with a warning, never faked', async () => {
  fx.spec([RUN, 'show scenario "nothing to run"', 'show call GET /api/version'].join('\n'));
  const caps = await capture({ repo: fx.repo, base: 'main', tmpRoot: fx.tmp });
  assert.equal(caps.shows[0], null);
  assert.equal(caps.shows[1]?.kind, 'call');
  assert.match(caps.warnings![0], /needs do lines and a then line/);
});

test('files only: no run line needed and no app started', async () => {
  fx.spec('show recipe Dockerfile');
  const caps = await capture({ repo: fx.repo, base: 'main', tmpRoot: fx.tmp });
  assert.equal(caps.shows[0]?.kind, 'recipe');
});

test('screens: 466 px at 2x, pins measured, a page the base lacks is new', { skip: !browser && 'no Chromium browser on this machine' }, async () => {
  fx.spec([RUN, 'show screen / "Home"', 'show screen /new', 'show same "Unchanged page" screen /same', 'show same "Home page" screen /',
    '+ "x"', '    pin screen "#hello"', '    pin screen "#fresh"', '    pin screen "#missing"', '    pin screen page'].join('\n'));
  const caps = await capture({ repo: fx.repo, base: 'main', tmpRoot: fx.tmp });
  const [home, fresh, same, differs] = caps.shows;
  assert.ok(home?.kind === 'screen' && fresh?.kind === 'screen');
  assert.equal(home.app, 'Demo');
  assert.deepEqual([home.before, home.after], ['before-0.png', 'after-0.png']);
  const out = join(fx.repo, '.storydiff');
  const png = readFileSync(join(out, 'after-0.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [932, 504]);
  const r = Object.fromEntries(home.rects.map(x => [x.sel, x]));
  assert.equal(r['#hello'].found, true);
  assert.ok(r['#hello'].w! > 0 && r['#hello'].y! > 0);
  assert.equal(r['#missing'].found, false);
  assert.equal(r['#fresh'].found, false);
  assert.deepEqual(r.page, { sel: 'page', found: true, x: 0, y: 0, w: 466, h: 252 });
  assert.equal(fresh.before, null);
  assert.equal(fresh.after, 'after-1.png');
  assert.equal(existsSync(join(out, 'before-1.png')), false);
  assert.equal(fresh.rects.find(x => x.sel === '#fresh')!.found, true);
  assert.deepEqual(same, { kind: 'same', match: true, diff: null });
  assert.ok(differs?.kind === 'same' && differs.match === false && differs.diff!.length > 0);
  assert.ok(caps.warnings!.some(w => /#missing/.test(w)));
});

test('a stale captures.json and old PNGs are removed before a new run', async () => {
  fx.spec('show recipe Dockerfile');
  await capture({ repo: fx.repo, base: 'main', tmpRoot: fx.tmp });
  const files = readdirSync(join(fx.repo, '.storydiff'));
  assert.deepEqual(files.filter(f => f.endsWith('.png')), []);
});

test('e2e: capture keeps its output folder out of git', async () => {
  const { mkdtempSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { ensureOutDir } = await import('../../src/render/captures.ts');
  const d = join(mkdtempSync(join(tmpdir(), 'sd-out-')), '.storydiff');
  ensureOutDir(d);
  assert.equal(readFileSync(join(d, '.gitignore'), 'utf8'), '*\n');
});
