# cast

**Several logged-in browser users for [Claude Code](https://claude.com/claude-code).**

![cast demo: Claude drives two logged-in browsers and finds a bug](docs/demo.gif)

To test an app where people interact (a chat, a marketplace, an approval flow), you need a browser per person, each logged in as that person. cast gives Claude one Chrome profile per person. You log in once; Claude opens the browsers itself, several at a time.

```
You:    /cast:add Sam       → Chrome opens, you log in as Sam, close the window
You:    /cast:add Elon      → same for Elon
You:    Send "hi" from Sam to Elon and check that Elon gets it.
Claude: opens both windows, already logged in, sends as Sam, checks as Elon.
```

Works with corporate SSO (Microsoft Entra, Okta, Google), because you log in yourself in a regular Chrome.

## Install

Needs Linux with a desktop, Google Chrome and Node.js 20+.

Start Claude Code (`claude`) and type these at its prompt. They are Claude Code commands, not shell commands:

```
/plugin marketplace add bodpad/cast
/plugin install cast@bodpad
/reload-plugins
```

From a terminal instead: `claude plugin marketplace add bodpad/cast`, then `claude plugin install cast@bodpad`, then start `claude`.

## Update

In a Claude Code session, fetch the latest marketplace listing, update the plugin and reload it:

```
/plugin marketplace update bodpad
/plugin update cast@bodpad
/reload-plugins
```

From a terminal instead: `claude plugin marketplace update bodpad`, then `claude plugin update cast@bodpad`, then restart `claude`.

Profiles and logins are kept. What changed in each version: [CHANGELOG.md](CHANGELOG.md).

## Get started

1. `/cast:add Sam sam@example.com "sends messages"` — the description says who this person is in your tests; Claude picks profiles by it. Skip it and cast suggests one after login from the page you landed on (e.g. `/vendor`).
2. A Chrome window opens. Log in everywhere Sam needs (your app, SSO, email), choose **"Stay signed in"** on MFA, then **close the window** and tell Claude. You may leave Claude Code meanwhile: cast saves what you visited once the window is closed.
3. cast saves the sites where you landed (e.g. `localhost:3000`; sign-in pages are left out). Change them any time with `/cast:edit Sam +site -site`. If you skipped the description, confirm the one Claude suggests.

Now every Claude Code session in this project knows Sam. Just ask:

- *"Check Sam's inbox for the invitation and open the link."*
- *"Sam creates an order, Elon approves it; check that Sam sees the new status."*

## Commands

| Command | What it does |
|---|---|
| `/cast:add <name> [email] ["description"] [--scope …]` | Add a person and log in |
| `/cast:login <name>` | Log in again, or add sites |
| `/cast:edit <name> [email] ["description"] [+site -site]` | Change the email, description or sites, no new login |
| `/cast:list` | Show profiles |
| `/cast:remove <name>` | Delete a profile and its logins |

Names: latin letters, digits, `-`, `_`.

## Good to know

- **Windows are regular, visible Chrome.** Watch, take over or close them; Claude reopens a window when needed.
- **Each person's window has its own color** and their name in the title bar (`Sam (sends messages) · cast`), so two windows side by side are easy to tell apart. cast sets the theme color each time it opens the window.
- **Logins and tabs are kept** between sessions.
- **Claude picks people by description.** It never guesses a role from a profile name. If no profile or several fit ("the vendor"), it asks you once and saves your answer. Change a description any time with `/cast:edit <name>`.
- **Claude never logs in.** When a session expires, it asks you to run `/cast:login <name>`.
- **cast reads the browser history of its own profiles, nothing else.** When a login window closes, cast reads that profile's Chrome history for the visits made while it was open: URLs and page titles only, no cookies or page content, and never your personal Chrome profile. It shows Claude the hosts and the last page on each site (without the query string) to save sites and suggest a description. Sites are saved as hosts; the description is saved only if you confirm it.
- **Claude sees what the person sees, email included.** Prefer test accounts. cast never stores passwords or shows cookies. Details: [SECURITY.md](SECURITY.md).

## Scopes and teams

| `--scope` | Profile visible | Use for |
|---|---|---|
| `local` (default) | to you, in this project | most cases |
| `user` | to you, in all projects | an account you use everywhere |
| `project` | to the team, as a slot in `.claude/cast.yaml` | shared test scenarios |

A project slot holds only a name and description, never logins. Commit `.claude/cast.yaml`; each teammate fills the slot with their own account via `/cast:add <name>`. If names clash, local wins over project, project over user.

## Where data lives

- Profile lists: `~/.config/cast/` (plain YAML, editable).
- Chrome data with logins: `~/.local/share/cast/`, readable only by you.

Uninstalling keeps profiles. To delete everything, remove both folders.

## Troubleshooting

- **No window / Chrome not found:** check `google-chrome --version`; set `CAST_CHROME` if Chrome lives elsewhere. Start Claude Code from a desktop session (`DISPLAY` set), not plain SSH. When Chrome exits right after starting, cast shows its last message; the full output is in `cast-chrome.log` in the profile folder (`dir` in `cast_list`).
- **"Profile is already open":** one profile, one Chrome. Close the other window (a login window or another Claude session).
- **SSO blocks the login:** log in only in the `/cast:add` or `/cast:login` window; it is a plain Chrome nothing controls.
- **Claude says the login window is still open:** close it (the window titled `… · log in · cast`), then tell Claude.
- **Profiles missing:** local profiles belong to one project folder; use `--scope user` for profiles you need everywhere.

## Similar tools

Plain [Playwright MCP](https://github.com/microsoft/playwright-mcp) runs one browser, which is enough for single-user browsing. Plugins that save auth state (`storageState`) switch roles in one browser and keep only cookies. cast keeps a full Chrome profile per person and several people logged in at once, lets you pass corporate SSO by logging in yourself, and tells Claude who is who.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [changelog](CHANGELOG.md).

## License

MIT
