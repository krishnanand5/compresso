/**
 * Node entrypoint — `node:http` server + minimal CLI flag parsing.
 *
 * Wraps the runtime-agnostic `createProxy` from src/core/proxy.ts. The
 * heavy lifting (transform, render, PNG) is identical to the Worker
 * version; only the request/response plumbing differs.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createProxy, parseGatewayHeaders, resolveUpstreams, type ProxyConfig } from '../core/proxy.js';
import { FilesystemLruCache } from '../core/cache.js';
import {
  parseExportArgv,
  runExportCore,
  type ExportParsed,
  type ExportResult,
} from '../core/export.js';
import { readExportTextFile } from '../export-collect.js';
import {
  toTrackEvent,
  TRACK_BODY_INLINE_MAX,
  type Tracker,
  type TrackEvent,
} from '../core/tracker.js';
import {
  DashboardState,
  dashboardPath,
  type DashboardRoute,
} from '../dashboard.js';
import { getContextManager, captureTaskState, injectContextPacket, extractArtifactsFromResponse } from '../context-manager/index.js';

/** Runtime config. The core transform tuning comes from DEFAULTS in
 *  transform.ts; startup knobs cover deployment plus emergency GPT scope
 *  control. No CLI flags beyond --help/--version. */
interface RuntimeConfig {
  port: number;
  /** Interface to bind. Defaults to 127.0.0.1 (loopback only) — the dashboard
   *  is unauthenticated and serves captured request context, so it must not be
   *  exposed to the LAN by default. Set HOST=0.0.0.0 to opt into all interfaces
   *  (e.g. reaching the dashboard from another device / the host of a container). */
  host: string;
  upstream: string;
  openAIUpstream: string;
  opencodeUpstream: string;
  opencodeGoUpstream: string;
  apiKey?: string;
  openAIApiKey?: string;
  provider?: 'cloudflare-ai-gateway';
  gatewayBaseUrl?: string;
  gatewayHeaders?: Record<string, string>;
  eventsFile: string;
}

const DEFAULT_CONFIG_FILE = path.join(os.homedir(), '.config', 'compresso', 'config.json');

function normalizeModelsConfig(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const models = value.map((v) => String(v).trim()).filter(Boolean);
    return models.length > 0 ? models.join(',') : 'off';
  }
  if (typeof value === 'string') return value.trim() || 'off';
  return undefined;
}

function applyConfigFileDefaults(): void {
  const file = process.env.COMPRESSO_CONFIG ?? DEFAULT_CONFIG_FILE;
  if (!fs.existsSync(file)) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  } catch (e) {
    console.warn(`[compresso] ignored invalid config ${file}: ${(e as Error).message}`);
    return;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
  const cfg = parsed as Record<string, unknown>;

  if (process.env.COMPRESSO_MODELS === undefined) {
    const models = normalizeModelsConfig(cfg.models);
    if (models !== undefined) process.env.COMPRESSO_MODELS = models;
  }
}

function parseCli(argv: string[]): RuntimeConfig {
  for (const a of argv) {
    if (a === '-h' || a === '--help') {
      printHelp();
      process.exit(0);
    }
    if (a === '--version') {
      printVersion();
      process.exit(0);
    }
    if (a.startsWith('-')) {
      console.error(`[compresso] unknown option: ${a}`);
       console.error(`[compresso] this build accepts no flags; run \`compresso --help\` for env vars`);
      process.exit(2);
    }
  }
  applyConfigFileDefaults();
  const sharedUpstream = process.env.COMPRESSO_UPSTREAM;
  return {
    port: Number(process.env.PORT ?? 47821),
    host: process.env.HOST?.trim() || '127.0.0.1',
    upstream: process.env.ANTHROPIC_UPSTREAM ?? sharedUpstream ?? 'https://api.anthropic.com',
    openAIUpstream: process.env.OPENAI_UPSTREAM ?? sharedUpstream ?? 'https://api.openai.com',
    opencodeUpstream: process.env.COMPRESSO_OPENCODE_UPSTREAM ?? sharedUpstream ?? 'https://opencode.ai/zen/v1',
    opencodeGoUpstream: process.env.COMPRESSO_OPENCODE_GO_UPSTREAM ?? sharedUpstream ?? 'https://opencode.ai/zen/go/v1',
    apiKey: process.env.ANTHROPIC_API_KEY,
    openAIApiKey: process.env.OPENAI_API_KEY,
    provider: parseProvider(process.env.COMPRESSO_PROVIDER),
    gatewayBaseUrl: process.env.COMPRESSO_GATEWAY_BASE_URL,
    gatewayHeaders: parseGatewayHeaders(process.env.COMPRESSO_GATEWAY_HEADERS),
    eventsFile:
      process.env.COMPRESSO_LOG ??
      path.join(os.homedir(), '.compresso', 'events.jsonl'),
  };
}

