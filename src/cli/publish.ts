// The spec travels in the PR description: a fenced storydiff block plus the check result in a hidden comment.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Report } from '../render/types.ts';
import { MARKER } from '../render/markdown.ts';

const START = '<!-- storydiff:start -->', END = '<!-- storydiff:end -->';
const REPORT = /<!-- storydiff-report ([\s\S]*?) -->/;

function fence(spec: string): string {
  const longest = Math.max(2, ...(spec.match(/`{3,}/g) || []).map((s) => s.length));
  return '`'.repeat(longest + 1);
}

// Storydiff's own markers inside a spec would end the block early; a word joiner keeps them inert, reversibly.
const WJ = '⁠';
const inert = (spec: string) => spec.replace(/<!-- storydiff(:start|:end|-report)/g, `<!-- storydiff${WJ}$1`);
const live = (spec: string) => spec.replace(new RegExp(`<!-- storydiff${WJ}(:start|:end|-report)`, 'g'), '<!-- storydiff$1');

/** The block that goes in the PR body. "--" is escaped so the JSON can never close the HTML comment. */
export function block(spec: string, report: Report): string {
  const s = inert(spec.replace(/\n+$/, ''));
  const f = fence(s);
  const json = JSON.stringify(report).replace(/--/g, '-\\u002d').replace(/>/g, '\\u003e');
  return `${START}\n${f}storydiff\n${s}\n${f}\n<!-- storydiff-report ${json} -->\n${END}`;
}

/** Where the last block sits in a body: [start, end), also when a human deleted its end marker. */
function lastBlock(body: string): [number, number] | null {
  const a = body.lastIndexOf(START);
  if (a < 0) return null;
  const z = body.indexOf(END, a);
  if (z >= 0) return [a, z + END.length];
  const rest = body.slice(a);
  const r = rest.match(/^[\s\S]*?<!-- storydiff-report [\s\S]*?-->/) ?? rest.match(/^[\s\S]*?\n(`{3,})storydiff[^\n]*\n[\s\S]*?\n\1[ \t]*(?=\n|$)/);
  return [a, a + (r ? r[0].length : START.length)];
}

/** Puts the block in the body, replacing the last one in place and keeping everything else. */
export function upsertBlock(body: string, spec: string, report: Report): string {
  const b = block(spec, report);
  const at = lastBlock(body);
  if (at) return body.slice(0, at[0]) + b + body.slice(at[1]);
  return body.trim() ? body.replace(/\s+$/, '') + '\n\n' + b : b;
}

/** The spec and report from a PR body (its last storydiff block), or null when it holds none. */
export function extractSpec(body: string): { spec: string; report: Report | null } | null {
  const at = lastBlock(body);
  const region = at ? body.slice(at[0], at[1]) : body;
  const m = region.match(/^(`{3,})storydiff[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*$/m);
  if (!m) return null;
  const r = region.match(REPORT);
  let report: Report | null = null;
  if (r) { try { report = JSON.parse(r[1]) as Report; } catch { report = null; } }
  return { spec: live(m[2]), report };
}

// --- gh -----------------------------------------------------------------------------------------------------------
function gh(args: string[], input?: string): string {
  const r = spawnSync('gh', args, { encoding: 'utf8', input });
  if (r.error) throw new Error('storydiff publish needs the GitHub CLI (gh). Install it and run gh auth login.');
  if (r.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(' ')} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

export interface PublishResult { pr: number; url: string; comment: 'created' | 'updated' }

/** Writes the block into the PR description and creates or updates the one Storydiff comment. */
export function publish(o: { cwd: string; pr?: string; spec: string; report: Report; markdown: string }): PublishResult {
  const view = JSON.parse(gh(['pr', 'view', ...(o.pr ? [o.pr] : []), '--json', 'number,url,body'])) as { number: number; url: string; body: string };
  const tmp = mkdtempSync(join(tmpdir(), 'sd-pub-'));
  const bodyFile = join(tmp, 'body.md');
  writeFileSync(bodyFile, upsertBlock(view.body || '', o.spec, o.report));
  gh(['pr', 'edit', String(view.number), '--body-file', bodyFile]);
  // Only a marked comment this account wrote can be edited; someone else's (the Action's bot) is left alone.
  const me = gh(['api', 'user', '--jq', '.login']).trim();
  const ids = gh(['api', `repos/{owner}/{repo}/issues/${view.number}/comments`, '--paginate', '--jq', `.[] | select((.body | startswith(${JSON.stringify(MARKER)})) and .user.login == ${JSON.stringify(me)}) | .id`]);
  const mine = ids.split('\n').filter(Boolean).map((id) => ({ id: Number(id) }))[0];
  const payload = join(tmp, 'comment.json');
  writeFileSync(payload, JSON.stringify({ body: o.markdown }));
  let updated = false;
  try {
    if (mine) { gh(['api', '--method', 'PATCH', `repos/{owner}/{repo}/issues/comments/${mine.id}`, '--input', payload]); updated = true; }
    if (!updated) gh(['api', '--method', 'POST', `repos/{owner}/{repo}/issues/${view.number}/comments`, '--input', payload]);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  return { pr: view.number, url: view.url, comment: updated ? 'updated' : 'created' };
}
