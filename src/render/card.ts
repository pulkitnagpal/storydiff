// The review card: spec + captures + check report -> HTML, exactly as designed on the canvas.
// Six slots, top to bottom: header and verdict, asked -> did, before -> after, underneath, the list, details.
import type { Doc, Mark, Show } from '../spec/types.ts';
import { CSS, FONTS, LOGO } from './css.ts';
import { layout, strip } from './map.ts';
import { call, filePanel, sameBlock, sameLine, scenario, screen } from './slots.ts';
import type { Captures, Report, ShowCapture } from './types.ts';
import { esc, tone } from './util.ts';

export interface RenderOptions { warn?: (msg: string) => void }

const GROUPS: [string, Mark['mark'][], string][] = [['New', ['new', 'changed', 'gone'], ''], ['Kept the same', ['kept'], ''], ['Try before you merge', ['watch'], '#C2410C']];

function list(d: Doc): string {
  let out = '', first = true;
  for (const [name, kinds, color] of GROUPS) {
    const items = d.marks.filter((m) => m.n && kinds.includes(m.mark)).sort((a, b) => a.n! - b.n!);
    if (!items.length && name !== 'Try before you merge') continue;
    out += `<span class="lbl" style="padding: ${first ? '0' : '14px'} 12px 4px${color ? '; color: ' + (items.length ? color : '#0F766E') : ''}">${name}</span>`;
    first = false;
    if (!items.length) { out += '<div class="li"><span class="lt" style="color: #6B6B74">Nothing. Every reply matched on both versions.</span></div>'; continue; }
    for (const m of items) {
      const q = m.said[0];
      const quote = q ? `<span class="q">“${esc(q.text)}” · ${esc(d.by)}${q.at && d.chapters.length ? ', ' + esc(q.at) : ''}</span>` : '';
      out += `<div class="li${m.mark === 'watch' ? ' w' : ''}"><span class="n ${tone(m)}">${m.n}</span><span class="lt">${esc(m.line)}${quote}</span></div>`;
    }
  }
  return out;
}

const chip = (text: string, style: string) => `<span class="vt" style="${style}">${esc(text)}</span>`;
const GOOD = 'background: #E3F1EF; color: #0B4F4A', PLAIN = 'background: #FFFFFF; border: 1px solid #E6E3DD; color: #3F3F46';
const BAD = 'background: #B42318; color: #FFFFFF', PENDING = 'background: #FFFFFF; border: 1.5px dashed #C9C5BE; color: #6B6B74';

function verdict(d: Doc, rep: Report): string {
  const watch = d.marks.filter((m) => m.n && m.mark === 'watch').length;
  const parts: string[] = [];
  if (rep.regressed.length) parts.push(chip(`✗ ${rep.regressed.length} old test${rep.regressed.length > 1 ? 's' : ''} now fail${rep.regressed.length > 1 ? '' : 's'}`, BAD));
  else if (rep.oldPass == null) parts.push(chip(rep.testsLine || 'Tests not run yet', rep.testsLine ? GOOD : PENDING));
  else parts.push(chip(`✓ All ${rep.oldPass} old tests still pass`, GOOD));
  if (rep.newTests) parts.push(chip(`${rep.newTests} new tests`, PLAIN));
  if (rep.unchecked) parts.push(chip(`${rep.claims} claims cited · not checked yet`, PENDING));
  else if (rep.failed) parts.push(chip(`✗ ${rep.failed} of ${rep.claims} claims don't hold up`, BAD));
  else parts.push(chip(`✓ ${rep.claims} claims checked`, PLAIN));
  for (const x of rep.extra || []) parts.push(chip(x, PLAIN));
  parts.push(watch ? chip(`${watch} thing${watch > 1 ? 's' : ''} to try`, 'background: #C2410C; color: #FFFFFF') : chip('✓ Nothing to try', GOOD));
  return `<section aria-label="Verdict" style="display: flex; gap: 8px; flex-wrap: wrap">${parts.join('')}</section>`;
}

