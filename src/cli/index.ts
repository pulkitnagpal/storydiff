#!/usr/bin/env node
// storydiff: check, render, view and publish the review card for the change in this folder.
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parse, SpecError } from '../spec/parse.ts';
import type { Doc } from '../spec/types.ts';
import { renderPage } from '../render/card.ts';
import { loadCaptures, loadReport } from '../render/captures.ts';
import { renderMarkdown, verdictLine } from '../render/markdown.ts';
import type { Report } from '../render/types.ts';
import { check, findSession } from '../check/index.ts';
import { screenshot } from '../shot/index.ts';
import { publish } from './publish.ts';

const HELP = `storydiff: the agent hands its PR over as one checked card.

  storydiff check    [--base REF] [--session ID|FILE|none] [--test-cmd CMD] [--no-tests]
                     Checks every line of handover.storydiff; writes .storydiff/report.json.
                     Exits 1 when a claim does not hold up or an old test now fails.
  storydiff render   [--html FILE] [--png FILE] [--md FILE] [--image-url URL] [--view-url URL]
                     Draws the card (default: --html .storydiff/card.html).
  storydiff view     Draws the card and opens it.
  storydiff publish  [--pr N] [--image-url URL] [--view-url URL] [--dry-run]
                     Puts the spec and the check result in the PR description and posts the card comment (gh).

  Common: --spec FILE (default: handover.storydiff at the repo root)
`;

declare const __STORYDIFF_VERSION__: string | undefined;
const version = () => typeof __STORYDIFF_VERSION__ === 'string' ? __STORYDIFF_VERSION__ : JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version as string;

class Exit extends Error { code: number; constructor(code: number, msg: string) { super(msg); this.code = code; } }

const say = (s: string) => process.stdout.write(s + '\n');
const warn = (s: string) => process.stderr.write('storydiff: ' + s + '\n');

function root(cwd: string): string {
  try { return execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return cwd; }
}

interface Ctx { repo: string; specPath: string; src: string; doc: Doc; out: string }

function load(cwd: string, spec?: string): Ctx {
  const repo = root(cwd);
  const specPath = spec ? resolve(cwd, spec) : join(repo, 'handover.storydiff');
  if (!existsSync(specPath)) throw new Exit(2, `no spec at ${relative(cwd, specPath) || specPath}. The agent writes handover.storydiff at the repo root (run /storydiff in Claude Code).`);
  const src = readFileSync(specPath, 'utf8');
  try {
    return { repo, specPath, src, doc: parse(src), out: join(repo, '.storydiff') };
  } catch (e) {
    if (e instanceof SpecError) throw new Exit(2, `${relative(cwd, specPath)}: ${e.message}`);
    throw e;
  }
}

function sessionFor(repo: string, arg?: string): string | null {
  if (arg === 'none') return null;
  if (arg) {
    if (existsSync(arg)) return resolve(arg);
    const found = findSession(repo);
    const byId = found && join(dirname(found), arg.replace(/\.jsonl$/, '') + '.jsonl');
    if (byId && existsSync(byId)) return byId;
    throw new Exit(2, `no session log ${arg}`);
  }
  return findSession(repo);
}

async function cmdCheck(cwd: string, a: Record<string, string | boolean | undefined>) {
  const c = load(cwd, a.spec as string);
  const session = sessionFor(c.repo, a.session as string);
  if (!session) warn('no Claude Code session log found for this folder, so quotes are not checked (pass --session FILE).');
  const rep = await check({ repo: c.repo, spec: c.src, base: a.base as string, session, testCmd: a['test-cmd'] as string, noTests: !!a['no-tests'] });
  mkdirSync(c.out, { recursive: true });
  writeFileSync(join(c.out, 'report.json'), JSON.stringify(rep, null, 2) + '\n');
  for (const t of rep.regressed) say(`✗ old test now fails: ${t}`);
  for (const k of rep.checks.filter((x) => x.ok !== true)) say(`${k.ok === false ? '✗' : '?'} line ${k.line}: ${k.kind === 'said' ? '“' + k.ref + '”' : k.ref}: ${k.why}`);
  say(verdictLine(c.doc, rep));
  say(`wrote ${relative(cwd, join(c.out, 'report.json'))}`);
  if (rep.failed || rep.regressed.length) process.exitCode = 1;
}

