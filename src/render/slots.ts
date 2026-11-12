// Slot 3: before -> after, one renderer per kind of show. Each draws only what was captured.
import type { Doc, Show } from '../spec/types.ts';
import { CURVE } from './css.ts';
import type { CallSide, ScenarioSide, ShowCapture, TerminalSide } from './types.ts';
import { esc, pinsOn, sec, type PinRef } from './util.ts';

type Cap<K extends ShowCapture['kind']> = Extract<ShowCapture, { kind: K }>;
type ShowOf<K extends Show['kind']> = Extract<Show, { kind: K }>;

// --- screen ---------------------------------------------------------------------------------------------------
type Rect = Cap<'screen'>['rects'][number];
function screenPins(pins: PinRef[], rects: Rect[] | undefined): string {
  return pins.filter((p) => p.target !== 'page').map((p) => {
    const r = (rects || []).find((x) => x.sel === p.target);
    if (!r || !r.found || !(r.w ?? 0) || !(r.h ?? 0)) return ''; // never draw a pin we could not find, or could not see
    const top = Math.max(-12, 31.5 + (r.y ?? 0) - 17), left = Math.max(0, Math.min(446, (r.x ?? 0) + (r.w ?? 0) - 5));
    return `<span class="mk ${p.t}" style="left: ${Math.round(left)}px; top: ${Math.round(top)}px">${p.n}</span>`;
  }).join('');
}

export function screen(d: Doc, sh: ShowOf<'screen'>, cap: Cap<'screen'>, first: boolean): string {
  const pins = pinsOn(d, 'screen'), pinsBefore = pinsOn(d, 'screen', 'before');
  const page = first ? pins.find((p) => p.target === 'page') : undefined;
  const win = (img: string, extra = '', inner = '') =>
    `<div class="win" style="${extra}"><div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="url">${esc(cap.app || 'App')}</span></div><img src="${esc(img)}" alt="">${inner}</div>`;
  const head = sec(sh.label || 'What people see', cap.before && cap.after ? sh.hint || 'spot the difference' : sh.hint);
  const col = (tag: string, body: string) => `<div style="display: flex; flex-direction: column; gap: 14px">${tag}${body}</div>`;
  if (!cap.before && !cap.after) return '';
  if (!cap.before) return head + `<div style="display: flex; align-items: center">${col('<span class="form">NEW · this page did not exist</span>', win(cap.after!, '', screenPins(pins, cap.rects)))}</div>`;
  if (!cap.after) return head + `<div style="display: flex; align-items: center">${col('<span class="form gone">REMOVED · this page is gone</span>', win(cap.before, 'opacity: .55', screenPins(pinsBefore, cap.rectsBefore)))}</div>`;
  const after = win(cap.after, page ? 'outline: 2.5px dashed #C2410C; outline-offset: 7px' : '', screenPins(pins, cap.rects) + (page ? `<span class="mk ${page.t}" style="left: 446px; top: -20px">${page.n}</span>` : ''));
  return head +
    `<div style="display: flex; align-items: center">${col('<span class="tag">BEFORE</span>', win(cap.before, '', screenPins(pinsBefore, cap.rectsBefore)))}${CURVE}` +
    `${col('<span class="tag" style="color: #0F766E">AFTER</span>', after)}</div>`;
}

// --- call: fields packed onto lines; volatile fields shown as (time); added and changed fields highlighted ------------
const VOLATILE = /(_at|At|time|date|_id_gen)$/;
type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);

