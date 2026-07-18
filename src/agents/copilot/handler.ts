import { CopilotRequestHandler, CopilotWebSocketForwarder } from '@github/copilot-sdk';
import type { CopilotRequestContext } from '@github/copilot-sdk';
import { transformOpenAIChatCompletions, transformOpenAIResponses } from '../../core/openai.js';
import type { TransformOptions, TransformInfo } from '../../core/utils.js';
import { REPORT_CHARS_PER_TOKEN } from '../../core/utils.js';
import type { CopilotEvent, CopilotTelemetry } from './telemetry.js';

const COPILOT_COMPRESS_DEFAULTS: TransformOptions = {
  compress: true,
  compressTools: true,
  reflow: true,
  multiCol: 1,
  minCompressChars: 2000,
  collapseHistory: true,
};

function toRequest(request: Request, body: Uint8Array, signal: AbortSignal): Request {
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

function extractModel(body: Uint8Array): string | undefined {
  try {
    const obj = JSON.parse(new TextDecoder().decode(body));
    return obj.model ?? undefined;
  } catch { return undefined; }
}

export class CopilotCompressHandler extends CopilotRequestHandler {
  private compressOpts: TransformOptions;
  private compressedCount = 0;
  private origTokensTotal = 0;
  private imageTokensTotal = 0;
  private wireBytesTotal = 0;
  private telemetry?: CopilotTelemetry;
  private turn = 0;

  constructor(opts?: TransformOptions, telemetry?: CopilotTelemetry) {
    super();
    this.compressOpts = opts ?? COPILOT_COMPRESS_DEFAULTS;
    this.telemetry = telemetry;
  }

  get compressionStats() {
    return {
      compressedCount: this.compressedCount,
      origTokensTotal: this.origTokensTotal,
      imageTokensTotal: this.imageTokensTotal,
      tokenSavingsPct: this.origTokensTotal > 0
        ? Math.round((1 - this.imageTokensTotal / this.origTokensTotal) * 100)
        : 0,
    };
  }

  override async sendRequest(request: Request, ctx: CopilotRequestContext): Promise<Response> {
    const url = new URL(ctx.url);
    const path = url.pathname;
    const isResponses = path.includes('/responses');
    const isChat = path.includes('/chat/completions');
    if (!isResponses && !isChat) return fetch(request, { signal: ctx.signal });

    const bodyBytes = new Uint8Array(await request.arrayBuffer());
    const model = extractModel(bodyBytes);
    const start = performance.now();
    let didCompress = false;
    let outBody = new Uint8Array(bodyBytes);
    let info: TransformInfo | null = null;

    try {
      if (isResponses) {
        const r = await transformOpenAIResponses(bodyBytes, { ...this.compressOpts });
        info = r.info as TransformInfo | null;
        if (info?.compressed) didCompress = true;
        outBody = new Uint8Array(r.body);
      } else if (isChat) {
        const r = await transformOpenAIChatCompletions(bodyBytes, { ...this.compressOpts });
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

    const durationMs = Math.round(performance.now() - start);

    if (info) {
      const origTokens = info.origChars > 0 ? Math.round(info.origChars / REPORT_CHARS_PER_TOKEN) : 0;
      const imageTokens = info.imageTokens ?? 0;
      this.compressedCount++;
      this.origTokensTotal += origTokens;
      this.imageTokensTotal += imageTokens;
      this.wireBytesTotal += bodyBytes.length;

      if (this.telemetry) {
        try {
          this.telemetry.emit({
            ts: new Date().toISOString(),
            session_id: ctx.sessionId ?? 'unknown',
            turn: ++this.turn,
            model: model ?? 'unknown',
            prompt_preview: '',
            duration_ms: durationMs,
            status: 0,
            compressed: didCompress,
            orig_tokens: origTokens,
            image_tokens: imageTokens,
            token_savings_pct: origTokens > 0 ? Math.round((1 - imageTokens / origTokens) * 100) : 0,
            orig_chars: info.origChars,
            image_count: info.imageCount ?? 0,
            wire_bytes_in: bodyBytes.length,
            wire_bytes_out: outBody.length,
          });
        } catch {}
      }
    }

    return fetch(toRequest(request, outBody, ctx.signal), { signal: ctx.signal });
  }

  override async openWebSocket(ctx: CopilotRequestContext): Promise<CopilotWebSocketForwarder> {
    return new CopilotWebSocketForwarder(ctx);
  }
}
