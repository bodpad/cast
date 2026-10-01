# cast

**Several logged-in browser users for [Claude Code](https://claude.com/claude-code).**

![cast demo: Claude drives two logged-in browsers and finds a bug](docs/demo.gif)

To test an app where people interact (a chat, a marketplace, an approval flow), you need a browser per person, each logged in as that person. cast gives Claude one Chrome profile per person. You log in once; Claude opens the browsers itself, several at a time.

Works with corporate SSO (Microsoft Entra, Okta, Google), because you log in yourself in a regular Chrome.

## Install

Needs Linux with a desktop, macOS or Windows, Node.js 20+ and Google Chrome or another Chromium browser: Microsoft Edge, Brave, Chromium or Vivaldi. cast picks Chrome when it is installed. On Windows, Microsoft Edge is always there. Firefox and Safari are not supported: Claude drives the browser over the Chrome DevTools protocol.

Start Claude Code (`claude`) and type these at its prompt. They are Claude Code commands, not shell commands:

```
/plugin marketplace add cosmotools/claude-cast
/plugin install cast@cosmotools
/reload-plugins
```

From a terminal instead: `claude plugin marketplace add cosmotools/claude-cast`, then `claude plugin install cast@cosmotools`, then start `claude`.

Or add cast from Anthropic's directory on claude.ai (**Customize → Plugins → Discover**); Claude Code then loads it as `cast@synced` when you sign in with that claude.ai account. Install it one way, not both: a marketplace install takes precedence over the synced copy.

cast works in Claude Code, and in Cowork when the session runs on your computer. It does nothing in claude.ai chat: it starts browsers on your computer, which a chat cannot reach.

## Update

In a Claude Code session, fetch the latest marketplace listing, update the plugin and reload it:

```
/plugin marketplace update cosmotools
/plugin update cast@cosmotools
/reload-plugins
```

From a terminal instead: `claude plugin marketplace update cosmotools`, then `claude plugin update cast@cosmotools`, then restart `claude`.

Profiles and logins are kept. What changed in each version: [CHANGELOG.md](CHANGELOG.md).

## Get started

1. `/cast:add Sam sam@example.com "sends messages"` — the description says who this person is in your tests and is required: Claude picks profiles by it. Leave it out and Claude asks for it before the window opens.
2. A Chrome window opens. Log in everywhere Sam needs (your app, SSO, email), choose **"Stay signed in"** on MFA, then **close the window** and tell Claude. You may leave Claude Code meanwhile: cast saves what you visited once the window is closed.
3. cast saves the sites where you landed (e.g. `localhost:3000`; sign-in pages are left out). Change them any time with `/cast:edit Sam +site -site`.

Now every Claude Code session in this project knows Sam. Just ask:

- *"Check Sam's inbox for the invitation and open the link."*
- *"Sam creates an order, Elon approves it; check that Sam sees the new status."*
- *"Sam sends Elon a chat message; check that Elon gets it within a few seconds, without reloading."*

## Commands

| Command | What it does |
|---|---|
| `/cast:add <name> [email] "description" [--scope …]` | Add a person and log in |
| `/cast:login <name>` | Log in again, or add sites |
| `/cast:edit <name> [email] ["description"] [+site -site]` | Change the email, description or sites, no new login |
| `/cast:list` | Show profiles |
| `/cast:remove <name>` | Delete a profile and its logins |

Names: latin letters, digits, `-`, `_`.

## Good to know

- **Windows are regular, visible Chrome.** Watch, take over or close them; Claude reopens a window when needed.
- **Each person's window has its own color** and their name as the window title (`Sam (sends messages) · cast`; on Linux in the title bar), so two windows side by side are easy to tell apart. cast sets the theme color each time it opens the window.
- **Logins and tabs are kept** between sessions.
- **Claude picks people by description.** It never guesses a role from a profile name. If no profile or several fit ("the vendor"), it asks you once and saves your answer. Change a description any time with `/cast:edit <name>`.
- **Claude never logs in.** When a session expires, it asks you to run `/cast:login <name>`.
- **cast reads the browser history of its own profiles, nothing else.** When a login window closes, cast reads that profile's Chrome history for the visits made while it was open: URLs and page titles only, no cookies or page content, and never your personal Chrome profile. It shows Claude the hosts and the last page on each site (without the query string) to save sites and, for a profile made before descriptions were required, to suggest one. Sites are saved as hosts; a description is saved only if you confirm it.
- **Claude sees what the person sees, email included.** Prefer test accounts. cast never stores passwords or shows cookies. Details: [SECURITY.md](SECURITY.md).

## What cast runs

- **Google Chrome** (or Edge, Brave, Chromium, Vivaldi), the one installed on your computer, with a separate data folder per person. Each profile keeps the browser it was made with. Claude's window has a DevTools port on 127.0.0.1; the login window has none.
- **[Playwright MCP](https://github.com/microsoft/playwright-mcp)** (`@playwright/mcp`, pinned in `package-lock.json`), one per open profile, attached to that Chrome.
- **A `SessionStart` hook** that prints the profile list so Claude knows the people.
- **On macOS, a small watcher** per cast window (`osascript`, CoreGraphics window list) that quits that Chrome once its last window is closed.
- **On Windows, `taskkill` without `/F`** to close a cast window the way its close button does, so cookies are saved.

cast sends nothing anywhere by itself and has no telemetry. What Claude reads in a cast window (pages, snapshots, screenshots) goes to the model as part of your Claude session, like any other tool result. Details: [PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md).

## Scopes and teams

| `--scope` | Profile visible | Use for |
|---|---|---|
| `local` (default) | to you, in this project | most cases |
| `user` | to you, in all projects | an account you use everywhere |
| `project` | to the team, as a slot in `.claude/cast.yaml` | shared test scenarios |

A project slot holds only a name and description, never logins. Commit `.claude/cast.yaml`; each teammate fills the slot with their own account via `/cast:add <name>`. If names clash, local wins over project, project over user.

## Where data lives

- Profile lists: `~/.config/cast/` (plain YAML, editable); on Windows `%APPDATA%\cast\`.
- Chrome data with logins: `~/.local/share/cast/`, readable only by you; on Windows `%LOCALAPPDATA%\cast\`. A snap browser (Ubuntu's Chromium) cannot read hidden folders, so its profiles are in `~/snap/<browser>/common/cast/`.

## Uninstall

In a Claude Code session:

```
/plugin uninstall cast@cosmotools
/plugin marketplace remove cosmotools
```

From a terminal instead: `claude plugin uninstall cast@cosmotools`, then `claude plugin marketplace remove cosmotools`.

Added from claude.ai: remove it in **Customize → Plugins** there.

Uninstalling keeps profiles and logins. To delete them too, close all cast windows and remove both folders:

```bash
rm -rf ~/.config/cast ~/.local/share/cast ~/snap/*/common/cast
```

On Windows, in PowerShell:

```powershell
Remove-Item -Recurse -Force "$env:APPDATA\cast", "$env:LOCALAPPDATA\cast"
```

Team slots in a project's `.claude/cast.yaml` stay in that repository; delete the file there if nobody needs them.

## Troubleshooting

- **No window / no browser found:** cast looks for Google Chrome, Edge, Brave, Chromium and Vivaldi in their usual places and in `PATH` (macOS: `/Applications` or `~/Applications`; Windows: `Program Files` or `AppData\Local`); set `CAST_CHROME` to the browser's executable if it lives elsewhere. A Flatpak browser cannot be used: its sandbox hides the profile folder and the process; install the .deb or .rpm package instead. Snap browsers work. On Linux, start Claude Code from a desktop session (`DISPLAY` set), not plain SSH. When Chrome exits right after starting, cast shows its last message; the full output is in `cast-chrome.log` in the profile folder (`dir` in `cast_list`).
- **"Profile is already open":** one profile, one Chrome. Close the other window (a login window or another Claude session).
- **SSO blocks the login:** log in only in the `/cast:add` or `/cast:login` window; it is a plain Chrome nothing controls.
- **Claude says the login window is still open:** close it (the window titled `… · log in · cast`), then tell Claude. On macOS, closing a cast window quits that Chrome within a second; a minimized window counts as open.
- **Profiles missing:** local profiles belong to one project folder; use `--scope user` for profiles you need everywhere.

## Similar tools

Plain [Playwright MCP](https://github.com/microsoft/playwright-mcp) runs one browser, which is enough for single-user browsing. Plugins that save auth state (`storageState`) switch roles in one browser and keep only cookies. cast keeps a full Chrome profile per person and several people logged in at once, lets you pass corporate SSO by logging in yourself, and tells Claude who is who.

## Support

Questions and ideas: [Discussions](https://github.com/cosmotools/claude-cast/discussions). Bugs: [Issues](https://github.com/cosmotools/claude-cast/issues). Security issues: privately, as [SECURITY.md](SECURITY.md) describes.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [changelog](CHANGELOG.md).

## License

MIT
