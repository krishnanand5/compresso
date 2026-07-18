// src/agents/multimodal.ts
// Utility for determining which multimodal models an agent supports.
// pxpipe only works with multimodal agents — models that accept image inputs.

import { getAgent } from './registry.js';
import { IMAGE_CAPABLE_BASES } from '../core/applicability.js';

/** Returns the subset of the agent's `supportedModels` that are multimodal
 *  (i.e., appear in IMAGE_CAPABLE_BASES). Returns empty array when the agent
 *  is unknown or has no multimodal models. */
export function getMultimodalModelsForAgent(agentId: string): string[] {
  const agent = getAgent(agentId);
  if (!agent) return [];
  return agent.supportedModels.filter((m) => IMAGE_CAPABLE_BASES.has(m));
}

/** Returns all currently multimodal model bases from IMAGE_CAPABLE_BASES. */
export function listAllMultimodalModels(): string[] {
  return [...IMAGE_CAPABLE_BASES];
}

/** True iff the agent declares at least one supported model that is multimodal. */
export function isAgentMultimodalCompatible(agentId: string): boolean {
  return getMultimodalModelsForAgent(agentId).length > 0;
}