function fields(obj: Obj, other: Obj | null, pins: PinRef[], side: 'before' | 'after'): string {
  const parts = Object.keys(obj).map((k) => {
    const vol = VOLATILE.test(k);
    const v = vol ? '<span class="mute">(time)</span>' : esc(JSON.stringify(obj[k]));
    let kv = `"${esc(k)}": ${v}`;
    const plain = `"${k}": ${vol ? '(time)' : JSON.stringify(obj[k])}`;
    const pin = pins.find((x) => x.target === k);
    const num = pin ? `<span class="mki ${pin.t}">${pin.n}</span>` : '';
    if (other && k in other && !vol && side === 'after' && JSON.stringify(other[k]) !== JSON.stringify(obj[k])) {
      kv = `<span class="addf${pin?.t === 'o' ? ' w' : ''}" style="outline-color: #4338CA; background: #E8E7FB; color: #312E81">${kv}</span>${num}`;
    } else if (other && !(k in other)) {
      kv = side === 'after' ? `<span class="addf${pin?.t === 'o' ? ' w' : ''}">${kv}</span>${num}` : `<span class="gonef">${kv}</span>`;
    }
    return { html: kv, len: plain.length };
  });
  const lines: string[][] = [];
  let cur: string[] = [], w = 0;
  for (const p of parts) {
    if (cur.length && w + p.len > 46) { lines.push(cur); cur = []; w = 0; }
    cur.push(p.html); w += p.len + 2;
  }
  if (cur.length) lines.push(cur);
  return '{ ' + lines.map((l) => l.join(', ')).join(',\n  ') + ' }';
}

function body(mine: CallSide, other: CallSide, pins: PinRef[], side: 'before' | 'after'): string {
  // A list: one row per item, matched by id, first four shown.
  if (Array.isArray(mine.json) && (Array.isArray(other.json) || other.status === 0)) {
    const others = (Array.isArray(other.json) ? other.json : []) as unknown[];
    const rows = (mine.json as unknown[]).slice(0, 4).map((row) => {
      if (!isObj(row)) return esc(JSON.stringify(row));
      const o = others.find((x) => isObj(x) && x.id === row.id) as Obj | undefined;
      return fields(row, other.status === 0 ? null : o ?? {}, pins, side);
    });
    const more = mine.json.length > 4 ? `,\n  …${mine.json.length - 4} more` : '';
    return '[ ' + rows.join(',\n  ') + more + ' ]';
  }
  if (other.status === 0) return isObj(mine.json) ? fields(mine.json, null, pins, side) : esc(JSON.stringify(mine.json ?? null));
  return isObj(mine.json) ? fields(mine.json, isObj(other.json) ? other.json : null, pins, side) : esc(JSON.stringify(mine.json ?? null));
}

export function call(d: Doc, sh: ShowOf<'call'>, cap: Cap<'call'>, top = 0): string {
  const pins = pinsOn(d, 'call'), head = esc(`${sh.method} ${sh.path}`);
  const none: CallSide = { status: 0, json: null };
  const box = (s: CallSide, o: CallSide | null, side: 'before' | 'after', extra = '') =>
    `<div class="json"${extra}><span class="req">${head}  →  ${esc(s.status)}</span>\n${body(s, o ?? none, pins, side)}</div>`;
  const label = sec(sh.label || 'What apps get back', sh.hint, top);
  if (!cap.before && !cap.after) return '';
  if (!cap.before) return label + `<span class="form">NEW · there was no reply before</span><div style="display: flex; align-items: center">${box(cap.after!, null, 'after')}</div>`;
  if (!cap.after) return label + `<span class="form gone">REMOVED · nothing answers now</span><div style="display: flex; align-items: center">${box(cap.before, null, 'before', ' style="opacity: .6; text-decoration: line-through"')}</div>`;
  return label + `<div style="display: flex; align-items: center">${box(cap.before, cap.after, 'before')}<span class="arrow">→</span>${box(cap.after, cap.before, 'after')}</div>`;
}

// --- same: identical captures. One line each, or one block when that is all the card has -------------------------
/** The first field that differs, as one short line. */
function firstDiff(diff: unknown): string {
  if (!Array.isArray(diff) || !diff.length) return '';
  const e = diff[0] as { at?: string; before?: unknown; after?: unknown };
  const v = (x: unknown) => (x === undefined ? 'not there' : JSON.stringify(x).slice(0, 40));
  return `${esc(e.at ?? '')}: ${esc(v(e.before))} → ${esc(v(e.after))}${diff.length > 1 ? ` · +${diff.length - 1} more` : ''}`;
}

