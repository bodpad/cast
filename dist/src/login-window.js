import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import initSqlJs from 'sql.js';
import { launchChrome } from './chrome.js';
import { ensurePrivateDir } from './paths.js';
import { classifyHosts } from './sites.js';
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
/** The instruction page, kept in the profile folder; the gateway closes its tab when Claude opens the profile. */
export const INSTRUCTIONS_FILE = 'cast-login.html';
/** Chrome stores times as microseconds since 1601-01-01. */
const CHROME_EPOCH_OFFSET_US = 11_644_473_600_000_000;
/**
 * Opens the profile in a plain Chrome for the human and returns at once. Chrome runs detached, so the
 * window outlives cast and the Claude session; what was visited is read later with readLogin.
 *
 * Nothing drives this window: no Playwright and no DevTools port. Either one makes pages see
 * navigator.webdriver = true, and SSO bot checks (GoDaddy, Okta…) refuse to log in there.
 * The previous session's tabs come back.
 */
export async function startLoginWindow(dir, opts) {
    const test = process.env.CAST_TEST_HEADLESS === '1';
    // Inside the profile, not in /tmp: the session is restored later and the tab must still load.
    ensurePrivateDir(dir);
    const instructions = join(dir, INSTRUCTIONS_FILE);
    writeFileSync(instructions, instructionPage(opts.name, opts.sites ?? []));
    const startedAt = new Date(Date.now() - 1000);
    const chrome = await launchChrome(dir, {
        restore: true,
        look: opts.look,
        browser: opts.browser,
        detached: true,
        // Tests play the human over a DevTools port; real login windows never get one.
        debugPort: test && !!opts.onReady,
        urls: [pathToFileURL(instructions).href, ...(opts.sites ?? []).map(siteUrl)],
    });
    try {
        if (opts.onReady)
            await opts.onReady({ endpoint: chrome.endpoint, close: () => chrome.process.kill('SIGINT') });
    }
    catch (e) {
        await chrome.close();
        throw e;
    }
    return { startedAt, chrome };
}
/** Opens the login window and waits until the human closes it (or the timeout closes it). */
export async function openLoginWindow(dir, opts) {
    const { startedAt, chrome } = await startLoginWindow(dir, opts);
    let timer;
    const timedOut = await Promise.race([
        chrome.exited.then(() => false),
        new Promise(resolve => { timer = setTimeout(() => resolve(true), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS); }),
    ]);
    clearTimeout(timer);
    if (timedOut)
        await chrome.close();
    return { ...await readLogin(dir, startedAt), timedOut };
}
/** "https://app.example.com/vendor?code=…#x" → "https://app.example.com/vendor" */
export function pageUrl(url) {
    const u = new URL(url);
    return u.origin + u.pathname;
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
/** Chrome page transition qualifier: the visit ended a redirect chain, i.e. the page was shown. */
const CHAIN_END = 0x20000000;
/**
 * Hosts of pages visited between `since` and `until`, from the profile's History database.
 * Read it after Chrome exits: History is flushed on exit.
 */
export async function readLogin(dir, since, until = new Date()) {
    const file = join(dir, 'Default', 'History');
    if (!existsSync(file))
        return { sites: [], signIn: [], landings: [] };
    const SQL = await initSqlJs();
    const db = new SQL.Database(readFileSync(file));
    try {
        const rows = db.exec('SELECT u.url, u.title, v.transition FROM visits v JOIN urls u ON u.id = v.url WHERE v.visit_time BETWEEN ? AND ? ORDER BY v.visit_time', [chromeTime(since), chromeTime(until)]);
        const hosts = new Set();
        const last = new Map();
        for (const [url, title, transition] of rows[0]?.values ?? []) {
            const host = httpHost(String(url));
            if (!host)
                continue;
            hosts.add(host);
            if (Number(transition) & CHAIN_END)
                last.set(host, { host, url: pageUrl(String(url)), title: String(title ?? '') });
        }
        const { sites, signIn } = classifyHosts([...hosts], new Set(last.keys()));
        return { sites, signIn, landings: sites.map(h => last.get(h)) };
    }
    finally {
        db.close();
    }
}
function chromeTime(d) {
    return d.getTime() * 1000 + CHROME_EPOCH_OFFSET_US;
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
<li><b>Close this window</b> when you are done, then tell Claude.</li>
</ol>
${known}
<p>This is a regular Chrome: nothing is automated while you log in. cast never stores or types passwords; it only notes which sites you visited and the last page on each (no cookies).</p>
<p>You can leave Claude Code meanwhile: cast reads the visited sites once the window is closed.</p>`;
}
