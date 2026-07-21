import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../../src/context-manager/config.js';
import { DEFAULT_CONFIG } from '../../src/context-manager/types.js';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const TEST_CONFIG_DIR = join(homedir(), '.compresso', 'context-manager-test');

describe('loadConfig', () => {
  beforeEach(() => {
    rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
  });

  it('should return defaults when no config file exists', () => {
    const config = loadConfig(TEST_CONFIG_DIR);
    expect(config.budgetTokens).toBe(DEFAULT_CONFIG.budgetTokens);
    expect(config.toolOutputTTLSeconds).toBe(DEFAULT_CONFIG.toolOutputTTLSeconds);
  });

  it('should merge file config with defaults', () => {
    mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    writeFileSync(
      join(TEST_CONFIG_DIR, 'config.json'),
      JSON.stringify({ budgetTokens: 4000 }),
    );

    const config = loadConfig(TEST_CONFIG_DIR);
    expect(config.budgetTokens).toBe(4000);
    expect(config.toolOutputTTLSeconds).toBe(DEFAULT_CONFIG.toolOutputTTLSeconds);
  });

  it('should handle malformed JSON gracefully', () => {
    mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    writeFileSync(join(TEST_CONFIG_DIR, 'config.json'), 'not json');

    const config = loadConfig(TEST_CONFIG_DIR);
    expect(config.budgetTokens).toBe(DEFAULT_CONFIG.budgetTokens);
  });
});
