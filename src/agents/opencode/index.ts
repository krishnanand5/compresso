import type { BaseUrlAgent } from '../types.js';
import { registerAgent } from '../registry.js';
import { writeOpenCodeConfig } from './config.js';

export const opencodeAgent: BaseUrlAgent = {
  id: 'opencode',
  displayName: 'OpenCode',
  family: 'base-url',
  binaryName: 'opencode',
  defaultPort: 47822,
  supportedModels: ['claude-5', 'claude-fable-5', 'gpt-5.6', 'big-pickle'],
  envVars: (port) => ({
    OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
  }),
  writeConfig: writeOpenCodeConfig,
  helpText: `compresso opencode — compressed OpenCode session
    compresso opencode                            interactive OpenCode session
    compresso opencode "write a test"             single-shot, print, exit
    compresso opencode --port 47822               reuse existing proxy on port
    compresso opencode --model gpt-5.6-sol        specific model
    compresso opencode --setup                    write ~/.config/opencode/opencode.json`,
};

registerAgent(opencodeAgent);
