import { randomUUID, createHash } from 'crypto';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { initializeDatabase } from './db-schema.js';
import type { Artifact, ArtifactInput } from './types.js';
import type Database from 'better-sqlite3';

export interface ArtifactRecord {
  artifact: Artifact;
  content: string;
}

export class ArtifactStore {
  private db: Database.Database;
  private dbDir: string;

  constructor(dbDir: string) {
    this.dbDir = dbDir;
    this.db = initializeDatabase(dbDir);
  }

  createArtifact(input: ArtifactInput): Artifact {
    const id = randomUUID();
    const contentHash = createHash('sha256').update(input.content).digest('hex');
    const rawLocation = join(this.dbDir, 'raw', `${id}.txt`);
    const createdAt = Date.now();

    writeFileSync(rawLocation, input.content, 'utf-8');

    const artifact: Artifact = {
      id,
      type: input.type,
      contentHash,
      rawLocation,
      createdAt,
      sourceRepo: input.sourceRepo,
      sourcePath: input.sourcePath,
      sourceCommit: input.sourceCommit,
      sourceBranch: input.sourceBranch,
    };

    this.db.prepare(`
      INSERT INTO Artifact (id, type, content_hash, raw_location, created_at, source_repo, source_path, source_commit, source_branch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      artifact.id,
      artifact.type,
      artifact.contentHash,
      artifact.rawLocation,
      artifact.createdAt,
      artifact.sourceRepo,
      artifact.sourcePath,
      artifact.sourceCommit,
      artifact.sourceBranch,
    );

    return artifact;
  }

  getArtifact(id: string): ArtifactRecord | null {
    const row = this.db.prepare('SELECT * FROM Artifact WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToRecord(row);
  }

  queryBySourcePath(sourcePath: string): ArtifactRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM Artifact WHERE source_path = ? ORDER BY created_at DESC'
    ).all(sourcePath) as Record<string, unknown>[];
    return rows.map(r => this.rowToRecord(r));
  }

  queryByBranch(branch: string): ArtifactRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM Artifact WHERE source_branch = ? ORDER BY created_at DESC'
    ).all(branch) as Record<string, unknown>[];
    return rows.map(r => this.rowToRecord(r));
  }

  queryByCommit(commit: string): ArtifactRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM Artifact WHERE source_commit = ? ORDER BY created_at DESC'
    ).all(commit) as Record<string, unknown>[];
    return rows.map(r => this.rowToRecord(r));
  }

  queryRecent(type: string, limit: number): ArtifactRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM Artifact WHERE type = ? ORDER BY created_at DESC LIMIT ?'
    ).all(type, limit) as Record<string, unknown>[];
    return rows.map(r => this.rowToRecord(r));
  }

  deleteArtifact(id: string): void {
    const row = this.db.prepare('SELECT raw_location FROM Artifact WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (row && existsSync(row.raw_location as string)) {
      unlinkSync(row.raw_location as string);
    }
    this.db.prepare('DELETE FROM Artifact WHERE id = ?').run(id);
  }

  close(): void {
    this.db.close();
  }

  private rowToRecord(row: Record<string, unknown>): ArtifactRecord {
    const artifact: Artifact = {
      id: row.id as string,
      type: row.type as Artifact['type'],
      contentHash: row.content_hash as string,
      rawLocation: row.raw_location as string,
      createdAt: row.created_at as number,
      sourceRepo: row.source_repo as string,
      sourcePath: row.source_path as string | null,
      sourceCommit: row.source_commit as string | null,
      sourceBranch: row.source_branch as string | null,
    };
    const content = readFileSync(row.raw_location as string, 'utf-8');
    return { artifact, content };
  }
}
