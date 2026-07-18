import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAgent, listAgents } from '../src/agents/registry.js';
import { codexAgent } from '../src/agents/codex/index.js';
import { parseCommonFlags } from '../src/cli/argv.js';
import * as childSpawn from '../src/agents/shared/child-spawn.js';
import { spawnCodex } from '../src/agents/codex/child.js';

describe('Codex agent registration', () => {
  it('should be retrievable from the registry', () => {
    expect(getAgent('codex')).toBe(codexAgent);
    expect(listAgents()).toContain('codex');
  });
});

describe('Common flag parser', () => {
  it('parses typical arguments', () => {
    const argv = ['--port', '1234', '--model', 'gpt-4o', '--api-key', 'sk-test', '--setup', 'my prompt'];
    const result = parseCommonFlags(argv);
    expect(result.port).toBe(1234);
    expect(result.model).toBe('gpt-4o');
    expect(result.apiKey).toBe('sk-test');
    expect(result.setup).toBe(true);
    expect(result.prompt).toBe('my prompt');
  });
});

describe('spawnCodex child process', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  it('invokes spawnChild with correct binary and env', async () => {
    const spy = vi.spyOn(childSpawn, 'spawnChild').mockImplementation(() => {
      // Return a dummy child process with minimal API
      return {
        on: () => {},
        kill: () => {},
      } as any;
    });
    const argv = { prompt: 'test', help: false, setup: false, port: 0, model: undefined, apiKey: undefined, quiet: false, extra: {} } as any;
    const child = spawnCodex(argv, 47821);
    expect(spy).toHaveBeenCalledOnce();
    const callArgs = spy.mock.calls[0][0];
    expect(callArgs.binary).toBe('codex');
    expect(callArgs.env?.OPENAI_BASE_URL).toBe('http://127.0.0.1:47821');
    expect(child).toBeDefined();
  });
});
