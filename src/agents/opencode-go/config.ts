import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

export async function writeOpenCodeGoConfig(opts: {
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

  const proxyOverrides: Record<string, unknown> = {
    model: opts.model ?? 'opencode-go/deepseek-v4-flash',
    provider: {
      openai: { options: { baseURL: `http://127.0.0.1:${opts.port}/v1` } },
    },
  };

  if (opts.apiKey) {
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

  if (proxyOverrides.model) {
    existing.model = proxyOverrides.model;
  }

  await fs.writeFile(configFile, JSON.stringify(existing, null, 2), 'utf8');

  console.log('');
  console.log('OpenCode Go configured. Next steps:');
  console.log('  1. Subscribe to OpenCode Go at https://opencode.ai/auth');
  console.log('  2. Run `/connect` in the OpenCode TUI and select "OpenCode Go"');
  console.log('  3. Paste your Go API key when prompted');
  console.log('  4. Run `/models` to see available Go models');
  console.log('');
  console.log('Available Go models (use with --model flag):');
  console.log('  - opencode-go/deepseek-v4-flash');
  console.log('  - opencode-go/deepseek-v4-pro');
  console.log('  - opencode-go/grok-4.5');
  console.log('  - opencode-go/kimi-k3');
  console.log('  - opencode-go/qwen3.7-max');
  console.log('  - opencode-go/mimo-v2.5');
}
