import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

export async function writeOpenCodeConfig(opts: {
  port: number;
  model?: string;
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
    },
  };

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
}
