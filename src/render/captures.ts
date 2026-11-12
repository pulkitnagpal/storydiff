// Reading .storydiff/: captures.json (from capture) and report.json (from check).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { Doc } from '../spec/types.ts';
import { uncheckedReport } from './card.ts';
import type { Captures, Report } from './types.ts';

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

function inline(dir: string, ref: string | null): string | null {
  if (ref == null) return null;
  if (/^(data:|https?:)/.test(ref)) return ref;
  const p = join(dir, ref);
  if (!existsSync(p)) throw new Missing(ref);
  return `data:${MIME[extname(p).toLowerCase()] ?? 'application/octet-stream'};base64,${readFileSync(p).toString('base64')}`;
}

class Missing extends Error {}

/** captures.json with screenshots turned into data URIs, so the card is one self-contained file. No file = no captures. */
export function loadCaptures(dir: string, warn: (m: string) => void = () => {}): Captures {
  const f = join(dir, 'captures.json');
  if (!existsSync(f)) return { shows: [] };
  const caps = JSON.parse(readFileSync(f, 'utf8')) as Captures;
  if (!Array.isArray(caps.shows)) throw new Error(`${f} needs a "shows" array, one entry per show line`);
  caps.shows = caps.shows.map((c, k) => {
    if (!c || c.kind !== 'screen') return c;
    try { return { ...c, before: inline(dir, c.before), after: inline(dir, c.after) }; } catch (e) {
      if (!(e instanceof Missing)) throw e;
      warn(`show ${k + 1}: captures.json points at ${e.message}, which is not in ${dir}; left out.`);
      return null;
    }
  });
  return caps;
}

const hash = (spec: string) => createHash('sha256').update(spec.replace(/\r/g, '')).digest('hex').slice(0, 16);

/**
 * report.json, or the "not checked yet" report when check has not run, or when the spec changed since it ran
 * (pass specText to compare), so a stale green is never shown as current.
 */
export function loadReport(dir: string, doc?: Doc, o: { specText?: string; warn?: (m: string) => void } = {}): Report {
  const f = join(dir, 'report.json');
  if (existsSync(f)) {
    const rep = JSON.parse(readFileSync(f, 'utf8')) as Report;
    if (!(o.specText !== undefined && rep.specHash && rep.specHash !== hash(o.specText) && doc)) return rep;
    o.warn?.('the spec changed since storydiff check ran, so the card says "not checked yet". Run storydiff check again.');
  }
  if (!doc) throw new Error(`no report at ${f}`);
  return uncheckedReport(doc);
}

/** Makes the output folder and keeps it out of git (a .gitignore with *), so no repo file needs touching. */
export function ensureOutDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const gi = join(dir, '.gitignore');
  if (!existsSync(gi)) writeFileSync(gi, '*\n');
}
