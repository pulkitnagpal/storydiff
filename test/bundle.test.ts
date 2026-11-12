import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// The GitHub Action runs the bundle directly (node dist/cli.js …), not through bin/storydiff.js.
const BUNDLE = new URL('../dist/cli.js', import.meta.url).pathname;

test('the bundle run directly dispatches each command to itself, not to capture', { skip: !existsSync(BUNDLE) && 'run npm run build first' }, () => {
  const r = spawnSync(process.execPath, [BUNDLE, 'check', '--help'], { encoding: 'utf8' });
  const out = r.stdout + r.stderr;
  assert.doesNotMatch(out, /Unexpected argument 'check'/);
  assert.doesNotMatch(out, /storydiff capture: run the old and new version/);
});
