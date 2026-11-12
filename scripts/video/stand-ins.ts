// Stand-in pages for the shot list, built from the real run's data (the session, the handover, the checker's reports).
// Each one is replaced by a real capture from a v1 run as soon as that capture is in scripts/video/assets/.
import type { Report } from '../../src/render/types.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const FONTS = '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Caveat:wght@500;600;700&display=swap" rel="stylesheet">';

/** A light Claude Code transcript. */
const TERM_CSS = `body{margin:0;background:#FFFFFF;color:#16161A;font:400 15px/1.6 "JetBrains Mono",monospace}
.t{width:1100px;box-sizing:border-box;padding:22px 28px 26px}
.u{background:#F1EFEB;border-radius:8px;padding:8px 14px;margin:0 0 14px;color:#16161A}.u b{color:#8E8A84;font-weight:600;margin-right:10px}
.b{margin:10px 0 0;white-space:pre-wrap}.b i{font-style:normal;color:#0F766E;margin-right:10px}.b .n{color:#16161A;margin-right:10px}
.r{color:#6B6B74;white-space:pre;margin-left:24px}.r i{font-style:normal;color:#B9B5AE;margin-right:10px}
.box{margin:4px 0 0 52px;border-left:2px solid #E6E3DD;padding:2px 0 2px 14px;font-size:14px;line-height:1.55}
.ln{display:flex;gap:16px;white-space:pre}.ln span:first-child{width:22px;text-align:right;color:#B9B5AE}
.k{font-weight:700}.s{color:#0B4F4A}.p{color:#8E8A84}.w{color:#C2410C}.d{color:#6B6B74}
.ok{color:#0F766E;font-weight:700}.bad{color:#B42318;font-weight:700}
.ck{display:grid;grid-template-columns:22px 360px 1fr;margin-left:52px;white-space:pre}.ck span:last-child{color:#6B6B74;font-family:Inter,sans-serif;font-size:14.5px}
.sum{margin:6px 0 0 52px;font-weight:700;color:#0F766E}
.in{margin-top:18px;border:1.5px solid #D6D3CD;border-radius:10px;padding:10px 14px;color:#B9B5AE}.in b{color:#8E8A84;margin-right:10px}`;

function specLine(l: string): string {
  const ind = l.match(/^ */)![0], body = l.slice(ind.length);
  const first = body.split(' ')[0] ?? '';
  const cls: Record<string, string> = { '+': 'ok', '=': 'd', '!': 'w', '~': 'k', proof: 'p', pin: 'p', said: 'w' };
  const rest = esc(body.slice(first.length)).replace(/(&quot;|")([^"]*)"/g, '<span class="s">"$2"</span>');
  return `${ind}<span class="${cls[first] ?? 'k'}">${esc(first)}</span>${rest}`;
}

