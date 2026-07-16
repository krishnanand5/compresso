/**
 * Filesystem-backed LRU render cache.
 *
 * Stores serialised RenderedImage arrays keyed by a sha256 of the canonical
 * render inputs.  Evicts coldest entries when caps are exceeded.
 *
 * Layout:
 *   ~/.compresso/cache/
 *     index.json     → { entries: { <sha256>: { atime, size } } }
 *     <sha256>.json  → serialised CacheEntry
 *
 * Thread-safe at the filesystem level (atomic writes, stale reads recover).
 */

import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rm, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { RenderedImage } from './render.js';

// ── constants ───────────────────────────────────────────────────────────
const INDEX_FILE = 'index.json';
const DEFAULT_DIR = path.join(os.homedir(), '.compresso', 'cache');
const DEFAULT_MAX_FILES = 1000;
const DEFAULT_MAX_BYTES = 500 * 1024 * 1024; // 500 MB
const EVICT_FRACTION = 0.1; // evict coldest 10 %  when over cap

// ── types ───────────────────────────────────────────────────────────────

interface CachedImage {
  pngB64: string;
  width: number;
  height: number;
  charsRendered: number;
  droppedChars: number;
  droppedCodepoints: Record<number, number>;
}

interface CacheEntryMeta {
  atime: number;
  size: number;
}

interface LruIndex {
  entries: Record<string, CacheEntryMeta>;
}

// ── helpers ─────────────────────────────────────────────────────────────

function serialise(images: RenderedImage[]): string {
  const entry = {
    images: images.map((img) => ({
      pngB64: Buffer.from(img.png).toString('base64'),
      width: img.width,
      height: img.height,
      charsRendered: img.charsRendered,
      droppedChars: img.droppedChars,
      droppedCodepoints: Object.fromEntries(img.droppedCodepoints),
    })),
  };
  return JSON.stringify(entry);
}

function deserialise(json: string): RenderedImage[] {
  const entry = JSON.parse(json) as { images: CachedImage[] };
  return entry.images.map((img) => ({
    png: Buffer.from(img.pngB64, 'base64'),
    width: img.width,
    height: img.height,
    charsRendered: img.charsRendered,
    droppedChars: img.droppedChars,
    droppedCodepoints: new Map(
      Object.entries(img.droppedCodepoints).map(([k, v]) => [Number(k), v]),
    ),
  }));
}

// ── cache class ─────────────────────────────────────────────────────────

export interface RenderCache {
  /** Build a deterministic cache key from render parameters. */
  cacheKey(
    text: string,
    cols: number,
    maxCharsPerImage: number,
    maxHeightPx: number,
    style: Record<string, unknown>,
  ): string;
  /** Returned cached images, or undefined on a miss. */
  get(key: string): Promise<RenderedImage[] | undefined>;
  /** Store rendered images. Shadows any previous entry with the same key. */
  set(key: string, images: RenderedImage[]): Promise<void>;
  /** Number of entries and total byte count. */
  stats(): Promise<{ count: number; totalBytes: number }>;
  /** Wipe the entire cache (index + all entry files). */
  clear(): Promise<void>;
  /** Force LRU eviction regardless of current caps. */
  forceEvict(count: number): Promise<void>;
  /** Ensure the cache directory and index file exist. Idempotent. */
  init(): Promise<void>;
}

export class FilesystemLruCache implements RenderCache {
  private readonly dir: string;
  private readonly maxFiles: number;
  private readonly maxBytes: number;
  private ready = false;
  private readyPromise: Promise<void> | null = null;