function parseProvider(v: string | undefined): 'cloudflare-ai-gateway' | undefined {
  if (v === undefined || v === '') return undefined;
  if (v === 'cloudflare-ai-gateway') return v;
  console.error(`[compresso] unknown COMPRESSO_PROVIDER: ${v}`);
  process.exit(2);
}

function printHelp(): void {
  console.log(`compresso — token-saving proxy for LLM coding agents

Usage:
  compresso                run the proxy (no flags)
  compresso export [...]   render files/diff to PNG pages + cost report (see compresso export --help)

The proxy compresses eligible tools, schemas, reminders, tool_results,
and history; tracks events to disk; and measures real saved_pct via
/v1/messages/count_tokens. Dashboard controls can disable compression live.

Stats, sessions, and cleanup tools live in the dashboard at
  http://127.0.0.1:<port>/  (default port 47821)

Flags:
  -h, --help              show this help
      --version           show version

Environment:
  PORT                    listen port (default 47821)
  HOST                    interface to bind (default 127.0.0.1, loopback only).
                          Set 0.0.0.0 to expose the dashboard off-host — note it
                          is unauthenticated and serves captured request context.
  COMPRESSO_UPSTREAM       upstream API base for every API family
  ANTHROPIC_UPSTREAM       Anthropic API base; overrides COMPRESSO_UPSTREAM
                            (default https://api.anthropic.com)
  OPENAI_UPSTREAM          OpenAI API base; overrides COMPRESSO_UPSTREAM
                            (default https://api.openai.com)
  OPENAI_API_KEY           optional OpenAI key override; otherwise forwarded
  COMPRESSO_PROVIDER       optional: 'cloudflare-ai-gateway' — route both API
                           families through one gateway base URL
  COMPRESSO_GATEWAY_BASE_URL gateway base URL (required with COMPRESSO_PROVIDER)
  COMPRESSO_GATEWAY_HEADERS  extra upstream headers: JSON object or k=v;k2=v2
  COMPRESSO_MODELS         comma-separated model bases to image (Claude/GPT/Grok);
                           default claude-fable-5 (Sol/Opus/GPT-5.5/Grok opt-in);
                           off disables
  COMPRESSO_CONFIG         JSON config path (default ~/.config/compresso/config.json)
                           supports {"models": [...]} or {"models": "off"}
  COMPRESSO_LOG            JSONL events path (default ~/.compresso/events.jsonl)
  COMPRESSO_DUMP_DIR       debug: write every rendered PNG here (what the model
                           sees); off unless set. Compress arm only.
  COMPRESSO_OPENCODE_UPSTREAM OpenCode Zen upstream
                            (default https://opencode.ai/zen/v1)
  COMPRESSO_OPENCODE_GO_UPSTREAM OpenCode Go upstream
                            (default https://opencode.ai/zen/go/v1)

Use with Claude Code:
  ANTHROPIC_BASE_URL=http://127.0.0.1:47821 claude

Use with OpenAI-compatible GPT clients:
  OPENAI_BASE_URL=http://127.0.0.1:47821/v1
`);
}

declare const __COMPRESSO_VERSION__: string | undefined;

function printVersion(): void {
  const injected = typeof __COMPRESSO_VERSION__ === 'string' ? __COMPRESSO_VERSION__ : undefined;
  console.log(injected ?? process.env.npm_package_version ?? 'unknown');
}

function toWebRequest(req: IncomingMessage): Request {
  const proto = (req.headers['x-forwarded-proto'] as string) ?? 'http';
  const host = req.headers.host ?? 'localhost';
  const url = `${proto}://${host}${req.url ?? '/'}`;

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v == null) continue;
    if (Array.isArray(v)) v.forEach((vv) => headers.append(k, vv));
    else headers.append(k, v);
  }

  const method = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';

  let body: BodyInit | undefined;
  if (hasBody) {
    body = new ReadableStream<Uint8Array>({
      start(controller) {
        req.on('data', (chunk) => controller.enqueue(chunk));
        req.on('end', () => controller.close());
        req.on('error', (e) => controller.error(e));
      },
    });
  }

  return new Request(url, {
    method,
    headers,
    body,
    // @ts-expect-error — duplex is required for streamed request bodies in Node 18+
    duplex: hasBody ? 'half' : undefined,
  });
}

