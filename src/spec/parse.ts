// Storydiff spec v0.3: the language behind the review card. Pure function, no I/O.
//
//   pr "Linkbox #12" files 5
//   title "Tags for links"
//   by "Maya" with "Claude Code"
//   ask "..."            the human's words
//   did "..."            one line on the approach
//   ships-with "orchestrator#981"
//   chapters "Charge customers once", "Retry slow charges", "+ 6 smaller changes"
//   chapter 1
//   show screen /path ["label" ["hint"]]
//   show call METHOD /path [{json}] ["label" ["hint"]]
//   show same "label" (screen /path | METHOD /path)
//   show pipeline <file> ["label"]      show recipe <file> ["label"]
//   show scenario "what happens when…"
//   <kind> <id> "Label" ["note"]        a box on the map, as it is today
//   a -> b                              an arrow on the map
//   + | ~ | - | = | !  [box | id | a -> b]  "one line for the list"
//       said [@00:41] "the human's words"   proof <file:line | test name>   eng "..."   now "note after"
//       pin screen "<css>" | pin call "<field>" | pin step "<text>" | pin row "<text>" | pin outcome <n> | pin same <n>
import { KINDS, type BoxKind, type Doc, type Edge, type Mark, type MarkKind, type Node, type PinPlace, type Show } from './types.ts';

export class SpecError extends Error {
  line: number;
  constructor(line: number, message: string) {
    super(`Line ${line}: ${message}`);
    this.name = 'SpecError';
    this.line = line;
  }
}

const MARKS: Record<string, MarkKind> = { '+': 'new', '~': 'changed', '-': 'gone', '=': 'kept', '!': 'watch' };
const PLACES: PinPlace[] = ['screen', 'call', 'step', 'row', 'outcome', 'same'];
const isKind = (s: string): s is BoxKind => (KINDS as readonly string[]).includes(s);

interface Tok { s: string; q?: boolean; arrow?: boolean; json?: boolean }

function fail(i: number, msg: string): never { throw new SpecError(i + 1, msg); }

