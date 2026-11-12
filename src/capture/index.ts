// storydiff capture: runs the old and the new version side by side and records what each show line
// needs for slot 3 of the card. Writes .storydiff/captures.json (one entry per show, in order) and PNGs.
//
// The old version is the base ref, checked out in a temporary git worktree. The new version is the
// working tree as it is now. Both apps are stopped and the worktree is removed whatever happens.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnApp, type App } from './apps.ts';
import { addWorktree, defaultBase, repoRoot, resolveCommit } from './git.ts';
import { freePort, send, type Reply } from './http.ts';
import { needsApps, readPlan, type Plan, type Req, type ScenarioShow, type ShowPlan } from './plan.ts';
import { sameReply, sameSnapshot, type Diff } from './same.ts';
import { findBrowser, launchBrowser, type Browser, type Rect } from './shot.ts';
import { fill } from './template.ts';

export { readPlan, PlanError } from './plan.ts';
export type { Plan, ShowPlan } from './plan.ts';
export type { Rect } from './shot.ts';

export type CallSide = { status: number; json: unknown; text?: string };
export type ScenarioSide = { steps: string[][]; outcome: { big: string; small: string; tone: 'good' | 'bad' | 'watch' } };
export type ShowCapture =
  | { kind: 'screen'; app: string; before: string | null; after: string | null; rects: Rect[] }
  | { kind: 'call'; before: CallSide; after: CallSide }
  | { kind: 'same'; match: boolean; diff: Diff[] | null }
  | { kind: 'pipeline' | 'recipe'; file: string; before: string | null; after: string | null }
  | { kind: 'scenario'; before: ScenarioSide; after: ScenarioSide };
export type Captures = { base: string; shows: (ShowCapture | null)[]; warnings?: string[] };

export type CaptureOptions = {
  repo?: string;              // any folder inside the repository (default: cwd)
  base?: string;              // the old version (default: merge-base with origin/HEAD, main or master)
  spec?: string;              // default: <repo>/handover.storydiff
  out?: string;               // default: <repo>/.storydiff
  readyMs?: number;           // how long each app gets to answer (default 30 s)
  screen?: { width: number; height: number };   // CSS px; screenshots are taken at 2x
  tmpRoot?: string;           // where the base worktree goes (default: the OS temp dir)
  signals?: boolean;          // clean up and exit on SIGINT/SIGTERM (the CLI turns this on)
  log?: (line: string) => void;
};

const SCREEN = { width: 466, height: 252 };

type Undo = { name: string; run: () => Promise<void> | void; sync: () => void };

