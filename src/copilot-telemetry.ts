/**
 * Lightweight telemetry types and aggregators for the Copilot SDK path.
 * Separate from copilot.ts so the dashboard (and bundled CLI) can import
 * these without dragging in @github/copilot-sdk + its native binary deps.
 */

export interface CopilotEvent {
  ts: string;
  session_id: string;
  turn: number;
  model: string;
  prompt_preview: string;
  duration_ms: number;
  status: number;
  compressed: boolean;
  orig_tokens: number;
  image_tokens: number;
  token_savings_pct: number;
  orig_chars: number;
  image_count: number;
  wire_bytes_in: number;
  wire_bytes_out: number;
}

export interface CopilotAggregate {
  totalTurns: number;
  totalSessions: number;
  compressedTurns: number;
  origTokensTotal: number;
  imageTokensTotal: number;
  tokenSavingsPct: number;
  origCharsTotal: number;
  imageCountTotal: number;
  recentEvents: CopilotEvent[];
}

export function newCopilotAggregate(): CopilotAggregate {
  return {
    totalTurns: 0,
    totalSessions: 0,
    compressedTurns: 0,
    origTokensTotal: 0,
    imageTokensTotal: 0,
    tokenSavingsPct: 0,
    origCharsTotal: 0,
    imageCountTotal: 0,
    recentEvents: [],
  };
}

export function foldCopilotAggregate(a: CopilotAggregate, ev: CopilotEvent): CopilotAggregate {
  a.totalTurns++;
  if (ev.compressed) a.compressedTurns++;
  a.origTokensTotal += ev.orig_tokens;
  a.imageTokensTotal += ev.image_tokens;
  a.origCharsTotal += ev.orig_chars;
  a.imageCountTotal += ev.image_count;
  if (a.origTokensTotal > 0) {
    a.tokenSavingsPct = Math.round((1 - a.imageTokensTotal / a.origTokensTotal) * 100);
  }
  a.recentEvents.unshift(ev);
  if (a.recentEvents.length > 50) a.recentEvents.length = 50;
  return a;
}

const seenSessions = new Set<string>();
export function trackSession(id: string): boolean {
  if (seenSessions.has(id)) return false;
  seenSessions.add(id);
  return true;
}
export function sessionCount(): number {
  return seenSessions.size;
}
