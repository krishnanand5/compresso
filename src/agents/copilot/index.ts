import type { SdkAgent } from '../types.js';
import { registerAgent } from '../registry.js';
import { CopilotCompressHandler } from './handler.js';
import type { TransformOptions } from '../../core/utils.js';

function makeHandler(opts: { transform: TransformOptions }): CopilotCompressHandler {
  return new CopilotCompressHandler(opts.transform);
}

export const copilotAgent: SdkAgent = {
  id: 'copilot',
  displayName: 'Copilot',
  family: 'sdk',
  supportedModels: ['gpt-5.6', 'claude-5'],
  makeHandler,
  helpText: `compresso copilot — compressed Copilot session
    compresso copilot                              interactive REPL
    compresso copilot "write a test"               single-shot, print, exit
    compresso copilot --model gpt-4o               specific model
    compresso copilot --system "be concise"        custom system prompt
    compresso copilot --quiet                      skip startup banner`,
};

registerAgent(copilotAgent);
