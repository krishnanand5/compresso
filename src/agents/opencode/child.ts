import { spawn, execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildChildEnv, forwardSignals } from '../shared/child-spawn.js';
import { opencodeAgent } from './index.js';
import type { AgentArgv } from '../types.js';

function findOpenCodeBinary(): string | null {
  const homeDir = os.homedir();
  const opencodeNpm = path.join(homeDir, '.opencode', 'bin', 'opencode');
  if (fs.existsSync(opencodeNpm)) return opencodeNpm;
  try {
    const result = execSync('which opencode', { encoding: 'utf8' }).trim();
    if (result) return result;
  } catch {}
  return null;
}

export function spawnOpenCode(argv: AgentArgv, port: number) {
  const opencodeBin = findOpenCodeBinary();
  if (!opencodeBin) {
    console.error('OpenCode not found. Install from https://opencode.ai');
    process.exit(1);
  }

  const opencodeArgs: string[] = [];
  if (argv.model) opencodeArgs.push('--model', argv.model);
  if (argv.prompt) {
    opencodeArgs.push('run');
    opencodeArgs.push(argv.prompt);
  }

  const configJson = JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    provider: {
      openai: { options: { baseURL: `http://127.0.0.1:${port}/v1` } },
      anthropic: { options: { baseURL: `http://127.0.0.1:${port}` } },
      opencode: { options: { baseURL: `http://127.0.0.1:${port}/zen/v1` } },
      'opencode-go': { options: { baseURL: `http://127.0.0.1:${port}/zen/go/v1` } },
    },
  });

  const env = buildChildEnv({
    ...opencodeAgent.envVars(port),
    OPENCODE_CONFIG_CONTENT: configJson,
  });

  const child = spawn(opencodeBin, opencodeArgs, {
    stdio: 'inherit',
    env,
  });

  const cleanup = forwardSignals(child);
  child.on('exit', (code) => {
    cleanup();
    process.exit(code ?? 0);
  });

  return child;
}