export function sameLine(d: Doc, sh: ShowOf<'same'>, cap: Cap<'same'>, k: number, top = 0): string {
  const p = pinsOn(d, 'same').find((x) => Number(x.target) === k + 1);
  const ok = cap.match;
  const style = [ok ? '' : 'background: #FDF0EE; color: #B42318', top ? `margin-top: ${top}px` : ''].filter(Boolean).join('; ');
  const right = ok ? 'times and ids ignored' : firstDiff(cap.diff) || 'times and ids ignored';
  return `<div class="same"${style ? ` style="${style}"` : ''}>${p ? `<span class="n ${p.t}">${p.n}</span>` : ''}<span style="font: 700 14.5px Inter, sans-serif">${ok ? '✓ Same on both versions' : '✗ Differs between versions'}</span><span style="font: 500 13.5px Inter, sans-serif">${esc(sh.label)}</span><span style="margin-left: auto; font: 500 12px ${ok ? 'Inter, sans-serif' : '"JetBrains Mono", monospace'}; color: ${ok ? '#0F766E' : '#B42318'}">${right}</span></div>`;
}

export function sameBlock(list: ShowOf<'same'>[], caps: (Cap<'same'> | null)[]): string {
  const ok = caps.filter((c) => c && c.match).length, all = ok === list.length;
  const [bg, fg, soft] = all ? ['#E3F1EF', '#0B4F4A', '#F3FAF9'] : ['#FDF0EE', '#B42318', '#FFF7F5'];
  return sec('What anyone using it notices', all ? "nothing, and here's the proof" : 'some replies changed') +
    `<div style="background: ${bg}; border-radius: 16px; overflow: hidden"><div style="display: flex; align-items: center; gap: 12px; padding: 16px 16px 12px"><span style="font: 700 20px Inter, sans-serif; color: ${fg}">${all ? '✓ Same on both versions' : `✗ ${list.length - ok} of ${list.length} differ`}</span><span style="font: 500 13.5px Inter, sans-serif; color: ${all ? '#0F766E' : fg}">${ok} of ${list.length} captures match · times and ids ignored</span></div><div style="background: ${soft}">` +
    list.map((sh, k) => {
      const c = caps[k];
      const state = c?.match ? '✓ same' : c ? `✗ differs${firstDiff(c.diff) ? ' · ' + firstDiff(c.diff) : ''}` : 'not captured';
      return `<div class="sr"${c && !c.match ? ' style="color: #B42318"' : ''}>${esc(sh.label)}<code>${esc(sh.what.replace(/^screen\s+/, ''))}</code><span class="ck">${state}</span></div>`;
    }).join('') + '</div></div>';
}

// --- pipeline (GitHub Actions) and recipe (Dockerfile), read from the files ----------------------------------------
export function workflow(text: string): { trig: string; steps: { name: string; code: string }[] } {
  const on = (text.match(/^on:\s*\[?([^\]\n]*)\]?/m) || [])[1] || '';
  const trig = on.split(',').map((s) => s.trim().replace('pull_request', 'pull request')).filter(Boolean).join(' · ');
  const nodeV = (text.match(/node-version:\s*([\w.]+)/) || [])[1];
  const steps: { name: string; code: string }[] = [];
  const re = /^\s*-\s+(uses|run|name):\s*(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const v = m[2].trim();
    let name: string, code: string;
    if (m[1] === 'uses') {
      const a = v.replace(/^actions\//, '');
      code = a;
      name = /^checkout/.test(a) ? 'Get the code' : /^setup-node/.test(a) ? 'Set up Node ' + (nodeV || '') : a.split('@')[0];
    } else if (m[1] === 'run') { code = v; name = /test/.test(v) ? 'Run the tests' : /build/.test(v) ? 'Build' : 'Run ' + v; }
    else { name = v; code = ''; }
    steps.push({ name: name.trim(), code });
  }
  return { trig, steps };
}

