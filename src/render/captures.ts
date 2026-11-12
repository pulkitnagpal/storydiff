// Reading .storydiff/: captures.json (from capture) and report.json (from check).
import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { Doc } from '../spec/types.ts';
import { uncheckedReport } from './card.ts';
import type { Captures, Report } from './types.ts';

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

function inline(dir: string, ref: string | null): string | null {
  if (ref == null) return null;
  if (/^(data:|https?:)/.test(ref)) return ref;
  const p = join(dir, ref);
  if (!existsSync(p)) throw new Error(`captures.json points at ${ref}, which is not in ${dir}`);
  return `data:${MIME[extname(p).toLowerCase()] ?? 'application/octet-stream'};base64,${readFileSync(p).toString('base64')}`;
}

/** captures.json with screenshots turned into data URIs, so the card is one self-contained file. No file = no captures. */
export function loadCaptures(dir: string): Captures {
  const f = join(dir, 'captures.json');
  if (!existsSync(f)) return { shows: [] };
  const caps = JSON.parse(readFileSync(f, 'utf8')) as Captures;
  if (!Array.isArray(caps.shows)) throw new Error(`${f} needs a "shows" array, one entry per show line`);
  caps.shows = caps.shows.map((c) => (c && c.kind === 'screen' ? { ...c, before: inline(dir, c.before), after: inline(dir, c.after) } : c));
  return caps;
}

/** report.json, or the "not checked yet" report when check has not run. */
export function loadReport(dir: string, doc?: Doc): Report {
  const f = join(dir, 'report.json');
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8')) as Report;
  if (!doc) throw new Error(`no report at ${f}`);
  return uncheckedReport(doc);
}