function isConnectionAbort(err: unknown): boolean {
  const e = err as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    cause?: { code?: unknown; message?: unknown };
  };
  const name = typeof e?.name === 'string' ? e.name : '';
  const code = typeof e?.code === 'string'
    ? e.code
    : typeof e?.cause?.code === 'string'
      ? e.cause.code
      : '';
  const message = typeof e?.message === 'string' ? e.message : '';
  const causeMessage = typeof e?.cause?.message === 'string' ? e.cause.message : '';
  return name === 'AbortError' ||
    code === 'UND_ERR_SOCKET' ||
    code === 'ECONNRESET' ||
    code === 'EPIPE' ||
    message === 'client response closed' ||
    message === 'terminated' ||
    message.includes('aborted') ||
    causeMessage.includes('other side closed');
}

async function waitForDrain(out: ServerResponse): Promise<void> {
  const event = await Promise.race([
    once(out, 'drain').then(() => 'drain'),
    once(out, 'close').then(() => 'close'),
  ]);
  if (event === 'close') throw new Error('client response closed');
}

async function writeWebResponse(res: Response, out: ServerResponse): Promise<void> {
  out.statusCode = res.status;
  res.headers.forEach((v, k) => out.setHeader(k, v));
  if (!res.body) {
    out.end();
    return;
  }
  const reader = res.body.getReader();
  let finished = false;
  const cancelBody = () => {
    if (!finished) void reader.cancel().catch(() => undefined);
  };
  out.once('close', cancelBody);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value && !out.write(value)) await waitForDrain(out);
    }
    if (!out.writableEnded) out.end();
  } catch (err) {
    if (isConnectionAbort(err) || out.destroyed || out.writableEnded) {
      if (!out.destroyed && !out.writableEnded) out.destroy(err instanceof Error ? err : undefined);
      return;
    }
    throw err;
  } finally {
    finished = true;
    out.off('close', cancelBody);
    reader.releaseLock();
  }
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const MAX = 1024 * 1024;
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const b = chunk as Buffer;
    bytes += b.byteLength;
    if (bytes > MAX) throw new Error('request body too large');
    chunks.push(b);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function dispatchDashboard(
  dashboard: DashboardState,
  route: DashboardRoute,
  req: IncomingMessage,
  url: URL,
  port: number,
): Promise<Response | undefined> {
  const method = req.method ?? 'GET';
  switch (route.kind) {
    case 'html':
      if (method !== 'GET') return undefined;
      return dashboard.serveHtml(port);
    case 'stats':
      if (method !== 'GET') return undefined;
      return dashboard.serveStats();
    case 'recent':
      if (method !== 'GET') return undefined;
      return dashboard.serveRecent();
    case 'png': {
      if (method !== 'GET') return undefined;
      const idRaw = url.searchParams.get('id');
      const idNum = idRaw != null ? Number(idRaw) : NaN;
      return dashboard.servePng(Number.isFinite(idNum) ? idNum : undefined);
    }
    case 'api-image-source': {
      if (method !== 'GET') return undefined;
      const idRaw = url.searchParams.get('id');
      const idNum = idRaw != null ? Number(idRaw) : NaN;
      return dashboard.serveImageSource(Number.isFinite(idNum) ? idNum : undefined);
    }
    case 'api-sessions': {
      if (method !== 'GET') return undefined;
      return dashboard.serveSessionsJson({
        project: url.searchParams.get('project') ?? undefined,
        since: url.searchParams.get('since') ?? undefined,
      });
    }
    case 'api-stats':
      if (method !== 'GET') return undefined;
      return dashboard.serveApiStats();
    case 'current-session':
      if (method !== 'GET') return undefined;
      return dashboard.serveCurrentSessionJson();
    case 'fragment': {
      if (route.name === 'toggle' && method === 'POST') {
        let enabled = false;
        try {
          const raw = await readRequestBody(req);
          try {
            enabled = (JSON.parse(raw) as { enabled?: unknown }).enabled === true;
          } catch {
            enabled = new URLSearchParams(raw).get('enabled') === 'true';
          }
        } catch {
          return new Response('bad request body', { status: 400 });
        }
        dashboard.handleCompressionToggle({ enabled });
        return dashboard.serveFragment('toggle', url, port);
      }
      if (route.name === 'models' && method === 'POST') {
        let model = '';
        let on = false;
        try {
          const raw = await readRequestBody(req);
          try {
            const j = JSON.parse(raw) as { model?: unknown; on?: unknown };
            model = typeof j.model === 'string' ? j.model : '';
            on = j.on === true;
          } catch {
            const p = new URLSearchParams(raw);
            model = p.get('model') ?? '';
            on = p.get('on') === 'true';
          }
        } catch {
          return new Response('bad request body', { status: 400 });
        }
        if (model) dashboard.handleModelsToggle(model, on);
        return dashboard.serveFragment('models', url, port);
      }
      if (method !== 'GET') return undefined;
      return dashboard.serveFragment(route.name, url, port);
    }
    case 'api-compression': {
      if (method !== 'POST') {
        return new Response(
          JSON.stringify({ error: 'use POST' }),
          { status: 405, headers: { 'content-type': 'application/json' } },
        );
      }
      let body: Record<string, unknown> = {};
      try {
        const raw = await readRequestBody(req);
        body = raw ? JSON.parse(raw) : {};
      } catch (e) {
        return new Response(
          JSON.stringify({ error: 'bad request body', detail: (e as Error).message }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        );
      }
      return dashboard.handleCompressionToggle({ enabled: body.enabled });
    }
    case 'copilot-stats':
      if (method !== 'GET') return undefined;
      return dashboard.serveCopilotStats();
    case 'copilot-sessions':
      if (method !== 'GET') return undefined;
      return dashboard.serveCopilotSessions();
    case 'agent-stats':
      if (method !== 'GET') return undefined;
      return dashboard.serveAgentStats(route.agentId);
  }
}

class FileTracker implements Tracker {
  private fd: number | null = null;
  private bytesWritten = 0;
  private brokenLogged = false;
  private static readonly MAX_FILE_BYTES = 100 * 1024 * 1024;

  constructor(private readonly filePath: string) {}

  private ensureOpen(): boolean {
    if (this.fd != null) return true;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    } catch {}
    try {
      const st = fs.statSync(this.filePath);
      this.bytesWritten = st.size;
    } catch {
      this.bytesWritten = 0;
    }
    try {
      this.fd = fs.openSync(this.filePath, 'a');
      return true;
    } catch (err) {
      if (!this.brokenLogged) {
        console.error(
          `[compresso] FileTracker disabled — cannot open ${this.filePath}: ${(err as Error).message}`,
        );
        this.brokenLogged = true;
      }
      return false;
    }
  }

  private rotate(): void {
    if (this.fd != null) {
      try { fs.closeSync(this.fd); } catch {}
      this.fd = null;
    }
    try {
      fs.renameSync(this.filePath, this.filePath + '.1');
    } catch {}
    this.bytesWritten = 0;
  }

  emit(ev: TrackEvent): void {
    if (!this.ensureOpen()) return;
    try {
      const line = JSON.stringify(ev) + '\n';
      const buf = Buffer.from(line, 'utf8');
      fs.writeSync(this.fd!, buf);
      this.bytesWritten += buf.length;
      if (this.bytesWritten > FileTracker.MAX_FILE_BYTES) this.rotate();
    } catch (err) {
      if (!this.brokenLogged) {
        console.error(`[compresso] FileTracker write failed: ${(err as Error).message}`);
        this.brokenLogged = true;
      }
    }
  }

  flush(): void {
    if (this.fd != null) {
      try { fs.fsyncSync(this.fd); } catch {}
    }
  }

  close(): void {
    if (this.fd != null) {
      try { fs.fsyncSync(this.fd); } catch {}
      try { fs.closeSync(this.fd); } catch {}
      this.fd = null;
    }
  }
}

