import { spawn, execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as http from 'node:http';

declare const __COMPRESSO_VERSION__: string | undefined;
const VERSION: string = __COMPRESSO_VERSION__ ?? '0.0.0';

interface OpenCodeCliOptions {
  port: number;
  help: boolean;
  setup: boolean;
  model?: string;
  prompt?: string;
}

function parseArgv(): OpenCodeCliOptions {
  const args = process.argv.slice(2);
  const opts: OpenCodeCliOptions = { port: 47821, help: false, setup: false };

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--help' || a === '-h') { opts.help = true; continue; }
    if (a === '--version') {
      console.log(VERSION);
      process.exit(0);
    }
    if (a === '--port' || a === '-p') {
      opts.port = parseInt(args[++i] ?? '47821', 10) || 47821;
      continue;
    }
    if (a === '--model' || a === '-m') {
      opts.model = args[++i];
      continue;
    }
    if (a === '--setup') { opts.setup = true; continue; }
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
  console.log(`compresso opencode — compressed OpenCode session

Usage:
  compresso opencode                          interactive OpenCode session
  compresso opencode "write a test"           single-shot, print, exit
  compresso opencode --port 47821             reuse existing proxy on port
  compresso opencode --model gpt-5.6-sol      specific model (select in /models too)
  compresso opencode --setup                  write ~/.config/opencode/opencode.json
  compresso opencode --help                   this help

The proxy must be configured with an API key (OPENAI_API_KEY for GPT models,
ANTHROPIC_API_KEY for Claude models, or both).
`);
}

// ---- Proxy lifecycle -------------------------------------------------------

function proxyIsAlive(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}

function waitForProxyReady(port: number, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      if (Date.now() > deadline) {
        reject(new Error(`proxy did not start within ${timeoutMs}ms`));
        return;
      }
      proxyIsAlive(port).then((alive) => {
        if (alive) resolve();
        else setTimeout(poll, 200);
      });
    };
    poll();
  });
}

async function startProxy(port: number): Promise<{ process: import('node:child_process').ChildProcess }> {
  const ext = process.platform === 'win32' ? '.js' : '';
  const scriptPath = process.argv[1] ?? '';
  const entry = path.resolve(scriptPath.endsWith('opencode-cli.js') ? '.' : '.', 'dist', `node${ext}`);

  let proxyEntry = '';
  const candidates = [entry, path.resolve('dist/node.js')];
  for (const c of candidates) {
    if (fs.existsSync(c)) { proxyEntry = c; break; }
  }

  if (!proxyEntry) {
    throw new Error('cannot find proxy bundle (dist/node.js). Run `pnpm run build` first.');
  }

  const proxy = spawn(process.execPath, [proxyEntry], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'inherit', 'pipe'],
  });

  let stderrBuf = '';
  proxy.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    stderrBuf += text;
    process.stderr.write(text);
  });

  proxy.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`[compresso] proxy exited with code ${code}`);
    }
  });

  await waitForProxyReady(port);

  return { process: proxy };
}

function stopProxy(proxy: import('node:child_process').ChildProcess | null): void {
  if (!proxy) return;
  try {
    proxy.kill('SIGTERM');
    const timer = setTimeout(() => {
      try { proxy.kill('SIGKILL'); } catch { /* gone */ }
    }, 3000);
    proxy.on('exit', () => clearTimeout(timer));
  } catch { /* already dead */ }
}

function findOpenCodeBinary(): string | null {
  // ~/.opencode/bin/opencode (default install location)
  const homeDir = os.homedir();
  const opencodeNpm = path.join(homeDir, '.opencode', 'bin', 'opencode');
  if (fs.existsSync(opencodeNpm)) return opencodeNpm;

  try {
    const result = execSync('which opencode', { encoding: 'utf8' }).trim();
    if (result) return result;
  } catch { /* fall through */ }

  return null;
}

// ---- Temp config & setup ---------------------------------------------------

