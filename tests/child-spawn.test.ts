import { describe, it, expect } from 'vitest';
import { buildChildEnv } from '../src/agents/shared/child-spawn.js';

describe('agents/shared/child-spawn', () => {
  it('buildChildEnv merges agent env with current process env', () => {
    const env = buildChildEnv({ OPENAI_BASE_URL: 'http://127.0.0.1:47821' }, {
      PATH: '/usr/bin',
    } as any);
    expect(env.OPENAI_BASE_URL).toBe('http://127.0.0.1:47821');
    expect(env.PATH).toBe('/usr/bin');
  });
});
