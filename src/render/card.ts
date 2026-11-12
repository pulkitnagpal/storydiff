// The review card: spec + captures + check report -> HTML, exactly as designed on the canvas.
// Six slots, top to bottom: header and verdict, asked -> did, before -> after, underneath, the list, details.
// The card never claims what was not checked: a tick or the green tone only stands for something measured.
import type { Doc, Mark, Show } from '../spec/types.ts';
import { CSS, FONTS, LOGO } from './css.ts';
import { layout, strip } from './map.ts';
import { call, filePanel, sameBlock, sameLine, scenario, screen, terminal } from './slots.ts';
import type { Captures, Report, ShowCapture } from './types.ts';
import { esc, prose, STAMP, tone } from './util.ts';

export interface RenderOptions { warn?: (msg: string) => void }

const GROUPS: [string, Mark['mark'][], string][] = [
  ['Breaks for callers', ['breaks'], '#B42318'],
  ['New', ['new', 'changed', 'gone'], ''],
  ['Kept the same', ['kept'], ''],
  ['Try before you merge', ['watch'], '#C2410C'],
];

interface Pair { sh: Show; cap: ShowCapture }

/** The shows that have a matching capture. Missing or mismatched ones are left out, with a warning. */
function pairs(d: Doc, caps: Captures, warn: (m: string) => void): Pair[] {
  const out: Pair[] = [];
  d.shows.forEach((sh, k) => {
    const cap = caps.shows[k];
    if (!cap) return warn(`show ${k + 1} (${sh.kind}) has no capture, so the card leaves it out. Run storydiff capture.`);
    if (cap.kind !== sh.kind) return warn(`show ${k + 1} is ${sh.kind} but capture ${k + 1} is ${cap.kind}; left out.`);
    out.push({ sh, cap });
  });
  return out;
}

/** At least one same capture, and every one of them matched. Only then may the card say "nothing to try". */
function allSame(d: Doc, ps: Pair[]): boolean {
  const same = d.shows.filter((s) => s.kind === 'same').length;
  const got = ps.filter((p) => p.cap.kind === 'same');
  return same > 0 && got.length === same && got.every((p) => p.cap.kind === 'same' && p.cap.match && !p.cap.typed);
}

function list(d: Doc, rep: Report, quiet: boolean): string {
  let out = '', first = true;
  for (const [name, kinds, color] of GROUPS) {
    const items = d.marks.filter((m) => m.n && kinds.includes(m.mark)).sort((a, b) => a.n! - b.n!);
    const watchGroup = name === 'Try before you merge';
    if (!items.length && !watchGroup) continue;
    out += `<span class="lbl" style="padding: ${first ? '0' : '14px'} 12px 4px${color ? '; color: ' + (items.length ? color : quiet ? '#0F766E' : '#8E8A84') : ''}">${name}</span>`;
    first = false;
    if (!items.length) {
      out += `<div class="li"><span class="lt" style="color: #6B6B74">${quiet ? 'Nothing. Every reply matched on both versions.' : 'Nothing flagged.'}</span></div>`;
      continue;
    }
    for (const m of items) {
      const q = m.said[0];
      // The time the checker found beats the one the agent wrote.
      const at = q ? rep.checks.find((c) => c.kind === 'said' && c.ref === q.text && c.at)?.at || q.at : '';
      const quote = q ? `<span class="q">“${esc(q.text)}” · ${esc(d.by)}${at && d.chapters.length ? ', ' + esc(at) : ''}</span>` : '';
      out += `<div class="li${m.mark === 'watch' ? ' w' : ''}"><span class="n ${tone(m)}">${m.n}</span><span class="lt">${prose(m.line)}${quote}</span></div>`;
    }
  }
  if (d.smaller.length) out += `<div class="li sm"><span class="lt" style="color: #6B6B74">+ ${d.smaller.length} smaller change${d.smaller.length > 1 ? 's' : ''}</span></div>`;
  return out;
}

const chip = (text: string, style: string) => `<span class="vt" style="${style}">${esc(text)}</span>`;
const GOOD = 'background: #E3F1EF; color: #0B4F4A', PLAIN = 'background: #FFFFFF; border: 1px solid #E6E3DD; color: #3F3F46';
const BAD = 'background: #B42318; color: #FFFFFF', PENDING = 'background: #FFFFFF; border: 1.5px dashed #C9C5BE; color: #6B6B74';
const WARN = 'background: #FDEBE1; color: #9A3412', GREY = 'background: #F4F2EE; color: #6B6B74';
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** Things to try in this card, plus those in "+" chapters, so no risk hides in the small print. */
const watchCount = (d: Doc) => [d, ...d.rest.filter((r) => (r.chapters[r.chapter - 1] ?? '').startsWith('+'))]
  .reduce((n, x) => n + x.marks.filter((m) => m.n && m.mark === 'watch').length, 0);