async function maybeWriteBodySidecar(
  bytesGz: Uint8Array,
  sha8: string | undefined,
  dir: string,
): Promise<string | undefined> {
  try { fs.mkdirSync(dir, { recursive: true }); } catch { return undefined; }
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const tag = sha8 ?? 'nohash';
  const filePath = path.join(dir, `${ts}-${tag}.json.gz`);
  try {
    await fs.promises.writeFile(filePath, bytesGz);
    return filePath;
  } catch { return undefined; }
}

function cacheHelp(): void {
  console.log(`compresso cache — render-cache inspection and maintenance

Usage:
  compresso cache stats         show entry count and total byte usage
  compresso cache clean         wipe the entire render cache
  compresso cache prune         evict coldest entries, respecting LRU caps

Environment:
  COMPRESSO_CACHE_DIR           cache directory
                                (default ~/.compresso/cache)
  COMPRESSO_CACHE_MAX_FILES     max cached entries (default 1000)
  COMPRESSO_CACHE_MAX_BYTES     max total bytes (default 500000000)
`);
}

async function runCache(argv: string[]): Promise<void> {
  const cmd = argv[0];
  if (!cmd || cmd === '--help' || cmd === '-h') {
    cacheHelp();
    return;
  }

  const dir = process.env.COMPRESSO_CACHE_DIR
    || path.join(os.homedir(), '.compresso', 'cache');
  const maxFiles = Number(process.env.COMPRESSO_CACHE_MAX_FILES) || 1000;
  const maxBytes = Number(process.env.COMPRESSO_CACHE_MAX_BYTES) || 500_000_000;
  const cache = new FilesystemLruCache({ dir, maxFiles, maxBytes });

  switch (cmd) {
    case 'stats': {
      const s = await cache.stats();
      console.log(`cache entries: ${s.count}`);
      console.log(`total bytes:   ${s.totalBytes} (${(s.totalBytes / 1024 / 1024).toFixed(1)} MB)`);
      break;
    }
    case 'clean': {
      await cache.clear();
      console.log('cache cleared');
      break;
    }
    case 'prune': {
      const sBefore = await cache.stats();
      await cache.forceEvict(Math.max(1, Math.ceil(sBefore.count * 0.25)));
      const sAfter = await cache.stats();
      const evicted = sBefore.count - sAfter.count;
      const freed = sBefore.totalBytes - sAfter.totalBytes;
      console.log(`evicted ${evicted} entries (${(freed / 1024 / 1024).toFixed(1)} MB freed)`);
      console.log(`${sAfter.count} entries remain (${(sAfter.totalBytes / 1024 / 1024).toFixed(1)} MB)`);
      break;
    }
    default:
      console.error(`unknown cache subcommand: ${cmd}`);
      cacheHelp();
  }
}

