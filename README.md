# cast: Claude tests your app as every user at once

**A real, logged-in Chrome for each person in your test, SSO included. Sam sends a message, Elon receives it, [Claude Code](https://claude.com/claude-code) checks both screens.**

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

cast works in Claude Code on your computer: it starts browsers there. It does nothing in claude.ai chat, which cannot reach your computer.

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
3. cast saves the sites where you landed (e.g. `app.example.com`; sign-in pages are left out). Change them any time, e.g. `/cast:edit Sam +admin.example.com -old.example.com`.

Now every Claude Code session in this project knows Sam. Just ask:

- *"Check Sam's inbox for the invitation and open the link."*
- *"Sam creates an order, Elon approves it; check that Sam sees the new status."*
- *"Sam sends Elon a chat message; check that Elon gets it within a few seconds, without reloading."*

## Commands

| Command | What it does |
|---|---|
| `/cast:add <name> [email] <description> [--scope local\|project\|user]` | Add a person and log in |
| `/cast:open <name>` | Open the person's browser for you: log in again, add sites, look around |
| `/cast:edit <name> [email] [description] [+site]... [-site]...` | Change the email, description or sites, no new login |
| `/cast:list` | Show profiles |
| `/cast:remove <name>` | Delete a profile and its logins |

`<name>` is a value you fill in, `[x]` is optional, `a|b` means one of them, `...` means it can repeat. Put a description with spaces in quotes: `/cast:add Sam "sends messages"`.

Names: latin letters, digits, `-`, `_`, up to 40 characters, starting with a letter or digit.

## Good to know

- **Windows are regular, visible Chrome.** Watch, take over or close them; Claude reopens a window when needed.
- **Each person's window has its own color** and their name as the window title (`Sam (sends messages) · cast`; on Linux in the title bar), so two windows side by side are easy to tell apart. cast sets the theme color each time it opens the window.
- **Logins and tabs are kept** between sessions.
- **Claude picks people by description.** It never guesses a role from a profile name. If no profile or several fit ("the vendor"), it asks you once and saves your answer. Change a description any time with `/cast:edit <name>`.
- **Claude never logs in.** When a session expires, it asks you to run `/cast:open <name>` and log in again there.
- **cast reads the browser history of its own profiles, nothing else.** When you close a window from `/cast:add` or `/cast:open`, cast reads the visits made in it to save the sites (as hosts). Never your personal Chrome profile, never cookies or page content. Details: [PRIVACY.md](PRIVACY.md).
- **Claude sees what the person sees, email included.** Prefer test accounts. cast never stores passwords or shows cookies. Details: [SECURITY.md](SECURITY.md).

## What cast runs

- **Google Chrome** (or Edge, Brave, Chromium, Vivaldi), the one installed on your computer, with a separate data folder per person. Each profile keeps the browser it was made with. Claude's window has a DevTools port on 127.0.0.1; the window cast opens for you has none.
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
| `project` | to the team, as a slot in `.claude/claude-cast.yaml` | shared test scenarios |

A project slot holds only a name and description, never logins. Commit `.claude/claude-cast.yaml`; each teammate fills the slot with their own account via `/cast:add <name>`. If names clash, local wins over project, project over user.

## Where data lives

- Profile lists: `~/.config/claude-cast/` (plain YAML, editable; `$XDG_CONFIG_HOME` if set); on Windows `%APPDATA%\claude-cast\`.
- Chrome data with logins: `~/.local/share/claude-cast/` (`$XDG_DATA_HOME` if set), readable only by you; on Windows `%LOCALAPPDATA%\claude-cast\`. A snap browser (Ubuntu's Chromium) cannot read hidden folders, so its profiles are in `~/snap/<browser>/common/claude-cast/`.

## Uninstall

In a Claude Code session:

```
/plugin uninstall cast@cosmotools
/plugin marketplace remove cosmotools
```

From a terminal instead: `claude plugin uninstall cast@cosmotools`, then `claude plugin marketplace remove cosmotools`.

Uninstalling keeps profiles and logins. To delete them too, close all cast windows and remove both folders:

```bash
rm -rf ~/.config/claude-cast ~/.local/share/claude-cast ~/snap/*/common/claude-cast
```

On Windows, in PowerShell:

```powershell
Remove-Item -Recurse -Force "$env:APPDATA\claude-cast", "$env:LOCALAPPDATA\claude-cast"
```

Team slots in a project's `.claude/claude-cast.yaml` stay in that repository; delete the file there if nobody needs them.

## Troubleshooting

- **No window / no browser found:** cast looks for Google Chrome, Edge, Brave, Chromium and Vivaldi in their usual places and in `PATH` (macOS: `/Applications` or `~/Applications`; Windows: `Program Files` or `AppData\Local`); set `CAST_CHROME` to the browser's executable if it lives elsewhere. A Flatpak browser cannot be used: its sandbox hides the profile folder and the process; install the .deb or .rpm package instead. Snap browsers work. On Linux, start Claude Code from a desktop session (`DISPLAY` set), not plain SSH. When Chrome exits right after starting, cast shows its last message; the full output is in `cast-chrome.log` in the profile folder (`dir` in `cast_list`).
- **"Profile is already open":** one profile, one Chrome. Close the other window (yours from `/cast:add` or `/cast:open`, or another Claude session).
- **SSO blocks the login:** log in only in the `/cast:add` or `/cast:open` window; it is a plain Chrome nothing controls.
- **Claude says your window is still open:** close it (titled `… · your window · cast`), then tell Claude. On macOS, closing a cast window quits that Chrome within a second; a minimized window counts as open.
- **Profiles missing:** local profiles belong to one project folder; use `--scope user` for profiles you need everywhere.

## Similar tools

Plain [Playwright MCP](https://github.com/microsoft/playwright-mcp) runs one browser, which is enough for single-user browsing. Plugins that save auth state (`storageState`) switch roles in one browser and keep only cookies. cast keeps a full Chrome profile per person and several people logged in at once, lets you pass corporate SSO by logging in yourself, and tells Claude who is who.

## Privacy

cast has no server, no account and no telemetry. [Privacy policy](https://github.com/cosmotools/claude-cast/blob/main/PRIVACY.md): what cast stores on your computer, what it reads and what reaches Claude.

## Support

Questions and ideas: [Discussions](https://github.com/cosmotools/claude-cast/discussions). Bugs: [Issues](https://github.com/cosmotools/claude-cast/issues). Security issues: privately, as [SECURITY.md](SECURITY.md) describes.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [changelog](CHANGELOG.md).

## License

MIT