function report(c: Ctx): Report { return loadReport(c.out, c.doc); }

async function cmdRender(cwd: string, a: Record<string, string | boolean | undefined>, open = false) {
  const c = load(cwd, a.spec as string);
  const caps = loadCaptures(c.out), rep = report(c);
  const at = (f: string) => (isAbsolute(f) ? f : resolve(cwd, f));
  const wantHtml = (a.html as string) ?? (!a.png && !a.md ? join(c.out, 'card.html') : undefined);
  const html = renderPage(c.doc, caps, rep, { warn });
  const wrote: string[] = [];
  if (wantHtml) { const f = at(wantHtml); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, html); wrote.push(f); }
  if (a.png) {
    const f = at(a.png as string), tmp = join(c.out, 'card.html');
    mkdirSync(c.out, { recursive: true });
    if (!wantHtml || at(wantHtml) !== tmp) writeFileSync(tmp, html);
    mkdirSync(dirname(f), { recursive: true });
    await screenshot('file://' + tmp, f, { width: 1440, fullPage: true, settleMs: 600 });
    wrote.push(f);
  }
  if (a.md) { const f = at(a.md as string); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, renderMarkdown(c.doc, rep, { imageUrl: a['image-url'] as string, viewUrl: a['view-url'] as string })); wrote.push(f); }
  for (const f of wrote) say(`wrote ${relative(cwd, f) || f}`);
  if (open) {
    const f = wrote[0];
    if (process.env.STORYDIFF_NO_OPEN) return;
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    spawn(opener, [f], { detached: true, stdio: 'ignore' }).on('error', () => warn(`could not open the card; it is at ${f}`)).unref();
  }
}

async function cmdPublish(cwd: string, a: Record<string, string | boolean | undefined>) {
  const c = load(cwd, a.spec as string);
  const rep = report(c);
  if (rep.unchecked) warn('the checker has not run yet: the card will say "not checked yet". Run storydiff check first.');
  else if (rep.failed || rep.regressed.length) warn(`${rep.failed} claims do not hold up and ${rep.regressed.length} old tests fail. Publishing anyway; the card shows it.`);
  if (rep.head) rep.quotesCheckedAt = `the author's machine at ${rep.head}`;
  const markdown = renderMarkdown(c.doc, rep, { imageUrl: a['image-url'] as string, viewUrl: a['view-url'] as string });
  if (a['dry-run']) {
    const { upsertBlock } = await import('./publish.ts');
    say('--- PR description block ---');
    say(upsertBlock('', c.src, rep));
    say('--- comment ---');
    say(markdown);
    return;
  }
  const r = publish({ cwd, pr: a.pr as string, spec: c.src, report: rep, markdown });
  say(`PR #${r.pr}: description updated, card comment ${r.comment}. ${r.url}`);
}

export async function main(argv: string[], cwd = process.cwd()): Promise<void> {
  const { values: a, positionals } = parseArgs({
    args: argv, allowPositionals: true, strict: true,
    options: {
      spec: { type: 'string' }, base: { type: 'string' }, session: { type: 'string' }, 'test-cmd': { type: 'string' }, 'no-tests': { type: 'boolean' },
      html: { type: 'string' }, png: { type: 'string' }, md: { type: 'string' }, 'image-url': { type: 'string' }, 'view-url': { type: 'string' },
      pr: { type: 'string' }, 'dry-run': { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
    },
  });
  const cmd = positionals[0];
  if (a.version) { say(version()); return; }
  if (!cmd || a.help || cmd === 'help') { say(HELP); return; }
  if (cmd === 'check') return cmdCheck(cwd, a);
  if (cmd === 'render') return cmdRender(cwd, a);
  if (cmd === 'view') return cmdRender(cwd, { ...a, html: (a.html as string) ?? undefined }, true);
  if (cmd === 'publish') return cmdPublish(cwd, a);
  throw new Exit(2, `unknown command "${cmd}". Run storydiff --help.`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain || process.env.STORYDIFF_BIN) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    const code = e instanceof Exit ? e.code : 1;
    warn(e instanceof Error ? e.message : String(e));
    process.exit(code);
  });
}
