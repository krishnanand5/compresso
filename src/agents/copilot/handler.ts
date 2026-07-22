import { CopilotRequestHandler, CopilotWebSocketForwarder } from '@github/copilot-sdk';
import type { CopilotRequestContext } from '@github/copilot-sdk';
import type { TransformOptions, TransformInfo } from '../../core/utils.js';
import { REPORT_CHARS_PER_TOKEN } from '../../core/utils.js';
import type { CopilotEvent, CopilotTelemetry } from '../../copilot-telemetry.js';
import { getContextManager } from '../../context-manager/index.js';
import type { ContextManager } from '../../context-manager/index.js';
import type { TaskState } from '../../context-manager/types.js';
import { captureTaskState, injectContextPacket, extractArtifactsFromResponse } from '../../context-manager/integration-helpers.js';
import {
  COPILOT_COMPRESS_DEFAULTS,
  toCopilotRequest,
  extractCopilotModel,
  compressCopilotRequest,
} from '../../copilot-compress.js';

export class CopilotCompressHandler extends CopilotRequestHandler {
  private compressOpts: TransformOptions;
  private compressedCount = 0;
  private origTokensTotal = 0;
  private imageTokensTotal = 0;
  private wireBytesTotal = 0;
  private telemetry?: CopilotTelemetry;
  private turn = 0;
  private cm: ContextManager | null;

  constructor(opts?: TransformOptions, telemetry?: CopilotTelemetry, contextManager?: ContextManager) {
    super();
    this.compressOpts = opts ?? COPILOT_COMPRESS_DEFAULTS;
    this.telemetry = telemetry;
    this.cm = contextManager ?? null;
  }

  private getCM(): ContextManager {
    return this.cm ?? getContextManager();
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

    let bodyBytes = new Uint8Array(await request.arrayBuffer());
    const model = extractCopilotModel(bodyBytes);

    const cwd = process.cwd();
    let taskState: TaskState | null = null;
    try {
      const cm = this.getCM();
      taskState = captureTaskState(cwd, ctx.sessionId ?? 'unknown');
      const packet = cm.getContext(taskState, { budgetTokens: 2000, includeProvenance: true });
      if (packet.items.length > 0) {
        bodyBytes = injectContextPacket(bodyBytes, packet) as Uint8Array<ArrayBuffer>;
      }
    } catch {}

    const { outBody, didCompress, info, durationMs } = await compressCopilotRequest(
      bodyBytes, this.compressOpts, isResponses, isChat,
    );

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

    const response = await fetch(toCopilotRequest(request, outBody, ctx.signal), { signal: ctx.signal });

    if (taskState) {
      try {
        const cm = this.getCM();
        const responseClone = response.clone();
        const responseText = await responseClone.text();
        const responseBody = JSON.parse(responseText);
        const hasToolCalls = responseBody?.choices?.some((c: any) => c?.message?.tool_calls?.length > 0);
        if (hasToolCalls) {
          const artifacts = extractArtifactsFromResponse(responseBody);
          for (const a of artifacts) {
            cm.recordArtifact({
              type: 'tool_output' as const,
              content: a.content,
              sourceRepo: cwd,
              sourcePath: a.path,
              sourceCommit: taskState.headCommit,
              sourceBranch: taskState.branch,
            });
          }
        }
      } catch {}
    }

    return response;
  }

  override async openWebSocket(ctx: CopilotRequestContext): Promise<CopilotWebSocketForwarder> {
    return new CopilotWebSocketForwarder(ctx);
  }
}
