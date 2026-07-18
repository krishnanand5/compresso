import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ArtifactStore } from '../../src/context-manager/artifact-store.js';
import { rmSync, mkdirSync } from 'fs';

const TEST_DIR = '/tmp/compresso-test-artifact-store';

describe('ArtifactStore', () => {
  let store: ArtifactStore;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    store = new ArtifactStore(TEST_DIR);
  });

  afterEach(() => {
    store.close();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('should create and retrieve an artifact by id', () => {
    const artifact = store.createArtifact({
      type: 'file',
      content: 'console.log("hello")',
      sourceRepo: '/repo',
      sourcePath: '/repo/file.ts',
      sourceCommit: 'abc123',
      sourceBranch: 'main',
    });

    expect(artifact.id).toBeDefined();
    expect(artifact.type).toBe('file');
    expect(artifact.contentHash).toMatch(/^[a-f0-9]{64}$/);

    const retrieved = store.getArtifact(artifact.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.artifact.id).toBe(artifact.id);
    expect(retrieved!.content).toBe('console.log("hello")');
  });

  it('should return null for missing artifact', () => {
    expect(store.getArtifact('nonexistent')).toBeNull();
  });

  it('should query artifacts by source path', () => {
    store.createArtifact({
      type: 'file',
      content: 'content1',
      sourceRepo: '/repo',
      sourcePath: '/repo/file1.ts',
      sourceCommit: 'abc',
      sourceBranch: 'main',
    });
    store.createArtifact({
      type: 'file',
      content: 'content2',
      sourceRepo: '/repo',
      sourcePath: '/repo/file2.ts',
      sourceCommit: 'abc',
      sourceBranch: 'main',
    });

    const results = store.queryBySourcePath('/repo/file1.ts');
    expect(results).toHaveLength(1);
    expect(results[0].artifact.sourcePath).toBe('/repo/file1.ts');
  });

  it('should query artifacts by branch', () => {
    store.createArtifact({
      type: 'file',
      content: 'main-content',
      sourceRepo: '/repo',
      sourcePath: '/repo/file.ts',
      sourceCommit: 'abc',
      sourceBranch: 'main',
    });
    store.createArtifact({
      type: 'file',
      content: 'feature-content',
      sourceRepo: '/repo',
      sourcePath: '/repo/file.ts',
      sourceCommit: 'def',
      sourceBranch: 'feature',
    });

    const results = store.queryByBranch('feature');
    expect(results).toHaveLength(1);
    expect(results[0].artifact.sourceBranch).toBe('feature');
  });

  it('should query recent artifacts', () => {
    for (let i = 0; i < 5; i++) {
      store.createArtifact({
        type: 'file',
        content: `content-${i}`,
        sourceRepo: '/repo',
        sourcePath: `/repo/file${i}.ts`,
        sourceCommit: 'abc',
        sourceBranch: 'main',
      });
    }

    const results = store.queryRecent('file', 3);
    expect(results).toHaveLength(3);
  });

  it('should delete an artifact and its raw content', () => {
    const artifact = store.createArtifact({
      type: 'file',
      content: 'to-delete',
      sourceRepo: '/repo',
      sourcePath: '/repo/delete-me.ts',
      sourceCommit: 'abc',
      sourceBranch: 'main',
    });

    expect(store.getArtifact(artifact.id)).not.toBeNull();
    store.deleteArtifact(artifact.id);
    expect(store.getArtifact(artifact.id)).toBeNull();
  });
});
