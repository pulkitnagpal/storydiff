// Stand-in pages for the shot list, built from the real run's data (the session, the handover, the checker's reports).
// Each one is replaced by a real capture from a v1 run as soon as that capture is in scripts/video/assets/.
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
