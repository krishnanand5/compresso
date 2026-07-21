import { createProxy, type ProxyConfig } from '../core/proxy.js';
import type { TransformOptions } from '../core/utils.js';
import { toTrackEvent, JsonLogTracker, noopTracker, type Tracker } from '../core/tracker.js';

export interface Env {
  COMPRESSO_UPSTREAM?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENAI_UPSTREAM?: string;
  ANTHROPIC_UPSTREAM?: string;
  COMPRESSO_OPENCODE_UPSTREAM?: string;
  COMPRESSO_OPENCODE_GO_UPSTREAM?: string;
  COMPRESSO_MODELS?: string;
  COMPRESSO_PROVIDER?: string;
  COMPRESSO_GATEWAY_BASE_URL?: string;
  COMPRESSO_GATEWAY_HEADERS?: string;
  COMPRESSO_WORKER_SECRET?: string;
  COMPRESSO_DISABLE?: string;
}

function getEnv(env: Env, key: keyof Env): string | undefined {
  return env[key];
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (getEnv(env, 'COMPRESSO_WORKER_SECRET')) {
      const sig = request.headers.get('x-compresso-secret') ?? '';
      const expected = getEnv(env, 'COMPRESSO_WORKER_SECRET')!;
      const enc = new TextEncoder();
      const [sigHash, expectedHash] = await Promise.all([
        crypto.subtle.digest('SHA-256', enc.encode(sig)),
        crypto.subtle.digest('SHA-256', enc.encode(expected)),
      ]);
      if (!constantTimeEqual(new Uint8Array(sigHash), new Uint8Array(expectedHash))) {
        return new Response('unauthorized', { status: 403 });
      }
    }

    const sharedUpstream = getEnv(env, 'COMPRESSO_UPSTREAM');
    const config: ProxyConfig = {
      provider: (getEnv(env, 'COMPRESSO_PROVIDER') as 'cloudflare-ai-gateway' | undefined) ?? undefined,
      gatewayBaseUrl: getEnv(env, 'COMPRESSO_GATEWAY_BASE_URL'),
      gatewayHeaders: (() => {
        const raw = getEnv(env, 'COMPRESSO_GATEWAY_HEADERS');
        if (!raw) return undefined;
        try { return JSON.parse(raw) as Record<string, string>; } catch { return undefined; }
      })(),
      upstream: getEnv(env, 'ANTHROPIC_UPSTREAM') ?? sharedUpstream ?? 'https://api.anthropic.com',
      openAIUpstream: getEnv(env, 'OPENAI_UPSTREAM') ?? sharedUpstream ?? 'https://api.openai.com',
      opencodeUpstream: getEnv(env, 'COMPRESSO_OPENCODE_UPSTREAM') ?? sharedUpstream ?? 'https://opencode.ai/zen/v1',
      opencodeGoUpstream: getEnv(env, 'COMPRESSO_OPENCODE_GO_UPSTREAM') ?? sharedUpstream ?? 'https://opencode.ai/zen/go/v1',
      apiKey: getEnv(env, 'ANTHROPIC_API_KEY'),
      openAIApiKey: getEnv(env, 'OPENAI_API_KEY'),
      transform: () => {
        if (getEnv(env, 'COMPRESSO_DISABLE')) return { compress: false };
        return {};
      },
      onRequest: (e) => {
        console.log(JSON.stringify(toTrackEvent(e)));
      },
    };

    const handle = createProxy(config);
    return handle(request);
  },
};

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a[i]! ^ b[i]!;
  return result === 0;
}
