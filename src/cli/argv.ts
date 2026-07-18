// src/cli/argv.ts

import type { AgentArgv } from '../agents/types.js';

export interface CommonFlags {
  port: number;
  model?: string;
  setup: boolean;
  help: boolean;
  apiKey?: string;
  quiet: boolean;
  prompt?: string;
}

/** Parse the flags every agent's CLI accepts. The first non-flag
 *  positional arg is the prompt. Anything else lives in `extra`
 *  and is the agent adapter's problem.
 *
 *  When `argv` is omitted, reads `process.argv.slice(2)`. */
export function parseCommonFlags(argv?: readonly string[]): AgentArgv {
  const args = argv ?? process.argv.slice(2);
  let port = 0; // 0 = "let the agent's defaultPort win"
  let model: string | undefined;
  let setup = false;
  let help = false;
  let apiKey: string | undefined;
  let quiet = false;
  let prompt: string | undefined;
  const extra: Record<string, unknown> = {};

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    switch (a) {
      case '-h':
      case '--help':
        help = true;
        break;
      case '--version':
        extra.__version = true;
        break;
      case '-p':
      case '--port':
        port = parseInt(args[++i] ?? '', 10) || 0;
        break;
      case '-m':
      case '--model':
        model = args[++i];
        break;
      case '-k':
      case '--api-key':
        apiKey = args[++i];
        break;
      case '--setup':
        setup = true;
        break;
      case '-q':
      case '--quiet':
        quiet = true;
        break;
      case '-s':
      case '--system':
        // Common for SDK agents (copilot); stash as extra.
        extra.systemPrompt = args[++i];
        break;
      default:
        if (a.startsWith('-')) {
          // Pass agent-specific flags through
          const next = args[i + 1];
          if (next !== undefined && !next.startsWith('-')) {
            extra[a] = args[++i];
          } else {
            extra[a] = true;
          }
        } else if (prompt === undefined) {
          prompt = a;
        }
    }
  }

  return { port, model, setup, help, apiKey, quiet, prompt, extra };
}
