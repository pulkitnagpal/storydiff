// storydiff check: does every line of the agent's handover hold up against the code, the tests and the session?
// usage: node verify.js <repo> <base-ref> <session-id>   (reads <repo>/handover.storydiff, prints JSON)
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync, spawnSync } = require('child_process');
const SD = require('./core.js');
const [repo, base, sid] = process.argv.slice(2);
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
const src = fs.readFileSync(path.join(repo, 'handover.storydiff'), 'utf8');

// Changed lines in the new code, per file.
const changed = {};
let file = null;
for (const ln of git('diff', '-U0', base).split('\n')) {
  const f = ln.match(/^\+\+\+ b\/(.*)/); if (f) { file = f[1]; changed[file] = changed[file] || []; continue; }
  const h = ln.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
  if (h && file) { const a = +h[1], n = h[2] === undefined ? 1 : +h[2]; for (let k = a; k < a + n; k++) changed[file].push(k); }
}

// Test results on the new code (names that passed / failed).
function runTests(cwd) {
  const r = spawnSync('node', ['--test', '--test-reporter=tap'], { cwd, encoding: 'utf8' });
  const pass = new Set(), fail = new Set();
  for (const ln of (r.stdout || '').split('\n')) {
    const m = ln.match(/^\s*(not ok|ok) \d+ - (.*?)(\s+#.*)?$/); if (m) (m[1] === 'ok' ? pass : fail).add(m[2].trim());
  }
  return { pass, fail };
}
const head = runTests(repo);
// The same tests on the old code, to tell new tests from old ones.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdbase-'));
execFileSync('sh', ['-c', `git -C "${repo}" archive ${base} | tar -x -C "${tmp}"`]);
const before = runTests(tmp);

// The human's own messages in the session log, with their time from the session start.
function sessionFile(id) {
  const root = path.join(os.homedir(), '.claude', 'projects');
  for (const d of fs.readdirSync(root)) { const p = path.join(root, d, id + '.jsonl'); if (fs.existsSync(p)) return p; }
  return null;
}
const human = []; let t0 = null;
const sf = sid && (fs.existsSync(sid) ? sid : sessionFile(sid));
if (sf) for (const line of fs.readFileSync(sf, 'utf8').split('\n')) {
  if (!line.trim()) continue; let d; try { d = JSON.parse(line); } catch { continue; }
  if (d.timestamp && !t0) t0 = Date.parse(d.timestamp);
  const m = d.message; if (!m || m.role !== 'user') continue;
  let c = typeof m.content === 'string' ? m.content : (Array.isArray(m.content) ? m.content.filter(b => b.type === 'text').map(b => b.text).join(' ') : '');
  // Follow-ups typed while the agent works arrive as meta messages with a short prefix; other meta messages are not the human.
  if (d.isMeta) { const f = c.match(/^The (?:coordinator|user) sent a message while you were working:\n([\s\S]*)/); if (!f) continue; c = f[1]; }
  c = c.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
  if (!c || /tool_result/.test(JSON.stringify(m.content).slice(0, 40))) continue;
  human.push({ text: c, at: Date.parse(d.timestamp) - t0 });
}
const norm = s => s.toLowerCase().replace(/[“”"'’]/g, '').replace(/\s+/g, ' ').trim();
const mmss = ms => { const s = Math.round(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };

const doc = SD.parse(src), checks = [];
doc.steps.forEach((st, si) => st.marks.forEach((m, mi) => {
  m.proofs.forEach(p => {
    let ok = null, why = 'not a kind of proof the checker knows yet';
    const fl = p.match(/^([\w./-]+):(\d+)/);
    const tn = p.match(/^test\s+(.+?)(:.*)?$/);
    if (fl) {
      const f = fl[1], n = +fl[2], full = path.join(repo, f);
      const hit = Object.keys(changed).find(k => k === f || k.endsWith('/' + f));
      if (!fs.existsSync(full) && !hit) { ok = false; why = f + ' does not exist'; }
      else {
        const lines = fs.readFileSync(hit ? path.join(repo, hit) : full, 'utf8').split('\n').length;
        if (n > lines) { ok = false; why = f + ' has only ' + lines + ' lines'; }
        else if (hit && changed[hit].some(k => Math.abs(k - n) <= 3)) { ok = true; why = 'line changed in this PR'; }
        else { ok = true; why = 'line exists, not changed in this PR'; }
      }
    } else if (tn) {
      const name = tn[1].trim();
      if (head.pass.has(name)) { ok = true; why = before.pass.has(name) ? 'passes (old test)' : 'passes (new test)'; }
      else if (head.fail.has(name)) { ok = false; why = 'test fails'; }
      else { ok = false; why = 'no test with this name ran'; }
    }
    checks.push({ step: si + 1, mark: mi, kind: 'proof', ref: p, ok, why });
  });
  m.quotes.forEach(q => {
    const hit = human.find(h => norm(h.text).includes(norm(q.text)));
    checks.push({ step: si + 1, mark: mi, kind: 'said', ref: q.text, ok: !!hit, why: hit ? 'the human typed this' : 'not found in the human\'s messages', at: hit ? '@' + mmss(hit.at) : '' });
  });
}));
const sum = { total: checks.length, ok: checks.filter(c => c.ok === true).length, bad: checks.filter(c => c.ok === false).length, unknown: checks.filter(c => c.ok === null).length };
console.log(JSON.stringify({ sum, checks, tests: { head: [...head.pass].length, failed: [...head.fail], before: [...before.pass].length, added: [...head.pass].filter(n => !before.pass.has(n)).length, regressed: [...before.pass].filter(n => !head.pass.has(n)) }, session: sf ? path.basename(sf) : null, humanMessages: human.length, spec: src, diffstat: git('diff', '--shortstat', base).trim() }, null, 1));