function printExportHelp(): void {
  console.log(`compresso export — render code/text to PNG pages for compressed LLM context

Usage:
  compresso export [target ...]    default target is "." (current directory)

Targets:
  Files or directories to include. Multiple targets are joined with a header
  separator line. Defaults to "." when none are given.

Options:
  --include <glob>   include only files matching glob (repeatable)
  --exclude <glob>   exclude files matching glob (repeatable)
  --git              render "git diff HEAD" plus untracked files
  --diff <ref>       render "git diff <ref>"
  --stdin            read source text from stdin instead of files
  --out <dir>        base output directory (default \$TMPDIR or /tmp)
  --model <id>       model id for vision-token estimate (default claude-sonnet-4-5)
  --json             print report as JSON
  --open             reveal the output folder when done (macOS) so you can
                     drag the PNG pages straight into your chat
  -h, --help         show this help

Output:
  <out>/compresso-export-<hash>/
    page-001.png ...  rendered image pages
    factsheet.txt     verbatim precision tokens (paths, SHAs, ids, numbers)
    manifest.json     metadata + token report
    prompt.txt        paste-ready agent instruction referencing the images

Report columns:
  text tokens   approximate tokens if the source were sent as plain text
  image tokens  estimated tokens to send the rendered PNG pages
  % saved       (text − image) / text × 100

Examples:
  compresso export .                              # whole directory
  compresso export --include "*.ts" src/          # TypeScript files only
  compresso export --git                          # uncommitted changes
  compresso export --diff HEAD~3                  # last 3 commits
  compresso export --open src/                    # render src/, then reveal the folder
  cat big-file.txt | compresso export --stdin
`);
}

const WALK_SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build',
  '__pycache__', '.cache', '.next', '.nuxt', '.turbo',
]);

interface CollectedFile {
  relPath: string;
  content: string;
}

function walkDir(
  dir: string,
  rootDir: string,
  include: string[],
  exclude: string[],
  out: CollectedFile[],
): void {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(rootDir, full).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (WALK_SKIP_DIRS.has(entry.name)) continue;
      walkDir(full, rootDir, include, exclude, out);
    } else if (entry.isFile()) {
      const r = readExportTextFile(full, rel, include, exclude);
      if (r.kind === 'ok') out.push({ relPath: rel, content: r.content });
    }
  }
}

function collectFilesFromTargets(
  targets: string[],
  include: string[],
  exclude: string[],
): CollectedFile[] {
  const files: CollectedFile[] = [];
  for (const target of targets) {
    let st: fs.Stats;
    try { st = fs.statSync(target); } catch {
      console.warn(`[compresso export] skipping inaccessible target: ${target}`);
      continue;
    }
    if (st.isDirectory()) {
      walkDir(target, target, include, exclude, files);
    } else if (st.isFile()) {
      const rel = path.basename(target);
      const r = readExportTextFile(target, rel, include, exclude);
      if (r.kind === 'ok') files.push({ relPath: rel, content: r.content });
      else if (r.kind !== 'excluded') {
        console.warn(`[compresso export] skipping ${r.kind} file: ${target}`);
      }
    }
  }
  return files;
}

function gitRun(args: string[], cwd: string): string | null {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0 || result.error) return null;
  return result.stdout ?? null;
}

