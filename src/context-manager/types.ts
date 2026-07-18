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
  reasonSelected: string | null;
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
