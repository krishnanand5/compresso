import { describe, it, expect } from 'vitest';
import { proxyIsAlive, waitForProxyReady } from '../src/agents/shared/proxy-lifecycle.js';

describe('agents/shared/proxy-lifecycle', () => {
  it('proxyIsAlive returns false on connection refused', async () => {
    expect(await proxyIsAlive(47999)).toBe(false);
  });

  it('waitForProxyReady times out gracefully', async () => {
    await expect(waitForProxyReady(47999, 100)).rejects.toThrow();
  }, 1000);
});