/** Dockerfile -> rows of [what, value, source line]. */
export function dockerfile(text: string): [string, string, string][] {
  const rows: [string, string, string][] = [];
  const copies: string[] = [];
  let port = '', cmd = '', cmdRaw = '', copyRaw = '';
  for (const l of text.split('\n')) {
    const m = l.match(/^\s*([A-Z]+)\s+(.+)$/);
    if (!m) continue;
    const k = m[1], v = m[2].trim();
    if (k === 'FROM') rows.push(['Starts from', v, l.trim()]);
    // A source with no extension is a folder: show it as one, like "public/".
    else if (k === 'COPY') { copies.push(v.split(/\s+/).slice(0, -1).map((s) => (/\.|\/$/.test(s) ? s : s + '/')).join(' ')); copyRaw += l; }
    else if (k === 'VOLUME') rows.push(['Keeps data in', v, l.trim()]);
    else if (k === 'USER') rows.push(['Runs as', v + (v === 'root' ? '' : ', not root'), l.trim()]);
    else if (k === 'EXPOSE') port = v;
    else if (k === 'CMD') { try { cmd = (JSON.parse(v) as string[]).join(' '); } catch { cmd = v; } cmdRaw = l.trim(); }
  }
  if (copies.length) rows.splice(1, 0, ['Copies', copies.join(' '), copyRaw]);
  if (cmd) rows.push(['Starts with', cmd + (port ? ' on port ' + port : ''), cmdRaw]);
  return rows;
}

export function filePanel(d: Doc, sh: ShowOf<'pipeline' | 'recipe'>, cap: Cap<'pipeline' | 'recipe'>): string {
  const isNew = cap.before == null, isGone = cap.after == null && cap.before != null;
  const text = (isGone ? cap.before : cap.after) || '';
  let panel: string;
  if (sh.kind === 'pipeline') {
    const w = workflow(text), pins = pinsOn(d, 'step');
    panel = `<div class="panel"><span style="font: 600 12.5px Inter, sans-serif; color: #6B6B74">on ${esc(w.trig)}</span>` + w.steps.map((s) => {
      const p = pins.find((x) => (s.code + ' ' + s.name).includes(x.target));
      return `<div class="stp">${esc(s.name)}<code>${esc(s.code)}</code>${p ? `<span class="mk ${p.t}" style="right: -12px; top: -11px">${p.n}</span>` : ''}</div>`;
    }).join('') + '</div>';
  } else {
    const rp = pinsOn(d, 'row');
    panel = '<div class="panel" style="gap: 0">' + dockerfile(text).map((r) => {
      const p = rp.find((x) => (r[1] + ' ' + (r[2] || '')).includes(x.target));
      return `<div class="rr"><span>${esc(r[0])}</span><code>${esc(r[1])}</code>${p ? `<span class="mk ${p.t}" style="right: -12px; top: -4px">${p.n}</span>` : ''}</div>`;
    }).join('') + '</div>';
  }
  const label = sh.label || (sh.kind === 'pipeline' ? 'What runs in CI' : 'What it is built from');
  const tag = isNew ? `<span class="newtag">NEW · ${sh.kind === 'pipeline' ? 'nothing ran before' : 'there was no image'}</span>` : isGone ? `<span class="form gone">REMOVED · ${esc(sh.file)} is gone</span>` : '';
  return `<div style="flex: 1; display: flex; flex-direction: column; gap: 8px">${sec(label)}${tag}${isGone ? `<div class="gonebox">${panel}</div>` : panel}</div>`;
}

// --- scenario: steps per version, then the outcome ----------------------------------------------------------------
const OUTCOME = { bad: ['#FDF0EE', '#B42318'], good: ['#E3F1EF', '#0F766E'], watch: ['#FDEBE1', '#C2410C'] } as const;

