// Storydiff spec v0.3 (+ v1 additions): the language behind the review card. Pure function, no I/O.
//
//   pr "Linkbox #12" files 5
//   title "Tags for links"
//   by "Maya" [with "Claude Code"]          no "with": a PR without an agent session
//   ask "..." [from "who"] [in "#1484"]     the human's words; later asks render as "then: …"
//   did "..."                               one line on the approach
//   ships-with "orchestrator#981", ...
//   run "npm start" [port 3000] [env K=V K="two words"]    how capture starts the app ($PORT)
//   setup METHOD /path [{json}]             sent to both versions before the first show
//   run-tests "cargo test"                  test command for check
//   chapters "Charge customers once", "Retry slow charges", "+ 6 smaller changes"
//   chapter 1                               starts that chapter's section (lines above are shared)
//   show screen /path ["label" ["hint"]]
//   show call METHOD /path [{json}] ["label" ["hint"]]
//   show same "label" (screen /path | METHOD /path [{json}])
//   show pipeline <file> ["label"]      show recipe <file> ["label"]
//   show terminal "cmd" ["label"]
//   show scenario "what happens when…"
//       do   METHOD /path [{json}] "title" ["note"]
//       then METHOD /path [{json}] "big" ["small"] [want "x"]
//   <kind> <id> "Label" ["note"] [in "repo#n"]   a box on the map, as it is today
//   a -> b                                       an arrow on the map
//   + | ~ | - | = | ! | x  [box | id | a -> b]  "one line for the list"
//       said [@00:41] "the human's words"   proof <file:line | test name>   eng "..."   now "note after"
//       pin [before] screen "<css>" | call "<field>" | step "<text>" | row "<text>" | line "<text>" | outcome <n> | same <n>
//   smaller "one line" files a.ts, b.ts     folded into "+ N smaller changes"; the files count as covered
import { KINDS, type BoxKind, type Doc, type Edge, type Mark, type MarkKind, type Node, type PinPlace, type Request, type Show } from './types.ts';

export class SpecError extends Error {
  line: number;
  constructor(line: number, message: string) {
    super(`Line ${line}: ${message}`);
    this.name = 'SpecError';
    this.line = line;
  }
}

const MARKS: Record<string, MarkKind> = { '+': 'new', '~': 'changed', '-': 'gone', '=': 'kept', '!': 'watch', x: 'breaks' };
const PLACES: PinPlace[] = ['screen', 'call', 'step', 'row', 'outcome', 'same', 'line'];
const CAPPED: MarkKind[] = ['new', 'changed', 'gone', 'kept'];
const RANK: Record<MarkKind, number> = { breaks: 0, new: 1, changed: 1, gone: 1, kept: 2, watch: 3 };
const ID = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const isKind = (s: string): s is BoxKind => (KINDS as readonly string[]).includes(s);

interface Tok { s: string; q?: boolean; arrow?: boolean; json?: boolean }

function fail(i: number, msg: string): never { throw new SpecError(i + 1, msg); }

/** The end of a {json} value starting at `from`, respecting strings. -1 when it never closes. */
function jsonEnd(text: string, from: number): number {
  let depth = 0, str = false;
  for (let k = from; k < text.length; k++) {
    const c = text[k];
    if (str) { if (c === '\\') k++; else if (c === '"') str = false; continue; }
    if (c === '"') str = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) return k + 1; }
  }
  return -1;
}

