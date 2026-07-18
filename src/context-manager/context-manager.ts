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
    this.invalidator = new Invalidator(this.db, this.cache);
  }

  getContext(taskState: TaskState, options: ContextManagerOptions): ContextPacket {
    const start = performance.now();

    if (this.config.enableInvalidation) {
      this.snapshotManager.save(taskState);
      this.invalidator.invalidateExpiredTTL();
    }

    const records = this.cascade.retrieve(taskState);
    const items = this.packer.pack(records, options.budgetTokens);

    const rawTokens = items.reduce((sum, item) => {
      return sum + Math.ceil(item.content.length / REPORT_CHARS_PER_TOKEN);
    }, 0);

    const cacheStats = this.cache.getStats();

    return {
      items,
      totalTokens: Math.min(rawTokens, options.budgetTokens),
      retrievalTimeMs: Math.round(performance.now() - start),
      cacheHits: cacheStats.hits,
      staleItemsInvalidated: 0,
    };
  }

  recordArtifact(input: ArtifactInput) {
    return this.store.createArtifact(input);
  }

  recordOutcome(_outcome: { task: string; testsPassed: boolean; patch?: string }) {
  }

  invalidate(scopeOrPath: string) {
    this.invalidator.invalidateByFilePath(scopeOrPath, '');
  }

  close() {
    this.store.close();
    this.db.close();
  }
}