export function claudeSession(o: { prompt: string; numstat: [number, number, string][]; tests: number; did: string }): string {
  const edits = o.numstat.map(([a, d, f]) => `<div class="b"><i>⏺</i><span class="k">${a && !d && f.startsWith('test') ? 'Write' : 'Update'}</span>(${esc(f)})</div>
<div class="r"><i>⎿</i>${d ? `Updated ${esc(f)} with ${a} additions and ${d} removals` : `Wrote ${a} lines to ${esc(f)}`}</div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>${TERM_CSS}</style></head><body><div class="t" id="t">
<div class="u"><b>&gt;</b>${esc(o.prompt)}</div>
<div class="b"><span class="n">⏺</span>I'll add a tags table, accept tags when saving, filter the list by one tag, and show tags on the page.</div>
${edits}
<div class="b"><i>⏺</i><span class="k">Bash</span>(npm test)</div>
<div class="r"><i>⎿</i><span class="ok">✔ ${o.tests} tests pass</span> · 0 fail</div>
<div class="b"><span class="n">⏺</span>${esc(o.did)}</div>
<div class="in"><b>&gt;</b>&nbsp;</div>
</div></body></html>`;
}

export function storydiffRun(o: { spec: string[]; report: Report; tries: number; checkLabel: (c: Report['checks'][number]) => string }): string {
  const r = o.report;
  const spec = o.spec.map((l, i) => `<div class="ln"><span>${i + 1}</span><span>${specLine(l)}</span></div>`).join('');
  const checks = r.checks.map((c) => `<div class="ck row" data-ok="${c.ok === true}"><span class="${c.ok === true ? 'ok' : 'bad'}">${c.ok === true ? '✓' : '✗'}</span><span>${esc(c.kind === 'said' ? '“' + (c.ref.length > 30 ? c.ref.slice(0, 29) + '…' : c.ref) + '”' : c.ref.length > 34 ? c.ref.slice(0, 33) + '…' : c.ref)}</span><span>${esc(o.checkLabel(c))}</span></div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>${TERM_CSS}</style></head><body><div class="t" id="t">
<div class="u"><b>&gt;</b>/storydiff</div>
<div class="b"><i>⏺</i><span class="k">Write</span>(handover.storydiff)</div>
<div class="r"><i>⎿</i>Wrote ${o.spec.length} lines to handover.storydiff</div>
<div class="box" id="write">${spec}</div>
<div class="b"><i>⏺</i><span class="k">Bash</span>(storydiff check)</div>
<div class="r"><i>⎿</i>${r.claims} claims · the code, the tests and this session</div>
<div id="checks">${checks}</div>
<div class="sum" id="sum">${r.failed ? `<span class="bad">✗ ${r.failed} of ${r.claims} claims failed</span>` : `✓ ${r.claims} claims hold up · 0 failed · ${r.oldPass} old tests still pass · ${r.newTests} new`}</div>
<div class="b"><i>⏺</i><span class="k">Bash</span>(storydiff view)</div>
<div class="r"><i>⎿</i>Opened the card: .storydiff/card.html</div>
<div class="b"><span class="n">⏺</span>Handed over. Every claim holds up; the card lists ${o.tries} things for the reviewer to try before merging.</div>
<div class="in"><b>&gt;</b>&nbsp;</div>
</div></body></html>`;
}

export function checkRed(o: { report: Report; quote: string }): string {
  const r = o.report;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#FFFFFF;color:#1F2328;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
.w{width:900px;box-sizing:border-box;padding:24px}
.m{border:1px solid #D1D9E0;border-radius:6px}
.h{display:flex;gap:14px;align-items:center;padding:16px}
.x{flex:none;width:40px;height:40px;border-radius:999px;background:#D1242F;color:#fff;display:flex;align-items:center;justify-content:center;font:700 20px sans-serif}
.h b{font-size:16px}.h span{display:block;color:#59636E}
.row{display:flex;align-items:center;gap:10px;padding:10px 16px;border-top:1px solid #D1D9E0;background:#F6F8FA}
.row .i{width:18px;font-weight:700}.row .nm{font-weight:600}.row .st{color:#59636E}.row .dt{margin-left:auto;color:#0969DA}
.why{padding:10px 16px 14px 44px;border-top:1px solid #D1D9E0;color:#B42318;font-size:13.5px}
.bl{display:flex;gap:14px;align-items:center;padding:14px 16px;border-top:1px solid #D1D9E0}
.btn{margin-left:auto;background:#F6F8FA;color:#8C959F;border:1px solid #D1D9E0;border-radius:6px;padding:5px 16px;font-weight:600}
</style></head><body><div class="w"><div class="m">
<div class="h"><div class="x">✕</div><div><b>Some checks were not successful</b><span>1 failing and 1 successful check</span></div></div>
<div class="row" id="fail"><span class="i" style="color:#D1242F">✕</span><span class="nm">storydiff / check</span><span class="st">Failing after 9s · ${r.failed} of ${r.claims} claims failed</span><span class="dt">Details</span></div>
<div class="why" id="why">✗ “${esc(o.quote)}” is not in the session</div>
<div class="row"><span class="i" style="color:#1A7F37">✓</span><span class="nm">test / node 25</span><span class="st">Successful in 14s</span><span class="dt">Details</span></div>
<div class="bl"><div><b>Merging is blocked</b><br><span style="color:#59636E">The storydiff check must pass before this can merge.</span></div><span class="btn">Merge pull request</span></div>
</div></div></body></html>`;
}

/** Handwriting on the board, in the card's own hand (Caveat). */
export function hand(o: { text: string; size: number; color?: string; weight?: number }): string {
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>body{margin:0;background:transparent}
#h{display:inline-block;padding:0 16px;font:${o.weight ?? 600} ${o.size}px/1.1 Caveat,cursive;color:${o.color ?? '#16161A'};white-space:nowrap}</style></head>
<body><span id="h">${esc(o.text)}</span></body></html>`;
}
/** A sticky note with a human's words on it. */
export function sticky(o: { quote: string; who: string; color?: string; width?: number }): string {
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>body{margin:0;background:transparent;padding:30px}
#h{width:${o.width ?? 300}px;box-sizing:border-box;padding:22px 22px 16px;background:${o.color ?? '#FFE89A'};border-radius:3px;
box-shadow:0 1px 0 rgba(0,0,0,.04), 0 14px 24px -10px rgba(58,42,32,.35);font:600 29px/1.1 Caveat,cursive;color:#16161A}
#h small{display:block;text-align:right;margin-top:10px;font:600 24px Caveat,cursive;color:#6B6B74}</style></head>
<body><div id="h">${esc(o.quote)}<small>${esc(o.who)}</small></div></body></html>`;
}
