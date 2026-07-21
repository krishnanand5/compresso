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
