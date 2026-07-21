// src/agents/codex/cli.ts

import { parseCommonFlags } from '../../cli/argv.js';
import { startProxyIfNeeded, waitForProxyReady } from '../shared/proxy-lifecycle.js';
import { codexAgent } from './index.js';
import { spawnCodex } from './child.js';
import type { AgentArgv } from '../types.js';

async function main(): Promise<void> {
  const argv = parseCommonFlags();

  if (argv.help) {
    console.log(codexAgent.helpText);
    process.exit(0);
  }

  if (argv.setup) {
    // Write config then exit
    await codexAgent.writeConfig?.({ port: argv.port, apiKey: argv.apiKey, model: argv.model });
    console.log('Config written.');
    process.exit(0);
  }

  const port = argv.port || codexAgent.defaultPort;

  const apiKey = argv.apiKey ?? process.env.OPENAI_API_KEY ?? '';
  if (!apiKey) {
    console.error('No API key found. Set OPENAI_API_KEY or pass --api-key.');
    process.exit(1);
  }

  // Ensure proxy is running
  const proxy = await startProxyIfNeeded(port);
  // If we started a new proxy, wait for it to be ready (already awaited inside startProxyIfNeeded)

  // Spawn Codex binary
  const child = spawnCodex({ ...argv, port }, port);
  child.on('exit', (code) => {
    // Cleanup proxy if we started it
    if (proxy) {
      try { proxy.kill('SIGTERM'); } catch {}
    }
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
