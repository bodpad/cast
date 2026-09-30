# cast

**Several logged-in browser users for [Claude Code](https://claude.com/claude-code).**

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

```
/plugin marketplace add bodpad/cast
/plugin install cast@bodpad
/reload-plugins
```

To update: `/plugin marketplace update bodpad`, then `/plugin update cast@bodpad`.

## Get started

1. `/cast:add Sam sam@example.com "sends messages"` — email and description are optional; they help Claude pick the right person.
2. A Chrome window opens. Log in everywhere Sam needs (your app, SSO, email), choose **"Stay signed in"** on MFA, then **close the window**.
3. Confirm the sites cast suggests (where you landed, e.g. `localhost:3000`; sign-in pages are left out).

No app at hand? Try it on the [demo chat](examples/chat): `node examples/chat/server.mjs`.

Now every Claude Code session in this project knows Sam. Just ask:

- *"Check Sam's inbox for the invitation and open the link."*
- *"Sam creates an order, Elon approves it; check that Sam sees the new status."*

## Commands

| Command | What it does |
|---|---|
| `/cast:add <name> [email] ["description"] [--scope …]` | Add a person and log in |
| `/cast:login <name>` | Log in again, or add sites |
| `/cast:list` | Show profiles |
| `/cast:remove <name>` | Delete a profile and its logins |

Names: latin letters, digits, `-`, `_`.

## Good to know

- **Windows are regular, visible Chrome.** Watch, take over or close them; Claude reopens a window when needed.
- **Logins and tabs are kept** between sessions.
- **Claude never logs in.** When a session expires, it asks you to run `/cast:login <name>`.
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

- **No window / Chrome not found:** check `google-chrome --version`; set `CAST_CHROME` if Chrome lives elsewhere. Start Claude Code from a desktop session (`DISPLAY` set), not plain SSH.
- **"Profile is already open":** one profile, one Chrome. Close the other window (a login window or another Claude session).
- **SSO blocks the login:** log in only in the `/cast:add` or `/cast:login` window; it is a plain Chrome nothing controls.
- **Login window cancelled:** keep the Claude Code session open until you close the window.
- **Profiles missing:** local profiles belong to one project folder; use `--scope user` for profiles you need everywhere.

## Similar tools

Plain [Playwright MCP](https://github.com/microsoft/playwright-mcp) runs one browser, which is enough for single-user browsing. Plugins that save auth state (`storageState`) switch roles in one browser and keep only cookies. cast keeps a full Chrome profile per person and several people logged in at once, lets you pass corporate SSO by logging in yourself, and tells Claude who is who.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [changelog](CHANGELOG.md).

## License

MIT
