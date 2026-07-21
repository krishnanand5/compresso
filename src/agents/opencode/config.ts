import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

export async function writeOpenCodeConfig(opts: {
  port: number;
  model?: string;
  apiKey?: string;
}): Promise<void> {
  const configDir = path.join(os.homedir(), '.config', 'opencode');
  const configFile = path.join(configDir, 'opencode.json');
  await fs.mkdir(configDir, { recursive: true });

  let existing: Record<string, unknown> = {};
  try {
    const data = await fs.readFile(configFile, 'utf8');
    existing = JSON.parse(data);
  } catch {}

  const proxyOverrides = {
    provider: {
      openai: { options: { baseURL: `http://127.0.0.1:${opts.port}/v1` } },
      anthropic: { options: { baseURL: `http://127.0.0.1:${opts.port}` } },
      opencode: { options: { baseURL: `http://127.0.0.1:${opts.port}/zen/v1` } },
      'opencode-go': { options: { baseURL: `http://127.0.0.1:${opts.port}/zen/go/v1` } },
    },
  };

  if (opts.apiKey) {
    (proxyOverrides.provider as Record<string, unknown>)['opencode'] = { apiKey: opts.apiKey };
    (proxyOverrides.provider as Record<string, unknown>)['opencode-go'] = { apiKey: opts.apiKey };
  }

  if (proxyOverrides.provider && typeof proxyOverrides.provider === 'object') {
    const existingProviders =
      existing.provider && typeof existing.provider === 'object'
        ? (existing.provider as Record<string, unknown>)
        : {};
    const newProviders = proxyOverrides.provider as Record<string, unknown>;
    for (const [key, val] of Object.entries(newProviders)) {
      if (existingProviders[key] && typeof existingProviders[key] === 'object' && typeof val === 'object') {
        existingProviders[key] = { ...(existingProviders[key] as Record<string, unknown>), ...(val as Record<string, unknown>) };
      } else {
        existingProviders[key] = val;
      }
    }
    existing.provider = existingProviders;
  }

  await fs.writeFile(configFile, JSON.stringify(existing, null, 2), 'utf8');

  console.log('');
  console.log('OpenCode configured. Available providers:');
  console.log('  - opencode (Zen subscription): /zen/v1');
  console.log('  - opencode-go (Go subscription): /zen/go/v1');
  console.log('');
  console.log('Available models (use with --model flag):');
  console.log('  Zen tier:');
  console.log('    - claude-fable-5, claude-5, gpt-5.6, big-pickle');
  console.log('  Go tier:');
  console.log('    - grok-4.5, glm-5.2, glm-5.1, kimi-k3, kimi-k2.7-code, kimi-k2.6');
  console.log('    - deepseek-v4-pro, deepseek-v4-flash, mimo-v2.5, mimo-v2.5-pro');
  console.log('    - minimax-m3, minimax-m2.7, minimax-m2.5');
  console.log('    - qwen3.7-max, qwen3.7-plus, qwen3.6-plus');
}
