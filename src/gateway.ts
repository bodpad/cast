import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import type { Browser } from './browsers.js';
import { type Chrome, type WindowLook, launchChrome } from './chrome.js';
import { DialogGuard } from './dialogs.js';
import { INSTRUCTIONS_FILE } from './login-window.js';
import { ensurePrivateDir } from './paths.js';
import { VERSION } from './version.js';

const require = createRequire(import.meta.url);
/** @playwright/mcp does not export cli.js, so locate it next to its package.json. */
const PLAYWRIGHT_MCP_CLI = join(dirname(require.resolve('@playwright/mcp/package.json')), 'cli.js');

/** Tools cast replaces (browser_close → cast_close) or never exposes. */
const HIDDEN_TOOLS = new Set(['browser_close', 'browser_install']);

export const PROFILE_PARAM = { type: 'string', description: 'cast profile name, see cast_list' } as const;

export interface GatewayProfile {
  name: string;
  /** Chrome user-data-dir. */
  dir: string;
  /** Where Playwright MCP writes snapshots and screenshots. */
  outputDir: string;
  look?: WindowLook;
  browser?: Browser;
}

interface Child {
  profile: GatewayProfile;
  chrome: Chrome;
  client: Client;
  /** Set when Chrome or the Playwright MCP child went away without cast closing them. */
  exited?: string;
}

export class GatewayError extends Error {}

/**
 * One regular Chrome plus one @playwright/mcp child per open profile; browser_* calls are routed by
 * profile name. cast starts Chrome itself (restoring the previous tabs) and Playwright MCP attaches
 * to it over the DevTools port, so the window behaves like the person's normal Chrome.
 */
export class Gateway {
  private children = new Map<string, Child>();
  private opening = new Map<string, Promise<Child>>();
  private tools?: Promise<Tool[]>;

  isOpen(name: string): boolean {
    const child = this.children.get(name.toLowerCase());
    return !!child && !child.exited;
  }

  openNames(): string[] {
    return [...this.children.values()].filter(c => !c.exited).map(c => c.profile.name);
  }

  async open(profile: GatewayProfile): Promise<void> {
    await this.child(profile);
  }

  private async child(profile: GatewayProfile): Promise<Child> {
    const key = profile.name.toLowerCase();
    const current = this.children.get(key);
    if (current && !current.exited) return current;
    if (current) await this.close(current.profile.name);
    let pending = this.opening.get(key);
    if (!pending) {
      pending = this.start(profile).finally(() => this.opening.delete(key));
      this.opening.set(key, pending);
    }
    return pending;
  }

  private async start(profile: GatewayProfile): Promise<Child> {
    ensurePrivateDir(profile.outputDir);
    const chrome = await launchChrome(profile.dir, { restore: true, debugPort: true, look: profile.look, browser: profile.browser });
    const client = new Client({ name: 'cast', version: VERSION });
    const child: Child = { profile, chrome, client };
    const transport = spawnChild(['--cdp-endpoint', chrome.endpoint!, '--output-dir', profile.outputDir], profile.outputDir);
    transport.onclose = () => {
      child.exited ??= 'the Playwright MCP process exited';
      chrome.close().catch(() => {});
    };
    chrome.exited.then(() => {
      // Usually the human closed the window; the next call opens it again.
      child.exited ??= 'the Chrome window was closed';
      client.close().catch(() => {});
    });
    // A restored tab showing a dialog would keep Playwright from attaching.
    const dialogs = await DialogGuard.start(chrome.endpoint!);
    try {
      await client.connect(transport);
      await settleTabs(client);
    } catch (e) {
      await chrome.close();
      throw e;
    } finally {
      dialogs.stop();
    }
    this.children.set(profile.name.toLowerCase(), child);
    return child;
  }

  async close(name: string): Promise<boolean> {
    const key = name.toLowerCase();
    const child = this.children.get(key);
    if (!child) return false;
    this.children.delete(key);
    const wasOpen = !child.exited;
    child.exited ??= 'closed by cast';
    // Chrome first: on disconnect Playwright closes the tabs it opened, and the saved session would be empty.
    await child.chrome.close();
    await child.client.close().catch(() => {});
    return wasOpen;
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.children.values()].map(c => this.close(c.profile.name)));
  }

  /** Playwright MCP's tools with a required "profile" parameter. Fetched once from a child with no profile (Chrome does not start). */
  toolDefs(): Promise<Tool[]> {
    this.tools ??= (async () => {
      const client = new Client({ name: 'cast', version: VERSION });
      await client.connect(spawnChild([]));
      try {
        const { tools } = await client.listTools();
        return tools.filter(t => !HIDDEN_TOOLS.has(t.name)).map(withProfileParam);
      } finally {
        await client.close().catch(() => {});
      }
    })();
    this.tools.catch(() => { this.tools = undefined; });
    return this.tools;
  }

  /** Opens the profile if needed and forwards the call; the child's answer is returned as is. */
  async call(profile: GatewayProfile, tool: string, args: Record<string, unknown>): Promise<CallToolResult> {
    if (HIDDEN_TOOLS.has(tool)) throw new GatewayError(`${tool} is not available through cast; use cast_close.`);
    const child = await this.child(profile);
    try {
      const result = await child.client.callTool({ name: tool, arguments: args }) as CallToolResult;
      return absoluteLinks(result, profile.outputDir);
    } catch (e) {
      if (child.exited) {
        throw new GatewayError(`Browser for "${profile.name}" stopped (${child.exited}). Call the tool again to reopen it.`);
      }
      throw e;
    }
  }
}

