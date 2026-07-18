import { parseCommonFlags } from '../../cli/argv.js';
import { startProxyIfNeeded } from '../shared/proxy-lifecycle.js';
import { newAgent } from './index.js';
import { spawnNewAgent } from './child.js';

async function main(): Promise<void> {
  const argv = parseCommonFlags();

  if (argv.help) {
    console.log(newAgent.helpText);
    process.exit(0);
  }

  if (argv.setup) {
    await newAgent.writeConfig?.({ port: argv.port, model: argv.model });
    console.log('Config written.');
    process.exit(0);
  }

  const proxy = await startProxyIfNeeded(argv.port);

  const child = spawnNewAgent(argv, argv.port);
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
