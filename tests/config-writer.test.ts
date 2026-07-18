import { describe, it, expect } from 'vitest';
import { writeAgentConfig } from '../src/agents/shared/config-writer.js';

describe('agents/shared/config-writer', () => {
  it('returns an error for unknown agent', async () => {
    const r = await writeAgentConfig('not-a-real-agent', { port: 47821 });
    expect(r.ok).toBe(false);
  });
});
