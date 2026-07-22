/** Shared Copilot compression pipeline used by both the root handler
 *  (src/copilot.ts) and the agent handler (src/agents/copilot/handler.ts).
 *  Extracted to eliminate ~75 lines of duplicated logic between the two.
 */

import { transformOpenAIChatCompletions, transformOpenAIResponses } from './core/openai.js';
import type { TransformOptions, TransformInfo } from './core/utils.js';

export const COPILOT_COMPRESS_DEFAULTS: TransformOptions = {
  compress: true,
  compressTools: true,
  reflow: true,
  multiCol: 1,
  minCompressChars: 2000,
  collapseHistory: true,
};

export function toCopilotRequest(request: Request, body: Uint8Array, signal: AbortSignal): Request {
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  const raw = new Uint8Array(body.length);
  raw.set(body);
  return new Request(request.url, {
    method: request.method,
    headers,
    body: raw as unknown as BodyInit,
    signal,
  });
}

export function extractCopilotModel(body: Uint8Array): string | undefined {
  try {
    const obj = JSON.parse(new TextDecoder().decode(body));
    return obj.model ?? undefined;
  } catch { return undefined; }
}

export interface CompressResult {
  outBody: Uint8Array;
  didCompress: boolean;
  info: TransformInfo | null;
  durationMs: number;
}

export async function compressCopilotRequest(
  bodyBytes: Uint8Array,
  compressOpts: TransformOptions,
  isResponses: boolean,
  isChat: boolean,
): Promise<CompressResult> {
  const start = performance.now();
  let didCompress = false;
  let outBody = new Uint8Array(bodyBytes);
  let info: TransformInfo | null = null;

  if (!isResponses && !isChat) {
    return { outBody, didCompress: false, info: null, durationMs: Math.round(performance.now() - start) };
  }

  try {
    if (isResponses) {
      const r = await transformOpenAIResponses(bodyBytes, { ...compressOpts });
      info = r.info as TransformInfo | null;
      if (info?.compressed) didCompress = true;
      outBody = new Uint8Array(r.body);
    } else if (isChat) {
      const r = await transformOpenAIChatCompletions(bodyBytes, { ...compressOpts });
      info = r.info as TransformInfo | null;
      if (info?.compressed) didCompress = true;
      outBody = new Uint8Array(r.body);
    }
  } catch {}

  if (didCompress) {
    const text = new TextDecoder().decode(outBody);
    if (text.includes('"original"')) {
      outBody = new TextEncoder().encode(text.replace(/"detail":"original"/g, '"detail":"high"'));
    }
  }

  return { outBody, didCompress, info, durationMs: Math.round(performance.now() - start) };
}
