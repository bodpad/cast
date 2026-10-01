import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import { listFile, profileDir } from './paths.js';
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const personalEntry = z.object({
    email: z.string().optional(),
    description: z.string().optional(),
    sites: z.array(z.string()).default([]),
    createdAt: z.string().optional(),
    lastLoginAt: z.string().optional(),
    /** When the last user window opened; the login is finished once lastLoginAt is later. */
    loginStartedAt: z.string().optional(),
    /** Window color, e.g. "#1e88e5", so people tell the windows apart. */
    color: z.string().optional(),
    /** The browser the profile was made with (see browsers.ts); absent in profiles made with Google Chrome before 0.8.0. */
    browser: z.string().optional(),
});
const slotEntry = z.object({ description: z.string().optional() });
const personalFile = z.object({ version: z.literal(1).default(1), profiles: z.record(z.string(), personalEntry).default({}) });
const projectFile = z.object({ version: z.literal(1).default(1), profiles: z.record(z.string(), slotEntry).default({}) });
/** Distinct hues first: two or three profiles open side by side get clearly different windows. */
export const PROFILE_COLORS = ['#1e88e5', '#e53935', '#43a047', '#8e24aa', '#fb8c00', '#00897b', '#d81b60', '#fdd835'];
export class RegistryError extends Error {
}
export function validateName(name) {
    if (!NAME_RE.test(name)) {
        throw new RegistryError(`Invalid profile name "${name}": use letters, digits, "-" or "_" (up to 40 characters).`);
    }
    return name;
}
export function loadProfiles(paths) {
    const user = readPersonal(paths, 'user');
    const local = readPersonal(paths, 'local');
    const project = readProject(paths);
    const byKey = new Map();
    const personal = (scope, name, e) => ({
        name, scope, email: e.email, description: e.description, sites: e.sites, ready: true,
        dir: profileDir(paths, scope, name, e.browser), createdAt: e.createdAt, lastLoginAt: e.lastLoginAt, loginStartedAt: e.loginStartedAt,
        color: e.color, browser: e.browser,
    });
    // Lowest precedence first; later writes win: user < project < local.
    for (const [name, e] of Object.entries(user.profiles))
        byKey.set(name.toLowerCase(), personal('user', name, e));
    for (const [name, slot] of Object.entries(project.profiles)) {
        byKey.set(name.toLowerCase(), {
            name, scope: 'project', description: slot.description, sites: [], ready: false, dir: profileDir(paths, 'project', name),
        });
    }
    for (const [name, e] of Object.entries(local.profiles)) {
        const slot = findKey(project.profiles, name);
        if (slot) {
            // The developer's own login for a team slot.
            const p = personal('project', slot, e);
            p.description = e.description || project.profiles[slot].description;
            byKey.set(name.toLowerCase(), p);
        }
        else {
            byKey.set(name.toLowerCase(), personal('local', name, e));
        }
    }
    return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export function findProfile(paths, name) {
    return loadProfiles(paths).find(p => p.name.toLowerCase() === name.toLowerCase());
}
/**
 * Registers a profile before its first login. For scope "project" the slot (name + description)
 * goes to the committed .claude/cast.yaml and the personal part to the developer's local list.
 */
export function addProfile(paths, name, scope, input) {
    validateName(name);
    const existing = findProfile(paths, name);
    if (existing?.ready) {
        throw new RegistryError(`Profile "${existing.name}" already exists (${existing.scope}). Use /cast:open ${existing.name} to log in again.`);
    }
    if (existing && !existing.ready)
        scope = 'project';
    const now = new Date().toISOString();
    const entry = {
        email: input.email || undefined, description: input.description || undefined, sites: [], createdAt: now, color: nextColor(paths),
        browser: input.browser,
    };
    if (scope === 'project') {
        const project = readProject(paths);
        const slotName = findKey(project.profiles, name) ?? name;
        if (!project.profiles[slotName])
            project.profiles[slotName] = { description: input.description || undefined };
        writeYaml(listFile(paths, 'project'), project);
        // The slot already carries the shared description.
        updatePersonal(paths, 'local', f => { f.profiles[slotName] = { ...entry, description: undefined }; });
    }
    else {
        updatePersonal(paths, scope, f => { f.profiles[name] = entry; });
    }
    return findProfile(paths, name);
}
/** Updates the personal part (email, sites, timestamps) wherever this developer keeps it. */
export function updateProfile(paths, name, patch) {
    const p = requireReady(paths, name);
    const scope = p.scope === 'user' ? 'user' : 'local';
    updatePersonal(paths, scope, f => {
        const key = findKey(f.profiles, p.name);
        f.profiles[key] = { ...f.profiles[key], ...stripUndefined(patch) };
    });
    return findProfile(paths, name);
}
/** Gives a profile made before colors existed its own window color. */
export function ensureColor(paths, name) {
    const p = requireReady(paths, name);
    return p.color ? p : updateProfile(paths, name, { color: nextColor(paths) });
}
/** The first color no other profile uses; after that, the least used one. */
function nextColor(paths) {
    const used = loadProfiles(paths).map(p => p.color);
    const count = (c) => used.filter(u => u === c).length;
    return PROFILE_COLORS.reduce((best, c) => count(c) < count(best) ? c : best);
}
/**
 * Sets the email and description the user gave; an empty string clears the field. For a project
 * profile the description is kept in the developer's local list; the team slot is not changed.
 */
export function editProfile(paths, name, fields) {
    const p = requireReady(paths, name);
    const scope = p.scope === 'user' ? 'user' : 'local';
    updatePersonal(paths, scope, f => {
        const e = f.profiles[findKey(f.profiles, p.name)];
        for (const k of ['email', 'description']) {
            const v = fields[k]?.trim();
            if (v)
                e[k] = v;
            else if (v !== undefined)
                delete e[k];
        }
    });
    return findProfile(paths, name);
}
/** The description of a team slot in .claude/cast.yaml, if it has one. */
export function slotDescription(paths, name) {
    const project = readProject(paths);
    const key = findKey(project.profiles, name);
    return key ? project.profiles[key].description || undefined : undefined;
}
/** Forgets this developer's login. A project slot itself stays in .claude/cast.yaml for the team. */
export function removeProfile(paths, name) {
    const p = findProfile(paths, name);
    if (!p)
        throw new RegistryError(`No profile named "${name}".`);
    if (!p.ready)
        throw new RegistryError(`"${p.name}" is a project slot you have not logged in to; remove it from .claude/cast.yaml instead.`);
    const scope = p.scope === 'user' ? 'user' : 'local';
    updatePersonal(paths, scope, f => { delete f.profiles[findKey(f.profiles, p.name)]; });
    return p;
}
export function requireReady(paths, name) {
    const p = findProfile(paths, name);
    if (!p)
        throw new RegistryError(`No profile named "${name}". Ask the user to run /cast:add ${name}.`);
    if (!p.ready)
        throw new RegistryError(`Profile "${p.name}" is not set up on this machine yet. Ask the user to run /cast:add ${p.name}.`);
    return p;
}
function readPersonal(paths, scope) {
    return parse(listFile(paths, scope), personalFile);
}
function readProject(paths) {
    return parse(listFile(paths, 'project'), projectFile);
}
function parse(file, schema) {
    if (!existsSync(file))
        return schema.parse({});
    let raw;
    try {
        raw = YAML.parse(readFileSync(file, 'utf8')) ?? {};
    }
    catch (e) {
        throw new RegistryError(`Cannot read ${file}: ${e.message}`);
    }
    const r = schema.safeParse(raw);
    if (!r.success)
        throw new RegistryError(`Invalid ${file}: ${z.prettifyError(r.error)}`);
    return r.data;
}
function updatePersonal(paths, scope, fn) {
    const f = readPersonal(paths, scope);
    fn(f);
    writeYaml(listFile(paths, scope), f);
}
function writeYaml(file, data) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, YAML.stringify(stripUndefined(data)));
}
function findKey(record, name) {
    return Object.keys(record).find(k => k.toLowerCase() === name.toLowerCase());
}
function stripUndefined(v) {
    return JSON.parse(JSON.stringify(v));
}
