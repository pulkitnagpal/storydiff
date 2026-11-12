// The guide the agent follows must be valid v0.3, and every copy of it must agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../../scripts/agents-snippet.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
// poc/v3/spec.js is a browser script; load it without a module system.
const SPEC = new Function(read('poc/v3/spec.js') + '\nreturn SPEC;')();

test("the guide's full example parses as v0.3 and numbers its list 1 to 6", () => {
  const guide = read('plugin/skills/storydiff/language.md');
  const example = guide.split('## A complete example')[1].match(/```\n([\s\S]*?)```/)[1];
  const d = SPEC.parse(example);
  assert.equal(d.title, 'Tags for links');
  assert.equal(d.shows.length, 3);
  assert.deepEqual(d.marks.filter(m => m.n).map(m => m.n).sort(), [1, 2, 3, 4, 5, 6]);
  // Rule 1: everything is backed, except a `!` that says something has not been done yet.
  assert.ok(d.marks.every(m => m.proofs.length || m.said.length || m.mark === 'watch'), 'every mark is backed');
});

test('the mark-line snippets in the guide parse against a small map', () => {
  const map = 'endpoint api "API"\ncode server "s"\nendpoint receive "R"\nservice charge "C"\nexternal mobile "M"\nreceive -> charge\n';
  const lines = [
    '+ table tags "Tags" "Tags live in their own table."',
    '+ api -> tags',
    '~ server "server.js only starts the server now."',
    '- receive -> charge "Gone: charging straight after receiving."',
    '= mobile "The list the mobile app reads."',
    '! "Open the page once. Nobody has yet."',
  ];
  const d = SPEC.parse(map + lines.join('\n    proof a.js:1\n') + '\n    proof a.js:1\n');
  assert.equal(d.marks.length, 6);
});

test('AGENTS.storydiff.md is generated from the guide and up to date', () => {
  assert.equal(read('docs/AGENTS.storydiff.md'), build());
});

test('the skill points at the guide and runs only the CLI commands from docs/v1-build.md', () => {
  const skill = read('plugin/skills/storydiff/SKILL.md');
  assert.match(skill, /\[language\.md\]\(language\.md\)/);
  // Commands the skill runs: lines inside fenced blocks that start with `storydiff`.
  const code = [...skill.matchAll(/```[a-z!]*\n([\s\S]*?)```/g)].map(m => m[1]).join('\n');
  const used = new Set([...code.matchAll(/^\s*storydiff ([a-z-]+)/gm)].map(m => m[1]));
  const known = ['check', 'capture', 'render', 'view', 'publish', '--version'];
  for (const c of used) assert.ok(known.includes(c), `unknown storydiff command in SKILL.md: ${c}`);
  for (const c of ['check', 'capture', 'render', 'view', 'publish']) assert.ok(used.has(c), `SKILL.md runs storydiff ${c}`);
});
