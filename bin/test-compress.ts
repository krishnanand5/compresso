import { createSession } from '../src/copilot.js';
import { performance } from 'node:perf_hooks';

async function main() {
  const session = await createSession({
    model: 'auto',
    compress: true,
    logLevel: 'error',
    skipCustomInstructions: true,
  });

  console.log(`Session: ${session.sessionId}`);

  session.onEvent('assistant.message', (event: any) => {
    const content: string = event.data.content ?? '';
    console.log(`  ${content.slice(0, 120)}${content.length > 120 ? '...' : ''}`);
  });

  const prompts = [
    'What is the capital of France? Answer in one word.',
    'What is the population of that city? Just the number.',
    'What river flows through it? Just the name.',
    'How long is that river? Just the number in km.',
  ];

  for (const prompt of prompts) {
    const start = performance.now();
    process.stdout.write(`\n>>> "${prompt}"\n`);

    const response = await session.sendAndWait(prompt);
    const elapsed = ((performance.now() - start) / 1000).toFixed(1);
    const stats = session.compressionStats;

    process.stdout.write(`<<< (${elapsed}s)`);
    if (stats && stats.compressedCount > 0) {
      process.stdout.write(` savings=${stats.tokenSavingsPct}% (${stats.imageTokensTotal}/${stats.origTokensTotal} tok)`);
    }
    process.stdout.write('\n');
  }

  console.log(`\nFinal: ${JSON.stringify(session.compressionStats)}`);
  await session.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
