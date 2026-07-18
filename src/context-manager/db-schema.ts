import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync } from 'fs';

export function initializeDatabase(dbDir: string): Database.Database {
  mkdirSync(dbDir, { recursive: true });
  mkdirSync(join(dbDir, 'raw'), { recursive: true });
  const dbPath = join(dbDir, 'artifacts.db');
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS Artifact (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('file', 'tool_output', 'diff', 'command')),
      content_hash TEXT NOT NULL,
      raw_location TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      source_repo TEXT NOT NULL,
      source_path TEXT,
      source_commit TEXT,
      source_branch TEXT
    );

    CREATE TABLE IF NOT EXISTS MemoryRecord (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      claim TEXT NOT NULL,
      artifact_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('session', 'repo', 'file')),
      ttl_seconds INTEGER,
      confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
      created_at INTEGER NOT NULL,
      invalidated_at INTEGER,
      FOREIGN KEY (artifact_id) REFERENCES Artifact(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS StateSnapshot (
      session_id TEXT PRIMARY KEY,
      branch TEXT NOT NULL,
      head_commit TEXT NOT NULL,
      active_task TEXT,
      active_files TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS Dependency (
      memory_id TEXT NOT NULL,
      depends_on TEXT NOT NULL,
      depends_on_hash TEXT NOT NULL,
      FOREIGN KEY (memory_id) REFERENCES MemoryRecord(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_artifact_source_path ON Artifact(source_path);
    CREATE INDEX IF NOT EXISTS idx_artifact_source_commit ON Artifact(source_commit);
    CREATE INDEX IF NOT EXISTS idx_artifact_source_branch ON Artifact(source_branch);
    CREATE INDEX IF NOT EXISTS idx_artifact_type ON Artifact(type);
    CREATE INDEX IF NOT EXISTS idx_artifact_created ON Artifact(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_subject ON MemoryRecord(subject);
    CREATE INDEX IF NOT EXISTS idx_memory_scope ON MemoryRecord(scope);
    CREATE INDEX IF NOT EXISTS idx_memory_invalidated ON MemoryRecord(invalidated_at);
    CREATE INDEX IF NOT EXISTS idx_memory_artifact ON MemoryRecord(artifact_id);
    CREATE INDEX IF NOT EXISTS idx_dependency_depends_on ON Dependency(depends_on);
    CREATE INDEX IF NOT EXISTS idx_dependency_memory ON Dependency(memory_id);
  `);

  return db;
}
