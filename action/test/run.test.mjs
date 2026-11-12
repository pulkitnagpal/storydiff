// End to end: action/run.mjs against a fake GitHub API, a local bare repo for the cards branch and
// the stub CLI. Nothing here talks to the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { START, END } from '../lib/spec-source.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, '..', 'run.mjs');
const STUB = path.join(HERE, 'fixtures', 'stub-cli.mjs');
const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

const SPEC = `title "Tags for links"
ask   "Add tags to links."
did   "Tags get their own table."
table links "Links"
+ table tags "Tags" "Tags live in their own table."
    said @03:11 "in their own table, not a comma string"
    proof db.js:12
! "Open the page once. Nobody has yet."
    proof server.js:52
`;
const authorReport = (head) => ({ oldPass: 3, newTests: 2, regressed: [], claims: 3, failed: 0, head, checks: [
  { ref: 'in their own table, not a comma string', kind: 'said', ok: true, why: 'matches', at: '03:11' },
  { ref: 'db.js:12', kind: 'proof', ok: true }, { ref: 'server.js:52', kind: 'proof', ok: true },
] });
const published = (spec, report) => `What this PR does.\n\n${START}\n\`\`\`storydiff\n${spec}\`\`\`\n${report ? `<!-- storydiff-report ${JSON.stringify(report)} -->\n` : ''}${END}\n`;

// A fake GitHub: one PR, its comments, the statuses.
function fakeGitHub() {
  const state = { body: '', comments: [], statuses: [], requests: [], nextId: 100, denyComments: false };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', d => (raw += d));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      const url = new URL(req.url, 'http://x');
      state.requests.push({ method: req.method, path: url.pathname, auth: req.headers.authorization });
      const send = (code, data) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
      let m;
      if (req.method === 'GET' && /^\/repos\/o\/r\/pulls\/7$/.test(url.pathname)) return send(200, { number: 7, body: state.body });
      if (req.method === 'GET' && /^\/repos\/o\/r\/issues\/7\/comments$/.test(url.pathname)) return send(200, state.comments);
      if (req.method === 'POST' && /^\/repos\/o\/r\/issues\/7\/comments$/.test(url.pathname)) {
        if (state.denyComments) return send(403, { message: 'Resource not accessible by integration' });
        const c = { id: state.nextId++, body: body.body, user: { login: 'github-actions[bot]', type: 'Bot' }, html_url: `https://github.com/o/r/pull/7#issuecomment-${state.nextId}` };
        state.comments.push(c); return send(201, c);
      }
      if (req.method === 'PATCH' && (m = url.pathname.match(/^\/repos\/o\/r\/issues\/comments\/(\d+)$/))) {
        const c = state.comments.find(x => x.id === +m[1]); if (!c) return send(404, { message: 'Not Found' });
        c.body = body.body; return send(200, c);
      }
      if (req.method === 'POST' && (m = url.pathname.match(/^\/repos\/o\/r\/statuses\/(\w+)$/))) { state.statuses.push({ sha: m[1], ...body }); return send(201, {}); }
      send(404, { message: 'Not Found' });
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ state, api: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-action-'));
  const ws = path.join(dir, 'ws'), cards = path.join(dir, 'cards.git');
  fs.mkdirSync(ws);
  git(ws, 'init', '-q', '-b', 'main');
  git(ws, 'config', 'user.email', 't@example.com'); git(ws, 'config', 'user.name', 't'); git(ws, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(ws, 'db.js'), 'a\n'); git(ws, 'add', '.'); git(ws, 'commit', '-q', '-m', 'base');
  const base = git(ws, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(ws, 'db.js'), 'a\nb\n'); git(ws, 'commit', '-q', '-am', 'head');
  const head = git(ws, 'rev-parse', 'HEAD');
  git(dir, 'init', '-q', '--bare', cards);
  return { dir, ws, cards, base, head, log: path.join(dir, 'stub.log') };
}

