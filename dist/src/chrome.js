import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readlinkSync, rmSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { ensurePrivateDir } from './paths.js';
export class ChromeError extends Error {
}
const KEEP_BACKGROUND_TABS_ALIVE = [
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-background-timer-throttling',
];
/**
 * Starts a regular Google Chrome on a cast profile, the way a person would, without Playwright's
 * launch flags. --password-store=basic keeps cookie encryption the same in every cast window.
 */
export async function launchChrome(dir, opts = {}) {
    ensurePrivateDir(dir);
    assertNotRunning(dir);
    const portFile = join(dir, 'DevToolsActivePort');
    rmSync(portFile, { force: true });
    const args = [
        `--user-data-dir=${dir}`,
        '--password-store=basic',
        '--no-first-run',
        '--no-default-browser-check',
        // Claude acts on the user's behalf in the user's own session. Same default as Playwright MCP:
        // without it the DevTools port makes pages see navigator.webdriver = true. Nothing else is masked.
        '--disable-blink-features=AutomationControlled',
        ...(opts.restore ? ['--restore-last-session'] : []),
        // Background tabs keep rendering, so Claude can act in any tab (as Playwright's own launch does).
        ...(opts.debugPort ? ['--remote-debugging-port=0', ...KEEP_BACKGROUND_TABS_ALIVE] : []),
        ...(process.env.CAST_TEST_HEADLESS === '1' ? ['--headless=new'] : []),
        ...(opts.urls ?? []),
    ];
    const child = spawn(chromeExecutable(), args, { stdio: 'ignore' });
    let spawnError;
    let gone = false;
    const exited = new Promise(resolve => {
        child.on('exit', () => { gone = true; resolve(); });
        child.on('error', e => { spawnError = e; gone = true; resolve(); });
    });
    const chrome = {
        process: child,
        exited,
        close: async () => {
            if (gone)
                return;
            // SIGINT shuts Chrome down cleanly; SIGTERM drops cookies and history not flushed yet (up to ~30 s).
            child.kill('SIGINT');
            const killer = setTimeout(() => child.kill('SIGKILL'), 10_000);
            await exited;
            clearTimeout(killer);
        },
    };
    // Let a failed spawn surface before callers wait on anything else.
    await new Promise(r => setImmediate(r));
    if (spawnError)
        throw notInstalled();
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
export function chromeExecutable() {
    if (process.env.CAST_CHROME)
        return process.env.CAST_CHROME;
    return existsSync('/opt/google/chrome/chrome') ? '/opt/google/chrome/chrome' : 'google-chrome';
}
/** A second Chrome on a busy profile would hand its tabs to the running one and exit, so refuse early. */
export function assertNotRunning(dir) {
    let target;
    try {
        target = readlinkSync(join(dir, 'SingletonLock'));
    }
    catch {
        return;
    }
    const dash = target.lastIndexOf('-');
    const pid = Number(target.slice(dash + 1));
    if (target.slice(0, dash) !== hostname() || !pid)
        return;
    try {
        process.kill(pid, 0);
    }
    catch {
        return;
    }
    throw new ChromeError('This profile is already open in another Chrome window (another Claude session or a login window). Close that window and try again.');
}
function notInstalled() {
    return new ChromeError('Cannot start Google Chrome. Is it installed (google-chrome --version)? Set CAST_CHROME to its path if it lives elsewhere.');
}
