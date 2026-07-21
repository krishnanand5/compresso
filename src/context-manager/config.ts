import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { DEFAULT_CONFIG, type ContextManagerConfig } from './types.js';

export const DEFAULT_CONFIG_DIR = join(homedir(), '.compresso', 'context-manager');

export function loadConfig(configDir: string = DEFAULT_CONFIG_DIR): ContextManagerConfig {
  const configPath = join(configDir, 'config.json');

  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