function tokens(text: string, i: number): Tok[] {
  const out: Tok[] = [];
  const re = /\s*(?:"((?:[^"\\]|\\.)*)"|(->)|(\{.*\})|([^\s"]+))/g;
  let pos = 0;
  while (pos < text.length) {
    re.lastIndex = pos;
    const m = re.exec(text);
    if (!m || m.index !== pos || m[0].trim() === '') break;
    if (m[1] !== undefined) out.push({ s: m[1].replace(/\\"/g, '"'), q: true });
    else if (m[2]) out.push({ s: '->', arrow: true });
    else if (m[3]) out.push({ s: m[3], json: true });
    else out.push({ s: m[4] });
    pos = re.lastIndex;
  }
  if (text.slice(pos).trim() !== '') fail(i, 'an opening " has no closing "');
  return out;
}

function stripComment(line: string): string {
  let q = false;
  for (let k = 0; k < line.length; k++) {
    if (line[k] === '"' && line[k - 1] !== '\\') q = !q;
    if (line[k] === '#' && !q) return line.slice(0, k);
  }
  return line;
}

const quotes = (t: Tok[], from: number) => t.slice(from).filter((x) => x.q).map((x) => x.s);

export function parse(src: string): Doc {
  const d: Doc = { pr: '', files: 0, title: '', by: '', agent: '', ask: '', did: '', shipsWith: [], chapters: [], chapter: 0, shows: [], nodes: {}, order: [], edges: [], marks: [] };
  const lines = src.replace(/\r/g, '').replace(/\t/g, '  ').split('\n');
  let mark: Mark | null = null;
  let mIndent = -1;

  const node = (id: string, i: number): Node => d.nodes[id] ?? fail(i, `"${id}" is not on the map yet. Add it first, like: code ${id} "Label"`);
  const edge = (a: string, b: string): Edge | undefined => d.edges.find((e) => e.from === a && e.to === b);
  const addNode = (kind: BoxKind, id: string, label: string, note: string, born: boolean, state: Node['state']) => {
    d.nodes[id] = { id, kind, label, note, noteAfter: '', born, state, order: d.order.length };
    d.order.push(id);
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = stripComment(lines[i]);
    if (!raw.trim()) continue;
    const ind = raw.match(/^ */)![0].length;
    const text = raw.trim();
    const t = tokens(text, i);
    const h = t[0].s;

    // Detail lines belong to the mark above them.
    if (mark && ind > mIndent) {
      if (h === 'said') {
        const at = t[1] && /^@/.test(t[1].s) ? t[1].s.slice(1) : '';
        const q = t[at ? 2 : 1];
        if (!q || !q.q) fail(i, 'said needs a "quote", like: said @00:41 "Not Redis."');
        mark.said.push({ at, text: q.s });
      } else if (h === 'proof') {
        const p = text.slice(5).trim();
        if (!p) fail(i, 'proof needs a file:line or a test name');
        mark.proofs.push(p);
      } else if (h === 'eng') {
        if (!t[1] || !t[1].q) fail(i, 'eng needs a "sentence"');
        mark.eng = t[1].s;
      } else if (h === 'pin') {
        const where = t[1]?.s as PinPlace, what = t[2];
        if (!PLACES.includes(where) || !what) fail(i, 'pin needs a place and a target, like: pin screen "#filter"');
        mark.pins.push({ on: where, target: what.s });
      } else fail(i, 'under a mark, use said, proof, eng or pin');
      continue;
    }
    mark = null;
    mIndent = -1;

    if (h === 'pr') {
      d.pr = t[1]?.s ?? '';
      for (let k = 2; k < t.length; k++) if (t[k].s === 'files') d.files = Number(t[k + 1]?.s) || 0;
      continue;
    }
    if (h === 'title' || h === 'ask' || h === 'did') {
      if (!t[1] || !t[1].q) fail(i, `${h} needs a "sentence"`);
      d[h] = t[1].s;
      continue;
    }
    if (h === 'by') { d.by = t[1]?.s ?? ''; d.agent = t[3]?.s ?? ''; continue; }
    if (h === 'chapters') { d.chapters = quotes(t, 1); continue; }
    if (h === 'chapter') { d.chapter = Number(t[1]?.s) || 0; continue; }
    if (h === 'show') { d.shows.push(show(t, i)); continue; }

    if (MARKS[text[0]] && text[1] === ' ') {
      const mt = tokens(text.slice(2), i);
      const m: Mark = { mark: MARKS[text[0]], line: '', id: null, edge: null, said: [], proofs: [], pins: [], eng: '', src: i + 1 };
      m.line = mt.length && mt[mt.length - 1].q ? mt.pop()!.s : '';
      if (mt.length >= 3 && mt[1].arrow) {
        let e = edge(mt[0].s, mt[2].s);
        if (m.mark === 'new') {
          if (e) fail(i, 'that arrow already exists');
          node(mt[0].s, i); node(mt[2].s, i);
          e = { from: mt[0].s, to: mt[2].s, born: true, gone: false };
          d.edges.push(e);
        } else {
          if (!e) fail(i, `no arrow ${mt[0].s} -> ${mt[2].s} on the map`);
          if (m.mark === 'gone') e.gone = true;
        }
        m.edge = e;
      } else if (mt.length >= 2 && isKind(mt[0].s)) {
        // One quote on a box is its label; a second one is the list line.
        if (!(mt[2] && mt[2].q) && m.line) { mt.push({ s: m.line, q: true }); m.line = ''; }
        const id = mt[1].s, label = mt[2]?.q ? mt[2].s : id;
        if (d.nodes[id]) fail(i, `"${id}" is already on the map; refer to it by its id`);
        addNode(mt[0].s, id, label, '', m.mark === 'new', m.mark);
        m.id = id;
      } else if (mt.length === 1) {
        const n = node(mt[0].s, i);
        m.id = n.id;
        if (n.state === 'base') n.state = m.mark;
      } else if (mt.length > 1) fail(i, 'a mark points at a box ("table tags \\"Tags\\""), an id, an arrow, or nothing');
      if (!m.line && !m.edge && !(m.id && d.nodes[m.id].born)) fail(i, 'every mark needs its one line for the list, in "quotes" at the end');
      if (m.line && m.line.split(/\s+/).length > 16) fail(i, 'keep the list line to 16 words or fewer');
      d.marks.push(m);
      mark = m;
      mIndent = ind;
      continue;
    }
    if (t.length >= 3 && t[1].arrow) {
      node(t[0].s, i); node(t[2].s, i);
      if (edge(t[0].s, t[2].s)) fail(i, `the arrow ${t[0].s} -> ${t[2].s} is declared twice`);
      d.edges.push({ from: t[0].s, to: t[2].s, born: false, gone: false });
      continue;
    }
    if (t.length >= 2 && isKind(h)) {
      if (d.nodes[t[1].s]) fail(i, `"${t[1].s}" is declared twice`);
      addNode(h, t[1].s, t[2]?.q ? t[2].s : t[1].s, '', false, 'base');
      continue;
    }
    fail(i, 'unknown line. Lines start with a kind (code, screen, table…), an arrow, a mark (+ ~ - = !), show, pr, title, by, ask, did or chapters');
  }
  if (!d.order.length) fail(0, 'nothing on the map yet. Add a box, like: code api "API"');
  // Number the list: new things first, then what was kept, then what to try. Pins share these numbers.
  const rank: Record<MarkKind, number> = { new: 0, changed: 0, gone: 0, kept: 1, watch: 2 };
  let n = 0;
  d.marks.filter((m) => m.line).sort((a, b) => rank[a.mark] - rank[b.mark] || d.marks.indexOf(a) - d.marks.indexOf(b)).forEach((m) => { m.n = ++n; });
  if (n > 7) fail(0, 'the list holds at most 7 items; split the PR into chapters');
  return d;
}

function show(t: Tok[], i: number): Show {
  const kind = t[1]?.s;
  if (kind === 'screen') {
    const qs = quotes(t, 2);
    return { kind, path: t[2] && !t[2].q ? t[2].s : '/', label: qs[0], hint: qs[1] };
  }
  if (kind === 'call') {
    if (!t[2] || !t[3]) fail(i, 'show call needs METHOD /path');
    let body: unknown;
    if (t[4]?.json) { try { body = JSON.parse(t[4].s); } catch { fail(i, 'the call body is not valid JSON'); } }
    const qs = quotes(t, 4);
    const sh: Show = { kind, method: t[2].s.toUpperCase(), path: t[3].s, label: qs[0], hint: qs[1] };
    if (body !== undefined) sh.body = body;
    return sh;
  }
  if (kind === 'same') {
    if (!t[2]?.q) fail(i, 'show same needs a "label", then screen /path or METHOD /path');
    return { kind, label: t[2].s, what: t.slice(3).map((x) => x.s).join(' ') };
  }
  if (kind === 'pipeline' || kind === 'recipe') {
    if (!t[2] || t[2].q) fail(i, `show ${kind} needs a file`);
    return { kind, file: t[2].s, label: quotes(t, 3)[0] };
  }
  if (kind === 'scenario') {
    if (!t[2]?.q) fail(i, 'show scenario needs "what happens when…"');
    return { kind, label: t[2].s };
  }
  return fail(i, 'show needs one of: screen, call, same, pipeline, recipe, scenario');
}
