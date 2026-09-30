import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { briefList } from '../src/format.js';
import { normalizeSite, pageUrl } from '../src/login-window.js';
import { classifyHosts, isSignInHost } from '../src/sites.js';
import { ensurePrivateDir, listFile, projectIdFor, resolvePaths } from '../src/paths.js';
import {
  RegistryError, addProfile, editProfile, findProfile, loadProfiles, removeProfile, updateProfile, validateName,
} from '../src/registry.js';
import { type Sandbox, sandbox } from './helpers.js';

let sb: Sandbox;
beforeEach(() => { sb = sandbox(); });
afterEach(() => sb.cleanup());

describe('paths', () => {
  test('project id is stable and readable', () => {
    assert.equal(projectIdFor('/home/me/my app'), projectIdFor('/home/me/my app'));
    assert.match(projectIdFor('/home/me/my app'), /^my_app-[0-9a-f]{8}$/);
    assert.notEqual(projectIdFor('/a/app'), projectIdFor('/b/app'));
  });

  test('project dir: CAST_PROJECT_DIR, then CLAUDE_PROJECT_DIR, then cwd', () => {
    assert.equal(resolvePaths({ CAST_PROJECT_DIR: '/x', CLAUDE_PROJECT_DIR: '/y' }).projectDir, '/x');
    assert.equal(resolvePaths({ CLAUDE_PROJECT_DIR: '/y' }).projectDir, '/y');
    assert.equal(resolvePaths({ CAST_PROJECT_DIR: '${CLAUDE_PROJECT_DIR}', CLAUDE_PROJECT_DIR: '/y' }).projectDir, '/y');
  });

  test('XDG dirs are honoured', () => {
    const p = resolvePaths({ XDG_CONFIG_HOME: '/c', XDG_DATA_HOME: '/d' });
    assert.equal(p.configDir, '/c/cast');
    assert.equal(p.dataDir, '/d/cast');
  });

  test('profile dirs are private (0700)', () => {
    const dir = join(sb.root, 'p');
    mkdirSync(dir, { mode: 0o755 });
    ensurePrivateDir(dir);
    assert.equal(statSync(dir).mode & 0o777, 0o700);
    const nested = ensurePrivateDir(join(sb.root, 'a', 'b'));
    assert.equal(statSync(nested).mode & 0o777, 0o700);
  });
});

describe('registry', () => {
  test('validates names', () => {
    for (const ok of ['Sam', 'elon_2', 'a-b']) assert.equal(validateName(ok), ok);
    for (const bad of ['', '-x', 'a b', 'x/y', 'a'.repeat(41)]) assert.throws(() => validateName(bad), RegistryError);
  });

  test('adds a local profile by default and finds it case-insensitively', () => {
    addProfile(sb.paths, 'Sam', 'local', { email: 'sam@email.com', description: 'sender' });
    const p = findProfile(sb.paths, 'sam')!;
    assert.equal(p.name, 'Sam');
    assert.equal(p.scope, 'local');
    assert.equal(p.email, 'sam@email.com');
    assert.equal(p.ready, true);
    assert.ok(p.dir.includes(sb.paths.projectId));
  });

  test('refuses duplicates regardless of case', () => {
    addProfile(sb.paths, 'Sam', 'local', {});
    assert.throws(() => addProfile(sb.paths, 'SAM', 'user', {}), /already exists/);
  });

  test('precedence: local > project > user', () => {
    addProfile(sb.paths, 'Sam', 'user', { description: 'from user' });
    writeProjectSlots({ sam: { description: 'from project' } });
    assert.equal(findProfile(sb.paths, 'Sam')!.scope, 'project');
    assert.equal(findProfile(sb.paths, 'Sam')!.ready, false);

    mkdirSync(join(sb.paths.configDir, 'projects'), { recursive: true });
    writeFileSync(listFile(sb.paths, 'local'), 'profiles:\n  SAM:\n    description: mine\n');
    const p = findProfile(sb.paths, 'Sam')!;
    // A local entry with the slot's name fills the project slot.
    assert.equal(p.scope, 'project');
    assert.equal(p.ready, true);
    assert.equal(p.description, 'mine');
    assert.equal(loadProfiles(sb.paths).length, 1);
  });

  test('user profiles are shared across projects', () => {
    addProfile(sb.paths, 'Elon', 'user', {});
    const other = resolvePaths({ ...sb.env, CAST_PROJECT_DIR: join(sb.root, 'other') });
    assert.equal(findProfile(other, 'Elon')?.scope, 'user');
    assert.equal(findProfile(other, 'Elon')?.dir, findProfile(sb.paths, 'Elon')?.dir);
  });

  test('project slot: committed file has no personal data, developer fills it locally', () => {
    writeProjectSlots({ sender: { description: 'writes messages' } });
    const slot = findProfile(sb.paths, 'Sender')!;
    assert.equal(slot.ready, false);
    assert.match(briefList(loadProfiles(sb.paths)), /NOT set up on this machine: ask the user to run \/cast:add sender/);

    // /cast:add fills the slot even when the default scope is asked for.
    const p = addProfile(sb.paths, 'Sender', 'local', { email: 'me@corp.com' });
    assert.equal(p.scope, 'project');
    assert.equal(p.ready, true);
    assert.equal(p.name, 'sender');
    assert.equal(p.description, 'writes messages');
    assert.doesNotMatch(readFileSync(listFile(sb.paths, 'project'), 'utf8'), /me@corp\.com/);
    assert.match(readFileSync(listFile(sb.paths, 'local'), 'utf8'), /me@corp\.com/);

    updateProfile(sb.paths, 'SENDER', { sites: ['localhost:3000'] });
    assert.deepEqual(findProfile(sb.paths, 'sender')!.sites, ['localhost:3000']);

    removeProfile(sb.paths, 'sender');
    assert.equal(findProfile(sb.paths, 'sender')!.ready, false, 'the team slot stays');
  });

  test('new project slot writes .claude/cast.yaml', () => {
    addProfile(sb.paths, 'Admin', 'project', { email: 'a@b.c', description: 'admin user' });
    const committed = readFileSync(listFile(sb.paths, 'project'), 'utf8');
    assert.match(committed, /Admin/);
    assert.match(committed, /admin user/);
    assert.doesNotMatch(committed, /a@b\.c/);
  });

  test('update and remove act on the right scope', () => {
    addProfile(sb.paths, 'Elon', 'user', {});
    updateProfile(sb.paths, 'elon', { sites: ['outlook.office.com'], email: 'e@x.com' });
    assert.deepEqual(findProfile(sb.paths, 'Elon')!.sites, ['outlook.office.com']);
    removeProfile(sb.paths, 'ELON');
    assert.equal(findProfile(sb.paths, 'Elon'), undefined);
    assert.throws(() => removeProfile(sb.paths, 'Elon'), /No profile/);
  });

  test('edit sets and clears email and description, keeping the rest', () => {
    addProfile(sb.paths, 'Ali', 'local', { email: 'a@x.com' });
    updateProfile(sb.paths, 'Ali', { sites: ['app.example.com'] });
    const p = editProfile(sb.paths, 'ali', { description: '  vendor, Insygna org ' });
    assert.equal(p.description, 'vendor, Insygna org');
    assert.equal(p.email, 'a@x.com');
    assert.deepEqual(p.sites, ['app.example.com']);
    assert.equal(editProfile(sb.paths, 'Ali', { email: '' }).email, undefined);
    assert.throws(() => editProfile(sb.paths, 'Nobody', { description: 'x' }), /No profile/);
  });

  test('edit of a project profile keeps the team slot unchanged', () => {
    writeProjectSlots({ sender: { description: 'writes messages' } });
    addProfile(sb.paths, 'sender', 'local', {});
    assert.equal(editProfile(sb.paths, 'sender', { description: 'writes in Teams' }).description, 'writes in Teams');
    assert.match(readFileSync(listFile(sb.paths, 'project'), 'utf8'), /description: writes messages/);
    assert.equal(editProfile(sb.paths, 'sender', { description: '' }).description, 'writes messages');
  });

  test('reports broken yaml as RegistryError', () => {
    mkdirSync(join(sb.paths.configDir), { recursive: true });
    writeFileSync(listFile(sb.paths, 'user'), 'profiles: [1, 2');
    assert.throws(() => loadProfiles(sb.paths), RegistryError);
  });
});

