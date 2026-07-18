import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Invalidator } from '../../src/context-manager/invalidator.js';
import { ArtifactStore } from '../../src/context-manager/artifact-store.js';
import { HotCache } from '../../src/context-manager/hot-cache.js';
import { StateSnapshotManager } from '../../src/context-manager/state-snapshot.js';
import { initializeDatabase } from '../../src/context-manager/db-schema.js';
import { rmSync, mkdirSync } from 'fs';
import type Database from 'better-sqlite3';

const TEST_DIR = '/tmp/compresso-test-invalidator';

describe('Invalidator', () => {
  let db: Database.Database;
  let store: ArtifactStore;
  let cache: HotCache;
  let snapshotManager: StateSnapshotManager;
  let invalidator: Invalidator;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    db = initializeDatabase(TEST_DIR);
    store = new ArtifactStore(TEST_DIR);
    cache = new HotCache(100);
    snapshotManager = new StateSnapshotManager(db);
    invalidator = new Invalidator(db, store, cache);
  });

  afterEach(() => {
    db.close();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('should invalidate memory records by file path', () => {
    const artifact = store.createArtifact({
      type: 'file',
      content: 'original',
      sourceRepo: '/repo',
      sourcePath: '/repo/file.ts',
      sourceCommit: 'abc',
      sourceBranch: 'main',
    });

    db.prepare(`
      INSERT INTO MemoryRecord (id, subject, claim, artifact_id, scope, ttl_seconds, confidence, created_at, invalidated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('mem-1', '/repo/file.ts', 'file exports Foo', artifact.id, 'file', null, 0.9, Date.now(), null);

    db.prepare(`
      INSERT INTO Dependency (memory_id, depends_on, depends_on_hash)
      VALUES (?, ?, ?)
    `).run('mem-1', '/repo/file.ts', 'old-hash');

    const count = invalidator.invalidateByFilePath('/repo/file.ts', 'new-hash');
    expect(count).toBe(1);

    const record = db.prepare('SELECT * FROM MemoryRecord WHERE id = ?').get('mem-1') as any;
    expect(record.invalidated_at).not.toBeNull();
  });

  it('should invalidate all records for a branch on branch switch', () => {
    const artifact = store.createArtifact({
      type: 'tool_output',
      content: 'test output',
      sourceRepo: '/repo',
      sourcePath: null,
      sourceCommit: 'abc',
      sourceBranch: 'feature',
    });

    db.prepare(`
      INSERT INTO MemoryRecord (id, subject, claim, artifact_id, scope, ttl_seconds, confidence, created_at, invalidated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('mem-1', 'test result', 'tests pass', artifact.id, 'session', null, 0.8, Date.now(), null);

    const count = invalidator.invalidateByBranch('feature');
    expect(count).toBe(1);
  });

  it('should invalidate expired TTL records', () => {
    const artifact = store.createArtifact({
      type: 'tool_output',
      content: 'stale output',
      sourceRepo: '/repo',
      sourcePath: null,
      sourceCommit: 'abc',
      sourceBranch: 'main',
    });

    const oldTimestamp = Date.now() - 600_000;
    db.prepare(`
      INSERT INTO MemoryRecord (id, subject, claim, artifact_id, scope, ttl_seconds, confidence, created_at, invalidated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('mem-1', 'output', 'stale', artifact.id, 'session', 300, 0.7, oldTimestamp, null);

    const count = invalidator.invalidateExpiredTTL();
    expect(count).toBe(1);
  });

  it('should not invalidate records with future TTL', () => {
    const artifact = store.createArtifact({
      type: 'tool_output',
      content: 'fresh output',
      sourceRepo: '/repo',
      sourcePath: null,
      sourceCommit: 'abc',
      sourceBranch: 'main',
    });

    db.prepare(`
      INSERT INTO MemoryRecord (id, subject, claim, artifact_id, scope, ttl_seconds, confidence, created_at, invalidated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('mem-1', 'output', 'fresh', artifact.id, 'session', 300, 0.7, Date.now(), null);

    const count = invalidator.invalidateExpiredTTL();
    expect(count).toBe(0);
  });

  it('should remove invalidated items from hot cache', () => {
    const artifact = store.createArtifact({
      type: 'file',
      content: 'cached',
      sourceRepo: '/repo',
      sourcePath: '/repo/cached.ts',
      sourceCommit: 'abc',
      sourceBranch: 'main',
    });

    cache.set('/repo/cached.ts', { artifact, content: 'cached' });
    expect(cache.has('/repo/cached.ts')).toBe(true);

    invalidator.invalidateByFilePath('/repo/cached.ts', 'new-hash');
    expect(cache.has('/repo/cached.ts')).toBe(false);
  });
});
