import { describe, it, expect, beforeEach } from 'vitest';
import { HotCache } from '../../src/context-manager/hot-cache.js';
import type { ArtifactRecord } from '../../src/context-manager/artifact-store.js';

function makeRecord(id: string, path: string, content: string): ArtifactRecord {
  return {
    artifact: {
      id,
      type: 'file',
      contentHash: `hash-${id}`,
      rawLocation: `/raw/${id}.txt`,
      createdAt: Date.now(),
      sourceRepo: '/repo',
      sourcePath: path,
      sourceCommit: 'abc',
      sourceBranch: 'main',
    },
    content,
  };
}

describe('HotCache', () => {
  let cache: HotCache;

  beforeEach(() => {
    cache = new HotCache(3);
  });

  it('should store and retrieve items by key', () => {
    const rec = makeRecord('1', '/repo/file.ts', 'content');
    cache.set('/repo/file.ts', rec);
    const result = cache.get('/repo/file.ts');
    expect(result).toBeDefined();
    expect(result!.content).toBe('content');
  });

  it('should return undefined for missing keys', () => {
    expect(cache.get('/missing')).toBeUndefined();
  });

  it('should report has() correctly', () => {
    const rec = makeRecord('1', '/repo/file.ts', 'content');
    cache.set('/repo/file.ts', rec);
    expect(cache.has('/repo/file.ts')).toBe(true);
    expect(cache.has('/missing')).toBe(false);
  });

  it('should evict LRU items when capacity exceeded', () => {
    cache.set('/a', makeRecord('1', '/a', 'a'));
    cache.set('/b', makeRecord('2', '/b', 'b'));
    cache.set('/c', makeRecord('3', '/c', 'c'));
    cache.set('/d', makeRecord('4', '/d', 'd'));

    expect(cache.has('/a')).toBe(false);
    expect(cache.has('/d')).toBe(true);
  });

  it('should promote accessed items (LRU order)', () => {
    cache.set('/a', makeRecord('1', '/a', 'a'));
    cache.set('/b', makeRecord('2', '/b', 'b'));
    cache.set('/c', makeRecord('3', '/c', 'c'));

    cache.get('/a');
    cache.set('/d', makeRecord('4', '/d', 'd'));

    expect(cache.has('/a')).toBe(true);
    expect(cache.has('/b')).toBe(false);
  });

  it('should track hits and misses', () => {
    cache.set('/a', makeRecord('1', '/a', 'a'));
    cache.get('/a');
    cache.get('/a');
    cache.get('/missing');

    const stats = cache.getStats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.size).toBe(1);
  });

  it('should delete items', () => {
    cache.set('/a', makeRecord('1', '/a', 'a'));
    cache.delete('/a');
    expect(cache.has('/a')).toBe(false);
  });

  it('should clear all items', () => {
    cache.set('/a', makeRecord('1', '/a', 'a'));
    cache.set('/b', makeRecord('2', '/b', 'b'));
    cache.clear();
    expect(cache.getStats().size).toBe(0);
  });
});
