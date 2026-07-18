// src/agents/codex/child.ts

import { spawnChild, buildChildEnv, forwardSignals } from '../shared/child-spawn.js';
import { codexAgent } from './index.js';
import type { AgentArgv } from '../types.js';

/** Spawn the Codex CLI binary with proper environment and forwarding. */
export function spawnCodex(argv: AgentArgv, port: number) {
  const args = argv.prompt ? [argv.prompt] : [];
  const env = buildChildEnv(codexAgent.envVars(port));
  const child = spawnChild({
    binary: codexAgent.binaryName,
    args,
    env,
    stdio: 'inherit',
  });
  const cleanup = forwardSignals(child);
  child.on('exit', () => cleanup());
  return child;
}