async function collectSource(opts: ExportParsed): Promise<[string, string[]]> {
  if (opts.stdin) {
    const chunks: string[] = [];
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
      if (typeof chunk === 'string') chunks.push(chunk);
    }
    return [chunks.join(''), []];
  }

  if (opts.diff !== undefined) {
    const cwd = opts.targets.length > 0 ? opts.targets[0]! : process.cwd();
    const diff = gitRun(['diff', opts.diff], cwd);
    if (diff === null) {
      console.error(`[compresso export] git diff ${opts.diff} failed`);
      process.exit(1);
    }
    return [diff, []];
  }

  if (opts.git) {
    const cwd = opts.targets.length > 0 ? opts.targets[0]! : process.cwd();
    const diff = gitRun(['diff', 'HEAD'], cwd) ?? '';
    const untrackedOut = gitRun(['ls-files', '--others', '--exclude-standard'], cwd) ?? '';
    const untrackedFiles = untrackedOut.split('\n').map((l) => l.trim()).filter(Boolean);
    let untracked = '';
    for (const rel of untrackedFiles) {
      const full = path.join(cwd, rel);
      const r = readExportTextFile(full, rel, opts.include, opts.exclude);
      if (r.kind === 'ok') untracked += `\n===== ${rel} =====\n` + r.content;
      else if (r.kind !== 'excluded') {
        console.warn(`[compresso export] skipping ${r.kind} untracked file: ${rel}`);
      }
    }
    return [diff + untracked, []];
  }

  const targets = opts.targets.length > 0 ? opts.targets : ['.'];
  const files = collectFilesFromTargets(targets, opts.include, opts.exclude);
  if (files.length === 0) console.warn('[compresso export] no files collected');
  const sourceText = files.map((f) => `===== ${f.relPath} =====\n${f.content}`).join('\n\n');
  const sourceFiles = files.map((f) => f.relPath);
  return [sourceText, sourceFiles];
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function printExportReport(opts: ExportParsed, outDir: string, sourceFiles: string[], result: ExportResult): void {
  const { manifest } = result;
  const { tokenReport, pages } = manifest;
  const totalPngBytes = pages.reduce((s, p) => s + p.bytes, 0);

  if (opts.json) {
    process.stdout.write(
      JSON.stringify({
        outDir, fileCount: sourceFiles.length, sourceChars: manifest.sourceChars,
        pageCount: pages.length, totalPngBytes,
        textTokens: tokenReport.textTokens, imageTokens: tokenReport.imageTokens,
        percentSaved: tokenReport.percentSaved,
        factsheetItemCount: tokenReport.factsheetItemCount,
        factsheetDropped: tokenReport.factsheetDropped,
        model: manifest.model, cols: manifest.cols, generatedAt: manifest.generatedAt,
      }) + '\n',
    );
    return;
  }

  const saved = tokenReport.percentSaved;
  const savedStr = saved >= 0 ? `${saved.toFixed(1)}% saved` : `${Math.abs(saved).toFixed(1)}% more expensive`;
  const droppedNote = tokenReport.factsheetDropped > 0 ? ` (${tokenReport.factsheetDropped} dropped)` : '';
  console.log(
    `\ncompresso export\n` +
    `  out:            ${outDir}\n` +
    `  files:          ${sourceFiles.length}\n` +
    `  source chars:   ${formatNumber(manifest.sourceChars)}\n` +
    `  pages:          ${pages.length} (${formatNumber(totalPngBytes)} bytes)\n` +
    `  text tokens:    ~${formatNumber(tokenReport.textTokens)}\n` +
    `  image tokens:   ~${formatNumber(tokenReport.imageTokens)}  (${savedStr})\n` +
    `  factsheet:      ${tokenReport.factsheetItemCount} items${droppedNote}\n`,
  );
  console.log(
    `next — get this into your chat:\n` +
    `  1. attach the ${pages.length} page-*.png file${pages.length === 1 ? '' : 's'} from that folder\n` +
    `  2. paste prompt.txt alongside them (it tells the model what the images are)\n` +
    `     factsheet.txt has the verbatim paths / ids / numbers if you need exact strings\n` +
    (opts.open ? `  opening the folder…\n` : `  tip: add --open to reveal the folder automatically\n`),
  );
}