export async function capture(opts: CaptureOptions = {}): Promise<Captures> {
  const log = opts.log ?? (() => {});
  const root = repoRoot(resolve(opts.repo ?? process.cwd()));
  const specPath = resolve(root, opts.spec ?? 'handover.storydiff');
  if (!existsSync(specPath)) throw new Error(`no spec at ${relative(process.cwd(), specPath) || specPath}. Write handover.storydiff first.`);
  const plan = readPlan(readFileSync(specPath, 'utf8'));
  const apps = needsApps(plan);
  if (apps && !plan.run) throw new Error('these show lines need both versions running. Add a run line, like: run "npm start" port 3000');
  const baseRef = opts.base ?? defaultBase(root);
  const sha = resolveCommit(root, baseRef);
  const outDir = resolve(root, opts.out ?? '.storydiff');
  const screen = opts.screen ?? SCREEN;
  const warnings: string[] = [];
  const warn = (s: string) => { warnings.push(s); log('warning: ' + s); };

  // A stale captures.json next to a new spec would put the wrong pictures on the card.
  clearOld(outDir);

  const undo: Undo[] = [];
  const cleanupSync = () => { for (const u of undo.splice(0).reverse()) { try { u.sync(); } catch { /* keep going */ } } };
  const onSignal = (sig: NodeJS.Signals) => { log(`${sig}: stopping both apps and removing the base worktree`); cleanupSync(); process.exit(sig === 'SIGINT' ? 130 : 143); };
  if (opts.signals) { process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal); process.on('exit', cleanupSync); }

  try {
    const wt = addWorktree(root, sha, opts.tmpRoot);
    undo.push({ name: 'base worktree', run: wt.remove, sync: wt.remove });
    log(`base ${baseRef} (${sha.slice(0, 7)}) checked out`);

    let before: App | null = null, after: App | null = null;
    if (apps) {
      const run = plan.run!;
      const [p1, p2] = await twoPorts();
      before = spawnApp('before', run, wt.dir, p1);
      undo.push({ name: 'before app', run: before.stop, sync: before.stopSync });
      after = spawnApp('after', run, root, p2);
      undo.push({ name: 'after app', run: after.stop, sync: after.stopSync });
      const readyMs = opts.readyMs ?? 30000;
      await Promise.all([before.ready(readyMs), after.ready(readyMs)]);
      log(`before app on port ${p1}, after app on port ${p2}`);
      for (const app of [before, after]) {
        for (const r of plan.setup) {
          const rep = await call(app, r);
          if (rep.status >= 400) warn(`setup ${r.method} ${r.path} (line ${r.line}) got ${rep.status} from the ${app.name} app`);
        }
      }
    }

    let browser: Browser | null = null, noBrowser = false;
    const getBrowser = async () => {
      if (browser || noBrowser) return browser;
      const bin = findBrowser();
      if (!bin) { noBrowser = true; warn('no Chromium browser found (Chrome, Brave, Edge or Chromium; or set STORYDIFF_CHROME), so screens are not captured'); return null; }
      browser = await launchBrowser(bin);
      const b = browser;
      undo.push({ name: 'browser', run: b.close, sync: b.closeSync });
      return b;
    };

    mkdirSync(outDir, { recursive: true });
    const shows: (ShowCapture | null)[] = [];
    for (let i = 0; i < plan.shows.length; i++) {
      const sh = plan.shows[i];
      log(`show ${i + 1}: ${describe(sh)}`);
      shows.push(await captureShow(sh, i, { plan, root, base: wt.dir, before, after, outDir, screen, getBrowser, warn }));
    }

    const caps: Captures = { base: sha, shows };
    if (warnings.length) caps.warnings = warnings;
    const tmp = join(outDir, 'captures.json.tmp');
    writeFileSync(tmp, JSON.stringify(caps, null, 2) + '\n');
    renameSync(tmp, join(outDir, 'captures.json'));
    return caps;
  } finally {
    if (opts.signals) { process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal); }
    for (const u of undo.splice(0).reverse()) {
      try { await u.run(); } catch (e) { log(`could not clean up the ${u.name}: ${(e as Error).message}`); try { u.sync(); } catch { /* tried */ } }
    }
    if (opts.signals) process.off('exit', cleanupSync);
  }
}

function clearOld(outDir: string) {
  if (!existsSync(outDir)) return;
  for (const f of readdirSync(outDir)) if (f === 'captures.json' || /^(before|after)-\d+\.png$/.test(f)) rmSync(join(outDir, f), { force: true });
}

async function twoPorts(): Promise<[number, number]> {
  const a = await freePort();
  let b = await freePort();
  for (let i = 0; b === a && i < 5; i++) b = await freePort();
  return [a, b];
}

function describe(sh: ShowPlan): string {
  switch (sh.kind) {
    case 'screen': return `screen ${sh.path}`;
    case 'call': return `call ${sh.method} ${sh.path}`;
    case 'same': return `same ${sh.target.kind === 'screen' ? 'screen ' + sh.target.path : sh.target.method + ' ' + sh.target.path}`;
    case 'pipeline': case 'recipe': return `${sh.kind} ${sh.file}`;
    case 'scenario': return `scenario "${sh.label}"`;
  }
}

// A request to an app that has stopped is a failed capture, not a picture of an error.
async function call(app: App, r: Pick<Req, 'method' | 'path' | 'body'>): Promise<Reply> {
  try { return await send(app.origin, r); }
  catch (e) {
    await app.settle(500);
    const out = app.output().trim().split('\n').slice(-10).join('\n');
    throw new Error(`the ${app.name} app ${app.alive() ? 'did not answer' : 'stopped'}: ${(e as Error).message}${out ? `\nLast output of the ${app.name} app:\n${out}` : ''}`);
  }
}
const side = (r: Reply): CallSide => (r.text !== undefined ? { status: r.status, json: r.json, text: r.text } : { status: r.status, json: r.json });

type Ctx = {
  plan: Plan; root: string; base: string; before: App | null; after: App | null; outDir: string;
  screen: { width: number; height: number }; getBrowser: () => Promise<Browser | null>; warn: (s: string) => void;
};

