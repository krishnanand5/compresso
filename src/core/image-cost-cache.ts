/** Per-model image cost calibration cache.
 *
 *  The profitability gate estimates image token cost using OpenAI's formula,
 *  but upstream providers (especially opencode gateway for qwen/minimax/etc)
 *  may bill images very differently. After each compressed request we compare
 *  the estimated image tokens against the actual input tokens billed, and
 *  store a smoothed multiplier per model. Future gate checks multiply the
 *  estimate by this learned ratio.
 *
 *  Persistence: JSON file at ~/.compresso/image-cost-cache.json. Loaded on
 *  first access, written after each update. In-memory map is the hot path.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface ModelCostEntry {
  /** Smoothed multiplier: actual_input / baseline_tokens. >1 means compression lost money. */
  multiplier: number;
  /** Number of observations folded into the multiplier. */
  n: number;
  /** Last updated timestamp (epoch ms). */
  lastTs: number;
}

type ModelCostCacheMap = Record<string, ModelCostEntry>;

const CACHE_FILE = path.join(os.homedir(), '.compresso', 'image-cost-cache.json');
const SMOOTHING_FACTOR = 0.15; // low = noise-resistant, slow convergence
const DEFAULT_MULTIPLIER = 1.0;
const MIN_MULTIPLIER = 1.0; // floor: gate only gets MORE conservative with learning
const MAX_MULTIPLIER = 10.0; // cap: images cost at most 10x estimate
/** Minimum observations before the learned multiplier is trusted (falls back to 1.0). */
const MIN_OBSERVATIONS = 3;

/** Bucket baselineTokens into size ranges for per-model-size multiplier keys. */
function sizeBucket(baselineTokens: number): string {
  if (baselineTokens < 5000) return 's';  // small slab (high overhead)
  if (baselineTokens < 20000) return 'm'; // medium
  return 'l';                              // large (efficient)
}

function modelKey(model: string, baselineTokens: number): string {
  return `${model}:${sizeBucket(baselineTokens)}`;
}

let cache: ModelCostCacheMap | null = null;

function loadCache(): ModelCostCacheMap {
  if (cache !== null) return cache;
  let loaded: ModelCostCacheMap = {};
  try {
    if (fs.existsSync(CACHE_FILE)) {
      loaded = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    }
  } catch {}
  cache = loaded;
  return cache;
}

function saveCache(): void {
  if (cache === null) return;
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch {}
}

/** Get the learned multiplier for a (model, slabSize) bucket.
 *  Returns DEFAULT_MULTIPLIER if unknown OR fewer than MIN_OBSERVATIONS. */
export function getModelCostMultiplier(model: string, baselineTokens: number): number {
  const c = loadCache();
  const key = modelKey(model, baselineTokens);
  const entry = c[key];
  if (!entry || entry.n < MIN_OBSERVATIONS) return DEFAULT_MULTIPLIER;
  return entry.multiplier;
}

/** Clamp multiplier to reasonable bounds. */
function clampMultiplier(m: number): number {
  return Math.max(MIN_MULTIPLIER, Math.min(MAX_MULTIPLIER, m));
}

/** Record an observation: baselineTokens (what text would cost) vs actualInput (what we paid).
 *  Updates the smoothed multiplier for the (model, sizeBucket) key. */
export function recordImageCostObservation(
  model: string,
  baselineTokens: number,
  actualInput: number,
): void {
  if (baselineTokens <= 0 || actualInput <= 0) return;
  const c = loadCache();
  const key = modelKey(model, baselineTokens);
  const ratio = actualInput / baselineTokens;
  const existing = c[key];
  if (existing) {
    const raw = existing.multiplier * (1 - SMOOTHING_FACTOR) + ratio * SMOOTHING_FACTOR;
    existing.multiplier = clampMultiplier(raw);
    existing.n += 1;
    existing.lastTs = Date.now();
  } else {
    c[key] = {
      multiplier: clampMultiplier(ratio),
      n: 1,
      lastTs: Date.now(),
    };
  }
  cache = c;
  saveCache();
}

/** Reset the cache (for testing or manual recalibration). */
export function resetImageCostCache(): void {
  cache = {};
  try {
    if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);
  } catch {}
}
