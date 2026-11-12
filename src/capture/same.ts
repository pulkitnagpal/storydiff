// "Same on both versions, times and ids ignored." Masks volatile values, then compares.

const ID_KEY = /^(id|ID|uuid|guid)$|_(id|uuid)$|[a-z0-9](Id|ID|Uuid)$/;
const TIME_KEY = /^(at|created|updated|modified|deleted|expires|timestamp|time|date|ts)$|_(at|on|time|date|ts)$|[a-z0-9](At|On|Time|Date|Timestamp)$/;
const ISO = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function mask(v: unknown, key = ''): unknown {
  if (Array.isArray(v)) return v.map(x => mask(x));
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = mask(x, k);
    return o;
  }
  if (typeof v === 'string' || typeof v === 'number') {
    if (key && ID_KEY.test(key)) return '(id)';
    if (key && TIME_KEY.test(key)) return '(time)';
    if (typeof v === 'string' && ISO.test(v)) return '(time)';
    if (typeof v === 'string' && UUID.test(v)) return '(id)';
    if (typeof v === 'number' && Number.isInteger(v) && v >= 1e12 && v < 1e13) return '(time)';  // epoch ms
  }
  return v;
}

// Times, dates and uuids inside visible text.
export function maskText(s: string): string {
  return s
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '(id)')
    .replace(/\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?/g, '(time)')
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?(\s?[AaPp][Mm])?\b/g, '(time)');
}

export type Diff = { at: string; before?: unknown; after?: unknown };

export function diff(a: unknown, b: unknown, at = '$', out: Diff[] = [], max = 20): Diff[] {
  if (out.length >= max) return out;
  const isObj = (x: unknown) => x !== null && typeof x === 'object';
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length) && out.length < max; i++) {
      if (i >= a.length) out.push({ at: `${at}[${i}]`, after: b[i] });
      else if (i >= b.length) out.push({ at: `${at}[${i}]`, before: a[i] });
      else diff(a[i], b[i], `${at}[${i}]`, out, max);
    }
    return out;
  }
  if (isObj(a) && isObj(b) && !Array.isArray(a) && !Array.isArray(b)) {
    const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>;
    for (const k of new Set([...Object.keys(ao), ...Object.keys(bo)])) {
      if (out.length >= max) break;
      const p = /^[A-Za-z_$][\w$]*$/.test(k) ? `${at}.${k}` : `${at}[${JSON.stringify(k)}]`;
      if (!(k in ao)) out.push({ at: p, after: bo[k] });
      else if (!(k in bo)) out.push({ at: p, before: ao[k] });
      else diff(ao[k], bo[k], p, out, max);
    }
    return out;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ at, before: a, after: b });
  return out;
}

export type SameResult = { match: boolean; diff: Diff[] | null };

// Two replies: status and body, masked.
export function sameReply(a: { status: number; json: unknown; text?: string }, b: { status: number; json: unknown; text?: string }): SameResult {
  const side = (r: typeof a) => ({ status: r.status, body: r.text !== undefined ? maskText(r.text) : mask(r.json) });
  const d = diff(side(a), side(b));
  return d.length ? { match: false, diff: d } : { match: true, diff: null };
}

// Two page snapshots: one line per visible element (tag, position, own text), masked.
export function sameSnapshot(a: string[], b: string[]): SameResult {
  const d = diff(a.map(maskText), b.map(maskText), 'line').map(x => ({ ...x, at: x.at.replace(/^line\[(\d+)\]$/, (_, i) => `line ${+i + 1}`) }));
  return d.length ? { match: false, diff: d } : { match: true, diff: null };
}
