import { spawn, execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as http from 'node:http';

declare const __COMPRESSO_VERSION__: string | undefined;
const VERSION: string = __COMPRESSO_VERSION__ ?? '0.0.0';

interface CodexCliOptions {
  port: number;
  model?: string;
  apiKey?: string;
  help: boolean;
  setup: boolean;
  prompt?: string;
}

function parseArgv(): CodexCliOptions {
  const args = process.argv.slice(2);
  const opts: CodexCliOptions = { port: 47823, help: false, setup: false };

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
    if (a === '--api-key' || a === '-k') {
      opts.apiKey = args[++i];
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
  console.log(`compresso codex — compressed Codex CLI session

Usage:
  compresso codex                           interactive Codex CLI session
  compresso codex "write a test"            single-shot, print, exit
  compresso codex --port 47823              reuse existing proxy on port
  compresso codex --model gpt-4o            specific model
  compresso codex -k sk-...                 OpenAI API key
  compresso codex --setup                   write ~/.codex/config.toml provider config
  compresso codex --help                    this help

The proxy must be configured with an OpenAI API key (OPENAI_API_KEY env var
or the upstream must accept the forwarded key).
`);
}

// ---- Proxy lifecycle -------------------------------------------------------

function proxyIsAlive(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => {
        resolve(res.statusCode === 200 && body.includes('compresso'));
      });
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
  const entry = path.resolve(scriptPath.endsWith('codex-cli.js') ? '.' : '.', 'dist', `node${ext}`);

  // Find the CLI entry — try several locations depending on how compresso was invoked
  let proxyEntry = '';
  const candidates = [entry, path.resolve('dist/node.js')];
  for (const c of candidates) {
    if (fs.existsSync(c)) { proxyEntry = c; break; }
  }

  if (!proxyEntry) {
    throw new Error('cannot find proxy bundle (dist/node.js). Run `pnpm run build` first.');
  }

  const proxy = spawn(process.execPath, [proxyEntry], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      COMPRESSO_CLIENT: 'codex',
      COMPRESSO_CWD: process.cwd(),
    },
    stdio: ['ignore', 'inherit', 'pipe'],
  });

  let stderrBuf = '';
  proxy.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    stderrBuf += text;
    // Forward proxy stderr to user's stderr
    process.stderr.write(text);
  });

  proxy.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`[compresso] proxy exited with code ${code}`);
    }
  });

  // Wait for ready signal
  await waitForProxyReady(port);

  return { process: proxy };
}

function stopProxy(proxy: import('node:child_process').ChildProcess | null): void {
  if (!proxy) return;
  try {
    proxy.kill('SIGTERM');
    // Give it 3 seconds, then force kill
    const timer = setTimeout(() => {
      try { proxy.kill('SIGKILL'); } catch { /* gone */ }
    }, 3000);
    proxy.on('exit', () => clearTimeout(timer));
  } catch { /* already dead */ }
}

function findCodexBinary(): string | null {
  try {
    // npm global install location
    const npmRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    const codexNpm = path.join(npmRoot, '@openai', 'codex');
    if (fs.existsSync(codexNpm)) return codexNpm;
  } catch { /* fall through */ }

  try {
    const result = execSync('which codex', { encoding: 'utf8' }).trim();
    if (result) return result;
  } catch { /* fall through */ }

  return null;
}

// ---- Setup: write ~/.codex/config.toml -----------------------------------

function writeConfig(port: number, apiKey?: string): void {
  const configDir = path.join(os.homedir(), '.codex');
  const configFile = path.join(configDir, 'config.toml');
  const key = apiKey || process.env.OPENAI_API_KEY || '<your-api-key>';

  fs.mkdirSync(configDir, { recursive: true });

  const content = `# Generated by compresso codex --setup
[model_providers.compresso]
name = "Compresso"
base_url = "http://127.0.0.1:${port}"
env_key = "CODEX_PROXY_KEY"
wire_api = "responses"

[profiles.default]
model = "gpt-4o"
model_provider = "compresso"
`;

  fs.writeFileSync(configFile, content, 'utf8');

  const rcPath = path.join(os.homedir(), '.zshrc');
  const rcLine = `\nexport CODEX_PROXY_KEY="${key}"`;
  let wroteRc = false;
  try {
    const rc = fs.readFileSync(rcPath, 'utf8');
    if (!rc.includes('CODEX_PROXY_KEY')) {
      fs.appendFileSync(rcPath, rcLine);
      wroteRc = true;
    }
  } catch { /* no .zshrc */ }

  console.log(`  wrote config → ${configFile}`);
  if (wroteRc) console.log(`  added CODEX_PROXY_KEY to ${rcPath}`);
  console.log('');
  console.log(`  To use: run \`codex\` normally (make sure the proxy is running on port ${port})`);
  console.log(`  To remove: delete ${configFile}`);
}

// ---- Main ------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgv();

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  if (opts.setup) {
    writeConfig(opts.port, opts.apiKey);
    process.exit(0);
  }

  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY ?? '';
  if (!apiKey) {
    console.error('No API key found. Set OPENAI_API_KEY or pass --api-key.');
    process.exit(1);
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

  // Ensure cleanup on exit
  const cleanup = () => {
    if (proxyProc && !alive) stopProxy(proxyProc);
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', cleanup);

  // Find codex binary
  const codexBin = findCodexBinary();
  if (!codexBin) {
    console.error('Codex CLI not found. Install with: npm install -g @openai/codex');
    cleanup();
    process.exit(1);
  }

  // Build codex args
  const codexArgs: string[] = [];
  if (opts.model) codexArgs.push('--model', opts.model);
  if (opts.prompt) codexArgs.push(opts.prompt);

  // Spawn codex with OPENAI_BASE_URL pointing at compresso proxy
  const codex = spawn(codexBin, codexArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      OPENAI_BASE_URL: `http://127.0.0.1:${opts.port}`,
      OPENAI_API_KEY: apiKey,
    },
  });

  codex.on('exit', (code) => {
    if (code === 0) {
      console.log('');
      console.log(`[compresso] Codex session complete. Check \`compresso dashboard\` for token savings.`);
    }
    cleanup();
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
