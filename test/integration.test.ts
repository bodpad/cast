import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium } from 'playwright-core';
import { Gateway } from '../src/gateway.js';
import { spawn } from 'node:child_process';
import { type LoginWindow, openLoginWindow } from '../src/login-window.js';
import { outputDir } from '../src/paths.js';
import { addProfile, findProfile } from '../src/registry.js';
import { type Sandbox, type TestSite, sandbox, startSite, text } from './helpers.js';

// CAST_TEST_HEADED=1 shows the windows (checks what headless cannot, e.g. navigator.webdriver).
const headed = process.env.CAST_TEST_HEADED === '1';
if (!headed) process.env.CAST_TEST_HEADLESS = '1';

let sb: Sandbox;
let site: TestSite;
before(async () => {
  sb = sandbox();
  site = await startSite();
});
after(async () => {
  await site.close();
  sb.cleanup();
});

/** What a human does in /cast:add: log in as `user` and close the window. */
async function humanLogin(name: string, user: string) {
  addProfile(sb.paths, name, 'local', {});
  const p = findProfile(sb.paths, name)!;
  const from = site.hits.length;
  return openLoginWindow(p.dir, {
    name,
    // Like SSO: pass through a sign-in host (localhost) that redirects back to the app (127.0.0.1).
    onReady: w => visitAndClose(w, p.dir, `${ssoHost()}/hop?to=${encodeURIComponent(`${site.url}/login?user=${user}`)}`,
      () => site.hits.slice(from).includes('/')),
  });
}

function ssoHost() {
  return site.url.replace('127.0.0.1', 'localhost');
}

/**
 * Plays the human. Headless: drive the tab over the test-only DevTools port. Headed: the window has no
 * port, so open the URL like a person would (a second `chrome` call hands it to the running window).
 */
async function visitAndClose(w: LoginWindow, dir: string, url: string, done: () => boolean) {
  if (w.endpoint) {
    const browser = await chromium.connectOverCDP(w.endpoint);
    const page = await browser.contexts()[0].newPage();
    await page.goto(url);
    await until(done);
    const cdp = await browser.newBrowserCDPSession();
    await cdp.send('Browser.close').catch(() => {});
    return;
  }
  await new Promise(r => setTimeout(r, 1500));
  spawn('/opt/google/chrome/chrome', [`--user-data-dir=${dir}`, '--password-store=basic', url], { stdio: 'ignore' });
  await until(done);
  await new Promise(r => setTimeout(r, 500));
  w.close();
}

async function until(cond: () => boolean, ms = 15_000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 100))) {
    if (cond()) return;
  }
  throw new Error('timed out waiting for the page');
}

function gp(name: string) {
  const p = findProfile(sb.paths, name)!;
  return { name: p.name, dir: p.dir, outputDir: outputDir(sb.paths, p.name) };
}

function assertNoSecrets(output: string) {
  for (const s of site.secrets) assert.ok(!output.includes(s), 'cookie value leaked into output');
}

describe('login window', () => {
  test('suggests the sites the user landed on, not redirect hops, and finishes when the window closes', async () => {
    const result = await humanLogin('Sam', 'sam');
    assert.equal(result.timedOut, false);
    assert.deepEqual(result.sites, [new URL(site.url).host]);
    assert.deepEqual(result.signIn, [new URL(ssoHost()).host]);
    assert.equal(statSync(findProfile(sb.paths, 'Sam')!.dir).mode & 0o777, 0o700);
  });

  test('the login window is a plain Chrome, not flagged as automated', { skip: !headed && 'headless Chrome always reports webdriver' }, async () => {
    addProfile(sb.paths, 'Plain', 'local', {});
    const dir = findProfile(sb.paths, 'Plain')!.dir;
    const report = () => site.hits.find(h => h.startsWith('/report?'));
    await openLoginWindow(dir, { name: 'Plain', onReady: w => visitAndClose(w, dir, `${site.url}/probe`, () => !!report()) });
    assert.equal(report(), '/report?webdriver=false');
  });

  test('a profile that is already open is reported', async () => {
    addProfile(sb.paths, 'Busy', 'local', {});
    const dir = findProfile(sb.paths, 'Busy')!.dir;
    const first = openLoginWindow(dir, { name: 'Busy', timeoutMs: 8000 });
    await new Promise(r => setTimeout(r, 2500));
    await assert.rejects(openLoginWindow(dir, { name: 'Busy' }), /already open/);
    await first;
  });

  test('times out and closes the window', async () => {
    addProfile(sb.paths, 'Idle', 'local', {});
    const result = await openLoginWindow(findProfile(sb.paths, 'Idle')!.dir, { name: 'Idle', timeoutMs: 1500 });
    assert.equal(result.timedOut, true);
    assert.deepEqual(result.sites, []);
  });
});

