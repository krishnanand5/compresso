import { describe, it, expect } from 'vitest';
import { ApiFamily, TransformInfo, TransformRequest, TransformResult, Transformer } from '../src/core/transform/types.js';

describe('transform types', () => {
  it('ApiFamily includes expected values', () => {
    const families: ApiFamily[] = ['anthropic', 'openai-chat', 'openai-responses', 'opencode-zen'];
    expect(families).toContain('anthropic');
    expect(families).toContain('openai-chat');
  });

  it('Transformer works with mock', async () => {
    const mock: Transformer = async (req: TransformRequest): Promise<TransformResult> => {
      const info: TransformInfo = {
        origChars: req.body.length,
        compressed: false,
        imageCount: 0,
        imageBytes: 0,
      };
      return { body: new Uint8Array(), info };
    };
    const req: TransformRequest = {
      body: new Uint8Array([1,2,3]),
      model: 'test-model',
      method: 'POST',
      path: '/test',
      opts: { debug: false } as any,
    };
    const result = await mock(req);
    expect(result.info.origChars).toBe(3);
  });
});
