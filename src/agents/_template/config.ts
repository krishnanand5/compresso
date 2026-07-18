import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

export async function writeConfig(opts: {
  port: number;
  apiKey?: string;
  model?: string;
}): Promise<void> {
  const home = os.homedir();
  const dir = path.join(home, '.new-agent');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'config.json');
  const config: Record<string, unknown> = {
    provider: { baseURL: `http://127.0.0.1:${opts.port}` },
  };
  if (opts.model) config.model = opts.model;
  if (opts.apiKey) config.apiKey = opts.apiKey;
  await fs.writeFile(file, JSON.stringify(config, null, 2), 'utf8');
}
