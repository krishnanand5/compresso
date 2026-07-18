import type { BaseUrlAgent } from '../types.js';
import { registerAgent } from '../registry.js';
import { writeOpenCodeGoConfig } from './config.js';

export const opencodeGoAgent: BaseUrlAgent = {
  id: 'opencode-go',
  displayName: 'OpenCode Go',
  family: 'base-url',
  binaryName: 'opencode',
  defaultPort: 47825,
  supportedModels: ['deepseek-v4-flash', 'deepseek-v4-pro', 'grok-4.5'],
  envVars: (port) => ({
    OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
  }),
  writeConfig: writeOpenCodeGoConfig,
  helpText: `compresso opencode-go — compressed OpenCode Go subscription session
    compresso opencode-go                          interactive session
    compresso opencode-go "write a test"           single-shot, print, exit
    compresso opencode-go --port 47825             reuse existing proxy
    compresso opencode-go --model opencode-go/deepseek-v4-flash  specific Go model
    compresso opencode-go --setup                  write ~/.config/opencode/opencode.json`,
};

registerAgent(opencodeGoAgent);
