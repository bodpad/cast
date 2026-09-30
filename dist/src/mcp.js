#!/usr/bin/env node
import { rmSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Gateway, PROFILE_PARAM } from './gateway.js';
import { openLoginWindow, normalizeSite } from './login-window.js';
import { outputDir, resolvePaths } from './paths.js';
import { VERSION } from './version.js';
import { RegistryError, addProfile, editProfile, findProfile, loadProfiles, removeProfile, requireReady, updateProfile, } from './registry.js';
const HUMAN_ONLY = 'Call ONLY when the user explicitly asked for it (/cast:add, /cast:login): a human must log in in the window. Never call it on your own because a session expired.';
const CAST_TOOLS = [
    {
        name: 'cast_list',
        description: 'List cast browser profiles (one per person): name, scope, email, description, known sites, whether it is set up on this machine (ready), currently open, and the Chrome profile folder (dir). Never start Chrome on that folder by hand: use /cast:login, which launches it with the right flags.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'cast_open',
        description: 'Open the visible Chrome of a profile, optionally navigating to a URL. browser_* tools also open the profile automatically.',
        inputSchema: {
            type: 'object',
            properties: { profile: PROFILE_PARAM, url: { type: 'string', description: 'URL to open' } },
            required: ['profile'],
        },
    },
    {
        name: 'cast_close',
        description: 'Close the Chrome of a profile. Logins are kept in the profile. Close profiles when the task is done.',
        inputSchema: { type: 'object', properties: { profile: PROFILE_PARAM }, required: ['profile'] },
    },
    {
        name: 'cast_add',
        description: `Create a profile and open a clean Chrome for the human to log in; blocks until they close the window and returns the visited domains. ${HUMAN_ONLY}`,
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Profile name: letters, digits, "-" or "_"' },
                email: { type: 'string' },
                description: { type: 'string', description: 'Who this person is in tests, e.g. "sender" or "vendor, Insygna org". Only what the user gave.' },
                scope: { type: 'string', enum: ['local', 'project', 'user'], description: 'local (default): this project only; project: shared team slot in .claude/cast.yaml; user: all projects' },
            },
            required: ['name'],
        },
    },
    {
        name: 'cast_login',
        description: `Reopen an existing profile for the human to log in again or add sites; blocks until they close the window and returns newly visited domains. ${HUMAN_ONLY}`,
        inputSchema: { type: 'object', properties: { name: PROFILE_PARAM }, required: ['name'] },
    },
    {
        name: 'cast_set_sites',
        description: 'Replace the list of sites (hosts, e.g. "localhost:3000", "outlook.office.com") remembered for a profile.',
        inputSchema: {
            type: 'object',
            properties: { name: PROFILE_PARAM, sites: { type: 'array', items: { type: 'string' } } },
            required: ['name', 'sites'],
        },
    },
    {
        name: 'cast_update',
        description: 'Change the email or description of a profile without logging in again. The description says who this person is in tests (e.g. "vendor, Insygna org"); Claude picks profiles by it. Save only what the user stated or confirmed, never a guess. An empty string clears a field.',
        inputSchema: {
            type: 'object',
            properties: { name: PROFILE_PARAM, email: { type: 'string' }, description: { type: 'string' } },
            required: ['name'],
        },
    },
    {
        name: 'cast_remove',
        description: 'Delete a profile and its Chrome data (logins). Only when the user asked (/cast:remove).',
        inputSchema: { type: 'object', properties: { name: PROFILE_PARAM }, required: ['name'] },
    },
];
export function createServer(paths, gateway) {
    const server = new Server({ name: 'cast', version: VERSION }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [...CAST_TOOLS, ...await gateway.toolDefs()],
    }));
    server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
        const { name, arguments: args = {} } = req.params;
        const token = req.params._meta?.progressToken;
        let n = 0;
        const progress = () => {
            if (token === undefined)
                return;
            extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress: ++n } }).catch(() => { });
        };
        try {
            if (name.startsWith('cast_'))
                return await castTool(paths, gateway, name, args, progress);
            const { profile, ...rest } = args;
            if (typeof profile !== 'string')
                return fail('Missing "profile": pass the cast profile name (see cast_list).');
            return await gateway.call(gatewayProfile(paths, requireReady(paths, profile)), name, rest);
        }
        catch (e) {
            return fail(e.message);
        }
    });
    return server;
}
async function castTool(paths, gateway, tool, args, progress) {
    switch (tool) {
        case 'cast_list': {
            const open = new Set(gateway.openNames().map(n => n.toLowerCase()));
            const profiles = loadProfiles(paths).map(p => ({
                name: p.name, scope: p.scope, email: p.email, description: p.description, sites: p.sites,
                ready: p.ready, open: open.has(p.name.toLowerCase()), dir: p.dir,
                ...(p.ready ? {} : { note: `Not set up on this machine: ask the user to run /cast:add ${p.name}` }),
            }));
            return ok(profiles.length ? JSON.stringify(profiles, null, 2) : 'No cast profiles yet. The user can create one with /cast:add <name>.');
        }
        case 'cast_open': {
            const p = requireReady(paths, str(args, 'profile'));
            const gp = gatewayProfile(paths, p);
            // Playwright MCP starts Chrome lazily, so make a call that shows the window.
            const url = optStr(args, 'url');
            const result = url
                ? await gateway.call(gp, 'browser_navigate', { url })
                : await gateway.call(gp, 'browser_tabs', { action: 'list' });
            return { ...result, content: [{ type: 'text', text: `Profile "${p.name}" is open.` }, ...result.content] };
        }
        case 'cast_close': {
            const name = str(args, 'profile');
            return ok(await gateway.close(name) ? `Closed "${name}".` : `"${name}" was not open.`);
        }
        case 'cast_add': {
            const name = str(args, 'name');
            const scope = (optStr(args, 'scope') ?? 'local');
            if (!['local', 'project', 'user'].includes(scope))
                throw new RegistryError(`Unknown scope "${scope}".`);
            const before = findProfile(paths, name);
            const p = addProfile(paths, name, scope, { email: optStr(args, 'email'), description: optStr(args, 'description') });
            try {
                const result = await loginWindow(gateway, p, progress);
                updateProfile(paths, p.name, { lastLoginAt: new Date().toISOString() });
                return ok(loginReport(p, result));
            }
            catch (e) {
                if (!before)
                    removeProfile(paths, p.name);
                throw e;
            }
        }
        case 'cast_login': {
            const p = requireReady(paths, str(args, 'name'));
            const result = await loginWindow(gateway, p, progress);
            updateProfile(paths, p.name, { lastLoginAt: new Date().toISOString() });
            return ok(loginReport(p, { ...result, sites: result.sites.filter(d => !p.sites.includes(d)) }));
        }
        case 'cast_set_sites': {
            const raw = args.sites;
            if (!Array.isArray(raw) || raw.some(s => typeof s !== 'string'))
                throw new RegistryError('"sites" must be an array of strings.');
            const sites = [...new Set(raw.map(s => normalizeSite(s)).filter((s) => !!s))];
            const p = updateProfile(paths, str(args, 'name'), { sites });
            return ok(`Sites of "${p.name}": ${p.sites.join(', ') || '(none)'}`);
        }
        case 'cast_update': {
            const fields = { email: rawStr(args, 'email'), description: rawStr(args, 'description') };
            if (fields.email === undefined && fields.description === undefined)
                throw new RegistryError('Pass "email" or "description" to change.');
            const p = editProfile(paths, str(args, 'name'), fields);
            const slot = p.scope === 'project' && fields.description !== undefined
                ? ' The description is kept for you only; the team slot in .claude/cast.yaml is unchanged.' : '';
            return ok(`Profile "${p.name}": email ${p.email ?? '(none)'}, description ${p.description ?? '(none)'}.${slot}`);
        }
        case 'cast_remove': {
            const name = str(args, 'name');
            await gateway.close(name);
            const p = removeProfile(paths, name);
            rmSync(p.dir, { recursive: true, force: true });
            rmSync(outputDir(paths, p.name), { recursive: true, force: true });
            const slot = p.scope === 'project' ? ' The team slot stays in .claude/cast.yaml.' : '';
            return ok(`Removed profile "${p.name}" (${p.scope}) and its browser data.${slot}`);
        }
        default:
            return fail(`Unknown tool ${tool}.`);
    }
}
async function loginWindow(gateway, p, progress) {
    // The Chrome profile can be used by one browser at a time.
    await gateway.close(p.name);
    const heartbeat = setInterval(progress, 20_000);
    try {
        return await openLoginWindow(p.dir, { name: p.name, sites: p.sites });
    }
    finally {
        clearInterval(heartbeat);
    }
}
function loginReport(p, r) {
    const lines = [
        r.timedOut
            ? `The login window for "${p.name}" was open too long and cast closed it. Logins made so far are kept.`
            : `The user closed the login window for "${p.name}".`,
        `Suggested sites (where the user landed${p.sites.length ? ', not saved yet' : ''}): ${r.sites.join(', ') || '(none)'}`,
        `Sign-in pages and redirects (not suggested; Claude never logs in itself): ${r.signIn.join(', ') || '(none)'}`,
        `Currently saved sites: ${p.sites.join(', ') || '(none)'}`,
        'Show the suggested sites and ask which to keep (the user may also name the app they logged in to), then call cast_set_sites with the full list.',
    ];
    if (r.landings.length) {
        lines.push('Last page the user saw on each site (the path and title often tell the role):');
        for (const l of r.landings)
            lines.push(`- ${l.url}${l.title ? ` — "${l.title}"` : ''}`);
    }
    lines.push(p.description
        ? `Saved description: "${p.description}".`
        : 'The profile has no description, so Claude cannot tell who this person is. In the same message, ask who this person is in the tests, '
            + 'suggesting a short description from the pages above if they show a role (e.g. "vendor on platform-dev (/vendor)"). '
            + 'Call cast_update only with what the user answered or confirmed; if they decline, save nothing.');
    return lines.join('\n');
}
export function gatewayProfile(paths, p) {
    return { name: p.name, dir: p.dir, outputDir: outputDir(paths, p.name) };
}
function str(args, key) {
    const v = args[key];
    if (typeof v !== 'string' || !v)
        throw new RegistryError(`Missing "${key}".`);
    return v;
}
/** A string argument as given, including "" (which clears a field); undefined when absent. */
function rawStr(args, key) {
    const v = args[key];
    if (v === undefined)
        return undefined;
    if (typeof v !== 'string')
        throw new RegistryError(`"${key}" must be a string.`);
    return v;
}
function optStr(args, key) {
    const v = args[key];
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
function ok(text) {
    return { content: [{ type: 'text', text }] };
}
function fail(text) {
    return { content: [{ type: 'text', text }], isError: true };
}
async function main() {
    const gateway = new Gateway();
    const server = createServer(resolvePaths(), gateway);
    let stopping = false;
    const stop = async () => {
        if (stopping)
            return;
        stopping = true;
        await gateway.closeAll().catch(() => { });
        process.exit(0);
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
    process.stdin.on('end', stop);
    server.onclose = stop;
    await server.connect(new StdioServerTransport());
}
main().catch(e => {
    console.error(e);
    process.exit(1);
});
