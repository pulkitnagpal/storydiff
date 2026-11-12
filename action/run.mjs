// The Storydiff GitHub Action, after checkout: find the spec, re-check it, render the card, store the
// image, update the one sticky comment and set the `storydiff` status. Only GITHUB_TOKEN is used.
//
// Settings come from the environment (action.yml maps the inputs): SD_TEST_CMD, SD_CAPTURE,
// SD_SPEC_FILE, SD_CARDS_BRANCH, SD_STATUS_CONTEXT, SD_STRICT_QUOTES, SD_FAIL_JOB, SD_CLI.
// SD_CARDS_REMOTE overrides the git remote for the cards branch, and SD_BUILT_CLI the path of the built CLI (both for the tests).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSpecs, chapterOf, hasShows } from './lib/spec-source.mjs';
import { mergeAuthorQuotes, verdict } from './lib/report.mjs';
import { buildComment, findSticky } from './lib/comment.mjs';
import { cardPath, cardUrl, pushCards } from './lib/cards.mjs';
import { client } from './lib/github.mjs';

const env = process.env;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = env.GITHUB_WORKSPACE || process.cwd();
const OUT = path.join(ROOT, '.storydiff');
const BUILT = env.SD_BUILT_CLI || path.join(HERE, '..', 'dist', 'cli.js');

const log = (s) => console.log(s);
const warn = (s) => console.log(`::warning title=Storydiff::${oneLine(s)}`);
const group = (s) => console.log(`::group::${s}`);
const endGroup = () => console.log('::endgroup::');
const oneLine = (s) => String(s).replace(/\r?\n/g, ' ');
const yes = (v) => String(v || '').toLowerCase() === 'true';

// The CLI runs the PR's tests, which are code from the PR. It gets no token.
function childEnv() {
  const e = { ...env };
  for (const k of Object.keys(e)) if (k === 'GITHUB_TOKEN' || k === 'GH_TOKEN' || /^INPUT_/.test(k) || k === 'ACTIONS_RUNTIME_TOKEN' || k === 'ACTIONS_ID_TOKEN_REQUEST_TOKEN') delete e[k];
  return e;
}

function cliCommand(args) {
  if (env.SD_CLI) return ['bash', ['-c', `${env.SD_CLI} "$@"`, 'storydiff', ...args]];
  // action.yml builds the CLI from this action's own source before this script runs.
  return ['node', [BUILT, ...args]];
}

function storydiff(args) {
  const [cmd, argv] = cliCommand(args);
  log(`$ storydiff ${args.join(' ')}`);
  const r = spawnSync(cmd, argv, { cwd: ROOT, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stdout.write(r.stderr);
  if (r.error) return { code: 127, out: '', err: r.error.message };
  return { code: r.status ?? 1, out: r.stdout || '', err: r.stderr || '' };
}

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }

function setOutput(name, value) {
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `${name}=${oneLine(value)}\n`);
}

