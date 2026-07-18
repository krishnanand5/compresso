import type { Transformer } from './types.js';
import { registerTransformer } from './registry.js';
import { transformOpenAIChatCompletions, transformOpenAIResponses } from '../openai.js';

const opencodeZenTransformer: Transformer = async ({ body, opts, path }) => {
  const isResponses = path.includes('/responses');
  const r = isResponses
    ? await transformOpenAIResponses(body, opts)
    : await transformOpenAIChatCompletions(body, opts);
  return { body: r.body, info: r.info };
};

registerTransformer('opencode-zen', opencodeZenTransformer);