export function scenario(d: Doc, sh: ShowOf<'scenario'>, cap: Cap<'scenario'>, k: number, top = 0): string {
  const pin = pinsOn(d, 'outcome').find((x) => Number(x.target) === k + 1);
  const side = (v: ScenarioSide, after: boolean) => {
    const oc = v.outcome, [bg, fg] = OUTCOME[oc.tone] ?? OUTCOME.good;
    const len = String(oc.big).length, size = len <= 7 ? '' : len <= 10 ? '; font-size: 19px' : len <= 15 ? '; font-size: 15px' : '; font-size: 12px';
    const p = after ? pin : undefined;
    return `<div class="half"><span class="tag"${after ? ' style="color: #0F766E"' : ''}>${after ? 'AFTER' : 'BEFORE'}</span><div class="sc">` +
      v.steps.map((s) => `<div class="fr"${s[2] === 'watch' ? ' style="border-color: #C2410C"' : ''}>${esc(s[0])}<small>${esc(s[1])}</small></div><span class="ar">→</span>`).join('') +
      `<div class="oc" style="background: ${bg}; border: 2px solid ${fg}"><b style="color: ${fg}${size}">${esc(oc.big)}</b><span class="os">${esc(oc.small)}</span>${p ? `<span class="mk ${p.t}" style="right: -10px; top: -12px">${p.n}</span>` : ''}</div></div></div>`;
  };
  const head = sec('What happens when…', sh.label, top);
  if (!cap.before && !cap.after) return '';
  if (!cap.before) return head + `<span class="form">NEW · this could not happen before</span><div style="display: flex; align-items: center">${side(cap.after!, true)}</div>`;
  if (!cap.after) return head + `<span class="form gone">REMOVED</span><div style="display: flex; align-items: center; opacity: .6">${side(cap.before, false)}</div>`;
  return head + `<div style="display: flex; align-items: center">${side(cap.before, false)}<span class="arrow">→</span>${side(cap.after, true)}</div>`;
}

// --- terminal: the same command on both versions, last lines and the exit code ------------------------------------
const SHOW_LINES = 12;
export function terminal(d: Doc, sh: ShowOf<'terminal'>, cap: Cap<'terminal'>, top = 0): string {
  const panel = (v: TerminalSide, other: TerminalSide | null, side: 'before' | 'after') => {
    const pins = pinsOn(d, 'line', side);
    const seen = new Set(other ? other.lines : []);
    const shown = v.lines.slice(-SHOW_LINES), hidden = Math.max(0, v.total - shown.length);
    const lines = shown.map((l) => {
      const p = pins.find((x) => l.includes(x.target));
      const fresh = side === 'after' && other && !seen.has(l);
      const cls = ['tl', fresh ? 'new' : '', p ? 'pin' : ''].filter(Boolean).join(' ');
      return `<span class="${cls}">${esc(l)}${p ? `<span class="mki ${p.t}">${p.n}</span>` : ''}</span>`;
    }).join('');
    const exit = v.timedOut ? 'timed out' : v.exit == null ? 'killed' : `exit ${v.exit}`;
    return `<div class="term"><span class="tp">$ ${esc(sh.cmd)}</span>${hidden ? `<span class="tm">… ${hidden} more line${hidden > 1 ? 's' : ''} above</span>` : ''}${lines}<span class="tx${v.exit === 0 ? '' : ' bad'}">${exit}</span></div>`;
  };
  const head = sec(sh.label || 'What the command prints', '', top);
  if (!cap.before && !cap.after) return '';
  if (!cap.before) return head + `<span class="form">NEW · this command did not exist</span><div style="display: flex; align-items: center">${panel(cap.after!, null, 'after')}</div>`;
  if (!cap.after) return head + `<span class="form gone">REMOVED · this command is gone</span><div style="display: flex; align-items: center; opacity: .6">${panel(cap.before, null, 'before')}</div>`;
  return head + `<div style="display: flex; align-items: center">${panel(cap.before, cap.after, 'before')}<span class="arrow">→</span>${panel(cap.after, cap.before, 'after')}</div>`;
}
