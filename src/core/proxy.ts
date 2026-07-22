import type { TransformOptions, TransformInfo } from './utils.js';
import { isImageCapableModel, isPxpipeSupportedGptModel, isPxpipeSupportedModel } from './applicability.js';
import type { Usage } from './types.js';
import { getTransformer } from './transform/registry.js';
import './transform/register-all.js';
import { recordImageCostObservation } from './image-cost-cache.js';

function newRequestId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {}
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface ProxyConfig {
  provider?: 'cloudflare-ai-gateway';
  gatewayBaseUrl?: string;
  gatewayHeaders?: Record<string, string>;
  upstream?: string;
  apiKey?: string;
  openAIUpstream?: string;
  openAIApiKey?: string;
  opencodeUpstream?: string;
  opencodeGoUpstream?: string;
  cwd?: string;
  dumpBodiesDir?: string;
  transform?: TransformOptions | (() => TransformOptions);
  onRequest?: (event: ProxyEvent) => void | Promise<void>;
  onBeforeTransform?: (body: Uint8Array, env: { cwd?: string }) => Uint8Array | Promise<Uint8Array>;
  onAfterResponse?: (responseJson: any, env: { cwd?: string }) => void | Promise<void>;
}

export interface ProxyEvent {
  requestId: string;
  method: string;
  path: string;
  model?: string;
  client?: string;
  cwd?: string;
  tier?: OpenCodeTier;
  status: number;
  durationMs: number;
  firstByteMs?: number;
  info?: TransformInfo;
  usage?: Usage;
  stopReason?: string;
  error?: string;
  errorBody?: string;
  reqBodySha8?: string;
  reqBodyGz?: Uint8Array;
  reqBodySamplePath?: string;
  measurement?: OutputMeasurement;
}

const ERROR_BODY_MAX = 2048;

function readModelField(body: Uint8Array): string | null {
  try {
    const head = new TextDecoder().decode(body.subarray(0, 8192));
    const m = /"model"\s*:\s*"([^"]{1,80})"/.exec(head);
    return m ? m[1]! : null;
  } catch { return null; }
}