function opencodeConfigContent(port: number): string {
  return JSON.stringify(
    {
      $schema: 'https://opencode.ai/config.json',
      provider: {
        openai: {
          options: {
            baseURL: `http://127.0.0.1:${port}/v1`,
          },
        },
        anthropic: {
          options: {
            baseURL: `http://127.0.0.1:${port}`,
          },
        },
      },
    },
    null,
    2,
  );
}

function writeTempConfig(port: number): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compresso-opencode-'));
  const configPath = path.join(tmpDir, 'opencode.json');
  fs.writeFileSync(configPath, opencodeConfigContent(port), 'utf8');
  return configPath;
}

function writeGlobalConfig(port: number): void {
  const configDir = path.join(os.homedir(), '.config', 'opencode');
  const configFile = path.join(configDir, 'opencode.json');

  fs.mkdirSync(configDir, { recursive: true });

  // Merge with existing config if present
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch {
    // start fresh
  }

  const proxyOverrides = JSON.parse(opencodeConfigContent(port)) as Record<string, unknown>;

  // Merge provider section preserving existing entries
  if (proxyOverrides.provider && typeof proxyOverrides.provider === 'object') {
    const existingProviders =
      existing.provider && typeof existing.provider === 'object'
        ? (existing.provider as Record<string, unknown>)
        : {};
    const newProviders = proxyOverrides.provider as Record<string, unknown>;

    for (const [key, val] of Object.entries(newProviders)) {
      if (existingProviders[key] && typeof existingProviders[key] === 'object' && typeof val === 'object') {
        existingProviders[key] = { ...(existingProviders[key] as Record<string, unknown>), ...(val as Record<string, unknown>) };
      } else {
        existingProviders[key] = val;
      }
    }

    existing.provider = existingProviders;
  }

  fs.writeFileSync(configFile, JSON.stringify(existing, null, 2), 'utf8');
  console.log(`  merged config → ${configFile}`);
  console.log('');
  console.log(`  To use: run \`opencode\` normally (make sure the proxy is running on port ${port})`);
  console.log(`  To remove: delete the \`provider.openai.options.baseURL\` and \`provider.anthropic.options.baseURL\` entries`);
}

function cleanupTempConfig(configPath: string): void {
  try {
    fs.unlinkSync(configPath);
    fs.rmdirSync(path.dirname(configPath));
  } catch { /* best effort */ }
}

// ---- Main ------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgv();

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  if (opts.setup) {
    writeGlobalConfig(opts.port);
    process.exit(0);
  }

  // Check if proxy is already running
  const alive = await proxyIsAlive(opts.port);
  let proxyProc: import('node:child_process').ChildProcess | null = null;

  if (!alive) {
    console.log(`[compresso] starting proxy on port ${opts.port}...`);
    proxyProc = (await startProxy(opts.port)).process;
  } else {
    console.log(`[compresso] using existing proxy on port ${opts.port}`);
  }

  // Write temp opencode config
  const tempConfigPath = writeTempConfig(opts.port);

  // Ensure cleanup on exit
  const cleanup = () => {
    cleanupTempConfig(tempConfigPath);
    if (proxyProc && !alive) stopProxy(proxyProc);
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', cleanup);

  // Find opencode binary
  const opencodeBin = findOpenCodeBinary();
  if (!opencodeBin) {
    console.error('OpenCode not found. Install from https://opencode.ai');
    cleanup();
    process.exit(1);
  }

  // Build opencode args
  const opencodeArgs: string[] = [];
  if (opts.model) opencodeArgs.push('--model', opts.model);
  if (opts.prompt) {
    opencodeArgs.push('run');
    opencodeArgs.push(opts.prompt);
  }

  // Spawn opencode with OPENCODE_CONFIG pointing at our temp config
  const opencode = spawn(opencodeBin, opencodeArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      OPENCODE_CONFIG: tempConfigPath,
    },
  });

  opencode.on('exit', (code) => {
    if (code === 0) {
      console.log('');
      console.log(`[compresso] OpenCode session complete. Check \`compresso dashboard\` for token savings.`);
    }
    cleanup();
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
