import { describe, it, expect, afterEach } from 'vitest';
import { createContextManager, getContextManager, setContextManager, resetContextManager } from '../../src/context-manager/index.js';
import { ContextManager } from '../../src/context-manager/context-manager.js';
import { DEFAULT_CONFIG } from '../../src/context-manager/types.js';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `pxpipe-ctx-lifecycle-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

afterEach(() => {
  resetContextManager();
});

describe('ContextManager lifecycle', () => {
  it('createContextManager returns a new instance', () => {
    const dir = tmpDir();
    const cm = createContextManager(dir);
    expect(cm).toBeInstanceOf(ContextManager);
    expect(cm.isClosed).toBe(false);
    cm.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('getContextManager returns a singleton', () => {
    const cm1 = getContextManager();
    const cm2 = getContextManager();
    expect(cm1).toBe(cm2);
  });

  it('setContextManager replaces the singleton', () => {
    const dir = tmpDir();
    const cm1 = getContextManager();
    const cm2 = createContextManager(dir);
    setContextManager(cm2);
    const current = getContextManager();
    expect(current).toBe(cm2);
    expect(current).not.toBe(cm1);
    expect(cm1.isClosed).toBe(true);
    cm2.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('setContextManager(null) clears the singleton', () => {
    const dir = tmpDir();
    const cm = createContextManager(dir);
    setContextManager(cm);
    expect(getContextManager()).toBe(cm);
    setContextManager(null);
    // After clearing, getContextManager creates a fresh singleton
    const fresh = getContextManager();
    expect(fresh).not.toBe(cm);
    expect(cm.isClosed).toBe(true);
    fresh.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('resetContextManager closes and clears singleton', () => {
    const cm = getContextManager();
    expect(cm.isClosed).toBe(false);
    resetContextManager();
    expect(cm.isClosed).toBe(true);
    // Next call creates a new instance
    const cm2 = getContextManager();
    expect(cm2).not.toBe(cm);
    cm2.close();
  });

  it('close is idempotent', () => {
    const dir = tmpDir();
    const cm = createContextManager(dir);
    cm.close();
    expect(cm.isClosed).toBe(true);
    cm.close(); // should not throw
    expect(cm.isClosed).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('getContext on closed manager returns empty packet', () => {
    const dir = tmpDir();
    const cm = createContextManager(dir);
    cm.close();
    const packet = cm.getContext(
      { headCommit: 'abc', branch: 'main', workingTreeHash: 'x', sessionId: 's1', cwd: dir, pendingChanges: [] },
      { budgetTokens: 100, includeProvenance: false },
    );
    expect(packet.items).toEqual([]);
    expect(packet.totalTokens).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('recordArtifact on closed manager is a no-op', () => {
    const dir = tmpDir();
    const cm = createContextManager(dir);
    cm.close();
    // should not throw
    const id = cm.recordArtifact({
      type: 'tool_output',
      content: 'test',
      sourceRepo: dir,
      sourcePath: '/test.ts',
      sourceCommit: null,
      sourceBranch: null,
    });
    expect(id).toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
