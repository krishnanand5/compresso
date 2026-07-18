import { main } from './agents/opencode-go/cli.js';
main().catch((err: unknown) => {
  console.error(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
