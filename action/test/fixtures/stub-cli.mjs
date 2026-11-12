#!/usr/bin/env node
// A stand-in for the storydiff CLI with the commands and flags from docs/v1-build.md, so the
// Action can be tested before the real CLI lands. It honours the file contracts:
// handover.storydiff in, .storydiff/report.json and .storydiff/captures.json out.
//
//   check    a proof fails when it cites line 999 or a test named "made up"; quotes are null (no session log)
//   render   writes --md (marker, title, image link, list) and --png (a real PNG)
//   capture  writes captures.json; STUB_CAPTURE_EXIT makes it fail
// STUB_LOG: append one JSON line per call (argv, and whether a token leaked into the environment).
// STUB_NO_REPORT=1: check writes nothing.  STUB_NO_PNG=1: render writes no PNG.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const OUT = '.storydiff';
fs.mkdirSync(OUT, { recursive: true });

if (process.env.STUB_LOG) {
  fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ cmd, rest, tokenSeen: !!(process.env.GITHUB_TOKEN || process.env.GH_TOKEN) }) + '\n');
}

const spec = fs.existsSync('handover.storydiff') ? fs.readFileSync('handover.storydiff', 'utf8') : '';

if (cmd === '--version') { console.log('storydiff 0.0.0-stub'); process.exit(0); }

if (cmd === 'check') {
  if (process.env.STUB_NO_REPORT) process.exit(2);
  const checks = [];
  for (const line of spec.split('\n')) {
    const t = line.trim();
    if (t.startsWith('proof ')) {
      const ref = t.slice(6).trim();
      const bad = /:999$/.test(ref) || /^test made up/.test(ref);
      checks.push({ ref, kind: 'proof', ok: !bad, why: bad ? 'no such line or test' : 'found' });
    } else if (t.startsWith('said ')) {
      const ref = (t.match(/"(.*)"/) || [])[1] || t;
      checks.push({ ref, kind: 'said', ok: null, why: 'no session log on this machine' });
    }
  }
  const failed = checks.filter(c => c.ok !== true).length;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ oldPass: 3, newTests: 2, regressed: [], claims: checks.length, failed, checks }));
  console.log(failed ? `✗ ${failed} of ${checks.length} claims don't hold up` : `✓ ${checks.length} claims checked`);
  process.exit(failed ? 1 : 0);
}

if (cmd === 'render') {
  const report = JSON.parse(fs.readFileSync(path.join(OUT, 'report.json'), 'utf8'));
  const title = (spec.match(/^title\s+"(.*)"/m) || [])[1] || 'Untitled';
  const md = flag('--md'), png = flag('--png'), img = flag('--image-url');
  const items = [...spec.matchAll(/^[+~=!-] .*"([^"]+)"\s*$/gm)].map((m, i) => `${i + 1}. ${m[1]}`);
  if (md) {
    fs.writeFileSync(md, [
      '<!-- storydiff:card -->',
      `### Storydiff · ${title}`,
      `**${report.failed ? `✗ ${report.failed} of ${report.claims} claims don't hold up` : `✓ ${report.claims} claims checked`}**`,
      img ? `![The Storydiff card](${img})` : '',
      ...items,
      '<details><summary>Map</summary>\n\n```mermaid\nflowchart LR\n  a --> b\n```\n</details>',
    ].filter(Boolean).join('\n\n'));
  }
  if (png && !process.env.STUB_NO_PNG) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    fs.copyFileSync(path.join(here, 'card.png'), png);
  }
  process.exit(0);
}

if (cmd === 'capture') {
  if (process.env.STUB_CAPTURE_EXIT) process.exit(+process.env.STUB_CAPTURE_EXIT);
  fs.writeFileSync(path.join(OUT, 'captures.json'), JSON.stringify({ shows: [] }));
  process.exit(0);
}

console.error(`stub: unknown command ${cmd}`);
process.exit(64);
