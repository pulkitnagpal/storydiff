// Fills "{field}" templates in scenario lines from one reply.
import type { Reply } from './http.ts';

export function pick(v: unknown, path: string): unknown {
  let cur: unknown = v;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur) && /^\d+$/.test(part)) cur = cur[+part];
    else if (typeof cur === 'object') cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return cur;
}

// Returns the text and the names that had no value (shown as "?").
export function fill(tpl: string, r: Reply): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = tpl.replace(/\{([@\w.-]+)\}/g, (_, name: string) => {
    let v: unknown;
    if (name === '@status') v = r.status;
    else if (name === '@ms') v = r.ms;
    else if (name === '@s') v = (r.ms / 1000).toFixed(r.ms < 10000 ? 2 : 1);
    else if (name === '@count') v = Array.isArray(r.json) ? r.json.length : undefined;
    else v = pick(r.json, name);
    if (v === undefined || v === null) { missing.push(name); return '?'; }
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  });
  return { text, missing };
}
