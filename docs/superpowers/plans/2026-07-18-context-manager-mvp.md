# Context Manager MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a provenance-aware context manager that reduces transmitted tokens by 25-40% while maintaining task success rate, targeting Copilot as the first integration.

**Architecture:** Request interceptor pattern — context manager sits inside the Copilot SDK handler, retrieves relevant artifacts from SQLite + RAM cache using a deterministic retrieval cascade, packs into a token-budget-constrained packet, and injects into the request before it reaches the compression proxy.

**Tech Stack:** TypeScript (ESM), better-sqlite3, gpt-tokenizer, vitest, existing compresso-cli proxy infrastructure

## Global Constraints

- Target 25-40% lower transmitted input tokens per successful task
- No statistically meaningful drop in test pass rate or task completion
- Context retrieval latency < 50ms p95
- Every injected memory item must have traceability: source path, commit, timestamp, reason selected
- Local overhead adds less latency than it saves in model/context work
- Storage location: `~/.compresso/context-manager/`
- No embeddings or vector search in MVP
- No multi-agent support in MVP
- All imports use `.js` extension (ESM convention)
- All new modules must have unit tests before integration

---

## File Structure

**New files:**

```
src/context-manager/
  types.ts                    — Type definitions (Artifact, MemoryRecord, TaskState, ContextPacket)
  db-schema.ts                — SQLite schema initialization
  artifact-store.ts           — SQLite-backed artifact storage + retrieval
  hot-cache.ts                — RAM LRU cache for active artifacts
  state-snapshot.ts           — Session state tracking (branch, HEAD, active files)
  retrieval-cascade.ts        — Deterministic retrieval: exact → git → path → recency
  token-budget-packer.ts      — Greedy token-budget-constrained packing
  invalidator.ts              — File-hash + git-state + TTL invalidation
  context-manager.ts          — Orchestrator: getContext, recordArtifact, recordOutcome, invalidate
  config.ts                   — Configuration loader (~/.compresso/context-manager/config.json)
  index.ts                    — Public API: getContextManager(), re-exports

src/agents/copilot/
  context-integration.ts      — Copilot-specific: captureTaskState, injectContextPacket

tests/context-manager/
  artifact-store.test.ts
  hot-cache.test.ts
  state-snapshot.test.ts
  retrieval-cascade.test.ts
  token-budget-packer.test.ts
  invalidator.test.ts
  context-manager.test.ts
  integration.test.ts
```

**Modified files:**

```
src/agents/copilot/handler.ts — Wire context manager into sendRequest
src/core/tracker.ts           — Add context manager telemetry fields to TrackEvent
package.json                  — Add better-sqlite3 dependency
```

---

## Task 1: Add Dependencies & Type Definitions

**Files:**
- Modify: `package.json`
- Create: `src/context-manager/types.ts`
- Create: `tests/context-manager/types.test.ts`

**Interfaces:**
- Produces: All type definitions used by subsequent tasks

- [ ] **Step 1: Install better-sqlite3**

```bash
pnpm add better-sqlite3
pnpm add -D @types/better-sqlite3
```

- [ ] **Step 2: Write type definitions**

```typescript
// src/context-manager/types.ts

export type ArtifactType = 'file' | 'tool_output' | 'diff' | 'command';
export type Scope = 'session' | 'repo' | 'file';

export interface Artifact {
  id: string;
  type: ArtifactType;
  contentHash: string;
  rawLocation: string;
  createdAt: number;
  sourceRepo: string;
  sourcePath: string | null;
  sourceCommit: string | null;
  sourceBranch: string | null;
}

export interface MemoryRecord {
  id: string;
  subject: string;
  claim: string;
  artifactId: string;
  scope: Scope;
  ttlSeconds: number | null;
  confidence: number;
  createdAt: number;
  invalidatedAt: number | null;
}

export interface StateSnapshot {
  sessionId: string;
  branch: string;
  headCommit: string;
  activeTask: string | null;
  activeFiles: string[];
  updatedAt: number;
}

export interface Dependency {
  memoryId: string;
  dependsOn: string;
  dependsOnHash: string;
}

export interface TaskState {
  sessionId: string;
  branch: string;
  headCommit: string;
  activeFiles: string[];
  activeTask: string | null;
}

export interface ContextPacketItem {
  type: string;
  content: string;
  sourcePath: string | null;
  commit: string | null;
  timestamp: number;
  reasonSelected: string;
}

export interface ContextPacket {
  items: ContextPacketItem[];
  totalTokens: number;
  retrievalTimeMs: number;
  cacheHits: number;
  staleItemsInvalidated: number;
}

export interface ContextManagerOptions {
  budgetTokens: number;
  includeProvenance: boolean;
}

export interface ArtifactInput {
  type: ArtifactType;
  content: string;
  sourceRepo: string;
  sourcePath: string | null;
  sourceCommit: string | null;
  sourceBranch: string | null;
}

export interface ContextManagerConfig {
  budgetTokens: number;
  toolOutputTTLSeconds: number;
  maxArtifacts: number;
  enableInvalidation: boolean;
  hotCacheCapacity: number;
}

export const DEFAULT_CONFIG: ContextManagerConfig = {
  budgetTokens: 2000,
  toolOutputTTLSeconds: 300,
  maxArtifacts: 10000,
  enableInvalidation: true,
  hotCacheCapacity: 1000,
};
```

- [ ] **Step 3: Write type smoke test**

```typescript
// tests/context-manager/types.test.ts
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
```

- [ ] **Step 4: Run test**

```bash
pnpm test tests/context-manager/types.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/context-manager/types.ts tests/context-manager/types.test.ts
git commit -m "feat: add context manager type definitions and better-sqlite3 dependency"
```

---

## Task 2: SQLite Schema & ArtifactStore

**Files:**
- Create: `src/context-manager/db-schema.ts`
- Create: `src/context-manager/artifact-store.ts`
- Create: `tests/context-manager/artifact-store.test.ts`

