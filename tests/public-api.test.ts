import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getAllowedModelBases,
  isPxpipeSupportedGptModel,
  isPxpipeSupportedModel,
  setAllowedModelBases,
  transformOpenAIChatCompletions,
} from '../src/core/index.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

// Tests below assert DEFAULT model-scope behavior, which assumes COMPRESSO_MODELS is unset.
// Snapshot and clear any ambient value (e.g. a dev shell that still exports COMPRESSO_MODELS)
// before each test so the suite is deterministic regardless of the environment it runs in,
// then restore the original afterward. The per-test override cases still work: they see an
// unset var, set their own value, and clean up.
let ambientPxpipeModels: string | undefined;
beforeEach(() => {
  ambientPxpipeModels = process.env.COMPRESSO_MODELS;
  delete process.env.COMPRESSO_MODELS;
});
afterEach(() => {
  if (ambientPxpipeModels === undefined) delete process.env.COMPRESSO_MODELS;
  else process.env.COMPRESSO_MODELS = ambientPxpipeModels;
});

describe('public library API', () => {
  it('recognizes Fable 5 (with suffix aliases) as the default scope; Opus is OFF by default', () => {
    expect(isPxpipeSupportedModel('claude-fable-5')).toBe(true);
    expect(isPxpipeSupportedModel('claude-fable-5-high')).toBe(true);
    // Opus 4.8 is OPT-IN, not in the default scope — same pipeline/render as
    // Fable, but it reads imaged content at a tax (FINDINGS.md 2026-06-16), so
    // the default doesn't silently compress the operator's main driver. Enable
    // it via COMPRESSO_MODELS or the dashboard "compress models" chips.
    expect(isPxpipeSupportedModel('claude-opus-4-8')).toBe(false);
    // older Opus + other families are not in the default scope
    expect(isPxpipeSupportedModel('claude-opus-4-7')).toBe(false);
    expect(isPxpipeSupportedModel('claude-opus-4-6')).toBe(false);
    expect(isPxpipeSupportedModel('claude-mythos-5')).toBe(false);
    expect(isPxpipeSupportedModel('claude-fable-50')).toBe(false);
    expect(isPxpipeSupportedModel('claude-sonnet-4-7')).toBe(false);
    expect(isPxpipeSupportedModel(null)).toBe(false);
  });

  it('strips bracketed variant tags like [1m] before matching', () => {
    expect(isPxpipeSupportedModel('claude-fable-5[1m]')).toBe(true);
    expect(isPxpipeSupportedModel('claude-fable-5-high[1m]')).toBe(true);
    expect(isPxpipeSupportedModel('claude-opus-4-8[1m]')).toBe(false); // Opus opt-in, off by default
    // a non-scoped base is still rejected even with a variant tag
    expect(isPxpipeSupportedModel('claude-opus-4-7[1m]')).toBe(false);
  });

  it('honors COMPRESSO_MODELS to override the default scope', () => {
    const prev = process.env.COMPRESSO_MODELS;
    try {
      // narrow to Fable only
      process.env.COMPRESSO_MODELS = 'claude-fable-5';
      expect(isPxpipeSupportedModel('claude-fable-5')).toBe(true);
      expect(isPxpipeSupportedModel('claude-opus-4-8')).toBe(false);
      // re-point to a different set
      process.env.COMPRESSO_MODELS = 'claude-fable-5,claude-opus-4-7';
      expect(isPxpipeSupportedModel('claude-opus-4-7')).toBe(true);
      expect(isPxpipeSupportedModel('claude-opus-4-8')).toBe(false); // not in this set
    } finally {
      if (prev === undefined) delete process.env.COMPRESSO_MODELS;
      else process.env.COMPRESSO_MODELS = prev;
    }
  });

  it('honors the dashboard runtime override (setAllowedModelBases) over env/default', () => {
    try {
      // override takes precedence over the env/default scope
      setAllowedModelBases(['claude-fable-5', 'claude-opus-4-8']);
      expect(getAllowedModelBases()).toEqual(['claude-fable-5', 'claude-opus-4-8']);
      expect(isPxpipeSupportedModel('claude-opus-4-8')).toBe(true); // opted in at runtime
      // empty list = compress nothing
      setAllowedModelBases([]);
      expect(isPxpipeSupportedModel('claude-fable-5')).toBe(false);
      // null clears the override → back to the Fable + GPT 5.6 default
      setAllowedModelBases(null);
      expect(isPxpipeSupportedModel('claude-fable-5')).toBe(true);
      expect(isPxpipeSupportedGptModel('gpt-5.6-sol')).toBe(true);
      expect(isPxpipeSupportedGptModel('grok-4.5')).toBe(false);
      expect(isPxpipeSupportedModel('claude-opus-4-8')).toBe(false);
    } finally {
      setAllowedModelBases(null); // never leak the override into other tests
    }
  });

  it('includes GPT 5.6 family in the default scope; narrows to exact Sol when env overrides', () => {
    expect(isPxpipeSupportedGptModel('gpt-5')).toBe(false);
    expect(isPxpipeSupportedGptModel('gpt-5.5')).toBe(false);
    expect(isPxpipeSupportedGptModel('gpt-5.5-codex')).toBe(false);
    expect(isPxpipeSupportedGptModel('gpt-5.6')).toBe(true);
    expect(isPxpipeSupportedGptModel('gpt-5.6-sol')).toBe(true);
    expect(isPxpipeSupportedGptModel('gpt-5.6-sol-codex')).toBe(true);
    expect(isPxpipeSupportedGptModel('gpt-5.6-terra')).toBe(true);
    expect(isPxpipeSupportedGptModel('gpt-5-mini')).toBe(false);
    expect(isPxpipeSupportedGptModel('gpt-4o')).toBe(false);

    process.env.COMPRESSO_MODELS = 'gpt-5.6-sol';
    expect(isPxpipeSupportedGptModel('gpt-5.6-sol')).toBe(true);
    expect(isPxpipeSupportedGptModel('gpt-5.6-sol-codex')).toBe(true);
    expect(isPxpipeSupportedGptModel('gpt-5.6-sol[1m]')).toBe(true);
    expect(isPxpipeSupportedGptModel('gpt-5.6-sol-codex[1m]')).toBe(true);
    expect(isPxpipeSupportedGptModel('gpt-5.6')).toBe(false);
    expect(isPxpipeSupportedGptModel('gpt-5.6-terra')).toBe(false);
  });

  it('keeps Grok opt-in by default; GPT 5.6 family is included', () => {
    // Grok remains opt-in because its arithmetic, gist, and state results are
    // below the Fable bar.
    const prev = process.env.COMPRESSO_MODELS;
    try {
      delete process.env.COMPRESSO_MODELS;
      expect(isPxpipeSupportedGptModel('grok-4.5')).toBe(false);
      expect(isPxpipeSupportedGptModel('grok-4')).toBe(false);
      expect(isPxpipeSupportedGptModel('grok-4.20')).toBe(false);
      expect(getAllowedModelBases()).not.toContain('grok-4.5');
      expect(getAllowedModelBases()).toEqual(['claude-fable-5', 'gpt-5.6']);

      process.env.COMPRESSO_MODELS = 'claude-fable-5,gpt-5.6-sol,grok-4.5';
      expect(isPxpipeSupportedGptModel('grok-4.5')).toBe(true);
      expect(isPxpipeSupportedGptModel('grok-4.5-fast')).toBe(true); // -suffix alias
      expect(isPxpipeSupportedGptModel('gpt-5.6-sol')).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.COMPRESSO_MODELS;
      else process.env.COMPRESSO_MODELS = prev;
    }
  });

  it('honors the single COMPRESSO_MODELS scope for GPT families', () => {
    const prev = process.env.COMPRESSO_MODELS;
    try {
      // Explicit Claude-only scope disables GPT imaging.
      process.env.COMPRESSO_MODELS = 'claude-fable-5';
      expect(isPxpipeSupportedGptModel('gpt-5.5')).toBe(false);
      expect(isPxpipeSupportedGptModel('gpt-5.6-sol')).toBe(false);

      // Mixed CSV selects exactly those bases across families.
      process.env.COMPRESSO_MODELS = 'claude-fable-5,gpt-5.6-sol';
      expect(isPxpipeSupportedGptModel('gpt-5.5')).toBe(false);
      expect(isPxpipeSupportedGptModel('gpt-5.6-sol')).toBe(true);
      expect(isPxpipeSupportedModel('claude-fable-5')).toBe(true);

      // `off` disables everything.
      process.env.COMPRESSO_MODELS = 'off';
      expect(isPxpipeSupportedGptModel('gpt-5.6-sol')).toBe(false);
      expect(isPxpipeSupportedModel('claude-fable-5')).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.COMPRESSO_MODELS;
      else process.env.COMPRESSO_MODELS = prev;
    }
  });

  it('transforms GPT 5.5 chat completions using OpenAI image_url blocks', async () => {
    const body = enc.encode(JSON.stringify({
      model: 'gpt-5.5',
      messages: [
        { role: 'system', content: 'System instruction. '.repeat(700) },
        { role: 'developer', content: 'Developer instruction. '.repeat(400) },
        { role: 'user', content: 'hello' },
      ],
      tools: [{
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a file from disk. '.repeat(100),
          parameters: {
            type: 'object',
            description: 'Long root description.',
            properties: {
              path: { type: 'string', description: 'Path to read.' },
            },
            required: ['path'],
          },
        },
      }],
    }));

    const transformed = await transformOpenAIChatCompletions(body, {
      charsPerToken: 1,
      minCompressChars: 1,
    });
    expect(transformed.info.compressed).toBe(true);
    expect(transformed.info.imageCount).toBeGreaterThan(0);
    const out = JSON.parse(dec.decode(transformed.body)) as any;
    const firstUser = out.messages.find((m: any) => m.role === 'user');
    expect(Array.isArray(firstUser.content)).toBe(true);
    expect(firstUser.content[0].type).toBe('image_url');
    expect(firstUser.content[0].image_url.url).toMatch(/^data:image\/png;base64,/);
    expect(out.messages[0].content).toContain('rendered into image');
    expect(out.tools[0].function.description).toBe('Read a file from disk. '.repeat(100));
    expect(out.tools[0].function.parameters.description).toBeUndefined();
    expect(out.tools[0].function.parameters.properties.path.description).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('cache_control');
  });
});
