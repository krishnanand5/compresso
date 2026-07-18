// src/agents/shared/config-writer.ts

import { getAgent } from '../registry.js';

export interface ConfigWriteResult {
  ok: boolean;
  path?: string;
  error?: string;
}

/** Dispatch to the per-agent config writer. The agent's writeConfig
 *  is responsible for knowing its own file format and location. */
export async function writeAgentConfig(
  agentId: string,
  opts: { port: number; apiKey?: string; model?: string },
): Promise<ConfigWriteResult> {
  const agent = getAgent(agentId);
  if (!agent || agent.family !== 'base-url' || !agent.writeConfig) {
    return { ok: false, error: `agent '${agentId}' has no writeConfig` };
  }
  try {
    await agent.writeConfig(opts);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
