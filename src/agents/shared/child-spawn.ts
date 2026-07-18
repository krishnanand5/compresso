// src/agents/shared/child-spawn.ts

import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process';
import type { AgentEnv } from '../types.js';

/** Merge agent env overrides over a base process env. */
export function buildChildEnv(
  agentEnv: AgentEnv,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return { ...base, ...agentEnv };
}

export interface SpawnChildOptions {
  binary: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  /** Inherit stdio by default; pass 'inherit' for interactive CLIs. */
  stdio?: StdioOptions;
  cwd?: string;
}

export function spawnChild(opts: SpawnChildOptions): ChildProcess {
  return spawn(opts.binary, opts.args ?? [], {
    stdio: opts.stdio ?? 'inherit',
    env: opts.env,
    cwd: opts.cwd,
  });
}

/** Forward SIGINT/SIGTERM/SIGHUP from the parent to the child so Ctrl-C cleans up. */
export function forwardSignals(child: ChildProcess): () => void {
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  const listeners = new Map<NodeJS.Signals, () => void>();
  for (const sig of signals) {
    const listener = () => {
      if (!child.killed) child.kill(sig);
    };
    listeners.set(sig, listener);
    process.on(sig, listener);
  }
  return () => {
    for (const [sig, listener] of listeners) {
      process.off(sig, listener);
    }
  };
}
