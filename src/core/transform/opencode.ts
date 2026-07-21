import type { Transformer } from './types.js';
import { registerTransformer } from './registry.js';
import { transformOpenAIChatCompletions, transformOpenAIResponses } from '../openai.js';
import { transformAnthropicMessages } from './anthropic.js';

const opencodeTransformer: Transformer = async ({ body, opts, path }) => {
  if (path.endsWith('/messages')) {
    return transformAnthropicMessages(body, opts);
  }
  const isResponses = path.includes('/responses');
  const r = isResponses
    ? await transformOpenAIResponses(body, opts)
    : await transformOpenAIChatCompletions(body, opts);
  return { body: r.body, info: r.info };
};

registerTransformer('opencode', opencodeTransformer);
