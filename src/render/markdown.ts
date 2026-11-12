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

/** The verdict chips as one line of text. */
export function verdictLine(d: Doc, rep: Report): string {
  const watch = d.marks.filter((m) => m.n && m.mark === 'watch').length;
  const r = rep.regressed.length;
  const parts = [
    r ? `✗ ${r} old test${r > 1 ? 's' : ''} now fail${r > 1 ? '' : 's'}` : rep.oldPass == null ? rep.testsLine || 'Tests not run yet' : `✓ All ${rep.oldPass} old tests still pass`,
    rep.newTests ? `${rep.newTests} new tests` : '',
    rep.unchecked ? `${rep.claims} claims cited · not checked yet` : rep.failed ? `✗ ${rep.failed} of ${rep.claims} claims don't hold up` : `✓ ${rep.claims} claims checked`,
    ...(rep.extra || []),
    watch ? `${watch} thing${watch > 1 ? 's' : ''} to try` : '✓ Nothing to try',
  ];
  return parts.filter(Boolean).join(' · ');
}

const GROUPS: [string, Mark['mark'][]][] = [['New', ['new', 'changed', 'gone']], ['Kept the same', ['kept']], ['Try before you merge', ['watch']]];
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

export function renderMarkdown(d: Doc, rep: Report, o: MarkdownOptions = {}): string {
  const out: string[] = [MARKER, `### Storydiff · ${oneLine(d.pr)}${d.pr ? ' · ' : ''}${oneLine(d.title)}`, ''];
  if (d.shipsWith.length) out.push(`Ships with ${d.shipsWith.join(', ')}`, '');
  out.push(`**${verdictLine(d, rep)}**`, '');
  if (d.ask) out.push(`**${d.by || 'The human'} asked** “${oneLine(d.ask)}”  `);
  if (d.did) out.push(`**${(d.agent || 'The agent').split(' ')[0]} did** ${oneLine(d.did)}`);
  out.push('');
  if (o.imageUrl) out.push(o.viewUrl ? `[![The Storydiff card](${o.imageUrl})](${o.viewUrl})` : `![The Storydiff card](${o.imageUrl})`, '');

  const bad = rep.checks.filter((c) => c.ok !== true);
  if (rep.regressed.length || (bad.length && !rep.unchecked)) {
    out.push("**What doesn't hold up**");
    for (const t of rep.regressed) out.push(`- ✗ \`${t}\` passed before and fails now`);
    for (const c of bad) out.push(`- ${c.ok === false ? '✗' : '?'} \`${c.kind === 'said' ? '“' + c.ref + '”' : c.ref}\`: ${c.why}${c.line ? ` (spec line ${c.line})` : ''}`);
    out.push('');
  }

  for (const [name, kinds] of GROUPS) {
    const items = d.marks.filter((m) => m.n && kinds.includes(m.mark)).sort((a, b) => a.n! - b.n!);
    if (!items.length) continue;
    out.push(`**${name}**`);
    for (const m of items) {
      out.push(`${m.n}. ${oneLine(m.line)}`);
      const q = m.said[0];
      if (q) out.push(`   > “${oneLine(q.text)}” · ${d.by || 'the human'}${q.at ? ', ' + q.at : ''}`);
    }
    out.push('');
  }
  out.push('<details><summary>What changed underneath (map)</summary>', '', '```mermaid', mermaid(d), '```', '', '</details>', '');
  const where = rep.quotesCheckedAt ? `Quotes checked on ${rep.quotesCheckedAt}. ` : '';
  out.push(`<sub>${where}Every numbered line is checked against the code, the tests and the session. Made with [Storydiff](https://github.com/pulkitnagpal/storydiff).</sub>`);
  return out.join('\n') + '\n';
}

// --- Mermaid fallback for the map ---------------------------------------------------------------------------------
const SYM = { new: '+ ', changed: '~ ', gone: '− ', kept: '= ', watch: '! ' } as const;
const safeId = (id: string) => 'n_' + id.replace(/[^A-Za-z0-9_]/g, '_');

function cls(d: Doc, n: Node): keyof typeof SYM | '' {
  const marks = d.marks.filter((m) => m.id === n.id);
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
    '  classDef watch stroke:#C2410C,stroke-width:3px'];
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
