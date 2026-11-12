// End to end on a real two-version app: the linkbox bundle, branches pr-tags and pr-docker.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { capture } from '../../src/capture/index.ts';
import { findBrowser } from '../../src/capture/shot.ts';
import { worktrees } from './helpers.ts';

const BUNDLE = fileURLToPath(new URL('../../poc/fixtures/linkbox.bundle', import.meta.url));
const FIX = (f: string) => fileURLToPath(new URL('./fixtures/' + f, import.meta.url));
const browser = (() => { try { return findBrowser(); } catch { return null; } })();

let top = '', repo = '', tmp = '';
before(() => {
  top = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'sd-linkbox-')));
  repo = join(top, 'linkbox'); tmp = join(top, 'tmp');
  mkdirSync(tmp);
  execFileSync('git', ['clone', '-q', BUNDLE, repo]);
});
after(() => rmSync(top, { recursive: true, force: true }));

function on(branch: string, spec: string) {
  execFileSync('git', ['-C', repo, 'checkout', '-q', '-f', branch]);
  copyFileSync(FIX(spec), join(repo, 'handover.storydiff'));
}

test('pr-tags: a screen with pins, a call, a same', { skip: !browser && 'no Chromium browser on this machine' }, async () => {
  on('pr-tags', 'linkbox-tags.storydiff');
  const caps = await capture({ repo, base: 'main', tmpRoot: tmp });
  const [screen, call, same] = caps.shows;

  assert.ok(screen?.kind === 'screen');
  assert.equal(screen.app, 'Linkbox');
  for (const f of [screen.before!, screen.after!]) {
    const png = readFileSync(join(repo, '.storydiff', f));
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [932, 504], f);
  }
  assert.deepEqual(screen.rects.map(r => [r.sel, r.found]), [['li .tag', true], ['#filter', true], ['#tags', true], ['page', true]]);
  for (const r of screen.rects) assert.ok(r.x! >= 0 && r.y! >= 0 && r.x! + r.w! <= 466 && r.y! + r.h! <= 252, r.sel);

  assert.ok(call?.kind === 'call');
  assert.equal(call.before.status, 201);
  assert.equal(call.after.status, 201);
  const b = call.before.json as Record<string, unknown>, a = call.after.json as Record<string, unknown>;
  assert.deepEqual(Object.keys(b), ['id', 'url', 'title', 'created_at']);
  assert.deepEqual(Object.keys(a), ['id', 'url', 'title', 'created_at', 'tags']);
  assert.deepEqual(a.tags, ['design']);

  assert.deepEqual(same, { kind: 'same', match: true, diff: null });
  assert.equal(caps.warnings, undefined);
  assert.equal(worktrees(repo), 1);
  assert.deepEqual(readdirSync(tmp), []);
});

test('pr-docker: pipeline, recipe, same', async () => {
  on('pr-docker', 'linkbox-docker.storydiff');
  const caps = await capture({ repo, base: 'main', tmpRoot: tmp });
  const [pipeline, recipe, same] = caps.shows;
  assert.ok(pipeline?.kind === 'pipeline' && recipe?.kind === 'recipe');
  assert.equal(pipeline.before, null);
  assert.match(pipeline.after!, /on: \[push, pull_request\][\s\S]*run: npm test/);
  assert.equal(recipe.before, null);
  assert.match(recipe.after!, /^FROM node:25-alpine$/m);
  assert.match(recipe.after!, /^VOLUME \/data$/m);
  assert.deepEqual(same, { kind: 'same', match: true, diff: null });
  assert.equal(worktrees(repo), 1);
  assert.deepEqual(readdirSync(tmp), []);
});

test('pr-tags: the unfiltered list differs once the page asks for tags', async () => {
  // A same that does not hold is reported, with where it differs.
  on('pr-tags', 'linkbox-tags.storydiff');
  const src = readFileSync(join(repo, 'handover.storydiff'), 'utf8').replace(/^show screen.*$/m, '').replace('GET /api/links\n', 'GET /api/links?include=tags\n');
  execFileSync('sh', ['-c', 'cat > handover.storydiff'], { cwd: repo, input: src });
  const caps = await capture({ repo, base: 'main', tmpRoot: tmp });
  const same = caps.shows[1];
  assert.ok(same?.kind === 'same' && !same.match);
  assert.deepEqual(same.diff![0], { at: '$.body[0].tags', after: ['design'] });
});
