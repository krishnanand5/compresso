import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { registerAgent, unregisterAgent, listAgents } from '../src/agents/registry.js';
import { getMultimodalModelsForAgent, listAllMultimodalModels, isAgentMultimodalCompatible } from '../src/agents/multimodal.js';
import type { CodingAgent } from '../src/agents/types.js';
import { setAllowedModelBases } from '../src/core/applicability.js';

const multimodalStub: CodingAgent = {
  id: 'multimodal-agent',
  displayName: 'Multimodal',
  family: 'base-url',
  binaryName: 'mm',
  defaultPort: 47900,
  supportedModels: ['claude-5', 'gpt-5.6'],
  envVars: () => ({}),
};

const textOnlyStub: CodingAgent = {
  id: 'text-agent',
  displayName: 'Text Only',
  family: 'base-url',
  binaryName: 'txt',
  defaultPort: 47901,
  supportedModels: ['deepseek-v4-flash'],
  envVars: () => ({}),
};

const emptyStub: CodingAgent = {
  id: 'empty-agent',
  displayName: 'Empty',
  family: 'base-url',
  binaryName: 'empty',
  defaultPort: 47902,
  supportedModels: [],
  envVars: () => ({}),
};

beforeEach(() => {
  registerAgent(multimodalStub);
  registerAgent(textOnlyStub);
  registerAgent(emptyStub);
});

afterEach(() => {
  for (const id of ['multimodal-agent', 'text-agent', 'empty-agent', 'unknown-check']) {
    unregisterAgent(id);
  }
});

describe('getMultimodalModelsForAgent', () => {
  it('returns multimodal models for an agent that has them', () => {
    const models = getMultimodalModelsForAgent('multimodal-agent');
    expect(models).toContain('claude-5');
    expect(models).toContain('gpt-5.6');
  });

  it('returns empty array for text-only agent', () => {
    expect(getMultimodalModelsForAgent('text-agent')).toEqual([]);
  });

  it('returns empty array for agent with empty supportedModels', () => {
    expect(getMultimodalModelsForAgent('empty-agent')).toEqual([]);
  });

  it('returns empty array for unknown agent', () => {
    expect(getMultimodalModelsForAgent('nonexistent')).toEqual([]);
  });
});

describe('listAllMultimodalModels', () => {
  it('returns claude-5, claude-fable-5, gpt-5.6, big-pickle', () => {
    const models = listAllMultimodalModels();
    expect(models).toContain('claude-5');
    expect(models).toContain('claude-fable-5');
    expect(models).toContain('gpt-5.6');
    expect(models).toContain('big-pickle');
  });
});

describe('isAgentMultimodalCompatible', () => {
  it('returns true for agents with multimodal models', () => {
    expect(isAgentMultimodalCompatible('multimodal-agent')).toBe(true);
  });

  it('returns false for text-only agent', () => {
    expect(isAgentMultimodalCompatible('text-agent')).toBe(false);
  });

  it('returns false for agent with empty supportedModels', () => {
    expect(isAgentMultimodalCompatible('empty-agent')).toBe(false);
  });

  it('returns false for unknown agent', () => {
    expect(isAgentMultimodalCompatible('nonexistent')).toBe(false);
  });
});
