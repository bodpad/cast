import { isRunning } from './chrome.js';
import { type LoginResult, readLogin } from './login-window.js';
import type { CastPaths } from './paths.js';
import { type Profile, findProfile, loadProfiles, updateProfile } from './registry.js';

/**
 * A login runs from /cast:add or /cast:login until cast has read what the human visited, which it can
 * do only after the window is closed. The window may outlive the Claude session, so any later cast
 * call (or the next session start) finishes it.
 */
export function loginPending(p: Profile): boolean {
  return !!p.loginStartedAt && !(p.lastLoginAt && p.lastLoginAt >= p.loginStartedAt);
}

/**
 * Saves the sites visited in a finished login window (without asking: /cast:edit changes them).
 * Returns undefined while the window is still open.
 */
export async function finishLogin(paths: CastPaths, name: string): Promise<Profile | undefined> {
  const p = findProfile(paths, name);
  if (!p?.ready || !loginPending(p)) return p;
  if (isRunning(p.dir)) return undefined;
  const r = await readLogin(p.dir, new Date(p.loginStartedAt!));
  const added = r.sites.filter(s => !p.sites.includes(s));
  return updateProfile(paths, p.name, { sites: [...p.sites, ...added], lastLoginAt: new Date().toISOString() });
}

/** Finishes the logins whose windows were closed, e.g. after the Claude session that opened them ended. */
export async function finishClosedLogins(paths: CastPaths): Promise<void> {
  for (const p of loadProfiles(paths)) {
    if (p.ready && loginPending(p) && !isRunning(p.dir)) await finishLogin(paths, p.name).catch(() => {});
  }
}

/** What the human visited in the last finished login window. */
export function lastLogin(p: Profile): Promise<LoginResult> {
  return readLogin(p.dir, new Date(p.loginStartedAt!), new Date(p.lastLoginAt!));
}