describe('format', () => {
  test('brief list matches the hook format', () => {
    addProfile(sb.paths, 'Sam', 'local', { email: 'sam@email.com', description: 'sender' });
    updateProfile(sb.paths, 'Sam', { sites: ['localhost:3000', 'outlook.office.com'] });
    assert.equal(
      briefList(loadProfiles(sb.paths)),
      'cast: browser users available (open with cast_open / browser_* tools with profile=<name>):\n'
      + '- Sam (local) sam@email.com — sender. Sites: localhost:3000, outlook.office.com',
    );
    assert.equal(briefList([]), '');
    addProfile(sb.paths, 'Ali', 'local', {});
    assert.match(briefList(loadProfiles(sb.paths)), /- Ali \(local\) — role unknown \(no description\)\./);
  });

  test('sign-in hosts are told apart from sites', () => {
    for (const h of ['login.microsoftonline.com', 'sso.godaddy.com', 'accounts.google.com', 'acme.okta.com', 'login.live.com']) {
      assert.equal(isSignInHost(h), true, h);
    }
    for (const h of ['teams.microsoft.com', 'outlook.office.com', 'localhost:3000', 'platform-dev.example.com']) {
      assert.equal(isSignInHost(h), false, h);
    }
    assert.deepEqual(
      classifyHosts(['sso.godaddy.com', 'hop.example.com', 'app.example.com'], new Set(['sso.godaddy.com', 'app.example.com'])),
      { sites: ['app.example.com'], signIn: ['sso.godaddy.com', 'hop.example.com'] },
    );
  });

  test('sites are normalized to host[:port]', () => {
    assert.equal(normalizeSite('https://Outlook.Office.com/mail/'), 'outlook.office.com');
    assert.equal(normalizeSite('localhost:3000'), 'localhost:3000');
    assert.equal(normalizeSite('  '), undefined);
    assert.equal(pageUrl('https://App.example.com:8443/vendor/home?code=abc#x'), 'https://app.example.com:8443/vendor/home');
  });
});

function writeProjectSlots(slots: Record<string, { description?: string }>): void {
  const file = listFile(sb.paths, 'project');
  mkdirSync(join(sb.paths.projectDir, '.claude'), { recursive: true });
  const body = Object.entries(slots).map(([n, s]) => `  ${n}:\n    description: ${s.description}\n`).join('');
  writeFileSync(file, `version: 1\nprofiles:\n${body}`);
}
