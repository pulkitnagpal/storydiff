// Builds docs/AGENTS.storydiff.md, the snippet other agents (Codex, Cursor, Aider, …) read, from the
// plugin's language guide, so both say the same thing. Run: node scripts/agents-snippet.mjs
// `--check` exits 1 when the committed snippet is out of date.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LANGUAGE = path.join(ROOT, 'plugin', 'skills', 'storydiff', 'language.md');
const OUT = path.join(ROOT, 'docs', 'AGENTS.storydiff.md');

const HEAD = `<!-- Storydiff: paste this section into your repo's AGENTS.md (or .cursorrules, CONVENTIONS.md, …).
     Generated from plugin/skills/storydiff/language.md by scripts/agents-snippet.mjs. Do not edit by hand. -->

## Handing a change over for review (Storydiff)

When a change is ready for a pull request, or the human asks you to open or update one, hand it
over with Storydiff before you open the PR. It needs the \`storydiff\` command; if it is missing,
ask the human to install it once with \`npm install -g github:pulkitnagpal/storydiff\` (it is not on npm).

1. Write \`handover.storydiff\` at the repo root, as described below.
2. Run \`storydiff check\`. It writes \`.storydiff/report.json\` and exits 1 when a claim does not
   hold up. Fix the file, never the code, to match: correct a \`file:line\` or a test name, copy a
   quote exactly, or drop the line. Run it again until it passes (at most three rounds). If an old
   test now fails, stop and tell the human.
3. If the file has \`show\` lines, run \`storydiff capture\`. Remove any \`show\` it cannot capture.
4. Run \`storydiff render\` and \`storydiff view\`, and ask the human to look at the card.
5. Only after the human says yes: commit (never \`.storydiff/\`), push, open the PR if there is
   none, then run \`storydiff publish\`.

Quotes (\`said\`) are checked against the session log. \`storydiff check\` finds Claude Code's logs on
its own; for other agents, pass your transcript with \`--session <file>\` if you have one. Without a
log, quotes are shown as not checked. Add \`.storydiff/\` to \`.gitignore\`.

`;

export function build() {
  const lang = fs.readFileSync(LANGUAGE, 'utf8')
    // Demote the guide's headings one level so they sit under the section heading above.
    .replace(/^(#{1,5}) /gm, '#$1 ');
  return HEAD + lang;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = build();
  if (process.argv.includes('--check')) {
    const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (now !== text) { console.error('docs/AGENTS.storydiff.md is out of date: run node scripts/agents-snippet.mjs'); process.exit(1); }
  } else {
    fs.writeFileSync(OUT, text);
    console.log('wrote', path.relative(ROOT, OUT));
  }
}