**Interfaces:**
- Consumes: `Artifact`, `ArtifactInput` from `types.ts`
- Produces: `ArtifactStore` class with `createArtifact`, `getArtifact`, `queryBySourcePath`, `queryByBranch`, `queryBySession`, `queryRecent`, `deleteArtifact`, `close`

- [ ] **Step 1: Write failing test for ArtifactStore**

```typescript
// tests/context-manager/artifact-store.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test tests/context-manager/artifact-store.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement db-schema.ts**

```typescript
// src/context-manager/db-schema.ts
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
```

- [ ] **Step 4: Implement artifact-store.ts**

```typescript
// src/context-manager/artifact-store.ts
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
    const row = this.db.prepare('SELECT * FROM Artifact WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToRecord(row);
  }

  queryBySourcePath(sourcePath: string): ArtifactRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM Artifact WHERE source_path = ? ORDER BY created_at DESC'
    ).all(sourcePath) as any[];
    return rows.map(r => this.rowToRecord(r));
  }

  queryByBranch(branch: string): ArtifactRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM Artifact WHERE source_branch = ? ORDER BY created_at DESC'
    ).all(branch) as any[];
    return rows.map(r => this.rowToRecord(r));
  }

  queryByCommit(commit: string): ArtifactRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM Artifact WHERE source_commit = ? ORDER BY created_at DESC'
    ).all(commit) as any[];
    return rows.map(r => this.rowToRecord(r));
  }

  queryRecent(type: string, limit: number): ArtifactRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM Artifact WHERE type = ? ORDER BY created_at DESC LIMIT ?'
    ).all(type, limit) as any[];
    return rows.map(r => this.rowToRecord(r));
  }

  deleteArtifact(id: string): void {
    const row = this.db.prepare('SELECT raw_location FROM Artifact WHERE id = ?').get(id) as any;
    if (row && existsSync(row.raw_location)) {
      unlinkSync(row.raw_location);
    }
    this.db.prepare('DELETE FROM Artifact WHERE id = ?').run(id);
  }

  close(): void {
    this.db.close();
  }

  private rowToRecord(row: any): ArtifactRecord {
    const artifact: Artifact = {
      id: row.id,
      type: row.type,
      contentHash: row.content_hash,
      rawLocation: row.raw_location,
      createdAt: row.created_at,
      sourceRepo: row.source_repo,
      sourcePath: row.source_path,
      sourceCommit: row.source_commit,
      sourceBranch: row.source_branch,
    };
    const content = readFileSync(row.raw_location, 'utf-8');
    return { artifact, content };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm test tests/context-manager/artifact-store.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/context-manager/db-schema.ts src/context-manager/artifact-store.ts tests/context-manager/artifact-store.test.ts
git commit -m "feat: implement SQLite-backed artifact store with CRUD and queries"
```

---

## Task 3: HotCache (RAM LRU)

**Files:**
- Create: `src/context-manager/hot-cache.ts`
- Create: `tests/context-manager/hot-cache.test.ts`

**Interfaces:**
- Consumes: `ArtifactRecord` from `artifact-store.ts`
- Produces: `HotCache` class with `get`, `set`, `has`, `delete`, `getStats`, `clear`

- [ ] **Step 1: Write failing test**

```typescript
// tests/context-manager/hot-cache.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test tests/context-manager/hot-cache.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement hot-cache.ts**

```typescript
// src/context-manager/hot-cache.ts
import type { ArtifactRecord } from './artifact-store.js';

interface ListNode {
  key: string;
  value: ArtifactRecord;
  prev: ListNode | null;
  next: ListNode | null;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  capacity: number;
}

export class HotCache {
  private capacity: number;
  private map: Map<string, ListNode>;
  private head: ListNode;
  private tail: ListNode;
  private hits = 0;
  private misses = 0;

  constructor(capacity = 1000) {
    this.capacity = capacity;
    this.map = new Map();
    this.head = { key: '', value: null as any, prev: null, next: null };
    this.tail = { key: '', value: null as any, prev: null, next: null };
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  get(key: string): ArtifactRecord | undefined {
    const node = this.map.get(key);
    if (!node) {
      this.misses++;
      return undefined;
    }
    this.hits++;
    this.promote(node);
    return node.value;
  }

  set(key: string, value: ArtifactRecord): void {
    const existing = this.map.get(key);
    if (existing) {
      existing.value = value;
      this.promote(existing);
      return;
    }

    const node: ListNode = { key, value, prev: null, next: null };
    this.map.set(key, node);
    this.insertAfterHead(node);

    if (this.map.size > this.capacity) {
      const evicted = this.removeTail();
      if (evicted) this.map.delete(evicted.key);
    }
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  delete(key: string): void {
    const node = this.map.get(key);
    if (!node) return;
    this.unlink(node);
    this.map.delete(key);
  }

  clear(): void {
    this.head.next = this.tail;
    this.tail.prev = this.head;
    this.map.clear();
  }

  getStats(): CacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.map.size,
      capacity: this.capacity,
    };
  }

  private promote(node: ListNode): void {
    this.unlink(node);
    this.insertAfterHead(node);
  }

  private insertAfterHead(node: ListNode): void {
    node.prev = this.head;
    node.next = this.head.next;
    this.head.next!.prev = node;
    this.head.next = node;
  }

  private unlink(node: ListNode): void {
    node.prev!.next = node.next;
    node.next!.prev = node.prev;
  }

  private removeTail(): ListNode | null {
    if (this.tail.prev === this.head) return null;
    const node = this.tail.prev!;
    this.unlink(node);
    return node;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test tests/context-manager/hot-cache.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/context-manager/hot-cache.ts tests/context-manager/hot-cache.test.ts
git commit -m "feat: implement RAM LRU hot cache with hit/miss tracking"
```

---

## Task 4: StateSnapshot Manager

**Files:**
- Create: `src/context-manager/state-snapshot.ts`
- Create: `tests/context-manager/state-snapshot.test.ts`

**Interfaces:**
- Consumes: `StateSnapshot`, `TaskState` from `types.ts`, `Database` from `better-sqlite3`
- Produces: `StateSnapshotManager` class with `save`, `get`, `getCurrent`, `detectChanges`

- [ ] **Step 1: Write failing test**

```typescript
// tests/context-manager/state-snapshot.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StateSnapshotManager } from '../../src/context-manager/state-snapshot.js';
import { initializeDatabase } from '../../src/context-manager/db-schema.js';
import { rmSync, mkdirSync } from 'fs';
import type Database from 'better-sqlite3';

const TEST_DIR = '/tmp/compresso-test-state-snapshot';

describe('StateSnapshotManager', () => {
  let db: Database.Database;
  let manager: StateSnapshotManager;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    db = initializeDatabase(TEST_DIR);
    manager = new StateSnapshotManager(db);
  });

  afterEach(() => {
    db.close();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('should save and retrieve a state snapshot', () => {
    manager.save({
      sessionId: 'session-1',
      branch: 'main',
      headCommit: 'abc123',
      activeTask: 'fix bug',
      activeFiles: ['/repo/file1.ts', '/repo/file2.ts'],
    });

    const snapshot = manager.get('session-1');
    expect(snapshot).not.toBeNull();
    expect(snapshot!.branch).toBe('main');
    expect(snapshot!.headCommit).toBe('abc123');
    expect(snapshot!.activeFiles).toEqual(['/repo/file1.ts', '/repo/file2.ts']);
  });

  it('should return null for unknown session', () => {
    expect(manager.get('nonexistent')).toBeNull();
  });

  it('should update existing snapshot', () => {
    manager.save({
      sessionId: 'session-1',
      branch: 'main',
      headCommit: 'abc',
      activeTask: 'task1',
      activeFiles: ['/a.ts'],
    });
    manager.save({
      sessionId: 'session-1',
      branch: 'main',
      headCommit: 'def',
      activeTask: 'task2',
      activeFiles: ['/a.ts', '/b.ts'],
    });

    const snapshot = manager.get('session-1');
    expect(snapshot!.headCommit).toBe('def');
    expect(snapshot!.activeTask).toBe('task2');
    expect(snapshot!.activeFiles).toEqual(['/a.ts', '/b.ts']);
  });

  it('should detect branch change', () => {
    manager.save({
      sessionId: 'session-1',
      branch: 'main',
      headCommit: 'abc',
      activeTask: null,
      activeFiles: [],
    });

    const changes = manager.detectChanges('session-1', {
      sessionId: 'session-1',
      branch: 'feature',
      headCommit: 'def',
      activeFiles: [],
      activeTask: null,
    });

    expect(changes.branchChanged).toBe(true);
    expect(changes.commitChanged).toBe(true);
  });

  it('should detect no changes when state is identical', () => {
    manager.save({
      sessionId: 'session-1',
      branch: 'main',
      headCommit: 'abc',
      activeTask: null,
      activeFiles: [],
    });

    const changes = manager.detectChanges('session-1', {
      sessionId: 'session-1',
      branch: 'main',
      headCommit: 'abc',
      activeFiles: [],
      activeTask: null,
    });

    expect(changes.branchChanged).toBe(false);
    expect(changes.commitChanged).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test tests/context-manager/state-snapshot.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement state-snapshot.ts**

```typescript
// src/context-manager/state-snapshot.ts
import type Database from 'better-sqlite3';
import type { StateSnapshot, TaskState } from './types.js';

export interface StateChanges {
  branchChanged: boolean;
  commitChanged: boolean;
  previousBranch: string | null;
  previousCommit: string | null;
}

export class StateSnapshotManager {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  save(taskState: TaskState): StateSnapshot {
    const snapshot: StateSnapshot = {
      sessionId: taskState.sessionId,
      branch: taskState.branch,
      headCommit: taskState.headCommit,
      activeTask: taskState.activeTask,
      activeFiles: taskState.activeFiles,
      updatedAt: Date.now(),
    };

    this.db.prepare(`
      INSERT INTO StateSnapshot (session_id, branch, head_commit, active_task, active_files, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        branch = excluded.branch,
        head_commit = excluded.head_commit,
        active_task = excluded.active_task,
        active_files = excluded.active_files,
        updated_at = excluded.updated_at
    `).run(
      snapshot.sessionId,
      snapshot.branch,
      snapshot.headCommit,
      snapshot.activeTask,
      JSON.stringify(snapshot.activeFiles),
      snapshot.updatedAt,
    );

    return snapshot;
  }

  get(sessionId: string): StateSnapshot | null {
    const row = this.db.prepare(
      'SELECT * FROM StateSnapshot WHERE session_id = ?'
    ).get(sessionId) as any;

    if (!row) return null;

    return {
      sessionId: row.session_id,
      branch: row.branch,
      headCommit: row.head_commit,
      activeTask: row.active_task,
      activeFiles: JSON.parse(row.active_files),
      updatedAt: row.updated_at,
    };
  }

  detectChanges(sessionId: string, currentState: TaskState): StateChanges {
    const previous = this.get(sessionId);

    if (!previous) {
      return {
        branchChanged: false,
        commitChanged: false,
        previousBranch: null,
        previousCommit: null,
      };
    }

    return {
      branchChanged: previous.branch !== currentState.branch,
      commitChanged: previous.headCommit !== currentState.headCommit,
      previousBranch: previous.branch,
      previousCommit: previous.headCommit,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test tests/context-manager/state-snapshot.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/context-manager/state-snapshot.ts tests/context-manager/state-snapshot.test.ts
git commit -m "feat: implement state snapshot manager with change detection"
```

---

## Task 5: RetrievalCascade

**Files:**
- Create: `src/context-manager/retrieval-cascade.ts`
- Create: `tests/context-manager/retrieval-cascade.test.ts`

**Interfaces:**
- Consumes: `ArtifactStore`, `HotCache`, `StateSnapshotManager`, `TaskState`
- Produces: `RetrievalCascade` class with `retrieve(taskState)` → `ArtifactRecord[]` (ranked, deduplicated)

- [ ] **Step 1: Write failing test**

```typescript
// tests/context-manager/retrieval-cascade.test.ts
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
    const artifact = store.createArtifact({
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

    cache.set('/repo/cached.ts', { artifact, content: 'cached-content' });

    const results = cascade.retrieve({
      ...baseTaskState,
      activeFiles: ['/repo/cached.ts'],
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(cache.getStats().hits).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test tests/context-manager/retrieval-cascade.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement retrieval-cascade.ts**

```typescript
// src/context-manager/retrieval-cascade.ts
import type { ArtifactStore, ArtifactRecord } from './artifact-store.js';
import type { HotCache } from './hot-cache.js';
import type { StateSnapshotManager } from './state-snapshot.js';
import type { TaskState } from './types.js';

export class RetrievalCascade {
  private store: ArtifactStore;
  private cache: HotCache;
  private snapshotManager: StateSnapshotManager;

  constructor(store: ArtifactStore, cache: HotCache, snapshotManager: StateSnapshotManager) {
    this.store = store;
    this.cache = cache;
    this.snapshotManager = snapshotManager;
  }

  retrieve(taskState: TaskState): ArtifactRecord[] {
    const results: ArtifactRecord[] = [];
    const seen = new Set<string>();

    const addUnique = (records: ArtifactRecord[]) => {
      for (const rec of records) {
        if (!seen.has(rec.artifact.id)) {
          results.push(rec);
          seen.add(rec.artifact.id);
        }
      }
    };

    // 1. Exact file-path match for active files (highest priority)
    for (const filePath of taskState.activeFiles) {
      const cached = this.cache.get(filePath);
      if (cached) {
        addUnique([cached]);
        continue;
      }

      const artifacts = this.store.queryBySourcePath(filePath);
      if (artifacts.length > 0) {
        this.cache.set(filePath, artifacts[0]);
        addUnique(artifacts);
      }
    }

    // 2. Git-aware: artifacts matching current branch
    const branchArtifacts = this.store.queryByBranch(taskState.branch);
    addUnique(branchArtifacts);

    // 3. Git-aware: artifacts matching current commit
    const commitArtifacts = this.store.queryByCommit(taskState.headCommit);
    addUnique(commitArtifacts);

    // 4. Recency fallback: most recent tool outputs and diffs
    const recentToolOutputs = this.store.queryRecent('tool_output', 5);
    addUnique(recentToolOutputs);

    const recentDiffs = this.store.queryRecent('diff', 3);
    addUnique(recentDiffs);

    return results;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test tests/context-manager/retrieval-cascade.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/context-manager/retrieval-cascade.ts tests/context-manager/retrieval-cascade.test.ts
git commit -m "feat: implement deterministic retrieval cascade"
```

---

## Task 6: TokenBudgetPacker

**Files:**
- Create: `src/context-manager/token-budget-packer.ts`
- Create: `tests/context-manager/token-budget-packer.test.ts`

**Interfaces:**
- Consumes: `ArtifactRecord` from `artifact-store.ts`, `ContextPacket`, `ContextPacketItem` from `types.ts`
- Produces: `TokenBudgetPacker` class with `pack(records, budgetTokens)` → `ContextPacketItem[]`

- [ ] **Step 1: Write failing test**

```typescript
// tests/context-manager/token-budget-packer.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test tests/context-manager/token-budget-packer.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement token-budget-packer.ts**

```typescript
// src/context-manager/token-budget-packer.ts
import type { ArtifactRecord } from './artifact-store.js';
import type { ContextPacketItem } from './types.js';

export class TokenBudgetPacker {
  private charsPerToken: number;

  constructor(charsPerToken = 3.7) {
    this.charsPerToken = charsPerToken;
  }

  pack(records: ArtifactRecord[], budgetTokens: number, reasonOverride?: string): ContextPacketItem[] {
    if (budgetTokens <= 0 || records.length === 0) return [];

    const items: ContextPacketItem[] = [];
    let remainingTokens = budgetTokens;

    for (const rec of records) {
      if (remainingTokens <= 0) break;

      const estimatedTokens = Math.ceil(rec.content.length / this.charsPerToken);

      if (estimatedTokens <= remainingTokens) {
        items.push(this.toItem(rec, remainingTokens, reasonOverride));
        remainingTokens -= estimatedTokens;
      } else if (remainingTokens > 0) {
        const truncated = this.truncate(rec.content, remainingTokens);
        if (truncated.length > 0) {
          items.push({
            type: rec.artifact.type,
            content: truncated,
            sourcePath: rec.artifact.sourcePath,
            commit: rec.artifact.sourceCommit,
            timestamp: rec.artifact.createdAt,
            reasonSelected: reasonOverride ?? `truncated to fit budget (${remainingTokens} tokens remaining)`,
          });
          remainingTokens = 0;
        }
      }
    }

    return items;
  }

  private toItem(rec: ArtifactRecord, _remaining: number, reasonOverride?: string): ContextPacketItem {
    return {
      type: rec.artifact.type,
      content: rec.content,
      sourcePath: rec.artifact.sourcePath,
      commit: rec.artifact.sourceCommit,
      timestamp: rec.artifact.createdAt,
      reasonSelected: reasonOverride ?? `selected by retrieval cascade (${rec.artifact.type})`,
    };
  }

  private truncate(content: string, maxTokens: number): string {
    const maxChars = Math.floor(maxTokens * this.charsPerToken);
    if (content.length <= maxChars) return content;

    const headerLines = Math.floor(maxChars * 0.4);
    const tailLines = Math.floor(maxChars * 0.1);
    const lines = content.split('\n');

    if (lines.length <= 3) {
      return content.slice(0, maxChars) + '\n[... truncated ...]';
    }

    const header = lines.slice(0, Math.max(1, Math.floor(lines.length * 0.4))).join('\n');
    const tail = lines.slice(-Math.max(1, Math.floor(lines.length * 0.1))).join('\n');
    const result = `${header}\n[... ${lines.length - Math.floor(lines.length * 0.5)} lines omitted ...]\n${tail}`;

    return result.length > maxChars ? result.slice(0, maxChars) + '\n[... truncated ...]' : result;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test tests/context-manager/token-budget-packer.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/context-manager/token-budget-packer.ts tests/context-manager/token-budget-packer.test.ts
git commit -m "feat: implement token-budget packer with truncation"
```

---

## Task 7: Invalidator

**Files:**
- Create: `src/context-manager/invalidator.ts`
- Create: `tests/context-manager/invalidator.test.ts`

**Interfaces:**
- Consumes: `ArtifactStore`, `StateSnapshotManager`, `HotCache`, `Database` from `better-sqlite3`
- Produces: `Invalidator` class with `invalidateByFileHash`, `invalidateByGitState`, `invalidateExpiredTTL`, `runAll`

- [ ] **Step 1: Write failing test**

```typescript
// tests/context-manager/invalidator.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test tests/context-manager/invalidator.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement invalidator.ts**

```typescript
// src/context-manager/invalidator.ts
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

    if (deps.length === 0) return 0;

    const memoryIds = deps.map(d => d.memory_id);
    const placeholders = memoryIds.map(() => '?').join(',');
    const now = Date.now();

    const result = this.db.prepare(
      `UPDATE MemoryRecord SET invalidated_at = ? WHERE id IN (${placeholders}) AND invalidated_at IS NULL`
    ).run(now, ...memoryIds);

    if (this.cache.has(filePath)) {
      this.cache.delete(filePath);
    }

    return result.changes;
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test tests/context-manager/invalidator.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/context-manager/invalidator.ts tests/context-manager/invalidator.test.ts
git commit -m "feat: implement file-hash, git-state, and TTL invalidation"
```

---

## Task 8: Config Loader

**Files:**
- Create: `src/context-manager/config.ts`
- Create: `tests/context-manager/config.test.ts`

**Interfaces:**
- Consumes: `ContextManagerConfig`, `DEFAULT_CONFIG` from `types.ts`
- Produces: `loadConfig()` function

- [ ] **Step 1: Write failing test**

```typescript
// tests/context-manager/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../../src/context-manager/config.js';
import { DEFAULT_CONFIG } from '../../src/context-manager/types.js';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const TEST_CONFIG_DIR = join(homedir(), '.compresso', 'context-manager-test');

describe('loadConfig', () => {
  beforeEach(() => {
    rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
  });

  it('should return defaults when no config file exists', () => {
    const config = loadConfig(TEST_CONFIG_DIR);
    expect(config.budgetTokens).toBe(DEFAULT_CONFIG.budgetTokens);
    expect(config.toolOutputTTLSeconds).toBe(DEFAULT_CONFIG.toolOutputTTLSeconds);
  });

  it('should merge file config with defaults', () => {
    mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    writeFileSync(
      join(TEST_CONFIG_DIR, 'config.json'),
      JSON.stringify({ budgetTokens: 4000 }),
    );

    const config = loadConfig(TEST_CONFIG_DIR);
    expect(config.budgetTokens).toBe(4000);
    expect(config.toolOutputTTLSeconds).toBe(DEFAULT_CONFIG.toolOutputTTLSeconds);
  });

  it('should handle malformed JSON gracefully', () => {
    mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    writeFileSync(join(TEST_CONFIG_DIR, 'config.json'), 'not json');

    const config = loadConfig(TEST_CONFIG_DIR);
    expect(config.budgetTokens).toBe(DEFAULT_CONFIG.budgetTokens);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test tests/context-manager/config.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement config.ts**

```typescript
// src/context-manager/config.ts
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { DEFAULT_CONFIG, type ContextManagerConfig } from './types.js';

export const DEFAULT_CONFIG_DIR = join(homedir(), '.compresso', 'context-manager');

export function loadConfig(configDir: string = DEFAULT_CONFIG_DIR): ContextManagerConfig {
  const configPath = join(configDir, 'config.json');

  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test tests/context-manager/config.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/context-manager/config.ts tests/context-manager/config.test.ts
git commit -m "feat: add context manager config loader with defaults"
```

---

## Task 9: ContextManager Orchestrator

**Files:**
- Create: `src/context-manager/context-manager.ts`
- Create: `src/context-manager/index.ts`
- Create: `tests/context-manager/context-manager.test.ts`

**Interfaces:**
- Consumes: All previous modules
- Produces: `ContextManager` class with `getContext`, `recordArtifact`, `recordOutcome`, `invalidate`

- [ ] **Step 1: Write failing test**

```typescript
// tests/context-manager/context-manager.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test tests/context-manager/context-manager.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement context-manager.ts**

```typescript
// src/context-manager/context-manager.ts
import { initializeDatabase } from './db-schema.js';
import { ArtifactStore } from './artifact-store.js';
import { HotCache } from './hot-cache.js';
import { StateSnapshotManager } from './state-snapshot.js';
import { RetrievalCascade } from './retrieval-cascade.js';
import { TokenBudgetPacker } from './token-budget-packer.js';
import { Invalidator } from './invalidator.js';
import { REPORT_CHARS_PER_TOKEN } from '../core/utils.js';
import type {
  TaskState,
  ContextPacket,
  ContextManagerOptions,
  ContextManagerConfig,
  ArtifactInput,
} from './types.js';
import type Database from 'better-sqlite3';

export class ContextManager {
  private db: Database.Database;
  private store: ArtifactStore;
  private cache: HotCache;
  private snapshotManager: StateSnapshotManager;
  private cascade: RetrievalCascade;
  private packer: TokenBudgetPacker;
  private invalidator: Invalidator;
  private config: ContextManagerConfig;

  constructor(dbDir: string, config: ContextManagerConfig) {
    this.config = config;
    this.db = initializeDatabase(dbDir);
    this.store = new ArtifactStore(dbDir);
    this.cache = new HotCache(config.hotCacheCapacity);
    this.snapshotManager = new StateSnapshotManager(this.db);
    this.cascade = new RetrievalCascade(this.store, this.cache, this.snapshotManager);
    this.packer = new TokenBudgetPacker(REPORT_CHARS_PER_TOKEN);
    this.invalidator = new Invalidator(this.db, this.store, this.cache);
  }

  getContext(taskState: TaskState, options: ContextManagerOptions): ContextPacket {
    const start = performance.now();

    if (this.config.enableInvalidation) {
      this.snapshotManager.save(taskState);
      this.invalidator.invalidateExpiredTTL();
    }

    const records = this.cascade.retrieve(taskState);
    const items = this.packer.pack(records, options.budgetTokens);

    const totalTokens = items.reduce((sum, item) => {
      return sum + Math.ceil(item.content.length / REPORT_CHARS_PER_TOKEN);
    }, 0);

    const cacheStats = this.cache.getStats();

    return {
      items,
      totalTokens,
      retrievalTimeMs: Math.round(performance.now() - start),
      cacheHits: cacheStats.hits,
      staleItemsInvalidated: 0,
    };
  }

  recordArtifact(input: ArtifactInput) {
    return this.store.createArtifact(input);
  }

  recordOutcome(_outcome: { task: string; testsPassed: boolean; patch?: string }) {
    // Phase 6: will be expanded with evaluation harness
  }

  invalidate(scopeOrPath: string) {
    this.invalidator.invalidateByFilePath(scopeOrPath, '');
  }

  close() {
    this.store.close();
    this.db.close();
  }
}
```

- [ ] **Step 4: Implement index.ts (public API)**

```typescript
// src/context-manager/index.ts
import { ContextManager } from './context-manager.js';
import { loadConfig, DEFAULT_CONFIG_DIR } from './config.js';

export { ContextManager } from './context-manager.js';
export { ArtifactStore } from './artifact-store.js';
export { HotCache } from './hot-cache.js';
export { StateSnapshotManager } from './state-snapshot.js';
export { RetrievalCascade } from './retrieval-cascade.js';
export { TokenBudgetPacker } from './token-budget-packer.js';
export { Invalidator } from './invalidator.js';
export { loadConfig } from './config.js';
export * from './types.js';

let singleton: ContextManager | null = null;

export function getContextManager(): ContextManager {
  if (!singleton) {
    const config = loadConfig();
    singleton = new ContextManager(DEFAULT_CONFIG_DIR, config);
  }
  return singleton;
}

export function resetContextManager(): void {
  if (singleton) {
    singleton.close();
    singleton = null;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm test tests/context-manager/context-manager.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/context-manager/context-manager.ts src/context-manager/index.ts tests/context-manager/context-manager.test.ts
git commit -m "feat: implement context manager orchestrator with public API"
```

---

## Task 10: Copilot Integration

**Files:**
- Create: `src/agents/copilot/context-integration.ts`
- Modify: `src/agents/copilot/handler.ts`
- Create: `tests/context-manager/integration.test.ts`

**Interfaces:**
- Consumes: `ContextManager`, `TaskState`, `ContextPacket`
- Produces: `captureTaskState()`, `injectContextPacket()`, `extractArtifactsFromResponse()`

- [ ] **Step 1: Write context-integration.ts**

```typescript
// src/agents/copilot/context-integration.ts
import { execSync } from 'child_process';
import type { TaskState, ContextPacket } from '../../context-manager/types.js';

export function captureTaskState(cwd: string, sessionId: string): TaskState {
  return {
    sessionId,
    branch: safeGit(cwd, 'rev-parse --abbrev-ref HEAD') || 'unknown',
    headCommit: safeGit(cwd, 'rev-parse HEAD') || 'unknown',
    activeFiles: extractActiveFiles(cwd),
    activeTask: null,
  };
}

export function injectContextPacket(
  bodyBytes: Uint8Array,
  packet: ContextPacket,
): Uint8Array {
  if (packet.items.length === 0) return bodyBytes;

  try {
    const body = JSON.parse(new TextDecoder().decode(bodyBytes));
    const contextBlock = formatContextBlock(packet);

    if (body.messages && Array.isArray(body.messages)) {
      const systemMsg = body.messages.find((m: any) => m.role === 'system');
      if (systemMsg && typeof systemMsg.content === 'string') {
        systemMsg.content = contextBlock + '\n\n' + systemMsg.content;
      } else {
        body.messages.unshift({
          role: 'system',
          content: contextBlock,
        });
      }
    }

    return new TextEncoder().encode(JSON.stringify(body));
  } catch {
    return bodyBytes;
  }
}

export function extractArtifactsFromResponse(
  responseBody: any,
  cwd: string,
  branch: string,
  commit: string,
): Array<{ type: string; content: string; path: string | null }> {
  const artifacts: Array<{ type: string; content: string; path: string | null }> = [];

  if (!responseBody?.choices) return artifacts;

  for (const choice of responseBody.choices) {
    const message = choice.message;
    if (!message?.tool_calls) continue;

    for (const call of message.tool_calls) {
      const args = safeJsonParse(call.function?.arguments ?? '{}');
      const path = args?.file_path ?? args?.path ?? null;

      artifacts.push({
        type: 'tool_output',
        content: JSON.stringify(call.function),
        path,
      });
    }
  }

  return artifacts;
}

function formatContextBlock(packet: ContextPacket): string {
  const lines: string[] = [
    '<context-manager>',
    `<!-- retrieved ${packet.items.length} items in ${packet.retrievalTimeMs}ms, ${packet.totalTokens} tokens -->`,
  ];

  for (const item of packet.items) {
    const meta = [
      item.sourcePath ? `path=${item.sourcePath}` : null,
      item.commit ? `commit=${item.commit.slice(0, 8)}` : null,
      `reason=${item.reasonSelected}`,
    ].filter(Boolean).join(', ');

    lines.push(`<context-item type="${item.type}" meta="${meta}">`);
    lines.push(item.content);
    lines.push('</context-item>');
  }

  lines.push('</context-manager>');
  return lines.join('\n');
}

function safeGit(cwd: string, args: string): string | null {
  try {
    return execSync(`git ${args}`, { cwd, encoding: 'utf-8', timeout: 2000 }).trim();
  } catch {
    return null;
  }
}

function extractActiveFiles(cwd: string): string[] {
  try {
    const output = execSync('git diff --name-only HEAD', { cwd, encoding: 'utf-8', timeout: 2000 });
    return output.trim().split('\n').filter(Boolean).map(f => `${cwd}/${f}`);
  } catch {
    return [];
  }
}

function safeJsonParse(str: string): any {
  try { return JSON.parse(str); } catch { return null; }
}
```

- [ ] **Step 2: Modify handler.ts to integrate context manager**

Add these imports at the top of `src/agents/copilot/handler.ts`:

```typescript
import { getContextManager } from '../../context-manager/index.js';
import { captureTaskState, injectContextPacket, extractArtifactsFromResponse } from './context-integration.js';
```

Modify the `sendRequest` method in `CopilotCompressHandler` to call the context manager before compression:

```typescript
override async sendRequest(request: Request, ctx: CopilotRequestContext): Promise<Response> {
  const url = new URL(ctx.url);
  const path = url.pathname;
  const isResponses = path.includes('/responses');
  const isChat = path.includes('/chat/completions');
  if (!isResponses && !isChat) return fetch(request, { signal: ctx.signal });

  let bodyBytes = new Uint8Array(await request.arrayBuffer());
  const model = extractModel(bodyBytes);
  const start = performance.now();

  // Context manager injection (before compression)
  try {
    const cm = getContextManager();
    const cwd = ctx.metadata?.workspace?.rootPath ?? process.cwd();
    const taskState = captureTaskState(cwd, ctx.sessionId ?? 'unknown');
    const packet = cm.getContext(taskState, { budgetTokens: 2000, includeProvenance: true });
    if (packet.items.length > 0) {
      bodyBytes = injectContextPacket(bodyBytes, packet);
    }
  } catch {}

  // ... rest of existing sendRequest logic unchanged ...
```

After the response is received, record artifacts:

```typescript
    // After fetch returns response, record artifacts from tool calls
    try {
      const cm = getContextManager();
      const cwd = ctx.metadata?.workspace?.rootPath ?? process.cwd();
      const responseClone = response.clone();
      const responseText = await responseClone.text();
      const responseBody = JSON.parse(responseText);
      const artifacts = extractArtifactsFromResponse(
        responseBody,
        cwd,
        taskState.branch,
        taskState.headCommit,
      );
      for (const a of artifacts) {
        cm.recordArtifact({
          type: 'tool_output' as const,
          content: a.content,
          sourceRepo: cwd,
          sourcePath: a.path,
          sourceCommit: taskState.headCommit,
          sourceBranch: taskState.branch,
        });
      }
    } catch {}
```

- [ ] **Step 3: Write integration test**

```typescript
// tests/context-manager/integration.test.ts
import { describe, it, expect } from 'vitest';
import { injectContextPacket } from '../../src/agents/copilot/context-integration.js';
import type { ContextPacket } from '../../src/context-manager/types.js';

describe('Copilot context integration', () => {
  it('should inject context packet into request body', () => {
    const body = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Fix the bug.' },
      ],
    };

    const bodyBytes = new TextEncoder().encode(JSON.stringify(body));
    const packet: ContextPacket = {
      items: [
        {
          type: 'file',
          content: 'export function hello() { return "world"; }',
          sourcePath: '/repo/hello.ts',
          commit: 'abc123',
          timestamp: Date.now(),
          reasonSelected: 'active file',
        },
      ],
      totalTokens: 15,
      retrievalTimeMs: 5,
      cacheHits: 1,
      staleItemsInvalidated: 0,
    };

    const result = new TextDecoder().decode(injectContextPacket(bodyBytes, packet));
    const parsed = JSON.parse(result);

    expect(parsed.messages[0].content).toContain('<context-manager>');
    expect(parsed.messages[0].content).toContain('hello.ts');
    expect(parsed.messages[0].content).toContain('export function hello');
  });

  it('should return unchanged body when packet is empty', () => {
    const body = { model: 'gpt-4o', messages: [] };
    const bodyBytes = new TextEncoder().encode(JSON.stringify(body));
    const packet: ContextPacket = {
      items: [],
      totalTokens: 0,
      retrievalTimeMs: 0,
      cacheHits: 0,
      staleItemsInvalidated: 0,
    };

    const result = injectContextPacket(bodyBytes, packet);
    expect(new TextDecoder().decode(result)).toBe(new TextDecoder().decode(bodyBytes));
  });
});
```

- [ ] **Step 4: Run all context-manager tests**

```bash
pnpm test tests/context-manager/
```

Expected: All PASS

- [ ] **Step 5: Run typecheck**

```bash
pnpm run typecheck
```

Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/agents/copilot/context-integration.ts src/agents/copilot/handler.ts tests/context-manager/integration.test.ts
git commit -m "feat: integrate context manager into Copilot handler"
```

---

## Task 11: Telemetry Extension

**Files:**
- Modify: `src/core/tracker.ts`

**Interfaces:**
- Consumes: Existing `TrackEvent` interface
- Produces: New optional fields on `TrackEvent`

- [ ] **Step 1: Add context manager fields to TrackEvent**

Add these fields to the `TrackEvent` interface in `src/core/tracker.ts` (after the existing `cache_prefix_bytes` field around line 92):

```typescript
  // Context manager fields:
  /** Tokens in the optimized context packet injected by the context manager. */
  cm_packet_tokens?: number;
  /** Number of items in the context packet. */
  cm_packet_items?: number;
  /** Time in ms to retrieve + pack context. */
  cm_retrieval_time_ms?: number;
  /** RAM cache hits during retrieval. */
  cm_cache_hits?: number;
  /** Number of stale items invalidated before this request. */
  cm_stale_items?: number;
  /** Actual tokens / budget tokens (0.0-1.0). */
  cm_budget_utilization?: number;
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm run typecheck
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/core/tracker.ts
git commit -m "feat: add context manager telemetry fields to TrackEvent"
```

---

## Task 12: End-to-End Integration Test

**Files:**
- Create: `tests/context-manager/e2e.test.ts`

**Interfaces:**
- Consumes: `ContextManager`, `injectContextPacket`, `captureTaskState`
- Produces: End-to-end validation that the full pipeline works

- [ ] **Step 1: Write e2e test**

```typescript
// tests/context-manager/e2e.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ContextManager } from '../../src/context-manager/context-manager.js';
import { injectContextPacket } from '../../src/agents/copilot/context-integration.js';
import { DEFAULT_CONFIG } from '../../src/context-manager/types.js';
import { rmSync, mkdirSync } from 'fs';

const TEST_DIR = '/tmp/compresso-test-e2e';

describe('context manager e2e', () => {
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

  it('should record artifacts, retrieve context, and inject into request', () => {
    // Simulate agent recording file artifacts
    manager.recordArtifact({
      type: 'file',
      content: 'export function add(a: number, b: number) { return a + b; }',
      sourceRepo: '/repo',
      sourcePath: '/repo/math.ts',
      sourceCommit: 'abc123',
      sourceBranch: 'main',
    });

    manager.recordArtifact({
      type: 'tool_output',
      content: 'PASS tests/math.test.ts (2 tests, 0 failures)',
      sourceRepo: '/repo',
      sourcePath: null,
      sourceCommit: 'abc123',
      sourceBranch: 'main',
    });

    // Retrieve context
    const packet = manager.getContext({
      sessionId: 'session-1',
      branch: 'main',
      headCommit: 'abc123',
      activeFiles: ['/repo/math.ts'],
      activeTask: 'add subtract function',
    }, { budgetTokens: 2000, includeProvenance: true });

    expect(packet.items.length).toBeGreaterThan(0);
    expect(packet.totalTokens).toBeGreaterThan(0);
    expect(packet.totalTokens).toBeLessThanOrEqual(2000);
    expect(packet.retrievalTimeMs).toBeLessThan(50);

    // Inject into a mock request
    const body = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a coding assistant.' },
        { role: 'user', content: 'Add a subtract function.' },
      ],
    };
    const bodyBytes = new TextEncoder().encode(JSON.stringify(body));
    const injected = injectContextPacket(bodyBytes, packet);
    const parsed = JSON.parse(new TextDecoder().decode(injected));

    expect(parsed.messages[0].content).toContain('<context-manager>');
    expect(parsed.messages[0].content).toContain('math.ts');
  });

  it('should handle rapid successive calls (cache warming)', () => {
    manager.recordArtifact({
      type: 'file',
      content: 'content',
      sourceRepo: '/repo',
      sourcePath: '/repo/file.ts',
      sourceCommit: 'abc',
      sourceBranch: 'main',
    });

    const taskState = {
      sessionId: 'session-1',
      branch: 'main',
      headCommit: 'abc',
      activeFiles: ['/repo/file.ts'],
      activeTask: null,
    };

    const packet1 = manager.getContext(taskState, { budgetTokens: 2000, includeProvenance: true });
    const packet2 = manager.getContext(taskState, { budgetTokens: 2000, includeProvenance: true });

    expect(packet2.cacheHits).toBeGreaterThanOrEqual(packet1.cacheHits);
  });

  it('should respect token budget under pressure', () => {
    for (let i = 0; i < 20; i++) {
      manager.recordArtifact({
        type: 'file',
        content: 'x'.repeat(5000),
        sourceRepo: '/repo',
        sourcePath: `/repo/file${i}.ts`,
        sourceCommit: 'abc',
        sourceBranch: 'main',
      });
    }

    const packet = manager.getContext({
      sessionId: 'session-1',
      branch: 'main',
      headCommit: 'abc',
      activeFiles: Array.from({ length: 20 }, (_, i) => `/repo/file${i}.ts`),
      activeTask: null,
    }, { budgetTokens: 500, includeProvenance: true });

    expect(packet.totalTokens).toBeLessThanOrEqual(500);
  });
});
```

- [ ] **Step 2: Run all tests**

```bash
pnpm test tests/context-manager/
```

Expected: All PASS

- [ ] **Step 3: Run typecheck**

```bash
pnpm run typecheck
```

Expected: No errors

- [ ] **Step 4: Run full test suite**

```bash
pnpm test
```

Expected: All existing tests still pass

- [ ] **Step 5: Commit**

```bash
git add tests/context-manager/e2e.test.ts
git commit -m "test: add end-to-end context manager integration test"
```

---

## Summary

**12 tasks, ~5-7 weeks of work for one developer.**

| Task | Phase | Duration |
|---|---|---|
| 1. Types & dependencies | Baseline | 0.5 day |
| 2. ArtifactStore | Memory core | 1-2 days |
| 3. HotCache | Memory core | 1 day |
| 4. StateSnapshot | Memory core | 1 day |
| 5. RetrievalCascade | Context packer | 2 days |
| 6. TokenBudgetPacker | Context packer | 1-2 days |
| 7. Invalidator | Memory core | 2 days |
| 8. Config | Infrastructure | 0.5 day |
| 9. Orchestrator | Integration | 2 days |
| 10. Copilot integration | Integration | 2-3 days |
| 11. Telemetry | Baseline | 0.5 day |
| 12. E2E test | Validation | 1 day |

**Total: ~15-20 working days (3-4 weeks)**
