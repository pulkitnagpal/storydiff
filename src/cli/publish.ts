// The spec travels in the PR description: a fenced storydiff block plus the check result in a hidden comment.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
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

/** The block that goes in the PR body. "--" is escaped so the JSON can never close the HTML comment. */
export function block(spec: string, report: Report): string {
  const f = fence(spec);
  const json = JSON.stringify(report).replace(/--/g, '-\\u002d').replace(/>/g, '\\u003e');
  return `${START}\n${f}storydiff\n${spec.replace(/\n+$/, '')}\n${f}\n<!-- storydiff-report ${json} -->\n${END}`;
}

/** Puts the block in the body, replacing an earlier one in place, keeping everything else. */
export function upsertBlock(body: string, spec: string, report: Report): string {
  const b = block(spec, report);
  const a = body.indexOf(START), z = body.indexOf(END);
  if (a >= 0 && z > a) return body.slice(0, a) + b + body.slice(z + END.length);
  return body.trim() ? body.replace(/\s+$/, '') + '\n\n' + b : b;
}

/** The spec and report from a PR body, or null when it holds no storydiff block. */
export function extractSpec(body: string): { spec: string; report: Report | null } | null {
  const m = body.match(/^(`{3,})storydiff[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*$/m);
  if (!m) return null;
  const r = body.match(REPORT);
  let report: Report | null = null;
  if (r) { try { report = JSON.parse(r[1]) as Report; } catch { report = null; } }
  return { spec: m[2], report };
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
  const ids = gh(['api', `repos/{owner}/{repo}/issues/${view.number}/comments`, '--paginate', '--jq', `.[] | select(.body | startswith(${JSON.stringify(MARKER)})) | .id`]);
  const mine = ids.split('\n').filter(Boolean).map((id) => ({ id: Number(id) }))[0];
  const payload = join(tmp, 'comment.json');
  writeFileSync(payload, JSON.stringify({ body: o.markdown }));
  if (mine) gh(['api', '--method', 'PATCH', `repos/{owner}/{repo}/issues/comments/${mine.id}`, '--input', payload]);
  else gh(['api', '--method', 'POST', `repos/{owner}/{repo}/issues/${view.number}/comments`, '--input', payload]);
  return { pr: view.number, url: view.url, comment: mine ? 'updated' : 'created' };
}
