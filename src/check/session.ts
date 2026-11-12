// The human's own words, from a Claude Code session log (~/.claude/projects/<folder>/<session>.jsonl).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export interface HumanMessage { text: string; atMs: number; ts: number }

const FOLLOW_UP = /^The (?:coordinator|user) sent a message while you were working:\n([\s\S]*)/;
const CONTINUED = /^This session is being continued from a previous conversation/;

function textOf(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  if (content.some((b) => b && b.type === 'tool_result')) return null; // a tool's output, not a person
  return content.filter((b) => b && b.type === 'text').map((b) => String(b.text)).join('\n');
}

function entries(file: string): Record<string, any>[] {
  const out: Record<string, any>[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a torn last line */ }
  }
  return out;
}

/** What a person typed in one message: pasted content, fenced code, quoted lines and long pasted blocks removed. */
export function typedWords(c: string): string {
  c = c.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<pasted_content\b[^>]*>[\s\S]*?<\/pasted_content>/g, '')
    .replace(/```[\s\S]*?```/g, '');
  const lines = c.split('\n').filter((l) => !/^\s*>/.test(l));
  return lines.join('\n').split(/\n\s*\n/).filter((p) => p.split('\n').length < 12).join('\n\n').trim();
}

/** What the human typed, with the time since the session started. Tools, reminders, meta turns and compaction summaries are left out. */
export function humanMessages(file: string): HumanMessage[] {
  const all = entries(file);
  const t0 = all.map((d) => Date.parse(d.timestamp)).find((t) => !Number.isNaN(t)) ?? 0;
  const out: HumanMessage[] = [];
  for (const d of all) {
    const m = d.message;
    if (!m || m.role !== 'user' || d.isCompactSummary || d.isVisibleInTranscriptOnly) continue;
    let c = textOf(m.content);
    if (c == null) continue;
    if (d.isMeta) { const f = c.match(FOLLOW_UP); if (!f) continue; c = f[1]; }
    if (CONTINUED.test(c.trim())) continue;
    // A slash command: only its arguments are the human's words.
    if (/<command-name>/.test(c)) c = (c.match(/<command-args>([\s\S]*?)<\/command-args>/) || [])[1] || '';
    if (/^<(local-command-(stdout|stderr)|bash-(input|stdout|stderr))>/.test(c.trim()) || /^\[Request interrupted/.test(c.trim())) continue;
    c = typedWords(c);
    if (!c) continue;
    const t = Date.parse(d.timestamp);
    out.push({ text: c, atMs: Number.isNaN(t) ? 0 : t - t0, ts: Number.isNaN(t) ? t0 : t });
  }
  return out;
}

function span(file: string): [number, number] | null {
  let lo = Infinity, hi = -Infinity;
  for (const d of entries(file)) { const t = Date.parse(d.timestamp); if (!Number.isNaN(t)) { if (t < lo) lo = t; if (t > hi) hi = t; } }
  return lo === Infinity ? null : [lo, hi];
}

/** "25 min" or "2 h", from the first to the last timestamp in the log. */
export function sessionLength(file: string): string {
  const s = span(file);
  if (!s || s[1] === s[0]) return '';
  const min = (s[1] - s[0]) / 60_000;
  return min < 60 ? `${Math.max(1, Math.round(min))} min` : `${Math.round(min / 60)} h`;
}

export const mmss = (ms: number) => { const s = Math.round(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const pad = (n: number) => String(n).padStart(2, '0');
/** mm:ss from the start, or "day N, HH:MM" (local clock) in sessions longer than a day. */
export function quoteTime(m: HumanMessage, file: string): string {
  const s = span(file);
  if (!s || s[1] - s[0] <= 24 * 3600_000) return mmss(m.atMs);
  const a = new Date(s[0]), b = new Date(m.ts);
  const day = Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime() - new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()) / 86400_000) + 1;
  return `day ${day}, ${pad(b.getHours())}:${pad(b.getMinutes())}`;
}

/** Lowercase letters and digits only, so punctuation, quotes, dashes and ellipses never decide a match. */
export const normQuote = (s: string) => s.normalize('NFKC').toLowerCase().replace(/['’‘`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** The quote, word for word, inside what the human typed (on word boundaries). */
export const quoteIn = (quote: string, typed: string) => { const q = normQuote(quote); return !!q && (' ' + normQuote(typed) + ' ').includes(' ' + q + ' '); };

const projectDir = (dir: string, home: string) => join(home, '.claude', 'projects', resolve(dir).replace(/[^A-Za-z0-9]/g, '-'));

/**
 * The session log for this change. Looks in Claude Code's folder for `from` and each parent up to `root`,
 * and prefers the newest log that wrote handover.storydiff (several sessions can share one folder).
 */
export function findSession(from: string, home = homedir(), root?: string): string | null {
  const dirs: string[] = [];
  for (let d = resolve(from); ; d = dirname(d)) {
    dirs.push(projectDir(d, home));
    if ((root && resolve(root) === d) || dirname(d) === d || !root) break;
  }
  const logs = dirs.filter((d) => existsSync(d)).flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.jsonl')).map((f) => join(d, f)));
  if (!logs.length) return null;
  logs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return logs.find((f) => readFileSync(f, 'utf8').includes('handover.storydiff')) ?? logs[0];
}
