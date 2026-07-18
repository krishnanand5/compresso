#!/usr/bin/env node
import { resolveSubcommand } from '../dist/cli/dispatch.js';

const sub = process.argv[2];
const entry = resolveSubcommand(sub ?? 'proxy');

if (!entry) {
  console.error(`[compresso] unknown subcommand: ${sub}`);
  console.error(`[compresso] known: proxy, codex, opencode, opencode-go, copilot, dashboard, export`);
  process.exit(2);
}

process.argv.splice(2, 1);
import(`../${entry.entry}`).catch((err) => {
  console.error(`[compresso] failed to start ${sub ?? 'proxy'}:`, err.message ?? err);
  console.error('[compresso] did you forget to `npm run build`?');
  process.exit(1);
});
