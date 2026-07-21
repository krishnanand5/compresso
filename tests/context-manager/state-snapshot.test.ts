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