function run(w, gh, extra = {}) {
  const event = path.join(w.dir, 'event.json');
  fs.writeFileSync(event, JSON.stringify({ pull_request: { number: 7, body: 'stale copy', head: { sha: w.head }, base: { sha: w.base } } }));
  const out = path.join(w.dir, 'out.txt'), summary = path.join(w.dir, 'summary.md');
  fs.writeFileSync(out, '');
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME,
    GITHUB_EVENT_PATH: event, GITHUB_REPOSITORY: 'o/r', GITHUB_WORKSPACE: w.ws, GITHUB_API_URL: gh.api,
    GITHUB_SERVER_URL: 'https://github.com', GITHUB_RUN_ID: '42', GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary,
    GITHUB_TOKEN: 'ghs_fake_token_for_tests', SD_CLI: `node ${STUB}`, SD_CARDS_REMOTE: w.cards, STUB_LOG: w.log,
    ...extra,
  };
  return new Promise(resolve => execFile('node', [RUN], { cwd: w.ws, env }, (err, stdout, stderr) => {
    const outputs = Object.fromEntries(fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    resolve({ code: err ? err.code : 0, log: stdout + stderr, outputs, summary: fs.existsSync(summary) ? fs.readFileSync(summary, 'utf8') : '' });
  }));
}

