// Grammar added for capture, ship and the real-PR stress tests (plan Tasks 8 and 9a).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/spec/parse.ts';

const MAP = 'code api "API"\ncode db "DB"\napi -> db\n';

test('json bodies are read to the matching bracket, so a later quote with braces stays a quote', () => {
  const d = parse('show scenario "twice"\n    do POST /x {"a":{"b":1}} "Step" "{id} · {@status}"\n' + MAP + '+ "x"');
  const sh = d.shows[0];
  assert.equal(sh.kind, 'scenario');
  assert.deepEqual(sh.kind === 'scenario' && sh.steps, [{ method: 'POST', path: '/x', body: { a: { b: 1 } }, title: 'Step', note: '{id} · {@status}' }]);
});

test('run, setup and run-tests', () => {
  const d = parse('run "node server.js" port 3000 env LINKBOX_DB=:memory: K="two words"\nsetup POST /api/links {"url":"x"}\nsetup GET /health\nrun-tests "cargo test --all"\n' + MAP + '+ "x"');
  assert.deepEqual(d.run, { cmd: 'node server.js', port: 3000, env: { LINKBOX_DB: ':memory:', K: 'two words' } });
  assert.deepEqual(d.setup, [{ method: 'POST', path: '/api/links', body: { url: 'x' } }, { method: 'GET', path: '/health' }]);
  assert.equal(d.runTests, 'cargo test --all');
  assert.throws(() => parse('run "a" env PORT=1\n' + MAP + '+ "x"'), /PORT/);
  assert.throws(() => parse('run "a"\nrun "b"\n' + MAP + '+ "x"'), /one run line/);
});

test('show same with a body, show terminal, and scenario then', () => {
  const d = parse('show same "Save a link" POST /api/links {"url":"x"}\nshow terminal "node cli.js --help" "What --help prints"\nshow scenario "twice"\n    do POST /w {"id":"e"} "Stripe sends"\n    then GET /charges "{total}" "charged {@count} times" want "$49"\n' + MAP + '+ "x"');
  assert.deepEqual(d.shows[0], { kind: 'same', label: 'Save a link', what: 'POST /api/links', body: { url: 'x' } });
  assert.deepEqual(d.shows[1], { kind: 'terminal', cmd: 'node cli.js --help', label: 'What --help prints' });
  const sc = d.shows[2];
  assert.deepEqual(sc.kind === 'scenario' && sc.then, { method: 'GET', path: '/charges', big: '{total}', small: 'charged {@count} times', want: '$49' });
  assert.throws(() => parse(MAP + 'do GET /x "y"'), /do and then go under a show scenario line/);
});

test('smaller lines list the files they account for', () => {
  const d = parse(MAP + '+ "x"\nsmaller "Typos in the README" files README.md, docs/a.md');
  assert.deepEqual(d.smaller, [{ line: 'Typos in the README', files: ['README.md', 'docs/a.md'], src: 5 }]);
});

test('x marks what breaks for callers, listed first; x -> y is still an arrow', () => {
  const d = parse('code x "X"\ncode y "Y"\nx -> y\n+ "new thing"\nx y "Renamed connect() to open()."\n! "Try it."');
  assert.equal(d.edges.length, 1);
  const byN = d.marks.filter((m) => m.n).sort((a, b) => a.n! - b.n!).map((m) => m.mark);
  assert.deepEqual(byN, ['breaks', 'new', 'watch']);
});

test('only new, changed and kept count toward the 7-item cap', () => {
  const items = Array.from({ length: 7 }, (_, i) => `+ "item ${i}"`).join('\n');
  const d = parse(MAP + items + '\n! "try a"\n! "try b"\nx db "breaks c"');
  assert.deepEqual(d.marks.filter((m) => m.n).map((m) => m.n).sort((a, b) => a! - b!), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.throws(() => parse(MAP + items + '\n= db "one too many"'), /at most 7/);
});

test('ask with a source, more than one ask, and by without an agent', () => {
  const d = parse('by "Maya"\nask "Fix the crash" from "davidism" in "#1484"\nask "Also keep the old flag"\n' + MAP + '+ "x"');
  assert.deepEqual(d.asks, [{ text: 'Fix the crash', from: 'davidism', in: '#1484' }, { text: 'Also keep the old flag' }]);
  assert.equal(d.ask, 'Fix the crash');
  assert.equal(d.agent, '');
});

test('a box can live in another repo', () => {
  const d = parse('service auth "Auth" in "orchestrator#981"\ncode api "API"\napi -> auth\n+ service cache "Cache" in "infra#12" "A shared cache."');
  assert.equal(d.nodes.auth.repo, 'orchestrator#981');
  assert.equal(d.nodes.auth.label, 'Auth');
  assert.equal(d.nodes.cache.repo, 'infra#12');
  assert.equal(d.marks[0].line, 'A shared cache.');
});

test('pins on the before side, and pins on a terminal line', () => {
  const d = parse(MAP + '! "It crashed before."\n    pin before screen ".error"\n    pin before line "panicked at"\n    pin line "3 synced"');
  assert.deepEqual(d.marks[0].pins, [{ on: 'screen', target: '.error', side: 'before' }, { on: 'line', target: 'panicked at', side: 'before' }, { on: 'line', target: '3 synced', side: 'after' }]);
});

test('chapters: shared header, one doc per chapter, a + chapter needs no map', () => {
  const src = 'pr "Shop #482" files 31\nby "Maya" with "Claude Code"\nchapters "Charge once", "+ 6 smaller changes"\nchapter 1\nask "Charge once"\n' + MAP + '+ "x"\n! "try one"\nchapter 2\nask "Small things"\n! "Check the logs."\n+ "Typos."';
  const d = parse(src);
  assert.equal(d.chapter, 1);
  assert.equal(d.pr, 'Shop #482');
  assert.equal(d.rest.length, 1);
  const two = d.rest[0];
  assert.equal(two.chapter, 2);
  assert.equal(two.pr, 'Shop #482');
  assert.equal(two.ask, 'Small things');
  assert.equal(two.order.length, 0);
  assert.equal(two.marks.length, 2);
  assert.throws(() => parse(src.replace('chapter 2', 'oops')), /Line 11: unknown line/);
});
