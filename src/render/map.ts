// Slot 4: "What changed underneath". Two small strips, before and after, with the same layout so nothing moves.
// Row 1 is the longest chain of today's boxes (topped up with other boxes of today); the rest sit in row 2,
// under the box they connect to. The numbers come straight from the canvas boards.
import type { Doc, Edge } from '../spec/types.ts';
import { esc, tone } from './util.ts';

export interface Pos { x: number; y: number; w: number; h: number; col: number; row: 1 | 2 }

const RIGHT = 450; // boxes end before the strip's right padding (470 wide)

export function layout(d: Doc): Record<string, Pos> {
  const base = d.order.filter((id) => !d.nodes[id].born);
  const adj: Record<string, string[]> = {};
  for (const id of base) adj[id] = [];
  for (const e of d.edges) if (!e.born && adj[e.from] && adj[e.to]) { adj[e.from].push(e.to); adj[e.to].push(e.from); }
  let best: string[] = [];
  const walk = (path: string[]) => {
    if (path.length > best.length) best = path.slice();
    for (const nx of adj[path[path.length - 1]]) if (!path.includes(nx)) { path.push(nx); walk(path); path.pop(); }
  };
  if (base.length) walk([base[0]]);
  if (best.length < 2) for (const id of base) if (best.length < 2) walk([id]);
  const row1 = best.slice(0, 4);
  // Top the row up to three with other boxes of today, in the order they were declared.
  for (const id of base) if (row1.length < 3 && !row1.includes(id)) row1.push(id);
  const n = row1.length;
  const noted = row1.some((id) => d.nodes[id].note || d.nodes[id].noteAfter);
  const between = (id: string) =>
    d.edges.some((e) => e.to === id && row1.includes(e.from)) && d.edges.some((e) => e.from === id && row1.includes(e.to));
  let W = n <= 3 ? [104, 104, 120] : [80, 92, 92, 120];
  let X = n <= 3 ? [10, 170, 330] : [8, 108, 230, 340];
  if (n === 3 && noted) { W = [120, 118, 120]; X = [10, 172, 330]; }
  else if (n === 3 && d.order.some((id) => d.nodes[id].born && between(id))) { W = [80, 92, 120]; X = [8, 108, 330]; }

  const pos: Record<string, Pos> = {};
  const used: Record<number, boolean> = {};
  row1.forEach((id, i) => {
    const tall = !!(d.nodes[id].note || d.nodes[id].noteAfter);
    pos[id] = { x: X[i], y: noted && !tall ? 32 : 22, w: W[i], h: tall ? 62 : 40, col: i, row: 1 };
  });
  const rest = d.order.filter((id) => !pos[id]);
  for (const id of rest.filter((id) => !d.nodes[id].born)) {
    let c = 0; while (used[c]) c++; used[c] = true;
    pos[id] = { x: X[c] ?? X[X.length - 1], y: 92, w: W[c] ?? W[W.length - 1], h: 40, col: c, row: 2 };
  }
  const nearRow2 = (id: string) => d.edges.some((e) => { const o = e.from === id ? e.to : e.to === id ? e.from : null; return !!o && pos[o]?.row === 2; });
  const born = rest.filter((id) => d.nodes[id].born).sort((a, b) => Number(nearRow2(b)) - Number(nearRow2(a)));
  for (const id of born) {
    const ins = d.edges.filter((e) => e.to === id && pos[e.from]?.row === 1);
    const outs = d.edges.filter((e) => e.from === id && pos[e.to]?.row === 1);
    if (ins.length && outs.length) {
      const a = pos[ins[0].from], b = pos[outs[0].to];
      if (b.x - (a.x + a.w) >= 110) {
        // Tucked under the arrow it now sits on, starting at the source box's right edge.
        pos[id] = { x: a.x + a.w - 4, y: 96, w: 102, h: 40, col: a.col + 0.5, row: 2 };
        used[Math.floor(a.col + 0.5)] = true;
        continue;
      }
    }
    const partner = d.edges.filter((e) => (e.from === id && pos[e.to]) || (e.to === id && pos[e.from])).map((e) => pos[e.from === id ? e.to : e.from])[0];
    let c = partner ? Math.min(Math.floor(partner.col) + 1, W.length - 1) : 1;
    while (used[c] && c < W.length - 1) c++;
    while (used[c] && c > 0) c--;
    used[c] = true;
    const x = X[c];
    const w = Math.min(140, Math.max(W[c], d.nodes[id].label.length * 7.4 + 34), RIGHT - x);
    pos[id] = { x, y: partner && partner.y === 96 ? 96 : 92, w: Math.round(w), h: 40, col: c, row: 2 };
  }
  return pos;
}

interface Path { d: string; mx: number; my: number }
const mid = (p: Pos) => p.y + p.h / 2;

