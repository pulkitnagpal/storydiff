import type { Doc, Mark } from '../spec/types.ts';

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Pin colour class: g new, c changed, x gone, k kept, o watch. */
export type Tone = 'g' | 'c' | 'x' | 'k' | 'o';
export const tone = (m: Mark): Tone => m.mark === 'watch' ? 'o' : m.mark === 'kept' ? 'k' : m.mark === 'gone' ? 'x' : m.mark === 'changed' ? 'c' : 'g';

export interface PinRef { n: number; t: Tone; target: string; m: Mark }
/** Every pin placed on one kind of slot, with its list number. Marks without a number draw no pins. */
export function pinsOn(d: Doc, on: string): PinRef[] {
  const out: PinRef[] = [];
  for (const m of d.marks) if (m.n) for (const p of m.pins) if (p.on === on) out.push({ n: m.n, t: tone(m), target: p.target, m });
  return out;
}

/** A slot's label line. `top` is extra space above it, when it follows another slot. */
export const sec = (label: string, hint?: string, top = 0) =>
  `<div style="display: flex; align-items: baseline; gap: 10px${top ? `; margin-top: ${top}px` : ''}"><span class="lbl">${esc(label)}</span>${hint ? `<span class="say" style="font-size: 19px; color: #8E8A84">${esc(hint)}</span>` : ''}</div>`;
