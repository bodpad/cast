import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { ensurePrivateDir } from './paths.js';

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
}

interface Child {
  profile: GatewayProfile;
  client: Client;
  transport: StdioClientTransport;
  /** Set when the child process went away without cast closing it. */
  exited?: string;
}

export class GatewayError extends Error {}

/** One @playwright/mcp child per open profile; browser_* calls are routed by profile name. */
export class Gateway {
  private children = new Map<string, Child>();
  private tools?: Promise<Tool[]>;

  isOpen(name: string): boolean {
    return this.children.has(name.toLowerCase());
  }

  openNames(): string[] {
    return [...this.children.values()].map(c => c.profile.name);
  }

  async open(profile: GatewayProfile): Promise<void> {
    const key = profile.name.toLowerCase();
    const current = this.children.get(key);
    if (current && !current.exited) return;
    if (current) this.children.delete(key);

    ensurePrivateDir(profile.dir);
    const client = new Client({ name: 'cast', version: '0.1.0' });
    ensurePrivateDir(profile.outputDir);
    const transport = spawnChild([
      '--user-data-dir', profile.dir,
      '--output-dir', profile.outputDir,
    ], profile.outputDir);
    const child: Child = { profile, client, transport };
    transport.onclose = () => {
      child.exited ??= 'the browser process exited';
    };
    await client.connect(transport);
    this.children.set(key, child);
  }

  async close(name: string): Promise<boolean> {
    const key = name.toLowerCase();
    const child = this.children.get(key);
    if (!child) return false;
    this.children.delete(key);
    if (!child.exited) {
      child.exited = 'closed by cast';
      await child.client.callTool({ name: 'browser_close', arguments: {} }).catch(() => {});
    }
    await child.client.close().catch(() => {});
    return true;
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.children.values()].map(c => this.close(c.profile.name)));
  }

  /** Playwright MCP's tools with a required "profile" parameter. Fetched once from a child with no profile (Chrome does not start). */
  toolDefs(): Promise<Tool[]> {
    this.tools ??= (async () => {
      const client = new Client({ name: 'cast', version: '0.1.0' });
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
    await this.open(profile);
    const child = this.children.get(profile.name.toLowerCase())!;
    try {
      const result = await child.client.callTool({ name: tool, arguments: args }) as CallToolResult;
      return withHints(profile.name, absoluteLinks(result, profile.outputDir));
    } catch (e) {
      if (child.exited) {
        this.children.delete(profile.name.toLowerCase());
        throw new GatewayError(`Browser for "${profile.name}" stopped (${child.exited}). Call cast_open ${profile.name} to start it again.`);
      }
      throw e;
    }
  }
}

function spawnChild(extraArgs: string[], cwd?: string): StdioClientTransport {
  const args = [PLAYWRIGHT_MCP_CLI, '--browser', 'chrome', ...extraArgs];
  if (process.env.CAST_TEST_HEADLESS === '1') args.push('--headless');
  // The SDK's default env drops DISPLAY and Chrome would silently start headless.
  return new StdioClientTransport({ command: process.execPath, args, env: { ...process.env } as Record<string, string>, cwd, stderr: 'ignore' });
}

function withProfileParam(tool: Tool): Tool {
  const schema = tool.inputSchema;
  const required = (schema.required ?? []).filter(r => r !== 'profile');
  return {
    ...tool,
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

/** Chrome refuses a user-data-dir that another Chrome holds; say what that means for cast. */
function withHints(name: string, result: CallToolResult): CallToolResult {
  if (!result.isError) return result;
  const text = result.content.map(c => (c.type === 'text' ? c.text : '')).join('\n');
  if (!/ProcessSingleton|already in use|user data directory is already/i.test(text)) return result;
  return {
    ...result,
    content: [
      ...result.content,
      { type: 'text', text: `cast: profile "${name}" is already open in another Chrome (maybe another Claude session or a /cast:login window). Close that window and retry.` },
    ],
  };
}
