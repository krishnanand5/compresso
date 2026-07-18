import { spawnChild, buildChildEnv, forwardSignals } from '../shared/child-spawn.js';
import { newAgent } from './index.js';

export function spawnNewAgent(argv: { prompt?: string }, port: number) {
  const args = argv.prompt ? [argv.prompt] : [];
  const env = buildChildEnv(newAgent.envVars(port));
  const child = spawnChild({
    binary: newAgent.binaryName,
    args,
    env,
    stdio: 'inherit',
  });
  const cleanup = forwardSignals(child);
  child.on('exit', () => cleanup());
  return child;
}
