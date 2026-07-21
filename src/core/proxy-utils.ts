export interface UpstreamRoutes {
  anthropic: string;
  openai: string;
  opencode?: string;
  opencodeGo?: string;
  stripOpenAIV1: boolean;
}

const DEFAULT_UPSTREAM = 'https://api.anthropic.com';
const DEFAULT_OPENAI_UPSTREAM = 'https://api.openai.com';
const DEFAULT_OPENCODE_UPSTREAM = 'https://opencode.ai/zen/v1';
const DEFAULT_OPENCODE_GO_UPSTREAM = 'https://opencode.ai/zen/go/v1';

export function resolveUpstreams(config: {
  provider?: 'cloudflare-ai-gateway';
  gatewayBaseUrl?: string;
  upstream?: string;
  openAIUpstream?: string;
  opencodeUpstream?: string;
  opencodeGoUpstream?: string;
}): UpstreamRoutes {
  if (config.provider === 'cloudflare-ai-gateway') {
    const base = (config.gatewayBaseUrl ?? '').replace(/\/+$/, '');
    if (!base) throw new Error("provider 'cloudflare-ai-gateway' requires gatewayBaseUrl (COMPRESSO_GATEWAY_BASE_URL)");
    return {
      anthropic: `${base}/anthropic`,
      openai: `${base}/openai`,
      opencode: (config.opencodeUpstream ?? DEFAULT_OPENCODE_UPSTREAM).replace(/\/+$/, ''),
      opencodeGo: (config.opencodeGoUpstream ?? DEFAULT_OPENCODE_GO_UPSTREAM).replace(/\/+$/, ''),
      stripOpenAIV1: true,
    };
  }
  return {
    anthropic: (config.upstream ?? DEFAULT_UPSTREAM).replace(/\/+$/, ''),
    openai: (config.openAIUpstream ?? DEFAULT_OPENAI_UPSTREAM).replace(/\/+$/, ''),
    opencode: (config.opencodeUpstream ?? DEFAULT_OPENCODE_UPSTREAM).replace(/\/+$/, ''),
    opencodeGo: (config.opencodeGoUpstream ?? DEFAULT_OPENCODE_GO_UPSTREAM).replace(/\/+$/, ''),
    stripOpenAIV1: false,
  };
}

export function parseGatewayHeaders(spec: string | undefined): Record<string, string> {
  if (!spec) return {};
  const trimmed = spec.trim();
  if (trimmed.startsWith('{')) {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = String(v);
    return out;
  }
  const out: Record<string, string> = {};
  for (const pair of trimmed.split(';')) {
    const i = pair.indexOf('=');
    if (i <= 0) continue;
    out[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return out;
}
