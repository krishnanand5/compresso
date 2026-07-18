import { describe, it, expect } from 'vitest';
import { opencodeGoAgent } from '../src/agents/opencode-go/index.js';
import { isAgentMultimodalCompatible } from '../src/agents/multimodal.js';

describe('agents/opencode-go', () => {
  it('exposes a BaseUrlAgent', () => {
    expect(opencodeGoAgent.id).toBe('opencode-go');
    expect(opencodeGoAgent.family).toBe('base-url');
    expect(opencodeGoAgent.binaryName).toBe('opencode');
    expect(opencodeGoAgent.defaultPort).toBe(47825);
  });

  it('has required fields for base-url agent', () => {
    expect(opencodeGoAgent.displayName).toBe('OpenCode Go');
    expect(opencodeGoAgent.helpText).toContain('compresso opencode-go');
    expect(opencodeGoAgent.writeConfig).toBeDefined();
    expect(opencodeGoAgent.supportedModels).toContain('deepseek-v4-flash');
  });

  it('envVars returns OPENAI_BASE_URL', () => {
    const vars = opencodeGoAgent.envVars(48000);
    expect(vars.OPENAI_BASE_URL).toBe('http://127.0.0.1:48000/v1');
    expect(vars.ANTHROPIC_BASE_URL).toBeUndefined();
  });

  it('is multimodal compatible (grok-4.5 in IMAGE_CAPABLE_BASES)', () => {
    const compatible = isAgentMultimodalCompatible('opencode-go');
    expect(compatible).toBe(true);
  });

  it('registers itself in the agent registry', async () => {
    const { getAgent } = await import('../src/agents/registry.js');
    const agent = getAgent('opencode-go');
    expect(agent).toBeDefined();
    expect(agent?.id).toBe('opencode-go');
  });
});