describe('gateway', () => {
  const gateway = new Gateway();
  after(() => gateway.closeAll());

  test('tool definitions come from Playwright MCP with a required profile', async () => {
    const tools = await gateway.toolDefs();
    const names = tools.map(t => t.name);
    assert.ok(names.includes('browser_navigate'));
    assert.ok(names.includes('browser_handle_dialog'));
    assert.ok(!names.includes('browser_close'));
    for (const t of tools) {
      assert.equal(t.inputSchema.required?.[0], 'profile');
      assert.ok(t.inputSchema.properties?.profile);
    }
  });

  test('two profiles are open at the same time, each with its own user', async () => {
    await humanLogin('Elon', 'elon');
    const [nav] = await Promise.all([
      gateway.call(gp('Sam'), 'browser_navigate', { url: site.url }),
      gateway.call(gp('Elon'), 'browser_navigate', { url: site.url }),
    ]);
    // Action tools link the snapshot file; the link is absolute and inside cast's output dir.
    const link = /\[Snapshot\]\(([^)]+)\)/.exec(text(nav))?.[1];
    assert.ok(link?.startsWith(outputDir(sb.paths, 'Sam') + '/'), text(nav));
    assert.match(readFileSync(link!, 'utf8'), /Hello sam/);

    const [sam, elon] = await Promise.all([
      gateway.call(gp('Sam'), 'browser_snapshot', {}),
      gateway.call(gp('Elon'), 'browser_snapshot', {}),
    ]);
    assert.match(text(sam), /Hello sam/);
    assert.match(text(elon), /Hello elon/);
    assert.deepEqual(gateway.openNames().sort(), ['Elon', 'Sam']);
    assertNoSecrets(text(sam) + text(elon));
  });

  test('confirm() is handled with browser_handle_dialog', async () => {
    const click = await gateway.call(gp('Sam'), 'browser_click', { target: 'button', element: 'Delete button' });
    assert.match(text(click), /confirm/i);
    const handled = await gateway.call(gp('Sam'), 'browser_handle_dialog', { accept: true });
    assert.ok(!handled.isError, text(handled));
    const snap = await gateway.call(gp('Sam'), 'browser_snapshot', {});
    assert.match(text(snap), /confirmed/);
  });

  test('login survives close and reopen', async () => {
    assert.equal(await gateway.close('sam'), true);
    assert.equal(gateway.isOpen('Sam'), false);
    await gateway.call(gp('Sam'), 'browser_navigate', { url: site.url });
    const again = await gateway.call(gp('Sam'), 'browser_snapshot', {});
    assert.match(text(again), /Hello sam/);
  });

  test('browser_close is not proxied', async () => {
    await assert.rejects(gateway.call(gp('Sam'), 'browser_close', {}), /cast_close/);
  });
});

describe('cast MCP server', () => {
  let client: Client;
  before(async () => {
    client = new Client({ name: 'test', version: '0' });
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: ['dist/src/mcp.js'],
      env: sb.env as Record<string, string>,
      stderr: 'ignore',
    }));
  });
  after(() => client.close());

  test('lists cast and proxied tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map(t => t.name);
    for (const n of ['cast_list', 'cast_open', 'cast_close', 'cast_add', 'cast_login', 'cast_set_sites', 'cast_remove', 'browser_click']) {
      assert.ok(names.includes(n), n);
    }
  });

  test('cast_list, browser_* and cast_set_sites work without leaking cookies', async () => {
    const nav = await client.callTool({ name: 'cast_open', arguments: { profile: 'elon', url: site.url } });
    assert.match(text(nav), /Profile "Elon" is open/);
    const snap = await client.callTool({ name: 'browser_snapshot', arguments: { profile: 'elon' } });
    assert.match(text(snap), /Hello elon/);

    const sites = await client.callTool({ name: 'cast_set_sites', arguments: { name: 'Elon', sites: [`${site.url}/inbox`, 'outlook.office.com'] } });
    assert.ok(!sites.isError, text(sites));

    const list = JSON.parse(text(await client.callTool({ name: 'cast_list', arguments: {} })));
    const elon = list.find((p: { name: string }) => p.name === 'Elon');
    assert.equal(elon.open, true);
    assert.deepEqual(elon.sites, [new URL(site.url).host, 'outlook.office.com']);

    const net = await client.callTool({ name: 'browser_network_requests', arguments: { profile: 'Elon' } });
    assertNoSecrets(text(nav) + text(snap) + JSON.stringify(list) + text(net));

    const closed = await client.callTool({ name: 'cast_close', arguments: { profile: 'Elon' } });
    assert.match(text(closed), /Closed/);
  });

  test('errors are reported as tool errors', async () => {
    const missing = await client.callTool({ name: 'browser_snapshot', arguments: { profile: 'Nobody' } });
    assert.equal(missing.isError, true);
    assert.match(text(missing), /cast:add Nobody/);
    const noProfile = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    assert.equal(noProfile.isError, true);
  });

  test('cast_remove deletes the entry and the Chrome data', async () => {
    const dir = findProfile(sb.paths, 'Idle')!.dir;
    const removed = await client.callTool({ name: 'cast_remove', arguments: { name: 'idle' } });
    assert.ok(!removed.isError, text(removed));
    assert.equal(findProfile(sb.paths, 'Idle'), undefined);
    assert.equal(existsSync(dir), false);
  });
});
