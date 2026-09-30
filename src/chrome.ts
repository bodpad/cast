import { type ChildProcess, spawn } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { ensurePrivateDir } from './paths.js';

export class ChromeError extends Error {}

const KEEP_BACKGROUND_TABS_ALIVE = [
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--disable-background-timer-throttling',
];

/**
 * Claude acts on the user's behalf in the user's own session. Same default as Playwright MCP: without
 * it the DevTools port makes pages see navigator.webdriver = true. Nothing else is masked. --test-type
 * hides Chrome's "unsupported command-line flag" bar that the first flag brings.
 */
const HIDE_WEBDRIVER = ['--disable-blink-features=AutomationControlled', '--test-type'];

export interface LaunchOptions {
  /** Tabs to open in addition to the restored session. */
  urls?: string[];
  /** Open a DevTools port for Playwright. */
  debugPort?: boolean;
  /** Reopen the tabs of the previous session. */
  restore?: boolean;
  /** How people tell this profile's window from the others. */
  look?: WindowLook;
  /** Keep running after cast exits (the login window outlives the Claude session). */
  detached?: boolean;
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
  const headless = process.env.CAST_TEST_HEADLESS === '1';
  assertCanRun(headless);
  ensurePrivateDir(dir);
  assertNotRunning(dir);
  const portFile = join(dir, 'DevToolsActivePort');
  rmSync(portFile, { force: true });
  if (opts.look?.color) applyColor(dir, opts.look.color);
  const restore = opts.restore && existsSync(join(dir, 'Default', 'Sessions'));
  if (restore && opts.look) nameSessionWindows(dir, opts.look.title);

  const args = [
    `--user-data-dir=${dir}`,
    '--password-store=basic',
    '--no-first-run',
    '--no-default-browser-check',
    // Only when there is a session: on a new profile the flag opens a window that ignores --window-name.
    ...(restore ? ['--restore-last-session'] : []),
    // Names new windows only; restored ones keep the name saved in the session (see nameSessionWindows).
    ...(opts.look ? [`--window-name=${opts.look.title}`] : []),
    // Background tabs keep rendering, so Claude can act in any tab (as Playwright's own launch does).
    ...(opts.debugPort ? ['--remote-debugging-port=0', ...KEEP_BACKGROUND_TABS_ALIVE, ...HIDE_WEBDRIVER] : []),
    ...(headless ? ['--headless=new'] : []),
    ...(opts.urls ?? []),
  ];
  // Chrome's own output, to explain a Chrome that exits right away.
  const log = join(dir, LOG_FILE);
  const out = openSync(log, 'w', 0o600);
  const child = spawn(chromeExecutable(), args, { stdio: ['ignore', out, out], detached: opts.detached });
  closeSync(out);
  if (opts.detached) child.unref();
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
    throw spawnError ? notInstalled() : startFailure(log, gone);
  }
  // Until the lock exists, isRunning() would report a login window that is still starting as closed.
  for (let i = 0; i < 100 && !gone && !isRunning(dir); i++) await new Promise(r => setTimeout(r, 100));
  if (gone) throw startFailure(log, true);
  return chrome;
}

const LOG_FILE = 'cast-chrome.log';

/** Environment problems, each in one sentence with what to do. */
function assertCanRun(headless: boolean): void {
  if (process.platform !== 'linux') {
    throw new ChromeError(`cast works on Linux only for now (this is ${process.platform}).`);
  }
  if (!headless && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    throw new ChromeError('No display to show Chrome on (DISPLAY and WAYLAND_DISPLAY are not set): start Claude Code from a terminal in your desktop session, not over plain SSH.');
  }
}

/** Why Chrome did not come up, from the last lines it printed. */
function startFailure(log: string, exited: boolean): ChromeError {
  if (!exited) return new ChromeError(`Chrome did not start within 20 seconds. Its output is in ${log}.`);
  let text = '';
  try { text = readFileSync(log, 'utf8'); } catch { /* no output */ }
  if (/Missing X server|cannot open display|Failed to connect to Wayland/i.test(text)) {
    return new ChromeError('Chrome cannot open a window: the display is not reachable. Start Claude Code from a terminal in your desktop session, not over plain SSH.');
  }
  if (/profile appears to be in use|ProcessSingleton/i.test(text)) {
    return new ChromeError('This profile is already open in another Chrome window (a login window or another Claude session). Close that window and try again.');
  }
  const last = text.split('\n').map(l => l.replace(/^\[[^\]]*\]\s*/, '').trim()).filter(l => l && !/^Read channel/.test(l)).slice(-2).join(' ');
  return new ChromeError(`Chrome exited right after starting${last ? `: ${last}` : ''}. Its output is in ${log}.`);
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

