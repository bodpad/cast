import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
/**
 * Everything lives in the plugin's data folder (`~/.claude/plugins/data/cast-<marketplace>/`), so profiles
 * belong to one Claude account and `/plugin uninstall` deletes them. CAST_CONFIG_DIR and CAST_DATA_DIR override it.
 */
export function resolvePaths(env = process.env) {
    const projectDir = realpathOrSelf(resolve(expanded(env.CAST_PROJECT_DIR) || expanded(env.CLAUDE_PROJECT_DIR) || process.cwd()));
    const pluginData = expanded(env.CLAUDE_PLUGIN_DATA);
    const configDir = env.CAST_CONFIG_DIR || (pluginData && join(pluginData, 'config'));
    const dataDir = env.CAST_DATA_DIR || (pluginData && join(pluginData, 'data'));
    if (!configDir || !dataDir) {
        throw new Error('CLAUDE_PLUGIN_DATA is not set: run cast as a Claude Code plugin, or set CAST_CONFIG_DIR and CAST_DATA_DIR');
    }
    const snapDir = env.CAST_DATA_DIR ? join(env.CAST_DATA_DIR, 'snap') : join(homedir(), 'snap');
    const snapAccount = env.CAST_DATA_DIR || !pluginData ? '' : accountIdFor(pluginData);
    return { projectDir, projectId: projectIdFor(projectDir), configDir, dataDir, snapDir, snapAccount };
}
/**
 * The Claude Code config folder's name without the dot: "claude" for ~/.claude, "claude-work" for ~/.claude-work.
 * Readable, so people can find the folder, and the same for every install source.
 */
export function accountIdFor(pluginData) {
    return basename(resolve(pluginData, '..', '..', '..')).replace(/^\.+/, '').replace(/[^A-Za-z0-9_-]/g, '_') || 'claude';
}
/** Readable and stable: "<folder>-<8 hex of the real path>". */
export function projectIdFor(projectDir) {
    const hash = createHash('sha256').update(projectDir).digest('hex').slice(0, 8);
    const name = basename(projectDir).replace(/[^A-Za-z0-9_-]/g, '_') || 'root';
    return `${name}-${hash}`;
}
export function listFile(paths, scope) {
    switch (scope) {
        case 'user': return join(paths.configDir, 'profiles.yaml');
        case 'local': return join(paths.configDir, 'projects', `${paths.projectId}.yaml`);
        case 'project': return join(paths.projectDir, '.claude', 'claude-cast.yaml');
    }
}
/**
 * Project slots are filled per developer, so their Chrome data lives next to local profiles. `browser`
 * is the id the profile records ("snap:chromium" puts it where that snap can write).
 */
export function profileDir(paths, scope, name, browser) {
    const key = name.toLowerCase();
    const root = browser?.startsWith('snap:')
        ? join(paths.snapDir, browser.slice(5), 'common', 'claude-cast', paths.snapAccount)
        : paths.dataDir;
    return scope === 'user'
        ? join(root, 'user', key)
        : join(root, 'projects', paths.projectId, key);
}
export function outputDir(paths, name) {
    return join(paths.dataDir, 'output', paths.projectId, name.toLowerCase());
}
/** Chrome profiles hold live sessions: keep them readable by the owner only (on Windows, AppData is already private to the user). */
export function ensurePrivateDir(dir) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    return dir;
}
/** Ignores a "${VAR}" placeholder that the host left unexpanded in the MCP server config. */
function expanded(value) {
    return value && !value.includes('${') ? value : undefined;
}
function realpathOrSelf(p) {
    try {
        return realpathSync(p);
    }
    catch {
        return p;
    }
}