function tokens(text: string, i: number): Tok[] {
  const out: Tok[] = [];
  let pos = 0;
  while (pos < text.length) {
    while (pos < text.length && /\s/.test(text[pos])) pos++;
    if (pos >= text.length) break;
    const c = text[pos];
    if (c === '"') {
      let k = pos + 1, s = '';
      for (; k < text.length && text[k] !== '"'; k++) {
        if (text[k] === '\\' && text[k + 1] === '"') { s += '"'; k++; } else s += text[k];
      }
      if (k >= text.length) fail(i, 'an opening " has no closing "');
      out.push({ s, q: true });
      pos = k + 1;
    } else if (c === '{') {
      const end = jsonEnd(text, pos);
      if (end < 0) fail(i, 'a { has no closing }');
      out.push({ s: text.slice(pos, end), json: true });
      pos = end;
    } else if (text.startsWith('->', pos) && (pos + 2 >= text.length || /\s/.test(text[pos + 2]))) {
      out.push({ s: '->', arrow: true });
      pos += 2;
    } else {
      let k = pos;
      while (k < text.length && !/[\s"]/.test(text[k])) k++;
      out.push({ s: text.slice(pos, k) });
      pos = k;
    }
  }
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
function json(t: Tok, i: number): unknown {
  try { return JSON.parse(t.s); } catch { return fail(i, 'the JSON body is not valid JSON'); }
}
/** Pulls `in "repo#n"` out of a token list. */
function takeIn(t: Tok[]): string | undefined {
  const k = t.findIndex((x, j) => !x.q && x.s === 'in' && t[j + 1]?.q);
  if (k < 0) return undefined;
  const repo = t[k + 1].s;
  t.splice(k, 2);
  return repo;
}
/** METHOD /path [{json}] starting at token `at`; `next` is the token after it. */
function request(t: Tok[], at: number, i: number, what: string): { req: Request; next: number } {
  const m = t[at], p = t[at + 1];
  if (!m || m.q || m.json || !p || p.q || p.json) fail(i, `${what} needs METHOD /path, like: ${what} POST /api/links {"url":"x"}`);
  const req: Request = { method: m.s.toUpperCase(), path: p.s };
  if (t[at + 2]?.json) { req.body = json(t[at + 2], i); return { req, next: at + 3 }; }
  return { req, next: at + 2 };
}

/** Parses a handover. With several `chapter N` sections, returns the first chapter and the others in `rest`. */
export function parse(src: string): Doc {
  const lines = src.replace(/\r/g, '').split('\n');
  const starts = lines.map((l, k) => (/^chapter\s+\d+\s*(#.*)?$/.test(l) ? k : -1)).filter((k) => k >= 0);
  if (starts.length < 2) return parseOne(lines);
  // Each chapter sees the shared lines above the first chapter, plus its own section. Line numbers stay true.
  const docs = starts.map((s, j) => {
    const end = starts[j + 1] ?? lines.length;
    return parseOne(lines.map((l, k) => (k < starts[0] || (k >= s && k < end) ? l : '')));
  });
  docs[0].rest = docs.slice(1);
  return docs[0];
}

function parseOne(lines: string[]): Doc {
  const d: Doc = { pr: '', files: 0, title: '', by: '', agent: '', ask: '', asks: [], did: '', shipsWith: [], chapters: [], chapter: 0, shows: [], nodes: {}, order: [], edges: [], marks: [], smaller: [], setup: [], rest: [] };
  let mark: Mark | null = null, mIndent = -1;
  let scenario: Extract<Show, { kind: 'scenario' }> | null = null, sIndent = -1;

  const node = (id: string, i: number): Node => d.nodes[id] ?? fail(i, `"${id}" is not on the map yet. Add it first, like: code ${id} "Label"`);
  const edge = (a: string, b: string): Edge | undefined => d.edges.find((e) => e.from === a && e.to === b);
  const addNode = (i: number, kind: BoxKind, id: string, label: string, note: string, born: boolean, state: Node['state'], repo?: string) => {
    if (d.nodes[id]) fail(i, born || state !== 'base' ? `"${id}" is already on the map; refer to it by its id` : `"${id}" is declared twice`);
    if (!ID.test(id)) fail(i, `"${id}" is not a valid id (letters, digits, _ . -)`);
    d.nodes[id] = { id, kind, label, note, noteAfter: '', born, state, order: d.order.length, ...(repo ? { repo } : {}) };
    d.order.push(id);
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = stripComment(lines[i].replace(/\t/g, '  '));
    if (!raw.trim()) continue;
    const ind = raw.match(/^ */)![0].length;
    const text = raw.trim();
    const t = tokens(text, i);
    const h = t[0].s;

    // Steps of a scenario.
    if (h === 'do' || h === 'then') {
      if (!scenario || ind <= sIndent) fail(i, 'do and then go under a show scenario line, indented');
      const { req, next } = request(t, 1, i, h);
      if (h === 'do') {
        const qs = quotes(t, next);
        if (!qs[0]) fail(i, 'do needs a "title" for the step, like: do POST /webhooks {"id":"evt_9"} "Stripe sends"');
        (scenario.steps ??= []).push({ ...req, title: qs[0], ...(qs[1] !== undefined ? { note: qs[1] } : {}) });
      } else {
        const w = t.findIndex((x, j) => j >= next && !x.q && x.s === 'want' && t[j + 1]?.q);
        const outs = quotes(w >= 0 ? t.slice(0, w) : t, next);
        if (!outs[0]) fail(i, 'then needs the "big" outcome, like: then GET /charges "{total}" "charged {@count} times"');
        scenario.then = { ...req, big: outs[0], ...(outs[1] !== undefined ? { small: outs[1] } : {}), ...(w >= 0 ? { want: t[w + 1].s } : {}) };
      }
      continue;
    }
    if (scenario && ind <= sIndent) { scenario = null; sIndent = -1; }

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
      } else if (h === 'now') {
        if (!t[1] || !t[1].q) fail(i, 'now needs a "note", like: now "server only"');
        if (!mark.id) fail(i, 'now only works under a mark that points at a box');
        d.nodes[mark.id].noteAfter = t[1].s;
      } else if (h === 'pin') {
        const before = !!t[1] && !t[1].q && t[1].s === 'before';
        const where = t[before ? 2 : 1]?.s as PinPlace, what = t[before ? 3 : 2];
        if (!PLACES.includes(where) || !what) fail(i, 'pin needs a place and a target, like: pin screen "#filter" or pin before line "panicked"');
        mark.pins.push({ on: where, target: what.s, side: before ? 'before' : 'after' });
      } else fail(i, 'under a mark, use said, proof, eng, now or pin');
      continue;
    }
    mark = null;
    mIndent = -1;

    if (h === 'pr') {
      d.pr = t[1]?.s ?? '';
      for (let k = 2; k < t.length; k++) if (t[k].s === 'files') d.files = Number(t[k + 1]?.s) || 0;
      continue;
    }
    if (h === 'title' || h === 'did') {
      if (!t[1] || !t[1].q) fail(i, `${h} needs a "sentence"`);
      d[h] = t[1].s;
      continue;
    }
    if (h === 'ask') {
      if (!t[1] || !t[1].q) fail(i, 'ask needs the "human\'s words"');
      const a: Doc['asks'][number] = { text: t[1].s };
      for (let k = 2; k < t.length - 1; k++) if (!t[k].q && (t[k].s === 'from' || t[k].s === 'in') && t[k + 1].q) a[t[k].s as 'from' | 'in'] = t[k + 1].s;
      d.asks.push(a);
      d.ask = d.asks[0].text;
      continue;
    }
    if (h === 'by') {
      d.by = t[1]?.s ?? '';
      const w = t.findIndex((x) => !x.q && x.s === 'with');
      d.agent = w >= 0 ? t[w + 1]?.s ?? '' : '';
      continue;
    }
    if (h === 'ships-with') {
      const qs = quotes(t, 1);
      if (!qs.length) fail(i, 'ships-with needs a "repo#number", like: ships-with "orchestrator#981"');
      d.shipsWith.push(...qs);
      continue;
    }
    if (h === 'run') {
      if (d.run) fail(i, 'a spec has one run line');
      if (!t[1]?.q) fail(i, 'run needs the "command" that starts the app, like: run "npm start"');
      const env: Record<string, string> = {};
      let port: number | undefined;
      for (let k = 2; k < t.length; k++) {
        if (!t[k].q && t[k].s === 'port') { port = Number(t[++k]?.s); if (!Number.isInteger(port)) fail(i, 'port needs a number'); continue; }
        if (!t[k].q && t[k].s === 'env') continue;
        const m = t[k].q ? null : t[k].s.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!m) fail(i, `run: expected port N or env NAME=value, got ${t[k].s}`);
        let v = m[2];
        if (v === '' && t[k + 1]?.q) v = t[++k].s;
        if (m[1] === 'PORT') fail(i, 'run sets PORT itself (a free port per version). Read PORT in the app, and use port N for its default');
        env[m[1]] = v;
      }
      d.run = { cmd: t[1].s, ...(port !== undefined ? { port } : {}), env };
      continue;
    }
    if (h === 'setup') { d.setup.push(request(t, 1, i, 'setup').req); continue; }
    if (h === 'run-tests') {
      if (!t[1]?.q) fail(i, 'run-tests needs the "command", like: run-tests "cargo test"');
      d.runTests = t[1].s;
      continue;
    }
    if (h === 'smaller') {
      if (!t[1]?.q) fail(i, 'smaller needs "one line", then files a.ts, b.ts');
      const f = text.match(/"\s+files\s+(.+)$/);
      if (!f) fail(i, 'smaller needs the files it accounts for, like: smaller "Typos" files README.md, docs/a.md');
      d.smaller.push({ line: t[1].s, files: f[1].split(',').map((s) => s.trim()).filter(Boolean), src: i + 1 });
      continue;
    }
    if (h === 'chapters') { d.chapters = quotes(t, 1); continue; }
    if (h === 'chapter') { d.chapter = Number(t[1]?.s) || 0; continue; }
    if (h === 'show') {
      const sh = show(t, i);
      d.shows.push(sh);
      if (sh.kind === 'scenario') { scenario = sh; sIndent = ind; }
      continue;
    }

    // A mark. "x -> y" is an arrow from a box called x, not a mark.
    if (MARKS[text[0]] && text[1] === ' ' && !(text[0] === 'x' && t[1]?.arrow)) {
      const mt = tokens(text.slice(2), i);
      const repo = takeIn(mt);
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
        const id = mt[1].s;
        addNode(i, mt[0].s, id, mt[2]?.q ? mt[2].s : id, '', m.mark === 'new', m.mark, repo);
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
      const rest = t.slice(2), repo = takeIn(rest), qs = quotes(rest, 0);
      addNode(i, h, t[1].s, qs[0] ?? t[1].s, qs[1] ?? '', false, 'base', repo);
      continue;
    }
    fail(i, 'unknown line. Lines start with a kind (code, screen, table…), an arrow, a mark (+ ~ - = ! x), show, smaller, pr, title, by, ask, did, run, setup or chapters');
  }
  const listOnly = (d.chapters[d.chapter - 1] ?? '').startsWith('+');
  if (!d.order.length && !listOnly) fail(0, 'nothing on the map yet. Add a box, like: code api "API"');
  // Number the list: what breaks first, then new things, then what was kept, then what to try. Pins share these numbers.
  const listed = d.marks.filter((m) => m.line);
  if (listed.filter((m) => CAPPED.includes(m.mark)).length > 7) fail(0, 'New, Changed and Kept hold at most 7 items together. Fold small ones into smaller lines, or split the PR into chapters');
  listed.sort((a, b) => RANK[a.mark] - RANK[b.mark] || d.marks.indexOf(a) - d.marks.indexOf(b)).forEach((m, k) => { m.n = k + 1; });
  return d;
}

function show(t: Tok[], i: number): Show {
  const kind = t[1]?.s;
  if (kind === 'screen') {
    const qs = quotes(t, 2);
    return { kind, path: t[2] && !t[2].q ? t[2].s : '/', label: qs[0], hint: qs[1] };
  }
  if (kind === 'call') {
    const { req, next } = request(t, 2, i, 'show call');
    const qs = quotes(t, next);
    return { kind, ...req, label: qs[0], hint: qs[1] };
  }
  if (kind === 'same') {
    if (!t[2]?.q) fail(i, 'show same needs a "label", then screen /path or METHOD /path');
    const rest = t.slice(3), body = rest.find((x) => x.json);
    const sh: Show = { kind, label: t[2].s, what: rest.filter((x) => !x.json).map((x) => x.s).join(' ') };
    if (body) sh.body = json(body, i);
    return sh;
  }
  if (kind === 'pipeline' || kind === 'recipe') {
    if (!t[2] || t[2].q) fail(i, `show ${kind} needs a file`);
    return { kind, file: t[2].s, label: quotes(t, 3)[0] };
  }
  if (kind === 'terminal') {
    if (!t[2]?.q) fail(i, 'show terminal needs the "command", like: show terminal "node cli.js --help"');
    const label = quotes(t, 3)[0];
    return { kind, cmd: t[2].s, ...(label !== undefined ? { label } : {}) };
  }
  if (kind === 'scenario') {
    if (!t[2]?.q) fail(i, 'show scenario needs "what happens when…"');
    return { kind, label: t[2].s };
  }
  return fail(i, 'show needs one of: screen, call, same, pipeline, recipe, terminal, scenario');
}
