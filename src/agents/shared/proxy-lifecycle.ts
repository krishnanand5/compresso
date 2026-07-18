// src/agents/shared/proxy-lifecycle.ts

import * as http from 'node:http';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';

/** True iff GET http://127.0.0.1:<port>/ returns 200 with "compresso" in body. */
export function proxyIsAlive(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      res.on('end', () => {
        resolve(res.statusCode === 200 && body.includes('compresso'));
      });
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** Poll proxyIsAlive until true or timeout. Rejects on timeout. */
export function waitForProxyReady(port: number, timeoutMs = 15000): Promise<void> {
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

export interface StartProxyOptions {
  /** Client identity stamped on proxy env (dashboard badges). */
  client?: string;
  /** Extra env vars for the proxy process. */
  env?: NodeJS.ProcessEnv;
}

/** Start the proxy as a child if one isn't already running on `port`.
 *  Returns the child process, or null when reusing an existing proxy. */
export async function startProxyIfNeeded(
  port: number,
  opts: StartProxyOptions = {},
): Promise<ChildProcess | null> {
  if (await proxyIsAlive(port)) return null;

  const ext = process.platform === 'win32' ? '.js' : '';
  const scriptPath = process.argv[1] ?? '';
  // When launched from a bundled *-cli.js, look for dist/node.js relative to cwd.
  const entry = path.resolve(
    scriptPath.endsWith('-cli.js') || scriptPath.endsWith('cli.js') ? '.' : '.',
    'dist',
    `node${ext}`,
  );
  const candidates = [entry, path.resolve('dist/node.js')];
  let proxyEntry = '';
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      proxyEntry = c;
      break;
    }
  }
  if (!proxyEntry) {
    throw new Error('cannot find proxy bundle (dist/node.js). Run `pnpm run build` first.');
  }

  const proxy = spawn(process.execPath, [proxyEntry], {
    env: {
      ...process.env,
      ...opts.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      COMPRESSO_CLIENT: opts.client ?? process.env.COMPRESSO_CLIENT ?? 'unknown',
      COMPRESSO_CWD: process.cwd(),
    },
    stdio: ['ignore', 'inherit', 'pipe'],
  });

  proxy.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(chunk.toString());
  });

  proxy.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`[compresso] proxy exited with code ${code}`);
    }
  });

  await waitForProxyReady(port);
  return proxy;
}

/** Gracefully stop a proxy child we started. */
export function stopProxy(proxy: ChildProcess | null): void {
  if (!proxy) return;
  try {
    proxy.kill('SIGTERM');
    const timer = setTimeout(() => {
      try {
        proxy.kill('SIGKILL');
      } catch {
        /* gone */
      }
    }, 3000);
    proxy.on('exit', () => clearTimeout(timer));
  } catch {
    /* already dead */
  }
}
