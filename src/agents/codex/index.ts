// src/agents/codex/index.ts

import type { BaseUrlAgent } from '../types.js';
import { registerAgent } from '../registry.js';
import { writeCodexConfig } from './config.js';

export const codexAgent: BaseUrlAgent = {
  id: 'codex',
  displayName: 'Codex CLI',
  family: 'base-url',
  binaryName: 'codex',
  defaultPort: 47821,
  supportedModels: ['gpt-5.6', 'claude-5'],
  envVars: (port) => ({ OPENAI_BASE_URL: `http://127.0.0.1:${port}` }),
  writeConfig: writeCodexConfig,
  helpText: `compresso codex — compressed Codex CLI session
    compresso codex "write a test"            single-shot, print, exit
    compresso codex --port 47823              reuse existing proxy on port
    compresso codex --model gpt-4o            specific model
    compresso codex -k sk-...                 OpenAI API key
    compresso codex --setup                   write ~/.codex/config.toml`,
};

registerAgent(codexAgent);
