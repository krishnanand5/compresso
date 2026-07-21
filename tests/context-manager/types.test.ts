import { describe, it, expect } from 'vitest';
import type { Artifact, TaskState, ContextPacket, ContextManagerConfig } from '../../src/context-manager/types.js';
import { DEFAULT_CONFIG } from '../../src/context-manager/types.js';

describe('context-manager types', () => {
  it('should define Artifact shape', () => {
    const artifact: Artifact = {
      id: 'test-id',
      type: 'file',
      contentHash: 'abc123',
      rawLocation: '/path/to/file',
      createdAt: Date.now(),
      sourceRepo: '/repo',
      sourcePath: '/repo/file.ts',
      sourceCommit: 'def456',
      sourceBranch: 'main',
    };
    expect(artifact.type).toBe('file');
  });

  it('should define TaskState shape', () => {
    const taskState: TaskState = {
      sessionId: 'session-1',
      branch: 'main',
      headCommit: 'abc123',
      activeFiles: ['file1.ts', 'file2.ts'],
      activeTask: 'fix bug',
    };
    expect(taskState.activeFiles).toHaveLength(2);
  });

  it('should define ContextPacket shape', () => {
    const packet: ContextPacket = {
      items: [],
      totalTokens: 0,
      retrievalTimeMs: 0,
      cacheHits: 0,
      staleItemsInvalidated: 0,
    };
    expect(packet.items).toHaveLength(0);
  });

  it('should have sensible default config', () => {
    expect(DEFAULT_CONFIG.budgetTokens).toBe(2000);
    expect(DEFAULT_CONFIG.toolOutputTTLSeconds).toBe(300);
    expect(DEFAULT_CONFIG.hotCacheCapacity).toBe(1000);
  });
});
