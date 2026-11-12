// The one sticky comment: card image, numbered list, collapsed Mermaid fallback, all from
// `storydiff render --md`, plus a footnote on what was checked where.
// `storydiff publish` (author side) and this Action share the marker, so they update the same comment.

export const MARKER = '<!-- storydiff:card -->';
const MAX = 65000; // GitHub's limit is 65536 characters

/**
 * @param {{ cards: { md: string }[], head: string, quotesCheckedAt?: string|null, quotesUnchecked?: number, runUrl?: string, notes?: string[] }} o
 */
export function buildComment(o) {
  const cards = o.cards.map(c => stripMarker(c.md).trim()).filter(Boolean);
  const body = cards.join('\n\n---\n\n');
  const foot = footnote(o);
  let out = `${MARKER}\n${body}\n\n${foot}\n`;
  if (out.length > MAX) {
    const room = MAX - foot.length - MARKER.length - 200;
    out = `${MARKER}\n${body.slice(0, room)}\n\n_The card text was cut to fit a GitHub comment._\n\n${foot}\n`;
  }
  return out;
}

function footnote(o) {
  const short = (s) => (s ? String(s).slice(0, 7) : '');
  const lines = [];
  lines.push(`Code and test proofs re-checked at ${short(o.head)} by the Storydiff Action.`);
  if (o.quotesCheckedAt) lines.push(`Quotes checked on the author's machine at ${short(o.quotesCheckedAt)}, against their session log.`);
  else lines.push("Quotes are checked on the author's machine, against their session log.");
  if (o.quotesUnchecked) lines.push(`${o.quotesUnchecked} quote${o.quotesUnchecked === 1 ? ' was' : 's were'} never checked there.`);
  for (const n of o.notes || []) lines.push(n);
  const run = o.runUrl ? ` [Run](${o.runUrl}).` : '';
  return `<sub>${lines.join(' ')}${run}</sub>`;
}

function stripMarker(md) { return String(md || '').split(MARKER).join(''); }

/** The comment to update: ours (a bot's) first, then any comment with the marker. */
export function findSticky(comments) {
  const marked = (comments || []).filter(c => c && typeof c.body === 'string' && c.body.includes(MARKER));
  return marked.find(c => c.user && c.user.type === 'Bot') || marked[0] || null;
}
