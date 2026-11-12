// The PR comment: the same card as text, for GitHub. Verdict line, asked/did, the numbered list, a Mermaid map.
import type { Doc, Mark, Node } from '../spec/types.ts';
import type { Report } from './types.ts';

export const MARKER = '<!-- storydiff:card -->';

export interface MarkdownOptions {
  /** The card PNG, shown at the top when given. */
  imageUrl?: string;
  /** Where the image links to (the interactive card). */
  viewUrl?: string;
}

/** The verdict chips as one line of text, under the same honesty rules as the card. */
export function verdictLine(d: Doc, rep: Report): string {
  const unsure = !!rep.unchecked || rep.oldPass == null;
  const tick = (s: string) => (unsure ? s.replace(/^✓ /, '') : s);
  const watch = [d, ...d.rest.filter((r) => (r.chapters[r.chapter - 1] ?? '').startsWith('+'))].reduce((n, x) => n + x.marks.filter((m) => m.n && m.mark === 'watch').length, 0);
  const r = rep.regressed.length, u = rep.coverage?.uncovered.length ?? 0;
  const parts = [
    r ? `✗ ${r} old test${r > 1 ? 's' : ''} now fail${r > 1 ? '' : 's'}` : rep.oldPass == null ? rep.testsLine || 'Tests not run yet' : tick(`✓ All ${rep.oldPass} old tests still pass`),
    rep.newTests ? `${rep.newTests} new test${rep.newTests > 1 ? 's' : ''}` : '',
    rep.editedOld?.length ? `✎ ${rep.editedOld.length} old test${rep.editedOld.length > 1 ? 's' : ''} edited` : '',
    rep.missing?.length ? `${rep.missing.length} old test${rep.missing.length > 1 ? 's' : ''} gone or renamed` : '',
    rep.unchecked ? `${rep.claims} claims cited · not checked yet` : rep.failed ? `✗ ${rep.failed} of ${rep.claims} claims don't hold up` : (rep.unverified ?? 0) >= rep.claims && rep.claims ? `${rep.claims} claims cited · not checked here` : tick(`✓ ${rep.claims - (rep.unverified ?? 0)} claims checked`) + ((rep.unverified ?? 0) ? ` · ? ${rep.unverified} not checked here` : ''),
    rep.coverage ? (u ? `✗ ${u} file${u > 1 ? 's' : ''} not covered` : tick(`✓ Covers all ${rep.coverage.files} changed files`)) : '',
    ...(rep.extra || []),
    watch ? `${watch} thing${watch > 1 ? 's' : ''} to try` : 'Nothing flagged',
  ];
  return parts.filter(Boolean).join(' · ');
}

