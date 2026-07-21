import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RetrievalCascade } from '../../src/context-manager/retrieval-cascade.js';
import { ArtifactStore } from '../../src/context-manager/artifact-store.js';
import { HotCache } from '../../src/context-manager/hot-cache.js';
import { StateSnapshotManager } from '../../src/context-manager/state-snapshot.js';
import { initializeDatabase } from '../../src/context-manager/db-schema.js';
import { rmSync, mkdirSync } from 'fs';
import type Database from 'better-sqlite3';
import type { TaskState } from '../../src/context-manager/types.js';

const TEST_DIR = '/tmp/compresso-test-retrieval';

describe('RetrievalCascade', () => {
  let db: Database.Database;
  let store: ArtifactStore;
  let cache: HotCache;
  let snapshotManager: StateSnapshotManager;
  let cascade: RetrievalCascade;

  const baseTaskState: TaskState = {
    sessionId: 'session-1',
    branch: 'main',
    headCommit: 'abc123',
    activeFiles: [],
    activeTask: null,
  };

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    db = initializeDatabase(TEST_DIR);
    store = new ArtifactStore(TEST_DIR);
    cache = new HotCache(100);
    snapshotManager = new StateSnapshotManager(db);
    cascade = new RetrievalCascade(store, cache, snapshotManager);
  });

  afterEach(() => {
    db.close();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('should return empty array when no artifacts exist', () => {
    const results = cascade.retrieve(baseTaskState);
    expect(results).toEqual([]);
  });

  it('should retrieve artifacts matching active files (highest priority)', () => {
    store.createArtifact({
      type: 'file',
      content: 'active-content',
      sourceRepo: '/repo',
      sourcePath: '/repo/active.ts',
      sourceCommit: 'abc123',
      sourceBranch: 'main',
    });
    store.createArtifact({
      type: 'file',
      content: 'inactive-content',
      sourceRepo: '/repo',
      sourcePath: '/repo/inactive.ts',
      sourceCommit: 'abc123',
      sourceBranch: 'main',
    });

    const results = cascade.retrieve({
      ...baseTaskState,
      activeFiles: ['/repo/active.ts'],
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].artifact.sourcePath).toBe('/repo/active.ts');
  });

  it('should retrieve artifacts matching current branch', () => {
    store.createArtifact({
      type: 'file',
      content: 'main-content',
      sourceRepo: '/repo',
      sourcePath: '/repo/file.ts',
      sourceCommit: 'abc123',
      sourceBranch: 'main',
    });
    store.createArtifact({
      type: 'file',
      content: 'feature-content',
      sourceRepo: '/repo',
      sourcePath: '/repo/other.ts',
      sourceCommit: 'def456',
      sourceBranch: 'feature',
    });

    const results = cascade.retrieve(baseTaskState);

    expect(results.some(r => r.artifact.sourceBranch === 'main')).toBe(true);
    expect(results.some(r => r.artifact.sourceBranch === 'feature')).toBe(false);
  });

  it('should retrieve artifacts matching current commit', () => {
    store.createArtifact({
      type: 'diff',
      content: 'diff-content',
      sourceRepo: '/repo',
      sourcePath: null,
      sourceCommit: 'abc123',
      sourceBranch: 'main',
    });

    const results = cascade.retrieve(baseTaskState);
    expect(results.some(r => r.artifact.sourceCommit === 'abc123')).toBe(true);
  });

  it('should fall back to recent artifacts when no exact match', () => {
    store.createArtifact({
      type: 'tool_output',
      content: 'recent-output',
      sourceRepo: '/repo',
      sourcePath: null,
      sourceCommit: 'old-commit',
      sourceBranch: 'old-branch',
    });

    const results = cascade.retrieve(baseTaskState);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('should deduplicate artifacts', () => {
    store.createArtifact({
      type: 'file',
      content: 'content',
      sourceRepo: '/repo',
      sourcePath: '/repo/file.ts',
      sourceCommit: 'abc123',
      sourceBranch: 'main',
    });

    const results = cascade.retrieve({
      ...baseTaskState,
      activeFiles: ['/repo/file.ts'],
    });

    const ids = results.map(r => r.artifact.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });

  it('should use hot cache when available', () => {
    const artifact = store.createArtifact({
      type: 'file',
      content: 'cached-content',
      sourceRepo: '/repo',
      sourcePath: '/repo/cached.ts',
      sourceCommit: 'abc123',
      sourceBranch: 'main',
    });

    const record = store.getArtifact(artifact.id)!;
    cache.set('/repo/cached.ts', record);

    const results = cascade.retrieve({
      ...baseTaskState,
      activeFiles: ['/repo/cached.ts'],
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(cache.getStats().hits).toBeGreaterThan(0);
  });
});