async function gzipBytes(body: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(body as BufferSource).body!.pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function sha8Bytes(body: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', body as BufferSource);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < 4; i++) hex += bytes[i]!.toString(16).padStart(2, '0');
  return hex;
}

async function writeDebugLog(entry: Record<string, unknown>): Promise<void> {
  if (typeof process === 'undefined') return;
  try {
    const { default: fs } = await import('node:fs');
    const { default: path } = await import('node:path');
    const { default: os } = await import('node:os');
    const logDir = path.join(os.homedir(), '.compresso');
    await fs.promises.mkdir(logDir, { recursive: true });
    const logFile = path.join(logDir, 'debug.jsonl');
    await fs.promises.appendFile(logFile, JSON.stringify(entry) + '\n', 'utf8');
  } catch {}
}

export interface OutputMeasurement {
  textChars: number;
  thinkingChars: number;
  toolUseChars: number;
  redactedBlockCount: number;
}

function processSseEvent(
  block: string,
  m: OutputMeasurement,
  state: { usage: Usage | undefined; stopReason: string | undefined },
): void {
  let event = '';
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).replace(/^\s/, '');
  }
  if (!data) return;
  let j: unknown;
  try { j = JSON.parse(data); } catch { return; }
  const obj = j as Record<string, unknown>;

  const openAIUsage = normalizeUsage((obj as { usage?: unknown }).usage);
  if (openAIUsage) state.usage = openAIUsage;
  if (event === 'response.completed' || event === 'response.incomplete') {
    const resp = obj.response as { usage?: unknown; incomplete_details?: { reason?: unknown } } | undefined;
    const respUsage = normalizeUsage(resp?.usage);
    if (respUsage) state.usage = respUsage;
    const reason = resp?.incomplete_details?.reason;
    state.stopReason = typeof reason === 'string' ? reason : event === 'response.incomplete' ? 'incomplete' : 'stop';
  }
  measureOpenAIChoices(obj, m);
  if (event === 'response.output_text.delta' || event === 'response.refusal.delta') {
    if (typeof obj.delta === 'string') m.textChars += obj.delta.length;
  } else if (event === 'response.function_call_arguments.delta') {
    if (typeof obj.delta === 'string') m.toolUseChars += obj.delta.length;
  }
  const choices = obj.choices;
  if (Array.isArray(choices)) {
    for (const c of choices) {
      const fr = (c as { finish_reason?: unknown } | undefined)?.finish_reason;
      if (typeof fr === 'string') state.stopReason = fr;
    }
  }

  if (event === 'message_start') {
    const msg = obj.message as { usage?: Usage } | undefined;
    const usage = normalizeUsage(msg?.usage);
    if (usage) state.usage = usage;
  } else if (event === 'content_block_start') {
    const cb = obj.content_block as { type?: string } | undefined;
    if (cb?.type === 'redacted_thinking') m.redactedBlockCount += 1;
  } else if (event === 'content_block_delta') {
    const d = obj.delta as { type?: string; text?: string; thinking?: string; partial_json?: string } | undefined;
    if (d?.type === 'text_delta' && typeof d.text === 'string') m.textChars += d.text.length;
    else if (d?.type === 'thinking_delta' && typeof d.thinking === 'string') m.thinkingChars += d.thinking.length;
    else if (d?.type === 'input_json_delta' && typeof d.partial_json === 'string') m.toolUseChars += d.partial_json.length;
  } else if (event === 'message_delta') {
    const d = obj.delta as { stop_reason?: unknown } | undefined;
    if (typeof d?.stop_reason === 'string') state.stopReason = d.stop_reason;
    const u = obj.usage as Partial<Usage> | undefined;
    if (u) {
      if (!state.usage) state.usage = {} as Usage;
      const cur = state.usage;
      if (typeof u.output_tokens === 'number') cur.output_tokens = u.output_tokens;
      if (typeof u.input_tokens === 'number' && cur.input_tokens === undefined) cur.input_tokens = u.input_tokens;
      if (typeof u.cache_creation_input_tokens === 'number') cur.cache_creation_input_tokens = u.cache_creation_input_tokens;
      if (typeof u.cache_read_input_tokens === 'number') cur.cache_read_input_tokens = u.cache_read_input_tokens;
    }
  }
}

function normalizeUsage(raw: unknown): Usage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const u = raw as Record<string, unknown>;
  const out: Usage = {};
  if (typeof u.input_tokens === 'number') out.input_tokens = u.input_tokens;
  if (typeof u.output_tokens === 'number') out.output_tokens = u.output_tokens;
  if (typeof u.cache_creation_input_tokens === 'number') out.cache_creation_input_tokens = u.cache_creation_input_tokens;
  if (typeof u.cache_read_input_tokens === 'number') out.cache_read_input_tokens = u.cache_read_input_tokens;
  if (typeof u.cache_creation === 'object' && u.cache_creation !== null) out.cache_creation = u.cache_creation as Usage['cache_creation'];
  if (typeof u.server_tool_use === 'object' && u.server_tool_use !== null) out.server_tool_use = u.server_tool_use as Usage['server_tool_use'];
  if (typeof u.prompt_tokens === 'number') out.input_tokens = u.prompt_tokens;
  if (typeof u.completion_tokens === 'number') out.output_tokens = u.completion_tokens;
  const details = (u.input_tokens_details as Record<string, unknown> | undefined) ?? (u.prompt_tokens_details as Record<string, unknown> | undefined);
  if (details && typeof details.cached_tokens === 'number') out.cached_tokens = details.cached_tokens;
  return Object.keys(out).length > 0 ? out : undefined;
}

function measureOpenAIChoices(obj: Record<string, unknown>, m: OutputMeasurement): void {
  const choices = obj.choices;
  if (!Array.isArray(choices)) return;
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') continue;
    const c = choice as { delta?: unknown; message?: unknown };
    const payload = (c.delta ?? c.message) as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== 'object') continue;
    if (typeof payload.content === 'string') m.textChars += payload.content.length;
    const toolCalls = payload.tool_calls;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls) {
        const fn = (tc as { function?: unknown } | undefined)?.function;
        const args = (fn as { arguments?: unknown } | undefined)?.arguments;
        if (typeof args === 'string') m.toolUseChars += args.length;
      }
    }
  }
}