export function edgePath(a: Pos, b: Pos): Path {
  if (a.row === b.row && Math.abs(a.col - b.col) > 1) {
    // Skips a box in between: arc over the row, clear of anything in row 2.
    const L = a.x < b.x ? a : b, R = a.x < b.x ? b : a, top = Math.max(4, Math.min(L.y, R.y) - 16);
    return { d: `M${L.x + L.w / 2} ${L.y} C ${L.x + L.w / 2} ${top}, ${R.x + R.w / 2} ${top}, ${R.x + R.w / 2} ${R.y}`, mx: (L.x + R.x + R.w) / 2, my: top + 4 };
  }
  if (a.row === b.row) {
    const l = a.x < b.x ? a : b, r = a.x < b.x ? b : a;
    return { d: `M${l.x + l.w} ${mid(l)} L${r.x} ${mid(r)}`, mx: (l.x + l.w + r.x) / 2, my: mid(l) };
  }
  const top = a.row === 1 ? a : b, bot = a.row === 1 ? b : a;
  if (Math.abs(top.x + top.w / 2 - (bot.x + bot.w / 2)) < 30) return { d: `M${top.x + top.w / 2} ${top.y + top.h} L${bot.x + bot.w / 2} ${bot.y}`, mx: top.x + top.w / 2, my: (top.y + top.h + bot.y) / 2 };
  if (Math.abs(top.col - bot.col) > 1) {
    const fx = top.x + top.w - 14, fy = top.y + top.h, tx = bot.x + bot.w / 2, ty = bot.y;
    return { d: `M${fx} ${fy} C ${fx + 10} ${fy + 24}, ${tx} ${ty - 26}, ${tx} ${ty}`, mx: (fx + tx) / 2, my: (fy + ty) / 2 };
  }
  const sx = top.x + top.w / 2, sy = top.y + top.h, left = bot.x < top.x, ex = left ? bot.x + bot.w : bot.x, ey = mid(bot);
  return { d: `M${sx} ${sy} C ${sx} ${sy + 30}, ${ex + (left ? 30 : -30)} ${ey}, ${ex} ${ey}`, mx: (sx + ex) / 2, my: (sy + ey) / 2 };
}

/** A box whose arrow went away is drawn as changed on the after map. */
const lostArrow = (d: Doc, id: string) => d.edges.some((e) => e.gone && e.from === id);
const listedGone = (d: Doc, e: Edge) => d.marks.find((m) => m.edge === e && m.n);

export function strip(d: Doc, pos: Record<string, Pos>, after: boolean): string {
  let svg = '', boxes = '', pins = '';
  for (const e of d.edges) {
    if (!after && e.born) continue;
    const a = pos[e.from], b = pos[e.to];
    if (!a || !b) continue;
    const p = edgePath(a, b);
    if (after && e.gone) {
      // A removed arrow with its own list line is shown crossed out; otherwise it just is not there any more.
      const gm = listedGone(d, e);
      if (!gm) continue;
      svg += `<path d="${p.d}" stroke="#B9B5AE" stroke-width="2" stroke-dasharray="6 6" fill="none"></path><path d="M${p.mx - 8} ${p.my - 8} L${p.mx + 8} ${p.my + 8} M${p.mx + 8} ${p.my - 8} L${p.mx - 8} ${p.my + 8}" stroke="#8E8A84" stroke-width="2.4" stroke-linecap="round"></path>`;
      pins += `<span class="mk x" style="left: ${Math.round(p.mx - 13)}px; top: ${Math.round(p.my - 34)}px">${gm.n}</span>`;
    } else {
      const fresh = after && e.born;
      svg += `<path d="${p.d}" stroke="${fresh ? '#0F766E' : '#16161A'}" stroke-width="${fresh ? 2.6 : 2}" fill="none"></path>`;
    }
  }
  for (const id of d.order) {
    const n = d.nodes[id], p = pos[id];
    if (!after && n.born) continue;
    const st = !after ? '' : n.born ? 'new' : n.state === 'changed' || lostArrow(d, id) ? 'chg' : n.state === 'kept' ? 'kept' : n.state === 'gone' ? 'gone' : '';
    const note = after ? n.noteAfter || n.note : n.note;
    const style = [`left: ${p.x}px`, `top: ${p.y}px`, `width: ${p.w}px`];
    if (p.h !== 40) style.push(`height: ${p.h}px`, 'flex-direction: column', 'gap: 2px');
    if (n.label.length > 14) style.push('font-size: 12px');
    boxes += `<div class="sb ${st}" style="${style.join('; ')}">${after && n.born ? '+ ' : ''}${esc(n.label)}${note ? `<span style="font: 500 11px Inter, sans-serif; color: #6B6B74">${esc(note)}</span>` : ''}</div>`;
    if (!after) continue;
    const m = d.marks.find((x) => x.id === id && x.n && !(x.mark === 'watch' && x.pins.length));
    if (m) {
      const t = tone(m);
      // Kept pins sit on the box's left corner in the first column, so they never cover the arrow into it.
      const left = t === 'k' && p.col === 0 ? Math.max(0, p.x - 10) : p.x + p.w - 12;
      pins += `<span class="mk ${t}" style="left: ${left}px; top: ${p.y - 14}px">${m.n}</span>`;
    }
  }
  return `<div class="strip" aria-label="${after ? 'After' : 'Before'}, underneath"><svg width="470" height="150" style="position: absolute; left: 0; top: 0" aria-hidden="true">${svg}</svg>${boxes}${pins}</div>`;
}
