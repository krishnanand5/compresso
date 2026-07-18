import { spawnChild, buildChildEnv, forwardSignals } from '../shared/child-spawn.js';
import { opencodeGoAgent } from './index.js';

export function spawnOpenCodeGo(argv: { prompt?: string }, port: number) {
  const args = argv.prompt ? [argv.prompt] : [];
  const env = buildChildEnv(opencodeGoAgent.envVars(port));
  const child = spawnChild({
    binary: opencodeGoAgent.binaryName,
    args,
    env,
    stdio: 'inherit',
  });
  const cleanup = forwardSignals(child);
  child.on('exit', () => cleanup());
  return child;
}
