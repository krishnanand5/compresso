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
export { captureTaskState, injectContextPacket, extractArtifactsFromResponse } from './integration-helpers.js';
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
