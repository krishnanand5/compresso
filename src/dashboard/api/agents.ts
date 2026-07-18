// src/dashboard/api/agents.ts

/** Per-agent stats payload served by /api/agents/<id>/stats.json. */
export interface AgentStats {
  id: string;
  displayName: string;
  events?: number;
  sessions?: number;
  origTokens?: number;
  imageTokens?: number;
  savingsPct?: number;
  [key: string]: unknown;
}

/** Stats provider: given optional paths, returns agent stats or undefined. */
export type StatsProvider = (opts?: { eventsFile?: string }) => Promise<AgentStats | undefined>;

const providers = new Map<string, StatsProvider>();

export function registerStatsProvider(agentId: string, fn: StatsProvider): void {
  providers.set(agentId, fn);
}

export function getStatsProvider(agentId: string): StatsProvider | undefined {
  return providers.get(agentId);
}

export function listAgentIds(): string[] {
  return [...providers.keys()];
}