async function runExport(argv: string[]): Promise<void> {
  const parseResult = parseExportArgv(argv);

  if (parseResult.kind === 'help') { printExportHelp(); process.exit(0); }
  if (parseResult.kind === 'error') {
    console.error(`[compresso export] ${parseResult.message}`);
    console.error(`[compresso export] run \`compresso export --help\` for usage`);
    process.exit(2);
  }

  const opts = parseResult.parsed;
  const [sourceText, sourceFiles] = await collectSource(opts);
  fs.mkdirSync(opts.out, { recursive: true });
  const outDir = fs.mkdtempSync(path.join(opts.out, 'compresso-export-'));
  const result = await runExportCore(sourceText, { sourceFiles, cols: opts.cols, model: opts.model });

  for (const artifact of result.artifacts) {
    fs.writeFileSync(path.join(outDir, artifact.filename), artifact.data);
  }

  printExportReport(opts, outDir, sourceFiles, result);

  if (opts.open) spawnSync('open', [outDir], { stdio: 'ignore' });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === 'export') { await runExport(argv.slice(1)); return; }
  if (argv[0] === 'cache') { await runCache(argv.slice(1)); return; }

  const opts = parseCli(argv);
  const forcePassthrough = /^(1|true|yes|on)$/i.test(process.env.COMPRESSO_DISABLE ?? '');
  if (forcePassthrough) {
    console.log('[compresso] COMPRESSO_DISABLE set — passthrough mode (compress=false), still logging usage + baselines');
  }

  let imageDumpDir: string | undefined = process.env.COMPRESSO_DUMP_DIR?.trim() || undefined;
  let imageDumpSeq = 0;
  if (imageDumpDir) {
    try {
      fs.mkdirSync(imageDumpDir, { recursive: true });
      console.log(`[compresso] COMPRESSO_DUMP_DIR set — dumping rendered PNGs to ${imageDumpDir}`);
    } catch (err) {
      console.warn(`[compresso] COMPRESSO_DUMP_DIR unusable (${(err as Error).message}) — image dumping disabled`);
      imageDumpDir = undefined;
    }
  }

  const tracker: Tracker = new FileTracker(opts.eventsFile);
  const bodySidecarDir = path.join(path.dirname(opts.eventsFile), '4xx-bodies');
  const dashboard = new DashboardState({ eventsFile: opts.eventsFile, sidecarDir: bodySidecarDir });
  await dashboard.replay(opts.eventsFile).catch(() => {});

  const renderCache = new FilesystemLruCache();
  await renderCache.init().catch((err: unknown) => {
    console.warn(`[compresso] render cache init failed: ${(err as Error).message} — continuing without cache`);
  });

  const config: ProxyConfig = {
    provider: opts.provider,
    gatewayBaseUrl: opts.gatewayBaseUrl,
    gatewayHeaders: opts.gatewayHeaders,
    upstream: opts.upstream,
    openAIUpstream: opts.openAIUpstream,
    opencodeUpstream: opts.opencodeUpstream,
    opencodeGoUpstream: opts.opencodeGoUpstream,
    apiKey: opts.apiKey,
    openAIApiKey: opts.openAIApiKey,
    transform: () => {
      if (forcePassthrough || !dashboard.getCompressionEnabled()) return { compress: false };
      return { cache: renderCache };
    },
    onBeforeTransform: (body, env) => {
      try {
        const cm = getContextManager();
        const cwd = env.cwd ?? process.cwd();
        const sessionId = `proxy-${Date.now()}`;
        const taskState = captureTaskState(cwd, sessionId);
        const packet = cm.getContext(taskState, { budgetTokens: 2000, includeProvenance: true });
        if (packet.items.length > 0) {
          return injectContextPacket(body, packet);
        }
      } catch {}
      return body;
    },
    onAfterResponse: (responseJson, env) => {
      try {
        const cm = getContextManager();
        const hasToolCalls = responseJson?.choices?.some((c: any) => c?.message?.tool_calls?.length > 0);
        if (hasToolCalls) {
          const cwd = env.cwd ?? process.cwd();
          const artifacts = extractArtifactsFromResponse(responseJson);
          for (const a of artifacts) {
            cm.recordArtifact({
              type: 'tool_output' as const,
              content: a.content,
              sourceRepo: cwd,
              sourcePath: a.path,
              sourceCommit: null,
              sourceBranch: null,
            });
          }
        }
      } catch {}
    },
    onRequest: async (e) => {
      e.client = process.env.COMPRESSO_CLIENT ?? 'unknown';
      if (process.env.COMPRESSO_CWD) e.cwd = process.env.COMPRESSO_CWD;

      dashboard.update(e);
      if (imageDumpDir && e.info?.imagePngs && e.info.imagePngs.length > 0) {
        const seq = ++imageDumpSeq;
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const modelTag = (e.model ?? 'model').replace(/[^A-Za-z0-9._-]+/g, '_');
        const pngs = e.info.imagePngs;
        for (let i = 0; i < pngs.length; i++) {
          const name = `${stamp}_req${String(seq).padStart(3, '0')}_${modelTag}_p${String(i + 1).padStart(2, '0')}.png`;
          try { fs.writeFileSync(path.join(imageDumpDir, name), pngs[i]!); } catch (err) {
            console.warn(`[compresso] PNG dump write failed: ${(err as Error).message}`);
            break;
          }
        }
        console.log(`  ↳ dumped ${pngs.length} rendered png(s) → ${imageDumpDir}`);
      }

      const extra: string[] = [];
      if (e.info?.reminderImgs) extra.push(`rem+${e.info.reminderImgs}`);
      if (e.info?.toolResultImgs) extra.push(`tr+${e.info.toolResultImgs}`);
      const extraTag = extra.length > 0 ? ` (${extra.join(' ')})` : '';
      const tag = e.info?.compressed
        ? `compressed ${e.info.origChars}ch → ${e.info.imageCount}img/${e.info.imageBytes}B${extraTag}`
        : (e.info?.reason ?? '');
      const cacheRead = e.usage?.cache_read_input_tokens ?? 0;
      const inputTokens = e.usage?.input_tokens ?? 0;
      const usageTag = e.usage !== undefined
        ? ` tokens=${inputTokens}+${e.usage.output_tokens ?? 0} cache_read=${cacheRead}`
        : '';
      console.log(`[${new Date().toISOString()}] ${e.method} ${e.path} → ${e.status} (${e.durationMs}ms) ${tag}${usageTag}`);

      if (e.errorBody) {
        const trimmed = e.errorBody.length > 400 ? e.errorBody.slice(0, 400) + '…' : e.errorBody;
        console.warn(`[compresso ${e.status}] upstream body: ${trimmed}`);
      }

      if (e.info?.unknownStaticTags && e.info.unknownStaticTags.length > 0) {
        console.warn(
          `[compresso warn] unknown tag(s) in static slab: ${e.info.unknownStaticTags.join(', ')}  ` +
            `— may need to add to DYNAMIC_BLOCK_TAGS or KNOWN_STATIC_TAGS in src/core/transform.ts`,
        );
      }

      if (e.reqBodyGz && e.reqBodyGz.byteLength * 4 > TRACK_BODY_INLINE_MAX * 3) {
        const writtenPath = await maybeWriteBodySidecar(e.reqBodyGz, e.reqBodySha8, bodySidecarDir);
        if (writtenPath) { e.reqBodySamplePath = writtenPath; e.reqBodyGz = undefined; }
      }

      tracker.emit(toTrackEvent(e));
    },
  };
  const handle = createProxy(config);

  const server = createServer((req, res) => {
    Promise.resolve()
      .then(async () => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        const route = dashboardPath(url.pathname);
        if (route) {
          const webRes = await dispatchDashboard(dashboard, route, req, url, opts.port);
          if (webRes) { await writeWebResponse(webRes, res); return; }
        }
        const webReq = toWebRequest(req);
        const webRes = await handle(webReq);
        await writeWebResponse(webRes, res);
      })
      .catch((err) => {
        console.error('[compresso] handler error:', err);
        if (!res.headersSent) res.statusCode = 500;
        res.end();
      });
  });

  const displayHost = opts.host.includes(':') ? `[${opts.host}]` : opts.host;
  const isLoopbackHost = opts.host === '127.0.0.1' || opts.host === 'localhost' || opts.host === '::1';
  server.listen(opts.port, opts.host, () => {
    console.log(`[compresso] listening on http://${displayHost}:${opts.port}`);
    if (!isLoopbackHost) {
      console.warn(
        `[compresso] WARNING: bound to ${opts.host} — the unauthenticated dashboard ` +
          `(captured request context + kill switch) is reachable off-host. ` +
          `Unset HOST to restrict to loopback.`,
      );
    }
    const routes = resolveUpstreams(config);
    console.log(`[compresso] anthropic upstream → ${routes.anthropic}`);
    console.log(`[compresso] openai upstream → ${routes.openai}`);
    console.log(`[compresso] tracking events → ${opts.eventsFile}`);
    console.log(`[compresso] dashboard → http://127.0.0.1:${opts.port}/`);
  });

  let shuttingDown = false;
  const shutdown = (sig: string) => {
    if (shuttingDown) { console.log(`[compresso] ${sig} again — forcing exit`); process.exit(130); }
    shuttingDown = true;
    console.log(`[compresso] ${sig} — shutting down`);
    if (tracker instanceof FileTracker) tracker.close();
    server.close(() => process.exit(0));
    server.closeIdleConnections?.();
    const deadline = setTimeout(() => { server.closeAllConnections?.(); process.exit(0); }, 1500);
    deadline.unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[compresso] fatal:', err);
  process.exit(1);
});
