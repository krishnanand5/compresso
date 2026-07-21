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

    for (const filePath of taskState.activeFiles) {
      const cached = this.cache.get(filePath);
      if (cached) {
        addUnique([cached]);
        continue;
      }

      const artifacts = this.store.queryBySourcePath(filePath);
      if (artifacts.length > 0) {
        const first = artifacts[0];
        if (first) {
          this.cache.set(filePath, first);
        }
        addUnique(artifacts);
      }
    }

    const branchArtifacts = this.store.queryByBranch(taskState.branch);
    addUnique(branchArtifacts);

    const commitArtifacts = this.store.queryByCommit(taskState.headCommit);
    addUnique(commitArtifacts);

    const recentToolOutputs = this.store.queryRecent('tool_output', 5);
    addUnique(recentToolOutputs);

    const recentDiffs = this.store.queryRecent('diff', 3);
    addUnique(recentDiffs);

    return results;
  }
}
