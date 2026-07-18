/**
 * Tests for the /api/agents/<id>/stats.json endpoint and the agent stats
 * provider registry.
 */

import { describe, it, expect } from 'vitest';
import { registerStatsProvider, getStatsProvider, listAgentIds } from '../src/dashboard/api/agents.js';
import type { AgentStats } from '../src/dashboard/api/agents.js';
import { DashboardState, dashboardPath } from '../src/dashboard.js';

describe('agent stats provider registry', () => {
  it('lists registered agents', () => {
    const before = listAgentIds().length;
    registerStatsProvider('test-agent', async () => ({ id: 'test-agent', displayName: 'Test' }));
    expect(listAgentIds().length).toBe(before + 1);
    expect(listAgentIds()).toContain('test-agent');
  });

  it('returns undefined for unknown agent', () => {
    expect(getStatsProvider('nonexistent')).toBeUndefined();
  });

  it('returns the registered provider', async () => {
    registerStatsProvider('test-agent2', async () => ({ id: 'test-agent2', displayName: 'Test 2', events: 42 }));
    const fn = getStatsProvider('test-agent2');
    expect(fn).toBeDefined();
    const stats = await fn!();
    expect(stats?.id).toBe('test-agent2');
    expect(stats?.events).toBe(42);
  });
});

describe('dashboardPath agent-stats route', () => {
  it('matches /api/agents/<id>/stats.json', () => {
    const route = dashboardPath('/api/agents/copilot/stats.json');
    expect(route).toEqual({ kind: 'agent-stats', agentId: 'copilot' });
  });

  it('matches multi-word agent IDs', () => {
    const route = dashboardPath('/api/agents/codex-cli/stats.json');
    expect(route).toEqual({ kind: 'agent-stats', agentId: 'codex-cli' });
  });

  it('returns null for non-matching paths', () => {
    expect(dashboardPath('/api/agents/copilot/stats')).toBeNull();
    expect(dashboardPath('/api/agents/.json')).toBeNull();
    expect(dashboardPath('/api/agents//stats.json')).toBeNull();
  });
});

describe('DashboardState serveAgentStats', () => {
  it('returns 404 for unknown agent', async () => {
    const dash = new DashboardState();
    const res = await dash.serveAgentStats('nonexistent');
    expect(res.status).toBe(404);
    const body = await res.json() as { error?: string };
    expect(body.error).toContain('unknown agent');
  });
});
