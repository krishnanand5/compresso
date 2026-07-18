// src/core/transform/registry.ts

import type { ApiFamily, Transformer } from './types.js';

const REGISTRY = new Map<ApiFamily, Transformer>();

/** Register a transformer for a given API family. */
export function registerTransformer(family: ApiFamily, fn: Transformer): void {
  REGISTRY.set(family, fn);
}

/** Get a transformer for a family, or undefined if not registered. */
export function getTransformer(family: ApiFamily): Transformer | undefined {
  return REGISTRY.get(family);
}

/** Test-only helper to clear registry. */
export function __resetTransformerRegistry(): void {
  REGISTRY.clear();
}
