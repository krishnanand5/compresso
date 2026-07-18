import { describe, it, expect, beforeEach } from 'vitest';
import { registerTransformer, getTransformer, __resetTransformerRegistry } from '../src/core/transform/registry.js';
import type { Transformer } from '../src/core/transform/types.js';

const stubTransformer: Transformer = async ({ body }) => ({
  body,
  info: { compressed: false, origChars: 0, imageCount: 0, imageBytes: 0 },
});

describe('core/transform/registry', () => {
  beforeEach(() => {
    __resetTransformerRegistry();
  });

  it('registerTransformer + getTransformer round-trip', () => {
    registerTransformer('anthropic', stubTransformer);
    expect(getTransformer('anthropic')).toBe(stubTransformer);
  });

  it('getTransformer returns undefined for unregistered family', () => {
    expect(getTransformer('openai-responses')).toBeUndefined();
  });
});
