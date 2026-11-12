import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { needsApps, readPlan } from '../../src/capture/plan.ts';

const fixture = (f: string) => readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8');

test('tags fixture: run, setup, three shows and the screen pins', () => {
  const p = readPlan(fixture('linkbox-tags.storydiff'));
  assert.deepEqual(p.run, { cmd: 'node server.js', port: 3000, env: { LINKBOX_DB: ':memory:' }, line: 7 });
  assert.equal(p.setup.length, 2);
  assert.deepEqual(p.setup[0].body, { url: 'https://nodejs.org/docs', title: 'Node docs', tags: ['dev'] });
  assert.deepEqual(p.shows.map(s => s.kind), ['screen', 'call', 'same']);
  assert.deepEqual(p.shows[1], { kind: 'call', method: 'POST', path: '/api/links', body: { url: 'https://figma.com', title: 'Figma tips', tags: ['design'] }, label: 'What apps get back', hint: 'when they save a link', line: 12 });
  assert.deepEqual(p.shows[2], { kind: 'same', label: 'GET /api/links, the list the mobile app reads', target: { kind: 'call', method: 'GET', path: '/api/links', body: undefined }, line: 13 });
  assert.deepEqual(p.screenPins, ['li .tag', '#filter', '#tags', 'page']);
  assert.equal(needsApps(p), true);
});

test('docker fixture: pipeline and recipe files', () => {
  const p = readPlan(fixture('linkbox-docker.storydiff'));
  assert.deepEqual(p.shows.slice(0, 2), [
    { kind: 'pipeline', file: '.github/workflows/test.yml', label: 'What runs on every push', line: 10 },
    { kind: 'recipe', file: 'Dockerfile', label: 'What the image is built from', line: 11 },
  ]);
});

test('the four POC specs read without errors (no run line, so nothing to start)', () => {
  for (const k of ['tags', 'infra', 'refactor', 'big']) {
    const p = readPlan(readFileSync(new URL(`../../poc/v3/data/${k}/handover.storydiff`, import.meta.url), 'utf8'));
    assert.equal(p.run, null);
    assert.ok(p.shows.length > 0, k);
  }
});

test('same on a screen, and same with a body', () => {
  const p = readPlan('show same "The page" screen /links\nshow same "Save" POST /api/links {"url":"x"}');
  assert.deepEqual(p.shows[0], { kind: 'same', label: 'The page', target: { kind: 'screen', path: '/links' }, line: 1 });
  assert.deepEqual(p.shows[1], { kind: 'same', label: 'Save', target: { kind: 'call', method: 'POST', path: '/api/links', body: { url: 'x' } }, line: 2 });
});

test('scenario with do and then lines', () => {
  const p = readPlan([
    'show scenario "Stripe sends the same event twice"',
    '    do POST /webhooks {"id":"evt_9"} "Stripe sends" "{id} · ${amount}"',
    '    do POST /webhooks {"id":"evt_9"} "…and again"',
    '    then GET /charges "${total}" "charged {count} times" want "$49"',
    'show scenario "a refund lands during a retry"',
    '  do POST /refunds "Refund asked"',
    '  then GET /refunds/1 "{@s} s" "refund done"',
  ].join('\n'));
  assert.equal(p.shows.length, 2);
  const s = p.shows[0];
  assert.ok(s.kind === 'scenario');
  assert.deepEqual(s.steps.map(x => [x.method, x.path, x.title, x.note]), [['POST', '/webhooks', 'Stripe sends', '{id} · ${amount}'], ['POST', '/webhooks', '…and again', '{@status}']]);
  assert.deepEqual(s.then && [s.then.big, s.then.small, s.then.want], ['${total}', 'charged {count} times', '$49']);
  const r = p.shows[1];
  assert.ok(r.kind === 'scenario' && r.then && r.then.want === undefined && r.steps.length === 1);
});

test('env values may be quoted; comments are ignored', () => {
  const p = readPlan('run "npm start" port 8080 env A=1 B="two words" C=x=y # a comment');
  assert.deepEqual(p.run!.env, { A: '1', B: 'two words', C: 'x=y' });
});

test('pins under marks are collected once; other indented lines are not capture lines', () => {
  const p = readPlan('+ "a"\n    pin screen "#x"\n    pin call "tags"\n    proof a.js:1\n+ "b"\n    pin screen "#x"\n    pin screen page');
  assert.deepEqual(p.screenPins, ['#x', 'page']);
});

test('files alone need no apps', () => {
  assert.equal(needsApps(readPlan('show recipe Dockerfile\nshow pipeline ci.yml')), false);
});

test('errors carry line numbers', () => {
  const bad: [string, RegExp][] = [
    ['run "npm start"', /Line 1: run needs the port/],
    ['run npm port 3', /Line 1: run needs a "command"/],
    ['run "a" port 3 env PORT=4', /Line 1: PORT is set by capture/],
    ['run "a" port 3 env lower', /Line 1: env takes K=V/],
    ['run "a" port 3\nrun "b" port 4', /Line 2: only one run line/],
    ['setup /api', /Line 1: setup needs METHOD \/path/],
    ['setup POST /api {nope}', /Line 1: the JSON body does not parse/],
    ['\nshow call /x', /Line 2: show call needs METHOD \/path/],
    ['show same GET /x', /Line 1: show same needs a "label"/],
    ['show recipe "Dockerfile"', /Line 1: show recipe needs a file/],
    ['show scenario', /Line 1: show scenario needs/],
    ['show table x', /Line 1: show needs one of/],
    ['show scenario "s"\n  do GET /x', /Line 2: do needs a "Step"/],
    ['show scenario "s"\n  then GET /x "big"', /Line 2: then needs "big" and "small"/],
    ['show scenario "s"\n  then GET /x "a" "b"\n  then GET /x "a" "b"', /Line 3: a scenario has one then/],
    ['+ "x"\n  do GET /x "a"', /Line 2: do goes indented under a show scenario/],
    ['setup GET "/x', /Line 1: an opening " has no closing "/],
  ];
  for (const [src, re] of bad) assert.throws(() => readPlan(src), re, src);
});
