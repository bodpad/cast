import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import initSqlJs from 'sql.js';
import { ensurePrivateDir } from './paths.js';
import { classifyHosts } from './sites.js';
export class LoginWindowError extends Error {
}
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
/** Chrome stores times as microseconds since 1601-01-01. */
const CHROME_EPOCH_OFFSET_US = 11_644_473_600_000_000;
/**
 * Opens the profile in a plain Chrome and waits until the human closes it.
 *
 * Nothing drives this window. A Playwright-launched Chrome, and even a Chrome with
 * --remote-debugging-port, reports navigator.webdriver = true, and SSO bot checks (GoDaddy, Okta…)
 * refuse to log in there. Visited sites are read afterwards from the profile's own History.
 * --password-store=basic matches Playwright's launch flags, so Playwright can read the cookies later.
 */
export async function openLoginWindow(dir, opts) {
    ensurePrivateDir(dir);
    assertNotRunning(dir);
    const test = process.env.CAST_TEST_HEADLESS === '1';
    const portFile = join(dir, 'DevToolsActivePort');
    rmSync(portFile, { force: true });
    const pageDir = mkdtempSync(join(tmpdir(), 'cast-login-'));
    const instructions = join(pageDir, 'cast.html');
    writeFileSync(instructions, instructionPage(opts.name, opts.sites ?? []));
    const args = [
        `--user-data-dir=${dir}`,
        '--password-store=basic',
        '--no-first-run',
        '--no-default-browser-check',
        '--new-window',
        ...(test ? ['--headless=new', '--remote-debugging-port=0'] : []),
        pathToFileURL(instructions).href,
        ...(opts.sites ?? []).map(siteUrl),
    ];
    const startedUs = Date.now() * 1000 + CHROME_EPOCH_OFFSET_US - 1_000_000;
    const chrome = spawn(chromeExecutable(), args, { stdio: 'ignore' });
    let spawnError;
    const exited = new Promise(resolve => {
        chrome.on('exit', () => resolve());
        chrome.on('error', e => { spawnError = e; resolve(); });
    });
    try {
        if (opts.onReady) {
            const endpoint = test ? await waitForPort(portFile, exited) : undefined;
            await opts.onReady({ endpoint, close: () => chrome.kill('SIGINT') });
        }
        let timer;
        const timedOut = await Promise.race([
            exited.then(() => false),
            new Promise(resolve => { timer = setTimeout(() => resolve(true), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS); }),
        ]);
        clearTimeout(timer);
        if (timedOut) {
            // SIGINT shuts Chrome down cleanly; SIGTERM drops cookies and history not yet flushed (up to ~30 s).
            chrome.kill('SIGINT');
            const killer = setTimeout(() => chrome.kill('SIGKILL'), 10_000);
            await exited;
            clearTimeout(killer);
        }
        if (spawnError) {
            throw new LoginWindowError('Cannot start Google Chrome. Is it installed (google-chrome --version)? Set CAST_CHROME to its path if it lives elsewhere.');
        }
        return { ...await visitedHosts(dir, startedUs), timedOut };
    }
    catch (e) {
        chrome.kill('SIGINT');
        throw e;
    }
    finally {
        rmSync(pageDir, { recursive: true, force: true });
    }
}
/** "https://Outlook.office.com/mail" → "outlook.office.com"; ports are kept (localhost:3000 matters). */
export function httpHost(url) {
    try {
        const u = new URL(url);
        return u.protocol === 'http:' || u.protocol === 'https:' ? u.host : undefined;
    }
    catch {
        return undefined;
    }
}
/** Accepts a bare host or a URL as typed by a human. */
export function normalizeSite(site) {
    const s = site.trim();
    if (!s)
        return undefined;
    return httpHost(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `http://${s}`);
}
function chromeExecutable() {
    if (process.env.CAST_CHROME)
        return process.env.CAST_CHROME;
    // Same binary Playwright uses for channel "chrome" on Linux.
    return existsSync('/opt/google/chrome/chrome') ? '/opt/google/chrome/chrome' : 'google-chrome';
}
/** A running Chrome would take our window over and exit at once, so refuse early. */
function assertNotRunning(dir) {
    let target;
    try {
        target = readlinkSync(join(dir, 'SingletonLock'));
    }
    catch {
        return;
    }
    const dash = target.lastIndexOf('-');
    const host = target.slice(0, dash);
    const pid = Number(target.slice(dash + 1));
    if (host !== hostname() || !pid)
        return;
    try {
        process.kill(pid, 0);
    }
    catch {
        return;
    }
    throw new LoginWindowError('This profile is already open in another Chrome window (another Claude session or a login window). Close it and try again.');
}
/** Test mode only: Chrome writes "<port>\n<browser ws path>" into the user-data-dir once DevTools listens. */
async function waitForPort(portFile, exited) {
    let gone = false;
    exited.then(() => { gone = true; });
    for (let i = 0; i < 200 && !gone; i++) {
        if (existsSync(portFile)) {
            const [port] = readFileSync(portFile, 'utf8').split('\n');
            if (port)
                return `http://127.0.0.1:${port}`;
        }
        await new Promise(r => setTimeout(r, 100));
    }
    throw new LoginWindowError('Chrome did not start.');
}
/** Chrome page transition qualifier: the visit ended a redirect chain, i.e. the page was shown. */
const CHAIN_END = 0x20000000;
/** Hosts of pages visited since `sinceUs`, from the profile's History database (Chrome flushes it on exit). */
async function visitedHosts(dir, sinceUs) {
    const file = join(dir, 'Default', 'History');
    if (!existsSync(file))
        return { sites: [], signIn: [] };
    const SQL = await initSqlJs();
    const db = new SQL.Database(readFileSync(file));
    try {
        const rows = db.exec('SELECT u.url, v.transition FROM visits v JOIN urls u ON u.id = v.url WHERE v.visit_time >= ? ORDER BY v.visit_time', [sinceUs]);
        const hosts = new Set();
        const landed = new Set();
        for (const [url, transition] of rows[0]?.values ?? []) {
            const host = httpHost(String(url));
            if (!host)
                continue;
            hosts.add(host);
            if (Number(transition) & CHAIN_END)
                landed.add(host);
        }
        return classifyHosts([...hosts], landed);
    }
    finally {
        db.close();
    }
}
function siteUrl(host) {
    return /^(localhost|127\.|\[::1\])/.test(host) ? `http://${host}` : `https://${host}`;
}
function instructionPage(name, sites) {
    const esc = (s) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const known = sites.length
        ? `<p>Known sites for this profile are opened in the other tabs: ${sites.map(esc).join(', ')}.</p>`
        : '';
    return `<!doctype html><meta charset="utf-8"><title>cast: ${esc(name)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;color:#222}
h1{font-size:1.6rem}li{margin:.4rem 0}</style>
<h1>Browser profile “${esc(name)}”</h1>
<p>This Chrome window belongs to the cast profile <b>${esc(name)}</b>. Claude will reuse it later, already logged in.</p>
<ol>
<li>Open a new tab and log in everywhere ${esc(name)} needs: your app, email, SSO, chat…</li>
<li>When asked about MFA or “Stay signed in”, choose to stay signed in.</li>
<li><b>Close this window</b> when you are done. That tells Claude you are finished.</li>
</ol>
${known}
<p>This is a regular Chrome: nothing is automated while you log in. cast never stores or types passwords; it only records which sites you visited (host names, no cookies).</p>
<p>Keep the Claude Code session running until you close the window.</p>`;
}
