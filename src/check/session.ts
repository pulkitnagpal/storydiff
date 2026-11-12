// The human's own words, from a Claude Code session log (~/.claude/projects/<repo path>/<session>.jsonl).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface HumanMessage { text: string; atMs: number }

const FOLLOW_UP = /^The (?:coordinator|user) sent a message while you were working:\n([\s\S]*)/;

function textOf(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  if (content.some((b) => b && b.type === 'tool_result')) return null; // a tool's output, not a person
  return content.filter((b) => b && b.type === 'text').map((b) => String(b.text)).join(' ');
}

function entries(file: string): Record<string, any>[] {
  const out: Record<string, any>[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a torn last line */ }
  }
  return out;
}

/** What the human typed, with the time since the session started. Tool output, system reminders and meta turns are left out. */
export function humanMessages(file: string): HumanMessage[] {
  const all = entries(file);
  const t0 = all.map((d) => Date.parse(d.timestamp)).find((t) => !Number.isNaN(t)) ?? 0;
  const out: HumanMessage[] = [];
  for (const d of all) {
    const m = d.message;
    if (!m || m.role !== 'user') continue;
    let c = textOf(m.content);
    if (c == null) continue;
    if (d.isMeta) { const f = c.match(FOLLOW_UP); if (!f) continue; c = f[1]; }
    c = c.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '');
    // A slash command: only its arguments are the human's words.
    if (/<command-name>/.test(c)) c = (c.match(/<command-args>([\s\S]*?)<\/command-args>/) || [])[1] || '';
    if (/^<local-command-(stdout|stderr)>/.test(c.trim()) || /^\[Request interrupted/.test(c.trim())) continue;
    c = c.trim();
    if (!c) continue;
    const t = Date.parse(d.timestamp);
    out.push({ text: c, atMs: Number.isNaN(t) ? 0 : t - t0 });
  }
  return out;
}

/** "25 min" or "2 h", from the first to the last timestamp in the log. */
export function sessionLength(file: string): string {
  const ts = entries(file).map((d) => Date.parse(d.timestamp)).filter((t) => !Number.isNaN(t));
  if (ts.length < 2) return '';
  const min = (Math.max(...ts) - Math.min(...ts)) / 60_000;
  return min < 60 ? `${Math.max(1, Math.round(min))} min` : `${Math.round(min / 60)} h`;
}

/** The newest session log Claude Code keeps for this folder, or null. */
export function findSession(repo: string, home = homedir()): string | null {
  const dir = join(home, '.claude', 'projects', repo.replace(/[^A-Za-z0-9]/g, '-'));
  if (!existsSync(dir)) return null;
  const logs = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => join(dir, f));
  if (!logs.length) return null;
  return logs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

export const mmss = (ms: number) => { const s = Math.round(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
export const normQuote = (s: string) => s.toLowerCase().replace(/[“”"'’‘]/g, '').replace(/\s+/g, ' ').trim();
