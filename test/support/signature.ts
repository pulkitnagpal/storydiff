// What a reviewer sees on a card, reduced to comparable facts. Works on canvas boards and on generated cards alike:
// texts (whitespace ignored), every pin as tone+number, and the map strips' geometry. Screen windows are left out,
// because the canvas draws them as mockups and the card shows real screenshots.
interface El { tag: string; attrs: Record<string, string>; kids: (El | string)[] }

const VOID = new Set(['img', 'br', 'meta', 'link', 'input', 'hr']);
const ENT: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

function tree(html: string): El {
  html = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<helmet>[\s\S]*?<\/helmet>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const root: El = { tag: '#root', attrs: {}, kids: [] };
  const stack = [root];
  const re = /<(\/?)([a-zA-Z0-9-]+)((?:\s+[^\s=>]+(?:="[^"]*"|='[^']*')?)*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[5] !== undefined) { stack[stack.length - 1].kids.push(m[5].replace(/&[a-z#0-9]+;/g, (e) => ENT[e] ?? e)); continue; }
    const tag = m[2].toLowerCase();
    if (m[1]) { while (stack.length > 1 && stack.pop()!.tag !== tag); continue; }
    const attrs: Record<string, string> = {};
    (m[3] || '').replace(/([^\s=]+)(?:="([^"]*)"|='([^']*)')?/g, (_, k, a, b) => { attrs[k] = (a ?? b ?? '').replace(/&[a-z#0-9]+;/g, (e: string) => ENT[e] ?? e); return ''; });
    const el: El = { tag, attrs, kids: [] };
    stack[stack.length - 1].kids.push(el);
    if (!VOID.has(tag) && !m[4]) stack.push(el);
  }
  return root;
}

const cls = (e: El) => (e.attrs.class || '').split(/\s+/).filter(Boolean);
const has = (c: string) => (e: El) => cls(e).includes(c);
const text = (e: El | string, skip?: (e: El) => boolean): string => typeof e === 'string' ? e : skip && skip(e) ? '' : e.kids.map((k) => text(k, skip)).join('');
const squash = (s: string) => s.replace(/\s+/g, '');
function all(e: El, f: (e: El) => boolean, out: El[] = [], inside?: (e: El) => boolean): El[] {
  if (inside && inside(e)) return out;
  if (f(e)) out.push(e);
  for (const k of e.kids) if (typeof k !== 'string') all(k, f, out, inside);
  return out;
}
const px = (e: El, k: string): number | null => {
  const m = (e.attrs.style || '').match(new RegExp(`(?:^|;)\\s*${k}:\\s*(-?[\\d.]+)px`));
  return m ? Number(m[1]) : null;
};
const isPin = (e: El) => has('mk')(e) || has('mki')(e);
function tone(e: El): string {
  const c = cls(e).find((x) => x.length === 1);
  if (c) return c;
  const st = e.attrs.style || '';
  return /#8E8A84/i.test(st) ? 'x' : /#C2410C/i.test(st) ? 'o' : /#0F766E/i.test(st) ? 'g' : /#4338CA/i.test(st) ? 'c' : '?';
}
function state(e: El): string {
  for (const k of ['new', 'kept', 'chg', 'gone']) if (cls(e).includes(k)) return k;
  const st = e.attrs.style || '';
  if (/line-through/.test(st)) return 'gone';
  if (/#0F766E/i.test(st)) return 'new';
  if (/#4338CA/i.test(st)) return 'chg';
  if (/dashed/.test(st)) return 'kept';
  return '';
}

export interface Box { label: string; state: string; left: number; top: number; width: number; height: number }
export interface StripPin { tone: string; n: string; left: number; top: number }
export interface Signature {
  header: string[]; footer: string[]; sections: string[]; labels: string[]; verdict: string[]; list: string[];
  json: string[]; same: string[]; panels: string[]; pins: string[];
  strips: { boxes: Box[]; pins: StripPin[] }[];
}

export function cardSignature(html: string): Signature {
  const r = tree(html);
  const win = (e: El) => has('win')(e);
  return {
    header: all(r, (e) => e.tag === 'header' || e.tag === 'nav').map((e) => squash(text(e))),
    footer: all(r, (e) => e.tag === 'footer').map((e) => squash(text(e))),
    sections: all(r, (e) => e.tag === 'section').map((e) => squash(text(e))),
    labels: all(r, has('lbl')).map((e) => squash(text(e))),
    verdict: all(r, has('vt')).map((e) => squash(text(e))),
    list: all(r, has('li')).map((e) => squash(text(e))),
    json: all(r, has('json')).map((e) => squash(text(e, isPin))),
    same: all(r, (e) => has('same')(e) || has('sr')(e)).map((e) => squash(text(e))),
    panels: all(r, (e) => ['stp', 'rr', 'fr', 'oc'].some((c) => cls(e).includes(c))).map((e) => squash(text(e))),
    pins: all(r, isPin).map((e) => tone(e) + squash(text(e))).sort(),
    strips: all(r, has('strip')).map((s) => ({
      boxes: all(s, has('sb')).map((b) => ({ label: squash(text(b)), state: state(b), left: px(b, 'left') ?? 0, top: px(b, 'top') ?? 0, width: px(b, 'width') ?? 104, height: px(b, 'height') ?? 40 }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      pins: all(s, has('mk')).map((p) => ({ tone: tone(p), n: squash(text(p)), left: px(p, 'left') ?? 0, top: px(p, 'top') ?? 0 }))
        .sort((a, b) => a.n.localeCompare(b.n)),
    })),
  };
  void win;
}

/** Differences between two signatures; positions may differ by `tol` px. */
export function diffSignatures(got: Signature, want: Signature, tol = 4): string[] {
  const out: string[] = [];
  for (const k of ['header', 'footer', 'sections', 'labels', 'verdict', 'list', 'json', 'same', 'panels', 'pins'] as const) {
    if (JSON.stringify(got[k]) !== JSON.stringify(want[k])) out.push(`${k}:\n    got  ${JSON.stringify(got[k])}\n    want ${JSON.stringify(want[k])}`);
  }
  if (got.strips.length !== want.strips.length) out.push(`strips: got ${got.strips.length}, want ${want.strips.length}`);
  got.strips.forEach((g, i) => {
    const w = want.strips[i]; if (!w) return;
    const side = i === 0 ? 'before' : 'after';
    const near = (a: number, b: number) => Math.abs(a - b) <= tol;
    const bk = (b: Box) => `${b.label}|${b.state}|${b.left},${b.top} ${b.width}x${b.height}`;
    if (g.boxes.length !== w.boxes.length || g.boxes.some((b, j) => { const x = w.boxes[j]; return b.label !== x.label || b.state !== x.state || !near(b.left, x.left) || !near(b.top, x.top) || !near(b.width, x.width) || !near(b.height, x.height); }))
      out.push(`map ${side} boxes:\n    got  ${g.boxes.map(bk).join('  ')}\n    want ${w.boxes.map(bk).join('  ')}`);
    const pk = (p: StripPin) => `${p.tone}${p.n}@${p.left},${p.top}`;
    if (g.pins.length !== w.pins.length || g.pins.some((p, j) => { const x = w.pins[j]; return p.tone !== x.tone || p.n !== x.n || !near(p.left, x.left) || !near(p.top, x.top); }))
      out.push(`map ${side} pins:\n    got  ${g.pins.map(pk).join('  ')}\n    want ${w.pins.map(pk).join('  ')}`);
  });
  return out;
}
