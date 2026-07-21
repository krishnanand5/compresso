import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ContextManager } from '../../src/context-manager/context-manager.js';
import { injectContextPacket } from '../../src/context-manager/integration-helpers.js';
import { DEFAULT_CONFIG } from '../../src/context-manager/types.js';
import { rmSync, mkdirSync } from 'fs';

const TEST_DIR = '/tmp/compresso-test-e2e';

describe('context manager e2e', () => {
  let manager: ContextManager;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    manager = new ContextManager(TEST_DIR, DEFAULT_CONFIG);
  });

  afterEach(() => {
    manager.close();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('should record artifacts, retrieve context, and inject into request', () => {
    manager.recordArtifact({
      type: 'file',
      content: 'export function add(a: number, b: number) { return a + b; }',
      sourceRepo: '/repo',
      sourcePath: '/repo/math.ts',
      sourceCommit: 'abc123',
      sourceBranch: 'main',
    });

    manager.recordArtifact({
      type: 'tool_output',
      content: 'PASS tests/math.test.ts (2 tests, 0 failures)',
      sourceRepo: '/repo',
      sourcePath: null,
      sourceCommit: 'abc123',
      sourceBranch: 'main',
    });

    const packet = manager.getContext({
      sessionId: 'session-1',
      branch: 'main',
      headCommit: 'abc123',
      activeFiles: ['/repo/math.ts'],
      activeTask: 'add subtract function',
    }, { budgetTokens: 2000, includeProvenance: true });

    expect(packet.items.length).toBeGreaterThan(0);
    expect(packet.totalTokens).toBeGreaterThan(0);
    expect(packet.totalTokens).toBeLessThanOrEqual(2000);
    expect(packet.retrievalTimeMs).toBeLessThan(50);

    const body = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a coding assistant.' },
        { role: 'user', content: 'Add a subtract function.' },
      ],
    };
    const bodyBytes = new TextEncoder().encode(JSON.stringify(body));
    const injected = injectContextPacket(bodyBytes, packet);
    const parsed = JSON.parse(new TextDecoder().decode(injected));

    expect(parsed.messages[0].content).toContain('<context-manager>');
    expect(parsed.messages[0].content).toContain('math.ts');
  });

  it('should handle rapid successive calls (cache warming)', () => {
    manager.recordArtifact({
      type: 'file',
      content: 'content',
      sourceRepo: '/repo',
      sourcePath: '/repo/file.ts',
      sourceCommit: 'abc',
      sourceBranch: 'main',
    });

    const taskState = {
      sessionId: 'session-1',
      branch: 'main',
      headCommit: 'abc',
      activeFiles: ['/repo/file.ts'],
      activeTask: null,
    };

    const packet1 = manager.getContext(taskState, { budgetTokens: 2000, includeProvenance: true });
    const packet2 = manager.getContext(taskState, { budgetTokens: 2000, includeProvenance: true });

    expect(packet2.cacheHits).toBeGreaterThanOrEqual(packet1.cacheHits);
  });

  it('should respect token budget under pressure', () => {
    for (let i = 0; i < 20; i++) {
      manager.recordArtifact({
        type: 'file',
        content: 'x'.repeat(5000),
        sourceRepo: '/repo',
        sourcePath: `/repo/file${i}.ts`,
        sourceCommit: 'abc',
        sourceBranch: 'main',
      });
    }

    const packet = manager.getContext({
      sessionId: 'session-1',
      branch: 'main',
      headCommit: 'abc',
      activeFiles: Array.from({ length: 20 }, (_, i) => `/repo/file${i}.ts`),
      activeTask: null,
    }, { budgetTokens: 500, includeProvenance: true });

    expect(packet.totalTokens).toBeLessThanOrEqual(500);
  });
});
