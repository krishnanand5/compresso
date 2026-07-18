/**
 * Integration test: every registered agent must have corresponding entries
 * in the build pipeline and CLI dispatch, plus required fields.
 */

import { describe, it, expect } from 'vitest';
import { getAgent, listAgents } from '../src/agents/registry.js';
import { resolveSubcommand } from '../src/cli/dispatch.js';
import { readFileSync } from 'node:fs';
import { isAgentMultimodalCompatible } from '../src/agents/multimodal.js';

// Convention: agent id "codex" maps to CLI source "src/codex-cli.ts"
// and build output "dist/codex-cli.js".
function agentBuildEntry(agentId: string): string {
  return `${agentId}-cli`;
}

// Load build entries from scripts/build.mjs.
function readBuildEntries(): Set<string> {
  const src = readFileSync('scripts/build.mjs', 'utf8');
  const m = src.match(/const ENTRIES\s*=\s*\[(.*?)\];/s);
  if (!m) return new Set();
  const entries = new Set<string>();
  for (const line of m[1]!.split('\n')) {
    const match = line.match(/out:\s*'dist\/(.+)\.js'/);
    if (match) entries.add(match[1]!);
  }
  return entries;
}

describe('agent integration: dispatch registry', () => {
  it('every registered agent has a dispatch entry', () => {
    const agents = listAgents();
    expect(agents.length).toBeGreaterThan(0);
    for (const id of agents) {
      expect(resolveSubcommand(id), `agent '${id}' missing from dispatch.ts`).toBeDefined();
    }
  });
});

describe('agent integration: build pipeline', () => {
  it('every registered agent has a build entry', () => {
    const buildEntries = readBuildEntries();
    const agents = listAgents();
    for (const id of agents) {
      const expected = agentBuildEntry(id);
      expect(
        buildEntries.has(expected),
        `agent '${id}' expected build entry '${expected}' in build.mjs ENTRIES`,
      ).toBe(true);
    }
  });
});

describe('agent integration: required fields', () => {
  it('every agent has helpText', () => {
    for (const id of listAgents()) {
      const agent = getAgent(id)!;
      expect(agent.helpText, `agent ${id} missing helpText`).toBeTruthy();
    }
  });

  it('every agent has non-empty supportedModels', () => {
    for (const id of listAgents()) {
      const agent = getAgent(id)!;
      expect(
        Array.isArray(agent.supportedModels) && agent.supportedModels.length > 0,
        `agent ${id} must have at least one supported model`,
      ).toBe(true);
    }
  });

  it('every base-url agent has writeConfig', () => {
    for (const id of listAgents()) {
      const agent = getAgent(id)!;
      if (agent.family === 'base-url') {
        expect(
          typeof agent.writeConfig === 'function',
          `base-url agent '${id}' must implement writeConfig`,
        ).toBe(true);
      }
    }
  });

  it('every agent is multimodal-compatible', () => {
    for (const id of listAgents()) {
      expect(
        isAgentMultimodalCompatible(id),
        `agent '${id}' has no multimodal models in its supportedModels`,
      ).toBe(true);
    }
  });
});

describe('agent integration: no port conflicts', () => {
  it('every agent has a unique defaultPort', () => {
    const agents = listAgents();
    const ports = agents.map((id) => getAgent(id)!.defaultPort ?? 0).filter(Boolean);
    const unique = new Set(ports);
    expect(ports.length, `duplicate ports: ${JSON.stringify(ports)}`).toBe(unique.size);
  });
});
