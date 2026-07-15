import { CopilotClient, CopilotSession as SdkSession, approveAll, CopilotRequestHandler, CopilotWebSocketForwarder } from '@github/copilot-sdk';
import type { SessionConfig, SystemMessageConfig, SessionEvent, CopilotRequestContext } from '@github/copilot-sdk';
import { transformOpenAIChatCompletions, transformOpenAIResponses } from './core/openai.js';
import type { TransformOptions, TransformInfo } from './core/utils.js';
import { REPORT_CHARS_PER_TOKEN } from './core/utils.js';
import { execSync } from 'node:child_process';

export type { TransformOptions, TransformInfo } from './core/utils.js';

const COPILOT_COMPRESS_DEFAULTS: TransformOptions = {
  compress: true,
  compressTools: true,
  reflow: true,
  multiCol: 1,
  minCompressChars: 2000,
  collapseHistory: true,
};

export interface CopilotSessionOptions {
  model?: string;
  workingDirectory?: string;
  baseDirectory?: string;
  compress?: boolean | TransformOptions;
  systemPrompt?: string;
  logLevel?: 'none' | 'error' | 'warning' | 'info' | 'debug' | 'all';
  onEvent?: (event: SessionEvent) => void;
  skipCustomInstructions?: boolean;
}

// ---------------------------------------------------------------------------
// Token helper
// ---------------------------------------------------------------------------
function getGitHubToken(): string {
  try {
    return execSync('gh auth token', { encoding: 'utf8', timeout: 10_000 }).trim();
  } catch {
    throw new Error('Failed to get GitHub token. Please run `gh auth login` first.');
  }
}

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

// ---------------------------------------------------------------------------
// Compress handler — intercepts /responses and compresses on the fly
// ---------------------------------------------------------------------------
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
    if (!isResponses && !isChat) {
      return fetch(request, { signal: ctx.signal });
    }

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
    } catch {
      // fall through — forward original body
    }

    if (didCompress) {
      const text = new TextDecoder().decode(outBody);
      if (text.includes('"original"')) {
        outBody = new TextEncoder().encode(text.replace(/"detail":"original"/g, '"detail":"high"'));
      }
    }

    const durationMs = Math.round(performance.now() - start);

    if (info) {
      const origTokens = info.origChars > 0
        ? Math.round(info.origChars / REPORT_CHARS_PER_TOKEN)
        : 0;
      const imageTokens = info.imageTokens ?? 0;
      const ts = new Date().toISOString();

      this.compressedCount++;
      this.origTokensTotal += origTokens;
      this.imageTokensTotal += imageTokens;
      this.wireBytesTotal += bodyBytes.length;

      // Emit telemetry — best-effort, never throws.
      if (this.telemetry) {
        try {
          this.telemetry.emit({
            ts,
            session_id: ctx.sessionId ?? 'unknown',
            turn: ++this.turn,
            model: model ?? 'unknown',
            prompt_preview: '',
            duration_ms: durationMs,
            status: 0,
            compressed: didCompress,
            orig_tokens: origTokens,
            image_tokens: imageTokens,
            token_savings_pct: origTokens > 0
              ? Math.round((1 - imageTokens / origTokens) * 100)
              : 0,
            orig_chars: info.origChars,
            image_count: info.imageCount ?? 0,
            wire_bytes_in: bodyBytes.length,
            wire_bytes_out: outBody.length,
          });
        } catch { /* telemetry never throws */ }
      }
    }

    return fetch(toRequest(request, outBody, ctx.signal), { signal: ctx.signal });
  }

  override async openWebSocket(ctx: CopilotRequestContext): Promise<CopilotWebSocketForwarder> {
    return new CopilotWebSocketForwarder(ctx);
  }
}

function extractModel(body: Uint8Array): string | undefined {
  try {
    const obj = JSON.parse(new TextDecoder().decode(body));
    return obj.model ?? undefined;
  } catch {
    return undefined;
  }
}

import type { CopilotEvent, CopilotAggregate } from './copilot-telemetry.js';
import { newCopilotAggregate, foldCopilotAggregate, trackSession } from './copilot-telemetry.js';

export type { CopilotEvent, CopilotAggregate } from './copilot-telemetry.js';
export { newCopilotAggregate, foldCopilotAggregate, trackSession, sessionCount } from './copilot-telemetry.js';

export interface CopilotTelemetry {
  emit(ev: CopilotEvent): void;
}

// ---------------------------------------------------------------------------
// File-based telemetry: writes to ~/.compresso/copilot-events.jsonl
// ---------------------------------------------------------------------------
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const COMPRESSO_HOME = process.env.COMPRESSO_HOME ?? path.join(os.homedir(), '.compresso');

