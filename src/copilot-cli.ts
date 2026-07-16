import { createSession } from './copilot.js';

declare const __COMPRESSO_VERSION__: string | undefined;
const VERSION: string = __COMPRESSO_VERSION__ ?? '0.0.0';

interface CopilotCliOptions {
  model?: string;
  systemPrompt?: string;
  quiet: boolean;
  help: boolean;
  prompt?: string;
}

function parseArgv(): CopilotCliOptions {
  const args = process.argv.slice(2);
  const opts: CopilotCliOptions = { quiet: false, help: false };

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--help' || a === '-h') { opts.help = true; continue; }
    if (a === '--version') {
      console.log(VERSION);
      process.exit(0);
    }
    if (a === '--model' || a === '-m') {
      opts.model = args[++i];
      continue;
    }
    if (a === '--system' || a === '-s') {
      opts.systemPrompt = args[++i];
      continue;
    }
    if (a === '--quiet' || a === '-q') { opts.quiet = true; continue; }
    if (a.startsWith('-')) {
      console.error(`unknown flag: ${a}`);
      process.exit(1);
    }
    opts.prompt = a;
    break;
  }

  return opts;
}

function printHelp(): void {
  console.log(`compresso copilot — compressed Copilot session

Usage:
  compresso copilot                              interactive REPL
  compresso copilot "write a test"               single-shot, print, exit
  compresso copilot --model gpt-4o               specific model
  compresso copilot --system "be concise"         custom system prompt
  compresso copilot --quiet                       skip startup banner
  compresso copilot --help                        this help

REPL commands:
  /exit      quit the session
  /stats     print compression stats for this session
  /clear     clear the terminal

Environment:
  A GitHub token is required. Run \`gh auth login\` first.
`);
}

function printStats(stats: { compressedCount: number; origTokensTotal: number; imageTokensTotal: number; tokenSavingsPct: number } | null): void {
  if (!stats || stats.compressedCount === 0) {
    console.log('  (no compression data yet)');
    return;
  }
  console.log('');
  console.log(`  compressed:    ${stats.compressedCount} request(s)`);
  console.log(`  tokens saved:  ${stats.origTokensTotal.toLocaleString()} → ${stats.imageTokensTotal.toLocaleString()}  (${stats.tokenSavingsPct}%)`);
}

import * as readline from 'node:readline';

async function runREPL(opts: CopilotCliOptions): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
  });

  if (!opts.quiet) {
    console.log('');
    console.log('  compresso copilot — type /exit to quit, /stats for savings');
    console.log(`  model: ${opts.model ?? 'default'}`);
    console.log('');
  }

  let session;
  try {
    session = await createSession({
      model: opts.model,
      systemPrompt: opts.systemPrompt,
      compress: true,
      logLevel: 'error',
      skipCustomInstructions: false,
    });
  } catch (err) {
    console.error(`failed to connect: ${err instanceof Error ? err.message : String(err)}`);
    rl.close();
    process.exit(1);
  }

  const cleanup = () => {
    if (session) {
      const stats = session.compressionStats;
      if (stats && stats.compressedCount > 0) {
        console.log('\n── session stats ──');
        printStats(stats);
      }
      session.close().catch(() => {});
    }
    rl.close();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  rl.on('close', cleanup);

  rl.prompt();

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      continue;
    }

    if (trimmed === '/exit') {
      cleanup();
      break;
    }

    if (trimmed === '/stats') {
      printStats(session?.compressionStats ?? null);
      rl.prompt();
      continue;
    }

    if (trimmed === '/clear') {
      console.clear();
      rl.prompt();
      continue;
    }

    try {
      const response = await session!.sendAndWait(trimmed, 120_000);
      console.log(response ?? '');
    } catch (err) {
      console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    }

    rl.prompt();
  }
}

async function runSingleShot(opts: CopilotCliOptions): Promise<void> {
  const prompt = opts.prompt!;

  let session;
  try {
    session = await createSession({
      model: opts.model,
      systemPrompt: opts.systemPrompt,
      compress: true,
      logLevel: 'error',
      skipCustomInstructions: false,
    });
  } catch (err) {
    console.error(`failed to connect: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  try {
    const response = await session.sendAndWait(prompt, 120_000);
    console.log(response ?? '');
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!opts.quiet) {
    const stats = session.compressionStats;
    if (stats && stats.compressedCount > 0) {
      console.log('');
      printStats(stats);
    }
  }

  await session.close();
}

async function main(): Promise<void> {
  const opts = parseArgv();

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  if (opts.prompt) {
    await runSingleShot(opts);
  } else {
    await runREPL(opts);
  }
}

main().catch((err) => {
  console.error(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
