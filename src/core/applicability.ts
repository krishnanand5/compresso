/** Applicability helpers for compresso's production-safe model scope. */

export type PxpipeApplicabilityReason =
  | 'eligible'
  | 'unsupported_model'
  | 'unsupported_method'
  | 'unsupported_path'
  | 'empty_body';

export interface PxpipeApplicabilityInput {
  readonly model?: string | null;
  readonly method?: string | null;
  readonly path?: string | null;
  readonly bodyBytes?: number | null;
}

/** Bracketed variant tags (e.g. `[1m]`) stripped before model matching so base and variant gate identically. */
const VARIANT_TAG = /\[[^\]]*\]/g;

function baseModelId(model: string): string {
  // Strip provider/ prefix (e.g. "openai/gpt-5.6-sol" → "gpt-5.6-sol") so
  // clients that send prefixed model names (OpenCode / AI SDK) match the
  // allowlist correctly.
  const slashIdx = model.indexOf('/');
  const stripped = slashIdx >= 0 ? model.slice(slashIdx + 1) : model;
  return stripped.replace(VARIANT_TAG, '');
}

/** Dashboard runtime override; null = fall back to COMPRESSO_MODELS env / built-in default. In-memory only. */
let runtimeModelBases: readonly string[] | null = null;

/** Built-in default scope when COMPRESSO_MODELS is unset: Fable 5 only.
 *  Everything else is opt-in via dashboard chips or COMPRESSO_MODELS:
 *  - Opus 4.7/4.8 — worse at reading imaged content (FINDINGS.md 2026-06-16:
 *    Opus 4.8 ~2pp arithmetic, 6/15 dense-hex vs Fable 100/100).
 *  - GPT 5.5 — degrades on imaged history/context.
 *  - GPT 5.6 Sol — 98/100 production arithmetic, but 79/93 completed gist,
 *    4/15 completed guard confabulations, and 0/15 dense hex.
 *  - Grok 4.5 — 82/100 arithmetic, 83/98 gist, and 13/18 state tracking.
 *  Both profiles remain available for explicit opt-in.
 *  Silently imaging weak or unvalidated readers is the wrong default. */
const DEFAULT_MODEL_BASES = [
  'claude-5',
  'claude-fable-5',
  'gpt-5.6',
  'deepseek-v4-flash',
  'nemotron-3-ultra',
  'big-pickle',
];

/** Model bases confirmed to support image (multimodal) input — compression renders
 *  text into images, so only these models can receive compressed requests.
 *  Models in `DEFAULT_MODEL_BASES` but NOT in this set are text-only and will
 *  be passed through without compression. */
export const IMAGE_CAPABLE_BASES = new Set([
  'claude-5',
  'claude-fable-5',
  'gpt-5.6',
  'big-pickle',
  'grok-4.5',
]);

function falsey(v: string): boolean {
  return /^(0|false|no|off|none)$/i.test(v.trim());
}

/** COMPRESSO_MODELS env / built-in default, ignoring the runtime override. One CSV
 *  controls every family (Claude + GPT). Resolution (read per-call so scope flips LIVE):
 *  - unset or empty        → built-in default (Fable 5 only)
 *  - `off`/`0`/`false`/... → compress nothing
 *  - CSV of model bases    → exactly those families (e.g. `claude-fable-5,gpt-5.6-sol`) */
function envOrDefaultBases(): string[] {
  // Edge-safe: `process` is undefined off-Node; `typeof` avoids a ReferenceError.
  const raw = typeof process !== 'undefined' ? process.env?.COMPRESSO_MODELS : undefined;
  if (raw === undefined) return [...DEFAULT_MODEL_BASES];
  const trimmed = raw.trim();
  if (!trimmed) return [...DEFAULT_MODEL_BASES];
  if (falsey(trimmed)) return [];
  return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
}

function allowedModelBases(): string[] {
  if (runtimeModelBases !== null) return [...runtimeModelBases];
  return envOrDefaultBases();
}

/** Current effective allowed-model scope (Claude + GPT). */
export function getAllowedModelBases(): string[] {
  return allowedModelBases();
}

/** COMPRESSO_MODELS env / default scope, independent of runtime override.
 *  Dashboard unions this into its chip set so env-enabled models are always shown as toggles. */
export function getConfiguredModelBases(): string[] {
  return envOrDefaultBases();
}

/** Set the dashboard runtime override. Empty array = compress nothing; null = clear override. Not persisted. */
export function setAllowedModelBases(list: readonly string[] | null): void {
  runtimeModelBases = list === null ? null : list.map((s) => s.trim()).filter(Boolean);
}

/** Membership test against the single allowed scope. Matches exact base or `-suffix`
 *  alias; [variant] tags stripped first. */
function isAllowed(model: string | null | undefined): boolean {
  if (typeof model !== 'string') return false;
  const base = baseModelId(model);
  return allowedModelBases().some((b) => base === b || base.startsWith(`${b}-`));
}

/** True when compresso may transform this Anthropic model. */
export function isPxpipeSupportedModel(model: string | null | undefined): boolean {
  return isAllowed(model);
}

/** True when compresso may transform this GPT model. Shares the single COMPRESSO_MODELS scope. */
export function isPxpipeSupportedGptModel(model: string | null | undefined): boolean {
  return isAllowed(model);
}

/** True when the model supports image (multimodal) input — compression may render
 *  text into images. Text-only models (e.g. deepseek-v4-flash-free) return false
 *  even if they are in the allowed scope, so their requests pass through unchanged. */
export function isImageCapableModel(model: string | null | undefined): boolean {
  if (typeof model !== 'string') return false;
  const base = baseModelId(model);
  return [...IMAGE_CAPABLE_BASES].some((b) => base === b || base.startsWith(`${b}-`));
}

/** Canonical set of Anthropic Messages routes compresso transforms. Shared with
 *  createProxy (src/core/proxy.ts) so the public applicability helper and the
 *  proxy router can never disagree on which paths are eligible — they did: the
 *  proxy accepts /anthropic/messages, but the helper's old `endsWith` check
 *  rejected it (and would have wrongly accepted /foo/v1/messages). Exact matches
 *  only, so /v1/messages/count_tokens stays unsupported. */
export function isAnthropicMessagesPath(pathname: string): boolean {
  return pathname === '/v1/messages'
    || pathname === '/anthropic/v1/messages'
    || pathname === '/anthropic/messages';
}

export function shouldTransformAnthropicMessages(
  input: PxpipeApplicabilityInput,
): { eligible: boolean; reason: PxpipeApplicabilityReason } {
  if (input.method !== undefined && input.method !== null && input.method.toUpperCase() !== 'POST') {
    return { eligible: false, reason: 'unsupported_method' };
  }
  if (input.path !== undefined && input.path !== null && !isAnthropicMessagesPath(input.path)) {
    return { eligible: false, reason: 'unsupported_path' };
  }
  if (input.bodyBytes !== undefined && input.bodyBytes !== null && input.bodyBytes <= 0) {
    return { eligible: false, reason: 'empty_body' };
  }
  if (!isPxpipeSupportedModel(input.model)) {
    return { eligible: false, reason: 'unsupported_model' };
  }
  return { eligible: true, reason: 'eligible' };
}
