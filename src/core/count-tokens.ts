/** Count tokens via the upstream /messages/count_tokens endpoint.
 *
 *  Anthropic-compatible providers (including opencode's Zen/Go gateways) expose
 *  POST /v1/messages/count_tokens which returns exact token counts for a given
 *  request body. We use this to get an accurate baselineTokens instead of the
 *  combined.length / 3 heuristic.
 *
 *  Results are cached in-memory (keyed by model + body SHA-256) to avoid
 *  repeated calls for identical requests. Cache TTL: 1 hour.
 */

import { sha256 } from './utils.js';

interface CountTokensRequest {
  model: string;
  system?: string | Array<{ type: string; text?: string }>;
  messages: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>;
  tools?: Array<{ name: string; description?: string; input_schema: Record<string, unknown> }>;
}

interface CountTokensResponse {
  input_tokens: number;
}

interface CacheEntry {
  tokens: number;
  ts: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const tokenCache = new Map<string, CacheEntry>();

function cacheKey(model: string, body: string): string {
  return `${model}:${sha256(body)}`;
}

function getCached(key: string): number | undefined {
  const entry = tokenCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    tokenCache.delete(key);
    return undefined;
  }
  return entry.tokens;
}

function setCached(key: string, tokens: number): void {
  tokenCache.set(key, { tokens, ts: Date.now() });
  // Prune old entries if cache grows too large
  if (tokenCache.size > 1000) {
    const now = Date.now();
    for (const [k, v] of tokenCache) {
      if (now - v.ts > CACHE_TTL_MS) tokenCache.delete(k);
    }
  }
}

export async function countTokens(
  upstreamBase: string,
  apiKey: string | undefined,
  req: CountTokensRequest,
): Promise<number | undefined> {
  const body = JSON.stringify(req);
  const key = cacheKey(req.model, body);

  const cached = getCached(key);
  if (cached !== undefined) return cached;

  try {
    const url = `${upstreamBase.replace(/\/+$/, '')}/messages/count_tokens`;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (apiKey) headers['x-api-key'] = apiKey;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
    });

    if (!res.ok) return undefined;

    const data = (await res.json()) as CountTokensResponse;
    if (typeof data.input_tokens === 'number' && data.input_tokens > 0) {
      setCached(key, data.input_tokens);
      return data.input_tokens;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Clear the count_tokens cache (for testing). */
export function clearCountTokensCache(): void {
  tokenCache.clear();
}