function verdict(d: Doc, rep: Report, ps: Pair[]): string {
  const unsure = !!rep.unchecked || rep.oldPass == null;
  const tick = (s: string) => (unsure ? s.replace(/^✓ /, '') : s);
  const ok = unsure ? PENDING : GOOD;
  const parts: string[] = [];
  const r = rep.regressed.length;
  if (r) parts.push(chip(`✗ ${plural(r, 'old test')} now fail${r > 1 ? '' : 's'}`, BAD));
  else if (rep.oldPass == null) parts.push(chip(rep.testsLine || 'Tests not run yet', PENDING));
  else parts.push(chip(tick(`✓ All ${rep.oldPass} old tests still pass`), ok));
  if (rep.newTests) parts.push(chip(`${rep.newTests} new tests`, PLAIN));
  if (rep.editedOld?.length) parts.push(chip(`✎ ${plural(rep.editedOld.length, 'old test')} edited`, WARN));
  if (rep.unchecked) parts.push(chip(`${rep.claims} claims cited · not checked yet`, PENDING));
  else if (rep.failed) parts.push(chip(`✗ ${rep.failed} of ${rep.claims} claims don't hold up`, BAD));
  else parts.push(chip(tick(`✓ ${rep.claims} claims checked`), unsure ? PENDING : PLAIN));
  if (rep.coverage) {
    const u = rep.coverage.uncovered.length;
    parts.push(u ? chip(`✗ ${plural(u, 'file')} not covered`, BAD) : chip(tick(`✓ Covers all ${rep.coverage.files} changed files`), unsure ? PENDING : PLAIN));
  }
  const typed = ps.filter((p) => p.cap.typed).length;
  if (typed) parts.push(chip(`${plural(typed, 'picture')} not captured`, PENDING));
  for (const x of rep.extra || []) parts.push(chip(x, PLAIN));
  const watch = watchCount(d);
  if (watch) parts.push(chip(`${plural(watch, 'thing')} to try`, 'background: #C2410C; color: #FFFFFF'));
  else if (!unsure && allSame(d, ps)) parts.push(chip('✓ Nothing to try', GOOD));
  else parts.push(chip('Nothing flagged', GREY));
  return `<section aria-label="Verdict" style="display: flex; gap: 8px; flex-wrap: wrap">${parts.join('')}</section>`;
}

function slot3(d: Doc, ps: Pair[]): string {
  const stamp = (cap: ShowCapture, html: string) => (cap.typed ? html.replace(/(<span class="lbl">[^<]*<\/span>)/, `$1${STAMP}`) : html);
  if (ps.length && ps.every((p) => p.sh.kind === 'same') && d.shows.every((s) => s.kind === 'same')) {
    const html = sameBlock(ps.map((p) => p.sh as Extract<Show, { kind: 'same' }>), ps.map((p) => p.cap as Extract<ShowCapture, { kind: 'same' }>));
    return ps.some((p) => p.cap.typed) ? html.replace(/(<span class="lbl">[^<]*<\/span>)/, `$1${STAMP}`) : html;
  }
  let col = '', si = 0, sc = 0, firstScreen = true, files: string[] = [];
  ps.forEach(({ sh, cap }, k) => {
    const prev = ps[k - 1]?.sh.kind;
    if (sh.kind === 'screen' && cap.kind === 'screen') { col += stamp(cap, screen(d, sh, cap, firstScreen)); firstScreen = false; }
    else if (sh.kind === 'call' && cap.kind === 'call') col += stamp(cap, call(d, sh, cap, col ? 8 : 0));
    else if (sh.kind === 'same' && cap.kind === 'same') col += stamp(cap, sameLine(d, sh, cap, si++, prev === 'pipeline' || prev === 'recipe' ? 6 : 0));
    else if (sh.kind === 'scenario' && cap.kind === 'scenario') col += stamp(cap, scenario(d, sh, cap, sc, sc++ ? 6 : 0));
    else if (sh.kind === 'terminal' && cap.kind === 'terminal') col += stamp(cap, terminal(d, sh, cap, col ? 8 : 0));
    else if ((sh.kind === 'pipeline' || sh.kind === 'recipe') && (cap.kind === 'pipeline' || cap.kind === 'recipe')) {
      files.push(stamp(cap, filePanel(d, sh, cap)));
      const next = ps[k + 1]?.sh.kind;
      if (next !== 'pipeline' && next !== 'recipe') { col += `<div style="display: flex; gap: 24px">${files.join('')}</div>`; files = []; }
    }
  });
  return col;
}

