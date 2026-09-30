import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CastPaths, resolvePaths } from '../src/paths.js';

export interface Sandbox {
  root: string;
  env: NodeJS.ProcessEnv;
  paths: CastPaths;
  cleanup(): void;
}

/** Isolated project, config and data dirs. */
export function sandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'cast-test-'));
  const env = {
    ...process.env,
    CAST_PROJECT_DIR: join(root, 'project'),
    CAST_CONFIG_DIR: join(root, 'config'),
    CAST_DATA_DIR: join(root, 'data'),
  };
  return { root, env, paths: resolvePaths(env), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export interface TestSite {
  url: string;
  /** Session token values that must never show up in cast output. */
  secrets: string[];
  /** Request paths with query, in order. */
  hits: string[];
  close(): Promise<void>;
}

/** /login?user=X sets a persistent session cookie; / greets the user and has a confirm() button. */
export async function startSite(): Promise<TestSite> {
  const secrets: string[] = [];
  const hits: string[] = [];
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    hits.push(url.pathname + url.search);
    if (url.pathname === '/probe') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<script>fetch("/report?webdriver=" + navigator.webdriver)</script>');
      return;
    }
    if (url.pathname === '/login') {
      const user = url.searchParams.get('user') ?? 'anon';
      const token = `tok${randomBytes(12).toString('hex')}`;
      secrets.push(token);
      res.writeHead(302, {
        'Set-Cookie': [`user=${user}; Max-Age=3600; Path=/`, `session=${token}; Max-Age=3600; Path=/; HttpOnly`],
        Location: '/',
      });
      res.end();
      return;
    }
    const user = /(?:^|;\s*)user=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(user
      ? `<title>App</title><h1>Hello ${user}</h1>
<button onclick="document.getElementById('r').textContent = confirm('Sure?') ? 'confirmed' : 'cancelled'">Delete</button>
<p id="r"></p>`
      : '<title>Sign in</title><h1>Please sign in</h1>');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    secrets,
    hits,
    close: () => new Promise(r => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

export function text(result: object): string {
  return (((result as { content?: unknown }).content ?? []) as { type: string; text?: string }[]).map(c => c.text ?? '').join('\n');
}
