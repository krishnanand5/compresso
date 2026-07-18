import { build } from 'esbuild';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const OUT = 'dist';
if (existsSync(OUT)) await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const tsc = spawnSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json'], { stdio: 'inherit', shell: false });
if (tsc.status !== 0) process.exit(tsc.status ?? 1);
console.log('✓ emitted dist/ library modules + declarations');

const sharedDefine = { __COMPRESSO_VERSION__: JSON.stringify(pkg.version) };
const banner = { js: '#!/usr/bin/env node' };

const ENTRIES = [
  { in: 'src/node.ts',           out: 'dist/node.js',           external: [] },
  { in: 'src/copilot-cli.ts',    out: 'dist/copilot-cli.js',    external: ['@github/copilot-sdk'] },
  { in: 'src/dashboard-cli.ts',  out: 'dist/dashboard-cli.js',  external: [] },
  { in: 'src/codex-cli.ts',      out: 'dist/codex-cli.js',     external: [] },
  { in: 'src/opencode-cli.ts',   out: 'dist/opencode-cli.js',  external: [] },
  { in: 'src/opencode-go-cli.ts', out: 'dist/opencode-go-cli.js', external: [] },
];

for (const e of ENTRIES) {
  await build({
    entryPoints: [e.in],
    outfile: e.out,
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'esm',
    sourcemap: true,
    packages: e.external.length > 0 ? 'external' : undefined,
    define: sharedDefine,
    banner,
  });
  console.log(`✓ built ${e.out}`);
}

const smoke = spawnSync(process.execPath, ['dist/node.js', '--version'], { encoding: 'utf8' });
const printedVersion = (smoke.stdout ?? '').trim();
if (smoke.status !== 0 || printedVersion !== pkg.version) {
  console.error(
    `✗ version smoke check failed: 'node dist/node.js --version' printed ` +
      `${JSON.stringify(printedVersion)} (exit ${smoke.status}), expected ${JSON.stringify(pkg.version)}`,
  );
  process.exit(1);
}
console.log(`✓ version smoke check: --version prints ${pkg.version}`);
