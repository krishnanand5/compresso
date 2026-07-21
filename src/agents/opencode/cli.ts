import { parseCommonFlags } from '../../cli/argv.js';
import { startProxyIfNeeded, waitForProxyReady } from '../shared/proxy-lifecycle.js';
import { opencodeAgent } from './index.js';
import { spawnOpenCode } from './child.js';
import type { AgentArgv } from '../types.js';

async function main(): Promise<void> {
  const argv = parseCommonFlags();

  if (argv.help) {
    console.log(opencodeAgent.helpText);
    process.exit(0);
  }

  if (argv.setup) {
    await opencodeAgent.writeConfig?.({ 
      port: argv.port || opencodeAgent.defaultPort, 
      model: argv.model,
      apiKey: argv.apiKey 
    });
    console.log('Config written.');
    process.exit(0);
  }

  const port = argv.port || opencodeAgent.defaultPort;

  const proxy = await startProxyIfNeeded(port);

  const child = spawnOpenCode({ ...argv, port }, port);
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
