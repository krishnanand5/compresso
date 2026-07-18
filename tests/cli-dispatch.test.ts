import { describe, it, expect } from 'vitest';
import { resolveSubcommand, listSubcommands } from '../src/cli/dispatch.js';

describe('cli/dispatch', () => {
  it('resolves known subcommands', () => {
    expect(resolveSubcommand('codex')).toBeDefined();
    expect(resolveSubcommand('opencode')).toBeDefined();
    expect(resolveSubcommand('copilot')).toBeDefined();
  });

  it('returns undefined for unknown', () => {
    expect(resolveSubcommand('nope')).toBeUndefined();
  });

  it('lists every registered subcommand', () => {
    const cmds = listSubcommands();
    expect(cmds).toContain('codex');
    expect(cmds).toContain('copilot');
    expect(cmds).toContain('dashboard');
    expect(cmds).toContain('opencode');
    expect(cmds).toContain('proxy');
  });
});
