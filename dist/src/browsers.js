import { closeSync, existsSync, openSync, readSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
export class BrowserError extends Error {
}
export function systemProbe() {
    return {
        platform: process.platform,
        env: process.env,
        home: homedir(),
        exists: existsSync,
        realpath: p => { try {
            return realpathSync(p);
        }
        catch {
            return p;
        } },
        head: p => { try {
            return readHead(p, 4096);
        }
        catch {
            return '';
        } },
    };
}
/** The first bytes of a file: reading a whole browser executable would cost hundreds of MB. */
function readHead(path, size) {
    const fd = openSync(path, 'r');
    try {
        const buf = Buffer.alloc(size);
        return buf.toString('latin1', 0, readSync(fd, buf, 0, size, 0));
    }
    finally {
        closeSync(fd);
    }
}
/** In order of preference. Google Chrome is what most sites and SSO providers test with. */
const KINDS = [
    {
        id: 'chrome', name: 'Google Chrome', linux: ['/opt/google/chrome/chrome'], commands: ['google-chrome-stable', 'google-chrome'],
        snaps: [], mac: ['Google Chrome', 'Google Chrome'], flatpak: 'com.google.Chrome', win: 'Google\\Chrome\\Application\\chrome.exe',
    },
    {
        id: 'edge', name: 'Microsoft Edge', linux: ['/opt/microsoft/msedge/msedge'], commands: ['microsoft-edge-stable', 'microsoft-edge'],
        snaps: [], mac: ['Microsoft Edge', 'Microsoft Edge'], flatpak: 'com.microsoft.Edge', win: 'Microsoft\\Edge\\Application\\msedge.exe',
    },
    {
        id: 'brave', name: 'Brave', linux: ['/opt/brave.com/brave/brave'], commands: ['brave-browser', 'brave'],
        snaps: ['brave'], mac: ['Brave Browser', 'Brave Browser'], flatpak: 'com.brave.Browser', win: 'BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    },
    {
        id: 'chromium', name: 'Chromium',
        linux: ['/usr/lib/chromium/chromium', '/usr/lib64/chromium-browser/chromium-browser', '/usr/lib/chromium-browser/chromium-browser'],
        commands: ['chromium', 'chromium-browser'], snaps: ['chromium'], mac: ['Chromium', 'Chromium'], flatpak: 'org.chromium.Chromium', win: 'Chromium\\Application\\chrome.exe',
    },
    {
        id: 'vivaldi', name: 'Vivaldi', linux: ['/opt/vivaldi/vivaldi'], commands: ['vivaldi-stable', 'vivaldi'],
        snaps: ['vivaldi'], mac: ['Vivaldi', 'Vivaldi'], flatpak: 'com.vivaldi.Vivaldi', win: 'Vivaldi\\Application\\vivaldi.exe',
    },
];
/**
 * The Chromium browsers installed here, preferred first: per kind a native install, then a snap.
 * Flatpak installs are left out (see browserNotFound).
 */
export function findBrowsers(probe = systemProbe()) {
    const found = [];
    const add = (b) => { if (!found.some(f => f.id === b.id))
        found.push(b); };
    for (const kind of KINDS) {
        if (probe.platform === 'win32') {
            if (!kind.win)
                continue;
            for (const root of windowsRoots(probe)) {
                const path = win32.join(root, kind.win);
                if (probe.exists(path)) {
                    add({ id: kind.id, name: kind.name, executable: path });
                    break;
                }
            }
        }
        else if (probe.platform === 'darwin') {
            if (!kind.mac)
                continue;
            const [app, exe] = kind.mac;
            for (const root of [posix.join(probe.home, 'Applications'), '/Applications']) {
                const path = posix.join(root, `${app}.app`, 'Contents', 'MacOS', exe);
                if (probe.exists(path)) {
                    add({ id: kind.id, name: kind.name, executable: path });
                    break;
                }
            }
        }
        else if (probe.platform === 'linux') {
            const candidates = [...kind.linux, ...kind.commands.flatMap(c => inPath(probe, c))];
            for (const path of candidates) {
                const b = linuxBrowser(probe, path, kind);
                if (b)
                    add(b);
            }
            for (const snap of kind.snaps) {
                const path = `/snap/bin/${snap}`;
                if (probe.exists(path))
                    add(snapBrowser(kind, snap, path));
            }
        }
    }
    // Native installs of every kind before any snap: a snap keeps its profiles apart from the others.
    return [...found.filter(b => !b.snap), ...found.filter(b => b.snap)];
}
/** A path that exists, as a native browser or the snap it starts. */
function linuxBrowser(probe, path, kind) {
    if (!probe.exists(path))
        return undefined;
    const snap = snapOf(probe, path);
    if (snap)
        return snapBrowser(kind, snap, `/snap/bin/${snap}`);
    return { id: kind.id, name: kind.name, executable: path };
}
/**
 * The snap behind a path: /snap/bin/<name> links to /usr/bin/snap, and Ubuntu's /usr/bin/chromium-browser
 * is a script that runs /snap/bin/chromium.
 */
function snapOf(probe, path) {
    if (path.startsWith('/snap/bin/'))
        return posix.basename(path);
    const real = probe.realpath(path);
    if (real.startsWith('/snap/'))
        return real.split('/')[2];
    if (posix.basename(real) === 'snap')
        return posix.basename(path);
    const head = probe.head(path);
    if (head.startsWith('#!'))
        return /\/snap\/bin\/([a-z0-9-]+)/.exec(head)?.[1];
    return undefined;
}
function snapBrowser(kind, snap, executable) {
    return { id: `snap:${snap}`, name: `${kind.name} (snap)`, executable, snap };
}
/** System-wide installs first, then per-user ones (Chrome installs to AppData\\Local without admin rights). */
function windowsRoots(probe) {
    return [probe.env.ProgramFiles, probe.env['ProgramFiles(x86)'], probe.env.LOCALAPPDATA].filter((r) => !!r);
}
function inPath(probe, command) {
    return (probe.env.PATH ?? '').split(posix.delimiter).filter(Boolean).map(dir => posix.join(dir, command));
}
/** CAST_CHROME: any Chromium browser the user points at; a snap is recognized so its profiles go to ~/snap. */
function customBrowser(probe, path) {
    const snap = probe.platform === 'linux' && probe.exists(path) ? snapOf(probe, path) : undefined;
    if (snap)
        return { id: `snap:${snap}`, name: browserName(`snap:${snap}`), executable: path, snap };
    return { id: 'custom', name: 'the browser in CAST_CHROME', executable: path };
}
/**
 * The browser for a profile: CAST_CHROME when set, else the one the profile was made with (cookies are
 * encrypted per browser on macOS, and an older browser cannot open a newer one's profile), else the
 * preferred one installed.
 */
export function pickBrowser(opts = {}, probe = systemProbe()) {
    if (probe.env.CAST_CHROME)
        return customBrowser(probe, probe.env.CAST_CHROME);
    const found = findBrowsers(probe);
    if (opts.pinned && opts.pinned !== 'custom') {
        const b = found.find(f => f.id === opts.pinned);
        if (b)
            return b;
        throw new BrowserError(`This profile was made with ${browserName(opts.pinned)}, which is no longer found. Install it again, or set CAST_CHROME to its path; or start over with /cast:remove and /cast:add.`);
    }
    const usable = opts.legacy ? found.filter(b => !b.snap) : found;
    const b = (opts.legacy && usable.find(f => f.id === 'chrome')) || usable[0];
    if (b)
        return b;
    throw browserNotFound(probe, found);
}
/** Why no browser fits, with what to do. */
export function browserNotFound(probe = systemProbe(), found = []) {
    if (found.length) {
        return new BrowserError(`This profile was made with Google Chrome, which is not found; only ${found.map(b => b.name).join(', ')} is installed, which keeps its profiles elsewhere. Install Google Chrome, or start over with /cast:remove and /cast:add.`);
    }
    const install = probe.platform === 'linux'
        ? 'Install Google Chrome from https://www.google.com/chrome/ (the .deb or .rpm package)'
        : 'Install Google Chrome from https://www.google.com/chrome/';
    const flatpaks = KINDS.filter(k => flatpakInstalled(probe, k.flatpak)).map(k => k.name);
    if (flatpaks.length) {
        return new BrowserError(`Only a Flatpak ${flatpaks.join(', ')} is installed, which cast cannot run: its sandbox hides the process and the profile folder. ${install}, or set CAST_CHROME to another Chromium browser.`);
    }
    const other = firefoxInstalled(probe) ? 'Firefox is not supported: cast needs a Chromium browser (Chrome, Edge, Brave, Chromium or Vivaldi). ' : '';
    return new BrowserError(`No Chromium browser found. ${other}${install}, or set CAST_CHROME to the path of Chrome, Edge, Brave, Chromium or Vivaldi.`);
}
function flatpakInstalled(probe, id) {
    return probe.platform === 'linux'
        && (probe.exists(`/var/lib/flatpak/app/${id}`) || probe.exists(posix.join(probe.home, '.local/share/flatpak/app', id)));
}
function firefoxInstalled(probe) {
    if (probe.platform === 'win32')
        return windowsRoots(probe).some(r => probe.exists(win32.join(r, 'Mozilla Firefox', 'firefox.exe')));
    if (probe.platform === 'darwin')
        return probe.exists('/Applications/Firefox.app') || probe.exists(posix.join(probe.home, 'Applications/Firefox.app'));
    return ['/usr/bin/firefox', '/snap/bin/firefox', '/usr/lib/firefox/firefox'].some(p => probe.exists(p)) || flatpakInstalled(probe, 'org.mozilla.firefox');
}
/** "brave" → "Brave", "snap:chromium" → "Chromium (snap)". */
export function browserName(id) {
    if (id === 'custom')
        return 'the browser in CAST_CHROME';
    const snap = id.startsWith('snap:') ? id.slice(5) : undefined;
    const kind = KINDS.find(k => k.id === id || (snap && k.snaps.includes(snap)));
    if (!kind)
        return snap ? `${snap} (snap)` : id;
    return snap ? `${kind.name} (snap)` : kind.name;
}
