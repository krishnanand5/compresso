import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { aggregateEventsFile, renderTextReport } from './stats.js';
import { aggregateSessions, filterSessions, defaultPaths } from './sessions.js';
import { newCopilotAggregate, foldCopilotAggregate } from './copilot-telemetry.js';
import type { CopilotEvent, CopilotAggregate } from './copilot-telemetry.js';

const VERSION: string = (globalThis as any).__COMPRESSO_VERSION__ ?? '0.0.0';

const COMPRESSO_HOME = process.env.COMPRESSO_HOME ?? path.join(os.homedir(), '.compresso');
const EVENTS_FILE = process.env.COMPRESSO_LOG ?? path.join(COMPRESSO_HOME, 'events.jsonl');
const COPILOT_EVENTS_FILE = path.join(COMPRESSO_HOME, 'copilot-events.jsonl');

interface DashboardCliOptions {
  view: 'stats' | 'sessions' | 'copilot' | 'watch';
  limit: number;
  interval: number;
  help: boolean;
}

function parseArgv(): DashboardCliOptions {
  const args = process.argv.slice(2);
  const opts: DashboardCliOptions = { view: 'stats', limit: 20, interval: 2, help: false };

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--help' || a === '-h') { opts.help = true; continue; }
    if (a === '--version') {
      console.log(VERSION);
      process.exit(0);
    }
    if (a === '--limit' || a === '-n') {
      opts.limit = parseInt(args[++i] ?? '20', 10) || 20;
      continue;
    }
    if (a === '--interval' || a === '-t') {
      opts.interval = parseInt(args[++i] ?? '2', 10) || 2;
      continue;
    }
    if (a === 'sessions') { opts.view = 'sessions'; continue; }
    if (a === 'copilot') { opts.view = 'copilot'; continue; }
    if (a === 'watch') { opts.view = 'watch'; continue; }
    if (a.startsWith('-')) {
      console.error(`unknown flag: ${a}`);
      process.exit(1);
    }
    // positional — treat as view name
    if (a === 'stats' || a === 'sessions' || a === 'copilot' || a === 'watch') {
      opts.view = a;
    } else {
      console.error(`unknown view: ${a}`);
      process.exit(1);
    }
  }
  return opts;
}

function printHelp(): void {
  console.log(`compresso dashboard — terminal dashboard for compresso

Usage:
  compresso dashboard                      proxy stats (aggregate)
  compresso dashboard sessions [--limit N] per-session breakdown
  compresso dashboard copilot              Copilot session stats
  compresso dashboard watch [--interval N] live-refresh (default 2s)
  compresso dashboard --help               this help
`);
}

// ---- Copilot event scanner (inlined to avoid coupling with dashboard.ts) ----

async function scanCopilotEvents(file: string): Promise<{ agg: CopilotAggregate; lineCount: number } | null> {
  if (!fs.existsSync(file)) return null;
  const agg = newCopilotAggregate();
  const seenSessionIds = new Set<string>();
  let lineCount = 0;

  const content = fs.readFileSync(file, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const ev = JSON.parse(trimmed) as CopilotEvent;
      foldCopilotAggregate(agg, ev);
      seenSessionIds.add(ev.session_id);
      lineCount++;
    } catch { /* skip malformed */ }
  }

  agg.totalSessions = seenSessionIds.size;
  return { agg, lineCount };
}

function printCopilotStats(agg: CopilotAggregate): void {
  console.log('');
  console.log(`  Copilot sessions    │ ${agg.totalSessions} session(s) · ${agg.totalTurns} turn(s)`);
  if (agg.totalTurns > 0) {
    const pct = agg.tokenSavingsPct;
    console.log(`  Token saving        │ ${agg.origTokensTotal.toLocaleString()} → ${agg.imageTokensTotal.toLocaleString()}  (${pct}%)`);
  }
  if (agg.recentEvents.length > 0) {
    const avgDur = Math.round(agg.recentEvents.reduce((s, e) => s + e.duration_ms, 0) / agg.recentEvents.length);
    console.log(`  Avg compression     │ ${avgDur} ms/turn`);

    const modelCounts = new Map<string, number>();
    for (const e of agg.recentEvents) {
      modelCounts.set(e.model, (modelCounts.get(e.model) ?? 0) + 1);
    }
    const models = [...modelCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([m, c]) => `${m} (${c})`)
      .join(' · ');
    console.log(`  Models              │ ${models}`);
  }
  console.log('');
}

