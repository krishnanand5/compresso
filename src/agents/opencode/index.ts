import type { BaseUrlAgent } from '../types.js';
import { registerAgent } from '../registry.js';
import { writeOpenCodeConfig } from './config.js';

export const opencodeAgent: BaseUrlAgent = {
  id: 'opencode',
  displayName: 'OpenCode',
  family: 'base-url',
  binaryName: 'opencode',
  defaultPort: 47822,
  supportedModels: [
    'claude-fable-5', 'claude-5', 'gpt-5.6', 'big-pickle',
    'grok-4.5', 'glm-5.2', 'glm-5.1', 'kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6',
    'deepseek-v4-pro', 'deepseek-v4-flash', 'mimo-v2.5', 'mimo-v2.5-pro',
    'minimax-m3', 'minimax-m2.7', 'minimax-m2.5',
    'qwen3.7-max', 'qwen3.7-plus', 'qwen3.6-plus',
  ],
  envVars: (port) => ({
    OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
  }),
  writeConfig: writeOpenCodeConfig,
  helpText: `compresso opencode — compressed OpenCode session (Zen + Go tiers)

  compresso opencode                            interactive OpenCode session
  compresso opencode "write a test"             single-shot, print, exit
  compresso opencode --port 47822               reuse existing proxy on port
  compresso opencode --model claude-fable-5     specific model
  compresso opencode --setup                    write ~/.config/opencode/opencode.json

Available providers:
  opencode (Zen): /zen/v1 — claude-fable-5, claude-5, gpt-5.6, big-pickle
  opencode-go:    /zen/go/v1 — grok-4.5, glm-5.2, kimi-k3, deepseek-v4-*, minimax-*, qwen3.7-*`,
};

registerAgent(opencodeAgent);
