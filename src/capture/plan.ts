// Reads the lines of a handover.storydiff that capture acts on. Everything else (the map, the marks,
// said/proof/eng) belongs to the spec parser in src/spec and is skipped here.
//
//   run "node server.js" port 3000 [env K=V ...]   how to start one version (PORT is set for each)
//   setup METHOD /path [{json}]                    a request sent to both versions before any show
//   show screen /path ["label" ["hint"]]
//   show call METHOD /path [{json}] ["label" ["hint"]]
//   show same "label" (screen /path | METHOD /path [{json}])
//   show pipeline <file> ["label"]       show recipe <file> ["label"]
//   show terminal "cmd" ["label"]        runs in each version's checkout, no TTY, 60 s at most
//   show scenario "what happens when…"
//       do   METHOD /path [{json}] "Step" ["note"]
//       then METHOD /path [{json}] "big" "small" [want "big value"]
//   pin screen "<css>" | pin screen page          (under a mark: measured on every screen)
//
// Templates in a step note and in then's big/small: {a.b.0} is a field of the JSON reply,
// {@status} the HTTP status, {@ms} and {@s} how long the request took, {@count} the length of a list.

export type Req = { method: string; path: string; body?: unknown; line: number };
export type Run = { cmd: string; port: number; env: Record<string, string>; line: number };
export type Step = Req & { title: string; note: string };
export type Then = Req & { big: string; small: string; want?: string };

export type ScreenShow = { kind: 'screen'; path: string; label?: string; hint?: string; line: number };
export type CallShow = { kind: 'call'; method: string; path: string; body?: unknown; label?: string; hint?: string; line: number };
export type SameShow = {
  kind: 'same'; label: string; line: number;
  target: { kind: 'screen'; path: string } | { kind: 'call'; method: string; path: string; body?: unknown };
};
export type FileShow = { kind: 'pipeline' | 'recipe'; file: string; label?: string; line: number };
export type TerminalShow = { kind: 'terminal'; cmd: string; label?: string; line: number };
export type ScenarioShow = { kind: 'scenario'; label: string; steps: Step[]; then: Then | null; line: number };
export type ShowPlan = ScreenShow | CallShow | SameShow | FileShow | TerminalShow | ScenarioShow;

export type Plan = { run: Run | null; setup: Req[]; shows: ShowPlan[]; screenPins: string[] };

export class PlanError extends Error {
  line: number;
  constructor(line: number, msg: string) { super(`Line ${line}: ${msg}`); this.name = 'PlanError'; this.line = line; }
}

type Tok = { s: string; q?: boolean; json?: boolean };
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

// Words, "quotes" and {json} / [json]. JSON is read to its matching bracket, so a later quote can hold a }.
function tokens(text: string, line: number): Tok[] {
  const out: Tok[] = [];
  let pos = 0;
  while (pos < text.length) {
    while (text[pos] === ' ') pos++;
    if (pos >= text.length) break;
    const c = text[pos];
    if (c === '"') {
      let k = pos + 1, s = '';
      for (; k < text.length && text[k] !== '"'; k++) s += text[k] === '\\' && text[k + 1] === '"' ? (k++, '"') : text[k];
      if (k >= text.length) throw new PlanError(line, 'an opening " has no closing "');
      out.push({ s, q: true });
      pos = k + 1;
    } else if (c === '{' || c === '[') {
      let depth = 0, inStr = false, k = pos;
      for (; k < text.length; k++) {
        const ch = text[k];
        if (inStr) { if (ch === '\\') k++; else if (ch === '"') inStr = false; continue; }
        if (ch === '"') inStr = true;
        else if (ch === '{' || ch === '[') depth++;
        else if (ch === '}' || ch === ']') { if (--depth === 0) break; }
      }
      if (depth !== 0 || k >= text.length) throw new PlanError(line, `the JSON body has no closing ${c === '{' ? '}' : ']'}`);
      out.push({ s: text.slice(pos, k + 1), json: true });
      pos = k + 1;
    } else {
      let k = pos;
      while (k < text.length && text[k] !== ' ' && text[k] !== '"') k++;
      out.push({ s: text.slice(pos, k) });
      pos = k;
    }
  }
  return out;
}