async function main() {
  const event = readJson(env.GITHUB_EVENT_PATH) || {};
  const pr = event.pull_request;
  if (!env.SD_CLI && !fs.existsSync(BUILT)) {
    log(`::error title=Storydiff::The storydiff CLI was not built (${BUILT} is missing). The "Build the storydiff CLI" step should have made it.`);
    return 1;
  }
  if (!pr) { log('Storydiff runs on pull_request events; nothing to do here.'); return 0; }

  const repo = env.GITHUB_REPOSITORY;
  const server = env.GITHUB_SERVER_URL || 'https://github.com';
  const head = pr.head.sha, base = pr.base.sha, number = pr.number;
  const gh = client({ token: env.GITHUB_TOKEN });
  const runUrl = env.GITHUB_RUN_ID ? `${server}/${repo}/actions/runs/${env.GITHUB_RUN_ID}` : '';
  const context = env.SD_STATUS_CONTEXT || 'storydiff';
  const branch = env.SD_CARDS_BRANCH || 'storydiff-cards';

  async function setStatus(state, description, target) {
    try {
      await gh.post(`/repos/${repo}/statuses/${head}`, { state, description: description.slice(0, 140), context, target_url: target || runUrl || undefined });
    } catch (e) {
      warn(`could not set the ${context} status (${e.message}). The workflow needs "statuses: write"; fork PRs get a read-only token.`);
    }
  }

  // 1. The spec: from the PR description first (what `storydiff publish` wrote), else the file.
  let body = pr.body || '';
  try { body = (await gh.get(`/repos/${repo}/pulls/${number}`)).body || ''; } catch (e) { warn(`could not re-read the PR description (${e.message}); using the event's copy.`); }
  let specs = extractSpecs(body), source = 'the PR description';
  const specFile = path.join(ROOT, env.SD_SPEC_FILE || 'handover.storydiff');
  if (!specs.length && fs.existsSync(specFile)) { specs = [{ spec: fs.readFileSync(specFile, 'utf8'), report: null }]; source = env.SD_SPEC_FILE || 'handover.storydiff'; }
  if (!specs.length) {
    log('No storydiff block in the PR description and no handover file: nothing to check.');
    await setStatus('success', 'No Storydiff handover in this PR');
    setOutput('state', 'success');
    return 0;
  }
  log(`Found ${specs.length} spec${specs.length === 1 ? '' : 's'} in ${source}.`);

  // 2. Per chapter: capture, check, merge the author's quote results, render.
  fs.mkdirSync(path.join(OUT, 'out'), { recursive: true });
  const handover = path.join(ROOT, 'handover.storydiff');
  const original = fs.existsSync(handover) ? fs.readFileSync(handover) : null;
  const chapters = [];
  let broken = null;
  try {
    for (let i = 0; i < specs.length; i++) {
      const { spec, report: author } = specs[i];
      const n = chapterOf(spec) ?? (specs.length > 1 ? i + 1 : null);
      group(`Chapter ${n ?? 1}`);
      fs.writeFileSync(handover, spec);
      for (const f of ['report.json', 'captures.json']) fs.rmSync(path.join(OUT, f), { force: true });

      const capture = (env.SD_CAPTURE || 'auto').toLowerCase();
      if (capture === 'true' || (capture === 'auto' && hasShows(spec))) {
        const c = storydiff(['capture', '--base', base]);
        if (c.code !== 0) warn(`capture failed for chapter ${n ?? 1}; the card is drawn without its before/after pictures.`);
      }

      const args = ['check', '--base', base];
      if (env.SD_TEST_CMD) args.push('--test-cmd', env.SD_TEST_CMD);
      storydiff(args); // exits 1 when a claim fails; the report says which
      const ci = readJson(path.join(OUT, 'report.json'));
      if (!ci) { broken = `storydiff check did not write .storydiff/report.json (chapter ${n ?? 1})`; endGroup(); break; }
      if (!author) log("This spec has no check result from the author's machine, so its quotes stay unchecked.");
      const report = mergeAuthorQuotes(ci, author, { strictQuotes: yes(env.SD_STRICT_QUOTES) });
      fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
      for (const c of report.checks.filter(c => c.ok !== true)) log(`  ✗ ${c.kind} ${c.ref}: ${c.why || 'does not hold up'}`);

      const file = cardPath(number, head, n);
      const url = cardUrl({ server, repo, branch, file });
      const png = path.join(OUT, 'out', `card-${i}.png`), md = path.join(OUT, 'out', `card-${i}.md`);
      const r = storydiff(['render', '--png', png, '--md', md, '--image-url', url]);
      if (!fs.existsSync(md)) { broken = `storydiff render did not write the Markdown card (chapter ${n ?? 1}, exit ${r.code})`; endGroup(); break; }
      chapters.push({ n, report, png: fs.existsSync(png) ? png : null, md, file, url, spec });
      endGroup();
    }
  } finally {
    if (original) fs.writeFileSync(handover, original); else fs.rmSync(handover, { force: true });
  }

  if (broken) {
    log(`::error title=Storydiff::${broken}`);
    await setStatus('error', 'Storydiff could not check this PR. See the run log.');
    setOutput('state', 'error');
    return 1;
  }

  // 3. Store the images. If that fails, render the Markdown again without an image link.
  const notes = [];
  const withPng = chapters.filter(c => c.png);
  let stored = false;
  if (withPng.length) {
    try {
      const remote = env.SD_CARDS_REMOTE || `${server}/${repo}.git`;
      pushCards({ remote, branch, token: env.GITHUB_TOKEN, files: withPng.map(c => ({ src: c.png, dest: c.file })), message: `Card for #${number} at ${head.slice(0, 7)}`, log });
      stored = true;
    } catch (e) {
      warn(`could not store the card image on ${branch} (${e.message}). The workflow needs "contents: write".`);
    }
  } else {
    notes.push('The card image could not be rendered here (no Chromium on the runner?).');
  }
  const imageless = chapters.filter(c => !stored || !c.png);
  if (imageless.length) {
    for (const c of imageless) {
      fs.writeFileSync(handover, c.spec);
      fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(c.report, null, 2));
      storydiff(['render', '--md', c.md]);
      c.url = null;
    }
    if (original) fs.writeFileSync(handover, original); else fs.rmSync(handover, { force: true });
  }

  // 4. The sticky comment and the status.
  const reports = chapters.map(c => c.report);
  const v = verdict(reports);
  const comment = buildComment({
    cards: chapters.map(c => ({ md: fs.readFileSync(c.md, 'utf8') })),
    head,
    quotesCheckedAt: reports.map(r => r.quotesCheckedAt).find(Boolean) || null,
    quotesUnchecked: reports.reduce((k, r) => k + (r.quotesUnchecked || 0), 0),
    runUrl,
    notes,
  });
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, comment + '\n');

  let commentUrl = '';
  try {
    const existing = findSticky(await gh.all(`/repos/${repo}/issues/${number}/comments`));
    let posted = null;
    if (existing) {
      try { posted = await gh.patch(`/repos/${repo}/issues/comments/${existing.id}`, { body: comment }); }
      catch (e) { warn(`could not update comment ${existing.id} (${e.message}); posting a new one.`); }
    }
    if (!posted) posted = await gh.post(`/repos/${repo}/issues/${number}/comments`, { body: comment });
    commentUrl = posted && posted.html_url || '';
  } catch (e) {
    warn(`could not post the card comment (${e.message}). The workflow needs "pull-requests: write"; fork PRs get a read-only token. The card is in this run's summary.`);
  }

  await setStatus(v.state, v.description, commentUrl);
  setOutput('state', v.state);
  setOutput('comment-url', commentUrl);
  setOutput('card-url', chapters.find(c => c.url)?.url || '');
  log(`${v.state === 'success' ? '✓' : '✗'} ${v.description}`);
  return v.state === 'failure' && yes(env.SD_FAIL_JOB) ? 1 : 0;
}

main().then(code => process.exit(code), e => {
  console.log(`::error title=Storydiff::${oneLine(e && e.stack || e)}`);
  process.exit(1);
});
