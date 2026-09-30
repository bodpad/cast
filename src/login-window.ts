import { type BrowserContext, type Page, chromium } from 'playwright-core';
import { ensurePrivateDir } from './paths.js';

export interface LoginWindowOptions {
  /** Profile name shown on the instruction page. */
  name: string;
  /** Sites the profile already knows; opened as extra tabs for /cast:login. */
  sites?: string[];
  timeoutMs?: number;
  /** Tests only: receives the context to browse and close it instead of a human. */
  onContext?: (context: BrowserContext) => void | Promise<void>;
}

export interface LoginResult {
  /** Hosts (with port) of every main-frame http(s) navigation, in first-visit order. */
  domains: string[];
  timedOut: boolean;
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Opens a visible Chrome on the profile's user-data-dir and waits until the human closes it.
 * Uses the same playwright-core as @playwright/mcp so both read the profile the same way.
 */
export async function openLoginWindow(dir: string, opts: LoginWindowOptions): Promise<LoginResult> {
  ensurePrivateDir(dir);
  const context = await chromium.launchPersistentContext(dir, {
    channel: 'chrome',
    headless: process.env.CAST_TEST_HEADLESS === '1',
    viewport: null,
  });

  const domains = new Set<string>();
  const track = (page: Page) => {
    page.on('framenavigated', frame => {
      if (frame !== page.mainFrame()) return;
      const host = httpHost(frame.url());
      if (host) domains.add(host);
    });
  };
  const closed = new Promise<void>(resolve => context.on('close', () => resolve()));
  context.on('page', track);
  context.pages().forEach(track);

  const first = context.pages()[0] ?? await context.newPage();
  await first.setContent(instructionPage(opts.name, opts.sites ?? []));
  for (const site of opts.sites ?? []) {
    const page = await context.newPage();
    page.goto(siteUrl(site)).catch(() => { /* the human sees the error in the tab */ });
  }
  await first.bringToFront().catch(() => {});

  if (opts.onContext) await opts.onContext(context);

  let timer: NodeJS.Timeout | undefined;
  const timedOut = await Promise.race([
    closed.then(() => false),
    new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(true), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS); }),
  ]);
  clearTimeout(timer);
  if (timedOut) await context.close().catch(() => {});
  return { domains: [...domains], timedOut };
}

/** "https://Outlook.office.com/mail" → "outlook.office.com"; ports are kept (localhost:3000 matters). */
export function httpHost(url: string): string | undefined {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.host : undefined;
  } catch {
    return undefined;
  }
}

/** Accepts a bare host or a URL as typed by a human. */
export function normalizeSite(site: string): string | undefined {
  const s = site.trim();
  if (!s) return undefined;
  return httpHost(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `http://${s}`);
}

function siteUrl(host: string): string {
  return /^(localhost|127\.|\[::1\])/.test(host) ? `http://${host}` : `https://${host}`;
}

function instructionPage(name: string, sites: string[]): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const known = sites.length
    ? `<p>Known sites for this profile are opened in the other tabs: ${sites.map(esc).join(', ')}.</p>`
    : '';
  return `<!doctype html><meta charset="utf-8"><title>cast: ${esc(name)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;color:#222}
h1{font-size:1.6rem}li{margin:.4rem 0}code{background:#eee;padding:0 .3rem;border-radius:3px}</style>
<h1>Browser profile “${esc(name)}”</h1>
<p>This Chrome window belongs to the cast profile <b>${esc(name)}</b>. Claude will reuse it later, already logged in.</p>
<ol>
<li>Open a new tab and log in everywhere ${esc(name)} needs: your app, email, SSO, chat…</li>
<li>When asked about MFA or “Stay signed in”, choose to stay signed in.</li>
<li><b>Close this window</b> when you are done. That tells Claude you are finished.</li>
</ol>
${known}
<p>cast never stores or types passwords. It only records which sites you visited (host names, no cookies).</p>`;
}
