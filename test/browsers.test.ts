import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { BrowserError, type Probe, browserName, findBrowsers, pickBrowser } from '../src/browsers.js';

/** A system with these files; `links` maps a path to its real path, `scripts` a path to its first bytes. */
function probe(platform: NodeJS.Platform, files: string[], opts: { links?: Record<string, string>; scripts?: Record<string, string>; env?: NodeJS.ProcessEnv } = {}): Probe {
  const all = new Set([...files, ...Object.keys(opts.links ?? {}), ...Object.keys(opts.scripts ?? {})]);
  return {
    platform,
    env: { PATH: '/usr/local/bin:/usr/bin', ...opts.env },
    home: '/home/me',
    exists: p => all.has(p),
    realpath: p => opts.links?.[p] ?? p,
    head: p => opts.scripts?.[p] ?? '\x7fELF',
  };
}

const ids = (p: Probe) => findBrowsers(p).map(b => b.id);

describe('browser discovery', () => {
  test('Linux: Google Chrome first, then Edge, Brave, Chromium, Vivaldi', () => {
    const p = probe('linux', ['/opt/vivaldi/vivaldi', '/usr/lib/chromium/chromium', '/opt/brave.com/brave/brave', '/opt/microsoft/msedge/msedge', '/opt/google/chrome/chrome']);
    assert.deepEqual(ids(p), ['chrome', 'edge', 'brave', 'chromium', 'vivaldi']);
    assert.equal(pickBrowser({}, p).executable, '/opt/google/chrome/chrome');
  });

  test('Linux: commands in PATH', () => {
    const p = probe('linux', ['/usr/bin/google-chrome-stable']);
    assert.deepEqual(findBrowsers(p), [{ id: 'chrome', name: 'Google Chrome', executable: '/usr/bin/google-chrome-stable' }]);
  });

  test('Linux: a snap, also behind a link or Ubuntu\'s wrapper script, comes after native installs', () => {
    const wrapper = probe('linux', ['/usr/bin/brave-browser'], {
      scripts: { '/usr/bin/chromium-browser': '#!/bin/sh\nexec /snap/bin/chromium "$@"\n' },
    });
    assert.deepEqual(findBrowsers(wrapper), [
      { id: 'brave', name: 'Brave', executable: '/usr/bin/brave-browser' },
      { id: 'snap:chromium', name: 'Chromium (snap)', executable: '/snap/bin/chromium', snap: 'chromium' },
    ]);
    const link = probe('linux', [], { links: { '/snap/bin/chromium': '/usr/bin/snap', '/usr/bin/chromium': '/usr/bin/snap' } });
    assert.deepEqual(ids(link), ['snap:chromium']);
  });

  test('Linux: one entry per browser', () => {
    const p = probe('linux', ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable']);
    assert.deepEqual(ids(p), ['chrome']);
  });

  test('macOS: ~/Applications before /Applications', () => {
    const user = '/home/me/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const p = probe('darwin', [user, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']);
    assert.deepEqual(findBrowsers(p).map(b => b.executable), [user, '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']);
  });

  test('Windows: Program Files, then the per-user install; Edge when Chrome is missing', () => {
    const env = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' };
    const userChrome = 'C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
    const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    assert.deepEqual(findBrowsers(probe('win32', [userChrome, edge], { env })).map(b => b.executable), [userChrome, edge]);
    assert.equal(pickBrowser({}, probe('win32', [edge], { env })).id, 'edge');
    assert.match(
      (() => { try { pickBrowser({}, probe('win32', ['C:\\Program Files\\Mozilla Firefox\\firefox.exe'], { env })); } catch (e) { return (e as Error).message; } })()!,
      /Firefox is not supported.*Install Google Chrome from https:\/\/www\.google\.com\/chrome\/,/,
    );
  });

  test('CAST_CHROME wins, and a snap there is recognized', () => {
    const p = probe('linux', ['/opt/google/chrome/chrome', '/opt/x/chrome'], { env: { CAST_CHROME: '/opt/x/chrome' } });
    assert.deepEqual(pickBrowser({ pinned: 'chrome' }, p), { id: 'custom', name: 'the browser in CAST_CHROME', executable: '/opt/x/chrome' });
    const snap = probe('linux', ['/snap/bin/chromium'], { env: { CAST_CHROME: '/snap/bin/chromium' } });
    assert.equal(pickBrowser({}, snap).id, 'snap:chromium');
  });
});

describe('browser of a profile', () => {
  const both = probe('linux', ['/opt/google/chrome/chrome', '/opt/brave.com/brave/brave', '/snap/bin/chromium']);

  test('the browser a profile was made with', () => {
    assert.equal(pickBrowser({ pinned: 'brave' }, both).id, 'brave');
    assert.equal(pickBrowser({ pinned: 'snap:chromium' }, both).id, 'snap:chromium');
    assert.throws(() => pickBrowser({ pinned: 'edge' }, both), /made with Microsoft Edge, which is no longer found.*\/cast:remove/);
  });

  test('a profile from before 0.8.0 was made with Google Chrome, never with a snap', () => {
    assert.equal(pickBrowser({ legacy: true }, both).id, 'chrome');
    assert.equal(pickBrowser({ legacy: true }, probe('linux', ['/opt/brave.com/brave/brave'])).id, 'brave');
    assert.throws(() => pickBrowser({ legacy: true }, probe('linux', ['/snap/bin/chromium'])), /made with Google Chrome.*Chromium \(snap\)/);
  });

  test('a new profile may use a snap when that is all there is', () => {
    assert.equal(pickBrowser({}, probe('linux', ['/snap/bin/chromium'])).id, 'snap:chromium');
  });
});

describe('no browser found', () => {
  const error = (p: Probe) => { try { pickBrowser({}, p); } catch (e) { assert.ok(e instanceof BrowserError); return e.message; } assert.fail('no error'); };

  test('says what to install', () => {
    assert.match(error(probe('linux', [])), /No Chromium browser found\. Install Google Chrome .*\.deb or \.rpm.*CAST_CHROME/);
    assert.match(error(probe('darwin', [])), /No Chromium browser found\. Install Google Chrome from https:\/\/www\.google\.com\/chrome\//);
  });

  test('a Flatpak browser is named but not used', () => {
    assert.match(error(probe('linux', ['/var/lib/flatpak/app/com.google.Chrome'])), /Only a Flatpak Google Chrome is installed, which cast cannot run/);
    assert.match(error(probe('linux', ['/home/me/.local/share/flatpak/app/com.brave.Browser'])), /Flatpak Brave/);
  });

  test('Firefox is explained', () => {
    assert.match(error(probe('linux', ['/usr/bin/firefox'])), /Firefox is not supported: cast needs a Chromium browser/);
  });

  test('names', () => {
    assert.equal(browserName('brave'), 'Brave');
    assert.equal(browserName('snap:chromium'), 'Chromium (snap)');
    assert.equal(browserName('snap:other'), 'other (snap)');
  });
});