function strip(raw: string): string {
  let q = false;
  for (let k = 0; k < raw.length; k++) {
    if (raw[k] === '"' && raw[k - 1] !== '\\') q = !q;
    if (raw[k] === '#' && !q) return raw.slice(0, k);
  }
  return raw;
}

function json(t: Tok, line: number): unknown {
  try { return JSON.parse(t.s); } catch (e) { throw new PlanError(line, `the JSON body does not parse (${(e as Error).message})`); }
}

// METHOD /path [{json}] starting at t[i]. Returns the request and the index after it.
function request(t: Tok[], i: number, line: number, what: string): [Req, number] {
  const m = t[i], p = t[i + 1];
  if (!m || m.q || !METHODS.includes(m.s.toUpperCase()) || !p || p.q || !p.s.startsWith('/'))
    throw new PlanError(line, `${what} needs METHOD /path, like: ${what} POST /api/links {"url":"https://example.com"}`);
  const req: Req = { method: m.s.toUpperCase(), path: p.s, line };
  let k = i + 2;
  if (t[k]?.json) { req.body = json(t[k], line); k++; }
  return [req, k];
}

function quotes(t: Tok[], from: number): string[] { return t.slice(from).filter(x => x.q).map(x => x.s); }

export function readPlan(src: string): Plan {
  const plan: Plan = { run: null, setup: [], shows: [], screenPins: [] };
  const lines = src.replace(/\t/g, '  ').split('\n');
  let scenario: ScenarioShow | null = null, scIndent = -1;
  for (let i = 0; i < lines.length; i++) {
    const n = i + 1, raw = strip(lines[i]);
    if (!raw.trim()) continue;
    const ind = raw.match(/^ */)![0].length, text = raw.trim();
    const head = text.split(/\s+/)[0];

    if (scenario && ind > scIndent && (head === 'do' || head === 'then')) {
      const t = tokens(text, n);
      const [req, k] = request(t, 1, n, head);
      const rest = t.slice(k);
      if (head === 'do') {
        const qs = rest.filter(x => x.q).map(x => x.s);
        if (!qs[0]) throw new PlanError(n, 'do needs a "Step" title after the request');
        scenario.steps.push({ ...req, title: qs[0], note: qs[1] ?? '{@status}' });
      } else {
        if (scenario.then) throw new PlanError(n, 'a scenario has one then line');
        const w = rest.findIndex(x => !x.q && x.s === 'want');
        const qs = (w < 0 ? rest : rest.slice(0, w)).filter(x => x.q).map(x => x.s);
        if (qs.length < 2) throw new PlanError(n, 'then needs "big" and "small" after the request, like: then GET /api/charges "{total}" "charged"');
        const th: Then = { ...req, big: qs[0], small: qs[1] };
        if (w >= 0) { if (!rest[w + 1]?.q) throw new PlanError(n, 'want needs a "value"'); th.want = rest[w + 1].s; }
        scenario.then = th;
      }
      continue;
    }
    if (head === 'do' || head === 'then') throw new PlanError(n, `${head} goes indented under a show scenario line`);
    scenario = null; scIndent = -1;

    if (head === 'pin' && ind > 0) {
      const t = tokens(text, n);
      if (t[1]?.s === 'screen' && t[2]) { if (!plan.screenPins.includes(t[2].s)) plan.screenPins.push(t[2].s); }
      continue;
    }
    if (ind > 0) continue; // said, proof, eng and the rest belong to marks

    if (head === 'run') {
      if (plan.run) throw new PlanError(n, 'only one run line');
      const t = tokens(text, n);
      if (!t[1]?.q || !t[1].s.trim()) throw new PlanError(n, 'run needs a "command", like: run "npm start" port 3000');
      if (t[2]?.s !== 'port' || !/^\d+$/.test(t[3]?.s ?? '')) throw new PlanError(n, 'run needs the port the app listens on, like: run "npm start" port 3000');
      const run: Run = { cmd: t[1].s, port: +t[3].s, env: {}, line: n };
      let k = 4;
      if (t[k]) {
        if (t[k].s !== 'env') throw new PlanError(n, 'after the port, run takes only env K=V ...');
        k++;
        if (!t[k]) throw new PlanError(n, 'env needs at least one K=V');
        for (; k < t.length; k++) {
          const tok = t[k];
          let kv = tok.s;
          if (!tok.q && kv.endsWith('=') && t[k + 1]?.q) kv += t[++k].s;  // K="a value with spaces"
          const eq = kv.indexOf('=');
          if (tok.q || tok.json || eq < 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(kv.slice(0, eq))) throw new PlanError(n, `env takes K=V pairs, not ${JSON.stringify(tok.s)}`);
          const key = kv.slice(0, eq);
          if (key === 'PORT') throw new PlanError(n, 'PORT is set by capture, one free port per version; leave it out of env');
          run.env[key] = kv.slice(eq + 1);
        }
      }
      plan.run = run;
      continue;
    }
    if (head === 'setup') {
      const t = tokens(text, n);
      const [req, k] = request(t, 1, n, 'setup');
      if (t[k]) throw new PlanError(n, 'setup takes METHOD /path and an optional {json} body, nothing else');
      plan.setup.push(req);
      continue;
    }
    if (head !== 'show') continue;

    const t = tokens(text, n), kind = t[1]?.s;
    if (kind === 'screen') {
      const path = t[2] && !t[2].q ? t[2].s : '/';
      const qs = quotes(t, 2);
      plan.shows.push({ kind, path, label: qs[0], hint: qs[1], line: n });
    } else if (kind === 'call') {
      const [req, k] = request(t, 2, n, 'show call');
      const qs = quotes(t, k);
      plan.shows.push({ kind, method: req.method, path: req.path, body: req.body, label: qs[0], hint: qs[1], line: n });
    } else if (kind === 'same') {
      if (!t[2]?.q) throw new PlanError(n, 'show same needs a "label" first, like: show same "The list" GET /api/links');
      const label = t[2].s;
      if (t[3]?.s === 'screen') {
        plan.shows.push({ kind, label, target: { kind: 'screen', path: t[4] && !t[4].q ? t[4].s : '/' }, line: n });
      } else {
        const [req] = request(t, 3, n, 'show same "label"');
        plan.shows.push({ kind, label, target: { kind: 'call', method: req.method, path: req.path, body: req.body }, line: n });
      }
    } else if (kind === 'pipeline' || kind === 'recipe') {
      if (!t[2] || t[2].q) throw new PlanError(n, `show ${kind} needs a file, like: show ${kind} ${kind === 'recipe' ? 'Dockerfile' : '.github/workflows/test.yml'}`);
      plan.shows.push({ kind, file: t[2].s, label: quotes(t, 3)[0], line: n });
    } else if (kind === 'terminal') {
      if (!t[2]?.q || !t[2].s.trim()) throw new PlanError(n, 'show terminal needs a "command", like: show terminal "node cli.js --help"');
      plan.shows.push({ kind, cmd: t[2].s, label: quotes(t, 3)[0], line: n });
    } else if (kind === 'scenario') {
      if (!t[2]?.q) throw new PlanError(n, 'show scenario needs "what happens when…"');
      scenario = { kind, label: t[2].s, steps: [], then: null, line: n };
      scIndent = ind;
      plan.shows.push(scenario);
    } else {
      throw new PlanError(n, 'show needs one of: screen, call, same, pipeline, recipe, terminal, scenario');
    }
  }
  return plan;
}

// Which shows need both versions running (everything except reading files and running commands).
export function needsApps(plan: Plan): boolean {
  return plan.setup.length > 0 || plan.shows.some(s => s.kind !== 'pipeline' && s.kind !== 'recipe' && s.kind !== 'terminal');
}
