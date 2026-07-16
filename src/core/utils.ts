import type { GptHistoryOptions } from './openai-history.js';
import { MAX_HEIGHT_PX, PAD_Y, CELL_H, READABLE_CHARS_PER_IMAGE } from './render.js';

export const ANTHROPIC_PIXELS_PER_TOKEN = 750;
export const IMAGE_COST_SAFETY_MARGIN = 1.10;
export const REPORT_CHARS_PER_TOKEN = 3.7;
export const LINES_PER_IMAGE = Math.max(1, Math.floor((MAX_HEIGHT_PX - 2 * PAD_Y) / CELL_H));

export const HISTORY_SYNTHETIC_INTRO =
  '[Earlier turns of THIS conversation, transcribed in the image(s) below. Each turn is wrapped in <user t="N">...</user> or <assistant t="N">...</assistant> tags, where N is an absolute turn index (larger N = more recent); attribute every turn strictly by its tag, and treat the highest-N turns as the most recent prior context, NOT the low-N opening turns. Earlier turns may contain questions or tasks that were already answered later in this same history; do not reopen low-N turns unless the live text after this block asks you to. This is prior context, NOT the current request.]';
export const HISTORY_SYNTHETIC_OUTRO =
  '[End of earlier conversation. The current request is the live text that follows below.]';

export interface KeepSharpBlock {
  readonly kind: 'reminder' | 'tool_result' | 'tool_result_part';
  readonly text: string;
  readonly toolUseId?: string;
}

export interface RecoverableBlock {
  readonly id: string;
  readonly kind: 'reminder' | 'tool_result' | 'tool_result_part';
  readonly toolUseId?: string;
  readonly text: string;
  readonly imageCount: number;
}

export interface TransformOptions {
  compress?: boolean;
  compressTools?: boolean;
  compressReminders?: boolean;
  compressToolResults?: boolean;
  minCompressChars?: number;
  minReminderChars?: number;
  minToolResultChars?: number;
  cols?: number;
  maxImagesPerToolResult?: number;
  multiCol?: number;
  charsPerToken?: number;
  historyAmortizationHorizon?: number;
  priorWarmTokens?: number;
  priorWarmImageTokens?: number;
  collapseHistory?: boolean;
  gptHistory?: Partial<GptHistoryOptions>;
  reflow?: boolean;
  keepSharp?: (block: KeepSharpBlock) => boolean;
  emitRecoverable?: boolean;
  /** Filesystem-backed LRU cache for rendered PNGs. */
  cache?: import('./cache.js').RenderCache;
}

export type BucketName =
  | 'static_slab'
  | 'tool_result_json'
  | 'tool_result_log'
  | 'tool_result_prose'
  | 'reminder'
  | 'history';

export type BucketChars = Partial<Record<BucketName, number>>;

export interface EnvFields {
  cwd?: string;
  isGitRepo?: boolean;
  gitBranch?: string;
  platform?: string;
  osVersion?: string;
  today?: string;
}

export interface TransformInfo {
  compressed: boolean;
  reason?: string;
  origChars: number;
  compressedChars: number;
  imageCount: number;
  imageBytes: number;
  imagePixels?: number;
  imageTokens?: number;
  baselineImagedTokens?: number;
  outgoingTextChars?: number;
  responsesComposition?: {
    instructions: number;
    systemDeveloper: number;
    userAssistant: number;
    functionCalls: number;
    functionOutputs: number;
    reasoningEncrypted: number;
    compactionOpaque: number;
    toolsJson: number;
    other: number;
    totalLocal: number;
    imageParts: number;
    completedFunctionPairs?: number;
    recentNativeFunctionPairs?: number;
    oldFunctionPairs?: number;
    openFunctionCalls?: number;
    orphanFunctionOutputs?: number;
    malformedFunctionItems?: number;
    imageableFunctionCalls?: number;
    imageableFunctionOutputs?: number;
    collapsedFunctionPairs?: number;
    collapsedFunctionCalls?: number;
    collapsedFunctionOutputs?: number;
  };
  staticChars: number;
  dynamicChars: number;
  envRelocatedChars?: number;
  dynamicBlockCount: number;
  unknownStaticTags?: string[];
  churningStaticTags?: string[];
  envVolatileKeys?: string[];
  envStaticChars?: number;
  env?: EnvFields;
  systemSha8?: string;
  claudeMdSha8?: string;
  firstUserSha8?: string;
  firstImagePng?: Uint8Array;
  firstImageWidth?: number;
  firstImageHeight?: number;
  imagePngs?: Uint8Array[];
  imageDims?: Array<{ width: number; height: number }>;
  imageSourceText?: string;
  imageSourceTexts?: Array<string | undefined>;
  reminderImgs?: number;
  toolResultImgs?: number;
  toolDocsChars?: number;
  droppedChars?: number;
  droppedCodepointsTop?: Record<string, number>;
  passthroughReasons?: { below_threshold?: number; not_profitable?: number; kept_sharp?: number };
  gateEval?: {
    readonly site: 'slab';
    readonly imageTokens: number;
    readonly textTokens: number;
    readonly burnImageSide: number;
    readonly burnTextSide: number;
    readonly profitable: boolean;
  };
  bucketChars?: BucketChars;
  historyTextChars?: number;
  keptSharpBlocks?: number;
  recoverable?: RecoverableBlock[];
  truncatedToolResults?: number;
  omittedChars?: number;
  collapsedTurns?: number;
  collapsedChars?: number;
  collapsedImages?: number;
  historyImageSha?: string;
  cachePrefixSha8?: string;
  cachePrefixBytes?: number;
  historyReason?:
    | 'no_history'
    | 'prefix_too_short'
    | 'no_closed_prefix'
    | 'below_min_chars'
    | 'below_min_tokens'
    | 'not_profitable'
    | 'too_many_images'
    | 'render_empty'
    | 'collapsed';
  baselineTokens?: number;
  baselineCacheableTokens?: number;
  baselineProbeStatus?: 'ok' | 'partial' | 'failed';
}