function asked(d: Doc): string {
  const a = d.asks[0];
  const who = a?.from || d.by;
  const label = `${who} asked${a?.in ? ` (${a.in})` : ''}`;
  const didLabel = d.agent ? `${d.agent.split(' ')[0]} did` : `${d.by} did`;
  const later = d.asks.slice(1, 3).map((x) => `<span></span><span class="then">then: ${prose(x.text)}${x.from ? ` · ${esc(x.from)}` : ''}</span>`).join('');
  return `<section aria-label="Asked and did" style="display: grid; grid-template-columns: minmax(120px, max-content) 1fr; column-gap: 12px; row-gap: 8px; align-items: baseline"><span class="lbl" style="white-space: nowrap">${esc(label)}</span><span style="font: 600 28px/1.2 Inter, sans-serif; letter-spacing: -0.015em">“${prose(d.ask)}”</span>${later}<span class="lbl">${esc(didLabel)}</span><span style="font: 500 17px/1.4 Inter, sans-serif; color: #3F3F46">${prose(d.did)}</span></section>`;
}

/** The card itself: `<div class="card">…</div>`. It grows as tall as its content; nothing is clipped. */
export function render(d: Doc, caps: Captures, rep: Report, opts: RenderOptions = {}): string {
  const warn = opts.warn ?? (() => {});
  const listOnly = (d.chapters[d.chapter - 1] ?? '').startsWith('+');
  const ps = listOnly ? [] : pairs(d, caps, warn);
  const ships = d.shipsWith.map((s) => `<span class="ch" style="padding: 5px 11px; font-size: 12.5px">Ships with ${esc(s)}</span>`).join('');
  const who = d.agent ? `${esc(d.by)}, with ${esc(d.agent)}` : esc(d.by);
  let h = '<div class="card">';
  h += `<header style="display: flex; align-items: center; gap: 12px">${LOGO}<span style="font-weight: 700; font-size: 17px">Storydiff</span><span style="color: #D6D3CD">/</span><span style="font-weight: 600; font-size: 15px">${esc(d.pr)} · ${esc(d.title)}</span><span style="font-size: 13px; color: #8E8A84">${who} · ${d.files} files${rep.sessionLength && d.agent ? ` · ${esc(rep.sessionLength)} session` : ''}</span>${ships}</header>`;
  if (d.chapters.length) {
    h += `<nav aria-label="Chapters" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap"><span class="lbl" style="margin-right: 4px">This PR does ${d.chapters.length} things</span>` +
      d.chapters.map((c, i) => `<span class="ch${i + 1 === d.chapter ? ' on' : ''}"${c[0] === '+' && i + 1 !== d.chapter ? ' style="border-style: dashed; color: #6B6B74"' : ''}>${c[0] === '+' ? '' : `${i + 1} · `}${esc(c)}</span>`).join('') + '</nav>';
  }
  if (d.ask || d.did) h += asked(d);
  h += verdict(d, rep, ps);
  const quiet = allSame(d, ps) && !rep.unchecked && rep.oldPass != null;
  if (listOnly) {
    h += `<aside aria-label="The list" style="max-width: 760px; display: flex; flex-direction: column; gap: 2px; padding-top: 8px">${list(d, rep, quiet)}</aside>`;
  } else {
    const pos = layout(d);
    const col = slot3(d, ps) +
      `<div style="display: flex; align-items: baseline; gap: 10px; margin-top: 8px"><span class="lbl">What changed underneath</span></div><div style="display: flex; align-items: center">${strip(d, pos, false)}<span class="arrow">→</span>${strip(d, pos, true)}</div>`;
    h += `<div style="display: flex; gap: 28px; align-items: flex-start"><div style="flex: none; width: 1004px; display: flex; flex-direction: column; gap: 12px">${col}</div>`;
    h += `<aside aria-label="The list" style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; padding-top: 20px">${list(d, rep, quiet)}</aside></div>`;
  }
  const next = d.chapter && d.chapters[d.chapter] && d.chapters[d.chapter][0] !== '+' ? d.chapters[d.chapter] : '';
  const details = ['Details: ' + (d.files > 20 ? d.files + ' files' : 'files'), 'every check', ...(d.agent ? [`${esc(d.by)}'s session`] : [])].join(', ');
  h += `<footer style="display: flex; align-items: center; gap: 16px; margin-top: 8px"><span style="display: inline-flex; align-items: center; gap: 8px; font: 600 14px Inter, sans-serif; color: #FFFFFF; background: #16161A; border-radius: 999px; padding: 10px 16px"><svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2 L13 8 L4 14 Z" fill="#FFFFFF"></path></svg>Walk me through it</span><span style="font-size: 13px; color: #8E8A84">${details}${next ? ` · next chapter: ${esc(next)}` : ''}</span></footer></div>`;
  return h;
}

/** A full HTML page holding the card. */
export function renderPage(d: Doc, caps: Captures, rep: Report, opts: RenderOptions = {}): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Storydiff · ${esc(d.title)}</title>${FONTS}<style>${CSS}</style></head><body>${render(d, caps, rep, opts)}</body></html>`;
}

/** The report for a card whose checker has not run yet. */
export function uncheckedReport(d: Doc): Report {
  const claims = d.marks.reduce((n, m) => n + m.proofs.length + m.said.length, 0);
  return { oldPass: null, newTests: 0, regressed: [], claims, failed: 0, checks: [], unchecked: true };
}
