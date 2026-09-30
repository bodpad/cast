import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

export type Scope = 'local' | 'project' | 'user';

/** Where cast keeps its config (profile lists) and data (Chrome user-data-dirs). */
export interface CastPaths {
  projectDir: string;
  projectId: string;
  configDir: string;
  dataDir: string;
}

export function resolvePaths(env: NodeJS.ProcessEnv = process.env): CastPaths {
  const projectDir = realpathOrSelf(resolve(expanded(env.CAST_PROJECT_DIR) || expanded(env.CLAUDE_PROJECT_DIR) || process.cwd()));
  const configDir = env.CAST_CONFIG_DIR || join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'cast');
  const dataDir = env.CAST_DATA_DIR || join(env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'cast');
  return { projectDir, projectId: projectIdFor(projectDir), configDir, dataDir };
}

/** Readable and stable: "<folder>-<8 hex of the real path>". */
export function projectIdFor(projectDir: string): string {
  const hash = createHash('sha256').update(projectDir).digest('hex').slice(0, 8);
  const name = basename(projectDir).replace(/[^A-Za-z0-9_-]/g, '_') || 'root';
  return `${name}-${hash}`;
}

export function listFile(paths: CastPaths, scope: Scope): string {
  switch (scope) {
    case 'user': return join(paths.configDir, 'profiles.yaml');
    case 'local': return join(paths.configDir, 'projects', `${paths.projectId}.yaml`);
    case 'project': return join(paths.projectDir, '.claude', 'cast.yaml');
  }
}

/** Project slots are filled per developer, so their Chrome data lives next to local profiles. */
export function profileDir(paths: CastPaths, scope: Scope, name: string): string {
  const key = name.toLowerCase();
  return scope === 'user'
    ? join(paths.dataDir, 'user', key)
    : join(paths.dataDir, 'projects', paths.projectId, key);
}

export function outputDir(paths: CastPaths, name: string): string {
  return join(paths.dataDir, 'output', paths.projectId, name.toLowerCase());
}

/** Chrome profiles hold live sessions: keep them readable by the owner only. */
export function ensurePrivateDir(dir: string): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  return dir;
}

/** Ignores a "${VAR}" placeholder that the host left unexpanded in .mcp.json. */
function expanded(value: string | undefined): string | undefined {
  return value && !value.includes('${') ? value : undefined;
}

function realpathOrSelf(p: string): string {
  try { return realpathSync(p); } catch { return p; }
}
