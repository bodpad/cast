import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { ensurePrivateDir } from './paths.js';

export class ChromeError extends Error {}

const KEEP_BACKGROUND_TABS_ALIVE = [
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--disable-background-timer-throttling',
];

export interface LaunchOptions {
  /** Tabs to open in addition to the restored session. */
  urls?: string[];
  /** Open a DevTools port for Playwright. */
  debugPort?: boolean;
  /** Reopen the tabs of the previous session. */
  restore?: boolean;
  /** How people tell this profile's window from the others. */
  look?: WindowLook;
}

export interface WindowLook {
  /** Shown in the title bar, the taskbar and Alt+Tab instead of the page title. */
  title: string;
  /** Theme color, e.g. "#1e88e5". */
  color?: string;
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
  if (opts.look?.color) applyColor(dir, opts.look.color);

  const args = [
    `--user-data-dir=${dir}`,
    '--password-store=basic',
    '--no-first-run',
    '--no-default-browser-check',
    // Claude acts on the user's behalf in the user's own session. Same default as Playwright MCP:
    // without it the DevTools port makes pages see navigator.webdriver = true. Nothing else is masked.
    '--disable-blink-features=AutomationControlled',
    // Only when there is a session: on a new profile the flag opens a window that ignores --window-name.
    ...(opts.restore && existsSync(join(dir, 'Default', 'Sessions')) ? ['--restore-last-session'] : []),
    ...(opts.look ? [`--window-name=${opts.look.title}`] : []),
    // Background tabs keep rendering, so Claude can act in any tab (as Playwright's own launch does).
    ...(opts.debugPort ? ['--remote-debugging-port=0', ...KEEP_BACKGROUND_TABS_ALIVE] : []),
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

/**
 * Colors the window through the profile's own preferences, as "Customize Chrome" would, before Chrome
 * reads them. Pages cannot see any of it. Found by trying on Chrome 151 (Linux):
 * - a fresh profile follows the GTK theme, which ignores the color: system_theme 0 is Chrome's own theme;
 * - color_variant2 3 ("vibrant") keeps the hue recognizable in dark mode;
 * - custom_chrome_frame false shows the system title bar, where --window-name is visible.
 */
export function applyColor(dir: string, color: string): void {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return;
  const file = join(dir, 'Default', 'Preferences');
  let prefs: Prefs = {};
  if (existsSync(file)) {
    try { prefs = JSON.parse(readFileSync(file, 'utf8')); } catch { return; } // Leave a file we cannot read to Chrome.
  } else {
    mkdirSync(join(dir, 'Default'), { recursive: true, mode: 0o700 });
  }
  const argb = 0xff000000 | parseInt(color.slice(1), 16); // A signed 32-bit ARGB, as Chrome stores it.
  prefs.extensions = { ...prefs.extensions, theme: { ...prefs.extensions?.theme, system_theme: 0 } };
  prefs.browser = {
    ...prefs.browser,
    custom_chrome_frame: false,
    theme: { ...prefs.browser?.theme, user_color2: argb, color_variant2: 3 },
  };
  writeFileSync(file, JSON.stringify(prefs), { mode: 0o600 });
}

type Section = { theme?: Record<string, unknown>; [key: string]: unknown };
type Prefs = { browser?: Section; extensions?: Section; [key: string]: unknown };

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
