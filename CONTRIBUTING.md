# Contributing

## How it works

- `src/mcp.ts` — the `cast` MCP server. It exposes `cast_*` tools and all Playwright browser tools (`browser_click`, `browser_snapshot`, …) with an extra required `profile` parameter.
- `src/browsers.ts` — finds the Chromium browsers installed (Chrome, Edge, Brave, Chromium, Vivaldi; native before snap) and picks the one for a profile.
- `src/chrome.ts` — starts that browser on a profile, restoring the last session, optionally with a DevTools port.
- `src/gateway.ts` — for each open profile, starts Chrome with a DevTools port and attaches a [`@playwright/mcp`](https://github.com/microsoft/playwright-mcp) child to it (`--cdp-endpoint`); routes each `browser_*` call to it.
- `src/mac-windows.ts` — macOS only: a detached watcher that quits a cast Chrome once its last window is closed.
- `src/login-window.ts` — the `/cast:add` and `/cast:login` window: the same Chrome without a DevTools port, because a port makes SSO bot checks refuse the login. Starts it detached and reads visited hosts from the profile's History once it is closed.
- `src/logins.ts` — a login is pending from `/cast:add` or `/cast:login` until the window is closed and its sites are saved.
- `src/registry.ts`, `src/paths.ts` — profile lists in the three scopes and file locations (Windows: config in `%APPDATA%\cast`, data in `%LOCALAPPDATA%\cast`).
- `src/sites.ts` — tells sign-in hosts (Entra, Okta, `sso.…`) apart from the sites a person works on.
- `src/cli.ts`, `src/format.ts` — `list --brief`, printed by the `SessionStart` hook (`hooks/hooks.json`) so Claude knows the profiles.
- `skills/` — the `/cast:*` commands and the `cast` skill that tells Claude how to work with profiles.

## Why it is built this way

Chrome and Playwright MCP quirks found the hard way (Linux, Chrome 151 and macOS 15, Chrome 154; `@playwright/mcp` 0.0.83; Windows from documentation and CI only):

- **The login window has no DevTools port.** `--remote-debugging-port` alone makes pages see `navigator.webdriver = true`, and SSO bot checks (e.g. GoDaddy-federated Microsoft 365) refuse the login. So the login window is a plain Chrome that cast only waits on; visited sites and landing pages are read from the profile's `Default/History` (with `sql.js`) after it exits. Only headless tests (`CAST_TEST_HEADLESS=1`) add a port to play the human.
- **Stop Chrome with `SIGINT`.** Closing the window, `SIGINT` and `SIGHUP` flush History (committed every ~10 s) and cookies (~30 s); `SIGTERM` loses them. Windows has no signals: Node's `kill()` is `TerminateProcess`, which loses them too. There `Chrome.close()` sends CDP `Browser.close` when Chrome has a DevTools port, else `taskkill /PID` without `/F`, which posts `WM_CLOSE` to its windows like the close button; a forced `taskkill /F /T` comes only after 10 s or when there is no window (headless).
- **Close order.** When Playwright MCP disconnects it closes the tabs it opened. Stop Chrome first, then disconnect, or the restored session is empty.
- **Session restore races.** Chrome activates the last-used tab while restoring. The gateway waits until the tab list stops changing (250 ms polls, up to 5 s), then selects tab 0 so it is in front: background tabs pause rendering and clicks time out.
- **Window colors.** Before Chrome starts, cast writes a theme color to `Default/Preferences`: `browser.theme.user_color2` with `color_variant2: 3` (vibrant; other variants shift the hue or fade in dark mode), `extensions.theme.system_theme: 0` (a fresh Linux profile follows GTK, which ignores the color) and `browser.custom_chrome_frame: false` (the system title bar shows `--window-name`; Chrome's own frame shows no title). `--restore-last-session` is passed only when `Default/Sessions` exists: on a new profile it opens a window that ignores `--window-name`. A restored window ignores `--window-name` too and keeps the title saved in the session (Chrome's "Name window…"), so before a restore cast appends a `SetWindowUserTitle` command (SNSS id 31) for every window to `Default/Sessions/Session_*`; Chrome rewrites those files on each run. Pages see none of it.
- **`--password-store=basic` everywhere,** so the login window and Claude's window read the same cookies. macOS and Windows ignore it (Keychain, DPAPI per user), and all windows of one browser still share the key.
- **`--disable-blink-features=AutomationControlled`** in Claude's window, the same default as Playwright MCP, with `--test-type`, which hides Chrome's "unsupported command-line flag" bar. The login window has no port and needs neither. Nothing else is masked (see SECURITY.md).
- **Snapshots go to files.** Action tools return `[Snapshot](page-….yml)` relative to the child's cwd; the gateway runs the child with `cwd` = its output dir and makes the links absolute. Tool schemas are taken from the child, not hardcoded (`browser_click` takes `target`, not `ref`).
- **Pass `process.env` to the Playwright child.** `StdioClientTransport` strips the environment; without `DISPLAY` Chrome silently starts headless.
- **Explained start failures.** Before starting Chrome, cast checks the platform and `DISPLAY`/`WAYLAND_DISPLAY`. Chrome's stdout and stderr go to `cast-chrome.log` in the profile folder; when Chrome exits during startup, the error names the cause (display, busy profile) or quotes its last line.
- **A busy profile.** A second Chrome on the same folder hands its URLs to the running one and exits; cast checks `SingletonLock` first and reports "already open". Windows has no `SingletonLock`: Chrome holds `lockfile` in the profile folder open without write sharing and deletes it on exit, so the profile is busy when that file exists and cannot be opened for writing.
- **The login window does not block.** A tool call running over ~120 s moves to the background, and quitting the session cancelled it, so `cast_add`/`cast_login` return as soon as Chrome runs. Chrome is started detached and outlives the session. The profile records `loginStartedAt`; the login is finished (sites read from History and saved) when the window closes, by the watcher in the same MCP process, by any later cast tool call, or by the `SessionStart` hook. `cast_login_result` reports it to Claude. `launchChrome` waits for `SingletonLock`, or a window still starting would look closed.
- **macOS: closing the last window does not quit Chrome.** The app keeps running without windows, so a closed login window would look open (`SingletonLock` stays) and History would not be flushed. For every visible cast Chrome, `launchChrome` starts `mac-windows.js` detached; once a second it lists that process's windows with CoreGraphics (`CGWindowListCopyWindowInfo` through `osascript -l JavaScript`; no Screen Recording or Accessibility permission, so no titles). Chrome keeps hidden helper windows (500×500, menu bar strips, omnibox popups) that look exactly like a minimized window, so a window counts only after it was seen on screen and at least 400×300 (a browser window is at least 500×375). When all such windows are gone and nothing is on screen, the watcher sends `SIGINT`. It checks that the pid still runs the same Chrome executable before signalling. `--password-store=basic` is ignored on macOS: all cast windows use the "Chrome Safe Storage" keychain item, so they still read the same cookies. No `DISPLAY` check.
- **Chromium browsers only.** Playwright MCP attaches with `--cdp-endpoint`, which only Chromium speaks; Playwright's Firefox is a patched build, not the Firefox people log in with. Edge, Brave, Chromium and Vivaldi take the same flags and keep the same profile files (`History`, `Preferences`, `Sessions`, `SingletonLock`); some ignore the theme color.
- **A profile keeps its browser** (`browser` in the profile list): on macOS each browser encrypts cookies with its own keychain item, and an older browser refuses a profile a newer one wrote. Profiles from before 0.8.0 have no `browser` and were made with Google Chrome; it is recorded on first use. `CAST_CHROME` overrides the choice and is not recorded.
- **Snap.** A snap cannot read hidden folders in home, so a snap browser's profiles live in `~/snap/<snap>/common/cast/` (gone with `snap remove`). `/snap/bin/<name>` links to `/usr/bin/snap`, and Ubuntu's `/usr/bin/chromium-browser` is a script that runs `/snap/bin/chromium`; both are recognized. Native installs of any browser come before snaps.
- **No Flatpak.** `flatpak run` starts the browser in its own PID namespace (the `SingletonLock` pid is not ours, signals reach `bwrap`) and without access to `~/.local/share`. cast names a Flatpak browser in the error and asks for a native one.
- **Install.** A marketplace install runs `npm ci --ignore-scripts`; `--plugin-dir` does not, so run `npm install` yourself. `dist/src` is committed because there is no build step.

## Not done yet

- Firefox and Safari: they do not speak the Chrome DevTools protocol that Playwright MCP attaches with.
- Flatpak browsers (see above).
- A lock for one profile used by two Claude sessions (today Chrome refuses a busy folder and cast shows a hint).
- Detecting logged-in or expired state per site, `/cast:check`, a clean profile for sign-up tests.
- Whether to hide `browser_run_code_unsafe` (it can read cookies).
- Optional headless, TOTP, recording, publishing to npm and the Anthropic directory.

## Develop

```bash
git clone https://github.com/cosmotools/claude-cast && cd claude-cast
npm install
npm test                          # build + unit + integration tests (real Chrome, headless)
CAST_TEST_HEADED=1 npm test       # the same with visible windows
claude --plugin-dir .             # run Claude Code with your working copy
claude plugin validate --strict . # check the manifests
```

- Tests use `node:test`. Integration tests start a small local site and a real Chrome.
- `CAST_CONFIG_DIR`, `CAST_DATA_DIR` and `CAST_PROJECT_DIR` redirect all cast files.
- CI runs the tests on Ubuntu, macOS and Windows (Git Bash). Headless Chrome on Windows has no window to close, so tests that play the human closing it stop it by force.
- On macOS, `CAST_TEST_HEADED=1` also runs a test that closes a window and checks that Chrome quits; headless Chrome has no windows.

## Rules

- Everything in the repository is in English.
- `dist/src` is committed so the plugin needs no build step after install: run `npm run build` and commit `dist/` with source changes.
- Releases: bump the version in `package.json` and `.claude-plugin/plugin.json`, run `npm install` (updates `package-lock.json`), add a `CHANGELOG.md` entry. Users get updates only when the version changes. CI checks that the versions match; after the merge to `main` a workflow tags the version and publishes a GitHub release with its `CHANGELOG.md` section.
