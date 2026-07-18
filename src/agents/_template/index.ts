import type { BaseUrlAgent } from '../types.js';
import { registerAgent } from '../registry.js';

export const newAgent: BaseUrlAgent = {
  id: 'new-agent',
  displayName: 'New Agent',
  family: 'base-url',
  binaryName: 'new-agent',
  defaultPort: 47823,
  supportedModels: ['claude-5', 'gpt-5.6'],
  envVars: (port) => ({
    OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
  }),
  helpText: `compresso new-agent — compressed New Agent session
    compresso new-agent "write a test"          single-shot, print, exit
    compresso new-agent --port 47823            reuse existing proxy on port
    compresso new-agent --setup                  write config`,
};

registerAgent(newAgent);