/** SNSS commands (components/sessions/core/session_service_commands.cc). */
const SET_TAB_WINDOW = 0;
const SET_WINDOW_USER_TITLE = 31;

/**
 * Restored windows ignore --window-name and keep the title saved in the session ("Name window…"),
 * so a profile made before window names existed, or a login window restored as Claude's window,
 * would show the wrong title. Appends a SetWindowUserTitle command for each window to the session
 * files; the last command wins. Leaves files in a format it does not know alone.
 */
export function nameSessionWindows(dir: string, title: string): void {
  const sessions = join(dir, 'Default', 'Sessions');
  let files: string[];
  try { files = readdirSync(sessions).filter(f => f.startsWith('Session_')); } catch { return; }
  for (const f of files) {
    const file = join(sessions, f);
    try {
      const windows = sessionWindows(readFileSync(file));
      if (windows?.size) appendFileSync(file, Buffer.concat([...windows].map(w => userTitleCommand(w, title))));
    } catch { /* leave it to Chrome */ }
  }
}

/** Window ids in an SNSS session file, or undefined when it is not one. */
function sessionWindows(b: Buffer): Set<number> | undefined {
  if (b.length < 8 || b.toString('latin1', 0, 4) !== 'SNSS' || b.readInt32LE(4) !== 3) return undefined;
  const windows = new Set<number>();
  for (let i = 8; i + 3 <= b.length;) {
    const size = b.readUInt16LE(i);
    const id = b[i + 2];
    if (size < 1 || i + 2 + size > b.length) return undefined;
    // SetTabWindow is a struct {window id, tab id}; SetWindowUserTitle a pickle {payload size, window id, …}.
    if (id === SET_TAB_WINDOW && size === 9) windows.add(b.readInt32LE(i + 3));
    if (id === SET_WINDOW_USER_TITLE && size >= 9) windows.add(b.readInt32LE(i + 7));
    i += 2 + size;
  }
  return windows;
}

/** SetWindowUserTitle(window, title) as a pickle: payload size, window id, string length, UTF-8 padded to 4 bytes. */
function userTitleCommand(window: number, title: string): Buffer {
  const text = Buffer.from(title, 'utf8');
  const padded = Math.ceil(text.length / 4) * 4;
  const pickle = Buffer.alloc(4 + 4 + 4 + padded);
  pickle.writeUInt32LE(pickle.length - 4, 0);
  pickle.writeInt32LE(window, 4);
  pickle.writeInt32LE(text.length, 8);
  text.copy(pickle, 12);
  const head = Buffer.alloc(3);
  head.writeUInt16LE(pickle.length + 1, 0);
  head[2] = SET_WINDOW_USER_TITLE;
  return Buffer.concat([head, pickle]);
}

type Section = { theme?: Record<string, unknown>; [key: string]: unknown };
type Prefs = { browser?: Section; extensions?: Section; [key: string]: unknown };

/** Whether a Chrome runs on this profile folder, by its SingletonLock ("<host>-<pid>"). */
export function isRunning(dir: string): boolean {
  let target: string;
  try { target = readlinkSync(join(dir, 'SingletonLock')); } catch { return false; }
  const dash = target.lastIndexOf('-');
  const pid = Number(target.slice(dash + 1));
  if (target.slice(0, dash) !== hostname() || !pid) return false;
  try { process.kill(pid, 0); } catch { return false; }
  return true;
}

/** A second Chrome on a busy profile would hand its tabs to the running one and exit, so refuse early. */
export function assertNotRunning(dir: string): void {
  if (isRunning(dir)) throw new ChromeError('This profile is already open in another Chrome window (a login window or another Claude session). Close that window and try again.');
}

function notInstalled(): ChromeError {
  return new ChromeError(`Google Chrome is not installed (${chromeExecutable()} not found): install it from https://www.google.com/chrome/, or set CAST_CHROME to its path.`);
}
