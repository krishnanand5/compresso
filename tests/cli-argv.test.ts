import { describe, it, expect } from 'vitest';
import { parseCommonFlags } from '../src/cli/argv.js';

describe('cli/argv', () => {
  it('parses --port, --model, --setup, --help, --quiet, --api-key', () => {
    const r = parseCommonFlags(['--port', '48000', '-m', 'gpt-4o', '--setup', '-k', 'sk-xxx']);
    expect(r).toMatchObject({
      port: 48000, model: 'gpt-4o', setup: true, help: false,
      apiKey: 'sk-xxx', quiet: false, prompt: undefined,
    });
  });

  it('captures the first non-flag arg as prompt', () => {
    const r = parseCommonFlags(['write', 'a', 'test']);
    expect(r.prompt).toBe('write');
  });

  it('--help is a boolean', () => {
    expect(parseCommonFlags(['--help']).help).toBe(true);
  });
});
