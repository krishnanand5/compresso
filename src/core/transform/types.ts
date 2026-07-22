// src/core/transform/types.ts

/** All API families the engine can transform. */
export type ApiFamily =
  | 'anthropic'
  | 'openai-chat'
  | 'openai-responses'
  | 'opencode';

/** Options passed to each transformer (same as core utils TransformOptions). */
export type TransformOptions = import('../utils.js').TransformOptions;

/** Information about the original request needed by transformers.
 *  Re-exported from core utils so all code shares one definition. */
export type TransformInfo = import('../utils.js').TransformInfo;

/** Request payload handed to a transformer. */
export interface TransformRequest {
  readonly body: Uint8Array;
  readonly model: string;
  readonly method: string;
  readonly path: string;
  readonly opts: TransformOptions;
  readonly upstreamUrl?: string;
  readonly apiKey?: string;
}

/** Result returned from a transformer. */
export interface TransformResult {
  readonly body: Uint8Array;
  readonly info: TransformInfo;
}

/** Transformer function signature. */
export type Transformer = (req: TransformRequest) => Promise<TransformResult>;