function measureFromMessageJson(j: unknown): OutputMeasurement {
  const m: OutputMeasurement = { textChars: 0, thinkingChars: 0, toolUseChars: 0, redactedBlockCount: 0 };
  if (j && typeof j === 'object') measureOpenAIChoices(j as Record<string, unknown>, m);
  const content = (j as { content?: unknown })?.content;
  if (!Array.isArray(content)) return m;
  for (const block of content) {
    const b = block as { type?: string; text?: unknown; thinking?: unknown; input?: unknown };
    if (b?.type === 'text' && typeof b.text === 'string') m.textChars += b.text.length;
    else if (b?.type === 'thinking' && typeof b.thinking === 'string') m.thinkingChars += b.thinking.length;
    else if (b?.type === 'redacted_thinking') m.redactedBlockCount += 1;
    else if (b?.type === 'tool_use') {
      try { m.toolUseChars += JSON.stringify(b.input ?? {}).length; } catch {}
    }
  }
  return m;
}

function readStopReasonFromJson(j: unknown): string | undefined {
  if (!j || typeof j !== 'object') return undefined;
  const obj = j as { stop_reason?: unknown; choices?: unknown; status?: unknown; incomplete_details?: { reason?: unknown } };
  if (typeof obj.stop_reason === 'string') return obj.stop_reason;
  if (Array.isArray(obj.choices)) {
    for (const c of obj.choices) {
      const fr = (c as { finish_reason?: unknown } | undefined)?.finish_reason;
      if (typeof fr === 'string') return fr;
    }
  }
  if (obj.status === 'incomplete') {
    const reason = obj.incomplete_details?.reason;
    return typeof reason === 'string' ? reason : 'incomplete';
  }
  return undefined;
}

function teeForUsage(res: Response): {
  response: Response;
  usagePromise: Promise<Usage | undefined>;
  errorBodyPromise: Promise<string | undefined>;
  measurementPromise: Promise<OutputMeasurement | undefined>;
  stopReasonPromise: Promise<string | undefined>;
  responseJsonPromise: Promise<any | undefined>;
} {
  if (!res.body) {
    return { response: res, usagePromise: Promise.resolve(undefined), errorBodyPromise: Promise.resolve(undefined), measurementPromise: Promise.resolve(undefined), stopReasonPromise: Promise.resolve(undefined), responseJsonPromise: Promise.resolve(undefined) };
  }
  if (res.status >= 400) {
    const [forClient, forUs] = res.body.tee();
    const errorBodyPromise = (async (): Promise<string | undefined> => {
      const reader = forUs.getReader();
      const decoder = new TextDecoder();
      let out = '';
      try {
        while (out.length < ERROR_BODY_MAX) {
          const { done, value } = await reader.read();
          if (done) break;
          out += decoder.decode(value, { stream: true });
        }
        out += decoder.decode();
        while (true) { const { done } = await reader.read(); if (done) break; }
      } catch {}
      return out.length > ERROR_BODY_MAX ? out.slice(0, ERROR_BODY_MAX) : out;
    })();
    return { response: new Response(forClient, { status: res.status, statusText: res.statusText, headers: res.headers }), usagePromise: Promise.resolve(undefined), errorBodyPromise, measurementPromise: Promise.resolve(undefined), stopReasonPromise: Promise.resolve(undefined), responseJsonPromise: Promise.resolve(undefined) };
  }
  const ct = (res.headers.get('content-type') ?? '').toLowerCase();
  const [forClient, forUs] = res.body.tee();

  const scanResult = (async (): Promise<{ usage: Usage | undefined; measurement: OutputMeasurement | undefined; stopReason: string | undefined; responseJson: any | undefined }> => {
    const reader = forUs.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      if (ct.includes('text/event-stream')) {
        const m: OutputMeasurement = { textChars: 0, thinkingChars: 0, toolUseChars: 0, redactedBlockCount: 0 };
        const state: { usage: Usage | undefined; stopReason: string | undefined } = { usage: undefined, stopReason: undefined };
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let evEnd: number;
          while ((evEnd = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, evEnd);
            buf = buf.slice(evEnd + 2);
            processSseEvent(block, m, state);
          }
        }
        buf += decoder.decode();
        if (buf.trim().length > 0) processSseEvent(buf, m, state);
        return { usage: state.usage, measurement: m, stopReason: state.stopReason, responseJson: undefined };
      }
      if (ct.includes('application/json')) {
        const MAX = 4 * 1024 * 1024;
        while (buf.length < MAX) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
        }
        try {
          const j = JSON.parse(buf);
          return { usage: normalizeUsage(j?.usage), measurement: measureFromMessageJson(j), stopReason: readStopReasonFromJson(j), responseJson: j };
        } catch { return { usage: undefined, measurement: undefined, stopReason: undefined, responseJson: undefined }; }
      }
    } catch {}
    try { while (true) { const { done } = await reader.read(); if (done) break; } } catch {}
    return { usage: undefined, measurement: undefined, stopReason: undefined, responseJson: undefined };
  })();

  return { response: new Response(forClient, { status: res.status, statusText: res.statusText, headers: res.headers }), usagePromise: scanResult.then((s) => s.usage), errorBodyPromise: Promise.resolve(undefined), measurementPromise: scanResult.then((s) => s.measurement), stopReasonPromise: scanResult.then((s) => s.stopReason), responseJsonPromise: scanResult.then((s) => s.responseJson) };
}

