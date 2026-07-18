import { describe, it, expect } from 'vitest';
import type { CodingAgent, BaseUrlAgent, SdkAgent } from '../src/agents/types.js';

describe('agents/types', () => {
  it('CodingAgent is a structural type', () => {
    const agent: CodingAgent = {
      id: 'codex',
      displayName: 'Codex CLI',
      family: 'base-url',
      envVars: (port) => ({ OPENAI_BASE_URL: `http://127.0.0.1:${port}` }),
      binaryName: 'codex',
      defaultPort: 47821,
    };
    expect(agent.id).toBe('codex');
  });

  it('BaseUrlAgent sets base-URL env vars; SdkAgent provides a handler', () => {
    const baseUrl: BaseUrlAgent = {
      id: 'codex', displayName: 'x', family: 'base-url',
      envVars: (p) => ({}), binaryName: 'codex', defaultPort: 0,
    };
    const sdk: SdkAgent = {
      id: 'copilot', displayName: 'x', family: 'sdk',
      makeHandler: () => ({ handle: async () => new Response() }),
    };
    expect(baseUrl.family).toBe('base-url');
    expect(sdk.family).toBe('sdk');
  });
});
