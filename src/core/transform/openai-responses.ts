import type { Transformer } from './types.js';
import { registerTransformer } from './registry.js';
import { transformOpenAIResponses } from '../openai.js';

const openAIResponsesTransformer: Transformer = async ({ body, opts }) => {
  const r = await transformOpenAIResponses(body, opts);
  return { body: r.body, info: r.info };
};

registerTransformer('openai-responses', openAIResponsesTransformer);
