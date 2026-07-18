// src/agents/registry.ts

import type { CodingAgent } from './types.js';

const AGENTS = new Map<string, CodingAgent>();

export function registerAgent(agent: CodingAgent): void {
  AGENTS.set(agent.id, agent);
}

export function getAgent(id: string): CodingAgent | undefined {
  return AGENTS.get(id);
}

export function listAgents(): string[] {
  return [...AGENTS.keys()];
}

export function unregisterAgent(id: string): void {
  AGENTS.delete(id);
}
