import { describe, it, expect } from 'vitest';
import { opencodeAgent } from '../src/agents/opencode/index.js';

describe('agents/opencode', () => {
  it('exposes a BaseUrlAgent', () => {
    expect(opencodeAgent.id).toBe('opencode');
    expect(opencodeAgent.family).toBe('base-url');
    expect(opencodeAgent.binaryName).toBe('opencode');
    expect(opencodeAgent.defaultPort).toBe(47822);
  });

  it('envVars returns OPENAI_BASE_URL and ANTHROPIC_BASE_URL', () => {
    const vars = opencodeAgent.envVars(48000);
    expect(vars.OPENAI_BASE_URL).toBe('http://127.0.0.1:48000/v1');
    expect(vars.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:48000');
  });
});
