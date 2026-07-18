# Task 2 Report: SQLite Schema & ArtifactStore

## Status: DONE

## What was built

### 1. `src/context-manager/db-schema.ts` (70 lines)
- `initializeDatabase(dbDir)` function that creates the SQLite database with WAL mode
- 4 tables: Artifact, MemoryRecord, StateSnapshot, Dependency
- 11 indexes covering query patterns (source_path, source_branch, source_commit, type, created_at, memory lookups, dependencies)
- Foreign keys with ON DELETE CASCADE from MemoryRecord→Artifact and Dependency→MemoryRecord

### 2. `src/context-manager/artifact-store.ts` (121 lines)
- `ArtifactRecord` interface (artifact + content)
- `ArtifactStore` class with methods:
  - `createArtifact(input)` — generates UUID, SHA-256 hash, writes raw content to filesystem, inserts DB row
  - `getArtifact(id)` — retrieves by ID, reads raw content from disk
  - `queryBySourcePath(path)` — queries by source file path
  - `queryByBranch(branch)` — queries by git branch
  - `queryByCommit(commit)` — queries by commit hash
  - `queryRecent(type, limit)` — most recent N artifacts of a given type
  - `deleteArtifact(id)` — removes DB row and raw content file
  - `close()` — closes the database connection

### 3. `tests/context-manager/artifact-store.test.ts` (107 lines)
- 6 tests covering all CRUD and query operations

## Test Results
```
Test Files  1 passed (1)
Tests       6 passed (6)
```

## Typecheck
`pnpm run typecheck` — passed with no errors

## Notes
- Had to run `pnpm rebuild better-sqlite3` to compile native bindings (they weren't built for the current Node version)
- Used `Record<string, unknown>` instead of `any` for row types to satisfy strict TypeScript
- `verbatimModuleSyntax: true` respected — `import type` used for type-only imports
- All imports use `.js` extension per ESM convention

## Commit
`24c9a4c` — feat: implement SQLite-backed artifact store with CRUD and queries

---

## Review Fixes

### 1. Added `queryBySession(branch, commit)` method
- Queries artifacts by the combination of `source_branch` AND `source_commit`, which together identify a session's work
- Returns `ArtifactRecord[]` ordered by `created_at DESC`
- Added at `src/context-manager/artifact-store.ts:93-98`

### 2. Fixed atomicity in `createArtifact`
- Wrapped the DB INSERT in a try/catch block
- On DB failure, the raw file on disk is cleaned up via `unlinkSync` to prevent orphan files
- `writeFileSync` failure naturally propagates without leaving partial state

### 3. Added test for `queryBySession`
- Creates 4 artifacts: 2 matching the session (same branch + commit), 1 with different branch, 1 with different commit
- Asserts only the 2 matching artifacts are returned

### Test Results
```
Test Files  1 passed (1)
Tests       7 passed (7)
```

### Typecheck
`pnpm run typecheck` — passed with no errors

### Commit
`35496e8` — fix: add queryBySession method and atomicity guard in createArtifact