const GROUPS: [string, Mark['mark'][]][] = [['Breaks for callers', ['breaks']], ['New', ['new', 'changed', 'gone']], ['Kept the same', ['kept']], ['Try before you merge', ['watch']]];
/** Agent-written text, safe in a GitHub comment: no HTML, no @-mentions. */
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/@(?=[\w-])/g, '@\u200b');
/** A code span that survives backticks in its content. */
const code = (s: string) => { const t = s.replace(/\s+/g, ' '); const n = Math.max(0, ...(t.match(/`+/g) || []).map((x) => x.length)) + 1; const f = '`'.repeat(n); return n > 1 ? `${f} ${t} ${f}` : `${f}${t}${f}`; };

function body(d: Doc, rep: Report, out: string[]) {
  const a = d.asks[0];
  if (d.ask) out.push(`**${oneLine(a?.from || d.by || 'The human')} asked${a?.in ? ` (${oneLine(a.in)})` : ''}** “${oneLine(d.ask)}”  `);
  for (const x of d.asks.slice(1, 3)) out.push(`then: ${oneLine(x.text)}  `);
  if (d.did) out.push(`**${oneLine(d.agent ? d.agent.split(' ')[0] : d.by || 'The author')} did** ${oneLine(d.did)}`);
  out.push('');
  for (const [name, kinds] of GROUPS) {
    const items = d.marks.filter((m) => m.n && kinds.includes(m.mark)).sort((x, y) => x.n! - y.n!);
    if (!items.length) continue;
    out.push(`**${name}**`);
    for (const m of items) {
      out.push(`${m.n}. ${oneLine(m.line)}`);
      const q = m.said[0];
      const at = q ? rep.checks.find((c) => c.kind === 'said' && c.ref === q.text && c.at)?.at || q.at : '';
      if (q) out.push(`   > “${oneLine(q.text)}” · ${oneLine(d.by || 'the human')}${at ? ', ' + oneLine(at) : ''}`);
    }
    out.push('');
  }
  if (d.smaller.length) out.push(`<details><summary>+ ${d.smaller.length} smaller change${d.smaller.length > 1 ? 's' : ''}: ${oneLine(d.smaller[0].line)}${d.smaller.length > 1 ? ', …' : ''}</summary>`, '', ...d.smaller.map((s) => `- ${oneLine(s.line)} (${s.files.map(code).join(', ')})`), '', '</details>', '');
}

export function renderMarkdown(d: Doc, rep: Report, o: MarkdownOptions = {}): string {
  const out: string[] = [MARKER, `### Storydiff · ${oneLine(d.pr)}${d.pr ? ' · ' : ''}${oneLine(d.title)}`, ''];
  if (d.shipsWith.length) out.push(`Ships with ${d.shipsWith.map(oneLine).join(', ')}`, '');
  out.push(`**${verdictLine(d, rep)}**`, '');
  if (o.imageUrl) out.push(o.viewUrl ? `[![The Storydiff card](${o.imageUrl})](${o.viewUrl})` : `![The Storydiff card](${o.imageUrl})`, '');

  const bad = rep.checks.filter((c) => c.ok === false);
  const uncovered = rep.coverage?.uncovered ?? [];
  if (rep.regressed.length || rep.missing?.length || uncovered.length || (bad.length && !rep.unchecked)) {
    out.push("**What doesn't hold up**");
    for (const t of rep.regressed) out.push(`- ✗ ${code(t)} passed before and fails now`);
    for (const t of rep.missing ?? []) out.push(`- ? ${code(t)} passed before and did not run now (renamed or deleted?)`);
    for (const f of uncovered) out.push(`- ✗ ${code(f)} is changed but nothing on the card covers it`);
    if (!rep.unchecked) for (const c of bad) out.push(`- ✗ ${code(c.kind === 'said' ? '“' + c.ref + '”' : c.ref)}: ${oneLine(c.why)}${c.line ? ` (spec line ${c.line})` : ''}`);
    out.push('');
  }
  body(d, rep, out);
  for (const r of d.rest) {
    out.push(`#### Chapter ${r.chapter}: ${oneLine(r.chapters[r.chapter - 1] ?? '')}`, '');
    body(r, rep, out);
  }
  out.push('<details><summary>What changed underneath (map)</summary>', '', '```mermaid', mermaid(d), '```', '', '</details>', '');
  const where = rep.quotesCheckedAt ? `Quotes checked on ${rep.quotesCheckedAt}. ` : '';
  out.push(`<sub>${where}Every numbered line is checked against the code, the tests and the session. Made with [Storydiff](https://github.com/pulkitnagpal/storydiff).</sub>`);
  return out.join('\n') + '\n';
}

// --- Mermaid fallback for the map ---------------------------------------------------------------------------------
const SYM = { new: '+ ', changed: '~ ', gone: '− ', kept: '= ', watch: '! ', breaks: '✗ ' } as const;
const safeId = (id: string) => 'n_' + id.replace(/[^A-Za-z0-9_]/g, '_');

function cls(d: Doc, n: Node): keyof typeof SYM | '' {
  const marks = d.marks.filter((m) => m.id === n.id);
  if (marks.some((m) => m.mark === 'breaks')) return 'breaks';
  if (marks.some((m) => m.mark === 'watch')) return 'watch';
  if (n.born) return 'new';
  if (marks.some((m) => m.mark === 'gone')) return 'gone';
  if (marks.some((m) => m.mark === 'changed') || d.edges.some((e) => e.gone && e.from === n.id)) return 'changed';
  if (marks.some((m) => m.mark === 'kept')) return 'kept';
  return '';
}

export function mermaid(d: Doc): string {
  const out = ['flowchart LR',
    '  classDef new fill:#E3F1EF,stroke:#0F766E,stroke-width:2px,color:#0B4F4A',
    '  classDef changed stroke:#4338CA,stroke-width:2px',
    '  classDef gone stroke:#8E8A84,stroke-dasharray:5 5,color:#8E8A84',
    '  classDef kept stroke:#8E8A84,stroke-dasharray:3 3,color:#6B6B74',
    '  classDef watch stroke:#C2410C,stroke-width:3px',
    '  classDef breaks stroke:#B42318,stroke-width:3px,color:#B42318'];
  for (const id of d.order) {
    const n = d.nodes[id], c = cls(d, n);
    const label = '"' + ((c ? SYM[c] : '') + n.label).replace(/"/g, "'") + '"';
    const shape = n.kind === 'table' || n.kind === 'store' ? `[(${label})]` : n.kind === 'external' || n.kind === 'user' ? `([${label}])` : n.kind === 'queue' ? `[[${label}]]` : `[${label}]`;
    out.push(`  ${safeId(id)}${shape}${c ? ':::' + c : ''}`);
  }
  d.edges.forEach((e) => out.push(`  ${safeId(e.from)} ${e.gone ? '-.->' : e.born ? '==>' : '-->'} ${safeId(e.to)}`));
  d.edges.forEach((e, k) => {
    if (e.gone) out.push(`  linkStyle ${k} stroke:#8E8A84,stroke-dasharray:5 5`);
    else if (e.born) out.push(`  linkStyle ${k} stroke:#0F766E,stroke-width:2.5px`);
  });
  return out.join('\n');
}