export class CopilotFileTelemetry implements CopilotTelemetry {
  private fd: number | null = null;
  private broken = false;

  constructor(filePath?: string) {
    const resolved = filePath ?? path.join(COMPRESSO_HOME, 'copilot-events.jsonl');
    try {
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
    } catch { /* ignore */ }
    try {
      this.fd = fs.openSync(resolved, 'a');
    } catch {
      this.broken = true;
    }
  }

  emit(ev: CopilotEvent): void {
    if (this.broken || this.fd == null) return;
    try {
      const line = JSON.stringify(ev) + '\n';
      fs.writeSync(this.fd, line);
    } catch {
      this.broken = true;
    }
  }

  flush(): void {
    if (this.fd != null) {
      try { fs.fsyncSync(this.fd); } catch { /* ignore */ }
    }
  }

  close(): void {
    if (this.fd != null) {
      try { fs.closeSync(this.fd); } catch { /* ignore */ }
      this.fd = null;
    }
  }
}

// ---------------------------------------------------------------------------
// CopilotSession — programmatic Copilot session
// ---------------------------------------------------------------------------
export class CopilotSession {
  private client: CopilotClient | null = null;
  private session: SdkSession | null = null;
  private handler: CopilotCompressHandler | null = null;
  private telemetry: CopilotTelemetry | null = null;
  private connected = false;
  private _model: string | undefined;

  get sessionId(): string | null {
    return this.session?.sessionId ?? null;
  }

  get compressionStats() {
    return this.handler?.compressionStats ?? null;
  }

  async connect(options: CopilotSessionOptions = {}): Promise<void> {
    if (this.connected) return;

    const token = getGitHubToken();
    let compressOpts: TransformOptions | false = false;
    if (options.compress === true) {
      compressOpts = COPILOT_COMPRESS_DEFAULTS;
    } else if (options.compress && typeof options.compress === 'object') {
      compressOpts = { ...COPILOT_COMPRESS_DEFAULTS, ...options.compress };
    }

    this.telemetry = new CopilotFileTelemetry();
    this.handler = compressOpts ? new CopilotCompressHandler(compressOpts, this.telemetry) : null;

    this.client = new CopilotClient({
      gitHubToken: token,
      useLoggedInUser: false,
      workingDirectory: options.workingDirectory,
      baseDirectory: options.baseDirectory,
      logLevel: options.logLevel ?? 'info',
      requestHandler: this.handler ?? undefined,
    });

    await this.client.start();

    const systemMessage: SystemMessageConfig = options.systemPrompt
      ? { mode: 'replace', content: options.systemPrompt }
      : { mode: 'append' };

    const config: SessionConfig = {
      model: options.model,
      systemMessage,
      onPermissionRequest: approveAll,
      skipCustomInstructions: options.skipCustomInstructions,
    };

    this.session = await this.client.createSession(config);
    this._model = options.model;

    if (options.onEvent) {
      this.session.on(options.onEvent);
    }

    this.connected = true;
  }

  async send(prompt: string): Promise<string> {
    if (!this.session || !this.connected) {
      throw new Error('Session not connected. Call connect() first.');
    }
    return this.session.send({ prompt });
  }

  async sendAndWait(prompt: string, timeout?: number): Promise<string | undefined> {
    if (!this.session || !this.connected) {
      throw new Error('Session not connected. Call connect() first.');
    }
    const result = await this.session.sendAndWait({ prompt }, timeout);
    return result?.data?.content;
  }

  on(handler: (event: SessionEvent) => void): () => void {
    if (!this.session) throw new Error('Session not connected.');
    return this.session.on(handler);
  }

  onEvent<K extends SessionEvent['type']>(
    eventType: K,
    handler: (event: Extract<SessionEvent, { type: K }>) => void,
  ): () => void {
    if (!this.session) throw new Error('Session not connected.');
    return this.session.on(eventType, handler as any);
  }

  async close(): Promise<void> {
    this.connected = false;

    if (this.session) {
      await this.session.disconnect();
      this.session = null;
    }

    if (this.client) {
      await this.client.stop();
      this.client = null;
    }

    if (this.telemetry instanceof CopilotFileTelemetry) {
      this.telemetry.close();
    }

    this.handler = null;
    this.telemetry = null;
  }
}

export async function createSession(options?: CopilotSessionOptions): Promise<CopilotSession> {
  const session = new CopilotSession();
  await session.connect(options);
  return session;
}