export function maxCharsPerImage(cols: number): number {
  return Math.min(cols * LINES_PER_IMAGE, READABLE_CHARS_PER_IMAGE);
}

export function compactSlabWhitespace(text: string): string {
  if (!text) return text;
  let trimmed = '';
  let lineStart = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text.charCodeAt(i) === 10) {
      let end = i;
      while (end > lineStart) {
        const c = text.charCodeAt(end - 1);
        if (c !== 32 && c !== 9) break;
        end--;
      }
      trimmed += text.slice(lineStart, end);
      if (i < text.length) trimmed += '\n';
      lineStart = i + 1;
    }
  }
  return trimmed.replace(/\n{3,}/g, '\n\n');
}

export function countVisualRows(text: string, cols: number): number {
  let rows = 0;
  let lineStart = 0;
  const len = text.length;
  for (let i = 0; i <= len; i++) {
    const cc = i < len ? text.charCodeAt(i) : -1;
    if (i === len || cc === 10) {
      const lineLen = i - lineStart;
      rows += lineLen === 0 ? 1 : Math.ceil(lineLen / Math.max(1, cols));
      lineStart = i + 1;
    }
  }
  return rows;
}

export function estimateImageCount(
  textOrLen: string | number,
  cols: number,
  numCols: number = 1,
  maxCharsPerImageVal: number = READABLE_CHARS_PER_IMAGE,
  maxLinesPerColumn: number = LINES_PER_IMAGE,
): number {
  const n = Math.max(1, numCols | 0);
  const readableLinesPerCol = Math.max(1, Math.floor(maxCharsPerImageVal / Math.max(1, cols)));
  const hardLinesPerCol = Math.max(1, Math.floor(maxLinesPerColumn));
  const linesPerImage = Math.min(hardLinesPerCol, readableLinesPerCol) * n;
  const charBudget = Math.max(1, maxCharsPerImageVal * n);
  if (typeof textOrLen === 'number') {
    return Math.max(1, Math.ceil(textOrLen / charBudget));
  }
  const rows = countVisualRows(textOrLen, cols);
  return Math.max(
    1,
    Math.ceil(rows / linesPerImage),
    Math.ceil(textOrLen.length / charBudget),
  );
}

/**
 * Anthropic cache-read/cache-create pricing ratios for dashboard savings math.
 * Workers-safe: no node:, no Buffer, no process.*. Pure number math.
 */
export const CACHE_CREATE_RATE = 1.25;
export const CACHE_READ_RATE = 0.1;

export const CACHE_TTL_SEC = 300;

export interface BaselineWarmthPrev {
  ts: number;
  cacheable: number;
  prefixSha?: string;
}

export function deriveBaselineWarmth(
  prev: BaselineWarmthPrev | undefined,
  nowSec: number,
  cacheable: number,
  cr: number,
  ttlSec: number = CACHE_TTL_SEC,
  prefixSha?: string,
): { warm: boolean; prevCacheable: number } {
  const age = prev !== undefined ? nowSec - prev.ts : Number.POSITIVE_INFINITY;
  const samePrefix = prev === undefined
    || prev.prefixSha === undefined
    || prefixSha === undefined
    || prev.prefixSha === prefixSha;
  if (!(cr > 0)) return { warm: false, prevCacheable: 0 };
  const freshPrior = prev !== undefined && age >= 0 && age < ttlSec && samePrefix;
  return { warm: true, prevCacheable: freshPrior ? prev!.cacheable : cacheable };
}

export function computeBaselineInputEff(
  baseline: number,
  baselineCacheable: number,
  inputTokens: number,
  cc: number,
  cr: number,
  warm = false,
  prevCacheable = 0,
): number {
  if (baseline <= 0) return 0;
  if (baselineCacheable <= 0) return computeActualInputEff(inputTokens, cc, cr);
  const cacheable = Math.min(baselineCacheable, baseline);
  const coldTail = baseline - cacheable;
  if (warm) {
    const reused = Math.min(Math.max(prevCacheable, 0), cacheable);
    const grown = cacheable - reused;
    return reused * CACHE_READ_RATE + grown * CACHE_CREATE_RATE + coldTail * 1.0;
  }
  return cacheable * CACHE_CREATE_RATE + coldTail * 1.0;
}

export function computeActualInputEff(
  inputTokens: number,
  cc: number,
  cr: number,
): number {
  return inputTokens + cc * CACHE_CREATE_RATE + cr * CACHE_READ_RATE;
}

export async function sha8(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < 4; i++) hex += bytes[i]!.toString(16).padStart(2, '0');
  return hex;
}
