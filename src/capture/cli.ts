// storydiff capture [--base REF] [--spec FILE] [--out DIR] [--timeout SECONDS]
// core's src/cli dispatches `storydiff capture ...` here: `await main(argv)`.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { capture } from './index.ts';

const HELP = `storydiff capture: run the old and new version side by side and capture each show line

  --base REF       the old version (default: merge-base with origin/HEAD, main or master)
  --spec FILE      the handover (default: handover.storydiff at the repo root)
  --out DIR        where captures.json and the PNGs go (default: .storydiff)
  --timeout SEC    how long each app gets to answer (default: 30)
`;

export async function main(argv: string[]): Promise<number> {
  let a;
  try {
    a = parseArgs({ args: argv, options: {
      base: { type: 'string' }, spec: { type: 'string' }, out: { type: 'string' },
      timeout: { type: 'string' }, help: { type: 'boolean', short: 'h' },
    } }).values;
  } catch (e) { process.stderr.write(`${(e as Error).message}\n\n${HELP}`); return 2; }
  if (a.help) { process.stdout.write(HELP); return 0; }
  const timeout = a.timeout === undefined ? 30 : Number(a.timeout);
  if (!(timeout > 0)) { process.stderr.write('--timeout takes a number of seconds\n'); return 2; }
  try {
    const caps = await capture({
      base: a.base, spec: a.spec, out: a.out, readyMs: timeout * 1000, signals: true,
      log: s => process.stderr.write('storydiff capture: ' + s + '\n'),
    });
    const n = caps.shows.filter(Boolean).length;
    const where = a.out ?? '.storydiff';
    process.stdout.write(`captured ${n} of ${caps.shows.length} show${caps.shows.length === 1 ? '' : 's'} into ${where}/captures.json` +
      (caps.warnings?.length ? ` (${caps.warnings.length} warning${caps.warnings.length === 1 ? '' : 's'})` : '') + '\n');
    return 0;
  } catch (e) {
    process.stderr.write(`storydiff capture failed: ${(e as Error).message}\n`);
    return 1;
  }
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(self)) {
  main(process.argv.slice(2)).then(code => process.exit(code));
}
