// Stores card images on an orphan branch (default `storydiff-cards`) so the comment can link them.
// Linking through github.com (blob/…?raw=true) means a private repo's images load for anyone who
// can see the repo, with no public bucket and no extra secret.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const README = `# storydiff-cards

Card images for Storydiff review comments, written by the Storydiff GitHub Action.
This branch has no history in common with the code. It is safe to delete; the next PR push writes it again.
`;

export function cardPath(pr, sha, chapter) {
  return `pr-${pr}/${String(sha).slice(0, 12)}${chapter ? `-${chapter}` : ''}.png`;
}

export function cardUrl({ server = 'https://github.com', repo, branch, file }) {
  return `${server.replace(/\/$/, '')}/${repo}/blob/${encodeURIComponent(branch)}/${file}?raw=true`;
}

/**
 * Commits `files` ([{ dest, src }]) to `branch` on `remote` and pushes, retrying when another run
 * pushed first.
 */
export function pushCards({ remote, branch, files, token, message, attempts = 3, log = () => {} }) {
  // The token goes in through the environment, never on the command line, so it cannot show up in
  // an error message or a process list.
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  if (token && /^https?:/.test(remote)) {
    Object.assign(env, {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.extraheader',
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
    });
  }
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-cards-'));
    const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env }).toString();
    try {
      git('init', '-q');
      git('config', 'user.name', 'github-actions[bot]');
      git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
      git('config', 'commit.gpgsign', 'false');
      let exists = true;
      try { git('fetch', '-q', '--depth', '1', remote, `refs/heads/${branch}`); } catch { exists = false; }
      if (exists) git('checkout', '-q', '-B', branch, 'FETCH_HEAD');
      else { git('checkout', '-q', '--orphan', branch); fs.writeFileSync(path.join(dir, 'README.md'), README); }
      for (const f of files) {
        const to = path.join(dir, f.dest);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(f.src, to);
      }
      git('add', '-A');
      try { git('commit', '-q', '-m', message); } catch { log('cards: nothing new to commit'); return { pushed: false, unchanged: true }; }
      git('push', '-q', remote, `HEAD:refs/heads/${branch}`);
      return { pushed: true };
    } catch (e) {
      lastError = e;
      log(`cards: push attempt ${i} failed: ${gitError(e)}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  throw new Error(`could not push to ${branch}: ${gitError(lastError)}`);
}

// Only git's own stderr: an execFileSync message would repeat the whole command.
function gitError(e) { return String((e && e.stderr) || 'git failed').trim().split('\n').pop(); }
