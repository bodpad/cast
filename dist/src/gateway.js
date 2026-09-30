import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { launchChrome } from './chrome.js';
import { INSTRUCTIONS_FILE } from './login-window.js';
import { ensurePrivateDir } from './paths.js';
import { VERSION } from './version.js';
const require = createRequire(import.meta.url);
/** @playwright/mcp does not export cli.js, so locate it next to its package.json. */
const PLAYWRIGHT_MCP_CLI = join(dirname(require.resolve('@playwright/mcp/package.json')), 'cli.js');
/** Tools cast replaces (browser_close → cast_close) or never exposes. */
const HIDDEN_TOOLS = new Set(['browser_close', 'browser_install']);
export const PROFILE_PARAM = { type: 'string', description: 'cast profile name, see cast_list' };
export class GatewayError extends Error {
}
/**
 * One regular Chrome plus one @playwright/mcp child per open profile; browser_* calls are routed by
 * profile name. cast starts Chrome itself (restoring the previous tabs) and Playwright MCP attaches
 * to it over the DevTools port, so the window behaves like the person's normal Chrome.
 */
export class Gateway {
    children = new Map();
    opening = new Map();
    tools;
    isOpen(name) {
        const child = this.children.get(name.toLowerCase());
        return !!child && !child.exited;
    }
    openNames() {
        return [...this.children.values()].filter(c => !c.exited).map(c => c.profile.name);
    }
    async open(profile) {
        await this.child(profile);
    }
    async child(profile) {
        const key = profile.name.toLowerCase();
        const current = this.children.get(key);
        if (current && !current.exited)
            return current;
        if (current)
            await this.close(current.profile.name);
        let pending = this.opening.get(key);
        if (!pending) {
            pending = this.start(profile).finally(() => this.opening.delete(key));
            this.opening.set(key, pending);
        }
        return pending;
    }
    async start(profile) {
        ensurePrivateDir(profile.outputDir);
        const chrome = await launchChrome(profile.dir, { restore: true, debugPort: true });
        const client = new Client({ name: 'cast', version: VERSION });
        const child = { profile, chrome, client };
        const transport = spawnChild(['--cdp-endpoint', chrome.endpoint, '--output-dir', profile.outputDir], profile.outputDir);
        transport.onclose = () => {
            child.exited ??= 'the Playwright MCP process exited';
            chrome.close().catch(() => { });
        };
        chrome.exited.then(() => {
            // Usually the human closed the window; the next call opens it again.
            child.exited ??= 'the Chrome window was closed';
            client.close().catch(() => { });
        });
        try {
            await client.connect(transport);
            await settleTabs(client);
        }
        catch (e) {
            await chrome.close();
            throw e;
        }
        this.children.set(profile.name.toLowerCase(), child);
        return child;
    }
    async close(name) {
        const key = name.toLowerCase();
        const child = this.children.get(key);
        if (!child)
            return false;
        this.children.delete(key);
        const wasOpen = !child.exited;
        child.exited ??= 'closed by cast';
        // Chrome first: on disconnect Playwright closes the tabs it opened, and the saved session would be empty.
        await child.chrome.close();
        await child.client.close().catch(() => { });
        return wasOpen;
    }
    async closeAll() {
        await Promise.all([...this.children.values()].map(c => this.close(c.profile.name)));
    }
    /** Playwright MCP's tools with a required "profile" parameter. Fetched once from a child with no profile (Chrome does not start). */
    toolDefs() {
        this.tools ??= (async () => {
            const client = new Client({ name: 'cast', version: VERSION });
            await client.connect(spawnChild([]));
            try {
                const { tools } = await client.listTools();
                return tools.filter(t => !HIDDEN_TOOLS.has(t.name)).map(withProfileParam);
            }
            finally {
                await client.close().catch(() => { });
            }
        })();
        this.tools.catch(() => { this.tools = undefined; });
        return this.tools;
    }
    /** Opens the profile if needed and forwards the call; the child's answer is returned as is. */
    async call(profile, tool, args) {
        if (HIDDEN_TOOLS.has(tool))
            throw new GatewayError(`${tool} is not available through cast; use cast_close.`);
        const child = await this.child(profile);
        try {
            const result = await child.client.callTool({ name: tool, arguments: args });
            return absoluteLinks(result, profile.outputDir);
        }
        catch (e) {
            if (child.exited) {
                throw new GatewayError(`Browser for "${profile.name}" stopped (${child.exited}). Call the tool again to reopen it.`);
            }
            throw e;
        }
    }
}
/**
 * Waits until Chrome has finished restoring the session (the tab list stops changing), closes the
 * login instruction tab, and brings Playwright's current tab to the front: Chrome activates the
 * last-used tab while restoring, and actions in a background tab hang.
 */
async function settleTabs(client) {
    const list = async () => resultText(await client.callTool({ name: 'browser_tabs', arguments: { action: 'list' } }));
    let previous = await list();
    for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 250));
        const current = await list();
        if (current === previous)
            break;
        previous = current;
    }
    for (;;) {
        const lines = previous.split('\n').filter(l => /^- \d+:/.test(l));
        const stale = lines.find(l => l.includes(INSTRUCTIONS_FILE));
        if (!stale || lines.length < 2)
            break;
        const index = Number(/^- (\d+):/.exec(stale)[1]);
        await client.callTool({ name: 'browser_tabs', arguments: { action: 'close', index } });
        previous = await list();
    }
    await client.callTool({ name: 'browser_tabs', arguments: { action: 'select', index: 0 } });
}
function resultText(result) {
    return result.content.map(c => (c.type === 'text' ? c.text : '')).join('\n');
}
function spawnChild(extraArgs, cwd) {
    const args = [PLAYWRIGHT_MCP_CLI, '--browser', 'chrome', ...extraArgs];
    // The SDK's default env is reduced; pass everything through (DISPLAY, proxies…).
    return new StdioClientTransport({ command: process.execPath, args, env: { ...process.env }, cwd, stderr: 'ignore' });
}
function withProfileParam(tool) {
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
function absoluteLinks(result, cwd) {
    if (!Array.isArray(result.content))
        return result;
    return {
        ...result,
        content: result.content.map(c => c.type !== 'text' ? c : {
            ...c,
            text: c.text.replace(/\]\(([^)\s]+)\)/g, (m, link) => /^[a-z][a-z0-9+.-]*:/i.test(link) || isAbsolute(link) ? m : `](${resolve(cwd, link)})`),
        }),
    };
}
