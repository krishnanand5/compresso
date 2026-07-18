import { describe, it, expect } from 'vitest';
import { injectContextPacket } from '../../src/context-manager/integration-helpers.js';
import type { ContextPacket } from '../../src/context-manager/types.js';

describe('Copilot context integration', () => {
  it('should inject context packet into request body', () => {
    const body = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Fix the bug.' },
      ],
    };

    const bodyBytes = new TextEncoder().encode(JSON.stringify(body));
    const packet: ContextPacket = {
      items: [
        {
          type: 'file',
          content: 'export function hello() { return "world"; }',
          sourcePath: '/repo/hello.ts',
          commit: 'abc123',
          timestamp: Date.now(),
          reasonSelected: 'active file',
        },
      ],
      totalTokens: 15,
      retrievalTimeMs: 5,
      cacheHits: 1,
      staleItemsInvalidated: 0,
    };

    const result = new TextDecoder().decode(injectContextPacket(bodyBytes, packet));
    const parsed = JSON.parse(result);

    expect(parsed.messages[0].content).toContain('<context-manager>');
    expect(parsed.messages[0].content).toContain('hello.ts');
    expect(parsed.messages[0].content).toContain('export function hello');
  });

  it('should return unchanged body when packet is empty', () => {
    const body = { model: 'gpt-4o', messages: [] };
    const bodyBytes = new TextEncoder().encode(JSON.stringify(body));
    const packet: ContextPacket = {
      items: [],
      totalTokens: 0,
      retrievalTimeMs: 0,
      cacheHits: 0,
      staleItemsInvalidated: 0,
    };

    const result = injectContextPacket(bodyBytes, packet);
    expect(new TextDecoder().decode(result)).toBe(new TextDecoder().decode(bodyBytes));
  });
});
