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
  /** Smoothed multiplier: actual_image_tokens / estimated_image_tokens. */
  multiplier: number;
  /** Number of observations folded into the multiplier. */
  n: number;
  /** Last updated timestamp (epoch ms). */
  lastTs: number;
}

type ModelCostCacheMap = Record<string, ModelCostEntry>;

const CACHE_FILE = path.join(os.homedir(), '.compresso', 'image-cost-cache.json');
const SMOOTHING_FACTOR = 0.3; // weight of new observation vs existing (0 = ignore new)
const DEFAULT_MULTIPLIER = 1.0;

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

/** Get the learned multiplier for a model. Returns DEFAULT_MULTIPLIER if unknown. */
export function getModelCostMultiplier(model: string): number {
  const c = loadCache();
  const entry = c[model];
  return entry?.multiplier ?? DEFAULT_MULTIPLIER;
}

/** Record an observation: estimated image tokens vs actual image tokens.
 *  Updates the smoothed multiplier for the model. */
export function recordImageCostObservation(
  model: string,
  estimatedImageTokens: number,
  actualImageTokens: number,
): void {
  if (estimatedImageTokens <= 0 || actualImageTokens <= 0) return;
  const c = loadCache();
  const ratio = actualImageTokens / estimatedImageTokens;
  const existing = c[model];
  if (existing) {
    // Exponential moving average
    existing.multiplier = existing.multiplier * (1 - SMOOTHING_FACTOR) + ratio * SMOOTHING_FACTOR;
    existing.n += 1;
    existing.lastTs = Date.now();
  } else {
    c[model] = {
      multiplier: ratio,
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
