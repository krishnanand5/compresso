import type { Transformer } from './types.js';
import { registerTransformer } from './registry.js';
import { transformOpenAIChatCompletions, transformOpenAIResponses } from '../openai.js';

const opencodeTransformer: Transformer = async ({ body, opts, path }) => {
  if (path.endsWith('/messages')) {
    // OpenCode Go tier does not support image compression in /messages endpoints
    return {
      body,
      info: {
        compressed: false,
        origChars: 0,
        compressedChars: 0,
        imageCount: 0,
        imageBytes: 0,
        staticChars: 0,
        dynamicChars: 0,
        dynamicBlockCount: 0,
        reason: 'opencode_messages_passthrough',
      },
    };
  }
  const isResponses = path.includes('/responses');
  const r = isResponses
    ? await transformOpenAIResponses(body, opts)
    : await transformOpenAIChatCompletions(body, opts);
  return { body: r.body, info: r.info };
};

registerTransformer('opencode', opencodeTransformer);
