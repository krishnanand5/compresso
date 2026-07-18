import type { CodingAgent, AgentArgv } from '../agents/types.js';

import '../agents/codex/index.js';
import '../agents/opencode/index.js';
import '../agents/opencode-go/index.js';
import '../agents/copilot/index.js';

export interface DispatchEntry {
  name: string;
  entry: string;
  help?: string;
}

const ENTRIES: DispatchEntry[] = [
  { name: 'proxy',    entry: 'dist/node.js' },
  { name: 'export',   entry: 'dist/node.js' },
  { name: 'dashboard', entry: 'dist/dashboard-cli.js' },
  { name: 'codex',    entry: 'dist/codex-cli.js' },
  { name: 'opencode', entry: 'dist/opencode-cli.js' },
  { name: 'opencode-go', entry: 'dist/opencode-go-cli.js' },
  { name: 'copilot',  entry: 'dist/copilot-cli.js' },
];

export function resolveSubcommand(name: string): DispatchEntry | undefined {
  return ENTRIES.find((e) => e.name === name);
}

export function listSubcommands(): string[] {
  return ENTRIES.map((e) => e.name);
}