function printSessionsTable(): Promise<void> {
  return aggregateSessions(defaultPaths()).then(({ sessions }) => {
    const list = filterSessions(sessions, {});
    if (list.length === 0) {
      console.log('  (no sessions found)');
      return;
    }

    const header = `${'Session'.padEnd(24)} │ ${'Turns'.padStart(5)} │ ${'Saved %'.padStart(6)} │ Project`;
    const sep = '─'.repeat(24) + '┼' + '─'.repeat(7) + '┼' + '─'.repeat(8) + '┼' + '─'.repeat(30);
    console.log('');
    console.log(`  ${header}`);
    console.log(`  ${sep}`);

    for (const s of list.slice(0, 20)) {
      const id = s.id.length > 22 ? s.id.slice(0, 22) + '…' : s.id.padEnd(24);
      const turns = String(s.requestCount).padStart(5);
      const saved = s.tokensSavedEst > 0
        ? (s.tokensSavedEst / (s.tokensSavedEst + s.cacheReadTokens + 1) * 100).toFixed(1).padStart(6) + '%'
        : '    —';
      const proj = s.project ?? '';
      console.log(`  ${id} │ ${turns} │ ${saved} │ ${proj}`);
    }
    console.log('');
  });
}

// ---- Views -----------------------------------------------------------------

async function viewStats(): Promise<void> {
  const result = await aggregateEventsFile(EVENTS_FILE);
  if (!result || result.summary.total === 0) {
    console.log('  No proxy data yet. Run the proxy or copilot first.');
    return;
  }
  console.log(renderTextReport(result.summary));
}

async function viewSessions(opts: DashboardCliOptions): Promise<void> {
  await printSessionsTable();
}

async function viewCopilot(): Promise<void> {
  const data = await scanCopilotEvents(COPILOT_EVENTS_FILE);
  if (!data || data.lineCount === 0) {
    console.log('  No Copilot session data yet. Run `compresso copilot` first.');
    return;
  }
  printCopilotStats(data.agg);
}

async function viewWatch(opts: DashboardCliOptions): Promise<void> {
  const intervalMs = Math.max(1, opts.interval) * 1000;
  console.clear();
  console.log(`  compresso dashboard — watching (every ${opts.interval}s, Ctrl+C to stop)`);
  console.log('');

  const poll = async (): Promise<void> => {
    const result = await aggregateEventsFile(EVENTS_FILE);
    if (result && result.summary.total > 0) {
      // Print a compact one-line summary
      const s = result.summary;
      const compressedPct = s.total > 0 ? ((s.compressed / s.total) * 100).toFixed(1) : '—';
      const savedPct = s.total > 0
        ? ((1 - s.imageBytesTotal / Math.max(1, s.origCharsTotal)) * 100).toFixed(1)
        : '—';
      const now = new Date().toLocaleTimeString();
      process.stdout.write(`\r  [${now}] ${s.total} requests · ${s.compressed}/${s.total} compressed (${compressedPct}%) · ~${savedPct}% saved · ${s.err4xx + s.err5xx} errors`);
    } else {
      process.stdout.write(`\r  waiting for proxy data…`);
    }
  };

  await poll();
  const timer = setInterval(poll, intervalMs);

  process.on('SIGINT', () => {
    clearInterval(timer);
    console.log('\n');
    process.exit(0);
  });

  // Keep alive
  await new Promise(() => {});
}

// ---- Main ------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgv();

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  switch (opts.view) {
    case 'stats':
      await viewStats();
      break;
    case 'sessions':
      await viewSessions(opts);
      break;
    case 'copilot':
      await viewCopilot();
      break;
    case 'watch':
      await viewWatch(opts);
      break;
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
