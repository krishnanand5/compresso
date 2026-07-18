import type Database from 'better-sqlite3';
import type { ArtifactStore } from './artifact-store.js';
import type { HotCache } from './hot-cache.js';

export class Invalidator {
  private db: Database.Database;
  private store: ArtifactStore;
  private cache: HotCache;

  constructor(db: Database.Database, store: ArtifactStore, cache: HotCache) {
    this.db = db;
    this.store = store;
    this.cache = cache;
  }

  invalidateByFilePath(filePath: string, newHash: string): number {
    const deps = this.db.prepare(
      'SELECT memory_id FROM Dependency WHERE depends_on = ? AND depends_on_hash != ?'
    ).all(filePath, newHash) as any[];

    let changes = 0;

    if (deps.length > 0) {
      const memoryIds = deps.map(d => d.memory_id);
      const placeholders = memoryIds.map(() => '?').join(',');
      const now = Date.now();

      const result = this.db.prepare(
        `UPDATE MemoryRecord SET invalidated_at = ? WHERE id IN (${placeholders}) AND invalidated_at IS NULL`
      ).run(now, ...memoryIds);

      changes = result.changes;
    }

    if (this.cache.has(filePath)) {
      this.cache.delete(filePath);
    }

    return changes;
  }

  invalidateByBranch(branch: string): number {
    const artifactIds = this.db.prepare(
      'SELECT id FROM Artifact WHERE source_branch = ?'
    ).all(branch) as any[];

    if (artifactIds.length === 0) return 0;

    const ids = artifactIds.map(a => a.id);
    const placeholders = ids.map(() => '?').join(',');
    const now = Date.now();

    const result = this.db.prepare(
      `UPDATE MemoryRecord SET invalidated_at = ? WHERE artifact_id IN (${placeholders}) AND invalidated_at IS NULL`
    ).run(now, ...ids);

    return result.changes;
  }

  invalidateByCommit(commit: string): number {
    const artifactIds = this.db.prepare(
      'SELECT id FROM Artifact WHERE source_commit = ?'
    ).all(commit) as any[];

    if (artifactIds.length === 0) return 0;

    const ids = artifactIds.map(a => a.id);
    const placeholders = ids.map(() => '?').join(',');
    const now = Date.now();

    const result = this.db.prepare(
      `UPDATE MemoryRecord SET invalidated_at = ? WHERE artifact_id IN (${placeholders}) AND invalidated_at IS NULL`
    ).run(now, ...ids);

    return result.changes;
  }

  invalidateExpiredTTL(): number {
    const now = Date.now();
    const result = this.db.prepare(`
      UPDATE MemoryRecord
      SET invalidated_at = ?
      WHERE ttl_seconds IS NOT NULL
        AND invalidated_at IS NULL
        AND (created_at + ttl_seconds * 1000) < ?
    `).run(now, now);

    return result.changes;
  }

  runAll(filePathHashes?: Map<string, string>): { fileInvalidated: number; branchInvalidated: number; ttlExpired: number } {
    let fileInvalidated = 0;

    if (filePathHashes) {
      for (const [path, hash] of filePathHashes) {
        fileInvalidated += this.invalidateByFilePath(path, hash);
      }
    }

    const ttlExpired = this.invalidateExpiredTTL();

    return {
      fileInvalidated,
      branchInvalidated: 0,
      ttlExpired,
    };
  }
}
