import type { Transformer } from './types.js';
import { registerTransformer } from './registry.js';
import { transformOpenAIChatCompletions } from '../openai.js';

const openAIChatTransformer: Transformer = async ({ body, opts }) => {
  const r = await transformOpenAIChatCompletions(body, opts);
  return { body: r.body, info: r.info };
};

registerTransformer('openai-chat', openAIChatTransformer);