const STRIP_REQ_HEADERS = new Set(['host', 'connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'content-length', 'expect', 'accept-encoding']);
const STRIP_RES_HEADERS = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'content-length']);

function filterHeaders(src: Headers, strip: Set<string>): Headers {
  const out = new Headers();
  src.forEach((v, k) => { if (!strip.has(k.toLowerCase())) out.append(k, v); });
  return out;
}

const PASSTHROUGH_PREFIXES = ['/anthropic/', '/openai/', '/google-ai-studio/', '/compat/'] as const;

function isProviderPrefixedPath(pathname: string): boolean {
  return PASSTHROUGH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isCanonicalOpenAIPath(pathname: string, headers: Headers, hasOpenAIKey: boolean): boolean {
  const isModelsPath = pathname === '/v1/models' || pathname.startsWith('/v1/models/');
  const looksOpenAIAuth = hasOpenAIKey || (headers.has('authorization') && !headers.has('x-api-key'));
  return pathname === '/v1/chat/completions' || pathname === '/v1/responses' || pathname.startsWith('/v1/responses/') || (isModelsPath && looksOpenAIAuth);
}

type ApiFamily = 'anthropic' | 'openai-chat' | 'openai-responses' | 'opencode';
type OpenCodeTier = 'zen' | 'go';

function isOpenAIChatPath(pathname: string): boolean {
  return pathname === '/v1/chat/completions' || pathname === '/openai/v1/chat/completions';
}

function isOpenAIResponsesPath(pathname: string): boolean {
  return pathname === '/v1/responses'
    || pathname === '/openai/v1/responses'
    || pathname === '/openai/responses';
}

function isOpenCodePath(pathname: string): boolean {
  return pathname.startsWith('/zen/v1/') || pathname.startsWith('/zen/go/v1/');
}

function isOpenCodeGoPath(pathname: string): boolean {
  return pathname.startsWith('/zen/go/v1/');
}

function isOpenCodeResponsesPath(pathname: string): boolean {
  return pathname === '/zen/v1/responses' || pathname === '/zen/go/v1/responses';
}

function isOpenCodeChatPath(pathname: string): boolean {
  return pathname === '/zen/v1/chat/completions' || pathname === '/zen/go/v1/chat/completions';
}

function isOpenCodeMessagesPath(pathname: string): boolean {
  return pathname === '/zen/v1/messages' || pathname === '/zen/go/v1/messages';
}

function detectOpenCodeTier(pathname: string): OpenCodeTier {
  return isOpenCodeGoPath(pathname) ? 'go' : 'zen';
}

function pickFamily(method: string, pathname: string, headers: Headers, config: ProxyConfig): ApiFamily {
  const isPost = method === 'POST';
  if (isOpenCodePath(pathname)) {
    if (isPost && (isOpenCodeChatPath(pathname) || isOpenCodeResponsesPath(pathname))) return 'opencode';
    if (isPost && isOpenCodeMessagesPath(pathname)) return 'opencode';
    return 'anthropic';
  }
  if (isPost && isOpenAIChatPath(pathname)) return 'openai-chat';
  if (isPost && isOpenAIResponsesPath(pathname)) return 'openai-responses';
  const isOpenAIPath = isCanonicalOpenAIPath(pathname, headers, config.openAIApiKey !== undefined);
  if (isOpenAIPath && isPost) {
    if (pathname === '/v1/chat/completions' || pathname.endsWith('/chat/completions')) return 'openai-chat';
    if (pathname === '/v1/responses' || pathname.endsWith('/responses')) return 'openai-responses';
  }
  return 'anthropic';
}

function resolveUpstreamPath(pathname: string, family: ApiFamily, routes: { stripOpenAIV1: boolean; isOpenCodeAIPath: boolean }): string {
  if (family === 'opencode') {
    // Strip /zen/go/v1 or /zen/v1 prefix
    if (pathname.startsWith('/zen/go/v1')) return pathname.replace(/^\/zen\/go\/v1/, '');
    if (pathname.startsWith('/zen/v1')) return pathname.replace(/^\/zen\/v1/, '');
    return pathname;
  }
  if ((family === 'openai-chat' || family === 'openai-responses') && routes.stripOpenAIV1) return pathname.replace(/^\/v1(?=\/)/, '');
  return pathname;
}

import { resolveUpstreams, parseGatewayHeaders } from './proxy-utils.js';
export type { UpstreamRoutes } from './proxy-utils.js';
export { resolveUpstreams, parseGatewayHeaders };

export function createProxy(config: ProxyConfig = {}) {
  const routes_raw = resolveUpstreams(config);
  const upstreamBase = (family: ApiFamily, tier?: OpenCodeTier): string => {
    if (family === 'openai-chat' || family === 'openai-responses') return routes_raw.openai;
    if (family === 'opencode') {
      if (tier === 'go') return routes_raw.opencodeGo ?? routes_raw.opencode ?? routes_raw.anthropic;
      return routes_raw.opencode ?? routes_raw.anthropic;
    }
    return routes_raw.anthropic;
  };
  const gatewayHeaders = config.gatewayHeaders ?? {};
  const applyGatewayHeaders = (h: Headers): Headers => {
    for (const [k, v] of Object.entries(gatewayHeaders)) h.set(k, v);
    return h;
  };

  return async function handle(req: Request): Promise<Response> {
    const t0 = Date.now();
    const requestId = newRequestId();
    const url = new URL(req.url);
    const family = pickFamily(req.method, url.pathname, req.headers, config);
    const isProviderPrefixed = isProviderPrefixedPath(url.pathname);
    const opencodeTier = family === 'opencode' ? detectOpenCodeTier(url.pathname) : undefined;

    let reqBodyBytes: Uint8Array | undefined;
    let reqBodySha8: string | undefined;
    let requestModel: string | undefined;
    let info: TransformInfo | undefined;
    let upstreamUrl: string | undefined;

    const fire = (status: number, error?: string, firstByteMs?: number, usage?: Usage, errorBody?: string, measurement?: OutputMeasurement, stopReason?: string): void => {
      const isError = status >= 400;
      const finalize = async (): Promise<void> => {
        let reqBodyGz: Uint8Array | undefined;
        if (isError && reqBodyBytes && reqBodyBytes.byteLength > 0) {
          try { reqBodyGz = await gzipBytes(reqBodyBytes); } catch {}
        }
        await config.onRequest?.({ requestId, method: req.method, path: url.pathname, model: requestModel, tier: opencodeTier, status, durationMs: Date.now() - t0, firstByteMs, info, usage, error, errorBody, reqBodySha8, reqBodyGz, measurement, stopReason });
        if (isError) {
          try {
            let reqBodyJson: string | undefined;
            if (reqBodyBytes && reqBodyBytes.byteLength > 0 && reqBodyBytes.byteLength < 500_000) {
              try { reqBodyJson = new TextDecoder().decode(reqBodyBytes); } catch {}
            }
            await writeDebugLog({ ts: new Date().toISOString(), method: req.method, path: url.pathname, model: requestModel, tier: opencodeTier, status, error, errorBody, info, upstreamUrl, reqBodyJson });
          } catch {}
        }
      };
      void finalize();
    };

    const bodyIn = new Uint8Array(await req.arrayBuffer());
    const model = readModelField(bodyIn);
    requestModel = model ?? undefined;

    let processedBodyIn: Uint8Array = bodyIn;
    if (config.onBeforeTransform) {
      try {
        const cwd = config.cwd;
        processedBodyIn = await config.onBeforeTransform(bodyIn, { cwd }) as Uint8Array;
      } catch {}
    }

    const transformer = getTransformer(family);
    if (transformer) {
      const transformOpts = typeof config.transform === 'function' ? config.transform() : config.transform;
      const isOpenCodeMessages = family === 'opencode' && url.pathname.endsWith('/messages');
      const isAnthropicFamily = family === 'anthropic' || isOpenCodeMessages;
      const isGptFamily = family === 'openai-chat' || family === 'openai-responses' || (family === 'opencode' && !isOpenCodeMessages);
      const modelOk = (isGptFamily || isAnthropicFamily) && model ? (isGptFamily ? isPxpipeSupportedGptModel(model) : isPxpipeSupportedModel(model)) : true;
      const imageCapable = (isGptFamily || isAnthropicFamily) && model ? isImageCapableModel(model) : true;
      const effectiveOpts: import('./transform/types.js').TransformOptions = ((isGptFamily || isAnthropicFamily) && modelOk && imageCapable ? transformOpts : { ...transformOpts, compress: false }) ?? {};
      try {
        const r = await transformer({ body: processedBodyIn, model: model ?? '', method: req.method, path: url.pathname, opts: effectiveOpts, upstreamUrl, apiKey: config.apiKey });
        if ((isGptFamily || isAnthropicFamily) && !modelOk) r.info.reason = 'unsupported_model';
        info = r.info;
        reqBodyBytes = r.body;
        if (r.body.byteLength > 0) reqBodySha8 = await sha8Bytes(r.body);
      } catch (e) {
        fire(502, `transform_error: ${(e as Error).message}`);
        return new Response(JSON.stringify({ error: 'compresso transform failed' }), { status: 502, headers: { 'content-type': 'application/json' } });
      }
    } else {
      reqBodyBytes = processedBodyIn;
    }

    const outHeaders = filterHeaders(req.headers, STRIP_REQ_HEADERS);
    if (family === 'openai-chat' || family === 'openai-responses') {
      if (config.openAIApiKey) outHeaders.set('authorization', `Bearer ${config.openAIApiKey}`);
    } else if (family === 'opencode') {
      // OpenCode endpoints use different auth formats:
      // /messages (Anthropic) → x-api-key
      // /chat/completions & /responses (OpenAI-compatible) → Authorization: Bearer
      // Send both so the gateway picks whichever it needs.
      const authHeader = outHeaders.get('authorization');
      const clientKey = (authHeader && authHeader.startsWith('Bearer ')) ? authHeader.slice(7) : null;
      const effectiveKey = config.apiKey || clientKey;
      if (effectiveKey) {
        outHeaders.set('x-api-key', effectiveKey);
        outHeaders.set('authorization', `Bearer ${effectiveKey}`);
      }
      if (!effectiveKey) {
        console.error(`[compresso] WARNING: no API key for opencode request — set COMPRESSO_OPENCODE_API_KEY`);
      }
    } else if (config.apiKey && !isProviderPrefixed) {
      outHeaders.set('x-api-key', config.apiKey);
    }
    applyGatewayHeaders(outHeaders);

    const outPath = resolveUpstreamPath(url.pathname + url.search, family, { stripOpenAIV1: routes_raw.stripOpenAIV1, isOpenCodeAIPath: isOpenCodePath(url.pathname) });
    upstreamUrl = upstreamBase(family, opencodeTier) + outPath;

    let upstreamRes: Response;
    try {
      upstreamRes = await fetch(upstreamUrl, { method: req.method, headers: outHeaders, body: transformer ? reqBodyBytes : req.body, ...(req.body instanceof ReadableStream ? { duplex: 'half' as const } : {}) } as RequestInit);
    } catch (e) {
      fire(502, `upstream_error: ${(e as Error).message}`);
      return new Response(JSON.stringify({ error: 'compresso upstream unreachable' }), { status: 502, headers: { 'content-type': 'application/json' } });
    }

    const firstByteMs = Date.now() - t0;
    const { response: teed, usagePromise, errorBodyPromise, measurementPromise, stopReasonPromise, responseJsonPromise } = teeForUsage(upstreamRes);

    void Promise.all([usagePromise.catch(() => undefined), errorBodyPromise.catch(() => undefined), measurementPromise.catch(() => undefined), stopReasonPromise.catch(() => undefined), responseJsonPromise.catch(() => undefined)])
      .then(async ([usage, errorBody, measurement, stopReason, responseJson]) => {
        if (config.onAfterResponse && responseJson) {
          try {
            const cwd = config.cwd;
            void config.onAfterResponse(responseJson, { cwd });
          } catch {}
        }
        // Learn image cost: only from cold-miss, shallow-conversation compressions.
        // Cold miss avoids cache-warmth distortion (cached reads bill at 0.1x).
        // Slab fraction >30% ensures we're learning from early turns, not deep
        // conversations where history dominates actualInput.
        if (upstreamRes.status >= 200 && upstreamRes.status < 300 && usage && info?.compressed && info?.baselineTokens && info?.gateEval) {
          const actualInput = usage.input_tokens ?? 0;
          const cacheRead = usage.cache_read_input_tokens ?? 0;
          const baselineTokens = info.baselineTokens;
          const slabFraction = baselineTokens / Math.max(1, actualInput);
          if (actualInput > 0 && baselineTokens > 0 && cacheRead === 0 && slabFraction > 0.3) {
            recordImageCostObservation(requestModel ?? 'unknown', baselineTokens, actualInput);
          }
        }
        // Dump request/response bodies for debugging when enabled
        if (config.dumpBodiesDir && reqBodyBytes && reqBodyBytes.byteLength > 0) {
          try {
            const { default: fs } = await import('node:fs');
            const { default: path } = await import('node:path');
            const dir = path.join(config.dumpBodiesDir, 'bodies');
            await fs.promises.mkdir(dir, { recursive: true });
            const dumpFile = path.join(dir, `${requestId}.json`);
            let reqBodyText = '';
            try { reqBodyText = new TextDecoder().decode(reqBodyBytes); } catch {}
            const responseBody = errorBody ?? (responseJson ? JSON.stringify(responseJson) : '');
            const dump = {
              requestId,
              method: req.method,
              path: url.pathname,
              model: requestModel,
              status: upstreamRes.status,
              requestBody: reqBodyText.slice(0, 500_000),
              responseBody: responseBody.slice(0, 500_000),
            };
            await fs.promises.writeFile(dumpFile, JSON.stringify(dump, null, 2), 'utf8');
          } catch {}
        }
        fire(upstreamRes.status, undefined, firstByteMs, usage, errorBody, measurement, stopReason);
      });

    return new Response(teed.body, { status: upstreamRes.status, statusText: upstreamRes.statusText, headers: filterHeaders(upstreamRes.headers, STRIP_RES_HEADERS) });
  };
}
