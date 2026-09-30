import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, readFileSync, readlinkSync, rmSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { ensurePrivateDir } from './paths.js';

export class ChromeError extends Error {}

export interface LaunchOptions {
  /** Tabs to open in addition to the restored session. */
  urls?: string[];
  /** Open a DevTools port for Playwright. Pages then see navigator.webdriver = true. */
  debugPort?: boolean;
  /** Reopen the tabs of the previous session. */
  restore?: boolean;
}

export interface Chrome {
  process: ChildProcess;
  /** Resolves when Chrome is gone, e.g. the human closed its window. */
  exited: Promise<void>;
  /** "http://127.0.0.1:<port>" when started with debugPort. */
  endpoint?: string;
  /** Clean shutdown that keeps cookies and history. */
  close(): Promise<void>;
}

/**
 * Starts a regular Google Chrome on a cast profile, the way a person would, without Playwright's
 * launch flags. --password-store=basic keeps cookie encryption the same in every cast window.
 */
export async function launchChrome(dir: string, opts: LaunchOptions = {}): Promise<Chrome> {
  ensurePrivateDir(dir);
  assertNotRunning(dir);
  const portFile = join(dir, 'DevToolsActivePort');
  rmSync(portFile, { force: true });

  const args = [
    `--user-data-dir=${dir}`,
    '--password-store=basic',
    '--no-first-run',
    '--no-default-browser-check',
    ...(opts.restore ? ['--restore-last-session'] : []),
    ...(opts.debugPort ? ['--remote-debugging-port=0'] : []),
    ...(process.env.CAST_TEST_HEADLESS === '1' ? ['--headless=new'] : []),
    ...(opts.urls ?? []),
  ];
  const child = spawn(chromeExecutable(), args, { stdio: 'ignore' });
  let spawnError: Error | undefined;
  let gone = false;
  const exited = new Promise<void>(resolve => {
    child.on('exit', () => { gone = true; resolve(); });
    child.on('error', e => { spawnError = e; gone = true; resolve(); });
  });

  const chrome: Chrome = {
    process: child,
    exited,
    close: async () => {
      if (gone) return;
      // SIGINT shuts Chrome down cleanly; SIGTERM drops cookies and history not flushed yet (up to ~30 s).
      child.kill('SIGINT');
      const killer = setTimeout(() => child.kill('SIGKILL'), 10_000);
      await exited;
      clearTimeout(killer);
    },
  };

  // Let a failed spawn surface before callers wait on anything else.
  await new Promise(r => setImmediate(r));
  if (spawnError) throw notInstalled();
  if (opts.debugPort) {
    for (let i = 0; i < 200 && !gone; i++) {
      if (existsSync(portFile)) {
        const [port] = readFileSync(portFile, 'utf8').split('\n');
        if (port) {
          chrome.endpoint = `http://127.0.0.1:${port}`;
          return chrome;
        }
      }
      await new Promise(r => setTimeout(r, 100));
    }
    await chrome.close();
    throw spawnError ? notInstalled() : new ChromeError('Chrome did not start.');
  }
  return chrome;
}

export function chromeExecutable(): string {
  if (process.env.CAST_CHROME) return process.env.CAST_CHROME;
  return existsSync('/opt/google/chrome/chrome') ? '/opt/google/chrome/chrome' : 'google-chrome';
}

/** A second Chrome on a busy profile would hand its tabs to the running one and exit, so refuse early. */
export function assertNotRunning(dir: string): void {
  let target: string;
  try { target = readlinkSync(join(dir, 'SingletonLock')); } catch { return; }
  const dash = target.lastIndexOf('-');
  const pid = Number(target.slice(dash + 1));
  if (target.slice(0, dash) !== hostname() || !pid) return;
  try { process.kill(pid, 0); } catch { return; }
  throw new ChromeError('This profile is already open in another Chrome window (another Claude session or a login window). Close that window and try again.');
}

function notInstalled(): ChromeError {
  return new ChromeError('Cannot start Google Chrome. Is it installed (google-chrome --version)? Set CAST_CHROME to its path if it lives elsewhere.');
}