test('a published spec: card stored, one comment, green status; a fake line later turns it red in place', async (t) => {
  const gh = await fakeGitHub(); t.after(gh.close);
  const w = workspace();
  gh.state.body = published(SPEC, authorReport(w.head));

  const r1 = await run(w, gh);
  assert.equal(r1.code, 0, r1.log);
  assert.equal(gh.state.comments.length, 1);
  const c = gh.state.comments[0].body;
  assert.ok(c.startsWith('<!-- storydiff:card -->'));
  assert.match(c, new RegExp(`!\\[The Storydiff card\\]\\(https://github.com/o/r/blob/storydiff-cards/pr-7/${w.head.slice(0, 12)}\\.png\\?raw=true\\)`));
  assert.match(c, /Quotes checked on the author's machine at/);
  assert.equal(gh.state.statuses.at(-1).state, 'success');
  assert.equal(gh.state.statuses.at(-1).context, 'storydiff');
  assert.equal(gh.state.statuses.at(-1).sha, w.head);
  assert.match(gh.state.statuses.at(-1).description, /✓ 3 claims checked/);
  assert.equal(r1.outputs.state, 'success');
  assert.match(r1.summary, /storydiff:card/);

  // The image is on an orphan branch: one root commit, holding only cards.
  const files = git(w.cards, 'ls-tree', '-r', '--name-only', 'storydiff-cards').split('\n');
  assert.deepEqual(files.sort(), ['README.md', `pr-7/${w.head.slice(0, 12)}.png`]);
  assert.equal(git(w.cards, 'rev-list', '--max-parents=0', 'storydiff-cards').split('\n').length, 1);
  assert.equal(git(w.cards, 'rev-list', '--count', 'storydiff-cards'), '1');

  // The CLI never saw the token, and was asked for exactly these commands.
  const calls = fs.readFileSync(w.log, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.ok(calls.every(x => !x.tokenSeen));
  assert.deepEqual(calls.map(x => x.cmd), ['check', 'render']);
  assert.deepEqual(calls[0].rest, ['--base', w.base]);
  // The workspace is left as it was.
  assert.equal(fs.existsSync(path.join(w.ws, 'handover.storydiff')), false);

  gh.state.body = published(SPEC.replace('db.js:12', 'db.js:999'), authorReport(w.head));
  const r2 = await run(w, gh);
  assert.equal(r2.code, 0, r2.log);
  assert.equal(gh.state.comments.length, 1, 'the sticky comment is updated, not duplicated');
  assert.match(gh.state.comments[0].body, /1 of 3 claims don't hold up/);
  assert.equal(gh.state.statuses.at(-1).state, 'failure');
  assert.match(gh.state.statuses.at(-1).description, /✗ 1 of 3 claims don't hold up/);
  assert.match(r2.log, /✗ proof db\.js:999/);

  const r3 = await run(w, gh, { SD_FAIL_JOB: 'true' });
  assert.equal(r3.code, 1, 'fail-job turns a failing claim into a failed job');
});

test('no PR block: the handover file is used, and unchecked quotes are said, not failed', async (t) => {
  const gh = await fakeGitHub(); t.after(gh.close);
  const w = workspace();
  fs.writeFileSync(path.join(w.ws, 'handover.storydiff'), SPEC);
  const r = await run(w, gh);
  assert.equal(r.code, 0, r.log);
  assert.equal(gh.state.statuses.at(-1).state, 'success');
  assert.match(gh.state.statuses.at(-1).description, /1 quote not checked/);
  assert.match(gh.state.comments[0].body, /1 quote was never checked there/);
  assert.equal(fs.readFileSync(path.join(w.ws, 'handover.storydiff'), 'utf8'), SPEC, 'the committed file is restored');
});

test('no spec anywhere: a green "nothing to check" status and no comment', async (t) => {
  const gh = await fakeGitHub(); t.after(gh.close);
  const w = workspace();
  const r = await run(w, gh);
  assert.equal(r.code, 0, r.log);
  assert.equal(gh.state.comments.length, 0);
  assert.equal(gh.state.statuses.at(-1).state, 'success');
  assert.match(gh.state.statuses.at(-1).description, /No Storydiff handover/);
});

test('chapters: one card per block, one comment, one status for all', async (t) => {
  const gh = await fakeGitHub(); t.after(gh.close);
  const w = workspace();
  const ch = (n, t) => `chapters "One", "Two"\nchapter ${n}\n` + SPEC.replace('Tags for links', t);
  gh.state.body = `${START}\n\`\`\`storydiff\n${ch(1, 'First')}\`\`\`\n\n\`\`\`storydiff\n${ch(2, 'Second')}\`\`\`\n${END}`;
  const r = await run(w, gh);
  assert.equal(r.code, 0, r.log);
  const body = gh.state.comments[0].body;
  assert.match(body, /Storydiff · First[\s\S]*---[\s\S]*Storydiff · Second/);
  assert.match(body, /-1\.png\?raw=true[\s\S]*-2\.png\?raw=true/);
  assert.equal(gh.state.statuses.length, 1);
  assert.match(gh.state.statuses[0].description, /✓ 6 claims checked/);
});

test('show lines are captured first; a failed capture is a warning, not a failure', async (t) => {
  const gh = await fakeGitHub(); t.after(gh.close);
  const w = workspace();
  gh.state.body = published('show screen / "What people see"\n' + SPEC, authorReport(w.head));
  const r = await run(w, gh, { STUB_CAPTURE_EXIT: '3' });
  assert.equal(r.code, 0, r.log);
  const calls = fs.readFileSync(w.log, 'utf8').trim().split('\n').map(l => JSON.parse(l).cmd);
  assert.deepEqual(calls, ['capture', 'check', 'render']);
  assert.match(r.log, /::warning title=Storydiff::capture failed/);
  assert.equal(gh.state.statuses.at(-1).state, 'success');
});

test('when the cards branch cannot be pushed, the comment goes out without a broken image', async (t) => {
  const gh = await fakeGitHub(); t.after(gh.close);
  const w = workspace();
  gh.state.body = published(SPEC, authorReport(w.head));
  const r = await run(w, gh, { SD_CARDS_REMOTE: path.join(w.dir, 'missing.git') });
  assert.equal(r.code, 0, r.log);
  assert.match(r.log, /could not store the card image/);
  assert.doesNotMatch(gh.state.comments[0].body, /!\[The Storydiff card\]/);
  assert.doesNotMatch(r.log, /ghs_fake_token_for_tests/);
});

test('a read-only token (fork PR): warnings, the card in the run summary, no crash', async (t) => {
  const gh = await fakeGitHub(); t.after(gh.close);
  gh.state.denyComments = true;
  const w = workspace();
  gh.state.body = published(SPEC, authorReport(w.head));
  const r = await run(w, gh);
  assert.equal(r.code, 0, r.log);
  assert.match(r.log, /could not post the card comment/);
  assert.match(r.summary, /Storydiff · Tags for links/);
});

test('if check writes no report, the status is "error" and the job fails', async (t) => {
  const gh = await fakeGitHub(); t.after(gh.close);
  const w = workspace();
  gh.state.body = published(SPEC, null);
  const r = await run(w, gh, { STUB_NO_REPORT: '1' });
  assert.equal(r.code, 1);
  assert.equal(gh.state.statuses.at(-1).state, 'error');
  assert.equal(gh.state.comments.length, 0);
});