/** Index of the one visible page, the tab in front of the window, or -1. Pages come in the order of browser_tabs. */
const VISIBLE_TAB = 'async (page) => { const states = await Promise.all(page.context().pages()'
  + '.map(p => p.evaluate(() => document.visibilityState).catch(() => ""))); '
  + 'return states.filter(s => s === "visible").length === 1 ? states.indexOf("visible") : -1; }';

/**
 * Waits until Chrome has finished restoring the session (the tab list stops changing), closes the
 * login instruction tab, and makes the tab Chrome restored in front Playwright's current tab, so the
 * person finds the tab they left. Playwright numbers restored tabs in the order they attached, not
 * as in the window, and its current tab may be in the background, where actions hang.
 */
async function settleTabs(client: Client): Promise<void> {
  const list = async () => resultText(await client.callTool({ name: 'browser_tabs', arguments: { action: 'list' } }) as CallToolResult);
  let previous = await list();
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 250));
    const current = await list();
    if (current === previous) break;
    previous = current;
  }
  for (;;) {
    const lines = previous.split('\n').filter(l => /^- \d+:/.test(l));
    const stale = lines.find(l => l.includes(INSTRUCTIONS_FILE));
    if (!stale || lines.length < 2) break;
    const index = Number(/^- (\d+):/.exec(stale)![1]);
    await client.callTool({ name: 'browser_tabs', arguments: { action: 'close', index } });
    previous = await list();
  }
  const visible = await client.callTool({ name: 'browser_run_code_unsafe', arguments: { code: VISIBLE_TAB } }) as CallToolResult;
  const index = Number(/### Result\n(-?\d+)/.exec(resultText(visible))?.[1] ?? -1);
  await client.callTool({ name: 'browser_tabs', arguments: { action: 'select', index: Math.max(index, 0) } });
}

function resultText(result: CallToolResult): string {
  return result.content.map(c => (c.type === 'text' ? c.text : '')).join('\n');
}

function spawnChild(extraArgs: string[], cwd?: string): StdioClientTransport {
  const args = [PLAYWRIGHT_MCP_CLI, '--browser', 'chrome', ...extraArgs];
  // The SDK's default env is reduced; pass everything through (DISPLAY, proxies…).
  return new StdioClientTransport({ command: process.execPath, args, env: { ...process.env } as Record<string, string>, cwd, stderr: 'ignore' });
}

/** The current tab is usually one the person left open: Chrome restores their tabs. */
const NAVIGATE_NOTE = ' In cast the current tab is usually one of the person\'s own tabs, and this replaces it. '
  + 'To open a site, select a tab that already shows it (browser_tabs "select") or open a new one (browser_tabs "new" with url); '
  + 'navigate only in a tab you opened or selected for this task.';

function withProfileParam(tool: Tool): Tool {
  const schema = tool.inputSchema;
  const required = (schema.required ?? []).filter(r => r !== 'profile');
  return {
    ...tool,
    ...(tool.name === 'browser_navigate' ? { description: (tool.description ?? '') + NAVIGATE_NOTE } : {}),
    inputSchema: {
      ...schema,
      properties: { profile: PROFILE_PARAM, ...(schema.properties ?? {}) },
      required: ['profile', ...required],
    },
  };
}

/**
 * Action tools answer with "[Snapshot](page-….yml)" relative to the child's cwd; make such links
 * absolute so Claude can read the file whatever its own cwd is.
 */
function absoluteLinks(result: CallToolResult, cwd: string): CallToolResult {
  if (!Array.isArray(result.content)) return result;
  return {
    ...result,
    content: result.content.map(c => c.type !== 'text' ? c : {
      ...c,
      text: c.text.replace(/\]\(([^)\s]+)\)/g, (m, link: string) =>
        /^[a-z][a-z0-9+.-]*:/i.test(link) || isAbsolute(link) ? m : `](${resolve(cwd, link)})`),
    }),
  };
}