  constructor(opts?: {
    dir?: string;
    maxFiles?: number;
    maxBytes?: number;
  }) {
    this.dir = opts?.dir ?? DEFAULT_DIR;
    this.maxFiles = opts?.maxFiles ?? DEFAULT_MAX_FILES;
    this.maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  // ─ public API ────────────────────────────────────────────────────────

  cacheKey(
    text: string,
    cols: number,
    maxCharsPerImage: number,
    maxHeightPx: number,
    style: Record<string, unknown>,
  ): string {
    const canonical = JSON.stringify({
      t: text,
      c: cols,
      m: maxCharsPerImage,
      h: maxHeightPx,
      s: style,
    });
    return createHash('sha256').update(canonical).digest('hex');
  }

  async get(key: string): Promise<RenderedImage[] | undefined> {
    await this.ensureReady();
    const index = await this.readIndex();

    const meta = index.entries[key];
    if (!meta) return undefined;

    const filePath = this.entryPath(key);
    try {
      const raw = await readFile(filePath, 'utf-8');
      // Touch atime *before* returning so hot entries stay hot.
      meta.atime = Date.now();
      await this.writeIndex(index);
      return deserialise(raw);
    } catch {
      // Stale entry – remove from index so we don't keep trying.
      delete index.entries[key];
      await this.writeIndex(index);
      return undefined;
    }
  }

  async set(key: string, images: RenderedImage[]): Promise<void> {
    await this.ensureReady();
    const data = serialise(images);
    const bytes = Buffer.byteLength(data, 'utf-8');

    const filePath = this.entryPath(key);
    // Atomic write via temp file + rename.
    const tmp = filePath + '.tmp';
    await writeFile(tmp, data, 'utf-8');
    await rename(tmp, filePath);

    const index = await this.readIndex();
    index.entries[key] = { atime: Date.now(), size: bytes };
    await this.writeIndex(index);

    await this.evictIfNeeded();
  }

  async stats(): Promise<{ count: number; totalBytes: number }> {
    await this.ensureReady();
    const index = await this.readIndex();
    const entries = Object.entries(index.entries);
    return {
      count: entries.length,
      totalBytes: entries.reduce((sum, [, e]) => sum + e.size, 0),
    };
  }

  async clear(): Promise<void> {
    await this.ensureReady();
    const index = await this.readIndex();
    const keys = Object.keys(index.entries);
    for (const key of keys) {
      try {
        await rm(this.entryPath(key));
      } catch {
        /* best-effort */
      }
    }
    await writeFile(this.indexPath(), JSON.stringify({ entries: {} }));
  }

  async init(): Promise<void> {
    await this.ensureReady();
  }

  async forceEvict(count: number): Promise<void> {
    await this.ensureReady();
    const index = await this.readIndex();
    const entries = Object.entries(index.entries);
    if (entries.length === 0 || count <= 0) return;

    entries.sort(([, a], [, b]) => a.atime - b.atime);
    const toEvict = Math.min(count, entries.length);

    for (let i = 0; i < toEvict; i++) {
      const [key] = entries[i]!;
      delete index.entries[key];
      try {
        await rm(this.entryPath(key));
      } catch {
        /* best-effort */
      }
    }

    await this.writeIndex(index);
  }

  // ─ private helpers ───────────────────────────────────────────────────

  private async ensureReady(): Promise<void> {
    if (this.ready) return;
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = (async () => {
      await mkdir(this.dir, { recursive: true });
      // Initialise index file if it doesn't exist.
      if (!existsSync(this.indexPath())) {
        await writeFile(this.indexPath(), JSON.stringify({ entries: {} }));
      }
      this.ready = true;
    })();
    return this.readyPromise;
  }

  private indexPath(): string {
    return path.join(this.dir, INDEX_FILE);
  }

  private entryPath(key: string): string {
    return path.join(this.dir, `${key}.json`);
  }

  private async readIndex(): Promise<LruIndex> {
    try {
      const raw = await readFile(this.indexPath(), 'utf-8');
      return JSON.parse(raw) as LruIndex;
    } catch {
      return { entries: {} };
    }
  }

  private async writeIndex(index: LruIndex): Promise<void> {
    const tmp = this.indexPath() + '.tmp';
    await writeFile(tmp, JSON.stringify(index), 'utf-8');
    await rename(tmp, this.indexPath());
  }

  private async evictIfNeeded(): Promise<void> {
    const index = await this.readIndex();
    let entries = Object.entries(index.entries);
    if (entries.length === 0) return;

    // Check whether we're over either cap.
    const totalBytes = entries.reduce((sum, [, e]) => sum + e.size, 0);
    if (entries.length <= this.maxFiles && totalBytes <= this.maxBytes) return;

    // Sort coldest-first and evict the bottom fraction.
    entries.sort(([, a], [, b]) => a.atime - b.atime);
    const toEvict = Math.max(1, Math.ceil(entries.length * EVICT_FRACTION));

    for (let i = 0; i < toEvict && i < entries.length; i++) {
      const [key] = entries[i]!;
      delete index.entries[key];
      try {
        await rm(this.entryPath(key));
      } catch {
        /* best-effort */
      }
    }

    await this.writeIndex(index);
  }
}
