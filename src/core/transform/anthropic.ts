import type { Transformer } from './types.js';
import { registerTransformer } from './registry.js';

const anthropicTransformer: Transformer = async ({ body }) => ({
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
  },
});

registerTransformer('anthropic', anthropicTransformer);