async function captureShow(sh: ShowPlan, i: number, c: Ctx): Promise<ShowCapture | null> {
  const before = c.before!, after = c.after!;
  switch (sh.kind) {
    case 'pipeline': case 'recipe':
      return { kind: sh.kind, file: sh.file, before: readAt(c.base, sh.file, c.warn), after: readAt(c.root, sh.file, c.warn) };

    case 'call': {
      const b = await call(before, sh), a = await call(after, sh);
      return { kind: 'call', before: side(b), after: side(a) };
    }

    case 'same': {
      const t = sh.target;
      if (t.kind === 'call') {
        const b = await call(before, t), a = await call(after, t);
        return { kind: 'same', ...sameReply(b, a) };
      }
      const br = await c.getBrowser();
      if (!br) return null;
      const o = { ...c.screen, snapshot: true };
      const sb = await br.capture(before.origin + t.path, o), sa = await br.capture(after.origin + t.path, o);
      return { kind: 'same', ...sameSnapshot(sb.snapshot!, sa.snapshot!) };
    }

    case 'screen': {
      const br = await c.getBrowser();
      if (!br) return null;
      // A page the old version does not have is a new screen: after alone. And the other way round.
      const exists = async (app: App) => { const r = await call(app, { method: 'GET', path: sh.path }); return r.status !== 404 && r.status !== 410; };
      const shotOf = async (app: App, name: string) => {
        if (!(await exists(app))) return { file: null, rects: [] as Rect[] };
        const file = `${name}-${i}.png`;
        const { rects } = await br.capture(app.origin + sh.path, { ...c.screen, selectors: c.plan.screenPins, out: join(c.outDir, file) });
        return { file, rects };
      };
      const b = await shotOf(before, 'before'), a = await shotOf(after, 'after');
      if (!b.file && !a.file) { c.warn(`show screen ${sh.path} (line ${sh.line}): neither version has this page`); return null; }
      const missing = a.rects.filter(r => !r.found).map(r => r.sel);
      if (a.file && missing.length) c.warn(`show screen ${sh.path} (line ${sh.line}): not found on the new page, so no pin: ${missing.join(', ')}`);
      return { kind: 'screen', app: await appName(c, after, sh.path), before: b.file, after: a.file, rects: a.file ? a.rects : b.rects };
    }

    case 'scenario': {
      if (!sh.steps.length || !sh.then) {
        c.warn(`show scenario "${sh.label}" (line ${sh.line}) needs do lines and a then line under it to be captured`);
        return null;
      }
      return { kind: 'scenario', before: await scenario(before, sh, c.warn), after: await scenario(after, sh, c.warn) };
    }
  }
}

async function scenario(app: App, sh: ScenarioShow, warn: (s: string) => void): Promise<ScenarioSide> {
  const steps: string[][] = [];
  const note = (tpl: string, r: Reply, line: number) => {
    const f = fill(tpl, r);
    if (f.missing.length) warn(`scenario "${sh.label}" line ${line}: the ${app.name} reply has no ${f.missing.join(', ')}`);
    return f.text;
  };
  for (const st of sh.steps) steps.push([st.title, note(st.note, await call(app, st), st.line)]);
  const th = sh.then!, r = await call(app, th);
  const big = note(th.big, r, th.line), small = note(th.small, r, th.line);
  // The tone is a judgement. With want, capture can make it: the outcome is what was wanted or not.
  const tone = th.want === undefined ? 'watch' : big === th.want ? 'good' : 'bad';
  return { steps, outcome: { big, small, tone } };
}

function readAt(dir: string, file: string, warn: (s: string) => void): string | null {
  if (isAbsolute(file) || relative(dir, resolve(dir, file)).startsWith('..')) { warn(`${file} is outside the repository`); return null; }
  const p = resolve(dir, file);
  try { return statSync(p).isFile() ? readFileSync(p, 'utf8') : null; } catch { return null; }
}

// The name on the window bar: the page title, else package.json's name, else the folder.
async function appName(c: Ctx, app: App, path: string): Promise<string> {
  try {
    const r = await send(app.origin, { method: 'GET', path });
    const m = (r.text ?? '').match(/<title[^>]*>([^<]{1,60})<\/title>/i);
    if (m && m[1].trim()) return m[1].trim();
  } catch { /* fall back */ }
  try { const n = JSON.parse(readFileSync(join(c.root, 'package.json'), 'utf8')).name; if (n) return String(n); } catch { /* none */ }
  return basename(c.root);
}
