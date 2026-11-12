// npm build: one bundled file for the CLI, one for the library, plus type declarations. No runtime dependencies.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });
const common = { bundle: true, platform: 'node', format: 'esm', target: 'node22', legalComments: 'none', define: { __STORYDIFF_VERSION__: JSON.stringify(pkg.version) } } as const;
await build({ ...common, entryPoints: ['src/cli/index.ts'], outfile: 'dist/cli.js' });
await build({ ...common, entryPoints: ['src/index.ts'], outfile: 'dist/index.js' });
execFileSync('npx', ['tsc', '-p', 'tsconfig.build.json'], { stdio: 'inherit' });
// Declarations keep the source's .ts import paths; consumers resolve .js.
for (const f of readdirSync('dist/types', { recursive: true }) as string[]) {
  if (!f.endsWith('.d.ts')) continue;
  const p = join('dist/types', f);
  writeFileSync(p, readFileSync(p, 'utf8').replace(/(from\s+['"]\.{1,2}\/[^'"]+)\.ts(['"])/g, '$1.js$2'));
}
console.log('built dist/cli.js, dist/index.js and dist/types');
