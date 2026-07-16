// Build library ESM + declarations with tsc, then overwrite the Node CLI
// entry with a bundled executable. The Worker target can still be built by
// wrangler directly from src/worker.ts, but dist/worker.js is also emitted for
// package consumers via tsc.
import { build } from 'esbuild';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Single source of truth for the CLI version: read it here, inline it into the
// bundle via esbuild `define`. Reading npm_package_version at CLI *runtime* is
// unreliable (unset for global bins / npx, or the consumer's version), so the
// value is fixed at build time instead.
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const OUT = 'dist';
if (existsSync(OUT)) await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const tsc = spawnSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json'], {
  stdio: 'inherit',
  shell: false,
});
if (tsc.status !== 0) process.exit(tsc.status ?? 1);
console.log('✓ emitted dist/ library modules + declarations');

await build({
  entryPoints: ['src/node.ts'],
  outfile: 'dist/node.js',
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  sourcemap: true,
  // Inline the package version so `pxpipe --version` is correct for global/npx
  // installs (see the note where `pkg` is read). esbuild replaces the bare
  // identifier with the string literal at every reference.
  define: { __COMPRESSO_VERSION__: JSON.stringify(pkg.version) },
  // Atlas is inlined as a base64 string in src/core/atlas.ts, so no external assets.
  external: [],
  banner: { js: '#!/usr/bin/env node' },
});

console.log('✓ built dist/node.js');

// Pre-build the shared `define` so all bundles get the same version.
const sharedDefine = { __COMPRESSO_VERSION__: JSON.stringify(pkg.version) };

// dist/copilot-cli.js — Copilot session REPL (SDK left as runtime external)
await build({
  entryPoints: ['src/copilot-cli.ts'],
  outfile: 'dist/copilot-cli.js',
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  sourcemap: true,
  packages: 'external',
  define: sharedDefine,
  banner: { js: '#!/usr/bin/env node' },
});
console.log('✓ built dist/copilot-cli.js');

// dist/dashboard-cli.js — terminal dashboard (no SDK dep, fully inlined)
await build({
  entryPoints: ['src/dashboard-cli.ts'],
  outfile: 'dist/dashboard-cli.js',
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  sourcemap: true,
  external: [],
  define: sharedDefine,
  banner: { js: '#!/usr/bin/env node' },
});
console.log('✓ built dist/dashboard-cli.js');

// dist/codex-cli.js — Codex CLI wrapper (fully inlined, no SDK dep)
await build({
  entryPoints: ['src/codex-cli.ts'],
  outfile: 'dist/codex-cli.js',
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  sourcemap: true,
  external: [],
  define: sharedDefine,
  banner: { js: '#!/usr/bin/env node' },
});
console.log('✓ built dist/codex-cli.js');

// Smoke check: the bundled proxy CLI must report the real package version, not a
// stale fallback. Runs the shipped artifact end-to-end and fails the build on
// mismatch, so a broken version injection can never reach a release.
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