function slot3(d: Doc, caps: Captures, warn: (m: string) => void): string {
  const pairs: { sh: Show; cap: ShowCapture }[] = [];
  d.shows.forEach((sh, k) => {
    const cap = caps.shows[k];
    if (!cap) return warn(`show ${k + 1} (${sh.kind}) has no capture, so the card leaves it out. Run storydiff capture.`);
    if (cap.kind !== sh.kind && !(sh.kind === 'same' && cap.kind === 'same')) return warn(`show ${k + 1} is ${sh.kind} but capture ${k + 1} is ${cap.kind}; left out.`);
    pairs.push({ sh, cap });
  });
  let col = '';
  if (pairs.length && pairs.every((p) => p.sh.kind === 'same') && d.shows.every((s) => s.kind === 'same')) {
    return sameBlock(pairs.map((p) => p.sh as Extract<Show, { kind: 'same' }>), pairs.map((p) => p.cap as Extract<ShowCapture, { kind: 'same' }>));
  }
  let si = 0, sc = 0, firstScreen = true, files: string[] = [];
  pairs.forEach(({ sh, cap }, k) => {
    if (sh.kind === 'screen' && cap.kind === 'screen') { col += screen(d, sh, cap, firstScreen); firstScreen = false; }
    else if (sh.kind === 'call' && cap.kind === 'call') col += call(d, sh, cap, col ? 8 : 0);
    else if (sh.kind === 'same' && cap.kind === 'same') col += sameLine(d, sh, cap, si++, pairs[k - 1] && (pairs[k - 1].sh.kind === 'pipeline' || pairs[k - 1].sh.kind === 'recipe') ? 6 : 0);
    else if (sh.kind === 'scenario' && cap.kind === 'scenario') col += scenario(d, sh, cap, sc, sc++ ? 6 : 0);
    else if ((sh.kind === 'pipeline' || sh.kind === 'recipe') && (cap.kind === 'pipeline' || cap.kind === 'recipe')) {
      files.push(filePanel(d, sh, cap));
      const next = pairs[k + 1]?.sh.kind;
      if (next !== 'pipeline' && next !== 'recipe') { col += `<div style="display: flex; gap: 24px">${files.join('')}</div>`; files = []; }
    }
  });
  return col;
}

/** The card itself: `<div class="card">…</div>`. */
export function render(d: Doc, caps: Captures, rep: Report, opts: RenderOptions = {}): string {
  const warn = opts.warn ?? (() => {});
  const ships = d.shipsWith.map((s) => `<span class="ch" style="padding: 5px 11px; font-size: 12.5px">Ships with ${esc(s)}</span>`).join('');
  let h = '<div class="card">';
  h += `<header style="display: flex; align-items: center; gap: 12px">${LOGO}<span style="font-weight: 700; font-size: 17px">Storydiff</span><span style="color: #D6D3CD">/</span><span style="font-weight: 600; font-size: 15px">${esc(d.pr)} · ${esc(d.title)}</span><span style="font-size: 13px; color: #8E8A84">${esc(d.by)}, with ${esc(d.agent)} · ${d.files} files${rep.sessionLength ? ` · ${esc(rep.sessionLength)} session` : ''}</span>${ships}</header>`;
  if (d.chapters.length) {
    h += `<nav aria-label="Chapters" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap"><span class="lbl" style="margin-right: 4px">This PR does ${d.chapters.length} things</span>` +
      d.chapters.map((c, i) => `<span class="ch${i + 1 === d.chapter ? ' on' : ''}"${c[0] === '+' ? ' style="border-style: dashed; color: #6B6B74"' : ''}>${c[0] === '+' ? '' : `${i + 1} · `}${esc(c)}</span>`).join('') + '</nav>';
  }
  h += `<section aria-label="Asked and did" style="display: grid; grid-template-columns: 120px 1fr; row-gap: 8px; align-items: baseline"><span class="lbl">${esc(d.by)} asked</span><span style="font: 600 28px/1.2 Inter, sans-serif; letter-spacing: -0.015em">“${esc(d.ask)}”</span><span class="lbl">${esc(d.agent.split(' ')[0])} did</span><span style="font: 500 17px/1.4 Inter, sans-serif; color: #3F3F46">${esc(d.did)}</span></section>`;
  h += verdict(d, rep);
  const pos = layout(d);
  const col = slot3(d, caps, warn) +
    `<div style="display: flex; align-items: baseline; gap: 10px; margin-top: 8px"><span class="lbl">What changed underneath</span></div><div style="display: flex; align-items: center">${strip(d, pos, false)}<span class="arrow">→</span>${strip(d, pos, true)}</div>`;
  h += `<div style="display: flex; gap: 28px; align-items: flex-start"><div style="flex: none; width: 1004px; display: flex; flex-direction: column; gap: 12px">${col}</div>`;
  h += `<aside aria-label="The list" style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; padding-top: 20px">${list(d)}</aside></div>`;
  const next = d.chapter && d.chapters[d.chapter] && d.chapters[d.chapter][0] !== '+' ? d.chapters[d.chapter] : '';
  h += `<footer style="display: flex; align-items: center; gap: 16px; margin-top: 8px"><span style="display: inline-flex; align-items: center; gap: 8px; font: 600 14px Inter, sans-serif; color: #FFFFFF; background: #16161A; border-radius: 999px; padding: 10px 16px"><svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2 L13 8 L4 14 Z" fill="#FFFFFF"></path></svg>Walk me through it</span><span style="font-size: 13px; color: #8E8A84">Details: ${d.files > 20 ? d.files + ' files' : 'files'}, every check, ${esc(d.by)}'s session${next ? ` · next chapter: ${esc(next)}` : ''}</span></footer></div>`;
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
