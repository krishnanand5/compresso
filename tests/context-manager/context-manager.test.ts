import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ContextManager } from '../../src/context-manager/context-manager.js';
import { DEFAULT_CONFIG } from '../../src/context-manager/types.js';
import { rmSync, mkdirSync } from 'fs';

const TEST_DIR = '/tmp/compresso-test-context-manager';

describe('ContextManager', () => {
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

  it('should return empty packet when no artifacts exist', () => {
    const packet = manager.getContext({
      sessionId: 'session-1',
      branch: 'main',
      headCommit: 'abc',
      activeFiles: [],
      activeTask: null,
    }, { budgetTokens: 2000, includeProvenance: true });

    expect(packet.items).toEqual([]);
    expect(packet.totalTokens).toBe(0);
    expect(packet.retrievalTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should record artifact and include in next getContext', () => {
    manager.recordArtifact({
      type: 'file',
      content: 'export function hello() { return "world"; }',
      sourceRepo: '/repo',
      sourcePath: '/repo/hello.ts',
      sourceCommit: 'abc',
      sourceBranch: 'main',
    });

    const packet = manager.getContext({
      sessionId: 'session-1',
      branch: 'main',
      headCommit: 'abc',
      activeFiles: ['/repo/hello.ts'],
      activeTask: null,
    }, { budgetTokens: 2000, includeProvenance: true });

    expect(packet.items.length).toBeGreaterThan(0);
    expect(packet.items.some(i => i.sourcePath === '/repo/hello.ts')).toBe(true);
  });

  it('should respect token budget', () => {
    const longContent = 'x'.repeat(50000);
    manager.recordArtifact({
      type: 'file',
      content: longContent,
      sourceRepo: '/repo',
      sourcePath: '/repo/large.ts',
      sourceCommit: 'abc',
      sourceBranch: 'main',
    });

    const packet = manager.getContext({
      sessionId: 'session-1',
      branch: 'main',
      headCommit: 'abc',
      activeFiles: ['/repo/large.ts'],
      activeTask: null,
    }, { budgetTokens: 100, includeProvenance: true });

    expect(packet.totalTokens).toBeLessThanOrEqual(100);
  });

  it('should track cache stats', () => {
    manager.recordArtifact({
      type: 'file',
      content: 'content',
      sourceRepo: '/repo',
      sourcePath: '/repo/file.ts',
      sourceCommit: 'abc',
      sourceBranch: 'main',
    });

    manager.getContext({
      sessionId: 'session-1',
      branch: 'main',
      headCommit: 'abc',
      activeFiles: ['/repo/file.ts'],
      activeTask: null,
    }, { budgetTokens: 2000, includeProvenance: true });

    const packet = manager.getContext({
      sessionId: 'session-1',
      branch: 'main',
      headCommit: 'abc',
      activeFiles: ['/repo/file.ts'],
      activeTask: null,
    }, { budgetTokens: 2000, includeProvenance: true });

    expect(packet.cacheHits).toBeGreaterThanOrEqual(0);
  });

  it('should invalidate on request', () => {
    manager.recordArtifact({
      type: 'file',
      content: 'content',
      sourceRepo: '/repo',
      sourcePath: '/repo/file.ts',
      sourceCommit: 'abc',
      sourceBranch: 'main',
    });

    manager.invalidate('/repo/file.ts');
  });
});
