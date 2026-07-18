import { parseCommonFlags } from '../../cli/argv.js';
import { startProxyIfNeeded } from '../shared/proxy-lifecycle.js';
import { opencodeGoAgent } from './index.js';
import { spawnOpenCodeGo } from './child.js';

export async function main(): Promise<void> {
  const argv = parseCommonFlags();

  if (argv.help) {
    console.log(opencodeGoAgent.helpText);
    process.exit(0);
  }

  if (argv.setup) {
    await opencodeGoAgent.writeConfig?.({ port: argv.port, model: argv.model, apiKey: argv.apiKey });
    process.exit(0);
  }

  const proxy = await startProxyIfNeeded(argv.port, { client: 'opencode-go' });

  const child = spawnOpenCodeGo(argv, argv.port);
  child.on('exit', (code) => {
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
