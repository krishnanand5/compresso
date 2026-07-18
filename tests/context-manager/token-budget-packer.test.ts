import { describe, it, expect } from 'vitest';
import { TokenBudgetPacker } from '../../src/context-manager/token-budget-packer.js';
import type { ArtifactRecord } from '../../src/context-manager/artifact-store.js';

const CHARS_PER_TOKEN = 3.7;

function makeRecord(id: string, content: string, type = 'file'): ArtifactRecord {
  return {
    artifact: {
      id,
      type: type as any,
      contentHash: `hash-${id}`,
      rawLocation: `/raw/${id}.txt`,
      createdAt: Date.now(),
      sourceRepo: '/repo',
      sourcePath: `/repo/${id}.ts`,
      sourceCommit: 'abc',
      sourceBranch: 'main',
    },
    content,
  };
}

describe('TokenBudgetPacker', () => {
  const packer = new TokenBudgetPacker(CHARS_PER_TOKEN);

  it('should pack items within budget', () => {
    const records = [
      makeRecord('1', 'short content'),
      makeRecord('2', 'another short piece'),
    ];

    const items = packer.pack(records, 100);
    expect(items.length).toBe(2);
    const totalTokens = items.reduce((sum, item) => sum + Math.ceil(item.content.length / CHARS_PER_TOKEN), 0);
    expect(totalTokens).toBeLessThanOrEqual(100);
  });

  it('should truncate items that exceed remaining budget', () => {
    const longContent = 'x'.repeat(10000);
    const records = [makeRecord('1', longContent)];

    const items = packer.pack(records, 50);
    expect(items.length).toBe(1);
    expect(items[0].content.length).toBeLessThan(longContent.length);
  });

  it('should return empty array for zero budget', () => {
    const records = [makeRecord('1', 'content')];
    const items = packer.pack(records, 0);
    expect(items).toEqual([]);
  });

  it('should include provenance metadata when available', () => {
    const records = [makeRecord('1', 'content')];
    const items = packer.pack(records, 1000);

    expect(items[0].sourcePath).toBe('/repo/1.ts');
    expect(items[0].commit).toBe('abc');
    expect(items[0].timestamp).toBeDefined();
    expect(items[0].reasonSelected).toBeDefined();
  });

  it('should preserve priority order (first items are highest priority)', () => {
    const records = [
      makeRecord('high', 'high priority'),
      makeRecord('medium', 'medium priority'),
      makeRecord('low', 'low priority'),
    ];

    const items = packer.pack(records, 10);
    expect(items[0].content).toBe('high priority');
  });

  it('should handle empty input', () => {
    const items = packer.pack([], 100);
    expect(items).toEqual([]);
  });
});
