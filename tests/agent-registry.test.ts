import { describe, it, expect } from 'vitest';
import { registerAgent, getAgent, listAgents } from '../src/agents/registry.js';
import type { CodingAgent } from '../src/agents/types.js';

const stub: CodingAgent = {
  id: 'stub', displayName: 'Stub', family: 'base-url',
  binaryName: 'stub', defaultPort: 1,
  supportedModels: ['claude-5'],
  envVars: () => ({}),
};

describe('agents/registry', () => {
  it('registerAgent + getAgent round-trip', () => {
    registerAgent(stub);
    expect(getAgent('stub')).toBe(stub);
  });

  it('getAgent returns undefined for unknown id', () => {
    expect(getAgent('nope')).toBeUndefined();
  });

  it('listAgents returns registered ids', () => {
    registerAgent({ ...stub, id: 'a' });
    registerAgent({ ...stub, id: 'b' });
    expect(listAgents().sort()).toEqual(['a', 'b', 'stub'].sort());
  });
});
